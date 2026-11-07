//! 擋常見和外洩過的密碼。正式問 Pwned Passwords 的範圍 API（只送 SHA-1 的前 5 個字）；測試用假的清單。

use std::collections::HashSet;

use sha1::{Digest, Sha1};

#[derive(Clone)]
pub enum BreachCheck {
    Pwned(reqwest::Client),
    List(HashSet<String>),
}

impl BreachCheck {
    pub fn pwned() -> Self {
        Self::Pwned(reqwest::Client::new())
    }

    pub fn list<'a>(passwords: impl IntoIterator<Item = &'a str>) -> Self {
        Self::List(passwords.into_iter().map(str::to_owned).collect())
    }

    /// 這個密碼外洩過（或太常見）嗎。Pwned Passwords 連不上時當作沒有、記一筆 log：
    /// 別人的服務壞掉時，不擋住大家設密碼。
    pub async fn is_breached(&self, password: &str) -> bool {
        match self {
            Self::List(list) => list.contains(password),
            Self::Pwned(client) => match pwned(client, password).await {
                Ok(found) => found,
                Err(err) => {
                    tracing::warn!(%err, "Pwned Passwords 查不到，這次不擋");
                    false
                }
            },
        }
    }
}

async fn pwned(client: &reqwest::Client, password: &str) -> anyhow::Result<bool> {
    let hash: String = Sha1::digest(password.as_bytes())
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect();
    let (prefix, suffix) = hash.split_at(5);
    let body = client
        .get(format!("https://api.pwnedpasswords.com/range/{prefix}"))
        // 回應補上假的幾筆（次數是 0），別人從長度猜不出查了什麼。
        .header("Add-Padding", "true")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(body.lines().any(|line| {
        line.split_once(':')
            .is_some_and(|(tail, count)| tail.eq_ignore_ascii_case(suffix) && count.trim() != "0")
    }))
}
