# 部署與離線

## 部署

推上 `main` 後，`.github/workflows/deploy.yml` 會跑 Rust 伺服器的測試、前端測試、型別檢查、建置，任何一個沒過就停，全過才部署到 GitHub Pages：
`https://littlebluewhite.github.io/cheer_editor/`。

第一次要在 GitHub 上設定一次：Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
之後每次推 `main` 都會自動部署；也可以在 Actions 頁手動按 Run workflow。

## 網址底下的路徑（base path）

網站放在 `/cheer_editor/` 底下，由建置時的環境變數 `BASE_PATH` 決定（workflow 會帶 `/cheer_editor`）。
本機 `npm run dev`、`npm run build` 不設，就是 `/`。

要在本機看部署後的樣子：

```sh
BASE_PATH=/cheer_editor npm run build
BASE_PATH=/cheer_editor npm run preview   # 開 http://localhost:4173/cheer_editor/
```

程式裡的連結和檔案路徑用 `$app/paths` 的 `resolve()`／`asset()`，或用相對路徑，部署到 `/cheer_editor/` 底下才找得到。

## 本機跑伺服器

`server/` 是 Rust 伺服器（axum）。前端建好的檔案和 API 由它在同一個網址送出（ADR 0009）。
新網址底下沒有子路徑，所以建前端時**不要**設 `BASE_PATH`。

要先裝 Rust（`rustup`）、Node（在專案根目錄 `npm ci`）和一個 PostgreSQL。本機開發用 Neon 另開的 branch，連線字串寫進 `server/.env`：

```sh
npm run build                       # 建前端到 build/（不設 BASE_PATH）
cp server/.env.example server/.env  # 填 DATABASE_URL；.env 不進 git
cd server && cargo run              # 開 http://127.0.0.1:8080
```

- 啟動時會先跑 `server/migrations/` 的資料庫遷移。新的遷移加新檔（`0002_*.sql`…），已經上線的不要改。
- 伺服器用 QuickJS 跑流程核心（ADR 0010）：`cargo build` 時 `server/build.rs` 叫 `node scripts/core-bundle.mjs` 把 `src/lib/core/` 打包成一個 JS 檔、算指紋，編進程式。前端建置用同一支算指紋，兩邊一樣。所以 `cargo` 之前要先 `npm ci`；`cargo test` 也會叫 `node` 比對 QuickJS 和 Node 跑出來的結果。
- `/health` 是健康檢查，不碰資料庫（Neon 免費版沒人用時才睡得著）。
- 前端每頁建成 `<名字>.html`，所以 `/guide` 重新整理也打得開。其他找不到的路徑回 `200.html`（adapter 的 `fallback`），讓前端自己處理路由。
- log 只記請求的方法和路徑，不記查詢字串、標頭、內容。之後寫 log 也一樣：不記密碼、token、cookie、信的內容、流程內容；人用使用者 id，不寫 email。
- 寄信：`server/.env` 沒設 `RESEND_API_KEY` 時，信（含設密碼連結）印在終端機。信裡連結的網址是 `SITE_URL`（預設 `http://` 加 `LISTEN_ADDR`）。
- 登入的 cookie 是 `__Host-` 開頭、`Secure`：本機用 `http://127.0.0.1` 或 `http://localhost` 開，Chrome 照樣收；Safari 要 https。
- 改資料的 API 會看 `Sec-Fetch-Site`（沒有就看 `Origin`）擋別的網站送來的請求；用 curl 試要自己帶 `-H 'Sec-Fetch-Site: same-origin'`。

### 雲端流程的音樂檔（Cloudflare R2）

雲端流程的音樂檔放 R2，不經過伺服器（#249）：伺服器查權限、發 10 分鐘內有效的預簽網址，瀏覽器直接 PUT 上去；
傳完伺服器在 R2 查一次大小，超過 60 MB 就刪掉、退回。播放時瀏覽器拿下載的預簽網址，用 `fetch` 從 R2 拿下來解碼。
在 R2 的名字是 `flows/<流程 id>/<音樂檔 id>.<副檔名>`；換掉、刪掉的音樂在資料表 `flow_audio` 記下哪天不用了。

- 設定：`R2_ENDPOINT`（`https://<帳號 id>.r2.cloudflarestorage.com`）、`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。
  token 用「Object Read & Write」，只管這一個 bucket。沒設 `R2_ENDPOINT` 時放音樂、拿音樂的 API 回 503（其他照常）。
- **本機開發用另一個 bucket**（例：`cheer-music-dev`），不要指到正式的。
- bucket 的 CORS 只准新網址和本機開發（瀏覽器直接 PUT、GET 預簽網址才過得了）。R2 → bucket → Settings → CORS Policy：

```json
[
  {
    "AllowedOrigins": ["https://<新網址>"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

  開發用的 bucket 把 `AllowedOrigins` 換成 `["http://127.0.0.1:8080", "http://localhost:8080"]`。
- 伺服器測試不連 R2：`server/tests/music.rs` 開一台假的 R2（本機 HTTP，照 S3 的路徑收 PUT、HEAD、GET、DELETE，不驗簽名）。
  真的 R2 還沒接上實測過（#263）；`rusty-s3` 接不起來時換 `aws-sdk-s3`。

第一個管理員（也用來救進不去的管理員、換人當管理員）。沒有預設帳號、預設密碼：

```sh
cd server && cargo run -- create-admin --email 你的@email --name 你的名字
```

這個人變成管理員（原本的管理員不再是），收到一封設密碼信：還沒設過密碼是邀請（24 小時），設過是設新密碼（1 小時）。他之前沒用的連結作廢。
正式機用 `fly ssh console` 在機器上跑同一個指令。

前後端共用的訊息型別寫在 Rust（`#[derive(TS)]`），`cargo test` 時 ts-rs 把它們寫成 `src/lib/api-types/*.ts`（路徑設在 `server/.cargo/config.toml`）。
改了型別要跑一次 `cargo test`，產生的 .ts 一起 commit。

測試：

```sh
cd server && cargo test
```

`#[sqlx::test]` 的測試每個自己開一個乾淨的資料庫，要有 `DATABASE_URL` 指到一個能建資料庫的 PostgreSQL 帳號
（本機的 PostgreSQL 就好，不要用 Neon）。CI 用 GitHub Actions 的 `postgres:18` 服務。

## 離線

`@vite-pwa/sveltekit` 在建置時產生 `sw.js`（service worker）和 `manifest.webmanifest`，
把整個網站先存在瀏覽器裡。開過一次之後，沒網路也能打開。

更新：部署新版後，使用者重新整理時新的 service worker 會裝好並接手，頁面自動再載入一次，就是新版。
`npm run dev` 不會啟用 service worker，要試離線請用上面的 build + preview。

手動檢查離線：用 preview 或正式網址開一次，等頁面載完，開發者工具 Network 勾 Offline（或關掉 preview），重新整理，編輯器還能打開。

## App 圖示

圖示畫在 `static/favicon.svg`（墊子條紋加圓點，用 `src/app.css` 的顏色）。分頁上的 favicon、
iPhone／iPad 主畫面的 `apple-touch-icon.png`、PWA manifest 的 `pwa-192x192.png`／`pwa-512x512.png` 都從它產生。
`static/` 底下的檔會一起被 service worker 先存起來，離線也有圖示。

改了 SVG 就重新產生一次（要先裝 ImageMagick），產生的檔一起 commit：

```sh
sh scripts/app-icons.sh
```
