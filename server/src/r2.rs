//! Cloudflare R2 的一個 bucket（S3 相容）：放雲端流程的音樂檔（music.rs）、每天的備份（backup.rs）各用一個。

use std::time::Duration;

use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};

/// 預簽網址多久內有效。
const PRESIGN_FOR: Duration = Duration::from_secs(10 * 60);

/// R2（S3 相容）的一個 bucket：發預簽網址、查大小、放檔、刪檔。音樂、備份各一個。
#[derive(Clone)]
pub struct R2Bucket {
    bucket: Bucket,
    credentials: Credentials,
    http: reqwest::Client,
}

impl R2Bucket {
    /// endpoint 例：`https://<帳號 id>.r2.cloudflarestorage.com`；測試指到假的 R2。
    pub fn new(
        endpoint: reqwest::Url,
        bucket: &str,
        access_key: &str,
        secret: &str,
    ) -> anyhow::Result<Self> {
        // R2 的 region 一律寫 auto。
        let bucket = Bucket::new(endpoint, UrlStyle::Path, bucket.to_owned(), "auto")?;
        Ok(Self {
            bucket,
            credentials: Credentials::new(access_key, secret),
            http: reqwest::Client::new(),
        })
    }

    pub(crate) fn upload_url(&self, key: &str) -> String {
        let action = self.bucket.put_object(Some(&self.credentials), key);
        action.sign(PRESIGN_FOR).to_string()
    }

    pub(crate) fn download_url(&self, key: &str) -> String {
        let action = self.bucket.get_object(Some(&self.credentials), key);
        action.sign(PRESIGN_FOR).to_string()
    }

    /// R2 上這個檔幾個位元組；沒有這個檔是 None。
    pub(crate) async fn size(&self, key: &str) -> anyhow::Result<Option<i64>> {
        let url = self
            .bucket
            .head_object(Some(&self.credentials), key)
            .sign(PRESIGN_FOR);
        let res = self.http.head(url).send().await?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let res = res.error_for_status()?;
        let length = res
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok()?.parse().ok())
            .ok_or_else(|| anyhow::anyhow!("R2 沒說檔多大"))?;
        Ok(Some(length))
    }

    /// 把本機的一個檔放上去（每天的備份用，#265）。邊讀邊傳，不整個放進記憶體；R2 要先說多大。
    pub(crate) async fn put_file(&self, key: &str, path: &std::path::Path) -> anyhow::Result<()> {
        let file = tokio::fs::File::open(path).await?;
        let size = file.metadata().await?.len();
        let url = self
            .bucket
            .put_object(Some(&self.credentials), key)
            .sign(PRESIGN_FOR);
        self.http
            .put(url)
            .header(reqwest::header::CONTENT_LENGTH, size)
            .body(file)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// 在 R2 裡把 `from` 複製到 `to`（S3 的 CopyObject：PUT 加 `x-amz-copy-source`）。沒有 `from` 是 false。
    pub(crate) async fn copy(&self, from: &str, to: &str) -> anyhow::Result<bool> {
        let source = format!("{}/{from}", self.bucket.name());
        let mut action = self.bucket.put_object(Some(&self.credentials), to);
        action
            .headers_mut()
            .insert("x-amz-copy-source", source.clone());
        let res = self
            .http
            .put(action.sign(PRESIGN_FOR))
            .header("x-amz-copy-source", source)
            .header(reqwest::header::CONTENT_LENGTH, 0)
            .send()
            .await?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(false);
        }
        // S3 的 CopyObject 複製到一半出錯時回 200、錯誤寫在內容裡（AWS 文件 API_CopyObject）。
        let body = res.error_for_status()?.text().await?;
        if body.contains("<Error>") {
            anyhow::bail!("R2 複製出錯：{body}");
        }
        Ok(true)
    }

    pub(crate) async fn delete(&self, key: &str) -> anyhow::Result<()> {
        let url = self
            .bucket
            .delete_object(Some(&self.credentials), key)
            .sign(PRESIGN_FOR);
        self.http.delete(url).send().await?.error_for_status()?;
        Ok(())
    }
}
