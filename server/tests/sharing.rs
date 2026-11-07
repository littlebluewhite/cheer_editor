// 分享給使用者、權限（#250）：擁有者用 email 分享、改權限、收回；別人離開；每一級對每個 API、
// 每種 WebSocket 訊息收或擋（#234 的權限表）。開一台真的伺服器（網路埠），HTTP 用 oneshot、房間用 WebSocket。
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

    async fn people(&self, who: &User, id: &str) -> (StatusCode, Value) {
        self.send("GET", &format!("/api/flows/{id}/people"), None, &who.cookie)
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

    async fn revoke(&self, owner: &User, id: &str, email: &str) -> StatusCode {
        let user = self.user_id(email).await;
        let path = format!("/api/flows/{id}/people/{user}/remove");
        self.send("POST", &path, None, &owner.cookie).await.0
    }

    /// 停用一個人（管理員那頁做的事；這裡直接改，測的是分享）。
    async fn disable(&self, email: &str) {
        sqlx::query("UPDATE users SET disabled_at = now() WHERE email = $1")
            .bind(email)
            .execute(&self.state.db)
            .await
            .unwrap();
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

async fn step(socket: &mut Socket, step_id: &str, name: &str) -> Value {
    let commands = json!([{ "name": "renameFlow", "args": [name] }]);
    let message = json!({ "kind": "step", "stepId": step_id, "seen": 0, "commands": commands });
    say(socket, message).await;
    hear(socket).await
}

fn names(people: &Value) -> Vec<String> {
    people
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            format!(
                "{} {}",
                p["name"].as_str().unwrap(),
                p["role"].as_str().unwrap()
            )
        })
        .collect()
}

#[sqlx::test]
async fn the_owner_shares_by_email_and_it_shows_up_in_shared_with_me(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let id = s.create(&wang, "全國賽").await;

    // 預設編輯者；email 不分大小寫、頭尾空白不算
    let (status, people) = s.share(&wang, &id, "  LIN@example.com ", "editor").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(names(&people), ["王教練 owner", "林教練 editor"]);

    let (_, list) = s.send("GET", "/api/flows", None, &lin.cookie).await;
    assert_eq!(list["mine"], json!([]));
    assert_eq!(list["shared"][0]["id"], id.as_str());
    assert_eq!(list["shared"][0]["name"], "全國賽");
    assert_eq!(list["shared"][0]["ownerName"], "王教練");
    assert_eq!(list["shared"][0]["ownerDisabled"], false);
    assert_eq!(list["shared"][0]["role"], "editor");
    let (_, list) = s.send("GET", "/api/flows", None, &wang.cookie).await;
    assert_eq!(list["shared"], json!([]));

    // 打開：拿得到，知道自己的權限
    let (status, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, &lin.cookie)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(got["role"], "editor");
    let (_, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, &wang.cookie)
        .await;
    assert_eq!(got["role"], "owner");

    // 擁有者被停用：清單上寫已停用，流程照常用
    s.disable(wang.email).await;
    let (_, list) = s.send("GET", "/api/flows", None, &lin.cookie).await;
    assert_eq!(list["shared"][0]["ownerDisabled"], true);
    let (status, _) = s
        .send("GET", &format!("/api/flows/{id}"), None, &lin.cookie)
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[sqlx::test]
async fn sharing_says_why_it_cannot_add_someone(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let chen = s.user("chen@example.com", "陳教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "recorder").await;
    s.disable(chen.email).await;

    let (status, why) = s.share(&wang, &id, "nobody@example.com", "editor").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(why, json!({ "kind": "noAccount" }));
    let (_, why) = s.share(&wang, &id, "WANG@example.com", "editor").await;
    assert_eq!(why, json!({ "kind": "yourself" }));
    let (_, why) = s.share(&wang, &id, lin.email, "editor").await;
    assert_eq!(
        why,
        json!({ "kind": "already", "name": "林教練", "role": "recorder" })
    );
    let (_, why) = s.share(&wang, &id, chen.email, "editor").await;
    assert_eq!(why, json!({ "kind": "disabled", "name": "陳教練" }));

    let (_, people) = s.people(&wang, &id).await;
    assert_eq!(names(&people), ["王教練 owner", "林教練 recorder"]);
}

#[sqlx::test]
async fn only_the_owner_sees_emails(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let chen = s.user("chen@example.com", "陳教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "viewer").await;
    s.share(&wang, &id, chen.email, "editor").await;
    s.disable(chen.email).await;

    let (_, mine) = s.people(&wang, &id).await;
    assert_eq!(mine[0]["email"], "wang@example.com");
    assert_eq!(mine[0]["me"], true);
    assert_eq!(mine[1]["email"], "lin@example.com");
    assert_eq!(mine[2]["disabled"], true);

    let (status, theirs) = s.people(&lin, &id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        names(&theirs),
        ["王教練 owner", "林教練 viewer", "陳教練 editor"]
    );
    for p in theirs.as_array().unwrap() {
        assert_eq!(p.get("email"), None, "{p}");
    }
    assert_eq!(theirs[1]["me"], true);
    assert_eq!(theirs[0]["me"], false);
}

#[sqlx::test]
async fn only_the_owner_shares_changes_roles_and_revokes(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let chen = s.user("chen@example.com", "陳教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "editor").await;

    // 編輯者：不能分享、改權限、收回（403）
    let (status, _) = s.share(&lin, &id, chen.email, "viewer").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        s.set_role(&lin, &id, lin.email, "viewer").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(s.revoke(&lin, &id, lin.email).await, StatusCode::FORBIDDEN);
    // 沒權限的人：跟沒有這支一樣（404）
    let (status, _) = s.share(&chen, &id, chen.email, "viewer").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = s.people(&chen, &id).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // 擁有者：改權限、收回
    assert_eq!(
        s.set_role(&wang, &id, lin.email, "viewer").await,
        StatusCode::OK
    );
    let (_, people) = s.people(&wang, &id).await;
    assert_eq!(names(&people), ["王教練 owner", "林教練 viewer"]);
    // 不在名單上的人、擁有者自己：改不了
    assert_eq!(
        s.set_role(&wang, &id, chen.email, "viewer").await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        s.set_role(&wang, &id, wang.email, "viewer").await,
        StatusCode::NOT_FOUND
    );

    assert_eq!(s.revoke(&wang, &id, lin.email).await, StatusCode::OK);
    let (_, people) = s.people(&wang, &id).await;
    assert_eq!(names(&people), ["王教練 owner"]);
    // 收回後下一個請求就擋
    let (status, _) = s
        .send("GET", &format!("/api/flows/{id}"), None, &lin.cookie)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, list) = s.send("GET", "/api/flows", None, &lin.cookie).await;
    assert_eq!(list["shared"], json!([]));
}

#[sqlx::test]
async fn others_leave_but_the_owner_cannot(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "viewer").await;

    let leave = format!("/api/flows/{id}/leave");
    let (status, _) = s.send("POST", &leave, None, &wang.cookie).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = s.send("POST", &leave, None, &lin.cookie).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, list) = s.send("GET", "/api/flows", None, &lin.cookie).await;
    assert_eq!(list["shared"], json!([]));
    let (status, _) = s.send("POST", &leave, None, &lin.cookie).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn the_admin_gets_nothing_not_shared_with_them(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    // 最後開的是管理員
    let admin = s.user("admin@example.com", "管理員").await;

    let (status, _) = s
        .send("GET", &format!("/api/flows/{id}"), None, &admin.cookie)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = s.people(&admin, &id).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, list) = s.send("GET", "/api/flows", None, &admin.cookie).await;
    assert_eq!(list, json!({ "mine": [], "shared": [] }));
    assert_eq!(
        s.connect(&admin, &id).await.err(),
        Some(StatusCode::NOT_FOUND)
    );
}

#[sqlx::test]
async fn every_role_joins_the_room_but_only_editors_change_the_flow(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let ed = s.user("ed@example.com", "編輯者").await;
    let rec = s.user("rec@example.com", "記錄者").await;
    let view = s.user("view@example.com", "檢視者").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, ed.email, "editor").await;
    s.share(&wang, &id, rec.email, "recorder").await;
    s.share(&wang, &id, view.email, "viewer").await;

    for (who, can, n) in [
        (&wang, true, 1),
        (&ed, true, 2),
        (&rec, false, 3),
        (&view, false, 4),
    ] {
        let (mut room, first) = s.join(who, &id).await;
        assert_eq!(first["kind"], "ready", "{}", who.email);
        let reply = step(&mut room, &format!("step-{n}"), &format!("名字{n}")).await;
        if can {
            assert_eq!(reply["kind"], "accepted", "{}", who.email);
        } else {
            assert_eq!(reply["kind"], "rejected", "{}", who.email);
            assert_eq!(reply["message"], "沒存進去：你只能看這支流程");
        }
    }
    let (_, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, &view.cookie)
        .await;
    assert_eq!(got["flow"]["name"], "名字2");
    assert_eq!(got["step"], 2);
}

#[sqlx::test]
async fn the_room_is_told_when_a_role_changes_or_is_revoked(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "editor").await;
    let (mut owner_room, _) = s.join(&wang, &id).await;
    let (mut room, _) = s.join(&lin, &id).await;
    assert_eq!(step(&mut room, "step-a", "改過").await["kind"], "accepted");

    // 降成檢視者：馬上說，帶伺服器現在的樣子；之後送的步不收
    s.set_role(&wang, &id, lin.email, "viewer").await;
    let told = hear(&mut room).await;
    assert_eq!(told["kind"], "roleChanged");
    assert_eq!(told["role"], "viewer");
    assert_eq!(told["flow"]["name"], "改過");
    assert_eq!(told["step"], 1);
    assert_eq!(step(&mut room, "step-b", "偷改").await["kind"], "rejected");

    // 升回編輯者：又能改
    s.set_role(&wang, &id, lin.email, "editor").await;
    assert_eq!(hear(&mut room).await["role"], "editor");
    assert_eq!(step(&mut room, "step-c", "又改").await["kind"], "accepted");

    // 收回：說被收回，房間關掉
    s.revoke(&wang, &id, lin.email).await;
    assert_eq!(hear(&mut room).await, json!({ "kind": "revoked" }));
    assert_eq!(hear(&mut room).await, Value::Null);
    // 擁有者的房間沒收到別人的事
    let quiet = tokio::time::timeout(Duration::from_millis(200), owner_room.next()).await;
    assert!(quiet.is_err(), "擁有者不該收到：{quiet:?}");
    // 再連也連不上
    assert_eq!(
        s.connect(&lin, &id).await.err(),
        Some(StatusCode::NOT_FOUND)
    );
}

#[sqlx::test]
async fn a_step_after_being_revoked_is_turned_away(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "editor").await;
    let (mut room, _) = s.join(&lin, &id).await;

    // 不經過房間通知（例：另一台伺服器收回的）：下一步照樣擋
    sqlx::query("DELETE FROM flow_permissions")
        .execute(&s.state.db)
        .await
        .unwrap();
    assert_eq!(
        step(&mut room, "step-x", "偷改").await,
        json!({ "kind": "revoked" })
    );
    let (_, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, &wang.cookie)
        .await;
    assert_eq!(got["flow"]["name"], "全國賽");
}
