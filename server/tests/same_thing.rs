// 改到同一個東西時，後到的退回（#254，ADR 0010、0014）：伺服器記下每一步改到哪些東西（以分頁算），
// 收到一步時，改到的東西在「上次看到」之後被別的分頁改過就退回，訊息寫最後改到的人；合起來被規則擋下也退回；
// 一步被退回後，同一個分頁接著送的也退回，直到換成伺服器的樣子。
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
/// 範例流程裡的那段音樂、Lib、小美。
const SEGMENT: &str = "ss8th1zgvyub2";
const LIB: &str = "x2l8axo41g3ph";
const MEI: &str = "mzk52d2cu1vww";

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

/// 退回了，by 是訊息要寫的人（最後改到的人；沒有是 Null）。
fn assert_rejected(reply: &Value, by: Value) {
    assert_eq!(reply["kind"], "rejected", "{reply}");
    assert_eq!(
        reply.get("by").cloned().unwrap_or(Value::Null),
        by,
        "{reply}"
    );
}

#[sqlx::test]
async fn two_tabs_changing_different_things_both_count(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;

    // 兩個人都看到第 6 步，同時改：一個改流程名字，一個加一段
    let first = step(&mut a, "rename-1", 6, rename("全國賽決賽")).await;
    let segment = json!([{ "name": "addSegment", "args": ["chant"] }]);
    let second = step(&mut b, "segment-1", 6, segment).await;

    assert_eq!(first["kind"], "accepted", "{first}");
    assert_eq!(second["kind"], "accepted", "{second}");
    let flow = &s.flow(&wang, &id).await["flow"];
    assert_eq!(flow["name"], "全國賽決賽");
    assert_eq!(flow["segments"].as_array().unwrap().len(), 2);
}

#[sqlx::test]
async fn the_same_thing_changed_by_two_tabs_sends_the_later_back_naming_who(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;

    let first = step(&mut a, "rename-1", 6, rename("全國賽決賽")).await;
    assert_eq!(first["kind"], "accepted");
    let reply = step(&mut b, "rename-2", 6, rename("區賽")).await;

    assert_rejected(&reply, json!("王教練"));
    assert_eq!(reply["message"], "");
    assert_eq!(reply["why"], json!({ "code": "sameThing" }));
    assert_eq!(reply["step"], 7);
    assert_eq!(reply["flow"]["name"], "全國賽決賽");
    assert_eq!(s.flow(&wang, &id).await["flow"]["name"], "全國賽決賽");

    // 看過王教練那一步（第 7 步）再改：收
    let reply = step(&mut b, "rename-3", 7, rename("區賽")).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
}

#[sqlx::test]
async fn adding_a_member_or_a_formation_at_the_same_beat_sends_the_later_back(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;
    let formations = |flow: &Value| flow["flow"]["formations"].as_array().unwrap().len();

    // 王教練加隊員；林教練沒看到，在第 4 秒插一張站位（伺服器跑時新的人也被放進那張）
    let add = json!([{ "name": "addMembers", "args": [[
        { "name": "小新", "gender": "F", "globalRole": "top" }
    ]] }]);
    assert_eq!(step(&mut a, "add-1", 6, add).await["kind"], "accepted");
    let insert = json!([{ "name": "insertFormation", "args": [4] }]);
    let reply = step(&mut b, "insert-1", 6, insert.clone()).await;
    assert_rejected(&reply, json!("王教練"));
    assert_eq!(formations(&s.flow(&wang, &id).await), 1);

    // 兩個人在同一拍各加一張站位：後到的被規則擋下，寫先改的人和原因
    let first = step(&mut a, "insert-2", 7, insert.clone()).await;
    assert_eq!(first["kind"], "accepted", "{first}");
    let reply = step(&mut b, "insert-3", 7, insert).await;
    assert_rejected(&reply, json!("王教練"));
    assert_eq!(reply["message"], "這一拍已經有站位", "{reply}");
    let reason = json!({ "message": "這一拍已經有站位", "why": { "code": "formation_taken" } });
    let why = json!({ "code": "blocked", "reason": reason, "ask": false });
    assert_eq!(reply["why"], why, "{reply}");
    assert_eq!(formations(&s.flow(&wang, &id).await), 2);
}

#[sqlx::test]
async fn a_confirmed_delete_that_also_deletes_what_someone_just_added_is_sent_back(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;

    // 王教練在那一段加一個動作；林教練只看到 Lib，按了確定刪掉那一段
    let action = json!({ "segmentId": SEGMENT, "category": "dance", "name": "舞", "start": 16,
        "length": 8, "note": "", "members": [{ "memberId": MEI, "role": "上層" }] });
    let add = json!([{ "name": "addAction", "args": [action] }]);
    let first = step(&mut a, "action-1", 6, add).await;
    assert_eq!(first["kind"], "accepted", "{first}");
    let delete =
        json!([{ "name": "deleteSegment", "args": [SEGMENT], "options": { "confirmed": true } }]);
    let reply = step(&mut b, "delete-1", 6, delete).await;

    assert_rejected(&reply, json!("王教練"));
    let flow = &s.flow(&wang, &id).await["flow"];
    assert_eq!(flow["actions"].as_array().unwrap().len(), 2);
    assert_eq!(flow["actions"][0]["id"], LIB);
}

#[sqlx::test]
async fn after_a_step_is_sent_back_the_tab_is_sent_back_until_it_takes_the_server_flow(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;

    assert_eq!(
        step(&mut a, "rename-1", 6, rename("全國賽決賽")).await["kind"],
        "accepted"
    );
    let reply = step(&mut b, "rename-2", 6, rename("區賽")).await;
    assert_rejected(&reply, json!("王教練"));
    let server_step = reply["step"].as_i64().unwrap();

    // 還沒換成伺服器的樣子就接著送（改的是別的東西）：也退回，流程沒變
    let segment = json!([{ "name": "addSegment", "args": ["chant"] }]);
    let reply = step(&mut b, "segment-1", 6, segment.clone()).await;
    assert_eq!(reply["kind"], "rejected", "{reply}");
    assert_eq!(reply["message"], "沒存進去：前一步沒存進去，這一步也不算");
    assert_eq!(reply["why"], json!({ "code": "afterSentBack" }));
    assert_eq!(s.flow(&wang, &id).await["step"], server_step);

    // 換成伺服器的樣子（上次看到的是退回時說的那一步）之後：收
    let reply = step(&mut b, "segment-2", server_step, segment).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
}

#[sqlx::test]
async fn two_tabs_of_the_same_person_send_each_other_back(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut phone = s.join(&wang, &id, "tab-phone").await;
    let mut laptop = s.join(&wang, &id, "tab-laptop").await;

    let first = step(&mut phone, "rename-1", 6, rename("全國賽決賽")).await;
    assert_eq!(first["kind"], "accepted");
    let reply = step(&mut laptop, "rename-2", 6, rename("區賽")).await;
    assert_rejected(&reply, json!("王教練"));

    // 同一個分頁接著改自己剛改的：不算別人
    let reply = step(&mut phone, "rename-3", 6, rename("全國賽複賽")).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
}

#[sqlx::test]
async fn when_the_last_seen_step_is_no_longer_kept_the_tab_takes_the_server_flow(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut b = s.join(&lin, &id, "tab-b").await;

    // 超過 30 天的步清掉了（清掉在 #266）：第 1–3 步沒留
    sqlx::query("DELETE FROM flow_steps WHERE flow_id = $1 AND step <= 3")
        .bind(&id)
        .execute(&s.state.db)
        .await
        .unwrap();
    let reply = step(&mut b, "rename-1", 2, rename("區賽")).await;

    assert_rejected(&reply, Value::Null);
    assert_eq!(
        reply["message"],
        "沒存進去：離你上次看到太久了，換成現在的樣子"
    );
    assert_eq!(reply["why"], json!({ "code": "tooOld" }));
    assert_eq!(reply["step"], 6);
    assert_eq!(reply["flow"]["members"][0]["id"], MEI);
    assert_eq!(s.flow(&wang, &id).await["flow"]["name"], "全國賽");
    // 換成伺服器的樣子之後（第 3 步之後的還留著）：照常收
    let reply = step(&mut b, "rename-2", 6, rename("區賽")).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
}

#[sqlx::test]
async fn each_step_keeps_what_it_changed(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let first = step(&mut a, "rename-1", 6, rename("全國賽決賽")).await;
    assert_eq!(first["kind"], "accepted");

    let (keys,): (Vec<String>,) =
        sqlx::query_as("SELECT keys FROM flow_steps WHERE flow_id = $1 AND step = 7")
            .bind(&id)
            .fetch_one(&s.state.db)
            .await
            .unwrap();
    assert_eq!(keys, vec!["name"]);
}

#[sqlx::test]
async fn the_sender_gets_what_the_server_made_of_its_step(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.sample(&wang, &lin).await;
    let mut a = s.join(&wang, &id, "tab-a").await;
    let mut b = s.join(&lin, &id, "tab-b").await;
    let start = s.flow(&lin, &id).await["flow"].to_string();
    let add = |name: &str| json!([{ "name": "addMembers", "args": [[{ "name": name, "gender": "F", "globalRole": "top" }]] }]);

    // 兩個人都看到第 6 步，各加一個隊員：都收，伺服器把後到的放在別的位置
    let first = step(&mut a, "add-a", 6, add("小新")).await;
    assert_eq!(first["kind"], "accepted", "{first}");
    let ack = step(&mut b, "add-b", 6, add("小華")).await;
    assert_eq!(ack["kind"], "accepted", "{ack}");

    // 林教練的分頁：先在自己的畫面上跑自己的一步，再套上王教練的那一步（房間送來的），再套「收了」帶的改動
    let mine = s
        .state
        .core
        .run_step(start, "[]".into(), add("小華").to_string(), "add-b".into())
        .await
        .unwrap();
    let mine = serde_json::from_str::<Value>(&mine).unwrap()["flow"].to_string();
    let theirs: (String,) =
        sqlx::query_as("SELECT change::text FROM flow_steps WHERE flow_id = $1 AND step = 7")
            .bind(&id)
            .fetch_one(&s.state.db)
            .await
            .unwrap();
    let mut seen = s
        .state
        .core
        .apply_remote_change(mine, theirs.0)
        .await
        .unwrap();
    if let Some(change) = ack.get("change") {
        seen = s
            .state
            .core
            .apply_remote_change(seen, change.to_string())
            .await
            .unwrap();
    }

    let server = s.flow(&wang, &id).await["flow"].clone();
    let seen: Value = serde_json::from_str(&seen).unwrap();
    let names = |flow: &Value| -> Vec<String> {
        let members = flow["members"].as_array().unwrap();
        members
            .iter()
            .map(|m| m["name"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(names(&seen), names(&server));
    assert_eq!(seen["formations"], server["formations"]);
    assert_eq!(seen, server);

    assert!(ack["change"].is_object(), "{ack}");
    // 斷線重送同一步（步驟 id 一樣）：一樣帶那一步的改動
    let again = step(&mut b, "add-b", 6, add("小華")).await;
    assert_eq!(again["kind"], "accepted", "{again}");
    assert_eq!(again["change"], ack["change"], "{again}");
}
