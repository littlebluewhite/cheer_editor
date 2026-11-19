# 部署與離線

## 部署（Fly.io）

網站在 `https://littlebluewhite.com`：一台 Rust 伺服器同時送前端和 API，同一個網址（ADR 0012）。
Fly app `littlebluewhite`，新加坡 `sin`，一台 shared-cpu-1x 512 MB，一直開著（#188、#194）。

推上 `main` 後，`.github/workflows/fly-deploy.yml` 會：

1. 跑前端測試和型別檢查（`npm test`、`npm run check`），和 Rust 伺服器的測試（`cargo test`）。任何一個沒過就停，不部署。
2. 全過才 `flyctl deploy --ha=false`（只要一台：在場的人、全上誰拿著哪幾組只放這台的記憶體，ADR 0015）：在 Fly 的 builder 上照 `Dockerfile` 建映像檔（建好前端，不設 `BASE_PATH`，放進伺服器的映像檔）。
3. `fly.toml` 的 `release_command` 在一台臨時機器上跑 `/app/cheer-server migrate`（資料表遷移）。**沒跑成就不部署**，舊版照常接流量。
4. `bluegreen`：在旁邊開一台新的，`/health` 過了才切過去，不停機。切的時候 WebSocket 會斷，前端自己重連。

Actions 頁也能手動按 Run workflow（只部署 `main`）。沒有測試站，本機試過就上。
部署只在推 `main` 和手動按時跑；workflow 沒有 PR 的觸發，fork 來的 PR 拿不到 secrets。

- 設定在 `fly.toml`。不是金鑰的設定（`LISTEN_ADDR=0.0.0.0:8080`、`SITE_DIR=/app/build`、`RUST_LOG`）寫在它的 `[env]`；金鑰放 Fly secrets（下面「金鑰」）。
- `/health` 不碰資料庫：Neon 免費版 5 分鐘沒查詢才睡，一直查會把每月 100 CU 小時用完。
- log 只用 Fly 自己的（`fly logs`），留約 7 天。

### 第一次部署（網站主人）

Fly secrets、GitHub 的 `FLY_API_TOKEN` 已經設好（#263）。

1. 推 `main`（或 Actions 頁按 Run workflow），等 `Deploy to Fly` 跑完。
2. 看一次：打開 `https://littlebluewhite.fly.dev/`（網域接好後 `https://littlebluewhite.com/`）是編輯器；`/health` 回 `ok`；`fly status` **剛好一台**機器、健康檢查過。多了一台就 `fly scale count 1`。
3. 建第一個管理員（見「本機跑伺服器」的 `create-admin`）：

```sh
fly ssh console -C "/app/cheer-server create-admin --email 你的@email --name 你的名字"
```

網域接到 Fly（`fly certs`、Cloudflare DNS）、Better Stack 的監控在上線那天做（#269）。

### 資料表遷移：一次部署只加不刪

遷移是 `server/migrations/` 的 `.sql` 檔，編進伺服器裡。部署前 `release_command` 先跑；它跑的時候**舊版還在接流量、還在用資料庫**，所以：

- 一次部署只加：加表、加欄位（要有預設值或可以是空的）、加索引。舊版看不到新的欄位也照常跑。
- 要刪表、刪欄位、改名：分兩次部署。第一次讓程式不再用它；下一次才刪。
- 已經上線的遷移檔不要改（sqlx 會比對內容，改了就跑不起來）。新的加新檔，號碼接下去。
- 伺服器看到資料庫裡有它不認得、比較新的遷移（新版部署過，又倒回舊版的程式）照常啟動。只加不刪，舊版用多出來的表、欄位也沒事。

### 試一次：遷移失敗時不部署（網站主人）

推一個壞的遷移試不了：`cargo test` 會先失敗，根本不會部署。所以第一次部署成功後，從自己電腦部署一次：

1. 先切到 `main`、跟現在線上那版同一個 commit（`git pull`）。加一個一定會失敗的遷移，**不要 commit**：

```sh
echo 'SELECT 1/0;' > server/migrations/99990000_deploy_fail_trial.sql
fly deploy --remote-only --ha=false
```

2. 應該看到 release command 失敗、部署停下來；`fly releases` 最新那次是失敗的。
3. 網站照常打得開，`/health` 回 `ok`，還是原本那版。
4. 刪掉那個檔：`rm server/migrations/99990000_deploy_fail_trial.sql`。遷移在交易裡跑，失敗的不會留在資料庫裡。

### 舊網址（GitHub Pages）

舊網址 `https://littlebluewhite.github.io/cheer_editor/` 照舊用 `.github/workflows/deploy.yml` 部署（測試全過才部署到 GitHub Pages）。
推 `main` 建的是一般版，跟新網址一樣。上線那天建一份舊網址版就凍住，那個 workflow 拿掉（#267、#269）。

那個 workflow 第一次用要在 GitHub 上設定一次：Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。

**舊網址版**（`src/lib/old-site.ts`）：建置時設 `OLD_SITE=1`。沒有「登入」，也不碰伺服器（不 fetch、不開 WebSocket，當作沒登入）；
首頁最上面一條黃的搬家提示，右邊「到新網址」（`https://littlebluewhite.com/`）。登入才用得到的頁（登入、帳號、管理使用者、忘記密碼、設密碼，`src/lib/login-only.ts`）打開直接回首頁；使用說明不變。在本機建、看：

```sh
OLD_SITE=1 BASE_PATH=/cheer_editor npm run build
BASE_PATH=/cheer_editor npm run preview   # 開 http://localhost:4173/cheer_editor/
```

建出來的連結、檔案路徑都在 `/cheer_editor/` 底下。不設 `OLD_SITE`（或設成 `1` 以外）就是一般版。

#### 上線那天（網站主人，#269）

新網址 `https://littlebluewhite.com/` 打得開、能登入之後才做（黃條叫大家去那裡）：

1. 確定 `main` 最新的 commit 已經由 `Deploy to Fly` 部署好（新網址跑的就是它）。
2. GitHub → Actions → **Deploy to GitHub Pages** → Run workflow，分支選 `main`，勾 **舊網址版**，按 Run。用的是同一個 commit。
3. 跑完打開 `https://littlebluewhite.github.io/cheer_editor/`：最上面有黃條、「到新網址」打得開新網址，右上角沒有「登入」。
   service worker 換版要重新整理一兩次。
4. 馬上（推別的上 `main` 之前）拿掉 `.github/workflows/deploy.yml`，commit 推上 `main`。不拿掉的話，下一次推 `main` 又會建一般版蓋掉舊網址版。
   拿掉那個 workflow 的那次推上去，它不會再跑；舊網址就凍在步驟 2 那份。
5. 大家搬好後，網站主人再關舊網址：Settings → Pages 停掉（ADR 0012）。

## 金鑰

repo 是公開的：金鑰、密碼、連線字串都不放進 repo、issue、commit、log。

- 伺服器要用的金鑰都放 **Fly secrets**（只有這個 app 讀得到）：

| 名字 | 是什麼 |
|---|---|
| `DATABASE_URL` | Neon 正式資料庫的連線字串（不經過 pooler） |
| `R2_ENDPOINT`、`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` | 放音樂檔的 R2 bucket 和只管它的 token |
| `BACKUP_R2_BUCKET`、`BACKUP_R2_ACCESS_KEY_ID`、`BACKUP_R2_SECRET_ACCESS_KEY` | 放備份的 R2 bucket 和只管它的 token（每天的備份用，#265） |
| `BACKUP_HEARTBEAT_URL` | Better Stack 的備份報到網址（網址本身就是 token；**還沒設**，Better Stack 開好 heartbeat 後網站主人加，#269） |
| `RESEND_API_KEY`、`MAIL_FROM` | Resend 的金鑰和寄件人 |
| `SITE_URL` | 網站的網址（信裡的連結用） |

- **GitHub** 只放一把：Actions secret `FLY_API_TOKEN`，只能部署這個 app 的 Fly token。
- 只有網站主人有 Fly、Cloudflare、Neon、Resend、GitHub 的帳號和金鑰，第一版不給第二個人。
- 伺服器之後要讀新的金鑰時，網站主人先用 `fly secrets set` 加好，再部署。
- 不定期換。**外洩、或有人離開**才換。

### 怎麼換

每一把都是：先在那一家開一把新的 → 放進 Fly secrets → 確定網站正常 → 再把舊的作廢。

`fly secrets set`／`fly secrets import` 會重開機器（新的機器過了健康檢查才換過去）。值從標準輸入給，不要打在指令上（會留在 shell 的歷史紀錄）：

```sh
fly secrets import   # 貼上 名字=值，一行一個，按 Ctrl+D
```

- `DATABASE_URL`：Neon Console → 專案 → Roles → 那個角色 Reset password，拿新的連線字串（不經過 pooler 的那條）。換好之前舊的就不能用了，網站會停一下。
- R2（音樂、備份各一把）：Cloudflare → R2 → Manage API tokens 開一把新的（Object Read & Write，只管那一個 bucket），換 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`（備份是 `BACKUP_` 開頭那兩個），網站正常後刪掉舊的 token。
- `RESEND_API_KEY`：Resend → API Keys 開一把新的（只能寄信），換好後刪舊的。
- `FLY_API_TOKEN`（GitHub）：`fly tokens create deploy -a littlebluewhite` 開一把新的，貼到 GitHub → Settings → Secrets and variables → Actions → `FLY_API_TOKEN`；手動跑一次 workflow 確定能部署，再用 `fly tokens list`、`fly tokens revoke` 作廢舊的。
- 有人離開：上面的都換，帳號的密碼、兩步驟驗證也換。

## 倒回

只有網站主人做。倒回時間之後改的、記的都沒了，第一版不補回。手機上還沒傳的紀錄照樣傳上來（id 由手機發、不會撞，ADR 0011）。
開著的頁面要重新整理。伺服器的指紋還沒加「倒回第幾次」（#194 寫的「有新版，請重新整理」提示），所以倒回資料庫後，請大家自己重新整理。

### 程式

新版有問題、資料沒壞：`git revert` 那個 commit 推上 `main`，照常部署。舊版的程式碰到比較新的資料表也能跑（上面「只加不刪」）。

### 資料庫：6 小時內

Neon 免費版留 6 小時內的紀錄，可以倒回到這段時間的任何一刻：

1. Neon Console → 專案 → Branches → 正式的 branch → Restore，選要倒回的時間。
2. 整個 branch 被蓋掉；Neon 自己多留一份倒回前的 branch，要找東西去那份找。
3. 連線字串不變，不用改 Fly secrets。

### 每天的備份

伺服器自己每天台灣時間凌晨 4 點備份一次（`server/src/backup.rs`，#265），不用 GitHub 排程：

1. 跑 `pg_dump --format=custom --no-owner --no-acl`（custom 格式本身就壓縮過，不另外加密），連 `DATABASE_URL`（不經過 pooler）。
   映像檔裝的是 PostgreSQL 官方套件庫的 `postgresql-client-18`，跟資料庫同一版（`Dockerfile`；Debian 自己的、Neon 備份範本寫的是 17，不能用）。
2. 放上 R2 的備份 bucket（`BACKUP_R2_BUCKET`，跟音樂同一個 `R2_ENDPOINT`），名字是 `cheer-<台灣日期>-<時分>-<6 個 16 進位的亂數>.dump`，例 `cheer-2026-11-20-0400-3fa9c1.dump`（亂數讓手動備份碰上同一分鐘的排程時不會互蓋）。bucket 的生命週期規則 30 天自動刪。
3. 在資料表 `backups` 記一列多大（每天的工作算 R2 用量用，#266）。
4. 去 Better Stack 報到：打 `BACKUP_HEARTBEAT_URL`（Fly secret，網址本身就是 token）。**哪一步失敗就不報到**，Better Stack 等不到就寄信給網站主人（死人開關）。
   沒設 `BACKUP_HEARTBEAT_URL` 時照樣備份，log 寫「沒去 Better Stack 報到」。沒設 `BACKUP_R2_BUCKET` 時不備份（本機開發）。

現在就備份一次（例：試設定對不對）：

```sh
fly ssh console -C "/app/cheer-server backup"
```

### 資料庫：更早的

用每天凌晨 4 點（台灣時間）的備份（上面「每天的備份」，留 30 天）：

1. Cloudflare → R2 → 備份的 bucket，下載要的那一天（`cheer-<日期>-0400-<亂數>.dump`）。
2. Neon Console 開一個新的 branch（空的，不要從正式的複製），拿它的連線字串（不經過 pooler）。
3. 用 PostgreSQL 18 的 `pg_restore` 還原到這個新的 branch（跟資料庫同一版；自己電腦沒有 18 就用 docker 的 `postgres:18`）：

```sh
pg_restore --no-owner --no-acl --dbname="新 branch 的連線字串" cheer-2026-11-20-0400-3fa9c1.dump
# 或：docker run --rm -i postgres:18 pg_restore --no-owner --no-acl --dbname="新 branch 的連線字串" < cheer-2026-11-20-0400-3fa9c1.dump
```

   連線字串有密碼，打在指令上會留在 shell 的歷史紀錄：做完清掉，或先 `read -s DB` 再用 `--dbname="$DB"`。
4. 檢查：連上新的 branch 看使用者、流程、紀錄對不對。
5. 對了才換過去：`fly secrets import` 把 `DATABASE_URL` 換成新 branch 的連線字串（會重開機器）。舊的 branch 先留著，確定沒事再刪。

音樂檔：換掉、刪掉的音樂 30 天後才真的從 R2 刪，倒回 30 天內任何一份備份音樂都還在。

## 網址底下的路徑（base path）

新網址（Fly）放在網址根目錄 `/`，建置時不設 `BASE_PATH`（`Dockerfile` 也不設）。
舊網址（GitHub Pages）放在 `/cheer_editor/` 底下，由建置時的環境變數 `BASE_PATH` 決定（`deploy.yml` 會帶 `/cheer_editor`）。
本機 `npm run dev`、`npm run build` 不設，就是 `/`。

要在本機看舊網址部署後的樣子：

```sh
BASE_PATH=/cheer_editor npm run build
BASE_PATH=/cheer_editor npm run preview   # 開 http://localhost:4173/cheer_editor/
```

程式裡的連結和檔案路徑用 `$app/paths` 的 `resolve()`／`asset()`，或用相對路徑，兩種網址都找得到。

## 本機跑伺服器

`server/` 是 Rust 伺服器（axum）。前端建好的檔案和 API 由它在同一個網址送出（ADR 0012）。
新網址底下沒有子路徑，所以建前端時**不要**設 `BASE_PATH`。

要先裝 Rust（`rustup`）、Node（在專案根目錄 `npm ci`）和一個 PostgreSQL。本機開發**不碰正式的資料**：

- 資料庫用 Neon 另開的 `dev` branch（或自己電腦的 PostgreSQL），連線字串寫進 `server/.env`。
- 音樂用另一個 R2 bucket（下面「雲端流程的音樂檔」）。
- 信不寄：不設 `RESEND_API_KEY`，信印在終端機。
- `server/.env` 有金鑰，不進 git（`.gitignore` 擋著；範本是 `server/.env.example`）。

```sh
npm run build                       # 建前端到 build/（不設 BASE_PATH）
cp server/.env.example server/.env  # 填 DATABASE_URL；.env 不進 git
cd server && cargo run              # 開 http://127.0.0.1:8080
```

- 啟動時會先跑 `server/migrations/` 的資料庫遷移（正式機在部署前就跑過了，啟動時沒事做）。只跑遷移就結束：`cargo run -- migrate`。新的遷移加新檔，已經上線的不要改（上面「一次部署只加不刪」）。
- 要在本機試正式機的映像檔（不會部署）：`docker build -t cheer-server .`，再 `docker run --rm -p 8080:8080 -e DATABASE_URL=… cheer-server`。
- 伺服器用 QuickJS 跑流程核心（ADR 0013）：`cargo build` 時 `server/build.rs` 叫 `node scripts/core-bundle.mjs` 把 `src/lib/core/` 打包成一個 JS 檔、算指紋，編進程式。前端建置用同一支算指紋，兩邊一樣。所以 `cargo` 之前要先 `npm ci`；`cargo test` 也會叫 `node` 比對 QuickJS 和 Node 跑出來的結果。
- `/health` 是健康檢查，不碰資料庫（Neon 免費版沒人用時才睡得著）。
- 前端每頁建成 `<名字>.html`，所以 `/guide` 重新整理也打得開。其他找不到的路徑回 `200.html`（adapter 的 `fallback`），讓前端自己處理路由。
- log 只記請求的方法和路徑（路由的樣子，例 `/api/links/{token}`，不記 token 本身），不記查詢字串、標頭、內容。之後寫 log 也一樣：不記密碼、token、cookie、信的內容、流程內容；人用使用者 id，不寫 email。
- 寄信：`server/.env` 沒設 `RESEND_API_KEY` 時，信（含設密碼連結）印在終端機。信裡連結的網址是 `SITE_URL`（預設 `http://` 加 `LISTEN_ADDR`）。
- 登入的 cookie 是 `__Host-` 開頭、`Secure`：本機用 `http://127.0.0.1` 或 `http://localhost` 開，Chrome 照樣收；Safari 要 https。
- 改資料的 API 會看 `Sec-Fetch-Site`（沒有就看 `Origin`）擋別的網站送來的請求；用 curl 試要自己帶 `-H 'Sec-Fetch-Site: same-origin'`。

### 雲端流程的音樂檔（Cloudflare R2）

雲端流程的音樂檔放 R2，不經過伺服器（#249）：伺服器查權限、發 10 分鐘內有效的預簽網址，瀏覽器直接 PUT 到暫放的名字；
傳完伺服器在 R2 複製到正式的名字、刪掉暫放的，再查正式的那份多大，超過 60 MB 就刪掉、退回。
預簽網址收了之後還有效，但只寫得到暫放的，收好的音樂不會被換掉。播放時瀏覽器拿下載的預簽網址，用 `fetch` 從 R2 拿下來解碼。
在 R2 的正式名字是 `flows/<流程 id>/<音樂檔 id>.<副檔名>`，暫放的是前面加 `uploading/`；
換掉、刪掉的音樂在資料表 `flow_audio` 記下哪天不用了。

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
- **擁有者要做（還沒做）：** 傳了沒說傳完、傳完後又 PUT 的會留在 `uploading/`，伺服器不刪。
  R2 → 音樂的 bucket → Settings → Object Lifecycle Rules → Add rule：prefix 填 `uploading/`，物件 1 天後刪，Save changes。
  正式、開發的 bucket 都加。（Cloudflare 文件：https://developers.cloudflare.com/r2/buckets/object-lifecycles/ ，可以只管某個 prefix。）
- 伺服器測試不連 R2：`server/tests/music.rs` 開一台假的 R2（本機 HTTP，照 S3 的路徑收 PUT、HEAD、GET、DELETE 和複製（PUT 加 `x-amz-copy-source`），不驗簽名）。
  真的 R2 還沒接上實測過（#263）；`rusty-s3` 接不起來時換 `aws-sdk-s3`。

第一個管理員（也用來救進不去的管理員、換人當管理員）。沒有預設帳號、預設密碼：

```sh
cd server && cargo run -- create-admin --email 你的@email --name 你的名字
```

這個人變成管理員（原本的管理員不再是），收到一封設密碼信：還沒設過密碼是邀請（24 小時），設過是設新密碼（1 小時）。他之前沒用的連結作廢。
正式機用 `fly ssh console -C "/app/cheer-server create-admin --email … --name …"` 在機器上跑同一個指令。

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

service worker 只給建置時存好的頁面，網址後面的 `?…` 不看（`vite.config.ts` 的 `generateSW.ignoreURLParametersMatching`）：
不這樣的話，`guide?from=editor` 對不到存好的 `guide`，會掉到「其他網址都給首頁」那一條，按「使用說明」卻開出初始畫面。
`npm run check:sw` 照部署的樣子建置、開 preview 和 headless Chrome，等 service worker 接手後開使用說明的各種連結，看拿到的是不是對的頁
（check:layout 用 vite dev，沒有 service worker，看不到這一類錯）。

手動檢查離線：用 preview 或正式網址開一次，等頁面載完，開發者工具 Network 勾 Offline（或關掉 preview），重新整理，編輯器還能打開。

輸出影片用的 `mediabunny` 是動態 `import()`，建置後自己一個 chunk（2026-11-18 量：約 235 KiB，gzip 約 60 KiB），
不在首頁一開就載的檔案裡（`build/index.html` 的 modulepreload 沒有它）。它跟其他 `_app/immutable` 的檔一樣被 service worker 先存起來
（`sw.js` 的先存清單裡有它）；編輯器打開時不會去載它。

離線輸出影片實測過（2026-11-19，Mac、headless Chrome 157，`npm run build` 加 `vite preview`）：先開一次網站，等 service worker 接手、
快取裡有影片工具那一塊，再把 preview 關掉（連不上伺服器）、頁面也設成離線（CDP `Network.emulateNetworkConditions`，`navigator.onLine` 是 false），
重新開首頁、用 `docs/samples/sample-flow.zip` 輸出：影片工具從 service worker 拿到，對話框寫「影片長 0:12」，約 5 秒做完（兩次：4.7、5.1 秒）「做好了，0.7 MB」，
存下來的檔開頭是 `ftyp`、有 `avc1` 和 `mp4a`。只試過這一台。

影片工具載不下來（例：service worker 還沒存好就斷網）時，對話框寫「影片工具載不下來，請連上網路再試一次；還是不行，請重新整理頁面」。
同一天實測（同一台，service worker 不回、改從網路拿）：斷網或擋掉那一塊時打開對話框是這句話，恢復網路後按「再試一次」就到「開始」，
不用重新整理（Chrome 沒記住上次載入失敗）。網站剛更新、舊的那一塊已經不在時，再試一次也沒用，要重新整理才拿到新版，所以話裡留著重新整理。
`npm run check:layout` 有一條在開發模式擋掉再放行，看「再試一次」走得到「開始」。

## App 圖示

圖示畫在 `static/favicon.svg`（墊子條紋加圓點，用 `src/app.css` 的顏色）。分頁上的 favicon、
iPhone／iPad 主畫面的 `apple-touch-icon.png`、PWA manifest 的 `pwa-192x192.png`／`pwa-512x512.png` 都從它產生。
`static/` 底下的檔會一起被 service worker 先存起來，離線也有圖示。

改了 SVG 就重新產生一次（要先裝 ImageMagick），產生的檔一起 commit：

```sh
sh scripts/app-icons.sh
```

## 第三方套件授權

`npm run build` 會產生 `third-party-licenses.txt`（放在網站根目錄），列出打包進網站的別人的套件：名字、版本、授權、原始碼網址、授權全文。
例：輸出影片用的 `mediabunny` 是 MPL-2.0，要讓使用者知道原始碼在哪裡拿得到。使用說明最下面有連結。
產生的程式在 `scripts/third-party-licenses.ts`（`vite.config.ts` 掛上去）：看瀏覽器拿到的檔用了哪些 `node_modules` 裡的套件，
再加上 service worker 用的 `@vite-pwa/workbox-swkit` 和它依賴的套件。某個套件找不到授權全文時建置會失敗。`npm run dev` 底下沒有這個檔。
