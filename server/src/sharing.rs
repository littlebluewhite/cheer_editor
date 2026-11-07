//! 分享給使用者、權限（#250，#234「權限、分享、移交」）。
//! 權限從多到少：擁有者、編輯者、記錄者、檢視者；一個人對一支流程只有一種。擁有者記在 flows 上，
//! 其他人在 flow_permissions。伺服器擋，不只畫面鎖。管理員沒有特權：沒分享給他的流程跟沒有一樣（404）。
//! 只有擁有者能分享、改權限、收回；不是擁有者的能離開。改權限、收回、離開都馬上告訴那個人開著的房間。
//! 移交、刪流程（#252）：只有擁有者；移交給名單上沒被停用的人，原擁有者變編輯者。刪了告訴開著的每個人。

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::AppState;
use crate::accounts::{AppError, SignedIn, signed_in};
use crate::flow_room::RoomEvent;

/// 不能做的人（記錄者、檢視者送來的步，檢視者送來的紀錄）的原因。
pub const VIEW_ONLY: &str = "你只能看這支流程";

/// 一個人對一支流程的權限。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Role {
    Owner,
    Editor,
    Recorder,
    Viewer,
}

impl Role {
    fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Editor => "editor",
            Self::Recorder => "recorder",
            Self::Viewer => "viewer",
        }
    }

    pub(crate) fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "owner" => Self::Owner,
            "editor" => Self::Editor,
            "recorder" => Self::Recorder,
            "viewer" => Self::Viewer,
            _ => return None,
        })
    }

    /// 能改流程（擁有者、編輯者）。
    pub fn can_edit(self) -> bool {
        matches!(self, Self::Owner | Self::Editor)
    }

    /// 能記成功率（擁有者、編輯者、記錄者；檢視者只能看總表）。
    pub fn can_record(self) -> bool {
        !matches!(self, Self::Viewer)
    }
}

/// 這個人對這支流程的權限；沒有權限、沒有這支流程都是 None。
pub async fn role_of<'e>(
    db: impl sqlx::PgExecutor<'e>,
    flow_id: &str,
    user_id: i64,
) -> anyhow::Result<Option<Role>> {
    let found: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT CASE WHEN f.owner_id = $2 THEN 'owner' ELSE p.role END
         FROM flows f LEFT JOIN flow_permissions p ON p.flow_id = f.id AND p.user_id = $2
         WHERE f.id = $1",
    )
    .bind(flow_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    Ok(found.and_then(|(role,)| role).and_then(|r| Role::parse(&r)))
}

/// 這支流程被擁有者刪了，刪的時候這個人有權限（#252）：打開、連房間說「被刪了」（410），不說被收回。
pub async fn deleted_for<'e>(
    db: impl sqlx::PgExecutor<'e>,
    flow_id: &str,
    user_id: i64,
) -> anyhow::Result<bool> {
    let (deleted,): (bool,) = sqlx::query_as(
        "SELECT EXISTS (SELECT 1 FROM deleted_flows WHERE flow_id = $1 AND user_id = $2)",
    )
    .bind(flow_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;
    Ok(deleted)
}

/// 沒權限時回的：被刪了（刪的時候有權限）410，不然跟沒有這支一樣 404。
pub async fn no_access<'e>(
    db: impl sqlx::PgExecutor<'e>,
    flow_id: &str,
    user_id: i64,
) -> anyhow::Result<StatusCode> {
    Ok(if deleted_for(db, flow_id, user_id).await? {
        StatusCode::GONE
    } else {
        StatusCode::NOT_FOUND
    })
}

// ---------- 前後端共用的訊息 ----------

/// 分享對話框「有權限的人」的一列。擁有者在最前面，其他人照加進來的順序。
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Person {
    #[ts(type = "number")]
    pub user_id: i64,
    pub name: String,
    /// 只有擁有者看得到別人的 email。
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub email: Option<String>,
    pub role: Role,
    /// 是不是看名單的人自己（名字加「（你）」）。
    pub me: bool,
    /// 被停用了（名單上寫「已停用」）。
    pub disabled: bool,
}

/// 擁有者分享：對方的 email、權限（編輯者、記錄者、檢視者）。
#[derive(Deserialize, TS)]
#[ts(export)]
pub struct ShareRequest {
    pub email: String,
    pub role: Role,
}

/// 擁有者改一個人的權限。
#[derive(Deserialize, TS)]
#[ts(export)]
pub struct RoleRequest {
    pub role: Role,
}

/// 分享不成的原因（409 的內容）。
#[derive(Serialize, TS, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ShareProblem {
    /// 這個 email 還沒有帳號，請管理員先加。
    NoAccount,
    /// 這是你自己。
    Yourself,
    /// 他已經在名單上了（要改在下面改）。
    Already { name: String, role: Role },
    /// 他的帳號被停用了，不能分享給他。
    Disabled { name: String },
}

// ---------- API ----------

/// 叫的人、他對這支流程的權限。沒登入回 401，沒權限、沒有這支回 404；only_owner 時不是擁有者回 403。
async fn caller(
    state: &AppState,
    headers: &HeaderMap,
    flow_id: &str,
    only_owner: bool,
) -> Result<Result<(i64, Role), Response>, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(state, headers).await? else {
        return Ok(Err(StatusCode::UNAUTHORIZED.into_response()));
    };
    let Some(role) = role_of(&state.db, flow_id, user_id).await? else {
        return Ok(Err(StatusCode::NOT_FOUND.into_response()));
    };
    if only_owner && role != Role::Owner {
        return Ok(Err(StatusCode::FORBIDDEN.into_response()));
    }
    Ok(Ok((user_id, role)))
}

/// 有權限的人：誰都看得到名字、權限；只有擁有者看得到 email。
pub async fn people(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let (me, role) = match caller(&state, &headers, &id, false).await? {
        Ok(c) => c,
        Err(res) => return Ok(res),
    };
    Ok(Json(list(&state, &id, me, role == Role::Owner).await?).into_response())
}

async fn list(
    state: &AppState,
    flow_id: &str,
    me: i64,
    with_email: bool,
) -> anyhow::Result<Vec<Person>> {
    let rows: Vec<(i64, String, String, String, bool)> = sqlx::query_as(
        "SELECT u.id, u.name, u.email, 'owner', u.disabled_at IS NOT NULL
         FROM flows f JOIN users u ON u.id = f.owner_id WHERE f.id = $1
         UNION ALL
         (SELECT u.id, u.name, u.email, p.role, u.disabled_at IS NOT NULL
          FROM flow_permissions p JOIN users u ON u.id = p.user_id WHERE p.flow_id = $1
          ORDER BY p.added_at, u.id)",
    )
    .bind(flow_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(user_id, name, email, role, disabled)| Person {
            user_id,
            name,
            email: with_email.then_some(email),
            role: Role::parse(&role).unwrap_or(Role::Viewer),
            me: user_id == me,
            disabled,
        })
        .collect())
}

/// 分享：擁有者輸入 email。沒帳號、自己、已經在名單、被停用都說原因（409）。不寄通知信。回新的名單。
pub async fn share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<ShareRequest>,
) -> Result<Response, AppError> {
    let me = match caller(&state, &headers, &id, true).await? {
        Ok((me, _)) => me,
        Err(res) => return Ok(res),
    };
    if req.role == Role::Owner {
        return Ok(StatusCode::UNPROCESSABLE_ENTITY.into_response());
    }
    let found: Option<(i64, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT u.id, u.name, u.disabled_at IS NOT NULL, p.role FROM users u
         LEFT JOIN flow_permissions p ON p.user_id = u.id AND p.flow_id = $2
         WHERE lower(u.email) = lower($1)",
    )
    .bind(req.email.trim())
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;
    let problem = match found {
        None => ShareProblem::NoAccount,
        Some((user, ..)) if user == me => ShareProblem::Yourself,
        Some((_, name, _, Some(role))) => ShareProblem::Already {
            name,
            role: Role::parse(&role).unwrap_or(Role::Viewer),
        },
        Some((_, name, true, None)) => ShareProblem::Disabled { name },
        Some((user, _, false, None)) => return added(&state, &id, me, user, req.role).await,
    };
    Ok((StatusCode::CONFLICT, Json(problem)).into_response())
}

/// 加進名單，回新的名單。
async fn added(
    state: &AppState,
    id: &str,
    me: i64,
    user: i64,
    role: Role,
) -> Result<Response, AppError> {
    sqlx::query(
        "INSERT INTO flow_permissions (flow_id, user_id, role, added_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(user)
    .bind(role.as_str())
    .bind(state.clock.now())
    .execute(&state.db)
    .await?;
    Ok(Json(list(state, id, me, true).await?).into_response())
}

/// 改權限：只有擁有者；名單上沒有這個人（擁有者自己也不算）回 404。告訴他開著的房間。回新的名單。
pub async fn set_role(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, user)): Path<(String, i64)>,
    Json(req): Json<RoleRequest>,
) -> Result<Response, AppError> {
    let me = match caller(&state, &headers, &id, true).await? {
        Ok((me, _)) => me,
        Err(res) => return Ok(res),
    };
    if req.role == Role::Owner {
        return Ok(StatusCode::UNPROCESSABLE_ENTITY.into_response());
    }
    let done =
        sqlx::query("UPDATE flow_permissions SET role = $3 WHERE flow_id = $1 AND user_id = $2")
            .bind(&id)
            .bind(user)
            .bind(req.role.as_str())
            .execute(&state.db)
            .await?;
    if done.rows_affected() == 0 {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    state.rooms.tell(
        &id,
        RoomEvent::Permission {
            user_id: user,
            role: Some(req.role),
        },
    );
    Ok(Json(list(&state, &id, me, true).await?).into_response())
}

/// 收回：只有擁有者，不用確認。他下一次跟伺服器說話就擋；開著的房間馬上知道。回新的名單。
pub async fn revoke(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, user)): Path<(String, i64)>,
) -> Result<Response, AppError> {
    let me = match caller(&state, &headers, &id, true).await? {
        Ok((me, _)) => me,
        Err(res) => return Ok(res),
    };
    if !remove(&state, &id, user).await? {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    Ok(Json(list(&state, &id, me, true).await?).into_response())
}

/// 離開這支流程：不是擁有者的才能（擁有者 403）。他別的分頁開著的房間也知道。
pub async fn leave(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let (me, role) = match caller(&state, &headers, &id, false).await? {
        Ok(c) => c,
        Err(res) => return Ok(res),
    };
    if role == Role::Owner {
        return Ok(StatusCode::FORBIDDEN.into_response());
    }
    remove(&state, &id, me).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 移交（#252）：擁有者把流程交給名單上的一個人（哪一級都行）。對方不用接受、不寄信；原擁有者變編輯者。
/// 名單上沒有他 404；他被停用了 409（`disabled`）。告訴兩個人開著的房間。回新的名單（叫的人已經不是擁有者，沒有 email）。
pub async fn hand_over(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, user)): Path<(String, i64)>,
) -> Result<Response, AppError> {
    let me = match caller(&state, &headers, &id, true).await? {
        Ok((me, _)) => me,
        Err(res) => return Ok(res),
    };
    let found: Option<(String, bool)> = sqlx::query_as(
        "SELECT u.name, u.disabled_at IS NOT NULL
         FROM flow_permissions p JOIN users u ON u.id = p.user_id
         WHERE p.flow_id = $1 AND p.user_id = $2",
    )
    .bind(&id)
    .bind(user)
    .fetch_optional(&state.db)
    .await?;
    match found {
        None => return Ok(StatusCode::NOT_FOUND.into_response()),
        Some((name, true)) => {
            let problem = ShareProblem::Disabled { name };
            return Ok((StatusCode::CONFLICT, Json(problem)).into_response());
        }
        Some(_) => {}
    }
    let mut tx = state.db.begin().await?;
    let moved = hand_over_flows(&mut tx, me, user, Some(&id), state.clock.now()).await?;
    tx.commit().await?;
    tell_new_owner(&state, &moved, me, user);
    Ok(Json(list(&state, &id, me, false).await?).into_response())
}

/// 把 from 擁有的流程交給 to（only：只交這一支；None 是全部）：to 是擁有者（他原本的權限拿掉），
/// from 變編輯者。回交出去的流程 id。不查誰能做，叫的人查。
pub(crate) async fn hand_over_flows(
    tx: &mut sqlx::PgConnection,
    from: i64,
    to: i64,
    only: Option<&str>,
    now: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<Vec<String>> {
    let moved: Vec<(String,)> = sqlx::query_as(
        "UPDATE flows SET owner_id = $2 WHERE owner_id = $1 AND ($3::text IS NULL OR id = $3)
         RETURNING id",
    )
    .bind(from)
    .bind(to)
    .bind(only)
    .fetch_all(&mut *tx)
    .await?;
    let moved: Vec<String> = moved.into_iter().map(|(id,)| id).collect();
    sqlx::query("DELETE FROM flow_permissions WHERE user_id = $1 AND flow_id = ANY($2)")
        .bind(to)
        .bind(&moved)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO flow_permissions (flow_id, user_id, role, added_at)
         SELECT id, $1, 'editor', $3 FROM unnest($2::text[]) AS id",
    )
    .bind(from)
    .bind(&moved)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    Ok(moved)
}

/// 移交後告訴開著的房間：新擁有者、原擁有者（變編輯者）。
pub(crate) fn tell_new_owner(state: &AppState, flows: &[String], from: i64, to: i64) {
    for id in flows {
        for (user_id, role) in [(to, Role::Owner), (from, Role::Editor)] {
            let event = RoomEvent::Permission {
                user_id,
                role: Some(role),
            };
            state.rooms.tell(id, event);
        }
    }
}

/// 刪流程（#252）：只有擁有者。所有人都打不開，步驟紀錄、權限跟著刪（外鍵 ON DELETE CASCADE）；
/// 音樂記下哪天不用了（30 天後真的刪在 #266）。開著的房間都說被刪了。
/// 刪的時候有權限的人記在 deleted_flows：之後打開說「被刪了」，不說被收回。
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    if let Err(res) = caller(&state, &headers, &id, true).await? {
        return Ok(res);
    }
    let mut tx = state.db.begin().await?;
    // 鎖住這一列：正在收的步先收完（房間收步也鎖這一列）。
    sqlx::query("SELECT 1 FROM flows WHERE id = $1 FOR UPDATE")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE flow_audio SET unused_since = COALESCE(unused_since, $2) WHERE flow_id = $1",
    )
    .bind(&id)
    .bind(state.clock.now())
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO deleted_flows (flow_id, user_id, deleted_at)
         SELECT id, owner_id, $2 FROM flows WHERE id = $1
         UNION SELECT flow_id, user_id, $2 FROM flow_permissions WHERE flow_id = $1
         ON CONFLICT DO NOTHING",
    )
    .bind(&id)
    .bind(state.clock.now())
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM flows WHERE id = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    state.rooms.tell(&id, RoomEvent::Deleted);
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 把一個人從名單拿掉，告訴他開著的房間。名單上本來就沒有他回 false。
async fn remove(state: &AppState, flow_id: &str, user: i64) -> anyhow::Result<bool> {
    let done = sqlx::query("DELETE FROM flow_permissions WHERE flow_id = $1 AND user_id = $2")
        .bind(flow_id)
        .bind(user)
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Ok(false);
    }
    state.rooms.tell(
        flow_id,
        RoomEvent::Permission {
            user_id: user,
            role: None,
        },
    );
    Ok(true)
}
