//! 每天的工作（#266，#194）：台灣時間早上 5 點（凌晨 4 點備份之後）跑一次。
//! - 不用了 30 天的音樂從 R2 真的刪掉（倒回 30 天內的備份時音樂還在）。
//! - 30 天前的步驟紀錄刪掉。
//! - 算免費額度用了多少，有一項到 8 成就寄信給網站主人（管理員）：各家免費版都不會先提醒。

use std::sync::{Arc, Mutex};

use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, Utc};

use crate::AppState;
use crate::mail::Mail;

/// 音樂、步驟紀錄留多久。
const KEEP: Duration = Duration::days(30);

/// 每次查資料庫後，Neon 算醒著多久（5 分鐘沒查詢才睡）。
const AWAKE_AFTER_QUERY: Duration = Duration::minutes(5);

/// 免費額度。GB 照小的算（10⁹ 位元組，不是 2³⁰），寧可早一點寄。
const DB_LIMIT: i64 = 1_000_000_000;
const R2_LIMIT: i64 = 10_000_000_000;
const MAILS_PER_DAY: i64 = 100;
const MAILS_PER_MONTH: i64 = 3_000;
/// Neon 每月 100 CU 小時；固定 0.25 CU（#263 確認）時是醒著 400 小時。
const AWAKE_SECONDS_PER_MONTH: i64 = 400 * 3600;

/// 一直跑：每天台灣時間 5 點跑一次，出錯記 log、明天再跑。
pub async fn every_day(state: AppState, awake: AwakeMeter) {
    loop {
        let now = state.clock.now();
        let wait = (next_run(now) - now).to_std().unwrap_or_default();
        tokio::time::sleep(wait).await;
        if let Err(err) = run(&state, &awake).await {
            tracing::error!(error = %err, "每天的工作沒做完");
        }
    }
}

/// 下一次跑的時間：`now` 之後第一個台灣時間 5 點。
pub fn next_run(now: DateTime<Utc>) -> DateTime<Utc> {
    next_taiwan_hour(now, 5)
}

/// `now` 之後第一個台灣時間 `hour` 點整（每天的備份也用）。
pub(crate) fn next_taiwan_hour(now: DateTime<Utc>, hour: u32) -> DateTime<Utc> {
    let taiwan = FixedOffset::east_opt(8 * 3600).unwrap();
    let today = now
        .with_timezone(&taiwan)
        .date_naive()
        .and_hms_opt(hour, 0, 0)
        .unwrap()
        .and_local_timezone(taiwan)
        .unwrap()
        .to_utc();
    if today > now {
        today
    } else {
        today + Duration::days(1)
    }
}

/// 跑一次每天的工作。
pub async fn run(state: &AppState, awake: &AwakeMeter) -> anyhow::Result<()> {
    let now = state.clock.now();
    remove_old_music(state, now - KEEP).await?;
    sqlx::query("DELETE FROM flow_steps WHERE created_at <= $1")
        .bind(now - KEEP)
        .execute(&state.db)
        .await?;
    let items = usage(state, awake, now).await?;
    if items.iter().any(Item::near) {
        mail_owner(state, &items).await?;
    }
    Ok(())
}

/// 不用了（`unused_since`）到 `cutoff` 的音樂：R2 上的檔和那一列都刪。
/// R2 刪不掉的，那一列留著明天再試。沒接 R2 時都不動。
async fn remove_old_music(state: &AppState, cutoff: DateTime<Utc>) -> anyhow::Result<()> {
    let Some(store) = &state.music else {
        return Ok(());
    };
    let old: Vec<(String, String)> =
        sqlx::query_as("SELECT flow_id, audio_id FROM flow_audio WHERE unused_since <= $1")
            .bind(cutoff)
            .fetch_all(&state.db)
            .await?;
    for (flow_id, audio_id) in old {
        let mut tx = state.db.begin().await?;
        // 再看一次：查完到現在，可能又用到了（unused_since 變回空的）。
        let key: Option<(String,)> = sqlx::query_as(
            "DELETE FROM flow_audio WHERE flow_id = $1 AND audio_id = $2 AND unused_since <= $3
             RETURNING object_key",
        )
        .bind(&flow_id)
        .bind(&audio_id)
        .bind(cutoff)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((key,)) = key else { continue };
        match store.delete(&key).await {
            Ok(()) => tx.commit().await?,
            Err(err) => {
                tracing::warn!(flow_id, audio_id, error = %err, "R2 上的音樂刪不掉，明天再試")
            }
        }
    }
    Ok(())
}

/// 一項免費額度：用了多少、上限（同一個單位），和給人看的字。
struct Item {
    name: &'static str,
    used: i64,
    limit: i64,
    text: String,
}

impl Item {
    /// 到 8 成了。
    fn near(&self) -> bool {
        self.used * 5 >= self.limit * 4
    }

    fn percent(&self) -> i64 {
        self.used * 100 / self.limit
    }
}

async fn usage(
    state: &AppState,
    awake: &AwakeMeter,
    now: DateTime<Utc>,
) -> anyhow::Result<Vec<Item>> {
    let (db,): (i64,) = sqlx::query_as("SELECT pg_database_size(current_database())")
        .fetch_one(&state.db)
        .await?;
    // 自己記的音樂大小（含等著刪的）加 30 天內的備份。
    let (r2,): (i64,) = sqlx::query_as(
        "SELECT ((SELECT COALESCE(SUM(size), 0) FROM flow_audio)
               + (SELECT COALESCE(SUM(size), 0) FROM backups WHERE taken_at > $1))::bigint",
    )
    .bind(now - KEEP)
    .fetch_one(&state.db)
    .await?;
    let mut conn = state.db.acquire().await?;
    let awake_seconds = awake_this_month(&mut conn, awake, now).await?;
    drop(conn);

    let gb = |n: i64| format!("{:.2} GB", n as f64 / 1e9);
    let cu_hours = |seconds: i64| format!("{:.1} CU 小時", seconds as f64 / 3600.0 / 4.0);
    let mut items = vec![
        Item {
            name: "資料庫大小",
            used: db,
            limit: DB_LIMIT,
            text: format!("{}／{}", gb(db), gb(DB_LIMIT)),
        },
        Item {
            name: "R2（音樂、備份）",
            used: r2,
            limit: R2_LIMIT,
            text: format!("{}／{}", gb(r2), gb(R2_LIMIT)),
        },
        Item {
            name: "Neon 醒著的時數（估的）",
            used: awake_seconds,
            limit: AWAKE_SECONDS_PER_MONTH,
            text: format!(
                "{}／{}",
                cu_hours(awake_seconds),
                cu_hours(AWAKE_SECONDS_PER_MONTH)
            ),
        },
    ];
    match state.mailer.usage().await {
        Ok(Some((today, month))) => {
            items.push(Item {
                name: "Resend 今天寄的信",
                used: today,
                limit: MAILS_PER_DAY,
                text: format!("{today}／{MAILS_PER_DAY} 封"),
            });
            items.push(Item {
                name: "Resend 這個月寄的信",
                used: month,
                limit: MAILS_PER_MONTH,
                text: format!("{month}／{MAILS_PER_MONTH} 封"),
            });
        }
        Ok(None) => {}
        Err(err) => tracing::warn!(error = %err, "查不到 Resend 寄了幾封"),
    }
    Ok(items)
}

/// 寄信給網站主人（管理員），列出每一項。
async fn mail_owner(state: &AppState, items: &[Item]) -> anyhow::Result<()> {
    let owner: Option<(String,)> = sqlx::query_as("SELECT email FROM users WHERE is_admin")
        .fetch_optional(&state.db)
        .await?;
    let Some((to,)) = owner else {
        tracing::warn!("免費額度到 8 成了，但沒有管理員可以寄信");
        return Ok(());
    };
    let line = |i: &Item| format!("- {}：{}（{}%）", i.name, i.text, i.percent());
    let near: Vec<String> = items.iter().filter(|i| i.near()).map(line).collect();
    let all: Vec<String> = items.iter().map(line).collect();
    let text = format!(
        "這幾項免費額度用到 8 成了，用完前要升級付費方案：\n\n{}\n\n全部：\n{}\n\n（伺服器每天算一次；Neon 醒著的時數是伺服器自己估的。）",
        near.join("\n"),
        all.join("\n")
    );
    let mail = Mail {
        to,
        subject: "免費額度快用完了".into(),
        text,
    };
    if let Err(err) = state.mailer.send(mail).await {
        tracing::error!(error = %err, "免費額度的提醒信寄不出去");
    }
    Ok(())
}

/// 估 Neon 醒著多久：每次查詢後算醒著 5 分鐘，5 分鐘內又查就是同一段（拉長）。
/// 還沒結束的那一段放記憶體；結束了交給 `save_awake` 存起來。
#[derive(Clone, Default)]
pub struct AwakeMeter(Arc<Mutex<Option<Stretch>>>);

#[derive(Clone, Copy)]
struct Stretch {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

/// 結束的一段醒著的時間。
#[derive(Debug, PartialEq, Eq)]
pub struct Awake {
    pub start: DateTime<Utc>,
    pub seconds: i64,
}

impl AwakeMeter {
    /// `at` 查了一次資料庫。這次離上一段太久（上一段已經睡了）：回上一段，讓呼叫的人存起來。
    pub fn touch(&self, at: DateTime<Utc>) -> Option<Awake> {
        let mut open = self.0.lock().unwrap();
        let until = at + AWAKE_AFTER_QUERY;
        match &mut *open {
            Some(s) if at <= s.end => {
                s.end = s.end.max(until);
                None
            }
            _ => open
                .replace(Stretch {
                    start: at,
                    end: until,
                })
                .map(|s| Awake {
                    start: s.start,
                    seconds: (s.end - s.start).num_seconds(),
                }),
        }
    }

    fn open(&self) -> Option<Stretch> {
        *self.0.lock().unwrap()
    }
}

/// 把結束的一段加到它開始的那個月（UTC）。
pub async fn save_awake(conn: &mut sqlx::PgConnection, awake: &Awake) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO db_awake (month, seconds) VALUES ($1, $2)
         ON CONFLICT (month) DO UPDATE SET seconds = db_awake.seconds + EXCLUDED.seconds",
    )
    .bind(month_of(awake.start))
    .bind(awake.seconds)
    .execute(conn)
    .await?;
    Ok(())
}

/// 這個月（UTC）醒著幾秒：存起來的，加還沒結束的那一段。
pub async fn awake_this_month(
    conn: &mut sqlx::PgConnection,
    meter: &AwakeMeter,
    now: DateTime<Utc>,
) -> anyhow::Result<i64> {
    let saved: Option<(i64,)> = sqlx::query_as("SELECT seconds FROM db_awake WHERE month = $1")
        .bind(month_of(now))
        .fetch_optional(conn)
        .await?;
    let open = meter
        .open()
        .filter(|s| month_of(s.start) == month_of(now))
        .map_or(0, |s| (s.end - s.start).num_seconds());
    Ok(saved.map_or(0, |(n,)| n) + open)
}

fn month_of(t: DateTime<Utc>) -> NaiveDate {
    NaiveDate::from_ymd_opt(t.year(), t.month(), 1).unwrap()
}
