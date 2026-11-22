# app 自己的資料夾，系統會不會自己刪

Issue #300（地圖 #292「iPhone、iPad app 第一版」）。查核日期 2026-11-21。

問題：在 iOS／iPadOS 上，使用者沒有刪 app，系統會不會刪掉 app 放在自己資料夾（sandbox container）裡的檔案？分開看 `Documents/`、`Library/Application Support/`、`Library/Caches/`、`tmp/`，還有 app 裡的網頁（WKWebView）存的 IndexedDB、localStorage。

為什麼要查：有一條標準寫「資料（草稿、離線副本、還沒送出的紀錄、設定）不能被系統清掉」。資料放在 app 自己的資料夾就算過，**但前提是要有 Apple 的一手來源說這個資料夾不會被清**。這份筆記去找這句話，找不到就直說。

只整理事實，不決定過不過。

標記方式：

- **已確認**：有一手來源的原文。方括號是來源代號，見文末「來源」。
- **原始碼**：WebKit 開放原始碼在某個 tag 寫的內容。程式碼怎麼寫是已確認的；Apple 出貨的 iOS 是不是照這份編，查不到。所以從原始碼推出來的行為算推論。
- **推論**：我自己推的，沒有一手來源直接寫。
- **查不到**：找過，沒有一手來源。
- **未確認**：有人這樣說（例如論壇裡開發者的回報），沒有第二個來源，也沒實測。

這台 Mac 沒有 Xcode 和模擬器。**這份筆記沒有任何一項在真機上跑過。**

## 版本

- 交代的版本是 27.2。Apple 的安全性更新清單上，iOS／iPadOS 最新的其實是 **27.2.1（2026-11-09）**；27.2 是 2026-10-26 [APPLE-RELEASES]。
- 下面讀的 Apple 文件都沒有標「哪一版 iOS 起」適用，只有幾份有日期，寫在每條旁邊。

## 結論（事實）

**「Apple 一手來源明寫這個資料夾不會被清」：現行的 Apple 正式文件裡，查不到這種句子。** `Documents/`、`Application Support/` 都一樣。

最接近的替代來源，從新到舊：

1. 現行的〈Optimizing Your App’s Data for iCloud Backup〉說，app 資料夾裡放「可以清的資料」的地方有兩個：`/tmp`、`/Library/Caches`，系統會定期清 [APPLE-BACKUP]。其他資料夾它沒說會不會清。從「只點名這兩個」推出「其他的不清」，是**推論**。
2. 2018 年 8 月，Apple 技術支援（DTS）工程師在開發者論壇回覆：「iOS will not spontaneously delete files from your container except for specific directories, like Caches.」[APPLE-FORUM]。這是論壇回覆，不是正式文件；而且用的是「like」，沒說清單只有 Caches。
3. 2017-09-12 的 Apple Tech Talk 影片講 `Application Support`：「The directory is completely under your control, and it's persistent.」[APPLE-TT204]。這是 `Application Support` 唯一一句明寫的。是 iOS 11 時代的影片。
4. 舊的〈iOS Data Storage Guidelines〉寫過，設了「do not back up」的檔案「These files will not be purged」[APPLE-DSG-OLD]。**這頁已經下架**（2022 年的存檔已經轉到第 1 條那一頁），新頁反而說這個設定只是給備份參考（第 2.5 節）。不能拿來當現行的根據。

這個「查不到」的範圍：讀了第 1 節的備份文章、File System Programming Guide、`FileManager`／`URL` 的四個資料夾、`isExcludedFromBackup`、`isPurgeable`、`volumeAvailableCapacityFor…Usage`、〈Checking Volume Storage Capacity〉、`NSSupportsPurgeableLocalStorage`、`WKWebsiteDataStore` 的文件，Tech Talk 204，支援文章和 iOS 27／iPadOS 27 使用手冊的儲存空間頁（來源見文末）。另外在 developer.apple.com 搜了一次「Application Support」加「purge」，結果只有論壇和舊文件庫。**沒有讀任何 WWDC 場次的逐字稿**：搜尋只找到 Tech Talk 204 這一場講儲存位置；抓 WWDC16 第 221 場（On-Demand Resources）拿到的是場次清單頁，沒有內容。

每個位置一行：

| 位置 | 系統會不會自己刪 | Apple 有沒有明寫「不會刪」 |
|---|---|---|
| `tmp/` | **會**。app 沒在跑時定期清。已確認 [APPLE-BACKUP] [APPLE-FS] | 不適用 |
| `Library/Caches/` | **會**。現行文件寫「periodically purges」；舊文件和 Tech Talk 寫空間很少時清、app 正在跑時不清。已確認 [APPLE-BACKUP] [APPLE-FS] [APPLE-TT204] | 不適用 |
| `Library/Application Support/` | 沒有任何 Apple 來源說會 | 只有 2017 Tech Talk 一句「persistent」（已確認，舊）；現行正式文件查不到，只能從排除法推（推論） |
| `Documents/` | 沒有任何 Apple 來源說會 | 查不到明寫的句子。只有排除法（推論）和 2018 年的論壇回覆 |
| WebKit 的 IndexedDB、localStorage | **會，是 WebKit 自己刪**：ITP 7 天沒互動、系統空間不夠、超過總上限。已確認 [WK-ITP] [WK-ABD] [WK-STORAGE] | **沒有**。放在 `Library/` 底下、不在 `Caches`（原始碼），但這擋不住 WebKit 自己刪 |
| 例外：Shared iPad（學校用 MDM 管的共用 iPad） | **會**。換使用者、重新設定時，本機資料可能被清；空間不夠時整個使用者會被趕掉。已確認 [APPLE-SHARED-IPAD] [APPLE-SEC-SHARED] | 不適用 |

另外兩點：

- **「卸載未使用的 App」（Offload）留著資料。** Apple 寫：卸載「frees up storage used by the app, but keeps its documents and data」[APPLE-SUPPORT-STORAGE]；iOS 27 的使用手冊寫系統空間不夠時可以自動卸載，「while keeping your data」[APPLE-IPHONE-GUIDE] [APPLE-IPAD-GUIDE]。`Caches`、`tmp` 卸載後還在不在，查不到。
- **檔案層級的「可以清」存在，但 app 設不了。** iOS 14 起有 `isPurgeable`：「whether the file system can delete a file when the system needs to free space」，唯讀 [APPLE-PURGEABLE]。哪些檔案會被標成可以清，Apple 沒寫（查不到）。

## 1. 現行 Apple 文件怎麼分「會清」和「不會清」

來源：〈Optimizing Your App’s Data for iCloud Backup〉[APPLE-BACKUP]。

舊網址現在怎麼轉（用 `curl -sIL` 看）：

- QA1719（Preventing Files From Being Backed Up）：轉三次，最後到這一頁，200。
- 舊的〈iOS Data Storage Guidelines〉：轉到這一頁的舊式網址（底線、結尾有斜線），那個網址用 `curl` 抓是 404。Wayback Machine 2022-06-13 的紀錄也是轉到這一頁的舊式網址。

已確認，原文：

- 「Purgeable data is app data that the system can delete without affecting the app’s execution and that the app can re-create if it needs.」
- 「The app container provides two directories for storing purgeable data:」後面列 `/tmp`、`/Library/Caches`。
- 「The system periodically purges these directories, so iCloud Backup excludes them by default.」
- 「Don’t use these directories to exclude nonpurgeable data from iCloud Backup.」
- 「Nonpurgeable data is data the user creates, or data the app requires to function as the user expects.」

沒寫的：

- 這一頁沒有一句說「`Documents`、`Application Support` 不會被清」。它只把資料分成兩種，叫你把「可以清的」放進那兩個資料夾（查不到明寫）。
- 推論：Apple 把「使用者自己做的資料」定義成「nonpurgeable」，又只點名 `/tmp`、`/Library/Caches` 會被清。所以其他資料夾不在系統定期清的範圍。這是排除法，不是原文。

## 2. 各位置

### 2.1 `tmp/`

已確認：

- 現行文件：會定期清（第 1 節）[APPLE-BACKUP]。
- 舊文件庫的 File System Programming Guide（頁尾「Updated: 2018-04-09」）[APPLE-FS]：
  - 「Your app should remove files from this directory when they are no longer needed; however, the system may purge this directory when your app is not running.」
  - 「The system will periodically purge these files when your app is not running; therefore, you cannot rely on these files persisting after your app terminates.」
- Tech Talk（2017-09-12）[APPLE-TT204]：「Even though the operating system will periodically remove these files when your app is not running, it's best to remove them when you're done with them.」
- 支援文章（2026-10-13）[APPLE-SUPPORT-STORAGE]：「When your device is low on storage, it frees up space by removing items that you can download again or aren't needed, like unused apps and temporary files.」

### 2.2 `Library/Caches/`

已確認：

- 現行文件：會定期清（第 1 節）[APPLE-BACKUP]。`FileManager` 的文件把它叫「Discardable cache files (`Library/Caches`)」[APPLE-SEARCHPATH]。
- File System Programming Guide [APPLE-FS]：
  - 「In iOS 5.0 and later, the system may delete the Caches directory on rare occasions when the system is very low on disk space. This will never occur while an app is running. However, be aware that restoring from backup is not necessarily the only condition under which the Caches directory can be erased.」
  - 「Note that the system may delete the Caches/ directory to free up disk space, so your app must be able to re-create or download these files as needed.」
  - 「the system removes files in this directory during a full restoration of the device.」
- Tech Talk [APPLE-TT204]：「When a device is low on disk space, iOS can help by clearing caches. Files will never be removed from your caches directory if your app is running, and the operating system will start by clearing caches for apps that haven't been used in a while.」
- 論壇 DTS 回覆（2018-08）[APPLE-FORUM]：「If you put stuff in the Caches directory the system is free to delete it when necessary (although it won’t delete it while your app is running). If you don’t want that, don’t use the Caches directory.」

### 2.3 `Library/Application Support/`

已確認（說法）：

- Tech Talk（2017-09-12）[APPLE-TT204]：「The directory is completely under your control, and it's persistent. The contents are included in backups by default, but you can opt files out if they don't need to be backed up.」
- 同一段：這裡用的空間算在設定裡這個 app 的「Documents & Data」。
- File System Programming Guide [APPLE-FS]：「Use this directory to store all app data files except those associated with the user’s documents.」「In iOS, the contents of this directory are backed up by iTunes and iCloud.」沒有提會不會被清。
- `URL.applicationSupportDirectory` 的文件：「In iOS, this directory is within the app’s sandbox directory.」[APPLE-URLDIRS]。沒有提會不會被清。

查不到：

- 現行的 Apple 正式文件（不是影片、不是論壇）裡，沒有一句寫「`Application Support` 不會被系統清」。

推論：

- 排除法（第 1 節）加上 Tech Talk 的「persistent」，`Application Support` 不在系統定期清的範圍。要注意 Tech Talk 是 2017 年 iOS 11 的影片。

### 2.4 `Documents/`

已確認（說法）：

- File System Programming Guide [APPLE-FS]：「Use this directory to store user-generated content.」「The contents of this directory are backed up by iTunes and iCloud.」沒有提會不會被清。
- Tech Talk [APPLE-TT204]：把 `Documents` 開放給「檔案」app 以後，使用者可以在儲存空間設定裡一個一個刪檔，「This makes it much easier to manage disk space, and will reduce the likelihood that your entire app is deleted when space is low.」推論：這裡說的「整個 app 被刪」是使用者自己刪（上下文在講使用者管空間），不是系統清 `Documents`。

查不到：

- 沒有任何 Apple 文件或影片直接寫「`Documents` 不會被系統清」。

推論：

- 排除法（第 1 節），加上 DTS 的論壇回覆「iOS will not spontaneously delete files from your container except for specific directories, like Caches.」[APPLE-FORUM]。

### 2.5 「不要備份」（`isExcludedFromBackup`）跟「會不會被清」無關

已確認：

- 現行文件 [APPLE-BACKUP]：「The isExcludedFromBackup resource value exists only to provide guidance to the system about which files and directories it can exclude; it’s not a mechanism to guarantee those items never appear in a backup or on a restored device.」
- `isExcludedFromBackupKey` [APPLE-EXCLUDE]：「Use this property to exclude cache and other app support files that aren’t necessary in a backup. Set this property each time you save a file because some common file operations cause this property to reset to `false`.」
- `URLResourceValues.isExcludedFromBackup` [APPLE-EXCLUDE]：「Some operations commonly made to user documents will cause this property to be reset to false and so this property should not be used on user documents.」
- 論壇 DTS 回覆（2018-08）[APPLE-FORUM]，有人問「`Application Support` 的子資料夾設了這個，iOS 是不是永遠不會刪」，回答：「The NSURLIsExcludedFromBackupKey key is irrelevant in this case; iOS will not spontaneously delete files from your container except for specific directories, like Caches.」

已下架的舊說法（已確認曾經這樣寫，現在不是）：

- 舊的〈iOS Data Storage Guidelines〉[APPLE-DSG-OLD]：「Use the "do not back up" attribute for specifying files that should remain on device, even in low storage situations.」「These files will not be purged and will not be included in the user's iCloud or iTunes backup.」
- Wayback Machine 的紀錄：2017-12-07、2021-07-20 這兩次存檔都還有這句；2022-06-13 那次存檔，網址已經轉到〈Optimizing Your App’s Data for iCloud Backup〉。新頁沒有這句。

未確認：

- 同一串論壇裡，2018-09 有開發者回報：檔案放在 `Application Support` 的子資料夾、設了不要備份，iOS 11 上測試的人還是說檔案不見了。DTS 回：「the testers are saying that these files are being spontaneously deleted, and NSURLIsExcludedFromBackupKey has no impact on this」「I don’t have any specific advice on what’s going on with your app.」[APPLE-FORUM]。原因沒有下文。只有這一則回報，不知道是系統清的還是 app 自己的錯。

### 2.6 檔案層級的「可以清」（`isPurgeable`）

已確認：

- iOS 14 起有 `URLResourceKey.isPurgeableKey`：「The key for a Boolean value that indicates whether the file system can delete a file when the system needs to free space.」[APPLE-PURGEABLE]
- SDK 標頭檔 `NSURL.h` 寫它是唯讀：「True if the file can be deleted by the file system when asked to free space. (Read-only, value type NSNumber)」[APPLE-NSURL-H]
- 同一個標頭檔講可用空間：「Total available capacity in bytes for "Important" resources, including space expected to be cleared by purging non-essential and cached resources.」[APPLE-NSURL-H]

查不到：

- 哪些檔案會被標成「可以清」、app 能不能自己設、`Documents`／`Application Support` 裡的檔案會不會被標：Apple 文件都沒寫。
- 「non-essential」指哪些檔案，沒寫。

推論：這兩條沒有說 `Documents`、`Application Support` 會被清，但也表示「系統騰空間時清什麼」Apple 沒有寫成完整清單。

## 3. 系統空間不夠時，iOS 怎麼騰空間

已確認：

- 支援文章〈How to check the storage on your iPhone and iPad〉（「Published Date: October 13, 2026」）[APPLE-SUPPORT-STORAGE]：
  - 「When your device is low on storage, it frees up space by removing items that you can download again or aren't needed, like unused apps and temporary files.」
  - 「To free up space, your device removes cached and temporary files, so you don't have to.」
  - 「Cached data and temporary data might not count as usage.」
  - 卸載：「Offload the app. This frees up storage used by the app, but keeps its documents and data.」
  - 刪除：「Delete the app, which removes the app and its related data.」
- iPhone 使用手冊（iOS 27）〈Manage storage on iPhone〉[APPLE-IPHONE-GUIDE]：「When storage is low, iPhone can automatically remove unused apps while keeping your data. The app icon stays on your Home Screen with a cloud symbol—tap it to reinstall the app.」開關的位置，原文是「Tap Apps, tap App Store, then turn on Offload Unused Apps.」（中文畫面上的名字沒查，這裡不翻）。
- iPad 使用手冊（iPadOS 27）〈Manage storage on iPad〉[APPLE-IPAD-GUIDE]：同一段，主詞換成 iPad。

查不到：

- 卸載時 `Caches`、`tmp` 會不會一起清。
- 「documents and data」包不包括 `Library/` 底下所有東西（含 WebKit 的資料）。推論包括：Apple 把 app 資料夾裡的東西分成 app 本身和「documents and data」兩塊，WebKit 的資料在資料夾裡。
- 支援文章說的「items that you can download again or aren't needed」除了 app、暫存檔、快取以外還有什麼。

## 4. 例外：Shared iPad

Shared iPad 是學校用 MDM 設定、多個學生輪流登入的 iPad。

已確認：

- Apple 開發者網站〈Optimizing Apps for Shared iPad〉[APPLE-SHARED-IPAD]：「Since local data may be purged when switching users or when the device is reconfigured, it’s important to ensure persistent storage」。
- 同一頁：在 `Info.plist` 把 `NSSupportsPurgeableLocalStorage` 設成 yes，「indicates that your app supports having its local data purged when the user logs out.」
- `NSSupportsPurgeableLocalStorage`（iOS 9.3 起）：「A Boolean value indicating whether the app continues working if the system purges the local storage.」文件只有這一句 [APPLE-NSPLS]。
- Apple Platform Security〈Shared iPad security in iPadOS〉（頁面寫「Published Date: February 18, 2021」）[APPLE-SEC-SHARED]：新使用者登入、空間不夠時，「the system identifies an existing user whose data has finished syncing to the cloud and evicts that user from the device so that the new user to sign in.」

推論：這是整個使用者的資料，不分資料夾。一般個人的 iPhone、iPad 不是 Shared iPad，不適用。

## 5. app 裡的網頁（WKWebView）存的資料

兩件事分開講：**放在哪**，跟**會不會被刪**。

### 5.1 放在哪

Apple 文件（已確認）：

- 「By default, `WKWebViewConfiguration` uses the default data store returned by the `default()` method, which saves website data persistently to disk.」[APPLE-WDS]
- `default()`：「A web view configured with the default data store saves website data persistenly to disk. Use this data store to retain the state of web content between browsing sessions.」（原文就拼成 persistenly）[APPLE-WDS]
- 「persistently to disk」只說存在磁碟上、跨次保留，**沒說放在哪個資料夾，也沒說不會被刪**。

查不到：Apple 文件沒寫 WKWebView 的資料放在 app 資料夾的哪裡。

原始碼（tag `WebKit-7625.2.8`，版號跟 Safari 27.2 的引擎一樣）[SRC-WDSC]：

- 一般網站資料的根目錄：`NSLibraryDirectory` 底下的 `WebKit/WebsiteData/`（`websiteDataDirectoryFileSystemRepresentation`）。
- 快取類的根目錄：`NSCachesDirectory` 底下的 `WebKit/`（`cacheDirectoryFileSystemRepresentation`）。
- 跑 WebKit 的 app 有自己的資料夾（`processHasContainer()` 為真）時，路徑裡不再多一層 app 代號。iOS app 都有自己的資料夾（推論）。
- 各種資料的預設目錄：

| 資料 | 預設目錄（原始碼） | 在不在 `Library/Caches/` |
|---|---|---|
| 按來源分的一般儲存（`defaultGeneralStorageDirectory`） | `Library/WebKit/WebsiteData/Default` | 不在 |
| IndexedDB（`defaultIndexedDBDatabaseDirectory`） | `Library/WebKit/WebsiteData/IndexedDB` | 不在 |
| localStorage（`defaultLocalStorageDirectory`） | `Library/WebKit/WebsiteData/LocalStorage` | 不在 |
| ITP 紀錄 | `Library/WebKit/WebsiteData/ResourceLoadStatistics` | 不在 |
| Cache API（`CacheStorage`）、`ServiceWorkers`、HTTP 快取（`NetworkCache`） | `Library/Caches/WebKit/…` | 在 |

- 用 `init(forIdentifier:)`（iOS 17 起的「設定檔」）另外開的資料庫，根目錄是 `Library/WebKit/WebsiteDataStore/<代號>`（`defaultWebsiteDataStoreDirectory`），也不在 `Caches`。
- 前一份筆記查過：到了預設的 `Standard` 儲存等級，IndexedDB、Cache API、service worker 註冊都跟著來源的目錄走（`Default` 底下）[PREV]。這份沒有重追。

推論：IndexedDB、localStorage 實際在 app 資料夾的 `Library/WebKit/WebsiteData/` 底下，不在 iOS 會清的 `Caches`、`tmp`。沒有真機驗。

### 5.2 會不會被刪

已確認，WebKit 自己會刪，不管放在哪個資料夾：

- [WK-STORAGE]（2023-08-10）的適用範圍：「This post will discuss the latest storage policy in WebKit apps including Safari.」
- 「Eviction means automatic website data deletion that is not initiated by the user or website. It can happen under a few conditions: when exceeding the overall quota, when the system is under storage pressure, or when the site has not been interacted with by the user for some time (see Intelligent Tracking Prevention).」
- 「By default, all origins use a best-effort mode, which means their persistence is not guaranteed and their data can be evicted.」
- app 裡的總上限：「For other apps, overall quota is up to 20% of the total disk space.」
- ITP [WK-ITP]：「ITP deletes all cookies created in JavaScript and all other script-writeable storage after 7 days of no user interaction with the website.」
- ITP 在 app 裡預設開 [WK-ABD]：「Additionally in iOS 14.0 and macOS Big Sur, Intelligent Tracking Prevention (ITP), is enabled by default in all WKWebView applications.」

前一份筆記已經查過的，這裡不重查，只引用 [PREV]（分支 `research/app-webview-shell`，檔案 `docs/research/app-webview-shell.md`，commit `4a6ecf7`，第 1.2～1.4 節）：

- 7 天規則在 app 裡照算（推論）；明寫豁免的只有加到主畫面的網頁 App。
- 原始碼裡清除的視窗有 7 和 30 個「使用日」兩種，哪個才是出貨的行為要真機驗。
- app 裡的網頁呼叫 `navigator.storage.persist()`，從原始碼看會拿到 `false`（推論）。

### 5.3 有沒有新東西跟前一份對不上

沒有找到。查的範圍：

- Safari 27、27.1、27.2、27.3 beta、26 的版本說明全文，用 storage、IndexedDB、localStorage、tracking prevention、7 days、evict、website data、persist、`WKWebsiteDataStore`、quota 這幾個字找 [SAF-NOTES]。找到的都跟清除規則無關，例如 IndexedDB 的錯誤修正、新增 `getAllRecords()`、`QuotaExceededError` 改成 `DOMException` 的子類別、擴充功能的 storage。Safari 26 有一條「Added support for local storage and session storage restoration APIs.」。沒有一條改清除規則。
- WebKit 部落格 RSS 裡的 10 篇（2026-10-19 到 2026-11-18）。抓了其中 7 篇的全文，用同一組字找 [WK-FEED]。〈Blocking Identity Resolution Infrastructure〉讀完全文：講的是 27 版起 Safari 和 WebKit 在網域層級擋掉「身分比對」業者的網路連線，沒講儲存清除。〈Global Privacy Control (GPC) WebKit API〉是新的 WKWebView 隱私開關，用關鍵字找沒有講儲存清除。
- 沒有讀 WebKit 的 commit 紀錄，也沒有讀 27.2.1 的更新內容。

### 5.4 所以

- **IndexedDB、localStorage 實際放在 app 資料夾裡（原始碼，推論），但這不代表不會被刪。** 會刪它們的是 WebKit 自己（ITP、空間壓力、總上限），不是 iOS 清 `Caches`。
- 所以「放在 app 自己的資料夾就算過」這個理由，對 WebKit 的資料**不成立**。WebKit 的來源寫的是會刪（已確認）。

## 6. 沒查的、要真機驗的

- 沒有任何一項在真機上驗過：`Application Support`、`Documents` 在空間快滿時會不會少檔案；卸載再裝回來資料在不在；WKWebView 的 IndexedDB 過 7 天（或 30 個使用日）沒開會不會被清。
- 卸載時 `Caches`、`tmp` 會不會清，查不到。
- `isPurgeable` 怎麼被設，查不到。
- 換新手機、從備份還原的情況沒有展開查。只記兩句已確認的：`Caches`「the system removes files in this directory during a full restoration of the device」[APPLE-FS]；`isExcludedFromBackup`「it’s not a mechanism to guarantee those items never appear in a backup or on a restored device」[APPLE-BACKUP]。
- app 更新時哪些資料夾會留著，沒有查。

## 來源

全部在 2026-11-21 查。讀法：

- Apple 開發者文件讀的是同一路徑的 JSON 資料檔（`https://developer.apple.com/tutorials/data/documentation/….json`），用 `curl` 抓。下面列的是給人看的網址。
- 舊文件庫、支援文章、使用手冊、Tech Talk 頁、WebKit 部落格、WebKit 原始碼：用 `curl` 抓原始網頁或原始碼的全文，轉成文字，用關鍵字找到段落再讀上下文。
- 論壇那一串：直接抓會被擋在「Security Verification」頁。先用抓網頁的工具（會經過摘要）讀了兩次，再從 Wayback Machine 抓 2022-07-21 存檔的原始網頁（`id_` 網址，沒有改寫），用 `grep` 對過引用的每一句。文中引用的是存檔原文。
- 標頭檔 `NSURL.h` 是這台 Mac 的 Command Line Tools 附的 `MacOSX26.5.sdk`。Foundation 的標頭檔各平台共用，這幾行標了 `ios(14.0)`、`ios(11.0)`。
- 搜尋工具用了幾次，只拿來找網址，沒有拿搜尋摘要當來源。

**Apple 開發者文件（現行）**

- [APPLE-BACKUP] Optimizing Your App’s Data for iCloud Backup：https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup 。舊網址 https://developer.apple.com/library/archive/qa/qa1719/_index.html 轉到這裡（200）；https://developer.apple.com/icloud/documentation/data-storage/ 轉到這一頁的舊式網址，`curl` 抓是 404（第 1 節）。
- [APPLE-SEARCHPATH] `FileManager.SearchPathDirectory` 的 `documentDirectory`、`applicationSupportDirectory`、`cachesDirectory`：https://developer.apple.com/documentation/foundation/filemanager/searchpathdirectory/cachesdirectory （另兩個同一層）
- [APPLE-URLDIRS] `URL.documentsDirectory`、`applicationSupportDirectory`、`cachesDirectory`、`temporaryDirectory`（iOS 16 起）：https://developer.apple.com/documentation/foundation/url/applicationsupportdirectory （另三個同一層）
- [APPLE-EXCLUDE] `URLResourceKey.isExcludedFromBackupKey`、`URLResourceValues.isExcludedFromBackup`：https://developer.apple.com/documentation/foundation/urlresourcekey/isexcludedfrombackupkey 、https://developer.apple.com/documentation/foundation/urlresourcevalues/isexcludedfrombackup
- [APPLE-PURGEABLE] `URLResourceKey.isPurgeableKey`、`URLResourceValues.isPurgeable`（iOS 14 起）：https://developer.apple.com/documentation/foundation/urlresourcekey/ispurgeablekey 、https://developer.apple.com/documentation/foundation/urlresourcevalues/ispurgeable
- [APPLE-NSPLS] `NSSupportsPurgeableLocalStorage`：https://developer.apple.com/documentation/bundleresources/information-property-list/nssupportspurgeablelocalstorage
- [APPLE-WDS] `WKWebsiteDataStore`、`default()`：https://developer.apple.com/documentation/webkit/wkwebsitedatastore 、https://developer.apple.com/documentation/webkit/wkwebsitedatastore/default()
- [SAF-NOTES] Safari Release Notes（27、27.1、27.2、27.3 beta、26）：https://developer.apple.com/documentation/safari-release-notes
- [APPLE-NSURL-H] Foundation 標頭檔 `NSURL.h`（`MacOSX26.5.sdk`）：`NSURLIsPurgeableKey`、`NSURLVolumeAvailableCapacityForImportantUsageKey`、`NSURLIsExcludedFromBackupKey` 的註解。

**Apple 開發者文件（舊文件庫，還在線上，不再更新）**

- [APPLE-FS] File System Programming Guide〈File System Basics〉（頁尾「Updated: 2018-04-09」）：https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html

**Apple 開發者文件（已下架）**

- [APPLE-DSG-OLD] iOS Data Storage Guidelines（已下架）。Wayback Machine 存檔：https://web.archive.org/web/20171207132426id_/https://developer.apple.com/icloud/documentation/data-storage/index.html 、https://web.archive.org/web/20210720135603id_/https://developer.apple.com/icloud/documentation/data-storage/index.html 。2022-06-13 的存檔已經是轉址：https://web.archive.org/web/20220613015153id_/https://developer.apple.com/icloud/documentation/data-storage/index.html

**Apple 影片、論壇**

- [APPLE-TT204] Tech Talk〈iOS Storage Best Practices〉（頁面 `datePublished` 2017-09-12，讀的是頁面上的逐字稿）：https://developer.apple.com/videos/play/tech-talks/204/
- [APPLE-FORUM] Apple Developer Forums〈iOS: Prevent files from being removed on low disk space〉（2018-08、2018-09 的貼文；引用的是 DTS 工程師的回覆）：https://developer.apple.com/forums/thread/107071 。讀的存檔：https://web.archive.org/web/20220721121026id_/https://developer.apple.com/forums/thread/107071

**Apple 支援、使用手冊**

- [APPLE-SUPPORT-STORAGE] How to check the storage on your iPhone and iPad（「Published Date: October 13, 2026」）：https://support.apple.com/en-us/108429
- [APPLE-IPHONE-GUIDE] iPhone User Guide（iOS 27）〈Manage storage on iPhone〉：https://support.apple.com/en-us/guide/iphone/iph47c931112/ios
- [APPLE-IPAD-GUIDE] iPad User Guide（iPadOS 27）〈Manage storage on iPad〉：https://support.apple.com/en-us/guide/ipad/ipadf1f1b3f3/ipados
- [APPLE-SHARED-IPAD] Optimizing Apps for Shared iPad：https://developer.apple.com/education/shared-ipad/
- [APPLE-SEC-SHARED] Apple Platform Security〈Shared iPad security in iPadOS〉（「Published Date: February 18, 2021」）：https://support.apple.com/en-us/guide/security/secd99f373ef/web
- [APPLE-RELEASES] Apple security releases：https://support.apple.com/en-us/100100

**WebKit**

- [WK-STORAGE] Updates to Storage Policy（2023-08-10）：https://webkit.org/blog/14403/updates-to-storage-policy/
- [WK-ITP] Tracking Prevention in WebKit：https://webkit.org/tracking-prevention/
- [WK-ABD] App-Bound Domains（2020-06-26）：https://webkit.org/blog/10882/app-bound-domains/
- [WK-FEED] WebKit 部落格 RSS：https://webkit.org/feed/ 。抓了其中 7 篇的全文，用第 5.3 節那組字找；只有〈Blocking Identity Resolution Infrastructure〉從頭讀完。7 篇：〈Global Privacy Control (GPC) WebKit API〉https://webkit.org/blog/18646/global-privacy-control-gpc-webkit-api/ 、〈WebKit Features for Safari 27.2〉https://webkit.org/blog/18515/webkit-features-for-safari-27-2/ 、〈WebKit Features for Safari 27.1〉https://webkit.org/blog/18486/webkit-features-for-safari-27-1/ 、〈Blocking Identity Resolution Infrastructure〉https://webkit.org/blog/18438/blocking-identity-resolution-infrastructure/ 、Safari Technology Preview 255／256／257 的版本說明 https://webkit.org/blog/18482/release-notes-for-safari-technology-preview-255/ 、https://webkit.org/blog/18602/release-notes-for-safari-technology-preview-256/ 、https://webkit.org/blog/18652/release-notes-for-safari-technology-preview-257/ 。另外 3 篇（spatial CSS、Apple HomeView、Adaptive Dark Mode）只看了標題。
- [SRC-WDSC] WebKit 原始碼 tag `WebKit-7625.2.8`，`Source/WebKit/UIProcess/WebsiteData/Cocoa/WebsiteDataStoreCocoa.mm`：`websiteDataDirectoryFileSystemRepresentation`、`cacheDirectoryFileSystemRepresentation`、`defaultGeneralStorageDirectory`、`defaultIndexedDBDatabaseDirectory`、`defaultLocalStorageDirectory`、`defaultCacheStorageDirectory`、`defaultServiceWorkerRegistrationDirectory`、`defaultNetworkCacheDirectory`、`defaultResourceLoadStatisticsDirectory`、`defaultWebsiteDataStoreDirectory`：https://github.com/WebKit/WebKit/blob/WebKit-7625.2.8/Source/WebKit/UIProcess/WebsiteData/Cocoa/WebsiteDataStoreCocoa.mm

**前一份筆記**

- [PREV] Issue #294 的〈把網頁包進 app 後，比 Safari 多了什麼、少了什麼〉：本機分支 `research/app-webview-shell`，檔案 `docs/research/app-webview-shell.md`，commit `4a6ecf7`（還沒進 `main`）。第 1.2 節（7 天規則）、1.3 節（空間上限）、1.4 節（空間不夠時會不會被清、存在磁碟哪裡）。
