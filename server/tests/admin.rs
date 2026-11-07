// 管理使用者（#245）：從外面打 API（tower 的 oneshot），寄信用記在記憶體的、時間用手撥的鐘。
// 寄信服務回 429 用一台假的 Resend（本機開一個只回 429 的 HTTP 伺服器）。
// 要有 PostgreSQL：見 tests/db.rs 開頭。

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use chrono::{DateTime, Duration, TimeZone, Utc};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use cheer_server::accounts::create_admin;
use cheer_server::breach::BreachCheck;
use cheer_server::clock::Clock;
use cheer_server::mail::{Mail, Mailer};
use cheer_server::{AppState, app};

const SITE: &str = "https://cheer.example";
const GOOD: &str = "我們這一隊今年一定會贏 go go";
const OTHER: &str = "另一個也很長的好密碼喔喔喔喔喔";

struct Server {
    state: AppState,
    now: Arc<Mutex<DateTime<Utc>>>,
    site: tempfile::TempDir,
}

impl Server {
    fn new(db: sqlx::PgPool) -> Self {
        Self::with_mailer(db, Mailer::memory())
    }

    fn with_mailer(db: sqlx::PgPool, mailer: Mailer) -> Self {
        let now = Arc::new(Mutex::new(
            Utc.with_ymd_and_hms(2026, 11, 7, 9, 0, 0).unwrap(),
        ));
        let clock_now = now.clone();
        let state = AppState {
            db,
            mailer,
            breach: BreachCheck::list(["correct horse battery staple"]),
            clock: Clock::new(move || *clock_now.lock().unwrap()),
            site_url: SITE.into(),
            core: cheer_server::flow_core::FlowCore::start().unwrap(),
            mail_limit: Default::default(),
        };
        let site = tempfile::tempdir().unwrap();
        std::fs::write(site.path().join("200.html"), "spa entry").unwrap();
        Self { state, now, site }
    }

    fn pass(&self, d: Duration) {
        *self.now.lock().unwrap() += d;
    }

    /// 送一個請求（從網頁本身送的，帶 Sec-Fetch-Site: same-origin）。回狀態、JSON（沒有內容是 Null）、Set-Cookie。
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

    async fn post(&self, path: &str, body: Value, cookie: &str) -> (StatusCode, Value) {
        let (status, json, _) = self.send("POST", path, Some(body), Some(cookie)).await;
        (status, json)
    }

    async fn users(&self, cookie: &str) -> Value {
        let (status, json, _) = self
            .send("GET", "/api/admin/users", None, Some(cookie))
            .await;
        assert_eq!(status, StatusCode::OK);
        json
    }

    /// 名單上這個 email 的那一列。
    async fn row(&self, cookie: &str, email: &str) -> Value {
        self.users(cookie)
            .await
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["email"] == email)
            .cloned()
            .unwrap_or_else(|| panic!("名單上沒有 {email}"))
    }

    fn mails(&self) -> Vec<Mail> {
        self.state.mailer.sent()
    }

    /// 最後一封寄給 to 的信裡的設密碼連結的 token。
    fn link_token_to(&self, to: &str) -> String {
        let mail = self
            .mails()
            .into_iter()
            .rev()
            .find(|m| m.to == to)
            .unwrap_or_else(|| panic!("沒有寄信給 {to}"));
        let link = format!("{SITE}/set-password#");
        let at = mail.text.find(&link).expect("信裡沒有設密碼連結") + link.len();
        mail.text[at..]
            .split_whitespace()
            .next()
            .unwrap()
            .to_owned()
    }

    async fn link_works(&self, token: &str) -> bool {
        let (status, _, _) = self
            .send(
                "POST",
                "/api/password-link",
                Some(json!({ "token": token })),
                None,
            )
            .await;
        status == StatusCode::OK
    }

    async fn set_password(&self, token: &str, password: &str) -> StatusCode {
        self.send(
            "POST",
            "/api/set-password",
            Some(json!({ "token": token, "password": password })),
            None,
        )
        .await
        .0
    }

    /// 登入：回狀態和 JSON（失敗時拿來比是不是一樣）、cookie。
    async fn login(&self, email: &str, password: &str) -> (StatusCode, Value, Option<String>) {
        let (status, json, set_cookie) = self
            .send(
                "POST",
                "/api/login",
                Some(json!({ "email": email, "password": password })),
                None,
            )
            .await;
        (
            status,
            json,
            set_cookie.map(|c| c.split(';').next().unwrap().to_owned()),
        )
    }

    async fn signed_in(&self, cookie: &str) -> bool {
        self.send("GET", "/api/me", None, Some(cookie)).await.0 == StatusCode::OK
    }

    /// 管理員林教練：設好密碼、登入。回他的 cookie。
    async fn admin(&self) -> String {
        create_admin(&self.state, "lin@example.com", Some("林教練"))
            .await
            .unwrap();
        let token = self.link_token_to("lin@example.com");
        assert_eq!(
            self.set_password(&token, GOOD).await,
            StatusCode::NO_CONTENT
        );
        self.login("lin@example.com", GOOD).await.2.unwrap()
    }

    /// 管理員加一個使用者：回他在名單上的 id。
    async fn add(&self, admin: &str, email: &str, name: &str) -> i64 {
        let (status, json) = self
            .post(
                "/api/admin/users",
                json!({ "email": email, "name": name }),
                admin,
            )
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{json}");
        self.row(admin, email).await["id"].as_i64().unwrap()
    }

    /// 管理員加一個使用者，他從邀請信設好密碼、登入。回 id 和他的 cookie。
    async fn add_with_password(&self, admin: &str, email: &str, name: &str) -> (i64, String) {
        let id = self.add(admin, email, name).await;
        let token = self.link_token_to(email);
        assert_eq!(
            self.set_password(&token, GOOD).await,
            StatusCode::NO_CONTENT
        );
        (id, self.login(email, GOOD).await.2.unwrap())
    }
}

#[sqlx::test]
async fn only_the_admin_can_use_the_admin_api(db: sqlx::PgPool) {
    let s = Server::new(db);
    let admin = s.admin().await;
    let (wang_id, wang) = s
        .add_with_password(&admin, "wang@example.com", "王教練")
        .await;
    let sent = s.mails().len();

    let calls: Vec<(&str, String, Option<Value>)> = vec![
        ("GET", "/api/admin/users".into(), None),
        (
            "POST",
            "/api/admin/users".into(),
            Some(json!({ "email": "new@example.com", "name": "新人" })),
        ),
        (
            "POST",
            format!("/api/admin/users/{wang_id}/resend-invite"),
            Some(json!({})),
        ),
        (
            "POST",
            format!("/api/admin/users/{wang_id}/send-reset"),
            Some(json!({})),
        ),
        (
            "POST",
            format!("/api/admin/users/{wang_id}/email"),
            Some(json!({ "email": "w2@example.com" })),
        ),
        (
            "POST",
            format!("/api/admin/users/{wang_id}/disable"),
            Some(json!({})),
        ),
        (
            "POST",
            format!("/api/admin/users/{wang_id}/enable"),
            Some(json!({})),
        ),
    ];
    for (method, path, body) in calls {
        let (status, _, _) = s.send(method, &path, body.clone(), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "沒登入：{method} {path}");
        let (status, _, _) = s.send(method, &path, body, Some(&wang)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "不是管理員：{method} {path}");
    }
    assert_eq!(s.mails().len(), sent, "被擋的沒有寄信");
    assert!(s.signed_in(&wang).await, "被擋的停用沒有生效");
    assert_eq!(s.users(&admin).await.as_array().unwrap().len(), 2);
}

#[sqlx::test]
async fn list_shows_each_status(db: sqlx::PgPool) {
    let s = Server::new(db);
    let admin = s.admin().await;
    s.add_with_password(&admin, "wang@example.com", "王教練")
        .await;
    s.add(&admin, "mei@example.com", "陳小美").await;
    s.pass(Duration::hours(3) + Duration::minutes(30));
    s.add(&admin, "fang@example.com", "李小芳").await;
    let (huang, _) = s
        .add_with_password(&admin, "huang@example.com", "黃教練")
        .await;
    s.post(
        &format!("/api/admin/users/{huang}/disable"),
        json!({}),
        &admin,
    )
    .await;

    let lin = s.row(&admin, "lin@example.com").await;
    assert_eq!(lin["name"], "林教練");
    assert_eq!(lin["status"], json!({ "kind": "active" }));
    assert_eq!(lin["me"], json!(true));
    assert_eq!(s.row(&admin, "wang@example.com").await["me"], json!(false));
    // 邀請 24 小時：過了 3.5 小時還有 20.5 小時，算 21
    assert_eq!(
        s.row(&admin, "mei@example.com").await["status"],
        json!({ "kind": "invited", "hoursLeft": 21 })
    );
    assert_eq!(
        s.row(&admin, "fang@example.com").await["status"],
        json!({ "kind": "invited", "hoursLeft": 24 })
    );
    assert_eq!(
        s.row(&admin, "huang@example.com").await["status"],
        json!({ "kind": "disabled" })
    );

    s.pass(Duration::hours(21));
    assert_eq!(
        s.row(&admin, "mei@example.com").await["status"],
        json!({ "kind": "inviteExpired" })
    );
}

#[sqlx::test]
async fn adding_a_user_mails_an_invite_and_the_same_email_in_other_case_is_refused(
    db: sqlx::PgPool,
) {
    let s = Server::new(db);
    let admin = s.admin().await;
    s.add(&admin, "Wang@Example.com", "王教練").await;
    let invite = s.mails().last().cloned().unwrap();
    assert_eq!(invite.to, "Wang@Example.com");
    assert!(invite.text.contains("王教練"));
    assert!(s.link_works(&s.link_token_to("Wang@Example.com")).await);

    for email in ["wang@example.com", "  WANG@EXAMPLE.COM ", "LIN@example.com"] {
        let sent = s.mails().len();
        let (status, json) = s
            .post(
                "/api/admin/users",
                json!({ "email": email, "name": "另一個" }),
                &admin,
            )
            .await;
        assert_eq!(status, StatusCode::CONFLICT, "{email}");
        assert_eq!(json, json!({ "kind": "emailTaken" }));
        assert_eq!(s.mails().len(), sent, "沒有寄信");
    }
    assert_eq!(s.users(&admin).await.as_array().unwrap().len(), 2);
}

#[sqlx::test]
async fn resending_an_invite_voids_the_old_link(db: sqlx::PgPool) {
    let s = Server::new(db);
    let admin = s.admin().await;
    let id = s.add(&admin, "mei@example.com", "陳小美").await;
    let old = s.link_token_to("mei@example.com");
    s.pass(Duration::hours(30));

    let (status, _) = s
        .post(
            &format!("/api/admin/users/{id}/resend-invite"),
            json!({}),
            &admin,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let new = s.link_token_to("mei@example.com");
    assert_ne!(old, new);
    assert!(!s.link_works(&old).await);
    assert_eq!(s.set_password(&old, GOOD).await, StatusCode::GONE);
    assert_eq!(
        s.row(&admin, "mei@example.com").await["status"],
        json!({ "kind": "invited", "hoursLeft": 24 })
    );
    assert_eq!(s.set_password(&new, GOOD).await, StatusCode::NO_CONTENT);
    assert_eq!(
        s.login("mei@example.com", GOOD).await.0,
        StatusCode::NO_CONTENT
    );

    // 設好密碼的人不再重寄邀請
    let (status, json) = s
        .post(
            &format!("/api/admin/users/{id}/resend-invite"),
            json!({}),
            &admin,
        )
        .await;
    assert_eq!(
        (status, json),
        (StatusCode::CONFLICT, json!({ "kind": "notAllowed" }))
    );
}

#[sqlx::test]
async fn disabling_ends_sessions_and_links_and_login_looks_like_a_wrong_password(db: sqlx::PgPool) {
    let s = Server::new(db);
    let admin = s.admin().await;
    let (wang, phone) = s
        .add_with_password(&admin, "wang@example.com", "王教練")
        .await;
    let laptop = s.login("wang@example.com", GOOD).await.2.unwrap();
    let mei = s.add(&admin, "mei@example.com", "陳小美").await;
    let invite = s.link_token_to("mei@example.com");
    s.post(
        &format!("/api/admin/users/{wang}/send-reset"),
        json!({}),
        &admin,
    )
    .await;
    let reset = s.link_token_to("wang@example.com");

    for id in [wang, mei] {
        let (status, _) = s
            .post(&format!("/api/admin/users/{id}/disable"), json!({}), &admin)
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    assert!(!s.signed_in(&phone).await);
    assert!(!s.signed_in(&laptop).await);
    assert!(!s.link_works(&reset).await);
    assert!(!s.link_works(&invite).await);
    assert_eq!(s.set_password(&reset, OTHER).await, StatusCode::GONE);

    // 跟打錯密碼一樣：狀態、內容、沒有 cookie
    let disabled = s.login("wang@example.com", GOOD).await;
    let wrong = s
        .login("lin@example.com", "這不是我的密碼這不是我的密碼")
        .await;
    assert_eq!(disabled.0, StatusCode::UNAUTHORIZED);
    assert_eq!(disabled, wrong);

    // 恢復：原本的密碼就能登入
    let (status, _) = s
        .post(
            &format!("/api/admin/users/{wang}/enable"),
            json!({}),
            &admin,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        s.row(&admin, "wang@example.com").await["status"],
        json!({ "kind": "active" })
    );
    let (status, _, cookie) = s.login("wang@example.com", GOOD).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(s.signed_in(&cookie.unwrap()).await);
    // 停用前的登入狀態不會回來
    assert!(!s.signed_in(&phone).await);
}

#[sqlx::test]
async fn admin_cannot_disable_themselves(db: sqlx::PgPool) {
    let s = Server::new(db);
    let admin = s.admin().await;
    let id = s.row(&admin, "lin@example.com").await["id"]
        .as_i64()
        .unwrap();
    let (status, json) = s
        .post(&format!("/api/admin/users/{id}/disable"), json!({}), &admin)
        .await;
    assert_eq!(
        (status, json),
        (StatusCode::CONFLICT, json!({ "kind": "notAllowed" }))
    );
    assert!(s.signed_in(&admin).await);
}

#[sqlx::test]
async fn changing_email_notifies_old_and_new_and_refuses_someone_elses(db: sqlx::PgPool) {
    let s = Server::new(db);
    let admin = s.admin().await;
    let (wang, _) = s
        .add_with_password(&admin, "wang@example.com", "王教練")
        .await;
    s.add(&admin, "mei@example.com", "陳小美").await;

    let sent = s.mails().len();
    let (status, json) = s
        .post(
            &format!("/api/admin/users/{wang}/email"),
            json!({ "email": "MEI@example.com" }),
            &admin,
        )
        .await;
    assert_eq!(
        (status, json),
        (StatusCode::CONFLICT, json!({ "kind": "emailTaken" }))
    );
    assert_eq!(s.mails().len(), sent);

    let (status, _) = s
        .post(
            &format!("/api/admin/users/{wang}/email"),
            json!({ "email": "wang2@example.com" }),
            &admin,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let mails = s.mails()[sent..].to_vec();
    let mut to: Vec<&str> = mails.iter().map(|m| m.to.as_str()).collect();
    to.sort();
    assert_eq!(to, ["wang2@example.com", "wang@example.com"]);
    for m in &mails {
        assert!(
            m.text.contains("wang@example.com") && m.text.contains("wang2@example.com"),
            "{}",
            m.text
        );
    }

    assert_eq!(
        s.login("wang2@example.com", GOOD).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        s.login("wang@example.com", GOOD).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn reset_link_lasts_one_hour_and_using_it_logs_out_elsewhere_and_mails_a_notice(
    db: sqlx::PgPool,
) {
    let s = Server::new(db);
    let admin = s.admin().await;
    let (wang, phone) = s
        .add_with_password(&admin, "wang@example.com", "王教練")
        .await;

    // 1 小時後不能用
    s.post(
        &format!("/api/admin/users/{wang}/send-reset"),
        json!({}),
        &admin,
    )
    .await;
    let late = s.link_token_to("wang@example.com");
    s.pass(Duration::hours(1));
    assert!(!s.link_works(&late).await);
    assert_eq!(s.set_password(&late, OTHER).await, StatusCode::GONE);

    let (status, _) = s
        .post(
            &format!("/api/admin/users/{wang}/send-reset"),
            json!({}),
            &admin,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let token = s.link_token_to("wang@example.com");
    s.pass(Duration::minutes(59));
    let (_, link, _) = s
        .send(
            "POST",
            "/api/password-link",
            Some(json!({ "token": token })),
            None,
        )
        .await;
    assert_eq!(link["purpose"], json!("reset"));
    assert_eq!(s.set_password(&token, OTHER).await, StatusCode::NO_CONTENT);

    assert!(!s.signed_in(&phone).await);
    let notice = s.mails().last().cloned().unwrap();
    assert_eq!(notice.to, "wang@example.com");
    assert!(notice.subject.contains("密碼改了"), "{}", notice.subject);
    assert!(!notice.text.contains("/set-password#"));
    assert_eq!(
        s.login("wang@example.com", GOOD).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        s.login("wang@example.com", OTHER).await.0,
        StatusCode::NO_CONTENT
    );
    assert!(!s.link_works(&token).await, "用過就不能再用");
}

#[sqlx::test]
async fn reset_mail_only_for_people_who_can_log_in(db: sqlx::PgPool) {
    let s = Server::new(db);
    let admin = s.admin().await;
    let mei = s.add(&admin, "mei@example.com", "陳小美").await;
    let (status, json) = s
        .post(
            &format!("/api/admin/users/{mei}/send-reset"),
            json!({}),
            &admin,
        )
        .await;
    assert_eq!(
        (status, json),
        (StatusCode::CONFLICT, json!({ "kind": "notAllowed" }))
    );
    assert_eq!(
        s.post("/api/admin/users/999999/send-reset", json!({}), &admin)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
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
async fn mail_service_429_comes_back_as_cannot_send_today_and_changes_nothing(db: sqlx::PgPool) {
    // 先用記在記憶體的寄信建好管理員和兩個人，再換成回 429 的 Resend
    let s = Server::new(db.clone());
    let admin = s.admin().await;
    let (wang, _) = s
        .add_with_password(&admin, "wang@example.com", "王教練")
        .await;
    let mei = s.add(&admin, "mei@example.com", "陳小美").await;
    let invite = s.link_token_to("mei@example.com");

    let q = Server::with_mailer(
        db,
        Mailer::resend_at(
            "re_test",
            "test <t@example.com>".into(),
            resend_over_quota().await,
        ),
    );
    let quota = (
        StatusCode::SERVICE_UNAVAILABLE,
        json!({ "kind": "mailQuota" }),
    );

    let added = q
        .post(
            "/api/admin/users",
            json!({ "email": "fang@example.com", "name": "李小芳" }),
            &admin,
        )
        .await;
    assert_eq!(added, quota);
    assert!(
        q.users(&admin)
            .await
            .as_array()
            .unwrap()
            .iter()
            .all(|u| u["email"] != "fang@example.com"),
        "信寄不出去就沒加"
    );

    let resent = q
        .post(
            &format!("/api/admin/users/{mei}/resend-invite"),
            json!({}),
            &admin,
        )
        .await;
    assert_eq!(resent, quota);
    assert!(q.link_works(&invite).await, "信寄不出去，舊的邀請還能用");

    let reset = q
        .post(
            &format!("/api/admin/users/{wang}/send-reset"),
            json!({}),
            &admin,
        )
        .await;
    assert_eq!(reset, quota);

    let changed = q
        .post(
            &format!("/api/admin/users/{wang}/email"),
            json!({ "email": "w2@example.com" }),
            &admin,
        )
        .await;
    assert_eq!(changed, quota);
    assert_eq!(
        q.login("wang@example.com", GOOD).await.0,
        StatusCode::NO_CONTENT,
        "email 沒改"
    );
}
