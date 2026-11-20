# 原生 app 怎麼用同一份 TypeScript 流程核心：事實整理

研究票[查原生 app 怎麼用同一份 TypeScript 流程核心](https://github.com/littlebluewhite/cheer_editor/issues/295)的結果，屬於地圖[iPhone、iPad app 第一版：用什麼技術做、怎麼接上現有的網站、怎麼上架](https://github.com/littlebluewhite/cheer_editor/issues/292)。

查核日期：2026-11-20。這份只整理事實，不做決定，也不建議選哪一條路。

- 標「已確認」的，是我在查核日期當天讀到原始來源的原文。引號裡是原文照抄。
- 標「推論」的是我自己推的，沒有來源直接這樣寫。
- 標「本機實測」的是我在這台 Mac（Apple M3 Max、macOS 26.6.2）上跑的。**這是 Mac，不是 iPhone、iPad**，數字只能看量級。
- 標「查不到」的是找過官方來源，沒找到。
- 這台 Mac 沒有完整的 Xcode 和模擬器，所以沒有任何 iPhone、iPad 上的實測。
- 實測用的暫存檔沒有進 repo；做法寫在第 4 節，照著做可以重跑。
- 版本、日期都會變，用之前請再查一次。
- 這份接著 `docs/research/run-ts-core-on-server.md`（2026-11-06）往下查，那份寫過的不重寫。

## 先講結論

### 四種能在 iPhone、iPad app 裡跑這包 JavaScript 的引擎

| 引擎 | 版本（查於 2026-11-20） | 上架規定 | 快不快 | app 變多大 | 除錯 | 這包現在能不能直接跑 |
|---|---|---|---|---|---|---|
| 系統的 JavaScriptCore（`JSContext`） | 跟著 iOS 走。最新 iOS、iPadOS 是 27.2.1（2026-11-09） | 已確認：系統 framework，Apple 文件寫 `JSContext` iOS 7.0 起 | 本機實測（Mac 的 `jsc`，關掉 JIT）：1.5 MB 的流程一步 4.5–12 毫秒。推論：一般 app 裡沒有 JIT（見第 3.1 節） | 推論：引擎不用帶，只多打包檔 333 KB | 已確認：`isInspectable` 設成 `true` 就能用 Safari 的 Web Inspector 看（iOS 16.4 起） | 本機實測：能，不用墊片，輸出跟 Node 逐位元組一樣 |
| 看不見的 `WKWebView` 當引擎 | 跟著 iOS 走 | 已確認：系統 framework，`callAsyncJavaScript` iOS 14.0 起 | 已確認：網頁內容那個程序拿得到 JIT 的 entitlement（WebKit 原始碼）。沒測 | 推論：引擎不用帶 | 已確認：`isInspectable` 一樣可用 | 沒測。推論：它就是 Safari 的引擎，現在的網頁就是這樣跑 |
| QuickJS、QuickJS-NG | QuickJS 2026-06-04；QuickJS-NG v0.18.0（2026-11-01） | 查不到 Apple 點名允許或禁止。QuickJS-NG 文件把 iOS 列為支援，備註「Limited testing」 | 沒有 JIT，是直譯器。前一份筆記在這台 Mac 量過：1.0 MB 的流程一步 23–52 毫秒 | 已確認：首頁寫「367 KiB of x86 code for a simple hello world program」。ADR 0013：伺服器執行檔多約 1.7 MB | 查不到官方的除錯器文件 | 不能：沒有 `Intl`，要補 `Intl.Segmenter` 墊片（伺服器已經這樣做） |
| Hermes | 跟著 React Native 發版。React Native 0.88.1（2026-10-27）用 `hermes-compiler` 260318099.0.5 | 查不到 Apple 點名。React Native 預設就用它 | 沒測。已確認：建置時先編成位元組碼；JIT 的建置選項預設是關 | 查不到官方的「app 多幾 MB」。Maven 上 iOS 的壓縮檔是 25.4 MB（含好幾個平台，不等於 app 增加的大小） | 已確認：React Native DevTools（用 Chrome DevTools 的前端） | 推論：不能。原始碼裡沒有 `Intl.Segmenter`；0.88.1 用的那一版也沒有 `toSorted`。沒測 |

### 其他重點

- **上架條文管的是「下載、安裝、執行會改功能的程式碼」**，沒有點名哪個引擎。原文在第 2 節：App Store Review Guidelines 2.5.2、4.7，和 Apple Developer Program License Agreement 3.3.1(B)。
- **流程核心現在的大小**：`src/lib/core/` 不含測試 45 個檔、8,459 行；測試 43 個檔、12,620 行。打包檔 333,085 位元組，指令表登記 54 個指令（本機實測）。ADR 0013 寫的「約 3,400 行、53 個指令」是當時「指令會用到的部分」，算法不一樣（第 1 節）。
- **傳資料的兩種做法都量了**（本機實測，第 4 節）：
  - 整份流程 JSON 進、整份出（伺服器現在的做法）：1.5 MB 的流程，`jsc` 關 JIT 一步 4.5–11.7 毫秒。
  - 流程留在引擎裡，只送指令進去、只拿改到的出來：拿回來的只有 48–63,937 個字，不是 150 萬字。但關 JIT 時一步 5.4–12.7 毫秒，沒有比較快，因為「比對改了什麼」是 JS 自己在算。
- **跨平台框架**（第 5 節）：
  - Flutter 3.50.1、Compose Multiplatform 1.12.2 的官方文件都只講通用的橋（platform channel、FFI、Objective-C 互通），沒有講怎麼在手機上跑一包 JS。Flutter 有第三方套件 `flutter_js`。
  - React Native 0.88.1 本身就用 Hermes 跑 JS，TypeScript 是預設語言。
- **改寫成別的語言**（第 6 節）：ADR 0013 已經比過 Rust 重寫和「Rust 編成 WebAssembly 給前端」，都沒選。這次補上 Swift、Rust、Kotlin 各自能到哪些平台的官方說法。
- **流程核心指紋**（第 7 節）：是打包檔的 SHA-256。只要 app 帶的是同一支 `scripts/core-bundle.mjs` 在同一個 commit 打出來的檔，指紋就一樣（推論）。伺服器更新流程核心後，舊 app 連雲端流程會收到「有新版」然後被斷線；網頁是重新整理，app 要等更新。

## 1. 流程核心現況（本專案）

查的是 commit `62c78dc`。

### 大小

兩組數字算法不同，不能直接比：

| 算法 | 檔數 | 行數 | 測試 | 指令數 | 出處 |
|---|---|---|---|---|---|
| 指令會用到的部分（從指令所在的檔順著執行時的 import 找） | 25 | 4,634 行（含註解），約 3,360 程式行 | 約 7,500 行 | 53 | `docs/research/run-ts-core-on-server.md` 第 6 節（2026-11-06）、ADR 0013 |
| 整個 `src/lib/core/` 資料夾（今天） | 45（不含測試） | 8,459 行（含註解），6,117 程式行 | 43 個檔、12,620 行 | 54（打包檔的 `COMMAND_NAMES`） | 本機實測，2026-11-20 |

- 「程式行」是去掉空行，以及 `//`、`/*`、`*` 開頭的行，跟前一份筆記同一個算法。
- 「指令會用到的部分」今天沒有重算。

### 打包檔（伺服器現在跑的那一包）

- `scripts/core-bundle.mjs` 用 rolldown 把 `src/lib/core/bundle-entry.ts` 打包成一個 IIFE 檔，全域變數叫 `flowCore`，`platform: 'neutral'`。
- 本機實測：打包檔 `flow-core.js` 是 333,085 位元組，`gzip -9` 之後 103,389 位元組。沒有 minify。
- `bundle-entry.ts` 除了把核心整個匯出，還多了「收 JSON 字串、回 JSON 字串」的版本：`runCommandsJson`、`runStepJson`、`remoteChangeJson`、`applyRemoteChangeJson`、`checkRecordsJson`、`uploadFlowJson`、`runUndoJson`。
- 伺服器（`server/src/flow_core.rs`）載入這包之前，先放一段 `Intl.Segmenter` 墊片，切字由 Rust 的 `unicode-segmentation` 做。

### 引擎要有的 JS 內建功能

本機用 grep 數 `src/lib/core/` 不含測試的檔：

| 用到的 | 處數 | 哪一版 ECMAScript |
|---|---|---|
| `Intl.Segmenter`（`text-length.ts` 的最上層就建立） | 1 | ECMA-402，不是 ECMAScript 本體 |
| `toSpliced` | 11 | ES2023 |
| `with` | 10 | ES2023 |
| `toSorted` | 5 | ES2023 |
| `findLast`、`findLastIndex` | 4、3 | ES2023 |
| `Array.prototype.at` | 7 | ES2022 |
| `Object.hasOwn` | 2 | ES2022 |

沒有用到 `structuredClone`、`crypto`、`Math.random`、`Date.now()`、`async`／`await`、`setTimeout`、`console`（本機 grep）。

## 2. App Store 的規定：在 app 裡跑、下載 JavaScript

### App Store Review Guidelines（頁尾寫「Last Updated: October 16, 2026」）

已確認，原文：

- **2.5.2**：「Apps should be self-contained in their bundles, and may not read or write data outside the designated container area, nor may they download, install, or execute code which introduces or changes features or functionality of the app, including other apps. Educational apps designed to teach, develop, or allow students to test executable code may, in limited circumstances, download code provided that such code is not used for other purposes. Such apps must make the source code provided by the app completely viewable and editable by the user.」
- **2.5.6**：「Apps that browse the web must use the appropriate WebKit framework and WebKit JavaScript. You may apply for an entitlement to use an alternative web browser engine in your app.」
- **4.7**：「Apps may offer certain software that is not embedded in the binary, specifically HTML5 and JavaScript mini apps and mini games, streaming games, chatbots, and plug-ins. Additionally, retro game console and PC emulator apps can offer to download games. You are responsible for all such software offered in your app, including ensuring that such software complies with these Guidelines and all applicable laws.」後面 4.7.1–4.7.5 是這類軟體的附加規則。

### Apple Developer Program License Agreement（頁尾寫主文和 Schedule 1「last updated October 29, 2026」）

已確認，3.3.1 的 B 小節「Executable Code」原文：

> Except as set forth in the next paragraph, an Application may not download or install executable code. Interpreted code may be downloaded to an Application but only so long as such code: (a) does not change the primary purpose of the Application by providing features or functionality that are inconsistent with the intended and advertised purpose of the Application (b) does not bypass signing, sandbox, or other security features of the OS; and (c) for Applications distributed on the App Store, does not create a store or storefront for other Applications.

### 這些條文沒寫的

- 查不到：條文沒有點名 JavaScriptCore、QuickJS、Hermes 任何一個引擎可以或不可以。
- 推論：流程核心打包檔如果跟 app 一起送審、包在 app 裡，就不是 2.5.2 說的「download」。2.5.6 管的是「browse the web」的 app，用引擎跑自己的規則不是瀏覽網頁。這兩句是我讀條文的理解，不是 Apple 的說法。
- 查不到：Apple 有沒有針對「app 自己下載新版的規則程式」給過明確說法。條文只有上面 (a)(b)(c) 三個條件，合不合由審查判斷。

## 3. 引擎

### 3.1 系統的 JavaScriptCore

**API（已確認，Apple 開發者文件）：**

- `JSContext`：「A JavaScript execution environment.」iOS 7.0 起。
- `evaluateScript(_:)`：「Evaluating a script runs any top-level code and adds function and object definitions to the context’s global object.」推論：打包檔是 IIFE、全域變數 `flowCore`，跑一次就能拿到。
- `JSValue`：字串、數字、`NSDictionary`、`NSArray` 會自動跟 JS 的值互轉；`call(withArguments:)` 可以呼叫 JS 函式。
- `exceptionHandler`：JS 丟例外時會叫這個 block。
- 執行緒，`JSVirtualMachine` 文件：「The JavaScriptCore API is thread-safe—for example, you can create JSValue objects or evaluate scripts from any thread—however, all other threads attempting to use the same virtual machine must wait. To run JavaScript concurrently on multiple threads, use a separate JSVirtualMachine instance for each thread.」

**除錯（已確認）：**

- `isInspectable`（iOS 16.4、macOS 13.3 起）：「Defaults to false. Set to true at any point in the context’s lifetime to allow Safari Web Inspector access to inspect the context. Then, select your context in Safari’s Develop menu for either your computer or an attached device to inspect it.」
- `JSContext.name`：「This name appears when using remote debugging to examine the context.」

**JIT（app 裡的 `JSContext` 有沒有 JIT）：**

- 已確認，WebKit 原始碼 `Source/JavaScriptCore/jit/ExecutableAllocator.cpp`（main 分支）：

  ```cpp
  NODELETE static bool isJITEnabled()
  {
      bool jitEnabled = !g_jscConfig.jitDisabled;
  #if HAVE(IOS_JIT_RESTRICTIONS)
      jitEnabled = jitEnabled && (processHasEntitlement("dynamic-codesigning"_s) || processHasEntitlement("com.apple.developer.cs.allow-jit"_s));
  ```

- 已確認，`Source/WTF/wtf/PlatformHave.h`：`HAVE_IOS_JIT_RESTRICTIONS` 定義在 `PLATFORM(IOS_FAMILY) && !PLATFORM(IOS_FAMILY_SIMULATOR) && !PLATFORM(MACCATALYST)`。也就是實機的 iOS、iPadOS；模擬器不算。
- 已確認，`Source/WebKit/Scripts/process-entitlements.sh`：這兩個 entitlement 是加在 WebKit 自己的網頁內容程序上（`ios_family_process_webcontent_entitlements`）。
- 已確認，Apple 的 BrowserEngineKit 文件（給另一種瀏覽器引擎用的）：
  - JIT 的 entitlement 只能給網頁內容那個 extension：「You can’t give this entitlement to your browser app, rendering extension, or networking extension.」
  - 不是瀏覽器、只是內嵌另一種引擎的 app：「It can’t include any web browser extensions or use just-in-time (JIT) compilation.」
  - Apple 的說明頁：「Apple will provide authorized developers access to technologies within the system that enable critical functionality and help developers offer high-performance modern browser engines. These technologies include just-in-time compilation, multiprocess support, and more.」
- 已確認，macOS 的 `com.apple.security.cs.allow-jit` 文件（只適用 macOS）：「Without the Allow execution of JIT-compiled code entitlement, frameworks that rely on just-in-time (JIT) compilation may fall back to an interpreter.」例子裡列了「The fast-path of the JavaScriptCore framework」。
- **推論**：一般上架的 app 沒有那兩個 entitlement，所以 app 裡的 `JSContext` 在實機上不開 JIT，用直譯器跑。
- **查不到**：Apple 文件裡沒有一句直接寫「app 裡的 JavaScriptCore 沒有 JIT」。上面是原始碼加 entitlement 文件拼起來的。

**引擎有哪些 JS 功能，看 iOS 版本：**

- 推論：系統 framework 跟著 iOS 更新，app 不能自己帶新版。
- 已確認，Safari 版本說明：
  - Safari 14.1（「Safari 14.1 ships with iOS & iPadOS 14.5 and macOS Big Sur 11.3.」）：「Added `Intl.Segmenter`.」（這幾個字是連到 tc39 提案的連結。）
  - Safari 15.4（iOS、iPadOS 15.4）：「Added `Object.hasOwn()`.」「Added `Array.prototype.findLast` and `Array.prototype.findLastIndex`.」「Added `Array.prototype.at`, `String.prototype.at`, and `TypedArray.prototype.at`.」
- 查不到：Apple 的 Safari 16 版本說明沒有列 `toSorted`、`toSpliced`、`with`。MDN 的 browser-compat-data（不是 Apple 的來源）寫這三個都是 Safari 16 起。
- 已確認：今天最新的 iOS、iPadOS 是 27.2.1（2026-11-09，Apple 開發者網站的 Releases 頁）。
- 本機實測：這台 Mac 的 JavaScriptCore（framework 版本 21624.5.1.11.3）不改、不加墊片就能載入打包檔，`charCount` 對家庭 emoji、國旗、加重音的 `e`、「小美」回 1、1、1、2。

**大小：** 推論：引擎是系統的，app 只多打包檔本身（333 KB，沒 minify）。

### 3.2 看不見的 WKWebView 當引擎

- 已確認，`WKWebView.callAsyncJavaScript(_:arguments:in:in:completionHandler:)`，iOS 14.0 起：「Executes the specified string as an asynchronous JavaScript function.」
  - 參數能傳的型別：「Supported value types are NSNumber, NSString, NSDate, NSArray, NSDictionary, or NSNull.」
  - 結果從 completion handler 回來，所以每一步都是非同步的。
- 已確認：JIT 的 entitlement 加在 WebKit 的網頁內容程序上（第 3.1 節的原始碼）。
- 推論：現在的網頁在 iPhone、iPad 的 Safari 裡就是這樣跑流程核心的；app 裡多的是「原生畫面 ↔ 網頁內容程序」這一段跨程序的傳遞。這一段多久，沒測。
- 已確認：`isInspectable` 在 `WKWebView` 上也有（WebKit 部落格〈Enabling the Inspection of Web Content in Apps〉）。

### 3.3 QuickJS、QuickJS-NG

- **版本（已確認）：**
  - QuickJS（bellard）：最新發布 2026-06-04，「It is 42% faster than the previous release based on the bench-v8 (aka v8-v7) score.」「It supports the ES2025 specification.」
  - QuickJS-NG：v0.18.0，2026-11-01。README 說它是原版的 fork。
- **平台（已確認）：** QuickJS-NG 的 Supported Platforms 表有 iOS，備註「Limited testing」。QuickJS 原版首頁沒有列平台。
- **`Intl`（已確認）：** QuickJS-NG：「Due to size constraints it is unlikely QuickJS will ever support the Intl APIs.」所以要補 `Intl.Segmenter`。
  - 伺服器的墊片是 Rust 切字。推論：app 裡要換成別的切字來源（例：Swift 字串本來就照看得到的字切），而它用的 Unicode 版本跟伺服器、瀏覽器可能不同。ADR 0013 已經寫過這個後果：極少數很新的 emoji，字數可能差一個。
  - 前一份筆記記過：bellard 的 master 在 2026-10-10 加了實驗性的 `Intl`，還沒進正式發布。今天最新發布仍是 2026-06-04（已確認），所以還是沒有。
- **速度：**
  - 已確認：首頁寫「Fast interpreter with very low startup time」「The complete life cycle of a runtime instance completes in less than 300 microseconds.」是直譯器，沒有 JIT。
  - 前一份筆記的本機實測（2026-11-06，同一種 Mac，rquickjs 0.14.0 內含 QuickJS-NG 0.16.2，從 Rust 呼叫）：98 KB 的流程一步 2.5–13.8 毫秒；1.0 MB 的流程一步 23–52 毫秒。這次沒有重量。
  - 查不到：QuickJS 在 iPhone、iPad 上的官方數字。
- **大小：**
  - 已確認：QuickJS 首頁「just a few C files, no external dependency, 367 KiB of x86 code for a simple hello world program」。
  - 已確認：QuickJS-NG v0.18.0 發布頁的命令列程式 `qjs-darwin-arm64` 是 1,360,336 位元組（含命令列和標準函式庫，不等於嵌進 app 的大小）。
  - ADR 0013：伺服器執行檔多約 1.7 MB。
- **除錯：** 查不到官方的除錯器或 Web Inspector 文件。
- **上架：** 查不到 Apple 點名。它是 C 原始碼，編進 app 的執行檔裡，不是下載來的程式（推論）。

### 3.4 Hermes

- **版本（已確認）：**
  - Hermes 自己的 GitHub Releases 最後一版是 v0.13.0（2024-08-16）。README：「each Hermes release is aimed at a specific RN version」。
  - 現在跟著 React Native 發：React Native 0.84（2026-02-11）起「Hermes V1 is now the default JavaScript engine for React Native on both iOS and Android」。
  - React Native 最新正式版 0.88.1（npm 的 `latest`；GitHub 發布於 2026-10-27）。0.89.0-rc.2（2026-11-18）還是預發布。
  - 0.88.1 的 `package.json` 依賴 `hermes-compiler` 260318099.0.5；`sdks/.hermesv1version` 寫 `hermes-v260318099.0.5`。這個 tag 的 commit 日期是 2026-10-22。
  - Hermes repo 的預設分支是 `static_h`。
- **怎麼跑（已確認）：** README：「It features ahead-of-time static optimization and compact bytecode.」React Native 文件：release 建置時「This will compile JavaScript to Hermes Bytecode during build time which will improve your app's startup speed on device.」
- **JIT（已確認＋推論）：** `CMakeLists.txt` 有 `set(HERMESVM_ALLOW_JIT 0 CACHE STRING "JIT mode: 0 (off), 1 (auto) or 2 (force on)")`，預設關。React Native 0.88.1 建 Apple framework 的腳本裡沒有設這個選項。推論：React Native 的 iOS 版沒開 JIT。
- **`Intl`（已確認）：**
  - Hermes 的功能文件（`static_h` 分支）：「**`Intl` API:** Not supported. A partial implementation exists for Android, which calls into Java platform APIs, and for Apple platforms, which use Foundation. It is not built by default (`HERMES_ENABLE_INTL` is `OFF`), so in a default build `Intl` is `undefined`.」又寫「**Use a polyfill such as FormatJS instead**, accepting its start-up cost.」
  - React Native 0.88.1 和 Hermes 自己建 Apple framework 的腳本都有 `-DHERMES_ENABLE_INTL:BOOLEAN=true`，所以 iOS 上那個「部分實作」是開的。
  - `lib/VM/JSLib/Intl.cpp`（`static_h` 和 0.88.1 用的 tag）裡找不到「Segmenter」這個字（0 處）。
  - 推論：流程核心一載入就會在 `new Intl.Segmenter(...)` 那一行失敗，跟 QuickJS 一樣要補。沒測。
- **ES2023 的陣列方法（已確認）：**
  - 功能文件（`static_h`）列了「`Array.prototype.toSorted` / `toReversed` / `with` / `toSpliced` (ES2023)」。
  - 但 0.88.1 用的 tag 裡，`include/hermes/VM/PredefinedStrings.def` 有 `toReversed`、`toSpliced`、`findLast`、`findLastIndex`、`hasOwn`，**沒有 `toSorted`**；`static_h` 最新的才有。
  - 推論：在 React Native 0.88.1 上，流程核心 5 處 `toSorted` 要補。沒測。
- **跟規格不一樣的地方（已確認，功能文件）：**
  - 區塊變數：「By default Hermes creates it once per function call instead.」例子是迴圈裡的 closure 預設得到 `[3, 3, 3]`，加 `-Xes6-block-scoping` 才是 `[0, 1, 2]`。
  - 「Temporal Dead Zone (TDZ) Checks」預設關。
  - 「Hermes **does not** currently provide a runtime ES module loader.」推論：IIFE 的打包檔不受影響。
  - React Native 0.88.1 的 Babel preset 預設會加 `@babel/plugin-transform-block-scoping`（除非開 `unstable_preserveBlockScoping`）。推論：走 React Native 自己的打包流程時，區塊變數由 Babel 先轉掉；直接把 `flow-core.js` 丟給 Hermes 則不會經過這一步。
  - 這些差別會不會讓流程核心算出不同結果，沒測。
- **大小：** 查不到官方的「app 多幾 MB」。已確認：Maven Central 上 `hermes-ios-260318099.0.5-hermes-ios-release.tar.gz` 是 25,383,472 位元組，裡面是好幾個 Apple 平台的 framework 壓在一起，不等於 app 增加的大小。
- **除錯（已確認）：** React Native 文件：「React Native DevTools is based on the Chrome DevTools frontend.」
- **不透過 React Native 單獨嵌 Hermes：** 已確認 `API/hermes/hermes.h` 有 `makeHermesRuntime`（C++，JSI 介面）。查不到官方「在 Swift app 裡單獨用 Hermes」的教學。

## 4. 原生畫面和引擎之間怎麼傳資料

### 現在已經有的兩種形狀

- **整份進、整份出**：伺服器現在就是這樣。`runCommandsJson(flow, commands, stepId)` 收流程的 JSON 字串、指令串的 JSON 字串、步驟 id，回結果的 JSON 字串。
- **只送改到的**：核心有 `remoteChange(before, after)`，算出「改之前、改之後差在哪」；伺服器用它（`remoteChangeJson`）算要送給房間裡其他人的改動。`applyRemoteChange(flow, change)` 把改動套回一份流程。
- 推論：原生畫面如果只拿改動，自己手上那份流程要有一個跟 `applyRemoteChange` 一樣的套法；現在這個套法只有 TypeScript 版。

### 本機實測：做法

1. `npm ci`，再跑 `node scripts/core-bundle.mjs <資料夾>`，得到伺服器用的同一包 `flow-core.js`。
2. 用流程核心自己的指令（`runCommands`）做兩份流程：
   - 小的：105,160 位元組（16 人、16 個動作、13 張站位、480 次紀錄）。
   - 大的：1,568,455 位元組（36 人、80 個動作、71 張站位、8,000 次紀錄）。
3. 四種一步：
   - `rename`：改流程名字（`renameFlow`）。
   - `record`：記一次（`recordAttempt`）。
   - `drag`：在一張站位上挪兩個人（`setPositions`）。
   - `insert`：先把段加長一個八拍，再在最前面插一個八拍（`updateSegment`＋`insertBeats`，同一步兩個指令）。
4. 每一種量三個時間，取中位數（小的 60 次、大的 15 次，前面先跑 3 次暖身）：
   - **整份進出**：`flowCore.runCommandsJson(流程字串, 指令字串, 步驟 id)`。
   - **留在引擎裡**：流程物件留在引擎裡不動；每一步 `JSON.parse` 指令 → `runCommands` → `remoteChange(舊, 新)` → `JSON.stringify` 改動。這一段是實測時另外寫的幾行，`bundle-entry.ts` 現在沒有這個函式。
   - **只跑指令**：`runCommands`，不比對、不轉 JSON。
5. 三種跑法：Node 26.13.0；系統的 `jsc`（JIT 開）；`jsc --useJIT=false`。`jsc` 在 `/System/Library/Frameworks/JavaScriptCore.framework/` 的 `Helpers` 裡。
6. 每種跑法把所有結果字串寫成一個檔，比 SHA-256。

### 本機實測：結果

**輸出一不一樣：** 三種跑法的結果檔 SHA-256 完全相同（16 個結果字串加一組切字檢查）。打包檔沒有改、沒有加墊片。

**載入打包檔：** Node 14.4 毫秒；`jsc` 12.8 毫秒；`jsc` 關 JIT 12.0 毫秒。

**每一步（毫秒）。每格三個數字是：整份進出／留在引擎裡／只跑指令。**

| 流程 | 一步 | Node 26（V8，有 JIT） | `jsc`（JIT 開） | `jsc --useJIT=false` | 整份出去多長 | 只拿改動多長 |
|---|---|---|---|---|---|---|
| 小（105 KB） | rename | 0.56／0.16／0.00 | 0.29／0.16／0.00 | 0.28／0.50／0.00 | 102,929 字 | 76 字 |
| 小 | record | 0.70／0.20／0.07 | 0.34／0.20／0.05 | 0.50／0.72／0.19 | 103,119 字 | 48 字 |
| 小 | drag | 0.57／0.12／0.00 | 0.29／0.15／0.00 | 0.31／0.54／0.01 | 102,920 字 | 180 字 |
| 小 | insert | 0.72／0.23／0.08 | 0.45／0.26／0.10 | 1.28／1.50／0.95 | 102,937 字 | 12,758 字 |
| 大（1.57 MB） | rename | 8.28／1.46／0.00 | 4.14／1.10／0.00 | 4.57／5.42／0.00 | 1,535,038 字 | 76 字 |
| 大 | record | 10.5／2.65／1.18 | 4.87／1.90／0.73 | 7.71／8.62／3.16 | 1,535,228 字 | 48 字 |
| 大 | drag | 8.52／1.32／0.01 | 3.86／1.08／0.00 | 4.47／5.51／0.02 | 1,535,029 字 | 180 字 |
| 大 | insert | 9.38／2.17／0.59 | 4.58／1.85／0.69 | 11.7／12.7／7.09 | 1,535,067 字 | 63,937 字 |

單看 JSON（大的流程）：`JSON.parse` Node 5.05、`jsc` 2.80、`jsc` 關 JIT 2.82 毫秒；`JSON.stringify` 3.40、1.24、1.50 毫秒。

**從數字看得到的：**

- 整份進出的時間幾乎都是 JSON 進出，關不關 JIT 差不多（JSON 是引擎內建的原生程式）。
- 「留在引擎裡」在有 JIT 時快 3–6 倍；關 JIT 時反而慢一點，因為比對整份流程是 JS 在跑。
- 「只跑指令」最快，大部分不到 1 毫秒；關 JIT 時 `insert` 7 毫秒、`record` 3 毫秒。
- 拿回來的資料量差很多：改動是 48–63,937 字，整份是 150 萬字。

**這組數字的限制：**

- 是 Mac（M3 Max），不是 iPhone、iPad。
- `jsc --useJIT=false` 只是用來靠近「app 裡沒有 JIT」的情況（第 3.1 節的推論），不等於實機。
- 量的是引擎裡面的時間。Swift 那邊把 150 萬字的 JSON 解成自己的資料、再畫到畫面上要多久，沒量。
- 只量了 4 種一步、2 份流程，不是全部 54 個指令。
- QuickJS 這次沒重量（數字見第 3.3 節）；Hermes 沒測，因為規定不能執行下載來的程式，也沒有裝工具鏈。

## 5. 跨平台的畫面框架怎麼接一份現成的 JS／TS

版本都是 2026-11-20 從官方發版來源查的正式版。

| | Flutter | React Native | Compose Multiplatform |
|---|---|---|---|
| 最新正式版 | 3.50.1（2026-11-20），Dart 3.14.0 | 0.88.1（2026-10-27） | 1.12.2（2026-10-15）；Kotlin 2.4.21（2026-10-08） |
| 畫面用什麼語言寫 | Dart | JavaScript／TypeScript | Kotlin |
| 官方文件怎麼講「接 JS」 | 沒有講手機上跑 JS。`dart:js_interop` 是給網頁的 | 本身就是跑 JS | 沒有講。只講跟 Swift／Objective-C 互通 |
| 官方的通用橋 | platform channel（非同步傳訊息）、`dart:ffi`（呼叫 C） | Turbo Native Module、JSI | Kotlin/Native 的 Objective-C 互通 |
| 跑這包要靠什麼 | 推論：自己接 JavaScriptCore（走 channel 或 FFI），或第三方 `flutter_js`，或官方的 `webview_flutter` | Hermes（React Native 內建） | 推論：Kotlin 直接叫系統的 JavaScriptCore，或由 Swift 那邊叫 |

### Flutter

- 已確認，JS 互通只在網頁：「The Dart web platform provides tools to call JavaScript from Dart and Dart from JavaScript」「Integrate JavaScript libraries and APIs into Dart web apps.」
- 已確認，platform channel：「messages and responses are passed asynchronously through channels to ensure the user interface remains responsive.」資料用 `StandardMessageCodec`：「supports efficient binary serialization of simple JSON-like values, such as booleans, numbers, Strings, byte buffers, Lists, and Maps.」
- 已確認，FFI：「Flutter mobile and desktop apps can use the dart:ffi library to call native C APIs.」
- 第三方（不是 Flutter 官方）：pub.dev 的 `flutter_js` 0.8.7（2026-01-27），說明寫「A Javascript engine to use with flutter. It uses Quickjs on Android and JavascriptCore on IOS」。沒測。
- 官方套件 `webview_flutter` 4.14.1（2026-07-07）：「A Flutter plugin that provides a WebView widget backed by the system webview.」
- 推論：Dart 這邊拿到的流程要嘛是 JSON 字串自己解，要嘛是 codec 轉過的 Map／List；每一步是非同步的。

### React Native

- 已確認：「Hermes is used by default by React Native and no additional configuration is required to enable it.」
- 已確認：「New React Native projects target TypeScript by default, but also support JavaScript and Flow.」
- 已確認，Metro 設定文件：專案根目錄以外的檔案要列進 `watchFolders`（「Directories of any files it depends on outside this root must be listed in watchFolders」）。
- 推論：流程核心可以當一般 TypeScript 模組被畫面程式直接 import，中間沒有橋、不用轉 JSON。沒測。
- 但第 3.4 節的兩件事會擋住：Hermes 沒有 `Intl.Segmenter`；0.88.1 帶的 Hermes 沒有 `toSorted`。
- 已確認，跟原生程式溝通：「The New Architecture removes the asynchronous bridge between JavaScript and native and replaces it with JavaScript Interface (JSI). JSI is an interface that allows JavaScript to hold a reference to a C++ object and vice-versa. With a memory reference, you can directly invoke methods without serialization costs.」
- 已確認：官方有「Integration with Existing Apps」，可以把 React Native 的畫面加進現有的原生 app。
- 推論：這條路的畫面不是 SwiftUI／UIKit 自己寫的，是 React Native 的元件畫成原生的 view。

### Compose Multiplatform

- 已確認，穩定度表（頁面日期 2025-09-10）：Compose Multiplatform 的 iOS 是「Stable」；Kotlin Multiplatform 核心的 iOS 也是「Stable」。
- 已確認：「Kotlin/Native provides indirect interoperability with Swift through Objective-C.」
- 已確認：Kotlin repo 裡有 `kotlin-native/platformLibs/src/platform/ios/JavaScriptCore.def`，內容是 `package = platform.JavaScriptCore`、`modules = JavaScriptCore`。推論：Kotlin/Native 的 iOS 程式可以直接叫 `JSContext`。沒測。
- 已確認：「Compose Multiplatform is interoperable with the SwiftUI framework. You can embed Compose Multiplatform within a SwiftUI application as well as embed native SwiftUI components within the Compose Multiplatform UI.」
- 查不到：官方文件沒有「在 iOS 上跑一包現成 JS」的做法。

## 6. 另一條路：把流程核心改寫成別的語言

### ADR 0013 已經寫下的

ADR 0013 比過這幾條，原文：

- 「**用 Rust 重寫規則**：伺服器全是 Rust、跑得快。可是要寫約 3,400 行程式和約 7,500 行測試，以後每改一條規則都要改兩份、一直對齊。」
- 「**規則用 Rust 寫一份，編成 WebAssembly 給前端用**：一樣只有一份。可是要先全部重寫，前端 41 個檔要改呼叫方式，建前端也要裝 Rust。」
- 選的是 QuickJS 跑同一份 TypeScript：「規則只有一份，前端和伺服器跑的是同一份，結果一定一樣。」

這些數字是 2026-11 上旬、只算「指令會用到的部分」。今天整個資料夾的大小在第 1 節。

### 各語言能到哪些地方（官方說法）

| 改寫成 | 到 iPhone、iPad | 到網頁 | 到現在的 Rust 伺服器 | 來源狀態 |
|---|---|---|---|---|
| Swift | 原生 | Swift 官方有 WebAssembly 的 SDK 教學（swift.org，網站顯示目前版本 6.4.2） | 查不到 Rust 直接用 Swift 程式的官方做法 | 已確認／查不到 |
| Rust | UniFFI 0.32.2（2026-09-23）會產生 Swift 的綁定 | `wasm-bindgen` 0.2.130（2026-10-30）；ADR 0013 寫過這條的代價 | 直接用 | 已確認 |
| Kotlin | Kotlin/Native，iOS「Stable」 | Kotlin/JS「Stable」：「lets you transpile your Kotlin code, the Kotlin standard library, and any compatible dependencies to JavaScript」 | 推論：伺服器要嘛繼續用 QuickJS 跑 Kotlin 轉出來的 JS，要嘛另想辦法 | 已確認＋推論 |

- 已確認，UniFFI：「UniFFI is a tool that automatically generates foreign-language bindings targeting Rust libraries.」「Note that this tool will not help you ship a Rust library to these platforms, but it will help you avoid writing bindings code by hand.」
- 推論：不管改寫成哪一種，網頁現在直接 import TypeScript 的地方都要改（ADR 0013 數過是 41 個檔），或者留著 TypeScript 版，變成兩份規則。
- 推論：改寫後「同樣的輸入、同樣的結果」要重新證明。現在的證明方式是伺服器測試拿 QuickJS 和 Node 的輸出逐位元組比（`docs/deploy.md`）。
- 查不到：有人把這種大小的 TypeScript 規則改寫成 Swift 或 Kotlin 要花多少工的官方或一手數字。

### 伺服器現在用 QuickJS 跑同一份，會怎樣

- 如果 app 也跑同一包 JS：伺服器不用動，三邊（網頁、伺服器、app）是同一包。
- 如果改寫成 Rust：伺服器可以不用 QuickJS，但網頁要改用 WebAssembly 或留 TypeScript 版（ADR 0013 的兩條）。
- 如果改寫成 Swift 或 Kotlin 只給 app 用：伺服器和網頁照舊跑 TypeScript，app 是第二份規則（推論）。

## 7. 流程核心指紋：app 這邊怎麼對

### 現在怎麼算、怎麼比（本專案原始碼）

- `scripts/core-bundle.mjs`：指紋是打包結果那串程式碼的 SHA-256（十六進位 64 個字）。
- 網頁：`vite.config.ts` 建置時叫同一支算，放進 `__CORE_FINGERPRINT__`；`src/lib/core-fingerprint.ts` 匯出 `CORE_FINGERPRINT`。
- 伺服器：`server/build.rs` 叫同一支，把 `flow-core.js` 和 `flow-core.fingerprint` 編進程式。它盯著 `src/lib/core`、`scripts/core-bundle.mjs`、`package-lock.json` 三樣，有變就重打包。
- 比對只在連雲端流程的房間時做：前端連上後送 `{ kind: 'hello', fingerprint: CORE_FINGERPRINT, … }`（`src/lib/cloud-steps.svelte.ts`）；伺服器 `server/src/flow_room.rs` 發現不一樣就回 `NewVersion`，然後結束這條連線。
- `src/lib/core-fingerprint.test.ts` 測三件事：前端帶的跟打包算出來的一樣；核心改一行指紋就變；同樣的程式打包兩次指紋一樣。
- 本機實測：在乾淨的工作目錄 `npm ci` 後打包 commit `62c78dc`，指紋是 `626a50ff…d80442`。

### 指紋實際上綁的是什麼

- 已確認（原始碼）：它是 rolldown 輸出的位元組的雜湊，不是 TypeScript 原始碼的雜湊。
- 推論：所以它也跟 rolldown 的版本有關（`package-lock.json` 鎖住）。同一個 commit、同一份 lockfile 打出來才會一樣。

### app 這邊（推論，除非另外標示）

- app 建置時跑同一支 `scripts/core-bundle.mjs`，把 `flow-core.js` 和指紋一起包進 app，指紋就跟同一個 commit 的網頁、伺服器一樣。跑的位元組也是算指紋的那些位元組。
- 如果 app 的工具鏈會把核心重新打包或先編譯（例：React Native 的 Metro 加 Babel、Hermes 的位元組碼），實際跑的就不是算指紋的那些位元組。指紋還是可以由同一支腳本算了帶著，但它證明的是「同一份來源」，不是「同一包位元組」。
- 如果規則改寫成別的語言，就沒有這包 JS 可以算指紋，要另外定一個比對版本的辦法。
- 伺服器每次部署只要流程核心有變，指紋就變。還沒更新的 app 連雲端流程會收到 `NewVersion` 被斷線（已確認是伺服器現在的行為）。本機流程不經過這個比對。
- 網頁的解法是請人重新整理（`docs/deploy.md`）。app 要等使用者裝到新版。
- 已確認，App Review 頁：「App Review works around the clock, typically reviewing at least 50% of submissions in less than 24 hours and 90% in less than 48 hours.」
- 「app 自己下載新的打包檔」受第 2 節的條文管：Guidelines 2.5.2，和 License Agreement 3.3.1(B) 的 (a)(b)(c)。合不合由 Apple 審查判斷，查不到針對這種情況的明確說法。
- 地圖的「Not yet specified」已經列了「app 比伺服器舊時怎麼辦」，這裡只提供事實。

## 沒查到、沒確認的

- **實機的速度。** 沒有任何 iPhone、iPad 上的數字。這台 Mac 沒有 Xcode。
- **app 裡的 `JSContext` 沒有 JIT。** 是從 WebKit 原始碼和 entitlement 文件推的，Apple 文件沒有直接寫。
- **Hermes 全部沒實測。** 「沒有 `Intl.Segmenter`」「0.88.1 那版沒有 `toSorted`」是讀原始碼得來的；區塊變數的差別會不會影響結果沒驗證。
- **QuickJS 在 iOS 上。** 只有 QuickJS-NG 文件的「Limited testing」。沒有官方速度數字，沒找到除錯器文件。
- **Hermes 讓 app 多幾 MB。** 沒有官方數字。
- **`toSorted`、`toSpliced`、`with` 在哪一版 iOS 開始有。** Apple 的版本說明沒列；Safari 16 是 MDN 資料的說法。
- **Swift 那邊解 JSON、更新畫面的成本。** 沒量。
- **`WKWebView` 當引擎時跨程序傳 1.5 MB 的成本。** 沒量。
- **React Native 直接 import 流程核心。** 沒試。
- **Kotlin/Native 叫 JavaScriptCore、`flutter_js`。** 沒試。
- **Flutter、Compose Multiplatform 官方「在手機上跑 JS」的做法。** 沒找到，官方只有通用的橋。
- **Apple 對「下載新版規則程式」的明確態度。** 沒找到，只有條文。
- **改寫成 Swift／Kotlin 的工作量。** 沒有一手數字；今天也沒有重算「指令會用到的部分」。
- **各框架最低支援哪一版 iOS。** 沒查，不在這張票的範圍。

## 來源（查於 2026-11-20）

### 本專案

- `docs/adr/0013-server-runs-ts-core-in-quickjs.md`、`docs/research/run-ts-core-on-server.md`、`docs/deploy.md`
- `scripts/core-bundle.mjs`、`src/lib/core/bundle-entry.ts`、`src/lib/core-fingerprint.ts`、`src/lib/core-fingerprint.test.ts`、`vite.config.ts`
- `server/build.rs`、`server/src/flow_core.rs`、`server/src/flow_room.rs`、`src/lib/cloud-steps.svelte.ts`

### Apple

- App Store Review Guidelines：https://developer.apple.com/app-store/review/guidelines/
- Apple Developer Program License Agreement：https://developer.apple.com/support/terms/apple-developer-program-license-agreement/
- App Review：https://developer.apple.com/distribute/app-review/
- Releases（iOS、Xcode 版本）：https://developer.apple.com/news/releases/
- JavaScriptCore 文件（讀的是文件頁背後的資料 JSON）：
  - https://developer.apple.com/documentation/javascriptcore
  - https://developer.apple.com/documentation/javascriptcore/jscontext
  - https://developer.apple.com/documentation/javascriptcore/jscontext/evaluatescript(_:)
  - https://developer.apple.com/documentation/javascriptcore/jscontext/exceptionhandler
  - https://developer.apple.com/documentation/javascriptcore/jscontext/isinspectable
  - https://developer.apple.com/documentation/javascriptcore/jscontext/name
  - https://developer.apple.com/documentation/javascriptcore/jsvalue
  - https://developer.apple.com/documentation/javascriptcore/jsvalue/call(witharguments:)
  - https://developer.apple.com/documentation/javascriptcore/jsvirtualmachine
- WKWebView：https://developer.apple.com/documentation/webkit/wkwebview/callasyncjavascript(_:arguments:in:in:completionhandler:)
- JIT 和 entitlement：
  - https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit
  - https://developer.apple.com/documentation/browserenginekit/creating-browser-extensions-in-xcode
  - https://developer.apple.com/documentation/browserenginekit/protecting-code-compiled-just-in-time
  - https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.embedded-web-browser-engine
  - https://developer.apple.com/support/alternative-browser-engines/
- Safari 版本說明：
  - https://developer.apple.com/documentation/safari-release-notes/safari-14_1-release-notes
  - https://developer.apple.com/documentation/safari-release-notes/safari-15_4-release-notes
  - https://developer.apple.com/documentation/safari-release-notes/safari-16-release-notes

### WebKit

- https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/jit/ExecutableAllocator.cpp
- https://github.com/WebKit/WebKit/blob/main/Source/WTF/wtf/PlatformHave.h
- https://github.com/WebKit/WebKit/blob/main/Source/WebKit/Scripts/process-entitlements.sh
- https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/OptionsList.h
- https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/
- 不是 Apple 的來源：MDN browser-compat-data，https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Array.json

### QuickJS

- https://bellard.org/quickjs/ ，https://bellard.org/quickjs/Changelog
- https://github.com/quickjs-ng/quickjs/releases/tag/v0.18.0
- https://github.com/quickjs-ng/quickjs/blob/master/docs/docs/es_features.md
- https://github.com/quickjs-ng/quickjs/blob/master/docs/docs/supported_platforms.md
- https://github.com/quickjs-ng/quickjs/blob/master/README.md

### Hermes 和 React Native

- https://github.com/facebook/hermes （預設分支 `static_h`；Releases：https://github.com/facebook/hermes/releases ）
- https://github.com/facebook/hermes/blob/static_h/doc/Features.md
- https://github.com/facebook/hermes/blob/static_h/doc/IntlAPIs.md
- https://github.com/facebook/hermes/blob/static_h/CMakeLists.txt
- https://github.com/facebook/hermes/blob/static_h/utils/build-apple-framework.sh
- https://github.com/facebook/hermes/blob/static_h/API/hermes/hermes.h
- tag `hermes-v260318099.0.5` 的 `lib/VM/JSLib/Intl.cpp`、`lib/VM/JSLib/Array.cpp`、`include/hermes/VM/PredefinedStrings.def`、`CMakeLists.txt`：https://github.com/facebook/hermes/tree/hermes-v260318099.0.5
- https://registry.npmjs.org/react-native/latest
- https://api.github.com/repos/facebook/react-native/releases
- React Native 0.88.1 的 `packages/react-native/package.json`、`sdks/.hermesv1version`、`sdks/hermes-engine/utils/build-apple-framework.sh`、`packages/react-native-babel-preset/src/configs/main.js`：https://github.com/facebook/react-native/tree/v0.88.1
- https://reactnative.dev/blog/2026/02/11/react-native-0.84
- https://reactnative.dev/docs/hermes
- https://reactnative.dev/docs/typescript
- https://reactnative.dev/docs/react-native-devtools
- https://reactnative.dev/docs/turbo-native-modules-introduction
- https://reactnative.dev/docs/integration-with-existing-apps
- https://reactnative.dev/architecture/landing-page
- https://reactnative.dev/versions
- https://github.com/facebook/metro/blob/main/docs/Configuration.md
- https://repo1.maven.org/maven2/com/facebook/hermes/hermes-ios/260318099.0.5/

### Flutter 和 Dart

- https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json
- https://docs.flutter.dev/platform-integration/platform-channels
- https://docs.flutter.dev/platform-integration/ios/c-interop
- https://dart.dev/interop/js-interop
- https://pub.dev/packages/flutter_js （第三方；資料來自 https://pub.dev/api/packages/flutter_js ）
- https://pub.dev/packages/webview_flutter （資料來自 https://pub.dev/api/packages/webview_flutter ）

### Kotlin 和 Compose Multiplatform

- https://github.com/JetBrains/compose-multiplatform/releases/tag/v1.12.2
- https://github.com/JetBrains/kotlin/releases/tag/v2.4.21
- https://kotlinlang.org/docs/multiplatform/supported-platforms.html
- https://kotlinlang.org/docs/multiplatform/compose-swiftui-integration.html
- https://kotlinlang.org/docs/native-objc-interop.html
- https://kotlinlang.org/docs/native-platform-libs.html
- https://github.com/JetBrains/kotlin/blob/master/kotlin-native/platformLibs/src/platform/ios/JavaScriptCore.def
- https://kotlinlang.org/docs/js-overview.html

### 改寫用的工具

- https://mozilla.github.io/uniffi-rs/latest/ ，https://crates.io/api/v1/crates/uniffi
- https://crates.io/api/v1/crates/wasm-bindgen
- https://www.swift.org/documentation/articles/wasm-getting-started.html
