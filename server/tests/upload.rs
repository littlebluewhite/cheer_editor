// 傳上雲端（#259）：本機流程（flow.json 的內容）傳上來變成一支新的雲端流程，傳的人是擁有者。
// 伺服器跑「檢查一整支流程」和「整份流程檢查」，壞掉的、過不了的不收；紀錄拆出來分開存，沒有記的人。
// 從外面打 API（tower 的 oneshot）。要有 PostgreSQL：見 tests/db.rs 開頭。

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use chrono::{TimeZone, Utc};
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

/// 範例流程：從沒有流程開始，一步一步建出來（跟 tests/flow_core.rs 用的同一份）。
const SAMPLE_STEPS: &str = include_str!("fixtures/sample-steps.json");
/// 範例流程裡的 Lib、它的上法、第 1 組、第 2 組。
const LIB: &str = "x2l8axo41g3ph";
const LOAD: &str = "pq4lkns0v20ec";
const SQUAD_1: &str = "g7sil583dmpgv";
const SQUAD_2: &str = "gre8zqixysbk8";

struct Server {
    state: AppState,
    site: tempfile::TempDir,
}

impl Server {
    fn new(db: sqlx::PgPool) -> Self {
        let now = Utc.with_ymd_and_hms(2026, 11, 7, 9, 0, 0).unwrap();
        let state = AppState {
            db,
            mailer: Mailer::memory(),
            breach: BreachCheck::list(Vec::<&str>::new()),
            clock: Clock::new(move || now),
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

    /// 送一個請求（從網頁本身送的）。回狀態、JSON（沒有內容是 Null）。
    async fn send(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        cookie: Option<&str>,
    ) -> (StatusCode, Value) {
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
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    /// 開一個帳號、登入，回要帶的 Cookie。
    async fn signed_in(&self, email: &str, name: &str) -> String {
        create_admin(&self.state, email, Some(name)).await.unwrap();
        let mail = self.state.mailer.sent().last().cloned().unwrap();
        let link = format!("{SITE}/set-password#");
        let at = mail.text.find(&link).unwrap() + link.len();
        let token = mail.text[at..].split_whitespace().next().unwrap();
        let body = json!({ "token": token, "password": GOOD });
        let (status, _) = self
            .send("POST", "/api/set-password", Some(body), None)
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let req = Request::builder()
            .method("POST")
            .uri("/api/login")
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
        let cookie = res
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        cookie.split(';').next().unwrap().to_owned()
    }

    /// 傳上雲端：送 flow.json 的內容。
    async fn upload(&self, cookie: &str, doc: Value) -> (StatusCode, Value) {
        self.send("POST", "/api/flows/upload", Some(doc), Some(cookie))
            .await
    }

    /// 我的流程（我擁有的）的名字。
    async fn mine(&self, cookie: &str) -> Vec<Value> {
        let (_, list) = self.send("GET", "/api/flows", None, Some(cookie)).await;
        list["mine"].as_array().unwrap().clone()
    }
}

/// 範例流程（照 fixtures/sample-steps.json 的第 1–7 步：Lib 三個環節、分兩組），Lib 帶這些紀錄。
async fn sample_flow(core: &FlowCore, records: Value) -> Value {
    let steps: Vec<Value> = serde_json::from_str(SAMPLE_STEPS).unwrap();
    let mut flow = "null".to_string();
    for s in &steps[..7] {
        let result = core
            .run_commands(
                flow,
                s["commands"].to_string(),
                s["stepId"].as_str().unwrap().into(),
            )
            .await
            .unwrap();
        let r: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(r["kind"], "ok", "{r}");
        flow = r["flow"].to_string();
    }
    let mut flow: Value = serde_json::from_str(&flow).unwrap();
    let lib = flow["actions"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|a| a["id"] == LIB)
        .unwrap();
    lib["successRate"]["records"] = records;
    flow
}

/// flow.json 的內容。
fn doc(flow: &Value) -> Value {
    json!({ "formatVersion": 15, "flow": flow })
}

/// 流程檔裡的兩次：分段練一次（舊的 id），全上一次（帶開的時間）。
fn file_records() -> Value {
    json!([
        { "id": "t1", "date": "2026-11-01", "who": SQUAD_1, "practice": "drill", "whole": true, "marks": { LOAD: "✓" } },
        { "id": "trun000000010", "date": "2026-11-02", "who": SQUAD_2, "practice": "runThrough",
          "runThroughId": "rrun000000010", "runThroughStartedAt": 1_793_000_000_000_i64, "whole": true, "marks": { LOAD: "✗" } }
    ])
}

#[sqlx::test]
async fn an_uploaded_flow_becomes_a_new_cloud_flow_owned_by_the_uploader(db: sqlx::PgPool) {
    let s = Server::new(db);
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let flow = sample_flow(&s.state.core, file_records()).await;

    let (status, made) = s.upload(&lin, doc(&flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    assert_eq!(made["name"], "測試");
    assert_eq!(made["updatedAt"], "2026-11-07T09:00:00.000Z");
    let id = made["id"].as_str().unwrap();
    assert_eq!(id.len(), 12);

    // 傳的人是擁有者；剛傳上來是第 0 步。
    let mine = s.mine(&lin).await;
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0]["id"], id);
    let (status, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, Some(&lin))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(got["role"], "owner");
    assert_eq!(got["step"], 0);
    assert_eq!(got["flow"]["members"], flow["members"]);

    // 同一個檔再傳一次：另一支，不蓋掉。
    let (status, again) = s.upload(&lin, doc(&flow)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_ne!(again["id"], made["id"]);
    assert_eq!(s.mine(&lin).await.len(), 2);
}

#[sqlx::test]
async fn uploaded_records_are_kept_apart_without_a_recorder(db: sqlx::PgPool) {
    let s = Server::new(db);
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let flow = sample_flow(&s.state.core, file_records()).await;
    let (_, made) = s.upload(&lin, doc(&flow)).await;
    let id = made["id"].as_str().unwrap();

    // 編排裡沒有紀錄（ADR 0008）；紀錄分開拿，不是誰記的（沒有名字、不是自己記的）。
    let (_, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, Some(&lin))
        .await;
    let lib = got["flow"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == LIB)
        .unwrap();
    assert_eq!(lib["successRate"]["records"], json!([]));
    let records = got["records"].as_array().unwrap();
    let expected: Vec<Value> = file_records()
        .as_array()
        .unwrap()
        .iter()
        .map(|a| json!({ "actionId": LIB, "attempt": a, "by": null, "mine": false }))
        .collect();
    assert_eq!(records, &expected);

    // 資料庫裡一次一筆，沒有記的人；全上記下開的時間。
    let rows: Vec<(String, Option<i64>)> =
        sqlx::query_as("SELECT id, recorded_by FROM flow_records WHERE flow_id = $1 ORDER BY seq")
            .bind(id)
            .fetch_all(&s.state.db)
            .await
            .unwrap();
    assert_eq!(
        rows,
        [("t1".to_owned(), None), ("trun000000010".to_owned(), None)]
    );
    let (started,): (Option<i64>,) =
        sqlx::query_as("SELECT started_at FROM flow_run_throughs WHERE flow_id = $1")
            .bind(id)
            .fetch_one(&s.state.db)
            .await
            .unwrap();
    assert_eq!(started, Some(1_793_000_000_000));
}

#[sqlx::test]
async fn broken_flows_and_flows_failing_the_whole_flow_check_are_not_uploaded(db: sqlx::PgPool) {
    let s = Server::new(db);
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let good = sample_flow(&s.state.core, json!([])).await;

    // 檢查一整支流程：不是流程檔、比伺服器新的版本。
    let (status, body) = s.upload(&lin, json!({ "flow": good })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body, json!({ "message": "流程檔裡的資料壞掉了" }));
    let (status, body) = s
        .upload(&lin, json!({ "formatVersion": 99, "flow": good }))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "是新版編輯器存的，請重新整理，更新編輯器");

    // 整份流程檢查：動作指到不存在的隊員、段太長。
    let mut ghost = good.clone();
    ghost["actions"][0]["members"][0]["memberId"] = json!("mnobody000000");
    let (status, body) = s.upload(&lin, doc(&ghost)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body, json!({ "message": "流程檔裡的資料壞掉了" }));
    let mut long = good.clone();
    long["segments"][0]["halfBeats"] = json!(1_000_000);
    let (status, body) = s.upload(&lin, doc(&long)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"].as_str().unwrap().contains("個八拍之間"),
        "{body}"
    );

    // 紀錄打錯（記號不是物件）也算壞掉。
    let bad_record = sample_flow(
        &s.state.core,
        json!([{ "id": "t1", "date": "2026-11-01", "who": SQUAD_1, "practice": "drill", "whole": true, "marks": "✓" }]),
    )
    .await;
    let (status, _) = s.upload(&lin, doc(&bad_record)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // 都沒建出來。
    assert!(s.mine(&lin).await.is_empty());
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM flows")
        .fetch_one(&s.state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test]
async fn uploading_needs_signing_in(db: sqlx::PgPool) {
    let s = Server::new(db);
    let flow = sample_flow(&s.state.core, json!([])).await;
    let (status, _) = s
        .send("POST", "/api/flows/upload", Some(doc(&flow)), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
