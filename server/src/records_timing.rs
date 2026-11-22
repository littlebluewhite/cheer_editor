//! 量收紀錄要多久（#349，ADR 0018）：現在的 `record`（叫流程核心的 receiveRecords）跟 #349 以前的（Rust 自己的規則，
//! 照抄在下面，只給這裡比）在同一次跑裡交錯量，連 PostgreSQL。約 1 MB 的流程（tests/fixtures/big-flow.js，5,500 次紀錄）。
//! 三種：一次送 1 筆（1,001 對）、一次送 40 筆（一次全上）、整批 40 筆都是收過的重送（各 61 對）。
//! 改、刪、救回（#351）也一樣：現在的 `amend`（叫流程核心的 amendRecords）跟 #351 以前的（照抄在下面）比，改 1 筆、改 40 筆。
//! 只印數字、不比時間，所以平常不跑：
//! `npm run test:server -- --release --lib record_timing -- --ignored --nocapture`。結果寫在 ADR 0018。

use std::collections::HashMap;
use std::time::{Duration, Instant};

use super::*;
use crate::breach::BreachCheck;
use crate::clock::Clock;
use crate::flow_core::{FlowCore, summary};
use crate::mail::Mailer;
use serde_json::json;

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

/// #351 以前：跑一個紀錄的指令的結果（`runStepJson`）：成功（ok）帶跑完還在的紀錄。
#[derive(Deserialize)]
struct StepOutcome {
    kind: String,
    records: Option<Vec<Stored>>,
}

/// #349 以前收紀錄、#351 以前救回用的：這一次是全上的：同一次全上的同一個動作、同一組（騰翻、跳躍是同一個人）已經存了別的一筆（沒清掉的，id 不是 own），
/// 回先記的人的名字（沒有記的人的是 None）。資料庫也擋（遷移 0014）：存、救回、改之前先查，不會撞到。
async fn recorded_in_run(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    record: &Stored,
    own: &str,
) -> anyhow::Result<Option<Option<String>>> {
    let Some(run) = record.attempt.get("runThroughId").and_then(Value::as_str) else {
        return Ok(None);
    };
    let who = record.attempt.get("who").and_then(Value::as_str);
    let found: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT u.name FROM flow_records r LEFT JOIN users u ON u.id = r.recorded_by
         WHERE r.flow_id = $1 AND r.run_through_id = $2 AND r.action_id = $3 AND r.who = $4
           AND r.id <> $5 AND r.deleted_at IS NULL LIMIT 1",
    )
    .bind(flow_id)
    .bind(run)
    .bind(&record.action_id)
    .bind(who)
    .bind(own)
    .fetch_optional(&mut *tx)
    .await?;
    Ok(found.map(|(name,)| name))
}

/// #351 以前的 `amend`（照抄，只給量時間比；伺服器不叫）：讀整份紀錄（連清掉的）挑出送來的、Rust 自己判斷能不能動、
/// 每一筆進一次 QuickJS（runStepJson）、救回每筆用 SQL 查同一次全上的同一組、做完再讀整份紀錄回給送的人。
/// 以下是當時的註解：流程被刪了回 Deleted；被收回回 Revoked。不能動的（記錄者動別人的、檢視者）、
/// 已經清掉的（改、刪）、還在的（救回）都不算，不退回。照收到的先後做（鎖著那一列），後到的改贏。
/// 回這幾次現在在伺服器上的樣子（還在的；送的人換上它），改到的告訴房間裡別人（from 是這個連線）。
async fn amend_before_351(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    from: u64,
    amend: Amend,
) -> anyhow::Result<RoomMessage> {
    let mut tx = state.db.begin().await?;
    let Some((content, step)): Option<(String, i64)> =
        sqlx::query_as("SELECT content::text, step FROM flows WHERE id = $1 FOR UPDATE")
            .bind(flow_id)
            .fetch_optional(&mut *tx)
            .await?
    else {
        return Ok(RoomMessage::Deleted);
    };
    let Some(role) = role_of(&mut *tx, flow_id, user_id).await? else {
        return Ok(RoomMessage::Revoked);
    };
    let asked: HashSet<String> = match &amend {
        Amend::Change(attempts) => attempts
            .iter()
            .filter_map(|s| Some(s.attempt.get("id")?.as_str()?.to_owned()))
            .collect(),
        Amend::Delete(ids) | Amend::Restore(ids) => ids.iter().cloned().collect(),
    };
    let targets: HashMap<String, Kept> = rows(&mut *tx, flow_id, true)
        .await?
        .into_iter()
        .filter(|r| asked.contains(r.id()) && touchable(&r, role, user_id))
        .map(|r| (r.id().to_owned(), r))
        .collect();

    let now = state.clock.now();
    let mut change = RecordsChange::default();
    let mut changed = HashSet::new();
    match amend {
        Amend::Delete(ids) => {
            for id in ids {
                if targets.get(&id).is_some_and(|r| !r.gone) && !change.deleted.contains(&id) {
                    bury(&mut tx, flow_id, &id, now).await?;
                    amended(&mut tx, flow_id, &id, step).await?;
                    change.deleted.push(id);
                }
            }
        }
        Amend::Change(attempts) => {
            for s in attempts {
                let Some(r) = s
                    .attempt
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|id| targets.get(id))
                    .filter(|r| !r.gone)
                else {
                    continue;
                };
                let marks = s.attempt.get("marks").cloned().unwrap_or(Value::Null);
                let command =
                    json!({ "name": "changeAttempt", "args": [r.stored.action_id, r.id(), marks] });
                if let Some(new) = run_one(state, &content, Some(&r.stored), command).await? {
                    update(&mut tx, flow_id, &new, now).await?;
                    // 再送一次一樣的（回答沒收到）不算用手動過，不然之後復原、重做會照現在的留著。
                    if new.attempt != r.stored.attempt {
                        amended(&mut tx, flow_id, r.id(), step).await?;
                    }
                    changed.insert(r.id().to_owned());
                }
            }
        }
        Amend::Restore(ids) => {
            for id in ids {
                let Some(r) = targets.get(&id).filter(|r| r.gone) else {
                    continue;
                };
                // 刪掉之後同一次全上的這一組別人記了：只算先存的，不救回來。
                if recorded_in_run(&mut tx, flow_id, &r.stored, &id)
                    .await?
                    .is_some()
                {
                    continue;
                }
                let command = json!({ "name": "restoreAttempt", "args": [r.stored.action_id, r.stored.attempt, 0] });
                if let Some(new) = run_one(state, &content, None, command).await? {
                    update(&mut tx, flow_id, &new, now).await?;
                    amended(&mut tx, flow_id, &id, step).await?;
                    changed.insert(id);
                }
            }
        }
    }

    let now_kept = rows(&mut *tx, flow_id, false).await?;
    tx.commit().await?;
    let saved = now_kept
        .iter()
        .filter(|r| asked.contains(r.id()))
        .map(|r| r.seen_by(user_id))
        .collect();
    change.changed = now_kept
        .into_iter()
        .filter(|r| changed.contains(r.id()))
        .collect();
    if !change.is_empty() {
        state.rooms.tell(
            flow_id,
            RoomEvent::RecordsChanged {
                from,
                change: change.into(),
            },
        );
    }
    Ok(RoomMessage::RecordsSaved {
        saved,
        dropped: vec![],
    })
}

/// 用流程核心對一次跑一個紀錄的指令（改記號、救回）：放回流程的只有 record（救回是沒有）。
/// 收了回跑完的那一次；被擋、看不懂、跑完不在了是 None。
async fn run_one(
    state: &AppState,
    content: &str,
    record: Option<&Stored>,
    command: Value,
) -> anyhow::Result<Option<Stored>> {
    let records = serde_json::to_string(&record.into_iter().collect::<Vec<_>>())?;
    let Ok(result) = state
        .core
        .run_step(
            content.to_owned(),
            records,
            json!([command]).to_string(),
            String::new(),
        )
        .await
    else {
        return Ok(None);
    };
    let outcome: StepOutcome = serde_json::from_str(&result)?;
    if outcome.kind != "ok" {
        return Ok(None);
    }
    Ok(outcome.records.unwrap_or_default().into_iter().next())
}

/// #351 以前的：這個權限的人能不能改、刪、救回這一次：擁有者、編輯者都能；記錄者只能動自己記的。
fn touchable(r: &Kept, role: Role, user_id: i64) -> bool {
    role.can_edit() || (role.can_record() && r.recorded_by == Some(user_id))
}

/// 收了幾筆、沒收幾筆。
fn counts(reply: RoomMessage) -> (usize, usize) {
    match reply {
        RoomMessage::RecordsSaved { saved, dropped } => (saved.len(), dropped.len()),
        _ => panic!("不是 RecordsSaved"),
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

#[sqlx::test]
#[ignore = "量時間用，手動跑"]
async fn record_timing(db: sqlx::PgPool) {
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

    // 送 1 筆兩邊差不到 0.2 ms，要多跑幾對才看得出來
    for (name, sent, resend, pairs) in [
        ("送 1 筆", &single, false, 1001),
        ("送 40 筆（一次全上）", &forty, false, 61),
        ("整批 40 筆收過的重送", &forty, true, 61),
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
        for i in 0..pairs + 3 {
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
        let diff: Vec<f64> = after.iter().zip(&before).map(|(a, b)| a - b).collect();
        let faster = diff.iter().filter(|d| **d <= 0.0).count();
        println!(
            "{name}：#349 以前 中位數 {:.2} ms、改叫流程核心 中位數 {:.2} ms、每對相減（改叫 − 以前）中位數 {:+.2} ms、{faster}/{pairs} 對不比以前慢",
            summary(before).1,
            summary(after).1,
            summary(diff).1,
        );
    }

    // 改記號（#351）：存著的前 1、40 次（40 個不同的動作），每個環節的記號都改成 ✓
    // （big-flow.js 存的每一次都有 △、✗；全部 ✓ 一定照「改一次」的規則留，✗ 後面接 ✓ 會被拿掉）。
    // 每次都確認改成了（被擋下的看起來比較快），計時外把記號、用手動過的步改回來，下一次照樣是真的改。
    let changed = |n: usize| -> Vec<Stored> {
        big.records[..n]
            .iter()
            .map(|r| {
                let mut s = r.clone();
                let marks = s.attempt["marks"].as_object_mut().unwrap();
                for m in marks.values_mut() {
                    *m = json!("✓");
                }
                s
            })
            .collect()
    };
    let put_back = async |n: usize| {
        for r in &big.records[..n] {
            sqlx::query(
                "UPDATE flow_records SET marks = $3::json, amended_step = NULL WHERE flow_id = $1 AND id = $2",
            )
            .bind(flow_id)
            .bind(r.attempt["id"].as_str().unwrap())
            .bind(r.attempt["marks"].to_string())
            .execute(&db)
            .await
            .unwrap();
        }
    };
    for (name, n, pairs) in [("改 1 筆", 1, 61), ("改 40 筆", 40, 61)] {
        let sent = changed(n);
        let mut before = vec![];
        let mut after = vec![];
        for i in 0..pairs + 3 {
            let mut pair = [0.0; 2];
            for which in if i % 2 == 0 { [0, 1] } else { [1, 0] } {
                let amend = Amend::Change(sent.clone());
                let start = Instant::now();
                let reply = if which == 0 {
                    amend_before_351(&state, flow_id, user_id, 0, amend).await
                } else {
                    super::amend(&state, flow_id, user_id, 0, amend).await
                };
                pair[which] = ms(start.elapsed());
                let RoomMessage::RecordsSaved { saved, dropped } = reply.unwrap() else {
                    panic!("不是 RecordsSaved");
                };
                assert!(dropped.is_empty(), "{name}");
                assert_eq!(saved.len(), n, "{name}");
                for (s, want) in saved.iter().zip(&sent) {
                    assert_eq!(s.attempt["marks"], want.attempt["marks"], "{name}：沒改成");
                }
                put_back(n).await;
            }
            if i >= 3 {
                before.push(pair[0]);
                after.push(pair[1]);
            }
        }
        let diff: Vec<f64> = after.iter().zip(&before).map(|(a, b)| a - b).collect();
        let faster = diff.iter().filter(|d| **d <= 0.0).count();
        println!(
            "{name}：#351 以前 中位數 {:.2} ms、改叫流程核心 中位數 {:.2} ms、每對相減（改叫 − 以前）中位數 {:+.2} ms、{faster}/{pairs} 對不比以前慢",
            summary(before).1,
            summary(after).1,
            summary(diff).1,
        );
    }
}
