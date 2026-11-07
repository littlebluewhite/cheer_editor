use anyhow::Context;
use cheer_server::AppState;
use cheer_server::breach::BreachCheck;
use cheer_server::clock::Clock;
use cheer_server::config::Config;
use cheer_server::flow_core::FlowCore;
use cheer_server::mail::Mailer;
use cheer_server::music::MusicStore;
use tracing_subscriber::EnvFilter;

const USAGE: &str = "用法：
  cheer-server                                   開伺服器
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
    let command = match args.first().map(String::as_str) {
        None => None,
        Some("create-admin") => Some(admin_args(&args[1..])?),
        Some(_) => anyhow::bail!("{USAGE}"),
    };

    let config = Config::from_env()?;
    let db = sqlx::PgPool::connect(&config.database_url)
        .await
        .context("連不上資料庫")?;
    cheer_server::MIGRATOR
        .run(&db)
        .await
        .context("資料庫遷移失敗")?;
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
        music: match config.r2 {
            Some(r2) => Some(
                MusicStore::new(r2.endpoint, &r2.bucket, &r2.access_key, &r2.secret)
                    .context("R2 的設定不對")?,
            ),
            None => None,
        },
    };

    if let Some((email, name)) = command {
        cheer_server::accounts::create_admin(&state, &email, name.as_deref()).await?;
        println!("{email} 是管理員了，設密碼信寄出去了。");
        return Ok(());
    }

    let listener = tokio::net::TcpListener::bind(config.listen_addr)
        .await
        .with_context(|| format!("開不了 {}", config.listen_addr))?;
    tracing::info!(addr = %config.listen_addr, site = %config.site_dir.display(), "伺服器開好了");
    axum::serve(listener, cheer_server::app(state, &config.site_dir))
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
        })
        .await?;
    Ok(())
}

/// `create-admin` 後面的 `--email`、`--name`。
fn admin_args(args: &[String]) -> anyhow::Result<(String, Option<String>)> {
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
    Ok((email.context(USAGE)?, name))
}
