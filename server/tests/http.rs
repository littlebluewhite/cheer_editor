// 不開網路埠，直接把請求丟給 app（tower 的 oneshot）。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

/// 接著連不到的資料庫：用到它的請求一定會失敗，所以拿來證明「沒查資料庫」。
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

async fn get(app: axum::Router, path: &str) -> (StatusCode, String) {
    let res = app
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

#[tokio::test]
async fn health_check_is_ok_without_touching_the_database() {
    let site = tempfile::tempdir().unwrap();
    let app = cheer_server::app(unreachable_pool(), site.path());

    let (status, body) = get(app, "/health").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "ok");
}

/// 跟 `npm run build` 建出來的一樣形狀：每頁一個 .html，加上 SPA 入口頁 200.html。
fn built_site() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("index.html", "editor page");
    write("guide.html", "guide page");
    write("200.html", "spa entry");
    write("_app/immutable/app.js", "console.log(1)");
    dir
}

#[tokio::test]
async fn root_serves_the_editor_page() {
    let site = built_site();
    let (status, body) = get(cheer_server::app(unreachable_pool(), site.path()), "/").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "editor page");
}

#[tokio::test]
async fn reloading_guide_serves_the_guide_page() {
    let site = built_site();
    let (status, body) = get(cheer_server::app(unreachable_pool(), site.path()), "/guide").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "guide page");
}

#[tokio::test]
async fn built_asset_is_served_as_is() {
    let site = built_site();
    let (status, body) = get(
        cheer_server::app(unreachable_pool(), site.path()),
        "/_app/immutable/app.js",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "console.log(1)");
}

#[tokio::test]
async fn unknown_path_gets_the_spa_entry_so_the_frontend_routes_it() {
    let site = built_site();
    let (status, body) = get(
        cheer_server::app(unreachable_pool(), site.path()),
        "/no/such/page",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "spa entry");
}

#[tokio::test]
async fn privacy_and_support_with_a_trailing_slash_go_to_the_page() {
    // App Store Connect 填的網址後面有斜線；建出來的是 privacy.html，前端的路由不認 privacy/（#372）
    let site = built_site();
    for (path, to) in [("/privacy/", "/privacy"), ("/support/", "/support")] {
        let res = cheer_server::app(unreachable_pool(), site.path())
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::PERMANENT_REDIRECT, "{path}");
        assert_eq!(res.headers()["location"], to, "{path}");
    }
}

/// 自動填密碼（#395）：iPhone 照這個檔認 App 和網站是一家的。要是 JSON；
/// 沒有這條路由的話會拿到 200.html（狀態也是 200），所以連檔案類型、內容一起比。
#[tokio::test]
async fn apple_app_site_association_is_json_naming_the_app() {
    let site = built_site();
    let res = cheer_server::app(unreachable_pool(), site.path())
        .oneshot(
            Request::get("/.well-known/apple-app-site-association")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()["content-type"], "application/json");
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "webcredentials": { "apps": ["N5HMWTF697.com.littlebluewhite.cheereditor"] }
        })
    );
}
