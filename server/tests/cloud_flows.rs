// 雲端流程：新建、列出我的流程、拿一支；別人拿不到（#247）。
// 從外面打 API（tower 的 oneshot）。要有 PostgreSQL：見 tests/db.rs 開頭。

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
use cheer_server::flow_core::FlowCore;
use cheer_server::mail::Mailer;
use cheer_server::{AppState, app};

const SITE: &str = "https://cheer.example";
const GOOD: &str = "我們這一隊今年一定會贏 go go";

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
            breach: BreachCheck::list(Vec::<&str>::new()),
            clock: Clock::new(move || *clock_now.lock().unwrap()),
            site_url: SITE.into(),
            core: FlowCore::start().unwrap(),
            mail_limit: Default::default(),
            music: None,
        };
        let site = tempfile::tempdir().unwrap();
        std::fs::write(site.path().join("200.html"), "spa entry").unwrap();
        Self { state, now, site }
    }

    fn pass(&self, d: Duration) {
        *self.now.lock().unwrap() += d;
    }

    /// 送一個請求（從網頁本身送的：帶 Sec-Fetch-Site）。回狀態、JSON（沒有內容是 Null）、Set-Cookie。
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

    /// 開一個帳號（用 create-admin 寄的設密碼信設好密碼）、登入，回要帶的 Cookie。
    /// create-admin 會換管理員，但之前的人照樣登入著。
    async fn signed_in(&self, email: &str, name: &str) -> String {
        create_admin(&self.state, email, Some(name)).await.unwrap();
        let mail = self.state.mailer.sent().last().cloned().unwrap();
        let link = format!("{SITE}/set-password#");
        let at = mail.text.find(&link).unwrap() + link.len();
        let token = mail.text[at..].split_whitespace().next().unwrap();
        let (status, _, _) = self
            .send(
                "POST",
                "/api/set-password",
                Some(json!({ "token": token, "password": GOOD })),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (status, _, set_cookie) = self
            .send(
                "POST",
                "/api/login",
                Some(json!({ "email": email, "password": GOOD })),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        set_cookie.unwrap().split(';').next().unwrap().to_owned()
    }

    async fn create(&self, cookie: &str, name: &str) -> (StatusCode, Value) {
        let input = json!({ "name": name, "field": { "strips": 9, "layout": "vertical" } });
        let (status, json, _) = self
            .send("POST", "/api/flows", Some(input), Some(cookie))
            .await;
        (status, json)
    }
}

#[sqlx::test]
async fn create_list_and_get_my_flows(db: sqlx::PgPool) {
    let s = Server::new(db);
    let lin = s.signed_in("lin@example.com", "林教練").await;

    let (status, list, _) = s.send("GET", "/api/flows", None, Some(&lin)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list, json!({ "mine": [] }));

    // 新建：伺服器用流程核心建（名字頭尾空白去掉），回這支的 id、名字、最後改的時間。
    let (status, made) = s.create(&lin, "  全國賽 ").await;
    assert_eq!(status, StatusCode::CREATED);
    let id = made["id"].as_str().unwrap().to_owned();
    assert_eq!(made["name"], "全國賽");
    assert_eq!(made["updatedAt"], "2026-11-07T09:00:00.000Z");

    s.pass(Duration::minutes(5));
    let (_, second) = s.create(&lin, "校慶表演").await;

    // 我的流程：最近改的在前。
    let (_, list, _) = s.send("GET", "/api/flows", None, Some(&lin)).await;
    let names: Vec<&str> = list["mine"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["校慶表演", "全國賽"]);
    assert_eq!(list["mine"][0]["id"], second["id"]);
    assert_eq!(list["mine"][0]["updatedAt"], "2026-11-07T09:05:00.000Z");

    // 拿一支：編排、現在第幾步（剛建好是 0）。
    let (status, got, _) = s
        .send("GET", &format!("/api/flows/{id}"), None, Some(&lin))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(got["id"], id.as_str());
    assert_eq!(got["step"], 0);
    assert_eq!(got["updatedAt"], "2026-11-07T09:00:00.000Z");
    assert_eq!(got["flow"]["name"], "全國賽");
    assert_eq!(
        got["flow"]["field"],
        json!({ "strips": 9, "layout": "vertical" })
    );
    assert_eq!(got["flow"]["members"], json!([]));
}

#[sqlx::test]
async fn flow_core_blocks_a_bad_new_flow(db: sqlx::PgPool) {
    let s = Server::new(db);
    let lin = s.signed_in("lin@example.com", "林教練").await;

    let (status, body) = s.create(&lin, "   ").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body, json!({ "message": "請幫流程取名字" }));
    let (_, list, _) = s.send("GET", "/api/flows", None, Some(&lin)).await;
    assert_eq!(list, json!({ "mine": [] }));
}

#[sqlx::test]
async fn others_cannot_get_or_list_my_flow(db: sqlx::PgPool) {
    let s = Server::new(db);
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let wang = s.signed_in("wang@example.com", "王教練").await;
    let (_, made) = s.create(&lin, "全國賽").await;
    let path = format!("/api/flows/{}", made["id"].as_str().unwrap());

    // 別人：跟沒有這支一樣，回 404；他的清單裡也沒有。
    let (status, _, _) = s.send("GET", &path, None, Some(&wang)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = s.send("GET", "/api/flows/nope", None, Some(&lin)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, list, _) = s.send("GET", "/api/flows", None, Some(&wang)).await;
    assert_eq!(list, json!({ "mine": [] }));

    // 沒登入：401。
    let (status, _, _) = s.send("GET", &path, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = s.send("GET", "/api/flows", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = s
        .send(
            "POST",
            "/api/flows",
            Some(json!({ "name": "偷建", "field": { "strips": 9, "layout": "vertical" } })),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
