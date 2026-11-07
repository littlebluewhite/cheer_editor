//! 分享連結（#251，#234「權限、分享、移交」）：一支流程一條。只有擁有者能開、關；名單上的人都看得到、能複製。
//! 關掉再打開換一條新的，舊的就不能用。用連結打開不用登入，只拿到編排（場地、八拍表、播放），
//! 不給紀錄；不連房間、不加進名單（不出現在「分享給我的」）。已經登入、有權限的人用連結打開，照自己的權限。

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::value::RawValue;
use ts_rs::TS;

use crate::AppState;
use crate::accounts::{AppError, SignedIn, signed_in};
use crate::cloud_flows::iso;
use crate::sharing::{Role, role_of};

/// 分享連結開著沒：開著是連結的那串字，關著是 null。
#[derive(Serialize, TS)]
#[ts(export)]
pub struct ShareLink {
    pub token: Option<String>,
}

/// 擁有者開、關分享連結。
#[derive(Deserialize, TS)]
#[ts(export)]
pub struct SwitchShareLink {
    pub on: bool,
}

/// 用分享連結打開拿到的：編排（沒有紀錄）、最後改的時間。
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LinkedFlow {
    pub id: String,
    /// 編排：每個動作的成功率紀錄都拿掉了。
    #[ts(type = "unknown")]
    pub flow: Box<RawValue>,
    pub updated_at: String,
    /// 已經登入、有權限的人才有：照自己的權限打開（連房間那條路）。
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub role: Option<Role>,
}

/// 分享連結開著沒：名單上的人都看得到。沒登入 401，沒權限、沒有這支 404。
pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if role_of(&state.db, &id, user_id).await?.is_none() {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    let (token,): (Option<String>,) = sqlx::query_as("SELECT share_token FROM flows WHERE id = $1")
        .bind(&id)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(ShareLink { token }).into_response())
}

/// 開、關：只有擁有者（別人 403）。開著再開還是同一條；關著打開換一條新的。回現在的連結。
pub async fn switch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<SwitchShareLink>,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    match role_of(&state.db, &id, user_id).await? {
        None => return Ok(StatusCode::NOT_FOUND.into_response()),
        Some(Role::Owner) => {}
        Some(_) => return Ok(StatusCode::FORBIDDEN.into_response()),
    }
    let fresh = req.on.then(new_token).transpose()?;
    let (token,): (Option<String>,) = sqlx::query_as(
        "UPDATE flows SET share_token = CASE WHEN $2 THEN COALESCE(share_token, $3) END
         WHERE id = $1 RETURNING share_token",
    )
    .bind(&id)
    .bind(req.on)
    .bind(fresh)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(ShareLink { token }).into_response())
}

/// 用連結打開：不用登入。連結關了、換了、亂打的都 404。
pub async fn open(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Response, AppError> {
    let found: Option<(String, String, DateTime<Utc>)> =
        sqlx::query_as("SELECT id, content::text, updated_at FROM flows WHERE share_token = $1")
            .bind(&token)
            .fetch_optional(&state.db)
            .await?;
    let Some((id, content, at)) = found else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    let role = match signed_in(&state, &headers).await? {
        Some(SignedIn { user_id, .. }) => role_of(&state.db, &id, user_id).await?,
        None => None,
    };
    Ok(Json(LinkedFlow {
        id,
        flow: without_records(&content)?,
        updated_at: iso(at),
        role,
    })
    .into_response())
}

/// 用連結聽音樂：拿下載的預簽網址。連結不能用、沒有這個音樂檔 404；伺服器沒接 R2 503。
pub async fn audio(
    State(state): State<AppState>,
    Path((token, audio_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let found: Option<(String,)> = sqlx::query_as(
        "SELECT a.object_key FROM flows f JOIN flow_audio a ON a.flow_id = f.id
         WHERE f.share_token = $1 AND a.audio_id = $2 AND a.size IS NOT NULL",
    )
    .bind(&token)
    .bind(&audio_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((key,)) = found else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    let Some(store) = &state.music else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };
    Ok(Json(crate::music::Presigned {
        url: store.download_url(&key),
    })
    .into_response())
}

/// 編排拿掉每個動作的成功率紀錄（只留環節）：伺服器根本不給紀錄。
fn without_records(content: &str) -> anyhow::Result<Box<RawValue>> {
    let mut flow: Value = serde_json::from_str(content)?;
    if let Some(actions) = flow.get_mut("actions").and_then(Value::as_array_mut) {
        for action in actions {
            if let Some(rate) = action.get_mut("successRate").and_then(Value::as_object_mut) {
                rate.insert("records".into(), Value::Array(vec![]));
            }
        }
    }
    Ok(RawValue::from_string(serde_json::to_string(&flow)?)?)
}

/// 分享連結：32 個字的亂數（小寫字母、數字），猜不到。
fn new_token() -> anyhow::Result<String> {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("拿不到亂數：{e}"))?;
    Ok(bytes
        .iter()
        .map(|b| CHARS[*b as usize % CHARS.len()] as char)
        .collect())
}
