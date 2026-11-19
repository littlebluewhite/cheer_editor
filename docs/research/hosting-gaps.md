# R2／Fly／Neon／Resend／網域：補洞調查

Issue #188（地圖 #177）的補充調查，補 `docs/research/hosting.md`（#181）沒查到的部分。

- 查核日期：2026-11-06（下文所有來源都在這天讀過）
- 範圍：只回答上一輪留下的六個問題。不做決定。
- 標記：「推論」是我自己推出來的，不是來源原文。「查不到」是我讀不到或來源沒寫。
- 價格、版本、免費額度都會變。對外使用前請再查一次。

---

## 0. 先看這幾點（最影響決策）

1. **R2 預簽網址最長 7 天；只支援 GET／HEAD／PUT／DELETE；不支援 POST 表單上傳**。所以沒有 S3 那種「content-length-range」上傳大小限制。Cloudflare 文件只教「把 Content-Type 簽進去」來限制檔案類型。〔R2 Presigned URLs〕
2. **預簽網址只能用在 `<ACCOUNT_ID>.r2.cloudflarestorage.com`，不能用自訂網域**。瀏覽器直傳直下一定要在 bucket 設 CORS。過期的預簽網址回 403，而且**不帶 CORS 標頭**，前端 JS 讀不到錯誤內容。〔R2 Presigned URLs、R2 CORS〕
3. **Cloudflare 官方 R2 文件裡，Rust 只列 `aws-sdk-s3`**，並有預簽 GET／PUT 範例。`aws-sdk-s3` 預設 features 會多拉一套舊版 hyper 0.14／rustls 0.21（官方 issue #1339 仍開著）。最輕的是 `rusty-s3`（只做簽章、不發請求）。〔R2 aws-sdk-rust 頁、crates.io、GitHub〕
4. **R2 免費額度**：每月 10 GB-month 儲存、100 萬次 Class A、1,000 萬次 Class B，**出站流量免費**。官方文件寫「要先完成 checkout 加 R2 訂閱」；帳務政策寫「啟用訂閱前要有有效付款方式」。推論：實務上要綁卡。〔R2 Pricing、R2 Get started、Billing policy〕
5. **Fly 價格（依 Fly 文件頁內的計價公式算出）**：shared-cpu-1x 512 MB 常開，`sin` 約 **US$4.69／30 天**，`nrt` 約 **US$4.83／30 天**。Fly **沒有免費方案**，只有 US$1、7 天試用；組織都要綁信用卡。Fly 官網價目頁另寫「未滿 US$5 的帳單免收」，但文件頁沒寫，不要依賴。〔Fly Resource Pricing、fly.io/pricing〕
6. **Fly 官方文件沒寫封鎖 SMTP 埠**。文件建議改用交易型郵件服務（點名 Resend）。用 Resend HTTPS API（443）就不用管這件事。〔Fly Troubleshooting〕
7. **Neon 目前支援 Postgres 14–18，沒有 19 預覽**（changelog 只說「19 支援在路上」）。免費方案可選新加坡。免費：每專案每月 100 CU-hours、1 GB 儲存、還原窗 6 小時。〔Neon 文件〕
8. **Cloudflare Registrar 一定要用 Cloudflare DNS**（官方 FAQ：不能用第三方 nameserver）。Porkbun `.com` 註冊／續約／轉入都是 US$11.81（官方 API）。Cloudflare `.com` 實價我讀不到官方頁面。〔Registrar FAQ、Porkbun API〕

---

## 1. 從 Rust 用 R2（預簽網址）

### 1.1 Crate 比較

依賴數的量法（我自己跑的）：建一個基準專案 `axum 0.8.9 + tokio 1.54.1(full) + sqlx 0.9.0(postgres, runtime-tokio, tls-rustls-ring-webpki, macros, migrate) + resend-rs 0.35.2(rustls-tls)`，用 `cargo generate-lockfile` 解析，基準是 275 個套件。再分別加上各 S3 crate，算 Cargo.lock 多出幾個套件。注意：Cargo.lock 會列出所有平台的依賴（例如 windows-*），所以數字偏高，只適合互相比較。沒有實際編譯，也沒量二進位大小。

| Crate | 最新穩定版（發佈日） | 維護狀況 | 預簽支援 | R2 相關 | 依賴（加在基準上多幾個） |
|---|---|---|---|---|---|
| `aws-sdk-s3` | 1.157.0（2026-10-30） | AWS 官方；repo 最後推送 2026-11-05；MSRV 1.94.1；Apache-2.0 | `put_object()/get_object()…​.presigned(PresigningConfig::expires_in(d))`，回傳 `PresignedRequest`（method、uri、headers） | **Cloudflare 官方 R2 文件唯一列出的 Rust SDK**，有預簽 GET／PUT 範例 | 預設 features：+69；`default-features=false, features=["rt-tokio"]`：+38；再加 `aws-config`：+75 |
| `object_store` | 0.14.2（2026-09-15） | Apache Arrow 專案；repo 最後推送 2026-11-01；MSRV 1.85 | `Signer` trait：`signed_url(method, path, expires_in)`；另有 `signed_url_opts` + `SignedUrlOptions::with_signed_header` | crate 文件的 `with_url` 列出 `https://ACCOUNT_ID.r2.cloudflarestorage.com/bucket` 格式；Cloudflare 文件沒提 | `features=["aws"]`：+19（因為 reqwest 已經被 resend-rs 拉進來） |
| `rust-s3` | 0.38.0（2026-10-04） | 社群；repo 最後推送 2026-11-01 | `presign_get(path, expiry_secs: u32, …)`、`presign_put(path, expiry_secs, custom_headers, …)`、`presign_post(PostPolicy)`、`presign_delete` | 依賴的 `aws-region 0.29.0` 有 `Region::R2 { account_id }`、`Region::R2Eu`；Cloudflare 文件沒提 | 預設用 native-tls（OpenSSL）；改 `tokio-rustls-tls`：+42（含 sysinfo、attohttpc 等） |
| `rusty-s3` | 0.11.0（2026-10-27） | 社群；repo 最後推送 2026-10-27；MSRV 1.89；BSD-2-Clause | Sans-IO：只產生簽好的 URL，「不發送任何請求」；`bucket.put_object(Some(&creds), key).sign(Duration)`；`headers_mut()` 是「會被簽進去的標頭」 | 有 `UrlStyle`（path／virtual-host）；Cloudflare 文件沒提 | +12（單獨一個專案共 73） |

細節與坑：

- `aws-sdk-s3` 的 `PresignedRequest::headers()` 文件原文：回傳「需要跟著請求一起送的 HTTP 標頭（Host 除外）」。〔docs.rs aws-sdk-s3 PresignedRequest〕
- 2025 年 2 月有 bug：預簽後才加上 `x-amz-checksum-mode` 標頭，導致簽章不符。官方在 `aws-sdk-s3` 1.75.0 修好（issue #1253，2025-02-14 關閉）。推論：瀏覽器用預簽 PUT 時，要把 `PresignedRequest` 回傳的標頭一起送，並把它們加進 bucket CORS 的 `AllowedHeaders`。
- `aws-sdk-s3` 預設 features 會拉進 `hyper 0.14.32`、`rustls 0.21.12`、`hyper-rustls 0.24.2`，和你專案的 `hyper 1.x`／`rustls 0.23` 並存（我在 lockfile 看到）。官方 issue #1339「Legacy dependencies cause duplicated crates」仍是 open。
- 推論：只做「產生預簽網址」不需要 HTTP client。`aws-sdk-s3` 關掉預設 features 後能否正常 `presigned()`，我沒有實測。
- 推論：`rusty-s3` 最貼近「只要簽網址」的需求，依賴最少；但它不在 Cloudflare 文件裡，相容性要自己測。`object_store` 是通用儲存抽象層，功能比需要的多。`object_store` 的 `SignedUrlOptions` 是否被 `AmazonS3` 支援，文件頁沒寫，查不到。

### 1.2 R2 預簽網址的限制（Cloudflare 文件，2026-10-26 更新）

- 有效期：**1 秒到 7 天（604,800 秒）**。
- 支援操作：`GET`、`HEAD`、`PUT`、`DELETE`。**`POST`（HTML 表單上傳）不支援。**
- 產生網址時不需要連 R2，只要 R2 API 金鑰和 SigV4 簽章。
- 限制檔案類型：把 `Content-Type` 簽進去；上傳時送不同的 `Content-Type` 會得到 `403 SignatureDoesNotMatch`。
- 限制檔案大小：**文件沒有寫**。因為不支援 POST policy，所以沒有 `content-length-range`。推論：理論上可把固定的 `Content-Length` 簽進 SigV4，但 R2 是否會驗，我查不到也沒測。實務上可能要在上傳完成後用 `HeadObject` 檢查大小，太大就刪掉（推論）。
- 同一個預簽網址在到期前可以重複使用。
- **不能用在自訂網域**，只能用 `<ACCOUNT_ID>.r2.cloudflarestorage.com`。
- 單次 PUT 上限約 4.995 GiB，60 MB 沒問題。〔R2 Limits〕
- 驗證失敗的請求（401、403 SignatureDoesNotMatch／ExpiredRequest、AccessDenied）**不計費**。〔R2 Pricing FAQ〕
- 另一種做法：R2 有「temporary credentials」，可給一組有範圍限制的臨時金鑰。〔R2 Presigned URLs 頁〕

### 1.3 Bucket CORS（瀏覽器直傳直下必設）

- 文件原文：沒有 CORS 政策，瀏覽器用預簽網址上傳、下載都會失敗，即使網址本身有效。
- 要設的欄位：
  - `AllowedOrigins`：只能 `scheme://host[:port]`，不能帶路徑。最多一個 `*`。埠不能用萬用字元，`localhost:3000`、`localhost:5173` 要分開列。
  - `AllowedMethods`：依用途 `GET`、`PUT`、`HEAD`、`DELETE`。
  - `AllowedHeaders`：用戶端會送的標頭，例如 `Content-Type`。
  - `ExposeHeaders`（選用）：要讓 JS 讀 `ETag`、`Content-Length` 就要列出。
  - `MaxAgeSeconds`（選用）：最大 86400；瀏覽器可能只採 2 小時。
- 設定方式：Dashboard（bucket → Settings → CORS Policy），或 `npx wrangler r2 bucket cors set <BUCKET> --file cors.json`。
- 生效最久可能要 30 秒。
- 只有帶 `Origin` 標頭的請求才會收到 CORS 回應標頭（用 curl 測要自己加 `Origin`）。
- 過期預簽網址回 `403 ExpiredRequest` 且不帶 CORS 標頭。文件建議在過期前換新網址。

### 1.4 Service worker 能不能把 R2 回應快取起來離線用

- **可以，前提是用 CORS 模式取**（R2 已設 CORS）。
  - 不是 CORS 的跨來源回應叫「opaque response」，JS 讀不到內容。Chrome 會把每個 opaque response 在配額上至少算約 7 MB。〔Chrome Workbox：Caching resources during runtime〕
  - MDN：`Cache.put` 可以存任何 request／response 組合（包括 opaque）。〔MDN Cache.put，2025-06-24 更新〕
  - 推論：CORS 回應可讀、可正常計算大小，適合存起來。
- **快取鍵要自己定**。預簽網址的 query string 每次都不同。
  - 推論：建議用自己的固定鍵存，例如 `cache.put(new Request('/offline-music/<id>'), response)`。
  - 或查詢時用 `ignoreSearch: true`（MDN：忽略 URL 的 query string）。〔MDN Cache.match〕
- **音樂播放會用 Range 請求**。Workbox 文件：
  - 播放中「邊播邊快取」不可行，因為網路只抓部分內容（206）。
  - 要事先把整個檔案放進快取（`cache.add()`、precache 等），再用 `workbox-range-requests` 外掛回應 Range。
  - `<audio>`／`<video>` 要加 `crossorigin`，「同來源也要加」。〔Chrome Workbox：Serving cached audio and video〕
- **容量**：5 份流程 × 每首最多 60 MB ≈ 300 MB（推論的上限估算）。
  - Chrome：單一來源最多可用磁碟 60%。〔web.dev Storage for the web；頁面無更新日期〕
  - Safari（WebKit 2023-08-10 部落格）：瀏覽器 App 單一來源上限為磁碟 60%；Safari 17 起支援 `navigator.storage.persist()`，是否核准依啟發式規則（例如是否為主畫面 Web App）；淘汰依最少使用順序、以整個來源為單位。這是 2023 年的文章，可能已變。

---

## 2. R2 免費額度與帳務

- 免費（每月，只限 Standard 儲存，不含 Infrequent Access）：〔R2 Pricing，2026-10-30 更新〕
  - 儲存：10 GB-month
  - Class A：100 萬次
  - Class B：1,000 萬次
  - 出站流量：免費
- 超過後（Standard）：儲存 US$0.015／GB-month；Class A US$4.50／百萬次；Class B US$0.36／百萬次。用量會無條件進位到下一個計費單位。
- 出站免費的範圍：直接從 R2 出去，包括 Workers API、S3 API、`r2.dev`。接其他計費服務可能另外收費。
- 操作分類：`PutObject`、`ListObjects`、`CreateMultipartUpload`、`UploadPart` 等是 Class A；`GetObject`、`HeadObject` 是 Class B；`DeleteObject` 免費。
  - 推論：每次下載音樂是 1 次 Class B；播放器若對 R2 直接發多次 Range 請求，每次都算。用 service worker 先整檔快取可減少次數。
- **要不要綁付款方式**：
  - R2 Get started 原文：「需要有 R2 訂閱的 Cloudflare 帳號……完成 checkout 流程把 R2 訂閱加到帳號」，並說「R2 免費開始，含每月免費用量」。〔R2 Get started〕
  - Billing policy 原文：「啟用訂閱前，請確認你使用有效的付款方式」。對用量計費服務，Cloudflare 可能預先授權信用卡；付款失敗時 R2 bucket 會無法存取，30 天內沒更新付款方式資料可能被刪。〔Cloudflare Billing policy，2026-05-29〕
  - 官方文件**沒有一句話直接寫「免費額度也要綁卡」**。Cloudflare 社群有標題為「Why using R2 free tier involves giving card info?」的討論串，但該站回 403，我讀不到內容。
  - 推論：實務上要綁付款方式；而且 R2 用量沒有上限開關，超過就照價收費。

---

## 3. Fly.io

### 3.1 shared-cpu-1x 512 MB 常開月費

Fly 文件的區域價目表是用 JavaScript 算出來的，Markdown 版是空的。我從頁面原始碼讀到公式和常數，自己算：

- 公式：`每秒價格 = (vCPU 數 × 每 vCPU 秒價 + (RAM GB − vCPU 數 × 0.25) × 每 GB 秒價) × 區域倍率`
- 常數：shared 每 vCPU 秒 US$8.465e-7；每 GB RAM 秒 US$2.316e-6；shared 每 vCPU 含 0.25 GB；一個月 = 2,592,000 秒（30 天）。
- 區域倍率：`sin` 1.269230769；`nrt` 1.307692308；`iad` 1.0。

| 區域 | 每小時 | 每 30 天 | 每 31 天 |
|---|---|---|---|
| `iad`（基準，文件明列 US$3.69） | US$0.0051 | US$3.69 | US$3.82 |
| **`sin` 新加坡** | US$0.0065 | **US$4.69** | US$4.85 |
| **`nrt` 東京** | US$0.0067 | **US$4.83** | US$4.99 |

- 驗算：用同一公式算 1 GB 機器在 `sin` 得 US$8.50，和文件範例「One shared-cpu-1x 1GB Machine in Singapore (sin) $8.50」一致。fly.io/pricing 的區域表寫 256 MB `sin` US$2.78、`nrt` US$2.87，也和公式一致。
- 我沒有成功讀到 fly.io/calculator 的互動結果（JS 頁面）。
- 其他費用：
  - 出站流量：亞太 US$0.04／GB；入站免費。
  - 共用 IPv4 與 IPv6 免費；獨立 IPv4 US$2／月。
  - TLS 憑證：每個組織前 10 個單一主機名憑證免費，之後 US$0.10／月；萬用字元 US$1／月。
  - 停止的 Machine：rootfs 每 GB US$0.15／月。

### 3.2 免費額度與試用

- 文件原文：「Is there a free tier? No.」新組織沒有免費方案，也沒有每月免費額度。〔Fly Resource Pricing〕
- 試用：US$1 額度，7 天或用完為止，不用信用卡。試用期 Machine 跑 5 分鐘會自動停；最多 10 台、最大 shared-cpu-2x 4 GB。用完後要加信用卡才能再啟動。〔Fly Free Trial〕
- 文件原文：「All organizations (except for Linked Organizations) require a credit card on file.」
- 舊方案（2024-10-07 前購買的 Hobby／Launch／Scale）的免費額度仍保留，新帳號沒有。〔Fly Discontinued Plans〕
- fly.io/pricing 頁面寫「Invoices under $5 are waived.」我在 docs 的 Pricing、Billing 頁沒找到這句。推論：`sin` 30 天 US$4.69 加少量出站可能剛好在 US$5 附近，31 天的月份會更接近，不要把「免收」當成規劃依據。

### 3.3 SMTP 外連埠

- **Fly 官方文件沒有寫封鎖 25／465／587**。
- Troubleshooting 文件原文：寄信有問題時，「建議使用交易型郵件服務（例如 Postmark、Resend、SendGrid），而不是直接從 Machine 寄」。〔Fly Troubleshoot your deployment〕
- 社群（非官方文件）：
  - 2026-08-23，帳號 `flyio-support` 回覆：「There's no per-account blocking of outbound port 25.」並說目前不提供自訂 PTR（反解）記錄，大型收信方可能拒收直送郵件。〔community.fly.io 討論串 28537〕
  - 2026-02-19，回覆「this port is not blocked」（討論 587）。〔community.fly.io 討論串 27164〕
- 結論：Resend 走 HTTPS API（443）就不用管 SMTP 埠。

### 3.4 對已部署的 App 跑一次性管理指令（例如「建立第一個管理員」）

| 方式 | 在哪裡跑 | 重點 |
|---|---|---|
| `fly ssh console -C "<cmd>"` | 正在跑的 Machine 裡 | 「Connect to a running instance」。預設使用者 root。有 `-C` 時預設不配 pty。你有 `min_machines_running = 1`，一定有一台在跑（推論）。 |
| `fly console [-C "<cmd>"]` | 新開一台臨時 Machine | 用最新 release 的映像檔與環境；App 本身不啟動、不接流量；離開後 Machine 銷毀。可在 `fly.toml` 設 `console_command`。 |
| `fly machine run <image> [command] --rm` | 新 Machine | `--rm` 結束後自動刪除。文件：App 的 secrets「預設會以環境變數出現在 App 的每台 Machine」；也可用 `--file-secret` 寫成檔案。 |
| `[deploy] release_command` | 每次部署前一台臨時 Machine | 每次部署嘗試跑一次；有網路、環境變數、secrets，沒有 volume；失敗就中止部署。適合跑資料庫 migration。 |

- 推論：「建立第一個管理員」是一次性的，用 `fly ssh console -C "/app/server create-admin …"` 或 `fly console -C …` 最直接。放進 `release_command` 會每次部署都跑，除非指令是冪等的。
- 推論：在 512 MB 常開機器上用 `fly ssh console` 跑，會和正在服務的程序共用記憶體；用 `fly console` 則另開一台、另外計費（時間很短）。

### 3.5 自訂網域 TLS（Cloudflare DNS，只做 DNS、不開代理）

- Fly 文件稱 DNS-only 是「最簡單、最可靠」的做法：〔Fly Understanding Cloudflare〕
  1. `A` 記錄指向 App 的 IPv4，`AAAA` 指向 IPv6（或子網域用 `CNAME` 指向 App 專屬目標）。
  2. Cloudflare 關閉代理（灰色雲）。
  3. Fly 自動用 Let's Encrypt 簽憑證。
- 驗證網域需要以下至少一項：`AAAA` 指向 App、`_acme-challenge` CNAME、或 `_fly-ownership` TXT。〔Fly Custom domains〕
- 根網域（apex）建議用 A／AAAA；apex 用 CNAME 只在 DNS 商支援 CNAME flattening 時才行。
- 坑：
  - 之後若改開橘色雲代理：要加 `_fly-ownership` TXT，Cloudflare SSL 設「Full (strict)」；用「Flexible」會無限轉址。
  - 若網域有 CAA 記錄，要允許 `letsencrypt.org`（文件列在代理模式的問題裡；推論：DNS-only 也適用）。
  - 萬用字元憑證要 DNS-01；同一主機名只能讓一個 App 管憑證；Let's Encrypt 有速率限制。
  - 用 `fly certs check <hostname>` 排查。

---

## 4. Neon

- **Postgres 版本**：目前支援 14、15、16、17、18。〔Neon Compatibility，2026-09-17；Version support，2026-10-09〕
  - 2026 年 8 月起各版最新小版本：18.6、17.11、16.15、15.19、14.24。
  - 小版本在下次 compute 重啟時自動套用；不能選舊小版本。
  - 升大版本要開新專案並搬資料。
  - **沒有 Postgres 19 預覽**。2026-07-10 changelog 原文：「We support Postgres 14 through 18 today, with Postgres 19 support on the way.」
- **新加坡**：區域清單有 `aws-ap-southeast-1`（Singapore）。文件說「可在上列任何區域建專案」，沒有寫依方案限制。〔Neon Regions，2026-10-14〕
- **免費方案**（US$0／月）：〔Neon Plans，2026-11-04〕
  - 專案：100 個；每專案 10 個 branch
  - Compute：**每專案每月 100 CU-hours**（約等於 0.25 CU 跑 400 小時）；自動擴展最多 2 CU
  - Scale to zero：閒置 5 分鐘後暫停，**免費方案不能關**
  - 儲存：**每專案 1 GB，全帳號最多 20 GB**
  - 公網傳輸：每專案 5 GB
  - **時間點還原（instant restore／PITR）**：歷史窗 **6 小時，且最多 1 GB 變更**
  - 手動快照：1 個；監控保留 1 天
  - 超過 CU-hours 或傳輸量：compute 暫停到下個計費週期；超過儲存：會增加資料的寫入失敗
- **閒置的定義**：「5 分鐘內沒有 active query」就進入 idle；真正閒置的連線會被關掉；session 內的東西（prepared statements、暫存表、advisory lock、LISTEN）會消失。〔Neon Compute lifecycle，2026-09-16〕
  - 推論：Fly 健康檢查如果每次都查資料庫，compute 會一直醒著。0.25 CU 跑整個月約 180 CU-hours，會超過免費的 100，然後被暫停。健康檢查最好不要碰資料庫。
  - 推論：sqlx 連線池要能接受連線被伺服器關掉（例如取用前檢查）。

---

## 5. Resend（從 Fly 寄信）

- **官方 SDK**：Resend「Official SDKs」頁列出 Rust → `github.com/resend/resend-rust`。「Send emails with Rust」文件用 `cargo add resend-rs`。另有「Send emails with Axum」教學。〔Resend SDKs、Send with Rust〕
- **`resend-rs` 最新版**：0.35.2（2026-11-05）。MIT。預設 feature 是 `native-tls`（OpenSSL），可改 `rustls-tls`。repo 最後推送 2026-11-05。〔crates.io〕
- **API 還是 SMTP**：
  - 我**沒找到** Resend 明寫「優先用 API 不要用 SMTP」。
  - 有找到的是：API 文件建議「多數情況用官方 SDK，不要直接打 API」。〔Resend API reference Introduction〕
  - SMTP 設定：`smtp.resend.com`，埠 25、465、587、2465、2587；帳號 `resend`，密碼是 API key；速率限制和 API 相同；不提供 SMTP 伺服器日誌。〔Resend Send with SMTP〕
  - 推論：從 Fly 用 SDK 走 HTTPS 最省事，也完全避開 SMTP 埠問題。
- **免費方案**：〔Resend Pricing、Account quotas and limits〕
  - 交易郵件：**每月 3,000 封、每日 100 封**（UTC 日界）
  - To／CC／BCC 每個收件人各算一封；收到的郵件也算
  - 驗證網域：3 個
  - 資料保留：30 天
  - 速率：所有帳號起始 10 requests／秒
  - 行銷郵件：1,000 個聯絡人／月

---

## 6. 網域註冊商

- **Cloudflare Registrar 綁 DNS**：FAQ 原文：「No, all domains on Cloudflare Registrar use Cloudflare nameservers」。要用別家 nameserver 就得把網域轉出。〔Registrar FAQ，2026-08-03〕
  - 子網域可以委派到別家 DNS。
  - 轉出限制：註冊、轉入或改註冊人資料後 60 天內不能轉出。〔Transfer out from Cloudflare〕
- **Cloudflare 定價方式**：「只收註冊局收的錢，不加價」。〔Registrar 首頁〕
- **Cloudflare `.com` 實價：查不到官方頁面**。
  - 產品頁沒有價格表；`domains.cloudflare.com` 回 403。
  - Registrar API 文件的範例回應寫 `acmecorp.com` US$8.57，但那只是範例格式，不代表現價，不要引用。
  - 相關事實：Verisign 公告 `.com` 註冊局批發價從 US$10.26 漲到 **US$10.97，2026-11-01 生效**（新註冊與續約）。〔Verisign 2026 Q1 財報新聞稿，SEC 8-K，2026-04-23〕
  - ICANN 每筆交易費 US$0.20／年（FY26 公告）。FY27 數字我沒查到。
  - 推論：Cloudflare `.com` 現價約 US$10.97 + US$0.20 ≈ **US$11.17／年**。下單前請在 Dashboard 或 Registrar API 的 Check 端點確認。
- **Porkbun `.com`**：官方公開 API（`/api/json/v3/pricing/get`）回傳：註冊 US$11.81、續約 US$11.81、轉入 US$11.81。另有首年折 US$1 的優惠碼（每人限一次）。網頁 porkbun.com/tld/com 也顯示 US$11.81。

---

## 7. 沒做到或讀不到的

- Cloudflare 社群兩個 R2 綁卡討論串：403，讀不到內文，只看到標題。
- Cloudflare `.com` 現價：沒有可讀的官方頁面，只能推算。
- Fly 價格計算機（fly.io/calculator）：JS 頁面，沒讀到結果；月費是用文件頁內公式自己算的。
- Verisign 投資人網站：403；改讀 SEC EDGAR 上同一份新聞稿。
- 沒有實際編譯任何 crate，也沒有量二進位大小；依賴數只來自 lockfile 解析。
- 沒有實測：R2 是否驗證簽進去的 `Content-Length`；`aws-sdk-s3` 關掉預設 features 後的預簽行為；`rusty-s3`／`rust-s3`／`object_store` 對 R2 的實際相容性。

---

## 來源（皆於 2026-11-06 查核）

R2／Cloudflare
- R2 aws-sdk-rust 範例（2026-04-21 更新）：https://developers.cloudflare.com/r2/examples/aws/aws-sdk-rust/
- R2 S3 SDK 清單：https://developers.cloudflare.com/r2/examples/aws/
- R2 Presigned URLs（2026-10-26 更新）：https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 Configure CORS（2026-09-23 更新）：https://developers.cloudflare.com/r2/buckets/cors/
- R2 Pricing（2026-10-30 更新）：https://developers.cloudflare.com/r2/pricing/
- R2 Get started：https://developers.cloudflare.com/r2/get-started/
- R2 Limits：https://developers.cloudflare.com/r2/platform/limits/
- R2 S3 API compatibility（2026-10-14 更新）：https://developers.cloudflare.com/r2/api/s3/api/
- Cloudflare Billing policy（2026-05-29）：https://developers.cloudflare.com/billing/understand/billing-policy/
- Cloudflare 社群（403，只見標題）：https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179

Rust crates
- crates.io API：https://crates.io/api/v1/crates/aws-sdk-s3 、/object_store 、/rust-s3 、/rusty-s3 、/resend-rs 、/aws-config
- docs.rs aws-sdk-s3 PresignedRequest：https://docs.rs/aws-sdk-s3/latest/aws_sdk_s3/presigning/struct.PresignedRequest.html
- docs.rs object_store Signer：https://docs.rs/object_store/latest/object_store/signer/trait.Signer.html
- docs.rs object_store SignedUrlOptions：https://docs.rs/object_store/latest/object_store/signer/struct.SignedUrlOptions.html
- docs.rs object_store AmazonS3Builder：https://docs.rs/object_store/latest/object_store/aws/struct.AmazonS3Builder.html
- docs.rs rust-s3 Bucket：https://docs.rs/rust-s3/latest/s3/bucket/struct.Bucket.html
- docs.rs aws-region Region：https://docs.rs/aws-region/latest/awsregion/enum.Region.html
- docs.rs rusty-s3：https://docs.rs/rusty-s3/latest/rusty_s3/ 、PutObject：https://docs.rs/rusty-s3/latest/rusty_s3/actions/struct.PutObject.html
- aws-sdk-rust issue #1253（預簽 checksum 標頭）：https://github.com/awslabs/aws-sdk-rust/issues/1253
- aws-sdk-rust issue #1339（舊版依賴重複）：https://github.com/awslabs/aws-sdk-rust/issues/1339

瀏覽器快取
- Chrome Workbox：Caching resources during runtime：https://developer.chrome.com/docs/workbox/caching-resources-during-runtime
- Chrome Workbox：Serving cached audio and video：https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video
- MDN Cache.put（2025-06-24）：https://developer.mozilla.org/en-US/docs/Web/API/Cache/put
- MDN Cache.match（2025-11-09）：https://developer.mozilla.org/en-US/docs/Web/API/Cache/match
- web.dev Storage for the web：https://web.dev/articles/storage-for-the-web
- WebKit Updates to Storage Policy（2023-08-10）：https://webkit.org/blog/14403/updates-to-storage-policy/

Fly.io
- Resource Pricing：https://docs.fly.io/about/pricing （Markdown：https://docs.fly.io/about/pricing.md）
- fly.io/pricing（含「Invoices under $5 are waived」）：https://fly.io/pricing/ （Markdown：https://fly.io/pricing.md）
- Free Trial：https://docs.fly.io/about/free-trial
- Billing：https://docs.fly.io/about/billing
- Discontinued Plans：https://docs.fly.io/about/discontinued-plans
- Troubleshoot your deployment：https://docs.fly.io/getting-started/troubleshooting
- 社群：port 25：https://community.fly.io/t/outbound-port-25-direct-to-mx-smtp-blocked-by-default-on-new-accounts/28537
- 社群：port 587：https://community.fly.io/t/request-to-unblock-outbound-smtp-port-587-for-app-rialma-api/27164
- fly ssh console：https://docs.fly.io/flyctl/cmd/fly_ssh_console
- fly console：https://docs.fly.io/flyctl/cmd/fly_console
- fly machine run（指令）：https://docs.fly.io/flyctl/cmd/fly_machine_run ；（指南）：https://docs.fly.io/machines/flyctl/fly-machine-run
- fly.toml 設定（release_command、console_command）：https://docs.fly.io/reference/configuration
- Deploy an app：https://docs.fly.io/launch/deploy
- Custom domains：https://docs.fly.io/networking/custom-domain
- Understanding Cloudflare：https://docs.fly.io/networking/understanding-cloudflare

Neon
- Postgres version support（2026-10-09）：https://neon.com/docs/postgresql/postgres-version-support
- Compatibility（2026-09-17）：https://neon.com/docs/reference/compatibility
- Changelog（2026-07-10 條目）：https://neon.com/docs/changelog
- Regions（2026-10-14）：https://neon.com/docs/introduction/regions
- Plans（2026-11-04）：https://neon.com/docs/introduction/plans
- Scale to zero（2026-11-04）：https://neon.com/docs/introduction/scale-to-zero
- Compute lifecycle（2026-09-16）：https://neon.com/docs/conceptual-guides/compute-lifecycle

Resend
- Official SDKs：https://resend.com/docs/sdks
- Send emails with Rust：https://resend.com/docs/send-with-rust
- Send emails with SMTP：https://resend.com/docs/send-with-smtp
- API reference Introduction：https://resend.com/docs/api-reference/introduction
- Account quotas and limits：https://resend.com/docs/knowledge-base/account-quotas-and-limits
- Pricing：https://resend.com/pricing

網域
- Cloudflare Registrar：https://developers.cloudflare.com/registrar/
- Registrar FAQ（2026-08-03）：https://developers.cloudflare.com/registrar/faq/
- Transfer out from Cloudflare：https://developers.cloudflare.com/registrar/account-options/transfer-out-from-cloudflare/
- Registrar API（2026-09-16）：https://developers.cloudflare.com/registrar/registrar-api/
- Cloudflare Registrar 產品頁：https://www.cloudflare.com/products/registrar/
- Verisign 2026 Q1 財報新聞稿（SEC）：https://www.sec.gov/Archives/edgar/data/1014473/000101447326000019/q12026earningsrelease.htm
- ICANN FY26 registrar fee 公告：https://itp.cdn.icann.org/en/files/contracted-parties-communications/registrar-fee-approved-fy26-17-07-2025-en.pdf （僅讀到搜尋摘要，未開原檔）
- Porkbun 價格 API：https://api.porkbun.com/api/json/v3/pricing/get
- Porkbun .com 頁：https://porkbun.com/tld/com
