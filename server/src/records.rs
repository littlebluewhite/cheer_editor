//! 雲端流程的成功率紀錄（#257，ADR 0008）：跟編排分開存，一次一筆（資料表 flow_records、flow_run_throughs）。
//! 記一次從房間送來（同一條 WebSocket），伺服器照流程核心的「記一次」規則檢查：打在不在的環節上的記號丟掉；
//! 丟光了、或動作、組、隊員不在了，整筆不存並說原因。同一個 id 重送不會變兩筆。記下誰記的。
//! 擁有者、編輯者、記錄者能記；檢視者不能（伺服器擋）。收了馬上告訴房間裡別人。
//! 跑一步時把紀錄放回流程再跑，跑完照結果清掉（留墓碑）、改掉該改的（例：清掉重算、刪掉環節）。

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::value::RawValue;
use ts_rs::TS;

use crate::AppState;
use crate::flow_room::{RoomEvent, RoomMessage};
use crate::sharing::role_of;

/// 檢視者送來的紀錄：每一筆的原因。
const VIEW_ONLY: &str = "你只能看這支流程";

/// 前端拿到的一次：記在哪個動作、那一次（流程核心的 Attempt）、別人記的寫名字。
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloudRecord {
    pub action_id: String,
    #[ts(type = "unknown")]
    pub attempt: Value,
    /// 別人記的：記的人的名字。自己記的、沒有記的人（從流程檔來的）是 null。
    pub by: Option<String>,
}

/// 沒存進去的一次：id 和原因（例：「這一組沒有人了」）。
#[derive(Serialize, TS, Debug)]
#[ts(export)]
pub struct DroppedRecord {
    pub id: String,
    pub message: String,
}

/// 流程核心的 StoredAttempt：記在哪個動作、那一次。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Stored {
    pub action_id: String,
    pub attempt: Value,
}

/// 一次裡存成欄位的（流程核心檢查過的）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Attempt {
    id: String,
    date: String,
    who: String,
    run_through_id: Option<String>,
    run_through_started_at: Option<i64>,
    whole: bool,
    marks: Value,
}

/// 存著的一次和記的人。
struct Row {
    stored: Stored,
    recorded_by: Option<i64>,
    recorder: Option<String>,
}

/// 這支流程現在的紀錄（沒清掉的），照收到的先後。
async fn rows<'e>(db: impl sqlx::PgExecutor<'e>, flow_id: &str) -> anyhow::Result<Vec<Row>> {
    #[allow(clippy::type_complexity)]
    let found: Vec<(
        String,
        String,
        String,
        String,
        bool,
        String,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT r.id, r.action_id, r.who, r.marks::text, r.whole, r.date, r.run_through_id,
                t.started_at, r.recorded_by, u.name
         FROM flow_records r
         LEFT JOIN flow_run_throughs t ON t.flow_id = r.flow_id AND t.id = r.run_through_id
         LEFT JOIN users u ON u.id = r.recorded_by
         WHERE r.flow_id = $1 AND r.deleted_at IS NULL ORDER BY r.seq",
    )
    .bind(flow_id)
    .fetch_all(db)
    .await?;
    found
        .into_iter()
        .map(
            |(id, action_id, who, marks, whole, date, run, started, by, name)| {
                let mut a = serde_json::Map::new();
                a.insert("id".into(), id.into());
                a.insert("date".into(), date.into());
                a.insert("who".into(), who.into());
                let practice = if run.is_some() { "runThrough" } else { "drill" };
                a.insert("practice".into(), practice.into());
                if let Some(run) = run {
                    a.insert("runThroughId".into(), run.into());
                }
                if let Some(at) = started {
                    a.insert("runThroughStartedAt".into(), at.into());
                }
                a.insert("whole".into(), whole.into());
                a.insert("marks".into(), serde_json::from_str(&marks)?);
                Ok(Row {
                    stored: Stored {
                        action_id,
                        attempt: Value::Object(a),
                    },
                    recorded_by: by,
                    recorder: name,
                })
            },
        )
        .collect()
}

/// 打開一支流程時拿的紀錄：viewer 是誰在看（自己記的不寫名字）。
pub async fn for_viewer(
    db: &sqlx::PgPool,
    flow_id: &str,
    viewer: i64,
) -> anyhow::Result<Vec<CloudRecord>> {
    Ok(rows(db, flow_id)
        .await?
        .into_iter()
        .map(|r| CloudRecord {
            by: r.recorder.filter(|_| r.recorded_by != Some(viewer)),
            action_id: r.stored.action_id,
            attempt: r.stored.attempt,
        })
        .collect())
}

/// 跑一步之前：這支流程現在的紀錄（給流程核心放回流程）。
pub async fn before_step(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
) -> anyhow::Result<Vec<Stored>> {
    Ok(rows(tx, flow_id)
        .await?
        .into_iter()
        .map(|r| r.stored)
        .collect())
}

/// 跑一步的結果（`runStepJson`）：成功帶不帶紀錄的編排和跑完還在的紀錄，被擋、要問帶原因。
#[derive(Deserialize)]
pub struct StepOutcome<'a> {
    pub kind: String,
    #[serde(borrow)]
    pub flow: Option<&'a RawValue>,
    pub message: Option<String>,
    pub records: Option<Vec<Stored>>,
    /// 成功時：這一步記下的鍵、要查別的分頁改過沒有的鍵（流程核心的 stepKeys，#254）。
    #[serde(default)]
    pub keys: Vec<String>,
    #[serde(default)]
    pub watch: Vec<String>,
}

/// 跑完一步：不在了的紀錄清掉（留墓碑），改了的（例：記號少了）存成改好的。
pub async fn after_step(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    before: &[Stored],
    after: Vec<Stored>,
    now: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<()> {
    let after: HashMap<String, Stored> = after
        .into_iter()
        .filter_map(|s| Some((s.attempt.get("id")?.as_str()?.to_owned(), s)))
        .collect();
    for old in before {
        let Some(id) = old.attempt.get("id").and_then(Value::as_str) else {
            continue;
        };
        match after.get(id) {
            None => {
                sqlx::query(
                    "UPDATE flow_records SET deleted_at = $3, updated_at = $3
                     WHERE flow_id = $1 AND id = $2",
                )
                .bind(flow_id)
                .bind(id)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
            Some(new) if new.attempt != old.attempt || new.action_id != old.action_id => {
                let a: Attempt = serde_json::from_value(new.attempt.clone())?;
                sqlx::query(
                    "UPDATE flow_records SET action_id = $3, who = $4, marks = $5::json, whole = $6,
                     updated_at = $7 WHERE flow_id = $1 AND id = $2",
                )
                .bind(flow_id)
                .bind(id)
                .bind(&new.action_id)
                .bind(&a.who)
                .bind(a.marks.to_string())
                .bind(a.whole)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
            Some(_) => {}
        }
    }
    Ok(())
}

/// 檢查的結果（`checkRecordsJson` 的一筆）。
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Checked {
    Ok { record: Stored },
    Dropped { message: String },
}

/// 收房間送來的一串紀錄：流程被刪了回 Deleted（#252）；先查權限（被收回回 Revoked；檢視者每筆都不收），照規則檢查、存起來，
/// 回「收了哪些、哪些沒存進去」。收過的 id 回存著的那一筆（不變兩筆）；收過、後來被清掉的兩邊都不放。
/// 同一支流程跟收步一樣鎖著那一列：檢查和存之間流程不會被改。收了的告訴房間裡別人（from 是這個連線）。
pub async fn record(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    from: u64,
    attempts: Value,
) -> anyhow::Result<RoomMessage> {
    let incoming: Vec<Stored> = serde_json::from_value(attempts).unwrap_or_default();
    let mut seen = HashSet::new();
    let incoming: Vec<(String, Stored)> = incoming
        .into_iter()
        .filter_map(|s| {
            let id = s.attempt.get("id")?.as_str()?.to_owned();
            seen.insert(id.clone()).then_some((id, s))
        })
        .collect();

    let mut tx = state.db.begin().await?;
    let Some((content,)): Option<(String,)> =
        sqlx::query_as("SELECT content::text FROM flows WHERE id = $1 FOR UPDATE")
            .bind(flow_id)
            .fetch_optional(&mut *tx)
            .await?
    else {
        return Ok(RoomMessage::Deleted);
    };
    let Some(role) = role_of(&mut *tx, flow_id, user_id).await? else {
        return Ok(RoomMessage::Revoked);
    };
    if !role.can_record() {
        let dropped = incoming
            .into_iter()
            .map(|(id, _)| DroppedRecord {
                id,
                message: VIEW_ONLY.into(),
            })
            .collect();
        return Ok(RoomMessage::RecordsSaved {
            saved: vec![],
            dropped,
        });
    }

    // 收過的 id（斷線重送）：沒清掉的回存著的那一筆。
    let ids: Vec<String> = incoming.iter().map(|(id, _)| id.clone()).collect();
    let taken: HashSet<String> = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM flow_records WHERE flow_id = $1 AND id = ANY($2)",
    )
    .bind(flow_id)
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|(id,)| id)
    .collect();
    let mut saved: Vec<CloudRecord> = rows(&mut *tx, flow_id)
        .await?
        .into_iter()
        .filter(|r| {
            r.stored
                .attempt
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| taken.contains(id))
        })
        .map(|r| CloudRecord {
            action_id: r.stored.action_id,
            attempt: r.stored.attempt,
            by: r.recorder.filter(|_| r.recorded_by != Some(user_id)),
        })
        .collect();

    let fresh: Vec<(String, Stored)> = incoming
        .into_iter()
        .filter(|(id, _)| !taken.contains(id))
        .collect();
    let mut dropped = vec![];
    let mut added = vec![];
    if !fresh.is_empty() {
        let records: Vec<&Stored> = fresh.iter().map(|(_, s)| s).collect();
        let checked = state
            .core
            .check_records(content, serde_json::to_string(&records)?)
            .await;
        let checked: Vec<Checked> = match checked {
            Ok(json) => serde_json::from_str(&json)?,
            // 流程核心看不懂（例：記號不是物件）：每筆都不收。
            Err(_) => fresh
                .iter()
                .map(|_| Checked::Dropped {
                    message: "伺服器看不懂這一筆".into(),
                })
                .collect(),
        };
        let now = state.clock.now();
        for ((id, _), result) in fresh.into_iter().zip(checked) {
            match result {
                Checked::Dropped { message } => dropped.push(DroppedRecord { id, message }),
                Checked::Ok { record } => {
                    insert(&mut tx, flow_id, user_id, &record, now).await?;
                    added.push(record);
                }
            }
        }
    }
    tx.commit().await?;

    if !added.is_empty() {
        let (name,): (String,) = sqlx::query_as("SELECT name FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await?;
        state.rooms.tell(
            flow_id,
            RoomEvent::Recorded {
                from,
                user_id,
                name,
                records: added.clone(),
            },
        );
    }
    saved.extend(added.into_iter().map(|s| CloudRecord {
        action_id: s.action_id,
        attempt: s.attempt,
        by: None,
    }));
    Ok(RoomMessage::RecordsSaved { saved, dropped })
}

/// 存一次（檢查過的）；全上那次第一次見到時記下日期、開的時間。
async fn insert(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    user_id: i64,
    record: &Stored,
    now: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<()> {
    let a: Attempt = serde_json::from_value(record.attempt.clone())?;
    if let Some(run) = &a.run_through_id {
        sqlx::query(
            "INSERT INTO flow_run_throughs (flow_id, id, date, started_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING",
        )
        .bind(flow_id)
        .bind(run)
        .bind(&a.date)
        .bind(a.run_through_started_at)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO flow_records
         (flow_id, id, action_id, who, marks, whole, date, run_through_id, recorded_by, updated_at)
         VALUES ($1, $2, $3, $4, $5::json, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING",
    )
    .bind(flow_id)
    .bind(&a.id)
    .bind(&record.action_id)
    .bind(&a.who)
    .bind(a.marks.to_string())
    .bind(a.whole)
    .bind(&a.date)
    .bind(&a.run_through_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    Ok(())
}
