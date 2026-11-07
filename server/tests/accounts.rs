// 帳號：第一個管理員、設密碼、登入、登出（#244）。
// 從外面打 API（tower 的 oneshot），寄信用記在記憶體的、外洩密碼用假的清單、時間用手撥的鐘。
// 要有 PostgreSQL：見 tests/db.rs 開頭。

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use chrono::{DateTime, Duration, TimeZone, Utc};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tower::ServiceExt;

use cheer_server::accounts::create_admin;
use cheer_server::breach::BreachCheck;
use cheer_server::clock::Clock;
use cheer_server::mail::Mailer;
use cheer_server::{AppState, app};

const SITE: &str = "https://cheer.example";
/// 假的外洩清單裡的密碼（夠長，只是外洩過）。
const LEAKED: &str = "correct horse battery staple";
const GOOD: &str = "我們這一隊今年一定會贏 go go";

/// 一台測試用的伺服器：記在記憶體的寄信、手撥的鐘。
struct Server {
    state: AppState,
    now: Arc<Mutex<DateTime<Utc>>>,
    site: tempfile::TempDir,
}

impl Server {
    fn new(db: sqlx::PgPool) -> Self {
        let now = Arc::new(Mutex::new(
            Utc.with_ymd_and_hms(2026, 11, 7, 9, 0, 0).unwrap(),
        ));
        let clock_now = now.clone();
        let state = AppState {
            db,
            mailer: Mailer::memory(),
            breach: BreachCheck::list([LEAKED]),
            clock: Clock::new(move || *clock_now.lock().unwrap()),
            site_url: SITE.into(),
        };
        let site = tempfile::tempdir().unwrap();
        std::fs::write(site.path().join("200.html"), "spa entry").unwrap();
        Self { state, now, site }
    }

    fn pass(&self, d: Duration) {
        *self.now.lock().unwrap() += d;
    }

    /// 送一個請求；`headers` 是額外的標頭。回狀態、JSON（沒有內容是 Null）、Set-Cookie。
    async fn send(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        headers: &[(&str, &str)],
    ) -> (StatusCode, Value, Option<String>) {
        let mut req = Request::builder().method(method).uri(path);
        for (k, v) in headers {
            req = req.header(*k, *v);
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
        let cookie = res
            .headers()
            .get(header::SET_COOKIE)
            .map(|v| v.to_str().unwrap().to_owned());
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let json = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        };
        (status, json, cookie)
    }

    /// 從網頁本身送的（瀏覽器會帶 Sec-Fetch-Site: same-origin）。
    async fn post(
        &self,
        path: &str,
        body: Value,
        cookie: Option<&str>,
    ) -> (StatusCode, Value, Option<String>) {
        let mut headers = vec![("sec-fetch-site", "same-origin")];
        if let Some(c) = cookie {
            headers.push(("cookie", c));
        }
        self.send("POST", path, Some(body), &headers).await
    }

    async fn me(&self, cookie: &str) -> (StatusCode, Value) {
        let (status, json, _) = self
            .send("GET", "/api/me", None, &[("cookie", cookie)])
            .await;
        (status, json)
    }

    /// 最後一封信裡的設密碼連結的 token。
    fn last_link_token(&self) -> String {
        let mail = self.state.mailer.sent().last().cloned().expect("沒有寄信");
        let link = format!("{SITE}/set-password#");
        let at = mail.text.find(&link).expect("信裡沒有設密碼連結") + link.len();
        mail.text[at..]
            .split_whitespace()
            .next()
            .unwrap()
            .to_owned()
    }

    async fn login(&self, email: &str, password: &str) -> (StatusCode, Option<String>) {
        let (status, _, cookie) = self
            .post(
                "/api/login",
                json!({ "email": email, "password": password }),
                None,
            )
            .await;
        (status, cookie)
    }
}

/// Set-Cookie 換成下一個請求要帶的 Cookie（name=value）。
fn cookie_pair(set_cookie: &str) -> String {
    set_cookie.split(';').next().unwrap().trim().to_owned()
}

/// 第一個管理員：建好、從信裡拿 token、設好密碼。
async fn admin_with_password(s: &Server) {
    create_admin(&s.state, "Lin@Example.com", Some("林教練"))
        .await
        .unwrap();
    let token = s.last_link_token();
    let (status, _, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": GOOD }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn create_admin_mails_a_link_then_set_password_login_me_logout(db: sqlx::PgPool) {
    let s = Server::new(db);
    create_admin(&s.state, "lin@example.com", Some("林教練"))
        .await
        .unwrap();

    let mail = s.state.mailer.sent().last().cloned().unwrap();
    assert_eq!(mail.to, "lin@example.com");
    let token = s.last_link_token();

    // 打開連結：只看得到是誰，還沒用掉
    let (status, link, _) = s
        .post("/api/password-link", json!({ "token": token }), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        link,
        json!({ "email": "lin@example.com", "name": "林教練", "purpose": "invite" })
    );
    let (status, _, _) = s
        .post("/api/password-link", json!({ "token": token }), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, cookie) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": GOOD }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(cookie.is_none(), "設好密碼不自動登入");

    // email 不分大小寫
    let (status, set_cookie) = s.login("LIN@example.com", GOOD).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let set_cookie = set_cookie.unwrap();
    for part in ["__Host-", "Secure", "HttpOnly", "SameSite=Lax", "Path=/"] {
        assert!(
            set_cookie.contains(part),
            "cookie 少了 {part}：{set_cookie}"
        );
    }
    let cookie = cookie_pair(&set_cookie);

    let (status, me) = s.me(&cookie).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        me,
        json!({ "email": "lin@example.com", "name": "林教練", "isAdmin": true })
    );

    let (status, _, _) = s.post("/api/logout", json!({}), Some(&cookie)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(s.me(&cookie).await.0, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn wrong_password_or_unknown_email_cannot_log_in(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;

    assert_eq!(
        s.login("lin@example.com", "這不是我的密碼這不是我的密碼")
            .await,
        (StatusCode::UNAUTHORIZED, None)
    );
    assert_eq!(
        s.login("nobody@example.com", GOOD).await,
        (StatusCode::UNAUTHORIZED, None)
    );
}

#[sqlx::test]
async fn logging_in_again_gives_a_new_session_and_drops_the_old_one(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;
    let first = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());

    let (_, _, again) = s
        .post(
            "/api/login",
            json!({ "email": "lin@example.com", "password": GOOD }),
            Some(&first),
        )
        .await;
    let second = cookie_pair(&again.unwrap());

    assert_ne!(first, second);
    assert_eq!(s.me(&first).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(s.me(&second).await.0, StatusCode::OK);
}

#[sqlx::test]
async fn used_expired_and_tampered_links_do_not_work(db: sqlx::PgPool) {
    let s = Server::new(db);
    create_admin(&s.state, "lin@example.com", Some("林教練"))
        .await
        .unwrap();
    let token = s.last_link_token();

    // 亂改的
    let mut tampered = token.clone();
    let last = tampered.pop().unwrap();
    tampered.push(if last == 'A' { 'B' } else { 'A' });
    for t in [tampered.as_str(), "", "not-a-token"] {
        assert_eq!(
            s.post("/api/password-link", json!({ "token": t }), None)
                .await
                .0,
            StatusCode::GONE
        );
        let (status, _, _) = s
            .post(
                "/api/set-password",
                json!({ "token": t, "password": GOOD }),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::GONE);
    }

    // 用過的
    let (status, _, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": GOOD }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        s.post("/api/password-link", json!({ "token": token }), None)
            .await
            .0,
        StatusCode::GONE
    );
    let (status, _, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": "另一個也很長的好密碼喔喔喔喔" }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::GONE);
    assert_eq!(
        s.login("lin@example.com", GOOD).await.0,
        StatusCode::NO_CONTENT
    );
}

#[sqlx::test]
async fn invite_link_expires_after_24_hours(db: sqlx::PgPool) {
    let s = Server::new(db);
    create_admin(&s.state, "lin@example.com", Some("林教練"))
        .await
        .unwrap();
    let token = s.last_link_token();

    s.pass(Duration::hours(24) - Duration::seconds(1));
    assert_eq!(
        s.post("/api/password-link", json!({ "token": token }), None)
            .await
            .0,
        StatusCode::OK
    );
    s.pass(Duration::seconds(1));
    assert_eq!(
        s.post("/api/password-link", json!({ "token": token }), None)
            .await
            .0,
        StatusCode::GONE
    );
    let (status, _, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": GOOD }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::GONE);
}

#[sqlx::test]
async fn running_create_admin_again_voids_the_old_link(db: sqlx::PgPool) {
    let s = Server::new(db);
    create_admin(&s.state, "lin@example.com", Some("林教練"))
        .await
        .unwrap();
    let old = s.last_link_token();
    create_admin(&s.state, "lin@example.com", None)
        .await
        .unwrap();
    let new = s.last_link_token();

    assert_eq!(
        s.post("/api/password-link", json!({ "token": old }), None)
            .await
            .0,
        StatusCode::GONE
    );
    assert_eq!(
        s.post("/api/password-link", json!({ "token": new }), None)
            .await
            .0,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn create_admin_for_someone_else_moves_admin_and_mails_a_new_password_link(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;
    let lin = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());

    create_admin(&s.state, "wang@example.com", Some("王教練"))
        .await
        .unwrap();
    let token = s.last_link_token();
    s.post(
        "/api/set-password",
        json!({ "token": token, "password": GOOD }),
        None,
    )
    .await;
    let wang = cookie_pair(&s.login("wang@example.com", GOOD).await.1.unwrap());

    assert_eq!(s.me(&lin).await.1["isAdmin"], json!(false));
    assert_eq!(s.me(&wang).await.1["isAdmin"], json!(true));

    // 管理員有密碼還進不去：再跑一次，寄設新密碼的信
    create_admin(&s.state, "wang@example.com", None)
        .await
        .unwrap();
    let (status, link, _) = s
        .post(
            "/api/password-link",
            json!({ "token": s.last_link_token() }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(link["purpose"], json!("reset"));
}

#[sqlx::test]
async fn create_admin_for_a_new_email_needs_a_name(db: sqlx::PgPool) {
    let s = Server::new(db);
    assert!(
        create_admin(&s.state, "lin@example.com", None)
            .await
            .is_err()
    );
    assert!(s.state.mailer.sent().is_empty());
}

#[sqlx::test]
async fn database_keeps_only_hashes_of_link_and_session_tokens(db: sqlx::PgPool) {
    let s = Server::new(db.clone());
    create_admin(&s.state, "lin@example.com", Some("林教練"))
        .await
        .unwrap();
    let token = s.last_link_token();

    let stored: Vec<(Vec<u8>,)> = sqlx::query_as("SELECT token_hash FROM password_links")
        .fetch_all(&db)
        .await
        .unwrap();
    assert_eq!(stored, vec![(Sha256::digest(token.as_bytes()).to_vec(),)]);

    s.post(
        "/api/set-password",
        json!({ "token": token, "password": GOOD }),
        None,
    )
    .await;
    let cookie = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());
    let session = cookie.split_once('=').unwrap().1;
    let stored: Vec<(Vec<u8>,)> = sqlx::query_as("SELECT token_hash FROM sessions")
        .fetch_all(&db)
        .await
        .unwrap();
    assert_eq!(stored, vec![(Sha256::digest(session.as_bytes()).to_vec(),)]);

    let (hash,): (String,) = sqlx::query_as("SELECT password_hash FROM users")
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(
        hash.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"),
        "{hash}"
    );
}

#[sqlx::test]
async fn password_needs_15_characters_counting_chinese_and_spaces(db: sqlx::PgPool) {
    let s = Server::new(db);
    create_admin(&s.state, "lin@example.com", Some("林教練"))
        .await
        .unwrap();
    let token = s.last_link_token();

    // 14 個字（中文、空白、emoji 各算一個）
    let fourteen = "啦啦隊 加油 👨‍👩‍👧 abc 1";
    let (status, json, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": fourteen }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json, json!({ "kind": "tooShort", "missing": 1 }));

    let (status, json, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": "短" }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json, json!({ "kind": "tooShort", "missing": 14 }));

    // 被擋不會用掉連結；15 個字收
    let fifteen = "啦啦隊 加油 👨‍👩‍👧 abc 12";
    let (status, _, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": fifteen }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        s.login("lin@example.com", fifteen).await.0,
        StatusCode::NO_CONTENT
    );
}

#[sqlx::test]
async fn password_of_64_characters_is_accepted(db: sqlx::PgPool) {
    let s = Server::new(db);
    create_admin(&s.state, "lin@example.com", Some("林教練"))
        .await
        .unwrap();
    let long = "啦".repeat(64);
    let (status, _, _) = s
        .post(
            "/api/set-password",
            json!({ "token": s.last_link_token(), "password": long }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        s.login("lin@example.com", &long).await.0,
        StatusCode::NO_CONTENT
    );
}

#[sqlx::test]
async fn leaked_password_is_refused(db: sqlx::PgPool) {
    let s = Server::new(db);
    create_admin(&s.state, "lin@example.com", Some("林教練"))
        .await
        .unwrap();
    let token = s.last_link_token();

    let (status, json, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token, "password": LEAKED }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json, json!({ "kind": "breached" }));
    assert_eq!(
        s.post("/api/password-link", json!({ "token": token }), None)
            .await
            .0,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn session_stops_working_30_days_after_login_even_when_used(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;
    let cookie = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());

    // 一直在用也不延長
    for _ in 0..29 {
        s.pass(Duration::days(1));
        assert_eq!(s.me(&cookie).await.0, StatusCode::OK);
    }
    s.pass(Duration::days(1) - Duration::seconds(1));
    assert_eq!(s.me(&cookie).await.0, StatusCode::OK);
    s.pass(Duration::seconds(1));
    assert_eq!(s.me(&cookie).await.0, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn changes_from_other_sites_are_refused(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;
    let cookie = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());

    let refused: [&[(&str, &str)]; 4] = [
        &[("sec-fetch-site", "cross-site")],
        &[("sec-fetch-site", "same-site")],
        &[("origin", "https://evil.example")],
        &[],
    ];
    for headers in refused {
        let mut headers = headers.to_vec();
        headers.push(("cookie", &cookie));
        headers.push(("host", "cheer.example"));
        let (status, _, _) = s
            .send("POST", "/api/logout", Some(json!({})), &headers)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{headers:?}");
    }
    assert_eq!(s.me(&cookie).await.0, StatusCode::OK, "被擋的登出沒有生效");

    // 舊瀏覽器沒有 Sec-Fetch-Site：Origin 是自己就收
    let (status, _, _) = s
        .send(
            "POST",
            "/api/logout",
            Some(json!({})),
            &[
                ("origin", "https://cheer.example"),
                ("host", "cheer.example"),
                ("cookie", &cookie),
            ],
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn changes_are_not_made_with_get(db: sqlx::PgPool) {
    let s = Server::new(db);
    for path in ["/api/login", "/api/logout", "/api/set-password"] {
        let (status, _, _) = s
            .send("GET", path, None, &[("sec-fetch-site", "same-origin")])
            .await;
        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED, "{path}");
    }
}
