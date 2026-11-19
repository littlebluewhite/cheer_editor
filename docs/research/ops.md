# 上線後：部署、備份、出事怎麼知道

Issue #194 的調查。

- 查核日期：2026-11-07（下文所有來源都在這天讀過）。
- 範圍：只查 #194 要用的事實，不做決定。價錢和免費額度在 `docs/research/hosting.md`、`docs/research/hosting-gaps.md` 查過，這裡不重複。
- 標記：「推論」是我推出來的，來源沒直接寫。「查不到」是讀不到或來源沒寫。「社群」是論壇貼文，不是官方文件。
- 這些服務常改。照著做之前請再查一次。

---

## 結論（最影響決策的幾點）

1. **Fly 的 log 只留約 7 天。** 想留更久，官方寫的辦法是另外跑一個 Fly Log Shipper app，把 log 送出去。它能送到 S3 相容儲存，README 點名 Cloudflare R2。Log Shipper 本身是另一台常開的機器。
2. **Fly 不會替你盯著。** 官方文件：沒有內建的指標警報；沒有帳單警報（「yet」）；健康檢查失敗不會自動重開機器。只有社群說記憶體不足（OOM）時會寄信，一天最多一封，也有人沒收到。要知道「網站掛了」，得靠外部監控。
3. **只有一台機器時，預設的 rolling 部署一定會停一下。** 官方：要「健康檢查加至少兩台」才能不停機。`bluegreen` 會先在旁邊開一台新的，健康檢查過了才切過去，一台也能用；但**一定要設健康檢查**，也不能掛 volume。停幾秒，官方沒寫（查不到）。
4. **`release_command`（例如資料表遷移）在任何機器更新之前跑，這時舊版還在接流量。** 官方說遷移要讓新舊程式都能用：先加欄位、加表，晚點才刪或改名。
5. **GitHub Actions 的排程，在公開 repo 60 天沒活動就自動停掉。** 用它跑每天備份，要另外有「死人開關」（備份跑完去報到，沒報到就通知你）。公開 repo 的 run log 和 artifact，任何登入 GitHub 的人都能看、能下載（推論，見第 5 節），所以備份檔不能當 artifact 傳。fork 來的 PR 拿不到 secrets。
6. **免費額度快用完時，幾乎沒有一家會先提醒你。**
   - Neon 免費版：沒有花費通知；用量 API 只給付費方案。只能自己看 Console。CU 小時用完，資料庫就停到下個月。
   - Cloudflare：預算警報是「花了多少錢」才響。在免費額度內花費是 0，所以 R2 用到 8 成不會響（推論）。
   - Resend：每個 API 回應都附「今天、這個月已經用幾封」。超過就回 `429`，信不寄出。
   - Fly：沒有帳單警報，也沒有花費上限。
7. **免費的外部監控各有缺：** UptimeRobot 免費 50 個、5 分鐘一次、可商用，但沒有 heartbeat、沒有 Telegram。healthchecks.io 免費 20 個 heartbeat，可接 Telegram、Discord、手機推播，但它不會主動去檢查網站。Better Stack 免費 10 個（網站監控和 heartbeat 合計）、3 分鐘一次，只有 email 和 Slack。四家都沒有 LINE；LINE Notify 已在 2025-03-31 停止服務。
8. **備份的工具：** R2 可以設「N 天後自動刪」，token 可以只管一個 bucket；R2 **沒有版本控制**，但有 bucket lock 防刪。Neon 倒回是**整個覆蓋**主要 branch（會自動多一個備份 branch），也可以從過去的時間點另開一個 branch。`pg_dump` 要用**不經過 pooler 的連線字串**，版本要和資料庫一樣：Postgres 18 就用 `pg_dump` 18。

---

## 1. Fly.io 的 log

### 1.1 在哪裡看、留多久

- log 就是機器裡程式印到 stdout 的東西。〔Fly Logging overview〕
- **即時看**：dashboard 的 Live Logs 頁，或 `fly logs`。`fly logs` 先印最近的 log，再一直跟著印；`--instance <機器 ID>` 只看一台。〔Fly Live tail logs〕
- **搜尋**：dashboard 按「Search logs in Grafana」，或直接開 `fly-metrics.net` 的 fly-logs 儀表板。後端是 VictoriaLogs，用 LogsQL 查。〔Fly Search logs〕
  - 原文：「We currently retain logs for 7 days.」
  - 「Searchable application logs are a beta feature. During the beta period, log search is free.」
- **用程式抓**：`GET /api/v1/apps/:app_name/logs`，就是 `fly logs` 背後用的。〔Fly Logs API options〕
  - 預設回「最近 24 小時內最新的 100 筆」，用 `next_token` 翻頁。
  - 官方說這是唯一拿得到歷史 log 的方式，最遠到保留期（「about 7 days」）。
  - 官方說這個 API「isn't officially supported for external use」，但 flyctl 靠它。
- 指標（CPU、記憶體等，不是 log）：Fly 代管的 Prometheus 留「approximately 15 days」，目前不另收費。〔Fly Metrics〕

### 1.2 想留更久：Fly Log Shipper

- 官方原文：「Here's the easiest way to ship your logs to a location of your choosing.」指的就是 Fly Log Shipper。〔Fly Export logs〕
- 它是你組織裡**另一個 Fly app**，裡面跑 Vector，從 Fly 內部的 log 串流（NATS）收 log，再轉送出去。
- 官方的設定要點：
  - 刪掉 `[http_service]`，用 `fly deploy --no-public-ips` 部署，不開對外 IP。
  - 設 `SUBJECT = "logs.<app 名>.>"`，只送一個 app 的 log；不設就送整個組織的。
  - 「can occasionally stop shipping logs without exiting」：建議加頂層 `[checks]`，檢查 Vector 的 `:8686/health`。
  - 只從連上那一刻開始送，連上之前的 log 拿不到。〔Fly Logs API options〕
- 可以送去的地方很多。AWS S3 那一項有 `S3_ENDPOINT`，README 原文：「Endpoint URL for S3 compatible object stores such as Cloudflare R2 or Wasabi」。〔fly-log-shipper README〕
- 推論：
  - 送到 R2 的一個 bucket，再設「N 天後刪」的生命週期規則（第 6.1 節），就能留比 7 天久。
  - Log Shipper 多一台常開機器。最小的 256 MB 在 `sin` 約 US$2.78／月（價錢見 `hosting-gaps.md`）。它需要多少記憶體，文件沒寫（查不到）。
  - 送去 Better Stack 不會比較久：它免費版的 log「3 GB logs retained for 3 days」，比 Fly 自己的 7 天還短。〔Better Stack Pricing〕

---

## 2. Fly.io：出事通知、部署方式、排程機器

### 2.1 Fly 會不會通知你

官方文件：

- 「Fly.io doesn't include built-in alerting on metrics」。要警報，得自己接 Grafana 警報規則或 Prometheus Alertmanager。〔Fly Metrics〕
- 健康檢查失敗：proxy 不再把流量送過去，但「your Machines won't automatically restart or stop due to failing their health checks, this needs to be done manually」。〔Fly Health checks〕
- 沒有任何健康的機器時：「the connection will block, waiting for a Machine to become healthy」。〔Fly App availability〕
- 帳單：「We don't support billing alerts (yet)」。〔Fly Cost management〕
- 機器當掉、重開時會不會寄信：文件沒寫（查不到）。

社群（非官方）：

- OOM 會寄信。2022-12-14 Fly 員工確認：「We only send this at most once per day.」〔社群 9376〕
- 2025-05-12 有人 OOM 卻沒收到信，Fly 員工查了也說不出原因。這個人說帳號設定裡只看到「failed release notifications」（部署失敗通知）的開關。〔社群 24833〕

機器自己會不會重開：

- `fly launch`、`fly deploy` 建的機器，預設重開策略是 `on-fail`：程式以非 0 結束時，5 分鐘內最多重開 `max_retries` 次（預設 10），之後就停著。〔Fly Machine restart policy〕
- 推論：要知道「掛了」，用外部監控（第 3 節）定時打一個**不碰資料庫**的網址。

### 2.2 部署方式（`[deploy] strategy`）

| 方式 | 做什麼 | 限制 |
|---|---|---|
| `rolling`（預設） | 一台一台：把舊的停掉，換成新的 | `max_unavailable` 控制一次停幾台，預設 0.33 |
| `immediate` | 全部一起換，不等健康檢查 | 官方說給緊急狀況用 |
| `canary` | 先開一台新的，健康了再照 rolling 換 | 不能掛 volume |
| `bluegreen` | 每台舊的旁邊開一台新的；新的全部通過健康檢查，才切流量、刪舊的 | **至少要設一個健康檢查**；不能掛 volume |

- `max-per-region` 設 1 時，canary、bluegreen 都要暫時多一台，所以預設改回 rolling。

〔Fly fly.toml configuration、Fly Deploy an app〕

只有一台時：

- 官方：「Working with health checks and at least two Machines, you can avoid downtime.」〔Fly Zero-downtime deployments〕
- 社群 2025-03-11：發文者轉述 Fly 客服確認「You can't have a rolling deployment with a min number of machines of 1 and not have downtime.」〔社群 24133〕
- 停幾秒：官方沒寫（查不到）。推論：大約是「舊程式關掉（`kill_timeout` 預設 5 秒）＋新機器開機＋健康檢查通過」。
- `bluegreen` 文件寫「For every running Machine, a new one is booted alongside it」，所以一台也能用。推論：部署時短暫有兩台，多付幾分鐘的錢。
- `bluegreen` 靠健康檢查判斷。社群 2026-04 有人設定寫錯，新機器還沒開好就被切過去；Fly 員工請他拿掉 `http_service` 裡的 `processes = ['app']` 後就好了。〔社群 27642〕推論：上線前實際部署一次，看會不會斷。
- 健康檢查要放在 `[[http_service.checks]]`（服務層級，會影響流量分配）。頂層 `[checks]`「don't influence routing」，只用來觀察。〔Fly Zero-downtime deployments〕bluegreen 要哪一種，文件只寫「at least one health check」（推論：服務層級那種）。
- 每次部署還有 smoke check：機器啟動後看約 10 秒，一直重開就中止部署。〔Fly Deploy an app〕

### 2.3 `release_command`

- 原文：「before any of your deployed Machines are created or updated」。〔Fly fly.toml configuration〕
  - 用新的映像檔開一台臨時機器跑，每次部署跑一次。
  - 拿得到環境變數、secrets、網路；拿不到 volume。
  - 非 0 結束就中止部署。
  - 預設 5 分鐘逾時（可改 `release_command_timeout`）。
  - log 會出現在 `fly deploy` 和 `fly logs`。
- **跑的時候舊版還在接流量。** 官方的零停機指南：遷移跑完、機器一台台換的期間，「If the old app code can't handle the new schema, users will see errors while old Machines are still running.」bluegreen 也一樣，要等新機器全部通過才切。〔Fly Zero-downtime deployments〕
- 官方建議：程式能同時處理新舊資料表結構；遷移先加欄位、加表，晚點才刪或改名。

### 2.4 排程機器（`fly machine run --schedule`）

〔Fly Run a new Machine、Fly Task scheduling、Fly Billing〕

- 只能選 `hourly`、`daily`、`weekly`、`monthly`，時間是「fuzzy」（大約）。
- `fly machine run` 當下先跑一次，之後大約每小時／天／週／月一次。用 `fly machine create --schedule` 建的，第一次要自己啟動。
- 文件原文：「Scheduled machines cannot be started via flyctl or Machines API commands, they will only run according to the schedule.」
- 時間到時，機器所在主機資源不夠就會失敗，「It's up to you to build the appropriate level of redundancy」。
- 預設重開策略 `on-fail`。
- 官方排程指南說它適合「~1x/day」、「Not for precise timing」。其他做法：Cron Manager（要另一個 app）、Supercronic（跑在 app 的容器裡）、外部排程（點名 GitHub Actions）。
- 費用：在跑的時候按秒算；停著時只收 rootfs，每 GB 每月 US$0.15。
- 推論：
  - 256 MB 機器每天跑 5 分鐘，一個月 CPU 加記憶體約 US$0.01，加上停著的 rootfs，總共不到 US$0.1。
  - 在 Fly 新加坡跑 `pg_dump`，連 Neon 新加坡，路很短。也不受 GitHub 排程「60 天停用」和公開 log 的影響（第 5 節）。

---

## 3. 免費的外部監控

先分兩種：

- **主動檢查**：服務定時去打你的網址，打不通就通知你。抓「網站掛了」。
- **heartbeat（死人開關）**：你的工作（例如每天備份）做完去「報到」，時間到沒報到就通知你。抓「排程沒跑」。

| 服務 | 免費數量 | 多久查一次 | heartbeat | email | Telegram | Discord | LINE | 手機推播 | 商用 |
|---|---|---|---|---|---|---|---|---|---|
| UptimeRobot | 50 個監控、1 個狀態頁 | 5 分鐘 | **沒有**（付費才有） | 有 | **沒有**（付費才有） | 有 | 沒有 | 官方 App（Android、iOS） | 可以 |
| Better Stack | 10 個（監控和 heartbeat 合計）、1 個狀態頁 | 3 分鐘 | 有（算在 10 個內） | 有 | 沒列 | 沒列 | 沒有 | 沒列在免費版 | 定價頁寫「Free for personal projects」；條款沒找到禁止商用 |
| healthchecks.io | 20 個 job，每個留 100 筆紀錄 | 不主動檢查；週期最短 1 分鐘 | 就是它的功能 | 有 | 有 | 有 | 沒有 | 經 ntfy、Pushover、Gotify、Pushbullet | 條款沒限制；不准開多個帳號繞過上限 |
| Cronitor | 5 個（cron、heartbeat、網站、API 合計）、1 個使用者 | 最快 5 分鐘 | 有 | 有 | 沒列 | 有 | 沒有 | 沒列（查不到） | 寫「for homelabs and small projects」；條款沒找到禁止商用 |

細節：

- **UptimeRobot**〔UptimeRobot Pricing、Terms、Fair Use〕
  - 比較表（綠勾、紅叉是圖，我從網頁原始碼讀）：免費版「Heartbeat monitoring」、「Slack, Mattermost, Telegram & MS Teams」、「Webhook, Zapier, Pagerduty」都是叉。
  - 免費有「Basic 3rd party integrations」：Google Chat、Discord、Pushover、Pushbullet、Splunk。免費版寫「Only 5 integrations」。
  - 「Re-check from a second data center」免費有。紀錄留 3 個月；每月報告只寄前 3 個月。
  - 簡訊、電話：免費「Not included, can be added」（要另外買點數）。
  - 條款原文：「UptimeRobot is available for any use, including commercial and business use.」條款最後更新 2026-05-26，加了 Fair Use Policy（禁止多帳號繞過上限等）。
- **Better Stack**〔Better Stack Pricing、Check frequency〕
  - 定價頁免費版只寫「Slack & e-mail alerts」。推播、電話、簡訊列在付費的 Responder 授權下（推論：免費沒有）。
  - 定價頁沒寫免費版多久查一次。說明文件（2025-03-24 更新）：「from 3 minutes for free plans to 30 seconds for paid plans」。
- **healthchecks.io**〔healthchecks.io Pricing、首頁、Configuring notifications、Management API〕
  - 它**不會主動去打你的網站**，只等你的程式來報到。
  - 週期、寬限時間最短都是 60 秒。也可以用 cron 運算式設排程。
  - 簡訊、WhatsApp、電話只有付費方案有點數。定價頁沒寫免費版限制哪些通知方式。
  - 開源專案和非營利可以免費用 Business 方案（要寫信申請）。
- **Cronitor**〔Cronitor Pricing、Terms〕
  - 免費版：「Email and Slack alerts」、「No SMS alerts」、「No premium integrations」。比較表「Email and chat alerts（Slack, Discord, Teams, webhooks）」免費有勾。
- **LINE**：四家都沒列。LINE Notify「2025年3月31日にサービスを終了」，官方叫人改用 Messaging API（每月有一定免費則數）。〔LINE Notify 結束公告〕推論：要 LINE，只能自己寫 webhook 轉 Messaging API；免費版有 webhook 的是 healthchecks.io 和 Cronitor。
- Fly 官方文件在講背景工作監控時，點名 Dead Man's Snitch 這類服務。〔Fly Health checks〕我沒查它的免費方案。
- 推論：兩種一起用。主動檢查打一個不碰資料庫的網址；heartbeat 盯每天的備份。

---

## 4. 免費額度快用完時，誰會先講

#194 寫「免費額度用到約 8 成再升付費」。下面是各家能不能在 8 成時讓你知道。

### 4.1 Neon 免費版

〔Neon Plans、Free plan FAQ、Monitor billing and usage、Consumption metrics〕

- **花費通知**（每月費用到門檻的 80%、100% 寄 email）：只有 Launch、Scale。免費版「Not available」。
- **用量 API**（`/consumption_history/v2/...`）：只有 Launch、Scale、Agent、Enterprise。免費版打會回 `403`。
- 免費版只能看 Console：
  - Projects 頁和專案的 Overview 頁有 Compute、Storage、History、Network transfer 四個數字。
  - 「Metrics may be delayed by about an hour and are not updated for inactive projects.」
- 到上限會怎樣：
  - CU 小時或網路流量用完：compute 暫停到下個計費週期。「Existing connections drop and new ones can't open.」
  - 儲存超過 1 GB：會讓儲存變大的新增、修改、刪除都失敗。
  - 資料不會被刪。
- 免費版到上限前或到上限時會不會寄信：文件沒寫（查不到）。

**能不能固定 0.25 CU（不自動擴展）：**

- Computes 文件：每個 compute 可選「Fixed size」（0.25 到 56 CU）或「Autoscaling」。〔Neon Manage computes〕
- 免費版上限 2 CU。免費版新專案的預設是自動擴展 0.25 到 2 CU。〔Neon Plans、Enable autoscaling〕
- 文件沒明寫免費版能不能選固定 0.25（查不到）。推論：能，因為在免費上限內；要在 Console 的「Edit compute」確認。
- 推論：固定 0.25 CU 時，100 CU 小時約等於醒著 400 小時（FAQ 也這樣寫）。開到 2 CU 時，忙的時候一小時最多用掉 2 CU 小時。

### 4.2 Cloudflare R2

〔Cloudflare Budget alerts、Usage-based billing、Notifications available、Changelog〕

- **預算警報（Budget alerts）**，2026-04-21 推出：
  - 本期「用量計費的總金額」超過你設的美元門檻時，寄 email 給你指定的人。
  - 只是通知，「do not pause or cap usage」。
  - 只給 Pay-as-you-go 帳號。
  - 推出公告寫「calculated daily」，看的是「projected monthly spend」（預估月花費）；說明文件寫的是「cumulative usage-based spend」（累計）。兩頁寫法不同。
- 2026-07-20 公告：分批幫 Pay-as-you-go 帳號自動建一個 US$10 的預算警報。
- **用量通知**（看單一產品的位元組、次數，不看錢）：文件寫「If you are on a Professional plan or higher」。範例只舉 Argo、Load Balancing。R2 能不能選：查不到。
- 推論：
  - 免費額度內花費是 0，預算警報不會響。它只能告訴你「已經開始收錢」。
  - 想在 8 成時知道，要自己看 dashboard（R2 頁或 Billing → Billable Usage），或自己用 API 算。R2 用量的 API 我沒查。

### 4.3 Resend 免費版

〔Resend Account quotas and limits、Usage limits、Retrieve metrics、Pay-as-you-go changelog〕

- 每次呼叫 API，回應標頭帶已用量：
  - `x-resend-daily-quota`：今天已用幾封，「Only sent to free plan users」。
  - `x-resend-monthly-quota`：這個月已用幾封。
- 每日額度照 UTC 日界，UTC 半夜 0 點重算（推論：台灣早上 8 點）。
- **超過**：回 `429`，錯誤類型 `daily_quota_exceeded` 或 `monthly_quota_exceeded`。文件沒說會排隊晚點寄（推論：這封就是沒寄出）。
- 超量付費（pay-as-you-go）只給付費方案。
- **提醒信**：2025-12-05 的公告寫「Resend emails you an alert when you are approaching your quota limits, as well as when you exceed your quota (at 80%, 100%, etc.)」。這篇講的是付費方案；免費版會不會收到，沒寫（推論：會，未確認）。
- **用量 API**：有 `GET /emails/metrics`，回帳號層級的寄送統計（received、sent、delivered……），沒寫限付費方案；資料保留看方案（免費 30 天）。沒找到直接回「剩幾封」的端點（查不到）。推論：讀上面兩個標頭最簡單。

### 4.4 Fly

〔Fly Cost management、Fly Billing〕

- 「We don't support billing alerts (yet), so budget accordingly.」
- 「Free allowances don't cap your bill. … there's no soft ceiling. If you go over, we'll bill you.」
- 官方叫你常看 dashboard 的「current month to date bill」。
- 沒有花費上限的功能（文件沒有；推論）。
- 建錯資源或被攻擊造成的大帳單，可以寫信到 billing@fly.io 談退款。

---

## 5. GitHub Actions（公開 repo）

**排程會被停用**〔GitHub Events that trigger workflows、Disable and enable workflows〕

- 原文：「In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days.」
- 停了要到 Actions 頁手動重新啟用。停用前或停用時會不會通知你：文件沒寫（查不到）。
- 其他限制：
  - 最短 5 分鐘一次。
  - 整點最忙，會延遲；「some queued jobs may be dropped」。
  - 只跑預設分支上的 workflow 檔。
  - 預設 UTC；可以用 `timezone` 指定時區。
- fork 出去的 repo，排程預設關閉。

**log 和 artifact 誰看得到**〔GitHub Use workflow run logs、Download workflow artifacts、About repositories、Actions settings〕

- 看 workflow run「must be logged in to a GitHub account … including for public repositories」。
- 看 log、搜 log、下載 log 和 artifact：要「Read access to the repository」。
- 「Public repositories are accessible to everyone on the internet.」
- 推論：任何登入 GitHub 的人，都能看公開 repo 的 run log、下載 artifact。
- 保留：預設 90 天；公開 repo 可設 1 到 90 天。2026-10-01 起，這個設定也套用到 workflow run、check、commit status。
- secrets 印到 log 會自動遮蔽，但「this redaction is not guaranteed」（值被改寫過就可能漏）。〔GitHub Secrets〕
- 推論：備份檔不要用 `upload-artifact` 傳；從 runner 直接傳到 R2。

**fork 來的 PR 拿不拿得到 secrets**〔GitHub Events that trigger workflows、Actions settings〕

- 原文：「With the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is triggered from a forked repository.」
- `GITHUB_TOKEN` 在 fork 來的 PR 只有讀權限。
- 第一次貢獻的人開的 PR，可能要維護者核准才會跑。
- `pull_request_target` 用主 repo 的權限跑。官方警告：在它底下跑別人送來的程式碼，會洩漏 secrets 或寫入權限。

**現況**：`.github/workflows/deploy.yml` 只在推到 `main` 時跑，沒有排程，也沒有 PR 觸發。

---

## 6. 備份：R2 和 Neon

### 6.1 R2

**生命週期規則（自動刪）**〔R2 Object lifecycles〕

- 可以設「N 天後刪」（例：`Expiration: { Days: 90 }`），可以只套用某個 prefix，最多 1,000 條。
- 「Objects will typically be removed from a bucket within 24 hours」到期後。刪掉就不再收錢。
- 每個 bucket 預設有一條：沒完成的分段上傳，7 天後清掉。
- 設定方式：dashboard（bucket → Settings → Object Lifecycle Rules）、`npx wrangler r2 bucket lifecycle add`、S3 API。
- 文件沒寫限付費（推論：免費額度內也能用；R2 只有一種方案，免費是用量額度）。

**只管一個 bucket 的 token**〔R2 API tokens〕

- 建 R2 API token 時選「Object Read & Write」或「Object Read only」，可以限定一組 bucket。
- 這兩種只能用在 S3 相容 API，不能用 Cloudflare REST API。
- 「Admin Read & Write」能建、刪 bucket，改所有設定。
- 「Object Read & Write」寫的是「read, write, and list objects」；能不能刪檔，沒寫（查不到）。

**版本控制**〔R2 S3 API compatibility〕

- `GetBucketVersioning`、`PutBucketVersioning` 都標 ❌。**R2 沒有物件版本**：覆蓋或刪掉就回不來。

**替代：bucket lock**〔R2 Bucket locks〕

- 在設定的期間內（或永久）擋住覆蓋和刪除。
- 「Bucket lock rules take precedence over lifecycle rules」：生命週期也刪不掉被鎖的檔。
- 有 lock 規則時不能清空 bucket。
- 推論：備份 bucket 設「lock 7 天、生命週期 30 天刪」，就算 token 外洩，最近 7 天的備份也刪不掉、改不了。

### 6.2 Neon 免費版：倒回 6 小時內

〔Neon Instant restore、History window、Manage branches、Plans〕

**兩種做法：**

1. **原地倒回（Instant restore）**
   - 只能對 root branch（最上層的 branch）做。
   - 整個 branch 覆蓋成那個時間點：所有資料庫、`neon_auth` 都一起。原文：「not a merge」。
   - 現有連線會短暫中斷，連線字串不變，「last a few seconds」。
   - Neon 自動留一個 `{branch 名}_old_{時間}` 的備份 branch，想反悔可以用。
   - Console：Postgres database → Backup & Restore → Restore from history。
   - CLI 例：`neon branches restore main ^self@2026-11-07T01:00:00Z --preserve-under-name main_old`（倒回自己時，`--preserve-under-name` 必填）。
2. **另開一個 branch**
   - 建 branch 時選「Past data」，指定歷史窗內的時間，得到那時候的一份副本。
   - 推論：只想救回幾筆資料時，這樣比較安全，原本的資料不動。

**其他：**

- 動手前可以用 Time Travel Assist，對過去的時間點做唯讀查詢，找準時間。
- 歷史窗：免費版 6 小時，最多 1 GB 的變更，不能調長。設成 0 就沒有倒回功能。
- branch：免費每個專案 10 個。推論：每倒回一次就多一個備份 branch，要記得刪。「從別的 branch 倒回」產生的備份 branch 刪不掉。
- Neon 的 Object Storage 和 Functions 不會跟著倒回（我們音樂放 R2，推論：不受影響）。

### 6.3 Neon 的 `pg_dump` 建議

〔Neon Backups with pg_dump、Automate pg_dump、Part 2、Migrate from Postgres、PostgreSQL pg_dump〕

- **連線字串**：「Avoid using `pg_dump` over a pooled connection string.」要用直連的：主機名**沒有 `-pooler`**。在 Console 按 Connect，取消勾選 Connection pooling。
- **版本**：Neon 建議用最新版，並且「the client version matches your Neon project's Postgres version」。
  - Postgres 官方：`pg_dump`「cannot dump from PostgreSQL servers newer than its own major version; it will refuse to even try」。
  - 所以 Postgres 18 要用 `pg_dump` 18。
- **指令**：
  - 備份：`pg_dump -Fc -v -d "<直連字串>" -f <檔名>`
  - 還原：先在新專案建同名的資料庫，再 `pg_restore -v -d "<直連字串>" <檔名>`
- Neon 自己說：不小心刪資料，多半用倒回就夠；`pg_dump` 是給「off-platform redundancy, archival beyond your history window」。
- **官方的自動備份範例**：GitHub Actions 每晚 `pg_dump` 傳到 AWS S3。
  - `cron: '0 5 * * *'`、`RETENTION: 7`（刪掉 7 天前的檔）、`PG_VERSION: '17'`，從 PostgreSQL 官方套件庫裝 `postgresql-17`。
  - 推論：我們是 18，要改成 `'18'`。範例用 AWS IAM role 登入；R2 沒有這個，要改用 R2 token 放 secrets。
- 文件前後不一：「Migrate from Postgres」頁還寫「Neon supports PostgreSQL 14, 15, 16, and 17」；版本支援頁是 14 到 18（見 `hosting-gaps.md`）。
- 推論：`pg_dump` 會叫醒 compute，之後閒置 5 分鐘才睡。每天一次，0.25 CU 多醒約 5～10 分鐘，一個月約 0.6 到 1.3 CU 小時。如果那天本來就有人在用，就不會多。

---

## 7. 沒查到、要實測

- Fly：一台用 rolling 部署實際停幾秒；`bluegreen` 一台時是不是真的不停機。
- Fly：機器當掉、重開會不會寄信（只有社群說 OOM 會寄）；dashboard 有哪些通知開關。
- Fly Log Shipper 要多大的機器；送到 R2 一天會用掉多少次 Class A 操作。
- Neon 免費版：Console 能不能選固定 0.25 CU；到上限前後會不會寄信。
- Cloudflare：用量通知能不能選 R2、免費帳號看不看得到；R2 用量的 API（沒查）。
- Resend 免費版會不會收到 80% 提醒信。
- GitHub 停用排程前會不會寄信。
- R2「Object Read & Write」token 能不能刪檔。
- Better Stack 免費 heartbeat 最短多久；Cronitor 有沒有手機 App。

---

## 來源（皆於 2026-11-07 查核）

標了日期的是頁面上寫的更新或發布日；沒標的是頁面沒寫。

**Fly.io**

- Logging overview：https://docs.fly.io/monitoring/logging-overview
- Live tail logs：https://docs.fly.io/monitoring/live-tail-logs
- Search logs：https://docs.fly.io/monitoring/search-logs
- Logs API options：https://docs.fly.io/monitoring/logs-api-options
- Export logs：https://docs.fly.io/monitoring/exporting-logs
- fly-log-shipper README：https://github.com/superfly/fly-log-shipper
- Metrics：https://docs.fly.io/monitoring/metrics
- Health checks：https://docs.fly.io/reference/health-checks
- App availability：https://docs.fly.io/apps/app-availability
- Machine restart policy：https://docs.fly.io/machines/guides-examples/machine-restart-policy
- Deploy an app：https://docs.fly.io/launch/deploy
- fly.toml configuration（`[deploy]`、`release_command`、`kill_timeout`）：https://docs.fly.io/reference/configuration
- Zero-downtime deployments：https://docs.fly.io/blueprints/seamless-deployments
- Run a new Machine（`--schedule`）：https://docs.fly.io/machines/flyctl/fly-machine-run
- Task scheduling：https://docs.fly.io/blueprints/task-scheduling
- Billing：https://docs.fly.io/about/billing
- Cost management：https://docs.fly.io/about/cost-management
- 社群 9376「Are "out of memory" e-mails throttled?」（2022-12-14）：https://community.fly.io/t/are-out-of-memory-e-mails-throttled/9376
- 社群 24833「Get notifications when app crashed with out of memory?」（2025-05-12）：https://community.fly.io/t/get-notifications-when-app-crashed-with-out-of-memory/24833
- 社群 24133「Rolling update always causes downtime」（2025-03-06～11）：https://community.fly.io/t/rolling-update-always-causes-downtime-proxy-errors-in-log/24133
- 社群 27642「Blue-green deployment always deploy instantly」（2026-04-17～20）：https://community.fly.io/t/blue-green-deployment-always-deploy-instantly/27642

**外部監控**

- UptimeRobot Pricing（2026-10-28）：https://uptimerobot.com/pricing/
- UptimeRobot Terms（變更紀錄最新 2026-05-26）：https://uptimerobot.com/terms/
- UptimeRobot Fair Use Policy：https://uptimerobot.com/terms-fair-use/
- Better Stack Pricing：https://betterstack.com/pricing
- Better Stack Check frequency（2025-03-24）：https://betterstack.com/docs/uptime/check-frequency/
- Better Stack Terms：https://betterstack.com/terms
- healthchecks.io Pricing：https://healthchecks.io/pricing/
- healthchecks.io 首頁（通知方式列表）：https://healthchecks.io/
- healthchecks.io Configuring notifications：https://healthchecks.io/docs/configuring_notifications/
- healthchecks.io Configuring checks：https://healthchecks.io/docs/configuring_checks/
- healthchecks.io Management API：https://healthchecks.io/docs/api/
- healthchecks.io Terms：https://healthchecks.io/terms/
- Cronitor Pricing：https://cronitor.io/pricing
- Cronitor Terms（2022-02-02）：https://cronitor.io/terms
- LINE Notify 結束公告：https://notify-bot.line.me/closing-announce

**Neon**

- Plans（2026-11-04）：https://neon.com/docs/introduction/plans
- Free plan limits FAQ（2026-11-03）：https://neon.com/faqs/free-plan-limits-and-quotas
- Monitor billing and usage（2026-10-09）：https://neon.com/docs/introduction/monitor-usage
- Querying consumption metrics（2026-10-31）：https://neon.com/docs/guides/consumption-metrics
- Autoscaling（2026-06-05）：https://neon.com/docs/introduction/autoscaling
- Enable autoscaling（2026-10-09）：https://neon.com/docs/guides/autoscaling-guide
- Manage computes（2026-11-05）：https://neon.com/docs/manage/computes
- Backups（2026-11-04）：https://neon.com/docs/postgres/backup-restore/backups
- Instant restore（2026-09-25）：https://neon.com/docs/postgres/backup-restore/branch-restore
- History window（2026-08-24）：https://neon.com/docs/postgres/backup-restore/history-window
- Manage branches（2026-10-09）：https://neon.com/docs/manage/branches
- Backups with pg_dump（2026-11-04）：https://neon.com/docs/manage/backup-pg-dump
- Automate pg_dump backups（2026-11-04）：https://neon.com/docs/manage/backup-pg-dump-automate
- Part 2：GitHub Action 每晚備份（2026-11-04）：https://neon.com/docs/manage/backups-aws-s3-backup-part-2
- Migrate from Postgres（2026-11-04）：https://neon.com/docs/import/migrate-from-postgres
- PostgreSQL 18 `pg_dump`：https://www.postgresql.org/docs/18/app-pgdump.html

**Cloudflare**

- R2 Object lifecycles（2026-10-26）：https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- R2 API tokens（2026-10-01）：https://developers.cloudflare.com/r2/api/tokens/
- R2 Bucket locks（2026-10-28）：https://developers.cloudflare.com/r2/buckets/bucket-locks/
- R2 S3 API compatibility（2026-10-14）：https://developers.cloudflare.com/r2/api/s3/api/
- Budget alerts（2026-05-29）：https://developers.cloudflare.com/billing/manage/budget-alerts/
- Usage-based billing（2026-05-29）：https://developers.cloudflare.com/billing/understand/usage-based-billing/
- Notifications available（2026-10-21）：https://developers.cloudflare.com/notifications/notification-available/
- Changelog：Billable Usage dashboard and Budget alerts（2026-04-21）：https://developers.cloudflare.com/changelog/post/2026-04-13-billable-usage-dashboard-and-budget-alerts/
- Changelog：Budget alerts now on by default（頁面顯示 2026-07-20）：https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/

**Resend**

- Account quotas and limits：https://resend.com/docs/knowledge-base/account-quotas-and-limits
- Usage Limits（quota 標頭、429）：https://resend.com/docs/api-reference/rate-limit
- Retrieve Metrics：https://resend.com/docs/api-reference/emails/get-metrics
- Pay-as-you-go Pricing（2025-12-05 發布，2026-07-09 修改）：https://resend.com/changelog/pay-as-you-go-pricing

**GitHub**

- Events that trigger workflows（`schedule`、fork PR）：https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Disable and enable workflows：https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
- Use workflow run logs：https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs
- Download workflow artifacts：https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts
- Managing GitHub Actions settings for a repository（保留天數、fork PR 核准）：https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- Secrets（自動遮蔽）：https://docs.github.com/en/actions/concepts/security/secrets
- About repositories（公開 repo）：https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories
