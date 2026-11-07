//! 管理使用者（#245）：只有管理員能叫。名單、加使用者、重寄邀請、寄重設密碼信、改 email、停用、恢復。
//! 只有停用，沒有刪除使用者。管理員不能幫人決定密碼（只能寄信讓他自己設）。
//! 要寄信的事，信寄不出去就什麼都不改（信在交易裡寄，寄不出去就退回）。

use axum::Json;
use axum::extract::{FromRequestParts, Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::AppState;
use crate::accounts::{LinkPurpose, current_user_id, new_link, password_mail};
use crate::mail::{Mail, MailError};

// ---------- 前後端共用的訊息 ----------

/// 名單上的一列。
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UserRow {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub email: String,
    pub status: UserStatus,
    /// 是不是管理員自己（自己那列沒有「停用」）。
    pub me: bool,
}

/// 這個人卡在哪裡。
#[derive(Serialize, TS, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum UserStatus {
    /// 可以登入。
    Active,
    /// 等他設密碼：邀請信幾小時後過期（不到 1 小時算 1）。
    Invited {
        #[serde(rename = "hoursLeft")]
        hours_left: u32,
    },
    /// 邀請過期，他還沒設密碼。
    InviteExpired,
    /// 已停用。
    Disabled,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct AddUserRequest {
    pub email: String,
    pub name: String,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct ChangeEmailRequest {
    pub email: String,
}

/// 管理的事做不成的原因（4xx、503 的內容）。
#[derive(Serialize, TS, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AdminProblem {
    /// 這個 email 已經有帳號了（不分大小寫）。409。
    EmailTaken,
    /// 寄信服務今天的額度用完了：今天寄不出去，明天再試。503。
    MailQuota,
    /// 這個人現在不能這樣做（例：停用自己、幫已停用的人寄重設密碼信）。409。
    NotAllowed,
}

// ---------- 只有管理員 ----------

/// 叫管理的 API 的人是管理員：沒登入回 401，不是管理員回 403。裡面是他的 id。
pub struct Admin(i64);

impl FromRequestParts<AppState> for Admin {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        match current_user_id(state, &parts.headers).await {
            Ok(Some((id, true))) => Ok(Self(id)),
            Ok(Some(_)) => Err(StatusCode::FORBIDDEN.into_response()),
            Ok(None) => Err(StatusCode::UNAUTHORIZED.into_response()),
            Err(err) => Err(AdminError::Internal(err).into_response()),
        }
    }
}

// ---------- API ----------

/// 資料庫裡的一列，還沒算狀態。
#[derive(sqlx::FromRow)]
struct StoredUser {
    id: i64,
    name: String,
    email: String,
    has_password: bool,
    disabled: bool,
    /// 還沒用的邀請連結到期的時間（沒有是空的）。
    invite_until: Option<DateTime<Utc>>,
}

/// 所有使用者（照加進來的順序）。
pub async fn list(
    Admin(me): Admin,
    State(state): State<AppState>,
) -> Result<Json<Vec<UserRow>>, AdminError> {
    let rows: Vec<StoredUser> = sqlx::query_as(
        "SELECT u.id, u.name, u.email, u.password_hash IS NOT NULL AS has_password,
                u.disabled_at IS NOT NULL AS disabled,
                (SELECT max(l.expires_at) FROM password_links l
                 WHERE l.user_id = u.id AND l.purpose = 'invite') AS invite_until
         FROM users u ORDER BY u.id",
    )
    .fetch_all(&state.db)
    .await?;
    let now = state.clock.now();
    Ok(Json(
        rows.into_iter()
            .map(|u| UserRow {
                status: status(now, u.has_password, u.disabled, u.invite_until),
                me: u.id == me,
                id: u.id,
                name: u.name,
                email: u.email,
            })
            .collect(),
    ))
}

fn status(
    now: DateTime<Utc>,
    has_password: bool,
    disabled: bool,
    invite_until: Option<DateTime<Utc>>,
) -> UserStatus {
    if disabled {
        return UserStatus::Disabled;
    }
    if has_password {
        return UserStatus::Active;
    }
    match invite_until {
        Some(until) if until > now => {
            let seconds = (until - now).num_seconds();
            UserStatus::Invited {
                hours_left: ((seconds + 3599) / 3600) as u32,
            }
        }
        _ => UserStatus::InviteExpired,
    }
}

/// 加使用者、寄邀請（24 小時）。一個 email 一個帳號，不分大小寫。
pub async fn add(
    Admin(_): Admin,
    State(state): State<AppState>,
    Json(req): Json<AddUserRequest>,
) -> Result<Response, AdminError> {
    let (email, name) = (req.email.trim(), req.name.trim());
    if !email.contains('@') || name.is_empty() {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    let mut tx = state.db.begin().await?;
    let (id,): (i64,) =
        sqlx::query_as("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id")
            .bind(email)
            .bind(name)
            .fetch_one(&mut *tx)
            .await
            .map_err(taken)?;
    let token = new_link(&mut tx, id, LinkPurpose::Invite, state.clock.now()).await?;
    let mail = password_mail(
        &state.site_url,
        email.into(),
        name,
        LinkPurpose::Invite,
        &token,
    );
    state.mailer.send(mail).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 重寄邀請：舊的連結馬上不能用。只給還沒設密碼、沒被停用的人。
pub async fn resend_invite(
    Admin(_): Admin,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, AdminError> {
    password_link_for(&state, id, LinkPurpose::Invite).await
}

/// 寄重設密碼信（1 小時、用一次）。只給可以登入的人。管理員不知道、也不能決定他的密碼。
pub async fn send_reset(
    Admin(_): Admin,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, AdminError> {
    password_link_for(&state, id, LinkPurpose::Reset).await
}

async fn password_link_for(
    state: &AppState,
    id: i64,
    purpose: LinkPurpose,
) -> Result<Response, AdminError> {
    let mut tx = state.db.begin().await?;
    let Some((email, name, has_password, disabled)) = user(&mut tx, id).await? else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    let fits = match purpose {
        LinkPurpose::Invite => !has_password,
        LinkPurpose::Reset => has_password,
    };
    if disabled || !fits {
        return Err(AdminProblem::NotAllowed.into());
    }
    let token = new_link(&mut tx, id, purpose, state.clock.now()).await?;
    let mail = password_mail(&state.site_url, email, &name, purpose, &token);
    state.mailer.send(mail).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 改 email：不能跟別人重複（不分大小寫）；新舊兩個信箱都收到通知。
pub async fn change_email(
    Admin(_): Admin,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<ChangeEmailRequest>,
) -> Result<Response, AdminError> {
    let new = req.email.trim();
    if !new.contains('@') {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    let mut tx = state.db.begin().await?;
    let Some((old, name, _, _)) = user(&mut tx, id).await? else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    sqlx::query("UPDATE users SET email = $1 WHERE id = $2")
        .bind(new)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(taken)?;
    let text = format!(
        "{name}，你好：\n\n管理員把你登入用的 email 從 {old} 改成 {new}。之後請用 {new} 登入。\n\n不是你要的，請找管理員。\n"
    );
    for to in [old.as_str(), new] {
        state
            .mailer
            .send(Mail {
                to: to.into(),
                subject: "你登入用的 email 改了：競技啦啦隊流程編輯器".into(),
                text: text.clone(),
            })
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 停用：每台裝置馬上登出、還沒用的連結作廢。流程、權限、紀錄都留著。不能停用自己。
pub async fn disable(
    Admin(me): Admin,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, AdminError> {
    if id == me {
        return Err(AdminProblem::NotAllowed.into());
    }
    let mut tx = state.db.begin().await?;
    let done =
        sqlx::query("UPDATE users SET disabled_at = $1 WHERE id = $2 AND disabled_at IS NULL")
            .bind(state.clock.now())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    if done.rows_affected() == 0 {
        return Ok(already_or_missing(&mut tx, id).await?);
    }
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM password_links WHERE user_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 恢復：他用原本的密碼就能登入（停用前還沒設密碼的，要重寄邀請）。
pub async fn enable(
    Admin(_): Admin,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, AdminError> {
    let mut tx = state.db.begin().await?;
    let done = sqlx::query(
        "UPDATE users SET disabled_at = NULL WHERE id = $1 AND disabled_at IS NOT NULL",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Ok(already_or_missing(&mut tx, id).await?);
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

// ---------- 小工具 ----------

/// email、名字、設過密碼沒、停用了沒。
async fn user(
    tx: &mut sqlx::PgConnection,
    id: i64,
) -> sqlx::Result<Option<(String, String, bool, bool)>> {
    sqlx::query_as(
        "SELECT email, name, password_hash IS NOT NULL, disabled_at IS NOT NULL FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
}

/// 停用、恢復沒改到：已經是那樣了（照樣算做好）或沒有這個人。
async fn already_or_missing(tx: &mut sqlx::PgConnection, id: i64) -> sqlx::Result<Response> {
    Ok(match user(tx, id).await? {
        Some(_) => StatusCode::NO_CONTENT.into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    })
}

/// email 撞到別人（users_email_key 是 lower(email) 的唯一索引）。
fn taken(err: sqlx::Error) -> AdminError {
    match &err {
        sqlx::Error::Database(db) if db.is_unique_violation() => AdminProblem::EmailTaken.into(),
        _ => AdminError::Internal(err.into()),
    }
}

pub enum AdminError {
    Problem(AdminProblem),
    Internal(anyhow::Error),
}

impl From<AdminProblem> for AdminError {
    fn from(problem: AdminProblem) -> Self {
        Self::Problem(problem)
    }
}

impl From<sqlx::Error> for AdminError {
    fn from(err: sqlx::Error) -> Self {
        Self::Internal(err.into())
    }
}

impl From<anyhow::Error> for AdminError {
    fn from(err: anyhow::Error) -> Self {
        Self::Internal(err)
    }
}

impl From<MailError> for AdminError {
    fn from(err: MailError) -> Self {
        match err {
            MailError::OverQuota => Self::Problem(AdminProblem::MailQuota),
            other => Self::Internal(other.into()),
        }
    }
}

impl IntoResponse for AdminError {
    fn into_response(self) -> Response {
        match self {
            Self::Problem(problem) => {
                let status = match problem {
                    AdminProblem::MailQuota => StatusCode::SERVICE_UNAVAILABLE,
                    AdminProblem::EmailTaken | AdminProblem::NotAllowed => StatusCode::CONFLICT,
                };
                (status, Json(problem)).into_response()
            }
            Self::Internal(err) => {
                tracing::error!(err = %err, "伺服器出錯");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        }
    }
}
