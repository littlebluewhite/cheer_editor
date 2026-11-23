//! 房間裡一起記全上的接線（不連資料庫、不開網路埠）：時鐘暫停（tokio 的 start_paused），斷線 1 分鐘後再說一次不用真的等。
//! 規則本身（誰算離開）的表格在 `src/lib/core/run-together.test.ts`；連 WebSocket 的在 `tests/run_together.rs`。

use super::*;
use crate::breach::BreachCheck;
use crate::clock::Clock;
use crate::flow_core::FlowCore;
use crate::mail::Mailer;
use chrono::TimeZone;

const FLOW: &str = "flow00000001";
const RUN: &str = "rabc123def456";
const WANG: i64 = 1;
const LIN: i64 = 2;

/// 一台伺服器的狀態：伺服器的鐘跟著 tokio 的鐘走（暫停時撥 tokio 的鐘，伺服器的鐘也跟著過）。資料庫不會用到。
fn state() -> AppState {
    let start = tokio::time::Instant::now();
    let base = chrono::Utc.with_ymd_and_hms(2026, 11, 7, 9, 0, 0).unwrap();
    AppState {
        // 不清閒置的連線：不然它的計時器（10 分鐘）會讓暫停的鐘在等流程核心時一下跳過去。
        db: sqlx::postgres::PgPoolOptions::new()
            .idle_timeout(None)
            .max_lifetime(None)
            .connect_lazy("postgres://unused@127.0.0.1/unused")
            .unwrap(),
        mailer: Mailer::memory(),
        breach: BreachCheck::list(Vec::<&str>::new()),
        clock: Clock::new(move || base + chrono::Duration::from_std(start.elapsed()).unwrap()),
        site_url: "https://cheer.example".into(),
        core: FlowCore::start().unwrap(),
        mail_limit: Default::default(),
        rooms: Default::default(),
        music: None,
    }
}

/// 林教練收到的下一個一起記全上的樣子（別的事跳過）。
/// 真的時間過了 10 秒還沒有就失敗：暫停的 tokio 鐘沒事做時會自己往前撥，不能拿它來限時。
async fn next_runs(events: &mut tokio::sync::broadcast::Receiver<RoomEvent>) -> Vec<RunView> {
    let (late, too_late) = tokio::sync::oneshot::channel::<()>();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let _ = late.send(());
    });
    let next = async {
        loop {
            if let Ok(RoomEvent::Runs(_, views)) = events.recv().await {
                return views[&LIN].clone();
            }
        }
    };
    tokio::select! {
        views = next => views,
        _ = too_late => panic!("一直沒說一起記全上的樣子"),
    }
}

/// 表裡的人：名字、斷線了沒。
fn people(views: &[RunView]) -> Vec<(&str, bool)> {
    views[0]
        .people
        .iter()
        .map(|p| (p.name.as_str(), p.away))
        .collect()
}

#[tokio::test(start_paused = true)]
async fn a_minute_after_someone_disconnects_the_others_are_told_again_that_he_left() {
    let state = state();
    let mut events = state.rooms.listen(FLOW);
    // 王教練（連線 1）開了全上拿第 1 組，林教練（連線 2）加入拿第 2 組。
    for (conn, user_id, name) in [(1, WANG, "王教練"), (2, LIN, "林教練")] {
        let here = Here {
            conn,
            user_id,
            name: name.into(),
            editing: false,
        };
        state.rooms.update_here(FLOW, |list| list.push(here));
        let report = Report {
            id: RUN.into(),
            date: "2026-11-07".into(),
            started_at: 1_794_036_000_000,
            keys: vec![format!("n:{user_id}")],
            touched: vec![],
            joining: user_id == LIN,
        };
        let who = Who {
            user_id,
            conn,
            name,
        };
        let event = Event::Report { who, report };
        assert!(run_event(&state, FLOW, event).await.is_some());
    }
    while events.try_recv().is_ok() {}

    // 王教練斷線：馬上說他斷線了，還在表裡。
    let disconnected = state.clock.now();
    run_disconnect(&state, FLOW, 1).await;
    state.rooms.leave(FLOW, 1);
    let away = next_runs(&mut events).await;
    assert_eq!(people(&away), vec![("王教練", true), ("林教練", false)]);

    // 沒人再做什麼：1 分鐘後伺服器自己再說一次，王教練離開了表。
    let gone = next_runs(&mut events).await;
    assert_eq!(people(&gone), vec![("林教練", false)]);
    let wang_key = gone[0].keys.iter().find(|k| k.key == "n:1").unwrap();
    assert_eq!((wang_key.user_id, wang_key.away), (WANG, true));
    // 是斷線後 61 秒那次說的（不是更晚才說）。
    let after = state.clock.now() - disconnected;
    assert!(
        after >= chrono::Duration::seconds(61) && after < chrono::Duration::seconds(62),
        "斷線後 {after} 才說"
    );
}
