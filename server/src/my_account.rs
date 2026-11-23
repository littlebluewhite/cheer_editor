//! 忘記密碼、我的帳號（改名字、改密碼）（#246）。字和規矩照 #183、#190 的結論留言。
//! 要求刪除帳號（#370，照 #325 的結論）：馬上停用，寄他和管理員各一封信；真的刪由管理員做（admin.rs 的 delete）。

use std::num::NonZeroU32;
use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::AppState;
use crate::accounts::{
    AppError, LinkPurpose, Me, SignedIn, cleared_cookie, hash_password, new_link, password_mail,
    password_problem, signed_in, signed_out, verify_password,
};
use crate::lockout;
use crate::mail::{Mail, MailError};

/// 同一個 email 的忘記密碼信，一小時最多寄 3 封（OWASP：每個帳號限制重設請求的次數）。
/// 超過的照樣回一樣的話，只是不寄。只記在記憶體：伺服器重開就歸零，擋的只是一直寄信煩人。
#[derive(Clone)]
pub struct MailLimit(Arc<DefaultKeyedRateLimiter<String>>);

impl Default for MailLimit {
    fn default() -> Self {
        Self(Arc::new(RateLimiter::keyed(Quota::per_hour(
            NonZeroU32::new(3).unwrap(),
        ))))
    }
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct ChangeNameRequest {
    pub name: String,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct ChangePasswordRequest {
    /// 現在的密碼。
    pub current: String,
    /// 新密碼。
    pub password: String,
}

/// 要求刪除帳號的確認框：我擁有幾支流程、其中幾支有分享給別人（有別人的權限）。
#[derive(Serialize, TS)]
#[ts(export)]
pub struct DeleteSummary {
    pub flows: u32,
    pub shared: u32,
}

/// 忘記密碼：一律馬上回 204，有沒有帳號、有沒有被停用都一樣。查人、寄信都在背景做，回應一樣快。
/// 可以登入的（含被鎖住的）收到重設密碼信（1 小時）；還沒設密碼的收到新的設密碼信（24 小時）；
/// 沒帳號、被停用的不寄。這個人之前沒用的連結作廢。
pub async fn forgot_password(
    State(state): State<AppState>,
    Json(req): Json<ForgotPasswordRequest>,
) -> StatusCode {
    let email = req.email.trim().to_lowercase();
    if state.mail_limit.0.check_key(&email).is_ok() {
        tokio::spawn(async move {
            if let Err(err) = mail_password_link(&state, &email).await {
                tracing::error!(%err, "忘記密碼的信沒寄成");
            }
        });
    }
    StatusCode::NO_CONTENT
}

async fn mail_password_link(state: &AppState, email: &str) -> anyhow::Result<()> {
    let mut tx = state.db.begin().await?;
    // 鎖住這一列到 commit：管理員同時改 email，連結不會照舊 email 寄出又留下來（admin.rs 的 user 也鎖）。
    let user: Option<(i64, String, String, bool)> = sqlx::query_as(
        "SELECT id, email, name, password_hash IS NOT NULL FROM users
         WHERE lower(email) = lower($1) AND disabled_at IS NULL FOR NO KEY UPDATE",
    )
    .bind(email)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((user_id, to, name, has_password)) = user else {
        return Ok(());
    };
    let purpose = if has_password {
        LinkPurpose::Reset
    } else {
        LinkPurpose::Invite
    };
    let token = new_link(&mut tx, user_id, purpose, state.clock.now()).await?;
    tx.commit().await?;
    state
        .mailer
        .send(password_mail(&state.site_url, to, &name, purpose, &token))
        .await?;
    Ok(())
}

/// 改自己的名字（前後的空白去掉，不能是空的）。回改好的自己。沒登入 401。
pub async fn change_name(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChangeNameRequest>,
) -> Result<Response, AppError> {
    let Some(me) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let name = req.name.trim();
    if name.is_empty() {
        return Ok(StatusCode::UNPROCESSABLE_ENTITY.into_response());
    }
    let (email, name, is_admin): (String, String, bool) =
        sqlx::query_as("UPDATE users SET name = $1 WHERE id = $2 RETURNING email, name, is_admin")
            .bind(name)
            .bind(me.user_id)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(Me {
        email,
        name,
        is_admin,
    })
    .into_response())
}

/// 改密碼：要對現在的密碼（錯了 403，算進鎖住的次數；鎖住時 429）；新密碼不收回 422。
/// 改好回 204：這台還登入著，其他登入狀態都刪掉，還沒用的設密碼連結作廢。沒登入 401。
pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<Response, AppError> {
    let Some(SignedIn {
        user_id,
        me,
        token_hash,
        ..
    }) = signed_in(&state, &headers).await?
    else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let now = state.clock.now();
    if let Some(wait) = lockout::check(&state.db, &me.email, now).await? {
        return Ok((StatusCode::TOO_MANY_REQUESTS, Json(wait)).into_response());
    }
    let (hash,): (Option<String>,) =
        sqlx::query_as("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await?;
    let ok = match hash {
        Some(hash) => verify_password(req.current, hash).await?,
        None => false,
    };
    if !ok {
        lockout::failed(&state.db, &me.email, now).await?;
        return Ok(StatusCode::FORBIDDEN.into_response());
    }
    if let Some(problem) = password_problem(&state, &req.password).await {
        return Ok((StatusCode::UNPROCESSABLE_ENTITY, Json(problem)).into_response());
    }
    let hash = hash_password(req.password).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2")
        .bind(user_id)
        .bind(&token_hash)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM password_links WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    lockout::clear(&mut *tx, &me.email).await?;
    tx.commit().await?;
    signed_out(&state, user_id);
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 要求刪除帳號的確認框要的數字。沒登入 401。
pub async fn delete_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let Some(me) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let (flows, shared): (i64, i64) = sqlx::query_as(
        "SELECT count(*),
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM flow_permissions p WHERE p.flow_id = f.id))
         FROM flows f WHERE f.owner_id = $1",
    )
    .bind(me.user_id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(DeleteSummary {
        flows: flows as u32,
        shared: shared as u32,
    })
    .into_response())
}

/// 要求刪除帳號：帳號馬上停用（跟管理員停用一樣：每台裝置登出、連結作廢），記下要求的時間，
/// 這台的 cookie 清掉。寄他「收到了」、寄管理員「某某要求刪除帳號」；信寄不出去就什麼都不改
/// （今天的額度用完回 503）。管理員不能要求（409：要先用伺服器指令換別人當管理員）。沒登入 401。
pub async fn request_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, me, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if me.is_admin {
        return Ok(StatusCode::CONFLICT.into_response());
    }
    let mut tx = state.db.begin().await?;
    // 改的時候再看一次是不是管理員：上面讀過以後才被換成管理員的也不停用
    let done = sqlx::query(
        "UPDATE users SET disabled_at = $1, delete_requested_at = $1
         WHERE id = $2 AND disabled_at IS NULL AND NOT is_admin",
    )
    .bind(state.clock.now())
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        let admin: Option<bool> = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
        let status = if admin == Some(true) {
            StatusCode::CONFLICT
        } else {
            StatusCode::UNAUTHORIZED
        };
        return Ok(status.into_response());
    }
    for sql in [
        "DELETE FROM sessions WHERE user_id = $1",
        "DELETE FROM password_links WHERE user_id = $1",
    ] {
        sqlx::query(sql).bind(user_id).execute(&mut *tx).await?;
    }
    let admins: Vec<String> = sqlx::query_scalar("SELECT email FROM users WHERE is_admin")
        .fetch_all(&mut *tx)
        .await?;
    let name = &me.name;
    let mut mails = vec![Mail {
        to: me.email.clone(),
        subject: "收到你要求刪除帳號：競技啦啦隊流程編輯器".into(),
        text: format!(
            "{name}，你好：\n\n收到你要求刪除競技啦啦隊流程編輯器的帳號。你的帳號已經停用，每台裝置都登出了，30 天內會刪好，刪好會再寄信告訴你。\n\n你擁有的流程會一起刪掉；在刪掉之前，有權限的人還能照常用。\n\n不想刪了，回這封信。\n"
        ),
    }];
    for to in admins {
        mails.push(Mail {
            to,
            subject: format!("{name}要求刪除帳號：競技啦啦隊流程編輯器"),
            text: format!(
                "{name}（{}）在帳號頁要求刪除帳號，他的帳號已經停用。\n\n請在 30 天內到「管理使用者」頁刪除；他回信說不想刪了，就按「恢復」。\n",
                me.email
            ),
        });
    }
    for mail in mails {
        match state.mailer.send(mail).await {
            Ok(()) => {}
            Err(MailError::OverQuota) => {
                return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
            }
            Err(err) => return Err(err.into()),
        }
    }
    tx.commit().await?;
    signed_out(&state, user_id);
    Ok((
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, cleared_cookie())],
    )
        .into_response())
}
