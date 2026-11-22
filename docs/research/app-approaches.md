# iPhone、iPad app 有哪幾種做法、各自最新到哪一版

Issue #293（地圖 #292）。

查核日期：2026-11-20。這份只整理事實，不選哪一條路。選哪一條是另一張單「app 用什麼技術做」（#301）的事。

- 沒有特別標的句子，是在一手來源讀到的（已確認）。來源列在最後，內文用 [方括號] 標是哪一個。
- 標「推論」的是我自己推的或算的，來源沒有直接寫。
- 標「本機實測」的是在這台 Mac（Apple Silicon、macOS 26.6.2、只有 Command Line Tools）上數的或跑的。
- 標「回報」的是 WebKit 臭蟲單裡回報的人寫的，不是 WebKit 團隊的正式說法。
- 標「查不到」的是在讀過的一手來源裡找不到。
- 這次沒有裝 Xcode、Flutter、Android SDK，也沒有在真的 iPhone、iPad 上跑過任何東西。手感的部分只有「文件怎麼寫」，沒有量過。
- 「最新正式版」的認法：套件登錄處（npm、crates.io、Flutter 的 releases 檔、GitHub 上標 Latest 的版本）裡，不帶 alpha、beta、rc 的最高版本。
- 版本、日期、規定都會變。開工那天請再查一次。

## 先講結論

### Apple 這邊現在到哪一版

| 項目 | 現況 | 來源 |
|---|---|---|
| Xcode 最新正式版 | 27.2（27B52），2026-10-29 | [Apple 發版列表] |
| Xcode 27.2 要的 macOS | macOS Tahoe 26.6 以上 | [Xcode 需求表] |
| Xcode 27.2 帶的 SDK | iOS 27.2、iPadOS 27.2 | [Xcode 27.2 發版說明] |
| Xcode 27.2 能設的最低系統版本 | iOS／iPadOS 15 到 27 | [Xcode 需求表] |
| Xcode 27.2 能接的實機、模擬器 | iOS 17 以上 | [Xcode 需求表] |
| Swift | Xcode 27.2 內附 6.4；swift.org 最新是 6.4.1（2026-10-12） | [Xcode 27.2 發版說明]、[Swift 安裝頁] |
| iOS／iPadOS 最新正式版 | 27.2.1，2026-11-09。列表上 iOS 有兩個版號（24B156、24B91034），iPadOS 是 24B156 | [Apple 發版列表] |
| 上架要用的工具 | 2026-04-28 起要用 Xcode 26 以上、iOS 26 SDK 以上建。還沒有「一定要 Xcode 27」的規定 | [Apple 上架規定] |
| 上架可設的最低系統版本 | 2026-09-09 起，最低只能設到 iOS 13 或更新 | [Apple 上架規定] |
| 測試版（不算正式版） | Xcode 27.3 beta 2（2026-11-16）、iOS 27.3 beta 2 v2（2026-11-19） | [Apple 發版列表] |

這台 Mac 是 macOS 26.6.2（本機實測），裝得了 Xcode 27.2。現在沒有裝。

### 各做法一覽

下面每一種做法的文件都要 Xcode：Tauri 明寫 iOS 開發只能在 macOS 上做；Capacitor 的 FAQ 對「沒有 Mac 能不能建 iOS app」的回答是「Short answer, no」；Flutter、React Native 的設定頁要裝 Xcode；Kotlin 的相容表列了要配哪一版 Xcode。推論：所以每一種都要一台 Mac。

| 做法 | 最新正式版（發布日） | 誰在維護 | 多久出一版 | 文件寫的 Xcode | 最低 iOS／iPadOS | 畫面誰畫 | 寫什麼語言 |
|---|---|---|---|---|---|---|---|
| Apple 原生（SwiftUI、UIKit） | Xcode 27.2（2026-10-29）、Swift 6.4.1（2026-10-12） | Apple | 沒寫固定週期（查不到）。今年：Xcode 27 是 09-14、27.1 是 10-15、27.2 是 10-29 | 就是 Xcode 本身 | Xcode 27.2 可設 15 到 27。SwiftUI 13.0 起 | 系統元件 | Swift |
| Capacitor | 8.6.2（2026-11-12） | Ionic（2022-10 起屬於 OutSystems） | 沒寫固定週期。大版：5 是 2023-05、6 是 2024-04、7 是 2025-01、8 是 2025-12 | 最低 26.0 | 15.0 | 系統的 WKWebView 顯示網頁 | 原本的網頁程式；外掛用 Swift |
| Tauri | tauri 2.12.7、CLI 2.12.6（都是 2026-11-18） | Tauri Programme（在 Commons Conservancy 底下） | 沒寫固定週期（查不到）。小版：2.9 是 2025-10、2.10 是 2026-02、2.11 是 2026-04、2.12 是 2026-09 | 只寫「要 Xcode」，沒寫版號 | 預設 15.0 | 系統的 WKWebView 顯示網頁 | 原本的網頁程式；另一半是 Rust（也可用 Swift） |
| 自己用 Swift 包一個 WKWebView | 跟著 Xcode、iOS | Apple | 同 Apple 原生 | 就是 Xcode 本身 | WKWebView 8.0 起；SwiftUI 的 `WebView` 26.0 起 | 系統的 WKWebView 顯示網頁 | 原本的網頁程式；殼用 Swift |
| Flutter | 3.50.1（2026-11-20），Dart 3.14.0 | Google | 一年四個正式版。2027 年預定 2、5、8、11 月 | 只寫「最新版 Xcode」 | 15（支援 15 到 27；CI 測 18 和 26） | Flutter 自己畫 | Dart |
| React Native | 0.88.1（2026-10-27）。Expo SDK 58（58.0.26，2026-11-17） | README 寫是很多公司和個人一起維護，並指向 React Foundation；原始碼檔頭的著作權是 Meta Platforms | 推論：約兩個月一個小版（照 0.83 到 0.88 的日期算，見 4.2）。官方寫只維護最新三個小版 | 最低 26.0。Expo SDK 58 寫 26.4 以上 | 15.1。Expo SDK 58 寫 16.4 以上 | 系統原生元件 | JavaScript／TypeScript，畫面用 React |
| Compose Multiplatform | 1.12.2（2026-10-15）。Kotlin 2.4.21（2026-10-08） | JetBrains | 推論：三到四個月一個小版（1.10 是 2026-01、1.11 是 2026-05、1.12 是 2026-08） | Kotlin 2.4.20–2.4.21 對 Xcode 26.4。表上沒有 Xcode 27 | 14 | Compose 自己畫（Skia） | Kotlin |

其他比較少人走的路（NativeScript、Symbiote Native、Lynx、Cordova、.NET MAUI、只共用邏輯的 Kotlin Multiplatform）在第 5 節，各一兩句。

### 現有的東西能留多少

| 做法 | Svelte 畫面 | 流程核心（`src/lib/core/`） | 測試 |
|---|---|---|---|
| 網頁殼（Capacitor、Tauri、自己包） | 可以原樣放進去（Capacitor、Tauri、Svelte 的文件都這樣說；沒實測） | 原樣（沒實測） | 原樣（推論） |
| React Native | 用 React 重寫 | 同樣是 JS，但 Hermes 的文件沒列 `Intl.Segmenter`，核心一載入就用到（沒實測） | 核心的測試留得住，元件測試跟著畫面作廢（推論） |
| Apple 原生 | 用 SwiftUI／UIKit 重寫 | 可以用 JavaScriptCore 載入，或改寫成 Swift | 看核心走哪條路（推論） |
| Flutter、Compose Multiplatform | 用 Dart／Kotlin 重寫 | 不能直接跑 TypeScript（推論：改寫，或另外嵌 JS 引擎） | 重寫（推論） |

細節和數字在第 6 節。

### 把網頁包進 app 時，一手來源指出的幾件事

三種網頁殼用的都是 WKWebView，所以這幾件事三種都一樣。

- **畫面更新率**：「讓 WKWebView 支援 120 Hz」這張 WebKit 需求單還開著（狀態 NEW）。單子裡 WebKit 工程師寫，主畫面網頁 app 預設是 60 fps。Apple 文件沒有一句正式講 WKWebView 的上限（查不到）。
- **放大字體**：網頁裡的一般文字不會跟著系統的字級設定變大。這張單 WebKit 標成不修（WONTFIX），並寫了兩個替代做法。
- **service worker**：「WKWebView 支援 service worker」這張單也還開著。回報：用 `capacitor://` 這類自訂網址時，註冊不了 service worker。這個專案現在靠 service worker 離線（本機實測：`vite.config.ts`、`src/hooks.client.ts`）。
- **存在網頁裡的資料**：Capacitor 文件寫，iOS 空間不夠時系統會收回 Web View 的 Local Storage，IndexedDB 也一樣，要當成「暫時的」。
- **審查**：App Review Guidelines 4.2 寫，app 不能只是把網站重新包一次。
- **Capacitor 不建議直接載入線上網站**：`server.url` 這個設定寫明不是給正式版用的。

### 各版 iOS／iPadOS 使用比例

Apple 公布的數字，量的日期是 2026-06-07。推論：那時 iOS 27 還沒出（Xcode 27 是 2026-09-14 才出）。

| | iOS／iPadOS 26 | 18 | 更早 |
|---|---|---|---|
| 全部 iPhone | 79% | 14% | 7% |
| 近四年推出的 iPhone | 86% | 11% | 3% |
| 全部 iPad | 68% | 17% | 15% |
| 近四年推出的 iPad | 79% | 16% | 5% |

Apple 只分這三格。iOS 27 的比例還沒公布，17、16、15 各佔多少也沒有。

## 1. Apple 的工具和規定

### 1.1 Xcode 和系統版本

| | Xcode 27.2（最新正式版） | Xcode 26.6（2026-06-25） |
|---|---|---|
| 要的 macOS | macOS Tahoe 26.6 以上 | macOS Tahoe 26.2 到 26.x |
| iOS SDK | 27.2 | 26.5 |
| 可設的最低系統版本 | iOS／iPadOS 15 到 27 | iOS 15 到 26.5 |
| 能接的實機 | iOS 17 以上 | iOS 15 以上 |
| Swift | 6.4 | 6.3 |

來源：[Xcode 需求表]、[Apple 發版列表]。

[Xcode 27.2 發版說明] 的原文：

> Xcode 27.2 includes Swift 6.4 and SDKs for iOS 27.2, iPadOS 27.2, tvOS 27.2, watchOS 27.2, macOS 27.2, and visionOS 27.2. Xcode 27.2 supports on-device debugging in iOS 17 and later, tvOS 17 and later, watchOS 10 and later, and visionOS. Xcode 27.2 requires a Mac running macOS Tahoe 26.6 or later.

推論：用 Xcode 27.2 開發，手上的測試機要 iOS 17 以上才接得上除錯。

### 1.2 上架規定

[Apple 上架規定] 的原文：

> Since September 9, 2026 — iOS and iPadOS apps uploaded to App Store Connect must target iOS 13 or later.

> Since April 28, 2026 — Apps uploaded to App Store Connect must be built with Xcode 26 or later using an SDK for iOS 26, iPadOS 26, tvOS 26, visionOS 26, or watchOS 26.

這一頁沒有列「要用 Xcode 27」的日期。

### 1.3 用 iOS 27 SDK 建的 app 多了三條規定

來源是 [iOS 27 發版說明] 的 UIKit 一節。用 Xcode 27 建就適用。

> Apps built with the latest SDK must adopt the scene-based life cycle or they fail to launch.

> iOS and iPadOS apps built with the 27.0 SDK or later are required to include a launch screen. ... Apps that don’t include a launch screen are rejected when the App Store begins accepting apps built with the 27.0 SDK.

> Beginning with iOS 27, supported interface orientations should no longer be a condition for continuous resizability.

另外，`UIRequiresFullScreen`（讓 iPad app 不參加多工的設定）在 iOS／iPadOS 26.0 就標成停用了。[UIRequiresFullScreen] 的原文：

> In iPadOS 26 and later, support multitasking and dynamic resizing to make your iPad app flexible.

各家對這幾條寫了什麼：

| 做法 | 對 Xcode 27、iOS 27 SDK、scene 生命週期寫了什麼 | 來源 |
|---|---|---|
| Flutter 3.50 | 「As of the Flutter 3.41 release, UIScene support is the default for iOS apps, and eligible apps are migrated automatically.」支援平台表寫 iOS 15 到 27。 | [Flutter UIScene]、[Flutter 支援平台] |
| React Native 0.88 | 0.88.0 的更新紀錄：「**SceneDelegate**: Add SceneDelegate lifecycle support」。0.88.1 修了「on iOS 27 for apps built with the iOS 27 SDK」的狀態列問題。支援表寫最低 Xcode 26.0。 | [RN 更新紀錄]、[RN 支援表] |
| Expo SDK 58 | 「SDK 58 is built for iOS 27 and includes React Native 0.88.」版本表寫 Xcode 26.4 以上。 | [Expo SDK 58]、[Expo 版本表] |
| Capacitor 8.6 | 8.5.0（2026-07-31）的更新紀錄：「**ios:** UIScene Support」和「**cli:** add migrator functionality for adopting UIScene」。文件只寫最低 Xcode 26.0。沒找到寫明「支援 Xcode 27」的句子（查不到）。 | [Capacitor 更新紀錄]、[Capacitor 支援政策] |
| Tauri 2.12 | CLI 2.12.0 的更新紀錄：「Update the generated iOS Xcode project to build with Xcode 27. The scenes lifecycle is **not** enabled by default: to opt in, add the `UIApplicationSceneManifest` key to your `src-tauri/Info.ios.plist`.」 | [Tauri CLI 更新紀錄] |
| Compose Multiplatform 1.12 | Kotlin 的 Xcode 相容表：Kotlin 2.4.20–2.4.21 對 Xcode 26.4，沒有 Xcode 27 那一列。Kotlin 2.5.0 預定 2026 年 12 月；2.4.20 的說明提到，為了相容 Xcode 27，2.5.0 要拿掉一個 watchOS 目標。 | [KMP 相容表]、[Kotlin 發版]、[Kotlin 2.4.20] |

Tauri 那一句「預設不開 scene 生命週期」和 Apple 那一句「不採用就開不起來」放在一起，看起來對不上。Tauri 底層 tao 的 [tao 更新紀錄] 有一條這樣寫：

> On iOS, always implement `application:configurationForConnectingSceneSession:options:` on the application delegate, using the role of the connecting session, so the tao scene delegate is installed whenever the system runs the app on the scene lifecycle - which iOS 26 and above does even for apps whose Info.plist does not declare a `UIApplicationSceneManifest`.

這兩邊合起來到底行不行，文件沒有直接講（查不到）。實際用 Xcode 27 建出來會怎樣，沒有測。

### 1.4 審查準則裡跟做法有關的三條

來源：[App Review Guidelines]（頁面寫 Last Updated: October 16, 2026）。

- 4.2：「Your app should include features, content, and UI that elevate it beyond a repackaged website. If your app is not particularly useful, unique, or “app-like,” it doesn’t belong on the App Store.」
- 2.5.2：「Apps should be self-contained in their bundles ... nor may they download, install, or execute code which introduces or changes features or functionality of the app」
- 2.5.6：「Apps that browse the web must use the appropriate WebKit framework and WebKit JavaScript.」

準則沒有寫怎樣才算「超過重新包裝的網站」。網頁殼的 app 會不會被 4.2 退件，沒有一手來源能回答（查不到）。

## 2. Apple 自己的做法（Swift、SwiftUI、UIKit）

- **Swift**：6.4.1 是 2026-10-12，6.4.0 是 2026-09-14 [Swift 安裝頁]。Xcode 27.2 內附 6.4。這台 Mac 的 Command Line Tools 也是 Swift 6.4（本機實測）。
- **SwiftUI**：iOS 13.0 起 [SwiftUI 文件]。
- **UIKit**：文件寫它提供「the event-handling infrastructure for delivering Multi-Touch and other types of input」[UIKit 文件]。
- **兩個可以混用**：「SwiftUI is designed to work alongside UIKit and AppKit」[SwiftUI 介紹頁]。
- **發版節奏**：Apple 沒有寫固定週期（查不到）。讀到的日期見上面的一覽表。
- **要的 Xcode、最低系統版本**：就是 1.1 的表。

原生 app 裡還有兩個跟現有程式有關的零件：

| 零件 | 做什麼 | 哪一版起 | 來源 |
|---|---|---|---|
| WKWebView | 在 app 裡顯示網頁。「Use it when web technologies satisfy your app’s layout and styling requirements more readily than native views.」 | iOS 8.0 | [WKWebView 文件] |
| SwiftUI 的 `WebView`、`WebPage` | 同上，SwiftUI 的寫法 | iOS 26.0 | [WebKit for SwiftUI] |
| JavaScriptCore（`JSContext`） | 「evaluate JavaScript programs from within Swift, Objective-C, and C-based apps」。沒有畫面，只跑 JS | iOS 7.0 | [JavaScriptCore 文件] |

推論：所以原生 app 不一定要全部重寫。可以畫面用 Swift 寫、流程核心照舊用 JS 跑；也可以某幾個畫面放 WKWebView。

**本機實測（JavaScriptCore）**：在這台 Mac 用 Swift 6.4 開一個空的 `JSContext`，檢查流程核心會用到的內建功能。

| 功能 | 結果 |
|---|---|
| `Intl.Segmenter`（以 grapheme 切字） | 有，切得出來 |
| `toSorted`、`toSpliced`、`with`、`findLast`、`findLastIndex`、`at`、`Object.hasOwn` | 都有 |
| `TextEncoder`、`structuredClone`、`crypto.randomUUID` | 都沒有 |

這是 macOS 26.6.2 上的 JavaScriptCore，不是 iOS 上的。也只檢查了功能在不在，沒有把整包核心載進去跑。核心自己不用後面那三樣（見 `run-ts-core-on-server.md` 第 1 節）。

## 3. 把網頁包進 app 的殼

### 3.1 Capacitor

| 項目 | 內容 | 來源 |
|---|---|---|
| 最新正式版 | `@capacitor/core`、`@capacitor/ios` 8.6.2，2026-11-12。MIT 授權 | [npm] |
| 維護者 | Ionic。Ionic 在 2022 年 10 月加入 OutSystems | [Ionic 公告] |
| 發版 | 8.0.0 是 2025-12-08；小版 8.4 是 2026-06-02、8.5 是 07-31、8.6 是 10-28。v8 是 Active，v7 是 Extended Support | [npm]、[Capacitor 支援政策] |
| 要的 Xcode | 「Capacitor 8 requires a minimum of Xcode 26.0.」 | [Capacitor 環境設定] |
| 最低 iOS | 「iOS 15+ is supported.」 | [Capacitor iOS] |
| 其他要求 | Node 22 以上。iOS 相依套件建議用 Swift Package Manager。沒有 Mac 能不能建 iOS：「Short answer, no」（FAQ 說雲端服務可以建，但沒辦法在裝置或模擬器上測） | [Capacitor 支援政策]、[Capacitor 環境設定]、[Capacitor FAQ] |
| 怎麼顯示 | 「Capacitor uses WKWebView, not the deprecated UIWebView.」 | [Capacitor iOS] |
| 網頁的網址 | 預設是 `capacitor://localhost`。scheme 不能設成 http 或 https | [Capacitor 設定] |

文件對「放現有的網頁進去」的說法 [Capacitor 文件首頁]：

> Capacitor can be dropped into any existing modern JavaScript project

> If it works in the browser, it probably works in a mobile app when using Capacitor.

維護會不會斷：[Ionic 公告]（2025-02-11）宣布商業產品不再賣給新客戶，同一篇寫：

> Ionic’s open source software, including Ionic Framework and Capacitor, will remain free and open source. These offerings will continue to be maintained and improved since they form a significant portion of the OutSystems mobile stack.

### 3.2 Tauri

| 項目 | 內容 | 來源 |
|---|---|---|
| 最新正式版 | `tauri` 2.12.7、`@tauri-apps/cli` 2.12.6，都是 2026-11-18 | [crates.io]、[npm] |
| 維護者 | 「The Tauri Programme within the Commons Conservancy」 | [Tauri 治理] |
| 發版 | 2.0.0 是 2024-10-02。沒寫固定週期（查不到） | [npm] |
| 要的 Xcode | 「iOS development requires Xcode and is only available on macOS.」沒寫版號。2.12.0 起產生的專案改成能用 Xcode 27 建 | [Tauri 事前準備]、[Tauri CLI 更新紀錄] |
| 最低 iOS | `bundle.iOS.minimumSystemVersion`：「Defaults to 15.0.」 | [Tauri 設定] |
| 其他要求 | Rust（`tauri` 2.12.7 要 1.90 以上）、Rust 的 iOS 目標、Homebrew、CocoaPods | [crates.io]、[Tauri 事前準備] |
| 怎麼顯示 | 用系統的 webview；Apple 平台是 WKWebView。webview 跟著系統更新 | [Tauri webview 版本] |

[Tauri 開始頁] 的說法：

> Developers can integrate any frontend framework that compiles to HTML, JavaScript, and CSS for building their user experience while leveraging languages such as Rust, Swift, and Kotlin for backend logic when needed.

SvelteKit 的官方教學 [Tauri SvelteKit]：

> Use SSG and SPA via static-adapter. Tauri doesn’t support server-based solutions.

那一頁自己寫「This guide is accurate as of SvelteKit 2.20.4 / Svelte 5.25.8」，最後更新是 2025-07-05。這個專案用的是 SvelteKit 3、Svelte 5.57（`package.json`），教學沒有跟到這一版。

### 3.3 自己用 Swift 包一個 WKWebView

- 不靠任何框架：一個 Swift 寫的殼，裡面放 WKWebView（iOS 8.0 起）或 SwiftUI 的 `WebView`（iOS 26.0 起）[WKWebView 文件]、[WebKit for SwiftUI]。
- 版本就是 Xcode 和 iOS 的版本，沒有第三方要跟。
- 推論：Capacitor、Tauri 幫忙做掉的事（把網頁檔放進 app、網頁和原生互相呼叫、外掛）都要自己寫。讀過的 Apple 文件沒有一頁專門教「把整個網站包成 app」（查不到）。

### 3.4 三種殼共同的事：都是 WKWebView

| 題目 | 一手來源怎麼說 | 類別 | 來源 |
|---|---|---|---|
| 120 Hz | 需求單「Allow WKWebView to Support 120Hz Refresh Rate on ProMotion Devices」，2025-06-11 開，狀態 NEW，最後更動 2026-09-17。WebKit 工程師在單子裡寫：「I get 60fps in a Home Screen web app with default settings.」 | 已確認（單子的狀態和這句話） | [WebKit 294338] |
| 120 Hz | Safari 關掉「Prefer Page Rendering Updates Near 60fps」可以到 120 Hz，但這個開關「only affects Safari itself, but not hybrid apps using WKWebView」。有人說 Capacitor、Tauri 的外掛是用私有 API 打開的。 | 回報 | [WebKit 294338] |
| 放大字體 | 需求單「AX: WKWebView should support increasing text size for accessibility」，狀態 RESOLVED WONTFIX。Apple 的人在單子裡寫：「Standard web text does not not reflect the system font size because not all web views are coded well enough to contain it well.」 | 已確認 | [WebKit 187013] |
| 放大字體的替代做法 | 同一則：「you can either adjust the web content to use the legacy vendor-prefixed CSS keywords (like -apple-system-body) or implement your own font size controller」 | 已確認 | [WebKit 187013] |
| service worker | 需求單「WKWebView support for Service Workers」，狀態 NEW，最後更動 2026-08-04。2020 年 WebKit 的人寫：「We're looking into ways to enable this.」 | 已確認（單子的狀態和這句話） | [WebKit 206741] |
| service worker | 設了 App-Bound Domains 之後有 `navigator.serviceWorker`，「But workers can only be loaded via HTTP or HTTPS protocols. Workers can't be loaded from a custom URL scheme」。另一位說 Capacitor 的 `capacitor://` 因此不能用 service worker。 | 回報 | [WebKit 206741] |
| App-Bound Domains | app 可以在 `WKAppBoundDomains` 列最多 10 個網域。本機檔案和 data URL 一律算在內。Capacitor 有 `ios.limitsNavigationsToAppBoundDomains` 這個設定。 | 已確認 | [WebKit App-Bound Domains]、[Capacitor 設定] |
| 網頁資料的容量 | 不是瀏覽器的 app：一個來源最多用到磁碟的 15%，全部加起來最多 20%。預設是「盡量保存」模式，空間不夠時可能被清掉。 | 已確認 | [WebKit 儲存政策] |
| 網頁資料會不會被清 | 「Local Storage ... must be considered transient ... This is because the OS will reclaim local storage from Web Views if a device is running low on space. The same can be said for IndexedDB at least on iOS」 | 已確認（Capacitor 的文件） | [Capacitor 儲存] |
| 深色模式 | 「Safari and WebKit do not auto-darken web content — documents will need to opt-in to dark mode.」用 CSS 的 `color-scheme` 和 `prefers-color-scheme`，iOS 13 起。 | 已確認 | [WebKit 深色模式] |
| 直接載入線上網站 | Capacitor 的 `server.url`：「Load an external URL in the Web View. This is intended for use with live-reload servers. **This is not intended for use in production.**」 | 已確認 | [Capacitor 設定] |
| WKWebView 每年有沒有在動 | Safari 27.0 的說明有一節專講 WKWebView 新增的公開 API，也列了一長串 VoiceOver 的修正。裡面沒有 120 Hz。 | 已確認 | [Safari 27.0] |

推論：

- 殼裡的網頁來源是 `capacitor://localhost` 或 `tauri://localhost`，不是現在網站的網域。伺服器的 CORS、登入用的 cookie、音樂 bucket 的 CORS 都是照來源算的，要另外放行。這一點沒有實測。
- 網頁檔本來就包在 app 裡，不用靠 service worker 才開得起來。但這個專案現在是用 service worker 做離線的（`vite.config.ts` 的 `withPwa`、`src/hooks.client.ts` 的 `registerSW`，本機實測），在殼裡這一段要換做法或確認能不能註冊。沒有實測。

## 4. 一份程式跑多個平台的畫面框架

### 4.1 Flutter

| 項目 | 內容 | 來源 |
|---|---|---|
| 最新正式版 | 3.50.1，2026-11-20（查核當天），Dart 3.14.0。3.50.0 是 2026-11-11 | [Flutter 發版檔] |
| 維護者 | 「Flutter is an open source project managed by Google, with contributions from a global community of developers, companies, and individuals.」 | [Flutter FAQ] |
| 發版 | 3.38 是 2025-11-12、3.41 是 2026-02-11、3.44 是 05-18、3.47 是 08-12、3.50 是 11-11。「Roughly every third beta version is promoted to the stable version.」2027 年的正式版預定 2、5、8、11 月 | [Flutter 發版檔]、[Flutter 版本頁] |
| 要的 Xcode | 「install and set up the latest version of Xcode」。沒寫最低版號。還要 CocoaPods | [Flutter iOS 設定] |
| 最低 iOS | 支援 15 到 27；CI 測 18 和 26；14 以下不支援 | [Flutter 支援平台] |
| 怎麼畫 | 不用系統元件，自己畫 | [Flutter FAQ]、[Flutter 架構] |

[Flutter FAQ]：

> Does Flutter use my operating system's built-in platform widgets? No. Instead, Flutter renders widgets directly using its own engine, providing implementations of Material Design and Cupertino (iOS-style) widgets.

[Flutter 架構] 寫了這樣做的結果：

> The application looks and feels the same on all versions of the OS, even if the OS changed the implementations of its controls.

系統改版之後呢，[Flutter FAQ]：

> The Flutter team and community track new design guidelines and platform widgets from Apple and Google, updating Flutter's widget libraries accordingly.

FAQ 也寫，需要原生元件時可以嵌進去，舉的例子有「a web view」。

### 4.2 React Native（和 Expo）

| 項目 | 內容 | 來源 |
|---|---|---|
| 最新正式版 | `react-native` 0.88.1，2026-10-27。0.88.0 是 2026-10-15 | [npm] |
| 維護者 | 「React Native is developed and supported by many companies and individual core contributors. Find out more on the React Foundation website.」原始碼檔頭的著作權是 Meta Platforms | [RN README]、[RN helpers.rb] |
| 發版 | 0.83 是 2025-12-10、0.84 是 2026-02-11、0.85 是 04-07、0.86 是 06-09、0.87 是 08-11、0.88 是 10-15。0.89 排在 2026-12-07。「we’re committed to maintain the latest 3 minor series」 | [npm]、[RN 發版總覽] |
| 要的 Xcode | 0.87、0.88、0.89：最低 26.0。0.86：16.1。設定頁寫「Please use the latest version of Xcode.」 | [RN 支援表]、[RN 環境設定] |
| 最低 iOS | 15.1（0.88.1 的 `min_ios_version_supported`） | [RN helpers.rb] |
| 其他要求 | Node 22.13.0 以上、CocoaPods。畫面用 React 寫（peer 相依是 `react ^19.3.0`） | [RN 支援表]、[npm] |
| 怎麼畫 | 用系統原生元件 | [RN README] |

[RN README]：

> React Native primitives render to native platform UI, meaning your app uses the same native platform APIs other apps do. Gestures, text scaling, and accessibility behave the way users expect on each OS.

一個對不上的地方：支援表寫 0.88 最低 Xcode 26.0，但 0.88.1 的 `helpers.rb` 裡 `min_xcode_version_supported` 還是 `'16.1'`。兩個都是官方的檔案。以哪個為準，沒查到。

**Expo**（README 建議搭一個框架來用，Expo 是它舉的那個）：

| 項目 | 內容 | 來源 |
|---|---|---|
| 最新正式版 | `expo` 58.0.26，2026-11-17。SDK 58.0.0 是 2026-09-29 | [npm] |
| 發版 | SDK 55 是 2026-02-25、56 是 05-20、57 是 06-30、58 是 09-29 | [npm] |
| 對應 | 「SDK 58 is built for iOS 27 and includes React Native 0.88.」 | [Expo SDK 58] |
| Xcode、最低 iOS | SDK 58：Xcode 26.4 以上、iOS 16.4 以上 | [Expo 版本表] |

**JS 引擎**：React Native 0.84 起預設用 Hermes V1（部落格文章標題「React Native 0.84 - Hermes V1 by Default」；內文沒讀）。Hermes 的 [Hermes Intl 文件] 列了 `Intl.Collator`、`Intl.NumberFormat`、`Intl.DateTimeFormat`、`Intl.getCanonicalLocales`，**沒有 `Intl.Segmenter`**。這份文件有沒有跟上 Hermes V1，沒查到；也沒有實測。

### 4.3 Compose Multiplatform

| 項目 | 內容 | 來源 |
|---|---|---|
| 最新正式版 | 1.12.2，2026-10-15（GitHub 上標 Latest） | [Compose 發版] |
| 維護者 | JetBrains | [Compose 發版] |
| 發版 | 1.10.0 是 2026-01-13、1.11.0 是 05-13、1.12.0 是 08-25。「The gap between a Compose Multiplatform release and a Jetpack Compose release is usually 1–3 months.」 | [Compose 發版]、[Compose 相容與版本] |
| Kotlin | 「The current Stable version of Kotlin is 2.4.21.」（2026-10-08）。語言版每 6 個月一次，工具版在那之後 3 個月 | [KMP 相容表]、[Kotlin 發版] |
| 要的 Xcode | Kotlin 2.4.20–2.4.21 對 Xcode 26.4（2.3.x 對 26.0）。**沒有 Xcode 27 那一列** | [KMP 相容表] |
| 最低 iOS | 「Compose Multiplatform 1.12.2 supports ... iOS — iOS 14」 | [Compose 相容與版本] |
| iOS 的成熟度 | Stable | [KMP 支援平台] |
| 怎麼畫 | 自己畫，用 Skia（經由 Skiko）。1.12 更新到 Skia Milestone 150 | [Compose 1.12] |

推論：Xcode 27.2 能不能配 Kotlin 2.4.21 建出 Compose 的 iOS app，要等相容表補上 Xcode 27，或等 Kotlin 2.5.0（預定 2026 年 12 月）。現在的文件沒有答案。

## 5. 其他做法（各一兩句）

| 做法 | 是什麼 | 最新正式版 | 沒查的 |
|---|---|---|---|
| Svelte 官方怎麼說 | [Svelte FAQ]：「you can turn a SvelteKit SPA into a mobile app with Tauri or Capacitor」。自訂 renderer「is not yet merged」。 | — | — |
| Symbiote Native | [Svelte FAQ]：用 Svelte 寫、編成原生元件，「leverages the infrastructure provided by React Native」 | 沒查 | 版本、最低 iOS |
| Svelte Native（NativeScript） | [Svelte FAQ]：「Svelte Native was an option available for Svelte 4, but Svelte 5 does not currently support it.」npm 上的 `svelte-native` 1.0.29（2024-11-07）要 `svelte ^4.2.8` | `@nativescript/core` 9.1.4（2026-11-13） | 最低 iOS |
| Lynx | 官網寫「native rendering on iOS, Android, HarmonyOS and Web」 | `@lynx-js/react` 0.129.3（2026-11-13） | 維護者、最低 iOS |
| Apache Cordova | 2008 年就有的網頁殼，Apache 的專案。8.x 最低 iOS 13.0、Xcode 15.0.0 以上 | `cordova-ios` 8.2.0（2026-11-09） | — |
| .NET MAUI | .NET Multi-platform App UI，文件在 Microsoft 的網站 | .NET 11.0.0（2026-11-10） | 最低 iOS（頁面上同時有 iOS 11 和 iOS 12.2 兩種寫法，分不出哪個對應 .NET 11） |
| Kotlin Multiplatform，只共用邏輯 | 推論：畫面各平台用原生寫，只有邏輯用 Kotlin 共用。Kotlin Multiplatform 的 iOS 是 Stable | Kotlin 2.4.21 | 跟 Xcode 27 的相容性同 4.3 |

來源：[Svelte FAQ]、[npm]、[Lynx 官網]、[Capacitor 談 Cordova]、[Cordova iOS]、[.NET 發版索引]、[.NET MAUI 支援平台]、[KMP 支援平台]。

## 6. 現有的東西能留多少

### 6.1 現在有多少東西（本機實測，commit 62c78dc）

| 東西 | 檔案數 | 行數 |
|---|---|---|
| 流程核心 `src/lib/core/`（不含測試） | 45 | 8,459 |
| 流程核心的測試 | 43 | 12,620 |
| Svelte 元件（`.svelte`） | 50 | 20,881 |
| Svelte 的狀態模組（`.svelte.ts`，不含測試） | 12 | 沒數 |
| 核心以外的一般 `.ts`（不含測試） | 96 | 沒數 |
| 全部測試檔 | 163 | 40,650 |
| 其中元件測試（`*.svelte.test.ts`，在 jsdom 跑） | 89 | 22,169 |

流程核心對外只 import 一個套件：`fflate`。唯一用到 `Intl` 的地方是 `text-length.ts:24`，在模組最上層就執行 `new Intl.Segmenter(...)`。

核心以外用到的瀏覽器功能（grep 的出現次數，含測試）：`localStorage` 18、`AudioContext` 17、`VideoEncoder` 12、`showSaveFilePicker` 9、`BroadcastChannel` 7、`WebSocket` 6、`showOpenFilePicker` 5、`indexedDB` 2、`navigator.share` 1、`navigator.clipboard` 1，加上 service worker。這些在 WKWebView 裡各自能不能用，這份沒有逐項查。

### 6.2 各做法

| 做法 | Svelte 畫面 | 流程核心 | 測試 |
|---|---|---|---|
| Capacitor、Tauri、自己包 WKWebView | 原樣放進去。要另外處理的是 3.4 那幾件事，和上面那串瀏覽器功能 | 原樣，在 WKWebView 裡跑 | 推論：原樣。測試在開發機的 Node、jsdom 跑，跟殼無關。殼本身的行為這些測試測不到 |
| React Native（含 Expo） | 用 React 重寫。50 個元件、12 個狀態模組都是 Svelte 專用的 | 同樣是 JS／TS，可以直接 import（推論）。卡點是 Hermes 的文件沒列 `Intl.Segmenter`（見 4.2）。推論：沒有的話，核心一載入就失敗，要補墊片或改那一處 | 推論：核心的 43 個測試檔照舊在 Node 跑，但跑的引擎不是 Hermes。89 個元件測試跟著畫面作廢 |
| Apple 原生 | 用 SwiftUI／UIKit 重寫 | (a) 把核心打包成一個 JS 檔，用 `JSContext` 載入。本機實測：macOS 的 JavaScriptCore 有核心要的內建功能（見第 2 節）；iOS 上沒測，整包也沒實際載過。(b) 改寫成 Swift | 推論：(a) 核心測試照舊；(b) 要重寫。元件測試作廢 |
| Flutter | 用 Dart 重寫 | Dart 不能直接跑 TypeScript。讀過的 Flutter 文件沒找到內建跑 JS 的做法（查不到）。推論：改寫成 Dart，或另外嵌 JS 引擎 | 推論：重寫 |
| Compose Multiplatform | 用 Kotlin 重寫 | 同上，換成 Kotlin。這一項沒有查 Kotlin 的文件 | 推論：重寫 |

`run-ts-core-on-server.md` 已經查過「核心能在哪些 JS 引擎跑」。那一份的結論跟這裡有關的一點：沒有 `Intl` 的引擎，整包核心在載入時就失敗，補一個約 20 行的墊片就能跑。

## 7. 手感的上限：一手來源怎麼說

先講沒有的：**捲動、拖曳「跟不跟手」的數字（延遲幾毫秒、掉幾格），每一種做法的一手來源都沒有寫（查不到）。** 這只能在真機上量。下面只列文件寫了什麼。

### 7.1 捲動和拖曳

| 做法 | 文件怎麼說 | 來源 |
|---|---|---|
| Apple 原生 | UIKit 提供多點觸控的事件處理。「The system automatically handles frame pacing for UIKit, SpriteKit, SwiftUI, and CAAnimation animations for you.」 | [UIKit 文件]、[ProMotion 文件] |
| Flutter | 捲動是自己做的，照平台調整：「Scrolling is an important part of the platform's look and feel, and Flutter automatically adjusts the scrolling behavior to match the current platform.」 | [Flutter 平台調整] |
| React Native | `ScrollView` 是「Component that wraps platform ScrollView」，也就是包系統的捲動元件 | [RN ScrollView] |
| Compose Multiplatform | 自己畫。1.12 的說明寫「improved scrolling performance for lazy layouts」。嵌進原生元件時，觸控會先等 150 毫秒判斷是不是捲動，做法是「inspired by UIScrollView」 | [Compose 1.12]、[Compose iOS 觸控] |
| 網頁殼 | Capacitor 的 `ios.scrollEnabled`、`ios.contentInset` 是設在「the Web View's UIScrollView」上。推論：所以整頁的捲動是系統的捲動元件在做。網頁裡面自己做的拖曳（JS 的指標事件）有多跟手，查不到 | [Capacitor 設定] |

### 7.2 120 Hz

硬體：[ProMotion 文件] 列的有 ProMotion 的裝置是 iPhone 13 Pro／Pro Max 和之後、iPhone 17 和之後、iPhone Air，以及 iPad Pro（10.5 吋、11 吋、12.9 吋第 2 代起、13 吋）。

| 做法 | 文件怎麼說 | 來源 |
|---|---|---|
| Apple 原生 | 系統動畫自動處理。iPhone 上自己用 `CADisplayLink` 等畫的，要在 Info.plist 加 `CADisableMinimumFrameDurationOnPhone`：「If you don’t enable this support, Core Animation won’t access higher frame rates (above 60Hz).」「The iPad Pro doesn’t require this special configuration.」 | [ProMotion 文件] |
| Flutter | 「Flutter is designed to deliver smooth 60fps and 120fps animations.」3.50.1 的專案範本已經把上面那個設定開成 true | [Flutter FAQ]、[Flutter 範本] |
| React Native | 0.88 的專案範本已經把那個設定開成 true。文件裡沒找到講 120 Hz 的句子（查不到） | [RN 範本] |
| Compose Multiplatform | 「Apps built with Compose Multiplatform will now crash if the CADisableMinimumFrameDurationOnPhone property in the Info.plist file is absent or set to false.」另有 `Modifier.preferredFrameRate(...)`，上限「typically up to 120 Hz」 | [Compose 1.7]、[Compose 1.9] |
| 網頁殼 | 見 3.4：需求單還開著；WebKit 工程師說主畫面網頁 app 預設 60 fps。Capacitor 8.6.2 的專案範本沒有那個設定 | [WebKit 294338]、[Capacitor 範本] |

### 7.3 系統手勢

| 做法 | 文件怎麼說 | 來源 |
|---|---|---|
| Apple 原生 | 「Normally, the screen-edge gestures defined by the system take precedence over any gesture recognizers that you define.」app 可以用 `preferredScreenEdgesDeferringSystemGestures` 要求自己的手勢優先 | [系統手勢文件] |
| Flutter | 「On iOS, an edge swipe gesture can be used to pop the top route.」（Flutter 自己做的） | [Flutter 平台調整] |
| React Native | 只有 README 那句「Gestures ... behave the way users expect on each OS」。講系統手勢的句子沒找到（查不到） | [RN README] |
| Compose Multiplatform | 「The Compose Multiplatform UI supports the same gestures as the native iOS UI for navigation and interaction.」（出自無障礙那一頁） | [Compose iOS 無障礙] |
| 網頁殼 | WKWebView 的 `allowsBackForwardNavigationGestures`（左右滑換頁）預設是 false。Capacitor、Tauri 的文件沒找到講系統手勢的句子（查不到） | [WKWebView 手勢] |

### 7.4 鍵盤

| 做法 | 文件怎麼說 | 來源 |
|---|---|---|
| Apple 原生 | `UIKeyboardLayoutGuide`（iOS 15 起）代表鍵盤佔掉的空間，版面可以跟著它排。文件有列浮動鍵盤、分開的鍵盤、外接鍵盤的快捷列、1/3 分割畫面的情況 | [鍵盤版面文件] |
| Flutter | 文字輸入照平台調整（游標手勢、選字工具列）。「Apps should support basic mice, trackpads, and keyboard shortcuts.」 | [Flutter 平台調整]、[Flutter 做法建議] |
| React Native | `KeyboardAvoidingView`：「This component will automatically adjust its height, position, or bottom padding based on the keyboard height」 | [RN KeyboardAvoidingView] |
| Compose Multiplatform | 1.9.0 起可以用 `PlatformImeOptions` 設定「native UIKit text input traits such as keyboard type, autocorrection, and return key behavior」 | [Compose 1.9] |
| 網頁殼 | Capacitor 有 Keyboard 外掛：鍵盤出現、收起的事件；`resize` 設定「Configure the way the app is resized when the Keyboard appears. Only available on iOS.」Tauri 的沒查 | [Capacitor Keyboard] |

### 7.5 iPad 多工（分割畫面、視窗）

| 做法 | 文件怎麼說 | 來源 |
|---|---|---|
| Apple 原生 | iPadOS 26 起要支援多工和動態改大小；`UIRequiresFullScreen` 停用；iOS 27 SDK 起一定要用 scene 生命週期（見 1.3） | [UIRequiresFullScreen]、[iOS 27 發版說明] |
| Flutter | UIScene 從 3.41 起是預設。做法建議寫，app 可能「side by side with another app on tablets in a multi-window mode」，所以不要鎖方向、要看視窗大小不要看裝置。專講 iPad 的句子沒找到（查不到） | [Flutter UIScene]、[Flutter 做法建議] |
| React Native、Expo | 0.88.0 加了 SceneDelegate 生命週期。Expo SDK 58：「iOS 27 requires the UIKit scene-based life cycle and makes iPhone apps resizable」；「On iOS 27, requireFullScreen no longer opts your app out of resizing, and ScreenOrientation.lockAsync may have no effect while the app is resizable.」 | [RN 更新紀錄]、[Expo SDK 58] |
| Compose Multiplatform | 更新紀錄裡有修 Split View、多視窗（UIScene）的項目。文件裡專講 iPad 多工的句子沒找到（查不到） | [Compose 更新紀錄] |
| 網頁殼 | Capacitor 8.5.0 加了 UIScene 支援。Tauri 2.12.0 的 scene 生命週期預設不開（見 1.3）；底層 tao 的更新紀錄有「Added multi-window support for iOS and Android」，也修過「iPadOS 26 system window controls overlapping `WKWebView` content」 | [Capacitor 更新紀錄]、[Tauri CLI 更新紀錄]、[tao 更新紀錄] |

### 7.6 深色模式

| 做法 | 文件怎麼說 | 來源 |
|---|---|---|
| Apple 原生 | 「Standard views and controls automatically update their appearance to match the current interface style.」自訂的顏色要用會跟著變的顏色 | [Apple 深色模式] |
| Flutter | `ThemeMode.system`：「Use either the light or dark theme based on what the user has selected in the system settings.」 | [Flutter ThemeMode] |
| React Native | `useColorScheme`：「provides and subscribes to color scheme updates from the Appearance module」 | [RN useColorScheme] |
| Compose Multiplatform | 「Compose Multiplatform defines the current theme via isSystemInDarkTheme().」高對比的配色要自己加 | [Compose 資源環境]、[Compose iOS 無障礙] |
| 網頁殼 | 網頁要自己宣告才會變深色（見 3.4）。Capacitor 的鍵盤樣式沒設的話「will depend on the device appearance」 | [WebKit 深色模式]、[Capacitor Keyboard] |

### 7.7 無障礙（VoiceOver、放大字體）

| 做法 | 文件怎麼說 | 來源 |
|---|---|---|
| Apple 原生 | UIKit、SwiftUI 都寫可以自訂無障礙支援。放大字體靠 Dynamic Type：用文字樣式（text style），系統就會照使用者設的大小調整 | [UIKit 文件]、[SwiftUI 文件]、[Apple Dynamic Type] |
| Flutter | 「includes first-class framework support for accessibility in addition to that provided by the underlying operating system」。檢查清單寫要用 VoiceOver 測、字放很大時畫面還要能用 | [Flutter 無障礙] |
| React Native | 「Both Android and iOS provide APIs for integrating apps with assistive technologies like the bundled screen readers VoiceOver (iOS) and TalkBack (Android). React Native has complementary APIs that let your app accommodate all users.」README 寫 text scaling 照系統的行為 | [RN 無障礙]、[RN README] |
| Compose Multiplatform | 「Screen readers and VoiceOver can access the content of the Compose Multiplatform UI.」支援 Full Keyboard Access、AssistiveTouch。放大字體的句子沒找（這一項沒查） | [Compose iOS 無障礙] |
| 網頁殼 | 放大字體：一般網頁文字不跟系統字級，WebKit 不修（見 3.4）。VoiceOver：Safari 27.0 的說明列了很多 VoiceOver 修正。推論：可見網頁內容有接上 VoiceOver。專講 WKWebView 裡 VoiceOver 的句子沒找到（查不到） | [WebKit 187013]、[Safari 27.0] |

## 8. 各版 iOS／iPadOS 使用比例

[Apple 使用比例] 的原文：

> As measured by devices that transacted on the App Store on June 7, 2026.

數字就是「先講結論」那張表。「iOS 18」和「更早」的數字在頁面圖表的資料裡。

- 這是 2026-06-07 量的。Xcode 27 是 2026-09-14 才出，這一頁還沒有 iOS 27 的數字。現在 iOS 26 和 27 各佔多少，查不到。
- Apple 只分三格：26、18、更早。17、16、15 各佔多少，查不到。

推論（照 2026-06-07 的數字算）：

| 最低支援設在 | 全部 iPhone 蓋到 | 全部 iPad 蓋到 |
|---|---|---|
| iOS／iPadOS 26 | 79% | 68% |
| iOS／iPadOS 18 | 93% | 85% |
| 15、16 或 17 | 93% 到 100% 之間，分不出來 | 85% 到 100% 之間，分不出來 |

iOS 27 出了以後，26 以上那一格只會一樣或更高（推論）。

## 9. 以後加 Android

每種做法一句話。

| 做法 | 對以後的 Android app 有沒有幫助 | 來源 |
|---|---|---|
| Apple 原生 | 推論：畫面要整個重寫，因為 SwiftUI、UIKit 的文件只列 Apple 的平台。swift.org 的安裝頁有「Swift SDK for Android」；Swift 寫的邏輯能不能搬過去，這一項沒細查 | [SwiftUI 文件]、[Swift 安裝頁] |
| Capacitor | 同一份網頁程式可以再包成 Android app：官方平台是 iOS 15 以上和 Android 7.0（API 24）以上 | [Capacitor 支援政策] |
| Tauri | 同一份可以再建 Android 版：事前準備那一頁有 Android 一節（Android Studio、NDK、Rust 的 Android 目標） | [Tauri 事前準備] |
| 自己包 WKWebView | 推論：網頁程式留得住，Android 的殼要另外寫一個 | — |
| Flutter | 同一份 Dart 程式也跑 Android：支援 API 24 到 37 | [Flutter 支援平台] |
| React Native | 同一份也跑 Android：最低 Android 7.0 | [RN 支援表] |
| Compose Multiplatform | 同一份 Kotlin 也跑 Android（Stable，Android 5.0／API 21 起）；它的版本跟在 Android 的 Jetpack Compose 後面出，通常差 1 到 3 個月 | [Compose 相容與版本]、[KMP 支援平台] |

## 快要出的版本（都還不是正式版）

地圖 #292 寫「用開工當天最新的正式版，不用測試版」。下面這些在查核當天都還不是正式版，但開工時可能已經是了。

| 做法 | 快要出的 | 來源 |
|---|---|---|
| Xcode、iOS | Xcode 27.3 beta 2（2026-11-16）、iOS 27.3 beta 2 v2（2026-11-19） | [Apple 發版列表] |
| Capacitor | 9.0.0-rc.0（2026-11-12） | [npm] |
| Tauri | 3.0.0-alpha.6 | [crates.io]、[npm] |
| React Native | 0.89.0-rc.2；0.89 排在 2026-12-07 | [npm]、[RN 發版總覽] |
| Compose Multiplatform | 1.13.0-rc01 | [Compose 發版] |
| Kotlin | 2.5.0，「Planned for December 2026」 | [Kotlin 發版] |
| Flutter | 下一個正式版預定 2027 年 2 月 | [Flutter 版本頁] |

## 沒查到、寫得薄的

**要真機才知道的（這次完全沒做）**

- 每一種做法捲動、拖曳的延遲和掉格。沒有任何一手來源給數字。
- 現在的網頁放進 WKWebView 之後，在 120 Hz 的 iPhone、iPad 上實際是幾 fps。
- service worker、`AudioContext`、`VideoEncoder`、檔案選擇器、`BroadcastChannel`、IndexedDB 在 WKWebView（自訂網址）裡能不能用。
- iOS 上的 JavaScriptCore 載不載得動整包流程核心。只在 macOS 檢查了內建功能。
- Hermes V1 有沒有 `Intl.Segmenter`。只看到文件的清單裡沒有。
- Tauri 2.12 預設不開 scene 生命週期，用 Xcode 27 建出來能不能正常開。

**一手來源沒有寫的**

- WKWebView 的畫面更新率上限、service worker 支援：Apple 和 WebKit 沒有正式文件講，只有臭蟲單。
- 網頁殼的 app 會不會被審查準則 4.2 退件。
- iOS 27 的使用比例；17、16、15 各佔多少。
- Apple、Tauri 固定多久發一版。
- Capacitor 8 有沒有正式寫支援 Xcode 27。
- Kotlin／Compose Multiplatform 對 Xcode 27 的相容性（表只到 Xcode 26.4）。
- React Native 0.88 的最低 Xcode 到底是 26.0（支援表）還是 16.1（`helpers.rb`）。

**這次寫得薄的**

- 第 5 節的其他做法只查了版本，沒查最低 iOS、要的 Xcode、維護狀況。
- 手感的七項裡，系統手勢、鍵盤、iPad 多工這三項，各框架只找到一兩句，沒有完整比較。
- Compose Multiplatform 的放大字體、Tauri 的鍵盤，沒查。
- React Native 0.88 和 0.84 的發版文章只看到標題，內文沒讀。
- Tauri 的 SvelteKit 教學停在 SvelteKit 2.20.4，跟這個專案的 SvelteKit 3 合不合，沒試。
- 各做法要不要付費、Apple Developer Program 的規定，不在這張單的範圍，沒查。

## 來源（查於 2026-11-20）

讀法：

- 「全」：抓下整頁，自己從頭讀完。
- 「段」：抓下整頁，用關鍵字找到段落，讀那幾段。
- 「登錄」：機器可讀的登錄資料（JSON）。
- Apple 的文件頁要跑 JavaScript 才顯示，所以讀的是同一頁背後的 JSON（網址是把 `/documentation/…` 換成 `/tutorials/data/documentation/….json`）。下面列的是給人看的網址。
- 搜尋工具只用來找網址。沒有任何一句是照搜尋摘要寫的。
- 沒讀到的：React Native 0.88 的發版文章（404）、Apple 開發者論壇的討論串（被導到人機驗證頁）。都沒有引用。

### Apple

- [Apple 使用比例]（全）https://developer.apple.com/support/app-store/
- [Xcode 需求表]（段）https://developer.apple.com/xcode/system-requirements
- [Apple 發版列表]（全）https://developer.apple.com/news/releases/
- [Apple 上架規定]（全）https://developer.apple.com/news/upcoming-requirements/
- [Xcode 27.2 發版說明]（段）https://developer.apple.com/documentation/xcode-release-notes/xcode-27_2-release-notes
- [iOS 27 發版說明]（段，UIKit 一節）https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes
- [UIRequiresFullScreen]（全）https://developer.apple.com/documentation/bundleresources/information-property-list/uirequiresfullscreen
- [ProMotion 文件]（段）https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays
- [App Review Guidelines]（段）https://developer.apple.com/app-store/review/guidelines/
- [JavaScriptCore 文件]（段）https://developer.apple.com/documentation/javascriptcore
- [WKWebView 文件]（段）https://developer.apple.com/documentation/webkit/wkwebview
- [WKWebView 手勢]（全）https://developer.apple.com/documentation/webkit/wkwebview/allowsbackforwardnavigationgestures
- [WebKit for SwiftUI]（段）https://developer.apple.com/documentation/webkit/webkit-for-swiftui
- [SwiftUI 文件]（段）https://developer.apple.com/documentation/swiftui
- [SwiftUI 介紹頁]（段）https://developer.apple.com/swiftui/
- [UIKit 文件]（段）https://developer.apple.com/documentation/uikit
- [Apple 深色模式]（全）https://developer.apple.com/documentation/uikit/supporting-dark-mode-in-your-interface
- [Apple Dynamic Type]（全）https://developer.apple.com/documentation/uikit/scaling-fonts-automatically
- [鍵盤版面文件]（全）https://developer.apple.com/documentation/uikit/uikeyboardlayoutguide 和 https://developer.apple.com/documentation/uikit/adjusting-your-layout-with-keyboard-layout-guide
- [系統手勢文件]（全）https://developer.apple.com/documentation/uikit/uiviewcontroller/preferredscreenedgesdeferringsystemgestures
- [Swift 安裝頁]（段）https://www.swift.org/install/macos/

### WebKit

- [WebKit 294338]（全）https://bugs.webkit.org/show_bug.cgi?id=294338
- [WebKit 206741]（段）https://bugs.webkit.org/show_bug.cgi?id=206741
- [WebKit 187013]（段）https://bugs.webkit.org/show_bug.cgi?id=187013
- [WebKit App-Bound Domains]（段，2020-06-26）https://webkit.org/blog/10882/app-bound-domains/
- [WebKit 儲存政策]（段，2023-08-10）https://webkit.org/blog/14403/updates-to-storage-policy/
- [WebKit 深色模式]（段，2019-05-07）https://webkit.org/blog/8840/dark-mode-support-in-webkit/
- [Safari 27.0]（段）https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

### Capacitor

- [npm]（登錄）https://registry.npmjs.org/@capacitor/core 和 https://registry.npmjs.org/@capacitor/ios
- [Capacitor 支援政策]（全）https://capacitorjs.com/docs/main/reference/support-policy
- [Capacitor iOS]（段）https://capacitorjs.com/docs/ios
- [Capacitor 環境設定]（段）https://capacitorjs.com/docs/getting-started/environment-setup
- [Capacitor 文件首頁]（段）https://capacitorjs.com/docs
- [Capacitor 設定]（段）https://capacitorjs.com/docs/config
- [Capacitor 儲存]（段）https://capacitorjs.com/docs/guides/storage
- [Capacitor FAQ]（段）https://capacitorjs.com/docs/getting-started/faqs
- [Capacitor Keyboard]（段）https://capacitorjs.com/docs/apis/keyboard
- [Capacitor 更新紀錄]（段）https://raw.githubusercontent.com/ionic-team/capacitor/main/CHANGELOG.md
- [Capacitor 範本]（全）https://raw.githubusercontent.com/ionic-team/capacitor/8.6.2/ios-spm-template/App/App/Info.plist
- [Ionic 公告]（全，2025-02-11）https://ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products

### Tauri

文件頁抓的是 `https://tauri.app/…`。頁面自己標的正式網址是 `https://v2.tauri.app/…`，下面列的是後者。

- [crates.io]（登錄）https://crates.io/api/v1/crates/tauri
- [npm]（登錄）https://registry.npmjs.org/@tauri-apps/cli
- [Tauri 治理]（段）https://v2.tauri.app/about/governance/
- [Tauri 開始頁]（段）https://v2.tauri.app/start/
- [Tauri 事前準備]（段）https://v2.tauri.app/start/prerequisites/
- [Tauri 設定]（段）https://v2.tauri.app/reference/config/
- [Tauri SvelteKit]（段）https://v2.tauri.app/start/frontend/sveltekit/
- [Tauri webview 版本]（段）https://v2.tauri.app/reference/webview-versions/
- [Tauri CLI 更新紀錄]（段）https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/CHANGELOG.md
- [tao 更新紀錄]（段）https://raw.githubusercontent.com/tauri-apps/tao/dev/CHANGELOG.md

### Flutter

- [Flutter 發版檔]（登錄）https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json
- [Flutter 版本頁]（段）https://docs.flutter.dev/install/archive
- [Flutter 支援平台]（段，頁面寫 As of Flutter 3.50）https://docs.flutter.dev/reference/supported-platforms
- [Flutter iOS 設定]（段）https://docs.flutter.dev/platform-integration/ios/setup
- [Flutter 架構]（段）https://docs.flutter.dev/resources/architectural-overview
- [Flutter FAQ]（段）https://docs.flutter.dev/resources/faq
- [Flutter 平台調整]（段）https://docs.flutter.dev/ui/adaptive-responsive/platform-adaptations
- [Flutter 做法建議]（段）https://docs.flutter.dev/ui/adaptive-responsive/best-practices
- [Flutter 無障礙]（段）https://docs.flutter.dev/ui/accessibility
- [Flutter UIScene]（段）https://docs.flutter.dev/release/breaking-changes/uiscenedelegate
- [Flutter ThemeMode]（全）https://api.flutter.dev/flutter/material/ThemeMode.html
- [Flutter 範本]（全）https://raw.githubusercontent.com/flutter/flutter/3.50.1/packages/flutter_tools/templates/app/ios.tmpl/Runner/Info.plist.tmpl

### React Native、Expo

- [npm]（登錄）https://registry.npmjs.org/react-native 和 https://registry.npmjs.org/expo
- [RN 發版總覽]（段）https://reactnative.dev/releases/overview
- [RN 支援表]（段）https://raw.githubusercontent.com/reactwg/react-native-releases/main/docs/support.md
- [RN helpers.rb]（段）https://raw.githubusercontent.com/facebook/react-native/v0.88.1/packages/react-native/scripts/cocoapods/helpers.rb
- [RN README]（段）https://raw.githubusercontent.com/facebook/react-native/main/README.md
- [RN 更新紀錄]（段）https://raw.githubusercontent.com/facebook/react-native/main/CHANGELOG.md
- React Native 部落格的文章列表（只看標題）https://reactnative.dev/blog
- [RN 環境設定]（段）https://reactnative.dev/docs/set-up-your-environment
- [RN 無障礙]（段）https://reactnative.dev/docs/accessibility
- [RN ScrollView]（段）https://reactnative.dev/docs/scrollview
- [RN KeyboardAvoidingView]（全）https://reactnative.dev/docs/keyboardavoidingview
- [RN useColorScheme]（全）https://reactnative.dev/docs/usecolorscheme
- [RN 範本]（全）https://raw.githubusercontent.com/react-native-community/template/0.88-stable/template/ios/HelloWorld/Info.plist
- [Hermes Intl 文件]（段）https://raw.githubusercontent.com/facebook/hermes/main/doc/IntlAPIs.md
- [Expo SDK 58]（段）https://expo.dev/changelog/sdk-58
- [Expo 版本表]（段）https://docs.expo.dev/versions/latest/

### Compose Multiplatform、Kotlin

- [Compose 發版]（段）https://github.com/JetBrains/compose-multiplatform/releases
- [Compose 更新紀錄]（段）https://raw.githubusercontent.com/JetBrains/compose-multiplatform/master/CHANGELOG.md
- [Compose 相容與版本]（段）https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html
- [KMP 支援平台]（段）https://kotlinlang.org/docs/multiplatform/supported-platforms.html
- [KMP 相容表]（段）https://kotlinlang.org/docs/multiplatform/multiplatform-compatibility-guide.html
- [Kotlin 發版]（段）https://kotlinlang.org/docs/releases.html
- [Kotlin 2.4.20]（段）https://kotlinlang.org/docs/whatsnew2420.html
- [Compose 1.12]（段）https://kotlinlang.org/docs/multiplatform/whats-new-compose-112.html
- [Compose 1.9]（段）https://kotlinlang.org/docs/multiplatform/whats-new-compose-190.html
- [Compose 1.7]（段）https://kotlinlang.org/docs/multiplatform/whats-new-compose-170.html
- [Compose iOS 無障礙]（段）https://kotlinlang.org/docs/multiplatform/compose-ios-accessibility.html
- [Compose iOS 觸控]（段）https://kotlinlang.org/docs/multiplatform/compose-ios-touch.html
- [Compose 資源環境]（段）https://kotlinlang.org/docs/multiplatform/compose-resource-environment.html

### 其他

- [Svelte FAQ]（段）https://svelte.dev/docs/svelte/faq
- [npm]（登錄）https://registry.npmjs.org/@nativescript/core 、https://registry.npmjs.org/svelte-native 、https://registry.npmjs.org/@lynx-js/react 、https://registry.npmjs.org/cordova-ios
- [Lynx 官網]（只看了首頁）https://lynxjs.org/
- [Capacitor 談 Cordova]（段）https://capacitorjs.com/docs/cordova
- [Cordova iOS]（段）https://cordova.apache.org/docs/en/latest/guide/platforms/ios/
- [.NET 發版索引]（登錄）https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/releases-index.json
- [.NET MAUI 支援平台]（段）https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms
- Symbiote Native（只看了首頁）https://docs.symbiote-native.dev/

### 這個專案裡的

- `package.json`、`vite.config.ts`、`src/hooks.client.ts`、`src/lib/core/`（本機實測，commit 62c78dc）
- `docs/research/run-ts-core-on-server.md`（流程核心用到哪些 JS 內建功能）
