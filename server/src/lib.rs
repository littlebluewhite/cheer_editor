pub mod accounts;
pub mod admin;
pub mod backup;
pub mod breach;
pub mod clock;
pub mod cloud_flows;
pub mod config;
pub mod csrf;
pub mod daily;
pub mod flow_core;
pub mod flow_room;
pub mod lockout;
pub mod mail;
pub mod music;
pub mod my_account;
pub mod records;
pub mod run_together;
pub mod share_link;
pub mod sharing;

use std::path::Path;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::Request;
use axum::routing::{get, post};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::breach::BreachCheck;
use crate::clock::Clock;
use crate::flow_core::FlowCore;
use crate::mail::Mailer;
use crate::music::MusicStore;
use crate::my_account::MailLimit;

/// 前端建置時另外產生的入口頁（`vite.config.ts` 裡 adapter 的 `fallback`）。
const SPA_ENTRY: &str = "200.html";

/// 傳上雲端的流程（flow.json 的內容，不含音樂）最大幾個位元組。前端先擋、413 也說太大（src/lib/server-api.ts 的 MAX_CLOUD_FLOW_BYTES）。
const UPLOAD_LIMIT: usize = 16 * 1024 * 1024;

/// `migrations/` 底下的遷移，編譯時包進程式；部署前（`cheer-server migrate`）和伺服器啟動時跑（[`migrate`]）。
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

/// 跑還沒跑過的遷移。資料庫裡多了這版沒有的遷移（新版部署過，又倒回舊版）照樣過：
/// 一次部署只加不刪（docs/deploy.md），舊版用多出來的表、欄位也沒事。
pub async fn migrate(db: &sqlx::PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    let mut migrator = sqlx::migrate!();
    migrator.set_ignore_missing(true);
    migrator.run(db).await
}

/// 每個請求拿得到的共用東西。寄信、外洩密碼、時鐘在測試換成假的。
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub mailer: Mailer,
    pub breach: BreachCheck,
    pub clock: Clock,
    /// 這個網站的網址（信裡的連結用），例：`https://cheer.example`，最後沒有 `/`。
    pub site_url: String,
    /// 跑流程核心（QuickJS，ADR 0010）。
    pub core: FlowCore,
    /// 同一個 email 的忘記密碼信寄幾封的限制。
    pub mail_limit: MailLimit,
    /// 開著的雲端流程房間：權限改了告訴他們（#250）。
    pub rooms: flow_room::Rooms,
    /// 放雲端流程音樂檔的 R2；沒設定時（本機開發沒填）放音樂的 API 回 503。
    pub music: Option<MusicStore>,
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
        .route("/api/admin/users/{id}/transfer", post(admin::hand_over))
        .route(
            "/api/flows",
            get(cloud_flows::mine).post(cloud_flows::create),
        )
        // 傳上雲端帶整支流程（含成功率紀錄），比預設的 2 MB 大。
        .route(
            "/api/flows/upload",
            post(cloud_flows::upload).layer(DefaultBodyLimit::max(UPLOAD_LIMIT)),
        )
        .route("/api/flows/{id}", get(cloud_flows::get_one))
        .route("/api/flows/{id}/room", get(flow_room::join))
        .route(
            "/api/flows/{id}/people",
            get(sharing::people).post(sharing::share),
        )
        .route(
            "/api/flows/{id}/people/{user}/role",
            post(sharing::set_role),
        )
        .route(
            "/api/flows/{id}/people/{user}/remove",
            post(sharing::revoke),
        )
        .route(
            "/api/flows/{id}/people/{user}/owner",
            post(sharing::hand_over),
        )
        .route("/api/flows/{id}/leave", post(sharing::leave))
        .route("/api/flows/{id}/delete", post(sharing::delete))
        .route(
            "/api/flows/{id}/link",
            get(share_link::get).post(share_link::switch),
        )
        .route("/api/links/{token}", get(share_link::open))
        .route(
            "/api/links/{token}/audio/{audio_id}",
            get(share_link::audio),
        )
        .route("/api/flows/{id}/audio", post(music::start_upload))
        .route("/api/flows/{id}/audio/{audio_id}", get(music::download))
        .route(
            "/api/flows/{id}/audio/{audio_id}/done",
            post(music::finish_upload),
        )
        .route("/api/forgot-password", post(my_account::forgot_password))
        .route("/api/account/name", post(my_account::change_name))
        .route("/api/account/password", post(my_account::change_password))
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
