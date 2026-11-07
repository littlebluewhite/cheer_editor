// 即時看到別人的改動、誰開著（#253）：伺服器收了一步，把改好的東西送給房間裡的其他人；
// 有人進來、離開、換編輯／檢視，在場名單跟著變。開一台真的伺服器（網路埠），房間用 WebSocket。
// 要有 PostgreSQL：見 tests/db.rs 開頭。

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

    async fn user_id(&self, email: &str) -> i64 {
        let (id,): (i64,) = sqlx::query_as("SELECT id FROM users WHERE email = $1")
            .bind(email)
            .fetch_one(&self.state.db)
            .await
            .unwrap();
        id
    }

    async fn set_role(&self, owner: &User, id: &str, email: &str, role: &str) -> StatusCode {
        let user = self.user_id(email).await;
        let path = format!("/api/flows/{id}/people/{user}/role");
        self.send("POST", &path, Some(json!({ "role": role })), &owner.cookie)
            .await
            .0
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

/// 伺服器說的下一句，「誰開著」的跳過。
async fn reply(socket: &mut Socket) -> Value {
    loop {
        let message = hear(socket).await;
        if message["kind"] != "present" {
            return message;
        }
    }
}

/// 一直聽，聽到在場名單是 expected（[名字, 在編輯嗎]）為止；別的話跳過。
async fn present_until(socket: &mut Socket, expected: &[(&str, bool)]) {
    let mut last = Value::Null;
    for _ in 0..20 {
        let message = hear(socket).await;
        if message["kind"] != "present" {
            continue;
        }
        let people: Vec<(String, bool)> = message["people"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p["name"].as_str().unwrap().to_owned(),
                    p["editing"].as_bool().unwrap(),
                )
            })
            .collect();
        if people
            .iter()
            .map(|(n, e)| (n.as_str(), *e))
            .eq(expected.iter().copied())
        {
            return;
        }
        last = message;
    }
    panic!("在場名單一直不是 {expected:?}，最後是 {last}");
}

/// 連上、打招呼（帶在編輯還是檢視），回伺服器說的第一句。
async fn join_as(s: &Server, who: &User, id: &str, tab: &str, editing: bool) -> (Socket, Value) {
    let mut socket = s.connect(who, id).await.unwrap();
    let hello = json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": tab, "seen": 0, "editing": editing });
    say(&mut socket, hello).await;
    let first = reply(&mut socket).await;
    (socket, first)
}

async fn flow_of(s: &Server, who: &User, id: &str) -> Value {
    s.send("GET", &format!("/api/flows/{id}"), None, &who.cookie)
        .await
        .1
}

#[sqlx::test]
async fn others_get_what_a_step_changed_and_end_up_like_the_server(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let view = s.user("view@example.com", "檢視者").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "editor").await;
    s.share(&wang, &id, view.email, "viewer").await;
    let (mut a, _) = join_as(&s, &wang, &id, "tab-a", true).await;
    let (mut b, _) = join_as(&s, &lin, &id, "tab-b", true).await;
    let (mut c, _) = join_as(&s, &view, &id, "tab-c", false).await;
    let mut seen_by_b = flow_of(&s, &lin, &id).await["flow"].to_string();
    let mut seen_by_c = seen_by_b.clone();

    let steps = [
        json!([{ "name": "addMembers", "args": [[
            { "name": "小A", "gender": "F", "globalRole": "top" },
            { "name": "小B", "gender": "M", "globalRole": "base" }
        ]] }]),
        json!([{ "name": "addSegment", "args": ["chant"] }]),
        json!([{ "name": "renameFlow", "args": ["全國賽決賽"] }]),
        json!([{ "name": "adjustField", "args": [{ "strips": 7, "layout": "horizontal" }] }]),
    ];
    for (n, commands) in steps.into_iter().enumerate() {
        let step_id = format!("step-{n}");
        let message = json!({ "kind": "step", "stepId": step_id, "seen": n, "commands": commands });
        say(&mut a, message).await;
        let accepted = reply(&mut a).await;
        assert_eq!(accepted["kind"], "accepted", "{accepted}");

        for (socket, seen) in [(&mut b, &mut seen_by_b), (&mut c, &mut seen_by_c)] {
            let changed = reply(socket).await;
            assert_eq!(changed["kind"], "changed", "{changed}");
            assert_eq!(changed["step"], n + 1);
            assert_eq!(changed["by"], "王教練");
            *seen = s
                .state
                .core
                .apply_remote_change(seen.clone(), changed["change"].to_string())
                .await
                .unwrap();
        }
    }

    let server = flow_of(&s, &wang, &id).await["flow"].clone();
    assert_eq!(server["name"], "全國賽決賽");
    assert_eq!(serde_json::from_str::<Value>(&seen_by_b).unwrap(), server);
    assert_eq!(serde_json::from_str::<Value>(&seen_by_c).unwrap(), server);
    // 送的人自己只收到「收了」，不會再收到自己的改動
    let quiet = tokio::time::timeout(Duration::from_millis(200), reply(&mut a)).await;
    assert!(quiet.is_err(), "送的人不該再收到：{quiet:?}");
}

#[sqlx::test]
async fn the_present_list_follows_who_comes_goes_and_switches_mode(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "editor").await;

    // 自己不列
    let (mut a, first) = join_as(&s, &wang, &id, "tab-a", true).await;
    assert_eq!(first["kind"], "ready");
    present_until(&mut a, &[]).await;

    // 有人進來：檢視
    let (mut b, _) = join_as(&s, &lin, &id, "tab-b", false).await;
    present_until(&mut a, &[("林教練", false)]).await;
    present_until(&mut b, &[("王教練", true)]).await;

    // 換成編輯
    say(&mut b, json!({ "kind": "mode", "editing": true })).await;
    present_until(&mut a, &[("林教練", true)]).await;

    // 同一個人開第二個分頁：連得上，別人那邊還是一個人（有一個分頁在編輯就算在編輯）
    let (mut a2, first) = join_as(&s, &wang, &id, "tab-a2", false).await;
    assert_eq!(first["kind"], "ready");
    present_until(&mut a2, &[("林教練", true)]).await;
    present_until(&mut b, &[("王教練", true)]).await;
    drop(a);
    present_until(&mut b, &[("王教練", false)]).await;

    // 降成檢視者：算檢視
    s.set_role(&wang, &id, lin.email, "viewer").await;
    present_until(&mut a2, &[("林教練", false)]).await;
    // 檢視者說要編輯也不算
    say(&mut b, json!({ "kind": "mode", "editing": true })).await;
    say(&mut a2, json!({ "kind": "mode", "editing": true })).await;
    present_until(&mut b, &[("王教練", true)]).await;
    present_until(&mut a2, &[("林教練", false)]).await;

    // 離開
    drop(b);
    present_until(&mut a2, &[]).await;
}

/// 打招呼帶上次看到第幾步（斷線重連，#255），回連上之後伺服器說的（到「可以送步」為止，在場名單跳過）。
async fn rejoin(s: &Server, who: &User, id: &str, tab: &str, seen: i64) -> (Socket, Vec<Value>) {
    let mut socket = s.connect(who, id).await.unwrap();
    let hello = json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": tab, "seen": seen, "editing": true });
    say(&mut socket, hello).await;
    let mut heard = Vec::new();
    loop {
        let message = reply(&mut socket).await;
        let ready = message["kind"] == "ready";
        heard.push(message);
        if ready {
            return (socket, heard);
        }
    }
}

#[sqlx::test]
async fn reconnecting_catches_up_on_what_others_changed_meanwhile(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "editor").await;
    let (mut a, _) = join_as(&s, &wang, &id, "tab-a", true).await;
    let (mut b, _) = join_as(&s, &lin, &id, "tab-b", true).await;
    let mut seen_by_b = flow_of(&s, &lin, &id).await["flow"].to_string();

    // 林教練送了一步，伺服器收了，可是他還沒收到回答就斷線
    let mine = json!([{ "name": "addSegment", "args": ["chant"] }]);
    say(
        &mut b,
        json!({ "kind": "step", "stepId": "step-b", "seen": 0, "commands": mine }),
    )
    .await;
    let changed = reply(&mut a).await;
    assert_eq!(changed["kind"], "changed", "{changed}");
    seen_by_b = s
        .state
        .core
        .apply_remote_change(seen_by_b, changed["change"].to_string())
        .await
        .unwrap();
    drop(b);

    // 斷線期間王教練改了兩步
    let steps = [
        json!([{ "name": "renameFlow", "args": ["全國賽決賽"] }]),
        json!([{ "name": "adjustField", "args": [{ "strips": 7, "layout": "horizontal" }] }]),
    ];
    for (n, commands) in steps.into_iter().enumerate() {
        let message = json!({ "kind": "step", "stepId": format!("step-a{n}"), "seen": n + 1, "commands": commands });
        say(&mut a, message).await;
        assert_eq!(reply(&mut a).await["kind"], "accepted");
    }

    // 連回來（上次看到第 0 步）：先補上別人改的（這個分頁自己送的不補），再說可以送步
    let (mut b, heard) = rejoin(&s, &lin, &id, "tab-b", 0).await;
    let kinds: Vec<_> = heard.iter().map(|m| m["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["changed", "changed", "ready"], "{heard:?}");
    assert_eq!(heard[0]["step"], 2);
    assert_eq!(heard[1]["step"], 3);
    assert_eq!(heard[1]["by"], "王教練");
    assert_eq!(heard[2]["step"], 3);
    for changed in &heard[..2] {
        seen_by_b = s
            .state
            .core
            .apply_remote_change(seen_by_b, changed["change"].to_string())
            .await
            .unwrap();
    }
    let server = flow_of(&s, &wang, &id).await["flow"].clone();
    assert_eq!(serde_json::from_str::<Value>(&seen_by_b).unwrap(), server);

    // 斷線前送的那一步再送一次：回原本的結果，不套兩次
    let again = json!([{ "name": "addSegment", "args": ["chant"] }]);
    say(
        &mut b,
        json!({ "kind": "step", "stepId": "step-b", "seen": 0, "commands": again }),
    )
    .await;
    let accepted = reply(&mut b).await;
    assert_eq!(accepted["kind"], "accepted", "{accepted}");
    assert_eq!(accepted["step"], 1);

    // 已經是最新的：直接可以送步
    let (_, heard) = rejoin(&s, &lin, &id, "tab-b", 3).await;
    assert_eq!(heard.len(), 1, "{heard:?}");

    // 上次看到之後的步已經沒留（超過 30 天）：補不上，給伺服器現在的樣子
    sqlx::query("DELETE FROM flow_steps WHERE flow_id = $1 AND step = 2")
        .bind(&id)
        .execute(&s.state.db)
        .await
        .unwrap();
    let (_, heard) = rejoin(&s, &lin, &id, "tab-b", 1).await;
    let kinds: Vec<_> = heard.iter().map(|m| m["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["current", "ready"], "{heard:?}");
    assert_eq!(heard[0]["flow"], server);
    assert_eq!(heard[0]["step"], 3);
}
