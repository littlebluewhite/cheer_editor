// 雲端流程的成功率紀錄（#257，ADR 0008）：記一次從房間送、存起來、記下誰記的；同一個 id 不變兩筆；
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
        json!([{ "actionId": LIB, "attempt": one["attempt"], "by": null }])
    );

    // 王教練開著的房間馬上收到，寫林教練的名字。
    let heard = hear(&mut coach).await;
    assert_eq!(
        heard,
        json!({ "kind": "newRecords", "records": [
        { "actionId": LIB, "attempt": one["attempt"], "by": "林教練" }
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
async fn the_same_id_twice_is_one_record(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let (mut phone, _) = s.join(&wang, &id).await;
    let one = drill("tabc123def456", SQUAD_1, json!({ LOAD: "✓" }));

    let first = record(&mut phone, json!([one, one])).await;
    // 斷線重連後重送：回存著的那一筆，不變兩筆。
    let (mut again, _) = s.join(&wang, &id).await;
    let second = record(&mut again, json!([one])).await;

    assert_eq!(first["saved"].as_array().unwrap().len(), 1);
    assert_eq!(first["saved"], second["saved"]);
    assert_eq!(s.rows(&id).await.len(), 1);
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
async fn two_people_drilling_the_same_squad_both_count(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "editor")]).await;
    let (mut a, _) = s.join(&wang, &id).await;
    let (mut b, _) = s.join(&lin, &id).await;

    record(
        &mut a,
        json!([drill("tfromwang0010", SQUAD_1, json!({ LOAD: "✓" }))]),
    )
    .await;
    hear(&mut b).await;
    record(
        &mut b,
        json!([drill("tfromlin00010", SQUAD_1, json!({ LOAD: "✓" }))]),
    )
    .await;

    let got = s.records(&wang, &id).await;
    assert_eq!(ids(&got), vec!["tfromwang0010", "tfromlin00010"]);
    assert_eq!(got[1]["by"], "林教練");
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

async fn say(socket: &mut Socket, message: Value) {
    socket
        .send(Message::Text(message.to_string().into()))
        .await
        .unwrap();
}

/// 伺服器說的下一句；房間關了是 Null。
async fn hear(socket: &mut Socket) -> Value {
    let next = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => return serde_json::from_str(&text).unwrap(),
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return Value::Null,
                _ => {}
            }
        }
    });
    next.await.expect("伺服器一直沒說話")
}
