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

/// 不 derive Debug：`database_url` 裡有密碼、`resend`、`r2` 有金鑰，不能被印進 log。
pub struct Config {
    pub database_url: String,
    pub listen_addr: SocketAddr,
    /// 前端建好的檔案（`npm run build` 的 `build/`）。
    pub site_dir: PathBuf,
    /// 這個網站的網址（信裡的連結用），最後沒有 `/`。
    pub site_url: String,
    /// Resend 的金鑰和寄件人；沒設金鑰時信印在終端機（本機開發）。
    pub resend: Option<(String, String)>,
    /// 放雲端流程音樂檔的 R2；沒設 R2_ENDPOINT 時是 None（放音樂的 API 回 503）。
    pub r2: Option<R2Config>,
    /// 每天的備份（#265）：放備份的 R2 bucket（跟音樂同一個 `R2_ENDPOINT`）；沒設 BACKUP_R2_BUCKET 時不備份。
    pub backup: Option<BackupConfig>,
}

pub struct BackupConfig {
    pub r2: R2Config,
    /// Better Stack 的報到網址（網址本身就是 token）；沒設時照樣備份，只是不報到。
    pub heartbeat: Option<reqwest::Url>,
}

/// R2（S3 相容）的 bucket 和只管這個 bucket 的 token。
pub struct R2Config {
    /// 例：`https://<帳號 id>.r2.cloudflarestorage.com`
    pub endpoint: reqwest::Url,
    pub bucket: String,
    pub access_key: String,
    pub secret: String,
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
        let need = |name: &'static str| std::env::var(name).map_err(|_| ConfigError::Missing(name));
        let r2 = match std::env::var("R2_ENDPOINT") {
            Ok(value) => Some(R2Config {
                endpoint: value.parse().map_err(|_| ConfigError::Invalid {
                    name: "R2_ENDPOINT",
                    value: value.clone(),
                })?,
                bucket: need("R2_BUCKET")?,
                access_key: need("R2_ACCESS_KEY_ID")?,
                secret: need("R2_SECRET_ACCESS_KEY")?,
            }),
            Err(_) => None,
        };
        let backup = match std::env::var("BACKUP_R2_BUCKET") {
            Ok(bucket) => Some(BackupConfig {
                r2: R2Config {
                    endpoint: r2
                        .as_ref()
                        .map(|r2| r2.endpoint.clone())
                        .ok_or(ConfigError::Missing("R2_ENDPOINT"))?,
                    bucket,
                    access_key: need("BACKUP_R2_ACCESS_KEY_ID")?,
                    secret: need("BACKUP_R2_SECRET_ACCESS_KEY")?,
                },
                heartbeat: match std::env::var("BACKUP_HEARTBEAT_URL") {
                    Ok(value) => Some(value.parse().map_err(|_| ConfigError::Invalid {
                        name: "BACKUP_HEARTBEAT_URL",
                        // 網址就是 token，不印出來。
                        value: "（不是網址）".into(),
                    })?),
                    Err(_) => None,
                },
            }),
            Err(_) => None,
        };
        Ok(Self {
            database_url,
            listen_addr,
            site_dir: site_dir.into(),
            site_url,
            resend,
            r2,
            backup,
        })
    }
}
