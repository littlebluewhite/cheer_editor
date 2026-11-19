# 後端放哪裡：主機、資料庫、寄信、音樂檔、網域

Issue #181（地圖 #177）。查核日期 2026-11-06。免費額度和價錢常改，每個數字都附來源，來源列在最後。

價錢是美金、未稅；Hetzner 是歐元、未稅。
標「推論」的是我自己算的或推的，沒有一手來源直接寫。
標「只讀到摘要」的，是原文網站擋自動抓取，只讀到搜尋結果的摘要。

## 結論

1. **Safari 會擋。** 前端在 `littlebluewhite.github.io`、後端在別的網址（例：`xxx.fly.dev`）時，後端設的登入 cookie 是「第三方 cookie」。iPad／iPhone 的 Safari 從 iPadOS／iOS 13.4（2020-03）起預設全擋，沒有例外。
2. **不買網域也有兩條路：** 不用 cookie，改用 token；或前端和後端放在同一個網址（後端順便送出前端的檔案）。
3. **買網域、前後端用同一個網域的子網域，cookie 就不會被擋。** 但 Safari 會把後端設的 cookie 壽命砍到最多 7 天（WebKit 叫它 CNAME／IP 偽裝防護）。前後端在同一台主機、同一個網址，才沒有這個上限。
4. **CHIPS（`Partitioned` cookie）Safari 26.2（2025-12）起能用，但不建議靠它。** 舊的 iPad 不行；WebKit 只舉 iframe 的例子，`fetch` 有沒有效要實測。
5. **主機：免費又不會睡的幾乎沒有。** Render 免費 15 分鐘沒人用就睡，醒來要約 1 分鐘。Koyeb 免費 1 小時沒人用就睡，只有歐美機房。Cloud Run 有免費額度、有台灣機房，但要開帳單帳戶。Fly.io 沒有免費方案，最小的機器一個月 $2.19 起。
6. **資料庫：Neon 免費最好用。** 1 GB、不會過期、可以倒回 6 小時內。Supabase 免費 1 週沒動會暫停、沒有備份。Render 免費 30 天就過期。
7. **寄信：Resend、Brevo、Postmark 都要自己的網域**（Brevo 會暫時改用它自己的網域寄）。不買網域，就只能用 Gmail 帳號寄（一天約 500 封）。所以**真正需要網域的是寄信，不是 cookie**。
8. **音樂檔：Cloudflare R2 免費 10 GB，下載流量不收錢。** 一首 2 分半、320 kbps 的 mp3 約 6 MB，10 GB 約放得下 1,600 首（推論）。
9. **網域：`.com` 一年約 $11–12。** Porkbun $11.81；Cloudflare 照成本賣。2026-11-01 起 `.com` 批發價漲到 $10.97（只讀到摘要）。
10. 順帶發現：現在的瀏覽器草稿存在 IndexedDB（`src/lib/file/draft.ts`）。在 Safari 分頁裡，7 天（Safari 有在用的日子）沒在這個網站點過、按過，草稿會被清掉；加到主畫面的不會。

## 1. Safari 和登入用的 cookie

### 先講幾個詞

- **cookie**：網站請瀏覽器記住的一小段字，例如「這個人登入了」。之後連到同一個網站，瀏覽器自動帶上。
- **站（site）**：網址最後「能買的那一段」。`api.example.com` 和 `cheer.example.com` 是同一個站（`example.com`）。哪一段算「能買的」，看公共後綴清單（Public Suffix List）[MDN Site]。
- **第三方 cookie**：cookie 屬於的站，和網址列上的站不一樣 [MDN 第三方 cookie]。
- **同源（origin）**：`https://`、網域、埠號全都一樣。比「同站」更嚴。
- **token**：登入後伺服器給的一串字。前端自己存著，每次呼叫後端時放在 `Authorization` 標頭裡，不靠 cookie。
- **CORS**：後端告訴瀏覽器「允許哪個網站來呼叫我」的設定。前後端不同源就要設。

### 事實

- **`github.io` 在公共後綴清單上**（2026-11-04 版）。所以 `littlebluewhite.github.io` 自己就是一個站，後端不可能跟它「同站」。`fly.dev`、`onrender.com`、`up.railway.app`、`*.run.app`、`pages.dev`、`workers.dev` 也都在清單上 [PSL]。
- **Safari 全擋第三方 cookie**：「ITP by default blocks all third-party cookies. There are no exceptions to this blocking.」[WebKit 追蹤防護]。從 Safari 13.1、iOS／iPadOS 13.4 開始（2020-03-24）[WebKit 2020]。
- WebKit 的「站」也看公共後綴清單：「A website is a registrable domain including all of its subdomains.」[WebKit 追蹤防護]
- **SameSite**：`SameSite=None` 一定要加 `Secure`。`Lax` 只在同站，或從別站點連結過來（最上層的 GET）時才送 [MDN Set-Cookie]。前端用 `fetch` 呼叫後端，不算點連結。
- **CNAME 偽裝防護**：同站的子網域，如果 CNAME（網域的別名設定）指到別的站，例如 `api.example.com` → `xxx.fly.dev`，Safari 會把這個回應設的 cookie 壽命砍到最多 7 天 [WebKit 追蹤防護][WebKit CNAME]。WebKit 的表：主網站沒有 CNAME、子網域 CNAME 到第三方 → 「7-day cap」。
- **IP 偽裝防護**：改用 A／AAAA 記錄直接指 IP 也躲不掉。後端的 IP 和網址列那個網站的 IP 差太多（IPv4 前 16 位元不同、IPv6 前 64 位元不同，或一個 IPv4 一個 IPv6），也當成第三方，一樣砍到 7 天。一般瀏覽和私密瀏覽都有 [WebKit 私密瀏覽 2.0]。GitHub Pages 的 IP 是 `185.199.108–111.153` [GitHub Pages 自訂網域]，別家主機的 IP 幾乎一定不同（推論）。
- **JS 儲存的 7 天上限**：Safari 有在用的日子裡，連續 7 天沒在這個網站點、按、打字，這個網站的 IndexedDB、localStorage、service worker 快取都會被清掉 [WebKit 2020][WebKit 追蹤防護]。**加到主畫面的網頁 App 不算**，不會被清 [WebKit 追蹤防護]。
- **CHIPS**：cookie 加上 `Partitioned`（再加 `SameSite=None; Secure`），就分開存在「網址列那個站」底下，不能拿去別的站追蹤人 [MDN CHIPS]。Safari 18.4 推出、18.5 拿掉、26.2 再推出；Chrome 114、Firefox 141 起支援 [BCD 8.1.8][WebKit 26.2]。WebKit 26.2 的說明只舉 iframe 的例子 [WebKit 26.2]。

### 五種做法

| 做法 | iPad Safari 擋不擋 | 要買網域嗎 | 代價 |
|---|---|---|---|
| A. 前端 github.io、後端別家網址、用 cookie | **擋**（第三方 cookie） | 不用 | 不能用 |
| B. 同 A，但不用 cookie，改用 token | 不擋（沒有 cookie） | 不用 | token 存在 IndexedDB 或 localStorage：Safari 分頁 7 天沒用會被清，要重新登入（主畫面 App 不會）。網頁的 JS 讀得到 token，萬一網頁被塞進惡意程式碼（XSS）就會被偷；`HttpOnly` cookie JS 讀不到（推論）。後端要設 CORS。 |
| C. 買網域：前端 `cheer.網域`（GitHub Pages 自訂網域）、後端 `api.網域` | 不擋（同站，是第一方 cookie） | 要 | Safari 把後端設的 cookie 壽命砍到 7 天（CNAME／IP 偽裝防護）。每次用都換新 cookie 的話，等於「7 天沒用要重新登入」（推論）。不同源，還是要設 CORS。 |
| D. 前後端同一個網址：後端程式也送出前端的檔案 | 不擋（同源） | 不一定：`xxx.fly.dev` 自己就是一個網址 | 前端離開 GitHub Pages，`docs/deploy.md` 的部署要改。主機睡著時，第一次打開會慢；service worker 存好之後，離線照樣打得開（推論）。 |
| E. 同 A，cookie 加 `Partitioned`（CHIPS） | iPadOS 26.2 以上可能不擋（推論，要實測） | 不用 | 26.2 以前的 iPad 會擋。`fetch` 有沒有效，WebKit 沒寫。 |

想要最少意外：選 D。不想搬前端：選 B。C 要買網域，還有 7 天上限。

## 2. 跑 Rust 的主機

「睡著」：沒人用時把程式停掉，有人來才再開（scale to zero）。「冷啟動」：從睡著到能回應，要等的時間。

| 家 | 免費方案 | 會不會睡、多久醒 | 付費起價 | 離台灣近的機房 |
|---|---|---|---|---|
| Fly.io | **沒有**。新帳號送 $1、7 天內用完 | 可以設成沒人用就停（`auto_stop_machines`），幾分鐘沒流量才停。冷啟動約 2 秒以上；用 suspend 約幾百毫秒。停著不收 CPU、記憶體的錢 | shared-cpu-1x：256 MB $2.19／月、512 MB $3.69／月（美東）。各區價錢不同：1 GB 美東 $6.70、新加坡 $8.50 | 東京 `nrt`、新加坡 `sin` |
| Render | 有：512 MB。每個工作區每月 750 小時，用完全部停到下個月。不能接硬碟 | 15 分鐘沒流量就睡，醒來約 1 分鐘 | Starter $7／月（512 MB、0.5 CPU）。工作區 Hobby $0，含 5 GB 流量 | 新加坡 |
| Railway | 試用：$5、30 天。之後 Free：每月 $1 額度，每個服務最多 1 vCPU、0.5 GB | 價錢頁沒寫會睡；停掉就不收錢（按秒算） | Hobby $5／月（含 $5 用量）。記憶體約 $10／GB 月、CPU 約 $20／vCPU 月 | 沒查 |
| Koyeb | 一個免費 instance：512 MB、0.1 vCPU、2 GB。不能接硬碟 | 1 小時沒流量就縮到 0 | 要 Pro $29／月（含 $10 用量）再加用量；最小的 eco-nano $1.61／月 | 免費只有法蘭克福、華盛頓；付費 eco 有新加坡 |
| Google Cloud Run | 每月 18 萬 vCPU 秒、36 萬 GiB 秒、200 萬次請求（照請求計費）。要有帳單帳戶 | 沒請求就縮到 0，有冷啟動（秒數沒查） | 超過免費額度才收，照用量 | 台灣 `asia-east1`（Tier 1 價，免費額度照 Tier 1 價折抵） |
| Hetzner（VPS） | 沒有 | 不會睡，整台是你的 | CX23（2 vCPU、4 GB、40 GB）€5.99／月，含 IPv4、20 TB 流量，只在歐洲；**查的當天顯示缺貨**。Regular Performance €6.49 起 | 新加坡（只含 0.5 TB 流量，比較貴） |
| Oracle Always Free（VPS） | Arm，等於 2 OCPU、12 GB；硬碟共 200 GB；每月 10 TB 流量 | 不會睡。但 7 天內 CPU、網路都用不到 20% 會被收回 | — | 只能開在註冊時選的主區域；常常「沒容量」開不起來 |

補充：

- 18 萬 vCPU 秒約等於 1 個 vCPU 全速跑 50 小時（推論：180,000 ÷ 3,600）。沒請求時不算。
- VPS（Hetzner、Oracle）要自己裝系統、資料庫、HTTPS 憑證，自己更新、自己備份。
- Oracle 的回收規則對一個隊用的小網站很容易符合（推論），不建議。

### WebSocket 和寄信用的埠

WebSocket：一條一直開著的連線。多人一起改時，伺服器可以馬上把別人改的東西推過來。
SMTP：寄信的老方法，走 25、465、587 埠。很多主機為了擋垃圾信會關掉。

| 家 | WebSocket | 對外 SMTP |
|---|---|---|
| Fly.io | 可以，不用設定；閒置不會被關。但自動停機前會先關掉連線（code 1012），前端要會重連 | 沒查 |
| Render | 可以，沒有最長時間；部署時會斷。新的 WebSocket 連線會叫醒免費服務 | 免費服務擋 25、465、587：**不能用 SMTP** |
| Railway | Socket.IO 指南說可以 | Free、Trial、Hobby 擋 SMTP，Pro 才開；官方叫你改用 HTTPS API 寄 |
| Koyeb | 文件把 HTTP、WebSocket 列在「不用 TCP Proxy」那邊（推論：支援） | 只擋 25 |
| Cloud Run | 可以。一條連線最長 60 分鐘（預設 5 分鐘），到時間就斷；連線開著就一直算錢；開好幾台時要自己同步 | 只擋 25，465、587 可以（只讀到摘要） |
| VPS | 自己決定 | 沒查各家 |

## 3. PostgreSQL

| 家 | 免費多大 | 會不會過期、暫停 | 備份 | 付費 |
|---|---|---|---|---|
| Neon | 每個專案 1 GB；每月 100 CU 小時；最多 100 個專案 | 不會過期（「no time limits」）。5 分鐘沒用就睡，幾百毫秒醒 | 可倒回 6 小時內（或 1 GB 的變動）；1 個快照 | Launch：$0.106／CU 小時、$0.35／GB 月，沒有月費下限 |
| Supabase（只用資料庫） | 500 MB；2 個專案 | **1 週沒動就暫停** | 免費方案沒有自動備份；官方叫你自己用 CLI `db dump` 匯出 | Pro $25／月起：8 GB、每天備份留 7 天 |
| Render | 1 GB；一個工作區一個 | **30 天後過期**，再 14 天寬限就刪掉 | 沒有 | Basic-256mb $6／月，加 $0.30／GB；Hobby 工作區可倒回 3 天 |
| Koyeb | 1 GB；每月 5 小時運算 | 5 分鐘沒用就睡 | 文件沒寫 | Small $29.76／月 |
| Fly Managed Postgres | 沒有 | — | 沒查 | Basic $38／月，加 $0.28／GB 月 |
| 自己裝在 VPS | 不另外收錢 | 不會 | 自己做 | 算在 VPS 月費裡 |

補充：

- Neon 的 1 CU 約 4 GB 記憶體（價錢頁：「2 CU (8 GB RAM)」）。用最小的 0.25 CU，100 CU 小時約可醒著 400 小時（推論）。沒人用 5 分鐘就睡，一個隊應該用不完（推論）。
- Neon 亞洲只有新加坡、雪梨；沒有東京。
- 流程檔的 JSON 很小，成功率紀錄也是一筆一筆的小資料，1 GB 很夠（推論）。音樂檔不放資料庫，放下面第 5 節的地方。

## 4. 寄信

SPF、DKIM、DMARC：在網域的 DNS 裡加幾行設定，讓收信的一方（例如 Gmail）能確認「這封信真的是這個網域寄的」。要設這些，就要有自己的網域。

| 家 | 免費 | 一定要自己的網域嗎 | 付費起價 |
|---|---|---|---|
| Resend | 每月 3,000 封、每天 100 封、3 個網域 | **要**。「a domain you own (i.e., not a shared or public domain)」 | Pro $20／月，5 萬封 |
| Brevo | 每天 300 封 | 寄件人是 gmail.com 這類免費信箱時沒辦法驗證，Brevo 會暫時換成 `brevosend.com` 寄；官方叫你買網域 | 價錢頁要跑 JS 才顯示，沒查到 |
| Postmark | 每月 100 封 | **要**。不准用 Gmail、Yahoo 這類公共信箱寄 | Basic $15／月，1 萬封 |
| Amazon SES | 新客戶最多 $200 免費額度（免費方案在開帳號後 6 個月內） | 寄件人要先驗證。新帳號在「沙盒」：只能寄給驗證過的地址、一天 200 封；要申請正式使用，約 96 小時內回覆 | 每 1,000 封 $0.10 |
| Gmail 帳號 | 一天約 500 封 | 不用，用自己的 @gmail.com | 免費 |

用 Gmail 帳號寄的細節：

- 程式要用「應用程式密碼」登入，要先開兩步驟驗證。Google 寫「App passwords aren't recommended」。
- Render 免費、Railway 非 Pro 都擋 SMTP，這兩家用不了。
- 邀請信、設密碼信的寄件人會是管理員自己的 Gmail。

### 寄到 Gmail 會不會進垃圾信

- Google 2024-02-01 起的規則：寄到 Gmail 的都要設 SPF 或 DKIM、正反向 DNS 要對、用 TLS、垃圾信檢舉率低於 0.3%。一天寄 Gmail 超過 5,000 封的，還要 DMARC，寄件人網域要對齊 [Google 寄件規則]。
- 我們一天只寄幾封邀請信、重設密碼信（推論），不算大量寄件者。用 Resend 或 Postmark，加上自己的網域設好 SPF、DKIM，就符合規則。
- 會不會進垃圾信，沒有一家保證。要實際寄幾封到 Gmail 看（推論）。
- 用 Gmail 帳號寄，信從 Google 自己的伺服器出去，認證是 Google 管的（推論：不會因為認證失敗被擋）。`gmail.com` 的 DMARC 是 `p=none`（2026-11-06 用 `dig TXT _dmarc.gmail.com` 查）。
- 寄件人寫 @gmail.com、卻從別家寄出去，收信方核對不過：Brevo 改用它的網域寄，Postmark 直接不准 [Brevo 驗證網域][Postmark 公共信箱]。

## 5. 放音樂檔（mp3、m4a、wav）

| 地方 | 免費 | 下載流量 | 付費 |
|---|---|---|---|
| Cloudflare R2 | 每月 10 GB、A 類操作（寫入）100 萬次、B 類（讀取）1,000 萬次 | **免費** | $0.015／GB 月 |
| Fly volume | — | Fly 對外：北美、歐洲 $0.02／GB，亞太 $0.04／GB | $0.15／GB 月 |
| Render disk | 免費服務不能接 | Hobby 含 5 GB／月 | $0.25／GB 月 |
| Railway volume | Free 最大 500 MB | $0.05／GB | $0.15／GB 月 |
| Koyeb | 免費 instance 不能接 | — | — |
| Hetzner | CX23 含 40 GB | 歐洲含 20 TB | 算在月費裡 |
| Supabase Storage | 1 GB | 免費含 5 GB | Pro 含 100 GB |
| Neon | 價錢頁寫免費有 5 GB Object Storage（新功能，沒細查） | 沒查 | 沒查 |

補充：

- 用 R2 要先在 Cloudflare 走結帳流程開 R2 訂閱。免費用量要不要先綁卡，官方沒寫清楚。
- 主機自帶的硬碟（volume）通常只接一台機器（推論）。以後要開兩台，音樂放 R2 比較省事（推論）。
- 大小（取自 `browser-capabilities.md`）：2 分半的 mp3 128 kbps 約 2.4 MB、320 kbps 約 6 MB；wav 約 26.5 MB。
- 流量估計（推論）：一支流程 4 段 6 MB 的 mp3，10 個隊員各下載一次約 240 MB。在 Fly 亞太約 $0.01；在 R2 是 0。

## 6. 網域

| 去哪買 | `.com` 一年 | 備註 |
|---|---|---|
| Cloudflare | 照成本，不加價，續約也是 | 價錢頁要過機器人驗證，抓不到數字。2026-11-01 起 `.com` 批發價從 $10.26 漲到 $10.97（Verisign，只讀到摘要），所以大約 $11 出頭（推論） |
| Porkbun | $11.81（註冊、續約、轉入一樣） | `.tw` 第一年 $11.89、續約 $17.99 |

- GitHub Pages 可以用自訂網域：子網域設 CNAME 指到 `littlebluewhite.github.io`，可以開「Enforce HTTPS」（最久要等 24 小時）[GitHub Pages 自訂網域]。
- 設了自訂網域，網址底下不再有 `/cheer_editor/`，`BASE_PATH` 要跟著改（推論，見 `docs/deploy.md`）。

## 建議

只是建議。要用哪一家，在 #188 決定。

### 免費組合（每月 $0，不買網域）

- **前端**：照舊 GitHub Pages。
- **後端**：Google Cloud Run，台灣機房（`asia-east1`）。沒人用就縮到 0；一個隊的用量應該在免費額度內（推論）。
- **資料庫**：Neon 免費，新加坡。
- **音樂**：Cloudflare R2 免費。
- **登入**：做法 B（token）。前後端不同站，cookie 會被 Safari 擋。
- **寄信**：Gmail 帳號加應用程式密碼（Cloud Run 不擋 587）。
- 代價：
  - Cloud Run 要開帳單帳戶，R2 可能也要綁卡。
  - 信用管理員自己的 Gmail 名義寄。
  - Safari 分頁 7 天沒開要重新登入；加到主畫面就不會。
  - 有冷啟動；WebSocket 每 60 分鐘斷一次，要重連。
  - 台灣的後端連新加坡的資料庫，每次查詢多一段路（推論：幾十毫秒）。
- 不想綁卡：後端改用 Koyeb 免費（只有歐美機房、1 小時沒人用就睡）。Render 免費醒來要 1 分鐘、又不能用 SMTP，不建議。

### 便宜付費組合（約每月 $5–6）

- **網域**：一個 `.com`，Cloudflare 或 Porkbun，一年約 $11–12（每月約 $1）。
- **主機**：Fly.io 新加坡（`sin`，跟資料庫同一區），一台 shared-cpu-1x 512 MB。美東 $3.69／月；新加坡沒查到確切價錢，可能貴一點（推論：$4–5）。
  - 這台同時送出前端的檔案和後端 API，網址 `cheer.你的網域`：做法 D。cookie 是同源的（`HttpOnly; Secure; SameSite=Lax`），沒有 Safari 7 天上限，也不用 CORS。
  - 讓這台一直開著（`min_machines_running = 1`），WebSocket 才不會被自動停機打斷。
- **資料庫**：先用 Neon 免費（新加坡）。不夠再升 Launch，用多少付多少。
- **音樂**：Cloudflare R2 免費。
- **寄信**：Resend 免費（每月 3,000 封），用自己的網域設好 SPF、DKIM、DMARC。
- GitHub Pages 那份要不要留（例如給不登入的人照舊用），留給 #188 決定。
- 想把前端留在 GitHub Pages：改用做法 C（`cheer.網域` 給 GitHub Pages、`api.網域` 給 Fly），但 Safari 上的登入最多撐 7 天。

## 沒查到、要實測

- CHIPS 在 Safari 用 `fetch` 跨站呼叫，到底有沒有效。
- Fly.io 東京、新加坡的確切月費（價錢頁的地區表沒載入，要用計算機）。
- Cloud Run 跑 Rust 的冷啟動要幾秒。
- Railway 有沒有亞洲機房、會不會自動睡。
- Brevo 付費方案的價錢。
- Cloudflare `.com` 的確切價錢（要登入後台看）。
- R2 免費用量要不要先綁卡。
- Fly.io 擋不擋對外 SMTP。
- 寄到 Gmail 實際會不會進垃圾信。

## 來源

全部在 2026-11-06 查。

**Safari、cookie**

- [WebKit：Tracking Prevention in WebKit][WebKit 追蹤防護]：https://webkit.org/tracking-prevention/
- [WebKit：Full Third-Party Cookie Blocking and More（2020-03-24）][WebKit 2020]：https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- [WebKit：CNAME Cloaking and Bounce Tracking Defense（2020-11-12）][WebKit CNAME]：https://webkit.org/blog/11338/cname-cloaking-and-bounce-tracking-defense/
- [WebKit：Private Browsing 2.0（2024-07-16）][WebKit 私密瀏覽 2.0]：https://webkit.org/blog/15697/private-browsing-2-0/
- [WebKit：Features for Safari 26.2（2025-12-12）][WebKit 26.2]：https://webkit.org/blog/17640/webkit-features-for-safari-26-2/
- [MDN：Third-party cookies][MDN 第三方 cookie]（2026-06-15 更新）：https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies
- [MDN：Partitioned cookies (CHIPS)][MDN CHIPS]：https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Privacy_sandbox/Partitioned_cookies
- [MDN：Set-Cookie][MDN Set-Cookie]（2026-09-01 更新）：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- [MDN：Site][MDN Site]（2026-01-05 更新）：https://developer.mozilla.org/en-US/docs/Glossary/Site
- [MDN browser-compat-data 8.1.8][BCD 8.1.8]（`http/headers/Set-Cookie.json` 的 `Partitioned`）：https://github.com/mdn/browser-compat-data
- [Public Suffix List][PSL]（VERSION 2026-11-04_19-07-29_UTC）：https://publicsuffix.org/list/public_suffix_list.dat
- [GitHub Docs：Managing a custom domain for your GitHub Pages site][GitHub Pages 自訂網域]：https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

**主機**

- Fly.io 價錢：https://docs.fly.io/about/pricing
- Fly.io 自動停機、啟動：https://docs.fly.io/launch/autostop-autostart/
- Fly.io WebSockets：https://docs.fly.io/networking/websockets
- Fly.io 地區：https://docs.fly.io/reference/regions
- Render 免費方案：https://render.com/docs/free
- Render 價錢：https://render.com/pricing
- Render WebSockets：https://render.com/docs/websocket
- Render 地區：https://render.com/docs/regions
- Railway 價錢：https://railway.com/pricing
- Railway 對外連線（SMTP）：https://docs.railway.com/networking/outbound-networking （只讀到摘要）
- Railway Socket.IO 指南：https://docs.railway.com/guides/socketio （只讀到摘要）
- Koyeb 價錢：https://www.koyeb.com/pricing
- Koyeb instance（免費 instance）：https://www.koyeb.com/docs/reference/instances
- Koyeb TCP Proxy（提到 WebSocket）：https://www.koyeb.com/docs/run-and-scale/tcp-proxy
- Koyeb FAQ（擋 25 埠）：https://www.koyeb.com/docs/faqs/general （只讀到摘要）
- Cloud Run 價錢：https://cloud.google.com/run/pricing
- Cloud Run WebSockets：https://docs.cloud.google.com/run/docs/triggering/websockets
- Google Cloud 免費方案（要帳單帳戶）：https://docs.cloud.google.com/free/docs/free-cloud-features
- Google Cloud 防火牆（只擋 25 埠）：https://docs.cloud.google.com/firewall/docs/firewalls （只讀到摘要）
- Hetzner Cloud：https://www.hetzner.com/cloud/ 、https://www.hetzner.com/cloud/cost-optimized/ 、https://www.hetzner.com/cloud/regular-performance/
- Oracle Always Free：https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

**資料庫**

- Neon 價錢：https://neon.com/pricing
- Neon 縮到 0：https://neon.com/docs/introduction/scale-to-zero
- Neon 地區：https://neon.com/docs/introduction/regions
- Supabase 價錢：https://supabase.com/pricing
- Supabase 備份：https://supabase.com/docs/guides/platform/backups
- Koyeb 資料庫：https://www.koyeb.com/docs/databases

**寄信**

- Resend 價錢：https://resend.com/pricing
- Resend 網域：https://resend.com/docs/dashboard/domains/introduction
- Brevo 免費方案限制：https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan （只讀到摘要）
- [Brevo：驗證網域][Brevo 驗證網域]：https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC （只讀到摘要）
- Postmark 價錢：https://postmarkapp.com/pricing
- [Postmark：為什麼不能用 Gmail][Postmark 公共信箱]：https://postmarkapp.com/blog/why-cant-i-use-gmail-address （只讀到摘要）
- Amazon SES 價錢：https://aws.amazon.com/ses/pricing/
- Amazon SES 沙盒：https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- Gmail 寄信上限：https://support.google.com/mail/answer/22839
- Google 應用程式密碼：https://support.google.com/accounts/answer/185833
- [Google 寄件規則][Google 寄件規則]：https://support.google.com/a/answer/81126
- `gmail.com` 的 DMARC：`dig +short TXT _dmarc.gmail.com` → `v=DMARC1; p=none; sp=quarantine; …`

**音樂檔、網域**

- Cloudflare R2 價錢：https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 開始用：https://developers.cloudflare.com/r2/get-started/ （只讀到摘要）
- Cloudflare Registrar：https://www.cloudflare.com/products/registrar/
- Porkbun 網域價錢：https://porkbun.com/products/domains
- Verisign 2026 第一季財報（`.com` 漲價）：https://investor.verisign.com/news-releases/news-release-details/verisign-reports-first-quarter-2026-results （只讀到摘要）

[WebKit 追蹤防護]: https://webkit.org/tracking-prevention/
[WebKit 2020]: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
[WebKit CNAME]: https://webkit.org/blog/11338/cname-cloaking-and-bounce-tracking-defense/
[WebKit 私密瀏覽 2.0]: https://webkit.org/blog/15697/private-browsing-2-0/
[WebKit 26.2]: https://webkit.org/blog/17640/webkit-features-for-safari-26-2/
[MDN 第三方 cookie]: https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies
[MDN CHIPS]: https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Privacy_sandbox/Partitioned_cookies
[MDN Set-Cookie]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
[MDN Site]: https://developer.mozilla.org/en-US/docs/Glossary/Site
[BCD 8.1.8]: https://github.com/mdn/browser-compat-data
[PSL]: https://publicsuffix.org/list/public_suffix_list.dat
[GitHub Pages 自訂網域]: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
[Brevo 驗證網域]: https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC
[Postmark 公共信箱]: https://postmarkapp.com/blog/why-cant-i-use-gmail-address
[Google 寄件規則]: https://support.google.com/a/answer/81126
