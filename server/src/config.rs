//! 設定都從環境變數來；本機開發可以寫在 `server/.env`（不進 git，範本是 `.env.example`）。

use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("少了環境變數 {0}（本機開發寫在 server/.env，範本是 server/.env.example）")]
    Missing(&'static str),
    #[error("環境變數 {name} 看不懂：{value}")]
    Invalid { name: &'static str, value: String },
}

/// 不 derive Debug：`database_url` 裡有密碼、`resend` 有金鑰，不能被印進 log。
pub struct Config {
    pub database_url: String,
    pub listen_addr: SocketAddr,
    /// 前端建好的檔案（`npm run build` 的 `build/`）。
    pub site_dir: PathBuf,
    /// 這個網站的網址（信裡的連結用），最後沒有 `/`。
    pub site_url: String,
    /// Resend 的金鑰和寄件人；沒設金鑰時信印在終端機（本機開發）。
    pub resend: Option<(String, String)>,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url =
            std::env::var("DATABASE_URL").map_err(|_| ConfigError::Missing("DATABASE_URL"))?;
        let listen_addr = match std::env::var("LISTEN_ADDR") {
            Ok(value) => value.parse().map_err(|_| ConfigError::Invalid {
                name: "LISTEN_ADDR",
                value,
            })?,
            Err(_) => SocketAddr::from(([127, 0, 0, 1], 8080)),
        };
        let site_dir = std::env::var("SITE_DIR").unwrap_or_else(|_| "../build".into());
        let site_url = std::env::var("SITE_URL")
            .unwrap_or_else(|_| format!("http://{listen_addr}"))
            .trim_end_matches('/')
            .to_owned();
        let resend = match std::env::var("RESEND_API_KEY") {
            Ok(key) => Some((
                key,
                std::env::var("MAIL_FROM").map_err(|_| ConfigError::Missing("MAIL_FROM"))?,
            )),
            Err(_) => None,
        };
        Ok(Self {
            database_url,
            listen_addr,
            site_dir: site_dir.into(),
            site_url,
            resend,
        })
    }
}
