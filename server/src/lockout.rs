//! 鎖住：密碼猜錯越多次等越久，連續錯到上限就停掉密碼、要重設（#246）。
//! 照 NIST 800-63B §3.2.2 和 OWASP 登入：次數跟著帳號（email）算，不跟著 IP；上限 100 次。
//! 沒有帳號的 email 一樣記、一樣等，別人從回的話猜不出誰有帳號。鎖住時照樣能用忘記密碼。
//! 記在 PostgreSQL（伺服器重開不歸零），時間照 `AppState.clock`。

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use ts_rs::TS;

/// 前幾次猜錯不用等。
const FREE_TRIES: i32 = 5;
/// 開始要等時等多久；之後每錯一次加倍，最多等 `MAX_WAIT`。
const FIRST_WAIT: Duration = Duration::seconds(30);
const MAX_WAIT: Duration = Duration::hours(1);
/// 連續錯到這麼多次，密碼就停掉：等多久都不收，要用設密碼連結重設。
pub const MAX_FAILURES: i32 = 100;

/// 試太多次（429 的內容）：幾秒後再試。
#[derive(Serialize, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TooManyTries {
    pub retry_after: u32,
}

/// 錯了 `failures` 次之後要等多久。
fn wait_after(failures: i32) -> Duration {
    if failures < FREE_TRIES {
        return Duration::zero();
    }
    let doublings = (failures - FREE_TRIES).min(16) as u32;
    (FIRST_WAIT * 2_i32.pow(doublings)).min(MAX_WAIT)
}

fn key(email: &str) -> String {
    email.trim().to_lowercase()
}

/// 這個 email 現在能不能試密碼；不能就回要等多久。
pub async fn check(
    db: &sqlx::PgPool,
    email: &str,
    now: DateTime<Utc>,
) -> anyhow::Result<Option<TooManyTries>> {
    let row: Option<(i32, DateTime<Utc>)> =
        sqlx::query_as("SELECT failures, last_failed_at FROM login_failures WHERE email = $1")
            .bind(key(email))
            .fetch_optional(db)
            .await?;
    let Some((failures, last)) = row else {
        return Ok(None);
    };
    let left = if failures >= MAX_FAILURES {
        // 停掉了：說要等最久的那麼久（畫面同時叫他用忘記密碼）
        MAX_WAIT
    } else {
        last + wait_after(failures) - now
    };
    Ok((left > Duration::zero()).then(|| TooManyTries {
        // 不滿一秒算一秒
        retry_after: ((left.num_milliseconds() + 999) / 1000) as u32,
    }))
}

/// 又猜錯一次。
pub async fn failed(db: &sqlx::PgPool, email: &str, now: DateTime<Utc>) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO login_failures (email, failures, last_failed_at) VALUES ($1, 1, $2)
         ON CONFLICT (email) DO UPDATE SET failures = login_failures.failures + 1, last_failed_at = $2",
    )
    .bind(key(email))
    .bind(now)
    .execute(db)
    .await?;
    Ok(())
}

/// 歸零：登入成功、設好密碼、改好密碼。
pub async fn clear<'c>(db: impl sqlx::PgExecutor<'c>, email: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM login_failures WHERE email = $1")
        .bind(key(email))
        .execute(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waits_double_from_the_fifth_failure_up_to_an_hour() {
        let secs = |n| wait_after(n).num_seconds();
        assert_eq!((secs(0), secs(4)), (0, 0));
        assert_eq!((secs(5), secs(6), secs(7)), (30, 60, 120));
        assert_eq!((secs(12), secs(99)), (3600, 3600));
    }
}
