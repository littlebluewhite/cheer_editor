//! 收紀錄的接線（連 PostgreSQL，不開網路埠）：Rust 挑哪些紀錄給流程核心、流程核心自己出錯時回什麼。
//! 流程核心換成假的（`flowCore` 換掉一個函式），看 Rust 傳進去的、照結果做的；規則本身的表格在 `src/lib/core/room-records.test.ts`。

use super::*;
use crate::breach::BreachCheck;
use crate::clock::Clock;
use crate::flow_core::FlowCore;
use crate::mail::Mailer;
use serde_json::json;

const FLOW: &str = "flow00000001";

/// 一台伺服器的狀態、一個使用者（王教練）和他的一支流程（編排不重要：流程核心是假的）。
async fn setup(db: sqlx::PgPool) -> (AppState, i64) {
    let (user_id,): (i64,) = sqlx::query_as(
        "INSERT INTO users (email, name) VALUES ('wang@example.com', '王教練') RETURNING id",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO flows (id, owner_id, content, updated_at) VALUES ($1, $2, '{}', now())",
    )
    .bind(FLOW)
    .bind(user_id)
    .execute(&db)
    .await
    .unwrap();
    let state = AppState {
        db,
        mailer: Mailer::memory(),
        breach: BreachCheck::list(Vec::<&str>::new()),
        clock: Clock::new(chrono::Utc::now),
        site_url: "https://cheer.example".into(),
        core: FlowCore::start().unwrap(),
        mail_limit: Default::default(),
        rooms: Default::default(),
        music: None,
    };
    (state, user_id)
}

/// 分段練的一次（run 給了就是那次全上的）。
fn one(id: &str, run: Option<&str>) -> Stored {
    let mut attempt = json!({ "id": id, "date": "2026-11-01", "who": "g1", "whole": true, "marks": { "p1": "✓" } });
    attempt["practice"] = json!("drill");
    if let Some(run) = run {
        attempt["practice"] = json!("runThrough");
        attempt["runThroughId"] = json!(run);
        attempt["runThroughStartedAt"] = json!(1_794_036_000_000_i64);
    }
    Stored {
        action_id: "x1".into(),
        attempt,
    }
}

/// 直接存進資料庫（recorded_by 是 by）；gone 就再清掉（留墓碑）。
async fn stored(state: &AppState, by: Option<i64>, record: &Stored, gone: bool) {
    let mut tx = state.db.begin().await.unwrap();
    insert(&mut tx, FLOW, by, record, chrono::Utc::now())
        .await
        .unwrap();
    tx.commit().await.unwrap();
    if gone {
        sqlx::query("UPDATE flow_records SET deleted_at = now() WHERE flow_id = $1 AND id = $2")
            .bind(FLOW)
            .bind(record.attempt["id"].as_str().unwrap())
            .execute(&state.db)
            .await
            .unwrap();
    }
}

/// 流程核心的 receiveRecordsJson 換成 body（JS 的函式本體，參數 flow、ask）。
async fn fake_receive(state: &AppState, body: &str) {
    state
        .core
        .eval(format!(
            "globalThis.flowCore = {{ ...flowCore, receiveRecordsJson(flow, ask) {{ {body} }} }}; ''"
        ))
        .await
        .unwrap();
}

fn ids(of: &[Value]) -> Vec<&str> {
    of.iter()
        .map(|r| r["attempt"]["id"].as_str().unwrap())
        .collect()
}

#[sqlx::test]
async fn when_the_flow_core_breaks_stored_ones_still_come_back_and_only_new_ones_are_refused(
    db: sqlx::PgPool,
) {
    let (state, wang) = setup(db).await;
    let kept = one("tkept11111110", None);
    let gone = one("tgone22222220", None);
    let new = one("tnew333333330", None);
    stored(&state, Some(wang), &kept, false).await;
    stored(&state, Some(wang), &gone, true).await;
    fake_receive(&state, "throw new Error('壞了')").await;

    let reply = record(&state, FLOW, wang, 1, json!([new, kept, gone, kept]))
        .await
        .unwrap();
    let reply = serde_json::to_value(reply).unwrap();

    // 收過的照樣回存著的那一筆；收過、後來清掉的兩邊都不放；只有新的寫看不懂
    assert_eq!(
        ids(reply["saved"].as_array().unwrap()),
        vec!["tkept11111110"]
    );
    assert_eq!(reply["saved"][0]["mine"], true);
    assert_eq!(
        reply["dropped"],
        json!([{ "id": "tnew333333330", "message": "伺服器看不懂這一筆" }])
    );
}

#[sqlx::test]
async fn while_the_flow_is_locked_only_related_records_are_read_for_the_flow_core(
    db: sqlx::PgPool,
) {
    let (state, wang) = setup(db).await;
    let resent = one("tresent111110", Some("rrun000000001"));
    for (record, gone) in [
        (one("tother0000010", None), false),
        (resent.clone(), true),
        (one("tmate00000010", Some("rrun000000001")), false),
        (one("tmategone0010", Some("rrun000000001")), true),
        (one("telse00000010", Some("rrun000000002")), false),
    ] {
        stored(&state, Some(wang), &record, gone).await;
    }
    fake_receive(&state, "globalThis.ASKED = JSON.parse(ask); return '[]';").await;

    let new = one("tnew000000010", Some("rrun000000001"));
    record(&state, FLOW, wang, 1, json!([resent, new]))
        .await
        .unwrap();

    // 傳進去的只有同樣 id 的（連清掉的）和同一次全上還在的；不讀整份紀錄
    let asked = state
        .core
        .eval("JSON.stringify(ASKED.records.map((r) => r.attempt.id))".into())
        .await
        .unwrap();
    let asked: Vec<String> = serde_json::from_str(&asked).unwrap();
    assert_eq!(asked, vec!["tresent111110", "tmate00000010"]);
}
