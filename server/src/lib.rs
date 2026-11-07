pub mod config;

use std::path::Path;

use axum::Router;
use axum::http::Request;
use axum::routing::get;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

/// 前端建置時另外產生的入口頁（`vite.config.ts` 裡 adapter 的 `fallback`）。
const SPA_ENTRY: &str = "200.html";

/// `migrations/` 底下的遷移，編譯時包進程式；伺服器啟動時跑。
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

/// 每個請求拿得到的共用東西。
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
}

/// 整個網站：API 和前端建好的檔案（`site`）在同一個網址（ADR 0009）。
pub fn app(db: sqlx::PgPool, site: &Path) -> Router {
    Router::new()
        // 健康檢查不碰資料庫：Neon 免費版沒人用時才睡得著。
        .route("/health", get(|| async { "ok" }))
        // 建置把每頁存成 <名字>.html（例：/guide → guide.html），重新整理才打得開。
        // 找不到的路徑回前端的入口頁，讓前端自己處理路由。
        .fallback_service(
            ServeDir::new(site)
                .html_as_default_extension(true)
                .fallback(ServeFile::new(site.join(SPA_ENTRY))),
        )
        .layer(TraceLayer::new_for_http().make_span_with(request_span))
        .with_state(AppState { db })
}

/// 每個請求的 log 只記方法和路徑：不記查詢字串、標頭（cookie、token 會在裡面）、內容。
fn request_span<B>(req: &Request<B>) -> tracing::Span {
    tracing::info_span!("request", method = %req.method(), path = %req.uri().path())
}
