//! 雲端流程的房間（WebSocket，#248）：一支流程一個，登入、有權限的人才能連（#250：每一級都能連，
//! 只有擁有者、編輯者送的步收；權限被改、被收回馬上告訴他）。
//! 連上先打招呼（指紋、分頁 id、上次看到第幾步）：指紋不一樣就說有新版、不收步。
//! 之後每一步：步驟 id、上次看到第幾步、一串指令（名字＋參數）。伺服器在現在的樣子上用流程核心照順序跑，
//! 被擋、要問（教練那邊沒問）就退回並帶原因和伺服器現在的樣子；收了就存起來、第幾步加 1（ADR 0007、0011）。
//! 步驟 id 收過：回原本的結果，不套兩次。別人的改動、改到同一個東西在 #253、#254。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use ts_rs::TS;

use crate::AppState;
use crate::accounts::{AppError, signed_in};
use crate::cloud_flows::Outcome;
use crate::csrf::from_this_site;
use crate::flow_core::FINGERPRINT;
use crate::sharing::{Role, role_of};

/// 不能改的人送來的步：退回的原因。
const VIEW_ONLY: &str = "沒存進去：你只能看這支流程";

/// 房間裡的事（同一台伺服器上，一支流程開著的連線都收得到）。
#[derive(Clone, Debug)]
pub enum RoomEvent {
    /// 這個人的權限改了；None 是被收回（或離開）。
    Permission { user_id: i64, role: Option<Role> },
}

/// 開著的房間：流程 id → 發給那支流程每個連線的頻道。
#[derive(Clone, Default)]
pub struct Rooms(Arc<Mutex<HashMap<String, tokio::sync::broadcast::Sender<RoomEvent>>>>);

impl Rooms {
    fn listen(&self, flow_id: &str) -> tokio::sync::broadcast::Receiver<RoomEvent> {
        let mut rooms = self.0.lock().unwrap_or_else(|e| e.into_inner());
        rooms
            .entry(flow_id.to_owned())
            .or_insert_with(|| tokio::sync::broadcast::channel(64).0)
            .subscribe()
    }

    /// 告訴這支流程開著的連線；沒人開著就算了。
    pub fn tell(&self, flow_id: &str, event: RoomEvent) {
        let rooms = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sender) = rooms.get(flow_id) {
            let _ = sender.send(event);
        }
    }

    /// 一個連線走了：沒人開著就拿掉這支的頻道。
    fn forget(&self, flow_id: &str) {
        let mut rooms = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if rooms.get(flow_id).is_some_and(|s| s.receiver_count() == 0) {
            rooms.remove(flow_id);
        }
    }
}

/// 用戶端送進房間的。
#[derive(Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum RoomRequest {
    /// 連上時第一句：流程核心那包的指紋、這個分頁的 id、上次看到第幾步。
    Hello {
        fingerprint: String,
        tab_id: String,
        /// 上次看到第幾步（改到同一個東西時用，#254）。
        #[ts(type = "number")]
        #[allow(dead_code)]
        seen: i64,
    },
    /// 一步：步驟 id（亂數）、上次看到第幾步、一串指令（名字＋參數，教練的回答在 options）。
    Step {
        step_id: String,
        #[ts(type = "number")]
        #[allow(dead_code)]
        seen: i64,
        #[ts(type = "unknown[]")]
        commands: serde_json::Value,
    },
}

/// 伺服器送給用戶端的。
#[derive(Serialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum RoomMessage {
    /// 指紋對了，可以送步：現在第幾步。
    Ready {
        #[ts(type = "number")]
        step: i64,
    },
    /// 指紋不一樣：有新版，請重新整理；不收步。
    NewVersion,
    /// 這一步收了：收了之後是第幾步。
    Accepted {
        step_id: String,
        #[ts(type = "number")]
        step: i64,
    },
    /// 這一步退回：原因、伺服器現在的樣子（換上它）、現在第幾步。
    Rejected {
        step_id: String,
        message: String,
        #[ts(type = "unknown")]
        flow: Box<RawValue>,
        #[ts(type = "number")]
        step: i64,
    },
    /// 我的權限被擁有者改了：新的權限、伺服器現在的樣子、現在第幾步（降成記錄者、檢視者：還沒送到的步不算）。
    RoleChanged {
        role: Role,
        #[ts(type = "unknown")]
        flow: Box<RawValue>,
        #[ts(type = "number")]
        step: i64,
    },
    /// 我被收回了（或離開了）：房間關掉，回首頁。
    Revoked,
}

/// 連房間：別的網站叫的擋（403）、沒登入 401、不是我的或沒有這支 404。
pub async fn join(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    // 瀏覽器連 WebSocket 會帶 cookie，別的網站也叫得動：跟改資料的請求一樣只收這個網站的。
    if !from_this_site(&headers) {
        return Ok(StatusCode::FORBIDDEN.into_response());
    }
    let Some((user_id, _)) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if role_of(&state.db, &id, user_id).await?.is_none() {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    Ok(ws.on_upgrade(move |socket| async move {
        let rooms = state.rooms.clone();
        if let Err(e) = serve(state, socket, &id, user_id).await {
            tracing::error!(err = %e, "房間出錯");
        }
        rooms.forget(&id);
    }))
}

/// 一個連線：先打招呼，再一步一步收；權限被改、被收回馬上說。對方斷線、被收回就結束。
async fn serve(
    state: AppState,
    mut socket: WebSocket,
    flow_id: &str,
    user_id: i64,
) -> anyhow::Result<()> {
    // 打招呼前就開始聽：連上之後的權限改動不會漏掉。
    let mut events = state.rooms.listen(flow_id);
    let tab_id = loop {
        match next_request(&mut socket).await {
            Some(RoomRequest::Hello {
                fingerprint,
                tab_id,
                ..
            }) => {
                if fingerprint != FINGERPRINT {
                    tell(&mut socket, &RoomMessage::NewVersion).await?;
                    return Ok(());
                }
                break tab_id;
            }
            Some(_) => continue,
            None => return Ok(()),
        }
    };
    if role_of(&state.db, flow_id, user_id).await?.is_none() {
        return tell(&mut socket, &RoomMessage::Revoked).await;
    }
    let (_, step) = current(&state, flow_id).await?;
    tell(&mut socket, &RoomMessage::Ready { step }).await?;

    loop {
        let reply = tokio::select! {
            request = next_request(&mut socket) => match request {
                None => return Ok(()),
                Some(RoomRequest::Step { step_id, commands, .. }) => {
                    take_step(&state, flow_id, user_id, &tab_id, step_id, commands).await?
                }
                Some(_) => continue,
            },
            event = events.recv() => match event {
                Ok(RoomEvent::Permission { user_id: who, role }) if who == user_id => {
                    told_role(&state, flow_id, role).await?
                }
                Ok(_) => continue,
                // 漏聽了幾件：照資料庫重新看一次自己的權限。
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let role = role_of(&state.db, flow_id, user_id).await?;
                    told_role(&state, flow_id, role).await?
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
            },
        };
        tell(&mut socket, &reply).await?;
        if matches!(reply, RoomMessage::Revoked) {
            return Ok(());
        }
    }
}

/// 權限改了要說的：被收回，或新的權限帶著伺服器現在的樣子。
async fn told_role(
    state: &AppState,
    flow_id: &str,
    role: Option<Role>,
) -> anyhow::Result<RoomMessage> {
    let Some(role) = role else {
        return Ok(RoomMessage::Revoked);
    };
    let (content, step) = current(state, flow_id).await?;
    Ok(RoomMessage::RoleChanged {
        role,
        flow: RawValue::from_string(content)?,
        step,
    })
}

/// 這支流程現在的樣子、第幾步。
async fn current(state: &AppState, flow_id: &str) -> anyhow::Result<(String, i64)> {
    Ok(
        sqlx::query_as("SELECT content::text, step FROM flows WHERE id = $1")
            .bind(flow_id)
            .fetch_one(&state.db)
            .await?,
    )
}

/// 下一句讀得懂的話；對方斷線是 None。讀不懂的跳過。
async fn next_request(socket: &mut WebSocket) -> Option<RoomRequest> {
    loop {
        match socket.recv().await? {
            Ok(Message::Text(text)) => {
                if let Ok(request) = serde_json::from_str(&text) {
                    return Some(request);
                }
            }
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

async fn tell(socket: &mut WebSocket, message: &RoomMessage) -> anyhow::Result<()> {
    let text = serde_json::to_string(message)?;
    socket.send(Message::Text(text.into())).await?;
    Ok(())
}

/// 收一步。同一支流程的步鎖著那一列一步一步來。先查權限：被收回（或流程不見了）回 Revoked，
/// 不能改的（記錄者、檢視者）退回。
async fn take_step(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    tab_id: &str,
    step_id: String,
    commands: serde_json::Value,
) -> anyhow::Result<RoomMessage> {
    let mut tx = state.db.begin().await?;
    let Some((content, step)): Option<(String, i64)> =
        sqlx::query_as("SELECT content::text, step FROM flows WHERE id = $1 FOR UPDATE")
            .bind(flow_id)
            .fetch_optional(&mut *tx)
            .await?
    else {
        return Ok(RoomMessage::Revoked);
    };
    let Some(role) = role_of(&mut *tx, flow_id, user_id).await? else {
        return Ok(RoomMessage::Revoked);
    };

    // 收過的步驟 id（斷線重送）：回原本的結果。
    let taken: Option<(i64,)> =
        sqlx::query_as("SELECT step FROM flow_steps WHERE flow_id = $1 AND step_id = $2")
            .bind(flow_id)
            .bind(&step_id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((step,)) = taken {
        return Ok(RoomMessage::Accepted { step_id, step });
    }

    let rejected = |message: String, content: String| -> anyhow::Result<RoomMessage> {
        Ok(RoomMessage::Rejected {
            step_id: step_id.clone(),
            message,
            flow: RawValue::from_string(content)?,
            step,
        })
    };
    if !role.can_edit() {
        return rejected(VIEW_ONLY.into(), content);
    }
    let Ok(result) = state
        .core
        .run_commands(content.clone(), commands.to_string(), step_id.clone())
        .await
    else {
        // 流程核心看不懂（例：沒有這個指令、參數不對）。
        return rejected("沒存進去：伺服器看不懂這一步".into(), content);
    };
    let outcome: Outcome = serde_json::from_str(&result)?;
    let flow = match (outcome.kind.as_str(), outcome.flow) {
        ("ok", Some(flow)) => flow,
        // 被擋，或要問（確認、選）而教練那邊沒問：退回並帶原因。
        _ => {
            let reason = outcome.message.unwrap_or_default();
            return rejected(format!("沒存進去：{reason}"), content);
        }
    };

    let now = state.clock.now();
    let step = step + 1;
    sqlx::query("UPDATE flows SET content = $2::json, step = $3, updated_at = $4 WHERE id = $1")
        .bind(flow_id)
        .bind(flow.get())
        .bind(step)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO flow_steps (flow_id, step, step_id, tab_id, user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(flow_id)
    .bind(step)
    .bind(&step_id)
    .bind(tab_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    // 換掉、刪掉的音樂記下哪天不用了（#249）。
    crate::music::note_unused(&mut tx, flow_id, flow.get(), now).await?;
    tx.commit().await?;
    Ok(RoomMessage::Accepted { step_id, step })
}
