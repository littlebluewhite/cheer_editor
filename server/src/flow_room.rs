//! 雲端流程的房間（WebSocket，#248）：一支流程一個，登入、有權限的人才能連（這時只有擁有者，權限在 #250）。
//! 連上先打招呼（指紋、分頁 id、上次看到第幾步）：指紋不一樣就說有新版、不收步。
//! 之後每一步：步驟 id、上次看到第幾步、一串指令（名字＋參數）。伺服器在現在的樣子上用流程核心照順序跑，
//! 被擋、要問（教練那邊沒問）就退回並帶原因和伺服器現在的樣子；收了就存起來、第幾步加 1（ADR 0007、0011）。
//! 步驟 id 收過：回原本的結果，不套兩次。別人的改動、改到同一個東西在 #253、#254。

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
    let mine: Option<(i64,)> =
        sqlx::query_as("SELECT step FROM flows WHERE id = $1 AND owner_id = $2")
            .bind(&id)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;
    if mine.is_none() {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(e) = serve(state, socket, id, user_id).await {
            tracing::error!(err = %e, "房間出錯");
        }
    }))
}

/// 一個連線：先打招呼，再一步一步收。對方斷線、流程不見了就結束。
async fn serve(
    state: AppState,
    mut socket: WebSocket,
    flow_id: String,
    user_id: i64,
) -> anyhow::Result<()> {
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
    let Some((step,)): Option<(i64,)> =
        sqlx::query_as("SELECT step FROM flows WHERE id = $1 AND owner_id = $2")
            .bind(&flow_id)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?
    else {
        return Ok(());
    };
    tell(&mut socket, &RoomMessage::Ready { step }).await?;

    while let Some(request) = next_request(&mut socket).await {
        let RoomRequest::Step {
            step_id, commands, ..
        } = request
        else {
            continue;
        };
        let Some(reply) = take_step(&state, &flow_id, user_id, &tab_id, step_id, commands).await?
        else {
            return Ok(());
        };
        tell(&mut socket, &reply).await?;
    }
    Ok(())
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

/// 收一步。同一支流程的步鎖著那一列一步一步來。流程不見了（或不是我的了）回 None。
async fn take_step(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    tab_id: &str,
    step_id: String,
    commands: serde_json::Value,
) -> anyhow::Result<Option<RoomMessage>> {
    let mut tx = state.db.begin().await?;
    let Some((content, step)): Option<(String, i64)> = sqlx::query_as(
        "SELECT content::text, step FROM flows WHERE id = $1 AND owner_id = $2 FOR UPDATE",
    )
    .bind(flow_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Ok(None);
    };

    // 收過的步驟 id（斷線重送）：回原本的結果。
    let taken: Option<(i64,)> =
        sqlx::query_as("SELECT step FROM flow_steps WHERE flow_id = $1 AND step_id = $2")
            .bind(flow_id)
            .bind(&step_id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((step,)) = taken {
        return Ok(Some(RoomMessage::Accepted { step_id, step }));
    }

    let rejected = |message: String, content: String| -> anyhow::Result<Option<RoomMessage>> {
        Ok(Some(RoomMessage::Rejected {
            step_id: step_id.clone(),
            message,
            flow: RawValue::from_string(content)?,
            step,
        }))
    };
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
    Ok(Some(RoomMessage::Accepted { step_id, step }))
}
