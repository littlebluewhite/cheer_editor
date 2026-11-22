// 雲端流程的音樂檔放 R2（#249）：伺服器查權限、發預簽網址，瀏覽器直接傳；傳完伺服器查大小；換掉的記下哪天不用了。
// R2 換成假的：開一台本機的 HTTP 伺服器，照 S3 的路徑（/bucket/key）收 PUT、HEAD、GET、DELETE，
// 和複製（PUT 加 x-amz-copy-source），不驗簽名。可以叫它下一次查大小、複製時出錯（見 Fault）。
// 開一台真的伺服器（網路埠），步用 WebSocket 送。要有 PostgreSQL：見 tests/db.rs 開頭。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{Method, Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Duration, TimeZone, Utc};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use tower::ServiceExt;

use cheer_server::accounts::create_admin;
use cheer_server::breach::BreachCheck;
use cheer_server::clock::Clock;
use cheer_server::flow_core::{FINGERPRINT, FlowCore};
use cheer_server::mail::Mailer;
use cheer_server::music::MAX_AUDIO_BYTES;
use cheer_server::r2::R2Bucket;
use cheer_server::{AppState, app};

const SITE: &str = "https://cheer.example";
const GOOD: &str = "我們這一隊今年一定會贏 go go";
const BUCKET: &str = "cheer-music-test";

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// 假的 R2 裡的檔：key → 內容。
type Objects = Arc<Mutex<HashMap<String, Vec<u8>>>>;

/// 叫假的 R2 下一次出錯（只錯一次）。
#[derive(Clone, Copy, PartialEq)]
enum Fault {
    /// 查大小（HEAD）回 500。
    Size,
    /// 複製回 200，但內容是錯誤（S3 的 CopyObject 複製到一半出錯會這樣回），沒複製。
    CopyErrorIn200,
    /// 刪檔回 500。
    Delete,
}

type Faults = Arc<Mutex<Vec<Fault>>>;

/// 開一台假的 R2，回它的網址（給 R2Bucket 當 endpoint）、裡面的檔和要它出的錯。
async fn fake_r2() -> (reqwest::Url, Objects, Faults) {
    let objects = Objects::default();
    let faults = Faults::default();
    async fn object(
        State((objects, faults)): State<(Objects, Faults)>,
        Path((bucket, key)): Path<(String, String)>,
        method: Method,
        headers: axum::http::HeaderMap,
        body: Bytes,
    ) -> Response {
        assert_eq!(bucket, BUCKET);
        let mut all = objects.lock().unwrap();
        let fail = |fault: Fault| {
            let mut faults = faults.lock().unwrap();
            let at = faults.iter().position(|f| *f == fault);
            at.map(|at| faults.remove(at)).is_some()
        };
        match method {
            Method::HEAD if fail(Fault::Size) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            Method::PUT
                if headers.contains_key("x-amz-copy-source") && fail(Fault::CopyErrorIn200) =>
            {
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
                 <Error><Code>InternalError</Code><Message>We encountered an internal error. Please try again.</Message></Error>"
                    .into_response()
            }
            Method::PUT if headers.contains_key("x-amz-copy-source") => {
                let source = headers["x-amz-copy-source"].to_str().unwrap();
                let from = source.strip_prefix(&format!("{BUCKET}/")).unwrap();
                match all.get(from).cloned() {
                    Some(bytes) => {
                        all.insert(key, bytes);
                        StatusCode::OK.into_response()
                    }
                    None => StatusCode::NOT_FOUND.into_response(),
                }
            }
            Method::PUT => {
                all.insert(key, body.to_vec());
                StatusCode::OK.into_response()
            }
            Method::DELETE if fail(Fault::Delete) => {
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
            Method::DELETE => {
                all.remove(&key);
                StatusCode::NO_CONTENT.into_response()
            }
            Method::GET | Method::HEAD => match all.get(&key) {
                Some(bytes) if method == Method::GET => bytes.clone().into_response(),
                Some(bytes) => ([(header::CONTENT_LENGTH, bytes.len())], ()).into_response(),
                None => StatusCode::NOT_FOUND.into_response(),
            },
            _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
        }
    }
    let fake = axum::Router::new()
        .route("/{bucket}/{*key}", axum::routing::any(object))
        .with_state((objects.clone(), faults.clone()))
        .layer(axum::extract::DefaultBodyLimit::disable());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
    (format!("http://{addr}").parse().unwrap(), objects, faults)
}

struct Server {
    state: AppState,
    now: Arc<Mutex<DateTime<Utc>>>,
    site: tempfile::TempDir,
    addr: std::net::SocketAddr,
    r2: Objects,
    faults: Faults,
}

impl Server {
    async fn new(db: sqlx::PgPool) -> Self {
        let now = Arc::new(Mutex::new(
            Utc.with_ymd_and_hms(2026, 11, 7, 9, 0, 0).unwrap(),
        ));
        let clock_now = now.clone();
        let (endpoint, r2, faults) = fake_r2().await;
        let state = AppState {
            db,
            mailer: Mailer::memory(),
            breach: BreachCheck::list(Vec::<&str>::new()),
            clock: Clock::new(move || *clock_now.lock().unwrap()),
            site_url: SITE.into(),
            core: FlowCore::start().unwrap(),
            mail_limit: Default::default(),
            rooms: Default::default(),
            music: Some(R2Bucket::new(endpoint, BUCKET, "test-key", "test-secret").unwrap()),
        };
        let site = tempfile::tempdir().unwrap();
        std::fs::write(site.path().join("200.html"), "spa entry").unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let router = app(state.clone(), site.path());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self {
            state,
            now,
            site,
            addr,
            r2,
            faults,
        }
    }

    /// 假的 R2 下一次這樣出錯。
    fn fail_next(&self, fault: Fault) {
        self.faults.lock().unwrap().push(fault);
    }

    fn pass(&self, d: Duration) {
        *self.now.lock().unwrap() += d;
    }

    async fn send(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        cookie: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header("sec-fetch-site", "same-origin");
        if let Some(c) = cookie {
            req = req.header("cookie", c);
        }
        let req = match body {
            Some(b) => req
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let res = app(self.state.clone(), self.site.path())
            .oneshot(req)
            .await
            .unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn signed_in(&self, email: &str, name: &str) -> String {
        create_admin(&self.state, email, Some(name)).await.unwrap();
        let mail = self.state.mailer.sent().last().cloned().unwrap();
        let link = format!("{SITE}/set-password#");
        let at = mail.text.find(&link).unwrap() + link.len();
        let token = mail.text[at..].split_whitespace().next().unwrap();
        let body = json!({ "token": token, "password": GOOD });
        self.send("POST", "/api/set-password", Some(body), None)
            .await;
        let req = Request::post("/api/login")
            .header("sec-fetch-site", "same-origin")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({ "email": email, "password": GOOD }).to_string(),
            ))
            .unwrap();
        let res = app(self.state.clone(), self.site.path())
            .oneshot(req)
            .await
            .unwrap();
        let cookie = res.headers().get(header::SET_COOKIE).unwrap();
        cookie
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned()
    }

    async fn create(&self, cookie: &str, name: &str) -> String {
        let input = json!({ "name": name, "field": { "strips": 9, "layout": "vertical" } });
        let (status, made) = self
            .send("POST", "/api/flows", Some(input), Some(cookie))
            .await;
        assert_eq!(status, StatusCode::CREATED);
        made["id"].as_str().unwrap().to_owned()
    }

    async fn flow(&self, cookie: &str, id: &str) -> Value {
        self.send("GET", &format!("/api/flows/{id}"), None, Some(cookie))
            .await
            .1
    }

    /// 連房間、打招呼。
    async fn join(&self, cookie: &str, id: &str) -> Socket {
        let mut req = format!("ws://{}/api/flows/{id}/room", self.addr)
            .into_client_request()
            .unwrap();
        req.headers_mut()
            .insert("sec-fetch-site", "same-origin".parse().unwrap());
        req.headers_mut().insert("cookie", cookie.parse().unwrap());
        let (mut socket, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        let hello =
            json!({ "kind": "hello", "fingerprint": FINGERPRINT, "tabId": "tab-a", "seen": 0 });
        say(&mut socket, hello).await;
        assert_eq!(hear(&mut socket).await["kind"], "ready");
        socket
    }

    /// 要傳一個音樂檔：伺服器回預簽網址（或狀態不對時的狀態）。
    async fn start_upload(
        &self,
        cookie: Option<&str>,
        flow: &str,
        audio: &str,
        size: i64,
    ) -> (StatusCode, Value) {
        let body = json!({ "audioId": audio, "fileName": "主歌.mp3", "size": size });
        self.send(
            "POST",
            &format!("/api/flows/{flow}/audio"),
            Some(body),
            cookie,
        )
        .await
    }

    async fn finish_upload(&self, cookie: &str, flow: &str, audio: &str) -> (StatusCode, Value) {
        self.send(
            "POST",
            &format!("/api/flows/{flow}/audio/{audio}/done"),
            None,
            Some(cookie),
        )
        .await
    }

    /// 整個傳一次：拿網址、瀏覽器直接 PUT 上去、告訴伺服器傳完了。回傳完的狀態。
    async fn upload(&self, cookie: &str, flow: &str, audio: &str, bytes: Vec<u8>) -> StatusCode {
        let (status, got) = self.start_upload(Some(cookie), flow, audio, 3).await;
        assert_eq!(status, StatusCode::OK);
        let url = got["url"].as_str().unwrap();
        let put = reqwest::Client::new().put(url).body(bytes).send().await;
        assert!(put.unwrap().status().is_success());
        self.finish_upload(cookie, flow, audio).await.0
    }

    /// 這支流程的音樂檔：audio id → 哪天不用了（還在用是 None）。
    async fn unused_since(&self, flow: &str) -> HashMap<String, Option<DateTime<Utc>>> {
        sqlx::query_as("SELECT audio_id, unused_since FROM flow_audio WHERE flow_id = $1")
            .bind(flow)
            .fetch_all(&self.state.db)
            .await
            .unwrap()
            .into_iter()
            .collect()
    }
}

async fn say(socket: &mut Socket, message: Value) {
    socket
        .send(Message::Text(message.to_string().into()))
        .await
        .unwrap();
}

/// 伺服器回這個連線的下一句：誰開著、別的連線的改動（#253）跳過。
async fn hear(socket: &mut Socket) -> Value {
    loop {
        match socket.next().await.unwrap().unwrap() {
            Message::Text(text) => {
                let message: Value = serde_json::from_str(&text).unwrap();
                if message["kind"] != "present" && message["kind"] != "changed" && message["kind"] != "runThroughs" {
                    return message;
                }
            }
            Message::Close(_) => panic!("房間關了"),
            _ => {}
        }
    }
}

/// 送一步（一定要收）。
async fn step(socket: &mut Socket, step_id: &str, commands: Value) {
    let message = json!({ "kind": "step", "stepId": step_id, "seen": 0, "commands": commands });
    say(socket, message).await;
    let reply = hear(socket).await;
    assert_eq!(reply["kind"], "accepted", "{reply}");
}

#[sqlx::test]
async fn upload_then_play_through_presigned_urls(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;

    assert_eq!(
        s.upload(&lin, &id, "a1", vec![1, 2, 3]).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        s.r2.lock().unwrap().values().cloned().collect::<Vec<_>>(),
        [vec![1, 2, 3]]
    );

    // 播放：拿下載的預簽網址，瀏覽器直接從 R2 拿。
    let (status, got) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let bytes = reqwest::get(got["url"].as_str().unwrap())
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(bytes.as_ref(), [1, 2, 3]);
}

#[sqlx::test]
async fn no_permission_no_presigned_url(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let wang = s.signed_in("wang@example.com", "王教練").await;
    let id = s.create(&lin, "全國賽").await;
    s.upload(&lin, &id, "a1", vec![1, 2, 3]).await;

    // 沒登入：401。
    let (status, got) = s.start_upload(None, &id, "a2", 3).await;
    assert_eq!((status, got), (StatusCode::UNAUTHORIZED, Value::Null));
    let (status, _) = s
        .send("GET", &format!("/api/flows/{id}/audio/a1"), None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // 別人（打不開這支流程）：跟沒有這支一樣，404，拿不到網址。
    let (status, got) = s.start_upload(Some(&wang), &id, "a2", 3).await;
    assert_eq!((status, got), (StatusCode::NOT_FOUND, Value::Null));
    let (status, got) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&wang),
        )
        .await;
    assert_eq!((status, got), (StatusCode::NOT_FOUND, Value::Null));
    let (status, _) = s.finish_upload(&wang, &id, "a1").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // 沒有這個音樂檔：404。
    let (status, _) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a9"),
            None,
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // 分享給他當檢視者（#250）：能聽，不能放音樂。
    let body = json!({ "email": "wang@example.com", "role": "viewer" });
    let (status, _) = s
        .send(
            "POST",
            &format!("/api/flows/{id}/people"),
            Some(body),
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, got) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&wang),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{got}");
    let (status, _) = s.start_upload(Some(&wang), &id, "a2", 3).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn bad_requests_get_no_url(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;

    // 說好的大小就超過 60 MB：不發網址。
    let (status, _) = s
        .start_upload(Some(&lin), &id, "a1", MAX_AUDIO_BYTES + 1)
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

    // 不是音樂檔、id 怪怪的：400。
    let body = json!({ "audioId": "a1", "fileName": "歌.ogg", "size": 3 });
    let (status, _) = s
        .send(
            "POST",
            &format!("/api/flows/{id}/audio"),
            Some(body),
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = s.start_upload(Some(&lin), &id, "../a1", 3).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // 還沒傳上去就說傳完：409。
    let (status, _) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = s.finish_upload(&lin, &id, "a1").await;
    assert_eq!(status, StatusCode::CONFLICT);

    // 傳好的不能再傳一次（同一個 id 不能換內容）：409。
    s.upload(&lin, &id, "a2", vec![1]).await;
    let (status, _) = s.start_upload(Some(&lin), &id, "a2", 3).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[sqlx::test]
async fn over_60_mb_after_upload_is_deleted_and_refused(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;

    // 說是 3 個位元組，傳上去的超過 60 MB：伺服器查到就刪掉、退回。
    let big = vec![0u8; MAX_AUDIO_BYTES as usize + 1];
    assert_eq!(
        s.upload(&lin, &id, "a1", big).await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert!(s.r2.lock().unwrap().is_empty(), "R2 上的刪掉了");
    assert!(s.unused_since(&id).await.is_empty(), "沒記這個音樂檔");
    let (status, _) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // 剛好 60 MB 收。
    let max = vec![0u8; MAX_AUDIO_BYTES as usize];
    assert_eq!(s.upload(&lin, &id, "a2", max).await, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn replaced_music_records_when_it_stopped_being_used(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let mut room = s.join(&lin, &id).await;
    step(
        &mut room,
        "stepaddseg01",
        json!([{ "name": "addSegment", "args": ["music"] }]),
    )
    .await;
    let segment = s.flow(&lin, &id).await["flow"]["segments"][0]["id"].clone();

    // 放音樂（音樂檔的 id 由步驟 id 算出來）。前端是先傳再送步；伺服器不管先後，這裡先送步才知道 id。
    let load = |file: &str| json!([{ "name": "loadSegmentAudio", "args": [segment, file, []] }]);
    step(&mut room, "steploadone1", load("主歌.mp3")).await;
    let first = s.flow(&lin, &id).await["flow"]["audio"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    s.upload(&lin, &id, &first, vec![1]).await;
    assert_eq!(s.unused_since(&id).await[&first], None);

    // 換掉：舊的記下哪天不用了，新的還在用。
    s.pass(Duration::days(2));
    step(&mut room, "steploadtwo1", load("副歌.mp3")).await;
    let second = s.flow(&lin, &id).await["flow"]["audio"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    s.upload(&lin, &id, &second, vec![2]).await;
    let unused = s.unused_since(&id).await;
    let replaced_at = Utc.with_ymd_and_hms(2026, 11, 9, 9, 0, 0).unwrap();
    assert_eq!(unused[&first], Some(replaced_at));
    assert_eq!(unused[&second], None);

    // 再過幾天又改別的：不用了的那天不會往後移。
    s.pass(Duration::days(3));
    step(
        &mut room,
        "steprename01",
        json!([{ "name": "renameFlow", "args": ["決賽"] }]),
    )
    .await;
    assert_eq!(s.unused_since(&id).await[&first], Some(replaced_at));
}

#[sqlx::test]
async fn the_share_link_plays_music_without_signing_in(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    s.upload(&lin, &id, "a1", vec![1, 2, 3]).await;
    let link_path = format!("/api/flows/{id}/link");
    let switch = |on: bool| s.send("POST", &link_path, Some(json!({ "on": on })), Some(&lin));
    let (_, link) = switch(true).await;
    let token = link["token"].as_str().unwrap();

    // 用連結（沒登入）拿下載的預簽網址（#251）。
    let (status, got) = s
        .send("GET", &format!("/api/links/{token}/audio/a1"), None, None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let bytes = reqwest::get(got["url"].as_str().unwrap())
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(bytes.as_ref(), [1, 2, 3]);
    let (status, _) = s
        .send("GET", &format!("/api/links/{token}/audio/a2"), None, None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // 連結關掉：拿不到。
    switch(false).await;
    let (status, _) = s
        .send("GET", &format!("/api/links/{token}/audio/a1"), None, None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn a_late_put_cannot_replace_finished_music(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let (_, got) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    let url = got["url"].as_str().unwrap().to_owned();
    let put = |bytes: Vec<u8>| reqwest::Client::new().put(&url).body(bytes).send();
    assert!(put(vec![1, 2, 3]).await.unwrap().status().is_success());
    assert_eq!(
        s.finish_upload(&lin, &id, "a1").await.0,
        StatusCode::NO_CONTENT
    );

    // 收了之後，同一個預簽網址還沒過期（例：瀏覽器重試）又 PUT 一次別的內容：收好的不變。
    put(vec![9; 4]).await.unwrap();
    let (status, got) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let bytes = reqwest::get(got["url"].as_str().unwrap())
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(bytes.as_ref(), [1, 2, 3]);
    let (size,): (i64,) = sqlx::query_as("SELECT size FROM flow_audio WHERE flow_id = $1")
        .bind(&id)
        .fetch_one(&s.state.db)
        .await
        .unwrap();
    assert_eq!(size, 3);
}

#[sqlx::test]
async fn finishing_again_after_a_failed_size_check_succeeds(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let (_, got) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    let put = reqwest::Client::new().put(got["url"].as_str().unwrap());
    assert!(
        put.body(vec![1, 2, 3])
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );

    // 複製好了，查大小時 R2 出錯：這次失敗。
    s.fail_next(Fault::Size);
    assert_eq!(
        s.finish_upload(&lin, &id, "a1").await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );

    // 瀏覽器再說一次傳完：收了，聽得到，暫放的刪掉了。
    assert_eq!(
        s.finish_upload(&lin, &id, "a1").await.0,
        StatusCode::NO_CONTENT
    );
    let (status, got) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let bytes = reqwest::get(got["url"].as_str().unwrap())
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(bytes.as_ref(), [1, 2, 3]);
    let keys: Vec<String> = s.r2.lock().unwrap().keys().cloned().collect();
    assert_eq!(keys, [format!("flows/{id}/a1.mp3")]);
}

#[sqlx::test]
async fn a_copy_that_fails_inside_a_200_is_not_taken_as_done(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let put = |url: String, bytes: Vec<u8>| reqwest::Client::new().put(url).body(bytes).send();

    // 第一次：複製好了，查大小出錯，沒收。
    let (_, got) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    put(got["url"].as_str().unwrap().into(), vec![1, 2, 3])
        .await
        .unwrap();
    s.fail_next(Fault::Size);
    s.finish_upload(&lin, &id, "a1").await;

    // 重傳一次別的內容；R2 複製回 200，內容卻是錯誤：不能當成收了（不然收的是上一次的）。
    let (_, got) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    put(got["url"].as_str().unwrap().into(), vec![4, 5, 6])
        .await
        .unwrap();
    s.fail_next(Fault::CopyErrorIn200);
    assert_eq!(
        s.finish_upload(&lin, &id, "a1").await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );

    // 再說一次傳完：收的是這次傳的。
    assert_eq!(
        s.finish_upload(&lin, &id, "a1").await.0,
        StatusCode::NO_CONTENT
    );
    let (_, got) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&lin),
        )
        .await;
    let bytes = reqwest::get(got["url"].as_str().unwrap())
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(bytes.as_ref(), [4, 5, 6]);
}

#[sqlx::test]
async fn a_restarted_upload_whose_staging_expired_does_not_take_the_earlier_copy(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let put = |url: String, bytes: Vec<u8>| reqwest::Client::new().put(url).body(bytes).send();

    // 第一次（A）：複製好了，查大小出錯，沒收。
    let (_, got) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    put(got["url"].as_str().unwrap().into(), vec![1, 2, 3])
        .await
        .unwrap();
    s.fail_next(Fault::Size);
    s.finish_upload(&lin, &id, "a1").await;

    // 重新開始傳別的（B），暫放的被 R2 的生命週期規則刪掉了才說傳完：不能收成 A。
    let (_, got) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    put(got["url"].as_str().unwrap().into(), vec![4, 5, 6])
        .await
        .unwrap();
    s.r2.lock()
        .unwrap()
        .remove(&format!("uploading/flows/{id}/a1.mp3"));
    assert_eq!(
        s.finish_upload(&lin, &id, "a1").await.0,
        StatusCode::CONFLICT
    );
    let (status, _) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn staging_left_behind_after_finishing_still_reports_success(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    let (_, got) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    let put = reqwest::Client::new().put(got["url"].as_str().unwrap());
    assert!(
        put.body(vec![1, 2, 3])
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );

    // 收了才刪暫放的，刪不掉：還是收了（暫放的留給 R2 的生命週期規則），瀏覽器不會以為沒傳成。
    s.fail_next(Fault::Delete);
    assert_eq!(
        s.finish_upload(&lin, &id, "a1").await.0,
        StatusCode::NO_CONTENT
    );
    let (status, _) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[sqlx::test]
async fn a_first_upload_does_not_need_a_delete_to_succeed(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;

    // 第一次傳這個音樂檔，沒有上次的要刪：R2 刪檔出錯也照樣拿到上傳網址。
    s.fail_next(Fault::Delete);
    let (status, got) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    assert_eq!(status, StatusCode::OK);
    assert!(got["url"].is_string());
}

#[sqlx::test]
async fn a_recording_left_in_r2_without_its_row_is_not_taken(db: sqlx::PgPool) {
    let s = Server::new(db).await;
    let lin = s.signed_in("lin@example.com", "林教練").await;
    let id = s.create(&lin, "全國賽").await;
    // 資料庫還原成備份之後：R2 上有正式的那份，資料庫沒有這一列。
    s.r2.lock()
        .unwrap()
        .insert(format!("flows/{id}/a1.mp3"), vec![1, 2, 3]);

    // 重新傳同一個 id，暫放的被 R2 的生命週期規則刪掉了才說傳完：不能收成留下來的那份。
    let (status, _) = s.start_upload(Some(&lin), &id, "a1", 3).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        s.finish_upload(&lin, &id, "a1").await.0,
        StatusCode::CONFLICT
    );
    let (status, _) = s
        .send(
            "GET",
            &format!("/api/flows/{id}/audio/a1"),
            None,
            Some(&lin),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
