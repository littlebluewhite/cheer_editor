//! 雲端流程的房間（WebSocket，#248）：一支流程一個，登入、有權限的人才能連（#250：每一級都能連，
//! 只有擁有者、編輯者送的步收；權限被改、被收回馬上告訴他）。
//! 連上先打招呼（指紋、分頁 id、上次看到第幾步、在編輯還是檢視）：指紋不一樣就說有新版、不收步。
//! 之後每一步：步驟 id、上次看到第幾步、一串指令（名字＋參數）。伺服器在現在的樣子上用流程核心照順序跑，
//! 被擋、要問（教練那邊沒問）就退回並帶原因和伺服器現在的樣子；收了就存起來、第幾步加 1（ADR 0010、0014）。
//! 步驟 id 收過：回原本的結果，不套兩次。
//! 收了的步（#253）：用流程核心比對前後，把改好之後的那些東西送給房間裡的其他連線（不轉送指令）；
//! 存好、送出去照第幾步的順序（同一支流程的步在這台伺服器上一個一個來）。
//! 誰開著（#253）：每個連線是誰、在編輯還是檢視；有人進來、離開、換模式就告訴每個連線（自己不列，同一個人只列一次）。
//! 流程被刪了（#252）每個連線都說，房間關掉。
//! 改到同一個東西（#254）：每一步記下改到哪些東西（流程核心的 stepKeys）。這一步改到的東西，在它上次看到之後
//! 被別的分頁（同一個人的別的分頁也算）改過就退回，寫最後改到的人；合起來被規則擋下也退回，寫上次看到之後最後改過的人。
//! 一步被退回，這個連線接著送的、上次看到的還在退回那一步之前的，也一起退回（還沒換成伺服器的樣子）。
//! 上次看到的那一步已經沒留（超過 30 天）：退回，換成伺服器的樣子。
//! 復原、重做（#256）也是一步：送要復原的那一步（of）改到的東西改之前的樣子（重做送改之後的）。
//! of 那一步之後，別的分頁改過那些東西就退回；放回去之後跑整份流程檢查，不合就退回；of 超過 30 天（或已經沒留）不能復原。
//! 成功率紀錄（#257）也從這裡送：記一次、別人記的馬上告訴房間裡的人（見 records.rs）。
//! 斷線重連（#255）：打招呼帶上次看到第幾步，先照順序補上之後別的分頁收了的步（每一步存著改好之後的東西），
//! 再說可以送步；補不上（步驟紀錄沒留、之前的步沒存改好的東西）就給伺服器現在的樣子。
//! 連回來的打招呼也要紀錄：可以送步之前先給現在的紀錄（斷線時別人記的、改的、刪的）。
//! 漏聽了房間裡的事（落後超過 256 件）也照這樣從資料庫補。
//! 一起記全上（#262，ADR 0015）：誰在表裡、誰拿著哪幾組放在房間裡（見 run_together.rs），變了就告訴能記的人
//! （檢視者不說）；連線斷了記下時間，1 分鐘後再說一次（當他離開）；被收回、降成檢視者踢出表。
//! 登入狀態不算了（被停用、改密碼、重設密碼、30 天到期、登出）：連線關掉，送來的不收（見 serve）。

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
use crate::accounts::{AppError, SignedIn, session, signed_in};
use crate::cloud_flows::FlowBlocked;
use crate::csrf::from_this_site;
use crate::flow_core::FINGERPRINT;
use crate::records::{self, Amend, CloudRecord, DroppedRecord, RecordsChange, Stored};
use crate::run_together::{Answer, Ask, Report, RunView, Runs, Who};
use crate::sharing::{Role, VIEW_ONLY, no_access, role_of};

/// 前一步被退回、還沒換成伺服器的樣子就送的步：退回的原因。
const AFTER_SENT_BACK: &str = "沒存進去：前一步沒存進去，這一步也不算";
/// 上次看到的那一步已經沒留（超過 30 天）：退回的原因。
const TOO_OLD: &str = "沒存進去：離你上次看到太久了，換成現在的樣子";
/// 步驟紀錄留幾天；比這久的步不能復原、重做。
const KEPT_DAYS: i64 = 30;

/// 房間裡的事（同一台伺服器上，一支流程開著的連線都收得到）。
#[derive(Clone, Debug)]
pub enum RoomEvent {
    /// 這個人的權限改了；None 是被收回（或離開）。
    Permission { user_id: i64, role: Option<Role> },
    /// 擁有者把這支流程刪了（#252）：每個人都要知道。
    Deleted,
    /// 這個人有登入狀態被刪了（被停用、改密碼、重設密碼）：他的連線重查自己的，不算登入了就關掉。
    SignedOut { user_id: i64 },
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
    /// 紀錄跟著改了（#258：跑一步、改、刪、救回）：from 是送來的那個連線。
    RecordsChanged {
        from: u64,
        change: Arc<RecordsChange>,
    },
    /// 一起記全上的人、組變了（#262）：能記的人照自己看到的樣子送。
    Runs,
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
    /// 一起記全上（#262）：只放記憶體。
    runs: Runs,
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
                runs: Runs::default(),
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

    /// 告訴每一支流程開著的連線（例：有人被停用，他開著哪幾支不知道）。
    pub fn tell_everywhere(&self, event: RoomEvent) {
        for room in self.lock().values() {
            let _ = room.events.send(event.clone());
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

    /// 改一起記全上的人、組；變了就告訴每個連線（能記的人自己照 run_views 拿）。
    fn runs<R>(&self, flow_id: &str, change: impl FnOnce(&mut Runs) -> R) -> Option<R> {
        let mut rooms = self.lock();
        let room = rooms.get_mut(flow_id)?;
        let before = room.runs.clone();
        let answer = change(&mut room.runs);
        if room.runs != before {
            let _ = room.events.send(RoomEvent::Runs);
        }
        Some(answer)
    }

    /// viewer 看到的一起記全上。
    fn run_views(
        &self,
        flow_id: &str,
        viewer: i64,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Vec<RunView> {
        self.lock()
            .get(flow_id)
            .map(|room| room.runs.view(viewer, now))
            .unwrap_or_default()
    }

    /// 一個連線斷了（#262）：在表上的記下斷線的時間、告訴別人；1 分鐘後再說一次（當他離開）。
    fn run_disconnect(&self, flow_id: &str, conn: u64, now: chrono::DateTime<chrono::Utc>) {
        let changed = {
            let mut rooms = self.lock();
            let Some(room) = rooms.get_mut(flow_id) else {
                return;
            };
            let changed = room.runs.disconnect(conn, now);
            if changed {
                let _ = room.events.send(RoomEvent::Runs);
            }
            changed
        };
        if changed {
            let rooms = self.clone();
            let flow_id = flow_id.to_owned();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(61)).await;
                rooms.tell(&flow_id, RoomEvent::Runs);
            });
        }
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
        /// 連回來的（#255）：現在的紀錄也要（斷線時別人記的、改的、刪的）。第一次打開不用（打開時拿過了）。
        #[serde(default)]
        records: bool,
    },
    /// 一步：步驟 id（亂數）、上次看到第幾步、一串指令（名字＋參數，教練的回答在 options）。
    Step {
        step_id: String,
        #[ts(type = "number")]
        seen: i64,
        #[ts(type = "unknown[]")]
        commands: serde_json::Value,
    },
    /// 復原（redo 是重做，#256）：步驟 id、上次看到第幾步、要復原的那一步的步驟 id（重做是復原那一步的）、
    /// 要放回去的樣子（流程核心的 RemoteChange：那一步改到的東西改之前的樣子，重做是改之後的）。
    Undo {
        step_id: String,
        #[ts(type = "number")]
        seen: i64,
        of: String,
        redo: bool,
        #[ts(type = "unknown")]
        change: serde_json::Value,
    },
    /// 換成編輯或檢視模式（在場名單用）。
    Mode { editing: bool },
    /// 記一次（分段練，或一個人記的全上的每一次）：流程核心的 StoredAttempt（動作 id、那一次，id 是手機發的）。
    Record {
        #[ts(type = "unknown[]")]
        attempts: serde_json::Value,
    },
    /// 改幾次的記號（#258）：改好的那幾次（StoredAttempt，伺服器只拿記號）。
    ChangeRecords {
        #[ts(type = "unknown[]")]
        attempts: serde_json::Value,
    },
    /// 刪幾次（#258）：一次的 id。
    DeleteRecords { ids: Vec<String> },
    /// 救回剛刪掉的幾次（#258）：一次的 id。
    RestoreRecords { ids: Vec<String> },
    /// 我在這次全上的表裡（#262）：開、加入（joining）、連上時再報。全上 id（手機發的亂數）、日期、開的時間、
    /// 拿著哪幾組、點過哪幾組。
    RunThrough {
        id: String,
        date: String,
        #[ts(type = "number")]
        started_at: i64,
        keys: Vec<String>,
        touched: Vec<String>,
        #[serde(default)]
        joining: bool,
    },
    /// 拿一組（或接手）：from 是我看到拿著的人（沒人拿著是 null）。
    Claim {
        run: String,
        key: String,
        #[ts(type = "number | null")]
        from: Option<i64>,
    },
    /// 放掉一組。
    Release { run: String, key: String },
    /// 一欄第一次點記號。
    Touch { run: String, key: String },
    /// 離開表（存好、取消）。
    LeaveRun { run: String },
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
    /// 這一步收了：收了之後是第幾步、伺服器做出來的改動（跟送給別人的 Changed 一樣的 RemoteChange）。
    /// 伺服器跑出來的可能跟送的人自己畫面上的不一樣（例：兩個人同時加隊員，後到的被放在別的位置），送的人照它換上。
    /// change 是後來加的：部署前開著的分頁不看它；沒記改動的舊步（重送）不帶。
    Accepted {
        step_id: String,
        #[ts(type = "number")]
        step: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(type = "unknown", optional)]
        change: Option<Box<RawValue>>,
    },
    /// 這一步退回：原因、伺服器現在的樣子（換上它）、現在第幾步。
    /// 有 by（#254）：別人在我上次看到之後改過——by 是最後改到同一個東西的人（被規則擋下時是最後改過流程的人），
    /// 畫面寫成「王教練剛改了同一個地方，你的「…」沒改成」。
    /// why 是原因的代號，畫面照使用者的語言寫成句子（ADR 0017）；message 是同一個原因的中文，給部署前開著、不認得 why 的分頁看
    /// （有 by 時是規則擋下的原因，改到同一個東西是空的）。
    Rejected {
        step_id: String,
        why: SentBack,
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
    /// 現在伺服器上的紀錄（連回來時要的，或漏聽了房間裡的事）：全部還在的（別人記的帶名字）。
    /// 不在這裡的、我也沒有還沒傳的，就是斷線時被刪掉、清掉了。
    Records { records: Vec<CloudRecord> },
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
    /// 送過、後來被清掉的兩邊都不放。改、刪、救回：那幾次現在在伺服器上的樣子（還在的），dropped 是空的。
    RecordsSaved {
        saved: Vec<CloudRecord>,
        dropped: Vec<DroppedRecord>,
    },
    /// 別人（或我在別的分頁）記的。
    NewRecords { records: Vec<CloudRecord> },
    /// 別人改、刪、救回的紀錄，或一步跟著改、清掉的紀錄（#258，自己的步也送）：改好的那幾次（不在畫面上的加進來）、刪掉的 id。
    RecordsChanged {
        changed: Vec<CloudRecord>,
        deleted: Vec<String>,
    },
    /// 現在有人在記的全上（#262，只送給能記的人）：誰在表裡、誰拿著哪幾組。
    RunThroughs { runs: Vec<RunView> },
    /// 拿不到這一組（#262）：拿著的人、他點過了沒（點過是拿不走，沒點過是他先拿了）。
    ClaimRefused {
        run: String,
        key: String,
        by: String,
        touched: bool,
    },
    /// 這次全上表裡的人都離開了，不能加入（#262）。
    RunClosed { run: String },
}

/// 一步退回的原因（ADR 0017）：伺服器送代號和要放進句子的東西，畫面照使用者的語言寫成句子。
/// reason 是流程核心擋下的原因：中文，改成代號的多帶 why（一個檔一個檔改）。redo：是重做（不是復原）。
#[derive(Serialize, TS, Debug)]
#[serde(tag = "code", rename_all = "camelCase")]
#[ts(export)]
pub enum SentBack {
    /// 只能看這支流程。
    ViewOnly,
    /// 前一步沒存進去，這一步也不算。
    AfterSentBack,
    /// 離上次看到太久了，換成現在的樣子。
    TooOld,
    /// 要復原的那一步太久以前了。
    UndoTooOld { redo: bool },
    /// 伺服器看不懂這一步。
    NotUnderstood,
    /// 那一步之後 by 改過同樣的東西。
    UndoChangedLater { by: String, redo: bool },
    /// 放回去不合規則。
    UndoBlocked { redo: bool, reason: FlowBlocked },
    /// 被規則擋下；ask：要問（確認、選）而教練那邊沒問，請再看一次。
    Blocked { reason: FlowBlocked, ask: bool },
    /// 改到同一個東西（Rejected 的 by 是最後改到的人）。
    SameThing,
}

impl SentBack {
    /// 同一個原因的中文（Rejected 的 message）。by：有沒有寫最後改的人（有的話畫面自己加前面那半句）。
    fn message(&self, by: bool) -> String {
        match self {
            Self::ViewOnly => format!("沒存進去：{VIEW_ONLY}"),
            Self::AfterSentBack => AFTER_SENT_BACK.into(),
            Self::TooOld => TOO_OLD.into(),
            Self::UndoTooOld { redo } => format!("太久以前的，{}", cannot(*redo)),
            Self::NotUnderstood => "沒存進去：伺服器看不懂這一步".into(),
            Self::UndoChangedLater { by, redo } => format!("{by}後來改過，這步{}", cannot(*redo)),
            Self::UndoBlocked { redo, reason } => {
                format!("這步{}：{}", cannot(*redo), reason.message)
            }
            Self::Blocked { reason, ask } => {
                let reason = if *ask {
                    format!("{}，請再看一次", reason.message)
                } else {
                    reason.message.clone()
                };
                if by {
                    reason
                } else {
                    format!("沒存進去：{reason}")
                }
            }
            Self::SameThing => String::new(),
        }
    }
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

/// 連房間：別的網站叫的擋（403）、沒登入 401、不是我的或沒有這支 404、被擁有者刪了（刪的時候我有權限）410。
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
    let Some(SignedIn {
        user_id,
        token_hash,
        expires_at,
        ..
    }) = signed_in(&state, &headers).await?
    else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if role_of(&state.db, &id, user_id).await?.is_none() {
        return Ok(no_access(&state.db, &id, user_id).await?.into_response());
    }
    Ok(ws.on_upgrade(move |socket| async move {
        let rooms = state.rooms.clone();
        let clock = state.clock.clone();
        let conn = rooms.next_conn.fetch_add(1, Ordering::Relaxed);
        let who = Connected {
            user_id,
            token_hash,
            expires_at,
            conn,
        };
        if let Err(e) = serve(state, socket, &id, who).await {
            tracing::error!(err = %e, "房間出錯");
        }
        rooms.run_disconnect(&id, conn, clock.now());
        rooms.leave(&id, conn);
    }))
}

/// 連上的是誰：使用者 id、他的登入狀態（號碼雜湊、什麼時候到期）、這個連線的號碼。
struct Connected {
    user_id: i64,
    token_hash: Vec<u8>,
    expires_at: chrono::DateTime<chrono::Utc>,
    conn: u64,
}

/// 一個連線：先打招呼，再一步一步收；權限被改、被收回馬上說；別人的改動、在場名單送過來。
/// 對方斷線、被收回就結束。登入狀態不算了（被停用、改密碼、30 天到期、登出）就關掉，不再收（#234）：
/// 每次送來的都先重查，被停用、改密碼時也馬上重查，到期的時候也重查（只開著看的分頁也關）。前端連不回來時問 /api/me 就知道是沒登入了。
async fn serve(
    state: AppState,
    mut socket: WebSocket,
    flow_id: &str,
    connected: Connected,
) -> anyhow::Result<()> {
    let Connected {
        user_id,
        token_hash,
        expires_at,
        conn,
    } = connected;
    let still_signed_in = async || -> anyhow::Result<bool> {
        Ok(session(&state, token_hash.clone()).await?.is_some())
    };
    // 離 at 還有多久（照伺服器的鐘；已經過了是 0）。
    let until =
        |at: chrono::DateTime<chrono::Utc>| (at - state.clock.now()).to_std().unwrap_or_default();
    // 打招呼前就開始聽：連上之後的權限改動不會漏掉。
    let mut events = state.rooms.listen(flow_id);
    let (tab_id, seen, editing, want_records) = loop {
        match next_request(&mut socket).await {
            Some(RoomRequest::Hello {
                fingerprint,
                tab_id,
                seen,
                editing,
                records,
            }) => {
                if fingerprint != FINGERPRINT {
                    tell(&mut socket, &RoomMessage::NewVersion).await?;
                    return Ok(());
                }
                break (tab_id, seen, editing, records);
            }
            Some(_) => continue,
            None => return Ok(()),
        }
    };
    // 連上到打招呼之間登入狀態可能已經不算了（到期、登出）：什麼都還沒送，先重查。
    if !still_signed_in().await? {
        return Ok(());
    }
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
    if want_records {
        tell(&mut socket, &records_now(&state, flow_id, user_id).await?).await?;
    }
    tell(&mut socket, &RoomMessage::Ready { step: known }).await?;
    let here = Here {
        conn,
        user_id,
        name: name.clone(),
        editing: editing && role.can_edit(),
    };
    state.rooms.update_here(flow_id, |list| list.push(here));
    let views = state.rooms.run_views(flow_id, user_id, state.clock.now());
    if role.can_record() && !views.is_empty() {
        tell(&mut socket, &RoomMessage::RunThroughs { runs: views }).await?;
    }
    let who = Who {
        user_id,
        conn,
        name: &name,
    };
    // 上一次被退回時伺服器在第幾步：上次看到的還在它之前的步，是還沒換成伺服器的樣子就送的。
    let mut sent_back: Option<i64> = None;
    // 回答之後還要跟送的人說的（復原跟著改的紀錄）。
    let mut also: Option<RoomMessage> = None;
    // 到期的時候也重查一次：只開著看、什麼都沒送的分頁也會關掉。
    let expiry = tokio::time::sleep(until(expires_at));
    tokio::pin!(expiry);

    loop {
        let reply = tokio::select! {
            () = &mut expiry => match session(&state, token_hash.clone()).await? {
                Some(s) => {
                    expiry.as_mut().reset(tokio::time::Instant::now() + until(s.expires_at));
                    continue;
                }
                None => return Ok(()),
            },
            request = next_request(&mut socket) => match request {
                None => return Ok(()),
                Some(_) if !still_signed_in().await? => return Ok(()),
                Some(request @ (RoomRequest::Step { .. } | RoomRequest::Undo { .. })) => {
                    // 存好、告訴別人都在鎖裡：別人收到的改動照第幾步的順序。
                    let steps = state.rooms.steps(flow_id);
                    let _one_at_a_time = steps.lock().await;
                    let (step_id, seen, work) = match request {
                        RoomRequest::Undo { step_id, seen, of, redo, change } => {
                            (step_id, seen, Work::Undo { of, redo, change })
                        }
                        RoomRequest::Step { step_id, seen, commands } => (step_id, seen, Work::Commands(commands)),
                        _ => unreachable!(),
                    };
                    let sent = Sent { step_id, seen, work, tab_id: &tab_id, sent_back };
                    let (reply, change) = take_step(&state, flow_id, user_id, sent).await?;
                    if let RoomMessage::Rejected { step, .. } = &reply {
                        sent_back = Some(*step);
                    }
                    if let (RoomMessage::Accepted { step, .. }, Some((change, kept))) = (&reply, change) {
                        let event = RoomEvent::Changed {
                            from: conn,
                            by: name.clone(),
                            step: *step,
                            change: change.into(),
                        };
                        state.rooms.tell(flow_id, event);
                        // 紀錄跟著改的接在編排的改動後面（別人先套編排，再換紀錄）。
                        if !kept.is_empty() {
                            // 送的人也收到（ADR 0007）：復原、重做加回來的；一般的步，進房間拿到的紀錄可能還沒算到這一步。
                            also = Some(RoomMessage::RecordsChanged {
                                changed: kept.changed.iter().map(|r| r.seen_by(user_id)).collect(),
                                deleted: kept.deleted.clone(),
                            });
                            state.rooms.tell(flow_id, RoomEvent::RecordsChanged { from: conn, change: kept.into() });
                        }
                    }
                    reply
                }
                Some(RoomRequest::Record { attempts }) => {
                    records::record(&state, flow_id, user_id, conn, attempts).await?
                }
                Some(RoomRequest::ChangeRecords { attempts }) => {
                    let attempts = serde_json::from_value(attempts).unwrap_or_default();
                    records::amend(&state, flow_id, user_id, conn, Amend::Change(attempts)).await?
                }
                Some(RoomRequest::DeleteRecords { ids }) => {
                    records::amend(&state, flow_id, user_id, conn, Amend::Delete(ids)).await?
                }
                Some(RoomRequest::RestoreRecords { ids }) => {
                    records::amend(&state, flow_id, user_id, conn, Amend::Restore(ids)).await?
                }
                Some(RoomRequest::RunThrough { id, date, started_at, keys, touched, joining }) => {
                    if !role.can_record() {
                        continue;
                    }
                    let report = Report { id: id.clone(), date, started_at, keys, touched, joining };
                    let now = state.clock.now();
                    let answer = state.rooms.runs(flow_id, |runs| runs.report(&who, report, now));
                    match told_run(id, None, answer) {
                        Some(message) => message,
                        None => continue,
                    }
                }
                Some(request @ (RoomRequest::Claim { .. } | RoomRequest::Release { .. } | RoomRequest::Touch { .. } | RoomRequest::LeaveRun { .. })) => {
                    if !role.can_record() {
                        continue;
                    }
                    let (run, key, ask) = match request {
                        RoomRequest::Claim { run, key, from } => (run, Some(key.clone()), Ask::Claim { key, from }),
                        RoomRequest::Release { run, key } => (run, Some(key.clone()), Ask::Release { key }),
                        RoomRequest::Touch { run, key } => (run, Some(key.clone()), Ask::Touch { key }),
                        RoomRequest::LeaveRun { run } => (run, None, Ask::Leave),
                        _ => unreachable!(),
                    };
                    let now = state.clock.now();
                    let answer = state.rooms.runs(flow_id, |runs| runs.ask(&who, &run, ask, now));
                    match told_run(run, key, answer) {
                        Some(message) => message,
                        None => continue,
                    }
                }
                Some(RoomRequest::Mode { editing }) => {
                    state.rooms.set_editing(flow_id, conn, editing && role.can_edit());
                    continue;
                }
                Some(RoomRequest::Hello { .. }) => continue,
            },
            event = events.recv() => match event {
                Ok(RoomEvent::Permission { user_id: who, role: changed }) if who == user_id => {
                    // 被收回、降成檢視者：踢出表，拿著的組放掉（#262）。
                    if !changed.is_some_and(|r| r.can_record()) {
                        let now = state.clock.now();
                        state.rooms.runs(flow_id, |runs| runs.kick(user_id, now));
                    }
                    if let Some(r) = changed {
                        role = r;
                        if !r.can_edit() {
                            state.rooms.set_editing(flow_id, conn, false);
                        }
                    }
                    told_role(&state, flow_id, changed).await?
                }
                Ok(RoomEvent::Deleted) => RoomMessage::Deleted,
                Ok(RoomEvent::SignedOut { user_id: who }) if who == user_id => {
                    if !still_signed_in().await? {
                        return Ok(());
                    }
                    continue;
                }
                Ok(RoomEvent::Changed { from, by, step, change }) if from != conn && step > known => {
                    known = step;
                    RoomMessage::Changed { step, by, change: RawValue::from_string(change.to_string())? }
                }
                Ok(RoomEvent::Runs) if role.can_record() => RoomMessage::RunThroughs {
                    runs: state.rooms.run_views(flow_id, user_id, state.clock.now()),
                },
                Ok(RoomEvent::Present(here)) => RoomMessage::Present { people: present_for(&here, user_id) },
                Ok(RoomEvent::Recorded { from, user_id: by, name, records }) if from != conn => {
                    let records = records
                        .into_iter()
                        .map(|s| CloudRecord {
                            action_id: s.action_id,
                            attempt: s.attempt,
                            by: (by != user_id).then(|| name.clone()),
                            mine: by == user_id,
                        })
                        .collect();
                    RoomMessage::NewRecords { records }
                }
                Ok(RoomEvent::RecordsChanged { from, change }) if from != conn => RoomMessage::RecordsChanged {
                    changed: change.changed.iter().map(|r| r.seen_by(user_id)).collect(),
                    deleted: change.deleted.clone(),
                },
                Ok(_) => continue,
                // 漏聽了幾件：照資料庫補上漏掉的別人的步，重新看一次自己的權限，再說一次在場名單。
                // 漏掉的可能是登出、停用：先重查登入狀態。
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if !still_signed_in().await? {
                        return Ok(());
                    }
                    let changed = role_of(&state.db, flow_id, user_id).await?;
                    let told = told_role(&state, flow_id, changed).await?;
                    if !matches!(told, RoomMessage::Revoked) {
                        for message in catch_up(&state, flow_id, &tab_id, &mut known).await? {
                            tell(&mut socket, &message).await?;
                        }
                        tell(&mut socket, &records_now(&state, flow_id, user_id).await?).await?;
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
        if let Some(message) = also.take() {
            tell(&mut socket, &message).await?;
        }
    }
}

/// 一起記全上做完要跟送的人說的：拿不到、加入不了；好了不用說（全上變了另外送）。
fn told_run(run: String, key: Option<String>, answer: Option<Answer>) -> Option<RoomMessage> {
    match answer? {
        Answer::Done => None,
        Answer::Refused { by, touched } => Some(RoomMessage::ClaimRefused {
            run,
            key: key.unwrap_or_default(),
            by,
            touched,
        }),
        Answer::Closed => Some(RoomMessage::RunClosed { run }),
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

/// 現在伺服器上的紀錄（viewer 看到的：別人記的帶名字）。
async fn records_now(state: &AppState, flow_id: &str, viewer: i64) -> anyhow::Result<RoomMessage> {
    Ok(RoomMessage::Records {
        records: records::for_viewer(&state.db, flow_id, viewer).await?,
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

/// 收一步的結果：回送的人的話；收了的帶要送給別人的改動（RemoteChange 的 JSON）和跟著改的紀錄。
type Taken = (RoomMessage, Option<(String, RecordsChange)>);

/// 送來的一步：步驟 id、上次看到第幾步、要做的；哪個分頁送的、這個連線上次被退回時伺服器在第幾步。
struct Sent<'a> {
    step_id: String,
    seen: i64,
    work: Work,
    tab_id: &'a str,
    sent_back: Option<i64>,
}

/// 一步要做的：跑一串指令，或復原、重做（#256）。
enum Work {
    Commands(serde_json::Value),
    Undo {
        of: String,
        redo: bool,
        change: serde_json::Value,
    },
}

/// 收一步。同一支流程的步鎖著那一列一步一步來。流程被刪了回 Deleted；先查權限：被收回回 Revoked，
/// 不能改的（記錄者、檢視者）退回。再看改到同一個東西（#254）。收了的連同要送給別人的改動、跟著改的紀錄一起回。
async fn take_step(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    sent: Sent<'_>,
) -> anyhow::Result<Taken> {
    let Sent {
        step_id,
        seen,
        work,
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
    let taken: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT step, change::text FROM flow_steps WHERE flow_id = $1 AND step_id = $2",
    )
    .bind(flow_id)
    .bind(&step_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((step, change)) = taken {
        let change = change.map(RawValue::from_string).transpose()?;
        return Ok((
            RoomMessage::Accepted {
                step_id,
                step,
                change,
            },
            None,
        ));
    }

    let rejected = |why: SentBack, by: Option<String>, content: String| -> anyhow::Result<Taken> {
        let flow = RawValue::from_string(content)?;
        let step_id = step_id.clone();
        Ok((
            RoomMessage::Rejected {
                step_id,
                message: why.message(by.is_some()),
                why,
                by,
                flow,
                step,
            },
            None,
        ))
    };
    if !role.can_edit() {
        return rejected(SentBack::ViewOnly, None, content);
    }
    // 前一步被退回、還沒換成伺服器的樣子就送的：一起退回。
    if sent_back.is_some_and(|n| seen < n) {
        return rejected(SentBack::AfterSentBack, None, content);
    }
    // 上次看到之後的步已經沒留（超過 30 天）：比不了，換成伺服器的樣子。
    if seen < step && !kept(&mut tx, flow_id, seen + 1).await? {
        return rejected(SentBack::TooOld, None, content);
    }
    // 紀錄放回流程再跑（ADR 0011）：跑完照結果清掉、改掉該改的紀錄。
    let before = records::before_step(&mut tx, flow_id).await?;
    let mut revived = vec![];
    let (ran, undoing) = match work {
        Work::Commands(commands) => {
            let ran = state
                .core
                .run_step(
                    content.clone(),
                    serde_json::to_string(&before)?,
                    commands.to_string(),
                    step_id.clone(),
                )
                .await;
            (ran, None)
        }
        Work::Undo { of, redo, change } => {
            // 要復原的那一步：超過 30 天或已經沒留，不能復原。
            let Some((n, keys)) = undoable(&mut tx, flow_id, &of, state.clock.now()).await? else {
                return rejected(SentBack::UndoTooOld { redo }, None, content);
            };
            // 那一步清掉的紀錄一起放回去、加回來的再清掉（ADR 0007）：重做是復原那一步復原的。
            let (records, back) = records::brought_back(&mut tx, flow_id, &of, &before).await?;
            revived = back;
            let ran = state
                .core
                .run_undo(
                    content.clone(),
                    serde_json::to_string(&records)?,
                    change.to_string(),
                )
                .await;
            (ran, Some((n, keys, redo)))
        }
    };
    let Ok(result) = ran else {
        // 流程核心看不懂（例：沒有這個指令、參數不對）。
        return rejected(SentBack::NotUnderstood, None, content);
    };
    let outcome: records::StepOutcome = serde_json::from_str(&result)?;
    if let Some((n, mut keys, redo)) = undoing {
        // 那一步之後別的分頁改過那些東西（那一步改到的、這次放回去會改到的）：退回，寫最後改到的人。
        keys.extend(outcome.watch.iter().cloned());
        if let Some(by) = last_other(&mut tx, flow_id, n, tab_id, Some(&keys)).await? {
            return rejected(SentBack::UndoChangedLater { by, redo }, None, content);
        }
        // 放回去不合規則（整份流程檢查）。
        if outcome.kind != "ok" {
            let reason = FlowBlocked::new(outcome.message, outcome.why);
            return rejected(SentBack::UndoBlocked { redo, reason }, None, content);
        }
    }
    let flow = match (outcome.kind.as_str(), outcome.flow) {
        ("ok", Some(flow)) => flow,
        // 被擋，或要問（確認、選）而教練那邊沒問：退回並帶原因。上次看到之後別人改過，寫最後改的人。
        (kind, _) => {
            let reason = FlowBlocked::new(outcome.message, outcome.why);
            let why = SentBack::Blocked {
                reason,
                ask: kind != "blocked",
            };
            let by = last_other(&mut tx, flow_id, seen, tab_id, None).await?;
            return rejected(why, by, content);
        }
    };
    // 這一步改到的東西，上次看到之後被別的分頁改過：退回，寫最後改到的人。
    if let Some(by) = last_other(&mut tx, flow_id, seen, tab_id, Some(&outcome.watch)).await? {
        return rejected(SentBack::SameThing, Some(by), content);
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
    let records_change = records::after_step(
        &mut tx,
        flow_id,
        step,
        &before,
        outcome.records.unwrap_or_default(),
        &revived,
        now,
    )
    .await?;
    // 換掉、刪掉的音樂記下哪天不用了（#249）。
    crate::music::note_unused(&mut tx, flow_id, flow.get(), now).await?;
    tx.commit().await?;
    Ok((
        RoomMessage::Accepted {
            step_id,
            step,
            change: Some(RawValue::from_string(change.clone())?),
        },
        Some((change, records_change)),
    ))
}

/// 「不能復原」或「不能重做」。
fn cannot(redo: bool) -> &'static str {
    if redo { "不能重做" } else { "不能復原" }
}

/// 要復原的那一步（步驟 id）：第幾步、改到的東西。沒留或超過 30 天是 None。
async fn undoable(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    step_id: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<Option<(i64, Vec<String>)>> {
    Ok(sqlx::query_as(
        "SELECT step, keys FROM flow_steps WHERE flow_id = $1 AND step_id = $2 AND created_at > $3",
    )
    .bind(flow_id)
    .bind(step_id)
    .bind(now - chrono::Duration::days(KEPT_DAYS))
    .fetch_optional(tx)
    .await?)
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
