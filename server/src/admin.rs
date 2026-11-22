//! 管理使用者（#245）：只有管理員能叫。名單、加使用者、重寄邀請、寄重設密碼信、改 email、停用、恢復。
//! 移交（#252）：只有使用者被停用時，把他擁有的流程全部交給同一個人；管理員只看到支數，看不到流程名字。
//! 刪除帳號（#369）：只有已停用的人，不能恢復；管理員刪不了自己。管理員不能幫人決定密碼（只能寄信讓他自己設）。
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
use crate::accounts::{LinkPurpose, SignedIn, new_link, password_mail, signed_in, signed_out};
use crate::cloud_flows::iso;
use crate::flow_room::RoomEvent;
use crate::mail::{Mail, MailError};
use crate::sharing::{delete_flow, hand_over_flows, tell_new_owner};

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
    /// 已停用：他擁有幾支流程（有的話寫「已停用・他有 N 支流程」，可以移交）。
    /// 他自己要求刪除帳號的（#370）帶要求的時間（ISO 8601，UTC）：寫「要求刪除・日期」，不給移交。
    Disabled {
        flows: u32,
        #[serde(rename = "deleteRequested", skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        delete_requested: Option<String>,
    },
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

/// 管理員移交：接手的人的 email。
#[derive(Deserialize, TS)]
#[ts(export)]
pub struct HandOverRequest {
    pub email: String,
}

/// 管理員移交好了：交出去幾支（看不到是哪幾支）。
#[derive(Serialize, TS)]
#[ts(export)]
pub struct HandedOver {
    pub flows: u32,
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
    /// 這個人現在不能這樣做（例：停用自己、幫已停用的人寄重設密碼信、移交沒被停用的人的流程）。409。
    NotAllowed,
    /// 移交：這個 email 沒有帳號。409。
    NoAccount,
    /// 移交：不能交給他自己。409。
    SameUser,
    /// 移交：接手的人被停用了，不能移交給他。409。
    Disabled { name: String },
}

// ---------- 只有管理員 ----------

/// 叫管理的 API 的人是管理員：沒登入回 401，不是管理員回 403。裡面是他的 id。
pub struct Admin(i64);

impl FromRequestParts<AppState> for Admin {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        match signed_in(state, &parts.headers).await {
            Ok(Some(SignedIn { user_id, me, .. })) if me.is_admin => Ok(Self(user_id)),
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
    /// 他擁有幾支流程。
    flows: i64,
    /// 他自己要求刪除帳號的時間（#370）。
    delete_requested_at: Option<DateTime<Utc>>,
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
                 WHERE l.user_id = u.id AND l.purpose = 'invite') AS invite_until,
                (SELECT count(*) FROM flows f WHERE f.owner_id = u.id) AS flows,
                u.delete_requested_at
         FROM users u ORDER BY u.id",
    )
    .fetch_all(&state.db)
    .await?;
    let now = state.clock.now();
    Ok(Json(
        rows.into_iter()
            .map(|u| UserRow {
                status: status(now, &u),
                me: u.id == me,
                id: u.id,
                name: u.name,
                email: u.email,
            })
            .collect(),
    ))
}

fn status(now: DateTime<Utc>, u: &StoredUser) -> UserStatus {
    if u.disabled {
        return UserStatus::Disabled {
            flows: u.flows as u32,
            delete_requested: u.delete_requested_at.map(iso),
        };
    }
    if u.has_password {
        return UserStatus::Active;
    }
    match u.invite_until {
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
    // 寄到舊信箱的邀請、重設密碼連結作廢（email 打錯時，舊信箱不是他的）。
    sqlx::query("DELETE FROM password_links WHERE user_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
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
    signed_out(&state, id);
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 恢復：他用原本的密碼就能登入（停用前還沒設密碼的，要重寄邀請）。他要求過刪除帳號的，要求一起取消（#370）。
pub async fn enable(
    Admin(_): Admin,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, AdminError> {
    let mut tx = state.db.begin().await?;
    let done = sqlx::query(
        "UPDATE users SET disabled_at = NULL, delete_requested_at = NULL WHERE id = $1 AND disabled_at IS NOT NULL",
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

/// 移交：只有被停用、不是自己要求刪除帳號的人（不然 409 notAllowed，#370）。他擁有的流程全部交給 email 那個人，他變這些流程的編輯者。
/// 擋：沒帳號、交給他自己、接手的人被停用。回交出去幾支。
pub async fn hand_over(
    Admin(_): Admin,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<HandOverRequest>,
) -> Result<Response, AdminError> {
    let mut tx = state.db.begin().await?;
    let Some((_, _, _, disabled)) = user(&mut tx, id).await? else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    let requested: bool =
        sqlx::query_scalar("SELECT delete_requested_at IS NOT NULL FROM users WHERE id = $1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if !disabled || requested {
        return Err(AdminProblem::NotAllowed.into());
    }
    let to: Option<(i64, String, bool)> = sqlx::query_as(
        "SELECT id, name, disabled_at IS NOT NULL FROM users WHERE lower(email) = lower($1)",
    )
    .bind(req.email.trim())
    .fetch_optional(&mut *tx)
    .await?;
    let to = match to {
        None => return Err(AdminProblem::NoAccount.into()),
        Some((to, ..)) if to == id => return Err(AdminProblem::SameUser.into()),
        Some((_, name, true)) => return Err(AdminProblem::Disabled { name }.into()),
        Some((to, ..)) => to,
    };
    let moved = hand_over_flows(&mut tx, id, to, None, state.clock.now()).await?;
    tx.commit().await?;
    tell_new_owner(&state, &moved, id, to);
    Ok(Json(HandedOver {
        flows: moved.len() as u32,
    })
    .into_response())
}

/// 刪除帳號：只有已停用的人（不然 409 notAllowed），管理員刪不了自己（409 notAllowed）。照 [`delete_account`] 刪，
/// 寄他一封「刪好了」（寄不出去就什麼都不刪）。
pub async fn delete(
    Admin(me): Admin,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, AdminError> {
    if id == me {
        return Err(AdminProblem::NotAllowed.into());
    }
    let mut tx = state.db.begin().await?;
    let disabled: Option<bool> =
        sqlx::query_scalar("SELECT disabled_at IS NOT NULL FROM users WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    match disabled {
        None => return Ok(StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Err(AdminProblem::NotAllowed.into()),
        Some(true) => {}
    }
    let deleted = delete_account(&mut tx, id, state.clock.now()).await?;
    state
        .mailer
        .send(Mail {
            to: deleted.email.clone(),
            subject: "你的帳號刪好了：競技啦啦隊流程編輯器".into(),
            text: format!(
                "{}，你好：\n\n你在競技啦啦隊流程編輯器的帳號刪好了。你的 email、名字、密碼都不在了；你擁有的流程也一起刪了。\n\n你在別人流程裡記的成功率紀錄、改過的地方還留著，但不寫是誰。\n\n之後要再用，請找管理員重新邀請你，會是一個新的帳號。\n",
                deleted.name
            ),
        })
        .await?;
    tx.commit().await?;
    deleted.tell_rooms(&state);
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 刪掉的那個人：email、名字（寄「刪好了」用），他擁有、刪掉的流程，他原本有權限的別人的流程。
pub(crate) struct DeletedAccount {
    pub user_id: i64,
    pub email: String,
    pub name: String,
    pub flows: Vec<String>,
    pub shared: Vec<String>,
}

impl DeletedAccount {
    /// commit 之後：他擁有的流程開著的房間說被刪了，別人的流程房間說他沒權限了，他自己每個連線都關掉。
    pub(crate) fn tell_rooms(&self, state: &AppState) {
        for flow in &self.flows {
            state.rooms.tell(flow, RoomEvent::Deleted);
        }
        for flow in &self.shared {
            state.rooms.tell(
                flow,
                RoomEvent::Permission {
                    user_id: self.user_id,
                    role: None,
                },
            );
        }
        signed_out(state, self.user_id);
    }
}

/// 刪除帳號（#369，#325 的結論）：在 tx 裡把這個人從伺服器上拿掉。不檢查能不能刪（呼叫的人先查、先鎖住他那一列）。
/// - 他擁有的流程：跟擁有者刪流程一樣（[`delete_flow`]），有權限的人之後看到「被擁有者刪掉了」，音樂 30 天後刪。
/// - 他在別人流程上的權限、登入、設密碼連結、他的「被擁有者刪掉了」、用 email 記的猜錯密碼紀錄：刪掉。
/// - 他在別人流程裡記的紀錄、改過的步：留著，記的人、改的人變 NULL（跟從流程檔傳上來的紀錄一樣不寫是誰）。
///
/// 之後同一個 email 可以再被邀請，是新的使用者。commit 之後叫 [`DeletedAccount::tell_rooms`]。
pub(crate) async fn delete_account(
    tx: &mut sqlx::PgConnection,
    id: i64,
    now: DateTime<Utc>,
) -> anyhow::Result<DeletedAccount> {
    let (email, name): (String, String) =
        sqlx::query_as("SELECT email, name FROM users WHERE id = $1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    let flows: Vec<String> =
        sqlx::query_scalar("SELECT id FROM flows WHERE owner_id = $1 ORDER BY id FOR UPDATE")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
    for flow in &flows {
        delete_flow(tx, flow, now).await?;
    }
    let shared: Vec<String> =
        sqlx::query_scalar("DELETE FROM flow_permissions WHERE user_id = $1 RETURNING flow_id")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
    for sql in [
        "DELETE FROM sessions WHERE user_id = $1",
        "DELETE FROM password_links WHERE user_id = $1",
        "DELETE FROM deleted_flows WHERE user_id = $1",
    ] {
        sqlx::query(sql).bind(id).execute(&mut *tx).await?;
    }
    crate::lockout::clear(&mut *tx, &email).await?;
    sqlx::query("UPDATE flow_records SET recorded_by = NULL WHERE recorded_by = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE flow_steps SET user_id = NULL WHERE user_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(DeletedAccount {
        user_id: id,
        email,
        name,
        flows,
        shared,
    })
}

// ---------- 小工具 ----------

/// email、名字、設過密碼沒、停用了沒。鎖住這一列到 commit：寄設密碼信和改 email 一次一個，
/// 不會照改之前的 email 寄出改之後才建的連結。
async fn user(
    tx: &mut sqlx::PgConnection,
    id: i64,
) -> sqlx::Result<Option<(String, String, bool, bool)>> {
    sqlx::query_as(
        "SELECT email, name, password_hash IS NOT NULL, disabled_at IS NOT NULL FROM users WHERE id = $1 FOR NO KEY UPDATE",
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
                    _ => StatusCode::CONFLICT,
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
