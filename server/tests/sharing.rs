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

/// 伺服器說的下一句（誰開著、別的連線的改動〔#253〕跳過）；房間關了是 Null。
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

/// 送一步（改流程名字），回伺服器的回答。seen：上次看到第幾步。
async fn step(socket: &mut Socket, step_id: &str, seen: i64, name: &str) -> Value {
    let commands = json!([{ "name": "renameFlow", "args": [name] }]);
    let message = json!({ "kind": "step", "stepId": step_id, "seen": seen, "commands": commands });
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
        // 前一個人改好的都看到了（改的是同一個名字，沒看到會被退回）
        let reply = step(
            &mut room,
            &format!("step-{n}"),
            (n - 1).min(2),
            &format!("名字{n}"),
        )
        .await;
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
    assert_eq!(
        step(&mut room, "step-a", 0, "改過").await["kind"],
        "accepted"
    );

    // 降成檢視者：馬上說，帶伺服器現在的樣子；之後送的步不收
    s.set_role(&wang, &id, lin.email, "viewer").await;
    let told = hear(&mut room).await;
    assert_eq!(told["kind"], "roleChanged");
    assert_eq!(told["role"], "viewer");
    assert_eq!(told["flow"]["name"], "改過");
    assert_eq!(told["step"], 1);
    assert_eq!(
        step(&mut room, "step-b", 1, "偷改").await["kind"],
        "rejected"
    );

    // 升回編輯者：又能改
    s.set_role(&wang, &id, lin.email, "editor").await;
    assert_eq!(hear(&mut room).await["role"], "editor");
    assert_eq!(
        step(&mut room, "step-c", 1, "又改").await["kind"],
        "accepted"
    );

    // 收回：說被收回，房間關掉
    s.revoke(&wang, &id, lin.email).await;
    assert_eq!(hear(&mut room).await, json!({ "kind": "revoked" }));
    assert_eq!(hear(&mut room).await, Value::Null);
    // 擁有者的房間沒收到別人的事
    let quiet = tokio::time::timeout(Duration::from_millis(200), hear(&mut owner_room)).await;
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
        step(&mut room, "step-x", 0, "偷改").await,
        json!({ "kind": "revoked" })
    );
    let (_, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, &wang.cookie)
        .await;
    assert_eq!(got["flow"]["name"], "全國賽");
}

// ---------- 移交、刪流程（#252） ----------

impl Server {
    /// 擁有者把流程移交給名單上的一個人。
    async fn hand_over(&self, owner: &User, id: &str, email: &str) -> (StatusCode, Value) {
        let user = self.user_id(email).await;
        let path = format!("/api/flows/{id}/people/{user}/owner");
        self.send("POST", &path, None, &owner.cookie).await
    }

    /// 管理員把一個（被停用的）人的流程全部移交給 to。
    async fn admin_hand_over(&self, admin: &User, from: &str, to: &str) -> (StatusCode, Value) {
        let user = self.user_id(from).await;
        let path = format!("/api/admin/users/{user}/transfer");
        self.send("POST", &path, Some(json!({ "email": to })), &admin.cookie)
            .await
    }

    async fn delete(&self, who: &User, id: &str) -> StatusCode {
        self.send(
            "POST",
            &format!("/api/flows/{id}/delete"),
            None,
            &who.cookie,
        )
        .await
        .0
    }

    async fn role(&self, who: &User, id: &str) -> Value {
        let (_, got) = self
            .send("GET", &format!("/api/flows/{id}"), None, &who.cookie)
            .await;
        got["role"].clone()
    }

    /// 管理使用者頁上這個人那一列的狀態。
    async fn status(&self, admin: &User, email: &str) -> Value {
        let (_, users) = self
            .send("GET", "/api/admin/users", None, &admin.cookie)
            .await;
        users
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["email"] == email)
            .unwrap()["status"]
            .clone()
    }
}

#[sqlx::test]
async fn the_owner_hands_over_only_to_someone_on_the_list_who_is_not_disabled(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let chen = s.user("chen@example.com", "陳教練").await;
    let mei = s.user("mei@example.com", "小美").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "viewer").await;
    s.share(&wang, &id, chen.email, "editor").await;
    s.disable(chen.email).await;

    // 不在名單上：404；被停用：409；不是擁有者：403
    assert_eq!(
        s.hand_over(&wang, &id, mei.email).await.0,
        StatusCode::NOT_FOUND
    );
    let (status, why) = s.hand_over(&wang, &id, chen.email).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(why, json!({ "kind": "disabled", "name": "陳教練" }));
    assert_eq!(
        s.hand_over(&lin, &id, lin.email).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(s.role(&wang, &id).await, "owner");

    // 哪一級都能接：檢視者接手，原擁有者變編輯者；回的名單沒有 email（他已經不是擁有者）
    let (status, people) = s.hand_over(&wang, &id, lin.email).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        names(&people),
        ["林教練 owner", "陳教練 editor", "王教練 editor"]
    );
    assert_eq!(people[0].get("email"), None);
    assert_eq!(s.role(&lin, &id).await, "owner");
    assert_eq!(s.role(&wang, &id).await, "editor");
    let (_, list) = s.send("GET", "/api/flows", None, &lin.cookie).await;
    assert_eq!(list["mine"][0]["id"], id.as_str());
    assert_eq!(list["shared"], json!([]));
    let (_, list) = s.send("GET", "/api/flows", None, &wang.cookie).await;
    assert_eq!(list["mine"], json!([]));
    assert_eq!(list["shared"][0]["ownerName"], "林教練");
    assert_eq!(list["shared"][0]["role"], "editor");

    // 原擁有者已經不能移交；新擁有者能分享
    assert_eq!(
        s.hand_over(&wang, &id, lin.email).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        s.share(&lin, &id, mei.email, "viewer").await.0,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn the_room_hears_who_is_owner_now(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "recorder").await;
    let (mut owner_room, _) = s.join(&wang, &id).await;
    let (mut room, _) = s.join(&lin, &id).await;

    s.hand_over(&wang, &id, lin.email).await;
    let told = hear(&mut room).await;
    assert_eq!(told["kind"], "roleChanged");
    assert_eq!(told["role"], "owner");
    assert_eq!(hear(&mut owner_room).await["role"], "editor");
    // 記錄者變擁有者：能改了
    assert_eq!(
        step(&mut room, "step-a", 0, "新名字").await["kind"],
        "accepted"
    );
}

#[sqlx::test]
async fn the_admin_hands_over_everything_of_a_disabled_user_to_one_person(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let huang = s.user("huang@example.com", "黃教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let chen = s.user("chen@example.com", "陳教練").await;
    let one = s.create(&huang, "全國賽").await;
    s.create(&huang, "校慶表演").await;
    let others = s.create(&lin, "林的").await;
    // 林教練本來就是其中一支的記錄者；黃教練在林教練的流程裡是檢視者
    s.share(&huang, &one, lin.email, "recorder").await;
    s.share(&lin, &others, huang.email, "viewer").await;
    let admin = s.user("admin@example.com", "管理員").await;

    // 還沒被停用：不能做
    let (status, why) = s.admin_hand_over(&admin, huang.email, lin.email).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(why, json!({ "kind": "notAllowed" }));
    // 不是管理員：403
    let (status, _) = s.admin_hand_over(&lin, huang.email, lin.email).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    s.disable(huang.email).await;
    // 管理員那頁：「已停用・他有 2 支流程」
    assert_eq!(
        s.status(&admin, huang.email).await,
        json!({ "kind": "disabled", "flows": 2 })
    );

    // 擋：沒帳號、交給他自己、接手的人被停用
    let (_, why) = s
        .admin_hand_over(&admin, huang.email, "nobody@example.com")
        .await;
    assert_eq!(why, json!({ "kind": "noAccount" }));
    let (_, why) = s
        .admin_hand_over(&admin, huang.email, "HUANG@example.com")
        .await;
    assert_eq!(why, json!({ "kind": "sameUser" }));
    s.disable(chen.email).await;
    let (_, why) = s.admin_hand_over(&admin, huang.email, chen.email).await;
    assert_eq!(why, json!({ "kind": "disabled", "name": "陳教練" }));

    // 全部交給林教練：回的只有支數
    let (status, done) = s
        .admin_hand_over(&admin, huang.email, " LIN@example.com")
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(done, json!({ "flows": 2 }));
    let (_, list) = s.send("GET", "/api/flows", None, &lin.cookie).await;
    let mut mine: Vec<&str> = list["mine"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    mine.sort();
    assert_eq!(mine, ["全國賽", "林的", "校慶表演"]);
    assert_eq!(list["shared"], json!([]));
    // 原擁有者變這兩支的編輯者；他在別人流程裡的權限不動
    let (_, people) = s.people(&lin, &one).await;
    assert_eq!(names(&people), ["林教練 owner", "黃教練 editor"]);
    assert_eq!(people[1]["disabled"], true);
    let (_, people) = s.people(&lin, &others).await;
    assert_eq!(names(&people), ["林教練 owner", "黃教練 viewer"]);
    assert_eq!(
        s.status(&admin, huang.email).await,
        json!({ "kind": "disabled", "flows": 0 })
    );
}

#[sqlx::test]
async fn only_the_owner_deletes_and_everything_goes_with_it(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, lin.email, "editor").await;
    let (mut lin_room, _) = s.join(&lin, &id).await;
    let (mut owner_room, _) = s.join(&wang, &id).await;
    assert_eq!(
        step(&mut lin_room, "step-a", 0, "改過").await["kind"],
        "accepted"
    );
    // 一個還在用的音樂、一個早就不用的
    let early = Utc.with_ymd_and_hms(2026, 11, 1, 9, 0, 0).unwrap();
    for (audio, unused) in [("a1", None), ("a2", Some(early))] {
        sqlx::query(
            "INSERT INTO flow_audio (flow_id, audio_id, object_key, size, created_at, unused_since)
             VALUES ($1, $2, $3, 10, $4, $5)",
        )
        .bind(&id)
        .bind(audio)
        .bind(format!("flows/{id}/{audio}.mp3"))
        .bind(early)
        .bind(unused)
        .execute(&s.state.db)
        .await
        .unwrap();
    }

    // 分享連結開著
    let (_, link) = s
        .send(
            "POST",
            &format!("/api/flows/{id}/link"),
            Some(json!({ "on": true })),
            &wang.cookie,
        )
        .await;
    let link = format!("/api/links/{}", link["token"].as_str().unwrap());
    assert_eq!(s.send("GET", &link, None, "").await.0, StatusCode::OK);

    // 編輯者不能刪（403），沒權限的 404
    assert_eq!(s.delete(&lin, &id).await, StatusCode::FORBIDDEN);
    let admin = s.user("admin@example.com", "管理員").await;
    assert_eq!(s.delete(&admin, &id).await, StatusCode::NOT_FOUND);

    assert_eq!(s.delete(&wang, &id).await, StatusCode::NO_CONTENT);
    // 開著的人都被通知，房間關掉
    assert_eq!(hear(&mut lin_room).await, json!({ "kind": "deleted" }));
    assert_eq!(hear(&mut lin_room).await, Value::Null);
    assert_eq!(hear(&mut owner_room).await, json!({ "kind": "deleted" }));
    // 所有人都打不開
    for who in [&wang, &lin] {
        let (status, _) = s
            .send("GET", &format!("/api/flows/{id}"), None, &who.cookie)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let (_, list) = s.send("GET", "/api/flows", None, &who.cookie).await;
        assert_eq!(list, json!({ "mine": [], "shared": [] }));
    }
    assert_eq!(
        s.connect(&lin, &id).await.err(),
        Some(StatusCode::NOT_FOUND)
    );
    assert_eq!(
        s.send("GET", &link, None, "").await.0,
        StatusCode::NOT_FOUND
    );
    // 紀錄一起刪
    for sql in [
        "SELECT count(*) FROM flow_steps WHERE flow_id = $1",
        "SELECT count(*) FROM flow_permissions WHERE flow_id = $1",
    ] {
        let (n,): (i64,) = sqlx::query_as(sql)
            .bind(&id)
            .fetch_one(&s.state.db)
            .await
            .unwrap();
        assert_eq!(n, 0, "{sql}");
    }
    // 音樂記下哪天不用了（30 天後真的刪在 #266）；早就不用的不動
    let audio: Vec<(String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT audio_id, unused_since FROM flow_audio WHERE flow_id = $1 ORDER BY audio_id",
    )
    .bind(&id)
    .fetch_all(&s.state.db)
    .await
    .unwrap();
    let now = Utc.with_ymd_and_hms(2026, 11, 7, 9, 0, 0).unwrap();
    assert_eq!(audio, [("a1".to_owned(), now), ("a2".to_owned(), early)]);
    // 再刪一次：沒有這支了
    assert_eq!(s.delete(&wang, &id).await, StatusCode::NOT_FOUND);
}
