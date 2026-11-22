//! 量收紀錄要多久（#349，ADR 0018）：現在的 `record`（叫流程核心的 receiveRecords）跟 #349 以前的（Rust 自己的規則，
//! 照抄在下面，只給這裡比）在同一次跑裡交錯量，連 PostgreSQL。約 1 MB 的流程（tests/fixtures/big-flow.js，5,500 次紀錄）。
//! 三種：一次送 1 筆、一次送 40 筆（一次全上）、整批 40 筆都是收過的重送。只印數字、不比時間，所以平常不跑：
//! `npm run test:server -- --release --lib record_timing -- --ignored --nocapture`。結果寫在 ADR 0018。

use std::time::{Duration, Instant};

use super::*;
use crate::breach::BreachCheck;
use crate::clock::Clock;
use crate::flow_core::FlowCore;
use crate::mail::Mailer;

/// #349 以前 `checkRecordsJson` 的一筆。
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Checked {
    Ok { record: Stored },
    Dropped { message: String },
}

/// #349 以前的 `record`（照抄，只給量時間比；伺服器不叫）：Rust 自己去重、查收過的 id、收過的讀整份紀錄挑出來、
/// 檢視者不收、checkRecordsJson 檢查、每筆用 SQL 查同一次全上的同一組。
async fn record_before_349(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    from: u64,
    attempts: Value,
) -> anyhow::Result<RoomMessage> {
    let incoming: Vec<Stored> = serde_json::from_value(attempts).unwrap_or_default();
    let mut seen = HashSet::new();
    let incoming: Vec<(String, Stored)> = incoming
        .into_iter()
        .filter_map(|s| {
            let id = s.attempt.get("id")?.as_str()?.to_owned();
            seen.insert(id.clone()).then_some((id, s))
        })
        .collect();

    let mut tx = state.db.begin().await?;
    let Some((content,)): Option<(String,)> =
        sqlx::query_as("SELECT content::text FROM flows WHERE id = $1 FOR UPDATE")
            .bind(flow_id)
            .fetch_optional(&mut *tx)
            .await?
    else {
        return Ok(RoomMessage::Deleted);
    };
    let Some(role) = role_of(&mut *tx, flow_id, user_id).await? else {
        return Ok(RoomMessage::Revoked);
    };
    let ids: Vec<String> = incoming.iter().map(|(id, _)| id.clone()).collect();
    let taken: HashSet<String> = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM flow_records WHERE flow_id = $1 AND id = ANY($2)",
    )
    .bind(flow_id)
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|(id,)| id)
    .collect();
    let mut saved: Vec<CloudRecord> = if taken.is_empty() {
        vec![]
    } else {
        rows(&mut *tx, flow_id, false)
            .await?
            .iter()
            .filter(|r| taken.contains(r.id()))
            .map(|r| r.seen_by(user_id))
            .collect()
    };

    let fresh: Vec<(String, Stored)> = incoming
        .into_iter()
        .filter(|(id, _)| !taken.contains(id))
        .collect();
    if !role.can_record() {
        let dropped = fresh
            .into_iter()
            .map(|(id, _)| DroppedRecord {
                id,
                message: VIEW_ONLY.into(),
                by: None,
                someone: None,
            })
            .collect();
        return Ok(RoomMessage::RecordsSaved { saved, dropped });
    }
    let mut dropped = vec![];
    let mut added = vec![];
    if !fresh.is_empty() {
        let records: Vec<&Stored> = fresh.iter().map(|(_, s)| s).collect();
        let checked = state
            .core
            .check_records(content, serde_json::to_string(&records)?)
            .await;
        let checked: Vec<Checked> = match checked {
            Ok(json) => serde_json::from_str(&json)?,
            Err(_) => fresh
                .iter()
                .map(|_| Checked::Dropped {
                    message: "伺服器看不懂這一筆".into(),
                })
                .collect(),
        };
        let now = state.clock.now();
        for ((id, _), result) in fresh.into_iter().zip(checked) {
            match result {
                Checked::Dropped { message } => dropped.push(DroppedRecord {
                    id,
                    message,
                    by: None,
                    someone: None,
                }),
                Checked::Ok { record } => {
                    if let Some(name) = recorded_in_run(&mut tx, flow_id, &record, &id).await? {
                        let someone = name.is_none().then_some(true);
                        let by = name.unwrap_or_else(|| "別人".into());
                        let message = format!("{by}已經記了這次全上的這一組");
                        dropped.push(DroppedRecord {
                            id,
                            message,
                            by: Some(by),
                            someone,
                        });
                        continue;
                    }
                    insert(&mut tx, flow_id, Some(user_id), &record, now).await?;
                    added.push(record);
                }
            }
        }
    }
    tx.commit().await?;

    if !added.is_empty() {
        let (name,): (String,) = sqlx::query_as("SELECT name FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await?;
        state.rooms.tell(
            flow_id,
            RoomEvent::Recorded {
                from,
                user_id,
                name,
                records: added.clone(),
            },
        );
    }
    saved.extend(added.into_iter().map(|s| CloudRecord {
        action_id: s.action_id,
        attempt: s.attempt,
        by: None,
        mine: true,
    }));
    Ok(RoomMessage::RecordsSaved { saved, dropped })
}

/// 收了幾筆、沒收幾筆。
fn counts(reply: RoomMessage) -> (usize, usize) {
    match reply {
        RoomMessage::RecordsSaved { saved, dropped } => (saved.len(), dropped.len()),
        _ => panic!("不是 RecordsSaved"),
    }
}

fn median(ms: &mut [f64]) -> f64 {
    ms.sort_by(f64::total_cmp);
    ms[ms.len() / 2]
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

#[sqlx::test]
#[ignore = "量時間用，手動跑"]
async fn record_timing(db: sqlx::PgPool) {
    const PAIRS: usize = 61;
    let core = FlowCore::start().unwrap();
    let made = core
        .eval(format!(
            "{}\nJSON.stringify(bigFlow())",
            include_str!("../tests/fixtures/big-flow.js")
        ))
        .await
        .unwrap();
    #[derive(Deserialize)]
    struct Big {
        flow: Box<serde_json::value::RawValue>,
        records: Vec<Stored>,
    }
    let big: Big = serde_json::from_str(&made).unwrap();
    let now = chrono::Utc::now();

    let (user_id,): (i64,) = sqlx::query_as(
        "INSERT INTO users (email, name) VALUES ('li@example.com', '李教練') RETURNING id",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let flow_id = "bigflow";
    sqlx::query(
        "INSERT INTO flows (id, owner_id, content, updated_at) VALUES ($1, $2, $3::json, $4)",
    )
    .bind(flow_id)
    .bind(user_id)
    .bind(big.flow.get())
    .bind(now)
    .execute(&db)
    .await
    .unwrap();
    let mut tx = db.begin().await.unwrap();
    from_file(&mut tx, flow_id, &big.records, now)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    println!(
        "流程（不帶紀錄）{} bytes、存著的紀錄 {} 次",
        big.flow.get().len(),
        big.records.len()
    );

    let state = AppState {
        db: db.clone(),
        mailer: Mailer::memory(),
        breach: BreachCheck::list(Vec::<&str>::new()),
        clock: Clock::new(chrono::Utc::now),
        site_url: "https://cheer.example".into(),
        core,
        mail_limit: Default::default(),
        rooms: Default::default(),
        music: None,
    };

    // 送來的：照存著的前 40 次的動作、組、記號（40 個不同的動作），換新的 id。
    const RUN: &str = "rrunbench0001";
    let one = |i: usize, run: bool| -> Value {
        let base = &big.records[i];
        let mut a = base.attempt.clone();
        a["id"] = json!(format!("b{i:012}"));
        if run {
            a["practice"] = json!("runThrough");
            a["runThroughId"] = json!(RUN);
            a["runThroughStartedAt"] = json!(1_794_036_000_000_i64);
        }
        json!({ "actionId": base.action_id, "attempt": a })
    };
    let single = json!([one(0, false)]);
    let forty = Value::Array((0..40).map(|i| one(i, true)).collect());
    let ids = |sent: &Value| -> Vec<String> {
        sent.as_array()
            .unwrap()
            .iter()
            .map(|s| s["attempt"]["id"].as_str().unwrap().to_owned())
            .collect()
    };
    let reset = async |sent: &Value| {
        sqlx::query("DELETE FROM flow_records WHERE flow_id = $1 AND id = ANY($2)")
            .bind(flow_id)
            .bind(ids(sent))
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("DELETE FROM flow_run_throughs WHERE flow_id = $1 AND id = $2")
            .bind(flow_id)
            .bind(RUN)
            .execute(&db)
            .await
            .unwrap();
    };

    for (name, sent, resend) in [
        ("送 1 筆", &single, false),
        ("送 40 筆（一次全上）", &forty, false),
        ("整批 40 筆收過的重送", &forty, true),
    ] {
        let n = sent.as_array().unwrap().len();
        if resend {
            assert_eq!(
                counts(
                    record(&state, flow_id, user_id, 0, sent.clone())
                        .await
                        .unwrap()
                ),
                (n, 0)
            );
        }
        let mut before = vec![];
        let mut after = vec![];
        // 3 對暖身不算；之後交錯，每一對輪流先跑哪一個
        for i in 0..PAIRS + 3 {
            let mut pair = [0.0; 2];
            for which in if i % 2 == 0 { [0, 1] } else { [1, 0] } {
                let start = Instant::now();
                let reply = if which == 0 {
                    record_before_349(&state, flow_id, user_id, 0, sent.clone()).await
                } else {
                    record(&state, flow_id, user_id, 0, sent.clone()).await
                };
                pair[which] = ms(start.elapsed());
                // 每次都確認全部收了（被退回的看起來比較快）
                assert_eq!(counts(reply.unwrap()), (n, 0), "{name}");
                if !resend {
                    reset(sent).await;
                }
            }
            if i >= 3 {
                before.push(pair[0]);
                after.push(pair[1]);
            }
        }
        let mut diff: Vec<f64> = after.iter().zip(&before).map(|(a, b)| a - b).collect();
        let faster = diff.iter().filter(|d| **d <= 0.0).count();
        println!(
            "{name}：#349 以前 中位數 {:.2} ms、改叫流程核心 中位數 {:.2} ms、每對相減（改叫 − 以前）中位數 {:+.2} ms、{faster}/{PAIRS} 對不比以前慢",
            median(&mut before),
            median(&mut after),
            median(&mut diff),
        );
    }
}
