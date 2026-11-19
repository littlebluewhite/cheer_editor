//! 帳號：第一個管理員（`create-admin`）、設密碼連結、設密碼、登入、登入狀態、登出（#244）。
//! 登入猜錯太多次的「鎖住」在 `lockout`；忘記密碼、我的帳號在 `my_account`（#246）。
//! 規矩照 #234「帳號」那段：token 和登入狀態的號碼只存 SHA-256；密碼用 Argon2id；30 天一定要重登。

use std::sync::LazyLock;

use anyhow::Context;
use argon2::Argon2;
use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

use crate::AppState;
use crate::lockout;
use crate::mail::Mail;

/// 密碼最少幾個字（看得到的字：一個中文字、一個空白、一個 emoji 都算一個）。
pub const MIN_PASSWORD_CHARS: usize = 15;
const INVITE_LIFETIME: Duration = Duration::hours(24);
const RESET_LIFETIME: Duration = Duration::hours(1);
/// 從登入那天算，30 天一定要重登；一直在用也不延長。
const SESSION_LIFETIME: Duration = Duration::days(30);
/// `__Host-`：瀏覽器強制 Secure、Path=/、沒有 Domain，只送回這台主機。
const SESSION_COOKIE: &str = "__Host-id";
/// 瀏覽器留 cookie 比登入狀態久（400 天是瀏覽器收的上限）：30 天到期後還帶得來，
/// 伺服器才說得出「登入超過 30 天了」，不是沒登入過。
const COOKIE_MAX_AGE: Duration = Duration::days(400);

// ---------- 前後端共用的訊息（ts-rs 產生 src/lib/api-types/ 底下的 .ts） ----------

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Me {
    pub email: String,
    pub name: String,
    pub is_admin: bool,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct LinkRequest {
    pub token: String,
}

/// 設密碼連結是哪一種：邀請（24 小時）或重設密碼（1 小時）。
#[derive(Serialize, Clone, Copy, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LinkPurpose {
    Invite,
    Reset,
}

impl LinkPurpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::Invite => "invite",
            Self::Reset => "reset",
        }
    }
}

/// 沒登入（`/api/me` 的 401）：`expired` 是帶來的登入狀態滿 30 天了（登入頁寫黃色那行）。
#[derive(Serialize, TS)]
#[ts(export)]
pub struct SignedOut {
    pub expired: bool,
}

/// 打開設密碼連結看到的：是誰的、哪一種。
#[derive(Serialize, TS)]
#[ts(export)]
pub struct LinkInfo {
    pub email: String,
    pub name: String,
    pub purpose: LinkPurpose,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct SetPasswordRequest {
    pub token: String,
    pub password: String,
}

/// 密碼不收的原因（422 的內容）。
#[derive(Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum PasswordProblem {
    /// 還差幾個字。
    TooShort { missing: u32 },
    /// 太常見，或在別的網站外洩過。
    Breached,
}

// ---------- 第一個管理員 ----------

/// `create-admin`：讓這個 email 的人當管理員（原本的管理員不再是），寄一封設密碼信。
/// 還沒有這個人就建一個（要給名字）；他還沒設密碼寄邀請，設過寄重設密碼。他之前沒用的連結作廢。
/// 管理員進不去、或要換人當管理員，也用這個。
pub async fn create_admin(state: &AppState, email: &str, name: Option<&str>) -> anyhow::Result<()> {
    let email = email.trim();
    anyhow::ensure!(email.contains('@'), "email 看不懂：{email}");
    let now = state.clock.now();
    let mut tx = state.db.begin().await?;
    let existing: Option<(i64, String, bool)> = sqlx::query_as(
        "SELECT id, name, password_hash IS NOT NULL FROM users WHERE lower(email) = lower($1)",
    )
    .bind(email)
    .fetch_optional(&mut *tx)
    .await?;
    let (user_id, name, has_password) = match existing {
        Some(found) => found,
        None => {
            let name = name
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .context("這個 email 還沒有帳號，要給名字（--name）")?;
            let (id,): (i64,) =
                sqlx::query_as("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id")
                    .bind(email)
                    .bind(name)
                    .fetch_one(&mut *tx)
                    .await?;
            (id, name.to_owned(), false)
        }
    };
    sqlx::query("UPDATE users SET is_admin = false WHERE is_admin AND id <> $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE users SET is_admin = true, disabled_at = NULL WHERE id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    let purpose = if has_password {
        LinkPurpose::Reset
    } else {
        LinkPurpose::Invite
    };
    let token = new_link(&mut tx, user_id, purpose, now).await?;
    tx.commit().await?;

    let (to,): (String,) = sqlx::query_as("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
    state
        .mailer
        .send(password_mail(&state.site_url, to, &name, purpose, &token))
        .await?;
    Ok(())
}

/// 換一條新的設密碼連結：這個人之前沒用的連結作廢。回 token（只在信裡，資料庫存雜湊）。
pub(crate) async fn new_link(
    tx: &mut sqlx::PgConnection,
    user_id: i64,
    purpose: LinkPurpose,
    now: DateTime<Utc>,
) -> anyhow::Result<String> {
    sqlx::query("DELETE FROM password_links WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    let lifetime = match purpose {
        LinkPurpose::Invite => INVITE_LIFETIME,
        LinkPurpose::Reset => RESET_LIFETIME,
    };
    let token = random_token()?;
    sqlx::query(
        "INSERT INTO password_links (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(sha256(&token))
    .bind(user_id)
    .bind(purpose.as_str())
    .bind(now + lifetime)
    .execute(&mut *tx)
    .await?;
    Ok(token)
}

pub(crate) fn password_mail(
    site_url: &str,
    to: String,
    name: &str,
    purpose: LinkPurpose,
    token: &str,
) -> Mail {
    let link = format!("{site_url}/set-password#{token}");
    let (subject, body) = match purpose {
        LinkPurpose::Invite => (
            "邀請你使用競技啦啦隊流程編輯器",
            "請點下面的連結設密碼，設好就能登入。連結 24 小時內有效，只能用一次。",
        ),
        LinkPurpose::Reset => (
            "設新密碼：競技啦啦隊流程編輯器",
            "請點下面的連結設新密碼。連結 1 小時內有效，只能用一次。設好後，你在其他裝置都會登出。",
        ),
    };
    Mail {
        to,
        subject: subject.into(),
        text: format!("{name}，你好：\n\n{body}\n\n{link}\n\n不是你要的信，不用理它。\n"),
    }
}

// ---------- API ----------

/// 打開設密碼連結：只看是誰、哪一種，不用掉（送出密碼才用掉）。不能用回 410。
pub async fn password_link(
    State(state): State<AppState>,
    Json(req): Json<LinkRequest>,
) -> Result<Response, AppError> {
    Ok(match live_link(&state, &req.token).await? {
        Some(link) => Json(LinkInfo {
            email: link.email,
            name: link.name,
            purpose: link.purpose,
        })
        .into_response(),
        None => StatusCode::GONE.into_response(),
    })
}

/// 設密碼：連結不能用回 410；密碼不收回 422（連結留著）；設好回 204，連結用掉，
/// 這個人每台裝置都登出。不自動登入。
pub async fn set_password(
    State(state): State<AppState>,
    Json(req): Json<SetPasswordRequest>,
) -> Result<Response, AppError> {
    let Some(link) = live_link(&state, &req.token).await? else {
        return Ok(StatusCode::GONE.into_response());
    };
    if let Some(problem) = password_problem(&state, &req.password).await {
        return Ok((StatusCode::UNPROCESSABLE_ENTITY, Json(problem)).into_response());
    }
    let hash = hash_password(req.password).await?;
    let mut tx = state.db.begin().await?;
    // 先鎖這個人那一列再動連結：寄設密碼信、改 email 都是這個順序，反過來會互等（deadlock）。
    sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE")
        .bind(link.user_id)
        .execute(&mut *tx)
        .await?;
    // 同時送兩次：只有刪到連結的那一次算數。
    let used = sqlx::query("DELETE FROM password_links WHERE token_hash = $1")
        .bind(sha256(&req.token))
        .execute(&mut *tx)
        .await?;
    if used.rows_affected() == 0 {
        return Ok(StatusCode::GONE.into_response());
    }
    sqlx::query("DELETE FROM password_links WHERE user_id = $1")
        .bind(link.user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(hash)
        .bind(link.user_id)
        .execute(&mut *tx)
        .await?;
    // 重設好了：鎖住解開
    lockout::clear(&mut *tx, &link.email).await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(link.user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    signed_out(&state, link.user_id);
    // 重設後寄通知信：帳號被別人用了，他也會知道。密碼已經設好，寄不出去只記在 log。
    if link.purpose == LinkPurpose::Reset {
        let mail = Mail {
            to: link.email,
            subject: "你的密碼改了：競技啦啦隊流程編輯器".into(),
            text: format!(
                "{}，你好：\n\n你的密碼剛剛重設了，你在其他裝置都登出了。\n\n不是你改的，請馬上找管理員。\n",
                link.name
            ),
        };
        if let Err(err) = state.mailer.send(mail).await {
            tracing::warn!(%err, "重設密碼的通知信寄不出去");
        }
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 登入：成功回 204 和新的登入狀態 cookie（帶來的舊號碼作廢）；email 不對、密碼不對、
/// 還沒設密碼、被停用都回一樣的 401，花的時間也差不多（都算一次雜湊）。
/// 猜錯太多次回 429 和要等幾秒（`lockout`），有沒有這個帳號都一樣。
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Response, AppError> {
    let now = state.clock.now();
    if let Some(wait) = lockout::check(&state.db, &req.email, now).await? {
        return Ok((StatusCode::TOO_MANY_REQUESTS, Json(wait)).into_response());
    }
    let user: Option<(i64, Option<String>, bool)> = sqlx::query_as(
        "SELECT id, password_hash, disabled_at IS NOT NULL FROM users WHERE lower(email) = lower($1)",
    )
    .bind(req.email.trim())
    .fetch_optional(&state.db)
    .await?;
    let (user_id, hash, disabled) = match user {
        Some((id, Some(hash), disabled)) => (Some(id), hash, disabled),
        _ => (None, DUMMY_HASH.clone(), true),
    };
    let ok = verify_password(req.password, hash).await?;
    if !ok {
        lockout::failed(&state.db, &req.email, now).await?;
    }
    let (Some(user_id), true, false) = (user_id, ok, disabled) else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    lockout::clear(&state.db, &req.email).await?;

    if let Some(old) = session_token(&headers) {
        sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
            .bind(sha256(&old))
            .execute(&state.db)
            .await?;
    }
    let token = random_token()?;
    sqlx::query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)")
        .bind(sha256(&token))
        .bind(user_id)
        .bind(now)
        .bind(now + SESSION_LIFETIME)
        .execute(&state.db)
        .await?;
    // Max-Age 只是讓瀏覽器關掉後還留著；到期與否是伺服器照 sessions.expires_at 算。
    let cookie = format!(
        "{SESSION_COOKIE}={token}; Max-Age={}; Path=/; Secure; HttpOnly; SameSite=Lax",
        COOKIE_MAX_AGE.num_seconds()
    );
    Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response())
}

/// 我是誰：沒登入、登入狀態到期或被刪了回 401（`SignedOut`：是不是滿 30 天到期的）。
pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    if let Some(me) = current_user(&state, &headers).await? {
        return Ok(Json(me).into_response());
    }
    let expired = match session_token(&headers) {
        Some(token) => {
            sqlx::query("SELECT 1 FROM sessions WHERE token_hash = $1 AND expires_at <= $2")
                .bind(sha256(&token))
                .bind(state.clock.now())
                .fetch_optional(&state.db)
                .await?
                .is_some()
        }
        None => false,
    };
    Ok((StatusCode::UNAUTHORIZED, Json(SignedOut { expired })).into_response())
}

/// 登出這台裝置：刪掉這個登入狀態，cookie 清掉。沒登入也回 204。
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Some(token) = session_token(&headers) {
        let gone: Option<(i64,)> =
            sqlx::query_as("DELETE FROM sessions WHERE token_hash = $1 RETURNING user_id")
                .bind(sha256(&token))
                .fetch_optional(&state.db)
                .await?;
        // 開著的房間（只看不改的也是）重查自己的登入狀態，這台的就關掉。
        if let Some((user_id,)) = gone {
            signed_out(&state, user_id);
        }
    }
    let cleared = format!("{SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax");
    Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, cleared)]).into_response())
}

/// 帶著的 cookie 是誰（還沒到期、沒被停用）。
pub async fn current_user(state: &AppState, headers: &HeaderMap) -> anyhow::Result<Option<Me>> {
    Ok(signed_in(state, headers).await?.map(|s| s.me))
}

/// 登入著的人：使用者 id、Me、這個登入狀態的號碼雜湊（改密碼留這台、房間重查用）、什麼時候到期（房間到時重查）。
pub struct SignedIn {
    pub user_id: i64,
    pub me: Me,
    pub token_hash: Vec<u8>,
    pub expires_at: DateTime<Utc>,
}

/// 帶著的 cookie 是誰（還沒到期、沒被停用）；沒登入是 None。
pub async fn signed_in(state: &AppState, headers: &HeaderMap) -> anyhow::Result<Option<SignedIn>> {
    let Some(token) = session_token(headers) else {
        return Ok(None);
    };
    session(state, sha256(&token)).await
}

/// 這個登入狀態（號碼雜湊）現在還算登入著嗎：還在（沒登出、沒因為改密碼或停用被刪）、沒到期、人沒被停用。
pub async fn session(state: &AppState, token_hash: Vec<u8>) -> anyhow::Result<Option<SignedIn>> {
    let found: Option<(i64, String, String, bool, DateTime<Utc>)> = sqlx::query_as(
        "SELECT u.id, u.email, u.name, u.is_admin, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.disabled_at IS NULL",
    )
    .bind(&token_hash)
    .bind(state.clock.now())
    .fetch_optional(&state.db)
    .await?;
    Ok(
        found.map(|(user_id, email, name, is_admin, expires_at)| SignedIn {
            user_id,
            me: Me {
                email,
                name,
                is_admin,
            },
            token_hash,
            expires_at,
        }),
    )
}

/// 這個人有登入狀態被刪了（被停用、改密碼、重設密碼）：他開著的房間重查，不算登入了就關掉。
pub(crate) fn signed_out(state: &AppState, user_id: i64) {
    state
        .rooms
        .tell_everywhere(crate::flow_room::RoomEvent::SignedOut { user_id });
}

// ---------- 小工具 ----------

struct LiveLink {
    user_id: i64,
    email: String,
    name: String,
    purpose: LinkPurpose,
}

/// 還能用的連結（沒到期、沒用過、沒作廢）。
async fn live_link(state: &AppState, token: &str) -> anyhow::Result<Option<LiveLink>> {
    let found: Option<(i64, String, String, String)> = sqlx::query_as(
        "SELECT u.id, u.email, u.name, l.purpose FROM password_links l JOIN users u ON u.id = l.user_id
         WHERE l.token_hash = $1 AND l.expires_at > $2",
    )
    .bind(sha256(token))
    .bind(state.clock.now())
    .fetch_optional(&state.db)
    .await?;
    Ok(found.map(|(user_id, email, name, purpose)| LiveLink {
        user_id,
        email,
        name,
        purpose: if purpose == "reset" {
            LinkPurpose::Reset
        } else {
            LinkPurpose::Invite
        },
    }))
}

/// 密碼收不收：至少 15 個看得到的字（空白、中文都算），不能是常見或外洩過的。沒有上限的規則（至少收 64 個字）。
pub(crate) async fn password_problem(state: &AppState, password: &str) -> Option<PasswordProblem> {
    let chars = password.graphemes(true).count();
    if chars < MIN_PASSWORD_CHARS {
        return Some(PasswordProblem::TooShort {
            missing: (MIN_PASSWORD_CHARS - chars) as u32,
        });
    }
    state
        .breach
        .is_breached(password)
        .await
        .then_some(PasswordProblem::Breached)
}

/// Argon2id（argon2 的預設就是 OWASP 最低：m=19456、t=2、p=1），鹽 128 bits，存 PHC 字串。
/// 先做 NFC：看起來一樣的字在不同裝置打出來，算出一樣的雜湊。算雜湊很吃 CPU，放到別的執行緒。
/// 同時最多算幾個 Argon2（一個約 19 MiB；機器只有 512 MB，一堆人同時登入不能把記憶體用光）。
static ARGON2_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

pub(crate) async fn hash_password(password: String) -> anyhow::Result<String> {
    // 名額跟著算的那條執行緒走：請求被取消了，Argon2 還在算，名額也還占著。
    let slot = ARGON2_SLOTS.acquire().await?;
    tokio::task::spawn_blocking(move || {
        let _slot = slot;
        let normalized: String = password.nfc().collect();
        Argon2::default()
            .hash_password(normalized.as_bytes())
            .map(|h| h.to_string())
            .map_err(|e| anyhow::anyhow!("算不出密碼雜湊：{e}"))
    })
    .await?
}

pub(crate) async fn verify_password(password: String, hash: String) -> anyhow::Result<bool> {
    let slot = ARGON2_SLOTS.acquire().await?;
    Ok(tokio::task::spawn_blocking(move || {
        let _slot = slot;
        let normalized: String = password.nfc().collect();
        PasswordHash::new(&hash).is_ok_and(|parsed| {
            Argon2::default()
                .verify_password(normalized.as_bytes(), &parsed)
                .is_ok()
        })
    })
    .await?)
}

/// 沒有這個人時拿來比的雜湊：照樣算一次，花的時間跟有這個人差不多。
static DUMMY_HASH: LazyLock<String> = LazyLock::new(|| {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("拿不到亂數");
    Argon2::default()
        .hash_password(&bytes)
        .expect("算不出密碼雜湊")
        .to_string()
});

/// 32 bytes 的安全亂數，網址能放的 base64。
fn random_token() -> anyhow::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("拿不到亂數：{e}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/// len 個字的亂數（小寫字母、數字）：雲端流程的 id（12 個字）、分享連結（32 個字）。
pub(crate) fn random_id(len: usize) -> anyhow::Result<String> {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut bytes = vec![0u8; len];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("拿不到亂數：{e}"))?;
    Ok(bytes
        .iter()
        .map(|b| CHARS[*b as usize % CHARS.len()] as char)
        .collect())
}

pub(crate) fn sha256(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub(crate) fn session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v: &HeaderValue| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|pair| {
            let (name, value) = pair.trim().split_once('=')?;
            (name == SESSION_COOKIE && !value.is_empty()).then(|| value.to_owned())
        })
}

/// 伺服器自己出錯：回 500，原因只記在 log。
pub struct AppError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for AppError {
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        tracing::error!(err = %self.0, "伺服器出錯");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    }
}
