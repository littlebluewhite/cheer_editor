//! 一起記全上（#262，ADR 0015、0020）：誰在哪次全上的表裡、誰拿著哪幾組、點過沒，只放伺服器記憶體（房間裡），不存資料庫。
//! 手機每次連上（斷線回來、伺服器重開後都是）自己再報一次「我在哪次全上、拿著哪幾組、點過哪幾組」。
//! 組是手機給的字（例：「n:2」是第 2 組，跨動作一起選；騰翻、跳躍每個人一個），伺服器不看裡面。
//!
//! 表怎麼變（誰拿得到哪一組、斷線多久算離開、都離開了就沒了）只在流程核心（`src/lib/core/run-together.ts`，#353）：
//! 表是流程核心給的 JSON，房間原樣存著；每件事叫一次 `runTogetherJson`，連給每個人看的樣子一起回；
//! 沒有事、只要樣子（打招呼、斷線 1 分鐘後再說一次）叫 `runViewsJson`。這裡只把事、回答、樣子在 Rust 和 JSON 之間換。
//! 真正擋住「一組記兩次」的是存紀錄（records.rs：同一次同一組只收先存的）。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use ts_rs::TS;

use crate::flow_core::FlowCore;

/// 沒有開著的全上時的表。
pub const EMPTY: &str = "[]";

/// 斷線多久就當他離開那張表：跟流程核心的 `GONE_MS`（`src/lib/core/run-together.ts`）是同一個，改一邊要改另一邊。
/// 這裡只拿來決定斷線後多久再說一次（算不算離開是流程核心算的）。
pub const GONE_AFTER: std::time::Duration = std::time::Duration::from_secs(60);

/// 誰送的：哪個人、哪個連線、叫什麼。
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Who<'a> {
    pub user_id: i64,
    pub conn: u64,
    pub name: &'a str,
}

/// 我在這次全上的表裡（開、加入、連上時再報）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub date: String,
    pub started_at: i64,
    pub keys: Vec<String>,
    pub touched: Vec<String>,
    /// 加入別人開的（不是自己開的、不是重報）：那次已經沒了就不能加入。
    pub joining: bool,
}

/// 手機從房間送來的一起記全上的事（RoomRequest 裡的幾種）。from：送的人看到誰拿著。
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Ask {
    Claim { key: String, from: Option<i64> },
    Release { key: String },
    Touch { key: String },
    Leave,
}

/// 發生的事（流程核心的 RunEvent）：報、問、一個連線斷了、請出去（被收回、降成檢視者）。
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Event<'a> {
    Report { who: Who<'a>, report: Report },
    Ask { who: Who<'a>, run: String, ask: Ask },
    Disconnect { conn: u64 },
    Kick { user_id: i64 },
}

/// 做了之後要跟送的人說的（別人照全上的新樣子）。
#[derive(Deserialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Answer {
    /// 好了（全上有沒有變另外看）。
    Done,
    /// 這一組別人拿著：拿著的人的名字、點過了沒。
    Refused { by: String, touched: bool },
    /// 那次全上的人都離開了，不能加入。
    Closed,
}

/// 做完一件事：新的表（JSON）、回答、變了沒、給每個看的人的樣子（使用者 id → 每次全上）。
pub struct Happened {
    pub runs: String,
    pub answer: Answer,
    pub changed: bool,
    pub views: HashMap<i64, Vec<RunView>>,
}

/// 送給能記的人的一次全上（照看的人寫哪些是他的）。
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunView {
    pub id: String,
    pub date: String,
    #[ts(type = "number")]
    pub started_at: i64,
    /// 還在表裡的人（斷線不到 1 分鐘的也算），照進來的先後。
    pub people: Vec<RunPerson>,
    /// 有人拿著的組（離開了的人拿著的也列，別人能接手）。
    pub keys: Vec<RunKey>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunPerson {
    pub name: String,
    /// 是看的人自己。
    pub me: bool,
    /// 斷線了。
    pub away: bool,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunKey {
    pub key: String,
    /// 拿著的人（拿這一組時說「我看到是他拿著」）。
    #[ts(type = "number")]
    pub user_id: i64,
    pub name: String,
    pub mine: bool,
    /// 點過記號了。
    pub touched: bool,
    /// 拿著的人斷線了。
    pub away: bool,
}

/// 在表 runs 上做一件事（`runTogetherJson`）。now 是毫秒，viewers 是要給哪些人看的使用者 id。
pub async fn happen(
    core: &FlowCore,
    runs: &str,
    event: Event<'_>,
    now: i64,
    viewers: &[i64],
) -> anyhow::Result<Happened> {
    #[derive(Serialize)]
    struct Sent<'a> {
        #[serde(flatten)]
        event: Event<'a>,
        now: i64,
        viewers: &'a [i64],
    }
    #[derive(Deserialize)]
    struct Out {
        runs: Box<RawValue>,
        answer: Answer,
        changed: bool,
        views: Vec<Vec<RunView>>,
    }
    let sent = serde_json::to_string(&Sent {
        event,
        now,
        viewers,
    })?;
    let out: Out = serde_json::from_str(&core.run_together(runs.to_owned(), sent).await?)?;
    Ok(Happened {
        runs: out.runs.get().to_owned(),
        answer: out.answer,
        changed: out.changed,
        views: viewers.iter().copied().zip(out.views).collect(),
    })
}

/// 沒有事、只要樣子（`runViewsJson`）：給每個 viewer 看的每次全上。表是空的不進流程核心。
pub async fn views(
    core: &FlowCore,
    runs: &str,
    now: i64,
    viewers: &[i64],
) -> anyhow::Result<HashMap<i64, Vec<RunView>>> {
    if runs == EMPTY {
        return Ok(viewers.iter().map(|v| (*v, vec![])).collect());
    }
    let ask = serde_json::json!({ "now": now, "viewers": viewers }).to_string();
    let views: Vec<Vec<RunView>> =
        serde_json::from_str(&core.run_views(runs.to_owned(), ask).await?)?;
    Ok(viewers.iter().copied().zip(views).collect())
}
