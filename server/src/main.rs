use anyhow::Context;
use cheer_server::config::Config;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 本機開發用 server/.env；正式機直接給環境變數，沒有 .env 也沒關係。
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env()?;
    let db = sqlx::PgPool::connect(&config.database_url)
        .await
        .context("連不上資料庫")?;
    cheer_server::MIGRATOR
        .run(&db)
        .await
        .context("資料庫遷移失敗")?;

    let listener = tokio::net::TcpListener::bind(config.listen_addr)
        .await
        .with_context(|| format!("開不了 {}", config.listen_addr))?;
    tracing::info!(addr = %config.listen_addr, site = %config.site_dir.display(), "伺服器開好了");
    axum::serve(listener, cheer_server::app(db, &config.site_dir))
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
        })
        .await?;
    Ok(())
}
