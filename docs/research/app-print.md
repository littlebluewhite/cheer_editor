# app 裡的網頁能不能印八拍表、殼要做什麼

Issue #334（地圖 #292）。查核日期 2026-11-22。
範圍：八拍表在 iPhone、iPad app 裡怎麼印、怎麼存成 PDF。app 的做法照 #301：畫面是現在的網頁，包在 app 裡（WKWebView），外面套自己用 Swift 寫的殼，最低 iOS／iPadOS 18.4。
#339（八拍表、輸出影片、使用說明在 app 裡怎麼辦）等這份筆記；要不要能存成 PDF、網頁和殼怎麼接，歸 #339，這裡不談。

只整理事實，不說該選哪一條路。

標記方式跟 `app-webview-shell.md` 一樣：

- **已確認**：有一手來源的原文。方括號是來源代號，見文末「來源」。
- **原始碼**：WebKit 原始碼在某個 tag 寫的內容。程式碼怎麼寫是已確認的；Apple 出貨的 iOS 是不是照這份編，查不到。所以從原始碼推出來的行為一律算推論。
- **推論**：我自己推的，沒有一手來源直接寫。
- **查不到**：找過，沒有一手來源。
- **未確認**：有人這樣寫（bug 裡的使用者回報），沒有第二個來源，也沒實測。

這台 Mac 只有 Command Line Tools，沒有 Xcode 和模擬器。**這份筆記沒有任何一項在真機上跑過。**

## 結論（事實）

1. **殼沒接的話，app 裡按「列印」什麼都不會發生（原始碼，推論）。** 不跳畫面、不丟錯誤、主控台沒訊息，`beforeprint`、`afterprint` 也不觸發。WebKit 只把 `window.print()` 交給兩個私有方法（`_webView:printFrame:` 那兩個）；app 沒實作，就直接當作印完 [SRC-UID]。公開的 `WKUIDelegate` 沒有列印 [APPLE-UIDELEGATE]，私有方法 Apple 的合約不准用 [DPLA]。18.3、18.5、27.2 三個 tag 寫法一樣（1.1）。
2. **殼能用的公開做法：網頁經過橋請殼印，殼用 `UIPrintInteractionController` 叫出系統的列印畫面，內容給 `webView.viewPrintFormatter()`。** `UIPrintInteractionController`、`UIViewPrintFormatter` 是 iOS 4.2 起就有 [APPLE-PIC] [APPLE-VPF]（`viewPrintFormatter()` 的文件頁沒寫版本），18.4 能用。Apple 文件沒寫 WKWebView 的 `viewPrintFormatter()` 能用（查不到）；原始碼裡 WKWebView 回傳 WebKit 自己的 `_WKWebViewPrintFormatter`，WebKit 自己的測試也這樣用 [SRC-FMT] [SRC-TEST]（2.2）。
3. **走這條路，`@media print` 算數（原始碼，推論）。** WebKit 排版時把媒體類型換成 `print`，也會發 `beforeprint`、`afterprint` [SRC-PRINTMODE]。版面寬度是紙的寬度，不是手機螢幕的寬度（2.3）。
4. **背景色預設不印。** `WKPreferences.shouldPrintBackgrounds`（iOS 16.4 起）預設 `false` [APPLE-BG]。寫了 `print-color-adjust: exact` 的照樣印 [SRC-BG]。八拍表表頭（`th`）的淺灰底沒寫 `exact`，app 裡會印成白底（推論，2.4）。
5. **⌘P 要殼自己接。** `Info.plist` 加 `UIApplicationSupportsPrintCommand`，按 ⌘P 時系統才會呼叫 `printContent(_:)`（iOS 15 起）[APPLE-PRINTCMD]。WebKit 的 iOS 程式沒有實作 `printContent`（只找了三個檔）[SRC-KEY]。所以沒接時 ⌘P 沒反應（推論，2.5）。
6. **印、存成 PDF、存進「檔案」、傳給別人，系統的列印畫面本身就有一顆「分享」鍵。** Apple 的說明（日記 App，iOS 18 起）寫：在列印選項畫面點「分享」，可以把 PDF 存進「檔案」，或交給「訊息」等 App [SUP-JOURNAL] [SUP-JOURNAL-GUIDE]。我們的殼叫出來的列印畫面有沒有這顆鍵，推論有；開發者文件查不到，要真機驗（第 3 節）。
7. **要在八拍表上另外放一顆「存成 PDF」，殼得自己畫 PDF，這條路有兩件事查不到**：公開介面設不了紙張大小（`paperRect` 只能讀）[APPLE-UPPR]；WebKit 在「不是最高畫質」時改畫點陣圖，每頁最長邊 500 像素，殼自己畫時是哪一種，查不到 [SRC-FMT] [SRC-SPI]（第 3 節）。
8. **`WKWebView.createPDF` 不是列印。** 它照螢幕的樣子拍一張長圖，不換成列印模式，`@media print` 不算，也不照紙張分頁（每 200 吋切一頁）[SRC-PDF]。Apple 文件沒寫這些（查不到，2.6）。
9. **跟下載的坑像，但這次查得到「沒接會怎樣」**：下載沒接 `WKDownloadDelegate` 會怎樣查不到（`app-webview-shell.md`）；列印沒接，原始碼寫明是直接當作印完（第 1 項）。

## 先講幾個詞

- **列印畫面**：iOS 系統的列印選項畫面（選印表機、份數、頁數）。app 用 `UIPrintInteractionController` 叫出來。
- **print formatter**：把一個畫面的內容排成一頁一頁、交給列印畫面的物件。WKWebView 的就是 `viewPrintFormatter()` 拿到的那個。
- **私有方法**：Apple 沒公開的介面，名字通常是底線開頭。Apple 的合約寫 app「must not use or call any private APIs」[DPLA]。
- **橋**：網頁和殼互傳訊息的管道（`window.webkit.messageHandlers`），見 `app-webview-shell.md` 第 5 節。

## 0. 查的當天的版本

| 東西 | 版本 | 發布日 | 讀的 WebKit tag | 來源 |
|---|---|---|---|---|
| Safari、WKWebView 18.3 | 20620.2.4 | 2025-01-27 | `WebKit-7620.2.4` | [SAF-NOTES] |
| 18.4（app 最低版本） | 20621.1.15 | 2025-03-31 | **沒有這一版的 tag** | [SAF-NOTES] |
| 18.5 | 20621.2.5 | 2025-05-12 | `WebKit-7621.2.5.10.1` | [SAF-NOTES] |
| 27.2（正式版） | 20625.2.8 | 2026-10-26 | `WebKit-7625.2.8` | [SAF-NOTES] |
| 27.3 beta | 20626.1.17 | 2026-11-16 | 沒讀 | [SAF-NOTES] |

- 版本號是 Apple 的 Safari 版本說明開頭寫的，例：「18.4 (20621.1.15)」[SAF-NOTES]。說明開頭寫它也管 WKWebView（`app-webview-shell.md` 第 0 節）。
- tag 是從 WebKit 的 GitHub 列出來的。用數字對 tag（`620.2.4` 對 `WebKit-7620.2.4`）是推論。
- 18.4 的 `621.1.15` 沒有 tag：`WebKit-7621.1` 開頭的只有 `WebKit-7621.1.2`。所以讀了前一版 18.3 和後一版 18.5。文末「來源」列為「對過」的段落，兩版都跟 27.2 寫法一樣（只差變數名字），推論 18.4 也一樣。其他段落只讀了 27.2。
- 27.2 的 tag 跟 `app-webview-shell.md` 讀的是同一個。

## 1. 殼沒接，`window.print()` 會怎樣

### 1.1 原始碼怎麼走

tag `WebKit-7625.2.8`。`WebKit-7620.2.4`、`WebKit-7621.2.5.10.1` 的同一段寫法一樣。

1. `LocalDOMWindow::print()` [SRC-DOMWIN]：
   - 頁面正在離開（unload）：主控台寫「Use of window.print is not allowed while unloading a page.」，不印。
   - 頁面還在載入：先記著，載完再印（1.3）。
   - 其他情況交給 `Chrome::print`。
2. `Chrome::print` [SRC-CHROME]：在沒有 `allow-modals` 的 sandbox iframe 裡，寫錯誤訊息、不印。八拍表不在 iframe 裡（推論：看了 `PrintSheet.svelte`、`+page.svelte`）。
3. `WebChromeClient::print` [SRC-WCC]：送 `PrintFrame` 給 app 那一端，**等它回話**才往下跑。訊息定義寫 `Synchronous`。
4. `WebPageProxy::printFrame` 交給 UI client [SRC-WPP]。
5. `UIDelegate::UIClient::printFrame` [SRC-UID]。這段沒有包在平台的 `#if` 裡，iOS、Mac 共用：
   - 只會呼叫 `_webView:printFrame:pdfFirstPageSize:completionHandler:` 或 `_webView:printFrame:`。兩個都宣告在 `WKUIDelegatePrivate.h`，是私有方法。
   - delegate 沒實作這兩個：直接呼叫 completion，當作印完。
   - 沒設 `uiDelegate`：`WKWebView.mm` 裡只有 `setUIDelegate:` 會換上這個 UI client（只找了這個檔）；沒換時用預設的 `API::UIClient`，它的 `printFrame` 也是直接呼叫 completion。
6. 收尾：`WebPageProxy::endPrinting` 看到沒在列印模式，直接回 [SRC-WPP]。`beforeprint`、`afterprint` 只在真的開始排版時才發（2.3），這條路沒走到 [SRC-PRINTMODE]。

合起來（推論，要真機驗）：

- 按了「列印」沒反應、不報錯，`window.print()` 正常回來，`beforeprint`、`afterprint` 都沒有。
- 沒設 `uiDelegate`、設了但沒實作私有方法，結果一樣。

### 1.2 為什麼殼不能直接接 `window.print()`

- Apple 文件裡 `WKUIDelegate` 的方法：開關視窗、alert／confirm／prompt、選檔、長按選單、編輯選單、權限 [APPLE-UIDELEGATE]。**沒有列印。**
- 那兩個私有方法，WebKit 2014 年的 bug 標題就寫是 SPI（給 Apple 自己用的介面）：「[iOS] Expose _WKWebViewPrintFormatter and -_webView:printFrame: as SPI」[WK-133600]。
- Safari 怎麼接 `window.print()`：Safari 不開源，查不到。

### 1.3 頁面還在載入時，`window.print()` 會延後

- 原始碼：`activeDocumentLoader()` 還在載入時不印，記著，載完再印 [SRC-DOMWIN]。
- 2014 年的 bug：一個長輪詢的 `XMLHttpRequest` 沒回來，列印畫面就等到它回來才出現 [WK-136335]。
- 2026-11-06 改了（commit `e4c679f46645`，325938@main）。修改說明：「Once the load event has fired we will no longer defer prints even if we are waiting for subresources.」[WK-136335]。這個修改不在 27.2 的 tag 裡；哪一版 Safari 開始帶，查不到。
- 這條在 Safari 分頁也一樣（同一份程式碼）。app 裡如果殼改用橋叫列印（第 2 節），就不經過這段（推論）。

### 1.4 旁證：加到主畫面的網頁 App（未確認）

- 2026-09、2026-10 有兩張 bug：iOS／iPadOS 27.0 上，從主畫面打開的網頁 App 呼叫 `window.print()` 沒反應、不丟錯誤、`beforeprint`／`afterprint` 都沒觸發；同一頁在 Safari 分頁能印 [WK-325259] [WK-327504]。
- WebKit 的人回：「This has been determined to be an issue outside WebKit, and will continue to be tracked by Apple internally.」[WK-327504]。另一張回「an issue in web app support code outside WebKit」[WK-325259]。
- 這講的是主畫面網頁 App，不是 app 裡的 WKWebView。寫的現象跟 1.1 從原始碼推的一樣。兩張都是使用者回報，沒實測。
- 網頁現在會在 iPhone、iPad 的 Safari 記成功率之後，提醒加到主畫面（`HomeScreenHint.svelte` 開頭的註解）。照這兩張 bug，iOS 27 上從主畫面打開的人可能也印不了八拍表（推論，未確認）。

## 2. 殼要接：Apple 給的做法

### 2.1 公開介面

| 介面 | 做什麼 | 最低版本 | 來源 |
|---|---|---|---|
| `WKScriptMessageHandler`、`WKUserScript` | 網頁叫殼（橋） | `WKUserScript` iOS 8；`WKScriptMessageHandler` 的文件頁沒寫版本 | [APPLE-BRIDGE] |
| `UIPrintInteractionController` | 系統列印畫面：`shared`、`printFormatter`、`printPageRenderer`、`printingItem(s)`、`isPrintingAvailable` | iOS 4.2 | [APPLE-PIC] |
| `UIView.viewPrintFormatter()` | 拿一個畫面的 print formatter | 文件頁沒寫版本；`UIViewPrintFormatter` 是 4.2 | [APPLE-VPF] |
| `printContent(_:)`、`UIApplicationSupportsPrintCommand` | ⌘P | iOS 15 | [APPLE-PRINTCMD] |
| `WKPreferences.shouldPrintBackgrounds` | 印不印背景 | iOS 16.4 | [APPLE-BG] |
| `UIPrintPageRenderer`、`UIGraphicsPDFRenderer` | 自己排頁、自己畫 PDF | 4.2；10 | [APPLE-UPPR] [APPLE-PDFR] |
| `UIActivityViewController`、`UIActivity.ActivityType.print` | 分享選單；選單裡的「列印」 | iOS 6 | [APPLE-ACT] |
| `UIDocumentPickerViewController(forExporting:asCopy:)` | 讓人選地方存檔（含「檔案」） | iOS 14 | [APPLE-DOCPICK] |
| `WKWebView.createPDF(configuration:completionHandler:)` | 把網頁拍成 PDF（不是列印，見 2.6） | iOS 14；`async` 版 `pdf(configuration:)` 15 | [APPLE-WKWEBVIEW] |

用不到的：

- `WKWebView.printOperation(with:)`：只有 macOS [APPLE-WKWEBVIEW]。標頭檔包在 `#if !TARGET_OS_IPHONE` 裡 [SRC-PUBH]。
- SwiftUI 的 `WebPage` 能轉成 PDF，但 iOS 26 起才有 [APPLE-WEBPAGE]，比 18.4 新。它是不是照 `@media print` 分頁，沒查。
- 第 1 節的兩個私有方法。

表上其他的 18.4 都有。

### 2.2 叫出列印畫面

Apple 文件寫的（已確認）：

- `UIPrintInteractionController` 有四個互斥的內容來源：`printingItem`、`printingItems`、`printFormatter`、`printPageRenderer` [APPLE-PIC]。
- 列印畫面讓人選印表機、份數、頁數範圍、單雙面 [APPLE-PIC]。
- iPhone 用 `present(animated:completionHandler:)`。在 iPad 上用它，畫面「animate from the window frame」[APPLE-PIC]。
- iPad 要從某個按鈕跳出小視窗：`present(from:in:animated:completionHandler:)`（給一個矩形和一個畫面），或 `present(from:animated:completionHandler:)`（給工具列按鈕）[APPLE-PIC]。
- `UIViewPrintFormatter` 的說明只列 `UIWebView`、`UITextView`、`MKMapView` 三種會給能用的 formatter，**沒有列 WKWebView** [APPLE-VPF]。
- 設計指引：沒東西可印、沒有印表機時，把列印的動作拿掉或變灰 [APPLE-HIG]。

原始碼：

- WKWebView 覆寫 `_printFormatterClass`，回傳 `_WKWebViewPrintFormatter`（`UIViewPrintFormatter` 的子類別，標頭寫 `ios(8.0)`）[SRC-FMT]。三個 tag 都有。
- WebKit 自己的測試用 `[webView viewPrintFormatter]` 配 `UIPrintPageRenderer`、`UIPrintInteractionController` 產生 PDF [SRC-TEST]。

推論：網頁的「列印」鍵在 app 裡改成經過橋請殼印；殼把 `webView.viewPrintFormatter()` 給 `UIPrintInteractionController.shared.printFormatter`，iPhone 用 `present(animated:)`，iPad 從按鈕的位置跳出。`PrintSheet.svelte` 已經有一個 `print` 參數（預設 `() => window.print()`），可以從外面換掉。怎麼做歸 #339。

### 2.3 `@media print` 算不算

原始碼（三個 tag 都一樣）[SRC-FMT] [SRC-PRINTMODE]：

1. 列印畫面要頁數時，`_WKWebViewPrintFormatter` 呼叫 `WKContentView` 的 `_wk_pageCountForPrintFormatter:`，它再請網頁那一端 `computePagesForPrintingiOS`。
2. 網頁那一端 `beginPrinting`：建 `PrintContext`、發 `beforeprint`、`PrintContext::begin(紙寬, 紙高)`。
3. `PrintContext::begin` 呼叫 `LocalFrame::setPrinting(true, …)`，它再呼叫 `LocalFrameView::adjustMediaTypeForPrinting(true)`：媒體類型改成 `print`。
4. 畫完 `endPrinting`：清掉 `PrintContext`、發 `afterprint`。

所以（推論，要真機驗）：

- `@media print` 算數。`+page.svelte` 的 `.print-hidden { display: none }`、`PrintSheet.svelte` 的 `.toolbar { display: none }` 會生效，只印那張表。
- 排版寬度是紙張扣掉邊界的寬度，不是手機螢幕的寬度。`PrintSheet.svelte` 裡 `@media screen and (max-width: 700px)` 的「手機一個八拍一張卡」不會套到紙上。
- `break-before: page`、`break-inside: avoid` 交給同一個 `PrintContext` 分頁。Safari 分頁按列印是不是走同一個 `PrintContext`，Safari 不開源，查不到。

預覽和真的印，畫法不一樣（原始碼）[SRC-FMT] [SRC-SPI]：

- `_WKWebViewPrintFormatter` 在要求的畫質不是 best 時，畫點陣圖，每頁最長邊 500 像素（`maximumPrintPreviewDimensionSize = 500.0`）；best 時畫 PDF。
- 「要求的畫質」是 `UIPrintPageRenderer` 的私有屬性 `requestedRenderingQuality`（WebKit 在 `UIKitSPI.h` 自己宣告）。

Safari 版本說明裡跟這有關的 [SAF-NOTES]：

- 26.1：「Fixed `@media print` styles to work when used inside a nested rule.」`src/` 裡找得到的 12 個 `@media print`（11 個檔，含 `app.css`、`EightCountCueLine.svelte`）都寫在 `<style>` 或 `app.css` 的最外層，沒有包在別的規則裡（看原始檔的縮排，沒看編譯後的 CSS），推論 18.4 不受影響。
- 27：「Fixed an issue where animations were ignored during print, causing missing content on animated pages.」八拍表沒有 CSS 動畫（看了 `PrintSheet.svelte`、`Modal.svelte`）。

### 2.4 背景色

- Apple：`shouldPrintBackgrounds`「A Boolean value that indicates whether to include any background color or graphics when printing content.」預設 `false`，iOS 16.4 起 [APPLE-BG]。
- 原始碼：用 iOS 16.4 以後的 SDK 建的 app，預設不印背景（`DefaultsToExcludingBackgroundsWhenPrinting`）[SRC-BG]。
- 原始碼：列印時，`print-color-adjust` 是 `economy` 的元素，有顏色的背景換成白的；`shouldPrintBackgrounds` 開著就照印 [SRC-BG]。寫 `exact` 的不換（推論：程式只在 `economy` 時換）。沒寫 `print-color-adjust` 時算 `economy`（推論，沒查 WebKit 的預設值）。
- 八拍表：`.mini`（小站位圖）寫了 `print-color-adjust: exact`；`th` 的 `#f2f4f8` 底色沒寫（`PrintSheet.svelte`）。app 裡不開 `shouldPrintBackgrounds` 的話，表頭會是白底（推論）。
- Safari 自己開不開這個設定，查不到。
- Safari 27：「Fixed an issue where printing light text on a dark background with backgrounds disabled could result in invisible text.」[SAF-NOTES]。八拍表是白底深色字，推論不受影響。

### 2.5 ⌘P

- Apple：`UIApplicationSupportsPrintCommand` 設 `YES`，「the system adds the Command-P keyboard shortcut to the app」；按 ⌘P 時，系統呼叫 responder chain 上第一個實作 `printContent(_:)` 的物件。iPad 的快捷鍵清單會出現 Print [APPLE-PRINTCMD]。
- `printContent(_:)` 的說明：在裡面準備列印工作，顯示 `UIPrintInteractionController` [APPLE-PRINTCMD]。
- 原始碼：`WKContentView.mm`、`WKContentViewInteraction.mm`、`WKWebViewIOS.mm` 裡找不到 `printContent` [SRC-KEY]。其他檔沒找。
- 推論：殼不接的話，app 裡按 ⌘P 沒反應。八拍表上「用瀏覽器列印（{keys}），也可以存成 PDF。」這句（`messages/zh-TW.json` 的 `print_hint`）在 app 裡不對，歸 #339。

### 2.6 `createPDF` 不是列印

- Apple：`createPDF(configuration:completionHandler:)`「Generates PDF data from the web view’s contents asynchronously.」，iOS 14 起。`WKPDFConfiguration` 只能設要拍的範圍（`rect`）和透明背景 [APPLE-WKWEBVIEW]。文件沒提列印樣式、紙張、分頁（查不到）。
- 原始碼 [SRC-PDF]：`createPDF` → `WebPage::drawToPDF` → `drawMainFrameToPDF` → `pdfSnapshotAtSize`。
  - 整條路沒有呼叫 `setPrinting`。照 2.3，換媒體類型的是 `setPrinting`，所以這裡不換（推論）。
  - 範圍預設是整個網頁內容的大小。每 200 吋（`72 * 200`）切一頁，不是照紙張。
- 推論：`@media print` 不算、`break-before` 不算、不是一頁一頁的 A4。
- `WKWebView.mediaType` 可以把媒體類型換成別的字串 [APPLE-WKWEBVIEW]。設成 `print` 再 `createPDF` 會怎樣，沒查，要真機驗。

## 3. 印成 PDF、存進「檔案」、傳給別人，走同一條路嗎

| 做法 | 印 | 存成 PDF | 存進「檔案」、傳給別人 | 查不到的 |
|---|---|---|---|---|
| A. 系統列印畫面（2.2） | 可以 [APPLE-PIC] | 列印選項畫面有「分享」鍵 [SUP-JOURNAL] | 分享鍵後選「檔案」「訊息」等 [SUP-JOURNAL-GUIDE] | 我們的殼叫出來的畫面有沒有這顆鍵（推論有） |
| B. 殼自己畫 PDF，再交給分享選單或存檔對話框 | 另外走 A | 自己畫 | `UIActivityViewController` [APPLE-ACT] 或 `UIDocumentPickerViewController(forExporting:asCopy:)` [APPLE-DOCPICK] | 紙張大小怎麼設、畫質 |
| C. 分享選單直接放 print formatter | 選單裡有「列印」[APPLE-ACT] | 查不到 | 查不到 | 選單會出現哪些項目 |
| D. `createPDF` | 不行 | 拍成長圖 PDF，不是列印版面（2.6） | 同 B | — |

A 的細節（已確認的只有 Apple 寫日記 App 的部分）：

- Apple 支援文件（2024-12-17）：「In iOS 18 or later, you can save copies of your journal entries as PDFs in the Files app」；「On the print options screen, choose what you want to do with the entries:」；「To save your entries as PDFs in the Files app, tap the Share button.」[SUP-JOURNAL]
- iPhone 使用手冊：「Tap Print, then tap [the Share button].」「Choose an app such as Notes, Files, or Messages, or tap Save to Files.」[SUP-JOURNAL-GUIDE]（方括號是圖示的替代文字）
- 一般的「從 iPhone 列印」和 AirPrint 那兩頁都沒提 PDF [SUP-PRINT] [SUP-AIRPRINT]。
- 推論：日記 App 用的是系統的列印畫面；我們的殼用 `UIPrintInteractionController` 叫出來的是同一個，也有這顆分享鍵。Apple 開發者文件沒有一句這樣寫（查不到），要真機驗。iOS 18.4 上有沒有也要驗（文件只寫「iOS 18 or later」）。

B 的細節：

- `UIPrintPageRenderer` 可以加 print formatter，`numberOfPages` 會照 formatter 算頁數 [APPLE-UPPR]。`UIGraphicsPDFRenderer` 可以一頁一頁畫成 PDF [APPLE-PDFR]。
- 紙張大小：`paperRect`、`printableRect` 在公開介面只能讀，說明是「the size of paper chosen for the print job」[APPLE-UPPR]。沒有列印工作時怎麼設，Apple 文件沒寫（查不到）。
- WebKit 自己的測試用私有的 setter 設紙張大小（測試檔自己宣告 `@property (nonatomic) CGRect paperRect;`）[SRC-TEST]。app 不能這樣做 [DPLA]。
- 寫一個子類別覆寫 `paperRect` 的 getter，公開介面上看起來可以（Apple 說 page renderer 本來就是「an instance of a custom subclass」[APPLE-UPPR]），但沒有文件或測試證明 WebKit 的 formatter 吃這一套（推論，要真機驗）。
- 畫質：2.3 的「不是 best 就畫點陣圖」。殼自己畫時 `requestedRenderingQuality` 是什麼，查不到。如果不是 best，PDF 會是每頁最長邊 500 像素的圖，字會糊（推論，要真機驗）。
- 分享選單在 iPad 上「you must present the view controller in a popover」[APPLE-ACT]。

C 的細節：

- `UIActivity.ActivityType.print`：「You can also provide UIPrintPageRenderer, UIPrintFormatter, and UIPrintInfo objects.」[APPLE-ACT]
- 放 formatter 進分享選單，會不會有「儲存到檔案」這類項目，文件沒寫（查不到）。`markupAsPDF` 這一項存在（iOS 11 起），文件沒說它收哪些東西 [APPLE-ACT]。

跟下載的關係：

- 上面四種都不經過 `WKDownloadDelegate`。只有「網頁自己做出 PDF 檔，再用 `<a download>` 存」才會走到下載那條路（`app-webview-shell.md` 第 3 節）（推論）。

合起來（推論）：印、存 PDF、存「檔案」、傳給別人，走 A 一條路都到得了（選印表機就印，按分享鍵就存或傳）。要在八拍表上另外放一顆「存成 PDF」，就要 B，而 B 有兩件事查不到。

## 4. 坑

| 坑 | 會怎樣 | 依據 |
|---|---|---|
| 沒接就安靜沒反應 | 按「列印」沒反應、不報錯、沒有 `beforeprint`／`afterprint`（推論） | 1.1 [SRC-UID] |
| 跟下載比 | 下載沒接會怎樣查不到；列印沒接，原始碼寫明直接當作印完 | `app-webview-shell.md` 第 3 節、1.1 |
| ⌘P 沒反應 | 要 `UIApplicationSupportsPrintCommand` 加 `printContent(_:)`（推論） | 2.5 |
| 背景不印 | `th` 淺灰底印成白的（推論） | 2.4 |
| iPad 要指一個位置 | 分享選單一定要用小視窗；列印畫面要從按鈕跳出，就要知道按鈕在哪（網頁要把位置傳給殼，推論） | [APPLE-ACT] [APPLE-PIC] |
| 拿 `createPDF` 當列印 | 不是列印版面 | 2.6 |
| 殼自己畫 PDF | 紙張大小、畫質都查不到，可能是糊的圖（推論） | 第 3 節 B |
| `window.print()` 等載入 | 有還沒回來的請求時，列印延後；2026-11-06 才改，27.2 還沒有 | 1.3 [WK-136335] |
| 同步訊息 | `window.print()` 等 app 那一端回話才往下跑；殼沒接時馬上回 | 1.1 [SRC-WCC] |
| 主畫面網頁 App（iOS 27） | 網頁版從主畫面打開可能印不了（未確認） | 1.4 |

## 5. 跟現有筆記、決定比

- `app-webview-shell.md` 第 3 節：下載要殼接 `WKDownloadDelegate`，沒接會怎樣查不到。列印是另一條路，不經過下載（第 3 節）。那份的「查不到」清單不用改。
- ADR 0022 列了殼要做的事：資料存在 app 的資料夾、「檔案」App 開流程檔、回到上次那支、鎖定畫面的播放鍵。沒有列印。照這份筆記，八拍表要在 app 裡印得出來，殼要多接列印（推論）。

## 查不到、要真機驗

要真機才知道的（沒有 Xcode，這次都沒做）：

- app 裡呼叫 `window.print()`：是不是真的沒反應、沒錯誤、沒有 `beforeprint`／`afterprint`。
- 殼用 `viewPrintFormatter()` 印：是不是只印八拍表；表格版面、分頁、小站位圖對不對。iPhone、iPad 各一次。
- 殼叫出來的列印選項畫面有沒有「分享」鍵；存出來的 PDF 頁數對不對。18.4 和最新版各一次。
- `th` 的淺灰底在 app 裡是不是印成白的；開 `shouldPrintBackgrounds` 以後印不印。
- 加了 `UIApplicationSupportsPrintCommand` 後，游標在網頁的輸入框裡按 ⌘P，會不會叫到殼的 `printContent(_:)`。
- `createPDF` 遇到 `position: fixed` 的八拍表會拍到什麼；設 `mediaType = "print"` 有沒有用。
- 殼自己用 `UIPrintPageRenderer` 子類別畫 PDF：頁數、畫質。

沒有一手來源的：

- Apple 文件寫「WKWebView 的 `viewPrintFormatter()` 能用」的句子。
- Apple 開發者文件寫「列印選項畫面有分享鍵、能存 PDF」的句子（只有日記 App 的使用說明）。
- Safari 怎麼處理 `window.print()`、印不印背景（Safari 不開源）。
- 沒有列印工作時，用公開介面設 `UIPrintPageRenderer` 紙張大小的方法。
- 殼自己畫 PDF 時的 `requestedRenderingQuality`。
- 分享選單放 print formatter 時會出現哪些項目。
- commit `e4c679f46645`（列印不再等子資源）從哪一版 Safari 開始。
- 18.4（`621.1.15`）本身的原始碼（沒有 tag）。

## 來源

全部在 2026-11-22 查。讀法：

- WebKit 原始碼用 `curl` 抓 GitHub 上某個 tag 的原始檔全文，用關鍵字找到函式再讀上下文。長檔沒有逐行讀完。GitHub 的程式碼搜尋在 WebKit 上找不到東西，所以只讀了下面列的檔。
- Apple 開發者文件讀的是同一路徑的 JSON 資料檔（`https://developer.apple.com/tutorials/data/documentation/….json`）。下面列給人看的網址。
- support.apple.com 的頁面用 `curl` 抓原始 HTML 讀。第一次被擋（429），過一陣子重抓成功。中途也用網頁摘要工具讀過其中兩頁，引文都再用原始 HTML 對過。
- WebKit bug 讀 Bugzilla 的 REST API（`https://bugs.webkit.org/rest/bug/<編號>/comment`）。
- [DPLA] 沿用 `app-webview-shell.md` 2026-11-20 讀的原文，這次沒重讀。
- 這個 repo 的檔案（`PrintSheet.svelte` 等）看的是 2026-11-22 的 `main`。

**WebKit 原始碼**（tag `WebKit-7625.2.8`。網址開頭 `https://github.com/WebKit/WebKit/blob/<tag>/`）

- 另外在 `WebKit-7620.2.4`、`WebKit-7621.2.5.10.1` 對過的：[SRC-DOMWIN]、[SRC-CHROME]、[SRC-WCC] 的同步送出、[SRC-WPP] 的 `printFrame`／`endPrinting`、[SRC-UID]（含 `printFrame` 沒有平台的 `#if`、`setUIDelegate:`、`APIUIClient.h`）、[SRC-FMT]（含點陣圖或 PDF 的判斷）、[SRC-PRINTMODE]（含 500 像素）、[SRC-PDF] 的 `createPDF`／`drawToPDF`、[SRC-BG] 的 `BackgroundPainter.cpp`、`WebPreferencesDefaultValues.cpp`。
- 只讀了 27.2 的：`WebPageProxy.messages.in`、`UnifiedWebPreferences.yaml`、`RuntimeApplicationChecksCocoa.mm`、[SRC-SPI]、[SRC-KEY]、[SRC-PUBH]、[SRC-TEST]、`WKPDFConfiguration.h`。

檔案：

- [SRC-DOMWIN] `Source/WebCore/page/LocalDOMWindow.cpp`：`LocalDOMWindow::print`
- [SRC-CHROME] `Source/WebCore/page/Chrome.cpp`：`Chrome::print`
- [SRC-WCC] `Source/WebKit/WebProcess/WebCoreSupport/WebChromeClient.cpp`：`WebChromeClient::print`；`Source/WebKit/UIProcess/WebPageProxy.messages.in`：`PrintFrame(...) -> () Synchronous`
- [SRC-WPP] `Source/WebKit/UIProcess/WebPageProxy.cpp`：`printFrame`、`endPrinting`、`drawToPDF`
- [SRC-UID] `Source/WebKit/UIProcess/Cocoa/UIDelegate.mm`：`UIClient::printFrame`、`setDelegate` 裡的 `respondsToSelector`；`Source/WebKit/UIProcess/API/APIUIClient.h`：預設的 `printFrame`；`Source/WebKit/UIProcess/API/Cocoa/WKUIDelegatePrivate.h`；`Source/WebKit/UIProcess/API/Cocoa/WKWebView.mm`：`setUIDelegate:`
- [SRC-FMT] `Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm`：`_printFormatterClass`；`Source/WebKit/UIProcess/_WKWebViewPrintFormatter.h`、`_WKWebViewPrintFormatter.mm`；`Source/WebKit/UIProcess/ios/WKContentView.mm`：Printing 那一段
- [SRC-PRINTMODE] `Source/WebKit/WebProcess/WebPage/WebPage.cpp`：`beginPrinting`、`endPrinting`、`endPrintingImmediately`、`computePagesForPrintingImpl`；`Source/WebKit/WebProcess/WebPage/ios/WebPageIOS.mm`：`computePagesForPrintingiOS`、`drawToImage`、`drawToPDFiOS`；`Source/WebCore/page/PrintContext.cpp`：`begin`；`Source/WebCore/page/LocalFrame.cpp`：`setPrinting`；`Source/WebCore/page/LocalFrameView.cpp`：`adjustMediaTypeForPrinting`
- [SRC-PDF] `Source/WebKit/UIProcess/API/Cocoa/WKWebView.mm`：`createPDFWithConfiguration:`；`Source/WebKit/WebProcess/WebPage/Cocoa/WebPageCocoa.mm`：`drawToPDF`（27.2；18.x 在 `WebPage.cpp`）；`Source/WebKit/WebProcess/WebPage/WebPage.cpp`：`drawMainFrameToPDF`、`pdfSnapshotAtSize`；`Source/WebKit/UIProcess/API/Cocoa/WKPDFConfiguration.h`
- [SRC-BG] `Source/WebCore/rendering/BackgroundPainter.cpp`；`Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`：`ShouldPrintBackgrounds`；`Source/WebKit/Shared/WebPreferencesDefaultValues.cpp`：`defaultShouldPrintBackgrounds`；`Source/WTF/wtf/cocoa/RuntimeApplicationChecksCocoa.mm`：iOS 16.4 SDK 那一段
- [SRC-SPI] `Source/WebKit/Platform/spi/ios/UIKitSPI.h`：`requestedRenderingQuality`
- [SRC-KEY] `Source/WebKit/UIProcess/ios/WKContentView.mm`、`Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm`、`Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm`：找 `printContent`、`print`
- [SRC-PUBH] `Source/WebKit/UIProcess/API/Cocoa/WKWebView.h`、`WKPreferences.h`、`WKWebViewConfiguration.h`、`WKWebViewPrivate.h`：找 `print`
- [SRC-TEST] `Tools/TestWebKitAPI/Tests/WebKit/WKWebView/WKWebViewPrintFormatter.mm`：`PrintToPDFUsingPrintPageRenderer`、`PrintToPDFShouldPrintBackgrounds`、`PrintToPDFUsingPrintInteractionController`

**WebKit bug、commit**

- [WK-133600] bug 133600「[iOS] Expose _WKWebViewPrintFormatter and -_webView:printFrame: as SPI」（2014-06，FIXED）：https://bugs.webkit.org/show_bug.cgi?id=133600
- [WK-136335] bug 136335「window.print() is blocked until XMLHttpRequest completes」（2014-08 開，2026-11-06 FIXED）：https://bugs.webkit.org/show_bug.cgi?id=136335 。commit `e4c679f46645`（325938@main）「Print should fire after the load event has fired.」：https://github.com/WebKit/WebKit/commit/e4c679f4664569ea0c24b6051be0701130740819
- [WK-325259] bug 325259「REGRESSION (iOS 27): window.print() silently does nothing Home Screen standalone web apps」（RESOLVED MOVED，2026-09-26）：https://bugs.webkit.org/show_bug.cgi?id=325259
- [WK-327504] bug 327504「REGRESSION (iOS 27): window.print() does nothing in a standalone web app (Home Screen)」（NEW，2026-10-20 最後更新）：https://bugs.webkit.org/show_bug.cgi?id=327504

**Apple 開發者文件**

- [SAF-NOTES] Safari Release Notes：18.3、18.4、18.5、26.1、27、27.2、27.3 beta 各頁的開頭和 Printing、CSS 段：https://developer.apple.com/documentation/safari-release-notes
- [APPLE-UIDELEGATE] WKUIDelegate：https://developer.apple.com/documentation/webkit/wkuidelegate
- [APPLE-WKWEBVIEW] WKWebView 的方法清單、`createPDF(configuration:completionHandler:)`、`pdf(configuration:)`、`printOperation(with:)`、`mediaType`、WKPDFConfiguration：https://developer.apple.com/documentation/webkit/wkwebview 、https://developer.apple.com/documentation/webkit/wkwebview/createpdf(configuration:completionhandler:) 、https://developer.apple.com/documentation/webkit/wkwebview/mediatype 、https://developer.apple.com/documentation/webkit/wkpdfconfiguration
- [APPLE-PIC] UIPrintInteractionController、`present(animated:completionHandler:)`、`present(from:animated:completionHandler:)`、`present(from:in:animated:completionHandler:)`、`printFormatter`、`isPrintingAvailable`：https://developer.apple.com/documentation/uikit/uiprintinteractioncontroller
- [APPLE-VPF] `viewPrintFormatter()`、UIViewPrintFormatter、UIPrintFormatter：https://developer.apple.com/documentation/uikit/uiview/viewprintformatter() 、https://developer.apple.com/documentation/uikit/uiviewprintformatter 、https://developer.apple.com/documentation/uikit/uiprintformatter
- [APPLE-UPPR] UIPrintPageRenderer、`paperRect`、`printableRect`、`numberOfPages`、`drawPage(at:in:)`、UIPrintRenderingQuality、`currentRenderingQuality(forRequested:)`：https://developer.apple.com/documentation/uikit/uiprintpagerenderer
- [APPLE-PDFR] UIGraphicsPDFRenderer：https://developer.apple.com/documentation/uikit/uigraphicspdfrenderer
- [APPLE-PRINTCMD] `printContent(_:)`、UIApplicationSupportsPrintCommand、Printing：https://developer.apple.com/documentation/uikit/uiresponderstandardeditactions/printcontent(_:) 、https://developer.apple.com/documentation/bundleresources/information-property-list/uiapplicationsupportsprintcommand 、https://developer.apple.com/documentation/uikit/printing
- [APPLE-BG] `WKPreferences.shouldPrintBackgrounds`：https://developer.apple.com/documentation/webkit/wkpreferences/shouldprintbackgrounds
- [APPLE-ACT] UIActivityViewController、`init(activityItems:applicationActivities:)`、`UIActivity.ActivityType.print`、`.markupAsPDF`：https://developer.apple.com/documentation/uikit/uiactivityviewcontroller 、https://developer.apple.com/documentation/uikit/uiactivity/activitytype-swift.struct/print
- [APPLE-DOCPICK] `UIDocumentPickerViewController.init(forExporting:asCopy:)`：https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller/init(forexporting:ascopy:)
- [APPLE-BRIDGE] WKScriptMessageHandler、WKUserScript：https://developer.apple.com/documentation/webkit/wkscriptmessagehandler 、https://developer.apple.com/documentation/webkit/wkuserscript
- [APPLE-WEBPAGE] WebPage（iOS 26 起）：https://developer.apple.com/documentation/webkit/webpage
- [APPLE-HIG] Human Interface Guidelines: Printing：https://developer.apple.com/design/human-interface-guidelines/printing
- [DPLA] Apple Developer Program License Agreement：見 `app-webview-shell.md` 的來源

**Apple 支援文件**

- [SUP-JOURNAL] Back up, export, and print Journal entries on iPhone（Published Date: December 17, 2024）：https://support.apple.com/en-us/121822
- [SUP-JOURNAL-GUIDE] Print and export entries in Journal on iPhone（iPhone 使用手冊）：https://support.apple.com/guide/iphone/print-and-export-entries-iph4cad323fe/ios
- [SUP-PRINT] Print from iPhone（iPhone 使用手冊）：https://support.apple.com/guide/iphone/printers-iph92628b8f/ios
- [SUP-AIRPRINT] Use AirPrint to print from your iPhone or iPad（Published Date: November 14, 2025）：https://support.apple.com/en-us/109349
