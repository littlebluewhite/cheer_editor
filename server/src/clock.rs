//! 現在幾點：正式用系統時間；測試換成手撥的鐘（例：撥 30 天，看登入狀態到期）。
//! 會到期的東西（連結、登入狀態）都照這個鐘算，不用資料庫的 now()。

use std::sync::Arc;

use chrono::{DateTime, FixedOffset, Utc};

/// 台灣時間（UTC+8，沒有夏令時間）：每天的工作、備份照它排，備份檔名也用它。
pub const TAIWAN: FixedOffset = match FixedOffset::east_opt(8 * 3600) {
    Some(offset) => offset,
    None => panic!("台灣時間的時差不對"),
};

#[derive(Clone)]
pub struct Clock(Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>);

impl Clock {
    pub fn system() -> Self {
        Self::new(Utc::now)
    }

    pub fn new(now: impl Fn() -> DateTime<Utc> + Send + Sync + 'static) -> Self {
        Self(Arc::new(now))
    }

    pub fn now(&self) -> DateTime<Utc> {
        (self.0)()
    }
}
