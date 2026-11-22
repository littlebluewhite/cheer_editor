//! 雲端流程的成功率紀錄（#257，ADR 0011）：跟編排分開存，一次一筆（資料表 flow_records、flow_run_throughs）。
//! 記一次從房間送來（同一條 WebSocket），收不收照流程核心的 receiveRecords（#349，ADR 0018）：打在不在的環節上的記號丟掉；
//! 丟光了、或動作、組、隊員不在了，整筆不存並說原因。同一個 id 重送不會變兩筆；檢視者不能記。這裡只挑有關的紀錄傳進去、
//! 照結果存、記下誰記的、寫沒收的中文句子。收了馬上告訴房間裡別人。
//! 跑一步時把紀錄放回流程再跑，跑完照結果清掉（留墓碑）、改掉該改的（例：清掉重算、刪掉環節），也告訴房間裡別人。
//! 每一步記下清掉、改掉了哪些（遷移 0017）：復原時這一步清掉的加回來，重做再清一次（ADR 0007）。
//! 改、刪、救回（#258）照流程核心的 amendRecords（#351，ADR 0018）：記錄者只能動自己記的；擁有者、編輯者能動任何人的
//! （沒有記的人的只有他們能動）。同一筆兩個人都改，照收到的先後，後到的贏（不退回）。刪掉的留墓碑：晚到的新增、改都不算，
//! 只有「救回」拿得回來。這裡只挑送來的那幾次傳進去、照結果存。
//! 一起記全上（#262，ADR 0015）：同一次全上的同一個動作、同一組只算先存的：存（receiveRecords）、救回（amendRecords）都先查，
//! 資料庫也擋（遷移 0014）。

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
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

/// 存著的一次的欄位（rows、related 共用 kept_select!）。
type KeptRow = (
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
);

macro_rules! kept_select {
    () => {
        "SELECT r.id, r.action_id, r.who, r.marks::text, r.whole, r.date, r.run_through_id,
                t.started_at, r.recorded_by, u.name, r.deleted_at IS NOT NULL, r.blanks::text,
                r.amended_step
         FROM flow_records r
         LEFT JOIN flow_run_throughs t ON t.flow_id = r.flow_id AND t.id = r.run_through_id
         LEFT JOIN users u ON u.id = r.recorded_by"
    };
}

/// 這支流程的紀錄，照收到的先後；with_gone 連清掉的也拿。
async fn rows<'e>(
    db: impl sqlx::PgExecutor<'e>,
    flow_id: &str,
    with_gone: bool,
) -> anyhow::Result<Vec<Kept>> {
    let found: Vec<KeptRow> = sqlx::query_as(concat!(
        kept_select!(),
        " WHERE r.flow_id = $1 AND (r.deleted_at IS NULL OR $2) ORDER BY r.seq"
    ))
    .bind(flow_id)
    .bind(with_gone)
    .fetch_all(db)
    .await?;
    found.into_iter().map(kept).collect()
}

/// 收一串紀錄時跟它們有關的（照收到的先後）：同樣 id 的（連清掉的），和同一次全上還在的（流程核心再挑同一個動作、同一組）。
/// 不讀整份紀錄（鎖著流程，別人在等）。
async fn related(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    ids: &[&str],
    runs: &[&str],
) -> anyhow::Result<Vec<Kept>> {
    let found: Vec<KeptRow> = sqlx::query_as(concat!(
        kept_select!(),
        " WHERE r.flow_id = $1
           AND (r.id = ANY($2) OR (r.run_through_id = ANY($3) AND r.deleted_at IS NULL))
         ORDER BY r.seq"
    ))
    .bind(flow_id)
    .bind(ids)
    .bind(runs)
    .fetch_all(&mut *tx)
    .await?;
    found.into_iter().map(kept).collect()
}

fn kept(
    (id, action_id, who, marks, whole, date, run, started, by, name, gone, blanks, amended): KeptRow,
) -> anyhow::Result<Kept> {
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

/// 給流程核心的一次（KnownRecord，receiveRecords、amendRecords 都用）：清掉的帶 gone；by 是記的人，
/// receiveRecords 給名字，amendRecords 給 id（寫成字，只拿來比「是不是他記的」）；沒有記的人不帶。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownRecord<'a> {
    #[serde(flatten)]
    stored: &'a Stored,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    gone: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    by: Option<String>,
}

/// 給流程核心 receiveRecords 的（RecordsAsk），編排以外的；編排另外傳（存著的原樣，不用先檢查一遍）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordsAsk<'a> {
    can_record: bool,
    by: &'a str,
    sent: &'a [Stored],
    records: Vec<KnownRecord<'a>>,
}

/// receiveRecords 的一筆（RecordVerdict）。收過的（again）照 Rust 挑的那一筆回，不讀這裡的 record。
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum RecordVerdict {
    Again { id: String },
    Skipped,
    Refused { id: String, why: RecordRefusal },
    Accepted { record: Stored },
}

/// 不收的原因（代號）；Rust 照它寫中文句子。
#[derive(Deserialize)]
#[serde(tag = "code", rename_all = "camelCase")]
enum RecordRefusal {
    ViewOnly,
    TakenInRun { by: Option<String> },
    Blocked { reason: Said },
    NotUnderstood,
}

/// 流程核心給的原因（只用中文句子）。
#[derive(Deserialize)]
struct Said {
    message: String,
}

const NOT_UNDERSTOOD: &str = "伺服器看不懂這一筆";

impl RecordRefusal {
    /// 沒存進去的一次，寫上中文句子。
    fn dropped(self, id: String) -> DroppedRecord {
        let (message, by, someone) = match self {
            Self::ViewOnly => (VIEW_ONLY.into(), None, None),
            Self::TakenInRun { by } => {
                let someone = by.is_none().then_some(true);
                let by = by.unwrap_or_else(|| "別人".into());
                (format!("{by}已經記了這次全上的這一組"), Some(by), someone)
            }
            Self::Blocked { reason } => (reason.message, None, None),
            Self::NotUnderstood => (NOT_UNDERSTOOD.into(), None, None),
        };
        DroppedRecord {
            id,
            message,
            by,
            someone,
        }
    }
}

/// 收房間送來的一串紀錄：流程被刪了回 Deleted（#252）；被收回回 Revoked。收不收照流程核心的 receiveRecords（ADR 0018）：
/// Rust 用 SQL 只挑有關的紀錄（同樣 id 的連清掉的、同一次全上還在的）傳進去，照結果存、寫沒收的中文句子，
/// 回「收了哪些、哪些沒存進去」。同一支流程跟收步一樣鎖著那一列：檢查和存之間流程不會被改。
/// 收了的告訴房間裡別人（from 是這個連線）。
pub async fn record(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    from: u64,
    attempts: Value,
) -> anyhow::Result<RoomMessage> {
    let sent: Vec<Stored> = serde_json::from_value(attempts).unwrap_or_default();
    let ids: Vec<&str> = sent
        .iter()
        .filter_map(|s| s.attempt.get("id")?.as_str())
        .collect();
    let runs: Vec<&str> = sent
        .iter()
        .filter_map(|s| s.attempt.get("runThroughId")?.as_str())
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
    let known = related(&mut tx, flow_id, &ids, &runs).await?;
    let (name,): (String,) = sqlx::query_as("SELECT name FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
    // 整批都收過（斷線重送）：沒有新的要檢查，編排給空的
    let all_taken = ids.iter().all(|id| known.iter().any(|k| k.id() == *id));
    let flow = if all_taken { "null".into() } else { content };
    let ask = RecordsAsk {
        can_record: role.can_record(),
        by: &name,
        sent: &sent,
        records: known
            .iter()
            .map(|k| KnownRecord {
                stored: &k.stored,
                gone: k.gone,
                by: k.recorder.clone(),
            })
            .collect(),
    };
    let verdicts: Vec<RecordVerdict> = match state
        .core
        .receive_records(flow, serde_json::to_string(&ask)?)
        .await
    {
        Ok(json) => serde_json::from_str(&json)?,
        // 流程核心自己出錯（不是 receiveRecords 不收的）：收過的照樣回存著的那一筆（收過、後來清掉的兩邊都不放），
        // 新的都當看不懂；同一批重複的 id 只算第一筆
        Err(err) => {
            tracing::warn!(error = %err, "流程核心跑 receiveRecords 出錯，新的當看不懂");
            let mut seen = HashSet::new();
            ids.iter()
                .filter(|id| seen.insert(**id))
                .map(|id| match known.iter().find(|k| k.id() == *id) {
                    Some(k) if !k.gone => RecordVerdict::Again { id: (*id).into() },
                    Some(_) => RecordVerdict::Skipped,
                    None => RecordVerdict::Refused {
                        id: (*id).into(),
                        why: RecordRefusal::NotUnderstood,
                    },
                })
                .collect()
        }
    };

    let now = state.clock.now();
    let mut again = HashSet::new();
    let mut dropped = vec![];
    let mut added = vec![];
    for verdict in verdicts {
        match verdict {
            RecordVerdict::Again { id } => {
                again.insert(id);
            }
            RecordVerdict::Skipped => {}
            RecordVerdict::Refused { id, why } => dropped.push(why.dropped(id)),
            RecordVerdict::Accepted { record } => {
                insert(&mut tx, flow_id, Some(user_id), &record, now).await?;
                added.push(record);
            }
        }
    }
    tx.commit().await?;

    // 收過的照存的先後在前，剛收的照送來的先後在後
    let mut saved: Vec<CloudRecord> = known
        .iter()
        .filter(|k| again.contains(k.id()))
        .map(|k| k.seen_by(user_id))
        .collect();
    if !added.is_empty() {
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

/// 改、刪、救回幾次（#258）。改只拿記號（照流程核心的「改某一次的記號」規則留）；救回照「救回」的規則檢查。
pub enum Amend {
    Change(Vec<Stored>),
    Delete(Vec<String>),
    Restore(Vec<String>),
}

/// 給流程核心 amendRecords 的「送來的」（AmendSent）。
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum AmendSent<'a> {
    Change { attempts: &'a [Stored] },
    Delete { ids: &'a [String] },
    Restore { ids: &'a [String] },
}

/// 給流程核心 amendRecords 的（AmendAsk），編排以外的；編排另外傳（存著的原樣）。by 是送的人的 id（寫成字）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AmendAsk<'a> {
    step: i64,
    role: Role,
    by: String,
    sent: AmendSent<'a>,
    records: Vec<KnownRecord<'a>>,
}

/// amendRecords 的結果（AmendOutcome，都照送來的先後）：清掉的 id、改成的、救回成的、要記「用手動過」的、
/// 改好救回的 id（告訴房間裡別人）。
#[derive(Deserialize, Default)]
struct AmendOutcome {
    deleted: Vec<String>,
    changed: Vec<Stored>,
    restored: Vec<Stored>,
    amended: Vec<Amended>,
    told: Vec<String>,
}

/// 要記「用手動過」的一次：id 和那時流程第幾步。
#[derive(Deserialize)]
struct Amended {
    id: String,
    step: i64,
}

/// 改、刪、救回時要的那幾次（照收到的先後）：送來的 id（連清掉的）；run_mates 時再加同一次全上還在的
/// （救回要比，流程核心再挑同一個動作、同一組）。不讀整份紀錄（鎖著流程，別人在等）。
async fn asked(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    ids: &[String],
    run_mates: bool,
) -> anyhow::Result<Vec<Kept>> {
    let found: Vec<KeptRow> = sqlx::query_as(concat!(
        kept_select!(),
        " WHERE r.flow_id = $1
           AND (r.id = ANY($2) OR ($3 AND r.deleted_at IS NULL AND r.run_through_id IN
                (SELECT run_through_id FROM flow_records WHERE flow_id = $1 AND id = ANY($2))))
         ORDER BY r.seq"
    ))
    .bind(flow_id)
    .bind(ids)
    .bind(run_mates)
    .fetch_all(&mut *tx)
    .await?;
    found.into_iter().map(kept).collect()
}

/// 收房間送來的改、刪、救回：流程被刪了回 Deleted；被收回回 Revoked。誰能動哪一筆、改成什麼、救不救回照流程核心的
/// amendRecords（#351，ADR 0018）：Rust 用 SQL 只挑送來的那幾次（救回再加同一次全上還在的）傳進去，照結果存
/// （清掉的留墓碑、改好救回的存成新的樣子、記下用手動過時第幾步）。不能動的不算，不退回。鎖著那一列：照收到的先後做。
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
    let (ids, sent): (Vec<String>, AmendSent) = match &amend {
        Amend::Change(attempts) => (
            attempts
                .iter()
                .filter_map(|s| Some(s.attempt.get("id")?.as_str()?.to_owned()))
                .collect(),
            AmendSent::Change { attempts },
        ),
        Amend::Delete(ids) => (ids.clone(), AmendSent::Delete { ids }),
        Amend::Restore(ids) => (ids.clone(), AmendSent::Restore { ids }),
    };
    let known = asked(&mut tx, flow_id, &ids, matches!(amend, Amend::Restore(_))).await?;
    let ask = AmendAsk {
        step,
        role,
        by: user_id.to_string(),
        sent,
        records: known
            .iter()
            .map(|k| KnownRecord {
                stored: &k.stored,
                gone: k.gone,
                by: k.recorded_by.map(|id| id.to_string()),
            })
            .collect(),
    };
    let outcome: AmendOutcome = match state
        .core
        .amend_records(content, serde_json::to_string(&ask)?)
        .await
    {
        Ok(json) => serde_json::from_str(&json)?,
        // 流程核心自己出錯（不是 amendRecords 不算的）：這一串都不動
        Err(err) => {
            tracing::warn!(error = %err, "流程核心跑 amendRecords 出錯，這一串都不動");
            AmendOutcome::default()
        }
    };

    let now = state.clock.now();
    for id in &outcome.deleted {
        bury(&mut tx, flow_id, id, now).await?;
    }
    for new in outcome.changed.iter().chain(&outcome.restored) {
        update(&mut tx, flow_id, new, now).await?;
    }
    for Amended { id, step } in &outcome.amended {
        amended(&mut tx, flow_id, id, *step).await?;
    }
    let now_kept: Vec<Kept> = asked(&mut tx, flow_id, &ids, false)
        .await?
        .into_iter()
        .filter(|r| !r.gone)
        .collect();
    tx.commit().await?;
    let saved = now_kept.iter().map(|r| r.seen_by(user_id)).collect();
    let told: HashSet<String> = outcome.told.into_iter().collect();
    let change = RecordsChange {
        changed: now_kept
            .into_iter()
            .filter(|r| told.contains(r.id()))
            .collect(),
        deleted: outcome.deleted,
    };
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

#[cfg(test)]
#[path = "records_timing.rs"]
mod timing;

#[cfg(test)]
#[path = "records_tests.rs"]
mod tests;
