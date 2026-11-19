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
use cheer_server::r2::R2Bucket;

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

/// 這次備份的情況。預設：pg_dump 成功、R2 收得下、有報到網址。
struct Setup {
    /// 假 pg_dump 的腳本（`DUMP_OK`、`DUMP_FAILS`）。
    pg_dump: &'static str,
    /// R2 每個 PUT 都回 500。
    r2_broken: bool,
    /// 設了 BACKUP_HEARTBEAT_URL。
    heartbeat: bool,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            pg_dump: DUMP_OK,
            r2_broken: false,
            heartbeat: true,
        }
    }
}

/// 台灣時間 11 月 20 日凌晨 4 點跑一次備份。
async fn back_up(db: &sqlx::PgPool, setup: Setup) -> Trial {
    let Setup {
        pg_dump: script,
        r2_broken,
        heartbeat,
    } = setup;
    let (endpoint, r2) = fake_r2(r2_broken).await;
    let (url, hits) = fake_heartbeat().await;
    let (pg_dump, _dir) = fake_pg_dump(script);
    let store = R2Bucket::new(endpoint, BUCKET, "test-key", "test-secret").unwrap();
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
    let trial = back_up(&db, Setup::default()).await;

    trial.result.unwrap();
    let objects = trial.r2.lock().unwrap().clone();
    let names: Vec<&String> = objects.keys().collect();
    assert_eq!(names.len(), 1);
    // cheer-<台灣日期>-<時分>-<6 個 16 進位的亂數>.dump
    let name = names[0];
    let suffix = name
        .strip_prefix("cheer-2026-11-20-0400-")
        .and_then(|s| s.strip_suffix(".dump"))
        .unwrap_or_else(|| panic!("{name}"));
    assert!(
        suffix.len() == 6 && suffix.chars().all(|c| c.is_ascii_hexdigit()),
        "{name}"
    );
    let dump = String::from_utf8(objects[name].to_vec()).unwrap();
    assert!(dump.contains("--format=custom"), "{dump}");
    assert!(dump.contains(DATABASE_URL), "{dump}");
    assert_eq!(trial.hits.load(Ordering::SeqCst), 1);
    // 每天的工作算 R2 用量時算進去（#266）。
    assert_eq!(backups(&db).await, [(nov(19, 20, 0), dump.len() as i64)]);
}

#[sqlx::test]
async fn pg_dump_fails_so_nothing_is_uploaded_and_it_does_not_check_in(db: sqlx::PgPool) {
    let trial = back_up(
        &db,
        Setup {
            pg_dump: DUMP_FAILS,
            ..Setup::default()
        },
    )
    .await;

    let err = trial.result.unwrap_err().to_string();
    assert!(err.contains("connection failed"), "{err}");
    assert!(trial.r2.lock().unwrap().is_empty());
    assert_eq!(trial.hits.load(Ordering::SeqCst), 0);
    assert_eq!(backups(&db).await, []);
}

#[sqlx::test]
async fn r2_refuses_the_upload_so_it_does_not_check_in(db: sqlx::PgPool) {
    let trial = back_up(
        &db,
        Setup {
            r2_broken: true,
            ..Setup::default()
        },
    )
    .await;

    assert!(trial.result.is_err());
    assert_eq!(trial.hits.load(Ordering::SeqCst), 0);
    assert_eq!(backups(&db).await, []);
}

#[sqlx::test]
async fn without_a_heartbeat_url_it_still_backs_up(db: sqlx::PgPool) {
    let trial = back_up(
        &db,
        Setup {
            heartbeat: false,
            ..Setup::default()
        },
    )
    .await;

    trial.result.unwrap();
    assert_eq!(trial.r2.lock().unwrap().len(), 1);
    assert_eq!(trial.hits.load(Ordering::SeqCst), 0);
}

#[sqlx::test]
async fn two_backups_in_the_same_minute_do_not_share_a_file(db: sqlx::PgPool) {
    // 手動的 `cheer-server backup` 剛好碰上凌晨 4 點那次：pg_dump 寫完停一下，兩個一起跑。
    const DUMP_SLOW: &str = r#"for a in "$@"; do case "$a" in --file=*) out="${a#--file=}";; esac; done
printf '%s\n' "$@" > "$out"; sleep 0.3"#;
    let (endpoint, r2) = fake_r2(false).await;
    let (pg_dump, _dir) = fake_pg_dump(DUMP_SLOW);
    let store = R2Bucket::new(endpoint, BUCKET, "test-key", "test-secret").unwrap();
    let backup = Backup::new(store, DATABASE_URL.into(), None).pg_dump(pg_dump);
    let later = nov(19, 20, 0) + chrono::Duration::seconds(30);

    let (a, b) = tokio::join!(backup.run(&db, nov(19, 20, 0)), backup.run(&db, later));

    a.unwrap();
    b.unwrap();
    let objects = r2.lock().unwrap().clone();
    assert_eq!(objects.len(), 2, "{:?}", objects.keys());
    for key in objects.keys() {
        assert!(key.starts_with("cheer-2026-11-20-0400-"), "{key}");
        assert!(key.ends_with(".dump"), "{key}");
    }
    assert_eq!(backups(&db).await.len(), 2);
}
