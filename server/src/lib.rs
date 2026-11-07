pub mod accounts;
pub mod admin;
pub mod breach;
pub mod clock;
pub mod config;
pub mod csrf;
pub mod flow_core;
pub mod mail;

use std::path::Path;

use axum::Router;
use axum::http::Request;
use axum::routing::{get, post};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::breach::BreachCheck;
use crate::clock::Clock;
use crate::mail::Mailer;

/// 前端建置時另外產生的入口頁（`vite.config.ts` 裡 adapter 的 `fallback`）。
const SPA_ENTRY: &str = "200.html";

/// `migrations/` 底下的遷移，編譯時包進程式；伺服器啟動時跑。
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

/// 每個請求拿得到的共用東西。寄信、外洩密碼、時鐘在測試換成假的。
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub mailer: Mailer,
    pub breach: BreachCheck,
    pub clock: Clock,
    /// 這個網站的網址（信裡的連結用），例：`https://cheer.example`，最後沒有 `/`。
    pub site_url: String,
}

/// 整個網站：API 和前端建好的檔案（`site`）在同一個網址（ADR 0009）。
pub fn app(state: AppState, site: &Path) -> Router {
    Router::new()
        // 健康檢查不碰資料庫：Neon 免費版沒人用時才睡得著。
        .route("/health", get(|| async { "ok" }))
        .route("/api/me", get(accounts::me))
        .route("/api/login", post(accounts::login))
        .route("/api/logout", post(accounts::logout))
        .route("/api/password-link", post(accounts::password_link))
        .route("/api/set-password", post(accounts::set_password))
        .route("/api/admin/users", get(admin::list).post(admin::add))
        .route(
            "/api/admin/users/{id}/resend-invite",
            post(admin::resend_invite),
        )
        .route("/api/admin/users/{id}/send-reset", post(admin::send_reset))
        .route("/api/admin/users/{id}/email", post(admin::change_email))
        .route("/api/admin/users/{id}/disable", post(admin::disable))
        .route("/api/admin/users/{id}/enable", post(admin::enable))
        // 建置把每頁存成 <名字>.html（例：/guide → guide.html），重新整理才打得開。
        // 找不到的路徑回前端的入口頁，讓前端自己處理路由。
        .fallback_service(
            ServeDir::new(site)
                .html_as_default_extension(true)
                .fallback(ServeFile::new(site.join(SPA_ENTRY))),
        )
        .layer(axum::middleware::from_fn(csrf::same_origin_only))
        .layer(TraceLayer::new_for_http().make_span_with(request_span))
        .with_state(state)
}

/// 每個請求的 log 只記方法和路徑：不記查詢字串、標頭（cookie、token 會在裡面）、內容。
fn request_span<B>(req: &Request<B>) -> tracing::Span {
    tracing::info_span!("request", method = %req.method(), path = %req.uri().path())
}
