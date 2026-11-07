//! 擋 CSRF（用 cookie 登入，別的網站能叫瀏覽器帶著 cookie 送請求）。照 OWASP：
//! 改資料的請求（GET、HEAD、OPTIONS 以外）看 `Sec-Fetch-Site`，只收 same-origin；
//! 舊瀏覽器沒有這個標頭，就看 `Origin` 是不是這個網址；兩個都沒有就擋。改資料的路由本來就不收 GET。

use axum::extract::Request;
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

pub async fn same_origin_only(req: Request, next: Next) -> Response {
    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if safe || from_this_site(req.headers()) {
        next.run(req).await
    } else {
        StatusCode::FORBIDDEN.into_response()
    }
}

fn from_this_site(headers: &HeaderMap) -> bool {
    let text = |name| headers.get(name).and_then(|v| v.to_str().ok());
    if let Some(site) = text("sec-fetch-site") {
        // none：使用者自己打網址、點書籤（不是別的網頁叫的）。
        return site == "same-origin" || site == "none";
    }
    match (text(header::ORIGIN.as_str()), text(header::HOST.as_str())) {
        (Some(origin), Some(host)) => origin
            .split_once("://")
            .is_some_and(|(_, authority)| authority == host),
        _ => false,
    }
}
