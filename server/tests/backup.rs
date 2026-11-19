// 每天的備份（#265）：台灣時間凌晨 4 點跑 pg_dump，放上 R2 的備份 bucket，做完去 Better Stack 報到。
// pg_dump 換成假的（一支 sh 腳本：印出拿到的參數，或直接失敗）；R2、報到網址是本機的假 HTTP 伺服器。
// 要有 PostgreSQL：見 tests/db.rs 開頭。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, TimeZone, Utc};

use cheer_server::backup::{self, Backup};
use cheer_server::music::MusicStore;

const BUCKET: &str = "cheer-backup-test";
const DATABASE_URL: &str = "postgres://backup-test@db.example/cheer";

fn nov(day: u32, hour: u32, min: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, day, hour, min, 0).unwrap()
}

#[test]
fn runs_every_day_at_4am_taiwan_time() {
    // 台灣 4 點是 UTC 前一天 20 點。
    assert_eq!(backup::next_run(nov(7, 19, 59)), nov(7, 20, 0));
    assert_eq!(backup::next_run(nov(7, 20, 0)), nov(8, 20, 0));
    assert_eq!(backup::next_run(nov(7, 20, 1)), nov(8, 20, 0));
}

/// 假的 R2 裡的檔：key → 內容。
type Objects = Arc<Mutex<HashMap<String, Bytes>>>;

/// 假的 R2：照 S3 的路徑收 PUT（不驗簽名）。真的 R2 要 Content-Length，沒帶就回 411。
/// `broken` 是 true 時每個 PUT 都回 500。
async fn fake_r2(broken: bool) -> (reqwest::Url, Objects) {
    let objects = Objects::default();
    async fn object(
        State((objects, broken)): State<(Objects, bool)>,
        Path((_bucket, key)): Path<(String, String)>,
        method: Method,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        if method != Method::PUT {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        }
        if broken {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        if !headers.contains_key(header::CONTENT_LENGTH) {
            return StatusCode::LENGTH_REQUIRED.into_response();
        }
        objects.lock().unwrap().insert(key, body);
        StatusCode::OK.into_response()
    }
    let fake = axum::Router::new()
        .route("/{bucket}/{*key}", axum::routing::any(object))
        .with_state((objects.clone(), broken));
    (serve(fake).await, objects)
}

/// 假的 Better Stack 報到網址：記被打了幾次。
async fn fake_heartbeat() -> (reqwest::Url, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let fake = axum::Router::new().route(
        "/api/v1/heartbeat/test-token",
        axum::routing::any(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            async { "ok" }
        }),
    );
    let url = serve(fake)
        .await
        .join("api/v1/heartbeat/test-token")
        .unwrap();
    (url, hits)
}

async fn serve(router: axum::Router) -> reqwest::Url {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{addr}").parse().unwrap()
}

/// 假的 pg_dump：寫一支 sh 腳本，回它的路徑（和放它的暫存資料夾，用完才刪）。
fn fake_pg_dump(script: &str) -> (PathBuf, tempfile::TempDir) {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pg_dump");
    std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    (path, dir)
}

/// 照 `--file=` 寫出檔案，內容是拿到的參數（一行一個）。
const DUMP_OK: &str = r#"for a in "$@"; do case "$a" in --file=*) out="${a#--file=}";; esac; done
printf '%s\n' "$@" > "$out""#;

const DUMP_FAILS: &str = "echo 'pg_dump: error: connection failed' >&2; exit 1";

struct Trial {
    r2: Objects,
    hits: Arc<AtomicUsize>,
    result: anyhow::Result<()>,
}

/// 台灣時間 11 月 20 日凌晨 4 點跑一次備份。
async fn back_up(db: &sqlx::PgPool, script: &str, r2_broken: bool, heartbeat: bool) -> Trial {
    let (endpoint, r2) = fake_r2(r2_broken).await;
    let (url, hits) = fake_heartbeat().await;
    let (pg_dump, _dir) = fake_pg_dump(script);
    let store = MusicStore::new(endpoint, BUCKET, "test-key", "test-secret").unwrap();
    let backup = Backup::new(store, DATABASE_URL.into(), heartbeat.then_some(url)).pg_dump(pg_dump);
    let result = backup.run(db, nov(19, 20, 0)).await;
    Trial { r2, hits, result }
}

async fn backups(db: &sqlx::PgPool) -> Vec<(DateTime<Utc>, i64)> {
    sqlx::query_as("SELECT taken_at, size FROM backups")
        .fetch_all(db)
        .await
        .unwrap()
}

#[sqlx::test]
async fn a_backup_is_uploaded_then_checks_in(db: sqlx::PgPool) {
    let trial = back_up(&db, DUMP_OK, false, true).await;

    trial.result.unwrap();
    let objects = trial.r2.lock().unwrap().clone();
    let names: Vec<&String> = objects.keys().collect();
    assert_eq!(names, ["cheer-2026-11-20-0400.dump"]);
    let dump = String::from_utf8(objects["cheer-2026-11-20-0400.dump"].to_vec()).unwrap();
    assert!(dump.contains("--format=custom"), "{dump}");
    assert!(dump.contains(DATABASE_URL), "{dump}");
    assert_eq!(trial.hits.load(Ordering::SeqCst), 1);
    // 每天的工作算 R2 用量時算進去（#266）。
    assert_eq!(backups(&db).await, [(nov(19, 20, 0), dump.len() as i64)]);
}

#[sqlx::test]
async fn pg_dump_fails_so_nothing_is_uploaded_and_it_does_not_check_in(db: sqlx::PgPool) {
    let trial = back_up(&db, DUMP_FAILS, false, true).await;

    let err = trial.result.unwrap_err().to_string();
    assert!(err.contains("connection failed"), "{err}");
    assert!(trial.r2.lock().unwrap().is_empty());
    assert_eq!(trial.hits.load(Ordering::SeqCst), 0);
    assert_eq!(backups(&db).await, []);
}

#[sqlx::test]
async fn r2_refuses_the_upload_so_it_does_not_check_in(db: sqlx::PgPool) {
    let trial = back_up(&db, DUMP_OK, true, true).await;

    assert!(trial.result.is_err());
    assert_eq!(trial.hits.load(Ordering::SeqCst), 0);
    assert_eq!(backups(&db).await, []);
}

#[sqlx::test]
async fn without_a_heartbeat_url_it_still_backs_up(db: sqlx::PgPool) {
    let trial = back_up(&db, DUMP_OK, false, false).await;

    trial.result.unwrap();
    assert_eq!(trial.r2.lock().unwrap().len(), 1);
    assert_eq!(trial.hits.load(Ordering::SeqCst), 0);
}
