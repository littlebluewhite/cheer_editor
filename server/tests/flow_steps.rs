// 雲端流程一步一步存（#248）：開一台真的伺服器（網路埠），用 WebSocket 連流程的房間送步。
// 要有 PostgreSQL：見 tests/db.rs 開頭。

use std::sync::{Arc, Mutex};

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
        cookie: Option<&str>,
    ) -> (StatusCode, Value, Option<String>) {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header("sec-fetch-site", "same-origin");
        if let Some(c) = cookie {
            req = req.header("cookie", c);
        }
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
        let set_cookie = res
            .headers()
            .get(header::SET_COOKIE)
            .map(|v| v.to_str().unwrap().to_owned());
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, json, set_cookie)
    }

    async fn signed_in(&self, email: &str, name: &str) -> String {
        create_admin(&self.state, email, Some(name)).await.unwrap();
        let mail = self.state.mailer.sent().last().cloned().unwrap();
        let link = format!("{SITE}/set-password#");
        let at = mail.text.find(&link).unwrap() + link.len();
        let token = mail.text[at..].split_whitespace().next().unwrap();
        let body = json!({ "token": token, "password": GOOD });
        self.send("POST", "/api/set-password", Some(body), None)
            .await;
        let body = json!({ "email": email, "password": GOOD });
        let (_, _, set_cookie) = self.send("POST", "/api/login", Some(body), None).await;
        set_cookie.unwrap().split(';').next().unwrap().to_owned()
    }

    async fn create(&self, cookie: &str, name: &str) -> String {
        let input = json!({ "name": name, "field": { "strips": 9, "layout": "vertical" } });
        let (status, made, _) = self
            .send("POST", "/api/flows", Some(input), Some(cookie))
            .await;
        assert_eq!(status, StatusCode::CREATED);
        made["id"].as_str().unwrap().to_owned()
    }

    async fn get(&self, cookie: &str, id: &str) -> Value {
        let (_, got, _) = self
            .send("GET", &format!("/api/flows/{id}"), None, Some(cookie))
            .await;
        got
    }

    /// 連這支流程的房間（從網頁本身連的：帶 Sec-Fetch-Site）。連不上回 HTTP 狀態。
    async fn connect(&self, cookie: Option<&str>, id: &str) -> Result<Socket, StatusCode> {
        let mut req = format!("ws://{}/api/flows/{id}/room", self.addr)
            .into_client_request()
            .unwrap();
        req.headers_mut()
            .insert("sec-fetch-site", "same-origin".parse().unwrap());
        if let Some(c) = cookie {
            req.headers_mut().insert("cookie", c.parse().unwrap());
        }
        match tokio_tungstenite::connect_async(req).await {
            Ok((socket, _)) => Ok(socket),
            Err(tokio_tungstenite::tungstenite::Error::Http(res)) => Err(res.status()),
            Err(e) => panic!("{e}"),
        }
    }

    /// 連上、打招呼（指紋對），回房間和伺服器說的第一句。
    async fn join(&self, cookie: &str, id: &str) -> (Socket, Value) {
        let mut socket = self.connect(Some(cookie), id).await.unwrap();
        let hello =
            json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": "tab-a", "seen": 0 });
        say(&mut socket, hello).await;
        let first = hear(&mut socket).await;
        (socket, first)
    }
}

async fn say(socket: &mut Socket, message: Value) {
    socket
        .send(Message::Text(message.to_string().into()))
        .await
        .unwrap();
}

/// 伺服器回這個連線的下一句：誰開著、別的連線的改動（#253）跳過。
async fn hear(socket: &mut Socket) -> Value {
    loop {
        match socket.next().await.unwrap().unwrap() {
            Message::Text(text) => {
                let message: Value = serde_json::from_str(&text).unwrap();
                if message["kind"] != "present" && message["kind"] != "changed" && message["kind"] != "runThroughs" {
                    return message;
                }
            }
            Message::Close(_) => panic!("房間關了"),
            _ => {}
        }
    }
}

/// 送一步，回伺服器的回答。
async fn step(socket: &mut Socket, step_id: &str, seen: i64, commands: Value) -> Value {
    let message = json!({ "kind": "step", "stepId": step_id, "seen": seen, "commands": commands });
    say(socket, message).await;
    hear(socket).await
}

fn rename(name: &str) -> Value {
    json!({ "name": "renameFlow", "args": [name] })
}

#[sqlx::test]
async fn a_step_changes_the_flow_and_counts_one_more(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;

    let (mut room, first) = s.join(&lin, &id).await;
    assert_eq!(first, json!({ "kind": "ready", "step": 0 }));

    let reply = step(&mut room, "step0000001", 0, json!([rename("全國賽決賽")])).await;
    assert_eq!(
        reply,
        json!({
            "kind": "accepted",
            "stepId": "step0000001",
            "step": 1,
            "change": { "things": [{ "key": "name", "after": "全國賽決賽" }], "orders": {} }
        })
    );
    let got = s.get(&lin, &id).await;
    assert_eq!(got["flow"]["name"], "全國賽決賽");
    assert_eq!(got["step"], 1);

    // 新東西的 id 由步驟 id 算出來：再連一次（重新打開）看到同一份。
    let add = json!({ "name": "addMembers", "args": [[{ "name": "小A", "gender": "F", "globalRole": "top" }]] });
    let reply = step(&mut room, "step0000002", 1, json!([add])).await;
    assert_eq!(reply["step"], 2);
    let (_, again) = s.join(&lin, &id).await;
    assert_eq!(again, json!({ "kind": "ready", "step": 2 }));
    assert_eq!(s.get(&lin, &id).await["flow"]["members"][0]["name"], "小A");
}

#[sqlx::test]
async fn the_same_step_id_twice_counts_once(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let (mut room, _) = s.join(&lin, &id).await;
    let add = json!({ "name": "addMembers", "args": [[{ "name": "小A", "gender": "F", "globalRole": "top" }]] });

    let first = step(&mut room, "stepsame0001", 0, json!([add])).await;
    // 斷線重連後重送：回原本的結果，不套兩次。
    let (mut again, _) = s.join(&lin, &id).await;
    let second = step(&mut again, "stepsame0001", 0, json!([add])).await;

    assert_eq!(first, second);
    assert_eq!(first["step"], 1);
    let got = s.get(&lin, &id).await;
    assert_eq!(got["step"], 1);
    assert_eq!(got["flow"]["members"].as_array().unwrap().len(), 1);
}

#[sqlx::test]
async fn blocked_or_unasked_commands_are_sent_back_with_the_reason(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let (mut room, _) = s.join(&lin, &id).await;

    // 被擋：退回、帶原因和伺服器現在的樣子。
    let reply = step(&mut room, "stepblock001", 0, json!([rename("   ")])).await;
    assert_eq!(reply["kind"], "rejected");
    assert_eq!(reply["stepId"], "stepblock001");
    assert_eq!(reply["message"], "沒存進去：請幫流程取名字");
    let reason = json!({ "message": "請幫流程取名字", "why": { "code": "flow_no_name" } });
    let why = json!({ "code": "blocked", "reason": reason, "ask": false });
    assert_eq!(reply["why"], why);
    assert_eq!(reply["step"], 0);
    assert_eq!(reply["flow"]["name"], "全國賽");

    // 流程核心的原因改成代號的（ADR 0017）：中文和代號一起帶回來，畫面照語言寫。
    let reply = step(&mut room, "stepblock003", 0, json!([])).await;
    assert_eq!(reply["kind"], "rejected");
    assert_eq!(reply["message"], "沒存進去：沒有指令");
    let reason = json!({ "message": "沒有指令", "why": { "code": "commands_none" } });
    assert_eq!(reply["why"]["reason"], reason, "{reply}");

    // 好幾個指令，中間一個被擋：全不算。
    let reply = step(
        &mut room,
        "stepblock002",
        0,
        json!([rename("改好的名字"), rename(""), rename("又改")]),
    )
    .await;
    assert_eq!(reply["kind"], "rejected");
    let got = s.get(&lin, &id).await;
    assert_eq!(got["flow"]["name"], "全國賽");
    assert_eq!(got["step"], 0);

    // 伺服器那邊要問、教練那邊沒問（沒帶回答）：退回。
    let add = json!({ "name": "addMembers", "args": [[{ "name": "小A", "gender": "F", "globalRole": "top" }]] });
    step(&mut room, "stepadd00001", 0, json!([add])).await;
    let member = s.get(&lin, &id).await["flow"]["members"][0]["id"].clone();
    let delete = json!({ "name": "deleteMember", "args": [member] });
    let reply = step(&mut room, "stepask00001", 1, json!([delete])).await;
    assert_eq!(reply["kind"], "rejected");
    assert!(
        reply["message"]
            .as_str()
            .unwrap()
            .starts_with("沒存進去：刪掉隊員「小A」"),
        "{reply}"
    );
    assert_eq!(reply["why"]["code"], "blocked", "{reply}");
    assert_eq!(reply["why"]["ask"], true, "{reply}");
    assert_eq!(s.get(&lin, &id).await["step"], 1);

    // 帶了回答就收。
    let delete =
        json!({ "name": "deleteMember", "args": [member], "options": { "confirmed": true } });
    let reply = step(&mut room, "stepask00002", 1, json!([delete])).await;
    assert_eq!(reply["kind"], "accepted");
    assert_eq!(s.get(&lin, &id).await["flow"]["members"], json!([]));

    // 伺服器看不懂的指令：也退回。
    let reply = step(
        &mut room,
        "stepbad00001",
        2,
        json!([{ "name": "noSuchCommand", "args": [] }]),
    )
    .await;
    assert_eq!(reply["kind"], "rejected");
    assert_eq!(reply["message"], "沒存進去：伺服器看不懂這一步");
    assert_eq!(reply["why"], json!({ "code": "notUnderstood" }));
    assert_eq!(s.get(&lin, &id).await["step"], 2);
}

#[sqlx::test]
async fn a_different_fingerprint_is_told_new_version_and_steps_are_not_taken(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let mut room = s.connect(Some(&lin), &id).await.unwrap();

    say(
        &mut room,
        json!({ "kind": "hello", "fingerprint": "old-editor", "tabId": "tab-a", "seen": 0 }),
    )
    .await;
    assert_eq!(hear(&mut room).await, json!({ "kind": "newVersion" }));

    // 照樣送步：不收（房間關掉，或不回）。
    let message = json!({ "kind": "step", "stepId": "stepold00001", "seen": 0, "commands": [rename("偷改")] });
    room.send(Message::Text(message.to_string().into()))
        .await
        .ok();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let got = s.get(&lin, &id).await;
    assert_eq!(got["flow"]["name"], "全國賽");
    assert_eq!(got["step"], 0);
}

#[sqlx::test]
async fn only_the_owner_signed_in_from_this_site_can_join(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let wang = s.signed_in("wang@example.com", "王教練").await;
    let id = s.create(&lin, "全國賽").await;

    assert_eq!(
        s.connect(None, &id).await.err(),
        Some(StatusCode::UNAUTHORIZED)
    );
    assert_eq!(
        s.connect(Some(&wang), &id).await.err(),
        Some(StatusCode::NOT_FOUND)
    );
    assert_eq!(
        s.connect(Some(&lin), "nope").await.err(),
        Some(StatusCode::NOT_FOUND)
    );

    // 別的網站叫瀏覽器連（帶著 cookie）：擋。
    let mut req = format!("ws://{}/api/flows/{id}/room", s.addr)
        .into_client_request()
        .unwrap();
    req.headers_mut().insert("cookie", lin.parse().unwrap());
    req.headers_mut()
        .insert("origin", "https://evil.example".parse().unwrap());
    match tokio_tungstenite::connect_async(req).await {
        Err(tokio_tungstenite::tungstenite::Error::Http(res)) => {
            assert_eq!(res.status(), StatusCode::FORBIDDEN)
        }
        other => panic!("應該擋下：{:?}", other.map(|_| ())),
    }
}
