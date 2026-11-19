// 請求的 log 不記分享連結的 token。自己一個測試檔：tracing 的 callsite 記一次「要不要記」，
// 同一個檔裡別的測試（沒有 subscriber）在別的執行緒同時先打到同一個 span，可能在這裡的 subscriber
// 掛上的同時記成「不用記」，log 就少了請求那一行（放在 http.rs 時偶爾失敗）。這個檔每個測試都先掛 subscriber 再送請求。

use axum::body::Body;
use axum::http::Request;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

/// 接著連不到的資料庫：這裡只看 log。
fn unreachable_pool() -> cheer_server::AppState {
    let db = PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(200))
        .connect_lazy("postgres://nobody@127.0.0.1:1/nothing")
        .unwrap();
    cheer_server::AppState {
        db,
        mailer: cheer_server::mail::Mailer::memory(),
        breach: cheer_server::breach::BreachCheck::list([]),
        clock: cheer_server::clock::Clock::system(),
        site_url: "https://cheer.example".into(),
        core: cheer_server::flow_core::FlowCore::start().unwrap(),
        mail_limit: Default::default(),
        rooms: Default::default(),
        music: None,
    }
}

/// 送一個 GET，回這段時間寫的 log。
async fn log_of(path: &str) -> String {
    let log = Captured::default();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(log.clone())
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::NEW)
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);
    let site = tempfile::tempdir().unwrap();
    cheer_server::app(unreachable_pool(), site.path())
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    String::from_utf8(log.0.lock().unwrap().clone()).unwrap()
}

/// log 寫到這裡，測試看寫了什麼。
#[derive(Clone, Default)]
struct Captured(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for Captured {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Captured {
    type Writer = Captured;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

#[tokio::test]
async fn share_link_token_stays_out_of_the_log() {
    let log = log_of("/api/links/SECRET-TOKEN").await;
    assert!(log.contains("/api/links/{token}"), "{log}");
    assert!(!log.contains("SECRET-TOKEN"), "{log}");
}

#[tokio::test]
async fn share_link_token_with_a_trailing_slash_stays_out_of_the_log() {
    let log = log_of("/api/links/SECRET-TOKEN/").await;
    assert!(log.contains("request"), "{log}");
    assert!(!log.contains("SECRET-TOKEN"), "{log}");
}
