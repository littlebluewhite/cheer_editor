# 把網頁包進 app 後，比 Safari 多了什麼、少了什麼

Issue #294（地圖 #292）。查核日期 2026-11-20。
範圍：把現在的網頁放進 iPhone、iPad app 裡的網頁畫面（WKWebView），跟 Safari 分頁、加到主畫面比。
聲音歸 #297（查 app 裡音樂和拍子、動畫怎麼對齊），App Store 會不會退「只是包一個網站」歸 #296（查 App Store 上架的規定和發 app 的方法），這裡不查。

只整理事實，不說該選哪一條路。

標記方式：

- **已確認**：有一手來源的原文。方括號是來源代號，見文末「來源」。
- **原始碼**：WebKit 或殼的開放原始碼在某個 tag 寫的內容。程式碼怎麼寫是已確認的；Apple 出貨的 iOS 是不是照這份編，查不到。所以從原始碼推出來的行為一律算推論。
- **推論**：我自己推的，沒有一手來源直接寫。
- **查不到**：找過，沒有一手來源。
- **未確認**：有人這樣寫（bug 裡的使用者留言、殼廠商的文件），或同一份資料自己前後對不上；沒有第二個來源，也沒實測。
- **沿用**：MDN browser-compat-data（BCD）那一格寫 `mirror`，意思是「照 Safari iOS 的值」，不是另外測過 WKWebView。

這台 Mac 只有 Command Line Tools，沒有 Xcode 和模擬器。**這份筆記沒有任何一項在真機上跑過。**

## 結論（事實）

詞的意思在下一節。

1. **殼（包住網頁的 app）有兩種裝法，下面幾乎每一題的答案都跟著變**：「連到網站」（殼打開原本的 `https://` 網址）和「包在 app 裡」（網頁檔放進安裝包，用 `capacitor://localhost` 這類自訂網址開）。所以對照表的 app 那一欄分成兩欄。
2. **「7 天沒用就清掉」在 app 裡照算（推論）。** 已確認的有兩句：這條規則是 ITP（WebKit 的防追蹤機制）做的 [WK-ITP]；iOS 14 起，ITP 在所有 WKWebView app 裡預設開著 [WK-ABD]。明寫可以豁免的只有「加到主畫面的網頁 App」[WK-ITP]；沒有一手來源說 app 裡的 WKWebView 可以豁免（查不到）。原始碼也沒有給 app 豁免（1.2）。沒有真機驗過。
3. **是 7 天還是 30 天，來源互相對不上。** WebKit 說明頁寫 7 天 [WK-ITP]；Safari 27.2 那一版的原始碼和 2024-02 的修改說明寫：沒被「帶追蹤參數的連結」連進來過的網站，是 30 個使用日 [SRC-ITP] [WK-274398]。同一則修改說明又寫它不改變現有行為。哪個才是出貨的行為，要真機驗。
4. **「天」算的是「有用的日子」。** 加到主畫面的網頁 App 自己數自己的使用日 [WK-2020]。app 的 ITP 紀錄存在 app 自己的資料夾裡（原始碼），所以 app 也是自己數（推論）。
5. **空間上限：app 比 Safari 小。** 一個來源最多用磁碟的 15%，全部來源合計 20%；Safari 和加到主畫面是 60%／80% [WK-STORAGE]。
6. **系統空間不夠時，三種都可能被清**，除非拿到「持久儲存」[WK-STORAGE]。原始碼裡，拿得到的只有主畫面網頁 App 的網域和幾種 app 自己設不了的名單 [SRC-NSM] [SRC-WDS]；app 裡的網頁拿不拿得到，推論是拿不到，要真機驗。
7. **service worker 在 app 裡預設沒有。** 要 app 設 App-Bound Domains（或拿到瀏覽器專用的權限）才有 [BCD] [SRC-SW]。「包在 app 裡」的自訂網址不能註冊 service worker（原始碼）[SRC-SWC]。
8. **IndexedDB、OPFS、Cache API：BCD 都寫「沿用 Safari」**，沒有另外測過 WKWebView 的紀錄 [BCD]。
9. **登入 cookie：「連到網站」時是同源的第一方 cookie，規則跟 Safari 分頁一樣。「包在 app 裡」時，後端變成別的站，cookie 變第三方，預設被擋** [WK-ITP] [WK-ABD] [CAP-COOKIES]。
10. **app 跟 Safari 各存各的（推論）。** WKWebView 的資料存在 app 自己的資料夾（原始碼）[SRC-WDSC]，app 讀不到自己資料夾以外的檔案 [APPLE-FS]。所以在 app 裡要另外登入一次，Safari 裡的草稿在 app 裡看不到。Apple 沒有一句話直接這樣寫（查不到）。
11. **檔案：選檔預設能用；下載（`<a download>`）要殼自己接；「用 app 打開別人傳來的流程檔」網頁做不到，app 可以。** Capacitor 8.6.2 的 iOS 原始碼沒看到接下載的地方 [SRC-CAP]。
12. **WebCodecs：BCD 寫「沿用 Safari」**（`VideoEncoder` 16.4、`AudioEncoder` 26）[BCD]。沒有任何來源專講 WKWebView 裡能不能編碼（查不到）。
13. **手感：WKWebView 預設沒有「邊緣滑回上一頁」，有回彈，可以長按選字，長按連結有預覽。** 每一項 app 都有原生開關 [APPLE-BFG] [APPLE-BOUNCE] [APPLE-TEXT] [APPLE-LINK]。Capacitor 預設把回彈關掉 [SRC-CAP]。
14. **120 Hz：WebKit 預設把 `requestAnimationFrame` 壓在 60 fps 附近** [SRC-PREF]。Safari 的使用者可以自己到設定裡關掉這個限制 [WK-173434]；app 裡的 WKWebView 沒有公開的方法關，WebKit 的需求單開著沒人接 [WK-294338]。
15. **照 BCD，網頁自己叫得到分享和選檔，叫不到震動** [BCD]。分享那一格是沿用 Safari 的值，在 WKWebView 裡沒實測。其他原生功能要靠橋（網頁和原生程式互傳訊息的管道）：Capacitor、Tauri 各有官方外掛，沒有的要自己寫。
16. **更新：「連到網站」跟著網站部署走；「包在 app 裡」要換安裝包裡的檔案（推論）。** Capacitor 的文件說 `server.url`（連到網站）「不是給正式版用的」[CAP-CONFIG]。Tauri 的設定參考接受遠端網址當 `frontendDist` 的值，沒寫能不能用在正式版 [TAURI-CONFIG]。Apple 的條文原文在第 6 節，怎麼解讀歸 #296。

## 先講幾個詞

- **WKWebView**：Apple 給 app 用的「網頁畫面」元件。app 裡開一塊地方顯示網頁，用的是跟 Safari 同一個 WebKit 引擎。
- **殼**：一個幾乎只有 WKWebView 的 app，網頁在裡面跑。Capacitor、Tauri 是現成的殼；也可以自己寫。
- **連到網站**：殼打開 `https://` 的原網址，網頁檔還是放在伺服器上。
- **包在 app 裡**：網頁檔放進 app 的安裝包，殼用自己的網址開它（Capacitor 是 `capacitor://localhost`；Tauri 的文件舉的例子是 `tauri://localhost`）。
- **來源（origin）**：`https://`、網域、埠號合起來。瀏覽器的儲存空間和 cookie 都按來源分。
- **ITP**：Safari／WebKit 的防追蹤機制。「7 天沒用就清掉」和「擋第三方 cookie」都是它做的（見 `hosting.md` 第 1 節）。
- **App-Bound Domains**：app 在 `Info.plist` 用 `WKAppBoundDomains` 列出最多 10 個「自己的網域」。iOS 14 起有。
- **橋**：網頁和 app 的原生程式互相傳訊息的管道。

## 0. 查的當天的版本

| 東西 | 版本 | 發布日 | 來源 |
|---|---|---|---|
| Safari、iOS 的 WKWebView（正式版） | 27.2，WebKit 625.2.8 | 2026-10-26 | [BCD] [SAF-NOTES] |
| 同上（測試版） | 27.3 beta | 2026-11-16 | [SAF-NOTES] |
| MDN browser-compat-data | 8.1.10 | — | [BCD] |
| 讀的 WebKit 原始碼 | tag `WebKit-7625.2.8`（版號跟 Safari 27.2 的引擎一樣） | — | [SRC-ITP] 等 |
| Capacitor（`@capacitor/core`、`ios`、`cli`） | 8.6.2；`next` 標籤是 9.0.0-rc.0 | 2026-11-12 | [NPM] |
| Capacitor 8 的要求 | iOS 15 以上、Xcode 26.0 以上、Node 22 以上 | — | [CAP-IOS] [NPM] |
| Tauri（`@tauri-apps/cli`／`@tauri-apps/api`） | 2.12.6／2.12.5；`next` 標籤是 3.0.0-alpha.6／3.0.0-alpha.3 | 2026-11-18／11-16 | [NPM] |
| Tauri iOS 最低版本的預設值 | 15.0 | — | [TAURI-CONFIG] |
| App Store Review Guidelines | 「Last Updated: October 16, 2026」 | — | [ASRG] |
| Apple Developer Program License Agreement | 頁尾「October 29, 2026」 | — | [DPLA] |

Tauri 的 Rust 套件版本沒查，只查了 npm。

Apple 的 Safari 版本說明開頭寫它也管 WKWebView：「Learn about changes for Safari and Safari View Controller …; WKWebView for iOS, iPadOS, macOS, watchOS, and in visionOS」[SAF-NOTES]。

## 1. 存資料

### 1.1 能不能用

| | Safari 分頁 | 加到主畫面 | app：連到網站 | app：包在 app 裡 |
|---|---|---|---|---|
| IndexedDB | 8 起 [BCD] | BCD 沒有這一欄；推論跟 Safari 一樣 | 沿用 [BCD] | 沿用 [BCD]；自訂網址下能不能用，查不到 |
| OPFS（`navigator.storage.getDirectory`） | 15.2 起 [BCD] | 同上 | 沿用 [BCD] | 同上 |
| OPFS 的 `createWritable` | 26 起 [BCD] | 同上 | 沿用 [BCD] | 同上 |
| Cache API（`caches`） | 11.1 起 [BCD] | 同上 | 沿用 [BCD] | 同上 |
| service worker | 11.1 起 [BCD] | 可以（推論：BCD 寫主畫面網頁 App 的通知「can only be sent from a service worker」[BCD]） | **預設沒有**，見下 | **不能註冊**，見下 |
| `navigator.storage.estimate()` | 17 起 [BCD] | 同 Safari | 沿用 [BCD] | 沿用 [BCD] |
| `navigator.storage.persist()` | 15.2 起有這個函式 [BCD]；給不給見 1.4 | 給的機會最大，見 1.4 | 沿用 [BCD]；給不給見 1.4 | 同左 |

service worker 在 WKWebView：

- BCD 兩列互相對不上。`api.ServiceWorkerContainer`（含 `register`）的 WKWebView 那一格寫**不支援**（`false`）。`api.ServiceWorker` 寫 14 起，附註：「Exposed only to apps configured with App Bound Domains (up to 10 domains) or apps with the Web Browser entitlement.」[BCD]
- 原始碼（iOS）：service worker 只在兩種情況開著。一是 app 有 `com.apple.developer.WebKit.ServiceWorkers` 或 `com.apple.developer.web-browser` 權限；二是這個 WKWebView 設了 `limitsNavigationsToAppBoundDomains`。兩個都沒有就關掉 [SRC-SW]。
- `com.apple.developer.web-browser` 是「可以當預設瀏覽器」的權限 [APPLE-WB]。`com.apple.developer.WebKit.ServiceWorkers` 怎麼申請，Apple 文件查不到。
- 原始碼：`serviceWorker.register()` 的指令檔網址不是 HTTP／HTTPS 就丟錯誤，訊息是「serviceWorker.register() must be called with a script URL whose protocol is either HTTP or HTTPS」[SRC-SWC]。「包在 app 裡」的網頁網址是 `capacitor://`、`tauri://`，所以不能註冊（推論）。
- Capacitor、Tauri 的文件都沒寫 iOS 上 service worker 能不能用（查不到）。

App-Bound Domains 是什麼（已確認，[WK-ABD]，2020-06-26）：

- `Info.plist` 加 `WKAppBoundDomains`，最多 10 個網域。「content supplied by the app through local files, data URLs, and HTML strings are always treated as app bound domains」。
- 一加這個鍵，app 裡所有 WKWebView 預設都**不能**注入 JavaScript、不能用自訂樣式、不能動 cookie、不能用訊息橋。
- 要拿回這些，WKWebView 的設定要開 `limitsNavigationsToAppBoundDomains`。開了以後這個網頁畫面只能去清單上的網域，去別的地方會失敗（「App-bound domain failure」）。
- Capacitor 有對應的設定 `ios.limitsNavigationsToAppBoundDomains`，文件寫：`Info.plist` 有 `WKAppBoundDomains` 時建議開，「otherwise some features won't work」；副作用是擋掉清單外的網域；`localhost` 也要加進清單 [CAP-CONFIG]。

### 1.2 「7 天沒用就清掉」在 app 裡算不算

一手來源寫的（已確認）：

- 規則本身：「ITP deletes all cookies created in JavaScript and all other script-writeable storage after 7 days of no user interaction with the website.」清的東西：IndexedDB、LocalStorage、Media keys、SessionStorage、Service Worker registrations and cache [WK-ITP]。
- 加到主畫面豁免：「The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all script-writeable storage, i.e. ITP always skips that domain in its website data removal algorithm.」[WK-ITP]
- app 裡 ITP 預設開：「Additionally in iOS 14.0 and macOS Big Sur, Intelligent Tracking Prevention (ITP), is enabled by default in all WKWebView applications.」[WK-ABD]
- 關掉的唯一方法是使用者自己關，而且 app 要先在 `Info.plist` 寫 `NSCrossWebsiteTrackingUsageDescription`，系統才會在「設定」裡這個 app 的頁面顯示開關。「The setting cannot be read or changed through API calls.」[WK-ABD]
- 「天」是使用日。Safari 是「seven days of Safari use」。主畫面網頁 App：「have their own counter of days of use. Their days of use will match actual use of the web application which resets the timer.」[WK-2020]

查不到：

- 沒有任何 WebKit 部落格、Apple 文件說「app 裡的 WKWebView 不清」或「App-Bound Domains 的網域不清」。[WK-ABD] 全文沒有提到資料會不會被清。

原始碼（tag `WebKit-7625.2.8`）：

- 不清的名單由四種網域合起來：App-Bound Domains、受管理的網域（managed domains）、persisted domains、主畫面網頁 App 的網域。程式裡的註解：「Domains permanently configured to be exempt. This can be home screen web applications, app-bound domains, or similar.」[SRC-ITP]
- 但是把 App-Bound Domains 交給 ITP 的那一段，被一個寫死的開關擋住：`constexpr static const std::atomic<bool> isAppBoundITPRelaxationEnabled = false;` [SRC-WDS]。照這份程式碼，App-Bound Domains **沒有**進到不清的名單（推論）。
- persisted domains 只能用底線開頭的私有介面設（`_setPersistedSites:`）[SRC-WKWDS]。Apple 的授權合約規定 app「must not use or call any private APIs」[DPLA]。
- 非瀏覽器的 app 只要沒寫 `NSCrossWebsiteTrackingUsageDescription`，ITP 一律開 [SRC-DWBC]。
- 清的條件是「在視窗內沒有使用者互動」。視窗有兩種：`operatingDatesWindowShort { 7 }`、`operatingDatesWindowLong { 30 }`，單位是使用日 [SRC-ITP]。一般網域用 30；被標成 `DataRemovalFrequency::Short` 的網域用 7。會被標成 Short 的，是「從被分類成追蹤者的網站、帶著連結參數連過來，而且參數沒被濾掉」的網域 [SRC-ITP]。
- 這個改動的說明（2024-02-09，WebKit bug 265598）：「if we never load a page with cross-site link decoration, or if we load a site with link decoration and link decoration filtering is enabled …, then the DataRemovalFrequency is set to 30-operational days.」同一則說明前面又寫「This patch doesn't change the current behavior」，還有「when the current FirstPartyDataRemovalMode is AllButCookies, website data is deleted after 7-operational days (without user interaction) regardless of whether cross-site link decoration was detected」[WK-274398]。這兩句和 30 天那一句放在一起，讀不出現在到底是哪一個。
- ITP 的紀錄檔在 app 自己的 `Library/WebKit/WebsiteData/ResourceLoadStatistics` [SRC-WDSC]。所以 app 的「使用日」是 app 自己的，不跟 Safari 一起算（推論）。

合起來（推論，都要真機驗）：

- 「連到網站」：規則跟 Safari 分頁一樣會清。差別只在使用日是數「開這個 app 的日子」。app 只開這一個網站，每次開都有點、有按，互動時間就一直更新。
- 「包在 app 裡」：網頁的網域是 `localhost`。原始碼裡 `localhost` 只在「分類成追蹤者」那幾段被跳過，清資料那一段沒看到跳過 [SRC-ITP]。會不會被清，從原始碼看不出來（查不到）。
- 哪一版 Safari 開始帶 30 天的改動，查不到。

### 1.3 空間上限

已確認，[WK-STORAGE]（2023-08-10）。Safari 17.0、iOS 17、iPadOS 17 起：

| | Safari 分頁 | 加到主畫面 | app 裡的 WKWebView |
|---|---|---|---|
| 一個來源最多 | 磁碟總容量的 60% | 跟瀏覽器一樣（60%） | **15%** |
| 所有來源合計 | 80% | 跟瀏覽器一樣（80%） | **20%** |

原文：

- 「For a browser app, the origin quota is up to 60% of the total disk space. For other apps, the origin quota is up to 15% of the total disk space.」
- 「For a browser app, overall quota is up to 80% of the total disk space. For other apps, overall quota is up to 20% of the total disk space.」
- 「An app is a browser app if it can be set as default browser」。
- 「When a web app is running standalone (as Home Screen Web App on iOS …), it has the same origin quota and overall quota as when it is opened in a browser app.」
- 超過一個來源的上限：寫入失敗，丟 `QuotaExceededError`。
- 上限只管 localStorage、Cache API、IndexedDB、Service Worker、File System。「cookies and HTTP cache are currently not subject to the policy」。
- `estimate()` 回報的上限不保證真的存得到那麼多：「there is no guarantee that a site can store that much」。

原始碼的數字一樣：`defaultAppOriginQuotaRatio = 0.15`、`defaultAppTotalQuotaRatio = 0.2`、瀏覽器 `0.6`、`0.8` [SRC-WDSC]。

換算（推論）：64 GB 的 iPad，app 裡一個來源最多約 9.6 GB，合計 12.8 GB。`browser-capabilities.md` 第 2 節估幾段 mp3 加起來幾十 MB，遠小於這個數。

### 1.4 系統空間不夠時會不會被清

已確認，[WK-STORAGE]：

- 「Eviction means automatic website data deletion that is not initiated by the user or website. It can happen under a few conditions: when exceeding the overall quota, when the system is under storage pressure, or when the site has not been interacted with by the user for some time (see Intelligent Tracking Prevention).」
- 一次清掉一整個來源，先清最久沒用的。
- 不會被清的兩種：「Origin might be excluded from eviction if it has active page at the time of eviction, or its storage is in persistent mode.」
- 預設都不是持久模式：「By default, all origins use a best-effort mode」。
- 要持久模式要呼叫 `navigator.storage.persist()`。「WebKit currently grants a request based on heuristics like whether the website is opened as a Home Screen Web App.」

原始碼：

- `persist()` 給不給，只看這個網域在不在 1.2 那份「不清的名單」裡。不在就回傳 `false` [SRC-NSM]。
- 照 1.2，app 自己設得了的 App-Bound Domains 沒進那份名單。所以 app 裡的網頁呼叫 `persist()` 會拿到 `false`（推論，要真機驗）。Safari 分頁拿不拿得到，要看 Safari 有沒有把網站放進那份名單，查不到。

殼的文件怎麼說：

- Capacitor：「Local Storage … must be considered transient, meaning your app needs to expect that the data will be lost eventually. This is because the OS will reclaim local storage from Web Views if a device is running low on space. The same can be said for IndexedDB at least on iOS」[CAP-STORAGE]。它提供原生的 Preferences 外掛放小資料，Filesystem 外掛放檔案。
- Tauri：文件沒談這件事（查不到）。有 Store 外掛（鍵值）和 File System 外掛，iOS 都支援 [TAURI-PLUGINS]。

存在磁碟哪裡（原始碼，[SRC-WDSC]）：

- 一般儲存的預設目錄在 app 的 `Library/WebKit/WebsiteData/` 底下。預設的儲存等級是 `Standard`，這一級的 IndexedDB、Cache API 都跟著來源的目錄走（推論：沒有把每一種資料都追完）。
- HTTP 快取（`NetworkCache`）在 `Library/Caches/WebKit/` 底下。
- `CacheStorage`、`ServiceWorkers` 兩個預設目錄的函式也指到 `Library/Caches/WebKit/` 底下。但程式裡，另外的 Cache API 路徑只在比 `Standard` 低的等級才用到；到了 `Standard`，service worker 的註冊也搬進來源的目錄（`migrateServiceWorkerRegistrationsToOrigins`）[SRC-NSM]。所以推論這兩種實際上跟 IndexedDB 放在一起。service worker 抓下來的指令檔放哪，沒追。
- Apple：`Library/Caches` 系統會清，「the system may delete the Caches directory on rare occasions when the system is very low on disk space」，而且不備份 [APPLE-FS] [APPLE-BACKUP]。`Library` 其他地方不在這條裡。
- 所以 IndexedDB 不在「iOS 把它當快取清」的那個資料夾（推論）；但 WebKit 自己的清除（上面那段）照樣會動它。

### 1.5 跟 Safari 是不是同一份資料

- 加到主畫面：已確認分開。「the website data of home screen web applications is kept isolated from Safari」[WK-ITP]。
- app 裡的 WKWebView：推論分開。
  - WKWebView 預設用 `WKWebsiteDataStore.default()`，「saves website data persistently to disk」[APPLE-WDS]。
  - 原始碼：預設目錄是 app 自己的 `Library` 和 `Library/Caches` 底下 [SRC-WDSC]。
  - Apple：「an iOS app's interactions with the file system are limited to the directories inside the app's sandbox directory」[APPLE-FS]。
  - Apple 沒有一句話直接寫「WKWebView 的資料不跟 Safari 共用」（查不到）。旁證：Apple 說要「share data between your app and Safari」得用 `ASWebAuthenticationSession` [APPLE-SFSVC]。
- 「連到網站」和「包在 app 裡」是不同來源，資料也不是同一份（推論：儲存按來源分）。
- iOS 26 起 `WKWebsiteDataStore` 多了 `fetchData(of:)`、`restoreData(_:)` 兩個方法。Apple 文件只有宣告，沒有說明文字 [APPLE-WDS]。能不能拿來搬資料，查不到。

## 2. 登入用的 cookie

現在的登入 cookie 是伺服器設的、同源、`HttpOnly; Secure; SameSite=Lax`（ADR 0012）。

| | Safari 分頁 | 加到主畫面 | app：連到網站 | app：包在 app 裡 |
|---|---|---|---|---|
| cookie 對網頁來說是 | 同源、第一方 | 同源、第一方 | 同源、第一方（推論：網址沒變） | **第三方**：網頁在 `capacitor://localhost`，後端在別的站 |
| 會不會被擋 | 不會 | 不會 | 推論不會（規則同 Safari） | **預設會**，見下 |
| 7 天上限 | 沒有（ADR 0012） | 沒有 | 推論沒有，見下 | 不適用 |
| 留在哪 | Safari 的資料 | 主畫面 App 自己的，跟 Safari 分開 [WK-ITP] | app 的預設資料儲存區，寫進磁碟 [APPLE-WDS] | 同左 |
| 跟 Safari 是不是同一個登入 | — | 不是 [WK-ITP] | 推論不是（1.5） | 推論不是 |

「連到網站」的細節：

- ITP 的 7 天規則管的是「cookies created in JavaScript」和 JS 寫得到的儲存 [WK-ITP]。伺服器用 HTTP 回應設的 `HttpOnly` cookie 不在裡面（`auth-safety.md` 已寫）。app 裡的 ITP 跟 Safari 是同一套（推論，依據 [WK-ABD]）。
- cookie 不受 1.3 的空間上限管 [WK-STORAGE]。
- 原生程式可以透過 `WKHTTPCookieStore` 讀、寫、刪 cookie，也可以監看 cookie 變動 [APPLE-COOKIE]。設了 App-Bound Domains 之後，這組介面只對清單上的網域有效，而且 WKWebView 要開 `limitsNavigationsToAppBoundDomains` [WK-ABD]。

「包在 app 裡」的細節：

- WebKit：「ITP by default blocks all third-party cookies. There are no exceptions to this blocking.」[WK-ITP]，而 ITP 在所有 WKWebView app 預設開著 [WK-ABD]。
- Capacitor 文件：「As of iOS 14, you cannot use 3rd party cookies by default. Add the following lines to your Info.plist file to get better support for cookies on iOS. You can add up to 10 domains.」接著是 `WKAppBoundDomains` 的範例 [CAP-COOKIES]。
- 這句話跟原始碼對不上：原始碼裡「App-Bound Domains 之間放行第三方 cookie」的模式（`AllExceptBetweenAppBoundDomains`）只在 1.2 那個寫死 `false` 的開關後面才會設 [SRC-WDS] [SRC-NSS]。加了 `WKAppBoundDomains` 第三方 cookie 會不會通，未確認，要真機驗。
- Capacitor 另外兩條路（文件寫的，預設都關）：`CapacitorHttp` 把 `fetch`、`XMLHttpRequest` 換成原生的網路函式庫；`CapacitorCookies` 把 `document.cookie` 換成原生的 [CAP-HTTP] [CAP-COOKIES]。
- Tauri：有 HTTP Client 外掛，用 Rust 的網路函式庫發請求，iOS 完整支援 [TAURI-PLUGINS]。
- `SameSite=Lax` 的 cookie 在跨站的 `fetch` 本來就不送（`hosting.md` 第 1 節）。後端也要另外設 CORS。這兩點是推論：拿現有筆記的規則套過來。

## 3. 檔案

| 要做的事 | 網頁自己（Safari 分頁、加到主畫面） | app 裡的 WKWebView | 殼給的 |
|---|---|---|---|
| 選一個檔案打開（`<input type=file>`） | 可以，Safari 1 起 [BCD] | 沿用 [BCD]。Apple：「By default on iOS, file uploads are enabled if you don't implement this method.」[APPLE-OPENPANEL] | Tauri Dialog 外掛（iOS 部分支援：不能選資料夾）[TAURI-PLUGINS] |
| 別人傳來流程檔，點了「用這個 app 打開」 | **做不到**。網頁版的入口 `LaunchQueue` Safari 不支援 [BCD] | app 可以：在 `Info.plist` 登記檔案類型（`CFBundleDocumentTypes`），系統把檔案網址交給 `scene(_:openURLContexts:)` [APPLE-DOCTYPES] [APPLE-OPENURL] | Tauri：`bundle.fileAssociations` 設定，開檔時收到 `RunEvent::Opened`，文件寫 iOS 可用；自訂副檔名要另外定義 `exportedType` [TAURI-FILEASSOC]。Capacitor：App 外掛的 `appUrlOpen` 事件，文件只寫到自訂網址和 Universal Links，事件資料裡有 `iosOpenInPlace` 欄位；有沒有涵蓋「打開檔案」，文件沒明寫（查不到）[CAP-APP] |
| 存檔（`<a download>`） | Safari iOS 13 起 [BCD] | BCD 寫沿用，但 **app 要自己接**：WebKit 把下載交給 `WKDownloadDelegate`（iOS 14.5 起），存到哪由 app 回答 [APPLE-DOWNLOAD]。Blob 的下載也走這裡（文件提到「a synthesized response for a blob download」）。app 沒接時會怎樣，Apple 文件沒寫（查不到） | Capacitor 8.6.2 的 iOS 原始碼沒看到接下載的地方：管導覽的 `WebViewDelegationHandler.swift` 和建立網頁畫面的 `CAPBridgeViewController.swift` 全檔沒有 `download` 這個字，`ios/Capacitor/Capacitor/` 最上層 60 個項目也沒有檔名帶 download 的（`Plugins/` 子資料夾沒讀）[SRC-CAP]。它給的是 Filesystem 外掛：寫檔要傳字串或 base64，「Blob data is only supported on Web」[CAP-FS]。Tauri：Dialog 外掛有存檔對話框，File System 外掛預設只能動 app 自己的資料夾 [TAURI-PLUGINS] |
| 存檔對話框（`showSaveFilePicker`） | 不支援 [BCD] | 不支援（沿用）[BCD] | 見上一列 |
| 檔案出現在「檔案」App | 下載的檔案由 Safari 處理（沒查） | 要 `Info.plist` 開 `UIFileSharingEnabled`、`LSSupportsOpeningDocumentsInPlace`，檔案放 `Documents` [APPLE-FILESHARING] [CAP-FS] | Capacitor Filesystem 的 `Directory.Documents` [CAP-FS] |
| 分享選單（`navigator.share`，含檔案） | `share` 12.1 起；帶檔案 14 起 [BCD] | 沿用 [BCD]。沒有專講 WKWebView 的來源（查不到） | Capacitor Share 外掛，`files` 參數「Only supported on iOS and Android」[CAP-SHARE]。Tauri 官方外掛沒有分享；官方頁列了社群的 `tauri-plugin-sharesheet` [TAURI-PLUGINS]。自己寫是 `UIActivityViewController`，iPad 上一定要用 popover 顯示 [APPLE-ACTIVITY] |
| 解開 zip（`DecompressionStream`） | 16.4 起 [BCD] | 沿用 [BCD] | — |

WebCodecs（輸出流程影片用）：

| API | Safari iOS | WKWebView |
|---|---|---|
| `VideoEncoder`、`VideoFrame` | 16.4 [BCD] | 沿用 [BCD] |
| `AudioEncoder` | 26 [BCD] | 沿用 [BCD] |

- BCD 只說介面有沒有，不說哪個 codec 能編（`video-export.md` 第 1 節）。
- 沒有任何一手來源專講 WKWebView 裡 WebCodecs 的行為（查不到）。
- `video-export.md` 記的 Safari 26／27 的編碼 bug 是引擎的 bug，在 WKWebView 應該一樣有（推論）。
- 現在 iPad、手機本來就不開「輸出影片」（`video-export.md`「後來怎麼做」）。

## 4. 手感

網頁自己能用的 CSS、API 三種環境都一樣（BCD 都是沿用）。app 多出來的是 WKWebView 的原生開關。
Safari 分頁和加到主畫面實際上怎麼動（例如邊緣滑動），Apple、WebKit 沒有一份文件逐項寫；沒查到的照實寫。

| 項目 | 網頁自己能控制的 | app 裡 WKWebView 的原生開關和預設 | 殼的預設 |
|---|---|---|---|
| 邊緣滑回上一頁 | 沒有標準的關法（沒查到） | `allowsBackForwardNavigationGestures`，「The default value is false.」[APPLE-BFG] | Capacitor、Tauri 的文件沒提（查不到） |
| 回彈（拉過頭彈回來） | `overscroll-behavior` Safari 16 起，BCD 標部分支援：對沒有可捲內容的容器無效 [BCD] | `scrollView.bounces`，「The default value is true.」[APPLE-BOUNCE] | Capacitor 8.6.2 寫死 `aWebView.scrollView.bounces = false` [SRC-CAP] |
| 整頁能不能捲 | CSS | `scrollView.isScrollEnabled`（Capacitor 設的就是它 [SRC-CAP]） | Capacitor `ios.scrollEnabled` [CAP-CONFIG] |
| 長按選字 | `-webkit-user-select`（Safari iOS 3 起）[BCD]。BCD 的 `none`、`text` 這幾個值在 WKWebView 那一格寫不支援，跟屬性那一列（沿用）對不上，未確認 | `WKPreferences.isTextInteractionEnabled`（iOS 14.5 起），預設 `true` [APPLE-TEXT] | — |
| 長按跳出選單 | `-webkit-touch-callout`（Safari iOS 2 起）[BCD] | — | — |
| 長按連結出現預覽 | — | `allowsLinkPreview`，iOS 10 起預設 `true` [APPLE-LINK] | Capacitor `ios.allowsLinkPreview` [CAP-CONFIG] |
| 拖曳時不要捲動、不要縮放 | `touch-action`（Safari iOS 9.3 起；`none`、`pan-x`、`pan-y` 13 起）[BCD] | — | Capacitor `zoomEnabled` [CAP-CONFIG] |
| 鍵盤遮住畫面 | `visualViewport` 13 起；`dvh` 這類單位 15.4 起；`VirtualKeyboard` API **不支援** [BCD] | 沒查到專門的公開屬性 | Capacitor Keyboard 外掛：`resize` 設定「Only available on iOS」，四種：`native`（整個網頁畫面縮小，影響 `vh`）、`body`、`ionic`、`none` [CAP-KEYBOARD]。Tauri：查不到 |
| 內容避開瀏海、圓角 | CSS | `scrollView.contentInsetAdjustmentBehavior`（Capacitor 設的就是它 [SRC-CAP]） | Capacitor `ios.contentInset`，預設 `never` [CAP-CONFIG] |
| 用 Mac 的 Safari 除錯 | 開發選單 | `isInspectable`（iOS 16.4 起），「Defaults to false」[APPLE-INSPECT] | Capacitor `webContentsDebuggingEnabled`：開發版預設開、正式版預設關 [CAP-CONFIG] |
| 螢幕不要自己關（`navigator.wakeLock`） | Safari iOS 16.4 起；18.4 以前在主畫面網頁 App 裡無效 [BCD] | 沿用 [BCD] | — |

### `requestAnimationFrame` 跑不跑得到 120 Hz

- **原始碼**：WebKit 有一個設定 `PreferPageRenderingUpdatesNear60FPSEnabled`，說明是「Prefer page rendering updates near 60 frames per second rather than using the display's refresh rate」，預設 `true`（只有 visionOS 是 `false`）[SRC-PREF]。
- **Safari 分頁**：這個設定在 Safari 的設定裡，使用者可以自己關。bug 裡 2023-08 的使用者留言寫的路徑是「Settings -> Safari -> Advanced -> Experimental Features」，後面的留言改叫它 feature flag；現在的 iOS 上叫什麼沒有查。Antoine Quint（WebKit 的 reviewer [SRC-CONTRIB]）2025-11-05 在 bug 裡寫：iPad Pro（M5）、iOS 26.1、接 144 Hz 外接螢幕，關掉這個設定後，TestUFO 量到 120 fps [WK-173434]。網站自己不能關（推論：這是瀏覽器的設定，沒查到對應的網頁 API）。bug「Support for 120Hz requestAnimationFrame」2017-06-15 開到現在，狀態還是 NEW、沒有人接（2026-05-19 最後更新）[WK-173434]。
- **加到主畫面**：Simon Fraser（WebKit 的 reviewer [SRC-CONTRIB]）2025-08-18 寫：「I get 60fps in a Home Screen web app with default settings.」[WK-294338]
- **app 裡的 WKWebView**：
  - 需求單「Feature Request: Allow WKWebView to Support 120Hz Refresh Rate on ProMotion Devices」（2025-06-11 開），狀態 NEW，沒有人接，最後更新 2026-09-17 [WK-294338]。
  - 開單的人寫：Safari 那個旗標「only affects Safari itself, but not hybrid apps using WKWebView under the hood」「there currently is no way to achieve this」。這是使用者的回報，不是 WebKit 的人說的；但 WebKit 的人在同一張單裡回了別的留言，沒有反駁這一點 [WK-294338]。
  - Apple 文件裡 `WKPreferences`、`WKWebViewConfiguration` 的公開屬性沒有任何一個跟更新率有關（2026-11-20 讀屬性清單）[APPLE-PREFS]。
  - 2026-07 的留言說，Capacitor 和 Tauri 都有人做了外掛，靠呼叫 WebKit 的私有介面解開 120 Hz [WK-294338]。Apple 的授權合約：app「must not use or call any private APIs」[DPLA]。
  - 2026-07-21 另一則留言說在真機上試過：把這個內部設定關掉，WKWebView 就到 120 fps，預設在 60 fps 左右；缺的是給 app 用的公開介面 [WK-294338]（使用者回報，未確認）。
- **原生 app 的對照**：iPhone 上原生動畫要超過 60 Hz，`Info.plist` 要加 `CADisableMinimumFrameDurationOnPhone`；「The iPad Pro doesn't require this special configuration.」[APPLE-PROMOTION]。有人回報加了這個鍵，WKWebView 還是 60 fps [WK-294338]（使用者回報，未確認）。
- Apple 列的 ProMotion（最高 120 Hz）機型：iPhone 13 Pro 和 13 Pro Max 以後、iPhone 17 以後、iPhone Air；iPad Pro 11 吋、13 吋、12.9 吋（第 2 代起）、10.5 吋 [APPLE-PROMOTION]。不在表上的機型螢幕幾 Hz，這份文件沒寫。
- CSS 動畫、捲動在 WKWebView 裡跑幾 Hz，查不到一手來源。
- Apple：「the system disables faster refresh rates in low power mode or if a device gets hot」[APPLE-PROMOTION]。bug 的留言說低耗電模式下 `requestAnimationFrame` 會壓到 30 fps [WK-173434]（使用者留言，未確認）。

## 5. 網頁叫得到哪些原生的東西

### 不靠殼，網頁自己就有的

| 功能 | Safari iOS | WKWebView | 來源 |
|---|---|---|---|
| 震動（`navigator.vibrate`） | 不支援 | 不支援（沿用） | [BCD] |
| 分享（`navigator.share`） | 12.1 起 | 沿用 | [BCD] |
| 選檔（`<input type=file>`） | 有 | 沿用；iOS 預設開 | [BCD] [APPLE-OPENPANEL] |
| 螢幕不關（`navigator.wakeLock`） | 16.4 起 | 沿用 | [BCD] |
| 通知（`Notification`、`PushManager`） | 16.4 起，只給主畫面網頁 App | **不支援**（BCD 明寫 `false`） | [BCD] |

### 橋

- 網頁 → 原生：app 登記一個 `WKScriptMessageHandler`，網頁呼叫 `window.webkit.messageHandlers.<名字>.postMessage(...)`。要回傳值用 `WKScriptMessageHandlerWithReply` [APPLE-BRIDGE]。
- 原生 → 網頁：`evaluateJavaScript`、`addUserScript`（[WK-ABD] 提到的兩個介面）。
- 自訂網址：`WKURLSchemeHandler`（iOS 11 起）讓 app 自己回應某個 scheme 的請求。不能登記 WebKit 已經處理的 scheme，例如 `https` [APPLE-SCHEME]。Capacitor 就是用它送出包在 app 裡的網頁檔 [SRC-CAP]。
- 設了 App-Bound Domains 之後，這幾樣只在開了 `limitsNavigationsToAppBoundDomains` 的 WKWebView、清單上的網域才能用 [WK-ABD]。
- iOS 26 起還有 SwiftUI 版的網頁畫面 `WebView`、`WebPage` [APPLE-SWIFTUI]。

### 殼的官方外掛

Capacitor（都是 `@capacitor/…`，npm 2026-11-20 的最新版，都要求 `@capacitor/core` 8 以上）[NPM]：

| 做什麼 | 外掛 | 版本 | 備註 |
|---|---|---|---|
| 震動回饋 | `haptics` | 8.0.2 | 有 `impact`、`notification`、`selectionStart／Changed／End`、`vibrate`。沒有 Taptic Engine 的裝置上呼叫了不會有反應，也不會出錯 [CAP-HAPTICS] |
| 分享選單 | `share` | 8.0.3 | 可帶檔案 [CAP-SHARE] |
| 讀寫檔案 | `filesystem` | 8.1.5 | 原生端不收 Blob [CAP-FS] |
| 下載、上傳檔案 | `file-transfer` | 2.0.6 | Filesystem 的 `downloadFile` 7.1.0 起改放這裡 [CAP-FS] |
| app 的事件（進背景、被網址叫起來） | `app` | 8.1.2 | [CAP-APP] |
| 鍵盤 | `keyboard` | 8.0.6 | [CAP-KEYBOARD] |
| 小資料（鍵值） | `preferences` | 8.0.1 | [CAP-STORAGE] |
| 原生 HTTP、cookie | 內建在 `@capacitor/core` | 8.6.2 | 預設關 [CAP-HTTP] [CAP-COOKIES] |

Tauri（官方外掛頁上每個外掛的 iOS 支援度）[TAURI-PLUGINS]：

| 做什麼 | 外掛 | npm 版本 | iOS |
|---|---|---|---|
| 震動回饋 | Haptics | 2.4.2 | 完整 |
| 開檔、存檔對話框 | Dialog | 2.8.4 | 部分：不能選資料夾 |
| 讀寫檔案 | File System | 2.7.1 | 部分：預設只能動 app 的資料夾 |
| 被網址叫起來 | Deep Linking | 2.6.3 | 部分：要寫在設定檔裡，不能執行時登記 |
| 開別的 app、開網址 | Opener | 2.7.3 | 部分：只能開網址 |
| 鍵值儲存 | Store | 2.5.1 | 完整 |
| 原生 HTTP | HTTP Client | 2.9.0 | 完整 |
| app 自己更新自己 | Updater | — | **不支援** |
| 分享選單 | 官方沒有 | — | 官方頁列了社群外掛 |

### 自己寫的話對應的原生元件

- 震動回饋：`UIImpactFeedbackGenerator`（iOS 10 起）[APPLE-HAPTIC]。
- 分享：`UIActivityViewController` [APPLE-ACTIVITY]。
- 選檔、把檔案存到 app 以外的地方：`UIDocumentPickerViewController` [APPLE-DOCPICKER]。

## 6. 包在 app 裡，還是連到網站

| | 包在 app 裡 | 連到網站 |
|---|---|---|
| 網頁檔在哪 | app 的安裝包裡。Capacitor：`npx cap sync`「will copy over your already built web bundle to both your Android and iOS projects」[CAP-WORKFLOW]。Tauri：`frontendDist` 填資料夾，「all files are embedded in the application binary」[TAURI-CONFIG] | 伺服器上，跟現在一樣 |
| 殼的文件怎麼看待 | 兩家的預設做法 | Capacitor：`server.url`「This is intended for use with live-reload servers. **This is not intended for use in production.**」[CAP-CONFIG]。Tauri：`frontendDist` 可以填「a remote URL (for example: https://site.com/app)」，「No assets are embedded in the app in this case.」文件沒說這是不是給正式版用的 [TAURI-CONFIG] |
| 網頁的來源 | 自訂網址。Capacitor `capacitor://localhost`（`server.iosScheme` 預設 `capacitor`、`server.hostname` 預設 `localhost`；不能設成 `http`、`https`）[CAP-CONFIG]。Tauri：設定文件舉的例子是 `tauri://localhost/users/john`，iOS 上實際的來源沒明寫 [TAURI-CONFIG] | 原本的 `https://` 網址 |
| 怎麼更新網頁 | 換安裝包裡的檔案，也就是出新版 app（推論）；或下載新的網頁檔（條文見下） | 網站部署完，app 下次載入就是新的（推論） |
| 斷網能不能開 | 能：檔案在機器上（推論，依據上面兩句文件） | 第一次要網路。之後離線要靠 service worker，而 service worker 在 WKWebView 要 App-Bound Domains（第 1 節）；不然只剩 HTTP 快取，離線開不開得起來，查不到 |
| service worker | 不能註冊（第 1 節，原始碼） | 要 App-Bound Domains（第 1 節） |
| 登入 cookie | 第三方，預設被擋（第 2 節） | 第一方（第 2 節） |
| 儲存的資料算哪個來源的 | 自訂網址那個來源 | 網站的來源 |
| app 比伺服器舊 | 會發生：網頁檔跟著 app 版本走（推論） | 網頁永遠是伺服器上那一版；原生的殼還是可能舊（推論） |

Tauri 的 Updater 外掛（app 自己下載新版）iOS 不支援 [TAURI-PLUGINS]。

### Apple 准不准不經審查就換內容：只列原文

怎麼解讀、會不會被退，歸 #296。

- App Store Review Guidelines 2.5.2：「Apps should be self-contained in their bundles, and may not read or write data outside the designated container area, nor may they download, install, or execute code which introduces or changes features or functionality of the app, including other apps.」[ASRG]
- Apple Developer Program License Agreement 3.3.1 (B)：「Except as set forth in the next paragraph, an Application may not download or install executable code. Interpreted code may be downloaded to an Application but only so long as such code: (a) does not change the primary purpose of the Application by providing features or functionality that are inconsistent with the intended and advertised purpose of the Application (b) does not bypass signing, sandbox, or other security features of the OS; and (c) for Applications distributed on the App Store, does not create a store or storefront for other Applications.」[DPLA]
- 殼廠商的說法（不是 Apple 的）：Capacitor 文件寫可以「make realtime updates to apps in an app store friendly way, as long as those changes do not require binary updates (aka compiled native functionality)」，又寫「Apple and Google explicitly allow web content updates to apps」。這一頁是在介紹它自家的付費服務 Appflow [CAP-DEPLOY]。

## 7. 跟現有筆記比

- 對不上的：`hosting.md` 結論 10 寫 Safari 分頁 7 個使用日沒互動，草稿會被清；ADR 0012 也用「7 天」這個數字。依據是 WebKit 的說明頁，那一頁現在還是寫 7 天 [WK-ITP]。這次讀到的原始碼和修改說明寫一般網站是 30 個使用日（1.2）。兩邊誰對，沒有真機驗證前不知道。這份筆記沒有改那兩份文件。
- 對得上的：`auth-safety.md` 寫加到主畫面的網頁 App 資料跟 Safari 分開，推論「教練從主畫面打開時要另外登入一次」。這次讀到的原文一樣：「kept isolated from Safari」[WK-ITP]。

## 查不到、要真機驗

要真機才知道的（沒有 Xcode，這次都沒做）：

- app 裡的 WKWebView 連到網站，放 7 個、30 個使用日不碰，IndexedDB 到底清不清。
- `navigator.storage.persist()` 在 app 裡回傳什麼。
- 設了 `WKAppBoundDomains` 加 `limitsNavigationsToAppBoundDomains` 之後，現在的 service worker 能不能照常註冊、離線能不能開。
- 「包在 app 裡」時加 `WKAppBoundDomains`，後端的登入 cookie 會不會通。
- `<a download>` 和 Blob 下載在 Capacitor、Tauri 的殼裡實際會怎樣。
- `navigator.share` 帶流程檔在 WKWebView 裡能不能叫出分享選單。
- WebCodecs 在 WKWebView 裡能不能編 H.264、AAC。
- `requestAnimationFrame` 在 120 Hz 的 iPad Pro、iPhone 上，app 裡實際幾 fps；CSS 動畫和捲動幾 Hz。
- 捲動、拖曳、長按在 app 裡跟 Safari 分頁的實際差別。

沒有一手來源的：

- Apple 直接寫「WKWebView 的資料不跟 Safari 共用」的句子。
- `com.apple.developer.WebKit.ServiceWorkers` 這個權限怎麼申請。
- 哪一版 Safari 開始帶「30 個使用日」的改動。
- 「包在 app 裡」的 `localhost` 來源會不會被 ITP 清。
- app 沒接 `WKDownloadDelegate` 時，下載會被丟掉還是怎樣。
- Capacitor 的 `appUrlOpen` 收不收得到「用這個 app 打開檔案」。
- Tauri 在 iOS 上鍵盤、回彈、邊緣滑動的預設。Tauri 的文件幾乎沒有 iOS 手感的內容。
- Safari 分頁、加到主畫面的邊緣滑動、回彈的官方說明。
- `WKWebsiteDataStore.fetchData(of:)`、`restoreData(_:)` 是做什麼的。

這次比較薄的：第 4 節（手感）主要是原生開關的清單，Safari 和主畫面那邊的實際行為沒有來源；Tauri 的 iOS 部分只讀了設定參考和外掛頁。搜尋工具中途用完額度，後半段只能靠直接抓已知網址，少了交叉比對。

## 來源

全部在 2026-11-20 查。讀法：

- 除了 [DPLA]，全部是用 `curl` 抓原始網頁、JSON 或原始碼的全文，存在本機，用關鍵字找到段落再讀上下文。長的檔案（WebKit 原始碼、bug 的留言串、設定參考）沒有逐行讀完。
- Apple 開發者文件讀的是同一路徑的 JSON 資料檔（`https://developer.apple.com/tutorials/data/documentation/….json`）。下面列的是給人看的網址。
- [DPLA] 是 PDF。原檔是抓網頁的工具存下來的（它自己讀不了 PDF，沒有給摘要），再用 `pdftotext` 轉成文字讀。
- 沒有任何一條是靠摘要工具讀的。搜尋工具用了兩次：一次只回討論區的摘要，沒有拿來當來源；一次額度用完沒有結果。

**WebKit 說明頁、部落格、bug**

- [WK-ITP] Tracking Prevention in WebKit：https://webkit.org/tracking-prevention/
- [WK-ABD] App-Bound Domains（2020-06-26）：https://webkit.org/blog/10882/app-bound-domains/
- [WK-2020] Full Third-Party Cookie Blocking and More（2020-03-24）：https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- [WK-STORAGE] Updates to Storage Policy（2023-08-10）：https://webkit.org/blog/14403/updates-to-storage-policy/
- [WK-274398] WebKit commit 274398@main「Introduce DataRemovalFrequency for scheduled data removal in the NetworkProcess」（2024-02-09，bug 265598）：https://github.com/WebKit/WebKit/commit/45061230013728ec9c4900b01b12af26dc592b4b
- [WK-173434] WebKit bug 173434「Support for 120Hz requestAnimationFrame」（NEW，2026-05-19 最後更新；讀了第 77 則留言和關鍵字附近的留言）：https://bugs.webkit.org/show_bug.cgi?id=173434
- [WK-294338] WebKit bug 294338「Feature Request: Allow WKWebView to Support 120Hz Refresh Rate on ProMotion Devices」（NEW，沒有人接，2026-09-17 最後更新；留言到第 21 則）：https://bugs.webkit.org/show_bug.cgi?id=294338

**WebKit 原始碼**（tag `WebKit-7625.2.8`，網址開頭都是 `https://github.com/WebKit/WebKit/blob/WebKit-7625.2.8/`）

- [SRC-ITP] `Source/WebKit/NetworkProcess/Classifier/ResourceLoadStatisticsStore.cpp`：`operatingDatesWindowShort／Long`、`shouldSkip`、`domainsExemptFromWebsiteDataDeletion`、`shouldRemoveAllButCookiesFor`、`registrableDomainsToDeleteOrRestrictWebsiteDataFor`、`logCrossSiteLoadWithLinkDecoration`
- [SRC-WDS] `Source/WebKit/UIProcess/WebsiteData/WebsiteDataStore.h`（`isAppBoundITPRelaxationEnabled`）、`WebsiteDataStore.cpp`（`forwardAppBoundDomainsToITPIfInitialized`、`setPersistedSiteURLs`）
- [SRC-WDSC] `Source/WebKit/UIProcess/WebsiteData/Cocoa/WebsiteDataStoreCocoa.mm`：容量比例、預設目錄、`initializeAppBoundDomains`
- [SRC-WKWDS] `Source/WebKit/UIProcess/API/Cocoa/WKWebsiteDataStore.mm`：`_setPersistedSites:`
- [SRC-DWBC] `Source/WebKit/Shared/Cocoa/DefaultWebBrowserChecks.mm`：`determineTrackingPreventionStateInternal`
- [SRC-NSM] `Source/WebKit/NetworkProcess/storage/NetworkStorageManager.cpp`：`persist`、`persistOrigin`、`fetchRegistrableDomainsForPersist`（名單來自 ITP 的 `domainsExemptFromWebsiteDataDeletion`）
- [SRC-NSS] `Source/WebCore/platform/network/NetworkStorageSession.cpp`：第三方 cookie 的幾種模式
- [SRC-SW] `Source/WebKit/WebProcess/WebPage/WebPage.cpp`（`shouldAllowServiceWorkersForAppBoundViews`）、`Source/WebKit/WebProcess/WebPage/ios/WebPageIOS.mm`（`parentProcessHasServiceWorkerEntitlement`）
- [SRC-SWC] `Source/WebCore/workers/service/ServiceWorkerContainer.cpp`：`register` 的網址檢查
- [SRC-PREF] `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`：`PreferPageRenderingUpdatesNear60FPSEnabled`
- [SRC-CONTRIB] `metadata/contributors.json`：Antoine Quint、Simon Fraser 的 `status` 是 `reviewer`

**MDN browser-compat-data**

- [BCD] 8.1.10（tag `v8.1.10`）：https://github.com/mdn/browser-compat-data/tree/v8.1.10 。讀的檔：`browsers/webview_ios.json`、`api/IDBFactory.json`、`api/StorageManager.json`、`api/ServiceWorkerContainer.json`、`api/ServiceWorker.json`、`api/CacheStorage.json`、`api/FileSystemFileHandle.json`、`api/VideoEncoder.json`、`api/AudioEncoder.json`、`api/VideoFrame.json`、`api/Navigator.json`、`api/Window.json`、`api/CompressionStream.json`、`api/DecompressionStream.json`、`api/WakeLock.json`、`api/VisualViewport.json`、`api/VirtualKeyboard.json`、`api/LaunchQueue.json`、`api/PushManager.json`、`api/Notification.json`、`html/elements/a.json`、`html/elements/input/file.json`、`css/properties/overscroll-behavior.json`、`css/properties/touch-action.json`、`css/properties/user-select.json`、`css/properties/-webkit-touch-callout.json`、`css/types/length.json`。除了文中寫「明寫」的幾格，WKWebView 那一欄都是 `mirror`。

**Apple**

- [SAF-NOTES] Safari Release Notes（版本清單）：https://developer.apple.com/documentation/safari-release-notes
- [APPLE-WDS] WKWebsiteDataStore、`default()`、`fetchData(of:completionHandler:)`、`restoreData(_:completionHandler:)`：https://developer.apple.com/documentation/webkit/wkwebsitedatastore
- [APPLE-COOKIE] WKHTTPCookieStore：https://developer.apple.com/documentation/webkit/wkhttpcookiestore
- [APPLE-WB] com.apple.developer.web-browser：https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser
- [APPLE-OPENPANEL] `webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`：https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:runopenpanelwith:initiatedbyframe:completionhandler:)
- [APPLE-DOWNLOAD] WKDownload、WKDownloadDelegate 的 `download(_:decideDestinationUsing:suggestedFilename:completionHandler:)`、`WKNavigationAction.shouldPerformDownload`：https://developer.apple.com/documentation/webkit/wkdownload 、https://developer.apple.com/documentation/webkit/wkdownloaddelegate
- [APPLE-DOCTYPES] CFBundleDocumentTypes：https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundledocumenttypes
- [APPLE-OPENURL] `scene(_:openURLContexts:)`：https://developer.apple.com/documentation/uikit/uiscenedelegate/scene(_:openurlcontexts:)
- [APPLE-FILESHARING] UIFileSharingEnabled、LSSupportsOpeningDocumentsInPlace：https://developer.apple.com/documentation/bundleresources/information-property-list/uifilesharingenabled 、https://developer.apple.com/documentation/bundleresources/information-property-list/lssupportsopeningdocumentsinplace
- [APPLE-BFG] `allowsBackForwardNavigationGestures`：https://developer.apple.com/documentation/webkit/wkwebview/allowsbackforwardnavigationgestures
- [APPLE-BOUNCE] `UIScrollView.bounces`：https://developer.apple.com/documentation/uikit/uiscrollview/bounces
- [APPLE-TEXT] `WKPreferences.isTextInteractionEnabled`：https://developer.apple.com/documentation/webkit/wkpreferences/istextinteractionenabled
- [APPLE-LINK] `allowsLinkPreview`：https://developer.apple.com/documentation/webkit/wkwebview/allowslinkpreview
- [APPLE-INSPECT] `isInspectable`：https://developer.apple.com/documentation/webkit/wkwebview/isinspectable
- [APPLE-PREFS] WKPreferences、WKWebViewConfiguration 的屬性清單：https://developer.apple.com/documentation/webkit/wkpreferences 、https://developer.apple.com/documentation/webkit/wkwebviewconfiguration
- [APPLE-PROMOTION] Optimizing iPhone and iPad apps to support ProMotion displays、CADisableMinimumFrameDurationOnPhone：https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays 、https://developer.apple.com/documentation/bundleresources/information-property-list/cadisableminimumframedurationonphone
- [APPLE-BRIDGE] WKScriptMessageHandler、WKScriptMessageHandlerWithReply：https://developer.apple.com/documentation/webkit/wkscriptmessagehandler 、https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply
- [APPLE-SCHEME] WKURLSchemeHandler、`setURLSchemeHandler(_:forURLScheme:)`：https://developer.apple.com/documentation/webkit/wkurlschemehandler
- [APPLE-SWIFTUI] WebView、WebPage（iOS 26 起）：https://developer.apple.com/documentation/webkit/webview-swift.struct 、https://developer.apple.com/documentation/webkit/webpage
- [APPLE-SFSVC] SFSafariViewController：https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller
- [APPLE-ACTIVITY] UIActivityViewController：https://developer.apple.com/documentation/uikit/uiactivityviewcontroller
- [APPLE-DOCPICKER] UIDocumentPickerViewController：https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller
- [APPLE-HAPTIC] UIImpactFeedbackGenerator：https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator
- [APPLE-FS] File System Programming Guide（舊文件庫）：https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html
- [APPLE-BACKUP] Optimizing Your App's Data for iCloud Backup：https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup
- [ASRG] App Store Review Guidelines（Last Updated: October 16, 2026）：https://developer.apple.com/app-store/review/guidelines/
- [DPLA] Apple Developer Program License Agreement（頁尾 October 29, 2026）：https://developer.apple.com/support/downloads/terms/apple-developer-program/Apple-Developer-Program-License-Agreement-English.pdf

**Capacitor**

- [CAP-IOS] iOS、Environment Setup、Updating to 8.0：https://capacitorjs.com/docs/ios 、https://capacitorjs.com/docs/getting-started/environment-setup 、https://capacitorjs.com/docs/updating/8-0
- [CAP-CONFIG] Capacitor Configuration：https://capacitorjs.com/docs/config
- [CAP-STORAGE] Storage：https://capacitorjs.com/docs/guides/storage
- [CAP-COOKIES] CapacitorCookies：https://capacitorjs.com/docs/apis/cookies
- [CAP-HTTP] CapacitorHttp：https://capacitorjs.com/docs/apis/http
- [CAP-FS] Filesystem：https://capacitorjs.com/docs/apis/filesystem
- [CAP-SHARE] Share：https://capacitorjs.com/docs/apis/share
- [CAP-HAPTICS] Haptics：https://capacitorjs.com/docs/apis/haptics
- [CAP-KEYBOARD] Keyboard：https://capacitorjs.com/docs/apis/keyboard
- [CAP-APP] App：https://capacitorjs.com/docs/apis/app
- [CAP-WORKFLOW] Capacitor Workflow：https://capacitorjs.com/docs/basics/workflow
- [CAP-DEPLOY] Deploying and Updating：https://capacitorjs.com/docs/guides/deploying-updates
- [SRC-CAP] Capacitor 原始碼 tag `8.6.2`：`ios/Capacitor/Capacitor/CAPBridgeViewController.swift`、`WebViewDelegationHandler.swift`：https://github.com/ionic-team/capacitor/tree/8.6.2/ios/Capacitor/Capacitor

**Tauri**

- [TAURI-CONFIG] Configuration reference（`frontendDist`、`devUrl`、iOS 的 `minimumSystemVersion`）：https://v2.tauri.app/reference/config/
- [TAURI-PLUGINS] 外掛清單和各外掛頁的支援度表：https://v2.tauri.app/plugin/ 、https://v2.tauri.app/plugin/haptics/ 、https://v2.tauri.app/plugin/dialog/ 、https://v2.tauri.app/plugin/file-system/ 、https://v2.tauri.app/plugin/deep-linking/ 、https://v2.tauri.app/plugin/opener/ 、https://v2.tauri.app/plugin/store/ 、https://v2.tauri.app/plugin/http-client/ 、https://v2.tauri.app/plugin/updater/
- [TAURI-FILEASSOC] File Associations on Mobile（2026-05-04 更新）：https://v2.tauri.app/learn/mobile-file-associations/

**版本**

- [NPM] npm registry（`https://registry.npmjs.org/<套件名>`）：`@capacitor/core`、`@capacitor/ios`、`@capacitor/cli`、`@capacitor/filesystem`、`@capacitor/share`、`@capacitor/haptics`、`@capacitor/keyboard`、`@capacitor/app`、`@capacitor/preferences`、`@capacitor/file-transfer`、`@tauri-apps/cli`、`@tauri-apps/api`、`@tauri-apps/plugin-haptics`、`@tauri-apps/plugin-fs`、`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-deep-link`、`@tauri-apps/plugin-opener`、`@tauri-apps/plugin-http`、`@tauri-apps/plugin-store`
