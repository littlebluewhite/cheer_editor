# 部署與離線

## 部署（Fly.io）

網站在 `https://littlebluewhite.com`：一台 Rust 伺服器同時送前端和 API，同一個網址（ADR 0012）。
Fly app `littlebluewhite`，新加坡 `sin`，一台 shared-cpu-1x 512 MB，一直開著（#188、#194）。

推上 `main` 後，`.github/workflows/fly-deploy.yml` 會：

1. 跑前端測試和型別檢查（`npm test`、`npm run check`），和 Rust 伺服器的測試（`cargo test`）。任何一個沒過就停，不部署。
2. 全過才 `flyctl deploy --ha=false`（只要一台：在場的人、全上誰拿著哪幾組只放這台的記憶體，ADR 0015）：在 Fly 的 builder 上照 `Dockerfile` 建映像檔（建好前端，不設 `BASE_PATH`，放進伺服器的映像檔）。
3. `fly.toml` 的 `release_command` 在一台臨時機器上跑 `/app/cheer-server migrate`（資料表遷移）。**沒跑成就不部署**，舊版照常接流量。
4. `bluegreen`：在旁邊開一台新的，`/health` 過了才切過去，不停機。切的時候 WebSocket 會斷，前端自己重連。
5. 部署完跑 `npm run check:live`（`scripts/check-live.mjs`）：`/health` 回 `ok`；網頁的清單（下面「網頁的清單」）抓得到，清單裡每個檔抓下來大小和 SHA-256 都對得上；自動填密碼用的 `/.well-known/apple-app-site-association`（下面「自動填密碼用的檔」）是 JSON、跟 repo 裡的一樣；音樂的 R2 bucket 准網站的網址 PUT、GET（CORS）。
   伺服器的測試用假的 R2，看不到 CORS。沒過不會倒回，只會變紅。bucket 的網址放 repo 的 variable `R2_MUSIC_BUCKET_URL`
   （`https://<帳號 id>.r2.cloudflarestorage.com/<bucket>`，不是金鑰）。本機也能跑：`R2_MUSIC_BUCKET_URL=… npm run check:live`。

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
- 例外：`0021_delete_account.sql` 讓 `flow_steps.user_id` 可以是空的（刪除帳號，#369）。部署時安全（只有新版會寫空的）；倒回比它舊的程式前要知道：刪過帳號的人改的步，舊版讀不到（說明寫在那個檔）。

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

舊網址 `https://littlebluewhite.github.io/cheer_editor/` 凍在上線那天（2026-11-20，#269）建的舊網址版（`99fa1f7`）。
部署它的 `.github/workflows/deploy.yml` 已經拿掉，推 `main` 不會再動到舊網址（#267、#269）。要再建一次，從 git 紀錄把那個檔拿回來，Actions 頁手動按 Run workflow、勾 **舊網址版**；建完馬上再拿掉（它推 `main` 就跑，會建一般版蓋掉舊網址版）。

**舊網址版**（`src/lib/old-site.ts`）：建置時設 `OLD_SITE=1`。沒有「登入」，也不碰伺服器（不 fetch、不開 WebSocket，當作沒登入）；
首頁最上面一條黃的搬家提示，右邊「到新網址」（`https://littlebluewhite.com/`）。登入才用得到的頁（登入、帳號、管理使用者、忘記密碼、設密碼，`src/lib/login-only.ts`）打開直接回首頁；使用說明不變。在本機建、看：

```sh
OLD_SITE=1 BASE_PATH=/cheer_editor npm run build
BASE_PATH=/cheer_editor npm run preview   # 開 http://localhost:4173/cheer_editor/
```

建出來的連結、檔案路徑都在 `/cheer_editor/` 底下。不設 `OLD_SITE`（或設成 `1` 以外）就是一般版。

大家搬好後，網站主人再關舊網址：Settings → Pages 停掉（ADR 0012）。

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
舊網址（GitHub Pages）放在 `/cheer_editor/` 底下，由建置時的環境變數 `BASE_PATH` 決定（當時的 `deploy.yml` 帶 `/cheer_editor`）。
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
- 前端每頁建成 `<名字>.html`，所以 `/guide` 重新整理也打得開。其他找不到的路徑回 `200.html`（adapter 的 `fallback`），讓前端自己處理路由。
- log 只記請求的方法和路徑（路由的樣子，例 `/api/links/{token}`，不記 token 本身），不記查詢字串、標頭、內容。之後寫 log 也一樣：不記密碼、token、cookie、信的內容、流程內容；人用使用者 id，不寫 email。
- 寄信：`server/.env` 沒設 `RESEND_API_KEY` 時，信（含設密碼連結）印在終端機。信裡連結的網址是 `SITE_URL`（預設 `http://` 加 `LISTEN_ADDR`）。
- 登入的 cookie 是 `__Host-` 開頭、`Secure`：本機用 `http://127.0.0.1` 或 `http://localhost` 開，Chrome 照樣收；Safari 要 https。
- 改資料的 API 會看 `Sec-Fetch-Site`（沒有就看 `Origin`）擋別的網站送來的請求；用 curl 試要自己帶 `-H 'Sec-Fetch-Site: same-origin'`。

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
npm run test:server                  # 全部
npm run test:server -- --test music  # 後面的參數給 cargo test
```

`scripts/test-server.sh` 用 docker 開一台用完就丟的 `postgres:18`（跟 CI、正式機同版），自己找空的埠，
設好 `DATABASE_URL` 跑 `cargo test --locked`，跑完收掉；沒有 `node_modules` 會先 `npm ci`。幾個 worktree 同時跑也不會撞。
全部跑完約 2 分鐘。

`#[sqlx::test]` 的測試每個自己開一個乾淨的資料庫，所以 `DATABASE_URL` 要指到一個能建資料庫的 PostgreSQL 帳號
（不要用 Neon）。自己給的話：`cd server && DATABASE_URL=… cargo test`。CI 用 GitHub Actions 的 `postgres:18` 服務。

排版：`cd server && cargo fmt`（CI 跑 `cargo fmt --check`）。前端沒有 Prettier 設定，不要跑 `prettier --write`，會把整個檔重排。

### 雲端流程的音樂檔（Cloudflare R2）

雲端流程的音樂檔放 R2，不經過伺服器（#249）：伺服器查權限、發 10 分鐘內有效的預簽網址，瀏覽器直接 PUT 到暫放的名字；
傳完伺服器在 R2 複製到正式的名字，查正式的那份多大，超過 60 MB 就刪掉、退回；記下來之後才刪暫放的（中間出錯，瀏覽器再說一次傳完就好）。
預簽網址收了之後還有效，但只寫得到暫放的，收好的音樂不會被換掉。播放時瀏覽器拿下載的預簽網址，用 `fetch` 從 R2 拿下來解碼。
App 裡的網頁（`app://local`）過不了 CORS，改由殼照預簽網址送到 R2（#382，`ios/README.md`「雲端流程的音樂」）：CORS、R2 的設定都不用為 App 改。
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
- **擁有者要做（還沒做）：** 傳了沒說傳完、傳完後又 PUT 的、收了但刪不掉的會留在 `uploading/`，伺服器不刪。
  R2 → 音樂的 bucket → Settings → Object Lifecycle Rules → Add rule：prefix 填 `uploading/`，物件 1 天後刪，Save changes。
  正式、開發的 bucket 都加。（Cloudflare 文件：https://developers.cloudflare.com/r2/buckets/object-lifecycles/ ，可以只管某個 prefix。）
- 伺服器測試不連 R2：`server/tests/music.rs` 開一台假的 R2（本機 HTTP，照 S3 的路徑收 PUT、HEAD、GET、DELETE 和複製（PUT 加 `x-amz-copy-source`），不驗簽名）。
  真的 R2 還沒接上實測過（#263）；`rusty-s3` 接不起來時換 `aws-sdk-s3`。

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

## 網頁的清單

App 的殼照這份清單從網站抓新版網頁換上（ADR 0025）。網址固定是 **`/web-bundle.json`**（正式站 `https://littlebluewhite.com/web-bundle.json`）。

`npm run build` 建完網頁後跑 `node scripts/web-bundle.mjs build`，寫出 `build/web-bundle.json`，跟網頁一起進映像檔；Dockerfile、部署流程、伺服器程式都沒改。`npm run dev` 底下沒有這個檔（只跑 `vite build` 的 `check:sw` 也沒有）。內容：

```json
{
	"id": "整包網頁的代號（64 個 16 進位字）",
	"files": [{ "path": "index.html", "size": 3591, "sha256": "64 個 16 進位字" }],
	"minShellBuild": 42
}
```

- `id`：每個檔一行「SHA-256、兩個空白、路徑」，照路徑排好接起來，再算一次 SHA-256。任何一個檔改了，代號就不一樣。殼比的是「跟網站上的一不一樣」，不比新舊。
- `files`：建置結果（`build/`）的每個檔，路徑相對網站根目錄、用 `/` 分開、照字元排好；大小是 bytes。**不列**：清單自己、`sw.js`、`workbox-*.js`、`manifest.webmanifest`、`pwa-*.png`（殼用不到 service worker 和 PWA 的檔）。`apple-touch-icon.png`、`favicon.*` 照列（網頁的 HTML 用到）。
- `minShellBuild`：要第幾版以上的殼（比建置號）。**平常不寫**；新網頁真的沒辦法在舊殼上跑才在 `scripts/web-bundle.mjs` 的 `MIN_SHELL_BUILD` 填上。比它舊的殼不換網頁、照樣被擋，被擋的畫面寫「這版 App 太舊，請到 App Store 更新」（#394，ios/README.md「殼自己更新網頁」）。
- 不另外簽名：只從自己的網站（HTTPS）抓，每個檔比 SHA-256。

同一個 commit 建兩次，清單一樣：SvelteKit 的版本名字（`version.name`，每頁 HTML 都帶著）預設是建置當下的時間，`vite.config.ts` 改成原始碼的 SHA-256（`scripts/web-bundle.mjs` 的 `sourceVersion`：`src`（不含產生出來的 `src/lib/paraglide`）、`static`、`messages`、`scripts`、`package.json`、`package-lock.json`、`vite.config.ts`、`project.inlang/settings.json`）。映像檔裡沒有 `.git`，所以不用 commit 的代號。

找不到的路徑伺服器回 `200.html`、狀態還是 200，所以殼和 `check:live` 都不看狀態碼：清單要是看得懂的 JSON，每個檔的大小、SHA-256 都要對得上。部署時新舊兩台換手的那一下，可能拿到新清單、舊檔，殼就整包丟掉、下次再抓。

本機試線上檢查：`npm run build`，用一個送 `build/`、找不到就回 `200.html` 的小伺服器（或 `cargo run`）開起來，`SITE_URL=http://127.0.0.1:8080 npm run check:live`（沒設 `R2_MUSIC_BUCKET_URL` 那條會紅，正常；`apple-app-site-association` 是伺服器的路由，小伺服器沒有、那條也會紅，用 `cargo run` 才會過）。

## 自動填密碼用的檔

App 裡要能填 iPhone 存的網站密碼（#395），網站要送 **`/.well-known/apple-app-site-association`**：寫著 App 的 Team ID 和 bundle ID（`N5HMWTF697.com.littlebluewhite.cheereditor`），iPhone 照它認 App 和網站是一家的。App 那邊是 `ios/App/CheerEditor.entitlements` 的 `webcredentials:littlebluewhite.com`（ios/README.md）。

- 檔在 `server/apple-app-site-association.json`，伺服器編譯時包進去（`server/src/lib.rs` 的一條路由），檔案類型 `application/json`。不放 `static/`：沒有副檔名，`ServeDir` 給不出 JSON 的檔案類型；也會跟著進網頁的清單和 App。不放 `docs/`：不進映像檔。
- Team ID 可以公開（ADR 0023）。換 Team ID 或 bundle ID 就改這個檔，`server/tests/http.rs` 的測試跟著改。
- `check:live` 比正式站送的跟 repo 裡的這個檔：要 200、不轉址、`application/json`、內容一樣（找不到的路徑會拿到 `200.html`、狀態也是 200，只看狀態碼會被騙）。

## App（iPhone、iPad）

殼怎麼建、怎麼測、檔案放哪：`ios/README.md`。這一節寫出版：從 `main` 到 App Store Connect（#396，規格 #360「建置、簽章、出新版」，#340）。

**只在這台 Mac 上做**，用 Xcode 登入的 Apple 帳號（網站主人的個人帳號，Team ID `N5HMWTF697`，#362）。Apple 用雲端簽章憑證幫忙簽：repo、GitHub 都不放 Apple 的秘密（沒有 API 金鑰、憑證、描述檔、密碼）。Team ID 是公開的，直接進 repo（`ios/ExportOptions.plist`；專案檔的 `DEVELOPMENT_TEAM` 在 #395 加）。不用 Xcode Cloud、不用 GitHub Actions 出版。

### 出版指令

```sh
npm run ios:release                  # 全部，最後上傳
npm run ios:release -- --no-upload   # 封存完就停
```

`scripts/ios-release.mjs`。哪一步沒過就停下來講原因，後面的都不做：

1. **git**：沒有沒 commit 的改動、在 `main`、`git fetch` 後跟 GitHub 上的 `main` 是同一個 commit。
2. **凍的情境**：`bridge-scenarios/<版本>/` 要有，而且跟 `current/` 每個檔都一樣（版本讀專案檔的 `MARKETING_VERSION`）。
3. **上架版只抓、只連自己的網站**：開發用的改網址設定（環境變數 `CHEER_SITE_URL`、`CHEER_WEB_BUNDLE_URL`，凡是 `"CHEER_…"`）在 `ios/App`、`ios/ShellCore/Sources` 裡都要包在 `#if DEBUG` 那一半；Release 的 `SWIFT_ACTIVE_COMPILATION_CONDITIONS` 不能有 `DEBUG`。以後加新的開發用設定，也取 `CHEER_` 開頭的名字，這一步才查得到。（看的是程式和建置設定，不是建出來的檔：14 個字以內的 Swift 字串會直接編進指令裡，在檔案裡搜不到。）
4. **建網頁、放進殼**：`npm run ios:web`（跟網站部署的同一包；不放 service worker、Workbox、`manifest.webmanifest`、PWA 圖示）。
5. **殼的測試**：`swift test`（規則），再在最新 iOS 的第一台 iPhone 模擬器上跑管子測試（`xcodebuild test`）。沒過不出版。
6. **封存**：`xcodebuild archive`（Release、`generic/platform=iOS`、`-allowProvisioningUpdates`），建置號帶 `CURRENT_PROJECT_VERSION=<main 的 commit 數>`。封存放在 Xcode 預設的資料夾（`~/Library/Developer/Xcode/Archives/<日期>/`），Organizer 看得到。封完再看一次封存裡的 `Info.plist`：建置號對、`ITSAppUsesNonExemptEncryption` 是 `NO`，不對就不上傳。
7. **上傳**：`xcodebuild -exportArchive`，`ios/ExportOptions.plist`（`method` `app-store-connect`、`destination` `upload`、自動簽章、不讓 Xcode 改建置號）。用 Xcode 登入的帳號，不用 API 金鑰。

跟規格的順序不一樣：git、凍的情境、網址這三個便宜的檢查先做，殼的測試排在建網頁後面（管子測試要用真的那包網頁）。

- 指令自己不 commit、不推。平常網站主人跑；網站主人明講「出版」時，agent 可以在這台 Mac 代跑。**送審的按鈕不在指令裡**，網站主人在 App Store Connect 按。
- ⚠️ **第 6 步（簽章的封存）和第 7 步（上傳）還沒真的跑過**（#396 只跑到不簽章的 Release 建置）。第一次真的出版時驗（#401）。上傳不行就用 `--no-upload`，再到 Xcode → Window → Organizer → 那一份 → Distribute App → App Store Connect 手動上傳，回來改這一節。
- 封存要專案有 Team（`DEVELOPMENT_TEAM`，#395）。
- ⚠️ **第 6、7 步會改 Apple 帳號**：封存和上傳都帶 `-allowProvisioningUpdates`，`xcodebuild` 會在 Xcode 登入的帳號裡「create and update profiles, app IDs, and certificates」（`man xcodebuild`，docs/research/app-release.md）：可能建新的簽章憑證、描述檔，也可能改 App ID（例如照 entitlements 打開 Associated Domains）。#395 建殼時故意沒帶它；出版指令帶，是因為沒有它 `xcodebuild` 不會去帳號拿或建描述檔，自動簽章簽不出來（推論，還沒真的跑過）。想先看清楚會建什麼，先在 Xcode 用付費帳號建一次真機版（#395 留給網站主人的那步），再跑出版指令。

### 版號

- **版本**（`MARKETING_VERSION`，專案檔）：從 `1.0` 起，殼每出一版加 0.1（1.9 之後是 1.10）。上一版上架以後、下一次出版前，推一個「App 1.x」的 commit 改它，**同一個 commit 把情境凍一份**（下面）。還在 TestFlight、還沒上架時，修了再傳不用改版本。
- **建置號**（`CFBundleVersion`）：出版那個 commit 在 `main` 的 commit 數（`git rev-list --count HEAD`），出版指令自己帶，專案檔裡的 `CURRENT_PROJECT_VERSION = 1` 只給開發版。自動產生、只會往上；同一個 commit 不能上傳兩次（要再傳就先推一個 commit）。Apple 對建置號規則的原文沒抓到，「每次上傳要新的、只往上」是推論（#340，2026-11-22 查）。
- 網頁的清單裡「要第幾版以上的殼」（`minShellBuild`，上面「網頁的清單」）比的是**建置號**，不是版本。

### 什麼時候出新版、TestFlight

- 殼改了才出；Apple 規定要用新的 SDK 時，殼沒改也要重建一版。裡面那包網頁用出版那天的 `main`（App 打開會自己去網站抓最新的）。
- 每一版：上傳 → 在 App Store Connect 等建置處理完 → **TestFlight 內部測試**裝到網站主人的 iPhone、iPad → 照下面「每次出新版殼前」那張清單兩台都做，**有一項沒過就不送審** → 網站主人按送審。**過審就自動上架，不分階段。**
- 第一次上架另外要 TestFlight **外部**測試：email 邀 3–5 位教練（不開公開連結；13 歲以上、iOS／iPadOS 18.4 以上），試至少 2 週；外部的第一版要先過審。細節在 #401。
- 送審備註寫「App 會從自己的網站更新網頁畫面，功能不變」。准不准是推論，沒驗（規格 #360）。

### 殼壞了

**商店上的版本不能倒回，只能出新版**（可以在 App Store Connect 申請加急審查）。推論，沒驗（#340）。網頁壞了照上面「倒回」做，殼會跟著換回網站上那一包（ADR 0025）。

### 凍的情境（保護商店裡的殼）

殼會自己從網站抓新網頁，每次部署，新網頁都會跑到商店裡的舊殼上；部署前唯一的關是 GitHub 上的 Vitest（ADR 0025）。所以：

- 每出一版殼，在「App 1.x」commit 把 `bridge-scenarios/current/` 整份複製成 `bridge-scenarios/1.x/`（`cp -R bridge-scenarios/current bridge-scenarios/1.x`）。出版指令第 2 步查它跟 `current/` 一樣。
- **網頁每次部署前，Vitest 都過每一份凍的情境**：`vite.config.ts` 的 `core@1.x`、`components@1.x` 把用到假殼（`#lib/scenario-shell.js`）的測試照那一份再跑一次；那一版沒有的情境（凍了以後才加的）用 `current/` 的。`src/lib/frozen-scenarios.test.ts` 另外查：凍的每個情境，`current/` 都還有同一個檔名、同一個名字（改了名，凍的那句就沒測試演了）。CI 前端那一關跑 `npm test` 就跑到，沒過不部署。殼那邊（`swift test`）本來就讀 `bridge-scenarios/` 底下每個資料夾。
- **那一版上架以後，凍的那份只能整份刪、不能改。** 沒有測試擋「有人去改凍的那份」，要靠看 diff。真的要改舊殼認得的話：網頁的清單標 `minShellBuild`，比它舊的那幾份整份刪掉。
- 還沒上架（還在 TestFlight）時情境改了，凍的那份跟著重凍（同一行 `cp -R`，先刪掉舊的）。**1.0 那份是 #396 凍的；別的票之後還會往情境檔加東西，真的出版前要再凍一次**（#401 第一步）。

### 加密出口

- `ios/App/Info.plist` 的 **`ITSAppUsesNonExemptEncryption` 設 `NO`**：殼和網頁只用系統的 HTTPS（`URLSession`、WebKit），沒有自己帶加密的程式庫。Apple 舉的「不用交文件」的例子就是這種。這樣上傳時不用每次答問卷。
- App Store Connect 若問到法國：答「不在法國上架」（只上台灣）。
- **美國的年度自我分類報告（BIS）不交。** 為什麼：2021-03-29 起（86 FR 16482），歸在 EAR 740.17(b)(1) 的「大眾市場」成品不用交，只要留紀錄；還要交的是大眾市場的元件、'executable software'，和仍是 5A002／5B002／5D002 的東西（eCFR §740.17(e)(3)）。查的日期：**2026-11-22**（#335 的研究，筆記在本機分支 `research/app-release` 的 `docs/research/app-release.md`；#340）。⚠️ **這是推論**：免費 App 算不算「大眾市場」、只呼叫系統加密算不算加密品項，都查不到；Apple 的原話是判斷錯了責任在開發者，也就是網站主人。想保險的話，改成每年 2 月 1 日前寄一份 CSV 給 BIS 和 NSA。
- 之後殼或網頁自己帶了加密的程式庫（例：用 `crypto.subtle` 加解密、加了加密套件），這一段要重看。

### 每次出新版殼前（草稿）

⚠️ **這張是 agent 照規格起草的，網站主人只定了規則，還沒一條一條看過**：要加、要刪、每條怎樣算過，請網站主人過一次（#401 前）。定了的規則：網站主人用 TestFlight 內部版，**iPhone、iPad 兩台都做，有一項沒過就不送審**。

1. 點圖示 1 秒內回到上次那支流程（每版要不要錄影量，網站主人過清單時定，不自己放寬）。
2. 改一下，馬上把 App 滑掉，再打開，改的還在。
3. 「檔案」點 `.cheer` 打得開；存檔蓋回原檔。
4. LINE 傳來的流程檔打得開。
5. 內建喇叭放 0、藍牙喇叭用調過的延遲校正，畫面和聲音對得上（每版怎麼量，網站主人過清單時定）。
6. 藍牙喇叭斷線，播放會停。
7. 鎖螢幕繼續播；鎖定畫面的播放鍵出現。
8. 飛航模式打得開，看得到上次那支。
9. 八拍表印得出來，顏色對。
10. 雲端流程：登入、連上、改一下、記一次。
11. 殼更新網頁：agent 用開發版接 Mac 上的小網站（`scripts/web-bundle-test-site.mjs`），四種各跑一次（`ios/README.md`）。
12. 送審前用審查帳號登一次。

## 第三方套件授權

`npm run build` 會產生 `third-party-licenses.txt`（放在網站根目錄），列出打包進網站的別人的套件：名字、版本、授權、原始碼網址、授權全文。
例：輸出影片用的 `mediabunny` 是 MPL-2.0，要讓使用者知道原始碼在哪裡拿得到。使用說明最下面有連結。
產生的程式在 `scripts/third-party-licenses.ts`（`vite.config.ts` 掛上去）：看瀏覽器拿到的檔用了哪些 `node_modules` 裡的套件，
再加上 service worker 用的 `@vite-pwa/workbox-swkit` 和它依賴的套件，以及產生到 `src/lib/paraglide/` 的 `@inlang/paraglide-js`。某個套件找不到授權全文時建置會失敗。`npm run dev` 底下沒有這個檔。
