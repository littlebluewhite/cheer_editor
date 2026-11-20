// 雲端流程的復原、重做（#256，ADR 0014）：復原也是一步，送那一步改到的東西改之前的樣子（重做送改之後的）。
// 那些東西後來被別的分頁改過就退回；放回去之後跑整份流程檢查，不合就退回；超過 30 天的步不能復原。
// 開一台真的伺服器（網路埠），HTTP 用 oneshot、房間用 WebSocket。要有 PostgreSQL：見 tests/db.rs 開頭。
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

    /// 連上（這個分頁是 tab）、打招呼，回房間。
    async fn join(&self, who: &User, id: &str, tab: &str) -> Socket {
        let mut socket = self.connect(who, id).await.unwrap();
        let hello = json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": tab, "seen": 0 });
        say(&mut socket, hello).await;
        assert_eq!(hear(&mut socket).await["kind"], "ready");
        socket
    }

    /// 王教練（擁有者）建一支有 Lib 的流程（4 個隊員、一段音樂、Lib 分好兩組，照 fixtures/sample-steps.json 的第 2–7 步），
    /// 分享給這個人當編輯者。回流程 id；建好是第 6 步。
    async fn sample(&self, owner: &User, editor: &User) -> String {
        let id = self.create(owner, "全國賽").await;
        let steps: Vec<Value> = serde_json::from_str(SAMPLE_STEPS).unwrap();
        let mut room = self.join(owner, &id, "setup").await;
        for (n, s) in steps[1..7].iter().enumerate() {
            let id = s["stepId"].as_str().unwrap();
            let reply = step(&mut room, id, n as i64, s["commands"].clone()).await;
            assert_eq!(reply["kind"], "accepted", "{reply}");
        }
        let (status, _) = self.share(owner, &id, editor.email, "editor").await;
        assert_eq!(status, StatusCode::OK);
        id
    }

    /// 伺服器上現在的樣子、第幾步。
    async fn flow(&self, who: &User, id: &str) -> Value {
        self.send("GET", &format!("/api/flows/{id}"), None, &who.cookie)
            .await
            .1
    }
}

/// 範例流程：從沒有流程開始，一步一步建出來（跟 tests/flow_core.rs 用的同一份）。
const SAMPLE_STEPS: &str = include_str!("fixtures/sample-steps.json");

async fn say(socket: &mut Socket, message: Value) {
    socket
        .send(Message::Text(message.to_string().into()))
        .await
        .unwrap();
}

/// 伺服器說的下一句（誰開著、別的連線的改動跳過）；房間關了是 Null。
async fn hear(socket: &mut Socket) -> Value {
    let next = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let message: Value = serde_json::from_str(&text).unwrap();
                    if message["kind"] != "present" && message["kind"] != "changed" {
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

/// 送一步，回伺服器的回答。
async fn step(socket: &mut Socket, step_id: &str, seen: i64, commands: Value) -> Value {
    let message = json!({ "kind": "step", "stepId": step_id, "seen": seen, "commands": commands });
    say(socket, message).await;
    hear(socket).await
}

fn rename(name: &str) -> Value {
    json!([{ "name": "renameFlow", "args": [name] }])
}

/// 送復原（redo 是重做）：of 是要復原的那一步的步驟 id，change 是要放回去的樣子（RemoteChange）。
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

/// 把流程名字放回 name 的改動。
fn name_back(name: &str) -> Value {
    json!({ "things": [{ "key": "name", "after": name }], "orders": {} })
}

fn assert_accepted(reply: &Value) {
    assert_eq!(reply["kind"], "accepted", "{reply}");
}

/// 退回了：給部署前開著的分頁看的中文（message）、畫面翻譯用的代號（why，ADR 0017）。
fn assert_sent_back(reply: &Value, message: &str, why: Value) {
    assert_eq!(reply["kind"], "rejected", "{reply}");
    assert_eq!(reply["message"], message, "{reply}");
    assert_eq!(reply["why"], why, "{reply}");
    assert!(reply.get("by").is_none(), "{reply}");
}

#[sqlx::test]
async fn others_changing_something_else_does_not_stop_my_undo(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;

    assert_accepted(&step(&mut a, "rename-1", 6, rename("全國賽決賽")).await);
    let segment = json!([{ "name": "addSegment", "args": ["chant"] }]);
    assert_accepted(&step(&mut b, "segment-1", 7, segment).await);

    // 王教練復原改名字：林教練加的段還在
    assert_accepted(&undo(&mut a, "undo-1", 8, "rename-1", false, name_back("全國賽")).await);
    let flow = &s.flow(&wang, &id).await["flow"];
    assert_eq!(flow["name"], "全國賽");
    assert_eq!(flow["segments"].as_array().unwrap().len(), 2);

    // 重做（復原的那一步是 undo-1）
    assert_accepted(&undo(&mut a, "redo-1", 9, "undo-1", true, name_back("全國賽決賽")).await);
    assert_eq!(s.flow(&wang, &id).await["flow"]["name"], "全國賽決賽");
}

#[sqlx::test]
async fn someone_later_changing_the_same_thing_sends_the_undo_back(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;

    assert_accepted(&step(&mut a, "rename-1", 6, rename("全國賽決賽")).await);
    assert_accepted(&step(&mut b, "rename-2", 7, rename("區賽")).await);

    let reply = undo(&mut a, "undo-1", 8, "rename-1", false, name_back("全國賽")).await;
    assert_sent_back(
        &reply,
        "林教練後來改過，這步不能復原",
        json!({ "code": "undoChangedLater", "by": "林教練", "redo": false }),
    );
    assert_eq!(reply["flow"]["name"], "區賽");
    assert_eq!(s.flow(&wang, &id).await["flow"]["name"], "區賽");

    // 重做也一樣：王教練復原之後林教練又改了名字
    assert_accepted(&step(&mut a, "rename-3", 8, rename("複賽")).await);
    assert_accepted(&undo(&mut a, "undo-2", 9, "rename-3", false, name_back("區賽")).await);
    assert_accepted(&step(&mut b, "rename-4", 10, rename("初賽")).await);
    let reply = undo(&mut a, "redo-2", 11, "undo-2", true, name_back("複賽")).await;
    assert_sent_back(
        &reply,
        "林教練後來改過，這步不能重做",
        json!({ "code": "undoChangedLater", "by": "林教練", "redo": true }),
    );
    assert_eq!(s.flow(&wang, &id).await["flow"]["name"], "初賽");
}

#[sqlx::test]
async fn an_undo_that_breaks_the_rules_is_sent_back(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;
    let people = |n: usize| -> Value {
        (0..n)
            .map(|i| json!({ "name": format!("隊員{i}"), "gender": "F", "globalRole": "base" }))
            .collect()
    };
    let members = |flow: &Value| flow["flow"]["members"].as_array().unwrap().clone();

    // 王教練加到 40 人，再刪掉 5 個（35）
    let add = json!([{ "name": "addMembers", "args": [people(36)] }]);
    assert_accepted(&step(&mut a, "add-1", 6, add).await);
    let forty = s.flow(&wang, &id).await;
    assert_eq!(members(&forty).len(), 40);
    let delete: Vec<Value> = members(&forty)[35..]
        .iter()
        .map(|m| json!({ "name": "deleteMember", "args": [m["id"]], "options": { "confirmed": true } }))
        .collect();
    assert_accepted(&step(&mut a, "delete-1", 7, Value::Array(delete)).await);
    let thirty_five = s.flow(&wang, &id).await;
    // 林教練加 5 個（40）
    let add = json!([{ "name": "addMembers", "args": [people(5)] }]);
    assert_accepted(&step(&mut b, "add-2", 8, add).await);

    // 王教練復原刪人：45 人，退回
    let change = s
        .state
        .core
        .remote_change(thirty_five["flow"].to_string(), forty["flow"].to_string())
        .await
        .unwrap();
    let change: Value = serde_json::from_str(&change).unwrap();
    let reply = undo(&mut a, "undo-1", 9, "delete-1", false, change).await;
    let why = json!({ "code": "flow_check_max_members", "max": 40 });
    let reason = json!({ "message": "一支流程最多 40 人", "why": why });
    assert_sent_back(
        &reply,
        "這步不能復原：一支流程最多 40 人",
        json!({ "code": "undoBlocked", "redo": false, "reason": reason }),
    );
    assert_eq!(members(&s.flow(&wang, &id).await).len(), 40);
}

#[sqlx::test]
async fn a_step_older_than_30_days_cannot_be_undone(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;

    assert_accepted(&step(&mut a, "rename-1", 6, rename("全國賽決賽")).await);
    assert_accepted(&step(&mut a, "rename-2", 7, rename("區賽")).await);
    sqlx::query("UPDATE flow_steps SET created_at = created_at - interval '31 days' WHERE flow_id = $1 AND step_id = 'rename-1'")
        .bind(&id)
        .execute(&s.state.db)
        .await
        .unwrap();

    let reply = undo(&mut a, "undo-1", 8, "rename-1", false, name_back("全國賽")).await;
    assert_sent_back(
        &reply,
        "太久以前的，不能復原",
        json!({ "code": "undoTooOld", "redo": false }),
    );
    // 已經清掉的步（清掉在 #266）也一樣
    sqlx::query("DELETE FROM flow_steps WHERE flow_id = $1 AND step_id = 'rename-2'")
        .bind(&id)
        .execute(&s.state.db)
        .await
        .unwrap();
    let reply = undo(
        &mut a,
        "undo-2",
        8,
        "rename-2",
        false,
        name_back("全國賽決賽"),
    )
    .await;
    assert_sent_back(
        &reply,
        "太久以前的，不能復原",
        json!({ "code": "undoTooOld", "redo": false }),
    );
    assert_eq!(s.flow(&wang, &id).await["flow"]["name"], "區賽");
}
