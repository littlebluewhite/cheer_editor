// 分享連結（#251）：一支流程一條。擁有者開、關；關掉再打開換新的，舊的不能用。
// 用連結打開不用登入、只拿到編排（沒有紀錄）；已經登入、有權限的人用連結打開照自己的權限。
// 要有 PostgreSQL：見 tests/db.rs 開頭。

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
/// 沒登入。
const NOBODY: &str = "";

struct Server {
    state: AppState,
    site: tempfile::TempDir,
}

impl Server {
    fn new(db: sqlx::PgPool) -> Self {
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

    /// 開一個帳號、設好密碼、登入，回 Cookie。
    async fn user(&self, email: &str, name: &str) -> String {
        create_admin(&self.state, email, Some(name)).await.unwrap();
        let mail = self.state.mailer.sent().last().cloned().unwrap();
        let link = format!("{SITE}/set-password#");
        let at = mail.text.find(&link).unwrap() + link.len();
        let token = mail.text[at..].split_whitespace().next().unwrap();
        let body = json!({ "token": token, "password": GOOD });
        self.send("POST", "/api/set-password", Some(body), NOBODY)
            .await;
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
        set_cookie
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned()
    }

    async fn create(&self, owner: &str, name: &str) -> String {
        let input = json!({ "name": name, "field": { "strips": 9, "layout": "vertical" } });
        let (status, made) = self.send("POST", "/api/flows", Some(input), owner).await;
        assert_eq!(status, StatusCode::CREATED);
        made["id"].as_str().unwrap().to_owned()
    }

    async fn share(&self, owner: &str, id: &str, email: &str, role: &str) {
        let body = json!({ "email": email, "role": role });
        let path = format!("/api/flows/{id}/people");
        let (status, _) = self.send("POST", &path, Some(body), owner).await;
        assert_eq!(status, StatusCode::OK);
    }

    /// 開、關分享連結，回狀態和連結（關著是 null）。
    async fn switch(&self, who: &str, id: &str, on: bool) -> (StatusCode, Value) {
        let path = format!("/api/flows/{id}/link");
        let (status, got) = self
            .send("POST", &path, Some(json!({ "on": on })), who)
            .await;
        (status, got["token"].clone())
    }

    /// 看分享連結開著沒（開著回連結，關著 null）。
    async fn link(&self, who: &str, id: &str) -> (StatusCode, Value) {
        let (status, got) = self
            .send("GET", &format!("/api/flows/{id}/link"), None, who)
            .await;
        (status, got["token"].clone())
    }

    /// 用連結打開。
    async fn open(&self, who: &str, token: &Value) -> (StatusCode, Value) {
        let token = token.as_str().unwrap();
        self.send("GET", &format!("/api/links/{token}"), None, who)
            .await
    }
}

#[sqlx::test]
async fn a_closed_link_does_not_open_and_reopening_makes_a_new_one(db: sqlx::PgPool) {
    let s = Server::new(db);
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;

    // 一開始關著
    assert_eq!(s.link(&wang, &id).await, (StatusCode::OK, Value::Null));

    let (status, first) = s.switch(&wang, &id, true).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        first.as_str().unwrap().len() >= 32,
        "連結要夠長猜不到：{first}"
    );
    // 開著再按開：還是同一條（擁有者能再複製）
    assert_eq!(s.switch(&wang, &id, true).await.1, first);
    assert_eq!(s.link(&wang, &id).await, (StatusCode::OK, first.clone()));
    let (status, got) = s.open(NOBODY, &first).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(got["id"], id.as_str());
    assert_eq!(got["flow"]["name"], "全國賽");

    // 關掉：打不開
    assert_eq!(
        s.switch(&wang, &id, false).await,
        (StatusCode::OK, Value::Null)
    );
    assert_eq!(s.open(NOBODY, &first).await.0, StatusCode::NOT_FOUND);

    // 再打開：換一條新的，舊的還是不能用
    let (_, second) = s.switch(&wang, &id, true).await;
    assert_ne!(second, first);
    assert_eq!(s.open(NOBODY, &second).await.0, StatusCode::OK);
    assert_eq!(s.open(NOBODY, &first).await.0, StatusCode::NOT_FOUND);
    // 亂打的
    assert_eq!(
        s.open(NOBODY, &json!("nosuchlink")).await.0,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test]
async fn only_the_owner_switches_the_link_but_everyone_on_the_list_sees_it(db: sqlx::PgPool) {
    let s = Server::new(db);
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let chen = s.user("chen@example.com", "陳教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, "lin@example.com", "editor").await;

    assert_eq!(s.switch(&lin, &id, true).await.0, StatusCode::FORBIDDEN);
    assert_eq!(s.link(&lin, &id).await, (StatusCode::OK, Value::Null));
    let (_, token) = s.switch(&wang, &id, true).await;
    // 不是擁有者：看得到開著，也能複製
    assert_eq!(s.link(&lin, &id).await, (StatusCode::OK, token.clone()));
    assert_eq!(s.switch(&lin, &id, false).await.0, StatusCode::FORBIDDEN);
    // 沒權限、沒登入：跟沒有這支一樣
    assert_eq!(s.link(&chen, &id).await.0, StatusCode::NOT_FOUND);
    assert_eq!(s.switch(&chen, &id, false).await.0, StatusCode::NOT_FOUND);
    assert_eq!(s.link(NOBODY, &id).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(s.link(&wang, &id).await, (StatusCode::OK, token));
}

#[sqlx::test]
async fn the_link_gives_the_arrangement_without_records(db: sqlx::PgPool) {
    let s = Server::new(db);
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.create(&wang, "全國賽").await;
    // 流程裡有一個動作記過成功率（紀錄還在編排裡的舊樣子也不能漏出去）
    let attempt = json!({ "id": "t1", "date": "2025-03-01", "marks": ["o"] });
    let action = json!({ "id": "x1", "name": "Lib", "successRate": { "phases": [{ "id": "p1", "name": "上" }], "records": [attempt] } });
    sqlx::query(
        "UPDATE flows SET content = json_build_object('name', content->'name', 'actions', json_build_array($2::json)) WHERE id = $1",
    )
    .bind(&id)
    .bind(action.to_string())
    .execute(&s.state.db)
    .await
    .unwrap();
    let (_, token) = s.switch(&wang, &id, true).await;

    let (status, got) = s.open(NOBODY, &token).await;
    assert_eq!(status, StatusCode::OK);
    let mut keys: Vec<&str> = got
        .as_object()
        .unwrap()
        .keys()
        .map(|k| k.as_str())
        .collect();
    keys.sort();
    assert_eq!(keys, ["flow", "id", "updatedAt"]);
    assert_eq!(got["flow"]["actions"][0]["name"], "Lib");
    assert_eq!(
        got["flow"]["actions"][0]["successRate"],
        json!({ "phases": [{ "id": "p1", "name": "上" }], "records": [] })
    );
    assert!(!got.to_string().contains("2025-03-01"), "{got}");
}

#[sqlx::test]
async fn people_with_access_who_open_the_link_get_their_own_role(db: sqlx::PgPool) {
    let s = Server::new(db);
    let wang = s.user("wang@example.com", "王教練").await;
    let lin = s.user("lin@example.com", "林教練").await;
    let chen = s.user("chen@example.com", "陳教練").await;
    let id = s.create(&wang, "全國賽").await;
    s.share(&wang, &id, "lin@example.com", "recorder").await;
    let (_, token) = s.switch(&wang, &id, true).await;

    assert_eq!(s.open(&wang, &token).await.1["role"], "owner");
    assert_eq!(s.open(&lin, &token).await.1["role"], "recorder");
    // 登入了但沒權限：跟沒登入一樣只能用連結看，也不會因此出現在「分享給我的」
    let (status, got) = s.open(&chen, &token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(got.get("role").is_none(), "{got}");
    let (_, list) = s.send("GET", "/api/flows", None, &chen).await;
    assert_eq!(list["shared"], json!([]));
    assert_eq!(
        s.send("GET", &format!("/api/flows/{id}"), None, &chen)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}
