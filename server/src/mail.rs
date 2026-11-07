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

    pub async fn send(&self, mail: Mail) -> anyhow::Result<()> {
        match self {
            Self::Resend { client, from } => {
                let email = resend_rs::types::CreateEmailBaseOptions::new(
                    from.as_str(),
                    [mail.to.as_str()],
                    mail.subject.as_str(),
                )
                .with_text(&mail.text);
                client.emails.send(email).await?;
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
