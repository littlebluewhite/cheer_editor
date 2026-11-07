//! 雲端流程的房間（WebSocket，#248）：一支流程一個，登入、有權限的人才能連（#250：每一級都能連，
//! 只有擁有者、編輯者送的步收；權限被改、被收回馬上告訴他）。
//! 連上先打招呼（指紋、分頁 id、上次看到第幾步、在編輯還是檢視）：指紋不一樣就說有新版、不收步。
//! 之後每一步：步驟 id、上次看到第幾步、一串指令（名字＋參數）。伺服器在現在的樣子上用流程核心照順序跑，
//! 被擋、要問（教練那邊沒問）就退回並帶原因和伺服器現在的樣子；收了就存起來、第幾步加 1（ADR 0007、0011）。
//! 步驟 id 收過：回原本的結果，不套兩次。
//! 收了的步（#253）：用流程核心比對前後，把改好之後的那些東西送給房間裡的其他連線（不轉送指令）；
//! 存好、送出去照第幾步的順序（同一支流程的步在這台伺服器上一個一個來）。
//! 誰開著（#253）：每個連線是誰、在編輯還是檢視；有人進來、離開、換模式就告訴每個連線（自己不列，同一個人只列一次）。
//! 流程被刪了（#252）每個連線都說，房間關掉。
//! 改到同一個東西（#254）：每一步記下改到哪些東西（流程核心的 stepKeys）。這一步改到的東西，在它上次看到之後
//! 被別的分頁（同一個人的別的分頁也算）改過就退回，寫最後改到的人；合起來被規則擋下也退回，寫上次看到之後最後改過的人。
//! 一步被退回，這個連線接著送的、上次看到的還在退回那一步之前的，也一起退回（還沒換成伺服器的樣子）。
//! 上次看到的那一步已經沒留（超過 30 天）：退回，換成伺服器的樣子。
//! 成功率紀錄（#257）也從這裡送：記一次、別人記的馬上告訴房間裡的人（見 records.rs）。
//! 斷線重連（#255）：打招呼帶上次看到第幾步，先照順序補上之後別的分頁收了的步（每一步存著改好之後的東西），
//! 再說可以送步；補不上（步驟紀錄沒留、之前的步沒存改好的東西）就給伺服器現在的樣子。
//! 漏聽了房間裡的事（落後超過 256 件）也照這樣從資料庫補。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
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
use crate::csrf::from_this_site;
use crate::flow_core::FINGERPRINT;
use crate::records::{self, CloudRecord, DroppedRecord, Stored};
use crate::sharing::{Role, role_of};

/// 不能改的人送來的步：退回的原因。
const VIEW_ONLY: &str = "沒存進去：你只能看這支流程";
/// 前一步被退回、還沒換成伺服器的樣子就送的步：退回的原因。
const AFTER_SENT_BACK: &str = "沒存進去：前一步沒存進去，這一步也不算";
/// 上次看到的那一步已經沒留（超過 30 天）：退回的原因。
const TOO_OLD: &str = "沒存進去：離你上次看到太久了，換成現在的樣子";

/// 房間裡的事（同一台伺服器上，一支流程開著的連線都收得到）。
#[derive(Clone, Debug)]
pub enum RoomEvent {
    /// 這個人的權限改了；None 是被收回（或離開）。
    Permission { user_id: i64, role: Option<Role> },
    /// 擁有者把這支流程刪了（#252）：每個人都要知道。
    Deleted,
    /// 收了一步：哪個連線送的、送的人的名字、收了之後第幾步、改好之後的東西（RemoteChange 的 JSON）。
    Changed {
        from: u64,
        by: String,
        step: i64,
        change: Arc<str>,
    },
    /// 在場名單變了：現在開著的每個連線。
    Present(Arc<Vec<Here>>),
    /// 有人記了幾次（收了的）：from 是送來的那個連線，user_id、name 是記的人。
    Recorded {
        from: u64,
        user_id: i64,
        name: String,
        records: Vec<Stored>,
    },
}

/// 開著這支流程的一個連線：誰、在編輯還是檢視。
#[derive(Clone, Debug)]
pub struct Here {
    conn: u64,
    user_id: i64,
    name: String,
    editing: bool,
}

/// 一支流程開著的房間。
struct Room {
    /// 發給這支流程每個連線的頻道。
    events: tokio::sync::broadcast::Sender<RoomEvent>,
    /// 收步一個一個來：存好、告訴別人照第幾步的順序。
    steps: Arc<tokio::sync::Mutex<()>>,
    /// 開著的連線，照進來的先後。
    here: Vec<Here>,
}

/// 開著的房間：流程 id → 那支流程的房間。
#[derive(Clone, Default)]
pub struct Rooms {
    rooms: Arc<Mutex<HashMap<String, Room>>>,
    /// 下一個連線的號碼。
    next_conn: Arc<AtomicU64>,
}

impl Rooms {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Room>> {
        self.rooms.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn listen(&self, flow_id: &str) -> tokio::sync::broadcast::Receiver<RoomEvent> {
        self.lock()
            .entry(flow_id.to_owned())
            .or_insert_with(|| Room {
                events: tokio::sync::broadcast::channel(256).0,
                steps: Default::default(),
                here: Vec::new(),
            })
            .events
            .subscribe()
    }

    /// 告訴這支流程開著的連線；沒人開著就算了。
    pub fn tell(&self, flow_id: &str, event: RoomEvent) {
        if let Some(room) = self.lock().get(flow_id) {
            let _ = room.events.send(event);
        }
    }

    /// 這支流程收步的鎖（連著的人才會叫，房間一定在）。
    fn steps(&self, flow_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.lock()
            .get(flow_id)
            .map(|room| room.steps.clone())
            .unwrap_or_default()
    }

    /// 改在場名單，再告訴每個連線。
    fn update_here(&self, flow_id: &str, change: impl FnOnce(&mut Vec<Here>)) {
        let mut rooms = self.lock();
        let Some(room) = rooms.get_mut(flow_id) else {
            return;
        };
        change(&mut room.here);
        let _ = room
            .events
            .send(RoomEvent::Present(Arc::new(room.here.clone())));
    }

    /// 現在的在場名單。
    fn here(&self, flow_id: &str) -> Vec<Here> {
        self.lock()
            .get(flow_id)
            .map(|room| room.here.clone())
            .unwrap_or_default()
    }

    /// 這個連線換成編輯或檢視。
    fn set_editing(&self, flow_id: &str, conn: u64, editing: bool) {
        self.update_here(flow_id, |here| {
            for h in here.iter_mut().filter(|h| h.conn == conn) {
                h.editing = editing;
            }
        });
    }

    /// 一個連線走了：從在場名單拿掉；沒人開著就拿掉這支的房間。
    fn leave(&self, flow_id: &str, conn: u64) {
        self.update_here(flow_id, |here| here.retain(|h| h.conn != conn));
        let mut rooms = self.lock();
        if rooms
            .get(flow_id)
            .is_some_and(|room| room.events.receiver_count() == 0)
        {
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
    /// 連上時第一句：流程核心那包的指紋、這個分頁的 id、上次看到第幾步、在編輯還是檢視。
    Hello {
        fingerprint: String,
        tab_id: String,
        /// 上次看到第幾步：之後別人的步先補給我（斷線重連，#255）。
        #[ts(type = "number")]
        seen: i64,
        /// 在編輯（不是檢視模式）：在場名單用。
        #[serde(default)]
        editing: bool,
    },
    /// 一步：步驟 id（亂數）、上次看到第幾步、一串指令（名字＋參數，教練的回答在 options）。
    Step {
        step_id: String,
        #[ts(type = "number")]
        seen: i64,
        #[ts(type = "unknown[]")]
        commands: serde_json::Value,
    },
    /// 換成編輯或檢視模式（在場名單用）。
    Mode { editing: bool },
    /// 記一次（分段練，或一個人記的全上的每一次）：流程核心的 StoredAttempt（動作 id、那一次，id 是手機發的）。
    Record {
        #[ts(type = "unknown[]")]
        attempts: serde_json::Value,
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
    /// 指紋對了，可以送步：現在第幾步。上次看到之後別人的步在這之前補完（Changed 或 Current）。
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
    /// 有 by（#254）：別人在我上次看到之後改過——by 是最後改到同一個東西的人（被規則擋下時是最後改過流程的人），
    /// message 是規則擋下的原因（改到同一個東西是空的），畫面寫成「王教練剛改了同一個地方，你的「…」沒改成」。
    Rejected {
        step_id: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        by: Option<String>,
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
    /// 擁有者把這支流程刪了（#252）：房間關掉，回首頁並說原因。
    Deleted,
    /// 別人的一步收了：收了之後第幾步、送的人的名字、改好之後的東西（RemoteChange，套在自己的畫面上）。
    Changed {
        #[ts(type = "number")]
        step: i64,
        by: String,
        #[ts(type = "unknown")]
        change: Box<RawValue>,
    },
    /// 斷線太久補不上（#255）：伺服器現在的樣子、現在第幾步（換上它，還沒送到的步不算）。
    Current {
        #[ts(type = "unknown")]
        flow: Box<RawValue>,
        #[ts(type = "number")]
        step: i64,
    },
    /// 現在誰開著（自己不列，同一個人只列一次），照進來的先後。
    Present { people: Vec<Present> },
    /// 我送的紀錄：收了的（伺服器存的樣子，記號可能少了）、沒存進去的和原因。
    /// 送過、後來被清掉的兩邊都不放。
    RecordsSaved {
        saved: Vec<CloudRecord>,
        dropped: Vec<DroppedRecord>,
    },
    /// 別人（或我在別的分頁）記的。
    NewRecords { records: Vec<CloudRecord> },
}

/// 在場名單的一個人：在編輯還是檢視（他有一個分頁在編輯就算在編輯）。
#[derive(Serialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Present {
    #[ts(type = "number")]
    pub user_id: i64,
    pub name: String,
    pub editing: bool,
}

/// 給 me 看的在場名單：自己不列，同一個人只列一次。
fn present_for(here: &[Here], me: i64) -> Vec<Present> {
    let mut people: Vec<Present> = Vec::new();
    for h in here.iter().filter(|h| h.user_id != me) {
        match people.iter_mut().find(|p| p.user_id == h.user_id) {
            Some(p) => p.editing |= h.editing,
            None => people.push(Present {
                user_id: h.user_id,
                name: h.name.clone(),
                editing: h.editing,
            }),
        }
    }
    people
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
        let conn = rooms.next_conn.fetch_add(1, Ordering::Relaxed);
        if let Err(e) = serve(state, socket, &id, user_id, conn).await {
            tracing::error!(err = %e, "房間出錯");
        }
        rooms.leave(&id, conn);
    }))
}

/// 一個連線：先打招呼，再一步一步收；權限被改、被收回馬上說；別人的改動、在場名單送過來。
/// 對方斷線、被收回就結束。
async fn serve(
    state: AppState,
    mut socket: WebSocket,
    flow_id: &str,
    user_id: i64,
    conn: u64,
) -> anyhow::Result<()> {
    // 打招呼前就開始聽：連上之後的權限改動不會漏掉。
    let mut events = state.rooms.listen(flow_id);
    let (tab_id, seen, editing) = loop {
        match next_request(&mut socket).await {
            Some(RoomRequest::Hello {
                fingerprint,
                tab_id,
                seen,
                editing,
            }) => {
                if fingerprint != FINGERPRINT {
                    tell(&mut socket, &RoomMessage::NewVersion).await?;
                    return Ok(());
                }
                break (tab_id, seen, editing);
            }
            Some(_) => continue,
            None => return Ok(()),
        }
    };
    let Some(mut role) = role_of(&state.db, flow_id, user_id).await? else {
        return tell(&mut socket, &RoomMessage::Revoked).await;
    };
    let (name,): (String,) = sqlx::query_as("SELECT name FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
    // 上次看到之後別人的步先補上，再說可以送步。之後房間裡的改動只送比這新的（補過的不再送）。
    let mut known = seen;
    for message in catch_up(&state, flow_id, &tab_id, &mut known).await? {
        tell(&mut socket, &message).await?;
    }
    tell(&mut socket, &RoomMessage::Ready { step: known }).await?;
    let here = Here {
        conn,
        user_id,
        name: name.clone(),
        editing: editing && role.can_edit(),
    };
    state.rooms.update_here(flow_id, |list| list.push(here));
    // 上一次被退回時伺服器在第幾步：上次看到的還在它之前的步，是還沒換成伺服器的樣子就送的。
    let mut sent_back: Option<i64> = None;

    loop {
        let reply = tokio::select! {
            request = next_request(&mut socket) => match request {
                None => return Ok(()),
                Some(RoomRequest::Step { step_id, seen, commands }) => {
                    // 存好、告訴別人都在鎖裡：別人收到的改動照第幾步的順序。
                    let steps = state.rooms.steps(flow_id);
                    let _one_at_a_time = steps.lock().await;
                    let sent = Sent { step_id, seen, commands, tab_id: &tab_id, sent_back };
                    let (reply, change) = take_step(&state, flow_id, user_id, sent).await?;
                    if let RoomMessage::Rejected { step, .. } = &reply {
                        sent_back = Some(*step);
                    }
                    if let (RoomMessage::Accepted { step, .. }, Some(change)) = (&reply, change) {
                        let event = RoomEvent::Changed {
                            from: conn,
                            by: name.clone(),
                            step: *step,
                            change: change.into(),
                        };
                        state.rooms.tell(flow_id, event);
                    }
                    reply
                }
                Some(RoomRequest::Record { attempts }) => {
                    records::record(&state, flow_id, user_id, conn, attempts).await?
                }
                Some(RoomRequest::Mode { editing }) => {
                    state.rooms.set_editing(flow_id, conn, editing && role.can_edit());
                    continue;
                }
                Some(RoomRequest::Hello { .. }) => continue,
            },
            event = events.recv() => match event {
                Ok(RoomEvent::Permission { user_id: who, role: changed }) if who == user_id => {
                    if let Some(r) = changed {
                        role = r;
                        if !r.can_edit() {
                            state.rooms.set_editing(flow_id, conn, false);
                        }
                    }
                    told_role(&state, flow_id, changed).await?
                }
                Ok(RoomEvent::Deleted) => RoomMessage::Deleted,
                Ok(RoomEvent::Changed { from, by, step, change }) if from != conn && step > known => {
                    known = step;
                    RoomMessage::Changed { step, by, change: RawValue::from_string(change.to_string())? }
                }
                Ok(RoomEvent::Present(here)) => RoomMessage::Present { people: present_for(&here, user_id) },
                Ok(RoomEvent::Recorded { from, user_id: by, name, records }) if from != conn => {
                    let records = records
                        .into_iter()
                        .map(|s| CloudRecord {
                            action_id: s.action_id,
                            attempt: s.attempt,
                            by: (by != user_id).then(|| name.clone()),
                        })
                        .collect();
                    RoomMessage::NewRecords { records }
                }
                Ok(_) => continue,
                // 漏聽了幾件：照資料庫補上漏掉的別人的步，重新看一次自己的權限，再說一次在場名單。
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let changed = role_of(&state.db, flow_id, user_id).await?;
                    let told = told_role(&state, flow_id, changed).await?;
                    if !matches!(told, RoomMessage::Revoked) {
                        for message in catch_up(&state, flow_id, &tab_id, &mut known).await? {
                            tell(&mut socket, &message).await?;
                        }
                        let people = present_for(&state.rooms.here(flow_id), user_id);
                        tell(&mut socket, &RoomMessage::Present { people }).await?;
                    }
                    told
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
            },
        };
        tell(&mut socket, &reply).await?;
        if matches!(reply, RoomMessage::Revoked | RoomMessage::Deleted) {
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

/// 從第 known 步補到現在：之後別的分頁收了的步（改好之後的東西，照順序；這個分頁自己送的不補），
/// known 換成現在第幾步。中間有一步沒留或沒存改好的東西：補不上，給伺服器現在的樣子。
async fn catch_up(
    state: &AppState,
    flow_id: &str,
    tab_id: &str,
    known: &mut i64,
) -> anyhow::Result<Vec<RoomMessage>> {
    let (content, step) = current(state, flow_id).await?;
    let since = std::mem::replace(known, step);
    if since >= step {
        return Ok(Vec::new());
    }
    let missed: Vec<(i64, String, Option<String>, String)> = sqlx::query_as(
        "SELECT s.step, s.tab_id, s.change::text, u.name FROM flow_steps s JOIN users u ON u.id = s.user_id
         WHERE s.flow_id = $1 AND s.step > $2 AND s.step <= $3 ORDER BY s.step",
    )
    .bind(flow_id)
    .bind(since)
    .bind(step)
    .fetch_all(&state.db)
    .await?;
    let whole = missed.len() as i64 == step - since && missed.iter().all(|m| m.2.is_some());
    if !whole {
        let flow = RawValue::from_string(content)?;
        return Ok(vec![RoomMessage::Current { flow, step }]);
    }
    missed
        .into_iter()
        .filter(|(_, tab, _, _)| tab != tab_id)
        .map(|(step, _, change, by)| {
            let change = RawValue::from_string(change.unwrap_or_default())?;
            Ok(RoomMessage::Changed { step, by, change })
        })
        .collect()
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

/// 送來的一步：步驟 id、上次看到第幾步、指令；哪個分頁送的、這個連線上次被退回時伺服器在第幾步。
struct Sent<'a> {
    step_id: String,
    seen: i64,
    commands: serde_json::Value,
    tab_id: &'a str,
    sent_back: Option<i64>,
}

/// 收一步。同一支流程的步鎖著那一列一步一步來。流程被刪了回 Deleted；先查權限：被收回回 Revoked，
/// 不能改的（記錄者、檢視者）退回。再看改到同一個東西（#254）。收了的連同要送給別人的改動（RemoteChange 的 JSON）一起回。
async fn take_step(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    sent: Sent<'_>,
) -> anyhow::Result<(RoomMessage, Option<String>)> {
    let Sent {
        step_id,
        seen,
        commands,
        tab_id,
        sent_back,
    } = sent;
    let mut tx = state.db.begin().await?;
    let Some((content, step)): Option<(String, i64)> =
        sqlx::query_as("SELECT content::text, step FROM flows WHERE id = $1 FOR UPDATE")
            .bind(flow_id)
            .fetch_optional(&mut *tx)
            .await?
    else {
        return Ok((RoomMessage::Deleted, None));
    };
    let Some(role) = role_of(&mut *tx, flow_id, user_id).await? else {
        return Ok((RoomMessage::Revoked, None));
    };

    // 收過的步驟 id（斷線重送）：回原本的結果。
    let taken: Option<(i64,)> =
        sqlx::query_as("SELECT step FROM flow_steps WHERE flow_id = $1 AND step_id = $2")
            .bind(flow_id)
            .bind(&step_id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((step,)) = taken {
        return Ok((RoomMessage::Accepted { step_id, step }, None));
    }

    let rejected = |message: String,
                    by: Option<String>,
                    content: String|
     -> anyhow::Result<(RoomMessage, Option<String>)> {
        let flow = RawValue::from_string(content)?;
        let step_id = step_id.clone();
        Ok((
            RoomMessage::Rejected {
                step_id,
                message,
                by,
                flow,
                step,
            },
            None,
        ))
    };
    if !role.can_edit() {
        return rejected(VIEW_ONLY.into(), None, content);
    }
    // 前一步被退回、還沒換成伺服器的樣子就送的：一起退回。
    if sent_back.is_some_and(|n| seen < n) {
        return rejected(AFTER_SENT_BACK.into(), None, content);
    }
    // 上次看到之後的步已經沒留（超過 30 天）：比不了，換成伺服器的樣子。
    if seen < step && !kept(&mut tx, flow_id, seen + 1).await? {
        return rejected(TOO_OLD.into(), None, content);
    }
    // 紀錄放回流程再跑（ADR 0008）：跑完照結果清掉、改掉該改的紀錄。
    let before = records::before_step(&mut tx, flow_id).await?;
    let Ok(result) = state
        .core
        .run_step(
            content.clone(),
            serde_json::to_string(&before)?,
            commands.to_string(),
            step_id.clone(),
        )
        .await
    else {
        // 流程核心看不懂（例：沒有這個指令、參數不對）。
        return rejected("沒存進去：伺服器看不懂這一步".into(), None, content);
    };
    let outcome: records::StepOutcome = serde_json::from_str(&result)?;
    let flow = match (outcome.kind.as_str(), outcome.flow) {
        ("ok", Some(flow)) => flow,
        // 被擋，或要問（確認、選）而教練那邊沒問：退回並帶原因。上次看到之後別人改過，寫最後改的人。
        (kind, _) => {
            let mut reason = outcome.message.unwrap_or_default();
            if kind != "blocked" {
                reason.push_str("，請再看一次");
            }
            return match last_other(&mut tx, flow_id, seen, tab_id, None).await? {
                Some(by) => rejected(reason, Some(by), content),
                None => rejected(format!("沒存進去：{reason}"), None, content),
            };
        }
    };
    // 這一步改到的東西，上次看到之後被別的分頁改過：退回，寫最後改到的人。
    if let Some(by) = last_other(&mut tx, flow_id, seen, tab_id, Some(&outcome.watch)).await? {
        return rejected(String::new(), Some(by), content);
    }

    // 要送給別人的：改好之後的那些東西（比對前後，不轉送指令）。
    let change = state
        .core
        .remote_change(content, flow.get().to_owned())
        .await?;
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
        "INSERT INTO flow_steps (flow_id, step, step_id, tab_id, user_id, created_at, keys, change)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::json)",
    )
    .bind(flow_id)
    .bind(step)
    .bind(&step_id)
    .bind(tab_id)
    .bind(user_id)
    .bind(now)
    .bind(&outcome.keys)
    .bind(&change)
    .execute(&mut *tx)
    .await?;
    records::after_step(
        &mut tx,
        flow_id,
        &before,
        outcome.records.unwrap_or_default(),
        now,
    )
    .await?;
    // 換掉、刪掉的音樂記下哪天不用了（#249）。
    crate::music::note_unused(&mut tx, flow_id, flow.get(), now).await?;
    tx.commit().await?;
    Ok((RoomMessage::Accepted { step_id, step }, Some(change)))
}

/// 第 n 步還留著（步驟紀錄留 30 天）。
async fn kept(tx: &mut sqlx::PgConnection, flow_id: &str, n: i64) -> anyhow::Result<bool> {
    let (kept,): (bool,) =
        sqlx::query_as("SELECT EXISTS (SELECT 1 FROM flow_steps WHERE flow_id = $1 AND step = $2)")
            .bind(flow_id)
            .bind(n)
            .fetch_one(tx)
            .await?;
    Ok(kept)
}

/// 上次看到（seen）之後，別的分頁送的步裡最後一步是誰送的（名字）。
/// 給了 watch：只看改到其中一個鍵的步（最後改到同一個東西的人）。
async fn last_other(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    seen: i64,
    tab_id: &str,
    watch: Option<&[String]>,
) -> anyhow::Result<Option<String>> {
    let name: Option<(String,)> = sqlx::query_as(
        "SELECT u.name FROM flow_steps s JOIN users u ON u.id = s.user_id
         WHERE s.flow_id = $1 AND s.step > $2 AND s.tab_id <> $3
           AND ($4::text[] IS NULL OR s.keys && $4)
         ORDER BY s.step DESC LIMIT 1",
    )
    .bind(flow_id)
    .bind(seen)
    .bind(tab_id)
    .bind(watch)
    .fetch_optional(tx)
    .await?;
    Ok(name.map(|(name,)| name))
}
