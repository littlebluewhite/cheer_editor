// 一起記全上（#262，ADR 0015）：開表的人送全上 id、日期、開的時間，伺服器發給能記的人（檢視者收不到）；
// 加入用同一個 id、日期；誰拿著哪幾組、點過沒只放記憶體：沒人拿著的給加入的人，還沒點過的能接手、點過的拿不走，
// 搶同一組後到的退回；斷線 1 分鐘當他離開；伺服器重開後手機重報補回來。存紀錄：同一次同一組只收先存的。
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

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct Server {
    state: AppState,
    /// 手撥的鐘。
    now: Arc<Mutex<DateTime<Utc>>>,
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
        let clock = now.clone();
        let state = AppState {
            db,
            mailer: Mailer::memory(),
            breach: BreachCheck::list(Vec::<&str>::new()),
            clock: Clock::new(move || -> DateTime<Utc> { *clock.lock().unwrap() }),
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
        Self {
            state,
            now,
            site,
            addr,
        }
    }

    /// 鐘往後撥幾秒。
    fn wait(&self, seconds: i64) {
        *self.now.lock().unwrap() += chrono::Duration::seconds(seconds);
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

    /// 開一個帳號、設好密碼、登入。
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

    /// 連上、打招呼，回房間（伺服器說了可以送步）。
    async fn join(&self, who: &User, id: &str) -> Socket {
        let mut req = format!("ws://{}/api/flows/{id}/room", self.addr)
            .into_client_request()
            .unwrap();
        req.headers_mut()
            .insert("sec-fetch-site", "same-origin".parse().unwrap());
        req.headers_mut()
            .insert("cookie", who.cookie.parse().unwrap());
        let (mut socket, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        let hello =
            json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": who.email, "seen": 0 });
        say(&mut socket, hello).await;
        assert_eq!(until(&mut socket, "ready").await["kind"], "ready");
        socket
    }

    /// 王教練（擁有者）建一支有 Lib 的流程（三個環節、兩組，照 fixtures/sample-steps.json 的第 2–7 步），
    /// 分享給這些人（email、權限）。回流程 id。
    async fn sample(&self, owner: &User, shares: &[(&User, &str)]) -> String {
        let input = json!({ "name": "全國賽", "field": { "strips": 9, "layout": "vertical" } });
        let (status, made) = self
            .send("POST", "/api/flows", Some(input), &owner.cookie)
            .await;
        assert_eq!(status, StatusCode::CREATED);
        let id = made["id"].as_str().unwrap().to_owned();
        let steps: Vec<Value> = serde_json::from_str(SAMPLE_STEPS).unwrap();
        let mut room = self.join(owner, &id).await;
        for (n, s) in steps[1..7].iter().enumerate() {
            let message = json!({ "kind": "step", "stepId": s["stepId"], "seen": n, "commands": s["commands"] });
            say(&mut room, message).await;
            assert_eq!(until(&mut room, "accepted").await["kind"], "accepted");
        }
        for (who, role) in shares {
            let body = json!({ "email": who.email, "role": role });
            let path = format!("/api/flows/{id}/people");
            let (status, _) = self.send("POST", &path, Some(body), &owner.cookie).await;
            assert_eq!(status, StatusCode::OK);
        }
        id
    }
}

/// 範例流程：從沒有流程開始，一步一步建出來（跟 tests/flow_core.rs 用的同一份）。
const SAMPLE_STEPS: &str = include_str!("fixtures/sample-steps.json");
/// 範例流程裡的 Lib、它的三個環節（上法、中段、下法）、第 1 組、第 2 組。
const LIB: &str = "x2l8axo41g3ph";
const LOAD: &str = "pq4lkns0v20ec";
const HOLD: &str = "p33qu2fx2u0ue";
const DISMOUNT: &str = "p8jok7d9wl8v2";
const SQUAD_2: &str = "gre8zqixysbk8";

/// 這次全上的 id、開的時間（手機的時間）。
const RUN: &str = "rabc123def456";
const STARTED: i64 = 1_794_036_000_000;

/// 我在這次全上的表裡（開、加入、連上時再報）：日期、拿著哪幾組、點過哪幾組。
fn report(date: &str, keys: &[&str], touched: &[&str], joining: bool) -> Value {
    json!({ "kind": "runThrough", "id": RUN, "date": date, "startedAt": STARTED,
            "keys": keys, "touched": touched, "joining": joining })
}

/// 這次全上裡每組誰拿著：組 → （名字、點過沒、斷線了沒）。
fn holders(runs: &Value) -> Vec<(String, String, bool, bool)> {
    runs["runs"][0]["keys"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|k| {
            (
                k["key"].as_str().unwrap().to_owned(),
                k["name"].as_str().unwrap().to_owned(),
                k["touched"].as_bool().unwrap(),
                k["away"].as_bool().unwrap(),
            )
        })
        .collect()
}

/// 表裡的人的名字（還沒離開的，照進來的先後）。
fn people(runs: &Value) -> Vec<&str> {
    runs["runs"][0]["people"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect()
}

fn hold(key: &str, name: &str, touched: bool, away: bool) -> (String, String, bool, bool) {
    (key.into(), name.into(), touched, away)
}

#[sqlx::test]
async fn an_opened_run_through_reaches_recorders_not_viewers_and_joining_uses_its_id_and_date(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let chen = s.user("chen@example.com", "陳檢視").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s
        .sample(&wang, &[(&lin, "recorder"), (&chen, "viewer")])
        .await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;
    let mut viewer = s.join(&chen, &id).await;

    say(
        &mut coach,
        report("2026-11-07", &["n:1", "n:2"], &[], false),
    )
    .await;
    let mine = until(&mut coach, "runThroughs").await;
    assert_eq!(mine["runs"][0]["keys"][0]["mine"], true);

    let seen = until(&mut phone, "runThroughs").await;
    assert_eq!(seen["runs"][0]["id"], RUN);
    assert_eq!(seen["runs"][0]["date"], "2026-11-07");
    assert_eq!(seen["runs"][0]["startedAt"], STARTED);
    assert_eq!(people(&seen), vec!["王教練"]);
    assert_eq!(
        holders(&seen),
        vec![
            hold("n:1", "王教練", false, false),
            hold("n:2", "王教練", false, false)
        ]
    );
    assert_eq!(seen["runs"][0]["keys"][0]["mine"], false);
    assert!(quiet(&mut viewer).await, "檢視者不該收到");

    // 林教練的手機日期不一樣，加入時還是用開的人的日期。
    let mut late = report("2026-11-08", &[], &[], true);
    late["startedAt"] = json!(STARTED + 5000);
    say(&mut phone, late).await;
    let joined = until(&mut phone, "runThroughs").await;
    assert_eq!(joined["runs"][0]["id"], RUN);
    assert_eq!(joined["runs"][0]["date"], "2026-11-07");
    assert_eq!(joined["runs"][0]["startedAt"], STARTED);
    assert_eq!(people(&joined), vec!["王教練", "林教練"]);
    assert_eq!(joined["runs"][0]["people"][1]["me"], true);
    assert!(quiet(&mut viewer).await, "檢視者不該收到");

    // 後來才連上的能記的人一連上就看到。
    let mut again = s.join(&lin, &id).await;
    assert_eq!(people(&until(&mut again, "runThroughs").await).len(), 2);
}

#[sqlx::test]
async fn joiners_get_free_squads_untouched_ones_can_be_taken_over_touched_ones_cannot_and_late_grabs_are_refused(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let mei = s.user("mei@example.com", "陳小美").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s
        .sample(&wang, &[(&lin, "recorder"), (&mei, "editor")])
        .await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;
    let mut tablet = s.join(&mei, &id).await;

    say(
        &mut coach,
        report("2026-11-07", &["n:1", "n:2"], &[], false),
    )
    .await;
    until(&mut coach, "runThroughs").await;
    // 加入時手機幫他勾好沒人拿著的組；別人拿著的不給。
    say(&mut phone, report("2026-11-07", &["n:2", "n:3"], &[], true)).await;
    let joined = until_with(&mut phone, |m| people(m).len() == 2).await;
    assert_eq!(
        holders(&joined),
        vec![
            hold("n:1", "王教練", false, false),
            hold("n:2", "王教練", false, false),
            hold("n:3", "林教練", false, false)
        ]
    );

    // 王教練還沒點過第 1 組：林教練接手。
    say(&mut phone, json!({ "kind": "claim", "run": RUN, "key": "n:1", "from": joined["runs"][0]["keys"][0]["userId"] })).await;
    let taken = until_with(&mut coach, |m| {
        holders(m).first().is_some_and(|h| h.1 == "林教練")
    })
    .await;
    assert_eq!(holders(&taken)[0], hold("n:1", "林教練", false, false));

    // 王教練點了第 2 組：拿不走。
    say(
        &mut coach,
        json!({ "kind": "touch", "run": RUN, "key": "n:2" }),
    )
    .await;
    let touched = until_with(&mut phone, |m| {
        holders(m).iter().any(|h| h.0 == "n:2" && h.2)
    })
    .await;
    let wang_id = holders_ids(&touched, "n:2");
    say(
        &mut phone,
        json!({ "kind": "claim", "run": RUN, "key": "n:2", "from": wang_id }),
    )
    .await;
    let refused = until(&mut phone, "claimRefused").await;
    assert_eq!(
        refused,
        json!({ "kind": "claimRefused", "run": RUN, "key": "n:2", "by": "王教練", "touched": true })
    );

    // 第 4 組沒人拿著，陳小美和林教練同時拿：陳小美先到，林教練退回。
    say(&mut tablet, json!({ "kind": "runThrough", "id": RUN, "date": "2026-11-07", "startedAt": STARTED, "keys": [], "touched": [], "joining": true })).await;
    until(&mut tablet, "runThroughs").await;
    say(
        &mut tablet,
        json!({ "kind": "claim", "run": RUN, "key": "n:4", "from": null }),
    )
    .await;
    until_with(&mut tablet, |m| holders(m).iter().any(|h| h.0 == "n:4")).await;
    say(
        &mut phone,
        json!({ "kind": "claim", "run": RUN, "key": "n:4", "from": null }),
    )
    .await;
    let refused = until(&mut phone, "claimRefused").await;
    assert_eq!(refused["by"], "陳小美");
    assert_eq!(refused["touched"], false);
}

/// 這一組現在拿著的人的 id。
fn holders_ids(runs: &Value, key: &str) -> Value {
    runs["runs"][0]["keys"]
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["key"] == key)
        .unwrap()["userId"]
        .clone()
}

/// 一次全上裡的一格（11/7、這次全上、整個做）。
fn entry(id: &str, who: &str) -> Value {
    json!({ "actionId": LIB, "attempt": {
        "id": id, "date": "2026-11-07", "who": who, "practice": "runThrough",
        "runThroughId": RUN, "runThroughStartedAt": STARTED,
        "whole": true, "marks": { LOAD: "✓", HOLD: "✓", DISMOUNT: "✓" }
    } })
}

#[sqlx::test]
async fn the_same_squad_in_the_same_run_through_keeps_only_the_first_saved(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;

    say(
        &mut coach,
        json!({ "kind": "record", "attempts": [entry("twang11111110", SQUAD_2)] }),
    )
    .await;
    assert_eq!(
        until(&mut coach, "recordsSaved").await["dropped"],
        json!([])
    );

    say(
        &mut phone,
        json!({ "kind": "record", "attempts": [entry("tlin222222220", SQUAD_2)] }),
    )
    .await;
    let reply = until(&mut phone, "recordsSaved").await;
    assert_eq!(reply["saved"], json!([]));
    assert_eq!(
        reply["dropped"],
        json!([{ "id": "tlin222222220", "message": "王教練已經記了這次全上的這一組", "by": "王教練" }])
    );
    let (_, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, &lin.cookie)
        .await;
    assert_eq!(got["records"].as_array().unwrap().len(), 1);
}

#[sqlx::test]
async fn the_same_squad_twice_in_one_batch_keeps_the_first_and_names_the_sender(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let mut coach = s.join(&wang, &id).await;

    say(
        &mut coach,
        json!({ "kind": "record", "attempts": [entry("twang11111110", SQUAD_2), entry("twang22222220", SQUAD_2)] }),
    )
    .await;
    let reply = until(&mut coach, "recordsSaved").await;
    assert_eq!(reply["saved"].as_array().unwrap().len(), 1);
    assert_eq!(reply["saved"][0]["attempt"]["id"], "twang11111110");
    assert_eq!(
        reply["dropped"],
        json!([{ "id": "twang22222220", "message": "王教練已經記了這次全上的這一組", "by": "王教練" }])
    );
}

#[sqlx::test]
async fn a_squad_first_recorded_by_nobody_says_someone_so_the_screen_can_write_it_in_its_language(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;

    say(
        &mut coach,
        json!({ "kind": "record", "attempts": [entry("twang11111110", SQUAD_2)] }),
    )
    .await;
    until(&mut coach, "recordsSaved").await;
    // 從流程檔傳上來的紀錄沒有記的人
    sqlx::query("UPDATE flow_records SET recorded_by = NULL WHERE id = 'twang11111110'")
        .execute(&s.state.db)
        .await
        .unwrap();

    say(
        &mut phone,
        json!({ "kind": "record", "attempts": [entry("tlin222222220", SQUAD_2)] }),
    )
    .await;
    assert_eq!(
        until(&mut phone, "recordsSaved").await["dropped"],
        json!([{ "id": "tlin222222220", "message": "別人已經記了這次全上的這一組", "by": "別人", "someone": true }])
    );
}

#[sqlx::test]
async fn the_database_also_refuses_a_second_live_record_of_the_same_squad_in_a_run_through(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[]).await;
    let insert = |record_id: &'static str| {
        sqlx::query(
            "INSERT INTO flow_records (flow_id, id, action_id, who, marks, whole, date, run_through_id, updated_at)
             VALUES ($1, $2, $3, $4, '{}', true, '2026-11-07', $5, now())",
        )
        .bind(id.clone())
        .bind(record_id)
        .bind(LIB)
        .bind(SQUAD_2)
        .bind(RUN)
    };
    insert("tfirst0000001").execute(&s.state.db).await.unwrap();
    // 鎖之外再擋一道：同一次全上、同一個動作、同一組，沒清掉的只能有一筆
    assert!(insert("tsecond000001").execute(&s.state.db).await.is_err());
    // 清掉的不算
    sqlx::query("UPDATE flow_records SET deleted_at = now() WHERE id = 'tfirst0000001'")
        .execute(&s.state.db)
        .await
        .unwrap();
    insert("tsecond000001").execute(&s.state.db).await.unwrap();
}

#[sqlx::test]
async fn restoring_a_deleted_record_does_not_double_count_a_squad_someone_else_recorded(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;

    // 王教練記了第 2 組又刪掉；林教練接著記了同一組
    say(
        &mut coach,
        json!({ "kind": "record", "attempts": [entry("twang11111110", SQUAD_2)] }),
    )
    .await;
    until(&mut coach, "recordsSaved").await;
    say(
        &mut coach,
        json!({ "kind": "deleteRecords", "ids": ["twang11111110"] }),
    )
    .await;
    until(&mut coach, "recordsSaved").await;
    say(
        &mut phone,
        json!({ "kind": "record", "attempts": [entry("tlin222222220", SQUAD_2)] }),
    )
    .await;
    assert_eq!(
        until(&mut phone, "recordsSaved").await["dropped"],
        json!([])
    );

    // 王教練按救回：那一組已經有林教練的，不救回來
    say(
        &mut coach,
        json!({ "kind": "restoreRecords", "ids": ["twang11111110"] }),
    )
    .await;
    assert_eq!(until(&mut coach, "recordsSaved").await["saved"], json!([]));
    let (_, got) = s
        .send("GET", &format!("/api/flows/{id}"), None, &lin.cookie)
        .await;
    let records = got["records"].as_array().unwrap();
    assert_eq!(records.len(), 1, "{records:?}");
    assert_eq!(records[0]["attempt"]["id"], "tlin222222220");
}

#[sqlx::test]
async fn a_squad_can_be_taken_after_its_holder_is_gone_a_minute_and_nobody_joins_once_all_left(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let mei = s.user("mei@example.com", "陳小美").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s
        .sample(&wang, &[(&lin, "recorder"), (&mei, "recorder")])
        .await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;

    say(&mut coach, report("2026-11-07", &["n:1"], &["n:1"], false)).await;
    let opened = until(&mut phone, "runThroughs").await;
    let wang_id = holders_ids(&opened, "n:1");
    say(&mut phone, report("2026-11-07", &[], &[], true)).await;
    until(&mut phone, "runThroughs").await;

    // 王教練斷線：寫斷線了，可是還不到 1 分鐘，點過的拿不走。
    drop(coach);
    let away = until_with(&mut phone, |m| holders(m).first().is_some_and(|h| h.3)).await;
    assert_eq!(holders(&away), vec![hold("n:1", "王教練", true, true)]);
    let claim = json!({ "kind": "claim", "run": RUN, "key": "n:1", "from": wang_id });
    s.wait(50);
    say(&mut phone, claim.clone()).await;
    assert_eq!(until(&mut phone, "claimRefused").await["touched"], true);

    // 超過 1 分鐘：當他離開，點過的也能接手。
    s.wait(11);
    say(&mut phone, claim).await;
    let taken = until_with(&mut phone, |m| {
        holders(m).first().is_some_and(|h| h.1 == "林教練")
    })
    .await;
    assert_eq!(holders(&taken), vec![hold("n:1", "林教練", false, false)]);
    assert_eq!(people(&taken), vec!["林教練"]);

    // 林教練存好、離開：表裡的人都離開了，陳小美加入不了。
    say(&mut phone, json!({ "kind": "leaveRun", "run": RUN })).await;
    until_with(&mut phone, |m| m["runs"] == json!([])).await;
    let mut tablet = s.join(&mei, &id).await;
    say(&mut tablet, report("2026-11-07", &["n:2"], &[], true)).await;
    assert_eq!(
        until(&mut tablet, "runClosed").await,
        json!({ "kind": "runClosed", "run": RUN })
    );
}

#[sqlx::test]
async fn coming_back_within_a_minute_keeps_the_squads_and_reports_refill_a_restarted_server(
    db: sqlx::PgPool,
) {
    let s = Server::new(db.clone()).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let mei = s.user("mei@example.com", "陳小美").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s
        .sample(&wang, &[(&lin, "recorder"), (&mei, "recorder")])
        .await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;
    say(&mut coach, report("2026-11-07", &["n:1"], &["n:1"], false)).await;
    until(&mut coach, "runThroughs").await;
    say(&mut phone, report("2026-11-07", &["n:2"], &[], true)).await;
    until(&mut phone, "runThroughs").await;

    // 王教練斷線 30 秒又連回來，再報一次：第 1 組還是他的。
    drop(coach);
    s.wait(30);
    let mut coach = s.join(&wang, &id).await;
    say(&mut coach, report("2026-11-07", &["n:1"], &["n:1"], false)).await;
    let back = until_with(&mut coach, |m| holders(m).first().is_some_and(|h| !h.3)).await;
    assert_eq!(holders(&back)[0], hold("n:1", "王教練", true, false));

    // 伺服器重開（記憶體清空）：手機連上自己再報一次，加入的人看到的跟之前一樣。
    let s2 = Server::new(db).await;
    let mut coach = s2.join(&wang, &id).await;
    let mut phone = s2.join(&lin, &id).await;
    say(&mut coach, report("2026-11-07", &["n:1"], &["n:1"], false)).await;
    until(&mut coach, "runThroughs").await;
    say(&mut phone, report("2026-11-07", &["n:2"], &[], false)).await;
    until(&mut phone, "runThroughs").await;
    let mut tablet = s2.join(&mei, &id).await;
    let seen = until(&mut tablet, "runThroughs").await;
    assert_eq!(people(&seen), vec!["王教練", "林教練"]);
    assert_eq!(
        holders(&seen),
        vec![
            hold("n:1", "王教練", true, false),
            hold("n:2", "林教練", false, false)
        ]
    );
}

#[sqlx::test]
async fn a_revoked_recorder_is_kicked_out_and_his_squads_are_freed(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;
    say(&mut coach, report("2026-11-07", &["n:1"], &[], false)).await;
    until(&mut coach, "runThroughs").await;
    say(&mut phone, report("2026-11-07", &["n:2"], &["n:2"], true)).await;
    until_with(&mut coach, |m| people(m).len() == 2).await;

    let (lin_id,): (i64,) = sqlx::query_as("SELECT id FROM users WHERE email = $1")
        .bind(lin.email)
        .fetch_one(&s.state.db)
        .await
        .unwrap();
    let path = format!("/api/flows/{id}/people/{lin_id}/remove");
    assert_eq!(
        s.send("POST", &path, None, &wang.cookie).await.0,
        StatusCode::OK
    );
    let after = until_with(&mut coach, |m| people(m).len() == 1).await;
    assert_eq!(people(&after), vec!["王教練"]);
    assert_eq!(holders(&after), vec![hold("n:1", "王教練", false, false)]);
}

#[sqlx::test]
async fn two_people_grabbing_the_same_free_squads_at_once_each_squad_goes_to_one_and_the_other_is_refused(
    db: sqlx::PgPool,
) {
    let s = Server::new(db).await;
    let lin = s.user("lin@example.com", "林教練").await;
    let wang = s.user("wang@example.com", "王教練").await;
    let id = s.sample(&wang, &[(&lin, "recorder")]).await;
    let mut coach = s.join(&wang, &id).await;
    let mut phone = s.join(&lin, &id).await;
    say(&mut coach, report("2026-11-07", &[], &[], false)).await;
    until(&mut phone, "runThroughs").await;
    say(&mut phone, report("2026-11-07", &[], &[], true)).await;
    until_with(&mut coach, |m| people(m).len() == 2).await;

    // 兩個人一起搶 20 組沒人拿著的（不等回答）：每組只給一個人，另一個人一定退回。
    let keys: Vec<String> = (10..30).map(|n| format!("n:{n}")).collect();
    for key in &keys {
        let claim = json!({ "kind": "claim", "run": RUN, "key": key, "from": null });
        say(&mut coach, claim.clone()).await;
        say(&mut phone, claim).await;
    }
    // 兩邊收到的都讀完（一陣子沒有新的），記下退回和最後的表。
    let mut refused = vec![];
    let mut table = Value::Null;
    for socket in [&mut coach, &mut phone] {
        while let Ok(Some(Ok(Message::Text(text)))) =
            tokio::time::timeout(Duration::from_millis(1000), socket.next()).await
        {
            let m: Value = serde_json::from_str(&text).unwrap();
            if m["kind"] == "claimRefused" {
                refused.push((
                    m["key"].as_str().unwrap().to_owned(),
                    m["by"].as_str().unwrap().to_owned(),
                ));
            } else if m["kind"] == "runThroughs" {
                table = m;
            }
        }
    }
    let held: std::collections::HashMap<String, String> =
        holders(&table).into_iter().map(|h| (h.0, h.1)).collect();
    assert_eq!(held.len(), keys.len());
    refused.sort();
    let mut want: Vec<_> = held.into_iter().collect();
    want.sort();
    assert_eq!(refused, want, "每組退回一個人，退回時說的是拿到的人");
}

async fn say(socket: &mut Socket, message: Value) {
    socket
        .send(Message::Text(message.to_string().into()))
        .await
        .unwrap();
}

/// 伺服器說的下一句裡、這一種的（別的跳過）；房間關了是 Null。
async fn until(socket: &mut Socket, kind: &str) -> Value {
    let next = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let message: Value = serde_json::from_str(&text).unwrap();
                    if message["kind"] == kind {
                        return message;
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return Value::Null,
                _ => {}
            }
        }
    });
    next.await
        .unwrap_or_else(|_| panic!("伺服器一直沒說 {kind}"))
}

/// 伺服器說的下一個 runThroughs 裡、合 ok 的（別的跳過）。
async fn until_with(socket: &mut Socket, ok: impl Fn(&Value) -> bool) -> Value {
    loop {
        let m = until(socket, "runThroughs").await;
        if ok(&m) {
            return m;
        }
    }
}

/// 一陣子沒收到一起記全上的事（誰開著、別人的改動不算）。
async fn quiet(socket: &mut Socket) -> bool {
    tokio::time::timeout(Duration::from_millis(300), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let message: Value = serde_json::from_str(&text).unwrap();
                    if message["kind"] != "present" && message["kind"] != "changed" {
                        return;
                    }
                }
                None => std::future::pending::<()>().await,
                _ => {}
            }
        }
    })
    .await
    .is_err()
}
