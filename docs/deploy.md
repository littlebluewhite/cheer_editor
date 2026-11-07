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

要先裝 Rust（`rustup`）和一個 PostgreSQL。本機開發用 Neon 另開的 branch，連線字串寫進 `server/.env`：

```sh
npm run build                       # 建前端到 build/（不設 BASE_PATH）
cp server/.env.example server/.env  # 填 DATABASE_URL；.env 不進 git
cd server && cargo run              # 開 http://127.0.0.1:8080
```

- 啟動時會先跑 `server/migrations/` 的資料庫遷移。新的遷移加新檔（`0002_*.sql`…），已經上線的不要改。
- `/health` 是健康檢查，不碰資料庫（Neon 免費版沒人用時才睡得著）。
- 前端每頁建成 `<名字>.html`，所以 `/guide` 重新整理也打得開。其他找不到的路徑回 `200.html`（adapter 的 `fallback`），讓前端自己處理路由。
- log 只記請求的方法和路徑，不記查詢字串、標頭、內容。之後寫 log 也一樣：不記密碼、token、cookie、信的內容、流程內容；人用使用者 id，不寫 email。

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
