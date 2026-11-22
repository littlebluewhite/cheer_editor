//! 雲端流程：新建、傳上雲端、列出我的流程和分享給我的、拿一支（#247、#250、#259）。
//! 有權限的人才拿得到；沒權限跟沒有這支一樣，回 404（管理員也一樣）。

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use ts_rs::TS;

use crate::AppState;
use crate::accounts::{AppError, SignedIn, random_id, signed_in};
use crate::records::{self, CloudRecord, Stored};
use crate::sharing::{Role, no_access, role_of};

/// 雲端流程的 id 幾個字（亂數）。
const FLOW_ID_LEN: usize = 12;

/// 「我的流程」裡的一支。
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloudFlowSummary {
    pub id: String,
    pub name: String,
    /// 最後改的時間（ISO 8601，UTC）。
    pub updated_at: String,
}

/// 「分享給我的」裡的一支：別人的流程寫「王教練的・編輯者」；擁有者被停用寫「黃教練的（已停用）」。
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharedFlowSummary {
    pub id: String,
    pub name: String,
    pub updated_at: String,
    pub owner_name: String,
    pub owner_disabled: bool,
    /// 我的權限。
    pub role: Role,
}

/// 首頁「雲端」那一塊。
#[derive(Serialize, TS)]
#[ts(export)]
pub struct MyFlows {
    /// 我擁有的，最近改的在前。
    pub mine: Vec<CloudFlowSummary>,
    /// 分享給我的，最近改的在前。
    pub shared: Vec<SharedFlowSummary>,
    /// 被擁有者刪掉的（刪的時候我有權限，#252）：這台的離線副本說「被刪掉了」，不說被收回。
    pub deleted: Vec<String>,
}

/// 打開一支雲端流程拿到的。
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloudFlow {
    pub id: String,
    /// 編排（流程核心的 Flow，不含成功率紀錄），照存進去的字原樣送。
    #[ts(type = "unknown")]
    pub flow: Box<RawValue>,
    /// 現在第幾步。
    #[ts(type = "number")]
    pub step: i64,
    pub updated_at: String,
    /// 我的權限（記錄者、檢視者打開一律是檢視模式）。
    pub role: Role,
    /// 成功率紀錄（跟編排分開存，ADR 0011），照收到的先後；別人記的帶名字。
    pub records: Vec<CloudRecord>,
}

/// 流程核心不收時（422）的原因：中文，和代號（流程核心的 Why，ADR 0017；還沒改成代號的原因沒有）。
/// 一步被退回（flow_room 的 SentBack）也用它帶流程核心的原因。
#[derive(Serialize, Deserialize, TS, Debug)]
#[ts(export)]
pub struct FlowBlocked {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "import('../core/why').Why")]
    pub why: Option<serde_json::Value>,
}

impl FlowBlocked {
    /// 流程核心結果裡的原因（沒寫是空的）。
    pub(crate) fn new(message: Option<String>, why: Option<serde_json::Value>) -> Self {
        Self {
            message: message.unwrap_or_default(),
            why,
        }
    }
}

/// 新建：收新建流程表單的 `{ name, field }`（流程核心的 NewFlowInput），用流程核心的 createFlow 建，
/// 建出來的就是這支的編排。被擋回 422 和原因；建好回 201 和這支的摘要。
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Box<RawValue>>,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let id = random_id(FLOW_ID_LEN)?;
    let commands = format!(r#"[{{"name":"createFlow","args":[{}]}}]"#, input.get());
    // 建這支流程的那一步：步驟 id 用這支流程的 id（亂數），新東西的 id 由它算出來（ADR 0014）。
    let Ok(result) = state
        .core
        .run_commands("null".into(), commands, id.clone())
        .await
    else {
        // 流程核心讀不懂（例：不是物件）。
        return Ok(StatusCode::BAD_REQUEST.into_response());
    };
    let outcome: Outcome = serde_json::from_str(&result)?;
    let flow = match (outcome.kind.as_str(), outcome.flow) {
        ("ok", Some(flow)) => flow,
        _ => {
            let reason = FlowBlocked::new(outcome.message, outcome.why);
            return Ok((StatusCode::UNPROCESSABLE_ENTITY, Json(reason)).into_response());
        }
    };

    let now = state.clock.now();
    let (name,): (String,) = sqlx::query_as(
        "INSERT INTO flows (id, owner_id, content, updated_at) VALUES ($1, $2, $3::json, $4)
         RETURNING content->>'name'",
    )
    .bind(&id)
    .bind(user_id)
    .bind(flow.get())
    .bind(now)
    .fetch_one(&state.db)
    .await?;
    let made = CloudFlowSummary {
        id,
        name,
        updated_at: iso(now),
    };
    Ok((StatusCode::CREATED, Json(made)).into_response())
}

/// 傳上雲端（#259）：收流程檔裡 flow.json 的內容，跑「檢查一整支流程」和「整份流程檢查」（流程核心），
/// 過了就變成一支新的雲端流程，傳的人是擁有者（同一個檔傳兩次就是兩支）。紀錄拆出來分開存，沒有記的人（ADR 0011）。
/// 音樂檔不經過這裡：建好後前端照放音樂的路（#249）一個一個傳。不收回 422 和原因；建好回 201 和這支的摘要。
pub async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(doc): Json<Box<RawValue>>,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let Ok(result) = state.core.upload_flow(doc.get().to_owned()).await else {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    };
    let uploaded: Uploaded = serde_json::from_str(&result)?;
    let (flow, records) = match (uploaded.kind.as_str(), uploaded.flow, uploaded.records) {
        ("ok", Some(flow), Some(records)) => (flow, records),
        _ => {
            let reason = FlowBlocked::new(uploaded.message, uploaded.why);
            return Ok((StatusCode::UNPROCESSABLE_ENTITY, Json(reason)).into_response());
        }
    };

    let id = random_id(FLOW_ID_LEN)?;
    let now = state.clock.now();
    let mut tx = state.db.begin().await?;
    // 記著讓它留著的毛病，配上這版流程核心的指紋（ADR 0020）。
    let (name,): (String,) = sqlx::query_as(
        "INSERT INTO flows (id, owner_id, content, updated_at, held, held_core)
         VALUES ($1, $2, $3::json, $4, $5, $6)
         RETURNING content->>'name'",
    )
    .bind(&id)
    .bind(user_id)
    .bind(flow.get())
    .bind(now)
    .bind(&uploaded.held)
    .bind(crate::flow_core::FINGERPRINT)
    .fetch_one(&mut *tx)
    .await?;
    records::from_file(&mut tx, &id, &records, now).await?;
    tx.commit().await?;
    let made = CloudFlowSummary {
        id,
        name,
        updated_at: iso(now),
    };
    Ok((StatusCode::CREATED, Json(made)).into_response())
}

/// 流程核心檢查傳上來的流程的結果（`uploadFlowJson`）：收了帶不帶紀錄的編排和紀錄，不收帶原因。
#[derive(Deserialize)]
struct Uploaded<'a> {
    kind: String,
    #[serde(borrow)]
    flow: Option<&'a RawValue>,
    records: Option<Vec<Stored>>,
    /// 收了：讓它留著的毛病的鍵（ADR 0020）。
    #[serde(default)]
    held: Vec<String>,
    message: Option<String>,
    why: Option<serde_json::Value>,
}

/// 我的流程（我擁有的）、分享給我的，最近改的在前。
pub async fn mine(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let rows: Vec<(String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, content->>'name', updated_at FROM flows WHERE owner_id = $1
         ORDER BY updated_at DESC, id",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    let mine = rows
        .into_iter()
        .map(|(id, name, at)| CloudFlowSummary {
            id,
            name,
            updated_at: iso(at),
        })
        .collect();
    let rows: Vec<(String, String, DateTime<Utc>, String, bool, String)> = sqlx::query_as(
        "SELECT f.id, f.content->>'name', f.updated_at, u.name, u.disabled_at IS NOT NULL, p.role
         FROM flow_permissions p JOIN flows f ON f.id = p.flow_id JOIN users u ON u.id = f.owner_id
         WHERE p.user_id = $1 ORDER BY f.updated_at DESC, f.id",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    let shared = rows
        .into_iter()
        .filter_map(|(id, name, at, owner_name, owner_disabled, role)| {
            Some(SharedFlowSummary {
                id,
                name,
                updated_at: iso(at),
                owner_name,
                owner_disabled,
                role: Role::parse(&role)?,
            })
        })
        .collect();
    let deleted: Vec<(String,)> =
        sqlx::query_as("SELECT flow_id FROM deleted_flows WHERE user_id = $1 ORDER BY flow_id")
            .bind(user_id)
            .fetch_all(&state.db)
            .await?;
    let deleted = deleted.into_iter().map(|(id,)| id).collect();
    Ok(Json(MyFlows {
        mine,
        shared,
        deleted,
    })
    .into_response())
}

/// 拿一支：編排、現在第幾步、我的權限。沒權限、沒有這支都回 404；被擁有者刪了（刪的時候我有權限）回 410。
pub async fn get_one(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let Some(role) = role_of(&state.db, &id, user_id).await? else {
        return Ok(no_access(&state.db, &id, user_id).await?.into_response());
    };
    let (content, step, at): (String, i64, DateTime<Utc>) =
        sqlx::query_as("SELECT content::text, step, updated_at FROM flows WHERE id = $1")
            .bind(&id)
            .fetch_one(&state.db)
            .await?;
    let flow = RawValue::from_string(content)?;
    let records = records::for_viewer(&state.db, &id, user_id).await?;
    Ok(Json(CloudFlow {
        id,
        flow,
        step,
        updated_at: iso(at),
        role,
        records,
    })
    .into_response())
}

/// 流程核心跑完的結果：成功帶流程（原樣的字），被擋、要問帶原因。
#[derive(Deserialize)]
pub(crate) struct Outcome<'a> {
    pub kind: String,
    #[serde(borrow)]
    pub flow: Option<&'a RawValue>,
    pub message: Option<String>,
    pub why: Option<serde_json::Value>,
}

/// 時間寫成跟 JS `toISOString` 一樣：`2026-11-07T09:00:00.000Z`。
pub(crate) fn iso(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}
