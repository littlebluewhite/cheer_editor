// 刪除帳號（#369）：管理員刪掉已停用的人。他這個使用者、他擁有的流程、他在別人流程上的權限都沒了；
// 他在別人流程裡記的紀錄、改過的步留著，不寫是誰；同一個 email 再邀請是新的人；管理員刪不了自己。
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

/// 要被刪的人：email、名字都挑別的地方不會出現的，資料庫整個找一遍。
const WANG: &str = "wang.deleted@example.com";
const WANG_NAME: &str = "王要刪掉教練";

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

    /// 登入；登不進來回 None。
    async fn login(&self, email: &str, password: &str) -> Option<String> {
        let req = Request::post("/api/login")
            .header("sec-fetch-site", "same-origin")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({ "email": email, "password": password }).to_string(),
            ))
            .unwrap();
        let res = app(self.state.clone(), self.site.path())
            .oneshot(req)
            .await
            .unwrap();
        let set_cookie = res.headers().get(header::SET_COOKIE)?;
        Some(
            set_cookie
                .to_str()
                .unwrap()
                .split(';')
                .next()
                .unwrap()
                .to_owned(),
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
        let cookie = self.login(email, GOOD).await.unwrap();
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

    async fn share(&self, owner: &User, id: &str, email: &str, role: &str) {
        let body = json!({ "email": email, "role": role });
        let (status, _) = self
            .send(
                "POST",
                &format!("/api/flows/{id}/people"),
                Some(body),
                &owner.cookie,
            )
            .await;
        assert_eq!(status, StatusCode::OK);
    }

    async fn user_id(&self, email: &str) -> i64 {
        sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
            .bind(email)
            .fetch_one(&self.state.db)
            .await
            .unwrap()
    }

    async fn disable(&self, admin: &User, email: &str) {
        let id = self.user_id(email).await;
        let path = format!("/api/admin/users/{id}/disable");
        assert_eq!(
            self.send("POST", &path, None, &admin.cookie).await.0,
            StatusCode::NO_CONTENT
        );
    }

    /// 管理員刪掉這個 id 的人。
    async fn delete_user(&self, admin: &User, id: i64) -> (StatusCode, Value) {
        let path = format!("/api/admin/users/{id}/delete");
        self.send("POST", &path, None, &admin.cookie).await
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

    /// 連上、打招呼（上次看到第 seen 步），回伺服器說的、到「可以送步」為止（含）。
    async fn join(&self, who: &User, id: &str, tab: &str, seen: i64) -> (Socket, Vec<Value>) {
        let mut socket = self.connect(who, id).await.unwrap();
        let hello =
            json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": tab, "seen": seen });
        say(&mut socket, hello).await;
        let mut heard = Vec::new();
        loop {
            let message = hear_any(&mut socket).await;
            let ready = message["kind"] == "ready";
            heard.push(message);
            if ready {
                return (socket, heard);
            }
        }
    }

    /// 林教練（擁有者）建一支有 Lib 的流程（照 fixtures/sample-steps.json 的第 2–7 步），分享給這些人。建好是第 6 步。
    async fn sample(&self, owner: &User, shares: &[(&User, &str)]) -> String {
        let id = self.create(owner, "全國賽").await;
        let steps: Vec<Value> = serde_json::from_str(SAMPLE_STEPS).unwrap();
        let (mut room, _) = self.join(owner, &id, "setup", 0).await;
        for (n, s) in steps[1..7].iter().enumerate() {
            let id = s["stepId"].as_str().unwrap();
            accepted(&step(&mut room, id, n as i64, s["commands"].clone()).await);
        }
        for (who, role) in shares {
            self.share(owner, &id, who.email, role).await;
        }
        id
    }

    async fn get_flow(&self, who: &User, id: &str) -> (StatusCode, Value) {
        self.send("GET", &format!("/api/flows/{id}"), None, &who.cookie)
            .await
    }

    /// 資料庫裡每一張表、每一列，有幾列寫著這段字。
    async fn rows_mentioning(&self, text: &str) -> Vec<String> {
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_sqlx_migrations'",
        )
        .fetch_all(&self.state.db)
        .await
        .unwrap();
        let mut found = Vec::new();
        for table in tables {
            // 表名是上面從 pg_tables 拿的，不是外面來的字。
            let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT count(*) FROM \"{table}\" t WHERE row_to_json(t)::text ILIKE '%' || $1 || '%'"
            )))
            .bind(text)
            .fetch_one(&self.state.db)
            .await
            .unwrap();
            if n > 0 {
                found.push(table);
            }
        }
        found
    }
}

/// 範例流程：從沒有流程開始，一步一步建出來（跟 tests/flow_core.rs 用的同一份）。
const SAMPLE_STEPS: &str = include_str!("fixtures/sample-steps.json");
/// 範例流程裡的 Lib、它的上法環節、第 1 組。
const LIB: &str = "x2l8axo41g3ph";
const LOAD: &str = "pq4lkns0v20ec";
const SQUAD_1: &str = "g7sil583dmpgv";

async fn say(socket: &mut Socket, message: Value) {
    socket
        .send(Message::Text(message.to_string().into()))
        .await
        .unwrap();
}

/// 伺服器說的下一句（誰開著跳過）；房間關了是 Null。
async fn hear_any(socket: &mut Socket) -> Value {
    let next = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let message: Value = serde_json::from_str(&text).unwrap();
                    if message["kind"] != "present" {
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

/// 伺服器說的下一句，別的連線的改動也跳過。
async fn hear(socket: &mut Socket) -> Value {
    loop {
        let message = hear_any(socket).await;
        if message["kind"] != "changed" {
            return message;
        }
    }
}

async fn step(socket: &mut Socket, step_id: &str, seen: i64, commands: Value) -> Value {
    let message = json!({ "kind": "step", "stepId": step_id, "seen": seen, "commands": commands });
    say(socket, message).await;
    hear(socket).await
}

fn rename(name: &str) -> Value {
    json!([{ "name": "renameFlow", "args": [name] }])
}

fn accepted(reply: &Value) {
    assert_eq!(reply["kind"], "accepted", "{reply}");
}

#[sqlx::test]
async fn only_a_disabled_user_can_be_deleted_and_not_by_anyone_but_the_admin(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user(WANG, WANG_NAME).await;
    let admin = s.user("admin@example.com", "管理員").await;
    let wang_id = s.user_id(WANG).await;
    let admin_id = s.user_id(admin.email).await;

    // 沒停用的人：不能刪
    let (status, problem) = s.delete_user(&admin, wang_id).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(problem, json!({ "kind": "notAllowed" }));
    // 管理員刪不了自己
    let (status, problem) = s.delete_user(&admin, admin_id).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(problem, json!({ "kind": "notAllowed" }));
    // 沒有這個人
    assert_eq!(
        s.delete_user(&admin, 999_999).await.0,
        StatusCode::NOT_FOUND
    );

    s.disable(&admin, WANG).await;
    // 不是管理員：不能叫（他也被停用了，等於沒登入）
    assert_eq!(
        s.delete_user(&wang, wang_id).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert!(s.login(WANG, GOOD).await.is_none());
    assert_eq!(
        s.delete_user(&admin, wang_id).await.0,
        StatusCode::NO_CONTENT
    );
    // 刪過了再刪：沒有這個人
    assert_eq!(
        s.delete_user(&admin, wang_id).await.0,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test]
async fn a_non_admin_cannot_delete(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let _admin = s.user("admin@example.com", "管理員").await;
    let lin_id = s.user_id(lin.email).await;
    assert_eq!(s.delete_user(&lin, lin_id).await.0, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn deleting_removes_him_his_flows_and_his_permissions_but_keeps_his_records_and_steps_without_his_name(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let wang = s.user(WANG, WANG_NAME).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let admin = s.user("admin@example.com", "管理員").await;

    // 他擁有的流程，分享給林教練
    let his = s.create(&wang, "王的流程").await;
    s.share(&wang, &his, lin.email, "editor").await;
    // 林教練的流程，他是編輯者：他改了名字、記了一次
    let lins = s.sample(&lin, &[(&wang, "editor")]).await;
    let (mut room, _) = s.join(&wang, &lins, "wang-tab", 6).await;
    accepted(&step(&mut room, "wang-rename", 6, rename("王改的名字")).await);
    let attempt = json!({ "actionId": LIB, "attempt": {
        "id": "twang12345678", "date": "2026-11-04", "who": SQUAD_1, "practice": "drill", "whole": true,
        "marks": { LOAD: "✓" }
    } });
    say(
        &mut room,
        json!({ "kind": "record", "attempts": [attempt] }),
    )
    .await;
    assert_eq!(hear(&mut room).await["kind"], "recordsSaved");
    // 林教練刪掉一支分享給他的流程：他有一筆「被擁有者刪掉了」
    let gone = s.create(&lin, "刪掉的").await;
    s.share(&lin, &gone, WANG, "viewer").await;
    let path = format!("/api/flows/{gone}/delete");
    assert_eq!(
        s.send("POST", &path, None, &lin.cookie).await.0,
        StatusCode::NO_CONTENT
    );
    // 猜錯一次密碼（用 email 記的那張）
    assert!(s.login(WANG, "猜錯的密碼猜錯的密碼").await.is_none());
    // 林教練開著他的流程
    let (mut lin_room, _) = s.join(&lin, &his, "lin-tab", 0).await;

    s.disable(&admin, WANG).await;
    let wang_id = s.user_id(WANG).await;
    let before = s.state.mailer.sent().len();
    assert_eq!(
        s.delete_user(&admin, wang_id).await.0,
        StatusCode::NO_CONTENT
    );

    // 他收到「刪好了」
    let sent = s.state.mailer.sent();
    assert_eq!(sent.len(), before + 1);
    let mail = &sent[before];
    assert_eq!(mail.to, WANG);
    assert!(mail.subject.contains("刪好了"), "{}", mail.subject);
    // 資料庫裡找不到他的 email、名字（連猜錯密碼的紀錄也清了）；登不進來
    assert_eq!(s.rows_mentioning(WANG).await, Vec::<String>::new());
    assert_eq!(s.rows_mentioning(WANG_NAME).await, Vec::<String>::new());
    assert!(s.login(WANG, GOOD).await.is_none());

    // 他擁有的流程不見了：林教練看到「被擁有者刪掉了」，開著的房間也被告知
    assert_eq!(s.get_flow(&lin, &his).await.0, StatusCode::GONE);
    assert_eq!(hear(&mut lin_room).await["kind"], "deleted");
    let (_, mine) = s.send("GET", "/api/flows", None, &lin.cookie).await;
    assert!(!mine.to_string().contains("王的流程"), "{mine}");

    // 林教練的流程：他記的那次還在，不寫名字；他改的名字還在；名單上沒有他
    let (status, flow) = s.get_flow(&lin, &lins).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(flow["flow"]["name"], "王改的名字");
    assert_eq!(
        flow["records"],
        json!([{ "actionId": LIB, "attempt": attempt["attempt"], "by": null, "mine": false }])
    );
    let (_, people) = s
        .send(
            "GET",
            &format!("/api/flows/{lins}/people"),
            None,
            &lin.cookie,
        )
        .await;
    assert_eq!(people.as_array().unwrap().len(), 1, "{people}");
}

#[sqlx::test]
async fn his_steps_still_count_for_undo_and_catching_up(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user(WANG, WANG_NAME).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let admin = s.user("admin@example.com", "管理員").await;
    let id = s.sample(&lin, &[(&wang, "editor")]).await;
    let (mut a, _) = s.join(&lin, &id, "tab-a", 6).await;
    let (mut b, _) = s.join(&wang, &id, "tab-b", 6).await;
    accepted(&step(&mut a, "rename-1", 6, rename("全國賽決賽")).await);
    accepted(&step(&mut b, "rename-2", 7, rename("區賽")).await);
    drop(b);

    s.disable(&admin, WANG).await;
    let wang_id = s.user_id(WANG).await;
    assert_eq!(
        s.delete_user(&admin, wang_id).await.0,
        StatusCode::NO_CONTENT
    );

    // 上次看到第 6 步的分頁重連：一步一步補上（他那步不寫名字），不是整份換掉
    let (_, heard) = s.join(&lin, &id, "tab-c", 6).await;
    let kinds: Vec<&str> = heard.iter().map(|m| m["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["changed", "changed", "ready"], "{heard:?}");
    assert_eq!(heard[0]["by"], "林教練");
    assert_eq!(heard[1]["step"], 8);
    assert_eq!(heard[1]["by"], "");

    // 他後來改過名字：林教練復原自己那步照樣退回，不寫是誰
    let message = json!({ "kind": "undo", "stepId": "undo-1", "seen": 8, "of": "rename-1", "redo": false,
        "change": { "things": [{ "key": "name", "after": "全國賽" }], "orders": {} } });
    say(&mut a, message).await;
    let reply = hear(&mut a).await;
    assert_eq!(reply["kind"], "rejected", "{reply}");
    assert_eq!(
        reply["why"],
        json!({ "code": "undoChangedLater", "by": "", "redo": false })
    );
    assert_eq!(reply["message"], "別人後來改過，這步不能復原");
}

#[sqlx::test]
async fn the_same_email_invited_again_is_a_new_user(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user(WANG, WANG_NAME).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let admin = s.user("admin@example.com", "管理員").await;
    s.create(&wang, "王的流程").await;
    let lins = s.create(&lin, "林的流程").await;
    s.share(&lin, &lins, WANG, "editor").await;
    s.disable(&admin, WANG).await;
    let old_id = s.user_id(WANG).await;
    assert_eq!(
        s.delete_user(&admin, old_id).await.0,
        StatusCode::NO_CONTENT
    );

    let body = json!({ "email": WANG, "name": "新的王" });
    assert_eq!(
        s.send("POST", "/api/admin/users", Some(body), &admin.cookie)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let new_id = s.user_id(WANG).await;
    assert_ne!(new_id, old_id);
    // 設好密碼登入：沒有流程、沒有分享給他的
    let mail = s.state.mailer.sent().last().cloned().unwrap();
    let link = format!("{SITE}/set-password#");
    let at = mail.text.find(&link).unwrap() + link.len();
    let token = mail.text[at..].split_whitespace().next().unwrap();
    s.send(
        "POST",
        "/api/set-password",
        Some(json!({ "token": token, "password": GOOD })),
        "",
    )
    .await;
    let cookie = s.login(WANG, GOOD).await.unwrap();
    let (_, flows) = s.send("GET", "/api/flows", None, &cookie).await;
    assert!(!flows.to_string().contains("王的流程"), "{flows}");
    assert!(!flows.to_string().contains("林的流程"), "{flows}");
    let again = User {
        cookie,
        email: WANG,
    };
    assert_eq!(s.get_flow(&again, &lins).await.0, StatusCode::NOT_FOUND);
}
