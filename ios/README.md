# App 的殼（iPhone、iPad）

畫面就是網頁，包在 App 裡；外面這層 Swift 殼只做網頁做不好的事（ADR 0022–0025，規格 #360）。這份寫：檔案放哪、怎麼建、怎麼測、要加東西時改哪裡。

終端機跑 `xcodebuild`、`xcrun`、`swift` 前先設（這台 Mac 的 `xcode-select` 還指著 Command Line Tools）：

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

## 版本（2026-11-22 查）

| 東西 | 版本 | 來源 |
|---|---|---|
| Xcode | 27.2（27B52），2026-10-29 出的正式版；比它新的只有 27.3 beta 2（2026-11-16），不用 | https://developer.apple.com/news/releases/ ；本機 `xcodebuild -version` |
| Swift | 6.4.2（跟 Xcode 27.2 一起裝的） | 本機 `swift --version`；swift.org 的 Previous Releases 表最上面是 6.4.2（2026-10-29）。Apple 的 Xcode 27.2 版本說明頁這次抓不到內容，沒從那裡確認 |
| 模擬器 | iOS 27.2 | 這台 Mac 只裝了 17.2、18.1、27.2，**沒有 18.4**：最低版本 18.4 上沒跑過 |

## 檔案放哪

```
ios/
  CheerEditor.xcodeproj   手寫的專案；App/、PipeTests/ 是「同步資料夾」：放進去的檔自動算進去，不用改專案檔
  App/                    App（target CheerEditor）：只接 UIKit、WebKit
    AppDelegate.swift、SceneDelegate.swift   scene 生命週期；只有一個視窗
    Info.plist            UIApplicationSupportsMultipleScenes = false（iPad 只開一個視窗）、UILaunchScreen（啟動畫面）
    Shell/WebShell.swift  WKWebView 和橋怎麼接
    Shell/ShellContext.swift   每一塊、每一條路拿得到的東西（outbox、webView）
    Shell/SchemeHandler.swift   app://local/ 送 App 裡那包網頁
    Shell/SchemeRoutes.swift    ★ app://local/ 上別的路（登記）
    Bridge/ShellParts.swift     ★ 橋上的每一塊（登記）
    Update/WebUpdates.swift     殼自己更新網頁：App 這邊怎麼接（#393，下面「殼自己更新網頁」）
    Web.bundle/           npm run ios:web 放進來的網頁（不進 git）
  PipeTests/              模擬器上「真的 WKWebView」的管子測試（target PipeTests）；new-flow-play.js 用真的那包網頁新建流程、放音樂、播放
  ShellCore/              殼的規則：Swift 套件，不碰畫面。swift test 在 Mac 上跑
    Sources/ShellCore/Bridge/     橋：Bridge、BridgePart、JSONValue、BootScript
    Sources/ShellCore/Parts/      橋上的每一塊，一件事一個檔（ReadyPart.swift）；跟別的檔一起做一件事的放那件事的資料夾（CloudMusicPart 在 Forward/、WebUpdatePart 在 Update/）
    Sources/ShellCore/Forward/    殼代網頁上網（#380 轉送 /api/、cookie 罐子、網站網址；#382 雲端流程的音樂 CloudMusicPart）
    Sources/ShellCore/Feel/       殼的手感（#376：邊邊、回彈；App 照它調 WKWebView）
    Sources/ShellCore/Site/       BundledSite（網址對到哪個檔）、NavigationPolicy（只開這包網頁）
    Sources/ShellCore/Update/     殼自己更新網頁的規則：WebUpdater、SiteFetcher、WebUpdatePart（#393）
    Sources/ShellCore/Resources/bridge.js   document start 塞進網頁的 JS
    Tests/ShellCoreTests/ScenarioParts.swift   ★ 情境測試用的每一塊（登記）
bridge-scenarios/current/ 共用的情境檔，一件事一個檔（repo 根目錄；網頁、殼兩邊都讀）
src/lib/app-shell.ts      網頁這邊：讀 window.__cheerShell，useShellIfInApp ★ 換上殼的版本（登記）
```

★ 的檔是「登記表」：一張票一格，**只改自己那一格**。格子中間空一行，幾張票同時加也合得起來（試過）。

- **bundle ID**：`com.littlebluewhite.cheereditor`（專案檔的 `PRODUCT_BUNDLE_IDENTIFIER`）。#362 定的，已經在 Apple 登記、綁在 App Store Connect 的 App 紀錄上，不能再改。
- **簽章**：自動簽章，Team ID `N5HMWTF697`（專案檔的 `DEVELOPMENT_TEAM`，#362 的留言；可以進公開的 repo，ADR 0023）。簽章金鑰、Apple 帳號、裝置識別資料不進 repo。
- **自動填密碼**（#395）：`App/CheerEditor.entitlements` 開 Associated Domains `webcredentials:littlebluewhite.com`（專案檔的 `CODE_SIGN_ENTITLEMENTS`），網站送 `/.well-known/apple-app-site-association`（`server/apple-app-site-association.json`，docs/deploy.md「自動填密碼用的檔」）。網址跟 `SiteAddress.production` 同一個。包在 App 裡會不會真的出現自動填還沒驗（要付費帳號的真機，#401）；沒出現就拿掉這兩樣加上伺服器那條路由、線上檢查那條，Team ID 留著。
- **自訂網址 `app://local/` 不要改**：這個來源是網頁存資料（IndexedDB、localStorage）的地方，換了就找不回來。
- 版本：`MARKETING_VERSION`（0.1.0）、`CURRENT_PROJECT_VERSION`（建置號 1）。建置號就是網頁的清單 `minShellBuild` 比的那個（docs/deploy.md「網頁的清單」），殼一開始塞給網頁的 `shellBuild` 也是它。

## 怎麼建、怎麼跑

```sh
npm run ios:web     # 建好網頁、放進殼（ios/App/Web.bundle）。要先跑，不然 App 打開只有一行字
cd ios
xcodebuild -project CheerEditor.xcodeproj -scheme CheerEditor \
  -destination 'platform=iOS Simulator,id=<模擬器 UDID>' -derivedDataPath .dd build
xcrun simctl install <UDID> .dd/Build/Products/Debug-iphonesimulator/CheerEditor.app
xcrun simctl launch <UDID> com.littlebluewhite.cheereditor
```

- `npm run ios:web` 放的是網頁的清單（`build/web-bundle.json`）列的檔加清單自己：跟網站部署的同一包，不另外建 App 版。清單本來就不列 service worker、Workbox、`manifest.webmanifest`、PWA 圖示。
- `-derivedDataPath` 一定放自己的 worktree 裡（`ios/.dd`，不進 git），不要用共用的預設位置；一次只建一個模擬器。
- 模擬器用 `xcrun simctl list devices available` 找 UDID，**指定 UDID，不要用 `booted`**（別人可能開著別的）。
- Debug 版的網頁可以用 Mac 的 Safari →「開發」→ 模擬器檢查（`isInspectable`）。

## 怎麼測

| 測什麼 | 怎麼跑 | 要模擬器嗎 |
|---|---|---|
| 殼的規則＋殼這邊的情境 | `cd ios/ShellCore && swift test` | 不用 |
| 網頁這邊的情境（假殼） | `npm test`（`src/lib/app-shell.svelte.test.ts`、`src/hooks.client.svelte.test.ts`） | 不用 |
| 管子（真的 WKWebView） | `npm run ios:web`，再 `cd ios && xcodebuild -project CheerEditor.xcodeproj -scheme CheerEditor -destination 'platform=iOS Simulator,id=<UDID>' -derivedDataPath .dd test` | 要 |

改到 `ios/` 或 `bridge-scenarios/` 時三種都跑（GitHub 沒有 macOS 的工作，只在 Mac 上跑）。

## 橋：網頁和殼之間怎麼說話

網頁只認殼在 document start 塞的 `window.__cheerShell`（`ShellCore/Resources/bridge.js`；網頁那邊是 `src/lib/app-shell.ts`，「問殼」在 `src/lib/host.ts`）：

- **一開始塞的**（boot）：`{ shellVersion, shellBuild, features, …每一塊自己要塞的 }`。網頁用 `host().shell.inApp`（有塞就在 App 裡）、`host().shell.can('<feature>')` 問。`features` 是每一塊的 `feature` 合起來，不用另外列。
- **網頁 → 殼**：`host().shell.send(name, body)`，回 Promise。底下走 `messageHandlers.shell`，傳的是 JSON 字串 `{"name","body"}`；殼回 `{"reply": 值}` 或 `{"error": "unknown" | "failed" | "bad message"}`（reject）。殼只收 `app://local` 這包網頁送的。
- **殼 → 網頁**：Swift 叫 `WebShell.emit(name, body)`，網頁用 `host().shell.on(name, fn)` 收。
- **好了**：網頁畫面出來以後（`+layout.svelte` 的 onMount）送 `ready`。ADR 0025 用它判斷新網頁打不打得開。
- 網頁在 App 裡不註冊 service worker（`src/hooks.client.ts`）。

### 「問殼」的名字

`features` 裡的字串就是 `can()` 問的名字，由加那一塊的票自己取，寫在那一塊的 `feature`。現在有 `screen`（編輯畫面整頁不回彈，#376）、`drafts`（草稿存在殼裡，#377）、`settings`（小設定存在殼裡，#378）、`cloudRoom`（雲端流程的房間經過殼，#381）、`cloudMusic`（殼代傳雲端流程的音樂，#382）、`offline`（離線存放，#383）、`nowPlaying`（鎖定畫面的播放鍵，#389）、`print`（列印，#391）、`webUpdate`（殼自己更新網頁，#393）；`ready` 是底層的管子，不算。取名用小寫駝峰、講那件事（例：`print`、`nowPlaying`），一取定就不要改：舊殼認得的名字凍在情境裡。

### 加一塊（一件事）

殼這邊：

1. `ShellCore/Sources/ShellCore/Parts/<件事>Part.swift`（那件事有好幾個檔就放那件事的資料夾，例：`Forward/CloudMusic.swift`）：實作 `BridgePart`（`feature`、`messages`、`boot`、`handle`）。規則寫在這裡；要碰畫面、系統的（列印、播放鍵）從 init 傳進來（看 `ReadyPart` 的 `onReady`）。要主動跟網頁說話的，init 收一個 `ShellOutbox`，`outbox.emit(name, body)`。
2. 在 `App/Bridge/ShellParts.swift` 自己那一格登記。`ShellParts.all(context)` 收 `ShellContext`（`App/Shell/ShellContext.swift`）：`context.outbox` 傳給要說話的那一塊；`context.webView` 是網頁畫面（列印、重新載入；網頁畫面比橋晚建好，所以要用的時候再拿，不要在 init 裡拿）；要聽網頁說「好了」的加到 `context.onReady`（看 #393 那一格）。
3. `ShellCore/Tests/ShellCoreTests/ScenarioParts.swift` 自己那幾格登記：假的東西（`ScenarioShell` 的屬性）、那一塊（用 `outbox` 和假的東西建）、情境裡殼主動說的話怎麼觸發（`triggers`）。
4. 要在 `app://local/` 上接請求（例：#380 轉送 `/api/`）：`App/Shell/<名字>Route.swift` 實作 `SchemeRoute`，在 `SchemeRoutes.swift` 自己那一格登記（一樣收 `ShellContext`）。

兩邊共用：`bridge-scenarios/current/<件事>.json` 寫情境（下一節）。

網頁這邊：

1. 換掉的接口（小設定、網站網址、離線存放…）：在 `src/lib/app-shell.ts` 的 `useShellIfInApp` 自己那一格加；實作放自己的檔。
2. 一開始多塞的東西：在自己的檔裡補 `ShellBoot` 的欄位（`declare module '#lib/app-shell.js' { interface ShellBoot { … } }`），不改 `app-shell.ts`。
3. 測試照情境寫（下一節的 `scenarioShell`）。殼會不會用 `host().shell.can('<feature>')` 問，不會就不顯示。

## 情境檔（`bridge-scenarios/`）

一件事一個檔，兩邊的測試都把資料夾裡的每個檔讀進來，加檔不用改別的地方：

```json
{
  "about": "這件事是什麼",
  "scenarios": [
    {
      "name": "情境的名字（網頁的測試用它找）",
      "boot": { "shellVersion": "0.1.0", "shellBuild": 1, "features": [] },
      "steps": [
        { "from": "web", "name": "ready", "reply": null },
        { "from": "web", "name": "noSuchThing", "body": { "any": 1 }, "error": "unknown" }
      ]
    }
  ]
}
```

- 情境只寫「說了什麼話」，不管底下怎麼傳。`reply` 沒寫等於 `null`。
- **殼這邊**（`ScenarioTests.swift`）：每個情境自動跑。`boot` 裡寫的每一樣要跟真的殼一樣（`shellVersion`、`shellBuild` 拿情境的當輸入）；`features` 是「殼至少會這些」。`from: web` 的每一句餵給真的 `Bridge`，回的要一樣。
- **網頁這邊**：測試用 `scenarioShell('<檔名>', '<情境名>')`（`src/lib/scenario-shell.ts`）拿到照情境演的假殼，接到網頁上（`fakeHost({ shell: appShell(fake.bridge) })` 或 `window.__cheerShell = fake.bridge`），讓網頁做事，最後 `fake.done()`：網頁該說的都說了、順序和內容都對。
- **殼主動說的話**（`{ "from": "shell", "name": "routeChanged", "body": … }`）：殼這邊照 `ScenarioParts.swift` 的 `triggers[name]` 觸發，殼要剛好說出這一句（沒登記觸發的方法會失敗）；網頁這邊測試叫 `fake.say()`，把這句送給網頁用 `on(name)` 聽的人。現在的情境檔裡還沒有這種，兩邊的跑法各有一個只在測試裡的例子（`ScenarioTests.swift`、`src/lib/scenario-shell.test.ts`）。
- **凍的情境**（ADR 0025）：每出一版殼，把 `current/` 複製成 `1.x/`（還沒有）。殼這邊已經讀 `bridge-scenarios/` 底下每個資料夾；網頁這邊到時候把 `scenario-shell.ts` 的 glob 改成也讀凍的那幾份。

## POST 進不進得了殼（開工先驗，2026-11-22，只在 iOS 27.2 模擬器上）

`PipeTests` 的 `POST的內容進不進得了殼`：網頁 `fetch` POST 到 `app://local/probe`，看 `WKURLSchemeHandler` 收到的 `URLRequest`。

| 送的內容 | 殼收到 |
|---|---|
| 字串 | 收到（`httpBody`） |
| ArrayBuffer、Uint8Array | 收到（`httpBody`），20 MB 也收到 |
| 只有字的 FormData | 收到（`httpBody`，multipart） |
| File 先 `await file.arrayBuffer()` 再送 | 收到 |
| Blob、File | **收不到**（`httpBody`、`httpBodyStream` 都是空的） |
| 帶檔案的 FormData | **收不到** |
| XHR 送 Blob | **收不到** |

**結論**：自訂網址收得到 POST 的內容，但 Blob／File 做的內容會被丟掉。之後經過殼的請求（#380 轉送、上傳音樂）：網頁把檔案先轉成 ArrayBuffer 再送，或改走 `messageHandlers`。這兩條都還沒在真機試過；速度也沒量。WebKit 哪天改了，這個測試會紅，要回來改這張表。

## 列印（#391）

網頁裡 `window.print()` 在 App 裡什麼都不會發生（docs/research/app-print.md），所以八拍表、記一次全上表、總表的「列印」改請殼印：

- 網頁：`src/lib/print.ts` 的 `printPage(event)`。殼會 `print` 就 `send('print', { button })`（按的那顆鈕的 `getBoundingClientRect`），不然照舊 `window.print()`。情境 `bridge-scenarios/current/print.json`。
- 殼：`ShellCore/Parts/PrintPart.swift`（拆出按鈕的位置）→ `App/Shell/Printer.swift`：`UIPrintInteractionController` 加 `webView.viewPrintFormatter()`，iPad 用 `present(from:in:)`、iPhone 用 `present(animated:)`。背景色用預設（不印）。
- ⌘P：`Info.plist` 的 `UIApplicationSupportsPrintCommand`，加上 `Printer.swift` 裡 `ShellViewController` 的 `printContent(_:)`。WebKit 不接 `printContent`，從網頁畫面裡往上找會找到 `ShellViewController`。
- 存成 PDF、傳給別人：用列印畫面右上角的「分享」，不另外做按鈕。
- App 裡八拍表的提示換成 `print_hint_app`（`PrintSheet.svelte` 用 `host().shell.can('print')` 判斷）。

在 iOS 27.2 模擬器上看到的（2026-11-22，`PipeTests/PrintPipeTests.swift`）：

- iPad、iPhone 都叫得出列印畫面，右上角有「分享」，預覽是八拍表的列印樣子（A4、1 頁、小站位圖有顏色、表頭白底）。
- 記一次全上表、總表的「列印」也叫得出列印畫面（`practice-flow.zip` 是 `src/lib/test-flows.ts` 的 `libSample()` 寫成的流程檔）。
- **iPad 上列印畫面不從按鈕跳出來**：iOS 27 的列印畫面是視窗正中間的大卡片，不是指著按鈕的小視窗，系統還記錄 `presentFromRect… called on iPhone`（iPad 模擬器上也是）。程式照樣傳按鈕的位置（18.4 上照文件應該從按鈕跳出來，沒試過）。
- 列印畫面還沒收完就再叫，系統不理。程式收起時也不會通知 delegate（測試看畫面上還有沒有蓋著的東西）。
- 真的按鍵盤的 ⌘P 沒試過：模擬器沒開視窗，送不了按鍵。測試是從網頁畫面裡的 `WKContentView` 送 `printContent`。
- 按「分享」→ 存成 PDF 沒試過（測試按不到系統的列印畫面）。

## 殼代網頁上網（#380，ADR 0023）

網頁照舊 `fetch('/api/…')`；在 App 裡是 `app://local/api/…`，`App/Shell/ForwardRoute.swift` 轉到自己的網站（規則在 `ShellCore/Sources/ShellCore/Forward/`）：

- 只轉 `app://local/api/` 底下的，只轉到自己的網站；同一個路徑、查詢字串、方法、內容。伺服器加新 API 不用改殼。
- 送的時候 `Origin` 是網站的網址；網頁帶的 `Origin`、`Referer`、`Cookie`、`Sec-Fetch-*` 拿掉。伺服器沒改。
- 登入 cookie 在殼自己的罐子（`CookieJar`，存在 Application Support 的 `cookies-<主機>-<埠>.json`），回給網頁的不帶 `Set-Cookie`。不用系統的 `HTTPCookieStorage`：它不收 http 送來的 `Secure` cookie，連本機的伺服器就登不進去。
- 不跟轉址；連不上網站時網頁的 `fetch` 失敗（不會當成沒登入）。
- 一開始塞 `siteUrl`（`SitePart`），網頁的「網站網址」用它（分享連結）。管理使用者頁在 App 裡藏起來。
- 轉到哪：上架版（Release）一定是 `SiteAddress.production`；Debug 版可以用環境變數連本機的伺服器：`SIMCTL_CHILD_CHEER_SITE_URL=http://127.0.0.1:8080/ xcrun simctl launch <UDID> com.littlebluewhite.cheereditor`。
- 管子測試 `PipeTests/ForwardPipeTests.swift` 在模擬器裡自己開一台小伺服器（`TinySite`），不連正式網站。

## 手感（#376，2026-11-22，只在 iOS 27.2 模擬器上）

規則在 `ShellCore/Sources/ShellCore/Feel/ScreenFeel.swift`，App 那邊是 `App/Shell/ScreenFeelView.swift`（包著網頁畫面的那一層）。

- **邊邊**：網頁放在 safe area 裡，邊邊塗 `--paper`；網頁沒有深色模式，殼也固定用淺色（狀態列的字才是深的）。
- **回彈**：網頁打開流程時說 `screen {kind: editor}`，離開說 `page`（`src/lib/shell-screen.svelte.ts`，情境 `bridge-scenarios/current/screen.json`）。每載入一頁殼先當是會捲的頁。整頁兩指放大本來就在網頁擋了（`src/hooks.client.ts` 的 gesturestart）。
- **字跟著系統的「文字大小」**：放大倍數 = 內文字級 ÷ 17，上限照畫面算：橫拿的 iPad 放到剛好還有 1024×600（iPad mini 1.10 倍、13 吋 1.34 倍），窄螢幕放到短邊剩 320（iPhone SE 1.17 倍）。
- **不用 `pageZoom`**（#336 原本定的）：網頁有 `width=device-width` 時，`pageZoom` 只讓 `innerWidth`、媒體查詢變小，版面不重排，字變大後右邊整排跑出畫面。殼改成改網頁的 `<meta name="viewport">`（`width=寬÷倍數, initial-scale=倍數`），量過會照放大後的寬重排。
- 長按連結不預覽（`allowsLinkPreview = false`）。鍵盤照 Safari：殼不在鍵盤出來時縮小網頁。

## 雲端流程的連線（#381）

App 裡的網頁不自己開 WebSocket：`src/lib/shell-socket.ts` 給房間（`server-api.ts` 的 `openRoom`）一個跟 WebSocket 一樣的東西，殼會 `cloudRoom` 才用；連線由殼開（`ShellCore/Sources/ShellCore/Parts/CloudRoomPart.swift`，App 那層 `App/Bridge/AppCloudRoom.swift` 用 `URLSessionWebSocketTask`）。說的話：`bridge-scenarios/current/cloudRoom.json`。

- 握手帶殼罐子裡的 cookie（`AppSite.cookies`）、`Origin` 是網站的網址（`Forwarder.origin(of:)`），伺服器沒改。只開自己網站底下 `/api/` 的連線，不跟轉址。
- **切到背景、鎖螢幕**（`UIScene.didEnterBackgroundNotification`）：殼關掉每一條，說 `socketClosed`（`background: true`）；在背景時網頁要開也馬上關。網頁不問伺服器為什麼、不自己重連（放音樂時網頁在背景照樣跑）。**回到前景**（`willEnterForeground`）殼說 `foreground`，網頁馬上重連、補齊，連上前不能改。拉下控制中心（`willDeactivate`）不斷線。
- 網頁版照舊用瀏覽器的 WebSocket，切分頁、縮小視窗不斷線。
- 管子測試 `PipeTests/CloudRoomPipeTests.swift` 在模擬器裡自己開一台小 WebSocket 伺服器（`TinyRoom`），看握手的標頭、背景關掉、前景再開；沒有跑真的伺服器的同網址檢查（`server/src/csrf.rs`）。

## 殼自己更新網頁（#393、#394、ADR 0025）

- **什麼時候看**：App 打開、回到前景（`App/Update/WebUpdates.swift`），抓 `https://littlebluewhite.com/web-bundle.json`（docs/deploy.md「網頁的清單」）。上架版網站寫死在 `WebUpdates.site`；開發版見下面「Mac 上的小網站」。App 被 PipeTests 帶起來時不自己看，免得測試連到正式站。
- **規則**（`ShellCore/Sources/ShellCore/Update/WebUpdater.swift`，`swift test` 的 `WebUpdaterTests` 一條一個）：清單的代號跟現在開的那包一樣就不動；不一樣就整包下載到 `staging/`，每個檔比大小和 SHA-256，都對了才搬到 `bundles/<代號>/`；一個檔對不上（拿到 `200.html`、部署換手）、斷線就整包丟掉。網站倒回 App 裡附的那包就直接換回去，不用下載。清單裡的路徑不是這個網站底下的相對路徑，整包不收；網站轉到別的地方也不跟（`SiteFetcher`）。
- **什麼時候換**：殼下載好了跟網頁說 `webBundleReady`；網頁回到首頁（等 1 秒讓草稿寫完、沒有沒存的東西）才說 `useNewWebBundle`，殼換上、同一個網頁畫面重新載入首頁（`src/lib/web-update.ts`，情境 `bridge-scenarios/current/web-update.json`）。沒換的話下次打開 App 換。
- **打不開就退回**：換上以後 10 秒內網頁沒說「好了」（`ShellParts.swift` 的 `ReadyPart`），或網頁的行程當掉（`WebShell` 的 `webViewWebContentProcessDidTerminate`，寫在 `WebUpdates.swift`），退回上一包打得開的（沒有就是附的那包），這包記成壞的、不再抓。換上後還沒說「好了」就被關掉，下次打開再等 10 秒。
- 下載的放 `Application Support/WebBundles/`，不進 iCloud 備份；只留現在開的、等著換的、退路那包。換上的那包由 `WebBundleRoute`（`SchemeRoutes.swift`）送，排在 `/api/` 那幾條後面。來源一樣是 `app://local`，草稿、小設定都在。
- **太舊就不換**（#394）：清單的 `minShellBuild` 比殼的建置號（`CFBundleVersion`）大，不下載、不換（`WebUpdater.check` 回 `tooOld`），網頁照樣被擋。
- **雲端流程被擋時的「更新」**（#394，`src/lib/app-update.svelte.ts`、`AppUpdateNote.svelte`）：被擋時網頁先問 `checkWebBundle`（`ready`／`tooOld`／`none`）。`tooOld` 寫「這版 App 太舊，請到 App Store 更新」加開 App Store 的按鈕（網址 `APP_STORE_URL` 上架後才有，現在按不下去）；不然寫「有新版」加「更新」。按了說 `updateWebBundle {flow}`：還沒下載就先抓，抓好馬上換（回 `updated`），重新載入到 `app://local/?cloud=<代號>`，網頁打開同一支、把代號從網址拿掉；被擋時記的照 #368 自動傳。網頁版、殼不會時字照舊（「有新版，請重新整理」）。
- **Debug 版也會換**：自己建的 App 打開後抓 `AppSite.current`（沒設 `CHEER_SITE_URL` 就是正式站）的那包，回首頁就換掉剛放進去的 `Web.bundle`。（正式站還沒有這份清單時抓不到，不會換。）

### Mac 上的小網站（#394，沒有測試站時怎麼測更新）

Debug 版可以用環境變數 `CHEER_WEB_BUNDLE_URL` 改去 Mac 上的小網站抓網頁（只換抓網頁的地方，`/api/` 照 `CHEER_SITE_URL`）。Release 版不讀這個設定（`WebUpdates.site` 的 `#if DEBUG`，上架前的檢查在 #396）。

```sh
npm run ios:web                                   # 小網站從 ios/App/Web.bundle 做出四種
node scripts/web-bundle-test-site.mjs [new|mismatch|broken|tooOld]   # 按 Enter 換下一種
SIMCTL_CHILD_CHEER_WEB_BUNDLE_URL=http://127.0.0.1:8787/ xcrun simctl launch <UDID> com.littlebluewhite.cheereditor
```

| 放的 | 殼該怎麼做 | 看哪裡 |
|---|---|---|
| `new` 新的一包 | 下載；回到首頁換上 | 小網站的 log 抓了每個檔；App 容器 `Library/Application Support/WebBundles/state.json` 的 `active` |
| `mismatch` 有一個檔對不上 | 整包丟掉，照舊 | `state.json` 沒有 `staged`，`bundles/` 沒有它 |
| `broken` 壞掉的一包 | 換上後 10 秒退回，記成壞的 | `state.json` 的 `bad` 有它，`active` 回到上一包 |
| `tooOld` 要新版殼 | 只抓清單，不下載、不換 | 小網站的 log 只有 `web-bundle.json` |

真機用 Mac 的區網 IP（小網站聽 `0.0.0.0`）。App 容器：`xcrun simctl get_app_container <UDID> com.littlebluewhite.cheereditor data`。

## 草稿（#377）

App 裡的草稿不存在網頁的 IndexedDB，存在殼：`Application Support/Drafts/<草稿 id>.zip`（整包流程檔，含音樂；不標成不備份，會進 iCloud 備份）。存的時間記成檔的修改時間（iCloud 還原後修改時間還在不在沒驗）。

- 殼：`ShellCore/Sources/ShellCore/Parts/DraftsPart.swift`（`drafts`）；App 裡的資料夾、背景時間在 `App/Bridge/AppDrafts.swift`。網頁：`src/lib/shell-drafts.ts`，殼會 `drafts` 才換（`Host.createDraftStore`）。說的話：`bridge-scenarios/current/drafts.json`。留幾支照網頁版，殼不管。
- **怎麼傳**：走橋（`messageHandlers`），位元組用 base64 放在 JSON 裡；這樣存、讀草稿都寫得進情境檔。自訂網址（`fetch` 送 ArrayBuffer）比較快，但假殼看不到，沒用。
- **快不快**（開工先驗，2026-11-22，只在 iOS 27.2 模擬器上，Mac 的 CPU；`PipeTests` 的 `量_60MB的草稿存一次讀一次多久`）：60 MB 存一次約 0.15–0.22 秒、讀一次約 0.3–0.37 秒；首頁列最近的流程時每份都整包讀，5 份 60 MB 一份一份讀約 1.4–1.6 秒（網頁其實是同時讀，記憶體沒量）。同樣 60 MB 走自訂網址：存 0.08 秒、讀 0.04 秒。**這是只量傳的那段**：網頁把流程打包成流程檔（`writeFlowFile`）的時間沒算進去。沒用退路（音樂分開存、殼直接回名字）。真機沒量（#379）。
- **趕不趕得及**：殼在 scene 不在前景時（`UIScene.willDeactivateNotification`，滑到 App 切換器就會；拉下控制中心也會，多存一次沒關係）主動說 `background`，網頁跟關分頁一樣馬上存，不等停手 1 秒；殼收到草稿時跟系統要背景時間（只包到寫檔那段，網頁打包、傳的那段不在裡面），檔整個寫好才換上去。
  - 管子測試（`真的那包網頁_改一下馬上要切到背景_不等停手1秒就存進殼`）是測試自己發通知：從改到存好約 50 毫秒。
  - 另外在模擬器上真的切到背景試過一次（打開「設定」把 App 擠到背景，一直改讓停手 1 秒的存不會跑）：iOS 有發 willDeactivate，草稿接著就存好；那段時間網頁沒收到 `visibilitychange`。只試一次，不是自動測試。真機滑掉 App 在 #379。

## 小設定、上次那支（#378）

「我」、印誰、停下回起播點、圖例、分隔線大小存在殼：`Application Support/settings.json`（一個 JSON，key 跟網頁版 localStorage 的一樣；key 裡有流程名字，不拿來當檔名；會進 iCloud 備份）。延遲校正的 key 也走這裡，殼讀喇叭延遲是 #388。語言、使用說明的打勾照舊存在網頁裡。

- 殼：`ShellCore/Sources/ShellCore/Parts/SettingsPart.swift`（`settings`）。網頁：`src/lib/shell-settings.ts`，殼會 `settings` 才換（`Host.settings`）。說的話：`bridge-scenarios/current/settings.json`。
- **怎麼拿**：document start 塞一份（boot 的 `settings`），網頁建編輯器時照舊同步讀；改了網頁先改自己記憶體裡那份，再馬上 `settingSet`／`settingRemove` 寫回殼。
- **一開始塞的每次換頁前重做**（`WebShell` 的 `refreshBoot`；別人加的 user script 放回去）：殼換上新網頁、網頁行程當掉後重新載入，用的是同一個網頁畫面；不重做的話塞的是 App 打開時的小設定、上次那支。
- **上次那支**：就是小設定裡的 `cheer-editor:lastFlow`（本機流程的草稿 id），網頁記、網頁開。殼說 `background`（#377 那句）時，開著本機流程就記它，在首頁、分享連結（沒有權限）就清掉；開著雲端流程記 `cloud:<流程 id>`（#383，下一節）。打開時記著就直接讀那份草稿開它，不先讀每份草稿列最近的流程；`app.html` 看殼塞的有記，首頁先藏起畫面，開好了或那份草稿沒了才給看（沒了就停在首頁，不說錯）。網頁版不記、不開。
- **多久**：模擬器上從載入首頁到看到上次那支的場地約 0.7 秒（2026-11-23，iOS 27.2 iPad Pro 11 模擬器；跟別的管子測試一起跑時 0.7–1.7 秒；App 裡不開分頁頻道（#392），打開時不用等別的分頁回答；`PipeTests` 的 `真的那包網頁_在流程裡關掉再開_直接進那支流程_中間不停在首頁`；是新的網頁畫面、App 已經開著，不是冷開 App，只當參考）。真機在 #379。

## 雲端流程的音樂（#382）

音樂放在 R2，R2 只放行網站的網址（CORS），`app://local` 的網頁直接 `fetch` 過不了；R2 的設定、伺服器都不改。網頁照舊跟伺服器（`/api/`，上面的轉送）拿預簽網址，再 `fetch('/cloud-music?url=<預簽網址>')`，`App/Shell/CloudMusicRoute.swift` 照那個網址直接送到 R2（規則在 `ShellCore/Sources/ShellCore/Forward/CloudMusic.swift`）：

- 只送到 `https://*.r2.cloudflarestorage.com`，只有 GET、PUT；Debug 版也准 `http://127.0.0.1`（管子測試的假 R2）。不帶網頁的標頭、不帶殼的 cookie（預簽網址只簽了 host），不跟轉址；回給網頁的只留狀態、內容、`Content-Type`。
- 上傳：`File` 的內容進不了殼（上面「POST 進不進得了殼」），網頁先 `await file.arrayBuffer()` 再送。網頁版照舊直接連 R2、送 `File`（`src/lib/server-api.ts` 的 `r2Fetch`）。
- 殼會 `cloudMusic`（`CloudMusicPart`，情境 `bridge-scenarios/current/cloudMusic.json`，只有一開始塞的）網頁才走 `/cloud-music`；網站更新的新網頁碰上還不會的舊殼，照網頁版直接連（過不了，說連不上）。
- 傳到一半斷線：殼丟錯誤，網頁的 `fetch` 失敗（`ServerUnreachable`），畫面照網頁版說傳不上、拿不到；再選一次音樂檔、再打開就是再試。
- **快不快**（2026-11-23，只在 iOS 27.2 模擬器上、本機的假 R2，不是真的 R2、不是真的網路；`PipeTests/CloudMusicPipeTests.swift` 的 `六十MB的音樂傳上去再拿回來`）：60 MB 上傳約 0.19 秒（含網頁轉 ArrayBuffer）、下載約 0.06 秒，只量了一次。真的 R2 還沒接上（docs/deploy.md、#263），真機沒量（#379）。

## 離線存放（#383）

雲端流程還沒傳的紀錄、離線副本（含音樂）、這台登入的是誰（斷網時首頁用的 `SignedInHere`）存在殼：`Application Support/Offline/`，**整個資料夾標成不進 iCloud 備份**（`isExcludedFromBackup`；還原時可能把舊的改動再送一次，離線副本很大、能再下載）。草稿、小設定照舊會進備份。標在資料夾上，不標在檔上：整個寫好才換上去（`.atomic`）的檔是新的檔，檔上的標記會不見；每次寫都再標一次。

- 殼：`ShellCore/Sources/ShellCore/Parts/OfflinePart.swift`（`offline`）。網頁：`src/lib/shell-offline.ts`，殼會 `offline` 才換（`Host.createOfflineStore`，編輯器、登入頁、帳號頁三個地方都經過它）。說的話：`bridge-scenarios/current/offline.json`。
- 存的樣子由網頁決定（帶版號，`src/lib/offline-store.ts` 讀），殼原樣存、原樣回：`unsent/<流程 id>.json`、`copies/<流程 id>.json`、`audio/<流程 id>/<音樂 id>`、`signedIn.json`。列離線副本不帶音樂；音樂一個檔一句（base64）。流程 id、音樂 id 只收英數字、`-`、`_`。
- 留幾支、登出清什麼照網頁版（登出清離線副本、音樂、這台登入的是誰，沒傳的紀錄不動）。殼代網頁上網用的 cookie 罐子（`cookies-<host>-<port>.json`，#380）不在這個資料夾，照舊會進備份；登出時伺服器叫它清空。
- **上次那支是雲端流程**：網頁記 `cloud:<流程 id>`。打開時這台有那支的離線副本就先開它（不先問伺服器；先當斷著：只能看、能記，名字旁寫「⚠ 離線」），房間連上（伺服器說可以送步）就自動換成最新的、可以改，中間記的跟斷線時記的一樣當沒傳的紀錄，連上就送（同一個 id 伺服器不記兩筆）；連上時畫面說「連上了。」。換成最新的時，離線副本裡有的音樂不再下載。被收回、被刪掉照房間說的回首頁（黃條說原因，離線副本刪掉）。沒有離線副本就照現在等伺服器（等的時候先畫首頁）。網頁版不記、不開。
- 只在模擬器、Vitest 上試過（`src/lib/last-flow.svelte.test.ts`、`PipeTests/OfflinePipeTests.swift` 看存在哪、標成不備份）；真的關網路再開 App、iCloud 備份還原沒試（#379）。

## 還沒做的（後面的票）

App 圖示、更新按鈕和「App 太舊」（#394）、出版指令（#340）。

已知、還沒處理的：自己網址的 `target=_blank`（例：使用說明的連結）在原地開，會蓋掉編輯畫面；網頁用 `<a download>` 下載 `blob:` 的檔，App 裡會怎樣沒試（下載交給 #377／#391 那幾張）。只在 iOS 27.2 模擬器上跑過；「交給 Safari」測的是殼呼叫打開外面網址的那一步，沒看到 Safari 真的打開；「只開一個視窗」只靠 Info.plist，沒在 iPad 上試拖出第二個視窗。
