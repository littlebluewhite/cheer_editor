//! 雲端流程的成功率紀錄（#257，ADR 0011）：跟編排分開存，一次一筆（資料表 flow_records、flow_run_throughs）。
//! 記一次從房間送來（同一條 WebSocket），伺服器照流程核心的「記一次」規則檢查：打在不在的環節上的記號丟掉；
//! 丟光了、或動作、組、隊員不在了，整筆不存並說原因。同一個 id 重送不會變兩筆。記下誰記的。
//! 擁有者、編輯者、記錄者能記；檢視者不能（伺服器擋）。收了馬上告訴房間裡別人。
//! 跑一步時把紀錄放回流程再跑，跑完照結果清掉（留墓碑）、改掉該改的（例：清掉重算、刪掉環節），也告訴房間裡別人。
//! 每一步記下清掉、改掉了哪些（遷移 0017）：復原時這一步清掉的加回來，重做再清一次（ADR 0007）。
//! 改、刪、救回（#258）：記錄者只能動自己記的；擁有者、編輯者能動任何人的（沒有記的人的只有他們能動）。
//! 同一筆兩個人都改，照收到的先後，後到的贏（不退回）。刪掉的留墓碑：晚到的新增、改都不算，只有「救回」拿得回來。
//! 一起記全上（#262，ADR 0015）：同一次全上的同一個動作、同一組只算先存的：存、救回都先查，資料庫也擋（遷移 0014）。

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use crate::AppState;
use crate::flow_room::{RoomEvent, RoomMessage};
use crate::sharing::{Role, VIEW_ONLY, role_of};

/// 前端拿到的一次：記在哪個動作、那一次（流程核心的 Attempt）、別人記的寫名字、是不是自己記的。
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloudRecord {
    pub action_id: String,
    #[ts(type = "unknown")]
    pub attempt: Value,
    /// 別人記的：記的人的名字。自己記的、沒有記的人（從流程檔來的）是 null。
    pub by: Option<String>,
    /// 自己記的（記錄者只能改、刪這些；「刪掉我的上一次」只刪這些）。
    pub mine: bool,
}

/// 沒存進去的一次：id 和原因（例：「這一組沒有人了」）。
#[derive(Serialize, TS, Debug)]
#[ts(export)]
pub struct DroppedRecord {
    pub id: String,
    pub message: String,
    /// 同一次全上的同一組別人先存了（#262，ADR 0015）：先記的人的名字（沒有記的人寫「別人」）。
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub by: Option<String>,
    /// 先記的那一筆沒有記的人（從流程檔傳上來的）：畫面照使用者的語言寫「別人」（ADR 0017）；
    /// by 照樣是中文的「別人」，給還不認得這一欄的分頁看。
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub someone: Option<bool>,
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
    /// 空著的環節（流程檔第 10 版起）；沒有就是沒有空著的。
    blanks: Option<Value>,
}

/// 存著的一次和記的人（送給每個人時照看的人寫名字）。
#[derive(Clone, Debug)]
pub struct Kept {
    pub stored: Stored,
    recorded_by: Option<i64>,
    recorder: Option<String>,
    /// 清掉了（墓碑）。
    gone: bool,
    /// 最後一次用手改、刪、救回時流程是第幾步（遷移 0018）；沒動過是 None。
    amended_step: Option<i64>,
}

impl Kept {
    fn id(&self) -> &str {
        self.stored
            .attempt
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    /// viewer 看到的這一次：別人記的寫名字。
    pub fn seen_by(&self, viewer: i64) -> CloudRecord {
        let mine = self.recorded_by == Some(viewer);
        CloudRecord {
            action_id: self.stored.action_id.clone(),
            attempt: self.stored.attempt.clone(),
            by: self.recorder.clone().filter(|_| !mine),
            mine,
        }
    }

    /// 這個權限的人能不能改、刪、救回這一次：擁有者、編輯者都能；記錄者只能動自己記的。
    fn touchable_by(&self, role: Role, user_id: i64) -> bool {
        role.can_edit() || (role.can_record() && self.recorded_by == Some(user_id))
    }
}

/// 紀錄跟著改了（跑一步、改、刪、救回）：改好的那幾次、刪掉的 id。房間裡別人照這個換。
#[derive(Debug, Default)]
pub struct RecordsChange {
    pub changed: Vec<Kept>,
    pub deleted: Vec<String>,
}

impl RecordsChange {
    pub fn is_empty(&self) -> bool {
        self.changed.is_empty() && self.deleted.is_empty()
    }
}

/// 這支流程的紀錄，照收到的先後；with_gone 連清掉的也拿。
async fn rows<'e>(
    db: impl sqlx::PgExecutor<'e>,
    flow_id: &str,
    with_gone: bool,
) -> anyhow::Result<Vec<Kept>> {
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
        bool,
        Option<String>,
        Option<i64>,
    )> = sqlx::query_as(
        "SELECT r.id, r.action_id, r.who, r.marks::text, r.whole, r.date, r.run_through_id,
                t.started_at, r.recorded_by, u.name, r.deleted_at IS NOT NULL, r.blanks::text,
                r.amended_step
         FROM flow_records r
         LEFT JOIN flow_run_throughs t ON t.flow_id = r.flow_id AND t.id = r.run_through_id
         LEFT JOIN users u ON u.id = r.recorded_by
         WHERE r.flow_id = $1 AND (r.deleted_at IS NULL OR $2) ORDER BY r.seq",
    )
    .bind(flow_id)
    .bind(with_gone)
    .fetch_all(db)
    .await?;
    found
        .into_iter()
        .map(
            |(
                id,
                action_id,
                who,
                marks,
                whole,
                date,
                run,
                started,
                by,
                name,
                gone,
                blanks,
                amended,
            )| {
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
                if let Some(blanks) = blanks {
                    a.insert("blanks".into(), serde_json::from_str(&blanks)?);
                }
                Ok(Kept {
                    stored: Stored {
                        action_id,
                        attempt: Value::Object(a),
                    },
                    recorded_by: by,
                    recorder: name,
                    gone,
                    amended_step: amended,
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
    Ok(rows(db, flow_id, false)
        .await?
        .iter()
        .map(|r| r.seen_by(viewer))
        .collect())
}

/// 給流程核心 takeStep 的一次（RoomRecord）：連清掉的（gone）也給；amendedStep 是最後一次用手改、刪、救回時流程是第幾步。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomRecord {
    #[serde(flatten)]
    stored: Stored,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    gone: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    amended_step: Option<i64>,
}

/// 收一步時給流程核心的：這支流程的紀錄，照存的先後，連清掉的。
pub async fn for_room(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
) -> anyhow::Result<Vec<RoomRecord>> {
    Ok(rows(tx, flow_id, true)
        .await?
        .into_iter()
        .map(|r| RoomRecord {
            stored: r.stored,
            gone: r.gone,
            amended_step: r.amended_step,
        })
        .collect())
}

/// 跑一個紀錄的指令的結果（`runStepJson`）：成功（ok）帶跑完還在的紀錄。
#[derive(Deserialize)]
struct StepOutcome {
    kind: String,
    records: Option<Vec<Stored>>,
}

/// 一步清掉、改掉的一次（ADR 0007，存在 flow_steps.cleared；流程核心的 ClearedRecord）：改之前的樣子
/// （was，復原加回來的是 None），這一步之後的樣子（now，整筆清掉是 None）。
#[derive(Serialize, Deserialize)]
pub struct Cleared {
    was: Option<Stored>,
    now: Option<Stored>,
}

/// 收了一步之後照流程核心算好的存紀錄（ADR 0018）：cleared 照它做的先後，整筆清掉的清掉（留墓碑）、
/// 改掉和加回來的存成這一步之後的樣子。deleted 是清掉的 id。回改了哪些（告訴房間裡別人）。
pub async fn store_step(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    cleared: &[Cleared],
    deleted: Vec<String>,
    now: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<RecordsChange> {
    let mut changed = HashSet::new();
    for Cleared { was, now: after } in cleared {
        match (was, after) {
            (_, Some(after)) => {
                update(tx, flow_id, after, now).await?;
                if let Some(id) = after.attempt.get("id").and_then(Value::as_str) {
                    changed.insert(id.to_owned());
                }
            }
            (Some(was), None) => {
                if let Some(id) = was.attempt.get("id").and_then(Value::as_str) {
                    bury(tx, flow_id, id, now).await?;
                }
            }
            (None, None) => {}
        }
    }
    let changed = if changed.is_empty() {
        vec![]
    } else {
        rows(&mut *tx, flow_id, false)
            .await?
            .into_iter()
            .filter(|r| changed.contains(r.id()))
            .collect()
    };
    Ok(RecordsChange { changed, deleted })
}

/// 清掉一次（留墓碑）。
async fn bury(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    id: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE flow_records SET deleted_at = $3, updated_at = $3 WHERE flow_id = $1 AND id = $2",
    )
    .bind(flow_id)
    .bind(id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// 存成改好的一次（動作、誰、記號、整個做；沒清掉）。
async fn update(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    new: &Stored,
    now: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<()> {
    let a: Attempt = serde_json::from_value(new.attempt.clone())?;
    sqlx::query(
        "UPDATE flow_records SET action_id = $3, who = $4, marks = $5::json, whole = $6,
         deleted_at = NULL, updated_at = $7, blanks = $8::json WHERE flow_id = $1 AND id = $2",
    )
    .bind(flow_id)
    .bind(&a.id)
    .bind(&new.action_id)
    .bind(&a.who)
    .bind(a.marks.to_string())
    .bind(a.whole)
    .bind(now)
    .bind(a.blanks.as_ref().map(Value::to_string))
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// 記下這一次是流程第 step 步時用手改、刪、救回的（復原、重做那一步以前的步不動它）。
async fn amended(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    id: &str,
    step: i64,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE flow_records SET amended_step = $3 WHERE flow_id = $1 AND id = $2")
        .bind(flow_id)
        .bind(id)
        .bind(step)
        .execute(&mut *tx)
        .await?;
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
    // 沒有收過的就不讀整份紀錄（鎖著流程，別人在等）
    let mut saved: Vec<CloudRecord> = if taken.is_empty() {
        vec![]
    } else {
        rows(&mut *tx, flow_id, false)
            .await?
            .iter()
            .filter(|r| taken.contains(r.id()))
            .map(|r| r.seen_by(user_id))
            .collect()
    };

    let fresh: Vec<(String, Stored)> = incoming
        .into_iter()
        .filter(|(id, _)| !taken.contains(id))
        .collect();
    // 只能看的：新的不收；收過的（收了才降成只能看，重送）照樣回存著的那一筆，不然手機當成沒存
    if !role.can_record() {
        let dropped = fresh
            .into_iter()
            .map(|(id, _)| DroppedRecord {
                id,
                message: VIEW_ONLY.into(),
                by: None,
                someone: None,
            })
            .collect();
        return Ok(RoomMessage::RecordsSaved { saved, dropped });
    }
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
                Checked::Dropped { message } => dropped.push(DroppedRecord {
                    id,
                    message,
                    by: None,
                    someone: None,
                }),
                Checked::Ok { record } => {
                    // 同一次全上的同一個動作、同一組只收先存的（ADR 0015）。
                    if let Some(name) = recorded_in_run(&mut tx, flow_id, &record, &id).await? {
                        let someone = name.is_none().then_some(true);
                        let by = name.unwrap_or_else(|| "別人".into());
                        let message = format!("{by}已經記了這次全上的這一組");
                        dropped.push(DroppedRecord {
                            id,
                            message,
                            by: Some(by),
                            someone,
                        });
                        continue;
                    }
                    insert(&mut tx, flow_id, Some(user_id), &record, now).await?;
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
        mine: true,
    }));
    Ok(RoomMessage::RecordsSaved { saved, dropped })
}

/// 這一次是全上的：同一次全上的同一個動作、同一組（騰翻、跳躍是同一個人）已經存了別的一筆（沒清掉的，id 不是 own），
/// 回先記的人的名字（沒有記的人的是 None）。資料庫也擋（遷移 0014）：存、救回、改之前先查，不會撞到。
async fn recorded_in_run(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    record: &Stored,
    own: &str,
) -> anyhow::Result<Option<Option<String>>> {
    let Some(run) = record.attempt.get("runThroughId").and_then(Value::as_str) else {
        return Ok(None);
    };
    let who = record.attempt.get("who").and_then(Value::as_str);
    let found: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT u.name FROM flow_records r LEFT JOIN users u ON u.id = r.recorded_by
         WHERE r.flow_id = $1 AND r.run_through_id = $2 AND r.action_id = $3 AND r.who = $4
           AND r.id <> $5 AND r.deleted_at IS NULL LIMIT 1",
    )
    .bind(flow_id)
    .bind(run)
    .bind(&record.action_id)
    .bind(who)
    .bind(own)
    .fetch_optional(&mut *tx)
    .await?;
    Ok(found.map(|(name,)| name))
}

/// 改、刪、救回幾次（#258）。改只拿記號（照流程核心的「改某一次的記號」規則留）；救回照「救回」的規則檢查。
pub enum Amend {
    Change(Vec<Stored>),
    Delete(Vec<String>),
    Restore(Vec<String>),
}

/// 收房間送來的改、刪、救回：流程被刪了回 Deleted；被收回回 Revoked。不能動的（記錄者動別人的、檢視者）、
/// 已經清掉的（改、刪）、還在的（救回）都不算，不退回。照收到的先後做（鎖著那一列），後到的改贏。
/// 回這幾次現在在伺服器上的樣子（還在的；送的人換上它），改到的告訴房間裡別人（from 是這個連線）。
pub async fn amend(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    from: u64,
    amend: Amend,
) -> anyhow::Result<RoomMessage> {
    let mut tx = state.db.begin().await?;
    let Some((content, step)): Option<(String, i64)> =
        sqlx::query_as("SELECT content::text, step FROM flows WHERE id = $1 FOR UPDATE")
            .bind(flow_id)
            .fetch_optional(&mut *tx)
            .await?
    else {
        return Ok(RoomMessage::Deleted);
    };
    let Some(role) = role_of(&mut *tx, flow_id, user_id).await? else {
        return Ok(RoomMessage::Revoked);
    };
    let asked: HashSet<String> = match &amend {
        Amend::Change(attempts) => attempts
            .iter()
            .filter_map(|s| Some(s.attempt.get("id")?.as_str()?.to_owned()))
            .collect(),
        Amend::Delete(ids) | Amend::Restore(ids) => ids.iter().cloned().collect(),
    };
    let targets: HashMap<String, Kept> = rows(&mut *tx, flow_id, true)
        .await?
        .into_iter()
        .filter(|r| asked.contains(r.id()) && r.touchable_by(role, user_id))
        .map(|r| (r.id().to_owned(), r))
        .collect();

    let now = state.clock.now();
    let mut change = RecordsChange::default();
    let mut changed = HashSet::new();
    match amend {
        Amend::Delete(ids) => {
            for id in ids {
                if targets.get(&id).is_some_and(|r| !r.gone) && !change.deleted.contains(&id) {
                    bury(&mut tx, flow_id, &id, now).await?;
                    amended(&mut tx, flow_id, &id, step).await?;
                    change.deleted.push(id);
                }
            }
        }
        Amend::Change(attempts) => {
            for s in attempts {
                let Some(r) = s
                    .attempt
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|id| targets.get(id))
                    .filter(|r| !r.gone)
                else {
                    continue;
                };
                let marks = s.attempt.get("marks").cloned().unwrap_or(Value::Null);
                let command =
                    json!({ "name": "changeAttempt", "args": [r.stored.action_id, r.id(), marks] });
                if let Some(new) = run_one(state, &content, Some(&r.stored), command).await? {
                    update(&mut tx, flow_id, &new, now).await?;
                    // 再送一次一樣的（回答沒收到）不算用手動過，不然之後復原、重做會照現在的留著。
                    if new.attempt != r.stored.attempt {
                        amended(&mut tx, flow_id, r.id(), step).await?;
                    }
                    changed.insert(r.id().to_owned());
                }
            }
        }
        Amend::Restore(ids) => {
            for id in ids {
                let Some(r) = targets.get(&id).filter(|r| r.gone) else {
                    continue;
                };
                // 刪掉之後同一次全上的這一組別人記了：只算先存的，不救回來。
                if recorded_in_run(&mut tx, flow_id, &r.stored, &id)
                    .await?
                    .is_some()
                {
                    continue;
                }
                let command = json!({ "name": "restoreAttempt", "args": [r.stored.action_id, r.stored.attempt, 0] });
                if let Some(new) = run_one(state, &content, None, command).await? {
                    update(&mut tx, flow_id, &new, now).await?;
                    amended(&mut tx, flow_id, &id, step).await?;
                    changed.insert(id);
                }
            }
        }
    }

    let now_kept = rows(&mut *tx, flow_id, false).await?;
    tx.commit().await?;
    let saved = now_kept
        .iter()
        .filter(|r| asked.contains(r.id()))
        .map(|r| r.seen_by(user_id))
        .collect();
    change.changed = now_kept
        .into_iter()
        .filter(|r| changed.contains(r.id()))
        .collect();
    if !change.is_empty() {
        state.rooms.tell(
            flow_id,
            RoomEvent::RecordsChanged {
                from,
                change: change.into(),
            },
        );
    }
    Ok(RoomMessage::RecordsSaved {
        saved,
        dropped: vec![],
    })
}

/// 用流程核心對一次跑一個紀錄的指令（改記號、救回）：放回流程的只有 record（救回是沒有）。
/// 收了回跑完的那一次；被擋、看不懂、跑完不在了是 None。
async fn run_one(
    state: &AppState,
    content: &str,
    record: Option<&Stored>,
    command: Value,
) -> anyhow::Result<Option<Stored>> {
    let records = serde_json::to_string(&record.into_iter().collect::<Vec<_>>())?;
    let Ok(result) = state
        .core
        .run_step(
            content.to_owned(),
            records,
            json!([command]).to_string(),
            String::new(),
        )
        .await
    else {
        return Ok(None);
    };
    let outcome: StepOutcome = serde_json::from_str(&result)?;
    if outcome.kind != "ok" {
        return Ok(None);
    }
    Ok(outcome.records.unwrap_or_default().into_iter().next())
}

/// 傳上雲端（#259）：流程檔裡的紀錄（整份流程檢查過的）一次一筆存起來，沒有記的人。
/// 同一次全上的同一組有兩筆：只存前面那筆（遷移 0014）。
pub(crate) async fn from_file(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    records: &[Stored],
    now: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<()> {
    for record in records {
        insert(tx, flow_id, None, record, now).await?;
    }
    Ok(())
}

/// 存一次（檢查過的）；全上那次第一次見到時記下日期、開的時間。記的人：從流程檔來的沒有。
async fn insert(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    recorded_by: Option<i64>,
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
         (flow_id, id, action_id, who, marks, whole, date, run_through_id, recorded_by, updated_at, blanks)
         VALUES ($1, $2, $3, $4, $5::json, $6, $7, $8, $9, $10, $11::json) ON CONFLICT DO NOTHING",
    )
    .bind(flow_id)
    .bind(&a.id)
    .bind(&record.action_id)
    .bind(&a.who)
    .bind(a.marks.to_string())
    .bind(a.whole)
    .bind(&a.date)
    .bind(&a.run_through_id)
    .bind(recorded_by)
    .bind(now)
    .bind(a.blanks.as_ref().map(Value::to_string))
    .execute(&mut *tx)
    .await?;
    Ok(())
}
