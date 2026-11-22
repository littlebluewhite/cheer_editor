# 流程檔怎麼用 app 打開：副檔名、「檔案」App、LINE、網頁選檔、存回原檔

查核日期 2026-11-22。
要決定的事：iPhone、iPad app（網頁包在 app 裡的 WKWebView，外面是自己寫的 Swift 殼，最低 iOS／iPadOS 18.4）的流程檔要用什麼副檔名、宣告成什麼型別。
目標：在「檔案」App 點一下就開 app；LINE 收到的檔，最多三下（點檔案 → 分享 → 選 app）就開 app，不用先存到「檔案」；存檔最好寫回原本那個檔。
Android 和電腦繼續用網站（`docs/flow-file-format.md`、`src/lib/file/save.ts`）。

只整理事實，不說該選哪一個。

標記方式（跟 `research/app-webview-shell` 分支上的 `docs/research/app-webview-shell.md` 一樣，多了「模擬器」和「真機」）：

- **已確認**：有一手來源的原文。方括號是來源代號，見文末「來源」。
- **原始碼**：WebKit、Chromium、Android 開放原始碼在某個 tag 寫的內容。程式碼怎麼寫是已確認的；出貨的版本是不是照這份編，查不到。所以從原始碼推出來的行為一律算推論。
- **本機**：在這台 Mac（macOS 26.7.3）讀系統檔、跑 Swift 查到的。
- **模擬器**：在 Xcode 27.2 的 iOS 18.1、iOS 27.2 模擬器裡跑小程式查到的。真機是不是一樣，是推論。
- **真機**：站主 2026-11-22 用 `prototypes/app-feel/` 的小樣在真機上試的結果（轉述，不是我跑的）。
- **推論**：我自己推的，沒有一手來源直接寫。
- **查不到**：找過，沒有一手來源。
- **沒查**：這次沒去找。
- **未確認**：兩份一手來源說的不一樣，或只有次級來源。

這次只在模擬器裡查了型別（第 2、3、8 節）。**其餘沒有一項是我在真機上跑的**；真機結果都是站主轉述，寫明出處。

## 結論先講

| 題目 | 答案 | 多確定 |
|---|---|---|
| 1. 「檔案」App 點 `.zip` | Apple：點一下 ZIP 檔，系統會建一個資料夾放解開的檔案 [APPLE-ZIP]。**真機**：兩支小樣都把 `public.zip-archive` 宣告成 Alternate，點 `app-feel-test.zip` 還是解成資料夾，沒開任何 app [DEVICE]。宣告成 Owner 能不能搶到：沒試，Apple 也沒寫。 | 解壓縮：一手＋真機。Alternate 搶不到：真機。Owner：查不到 |
| 2. 自訂副檔名 conform 到 `public.zip-archive` 還是 `public.data` | Apple：文件型別要 conform 到 `public.data`（或 `com.apple.package`）「檔案」App 才認得；要能 AirDrop 再加 `public.content`；舉的例子是「以 JSON 為底的格式 conform 到 `public.json`」[APPLE-UTDEF]。但系統自己的 zip 底格式（docx、xlsx、pptx、odt、epub、usdz）**都不** conform 到 `public.zip-archive`，只有 jar、xlsb 有；macOS 系統宣告、iOS 18.1 和 27.2 模擬器都一樣 [MAC-CORETYPES] [SIM-UT]。「檔案」App 對 conform 到 zip 的自訂型別會不會也自動解開：沒有文件。 | Apple 文件、系統宣告：一手（iOS 是模擬器）。「檔案」App 的行為：查不到 |
| 3. Safari、WKWebView 的 `accept=".zip,.自訂"` | WebKit（iOS）把 `accept` 的副檔名先換成 MIME，換不到就丟掉；全部丟光就讓人選所有檔案 [SRC-UPLOAD]。所以沒裝 app 的 iPhone Safari：`.zip,.自訂` 只選得到 zip，自訂的選不到；只寫 `.自訂` 反而什麼都選得到。裝了 app、型別帶 MIME 才可能認得。app 自己的殼從 iOS 18.4 起可以整個接手選檔畫面 [APPLE-OPENPANEL]。macOS Safari 由 Safari 自己決定，WebKit 交給它的清單裡留著自訂副檔名。 | 原始碼（行為是推論）；殼能接手：一手 |
| 4. Android Chrome 選自訂副檔名的檔 | `<input accept>`：不認得的副檔名當成 `application/octet-stream`，清單裡只要有一個這樣就不篩，所有檔案都能選；只寫 `.zip` 時只能選 zip [CR-SFD]。**但 Chrome Android 132 起 `save.ts` 開檔、存檔都走 `showOpenFilePicker`／`showSaveFilePicker`** [BCD]：MIME 鍵寫 `application/zip` 時只篩 zip，`.自訂` 推論選不到；寫 Android 不認得的 vendor MIME 就不篩 [CR-FSC] [CR-SFD]。 | 原始碼（行為是推論） |
| 5a. Safari `<a download="x.自訂">` | WebKit 對 `download` 屬性給的檔名，只在「沒有點」時補副檔名，有點就不動，跟 Blob 是 `application/zip` 還是 `application/octet-stream` 無關 [SRC-DL] [SRC-MIME]。Safari 18.x 那一代（7621.1.2、7621.2.5.14.9）和現在的原始碼都一樣。 | 原始碼（推論） |
| 5b. iOS Safari 分享自訂副檔名 | WebKit 的 `canShare` 不看檔案類型；分享時照給的檔名寫進暫存資料夾，型別照副檔名認 [SRC-NAV] [SRC-SHARE]。 | 原始碼（推論） |
| 5c. Chrome `showSaveFilePicker`／`showOpenFilePicker` 的 `accept` | 規格：副檔名要「.」開頭、只能有英數字和 `+`、`.`、不能「.」結尾、最多 16 個字（含開頭的點）；MIME 鍵要是合法 MIME、不能帶參數 [FSA]。Chromium 照做 [CR-GFSA]。**電腦版**：篩選清單 = 寫的副檔名 + MIME 鍵自己的副檔名，`{'application/zip': ['.自訂']}` 會變成「自訂、zip」兩種都能選；建議檔名的副檔名在清單裡就不改 [CR-FSC]。**Android**：MIME 鍵寫 `application/zip`、存 `x.自訂`，可能變成 `x.自訂.zip`；寫 `application/octet-stream` 或 vendor MIME 不會（推論，見 5.3）。 | 一手（規格）＋原始碼 |
| 5d. Chrome Web Share 能分享的檔 | 只准 41 種副檔名、28 種 MIME（圖片、音訊、影片、純文字、HTML、CSS、CSV、PDF），zip 和自訂副檔名都不在內。Android、Windows、Mac、ChromeOS 同一份清單 [CR-SHARE] [CR-SHARE-AND] [CR-SHARE-MD]。`canShare()` 不看類型、回 true，`share()` 才以 `NotAllowedError` 拒絕 [CR-NAVSHARE]。 | 原始碼 |
| 6. LINE | **真機**：Mac 電腦版 LINE 傳 `app-feel-test.cheerb`，iPhone 收到 `app-feel-test.zip`：副檔名被**換掉**，不是多加；存到「檔案」點開，解出 `app-feel-test.cheerb`。**iPhone 的 LINE 拒絕傳 `.cheerb`**：從分享選單分享到 LINE，顯示「不支援這種檔案」（轉述的字）；聊天室「加號圖示＞檔案」那條路沒試 [DEVICE]。官方只有一句，只寫在電腦版（Windows／Mac）那一段：「若希望傳送系統未支援的檔案類型，請先將檔案轉換為zip檔案後再傳送」（中、英、日文版一樣）[LINE-SEND]；2013 年的官方部落格說電腦版能傳 Word、Excel、PowerPoint、PDF 等各種格式，「一部の特殊な形式のファイルを除く」[LINE-BLOG-2013]。**LINE 能傳哪些類型：手機版、電腦版都沒有清單，查不到。** `.zip`：官方叫人轉成 zip，Mac 版自己也包成 zip，推論 zip 是支援的；iPhone 版收不收、會不會原樣送到，要真機（步驟 H）。大小、數量、能不能關掉：查不到。 | 真機（轉述）＋一手（一句）；類型清單查不到 |
| 7. 存回原檔 | 原地打開的網址是 security-scoped，要用 `NSFileCoordinator`（或 `UIDocument`）讀寫 [APPLE-PLIST-ARCHIVE] [APPLE-DOCPICKER]。選檔器給的網址可以存成書籤，之後解回來再用 [APPLE-DOCPICKER] [APPLE-DIRS]；從「檔案」App 點進來的網址能不能一樣：推論可以。iCloud 還沒下載的檔，協調讀取會等它下載完 [APPLE-COORD]。從 LINE 分享進來的推論是副本，寫不回 LINE 裡那份。新檔用 `forExporting` `asCopy: false`（搬過去）會拿到新位置的網址，可以繼續寫 [APPLE-PICKER-GUIDE]；`asCopy: true` 兩份 Apple 文件說法相反（未確認）。Google Drive、OneDrive 支不支援原地打開：沒查。 | 一手＋推論 |
| 8. 副檔名、MIME | `.cheer`、`.cheerflow`、`.routine`、`.cheerroutine`（還有小樣的 `.cheerb`）在 FileInfo、FilExt 都查不到（次級來源）；這台 Mac 和 iOS 模擬器上都是動態型別 [MAC-UT] [SIM-UT]。長度都在 16 字內。Gmail、Outlook 的封鎖清單沒有它們 [GMAIL] [OUTLOOK]。vendor MIME（`application/vnd.…`，可加 `+zip` 字尾）可以自己向 IANA 登記，經專家審 [RFC6838] [RFC6839]。實際差別：WebKit 下載不看 MIME（5a）；Android Chrome 存檔看 MIME（`application/zip` 會補 `.zip`，vendor MIME 不會，推論）；電腦版 Chrome 的對話框會把 MIME 的副檔名加進篩選清單；iOS 型別的 `public.mime-type` 標籤影響「從 MIME 找型別」，WebKit 的選檔就靠這條路（3）。LINE：iPhone 版從分享選單不收 `.cheerb`（聊天室裡選檔沒試），Mac 版把它包成同名 `.zip`（真機，第 6 節）。 | 一手（RFC、清單）＋原始碼＋真機＋推論 |

只有真機才知道的，整理在「查不到、要真機驗」，步驟可以直接用小樣跑。LINE 的步驟（H）是照「iPhone 版收什麼、Mac 版包成什麼、`.zip` 能不能原樣到」排的。

## 先講幾個詞

- **UTType（型別）**：Apple 用來認檔案類型的名字，例如 `public.zip-archive`。一個型別可以「conform 到」別的型別（像子類別），還可以帶副檔名、MIME 的標籤。
- **exported 型別**：app 自己發明、在 `Info.plist` 的 `UTExportedTypeDeclarations` 宣告的型別。小樣的 `com.littlebluewhite.feel.b` 就是。
- **動態型別**：系統不認得某個副檔名或 MIME 時，臨時給的型別，名字是 `dyn.` 開頭，只 conform 到 `public.data`。
- **Owner／Alternate**：`CFBundleDocumentTypes` 的 `LSHandlerRank`。Owner 是「這類檔主要是我做的」，Alternate 是「我也看得懂」。
- **原地打開**：app 直接開原本那個檔，不是複製一份進 app。要 `LSSupportsOpeningDocumentsInPlace = YES`。
- **security-scoped 網址**：指到 app 沙盒外面的檔案的網址。用之前要呼叫 `startAccessingSecurityScopedResource()`。
- **書籤**：把一個網址存成資料，下次開 app 再解回網址。

## 0. 查的當天的版本

| 東西 | 版本 | 來源 |
|---|---|---|
| WebKit 原始碼（現在） | tag `WebKit-7625.2.8`（跟 `app-webview-shell.md` 用的一樣，Safari 27.2 那一版的引擎） | [SRC-UPLOAD] 等 |
| WebKit 原始碼（18.x 那一代，對照用） | tag `WebKit-7621.1.2`（7621 系列最早的）和 `WebKit-7621.2.5.14.9`（最新的）。GitHub 上找不到 iOS 18.4 剛好那一版的 tag，這兩個夾在前後 | 同上 |
| Chrome 正式版 | Android 159.0.8154.18、Windows 159.0.8154.13 | [CR-DASH] |
| 讀的 Chromium 原始碼 | tag `159.0.8154.18` | [CR-SFD] 等 |
| Android 原始碼 | AOSP `main` 分支（2026-11-22 抓） | [AOSP-FU] 等 |
| MDN browser-compat-data | 8.1.10 | [BCD] |
| File System Access 規格 | WICG Draft Community Group Report，10 October 2025 | [FSA] |
| 本機 | macOS 26.7.3（25G342） | [MAC-CORETYPES] [MAC-UT] |
| 模擬器 | Xcode 27.2（27B52）；iOS 18.1（22B81）、iOS 27.2（24B8117） | [SIM-UT] |
| Apple「建立或打開 ZIP 檔」 | Published Date: October 29, 2026 | [APPLE-ZIP] |

## 1. 在「檔案」App 點 `.zip`

已確認：

- Apple 支援文件（台灣版）：「點一下 ZIP 檔或封存檔。系統會建立一個包含檔案的檔案夾。」英文版：「Tap the ZIP file or archive. A folder is created containing the files.」iPhone、iPad、Vision Pro 都這樣寫 [APPLE-ZIP]。
- iPhone 使用手冊另寫：按住 ZIP 檔 → 「Uncompress」也可以解壓縮 [APPLE-FILES]。
- `LSHandlerRank` 的四個值：Owner、Default、Alternate、None [APPLE-RANK]。舊版的鍵值參考寫：Owner 是「this app is the primary creator of files of this type」，Alternate 是「this app is a secondary viewer of files of this type」，「Launch Services uses the value of LSHandlerRank to determine the app to use to open files of this type. The order of precedence is: Owner, Default, Alternate.」[APPLE-PLIST-ARCHIVE]。這份是 2018 年的舊文件，沒寫「檔案」App 點一下時誰優先。

真機（站主，2026-11-22）[DEVICE]：

- 「檔案」App 點 `app-feel-test.zip`：解成資料夾，沒有開任何 app。當時裝了兩支小樣，都把 `public.zip-archive` 宣告成 Alternate。
- 小樣把 `.cheerb` 宣告成自己的型別（Owner），點一下就開 app（之前就試過）。

查不到：

- 宣告成 Owner 能不能讓「檔案」App 點 `.zip` 改開 app。Apple 的支援文件、型別文件、`LSHandlerRank` 文件都沒提。

推論：

- 「點一下」和「分享選單、打開方式」是兩條路。宣告 `public.zip-archive`（Alternate）搶不到點一下（真機），但可能讓 app 出現在 zip 的分享選單裡。要真機驗（步驟 A）。

## 2. 自訂副檔名要 conform 到哪裡

### 2.1 Apple 的寫法

已確認，Apple「Defining file and data types for your app」[APPLE-UTDEF]：

- 「if your app uses a proprietary file format based on `JSON`, use `public.json` in the `UTTypeConformsTo` string」。
- 「When defining a document type, make sure that it conforms to `public.data` or `com.apple.package` to ensure the Finder or Files app can represent it.」
- 「For document types, conform to `public.content` … This conformance allows users to share your type over AirDrop.」
- 「Conform your type to the most specific subtype applicable.」
- 「Define an exported type when your app is the canonical source of information for that type.」
- 自訂的識別字不能用 `public`、`dyn`、`com.apple` 開頭；只能有英數字、`-`、`.`。
- `public.zip-archive` conform 到 `public.data` 和 `public.archive` [APPLE-UTZIP]。
- `com.apple.package` 是「打包起來的資料夾」，conform 到 `public.directory` [APPLE-UTPKG]。流程檔是單一個 zip 檔，不是資料夾，所以不適用（推論）。

照「JSON 底的格式 conform 到 `public.json`」這句類推，zip 底的格式應該 conform 到 `public.zip-archive`（推論）。Apple 沒有一句話直接講 zip。

### 2.2 系統自己怎麼宣告 zip 底的格式

本機，讀 `/System/Library/CoreServices/CoreTypes.bundle/Contents/Info.plist`（macOS 26.7.3）[MAC-CORETYPES]：

| 型別 | 副檔名 | conform 到 |
|---|---|---|
| `org.openxmlformats.wordprocessingml.document` | docx | `org.openxmlformats.openxml`、`public.composite-content` |
| `org.openxmlformats.spreadsheetml.sheet` | xlsx | `org.openxmlformats.openxml`、`public.composite-content`、`public.spreadsheet` |
| `org.openxmlformats.presentationml.presentation` | pptx | `org.openxmlformats.openxml`、`public.presentation` |
| `org.openxmlformats.openxml` | — | `public.data` |
| `org.oasis-open.opendocument.text` | odt | `org.oasis-open.opendocument`（→ `public.data`）、`public.composite-content` |
| `org.idpf.epub-container` | epub | `public.data`、`public.composite-content` |
| `com.pixar.universal-scene-description-mobile` | usdz | `com.pixar.universal-scene-description`（→ `public.3d-content`、`public.data`） |
| `com.sun.java-archive` | jar | **`public.zip-archive`**、`public.executable` |
| `com.microsoft.excel.sheet.binary.macroenabled` | xlsb | **`public.zip-archive`**、`public.composite-content`、`public.spreadsheet`、`public.executable` |

- 這些檔裡面都是 zip。docx、xlsx、pptx、odt、epub、usdz 都**沒有** conform 到 `public.zip-archive`。主檔裡 conform 到它的只有 jar 和 xlsb；`Contents/Library/` 底下的子 bundle 共 822 筆型別宣告，沒有一筆 conform 到它。
- 模擬器（iOS 18.1、iOS 27.2）用 Swift 查：docx、xlsx、pptx、odt、epub、usdz 的型別 `conforms(to: .zip)` 都是 false；jar、xlsb 是 true；跟 macOS 一樣 [SIM-UT]。

### 2.3 兩種選法各會怎樣

| | conform 到 `public.data` + `public.content`（小樣的做法） | conform 到 `public.zip-archive`（+ `public.content`） |
|---|---|---|
| 「檔案」App 點一下 | 真機：直接開 app | **查不到**。Apple 說「點一下 ZIP 檔或封存檔」會解開 [APPLE-ZIP]，沒說是看副檔名還是看型別。如果看型別，就會被解開，不開 app（推論）。要真機驗（步驟 B） |
| 「檔案」App 長按選單有沒有「解壓縮」 | 查不到 | 查不到 |
| 預覽（Quick Look） | 查不到 | 查不到 |
| app 裡網頁現在的 `accept=".zip"` 選不選得到 | 選不到（推論：`.zip` 換成 `public.zip-archive`，自訂型別不是它的子型別，見 3.1） | 選得到（推論：選檔器照 conform 篩，見 3.1） |
| Safari（有裝 app 的 iPhone）的 `accept=".zip"` | 選不到（推論） | 選得到（推論） |
| AirDrop | 有 `public.content` 就可以 [APPLE-UTDEF] | 同左，要另外加 `public.content`（`public.zip-archive` 本身沒有）[APPLE-UTZIP] |

## 3. Safari、app 裡的網頁選檔（`<input type="file" accept>`）

### 3.1 iOS／iPadOS 的 WebKit

原始碼，`WKFileUploadPanel.mm`（`WebKit-7625.2.8`；`WebKit-7621.1.2`、`WebKit-7621.2.5.14.9` 這幾段一樣）[SRC-UPLOAD]：

1. `accept` 裡的 MIME 直接收。
2. `accept` 裡的副檔名（`.zip`）用 `MIMETypeRegistry::mimeTypeForExtension` 換成 MIME，「`if (!mimeType.isEmpty())`」才收。換不到就丟掉。
3. 每個 MIME 用 `[UTType typeWithMIMEType:]` 換成型別。`*/*` 直接變成「不篩」。
4. 選檔畫面：「`documentTypes = mediaTypes.count ? mediaTypes : @[ UTTypeItem.identifier ]`」。一個型別都沒有，就用 `public.item`（所有檔案）。

`mimeTypeForExtension` 在 Apple 平台先問 `NSURLFileTypeMappings`（Apple 的私有介面），問不到再查一張相機 RAW 檔的小表 [SRC-MIMECOCOA]。私有介面會不會讀到某個 app 宣告的型別，查不到。

本機和模擬器用 Swift 查 [MAC-UT] [SIM-UT]：

- `UTType(filenameExtension: "cheer")` 等四個候選和 `cheerb`：都是 `dyn.` 開頭的動態型別、`preferredMIMEType` 是 nil、不 conform 到 `public.zip-archive`。macOS、iOS 18.1、iOS 27.2 一樣。
- `UTType(mimeType: "application/zip")` 是 `public.zip-archive`；`application/octet-stream` 是 `public.data`；不認得的 `application/vnd.example.flow+zip` 是動態型別。
- Apple：不認得的 MIME 或副檔名「may provide a dynamic type」[APPLE-UTEXT]。

合起來（推論，都要真機驗，步驟 C、D）：

| `accept` | 沒裝 app 的 Safari | 有裝 app 的 Safari | app 裡的 WKWebView |
|---|---|---|---|
| `.zip` | 只有 zip | zip，加上 conform 到 zip 的自訂型別 | 同左 |
| `.zip,.自訂` | 只有 zip（`.自訂` 換不到 MIME 被丟掉） | 自訂型別有 `public.mime-type` 標籤、而且私有介面讀得到時，兩種都可以；否則同左 | 同左 |
| `.自訂` | **所有檔案**（換不到 → 一個型別都沒有 → `public.item`） | 換得到就只有自訂型別；換不到就所有檔案 | 同左 |
| `.zip,application/octet-stream` | 幾乎所有檔案（`public.data`） | 同左 | 同左 |

- 選檔器是照「conform 到」篩的，不是照名字完全相同：WebKit 自己用 `public.item` 代表「所有檔案」，這要靠 conform 才成立（推論）。Apple 的選檔器文件沒有直接寫。
- iOS 上的 Chrome、Edge 也是 WebKit，推論一樣（沒查）。

### 3.2 app 的殼可以接手選檔

- `webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`：iOS、iPadOS **18.4** 起有。「By default on iOS, file uploads are enabled if you don't implement this method.」實作了就由 app 自己顯示選檔畫面，把選到的網址交回去 [APPLE-OPENPANEL]。
- 公開的 `WKOpenPanelParameters` 只有 `allowsMultipleSelection`、`allowsDirectories`，沒有 `accept` 的內容 [APPLE-OPENPANEL]。`accept` 只在底線開頭的私有介面裡（`_acceptedMIMETypes`、`_acceptedFileExtensions`、`_allowedFileExtensions`）[SRC-OPP]。殼是自己的 app，可以不看 `accept`，直接用自己的型別開 `UIDocumentPickerViewController`（推論）。
- 原始碼：app 交回網址後，WebKit 在 iOS 上先把檔案複製到暫存資料夾再交給網頁（`_moveToNewTemporaryDirectory … asCopy:YES`）[SRC-UID]。所以網頁拿到的是副本，網頁自己寫不回原檔；要寫回原檔得由殼來做（推論，見第 7 節）。

### 3.3 macOS Safari

- macOS 上 WebKit 不自己開選檔視窗，交給瀏覽器 app：「By default on macOS, file uploads are disabled if you don't implement this method.」[APPLE-OPENPANEL]。Safari 怎麼開，是 Safari 自己的程式，看不到（查不到）。
- WebKit 交給它的「允許的副檔名」：MIME 換成的副檔名，再加上 `accept` 裡寫的副檔名原樣保留（`allowedFileExtensions`）[SRC-MIME] [SRC-OPP]。所以 `.自訂` 有交到 Safari 手上（原始碼）；Safari 讓不讓選，要實測（步驟 C）。

## 4. Android Chrome 選檔

原始碼，Chromium `159.0.8154.18`。

### 4.1 `<input type="file" accept>`

`SelectFileDialog.java` [CR-SFD]：

- `ensureMimeType`：副檔名用 Android 的 `MimeTypeMap` 換 MIME；換不到就回「`application/octet-stream`」（程式裡叫 `GENERIC_TYPE`）。
- 開選檔：「If some of the extensions are generic, just let user select all files.」清單裡只要有 `application/octet-stream`，就不帶 `EXTRA_MIME_TYPES`，所有檔案都能選。

所以（推論，步驟 G）：

| `accept` | Android Chrome |
|---|---|
| `.zip` | 只篩 `application/zip` |
| `.zip,.自訂` | 不篩，所有檔案都能選 |
| `.自訂` | 不篩，所有檔案都能選 |

### 4.2 Android 上 `showOpenFilePicker`、`showSaveFilePicker` 也有

- BCD：Chrome Android 132 起有 `showOpenFilePicker`、`showSaveFilePicker` [BCD]。`save.ts` 是看有沒有這兩個來分路的（開檔第 70～73 行、存檔第 93、113 行），所以 Android Chrome 開檔、存檔都走對話框，不是 `<input>`、分享或下載。
- 選檔（`ACTION_OPEN_DOCUMENT`）：MIME 清單 = `accept` 的 MIME 鍵，加上副檔名「認得的」MIME，認不得的副檔名不加 [CR-FSC]。清單裡每個 MIME 都是 Android 認得的，才帶 `EXTRA_MIME_TYPES` 篩；有一個認不得就不篩 [CR-SFD]。
  - `{'application/zip': ['.自訂']}` → 只篩 `application/zip`。本機儲存空間的 `.自訂` 檔，Android 照副檔名給 MIME，認不得就是 `application/octet-stream`，所以推論選不到。
  - `{'application/vnd.…+zip': ['.自訂']}` → vendor MIME Android 不認得 → 不篩，都能選（推論）。
- 存檔（`ACTION_CREATE_DOCUMENT`）見 5.3。

## 5. 網頁下載、分享自訂副檔名的檔

### 5.1 Safari `<a download>`（5a）

原始碼，`DownloadProxy.cpp` 的 `decideDestinationWithSuggestedFilename` [SRC-DL]：

- 檔名來源分三種：伺服器的 `Content-Disposition`、`download` 屬性、從網址猜。
- 程式註解：「Correct the file extension to match the Content-Type for URL-derived filenames …, or append an extension if the filename doesn't have one.」從網址猜的才改副檔名；`download` 屬性給的只走 `appendFileExtensionIfNecessary`。
- `appendFileExtensionIfNecessary`：「`if (filename.isEmpty() || filename.contains('.') || equalIgnoringASCIICase(mimeType, defaultMIMEType())) return filename;`」[SRC-MIME]。檔名有點就原樣回傳。

所以 `<a download="x.自訂">`，Blob 是 `application/zip` 或 `application/octet-stream`，WebKit 都不動檔名（推論）。`WebKit-7621.1.2`、`WebKit-7621.2.5.14.9` 只有 `appendFileExtensionIfNecessary` 這一步，結果一樣。

另外要知道的（原始碼）：

- 2026-03 的修改（310122@main）加了 `correctExtensionForMIMEType`：**從網址猜的檔名**，副檔名跟回應的 MIME 對不上，就換成 MIME 的副檔名。修改說明寫「Does not modify filesnames from Content-Disposition headers or download attributes.」[WK-310122]。
- 2026-05 的修改（314104@main）：兩邊都是壓縮檔的 MIME 才保留原副檔名 [WK-314104]。不認得的副檔名查不到 MIME，不算壓縮檔。
- 所以：如果將來伺服器直接給 `…/x.自訂` 這種網址、回 `application/zip`、又沒有 `Content-Disposition` 的檔名，新版 WebKit 會存成 `x.zip`（推論）。有 `Content-Disposition: attachment; filename=…` 就不會改。
- WebKit 交出檔名後，Safari 自己還可能做什麼（例如 macOS 的「下載後打開安全的檔案」會不會把 `application/zip` 的自訂檔解開），看不到（查不到，步驟 E）。

### 5.2 iOS Safari 分享（5b）

原始碼：

- `Navigator::canShare`：只看文件是否在前景、權限政策、有沒有內容，**不看檔案類型** [SRC-NAV]。
- `WKShareSheet.mm`：每個檔照給的檔名（先清掉不能用的字）寫進暫存資料夾；分享時的型別先問檔案自己的型別，沒有就照副檔名 `[UTType typeWithFilenameExtension:]`，再不行就 `public.data` [SRC-SHARE]。`File` 的 `type`（`application/zip`）在這裡沒用到（推論）。
- 所以 `x.自訂` 分享出去，型別由副檔名決定：裝了 app 的 iPhone 上是 app 的型別，分享選單可能列出 app；沒裝就是動態型別（推論，步驟 F）。

### 5.3 Chrome 的存檔、開檔對話框（5c）

規格（已確認，[FSA] 3.2.1）：

- 「Extensions have to be strings that start with a "." and only contain valid suffix code points. Additionally extensions are limited to a length of 16 code points.」
- 「A valid suffix code point is a code point that is ASCII alphanumeric, U+002B (+), or U+002E (.).」
- 副檔名「.」結尾丟 `TypeError`；MIME 鍵解析失敗或帶參數丟 `TypeError`。
- 規格建議：「Websites should always provide both MIME types and file extensions for each option.」

Chromium 原始碼 [CR-GFSA]：

- 錯誤訊息照規格：「must start with '.'」「contains invalid characters」「must not end with '.'」「cannot be longer than 16 characters」。16 是含開頭那個點的長度（`extension.length() > 16`）。
- MIME 鍵要是「`type/subtype`」兩段、都是合法的 HTTP token。vendor MIME（`application/vnd.x.y+zip`）合法。
- 瀏覽器端另外擋 `.lnk`、`.local`、`.scf`、`.url` 和 `{…}` 這幾種副檔名 [CR-FSC]。

電腦版（Windows、Mac、Linux；原始碼，[CR-FSC] [CR-MIME]）：

- 對話框的篩選清單：「The returned list will start with all the explicit website provided extensions in order, followed by (for each mime type) the preferred extension for that mime type (if any) and any other extensions associated with that mime type.」
- MIME 鍵各會多出什麼（推論，照 Chromium 自己的對照表；作業系統登記的另外會加）：

| MIME 鍵（副檔名都寫 `.自訂`） | 篩選清單 |
|---|---|
| `application/zip` | 自訂、zip（兩種都能選） |
| `application/octet-stream` | 自訂、bin、exe、com（`application/octet-stream` 沒有首選副檔名，但次要對照表把它對到 `bin,exe,com`） |
| `application/vnd.…+zip`（沒人登記） | 只有自訂 |

- 建議檔名（`suggestedName`）：副檔名在篩選清單裡就原樣用，並選那個篩選；不在清單裡就另外開「所有檔案」；超過 16 字的副檔名會被剪掉（`ResolveSuggestedNameExtension`）。所以 `x.自訂` 加上寫了 `.自訂` 的清單，檔名不變。
- 對照現在的 `save.ts`：`{'application/zip': ['.zip']}`，建議檔名 `流程名.zip`。

Android 的存檔（推論，步驟 G）：

- Chrome 把 MIME 清單的第一個當成 `ACTION_CREATE_DOCUMENT` 的類型，建議檔名當 `EXTRA_TITLE` [CR-SFD] [CR-SFD-CC]。
- Android 本機儲存空間建檔時用 `splitFileName(mimeType, displayName)`：副檔名換出的 MIME 跟要求的 MIME 對不上、要求的 MIME 的副檔名也跟檔名的不一樣，就「insist that create file matches requested MIME」，把整個檔名當主檔名，再補 MIME 的副檔名 [AOSP-FU] [AOSP-FSP]。

| MIME 鍵 | 建議檔名 | 推論存成 |
|---|---|---|
| `application/zip` | `x.自訂` | `x.自訂.zip` |
| `application/octet-stream` | `x.自訂` | `x.自訂`（Chrome 遇到 octet-stream 會先用副檔名查 MIME，查不到還是 octet-stream；Android 遇到 octet-stream 不補副檔名） |
| `application/vnd.…+zip`（Android 不認得） | `x.自訂` | `x.自訂`（查不到 MIME 的副檔名，什麼都不補） |

- 這只是 Android 本機儲存空間的寫法。Google 雲端硬碟等其他位置怎麼命名，沒查。

電腦版 Chrome 下載 `<a download="x.自訂">`：檔名已經有副檔名、又沒要求忽略時，Chromium 不換副檔名 [CR-FN]（原始碼，只讀了產生檔名那一段）。Android 的下載會寫進系統的下載資料夾，系統的媒體資料庫也用同一套 `splitFileName` [AOSP-MP]；所以 Blob 是 `application/zip` 時也可能變 `x.自訂.zip`（推論）。

### 5.4 Chrome 的 Web Share 能分享哪些檔（5d）

原始碼 [CR-SHARE] [CR-SHARE-AND] [CR-SHARE-MD]：

- 允許的副檔名（41 個）：avif、bmp、css、csv、ehtml、flac、gif、htm、html、ico、jfif、jpeg、jpg、m4a、m4v、mp3、mp4、mpeg、mpg、oga、ogg、ogm、ogv、opus、pdf、pjp、pjpeg、png、shtm、shtml、svg、svgz、text、tif、tiff、txt、wav、weba、webm、webp、xbm。
- 允許的 MIME（28 個）：`application/pdf`、音訊 7 個、圖片 11 個、文字 5 個（`text/comma-separated-values`、`text/css`、`text/csv`、`text/html`、`text/plain`）、影片 4 個。
- 副檔名和 MIME **兩個都要在清單裡**才放行。zip、自訂副檔名都不行。
- 電腦版（Windows、Mac、ChromeOS）和 Android 是同一份清單，三個檔案互相註明要同步。
- 另外一次最多 10 個檔、合計最多 50 MB（`kMaxSharedFileCount = 10`、`kMaxSharedFileBytes = 50U * 1024 * 1024`），超過也是 `NotAllowedError` [CR-NAVSHARE]。
- `canShare()` 在 Blink 只檢查有沒有內容、網址對不對，不看檔案類型 [CR-NAVSHARE]。所以帶 zip 的 `canShare({files})` 回 true，`share()` 才被瀏覽器拒絕，錯誤是 `NotAllowedError`（「Permission denied」）。

對照現在的 `save.ts`（推論）：它只在「沒有 `showSaveFilePicker`」而且觸控螢幕時才走分享。Chrome Android 132 起有 `showSaveFilePicker` [BCD]，所以 Android Chrome 不會走到分享；iPhone、iPad 的 Safari 走分享，WebKit 不擋 zip。沒有 `showSaveFilePicker` 的 Chromium 系瀏覽器（例如舊版 Chrome Android）會在 `share()` 收到 `NotAllowedError`，`save.ts` 會把它丟出去，不會退回下載。

## 6. LINE

讀法：用 `curl` 抓 help.line.me 的網頁全文（內容在 HTML 裡，不用跑 JavaScript），中文（繁體）、英文、日文版都讀了關鍵那一頁。說明中心的搜尋頁查過這些字（手機版和電腦版的說明中心都查了）：

- 中文：檔案、大小、1GB、zip、壓縮、資料夾、無法傳送檔案、儲存檔案、檔案類型、不支援、檔案格式、支援的檔案、無法傳送、傳送檔案、檔案種類、副檔名、PDF、Office。
- 英文：file、file size、open file、compress、zip、file type、unsupported、not supported、send file、extension、PDF。
- 日文：zip、圧縮、ファイル、ファイル形式、対応していない、送信できない、サポート、拡張子、PDF。

搜到的頁面裡，標題跟傳檔、使用限制、傳送失敗有關的都讀了（見 6.2 和文末來源），沒有一頁列出能傳的檔案類型或大小。關鍵那一頁（contentId=20007005）的手機版網址和電腦版網址（`/line/desktop/pc?…`）抓下來，中文、日文的文字都一模一樣。

一般搜尋：限定 official-blog.line.me、linecorp.com、lycorp.co.jp、help.line.me、guide.line.me 這幾個 LINE 自己的網域，用「LINE 傳送檔案 zip 檔案類型」「LINE ファイル 送信 zip 形式」查，只多找到一篇 2013 年的官方部落格（6.2）和兩篇 2015-12 講 Keep 的 LINE 台灣官方部落格（講 Keep 的容量，不是聊天室傳檔，不採用）。不限網域的搜尋只找到工具商和部落格的文章。

### 6.1 真機結果（站主轉述，2026-11-22）[DEVICE]

第一次：

1. 用 LINE 傳 `app-feel-test.cheerb`，收到的是 `.zip`。收的人要先存到「檔案」，「檔案」App 解開（第 1 節）變回 `.cheerb`，再點它才開小樣。超過三下。
2. 用 LINE 傳 `app-feel-test.zip`：站主說「差不多」，細節不清楚。

第二次（補上第一次不知道的）：

3. 第 1 點是 **Mac 電腦版** LINE 傳的。iPhone 收到的檔名是 `app-feel-test.zip`：`.cheerb` 被換成 `.zip`，不是變成 `app-feel-test.cheerb.zip`。存到「檔案」點一下，解出 `app-feel-test.cheerb`。
4. **iPhone 的 LINE 不讓傳 `.cheerb`**：分享到 LINE 時顯示「不支援這種檔案」（這是轉述的字，畫面上的原文沒有記下）。iPhone 版不會自己包成 zip，是直接拒絕。

還不知道：iPhone 那次是分享到 LINE；從聊天室的「加號圖示＞檔案」選，結果一不一樣。Mac 包的 zip 裡是只有那一個檔，還是多一層資料夾。iPhone 版收不收 `.zip`。

### 6.2 LINE 官方寫了什麼

已確認：

- 傳檔（手機）：「於主要裝置的聊天室內點選下方的［加號圖示］＞ 檔案 ＞ 選擇希望傳送的檔案 ＞ 點選 傳送 或 確定」（圖示的替代文字是「加號圖示」）。iPad／Android 的追加裝置一樣。**手機那兩段沒有提到 zip** [LINE-SEND]。
- 傳檔（Windows／Mac）：把檔案拖進聊天室，或點聊天室下方的圖示選檔。接著：「若希望傳送系統未支援的檔案類型，請先將檔案轉換為zip檔案後再傳送。」英文版：「If the file type you are sending is not supported, you can send it as a zip file.」日文版：「サポートしていないファイル形式の場合、zipファイルに変換して送信してください。」這句只出現在 Windows／Mac 那兩段（照片影片一段、檔案一段）[LINE-SEND]。
- 聊天室的「照片⋅影片」一覽有「檔案」分頁；點檔案右邊的圖示，可以「分享、傳送至Keep筆記、跳到該則訊息」[LINE-LIST]。電腦版：「點擊檔案即可將該筆檔案下載至電腦上。」
- 以「檔案」形式傳的資料有閱覽期限。主頁有「即將過期的檔案」列表（只在主要裝置）。「若在過期前用戶曾開啟檔案，系統即會將其儲存於裝置快取中。於此情況下，即使已超過有效期限，用戶仍可查看該檔案。」[LINE-EXPIRE]
- 照片、影片「儲存於本公司伺服器內的圖片及影片設有保存期限」「我們無法針對上述檔案保存期限提供詳細說明。」[LINE-MEDIA]
- LINE 官方部落格 2013-03-13（電腦版 ver.3.1.4.73）：「これまでPC版LINEからは、画像・動画・音声データのみ送信が可能でしたが、新しいバージョンでは、「ファイルの送信」からワード・エクセル・パワーポイント・PDFなどを含めた様々な形式のファイル※が送信可能です。（※一部の特殊な形式のファイルを除く）」[LINE-BLOG-2013]。十幾年前的文章，「特殊な形式」是哪些也沒寫。
- 另外讀了「LINE的使用限制相關說明」「無法傳送或接收聊天訊息」「突然無法傳送LINE的聊天訊息」「LINE的使用環境」「Keep筆記的基本使用方法」「【Android】於聊天室內傳送或接收圖片⋅影片…的相關問題」幾頁（中文；使用限制、使用環境、Keep 筆記三頁另讀日文）[LINE-OTHER]：都沒有提到哪些檔案類型可以傳、哪些不行，也沒有大小上限。Keep 筆記那頁只寫可以「傳送文字⋅連結⋅圖片⋅影片⋅檔案」。

### 6.3 什麼時候被包、什麼時候被拒

| 條件 | 查到的 | 多確定 |
|---|---|---|
| Mac 電腦版傳不支援的類型 | **包成 zip，而且把副檔名換成 `.zip`**：`app-feel-test.cheerb` → `app-feel-test.zip`，裡面是原本的 `app-feel-test.cheerb` [DEVICE]。一篇 2020-11-28 的 PTT 使用者文章也是 Mac：「我在mac上用line分享一個mobi格式的檔案要給朋友，結果檔案傳出去變zip格式」；回文「不被支援的格式就會變成zip格式送出的樣子 沒法改」[PTT-MAC]。官方那句「請先將檔案轉換為zip」也只寫在電腦版段落（6.2） | 真機＋次級 |
| iPhone 版傳不支援的類型 | **不包，直接拒絕**：`.cheerb` 從分享選單分享到 LINE，顯示「不支援這種檔案」（轉述）[DEVICE]。聊天室「加號圖示＞檔案」那條路沒試。官方手機段落沒提 | 分享選單：真機。聊天室選檔：沒試 |
| Windows 版、Android 版 | 官方的電腦版段落把 Windows 和 Mac 寫在一起；Windows 會不會也包、Android 會不會也拒：查不到、沒試 | 查不到 |
| 哪些類型算「支援」 | 官方說「系統未支援的檔案類型」，手機版、電腦版都沒有清單；2013 年的官方部落格只說「一部の特殊な形式のファイルを除く」[LINE-BLOG-2013]。看副檔名還是看檔案內容、iPhone 版是不是看 iOS 的型別：查不到 | 查不到 |
| `.zip` 會不會原樣送 | 官方叫人「先轉換為zip」、Mac 版自己也包成 zip，推論 zip 是支援的，至少電腦版會原樣送。iPhone 版收不收 `.zip`：站主第一次試說「差不多」，對不上是哪一種 | 推論；iPhone 要真機 |
| `.pdf` 會不會原樣送 | 查不到（只有部落格文章說可以傳 PDF、Office 檔，不採用） | 查不到 |
| 看大小 | 官方沒寫。PTT 那個例子是 2.3 MB，原 PO 說「實在不需要壓縮」，不像是因為太大才包 | 查不到 |
| 看一次傳幾個檔 | 官方沒寫 | 查不到 |
| 能不能讓 LINE 不包、不拒 | 說明中心沒有相關設定。PTT 回文說「沒法改」 | 查不到 |

照上面推下去（推論，要真機驗的見步驟 H）：

- **自訂副檔名的流程檔，從 iPhone 的分享選單傳不進 LINE**（`.cheerb` 真機；聊天室「加號圖示＞檔案」那條路沒試，要步驟 H1。別的自訂副檔名推論一樣，除非 iPhone 版是照 iOS 型別判斷，而 app 的型別又 conform 到它認得的型別，例如 `public.zip-archive`；這要步驟 B 的 `.cheerc` 去試）。
- **從 Mac 傳，收到的是 `流程名.zip`，裡面是 `流程名.自訂`**。iPhone 收的人：存到「檔案」→「檔案」App 解開 → 點自訂檔，超過三下（真機）。或在 LINE 裡點檔案 → 分享 → app：app 要宣告收 zip，收到的是「zip 裡包一個自訂檔，自訂檔本身又是 zip」。現在的讀檔規則只認 `flow.json` 在最上層或唯一一層資料夾裡（`docs/flow-file-format.md`），認不得這種。
- **副檔名就是 `.zip` 的流程檔**（現在網站存的樣子）：電腦版推論原樣送。iPhone 版如果也收：收的人點檔案 → 分享 → app（app 宣告收 zip），可能三下內；但存到「檔案」再點就會被解開（第 1 節）。

查不到（說明中心沒有）：

- 「系統未支援的檔案類型」的清單，手機版、電腦版都沒有。
- iPhone 版拒絕時的判斷方式（副檔名、iOS 型別、檔案內容）。
- 收到一般檔案（不是照片、影片）時，在 iPhone 上怎麼用別的 app 打開、要點幾下。
- Windows 版會不會也包；Android 版會不會拒絕、改名或包起來。
- 傳檔的大小上限。搜尋到的數字（1 GB、200 MB）都是工具商或部落格的文章，互相也不一樣，不採用。
- 閱覽期限是幾天。

推論：

- 從 LINE 分享到 app，app 收到的是 LINE 交出來的一份檔案，不是使用者「檔案」App 裡的檔，寫不回去（見第 7 節）。

## 7. 存回原檔

### 7.1 從「檔案」App 點進來

已確認：

- `LSSupportsOpeningDocumentsInPlace`：「A Boolean value indicating whether the app may open the original document from a file provider, rather than a copy of the document.」[APPLE-INPLACE]
- 舊版鍵值參考寫得比較多：「The app can access documents from the system's local file provider, the iCloud file provider, and any third-party File Provider extensions that support opening documents in place. The URL for a document opened in place is security-scoped.」「When opening a document in place, other processes can modify the document at any time. Therefore, you must coordinate your access to the document using either a UIDocument subclass or NSFilePresenter and NSFileCoordinator objects.」[APPLE-PLIST-ARCHIVE]
- 收到網址時看 `UIScene.OpenURLOptions.openInPlace`：「When the value of this property is false, copy the document to your app's container before opening the file. When the value of this property is true, open the existing URL in its current location.」[APPLE-OPENINPLACE]
- 「檔案」App 點進來會不會是 `openInPlace = true`：Apple 沒有一句話直接寫（推論是，要真機看，步驟 I）。

### 7.2 寫入、書籤、下次開 app

已確認，`UIDocumentPickerViewController` 文件 [APPLE-DOCPICKER]：

- 「The open and move operations provide security-scoped URLs for all external documents. Call the startAccessingSecurityScopedResource() method to access or bookmark these documents」。
- 「Always use file coordinators (see NSFileCoordinator) to read and write to external documents.」
- 「Don't save URLs that the open and move operations provide. You can, however, save a bookmark to these URLs after calling startAccessingSecurityScopedResource()」。
- 這段又寫要傳 `withSecurityScope`，但 `withSecurityScope` 這個選項**只有 macOS** 有 [APPLE-BOOKMARK-SCOPE]。iOS 的範例（選資料夾那篇）用的是 `.minimalBookmark`，解回來就是 security-scoped 網址，還要處理書籤過期（`isStale`）和使用者在設定裡收回權限 [APPLE-DIRS]。
- `startAccessingSecurityScopedResource()` 要跟 `stop…` 成對呼叫，不還會漏核心資源，最後連書籤都開不了，要重開 app [APPLE-SSR]。

推論：

- 「檔案」App 原地打開的網址也是 security-scoped [APPLE-PLIST-ARCHIVE]，所以照同一套存書籤、下次解回來寫應該可以。Apple 只對選檔器的網址明寫可以存書籤，對 `openURLContexts` 的網址沒寫。要真機驗（步驟 I）。

### 7.3 iCloud 還沒下載的檔

已確認：

- `NSFileCoordinator` 的協調讀取：「If the device has not yet downloaded the file at the given URL, this method blocks (potentially for a long time) while the file is downloaded. If the file cannot be downloaded, this method fails.」也可以先用 `startDownloadingUbiquitousItem(at:)` 叫它下載 [APPLE-COORD] [APPLE-ICLOUD-DL]。

### 7.4 從 LINE 分享進來

已確認：

- `openInPlace` 是 false 時，要先複製到 app 自己的資料夾再開 [APPLE-OPENINPLACE]。
- 舊文件：`Documents/Inbox`「Use this directory to access files that your app was asked to open by outside entities. … Your app can read and delete files in this directory but cannot create new files or write to existing files.」[APPLE-FS]（2018 年的文件）

推論：

- LINE 的檔在 LINE 自己的沙盒裡，app 收到的是副本（`openInPlace` false，放在 Inbox 或暫存資料夾），寫回去也不會改到 LINE 裡那份。存檔要另外問使用者存到哪（7.5）。要真機看實際路徑（步驟 I）。

### 7.5 新流程第一次存檔：`init(forExporting:asCopy:)`

已確認：

- 參數 `asCopy`：「A Boolean value that indicates whether the document picker copies the selected document.」iOS 14 起 [APPLE-EXPORT]。
- 「Export a local document. The user selects a destination. The document picker moves the document, and the user can access it and edit it in place. Optionally, you can specify that the document picker makes a copy of the document, leaving the original unchanged.」[APPLE-DOCPICKER]
- 選完的網址：「UIDocumentPickerModeExportToService: The URLs refer to new copies of the exported documents at the selected destination.」「UIDocumentPickerModeMoveToService: The URLs refer to the documents' new locations.」「The provided URLs are security-scoped」[APPLE-DIDPICK]
- 舊版指南（2015）：搬（move）「You are then given a new security-scoped URL to access the new file.」原本那份會從 app 沙盒刪掉。匯出（export，複製）「The document picker provides the copy's URL to indicate success; however, your app does not have access to the file referred to by this URL.」[APPLE-PICKER-GUIDE]

| | `asCopy: false`（搬過去） | `asCopy: true`（複製過去） |
|---|---|---|
| app 裡的暫存檔 | 被搬走 | 留著 |
| 拿到的網址 | 新位置，security-scoped，可以繼續寫（已確認） | 新文件說是 security-scoped；舊指南說 app 碰不到。**兩邊對不上（未確認）**，要真機驗 |
| 存書籤、下次開 app 再寫 | 推論可以（同 7.2） | 未確認 |

### 7.6 Google Drive、OneDrive 等第三方位置

- Apple 只寫原地打開支援「any third-party File Provider extensions that support opening documents in place」[APPLE-PLIST-ARCHIVE]。
- Google Drive、OneDrive 的 iOS app 支不支援原地打開、寫回去會不會同步、書籤會不會失效：沒查（沒去找它們的文件），要真機（步驟 I）。

## 8. 副檔名和 MIME

### 8.1 候選副檔名有沒有人用

| 副檔名 | FileInfo | FilExt | 型別（Mac、iOS 模擬器）[MAC-UT] [SIM-UT] |
|---|---|---|---|
| `.cheer` | 404（沒有這一頁） | 404 | 動態型別 |
| `.cheerflow` | 404 | 404 | 動態型別 |
| `.routine` | 404 | 404 | 動態型別 |
| `.cheerroutine` | 404 | 沒查 | 動態型別 |
| `.cheerb`（小樣） | 404 | 沒查 | 動態型別 |

- 對照：兩個網站的 `.zip` 頁都回 200，所以 404 是「沒收錄」，不是網站擋掉 [FILEINFO] [FILEXT]。
- 這兩個是民間整理的清單，不是登記處；副檔名沒有官方登記機構（查不到有）。搜尋引擎也查了 `.cheer`、`.routine`，沒有找到哪個知名 app 在用（只有一個民間網站列了不同的 `.routines`）。
- 這台 Mac 和模擬器沒裝任何宣告這些副檔名的 app。別人手機上有沒有 app 宣告同一個副檔名，查不到。兩個 app 宣告同一個副檔名時誰贏，Apple 沒寫（查不到）。

### 8.2 長度、字元

- Chrome 的存檔、開檔對話框：含點最多 16 字，只能英數字、`+`、`.`（5.3）。`.cheerroutine` 13 字，都在範圍內。
- Apple 的型別識別字（不是副檔名）只能英數字、`-`、`.` [APPLE-UTDEF]。副檔名本身的字元限制，Apple 文件沒寫（查不到）。
- 大小寫：WebKit、Chromium 比對副檔名時大多不分大小寫（原始碼裡多處 `ASCIICaseInsensitive`、`toLowerCase`），全部用小寫最不會出事（推論）。

### 8.3 會不會被擋

- Gmail 擋的副檔名清單（.ade、.adp、.apk、… .exe、… .xll）沒有這幾個候選，也沒有 `.zip`。但 Gmail 會看 zip 裡面：清單裡的類型「when found within archives (like .zip or .tgz files)」也擋，有密碼的壓縮檔也擋 [GMAIL]。流程檔裡只有 `flow.json` 和音樂檔（`docs/flow-file-format.md`），推論不會被擋。副檔名不是 `.zip` 的 zip 會不會被打開來看，查不到。
- Outlook 擋的是一份清單裡的副檔名；不在清單上的就不擋（推論，[OUTLOOK] 只列清單）。
- LINE：iPhone 版從分享選單拒絕傳 `.cheerb`（聊天室裡選檔沒試），Mac 電腦版把它包成同名 `.zip`（真機，第 6 節）。別的自訂副檔名推論一樣。
- Windows 檔案總管「隱藏已知檔案類型的副檔名」：微軟的正式說明查不到，只有社群問答。照字面，沒有程式認領的副檔名會照樣顯示（推論）。

### 8.4 要不要用 vendor MIME

已確認：

- vendor 樹：「A registration may be placed in the vendor tree by anyone who needs to interchange files associated with some product or set of products.」以 `vnd.` 開頭；可以直接送 IANA，「will undergo Expert Review prior to approval」[RFC6838]。
- 不登記的 `x.` 樹「strongly discouraged」；`x-` 開頭的已經不算這一樹 [RFC6838]。
- `+zip` 字尾：「The suffix "+zip" MAY be used with any media type whose representation follows that established for "application/zip".」[RFC6839]
- IANA 的 application 清單現在有 45 個 `+zip` 型別，例如 `application/epub+zip` [IANA-APP]。

實際差別（原始碼＋推論）：

| 地方 | `application/zip` | `application/vnd.….+zip`（自己的） |
|---|---|---|
| Safari `<a download="x.自訂">` | 檔名不變（5.1） | 檔名不變 |
| 伺服器給網址、沒有 `Content-Disposition` 檔名（新版 WebKit） | 可能被改成 `x.zip`（5.1） | MIME 查不到副檔名，推論不改 |
| iOS Safari 分享 | 型別看副檔名，MIME 沒用到（5.2） | 同左 |
| 電腦版 Chrome 存檔、開檔對話框 | 篩選清單多出 zip（5.3） | 只有寫的副檔名 |
| Android Chrome 存檔對話框 | 可能變 `x.自訂.zip`（5.3） | `x.自訂` |
| Android Chrome 開檔對話框 | 只篩 zip，`.自訂` 推論選不到（4.2） | 不篩，都能選 |
| Android Chrome `<a download>` | 可能變 `x.自訂.zip`（5.3） | 推論不變 |
| Chrome Web Share | 不在清單，被拒（5.4） | 不在清單，被拒 |
| iOS 型別的 `public.mime-type` 標籤 | `application/zip` 已經是系統 `public.zip-archive` 的 MIME 標籤 [MAC-CORETYPES]；自訂型別再寫同一個，就有兩個型別用同一個 MIME，`UTType(mimeType:)` 會回哪一個，Apple 沒寫（查不到） | 寫了，`UTType(mimeType:)` 才找得到 app 的型別；WebKit 選檔是走這條路（3.1） |

- 還有第三種：`application/octet-stream`。Android 上檔名不會被補 `.zip`（5.3），WebKit 也不補（5.1）；電腦版 Chrome 的篩選清單會多出 bin、exe、com（5.3）；而且什麼類型都沒說。
- 不登記直接用 `application/vnd.…`：RFC 只說登記「may」，沒有說不登記不能用。瀏覽器不會去查 IANA（推論）。

## 9. 跟現有程式、小樣的關係（只列事實）

- 網頁現在選檔是 `accept=".zip"`（`src/routes/+page.svelte` 兩處）；`showOpenFilePicker`（開檔）和 `showSaveFilePicker`（存檔）的 `types` 都是 `zipTypes()`，也就是 `{'application/zip': ['.zip']}`（`save.ts` 第 48、73、93 行）。改副檔名的話，這幾處在 Safari、電腦版和 Android Chrome 的行為照第 3、4、5 節。
- 小樣的型別 conform 到 `public.data` + `public.content`，跟 Apple 的文件寫法、系統的 docx／epub 一樣；小樣把 `public.zip-archive` 宣告成 Alternate（真機：搶不到「檔案」App 點 zip）。照 3.1 推論：小樣裡的網頁 `accept=".zip"` 選不到 `.cheerb`。
- `docs/flow-file-format.md` 寫「存成 `流程名.zip`」。副檔名一改，那份文件要跟著改（AGENTS.md 的規定）。這份筆記沒有改它。

## 查不到、要真機驗

要真機才知道的。步驟都可以用小樣（`prototypes/app-feel/` 那支，`.cheerb` 是 Owner、`public.zip-archive` 是 Alternate、`LSSupportsOpeningDocumentsInPlace = YES`）直接跑。範例檔用 `docs/samples/sample-flow.zip`（只有假名），另外複製一份改名成 `sample-flow.cheerb`。每一項都記下 iOS 版本、LINE 版本（LINE 的「設定＞關於LINE」）。

**A. 「檔案」App 點 `.zip`**（Alternate 那一半站主已經試過：解開，沒開 app）

1. 按住 `sample-flow.zip` → 分享，看分享選單有沒有小樣；有的話點下去，記下小樣收到的網址路徑和 `openInPlace`。
2. 把小樣的 zip 改成 Owner，重新安裝。點一下 `sample-flow.zip`：還是解開嗎？再做 1。
3. 1、2 在 iCloud Drive 的資料夾再做一次。

**B. 自訂型別 conform 到 zip**

1. 小樣多宣告一個型別：識別字 `com.littlebluewhite.feel.c`、副檔名 `cheerc`、conform 到 `public.zip-archive` 和 `public.content`，Owner。
2. 複製一份 `sample-flow.cheerc` 放進「檔案」。點一下：解成資料夾還是開小樣？
3. 按住看選單有沒有「解壓縮」；看預覽圖示。
4. 對照組 `sample-flow.cheerb` 做一樣的事。

**C. 網頁選檔（`accept`）**

做一頁只有三個選檔欄位的測試頁：`accept=".zip"`、`accept=".zip,.cheerb,.cheerc"`、`accept=".cheerb"`。

1. iPhone Safari，沒裝小樣：三個欄位各看 `.zip`、`.cheerb`、`.cheerc` 能不能點。
2. 裝了小樣再做一次。
3. macOS Safari 做一次。

**D. 小樣裡的 WKWebView**

1. 測試頁放進小樣，三個欄位各做一次 C 的檢查。
2. 小樣實作 `webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`，用 `UIDocumentPickerViewController(forOpeningContentTypes: [.cheerb 的型別, .zip])` 開，確認網頁收到檔案。

**E. 下載**

1. iPhone Safari：`<a download="t1.cheerb">`，Blob 分別用 `application/zip`、`application/octet-stream`。到「檔案」的「下載項目」看檔名。
2. macOS Safari 同樣做，「下載後打開『安全』的檔案」開著和關著各一次，看會不會被解開或改名。

**F. iOS Safari 分享**

1. `navigator.share({files: [new File([zip], 't2.cheerb', {type: 'application/zip'})]})`，裝了小樣：分享選單第一排有沒有小樣、要點幾下。
2. 點小樣，記下收到的網址路徑和 `openInPlace`。

**G. Android Chrome 和電腦版 Chrome**

1. Android：`showSaveFilePicker`，建議檔名 `t3.cheerb`，`types` 分別是 `{'application/zip': ['.cheerb']}`、`{'application/octet-stream': ['.cheerb']}`、`{'application/vnd.example.flow+zip': ['.cheerb']}`，存到「下載」。用檔案管理員看實際檔名。
2. Android：`showOpenFilePicker` 用同三組 `types`，看 `t3.cheerb` 能不能點。
3. Android：`<input type="file">` 用 C 的三個 `accept` 看能不能點。
4. Android：`<a download="t4.cheerb">`，Blob 分別是 `application/zip`、`application/octet-stream`，看下載資料夾裡的檔名。
5. 電腦版 Chrome（Windows、Mac）：1、2 各做一次，看對話框的篩選下拉選單列出哪些副檔名、存出來的檔名。

**H. LINE：iPhone 版收什麼、Mac 版包成什麼、`.zip` 能不能原樣到**

已知（真機）：Mac 電腦版把 `app-feel-test.cheerb` 包成 `app-feel-test.zip`；iPhone 版從分享選單拒絕傳 `.cheerb`（轉述的訊息是「不支援這種檔案」）。

準備：收檔的一律是裝了小樣的 iPhone。傳的檔用同一份內容（`sample-flow.zip` 複製改名），另外準備一個真的 PDF、一個 `.txt`。每傳一次，收的人在**點開之前**記下：聊天室裡顯示的檔名、「照片⋅影片＞檔案」分頁裡顯示的檔名。

1. **iPhone 版能傳什麼**：在 iPhone 用兩條路各傳一次：聊天室「加號圖示＞檔案」，和「檔案」App 按住檔案 → 分享 → LINE。檔案是 `t.zip`、真的 `t.pdf`、`t.txt`、`t.json`、`t.abcxyz`（隨便一個沒人用的副檔名）、`t.cheerb`。記下哪些被拒（截圖，記下畫面上的原文）、哪些在選檔畫面是灰的、哪些傳得出去。
2. **iPhone 版是看副檔名還是看 iOS 型別**：裝了步驟 B 的小樣（`.cheerc` conform 到 `public.zip-archive`）之後傳 `t.cheerc`。再把一個純文字檔改名成 `t2.zip` 傳，看會不會被擋。再找一台**沒裝小樣**的 iPhone 傳 `t.cheerb`（那台上 `.cheerb` 是動態型別），跟有裝的那台比。
3. **`.zip` 有沒有原樣到**：iPhone 傳的 `t.zip`、Mac 傳的 `t.zip`，收的人看到的檔名和大小；存到 Mac 用 `shasum` 跟原檔比，看是不是同一份（沒有被再包一層）。
4. **Mac 包的 zip 裡面是什麼**：Mac 傳 `t.cheerb`，收到 `t.zip`，存到 Mac 用 `unzip -l t.zip` 看是只有 `t.cheerb` 一個檔，還是多一層資料夾。
5. **Mac 拖曳和按鈕一樣嗎**：Mac 版用拖曳、用聊天室下方的圖示選檔，各傳一次 `t.cheerb`。
6. **Windows、Android 傳**：Windows 版、Android 版各傳 `t.cheerb` 和 `t.zip`：被拒、被包、還是原樣到。
7. **大小、數量**：從 Mac 版傳約 100 KB、10 MB、100 MB 的 `t.cheerb`（用大的音樂檔做流程檔）；一次拖 1 個和 3 個。看是不是一個檔包一個 zip、錯誤訊息怎麼寫。
8. **數幾下**：iPhone 收到原樣的 `t.zip` 時，從聊天室開始一下一下記，直到小樣打開：點檔案後有沒有預覽、分享鈕在哪、分享選單裡小樣排在哪。Mac 包過的 `t.zip` 也記一次（小樣收到的是 zip 裡包一個 `.cheerb`）。
9. **別的平台收**：Mac 傳的 `t.cheerb`，在 Android、Windows、Mac 的 LINE 收，看檔名是不是也變 `t.zip`。

**I. 存回原檔**

在小樣裡加記錄：收到的網址、`openInPlace`、`startAccessingSecurityScopedResource()` 的回傳值、用 `NSFileCoordinator` 寫入成不成功、存書籤成不成功。

1. 「我的 iPhone」裡點 `sample-flow.cheerb` → 小樣寫一次 → 「檔案」看修改時間。
2. 存書籤 → 把小樣滑掉關閉 → 重開 → 解書籤 → 再寫一次。看 `isStale`。
3. iCloud Drive：先在「檔案」對那個檔按「移除下載項目」，再點開，看讀取要等多久、寫入成不成功。
4. Google Drive、OneDrive 的資料夾各做 1、2。
5. 從 LINE 分享進小樣：記下網址路徑（是不是在 `Documents/Inbox` 或 `tmp`）和 `openInPlace`。
6. 新流程：用 `UIDocumentPickerViewController(forExporting:asCopy:)` 存到「我的 iPhone」，`asCopy` 分別是 false、true。拿回的網址能不能寫、能不能存書籤、重開 app 後能不能再寫。

沒有一手來源的：

- 「檔案」App 點 zip 時，宣告 Owner 的 app 能不能搶走（Alternate 已經真機確認搶不到）。
- 「檔案」App 是照副檔名還是照型別決定解壓縮。
- 兩個 app 宣告同一個副檔名時，iOS 選誰。
- `NSURLFileTypeMappings`（私有介面）讀不讀得到 app 宣告的型別。
- macOS Safari 的選檔視窗怎麼用 `accept`。
- LINE 能傳的檔案類型清單（手機、電腦都沒有）、iPhone 版拒絕時看什麼判斷、`.zip` 在 iPhone 版能不能傳、Windows 和 Android 版怎麼處理、大小和數量會不會影響、能不能關掉、收檔後的操作、大小上限、閱覽期限天數。
- `forExporting` 加 `asCopy: true` 拿回的網址能不能用（兩份 Apple 文件說法相反）。
- Windows 檔案總管隱藏副檔名的官方說明。

沒查的：Google Drive、OneDrive 支不支援原地打開；Android 下載到雲端硬碟時的命名。

這次比較薄的：第 6 節（LINE）的規則幾乎都要真機；官方只有一句，規則是從那一句、站主的結果和一篇使用者文章推的。第 8.1 節只查了兩個民間清單和一般搜尋。iOS 的型別是在模擬器上查的，真機推論一樣。GitHub 上找不到 iOS 18.4 剛好那一版的 WebKit tag，用 7621 系列最早和最新的兩個夾著。

## 來源

全部在 2026-11-22 查。讀法：

- Apple 開發者文件讀同一路徑的 JSON 資料檔（`https://developer.apple.com/tutorials/data/documentation/….json`），下面列給人看的網址。舊文件庫（library/archive）、Apple 支援、LINE 說明中心、Gmail、Outlook、RFC、IANA、規格、PTT 都用 `curl` 抓全文，用關鍵字找段落再讀上下文。
- WebKit、Android 原始碼用 raw 檔抓；Chromium 用 googlesource 的 `?format=TEXT`。長檔案沒有逐行讀完。
- 搜尋工具只拿來找網址，摘要不當來源。

**真機**

- [DEVICE] 站主 2026-11-22 用 `prototypes/app-feel/` 的兩支小樣在 iPhone 上試的結果，經協調的代理分兩次轉述：「檔案」App 點 `app-feel-test.zip` 解成資料夾、沒開 app；Mac 電腦版 LINE 傳 `app-feel-test.cheerb`，iPhone 收到 `app-feel-test.zip`，存到「檔案」點開解出 `app-feel-test.cheerb`；iPhone 版 LINE 分享 `.cheerb` 顯示「不支援這種檔案」；LINE 傳 `app-feel-test.zip`「差不多」（細節不明）。LINE、iOS 的版本號沒有轉述。

**Apple**

- [APPLE-ZIP] 在 iPhone、iPad 或 Apple Vision Pro 上建立或打開 ZIP 檔（Published Date: October 29, 2026）：https://support.apple.com/zh-tw/102532 、https://support.apple.com/en-us/102532
- [APPLE-FILES] iPhone User Guide「Organize files and folders in Files on iPhone」（Zip or unzip a file or folder）：https://support.apple.com/en-us/guide/iphone/iphab82e0798/ios
- [APPLE-UTDEF] Defining file and data types for your app：https://developer.apple.com/documentation/uniformtypeidentifiers/defining-file-and-data-types-for-your-app
- [APPLE-UTZIP] UTType.zip：https://developer.apple.com/documentation/uniformtypeidentifiers/uttype-swift.struct/zip
- [APPLE-UTPKG] UTType.package：https://developer.apple.com/documentation/uniformtypeidentifiers/uttype-swift.struct/package
- [APPLE-UTEXT] `init(filenameExtension:conformingTo:)`、`init(mimeType:conformingTo:)`：https://developer.apple.com/documentation/uniformtypeidentifiers/uttype-swift.struct/init(filenameextension:conformingto:) 、https://developer.apple.com/documentation/uniformtypeidentifiers/uttype-swift.struct/init(mimetype:conformingto:)
- [APPLE-RANK] LSHandlerRank：https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundledocumenttypes/lshandlerrank
- [APPLE-INPLACE] LSSupportsOpeningDocumentsInPlace：https://developer.apple.com/documentation/bundleresources/information-property-list/lssupportsopeningdocumentsinplace
- [APPLE-PLIST-ARCHIVE] Information Property List Key Reference（舊文件庫，Updated: 2018-06-04）：Core Foundation Keys（`LSHandlerRank`）https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html 、Launch Services Keys（`LSSupportsOpeningDocumentsInPlace`）https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/LaunchServicesKeys.html
- [APPLE-OPENINPLACE] `UIScene.OpenURLOptions.openInPlace`、`UIApplication.OpenURLOptionsKey.openInPlace`：https://developer.apple.com/documentation/uikit/uiscene/openurloptions/openinplace 、https://developer.apple.com/documentation/uikit/uiapplication/openurloptionskey/openinplace
- [APPLE-DOCPICKER] UIDocumentPickerViewController：https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller
- [APPLE-DIDPICK] `documentPicker(_:didPickDocumentsAt:)`：https://developer.apple.com/documentation/uikit/uidocumentpickerdelegate/documentpicker(_:didpickdocumentsat:)
- [APPLE-EXPORT] `init(forExporting:asCopy:)`：https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller/init(forexporting:ascopy:)
- [APPLE-DIRS] Providing access to directories：https://developer.apple.com/documentation/uikit/providing-access-to-directories
- [APPLE-SSR] `startAccessingSecurityScopedResource()`：https://developer.apple.com/documentation/foundation/url/startaccessingsecurityscopedresource()
- [APPLE-BOOKMARK-SCOPE] `NSURL.BookmarkCreationOptions.withSecurityScope`（只有 macOS 10.7 起）：https://developer.apple.com/documentation/foundation/nsurl/bookmarkcreationoptions/withsecurityscope
- [APPLE-COORD] NSFileCoordinator、`coordinate(readingItemAt:options:error:byAccessor:)`：https://developer.apple.com/documentation/foundation/nsfilecoordinator
- [APPLE-ICLOUD-DL] `startDownloadingUbiquitousItem(at:)`：https://developer.apple.com/documentation/foundation/filemanager/startdownloadingubiquitousitem(at:)
- [APPLE-PICKER-GUIDE] Document Picker Programming Guide「Accessing Documents」（舊文件庫，Updated: 2015-03-09）：https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/DocumentPickerProgrammingGuide/AccessingDocuments/AccessingDocuments.html
- [APPLE-FS] File System Programming Guide（舊文件庫，Updated: 2018-04-09，`Documents/Inbox`）：https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html
- [APPLE-OPENPANEL] `webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`（iOS 18.4 起）、WKOpenPanelParameters（iOS 18.4 起）：https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:runopenpanelwith:initiatedbyframe:completionhandler:) 、https://developer.apple.com/documentation/webkit/wkopenpanelparameters

**本機、模擬器**

- [MAC-CORETYPES] macOS 26.7.3（25G342）的 `/System/Library/CoreServices/CoreTypes.bundle/Contents/Info.plist`（`UTExportedTypeDeclarations`、`UTImportedTypeDeclarations`），和 `Contents/Library/` 底下子 bundle 的 `Info.plist`（共 822 筆宣告），用 Python `plistlib` 讀。
- [MAC-UT] 在這台 Mac 跑的 Swift 腳本：`UTType(filenameExtension:)`（zip、cheer、cheerflow、routine、cheerroutine、cheerb、docx、epub）、`UTType(mimeType:)`（`application/zip`、`application/octet-stream`、`application/vnd.example.flow+zip`），印出識別字、`isDynamic`、`conforms(to: .zip)`、`conforms(to: .data)`、`preferredMIMEType`。
- [SIM-UT] 同一支腳本（副檔名多加 xlsx、pptx、odt、usdz、jar、xlsb）用 `xcrun --sdk iphonesimulator swiftc` 編成模擬器版，以 `xcrun simctl spawn` 在 Xcode 27.2 的 iOS 18.1（22B81）、iOS 27.2（24B8117）模擬器裡跑。兩個版本輸出一樣。

**WebKit 原始碼**（tag `WebKit-7625.2.8`，網址開頭 `https://github.com/WebKit/WebKit/blob/WebKit-7625.2.8/`；對照 tag `WebKit-7621.1.2`、`WebKit-7621.2.5.14.9`）

- [SRC-UPLOAD] `Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm`：`presentWithParameters`、`UTIsForMIMETypes`、`showFilePickerMenu`（三個 tag 都讀）
- [SRC-MIMECOCOA] `Source/WebCore/platform/cocoa/MIMETypeRegistryCocoa.mm`：`mimeTypeForExtension`、`preferredExtensionForMIMEType`
- [SRC-MIME] `Source/WebCore/platform/MIMETypeRegistry.cpp`：`appendFileExtensionIfNecessary`、`correctExtensionForMIMEType`、`canonicalMIMEType`、`isArchiveMIMEType`、`allowedFileExtensions`（三個 tag 都讀）
- [SRC-DL] `Source/WebKit/UIProcess/Downloads/DownloadProxy.cpp`：`decideDestinationWithSuggestedFilename`（三個 tag 都讀）
- [SRC-OPP] `Source/WebKit/UIProcess/API/APIOpenPanelParameters.cpp`、`Source/WebKit/UIProcess/API/Cocoa/WKOpenPanelParameters.mm`
- [SRC-UID] `Source/WebKit/UIProcess/Cocoa/UIDelegate.mm`：`UIClient::runOpenPanel`
- [SRC-NAV] `Source/WebCore/page/Navigator.cpp`：`canShare`、`share`
- [SRC-SHARE] `Source/WebKit/UIProcess/Cocoa/WKShareSheet.mm`：`typeIdentifierForFileURL`、`writeFileToShareableURL`
- [WK-310122] WebKit commit 310122@main「"Save as" uses the file extension name instead of the URL Content-Type」（2026-03-28，bug 289445）：https://github.com/WebKit/WebKit/commit/d496d47f982c0e0c8229b1e66faab7a218ecd2a9
- [WK-314104] WebKit commit 314104@main「Safari "open safe files" turns .tgz files into tarballs without a file extension」（2026-05-29，bug 315604）：https://github.com/WebKit/WebKit/commit/aa5783f948506ce7056c3b37e68d31ee78da1d6d

**Chromium 原始碼**（tag `159.0.8154.18`，網址開頭 `https://chromium.googlesource.com/chromium/src/+/refs/tags/159.0.8154.18/`）

- [CR-DASH] Chrome 正式版版本：https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Android&num=2 （Windows 同樣網址換 `platform=Windows`）
- [CR-SFD] `ui/android/java/src/org/chromium/ui/base/SelectFileDialog.java`：`ensureMimeType`、`ACTION_OPEN_DOCUMENT`、`ACTION_CREATE_DOCUMENT`、`GET_CONTENT` 那幾段
- [CR-SFD-CC] `ui/shell_dialogs/select_file_dialog_android.cc`：`SetAcceptTypes`、`SelectFileImpl`
- [CR-FSC] `content/browser/file_system_access/file_system_chooser.cc`：`GetFileTypesFromAcceptsOption`、`ConvertAcceptsToFileTypeInfo`、`ResolveSuggestedNameExtension`、`ConvertAcceptsToMimeTypesList`（Android）、`kMaxExtensionLength`、`IsShellIntegratedExtension`
- [CR-MIME] `net/base/mime_util.cc`：`kPrimaryMappings`、`kSecondaryMappings`（`application/zip` → zip、`application/octet-stream` → bin,exe,com）、`FindPreferredExtension`（octet-stream 沒有首選副檔名）、`GetExtensionsForMimeType`
- [CR-GFSA] `third_party/blink/renderer/modules/file_system_access/global_file_system_access.cc`：`IsValidSuffixCodePoint`、`VerifyIsValidExtension`、MIME 鍵檢查
- [CR-SHARE] `chrome/browser/webshare/share_service_impl.cc`：`IsDangerousFilename`、`IsDangerousMimeType`
- [CR-SHARE-AND] `components/browser_ui/webshare/android/java/src/org/chromium/components/browser_ui/webshare/ShareServiceImpl.java`：`PERMITTED_EXTENSIONS`、`PERMITTED_MIME_TYPES`
- [CR-SHARE-MD] `third_party/blink/renderer/modules/webshare/FILE_TYPES.md`
- [CR-NAVSHARE] `third_party/blink/renderer/modules/webshare/navigator_share.cc`：`CanShareInternal`、`kMaxSharedFileCount`、`kMaxSharedFileBytes`、錯誤對應
- [CR-FN] `net/base/filename_util_internal.cc`：`GetCorrectedExtensionUnsafe`、`EnsureSafeExtension`、`GetSuggestedFilenameImpl`

**Android 原始碼**（AOSP `main`，2026-11-22）

- [AOSP-FU] `frameworks/base/core/java/android/os/FileUtils.java`：`splitFileName`、`buildUniqueFile`：https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/os/FileUtils.java
- [AOSP-FSP] `frameworks/base/core/java/com/android/internal/content/FileSystemProvider.java`：`createDocument`：https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/com/android/internal/content/FileSystemProvider.java
- [AOSP-MP] `packages/providers/MediaProvider` 的 `MediaProvider.java`（`ensureFileColumns`）和 `util/FileUtils.java`（`splitFileName`）：https://android.googlesource.com/platform/packages/providers/MediaProvider/+/refs/heads/main/src/com/android/providers/media/

**規格、登記**

- [FSA] File System Access（WICG，Draft Community Group Report，10 October 2025），3.2.1 Accepted file types：https://wicg.github.io/file-system-access/
- [RFC6838] Media Type Specifications and Registration Procedures（3.2 Vendor Tree、3.4 Unregistered x. Tree）：https://www.rfc-editor.org/rfc/rfc6838.txt
- [RFC6839] Additional Media Type Structured Syntax Suffixes（3.6 The +zip Structured Syntax Suffix）：https://www.rfc-editor.org/rfc/rfc6839.txt
- [IANA-APP] IANA Media Types，application 清單（CSV，數 `+zip`）：https://www.iana.org/assignments/media-types/application.csv
- [BCD] MDN browser-compat-data 8.1.10：`api/Window.json`（`showOpenFilePicker`、`showSaveFilePicker`）、`api/Navigator.json`（`share`、`canShare`）：https://github.com/mdn/browser-compat-data/tree/v8.1.10

**LINE 說明中心**（`https://help.line.me/line/smartphone/pc?lang=zh-Hant&contentId=…`，英文版、日文版把 `lang` 換成 `en`、`ja`）

- [LINE-SEND] 傳送、分享、複製、編輯訊息的操作方法（contentId=20007005；中、英、日文版都讀）
- [LINE-LIST] 於聊天室內編輯或確認照片、影片等項目的操作方法（contentId=20008461，「透過一覽畫面確認分享至聊天室內的圖片、影片、連結或檔案」那一段）
- [LINE-EXPIRE] 如何查看所有即將過期的檔案？（contentId=200002981）
- [LINE-MEDIA] 無法傳送、接收或播放圖片／影片／語音訊息（contentId=20000236）
- 電腦版網址：`https://help.line.me/line/desktop/pc?lang=zh-Hant&contentId=20007005`（和 `lang=ja`），文字跟手機版網址的一樣。
- [LINE-BLOG-2013] LINE公式ブログ「PC版LINEからワード・エクセル・パワーポイントなど様々な形式のファイルが送信可能になりました」（2013-03-13）：https://official-blog.line.me/ja/archives/24521111.html
- [LINE-OTHER] 沒有找到檔案類型清單的幾頁：LINE的使用限制相關說明（contentId=200002135，中、日）、無法傳送或接收聊天訊息（20000232）、突然無法傳送LINE的聊天訊息（20024565）、LINE的使用環境（10002433，中、日）、Keep筆記的基本使用方法（20017696，中、日）、【Android】於聊天室內傳送或接收圖片⋅影片，以及貼圖⋅表情貼⋅主題的相關問題（200001675）
- 搜尋頁：`https://help.line.me/line/smartphone/search/pc?lang=zh-Hant&q=…` 和 `https://help.line.me/line/desktop/search/pc?lang=…&q=…`（關鍵字見第 6 節開頭）。

**使用者文章（次級來源）**

- [PTT-MAC] PTT MAC 板「[求救] 用line傳檔案如何不要變zip檔?」（2020-11-28；原 PO 和回文者的帳號不列）：https://www.ptt.cc/bbs/MAC/M.1606572614.A.91B.html

**副檔名清單（次級來源）、郵件**

- [FILEINFO] https://fileinfo.com/extension/cheer 、…/cheerflow、…/routine、…/cheerroutine、…/cheerb（都 404）；…/zip（200）
- [FILEXT] https://filext.com/file-extension/CHEER 、…/ROUTINE、…/CHEERFLOW（都 404）；…/ZIP（200）
- [GMAIL] File types blocked in Gmail：https://support.google.com/mail/answer/6590?hl=en
- [OUTLOOK] Blocked attachments in Outlook：https://support.microsoft.com/en-us/office/blocked-attachments-in-outlook-434752e1-02d3-4e90-9124-8b81e49a8519
