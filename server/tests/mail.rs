//! 寄信：網站寄的每封信，回覆地址（Reply-To）都是支援信箱（#372）。

use std::sync::{Arc, Mutex};

use axum::http::StatusCode;
use cheer_server::mail::{Mail, Mailer};
use serde_json::{Value, json};

/// 假的 Resend：記下收到的信，回寄出了。
async fn fake_resend(got: Arc<Mutex<Vec<Value>>>) -> reqwest::Url {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let fake = axum::Router::new().route(
        "/emails",
        axum::routing::post(move |axum::Json(body): axum::Json<Value>| async move {
            got.lock().unwrap().push(body);
            (StatusCode::OK, axum::Json(json!({ "id": "fake-id" })))
        }),
    );
    tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
    format!("http://{addr}").parse().unwrap()
}

#[tokio::test]
async fn every_mail_replies_to_the_support_mailbox() {
    let got = Arc::default();
    let mailer = Mailer::resend_at(
        "re_test",
        "test <t@example.com>".into(),
        fake_resend(Arc::clone(&got)).await,
    );
    mailer
        .send(Mail {
            to: "mei@example.com".into(),
            subject: "主旨".into(),
            text: "內容".into(),
        })
        .await
        .unwrap();
    let got = got.lock().unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0]["reply_to"], json!(["support@littlebluewhite.com"]));
}
