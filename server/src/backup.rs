//! 每天的備份（#265，#194）：台灣時間凌晨 4 點跑 `pg_dump`，放上 R2 的備份 bucket（30 天自動刪），
//! 做完去 Better Stack 報到。沒做完就不報到，Better Stack 等不到就通知網站主人（死人開關）。
//! 不用 GitHub 排程（公開 repo 的 run log 誰都看得到，60 天沒活動排程會自己停）。

use std::path::PathBuf;

use anyhow::Context;
use chrono::{DateTime, Utc};

use crate::AppState;
use crate::clock::TAIWAN;
use crate::music::MusicStore;

/// 下一次備份的時間：`now` 之後第一個台灣時間凌晨 4 點。
pub fn next_run(now: DateTime<Utc>) -> DateTime<Utc> {
    crate::daily::next_taiwan_hour(now, 4)
}

/// 備份要用的：放備份的 R2 bucket、資料庫（不經過 pooler 的連線字串）、Better Stack 的報到網址。
/// 不 derive Debug：連線字串有密碼，報到網址本身就是 token。
pub struct Backup {
    store: MusicStore,
    database_url: String,
    heartbeat: Option<reqwest::Url>,
    pg_dump: PathBuf,
    http: reqwest::Client,
}

impl Backup {
    /// 沒有報到網址時照樣備份，只是不報到（log 會寫）。
    pub fn new(store: MusicStore, database_url: String, heartbeat: Option<reqwest::Url>) -> Self {
        Self {
            store,
            database_url,
            heartbeat,
            // 正式機的映像檔把 PostgreSQL 18 的工具放在 PATH 最前面（Dockerfile）。
            pg_dump: "pg_dump".into(),
            http: reqwest::Client::new(),
        }
    }

    /// 換一支 pg_dump（測試用假的）。
    pub fn pg_dump(mut self, path: impl Into<PathBuf>) -> Self {
        self.pg_dump = path.into();
        self
    }

    /// 備份一次：`pg_dump` → 放上 R2 → 記一列 `backups`（算 R2 用量，#266）→ 報到。
    /// 哪一步失敗就停，不報到。
    pub async fn run(&self, db: &sqlx::PgPool, now: DateTime<Utc>) -> anyhow::Result<()> {
        let key = format!(
            "cheer-{}.dump",
            now.with_timezone(&TAIWAN).format("%Y-%m-%d-%H%M")
        );
        let file = std::env::temp_dir().join(&key);
        let result = self.dump_and_upload(&file, &key).await;
        // 機器上的暫存檔不管成不成功都刪（記憶體、磁碟都小）。
        let _ = tokio::fs::remove_file(&file).await;
        let size = result?;
        sqlx::query("INSERT INTO backups (taken_at, size) VALUES ($1, $2)")
            .bind(now)
            .bind(size)
            .execute(db)
            .await?;
        tracing::info!(key, size, "備份放上 R2 了");
        match &self.heartbeat {
            Some(url) => {
                self.http
                    .get(url.clone())
                    .send()
                    .await
                    .and_then(|r| r.error_for_status())
                    // 錯誤訊息裡有網址（就是 token），不印。
                    .map_err(|e| {
                        anyhow::anyhow!("去 Better Stack 報到失敗（{}）", e.without_url())
                    })?;
            }
            None => tracing::warn!("沒設 BACKUP_HEARTBEAT_URL，備份做完了但沒去 Better Stack 報到"),
        }
        Ok(())
    }

    /// 跑 pg_dump 寫到 `file`（custom 格式，本身就壓縮過；用 pg_restore 還原），放上 R2，回幾個位元組。
    async fn dump_and_upload(&self, file: &std::path::Path, key: &str) -> anyhow::Result<i64> {
        let output = tokio::process::Command::new(&self.pg_dump)
            .arg("--format=custom")
            .arg("--no-owner")
            .arg("--no-acl")
            .arg(format!("--file={}", file.display()))
            .arg(format!("--dbname={}", self.database_url))
            .output()
            .await
            .context("pg_dump 跑不起來")?;
        if !output.status.success() {
            // pg_dump 的錯誤訊息不含密碼。
            anyhow::bail!(
                "pg_dump 失敗（{}）：{}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        let size = tokio::fs::metadata(file).await?.len();
        self.store
            .put_file(key, file)
            .await
            .context("備份放不上 R2")?;
        Ok(size as i64)
    }
}

/// 一直跑：每天台灣時間凌晨 4 點備份一次，出錯記 log、不報到、明天再跑。
pub async fn every_day(state: AppState, backup: Backup) {
    loop {
        let now = state.clock.now();
        let wait = (next_run(now) - now).to_std().unwrap_or_default();
        tokio::time::sleep(wait).await;
        if let Err(err) = backup.run(&state.db, state.clock.now()).await {
            tracing::error!(error = %err, "今天的備份沒做完，沒去報到");
        }
    }
}
