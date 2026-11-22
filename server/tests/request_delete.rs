// 要求刪除帳號（#370）：使用者自己在帳號頁按。帳號馬上停用（每台裝置登出、不能登入），流程別人照常用；
// 寄他「收到了」、寄管理員「某某要求刪除帳號」；管理使用者頁寫要求的日期，不給移交；管理員按「恢復」救得回來。
// 管理員自己不能要求。要有 PostgreSQL：見 tests/db.rs 開頭。

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use chrono::{DateTime, TimeZone, Utc};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use cheer_server::accounts::create_admin;
use cheer_server::breach::BreachCheck;
use cheer_server::clock::Clock;
use cheer_server::flow_core::FlowCore;
use cheer_server::mail::Mailer;
use cheer_server::{AppState, app};

const SITE: &str = "https://cheer.example";
const GOOD: &str = "我們這一隊今年一定會贏 go go";
const WANG: &str = "wang@example.com";
const ADMIN: &str = "admin@example.com";

struct Server {
    state: AppState,
    site: tempfile::TempDir,
}

struct User {
    cookie: String,
    email: &'static str,
}

impl Server {
    async fn new(db: sqlx::PgPool) -> Self {
        Self::with_mailer(db, Mailer::memory())
    }

    fn with_mailer(db: sqlx::PgPool, mailer: Mailer) -> Self {
        let now = Arc::new(Mutex::new(
            Utc.with_ymd_and_hms(2026, 11, 7, 9, 0, 0).unwrap(),
        ));
        let state = AppState {
            db,
            mailer,
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
        Self { state, site }
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
    async fn login(&self, email: &str) -> Option<String> {
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
        let cookie = self.login(email).await.unwrap();
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

    async fn share(&self, owner: &User, id: &str, email: &str) {
        let body = json!({ "email": email, "role": "editor" });
        let path = format!("/api/flows/{id}/people");
        let (status, _) = self.send("POST", &path, Some(body), &owner.cookie).await;
        assert_eq!(status, StatusCode::OK);
    }

    async fn user_id(&self, email: &str) -> i64 {
        sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
            .bind(email)
            .fetch_one(&self.state.db)
            .await
            .unwrap()
    }

    /// 管理使用者頁上這個人那一列的狀態。
    async fn status_of(&self, admin: &User, email: &str) -> Value {
        let (_, rows) = self
            .send("GET", "/api/admin/users", None, &admin.cookie)
            .await;
        rows.as_array()
            .unwrap()
            .iter()
            .find(|r| r["email"] == email)
            .unwrap()["status"]
            .clone()
    }
}

#[sqlx::test]
async fn the_confirm_box_counts_his_flows_and_the_shared_ones(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user(WANG, "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let _admin = s.user(ADMIN, "管理員").await;
    let shared = s.create(&wang, "全國賽").await;
    s.create(&wang, "區賽").await;
    s.share(&wang, &shared, lin.email).await;
    // 林的流程分享給王：不算王的
    let lins = s.create(&lin, "林的").await;
    s.share(&lin, &lins, wang.email).await;

    let (status, summary) = s
        .send("GET", "/api/account/delete", None, &wang.cookie)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(summary, json!({ "flows": 2, "shared": 1 }));

    let (status, _) = s.send("GET", "/api/account/delete", None, "").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn requesting_disables_him_everywhere_mails_him_and_the_admin_and_his_flows_stay(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let wang = s.user(WANG, "王教練").await;
    let other_device = s.login(WANG).await.unwrap();
    let lin = s.user("lin@example.com", "林教練").await;
    let admin = s.user(ADMIN, "管理員").await;
    let flow = s.create(&wang, "全國賽").await;
    s.share(&wang, &flow, lin.email).await;
    let before = s.state.mailer.sent().len();

    let (status, _) = s
        .send("POST", "/api/account/delete", None, &wang.cookie)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // 每台裝置登出、同一組帳密登不進來
    for cookie in [&wang.cookie, &other_device] {
        let (status, body) = s.send("GET", "/api/me", None, cookie).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "expired": false }));
    }
    assert_eq!(s.login(WANG).await, None);

    // 他的流程別人照常用
    let path = format!("/api/flows/{flow}");
    assert_eq!(
        s.send("GET", &path, None, &lin.cookie).await.0,
        StatusCode::OK
    );

    // 兩封信：他「收到了」、管理員「某某要求刪除帳號」
    let mails = s.state.mailer.sent()[before..].to_vec();
    assert_eq!(mails.len(), 2);
    assert_eq!(mails[0].to, WANG);
    assert!(mails[0].text.contains("30 天內"), "{}", mails[0].text);
    assert!(mails[0].text.contains("回這封信"), "{}", mails[0].text);
    assert_eq!(mails[1].to, ADMIN);
    assert!(mails[1].subject.contains("王教練"), "{}", mails[1].subject);
    assert!(mails[1].text.contains(WANG), "{}", mails[1].text);

    // 管理使用者頁：已停用、要求刪除的日期
    assert_eq!(
        s.status_of(&admin, WANG).await,
        json!({ "kind": "disabled", "flows": 1, "deleteRequested": "2026-11-07T09:00:00.000Z" })
    );
}

#[sqlx::test]
async fn the_admin_cannot_hand_over_his_flows_but_can_enable_or_delete_him(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user(WANG, "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let admin = s.user(ADMIN, "管理員").await;
    s.create(&wang, "全國賽").await;
    s.send("POST", "/api/account/delete", None, &wang.cookie)
        .await;
    let id = s.user_id(WANG).await;

    // 他自己要求刪的：不給移交
    let path = format!("/api/admin/users/{id}/transfer");
    let (status, problem) = s
        .send(
            "POST",
            &path,
            Some(json!({ "email": lin.email })),
            &admin.cookie,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(problem, json!({ "kind": "notAllowed" }));

    // 恢復：登得進來，不再寫要求刪除
    let path = format!("/api/admin/users/{id}/enable");
    assert_eq!(
        s.send("POST", &path, None, &admin.cookie).await.0,
        StatusCode::NO_CONTENT
    );
    assert!(s.login(WANG).await.is_some());
    assert_eq!(s.status_of(&admin, WANG).await, json!({ "kind": "active" }));

    // 再要求一次：管理員照 #369 刪得掉
    let wang = User {
        cookie: s.login(WANG).await.unwrap(),
        email: WANG,
    };
    s.send("POST", "/api/account/delete", None, &wang.cookie)
        .await;
    let path = format!("/api/admin/users/{id}/delete");
    assert_eq!(
        s.send("POST", &path, None, &admin.cookie).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(s.login(wang.email).await, None);
}

#[sqlx::test]
async fn the_admin_cannot_request_and_signed_out_gets_401(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let admin = s.user(ADMIN, "管理員").await;
    let before = s.state.mailer.sent().len();

    let (status, _) = s
        .send("POST", "/api/account/delete", None, &admin.cookie)
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(s.login(ADMIN).await.is_some());
    assert_eq!(s.state.mailer.sent().len(), before);

    let (status, _) = s.send("POST", "/api/account/delete", None, "").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// 一台假的 Resend：寄信一律回 429（今天的額度用完了）。
async fn resend_over_quota() -> reqwest::Url {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let fake = axum::Router::new().route(
        "/emails",
        axum::routing::post(|| async {
            (
                StatusCode::TOO_MANY_REQUESTS,
                axum::Json(json!({
                    "statusCode": 429,
                    "name": "daily_quota_exceeded",
                    "message": "You have reached your daily email sending quota."
                })),
            )
        }),
    );
    tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
    format!("http://{addr}").parse().unwrap()
}

#[sqlx::test]
async fn when_the_mail_cannot_go_out_nothing_changes(db: sqlx::PgPool) {
    // 先用記在記憶體的寄信建好人，再換成回 429 的 Resend
    let s = Server::new(db.clone()).await;
    let wang = s.user(WANG, "王教練").await;
    s.user(ADMIN, "管理員").await;
    let mailer = Mailer::resend_at(
        "re_test",
        "test <t@example.com>".into(),
        resend_over_quota().await,
    );
    let q = Server::with_mailer(db, mailer);

    let (status, _) = q
        .send("POST", "/api/account/delete", None, &wang.cookie)
        .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    let (status, _) = q.send("GET", "/api/me", None, &wang.cookie).await;
    assert_eq!(status, StatusCode::OK, "還登入著");
    assert!(q.login(WANG).await.is_some(), "沒停用");
}
