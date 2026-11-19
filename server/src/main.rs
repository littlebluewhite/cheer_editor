use anyhow::Context;
use cheer_server::AppState;
use cheer_server::backup::Backup;
use cheer_server::breach::BreachCheck;
use cheer_server::clock::Clock;
use cheer_server::config::Config;
use cheer_server::daily::{self, AwakeMeter};
use cheer_server::flow_core::FlowCore;
use cheer_server::mail::Mailer;
use cheer_server::music::MusicStore;
use tracing_subscriber::EnvFilter;

const USAGE: &str = "用法：
  cheer-server                                   開伺服器
  cheer-server migrate                           只跑資料庫遷移就結束（部署前 Fly 的 release_command 跑它）
  cheer-server backup                            現在就備份一次（平常每天凌晨 4 點自己跑）就結束
  cheer-server create-admin --email EMAIL [--name 名字]
      讓這個 email 的人當管理員，寄設密碼信（還沒有帳號時要給名字）。
      管理員進不去、或要換人當管理員，也用這個。";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 本機開發用 server/.env；正式機直接給環境變數，沒有 .env 也沒關係。
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let (migrate_only, command) = match args.first().map(String::as_str) {
        None => (false, None),
        Some("migrate") if args.len() == 1 => (true, None),
        Some("backup") if args.len() == 1 => (false, Some(Command::Backup)),
        Some("create-admin") => (false, Some(admin_args(&args[1..])?)),
        Some(_) => anyhow::bail!("{USAGE}"),
    };

    let config = Config::from_env()?;
    if migrate_only {
        // 沒跑成就回非 0，Fly 就不部署（舊版照常接流量）。
        let db = sqlx::PgPool::connect(&config.database_url)
            .await
            .context("連不上資料庫")?;
        cheer_server::migrate(&db).await.context("資料庫遷移失敗")?;
        println!("資料庫遷移跑完了。");
        return Ok(());
    }
    // 每次用完一條連線（查過資料庫）就記一下，估 Neon 醒著多久（#266）；一段結束時用這條連線存起來。
    let awake = AwakeMeter::default();
    let meter = awake.clone();
    let db = sqlx::postgres::PgPoolOptions::new()
        .after_release(move |conn, _| {
            let ended = meter.touch(chrono::Utc::now());
            Box::pin(async move {
                if let Some(ended) = ended
                    && let Err(err) = daily::save_awake(conn, &ended).await
                {
                    tracing::warn!(error = %err, "Neon 醒著的時間存不進去");
                }
                Ok(true)
            })
        })
        .connect(&config.database_url)
        .await
        .context("連不上資料庫")?;
    cheer_server::migrate(&db).await.context("資料庫遷移失敗")?;
    let mailer = match &config.resend {
        Some((key, from)) => Mailer::resend(key, from.clone()),
        None => Mailer::Console,
    };
    let state = AppState {
        db,
        mailer,
        breach: BreachCheck::pwned(),
        clock: Clock::system(),
        site_url: config.site_url.clone(),
        core: FlowCore::start().context("流程核心載入失敗")?,
        mail_limit: Default::default(),
        rooms: Default::default(),
        music: match config.r2 {
            Some(r2) => Some(
                MusicStore::new(r2.endpoint, &r2.bucket, &r2.access_key, &r2.secret)
                    .context("R2 的設定不對")?,
            ),
            None => None,
        },
    };

    // 每天的備份（#265）：沒設 BACKUP_R2_BUCKET（本機開發）就不備份。
    let backup = match config.backup {
        Some(b) => Some(Backup::new(
            MusicStore::new(b.r2.endpoint, &b.r2.bucket, &b.r2.access_key, &b.r2.secret)
                .context("備份的 R2 設定不對")?,
            config.database_url.clone(),
            b.heartbeat,
        )),
        None => None,
    };

    match command {
        Some(Command::CreateAdmin { email, name }) => {
            cheer_server::accounts::create_admin(&state, &email, name.as_deref()).await?;
            println!("{email} 是管理員了，設密碼信寄出去了。");
            return Ok(());
        }
        Some(Command::Backup) => {
            let backup = backup.context("沒設 BACKUP_R2_BUCKET，不能備份")?;
            backup.run(&state.db, state.clock.now()).await?;
            println!("備份好了，放上 R2 了。");
            return Ok(());
        }
        None => {}
    }

    let listener = tokio::net::TcpListener::bind(config.listen_addr)
        .await
        .with_context(|| format!("開不了 {}", config.listen_addr))?;
    tokio::spawn(daily::every_day(state.clone(), awake));
    match backup {
        Some(backup) => {
            tokio::spawn(cheer_server::backup::every_day(state.clone(), backup));
        }
        None => tracing::warn!("沒設 BACKUP_R2_BUCKET，不做每天的備份"),
    }
    tracing::info!(addr = %config.listen_addr, site = %config.site_dir.display(), "伺服器開好了");
    axum::serve(listener, cheer_server::app(state, &config.site_dir))
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
        })
        .await?;
    Ok(())
}

/// 跑完就結束的指令（`migrate` 另外處理：不用開伺服器的其他東西）。
enum Command {
    CreateAdmin { email: String, name: Option<String> },
    Backup,
}

/// `create-admin` 後面的 `--email`、`--name`。
fn admin_args(args: &[String]) -> anyhow::Result<Command> {
    let (mut email, mut name) = (None, None);
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let value = it.next().cloned();
        match flag.as_str() {
            "--email" => email = value,
            "--name" => name = value,
            _ => anyhow::bail!("{USAGE}"),
        }
    }
    Ok(Command::CreateAdmin {
        email: email.context(USAGE)?,
        name,
    })
}
