//! 雲端流程：新建、列出我的流程和分享給我的、拿一支（#247、#250）。
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
use crate::accounts::{AppError, signed_in};
use crate::records::{self, CloudRecord};
use crate::sharing::{Role, role_of};

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
    /// 成功率紀錄（跟編排分開存，ADR 0008），照收到的先後；別人記的帶名字。
    pub records: Vec<CloudRecord>,
}

/// 流程核心不收時（422）的原因。
#[derive(Serialize, TS)]
#[ts(export)]
pub struct FlowBlocked {
    pub message: String,
}

/// 新建：收新建流程表單的 `{ name, field }`（流程核心的 NewFlowInput），用流程核心的 createFlow 建，
/// 建出來的就是這支的編排。被擋回 422 和原因；建好回 201 和這支的摘要。
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Box<RawValue>>,
) -> Result<Response, AppError> {
    let Some((user_id, _)) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let id = new_flow_id()?;
    let commands = format!(r#"[{{"name":"createFlow","args":[{}]}}]"#, input.get());
    // 建這支流程的那一步：步驟 id 用這支流程的 id（亂數），新東西的 id 由它算出來（ADR 0011）。
    let Ok(result) = state
        .core
        .run_commands("null".into(), commands, id.clone())
        .await
    else {
        // 流程核心讀不懂（例：不是物件）。
        return Ok(StatusCode::BAD_REQUEST.into_response());
    };
    let outcome: Outcome = serde_json::from_str(&result)?;
    let flow = match (outcome.kind.as_str(), outcome.flow, outcome.message) {
        ("ok", Some(flow), _) => flow,
        (_, _, message) => {
            let message = message.unwrap_or_default();
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(FlowBlocked { message }),
            )
                .into_response());
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

/// 我的流程（我擁有的）、分享給我的，最近改的在前。
pub async fn mine(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    let Some((user_id, _)) = signed_in(&state, &headers).await? else {
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
    Ok(Json(MyFlows { mine, shared }).into_response())
}

/// 拿一支：編排、現在第幾步、我的權限。沒權限、沒有這支都回 404。
pub async fn get_one(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let Some((user_id, _)) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let Some(role) = role_of(&state.db, &id, user_id).await? else {
        return Ok(StatusCode::NOT_FOUND.into_response());
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
}

/// 時間寫成跟 JS `toISOString` 一樣：`2026-11-07T09:00:00.000Z`。
fn iso(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// 雲端流程的 id：12 個字的亂數（小寫字母、數字）。
fn new_flow_id() -> anyhow::Result<String> {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("拿不到亂數：{e}"))?;
    Ok(bytes
        .iter()
        .map(|b| CHARS[*b as usize % CHARS.len()] as char)
        .collect())
}
