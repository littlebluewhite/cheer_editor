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

// ---------- 忘記密碼、我的帳號、鎖住（#246） ----------

const WRONG: &str = "這不是我的密碼這不是我的密碼";
const NEWER: &str = "換一句新的話當密碼也很好記得住吧";

impl Server {
    /// 等背景寄的信：等到總共寄了 n 封（最多等 5 秒），再多等一下，確定沒有多寄。
    async fn mails_settle_at(&self, n: usize) -> Vec<cheer_server::mail::Mail> {
        for _ in 0..500 {
            if self.state.mailer.sent().len() >= n {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let sent = self.state.mailer.sent();
        assert_eq!(sent.len(), n, "寄的信：{sent:#?}");
        sent
    }

    async fn forgot(&self, email: &str) -> (StatusCode, Value, Option<String>) {
        self.post("/api/forgot-password", json!({ "email": email }), None)
            .await
    }

    /// 登入，回狀態和 JSON（試太多次時有 retryAfter）。
    async fn try_login(&self, email: &str, password: &str) -> (StatusCode, Value) {
        let (status, json, _) = self
            .post(
                "/api/login",
                json!({ "email": email, "password": password }),
                None,
            )
            .await;
        (status, json)
    }

    /// 改密碼：現在的密碼、新密碼。
    async fn change_password(
        &self,
        current: &str,
        password: &str,
        cookie: Option<&str>,
    ) -> (StatusCode, Value) {
        let (status, json, _) = self
            .post(
                "/api/account/password",
                json!({ "current": current, "password": password }),
                cookie,
            )
            .await;
        (status, json)
    }
}

/// 信裡的設密碼連結的 token。
fn token_in(text: &str) -> String {
    let link = format!("{SITE}/set-password#");
    let at = text.find(&link).expect("信裡沒有設密碼連結") + link.len();
    text[at..].split_whitespace().next().unwrap().to_owned()
}

/// 直接在資料庫加一個人（管理員加人的 API 在別張票）：有密碼的、還沒設密碼的，可以是被停用的。
async fn add_user(s: &Server, email: &str, name: &str, password: Option<&str>, disabled: bool) {
    let hash = password.map(|p| {
        use argon2::password_hash::PasswordHasher;
        argon2::Argon2::default()
            .hash_password(p.as_bytes())
            .unwrap()
            .to_string()
    });
    sqlx::query(
        "INSERT INTO users (email, name, password_hash, disabled_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(email)
    .bind(name)
    .bind(hash)
    .bind(disabled.then(|| s.state.clock.now()))
    .execute(&s.state.db)
    .await
    .unwrap();
}

#[sqlx::test]
async fn forgot_password_answers_the_same_and_mails_only_who_can_use_it(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await; // lin：可以登入（已經寄過 1 封邀請信）
    add_user(&s, "wang@example.com", "王教練", None, false).await; // 還沒設密碼
    add_user(&s, "huang@example.com", "黃教練", Some(GOOD), true).await; // 被停用

    for email in [
        "nobody@example.com",
        "huang@example.com",
        "LIN@example.com",
        "wang@example.com",
    ] {
        assert_eq!(
            s.forgot(email).await,
            (StatusCode::NO_CONTENT, Value::Null, None),
            "{email}"
        );
    }

    let sent = s.mails_settle_at(3).await;
    let mut to: Vec<&str> = sent[1..].iter().map(|m| m.to.as_str()).collect();
    to.sort();
    assert_eq!(to, ["Lin@Example.com", "wang@example.com"]);

    // lin 收到重設密碼（1 小時），wang 收到設密碼信（24 小時）
    let lin = sent[1..]
        .iter()
        .find(|m| m.to == "Lin@Example.com")
        .unwrap();
    let wang = sent.iter().find(|m| m.to == "wang@example.com").unwrap();
    assert!(lin.text.contains("1 小時"), "{}", lin.text);
    assert!(wang.text.contains("24 小時"), "{}", wang.text);
    let (_, info, _) = s
        .post(
            "/api/password-link",
            json!({ "token": token_in(&lin.text) }),
            None,
        )
        .await;
    assert_eq!(info["purpose"], "reset");
    let (_, info, _) = s
        .post(
            "/api/password-link",
            json!({ "token": token_in(&wang.text) }),
            None,
        )
        .await;
    assert_eq!(info["purpose"], "invite");

    // 重設連結設好新密碼，用新密碼登入
    let (status, _, _) = s
        .post(
            "/api/set-password",
            json!({ "token": token_in(&lin.text), "password": NEWER }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        s.login("lin@example.com", NEWER).await.0,
        StatusCode::NO_CONTENT
    );
}

#[sqlx::test]
async fn forgot_password_mails_one_email_only_a_few_times_in_a_row(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;

    for _ in 0..5 {
        assert_eq!(s.forgot("lin@example.com").await.0, StatusCode::NO_CONTENT);
    }
    let sent = s.mails_settle_at(1 + 3).await;
    assert!(sent[1..].iter().all(|m| m.to == "Lin@Example.com"));
}

#[sqlx::test]
async fn more_wrong_guesses_wait_longer_and_unknown_emails_get_the_same_answers(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;

    let mut answers = Vec::new();
    for email in ["lin@example.com", "nobody@example.com"] {
        let mut seen = Vec::new();
        for _ in 0..5 {
            seen.push(s.try_login(email, WRONG).await);
        }
        // 第 5 次錯之後要等 30 秒；等的時候連對的密碼都不收
        seen.push(s.try_login(email, GOOD).await);
        s.pass(Duration::seconds(29));
        seen.push(s.try_login(email, WRONG).await);
        s.pass(Duration::seconds(1));
        seen.push(s.try_login(email, WRONG).await);
        // 再錯一次：等更久
        seen.push(s.try_login(email, WRONG).await);
        answers.push(seen);
    }

    let wrong = (StatusCode::UNAUTHORIZED, Value::Null);
    let wait = |secs: u32| (StatusCode::TOO_MANY_REQUESTS, json!({ "retryAfter": secs }));
    let mut expected = vec![wrong.clone(); 5];
    expected.extend([wait(30), wait(1), wrong.clone(), wait(60)]);
    assert_eq!(answers[0], expected);
    assert_eq!(answers[1], answers[0], "沒有帳號的 email 回一樣的話");

    // 等夠了、密碼對：登入，失敗次數歸零
    s.pass(Duration::seconds(60));
    assert_eq!(
        s.try_login("lin@example.com", GOOD).await.0,
        StatusCode::NO_CONTENT
    );
    for _ in 0..5 {
        assert_eq!(s.try_login("LIN@example.com", WRONG).await, wrong);
    }
}

#[sqlx::test]
async fn after_100_wrong_guesses_only_a_reset_lets_you_in_and_forgot_password_still_works(
    db: sqlx::PgPool,
) {
    let s = Server::new(db);
    admin_with_password(&s).await;

    for i in 1..=100 {
        assert_eq!(
            s.try_login("lin@example.com", WRONG).await.0,
            StatusCode::UNAUTHORIZED,
            "第 {i} 次"
        );
        s.pass(Duration::hours(1));
    }
    // 密碼停掉了：等多久、密碼對都進不去
    s.pass(Duration::days(2));
    let (status, json) = s.try_login("lin@example.com", GOOD).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(json["retryAfter"].as_u64().unwrap() > 0);

    // 鎖住時忘記密碼照樣能用；重設後能登入
    assert_eq!(s.forgot("lin@example.com").await.0, StatusCode::NO_CONTENT);
    s.mails_settle_at(2).await;
    let (status, _, _) = s
        .post(
            "/api/set-password",
            json!({ "token": s.last_link_token(), "password": NEWER }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        s.login("lin@example.com", NEWER).await.0,
        StatusCode::NO_CONTENT
    );
}

#[sqlx::test]
async fn change_password_needs_the_current_one_and_logs_out_other_devices(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;
    let here = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());
    let there = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());

    assert_eq!(
        s.change_password(GOOD, NEWER, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        s.change_password(WRONG, NEWER, Some(&here)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        s.change_password(GOOD, "太短", Some(&here)).await,
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({ "kind": "tooShort", "missing": 13 })
        )
    );
    assert_eq!(
        s.change_password(GOOD, LEAKED, Some(&here)).await,
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({ "kind": "breached" })
        )
    );
    assert_eq!(
        s.me(&there).await.0,
        StatusCode::OK,
        "沒改成：別的裝置還登入著"
    );

    assert_eq!(
        s.change_password(GOOD, NEWER, Some(&here)).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(s.me(&here).await.0, StatusCode::OK, "這台還登入著");
    assert_eq!(
        s.me(&there).await.0,
        StatusCode::UNAUTHORIZED,
        "其他登入狀態都不能用"
    );
    assert_eq!(
        s.login("lin@example.com", GOOD).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        s.login("lin@example.com", NEWER).await.0,
        StatusCode::NO_CONTENT
    );
}

#[sqlx::test]
async fn wrong_current_password_counts_toward_the_lock(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;
    let cookie = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());

    for _ in 0..5 {
        assert_eq!(
            s.change_password(WRONG, NEWER, Some(&cookie)).await.0,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        s.change_password(GOOD, NEWER, Some(&cookie)).await,
        (StatusCode::TOO_MANY_REQUESTS, json!({ "retryAfter": 30 }))
    );
}

#[sqlx::test]
async fn changed_name_is_what_everyone_gets(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;
    let here = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());
    let there = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());

    let (status, _, _) = s
        .post("/api/account/name", json!({ "name": "   " }), Some(&here))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _, _) = s
        .post("/api/account/name", json!({ "name": "林總教練" }), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, me, _) = s
        .post(
            "/api/account/name",
            json!({ "name": "  林總教練 " }),
            Some(&here),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["name"], "林總教練");
    assert_eq!(s.me(&there).await.1["name"], "林總教練");

    // 信裡、設密碼頁也是新名字
    assert_eq!(s.forgot("lin@example.com").await.0, StatusCode::NO_CONTENT);
    let sent = s.mails_settle_at(2).await;
    assert!(sent[1].text.starts_with("林總教練，"), "{}", sent[1].text);
    let (_, info, _) = s
        .post(
            "/api/password-link",
            json!({ "token": s.last_link_token() }),
            None,
        )
        .await;
    assert_eq!(info["name"], "林總教練");
}

#[sqlx::test]
async fn me_says_when_the_30_days_are_up(db: sqlx::PgPool) {
    let s = Server::new(db);
    admin_with_password(&s).await;
    let set_cookie = s.login("lin@example.com", GOOD).await.1.unwrap();
    // 瀏覽器留 cookie 比 30 天久，到期後還帶得來，伺服器才說得出「到期了」
    let max_age: i64 = set_cookie
        .split(';')
        .find_map(|p| p.trim().strip_prefix("Max-Age="))
        .unwrap()
        .parse()
        .unwrap();
    assert!(max_age > Duration::days(30).num_seconds());
    let cookie = cookie_pair(&set_cookie);

    let (status, json, _) = s.send("GET", "/api/me", None, &[]).await;
    assert_eq!(
        (status, json),
        (StatusCode::UNAUTHORIZED, json!({ "expired": false }))
    );

    s.pass(Duration::days(30));
    assert_eq!(
        s.me(&cookie).await,
        (StatusCode::UNAUTHORIZED, json!({ "expired": true }))
    );

    // 登出的：不是到期
    let other = cookie_pair(&s.login("lin@example.com", GOOD).await.1.unwrap());
    s.post("/api/logout", json!({}), Some(&other)).await;
    assert_eq!(
        s.me(&other).await,
        (StatusCode::UNAUTHORIZED, json!({ "expired": false }))
    );
}
