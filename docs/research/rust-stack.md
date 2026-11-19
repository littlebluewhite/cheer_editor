# Rust 後端用哪些套件

Issue #180（地圖 #177）。問題：用 Rust + PostgreSQL 寫後端，各部分現在最好用哪個套件、最新穩定版是幾版。

查核日期 2026-11-06。所有版號都是當天從一手來源查的，見文末「來源」。
地圖 Notes 寫「用開工當天的最新穩定版」，所以**開工當天要再查一次**（第 9 節列了最可能變的）。

表格欄位：

- **最新穩定版、發版日**：crates.io API（`https://crates.io/api/v1/crates/<名字>`）的 `max_stable_version` 和那一版的發布時間。不算 alpha、rc 這類預覽版；有預覽版的另外寫。
- **GitHub 最近更新**：GitHub API 的 `pushed_at`，任何分支有人推就算，也包括機器人自動更新依賴。
- **需要 Rust**：套件自己寫的最低 Rust 版本（`rust-version`）。「—」是沒寫。
- **近 90 天下載**：crates.io 的 `recent_downloads`（crates.io 原始碼定義為最近 90 天）。只看得出多少人用，看不出好不好。

標「推論」的是我自己推的，沒有一手來源直接寫。

名詞：

- **套件（crate）**：Rust 的函式庫，放在 crates.io。
- **0.x 版**：Cargo 把 0.8 和 0.9 當成不相容。從 0.8 升到 0.9 可能要改程式 [Cargo：Specifying Dependencies]。
- **中介層（middleware）**：夾在「收到請求」和「處理請求的函式」中間的共用程式，例如寫 log、限制次數、檢查登入。
- **ORM**：用 Rust 的物件和函式代替手寫 SQL。

## 結論

1. **Rust 最新穩定版 1.99.1**（2026-10-15），edition 2024（1.85.0 起）。每 6 週一版，下一版 1.100.0 預計 2026-11-12（推論）。
2. **PostgreSQL 最新穩定大版是 18（18.6）**。19 正在 RC，官方預定 **2026-11-19** 正式發布。
3. **網頁框架：axum 0.8.9 和 actix-web 4.18.2 都有在維護。** axum 近 90 天下載量多十倍以上，放在 tokio-rs 組織底下。axum 還在 0.x，上次發版 2026-04-14。
4. **資料庫：sqlx 0.9.0 寫 SQL、編譯時檢查；diesel 2.3.14 用 Rust 組查詢；sea-orm 2.0.4 是建在 sqlx 0.9 上的 ORM。** sqlx 的 GitHub 已搬到 `transact-rs/sqlx`。
5. **密碼：argon2 0.6.0（RustCrypto）的預設參數就是 OWASP 的最低建議**（19 MiB 記憶體、2 次、平行度 1）。
6. **登入狀態的周邊套件跟不上新版。** crates.io 上的 tower-sessions-sqlx-store 0.15.0 還綁 sqlx 0.8 和舊的 tower-sessions 0.14；axum-login 0.18.0 也綁 tower-sessions 0.14。兩個的 GitHub 主分支都已經改好，只是還沒發版。
7. **CSRF 和限制次數的套件都很小。** tower-csrf 已封存（archived）；tower_governor 從 2025-08-14 後沒有更新。OWASP 建議用 `Sec-Fetch-Site` 加 `Origin` 檢查，自己寫不難（推論）。
8. **寄信：lettre 0.11.23 走 SMTP，哪家寄信服務都能用。** Resend 有官方 Rust SDK（resend-rs 0.35.2），AWS 也有（aws-sdk-sesv2 1.145.0）。
9. **WebSocket：axum 內建（開 `ws` 功能），也有內建 SSE。** 要真的「同時改同一份」，有 Yjs 的 Rust 版 yrs 0.28.1。
10. **共用型別：最簡單是 ts-rs 12.0.1**，從 Rust 型別直接產生 `.ts` 檔。走 OpenAPI 的話用 utoipa 6.0.0；前端工具 openapi-typescript 7.13.0 的 peer 依賴只寫 TypeScript 5，跟前端的 TypeScript 6 對不上；@hey-api/openapi-ts 0.99.0 有寫 6。

## 1. Rust 本身

| 項目 | 版本 | 日期 | 來源 |
|---|---|---|---|
| stable | **1.99.1** | 2026-10-15 | stable 頻道清單 `channel-rust-stable.toml`、Rust 官方部落格 |
| 上一版 | 1.99.0 | 2026-10-01 | Rust 官方部落格、Release notes |
| Cargo | 0.100.0 | 跟 1.99.1 一起 | stable 頻道清單 |
| edition | **2024** | 1.85.0 起 | Edition Guide（目錄只有 2015、2018、2021、2024） |
| 下一版 | 1.100.0 | 預計 2026-11-12 | 推論：官方寫「每 6 週一版」，1.99.0 是 10-01 |

- edition 是語法的大版本。新專案 `cargo new` 用最新的 edition 就好（推論）。
- 1.99.1 是小修：修 `wcslen` 連結錯誤、x86_64 FFI 回傳 bool 的錯、macOS 上 rust-lld 找不到 libLLVM。
- 這份筆記裡最高的「需要 Rust」是 aws-sdk-sesv2 的 1.94.1。sqlx、sea-orm 要 1.94.0。1.99.1 都夠。

## 2. 網頁框架和非同步執行環境

「非同步執行環境」（async runtime）：讓一台伺服器同時等很多個請求、資料庫回應，不用每個請求開一條執行緒。下面兩個框架底下都是 tokio。

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 需要 Rust | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|---|
| axum | 0.8.9 | 2026-04-14 | 2026-11-03 | 1.80 | 1.5 億 | 放在 tokio-rs 底下；用 tower 的中介層，tower-http、tower-sessions 這些都能直接套。還在 0.x，升 0.9 會要改程式。 |
| actix-web | 4.18.2 | 2026-11-06 | 2026-11-06 | 1.89 | 1,318 萬 | 4.0.0 是 2022-02-25，之後都在 4.x，沒有大版變動。中介層、session、WebSocket 都用自己一套（actix-extras）。 |
| tokio | 1.54.1 | 2026-10-21 | 2026-11-04 | 1.85 | 2.9 億 | 事實標準。有長期支援版（LTS）：1.51.x 到 2027-03、1.53.x 到 2027-09。 |
| tower | 0.5.3 | 2026-01-12 | 2026-06-22 | 1.64.0 | 2.3 億 | axum 的中介層介面。通常不用直接裝。 |
| tower-http | 0.7.1 | 2026-08-31 | 2026-10-31 | 1.65 | 2.1 億 | 現成的 HTTP 中介層：log（`trace`）、CORS、逾時、大小限制、壓縮。 |
| hyper | 1.12.0 | 2026-10-06 | 2026-11-02 | 1.63 | 2.7 億 | axum 底下的 HTTP 實作。不用直接用。 |

補充：

- axum 0.8.9 自己依賴 tower-http ^0.6.8，最新是 0.7.1。兩個都只要求 tower 0.5 和 http 1，應該能一起用（推論，沒實測）。
- actix-web 也依賴 tokio（crates.io 依賴表：actix-rt ^2.6、tokio ^1.38.2）。
- tokio 的 LTS 是「這個小版本會補修一年以上」。要鎖在 LTS 就寫 `tokio = "~1.53"` [tokio README]。

## 3. PostgreSQL 和資料庫套件

### PostgreSQL 版本

| 大版號 | 目前小版本 | 第一次發布 | 支援到 |
|---|---|---|---|
| 19 | RC 1（2026-10-15） | 預定 **2026-11-19** 正式版 | — |
| **18** | **18.6** | 2025-09-25 | 2030-11-14 |
| 17 | 17.11 | 2024-09-26 | 2029-11-08 |
| 16 | 16.15 | 2023-09-14 | 2028-11-09 |
| 14 | 14.24 | 2021-09-30 | **2026-11-12** |

- 來源：postgresql.org 的 Versioning Policy 和 19 RC 1 公告。
- 19 RC 1 公告寫：2026-11-12 出 RC 2（跟各版的例行更新同一天），沒問題的話 11-19 正式發布。官方說 RC「不建議用在正式環境」。
- 所以：11-19 前開工，最新穩定就是 18；之後開工就是 19.0。
- 主機商（#181）什麼時候提供 19，這裡沒查。

### 跟 PostgreSQL 溝通的套件

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 需要 Rust | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|---|
| sqlx | 0.9.0 | 2026-05-21 | 2026-10-31 | 1.94.0 | 5,507 萬 | 自己寫 SQL；`query!` 編譯時連資料庫檢查欄位和型別。不是 ORM。內建連線池、遷移、測試用資料庫、LISTEN/NOTIFY。 |
| diesel | 2.3.14 | 2026-10-07 | 2026-11-05 | 1.86.0 | 1,156 萬 | 用 Rust 函式組查詢，寫錯欄位編譯就不過。本身是同步的（等資料庫時會卡住那條執行緒），要非同步得加 diesel-async。 |
| diesel-async | 0.9.2 | 2026-06-19 | 2026-11-04 | 1.84.0 | 612 萬 | diesel 的非同步連線；依賴 diesel ~2.3.9。官方說是「搭配 diesel」，不是取代。 |
| sea-orm | 2.0.4 | 2026-09-27 | 2026-10-30 | 1.94.0 | 600 萬 | 非同步 ORM，建在 sqlx 0.9 上。`sea-orm-cli generate entity` 可從資料庫產生 Rust 型別。多一層，查錯要多看一層（推論）。 |
| tokio-postgres | 0.7.18 | 2026-06-12 | 2026-10-03 | 1.85 | 2,535 萬 | 最底層的 PostgreSQL 連線。沒有編譯時檢查，連線池要另外裝。 |
| deadpool-postgres | 0.14.2 | 2026-08-26 | 2026-09-25 | 1.85 | 845 萬 | tokio-postgres 用的連線池。 |

sqlx 0.9.0 的重點（CHANGELOG）：

- GitHub 從 launchbadge 搬到 `transact-rs`。crates.io 上的 repository 欄位還寫舊的，網址會自動轉過去。
- 支援的最低 Rust 是 1.94.0。
- 新增 `sqlx.toml` 設定檔。
- `Migrate` 介面有大改；`cargo install --locked sqlx-cli` 不能用了，改用 `cargo install sqlx-cli`。
- 編譯時檢查要連得到資料庫；連不到時用「離線模式」：先存一份查詢資料（`.sqlx` 資料夾），README 說離線模式現在一定開著。

### 資料庫遷移（migration）

遷移：一個個編號的 SQL 檔，記錄「資料表怎麼一步步改成現在的樣子」。上線時照順序跑，每台機器的資料表就一樣。

| 工具 | 最新穩定版 | 發版日 | 需要 Rust | 搭配 | 取捨 |
|---|---|---|---|---|---|
| sqlx-cli + `sqlx::migrate!` | 0.9.0 | 2026-05-21 | 1.94.0 | sqlx | 純 SQL 檔。`migrate!` 把遷移包進程式，啟動時自己跑。 |
| diesel_cli | 2.3.14 | 2026-10-07 | 1.86.0 | diesel | 每次遷移有 `up.sql`、`down.sql` 兩個檔；會幫你維護 `src/schema.rs`（diesel 入門指南）。 |
| sea-orm-migration（+ sea-orm-cli） | 2.0.4 | 2026-09-27 | 1.85.0 | sea-orm | 遷移是 `.rs` 檔，用 Rust 寫（sea-orm-cli 的範本）。 |
| refinery | 0.10.0 | 2026-10-02 | 1.92 | tokio-postgres、postgres 等 | 獨立的遷移工具。功能清單沒有 sqlx。 |

## 4. 登入相關

### 密碼雜湊

雜湊：把密碼算成一串固定的亂碼，存亂碼不存密碼。好的密碼雜湊故意算得慢、吃記憶體，讓別人偷到資料庫也很難猜。

OWASP 密碼儲存建議：「Argon2id，最少 19 MiB 記憶體、2 次、平行度 1」。bcrypt 只建議給舊系統，而且密碼上限 72 bytes。

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 需要 Rust | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|---|
| argon2 | 0.6.0 | 2026-08-27 | 2026-11-05 | 1.85 | 2,880 萬 | RustCrypto 維護。預設參數 = OWASP 最低建議（原始碼 `DEFAULT_M_COST = 19 * 1024`、`T = 2`、`P = 1`）。 |
| password-auth | 2.0.0 | 2026-11-05 | 2026-11-05 | 1.85 | 33 萬 | RustCrypto 維護，把 argon2 包成「產生雜湊／驗證」兩個函式。2.0.0 是查核前一天才出的大版。 |
| bcrypt | 0.19.3 | 2026-07-27 | 2026-07-27 | — | 808 萬 | 有在維護，但 OWASP 只建議給舊系統。 |
| rust-argon2 | 3.0.0 | 2025-07-17 | 2025-07-17 | — | 376 萬 | 另一個 Argon2 實作，16 個月沒更新。 |

### 登入狀態（session cookie 或 token）

兩種做法：

- **session cookie**：登入後伺服器在資料庫記一筆「這個人登入了」，瀏覽器的 cookie 只放一個亂數 ID。要讓人登出或停用帳號，刪掉那一筆就好。
- **token（例如 JWT）**：伺服器簽一張「我是誰、幾點過期」的票給瀏覽器，伺服器不用記。缺點是發出去就很難收回，要等過期（推論：JWT 本身沒有收回機制，要自己加黑名單）。

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 需要 Rust | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|---|
| tower-sessions | 0.15.0 | 2026-02-01 | 2026-10-26 | — | 143 萬 | axum 用的 session 中介層。資料存哪由「store」決定；README 說應用程式「可以也應該」自己寫 store。 |
| tower-sessions-sqlx-store | 0.15.0 | 2025-01-01 | 2026-11-04 | — | 23 萬 | 把 session 存進 PostgreSQL。**crates.io 版依賴 sqlx ^0.8、tower-sessions-core ^0.14**，跟 tower-sessions 0.15、sqlx 0.9 不合。GitHub 主分支已改到 0.15（2026-02-13）和 sqlx 0.9（2026-07-12），還沒發版。 |
| axum-login | 0.18.0 | 2025-07-20 | 2026-06-19 | — | 64 萬 | 包好登入、登出、權限檢查。**crates.io 版依賴 tower-sessions ^0.14**；主分支 2026-05-07 已升 0.15，還沒發版。 |
| axum-extra（`cookie-private`、`cookie-signed`） | 0.12.6 | 2026-04-14 | 2026-11-03 | 1.80 | 1,548 萬 | axum 官方的加簽、加密 cookie。不管 session 存哪，自己做時用得到。 |
| cookie | 0.18.2 | 2026-08-08 | 2026-08-08 | 1.56 | 6,960 萬 | 底層 cookie 解析。 |
| jsonwebtoken | 11.1.0 | 2026-09-16 | 2026-10-04 | 1.88.0 | 6,969 萬 | 產生、驗證 JWT。 |
| actix-session / actix-identity | 0.11.0 / 0.9.0 | 2025-08-26 | 2026-11-03 | 1.80 | 43 萬 / 21 萬 | actix-web 用的 session 和登入。 |

tower-sessions 的 `SessionStore` 只有 `create`、`save`、`load`、`delete` 四個函式（tower-sessions-core 原始碼），自己用 sqlx 0.9 寫一個存 PostgreSQL 的不難（推論）。

### CSRF

CSRF：使用者登入後去逛別的網站，那個網站偷偷叫瀏覽器對我們的後端送請求；瀏覽器會自動帶上 cookie，後端以為是本人。用 session cookie 就要防。

OWASP CSRF 建議（摘要）：

- 用瀏覽器自動帶的 `Sec-Fetch-Site` 擋「cross-site」的請求；舊瀏覽器沒有這個標頭，所以**一定要退回檢查 `Origin`**。OWASP 寫主要瀏覽器 2023-03 起都支援。
- `SameSite` cookie 是「多一層保險」，不能只靠它。
- 不要用 GET 改資料。

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| axum_csrf | 0.12.0 | 2026-10-22 | 2026-10-22 | 5 萬 | token 做法（表單或標頭帶一個亂數）。支援 axum 0.8。用的人少。 |
| tower-csrf | 0.1.0 | 2025-09-02 | **已封存** | 35 | 說明寫「Go 1.25+ CSRF middleware port」。GitHub 已封存，不要用。 |
| axum-csrf-sync-pattern | 0.3.2 | 2024-04-05 | 2026-11-05 | 178 | OWASP token 做法。兩年半沒發版。 |
| actix-csrf | 0.8.0 | 2024-11-08 | 2024-11-24 | 2,541 | actix 用。兩年沒動。 |

前端放 GitHub Pages、後端放別的網域時，cookie 會變成「跨站」cookie，要 `SameSite=None`，CORS 也要設。這部分看 #181（主機）和 #182（登入安全）（推論）。

### 限制嘗試次數（rate limit）

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| governor | 0.10.4 | 2025-12-16 | 2026-08-24 | 2,238 萬 | 限流的演算法本身。可以用任何東西當 key（IP、email）。 |
| tower_governor | 0.8.0 | 2025-08-14 | 2025-08-14 | 214 萬 | 把 governor 包成 axum 中介層，用 IP 當 key。**15 個月沒更新。** |
| actix-governor | 0.10.0 | 2025-10-12 | 2026-08-24 | 14 萬 | actix 版。 |

- tower_governor 有三種 key：連線 IP（預設）、`SmartIpKeyExtractor`（先看 `x-forwarded-for`、`x-real-ip`、`forwarded`，沒有才用連線 IP）、全部共用一個 key。
- 放在代理伺服器後面才該信 `x-forwarded-for`；沒有代理時，這些標頭別人可以亂填（推論）。
- 「同一個帳號試錯 5 次就鎖」這種，用 governor 以 email 當 key，或在 PostgreSQL 記失敗次數（推論）。governor 只存在記憶體，伺服器重開就歸零（推論）。

## 5. 寄信

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 需要 Rust | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|---|
| lettre | 0.11.23 | 2026-08-03 | 2026-10-02 | 1.85 | 875 萬 | 走 SMTP，哪家寄信服務都能用。要非同步開 `tokio1`；TLS 預設用 native-tls，可改 `tokio1-rustls`。 |
| resend-rs | 0.35.2 | 2026-11-05 | 2026-11-05 | — | 42 萬 | Resend 官方 SDK（Resend 文件有 Rust 教學）。用 HTTP API；底下是 reqwest 0.13。 |
| aws-sdk-sesv2 | 1.145.0 | 2026-10-30 | 2026-11-05 | 1.94.1 | 149 萬 | AWS SES 官方 SDK（awslabs/aws-sdk-rust）。要先弄好 AWS 帳號和金鑰（推論）。 |
| postmark | 2.0.1 | 2026-05-28 | 2026-05-28 | — | 1 萬 | Postmark 的 SDK，repo 在個人帳號（pastjean），不是官方。 |

- Resend 也開 SMTP（`smtp.resend.com`，帳號 `resend`，密碼是 API key）。所以用 lettre 也能寄 Resend。
- 選哪家寄信服務看 #181。用 lettre 走 SMTP，換服務只要改設定（推論）。

## 6. WebSocket（即時看到別人改的東西）

WebSocket：瀏覽器和伺服器之間開一條一直連著的線，伺服器有新東西可以馬上推過去。

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| axum（`ws` 功能） | 0.8.9 | 2026-04-14 | 2026-11-03 | — | 內建。底下用 tokio-tungstenite ^0.29。官方有 `websockets`、`chat`、`testing-websockets` 範例。 |
| tokio-tungstenite | 0.30.0 | 2026-07-11 | 2026-10-24 | 1.1 億 | 不靠框架的 WebSocket。 |
| actix-ws | 0.4.0 | 2026-02-24 | 2026-11-03 | 65 萬 | actix 版。 |
| yrs | 0.28.1 | 2026-11-04 | 2026-11-04 | 235 萬 | Yjs（CRDT）的 Rust 版。前端配 npm `yjs` 13.6.33。 |

- 只要「伺服器推給瀏覽器」單向的話，axum 也內建 SSE（`axum::response::sse`），比 WebSocket 簡單（推論）。
- 開不只一台伺服器時，要讓 A 台知道 B 台有人改了。sqlx 支援 PostgreSQL 的 `LISTEN`／`NOTIFY`，可以拿來傳話（推論：做法；支援是 sqlx README 寫的）。
- CRDT：一種資料結構，兩個人同時改，合起來不會打架。要不要用看 #179、#185。地圖 Notes 猜「改流程通常一次一個教練」，那就用不到（推論）。

## 7. 設定、log、錯誤處理、測試

### 設定

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| config | 0.15.27 | 2026-09-30 | 2026-11-05 | 2,225 萬 | 一層一層疊：設定檔、環境變數。需要 Rust 1.88.0。 |
| figment | 0.10.19 | 2024-05-17 | 2026-10-13 | 1,342 萬 | 跟 config 類似。兩年半沒發版，repo 還有動。 |
| dotenvy | 0.15.7 | 2023-03-22 | 2026-08-18 | 6,411 萬 | 開發時從 `.env` 檔讀環境變數。三年半沒發版，但功能很小。 |
| envy | 0.4.2 | 2021-01-04 | 2024-06-07 | 462 萬 | 把環境變數直接讀成 Rust struct。很久沒動。 |

### log

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| tracing | 0.1.44 | 2025-12-18 | 2026-11-05 | 2.6 億 | 放在 tokio-rs 底下的 log。可以記「這個請求從頭到尾」的範圍（span）。axum、sqlx、tower-http 都用它。 |
| tracing-subscriber | 0.3.23 | 2026-03-13 | 2026-11-05 | 1.9 億 | 決定 tracing 的 log 印到哪、什麼格式（文字或 JSON）。 |
| log + env_logger | 0.4.35 + 0.11.11 | 2026-10-30 / 2026-06-25 | 2026-10-30 / 2026-11-02 | 3.7 億 / 9,597 萬 | 較舊、較簡單的 log。只有一行一行的訊息，沒有範圍。 |

tower-http 的 `trace` 功能可以每個請求自動記一筆 tracing log。

### 錯誤處理

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| thiserror | 2.0.21 | 2026-09-23 | 2026-10-16 | 5.0 億 | 幫自己定義的錯誤型別少寫樣板。適合「哪種錯回哪個 HTTP 狀態碼」。 |
| anyhow | 1.0.104 | 2026-07-18 | 2026-11-03 | 2.8 億 | 什麼錯都裝得下，適合 `main`、腳本。 |
| eyre / color-eyre | 0.6.14 / 0.6.5 | 2026-08-11 / 2025-05-30 | 2026-08-11 | 2,606 萬 / 1,550 萬 | anyhow 的另一版，錯誤報告比較漂亮。 |

### 測試

Rust 內建 `cargo test`，不用另外裝測試框架。

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| `#[tokio::test]` | （tokio 內建） | — | — | — | 讓測試函式可以是 async。 |
| `#[sqlx::test]` | （sqlx 內建） | — | — | — | 每個測試自動開一個新的測試資料庫、跑完遷移，互不干擾。要有 PostgreSQL 可連。 |
| tower `ServiceExt::oneshot` | （tower 內建） | — | — | — | 不開網路埠，直接把一個請求丟給 axum app。axum 官方 `testing` 範例的做法。 |
| axum-test | 21.1.0（另有 22.0.0-rc.1） | 2026-08-20 | 2026-08-24 | 523 萬 | 包好的 axum 測試用伺服器，寫起來短。需要 Rust 1.89。 |
| testcontainers | 0.28.0 | 2026-08-06 | 2026-11-02 | 1,807 萬 | 測試時用 Docker 開一個真的 PostgreSQL。 |
| testcontainers-modules | 0.15.0 | 2026-02-21 | 2026-10-19 | 1,341 萬 | 現成的 PostgreSQL 等設定。**依賴 testcontainers ^0.27**，用它就不能用 0.28。 |
| cargo-nextest | 0.9.151 | 2026-11-03 | 2026-11-05 | 185 萬 | 另一個測試執行器。官網寫「最多比 `cargo test` 快 3 倍」、每個測試分開跑。需要 Rust 1.91。 |
| insta | 1.49.0 | 2026-10-03 | 2026-10-26 | 3,770 萬 | 快照測試：第一次存下輸出，之後比對有沒有變。 |
| mockall | 0.15.0 | 2026-06-28 | 2026-11-03 | 3,435 萬 | 假物件（mock）。 |
| reqwest | 0.13.5 | 2026-09-08 | 2026-10-19 | 2.5 億 | HTTP client。對真的伺服器送請求時用。 |

### 其他幾乎一定會用的

| 套件 | 最新穩定版 | 發版日 | 需要 Rust | 用途 |
|---|---|---|---|---|
| serde | 1.0.229 | 2026-07-18 | 1.56 | Rust 型別和 JSON 互轉的基礎。 |
| serde_json | 1.0.154 | 2026-10-11 | 1.71 | JSON。 |
| uuid | 1.29.0 | 2026-10-23 | 1.89.0 | 流程、使用者的 ID。 |
| time / chrono | 0.3.55 / 0.4.45 | 2026-08-01 / 2026-06-04 | 1.88.0 / 1.62.0 | 時間。sqlx 兩個都支援；sqlx CHANGELOG 提到 tower-sessions-sqlx-store 會開 `time`，跟用 `chrono` 的專案可能衝突。 |
| validator / garde | 0.21.0 / 0.23.0 | 2026-07-27 / 2026-05-23 | 1.88 / 1.87 | 檢查輸入（例如 email 格式、名字長度）。 |

## 8. 前端（TypeScript）和後端共用型別

兩條路：

- **A. 從 Rust 型別直接產生 `.ts` 檔**：只有型別，最簡單。
- **B. 先產生 OpenAPI**：OpenAPI 是一份描述「有哪些網址、送什麼、回什麼」的 JSON 說明書。再用前端工具把它轉成 TypeScript 型別，甚至 API 呼叫函式。設定比較多，但連網址和狀態碼都對得上。

### A. 直接產生 TypeScript

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| ts-rs | 12.0.1 | 2026-01-31 | 2026-10-31 | 1,005 萬 | 型別加 `#[derive(TS)]`、`#[ts(export)]`，跑 `cargo test` 就寫出 `bindings/*.ts`。需要 Rust 1.78.0。 |
| typeshare + typeshare-cli | 1.0.5 + 1.13.4 | 2026-01-02 / 2025-12-11 | 2026-11-01 | 184 萬 / 4 萬 | 1Password 做的。用指令 `typeshare` 掃整個專案；也能出 Swift、Kotlin。 |
| specta + specta-typescript | 1.0.5（另有 2.0.0-rc.28）+ 0.0.15 | 2023-07-17 / 2026-11-05 | 2026-11-06 | 161 萬 / 100 萬 | 很活躍，但 2.0 從 2023-07-17 起一直是 rc；穩定版 1.0.5 是 2023 年的。 |

### B. OpenAPI

| 套件 | 最新穩定版 | 發版日 | GitHub 最近更新 | 近 90 天下載 | 取捨 |
|---|---|---|---|---|---|
| utoipa | 6.0.0 | 2026-09-22 | 2026-10-20 | 2,147 萬 | 在 handler 上加標註，產生 OpenAPI。需要 Rust 1.88。 |
| utoipa-axum | 0.3.0 | 2026-09-22 | 2026-10-20 | 476 萬 | utoipa 和 axum 的整合：路由和 OpenAPI 寫在一起，比較不會漏寫（推論）。 |
| utoipa-scalar / utoipa-swagger-ui | 0.4.0 / 10.0.2 | 2026-09-22 / 2026-10-20 | 2026-10-20 | 140 萬 / 733 萬 | 產生可以點來點去的 API 說明網頁。 |
| aide | 0.15.1（另有 0.16.0-alpha.4） | 2025-08-19 | 2026-09-21 | 136 萬 | 另一種產生 OpenAPI 的方式。穩定版一年多沒更新；0.15.1 依賴 schemars ^0.9，不是最新的 1.x。 |
| schemars | 1.2.3 | 2026-10-12 | 2026-10-12 | 2.4 億 | 從 Rust 型別產生 JSON Schema。aide 靠它。 |

前端那一側（npm registry，2026-11-06）：

| npm 套件 | 最新版 | 發布日 | peer 依賴的 TypeScript | 取捨 |
|---|---|---|---|---|
| openapi-typescript | 7.13.0 | 2026-02-11 | `^5.x` | 只產生型別。peer 依賴沒寫 TypeScript 6，前端是 `typescript ^6.0.3`，npm 安裝可能報衝突（推論）。 |
| openapi-fetch | 0.17.0 | 2026-02-11 | — | 配 openapi-typescript，呼叫 API 時檢查型別。 |
| @hey-api/openapi-ts | 0.99.0 | 2026-06-22 | `>=5.5.3 \|\| >=6.0.0 \|\| 6.0.1-rc` | 型別加 API 呼叫函式。有寫支援 TypeScript 6。還在 0.x。 |

順帶：npm 上 `typescript` 最新是 7.0.2（2026-07-08）。前端現在用 6。

## 9. 開工當天要再查的

- Rust：1.100.0 預計 2026-11-12。
- PostgreSQL：19 RC 2 預定 2026-11-12，19.0 預定 2026-11-19。14 在 2026-11-12 停止支援。
- tower-sessions-sqlx-store、axum-login：主分支改好了，看有沒有發新版。
- testcontainers-modules：有沒有跟上 testcontainers 0.28。
- axum：有沒有出 0.9（會要改程式）。
- openapi-typescript：peer 依賴有沒有加 TypeScript 6。

## 沒找到

- sqlx、diesel、sea-orm 官方文件裡「支援到 PostgreSQL 幾版」的表。README、CHANGELOG 都沒寫。
- PostgreSQL 18.6 的發布日（versioning 頁只寫目前小版本）。
- 很多套件沒寫最低 Rust 版本（表上的「—」）。
- tower-http 0.7 跟 axum 0.8 一起用的官方說明；上面寫「應該能」是看依賴推的。

## 來源

查核日期都是 2026-11-06。

Rust：

- [stable 頻道清單 channel-rust-stable.toml](https://static.rust-lang.org/dist/channel-rust-stable.toml)：1.99.1、Cargo 0.100.0
- [Rust 官方部落格：Announcing Rust 1.99.1](https://blog.rust-lang.org/2026/10/15/Rust-1.99.1/)、[1.99.0](https://blog.rust-lang.org/2026/10/01/Rust-1.99.0/)
- [Rust Release notes](https://doc.rust-lang.org/stable/releases.html)：1.96.0 到 1.99.1 的日期
- [The Rust Book 附錄 G（每 6 週一版）](https://doc.rust-lang.org/book/appendix-07-nightly-rust.html)
- [Edition Guide](https://doc.rust-lang.org/edition-guide/print.html)、[Rust 2024（1.85.0）](https://doc.rust-lang.org/edition-guide/rust-2024/index.html)
- [Cargo：Specifying Dependencies（0.x 的相容規則）](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html)

PostgreSQL：

- [Versioning Policy](https://www.postgresql.org/support/versioning/)
- [PostgreSQL 19 RC 1 Released!](https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/)（2026-10-15）

crates.io（版號、發版日、需要 Rust、近 90 天下載、依賴版本）：

- 每個套件：`https://crates.io/api/v1/crates/<名字>`，例如 [axum](https://crates.io/api/v1/crates/axum)、[sqlx](https://crates.io/api/v1/crates/sqlx)
- 依賴表：`https://crates.io/api/v1/crates/<名字>/<版本>/dependencies`，例如 [tower-sessions-sqlx-store 0.15.0](https://crates.io/api/v1/crates/tower-sessions-sqlx-store/0.15.0/dependencies)、[axum-login 0.18.0](https://crates.io/api/v1/crates/axum-login/0.18.0/dependencies)、[testcontainers-modules 0.15.0](https://crates.io/api/v1/crates/testcontainers-modules/0.15.0/dependencies)、[sea-orm 2.0.4](https://crates.io/api/v1/crates/sea-orm/2.0.4/dependencies)、[axum 0.8.9](https://crates.io/api/v1/crates/axum/0.8.9/dependencies)
- [crates.io 原始碼：recent_crate_downloads 是 90 天](https://github.com/rust-lang/crates.io/blob/main/migrations/2019-03-22-162022_define_recent_crate_downloads_in_terms_of_version_downloads/up.sql)

GitHub（「GitHub 最近更新」用 `gh api repos/<owner>/<repo>` 的 `pushed_at`、`archived`）：

- [sqlx CHANGELOG](https://github.com/transact-rs/sqlx/blob/main/CHANGELOG.md)、[sqlx README](https://github.com/transact-rs/sqlx/blob/main/README.md)、[`#[sqlx::test]` 說明](https://github.com/transact-rs/sqlx/blob/main/src/macros/test.md)
- [tokio README（LTS）](https://github.com/tokio-rs/tokio/blob/master/README.md)
- [axum 範例資料夾](https://github.com/tokio-rs/axum/tree/main/examples)、[axum 的 sse.rs](https://github.com/tokio-rs/axum/blob/main/axum/src/response/sse.rs)、[axum releases](https://github.com/tokio-rs/axum/releases)
- [diesel-async README](https://github.com/diesel-rs/diesel_async/blob/main/README.md)
- [sea-orm-cli README](https://github.com/SeaQL/sea-orm/blob/master/sea-orm-cli/README.md)、[sea-orm-cli 遷移範本](https://github.com/SeaQL/sea-orm/tree/master/sea-orm-cli/template/migration/src)
- [argon2 params.rs（預設參數）](https://github.com/RustCrypto/password-hashes/blob/master/argon2/src/params.rs)
- [tower-sessions README（store 清單）](https://github.com/maxcountryman/tower-sessions/blob/main/README.md)、[SessionStore 原始碼](https://github.com/maxcountryman/tower-sessions/blob/main/tower-sessions-core/src/session_store.rs)
- [tower-sessions-stores 提交紀錄](https://github.com/maxcountryman/tower-sessions-stores/commits/main)、[sqlx-store Cargo.toml](https://github.com/maxcountryman/tower-sessions-stores/blob/main/sqlx-store/Cargo.toml)
- [axum-login 提交紀錄](https://github.com/maxcountryman/axum-login/commits/main)、[axum-login Cargo.toml](https://github.com/maxcountryman/axum-login/blob/main/axum-login/Cargo.toml)
- [tower_governor README（key 的種類）](https://github.com/benwis/tower-governor/blob/main/README.md)
- [axum_csrf README](https://github.com/AscendingCreations/AxumCSRF/blob/main/README.md)
- [tower-csrf（已封存）](https://github.com/yawn/tower-csrf)
- [ts-rs README](https://github.com/Aleph-Alpha/ts-rs/blob/main/README.md)、[typeshare README](https://github.com/1Password/typeshare/blob/main/README.md)

其他：

- [Diesel：Getting Started（up.sql、down.sql、schema.rs）](https://diesel.rs/guides/getting-started.html)
- [cargo-nextest 官網](https://nexte.st/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Resend：Send emails with Rust](https://resend.com/docs/send-with-rust)、[Resend：Send emails with SMTP](https://resend.com/docs/send-with-smtp)
- npm registry：[openapi-typescript](https://registry.npmjs.org/openapi-typescript)、[openapi-fetch](https://registry.npmjs.org/openapi-fetch)、[@hey-api/openapi-ts](https://registry.npmjs.org/@hey-api%2Fopenapi-ts)、[typescript](https://registry.npmjs.org/typescript)、[yjs](https://registry.npmjs.org/yjs)

## 建議的組合

這只是建議，#188 由人決定。理由都是推論。

| 部分 | 建議 | 為什麼 |
|---|---|---|
| Rust | 開工當天的 stable（今天 1.99.1）、edition 2024 | 地圖 Notes 的規則。上面所有套件要求的 Rust 都不超過 1.94.1。 |
| 框架 | axum 0.8 + tokio 1.54 + tower-http 0.7 | 兩個框架裡用的人比較多；log、CORS、限流、session 都能用 tower 的中介層。還在 0.x 是主要缺點。 |
| 資料庫 | PostgreSQL 18（11-19 後開工可考慮 19.0，看 #181 的主機有沒有） | 18 是今天的最新穩定版。 |
| 存取資料庫 | sqlx 0.9，遷移用 `sqlx::migrate!` + sqlx-cli | 資料表不多，直接寫 SQL 最好懂；編譯時就檢查 SQL。不用多學 ORM。 |
| 密碼 | argon2 0.6，用預設參數 | 預設就是 OWASP 的最低建議。password-auth 才剛出 2.0。 |
| 登入狀態 | session cookie：tower-sessions 0.15，自己用 sqlx 0.9 寫一個存 PostgreSQL 的 store；不用 axum-login | 管理員停用帳號要馬上生效，session 刪掉就好。現成的 store 和 axum-login 都還綁舊版。只有密碼登入，自己寫登入、登出不多。 |
| CSRF | 自己寫一層中介層：檢查 `Sec-Fetch-Site`，沒有就檢查 `Origin`；cookie 加 `SameSite` | OWASP 的做法；現成套件都很小或已封存。細節等 #181、#182 定網域。 |
| 限制次數 | governor 0.10：IP 一個限制、email 一個限制 | tower_governor 15 個月沒更新；直接用 governor 也不難。要撐過重開就記在 PostgreSQL。 |
| 寄信 | lettre 0.11（SMTP + rustls） | 哪家服務都能用，換家只改設定。 |
| 即時更新 | axum 內建 `ws`（或 SSE）；CRDT 等 #185 再說 | 不用多裝套件。 |
| 設定 | 環境變數 + dotenvy（只在開發時讀 `.env`） | 設定項目少，不需要 config、figment 的分層。 |
| log | tracing + tracing-subscriber + tower-http `trace` | axum、sqlx 都用 tracing。 |
| 錯誤 | thiserror（API 錯誤）+ anyhow（`main`） | 同一個作者（dtolnay），一個管「定義好的錯」、一個管「什麼錯都收」，分工清楚。 |
| 測試 | `cargo test` + `#[sqlx::test]` + tower `oneshot`；之後想快再加 cargo-nextest | 不用 Docker 套件也能測到資料庫（要有 PostgreSQL 可連）。 |
| 共用型別 | ts-rs 12 | 只要型別的話最簡單；想要 API 說明書再加 utoipa 6 + @hey-api/openapi-ts（它有寫支援 TypeScript 6）。 |
