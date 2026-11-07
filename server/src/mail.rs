//! 寄信：一個介面，三種。Resend（正式）、印在終端機（本機開發）、記在記憶體（測試）。

use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mail {
    pub to: String,
    pub subject: String,
    /// 純文字內容。
    pub text: String,
}

#[derive(Clone)]
pub enum Mailer {
    Resend {
        client: resend_rs::Resend,
        from: String,
    },
    Console,
    Memory(Arc<Mutex<Vec<Mail>>>),
}

impl Mailer {
    /// Resend：`from` 是寄件人（例：`競技啦啦隊流程編輯器 <no-reply@網域>`）。
    pub fn resend(api_key: &str, from: String) -> Self {
        Self::Resend {
            client: resend_rs::Resend::new(api_key),
            from,
        }
    }

    /// 連到別的網址的 Resend（測試開一台假的，看寄信服務回錯時怎樣）。
    pub fn resend_at(api_key: &str, from: String, base_url: reqwest::Url) -> Self {
        let config = resend_rs::ConfigBuilder::new(api_key)
            .base_url(base_url)
            .build();
        Self::Resend {
            client: resend_rs::Resend::with_config(config),
            from,
        }
    }

    pub fn memory() -> Self {
        Self::Memory(Arc::default())
    }

    /// 記在記憶體的那種寄過的信（照順序）；別種是空的。
    pub fn sent(&self) -> Vec<Mail> {
        match self {
            Self::Memory(sent) => sent.lock().unwrap().clone(),
            _ => Vec::new(),
        }
    }

    /// Resend 今天、這個月寄了幾封（Resend 的 `GET /usage`，每天算用量用）；不是 Resend 是 None。
    pub async fn usage(&self) -> Result<Option<(i64, i64)>, resend_rs::Error> {
        let Self::Resend { client, .. } = self else {
            return Ok(None);
        };
        let usage = client.usage.get().await?;
        Ok(Some((
            usage.emails.daily.used.into(),
            usage.emails.monthly.used.into(),
        )))
    }

    pub async fn send(&self, mail: Mail) -> Result<(), MailError> {
        match self {
            Self::Resend { client, from } => {
                let email = resend_rs::types::CreateEmailBaseOptions::new(
                    from.as_str(),
                    [mail.to.as_str()],
                    mail.subject.as_str(),
                )
                .with_text(&mail.text);
                client
                    .emails
                    .send(email)
                    .await
                    .map_err(MailError::from_resend)?;
            }
            // 本機開發：信（含設密碼連結）印在終端機。
            Self::Console => println!(
                "---- 寄信（沒設 RESEND_API_KEY，只印出來）----\n給：{}\n主旨：{}\n\n{}\n----",
                mail.to, mail.subject, mail.text
            ),
            Self::Memory(sent) => sent.lock().unwrap().push(mail),
        }
        Ok(())
    }
}

/// 寄不出去的原因：寄信服務今天的額度用完了（Resend 回 429），或別的錯。
#[derive(Debug, thiserror::Error)]
pub enum MailError {
    #[error("寄信服務今天的額度用完了")]
    OverQuota,
    #[error("寄不出信：{0}")]
    Other(resend_rs::Error),
}

impl MailError {
    fn from_resend(err: resend_rs::Error) -> Self {
        match &err {
            resend_rs::Error::RateLimit { .. } => Self::OverQuota,
            resend_rs::Error::Resend(res) if res.status_code == 429 => Self::OverQuota,
            _ => Self::Other(err),
        }
    }
}
