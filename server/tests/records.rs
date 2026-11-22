// 雲端流程的成功率紀錄（#257，ADR 0011）：記一次從房間送、存起來、記下誰記的；同一個 id 不變兩筆；
// 照「記一次」的規則丟記號、整筆不存；跑一步時紀錄跟著清；別人記的馬上看到；檢視者不能記。
// 開一台真的伺服器（網路埠），HTTP 用 oneshot、房間用 WebSocket。要有 PostgreSQL：見 tests/db.rs 開頭。
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use chrono::{DateTime, TimeZone, Utc};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use tower::ServiceExt;

use cheer_server::accounts::create_admin;
use cheer_server::breach::BreachCheck;
use cheer_server::clock::Clock;
use cheer_server::flow_core::{FINGERPRINT, FlowCore};
use cheer_server::mail::Mailer;
use cheer_server::{AppState, app};

const SITE: &str = "https://cheer.example";
const GOOD: &str = "我們這一隊今年一定會贏 go go";

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct Server {
    state: AppState,
    site: tempfile::TempDir,
    addr: std::net::SocketAddr,
}

/// 登入的一個人：要帶的 Cookie、email。
struct User {
    cookie: String,
    email: &'static str,
}

impl Server {
    async fn new(db: sqlx::PgPool) -> Self {
        let now = Arc::new(Mutex::new(
            Utc.with_ymd_and_hms(2026, 11, 7, 9, 0, 0).unwrap(),
        ));
        let state = AppState {
            db,
            mailer: Mailer::memory(),
            breach: BreachCheck::list(Vec::<&str>::new()),
            clock: Clock::new(move || -> DateTime<Utc> { *now.lock().unwrap() }),
            site_url: SITE.into(),
            core: FlowCore::start().unwrap(),
            mail_limit: Default::default(),
            rooms: Default::default(),
            music: None,
        };
        let site = tempfile::tempdir().unwrap();
        std::fs::write(site.path().join("200.html"), "spa entry").unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let router = app(state.clone(), site.path());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self { state, site, addr }
    }

    async fn send(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        cookie: &str,
    ) -> (StatusCode, Value) {
        let req = Request::builder()
            .method(method)
            .uri(path)
            .header("sec-fetch-site", "same-origin")
            .header("cookie", cookie);
        let req = match body {
            Some(b) => req
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let res = app(self.state.clone(), self.site.path())
            .oneshot(req)
            .await
            .unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    /// 開一個帳號、設好密碼、登入。最後一個開的是管理員（create-admin 會換管理員）。
    async fn user(&self, email: &'static str, name: &str) -> User {
        create_admin(&self.state, email, Some(name)).await.unwrap();
        let mail = self.state.mailer.sent().last().cloned().unwrap();
        let link = format!("{SITE}/set-password#");
        let at = mail.text.find(&link).unwrap() + link.len();
        let token = mail.text[at..].split_whitespace().next().unwrap();
        let body = json!({ "token": token, "password": GOOD });
        self.send("POST", "/api/set-password", Some(body), "").await;
        let req = Request::post("/api/login")
            .header("sec-fetch-site", "same-origin")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({ "email": email, "password": GOOD }).to_string(),
            ))
            .unwrap();
        let res = app(self.state.clone(), self.site.path())
            .oneshot(req)
            .await
            .unwrap();
        let set_cookie = res.headers().get(header::SET_COOKIE).unwrap();
        let cookie = set_cookie
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        User { cookie, email }
    }

    async fn create(&self, owner: &User, name: &str) -> String {
        let input = json!({ "name": name, "field": { "strips": 9, "layout": "vertical" } });
        let (status, made) = self
            .send("POST", "/api/flows", Some(input), &owner.cookie)
            .await;
        assert_eq!(status, StatusCode::CREATED);
        made["id"].as_str().unwrap().to_owned()
    }

    async fn share(&self, owner: &User, id: &str, email: &str, role: &str) -> (StatusCode, Value) {
        let body = json!({ "email": email, "role": role });
        self.send(
            "POST",
            &format!("/api/flows/{id}/people"),
            Some(body),
            &owner.cookie,
        )
        .await
    }

    async fn connect(&self, who: &User, id: &str) -> Result<Socket, StatusCode> {
        let mut req = format!("ws://{}/api/flows/{id}/room", self.addr)
            .into_client_request()
            .unwrap();
        req.headers_mut()
            .insert("sec-fetch-site", "same-origin".parse().unwrap());
        req.headers_mut()
            .insert("cookie", who.cookie.parse().unwrap());
        match tokio_tungstenite::connect_async(req).await {
            Ok((socket, _)) => Ok(socket),
            Err(tokio_tungstenite::tungstenite::Error::Http(res)) => Err(res.status()),
            Err(e) => panic!("{e}"),
        }
    }

    /// 連上、打招呼，回房間和伺服器說的第一句。
    async fn join(&self, who: &User, id: &str) -> (Socket, Value) {
        let mut socket = self.connect(who, id).await.unwrap();
        let hello =
            json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": who.email, "seen": 0 });
        say(&mut socket, hello).await;
        let first = hear(&mut socket).await;
        (socket, first)
    }

    /// 王教練（擁有者）建一支有 Lib 的流程（三個環節、兩組，照 fixtures/sample-steps.json 的第 2–7 步），
    /// 分享給這些人（email、權限）。回流程 id。
    async fn sample(&self, owner: &User, shares: &[(&User, &str)]) -> String {
        let id = self.create(owner, "全國賽").await;
        let steps: Vec<Value> = serde_json::from_str(SAMPLE_STEPS).unwrap();
        let (mut room, _) = self.join(owner, &id).await;
        for (n, s) in steps[1..7].iter().enumerate() {
            let reply = step(
                &mut room,
                s["stepId"].as_str().unwrap(),
                n as i64,
                s["commands"].clone(),
            )
            .await;
            assert_eq!(reply["kind"], "accepted", "{reply}");
        }
        for (who, role) in shares {
            assert_eq!(
                self.share(owner, &id, who.email, role).await.0,
                StatusCode::OK
            );
        }
        id
    }

    /// 打開一支流程拿到的紀錄。
    async fn records(&self, who: &User, id: &str) -> Vec<Value> {
        let (_, got) = self
            .send("GET", &format!("/api/flows/{id}"), None, &who.cookie)
            .await;
        got["records"].as_array().unwrap().clone()
    }

    /// 資料庫裡這支流程的紀錄（含清掉的）：id、記的人的 email、清掉了沒。
    async fn rows(&self, id: &str) -> Vec<(String, Option<String>, bool)> {
        sqlx::query_as(
            "SELECT r.id, u.email, r.deleted_at IS NOT NULL FROM flow_records r
             LEFT JOIN users u ON u.id = r.recorded_by WHERE r.flow_id = $1 ORDER BY r.seq",
        )
        .bind(id)
        .fetch_all(&self.state.db)
        .await
        .unwrap()
    }
}

/// 範例流程：從沒有流程開始，一步一步建出來（跟 tests/flow_core.rs 用的同一份）。
const SAMPLE_STEPS: &str = include_str!("fixtures/sample-steps.json");
/// 範例流程裡的 Lib、它的三個環節（上法、中段、下法）、第 1 組、第 2 組。
const LIB: &str = "x2l8axo41g3ph";
const LOAD: &str = "pq4lkns0v20ec";
const HOLD: &str = "p33qu2fx2u0ue";
const DISMOUNT: &str = "p8jok7d9wl8v2";
const SQUAD_1: &str = "g7sil583dmpgv";
const SQUAD_2: &str = "gre8zqixysbk8";

/// 手機發的一次：11/4 分段練、整個做。
fn drill(id: &str, who: &str, marks: Value) -> Value {
    json!({ "actionId": LIB, "attempt": {
        "id": id, "date": "2026-11-04", "who": who, "practice": "drill", "whole": true, "marks": marks
    } })
}

/// 送一串紀錄，回伺服器的回答。
async fn record(socket: &mut Socket, attempts: Value) -> Value {
    say(socket, json!({ "kind": "record", "attempts": attempts })).await;
    hear(socket).await
}

/// 送一步，回伺服器的回答。
async fn step(socket: &mut Socket, step_id: &str, seen: i64, commands: Value) -> Value {
    let message = json!({ "kind": "step", "stepId": step_id, "seen": seen, "commands": commands });
    say(socket, message).await;
    hear(socket).await
}

fn ids(records: &[Value]) -> Vec<&str> {
    records
        .iter()
        .map(|r| r["attempt"]["id"].as_str().unwrap())
        .collect()
}

#[sqlx::test]
async fn a_recording_is_saved_with_who_recorded_it_and_others_see_it_right_away(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    let (mut phone, _) = s.join(&lin, &id).await;

    let one = drill(
        "tabc123def456",
        SQUAD_1,
        json!({ LOAD: "✓", HOLD: "✓", DISMOUNT: "△" }),
    );
    let reply = record(&mut phone, json!([one])).await;
    assert_eq!(reply["kind"], "recordsSaved");
    assert_eq!(reply["dropped"], json!([]));
    assert_eq!(
        reply["saved"],
        json!([{ "actionId": LIB, "attempt": one["attempt"], "by": null, "mine": true }])
    );

    // 王教練開著的房間馬上收到，寫林教練的名字。
    let heard = hear(&mut coach).await;
    assert_eq!(
        heard,
        json!({ "kind": "newRecords", "records": [
        { "actionId": LIB, "attempt": one["attempt"], "by": "林教練", "mine": false }
    ] })
    );

    // 打開流程時拿得到：別人記的寫名字，自己記的不寫。
    assert_eq!(s.records(&wang, &id).await[0]["by"], "林教練");
    assert_eq!(s.records(&lin, &id).await[0]["by"], Value::Null);
    assert_eq!(s.records(&lin, &id).await[0]["attempt"], one["attempt"]);
    assert_eq!(
        s.rows(&id).await,
        vec![("tabc123def456".into(), Some(lin.email.into()), false)]
    );
}

#[sqlx::test]
async fn a_resend_after_being_made_a_viewer_still_returns_the_stored_record(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let rec = s.user("rec@example.com", "記錄者").await;
    let id = s.sample(&wang, &[(&rec, "recorder")]).await;
    let one = drill("tdowngrade010", SQUAD_1, json!({ LOAD: "✓" }));
    let (mut phone, _) = s.join(&rec, &id).await;
    let first = record(&mut phone, json!([one])).await;

    // 「收了」沒收到就斷線，這時被改成只能看；連回來重送：回存著的那一筆，新的才不收
    sqlx::query("UPDATE flow_permissions SET role = 'viewer' WHERE flow_id = $1")
        .bind(&id)
        .execute(&s.state.db)
        .await
        .unwrap();
    let (mut again, _) = s.join(&rec, &id).await;
    let fresh = drill("tdowngrade020", SQUAD_1, json!({ LOAD: "✓" }));
    let second = record(&mut again, json!([one, fresh])).await;

    assert_eq!(second["saved"], first["saved"]);
    assert_eq!(
        second["dropped"],
        json!([{ "id": "tdowngrade020", "message": "你只能看這支流程" }])
    );
}

#[sqlx::test]
async fn a_run_through_recorded_alone_keeps_its_id_and_start_time(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut phone, _) = s.join(&wang, &id).await;
    let run = |id: &str, who: &str| {
        json!({ "actionId": LIB, "attempt": {
            "id": id, "date": "2026-11-04", "who": who, "practice": "runThrough",
            "runThroughId": "rabc123def456", "runThroughStartedAt": 1_794_036_000_000_i64,
            "whole": true, "marks": { LOAD: "✓", HOLD: "✓", DISMOUNT: "✓" }
        } })
    };
    let both = json!([run("tone111111110", SQUAD_1), run("ttwo222222220", SQUAD_2)]);

    let reply = record(&mut phone, both.clone()).await;
    assert_eq!(reply["saved"].as_array().unwrap().len(), 2);
    let got = s.records(&wang, &id).await;
    assert_eq!(got[0]["attempt"], both[0]["attempt"]);
    assert_eq!(got[1]["attempt"], both[1]["attempt"]);
}

/// 第 10 版起整個做的一次記著空著的環節（blanks，✗ 之後沒做的）：存進去、改記號、打開都帶著，不會變成「那時還沒有這個環節」。
#[sqlx::test]
async fn blank_phases_are_kept_when_saved_and_changed(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut phone, _) = s.join(&wang, &id).await;
    let mut fail = drill("tblank0000001", SQUAD_1, json!({ LOAD: "✗" }));
    fail["attempt"]["blanks"] = json!([HOLD, DISMOUNT]);

    let reply = record(&mut phone, json!([fail])).await;
    assert_eq!(reply["saved"].as_array().unwrap().len(), 1);
    assert_eq!(reply["saved"][0]["attempt"], fail["attempt"]);
    assert_eq!(s.records(&wang, &id).await[0]["attempt"], fail["attempt"]);

    let mut fixed = fail.clone();
    fixed["attempt"]["marks"] = json!({ LOAD: "△", HOLD: "✗" });
    fixed["attempt"]["blanks"] = json!([DISMOUNT]);
    change(&mut phone, json!([fixed])).await;
    assert_eq!(s.records(&wang, &id).await[0]["attempt"], fixed["attempt"]);
}

#[sqlx::test]
async fn marks_on_deleted_phases_are_dropped_and_gone_squads_are_not_saved(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut room, _) = s.join(&wang, &id).await;
    // 教練刪掉下法；第 2 組的人都換到第 1 組（第 2 組沒有人了）。
    let delete = json!([{ "name": "deletePhase", "args": [LIB, DISMOUNT], "options": { "confirmed": true } }]);
    assert_eq!(
        step(&mut room, "stepdelete01", 6, delete).await["kind"],
        "accepted"
    );
    let people = json!(["mynspp181tezh", "msw4sio1bgnxb"]);
    let merge = json!([{ "name": "setSquad", "args": [LIB, people, 1] }]);
    assert_eq!(
        step(&mut room, "stepmerge001", 7, merge).await["kind"],
        "accepted"
    );

    // 手機上記的時候還沒看到教練改的。
    let reply = record(
        &mut room,
        json!([
            drill(
                "tkept11111110",
                SQUAD_1,
                json!({ LOAD: "✓", HOLD: "△", DISMOUNT: "✗" })
            ),
            drill("tonly22222220", SQUAD_1, json!({ DISMOUNT: "✓" })),
            drill("tgone33333330", SQUAD_2, json!({ LOAD: "✓" })),
        ]),
    )
    .await;
    assert_eq!(
        ids(reply["saved"].as_array().unwrap()),
        vec!["tkept11111110"]
    );
    assert_eq!(
        reply["saved"][0]["attempt"]["marks"],
        json!({ LOAD: "✓", HOLD: "△" })
    );
    assert_eq!(
        reply["dropped"],
        json!([
            { "id": "tonly22222220", "message": "記號打的環節都被刪掉了" },
            { "id": "tgone33333330", "message": "這一組沒有人了" },
        ])
    );
    assert_eq!(ids(&s.records(&wang, &id).await), vec!["tkept11111110"]);
}

#[sqlx::test]
async fn clearing_and_recounting_clears_stored_records_and_late_old_ones_still_count(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut room, _) = s.join(&wang, &id).await;
    let before = json!([
        drill("tclear1111110", SQUAD_1, json!({ LOAD: "✓" })),
        drill("tstay22222220", SQUAD_2, json!({ LOAD: "✗" })),
    ]);
    record(&mut room, before).await;

    // 第 2 組的小B 換到第 1 組，教練選「清掉重算」：兩組換了人，紀錄都清掉。
    let mv = json!([{ "name": "setSquad", "args": [LIB, ["mynspp181tezh"], 1], "options": { "records": "clear" } }]);
    assert_eq!(
        step(&mut room, "stepmove0001", 6, mv).await["kind"],
        "accepted"
    );
    hear(&mut room).await;
    assert_eq!(s.records(&wang, &id).await, Vec::<Value>::new());
    assert!(s.rows(&id).await.iter().all(|(_, _, gone)| *gone));

    // 清掉前記的、之後才傳上來的：組還在就照收。清掉的那一筆重送不會加回來。
    let late = drill("tlate11111110", SQUAD_1, json!({ LOAD: "△" }));
    let again = drill("tclear1111110", SQUAD_1, json!({ LOAD: "✓" }));
    let reply = record(&mut room, json!([late, again])).await;
    assert_eq!(
        ids(reply["saved"].as_array().unwrap()),
        vec!["tlate11111110"]
    );
    assert_eq!(reply["dropped"], json!([]));
    assert_eq!(ids(&s.records(&wang, &id).await), vec!["tlate11111110"]);
}

#[sqlx::test]
async fn deleting_a_phase_with_records_trims_the_stored_marks(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut room, _) = s.join(&wang, &id).await;
    record(
        &mut room,
        json!([
            drill(
                "tboth11111110",
                SQUAD_1,
                json!({ LOAD: "✓", DISMOUNT: "✗" })
            ),
            drill("tonly22222220", SQUAD_1, json!({ DISMOUNT: "✓" })),
        ]),
    )
    .await;

    let delete = json!([{ "name": "deletePhase", "args": [LIB, DISMOUNT], "options": { "confirmed": true } }]);
    assert_eq!(
        step(&mut room, "stepdelete01", 6, delete).await["kind"],
        "accepted"
    );

    let got = s.records(&wang, &id).await;
    assert_eq!(ids(&got), vec!["tboth11111110"]);
    assert_eq!(got[0]["attempt"]["marks"], json!({ LOAD: "✓" }));
    assert!(s.rows(&id).await[1].2);
    // 編排裡不帶紀錄。
    let (_, flow) = s
        .send("GET", &format!("/api/flows/{id}"), None, &wang.cookie)
        .await;
    assert_eq!(
        flow["flow"]["actions"][0]["successRate"]["records"],
        json!([])
    );
}

#[sqlx::test]
async fn a_viewer_cannot_record_but_a_recorder_can(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let rec = s.user("rec@example.com", "記錄者").await;
    let view = s.user("view@example.com", "檢視者").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s
        .sample(&wang, &[(&rec, "recorder"), (&view, "viewer")])
        .await;

    let (mut room, _) = s.join(&view, &id).await;
    let reply = record(
        &mut room,
        json!([drill("tviewer000010", SQUAD_1, json!({ LOAD: "✓" }))]),
    )
    .await;
    assert_eq!(
        reply,
        json!({ "kind": "recordsSaved", "saved": [], "dropped": [
        { "id": "tviewer000010", "message": "你只能看這支流程" }
    ] })
    );

    let (mut room, _) = s.join(&rec, &id).await;
    let reply = record(
        &mut room,
        json!([drill("trecorder0010", SQUAD_2, json!({ LOAD: "✓" }))]),
    )
    .await;
    assert_eq!(
        ids(reply["saved"].as_array().unwrap()),
        vec!["trecorder0010"]
    );

    // 檢視者看得到（總表）。
    assert_eq!(ids(&s.records(&view, &id).await), vec!["trecorder0010"]);
    assert_eq!(s.rows(&id).await.len(), 1);
}

#[sqlx::test]
async fn a_record_sent_after_the_flow_was_deleted_is_answered_deleted(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut phone, _) = s.join(&wang, &id).await;

    // 剛被刪、房間還沒說之前送到的：伺服器鎖那一列時找不到流程
    sqlx::query("DELETE FROM flows WHERE id = $1")
        .bind(&id)
        .execute(&s.state.db)
        .await
        .unwrap();
    let one = drill("tlate11111110", SQUAD_1, json!({ LOAD: "✓" }));
    assert_eq!(
        record(&mut phone, json!([one])).await,
        json!({ "kind": "deleted" })
    );
}

#[sqlx::test]
async fn a_batch_the_flow_core_cannot_read_is_dropped_with_a_sentence(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut phone, _) = s.join(&wang, &id).await;
    let good = drill("tgood11111110", SQUAD_1, json!({ LOAD: "✓" }));
    let mut bad = drill("tbad222222220", SQUAD_1, json!({ LOAD: "✗" }));
    bad["attempt"]["blanks"] = json!(3);

    // 流程核心看不懂（空著的環節不是陣列）：這一批都不收，寫中文句子
    let reply = record(&mut phone, json!([good, bad])).await;
    assert_eq!(reply["saved"], json!([]));
    assert_eq!(
        reply["dropped"],
        json!([
            { "id": "tgood11111110", "message": "伺服器看不懂這一筆" },
            { "id": "tbad222222220", "message": "伺服器看不懂這一筆" },
        ])
    );
    assert_eq!(s.rows(&id).await.len(), 0);
}

/// 改幾次的記號（送手機上改好的那幾次），回伺服器的回答。
async fn change(socket: &mut Socket, attempts: Value) -> Value {
    say(
        socket,
        json!({ "kind": "changeRecords", "attempts": attempts }),
    )
    .await;
    hear(socket).await
}

/// 刪幾次，回伺服器的回答。
async fn delete(socket: &mut Socket, ids: Value) -> Value {
    say(socket, json!({ "kind": "deleteRecords", "ids": ids })).await;
    hear(socket).await
}

/// 救回剛刪掉的幾次，回伺服器的回答。
async fn restore(socket: &mut Socket, ids: Value) -> Value {
    say(socket, json!({ "kind": "restoreRecords", "ids": ids })).await;
    hear(socket).await
}

/// 從流程檔傳上來的一次（沒有記的人）：直接放進資料庫（傳上雲端帶紀錄不在這張）。
async fn from_file(s: &Server, flow_id: &str, one: &Value) {
    let a = &one["attempt"];
    sqlx::query(
        "INSERT INTO flow_records (flow_id, id, action_id, who, marks, whole, date, updated_at)
         VALUES ($1, $2, $3, $4, $5::json, $6, $7, now())",
    )
    .bind(flow_id)
    .bind(a["id"].as_str().unwrap())
    .bind(one["actionId"].as_str().unwrap())
    .bind(a["who"].as_str().unwrap())
    .bind(a["marks"].to_string())
    .bind(a["whole"].as_bool().unwrap())
    .bind(a["date"].as_str().unwrap())
    .execute(&s.state.db)
    .await
    .unwrap();
}

/// 一次換了記號。
fn remarked(one: &Value, marks: Value) -> Value {
    let mut changed = one.clone();
    changed["attempt"]["marks"] = marks;
    changed
}

/// 每一次的某個環節的記號。
fn marks_of<'a>(records: &'a Value, phase: &str) -> Vec<&'a Value> {
    records
        .as_array()
        .unwrap()
        .iter()
        .map(|r| &r["attempt"]["marks"][phase])
        .collect()
}

/// 接線：沒有記的人（recorded_by 是 NULL）傳給流程核心是沒帶 by，回給前端的 by 是 null（規則的表格在 room-records.test.ts）。
#[sqlx::test]
async fn only_editors_and_the_owner_can_touch_records_with_no_recorder(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let rec = s.user("rec@example.com", "記錄者").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&rec, "recorder")]).await;
    let filed = drill("tfile33333330", SQUAD_2, json!({ LOAD: "✓" }));
    from_file(&s, &id, &filed).await;

    let (mut phone, _) = s.join(&rec, &id).await;
    delete(&mut phone, json!(["tfile33333330"])).await;
    assert_eq!(s.records(&wang, &id).await.len(), 1);

    let (mut coach, _) = s.join(&wang, &id).await;
    let reply = change(&mut coach, json!([remarked(&filed, json!({ LOAD: "△" }))])).await;
    assert_eq!(reply["saved"][0]["attempt"]["marks"], json!({ LOAD: "△" }));
    assert_eq!(reply["saved"][0]["by"], Value::Null);
    delete(&mut coach, json!(["tfile33333330"])).await;
    assert_eq!(s.records(&wang, &id).await, Vec::<Value>::new());
}

#[sqlx::test]
async fn a_recorder_cannot_change_or_delete_others_records_but_an_editor_can(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let rec = s.user("rec@example.com", "記錄者").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s
        .sample(&wang, &[(&rec, "recorder"), (&lin, "editor")])
        .await;
    let wangs = drill("twang11111110", SQUAD_1, json!({ LOAD: "✓" }));
    let recs = drill("trec222222220", SQUAD_1, json!({ LOAD: "✓" }));
    let filed = drill("tfile33333330", SQUAD_2, json!({ LOAD: "✓" }));
    let (mut coach, _) = s.join(&wang, &id).await;
    record(&mut coach, json!([wangs])).await;
    let (mut phone, _) = s.join(&rec, &id).await;
    record(&mut phone, json!([recs])).await;
    from_file(&s, &id, &filed).await;

    // 記錄者：別人記的、沒有記的人的都動不了（回伺服器現在的樣子）；自己記的可以。
    let reply = change(
        &mut phone,
        json!([
            remarked(&wangs, json!({ LOAD: "✗" })),
            remarked(&filed, json!({ LOAD: "✗" })),
            remarked(&recs, json!({ LOAD: "△" }))
        ]),
    )
    .await;
    assert_eq!(reply["kind"], "recordsSaved");
    assert_eq!(
        ids(reply["saved"].as_array().unwrap()),
        vec!["twang11111110", "trec222222220", "tfile33333330"]
    );
    assert_eq!(marks_of(&reply["saved"], LOAD), vec!["✓", "△", "✓"]);
    let reply = delete(&mut phone, json!(["twang11111110", "tfile33333330"])).await;
    assert_eq!(
        ids(reply["saved"].as_array().unwrap()),
        vec!["twang11111110", "tfile33333330"]
    );
    assert_eq!(s.records(&wang, &id).await.len(), 3);

    // 打開時拿得到哪幾次是自己記的。
    let got = s.records(&rec, &id).await;
    let mine: Vec<&Value> = got.iter().map(|r| &r["mine"]).collect();
    assert_eq!(mine, vec![&json!(false), &json!(true), &json!(false)]);

    // 編輯者：誰記的都能改、刪，沒有記的人的也可以。
    let (mut editor, _) = s.join(&lin, &id).await;
    let reply = change(&mut editor, json!([remarked(&wangs, json!({ LOAD: "✗" }))])).await;
    assert_eq!(reply["saved"][0]["attempt"]["marks"], json!({ LOAD: "✗" }));
    assert_eq!(reply["saved"][0]["by"], "王教練");
    let reply = delete(&mut editor, json!(["tfile33333330", "trec222222220"])).await;
    assert_eq!(reply["saved"], json!([]));
    assert_eq!(ids(&s.records(&wang, &id).await), vec!["twang11111110"]);
}

#[sqlx::test]
async fn when_two_people_change_the_same_record_the_later_one_wins(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "editor")]).await;
    let one = drill("tone111111110", SQUAD_1, json!({ LOAD: "✓" }));
    let (mut a, _) = s.join(&wang, &id).await;
    let (mut b, _) = s.join(&lin, &id).await;
    record(&mut a, json!([one])).await;
    hear(&mut b).await;

    let first = change(&mut a, json!([remarked(&one, json!({ LOAD: "✗" }))])).await;
    assert_eq!(first["saved"][0]["attempt"]["marks"], json!({ LOAD: "✗" }));
    // 林教練馬上看到王教練改的。
    let heard = hear(&mut b).await;
    assert_eq!(heard["kind"], "recordsChanged");
    assert_eq!(
        heard["changed"][0]["attempt"]["marks"],
        json!({ LOAD: "✗" })
    );
    assert_eq!(heard["changed"][0]["by"], "王教練");
    assert_eq!(heard["deleted"], json!([]));

    // 林教練後送到：不退回，他的算。
    let second = change(&mut b, json!([remarked(&one, json!({ LOAD: "△" }))])).await;
    assert_eq!(second["saved"][0]["attempt"]["marks"], json!({ LOAD: "△" }));
    assert_eq!(second["dropped"], json!([]));
    assert_eq!(
        hear(&mut a).await["changed"][0]["attempt"]["marks"],
        json!({ LOAD: "△" })
    );
    assert_eq!(
        s.records(&wang, &id).await[0]["attempt"]["marks"],
        json!({ LOAD: "△" })
    );
}

#[sqlx::test]
async fn a_deleted_record_does_not_come_back_from_late_adds_or_changes(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "editor")]).await;
    let one = drill("tone111111110", SQUAD_1, json!({ LOAD: "✓" }));
    let (mut a, _) = s.join(&wang, &id).await;
    let (mut b, _) = s.join(&lin, &id).await;
    record(&mut a, json!([one])).await;
    hear(&mut b).await;

    let reply = delete(&mut a, json!(["tone111111110"])).await;
    assert_eq!(reply["saved"], json!([]));
    assert_eq!(
        hear(&mut b).await,
        json!({ "kind": "recordsChanged", "changed": [], "deleted": ["tone111111110"] })
    );

    // 林教練斷網時改的、重送的新增，晚到：都不算。
    let late = change(&mut b, json!([remarked(&one, json!({ LOAD: "✗" }))])).await;
    assert_eq!(late["saved"], json!([]));
    let again = record(&mut b, json!([one])).await;
    assert_eq!(again["saved"], json!([]));
    assert_eq!(s.records(&wang, &id).await, Vec::<Value>::new());
    assert!(s.rows(&id).await[0].2);

    // 刪的人按「救回」才拿回來，別人也看到。
    let back = restore(&mut a, json!(["tone111111110"])).await;
    assert_eq!(
        ids(back["saved"].as_array().unwrap()),
        vec!["tone111111110"]
    );
    assert_eq!(
        hear(&mut b).await["changed"][0]["attempt"]["id"],
        "tone111111110"
    );
    assert_eq!(ids(&s.records(&wang, &id).await), vec!["tone111111110"]);
}

#[sqlx::test]
async fn records_from_a_revoked_recorder_are_not_taken(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let rec = s.user("rec@example.com", "記錄者").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&rec, "recorder")]).await;
    let (mut phone, _) = s.join(&rec, &id).await;
    record(
        &mut phone,
        json!([drill("trec222222220", SQUAD_1, json!({ LOAD: "✓" }))]),
    )
    .await;

    // 剛被收回、房間還沒說之前送到的（收回的通知跟紀錄同時到）：伺服器照資料庫的權限擋。
    sqlx::query("DELETE FROM flow_permissions WHERE flow_id = $1")
        .bind(&id)
        .execute(&s.state.db)
        .await
        .unwrap();
    let late = drill("tlate11111110", SQUAD_1, json!({ LOAD: "✓" }));
    assert_eq!(record(&mut phone, json!([late])).await["kind"], "revoked");
    assert_eq!(
        s.connect(&rec, &id).await.err(),
        Some(StatusCode::NOT_FOUND)
    );
    assert_eq!(ids(&s.records(&wang, &id).await), vec!["trec222222220"]);
    assert_eq!(s.rows(&id).await.len(), 1);
}

#[sqlx::test]
async fn a_revoked_recorder_cannot_delete(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let rec = s.user("rec@example.com", "記錄者").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&rec, "recorder")]).await;
    let (mut phone, _) = s.join(&rec, &id).await;
    record(
        &mut phone,
        json!([drill("trec222222220", SQUAD_1, json!({ LOAD: "✓" }))]),
    )
    .await;
    sqlx::query("DELETE FROM flow_permissions WHERE flow_id = $1")
        .bind(&id)
        .execute(&s.state.db)
        .await
        .unwrap();
    assert_eq!(
        delete(&mut phone, json!(["trec222222220"])).await["kind"],
        "revoked"
    );
    assert_eq!(ids(&s.records(&wang, &id).await), vec!["trec222222220"]);
}

#[sqlx::test]
async fn others_see_records_a_step_cleared_or_trimmed(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    let (mut phone, _) = s.join(&lin, &id).await;
    record(
        &mut phone,
        json!([
            drill(
                "tboth11111110",
                SQUAD_1,
                json!({ LOAD: "✓", DISMOUNT: "✗" })
            ),
            drill("tonly22222220", SQUAD_1, json!({ DISMOUNT: "✓" })),
        ]),
    )
    .await;
    hear(&mut coach).await;

    let delete = json!([{ "name": "deletePhase", "args": [LIB, DISMOUNT], "options": { "confirmed": true } }]);
    assert_eq!(
        step(&mut coach, "stepdelete01", 6, delete).await["kind"],
        "accepted"
    );

    // 林教練收到編排的改動，接著是紀錄跟著改的（不用重新整理）。
    let heard = hear(&mut phone).await;
    assert_eq!(heard["kind"], "recordsChanged");
    assert_eq!(
        ids(heard["changed"].as_array().unwrap()),
        vec!["tboth11111110"]
    );
    assert_eq!(
        heard["changed"][0]["attempt"]["marks"],
        json!({ LOAD: "✓" })
    );
    assert_eq!(heard["changed"][0]["mine"], true);
    assert_eq!(heard["deleted"], json!(["tonly22222220"]));
}

#[sqlx::test]
async fn reconnecting_gets_the_records_others_added_changed_or_deleted_meanwhile(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    let marks = json!({ LOAD: "✓", HOLD: "✓", DISMOUNT: "✓" });
    record(
        &mut coach,
        json!([drill("tkept00000001", SQUAD_1, marks.clone())]),
    )
    .await;
    record(
        &mut coach,
        json!([drill("tgone00000001", SQUAD_1, marks.clone())]),
    )
    .await;

    // 林教練斷線的時候，王教練又記了一次、刪了一次
    record(
        &mut coach,
        json!([drill("tnew000000001", SQUAD_2, marks.clone())]),
    )
    .await;
    delete(&mut coach, json!(["tgone00000001"])).await;

    // 林教練連回來（要現在的紀錄）：先拿到現在的紀錄（別人記的帶名字），再說可以送步
    let mut phone = s.connect(&lin, &id).await.unwrap();
    let hello = json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": lin.email, "seen": 6, "records": true });
    say(&mut phone, hello).await;
    let now = hear(&mut phone).await;
    assert_eq!(now["kind"], "records", "{now}");
    let records = now["records"].as_array().unwrap();
    assert_eq!(ids(records), vec!["tkept00000001", "tnew000000001"]);
    assert_eq!(records[1]["by"], "王教練");
    assert_eq!(hear(&mut phone).await["kind"], "ready");

    // 第一次打開（沒要）：不送，紀錄跟著打開時拿的
    let (_, first) = s.join(&lin, &id).await;
    assert_eq!(first["kind"], "ready");
}

/// 送復原（redo 是重做）：of 是要復原的那一步的步驟 id，change 是要放回去的樣子（RemoteChange）。回伺服器的回答。
async fn undo(
    socket: &mut Socket,
    step_id: &str,
    seen: i64,
    of: &str,
    redo: bool,
    change: Value,
) -> Value {
    let message = json!({ "kind": "undo", "stepId": step_id, "seen": seen, "of": of, "redo": redo, "change": change });
    say(socket, message).await;
    hear(socket).await
}

impl Server {
    /// 伺服器上現在的編排（不帶紀錄）。
    async fn flow(&self, who: &User, id: &str) -> Value {
        let (_, got) = self
            .send("GET", &format!("/api/flows/{id}"), None, &who.cookie)
            .await;
        got["flow"].clone()
    }

    /// 從 from 放回 to 的改動（RemoteChange）。
    async fn back_to(&self, from: &Value, to: &Value) -> Value {
        let change = self
            .state
            .core
            .remote_change(from.to_string(), to.to_string())
            .await
            .unwrap();
        serde_json::from_str(&change).unwrap()
    }
}

#[sqlx::test]
async fn undoing_a_phase_delete_brings_its_marks_back_and_redo_clears_them_again(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    let (mut phone, _) = s.join(&lin, &id).await;
    // 兩次都在下法失敗（ADR 0007 的 N02：記號被清掉、環節卻回來，整次就從 0% 變 100%）。
    record(
        &mut phone,
        json!([
            drill(
                "tboth11111110",
                SQUAD_1,
                json!({ LOAD: "✓", DISMOUNT: "✗" })
            ),
            drill("tonly22222220", SQUAD_1, json!({ DISMOUNT: "✗" })),
        ]),
    )
    .await;
    hear(&mut coach).await;
    let records_before = s.records(&wang, &id).await;
    let flow_before = s.flow(&wang, &id).await;

    let delete = json!([{ "name": "deletePhase", "args": [LIB, DISMOUNT], "options": { "confirmed": true } }]);
    assert_eq!(
        step(&mut coach, "stepdelete01", 6, delete).await["kind"],
        "accepted"
    );
    hear(&mut coach).await;
    hear(&mut phone).await;
    let records_after = s.records(&wang, &id).await;
    let flow_after = s.flow(&wang, &id).await;
    assert_eq!(ids(&records_after), vec!["tboth11111110"]);

    // 復原：環節回來，清掉的記號、整筆清掉的那一次也回來，跟刪之前一模一樣（成功率一樣）。
    let change = s.back_to(&flow_after, &flow_before).await;
    let reply = undo(&mut coach, "stepundo0001", 7, "stepdelete01", false, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    assert_eq!(s.records(&wang, &id).await, records_before);
    // 送的人和房間裡別人都收到回來的紀錄。
    for socket in [&mut coach, &mut phone] {
        let heard = hear(socket).await;
        assert_eq!(heard["kind"], "recordsChanged", "{heard}");
        assert_eq!(
            ids(heard["changed"].as_array().unwrap()),
            vec!["tboth11111110", "tonly22222220"]
        );
        assert_eq!(
            heard["changed"][1]["attempt"]["marks"],
            json!({ DISMOUNT: "✗" })
        );
    }

    // 重做：再清一次。
    let change = s.back_to(&flow_before, &flow_after).await;
    let reply = undo(&mut coach, "stepredo0001", 8, "stepundo0001", true, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    assert_eq!(s.records(&wang, &id).await, records_after);
}

#[sqlx::test]
async fn redo_clears_records_the_step_cleared(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    record(
        &mut coach,
        json!([drill("tsquad1111110", SQUAD_1, json!({ LOAD: "✓" }))]),
    )
    .await;
    let records_before = s.records(&wang, &id).await;
    let flow_before = s.flow(&wang, &id).await;

    // 第 1 組的小美換人（改名選清掉重算）：第 1 組的紀錄清掉。
    let rename = json!([{ "name": "updateMember", "args": ["mzk52d2cu1vww", { "name": "小琪" }], "options": { "records": "clear" } }]);
    assert_eq!(
        step(&mut coach, "steprename01", 6, rename).await["kind"],
        "accepted"
    );
    // 送的人也收到跟著清掉的紀錄：進房間拿到的紀錄可能還沒算到這一步。
    assert_eq!(
        hear(&mut coach).await,
        json!({ "kind": "recordsChanged", "changed": [], "deleted": ["tsquad1111110"] })
    );
    assert_eq!(s.records(&wang, &id).await, Vec::<Value>::new());
    let flow_after = s.flow(&wang, &id).await;

    let change = s.back_to(&flow_after, &flow_before).await;
    let reply = undo(&mut coach, "stepundo0001", 7, "steprename01", false, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    assert_eq!(s.records(&wang, &id).await, records_before);
    hear(&mut coach).await;

    // 重做：換上來的人不接前一個人的紀錄，再清一次。
    let change = s.back_to(&flow_before, &flow_after).await;
    let reply = undo(&mut coach, "stepredo0001", 8, "stepundo0001", true, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    assert_eq!(s.records(&wang, &id).await, Vec::<Value>::new());
}

#[sqlx::test]
async fn undoing_an_action_delete_brings_its_records_back(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    record(
        &mut coach,
        json!([drill(
            "tboth11111110",
            SQUAD_1,
            json!({ LOAD: "✓", DISMOUNT: "✗" })
        )]),
    )
    .await;
    let records_before = s.records(&wang, &id).await;
    let flow_before = s.flow(&wang, &id).await;

    let remove =
        json!([{ "name": "deleteAction", "args": [LIB], "options": { "confirmed": true } }]);
    assert_eq!(
        step(&mut coach, "stepdelete01", 6, remove).await["kind"],
        "accepted"
    );
    hear(&mut coach).await;
    assert_eq!(s.records(&wang, &id).await, Vec::<Value>::new());
    let flow_after = s.flow(&wang, &id).await;

    let change = s.back_to(&flow_after, &flow_before).await;
    let reply = undo(&mut coach, "stepundo0001", 7, "stepdelete01", false, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    assert_eq!(s.records(&wang, &id).await, records_before);
}

#[sqlx::test]
async fn undo_does_not_bring_back_records_changed_or_deleted_after_the_step(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    let both = drill(
        "tboth11111110",
        SQUAD_1,
        json!({ LOAD: "✓", DISMOUNT: "✗" }),
    );
    let only = drill("tonly22222220", SQUAD_1, json!({ DISMOUNT: "✗" }));
    let kept = drill(
        "tkept33333330",
        SQUAD_1,
        json!({ LOAD: "✓", DISMOUNT: "✓" }),
    );
    record(&mut coach, json!([both, only, kept])).await;
    let flow_before = s.flow(&wang, &id).await;

    let phase = json!([{ "name": "deletePhase", "args": [LIB, DISMOUNT], "options": { "confirmed": true } }]);
    assert_eq!(
        step(&mut coach, "stepdelete01", 6, phase).await["kind"],
        "accepted"
    );
    hear(&mut coach).await;
    let flow_after = s.flow(&wang, &id).await;
    // 刪環節之後：改了第一次的記號、刪掉第三次。
    change(&mut coach, json!([remarked(&both, json!({ LOAD: "△" }))])).await;
    delete(&mut coach, json!(["tkept33333330"])).await;

    let change = s.back_to(&flow_after, &flow_before).await;
    let reply = undo(&mut coach, "stepundo0001", 7, "stepdelete01", false, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    let got = s.records(&wang, &id).await;
    // 之後改過的照改過的；之後刪掉的不加回來；這一步整筆清掉的回來。
    assert_eq!(ids(&got), vec!["tboth11111110", "tonly22222220"]);
    assert_eq!(got[0]["attempt"]["marks"], json!({ LOAD: "△" }));
    assert_eq!(got[1]["attempt"]["marks"], json!({ DISMOUNT: "✗" }));
}

#[sqlx::test]
async fn redo_keeps_a_record_deleted_and_restored_after_the_undo(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "editor")]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    let (mut other, _) = s.join(&lin, &id).await;
    record(
        &mut coach,
        json!([drill("tsquad1111110", SQUAD_1, json!({ LOAD: "✓" }))]),
    )
    .await;
    hear(&mut other).await;
    let records_before = s.records(&wang, &id).await;
    let flow_before = s.flow(&wang, &id).await;

    // 改名選清掉重算：第 1 組的紀錄清掉；復原：加回來。
    let rename = json!([{ "name": "updateMember", "args": ["mzk52d2cu1vww", { "name": "小琪" }], "options": { "records": "clear" } }]);
    assert_eq!(
        step(&mut coach, "steprename01", 6, rename).await["kind"],
        "accepted"
    );
    hear(&mut coach).await;
    hear(&mut other).await;
    let flow_after = s.flow(&wang, &id).await;
    let change = s.back_to(&flow_after, &flow_before).await;
    let reply = undo(&mut coach, "stepundo0001", 7, "steprename01", false, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    hear(&mut coach).await;
    hear(&mut other).await;
    assert_eq!(s.records(&wang, &id).await, records_before);

    // 復原之後林教練刪掉、再按「救回」：內容跟復原加回來的一樣，但是之後才動過的。
    delete(&mut other, json!(["tsquad1111110"])).await;
    hear(&mut coach).await;
    restore(&mut other, json!(["tsquad1111110"])).await;
    hear(&mut coach).await;

    // 重做：之後救回的照現在的，不再清掉。
    let change = s.back_to(&flow_before, &flow_after).await;
    let reply = undo(&mut coach, "stepredo0001", 8, "stepundo0001", true, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    assert_eq!(ids(&s.records(&wang, &id).await), vec!["tsquad1111110"]);
}

#[sqlx::test]
async fn redo_clears_again_a_record_whose_mark_change_was_resent_unchanged(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    let one = drill("tresend111110", SQUAD_1, json!({ LOAD: "✓" }));
    record(&mut coach, json!([one.clone()])).await;
    // 改記號（回答沒收到，手機之後會再送一次）。
    let fixed = remarked(&one, json!({ LOAD: "✗" }));
    change(&mut coach, json!([fixed.clone()])).await;
    let records_before = s.records(&wang, &id).await;
    let flow_before = s.flow(&wang, &id).await;

    // 改名選清掉重算：清掉；復原：加回來。
    let rename = json!([{ "name": "updateMember", "args": ["mzk52d2cu1vww", { "name": "小琪" }], "options": { "records": "clear" } }]);
    assert_eq!(
        step(&mut coach, "steprename01", 6, rename).await["kind"],
        "accepted"
    );
    hear(&mut coach).await;
    let flow_after = s.flow(&wang, &id).await;
    let change_back = s.back_to(&flow_after, &flow_before).await;
    let reply = undo(
        &mut coach,
        "stepundo0001",
        7,
        "steprename01",
        false,
        change_back,
    )
    .await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    hear(&mut coach).await;
    assert_eq!(s.records(&wang, &id).await, records_before);

    // 手機再送一次一樣的記號：沒改到東西，不算之後用手動過。
    change(&mut coach, json!([fixed])).await;

    // 重做：復原加回來的再清掉。
    let change_again = s.back_to(&flow_before, &flow_after).await;
    let reply = undo(
        &mut coach,
        "stepredo0001",
        8,
        "stepundo0001",
        true,
        change_again,
    )
    .await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    assert_eq!(ids(&s.records(&wang, &id).await), Vec::<&str>::new());
}

#[sqlx::test]
async fn undoing_two_trimming_steps_in_a_row_brings_every_mark_back(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut coach, _) = s.join(&wang, &id).await;
    let all = json!({ LOAD: "✓", HOLD: "✓", DISMOUNT: "✗" });
    record(
        &mut coach,
        json!([drill("tthree1111110", SQUAD_1, all.clone())]),
    )
    .await;
    let flow_0 = s.flow(&wang, &id).await;

    // 刪兩個環節（兩步），每步各清掉一個記號。
    let first = json!([{ "name": "deletePhase", "args": [LIB, DISMOUNT], "options": { "confirmed": true } }]);
    assert_eq!(
        step(&mut coach, "stepphase001", 6, first).await["kind"],
        "accepted"
    );
    hear(&mut coach).await;
    let flow_1 = s.flow(&wang, &id).await;
    let second =
        json!([{ "name": "deletePhase", "args": [LIB, HOLD], "options": { "confirmed": true } }]);
    assert_eq!(
        step(&mut coach, "stepphase002", 7, second).await["kind"],
        "accepted"
    );
    hear(&mut coach).await;
    let flow_2 = s.flow(&wang, &id).await;

    // 連按兩次復原：兩個記號都回來。
    let change = s.back_to(&flow_2, &flow_1).await;
    let reply = undo(&mut coach, "stepundo0002", 8, "stepphase002", false, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    hear(&mut coach).await;
    let change = s.back_to(&flow_1, &flow_0).await;
    let reply = undo(&mut coach, "stepundo0001", 9, "stepphase001", false, change).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
    assert_eq!(s.records(&wang, &id).await[0]["attempt"]["marks"], all);
}

async fn say(socket: &mut Socket, message: Value) {
    socket
        .send(Message::Text(message.to_string().into()))
        .await
        .unwrap();
}

/// 伺服器說的下一句（誰開著、別的連線的改動（#253）跳過）；房間關了是 Null。
async fn hear(socket: &mut Socket) -> Value {
    let next = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let message: Value = serde_json::from_str(&text).unwrap();
                    if message["kind"] != "present" && message["kind"] != "changed" && message["kind"] != "runThroughs" {
                        return message;
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return Value::Null,
                _ => {}
            }
        }
    });
    next.await.expect("伺服器一直沒說話")
}
