// 每天的工作（#266）：清不用了 30 天的音樂、清 30 天前的步驟紀錄、算用量到 8 成寄信給網站主人。
// 時鐘手撥；R2 換成假的（本機的 HTTP 伺服器，照 S3 的路徑收 HEAD、DELETE，不驗簽名）；信記在記憶體。
// 要有 PostgreSQL：見 tests/db.rs 開頭。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::{Path, State};
use axum::http::{Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Duration, TimeZone, Utc};

use cheer_server::AppState;
use cheer_server::accounts::create_admin;
use cheer_server::breach::BreachCheck;
use cheer_server::clock::Clock;
use cheer_server::daily::{self, AwakeMeter};
use cheer_server::flow_core::FlowCore;
use cheer_server::mail::Mailer;
use cheer_server::r2::R2Bucket;

const BUCKET: &str = "cheer-music-test";
const ADMIN: &str = "owner@example.com";

/// 假的 R2 裡的檔：key → 大小。
type Objects = Arc<Mutex<HashMap<String, usize>>>;

async fn fake_r2() -> (reqwest::Url, Objects) {
    let objects = Objects::default();
    async fn object(
        State(objects): State<Objects>,
        Path((_bucket, key)): Path<(String, String)>,
        method: Method,
    ) -> Response {
        let mut all = objects.lock().unwrap();
        match method {
            Method::DELETE => {
                all.remove(&key);
                StatusCode::NO_CONTENT.into_response()
            }
            Method::HEAD => match all.get(&key) {
                Some(size) => ([(header::CONTENT_LENGTH, *size)], ()).into_response(),
                None => StatusCode::NOT_FOUND.into_response(),
            },
            _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
        }
    }
    let fake = axum::Router::new()
        .route("/{bucket}/{*key}", axum::routing::any(object))
        .with_state(objects.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
    (format!("http://{addr}").parse().unwrap(), objects)
}

fn nov(day: u32, hour: u32, min: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, day, hour, min, 0).unwrap()
}

struct Site {
    state: AppState,
    r2: Objects,
    now: DateTime<Utc>,
}

impl Site {
    /// 網站主人（管理員）有帳號；建好後把寄過的信清掉（設密碼信不算）。
    async fn new(db: sqlx::PgPool) -> Self {
        let now = nov(7, 21, 0);
        let (endpoint, r2) = fake_r2().await;
        let state = AppState {
            db,
            mailer: Mailer::memory(),
            breach: BreachCheck::list(Vec::<&str>::new()),
            clock: Clock::new(move || now),
            site_url: "https://cheer.example".into(),
            core: FlowCore::start().unwrap(),
            mail_limit: Default::default(),
            rooms: Default::default(),
            music: Some(R2Bucket::new(endpoint, BUCKET, "test-key", "test-secret").unwrap()),
        };
        create_admin(&state, ADMIN, Some("網站主人")).await.unwrap();
        if let Mailer::Memory(sent) = &state.mailer {
            sent.lock().unwrap().clear();
        }
        Self { state, r2, now }
    }

    /// R2 上放一個音樂檔，記下它多大、哪天開始不用（None：還在用）。
    async fn music(&self, key: &str, size: i64, unused_since: Option<DateTime<Utc>>) {
        self.r2.lock().unwrap().insert(key.into(), size as usize);
        sqlx::query(
            "INSERT INTO flow_audio (flow_id, audio_id, object_key, size, created_at, unused_since)
             VALUES ('f1', $1, $1, $2, $3, $4)",
        )
        .bind(key)
        .bind(size)
        .bind(self.now - Duration::days(60))
        .bind(unused_since)
        .execute(&self.state.db)
        .await
        .unwrap();
    }

    async fn run(&self) {
        daily::run(&self.state, &AwakeMeter::default())
            .await
            .unwrap();
    }
}

#[sqlx::test]
async fn music_unused_for_more_than_30_days_is_deleted_from_r2(db: sqlx::PgPool) {
    let site = Site::new(db).await;
    site.music("flows/f1/old.mp3", 10, Some(site.now - Duration::days(31)))
        .await;
    site.music(
        "flows/f1/recent.mp3",
        10,
        Some(site.now - Duration::days(29)),
    )
    .await;
    site.music("flows/f1/used.mp3", 10, None).await;

    site.run().await;

    let mut left: Vec<String> = site.r2.lock().unwrap().keys().cloned().collect();
    left.sort();
    assert_eq!(left, ["flows/f1/recent.mp3", "flows/f1/used.mp3"]);
    let rows: Vec<(String,)> = sqlx::query_as("SELECT audio_id FROM flow_audio ORDER BY audio_id")
        .fetch_all(&site.state.db)
        .await
        .unwrap();
    assert_eq!(
        rows,
        [
            ("flows/f1/recent.mp3".to_owned(),),
            ("flows/f1/used.mp3".to_owned(),)
        ]
    );
}

#[sqlx::test]
async fn step_log_older_than_30_days_is_deleted(db: sqlx::PgPool) {
    let site = Site::new(db).await;
    let db = &site.state.db;
    sqlx::query(
        "INSERT INTO flows (id, owner_id, content, step, updated_at)
         SELECT 'f1', id, '{}'::json, 3, $1 FROM users",
    )
    .bind(site.now)
    .execute(db)
    .await
    .unwrap();
    for (step, days) in [(1, 31), (2, 30), (3, 29)] {
        sqlx::query(
            "INSERT INTO flow_steps (flow_id, step, step_id, tab_id, user_id, created_at)
             SELECT 'f1', $1, 's' || $1, 't1', id, $2 FROM users",
        )
        .bind(step as i64)
        .bind(site.now - Duration::days(days))
        .execute(db)
        .await
        .unwrap();
    }

    site.run().await;

    let left: Vec<(i64,)> = sqlx::query_as("SELECT step FROM flow_steps ORDER BY step")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(left, [(3,)]);
}

/// R2 免費 10 GB（照小的算：10 × 10⁹ 位元組）。音樂 + 備份。
const R2_LIMIT: i64 = 10_000_000_000;

#[sqlx::test]
async fn usage_at_79_percent_sends_nothing(db: sqlx::PgPool) {
    let site = Site::new(db).await;
    site.music("flows/f1/a.mp3", R2_LIMIT * 79 / 100, None)
        .await;

    site.run().await;

    assert_eq!(site.state.mailer.sent(), []);
}

#[sqlx::test]
async fn usage_at_80_percent_mails_the_site_owner(db: sqlx::PgPool) {
    let site = Site::new(db).await;
    // 等著刪的音樂和備份也算。
    site.music("flows/f1/a.mp3", R2_LIMIT * 50 / 100, None)
        .await;
    site.music(
        "flows/f1/b.mp3",
        R2_LIMIT * 20 / 100,
        Some(site.now - Duration::days(3)),
    )
    .await;
    sqlx::query("INSERT INTO backups (taken_at, size) VALUES ($1, $2)")
        .bind(site.now - Duration::days(1))
        .bind(R2_LIMIT * 10 / 100)
        .execute(&site.state.db)
        .await
        .unwrap();

    site.run().await;

    let sent = site.state.mailer.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].to, ADMIN);
    assert!(sent[0].text.contains("R2"), "{}", sent[0].text);
    assert!(sent[0].text.contains("80%"), "{}", sent[0].text);
}

#[test]
fn queries_within_5_minutes_of_each_other_count_as_one_awake_stretch() {
    let meter = AwakeMeter::default();
    // 9:00、9:03、9:07 連著（每次都在上一次的 5 分鐘內）：一段，醒到 9:12。
    assert_eq!(meter.touch(nov(7, 9, 0)), None);
    assert_eq!(meter.touch(nov(7, 9, 3)), None);
    assert_eq!(meter.touch(nov(7, 9, 7)), None);
    // 9:30 才又查：前一段結束（9:00 到 9:12，12 分鐘），新的一段開始。
    let done = meter.touch(nov(7, 9, 30)).unwrap();
    assert_eq!(done.start, nov(7, 9, 0));
    assert_eq!(done.seconds, 12 * 60);
}

#[sqlx::test]
async fn awake_time_this_month_adds_saved_stretches_and_the_open_one(db: sqlx::PgPool) {
    let meter = AwakeMeter::default();
    meter.touch(nov(7, 9, 0));
    let done = meter.touch(nov(7, 10, 0)).unwrap();
    let mut conn = db.acquire().await.unwrap();
    daily::save_awake(&mut conn, &done).await.unwrap();
    // 上個月的不算。
    let october = meter_stretch(Utc.with_ymd_and_hms(2026, 10, 30, 9, 0, 0).unwrap());
    daily::save_awake(&mut conn, &october).await.unwrap();

    let seconds = daily::awake_this_month(&mut conn, &meter, nov(7, 10, 2))
        .await
        .unwrap();

    // 存起來的 5 分鐘 + 10:00 開始、還醒著的這一段（到 10:05）。
    assert_eq!(seconds, 10 * 60);
}

fn meter_stretch(start: DateTime<Utc>) -> daily::Awake {
    let meter = AwakeMeter::default();
    meter.touch(start);
    meter.touch(start + Duration::hours(1)).unwrap()
}

#[test]
fn runs_every_day_at_5am_taiwan_time() {
    // 台灣 5 點是 UTC 前一天 21 點。
    assert_eq!(daily::next_run(nov(7, 20, 0)), nov(7, 21, 0));
    assert_eq!(daily::next_run(nov(7, 21, 0)), nov(8, 21, 0));
    assert_eq!(daily::next_run(nov(7, 22, 0)), nov(8, 21, 0));
}

// ---------- 過期的登入、設密碼連結、猜錯密碼的紀錄、「被擁有者刪掉了」的紀錄（#371） ----------
// 隱私權政策寫每種資料留多久，所以這四種也要清。

/// 加一個使用者，回他的 id。
async fn user(db: &sqlx::PgPool, email: &str) -> i64 {
    let (id,): (i64,) =
        sqlx::query_as("INSERT INTO users (email, name) VALUES ($1, 'x') RETURNING id")
            .bind(email)
            .fetch_one(db)
            .await
            .unwrap();
    id
}

#[sqlx::test]
async fn expired_sessions_are_deleted(db: sqlx::PgPool) {
    let site = Site::new(db).await;
    let db = &site.state.db;
    let id = user(db, "a@example.com").await;
    for (token, expires) in [
        (b"old".as_slice(), site.now),
        (b"new".as_slice(), site.now + Duration::seconds(1)),
    ] {
        sqlx::query(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(token)
        .bind(id)
        .bind(expires - Duration::days(30))
        .bind(expires)
        .execute(db)
        .await
        .unwrap();
    }

    site.run().await;

    let left: Vec<(Vec<u8>,)> =
        sqlx::query_as("SELECT token_hash FROM sessions WHERE user_id = $1")
            .bind(id)
            .fetch_all(db)
            .await
            .unwrap();
    assert_eq!(left, [(b"new".to_vec(),)]);
}

#[sqlx::test]
async fn expired_password_links_are_deleted(db: sqlx::PgPool) {
    let site = Site::new(db).await;
    let db = &site.state.db;
    let id = user(db, "a@example.com").await;
    for (token, purpose, expires) in [
        (b"old".as_slice(), "invite", site.now),
        (b"new".as_slice(), "reset", site.now + Duration::seconds(1)),
    ] {
        sqlx::query(
            "INSERT INTO password_links (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(token)
        .bind(id)
        .bind(purpose)
        .bind(expires)
        .execute(db)
        .await
        .unwrap();
    }

    site.run().await;

    let left: Vec<(Vec<u8>,)> =
        sqlx::query_as("SELECT token_hash FROM password_links WHERE user_id = $1")
            .bind(id)
            .fetch_all(db)
            .await
            .unwrap();
    assert_eq!(left, [(b"new".to_vec(),)]);
}

#[sqlx::test]
async fn login_failures_30_days_old_are_deleted_unless_the_password_is_stopped(db: sqlx::PgPool) {
    let site = Site::new(db).await;
    let db = &site.state.db;
    user(db, "Stopped@Example.com").await;
    user(db, "old@example.com").await;
    let max = cheer_server::lockout::MAX_FAILURES;
    for (email, failures, days) in [
        // 30 天沒再猜錯：清。
        ("old@example.com", 7, 30),
        // 30 天內還猜錯過：留著，還在鎖的人不會提早解開。
        ("recent@example.com", 12, 29),
        // 猜到上限、密碼停掉了，有帳號：留到重設。
        ("stopped@example.com", max, 300),
        // 猜到上限但沒有這個帳號：永遠等不到重設，照 30 天清。
        ("nobody@example.com", max, 30),
    ] {
        sqlx::query(
            "INSERT INTO login_failures (email, failures, last_failed_at) VALUES ($1, $2, $3)",
        )
        .bind(email)
        .bind(failures)
        .bind(site.now - Duration::days(days))
        .execute(db)
        .await
        .unwrap();
    }

    site.run().await;

    let left: Vec<(String,)> = sqlx::query_as("SELECT email FROM login_failures ORDER BY email")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(
        left,
        [
            ("recent@example.com".to_owned(),),
            ("stopped@example.com".to_owned(),)
        ]
    );
}

#[sqlx::test]
async fn deleted_flow_notes_are_deleted_after_30_days(db: sqlx::PgPool) {
    let site = Site::new(db).await;
    let db = &site.state.db;
    let id = user(db, "a@example.com").await;
    for (flow, days) in [("f-old", 30), ("f-new", 29)] {
        sqlx::query("INSERT INTO deleted_flows (flow_id, user_id, deleted_at) VALUES ($1, $2, $3)")
            .bind(flow)
            .bind(id)
            .bind(site.now - Duration::days(days))
            .execute(db)
            .await
            .unwrap();
    }

    site.run().await;

    let left: Vec<(String,)> = sqlx::query_as("SELECT flow_id FROM deleted_flows")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(left, [("f-new".to_owned(),)]);
}
