# App 怎麼建置、簽章、送審，和加密出口要交什麼

Issue #335（地圖 #292）。查核日期 2026-11-22。範圍：iPhone、iPad app 從原始碼到 App Store Connect（含 TestFlight）的三種做法、送審能不能自動、加密出口要答什麼和交什麼、各工具現在的版本。只整理事實；選哪一種做法留給 #340。

我們這邊的前提：

- 公開上架、只在台灣、免費、個人開發者帳號（#302）。
- 殼改了才出新版 app；網頁由殼自己去網站抓（#307）。
- app 是 Swift 寫的殼，用 WKWebView 顯示現在的網頁；程式放這個 repo 的 `ios/`（#301）。查核當天 `main` 還沒有 `ios/`。
- 這個 repo 是公開的，放在 GitHub。
- 正式上架前，先用 TestFlight 給幾位教練試。

上架規定、五種發法、TestFlight 人數和天數、加密出口的基本表格，#296 已經查過，這裡不重複。那份筆記在分支 `research/app-store-rules` 的 `docs/research/app-store-rules.md`，還沒併進 `main`。下文寫「#296 筆記」就是指它。那份「查不到的事」第 13 條（美國的年度自我分類報告要不要交），本篇第 3 節有了答案，但只答到一半，見那一節。

來源只用官方的：Apple 開發者網站和 App Store Connect 說明、GitHub 的文件和 GitHub 官方的 repo、fastlane 的文件和發行紀錄、美國商務部工業安全局（BIS）的網站、美國聯邦法規（eCFR）和聯邦公報（Federal Register）。全部列在最後。版本、價錢、免費額度隨時會改，每個數字後面都有來源代號。這份不是法律意見。

標記方式（跟 #296 筆記一樣）：

- **已確認**：來源上有原句。方括號是來源代號，見文末「來源」。引號裡的英文是照抄的原句。
- **推論**：把來源的規則套到我們的 app，是我的讀法，來源沒有直接寫。
- **查不到**：讀過的官方頁面都沒寫。

## 先講幾個詞

- **建置（build）、封存（archive）**：把原始碼編成 app。要送 App Store 的，是 Xcode「封存」出來的那一份。
- **簽章（code signing）**：用 Apple 發的憑證在 app 上簽名，證明是誰做的、沒被改過。沒簽的 app 傳不上去。
- **發行憑證（Apple Distribution certificate）**：送 App Store Connect 用的那一種憑證。屬於整個團隊，不屬於某個人 [憑證]。
- **雲端簽章憑證（cloud-managed certificate）**：放在 Apple 那邊、由 Apple 管的發行憑證。Xcode 簽章時用它，私鑰不會落到自己的電腦上（推論：Apple 寫的是「managed remotely」）[雲端憑證]。
- **描述檔（provisioning profile）**：寫明「這個 app 用哪張憑證、能用哪些系統功能」的檔。
- **App Store Connect API 金鑰**：讓程式代替人操作 App Store Connect 的鑰匙。分三塊：私鑰檔（`.p8`）、金鑰代碼（key ID）、發行者代碼（issuer ID）[API 金鑰]。分「團隊金鑰」和「個人金鑰」兩種。
- **Team ID**：開發者帳號的團隊代碼。Xcode 專案的 `DEVELOPMENT_TEAM` 設定存的就是它 [建置設定]。
- **執行器（runner）**：GitHub Actions 跑工作的機器。GitHub 提供的叫 GitHub-hosted runner；自己的機器叫 self-hosted runner。
- **fork**：別人把公開 repo 複製一份到自己帳號下。從 fork 發來的合併請求（pull request，PR）裡的程式，是外人寫的。
- **秘密（secret）**：GitHub 或 Xcode Cloud 幫忙保管、跑工作時才放進去的密碼或金鑰。
- **EAR、BIS、ECCN**：EAR 是美國的出口管理規則，BIS 是管它的機關（美國商務部工業安全局）。ECCN 是 EAR 給每種東西的管制編號，加密軟體相關的是 5D002 和 5D992。
- **大眾市場（mass market）**：EAR 裡的一個條件（Category 5 Part 2 的 Note 3）。合乎的加密軟體歸到管制比較鬆的 5D992.c [eCFR CCL]。
- **自我分類報告（self-classification report）**：出口商自己判斷編號後，每年 2 月 1 日前用電子郵件（或郵寄）交給 BIS 的一份 CSV 表 [eCFR 740.17]。

## 結論

1. **三種做法都能把 app 送到 App Store Connect 和 TestFlight。** 開發者計畫的年費（#296 筆記：一年 99 美元）以外：在 Mac 上用 Xcode 手動不用錢；Xcode Cloud 每月含 25 小時，超過要買方案 [Xcode Cloud]；GitHub Actions 在公開 repo 用「標準」執行器（含 macOS）免費、不限量，但 `-large`、`-xlarge` 這類大台的照樣收錢 [GH 計費] [GH 執行器]。已確認。
2. **要保管的秘密不一樣。** 手動：Apple 帳號登入 Xcode，簽章用雲端簽章憑證，repo 裡什麼都不用放 [Xcode 發行] [雲端憑證]。Xcode Cloud：Apple 自己管簽章，只要授權它讀 GitHub repo [XC 設定] [XC 第一個流程]。GitHub Actions：至少要 App Store Connect API 金鑰；照 GitHub 文件的做法，還要 `.p12` 憑證、它的密碼、描述檔、一個臨時鑰匙圈密碼 [GH 簽章]。已確認。
3. **公開 repo 的重點：fork 來的 PR 拿不到 GitHub 的秘密** [GH 用秘密]，第一次貢獻的人預設要核准才會跑 [GH repo 設定]。危險的是 `pull_request_target` 這種觸發方式：它帶著秘密跑、而且不管核准設定都會跑，不能在裡面取出 PR 的程式 [GH 安全] [GH repo 設定]。工作紀錄和產出檔，登入 GitHub 的人都看得到（推論）[GH 紀錄] [GH 產出]。Xcode Cloud 會不會把秘密變數給 fork 來的 PR：查不到。
4. **Xcode 版本會卡 GitHub Actions。** Apple 現在要用 Xcode 26 以上建置 [近期要求]；2027 年 4 月起要用 iOS 27 的 SDK，最低支援 iOS 15 [送審準備]。GitHub 的 `macos-latest` 現在是 macOS 26，預設 Xcode 26.6，沒有 Xcode 27；Xcode 27 只在標「preview」的 `xcode-27` 標籤上 [GH 映像] [GH macOS 26 映像]。已確認。preview 什麼時候轉正式：查不到。
5. **送審可以用 API 做。** App Store Connect API 4.6.1 有：上傳建置、每個建置的加密答案、TestFlight 測試群組和外部測試審查、開新版本、填資料和截圖、年齡分級、給審查的人的資料、價錢和上架地區、送審、撤回、過審後發布、分階段發布 [API 規格] [送審]。已確認。
6. **一定要人在網頁上做的**：Account Holder 簽合約和更新的合約、申請 API 存取（Apple 逐案核准）、產生並下載金鑰（私鑰只能下載一次）[角色] [API 說明] [API 金鑰]。已確認。另外，4.6.1 的規格裡沒有「新建 app 紀錄」「隱私標示」「回覆審查訊息」「DSA 商家身分」的路徑 [API 規格]，這幾件目前要在網頁做（推論）。
7. **加密，Apple 這邊**：只用系統內建的加密，`Info.plist` 的 `ITSAppUsesNonExemptEncryption` 設 `NO`，就不用每次答問卷 [ITS 鍵] [加密文件]。已確認。API 裡這份問卷的欄位是：有沒有自有的加密、有沒有第三方的加密、會不會在法國上架、app 說明 [API 規格]。法國的申報表只有在法國上架才要 [出口文件]。我們只在台灣上架，法國那題答「否」（推論）。
8. **加密，美國 BIS 這邊**：2021-03-29 起，歸在 740.17(b)(1) 的大眾市場成品不用交年度自我分類報告；還要交的是大眾市場的「元件」和 'executable software'，以及非大眾市場、仍是 5A002／5B002／5D002 的東西 [eCFR 740.17] [FR 2021] [BIS 變更表]。已確認。BIS 自己的說明頁還寫成「(b)(1) 都要交」，跟法規條文對不上；以條文為準 [BIS 年報]。我們的 app 算不算大眾市場、算不算加密品項，都還有沒查到的地方，見第 3 節。
9. **現在的正式版**（2026-11-22）：Xcode 27.2（27B52，2026-10-29）；fastlane 2.242.0（2026-11-16）；App Store Connect API 4.6.1；Transporter 1.4.5；GitHub `macos-latest` 映像 20261117.0516.1；`actions/checkout` v7.0.1。細節見第 4 節。

## 1. 建置、簽章、上傳的三種做法

### 對照表

| | Mac 上用 Xcode 手動 | Xcode Cloud | GitHub Actions |
|---|---|---|---|
| 錢（年費以外） | 0。Xcode 從 Mac App Store 免費下載（#296 筆記） | 每月含 25 小時；100 小時 49.99 美元／月起 | 公開 repo 的標準執行器免費、不限量；大台的要錢 |
| 要誰的機器 | 自己的 Mac | Apple 的 | GitHub 的 |
| 簽章 | Xcode 用雲端簽章憑證自動簽 | Apple 簽，要開「自動管理簽章」 | 自己放憑證進去，或用 API 金鑰讓 `xcodebuild` 自動簽 |
| 要保管的秘密 | Apple 帳號（在 Xcode 裡登入） | 授權 Xcode Cloud 讀 GitHub repo；自己的腳本要秘密時才設「秘密變數」 | API 金鑰（`.p8`、key ID、issuer ID）；或 `.p12`＋密碼＋描述檔＋鑰匙圈密碼 |
| 公開 repo 要小心的 | 別把 Team ID、憑證檔 commit 進去 | 從 fork 來的 PR 會不會觸發、拿不拿得到秘密：查不到 | fork 的 PR、`pull_request_target`、公開的紀錄和產出檔 |
| Xcode 版本 | 自己裝 | 在 workflow 設定裡選 | 映像有哪幾版就只能用哪幾版 |

來源：[Xcode Cloud] [GH 計費] [GH 執行器] [Xcode 發行] [雲端憑證] [XC 第一個流程] [XC 流程] [GH 簽章]。下面分開寫。

### Mac 上用 Xcode 手動

- 上傳的方式：Xcode、Swift Playground、`altool`、Transporter；也能用 App Store Connect API 上傳 [上傳建置]。已確認。
- 能上傳的 Xcode 版本：iOS app 要「Xcode 26 or later」建置 [上傳建置]。已確認。
- 簽章：「Xcode uses cloud-managed signing certificates to automatically code sign your app.」[Xcode 發行]。另一頁：「In Xcode 13 or later, Xcode will cloud sign any apps or software for distribution when you’re using the Xcode Organizer archive and distribution workflow」，條件是電腦上找不到自己的發行憑證 [雲端憑證]。已確認。
- 雲端簽章憑證到期前 90 天會自動換新的 [雲端憑證]。已確認。
- 發行憑證「only one type of each distribution certificate ... is allowed per team」，只有 Account Holder 或 Admin 能建；個人帳號的本人就是 Account Holder [憑證]。已確認。
- Apple 把憑證當成敏感的東西：「Do not share Apple Certificates outside of your organization.」[憑證]。已確認。
- Xcode 27.2 要 macOS Tahoe 26.6 以上 [系統需求]。已確認。查核時這台 Mac 的 `xcodebuild -version` 是 Xcode 27.2（27B52）；#296 筆記當時寫的「只有 Command Line Tools」已經不是現況。
- 推論：這條路 repo 裡不用放任何秘密，風險最小；缺點是每次出新版都要有人坐在 Mac 前面。

### Xcode Cloud

- 價錢：「Apple Developer Program membership includes 25 compute hours per month.」加購方案：100 小時 49.99 美元、250 小時 99.99 美元、1,000 小時 399.99 美元、10,000 小時 3,999.99 美元，都是每月 [Xcode Cloud]。已確認（美元，查核當天）。
- 一個「compute hour」怎麼算：「running 5 tests of 12 minutes each equals one compute hour」[Xcode Cloud]。已確認。
- 一定要有開發者計畫 [Xcode Cloud]。第一次要在 Xcode 裡設定，之後可以在 App Store Connect 網頁改 [XC 流程]。已確認。
- 專案要開「Automatically manage signing」，bundle ID 要直接設在 Signing & Capabilities 裡 [XC 設定]。已確認。簽章由 Apple 做，選項有三種：None、「TestFlight (Internal Testing Only)」、「TestFlight and App Store」；要給外部測試者或上架，要選最後一種 [XC 動作]。已確認。
- 給外部測試者的建置要「clean build」，會比較久 [XC 流程]。已確認。教練如果是外部測試者，就是這種（推論）。
- 接 GitHub：沒用 GitHub 組織時，要對 repo 有 admin 權限才能授權 [XC 設定]。已確認。
- 秘密變數：「To securely store an environment variable and make sure it doesn’t appear in any logs, check the “Keep value redacted” (Xcode) or Secret (App Store Connect) box.」[XC 流程]。標成秘密的，在紀錄裡會變成星號 [XC 腳本]。已確認。
- 自己的腳本：放在 `ci_scripts/`，檔名固定是 `ci_post_clone.sh`、`ci_pre_xcodebuild.sh`、`ci_post_xcodebuild.sh` [XC 腳本]。建置機器上有 Homebrew，第三方工具（例如 Node）要自己在 `ci_post_clone.sh` 裡裝；不能用 `sudo` [XC 相依]。已確認。推論：照 #307，網頁是殼自己去網站抓，建置時不用 Node；要是之後決定在 app 裡先放一份網頁，才要裝。
- 觸發條件有：分支有改動、PR 有改動、Git tag、排時間、手動 [XC 觸發]。已確認。
- **fork 的 PR**：說明頁裡 `CI_PULL_REQUEST_SOURCE_REPO` 的例子是「example/fork-of-example-framework」[XC 變數]，所以 PR 的來源可以是 fork。已確認（只確認到這個例子）。這種 PR 會不會自動開始建置、拿不拿得到秘密變數、會不會跑 PR 裡改過的 `ci_scripts`：查不到。推論：送 TestFlight 的 workflow 不要開「PR 有改動」這個觸發，只用指定分支或手動。
- Xcode Cloud 現在能選哪幾版 Xcode：要登入或用 API（`ciXcodeVersions`）才看得到，查不到。

### GitHub Actions（`xcodebuild` 或 fastlane）

**錢**

- 「Use of the standard GitHub-hosted runners is free and unlimited on public repositories.」[GH 執行器]。已確認。
- 標準的 macOS 執行器標籤：`macos-latest`、`macos-15`、`macos-26`、`xcode-27`（M1、3 核）；Intel 的 `macos-15-intel`、`macos-26-intel` [GH 執行器]。已確認。
- 「Larger runners are billed for public repositories.」[GH 計費]。`-large`、`-xlarge` 結尾的就是大台的 [GH 映像]。已確認。
- 對照：私人 repo 的 macOS 一分鐘 0.062 美元，從方案內含的額度扣 [GH 計費]。已確認（跟我們無關，列出來對照）。

**簽章有三種做法**

1. 照 GitHub 文件：把 `.p12` 發行憑證、它的密碼、描述檔轉成 Base64 存成秘密，跑的時候建一個臨時鑰匙圈匯進去。秘密的名字在文件裡是 `BUILD_CERTIFICATE_BASE64`、`P12_PASSWORD`、`BUILD_PROVISION_PROFILE_BASE64`、`KEYCHAIN_PASSWORD` [GH 簽章]。已確認。上傳到 App Store Connect 還要另外的 API 金鑰（推論：文件只講簽章，沒講上傳）。
2. 用 API 金鑰讓 `xcodebuild` 自動簽：`-allowProvisioningUpdates` 讓 `xcodebuild`「create and update profiles, app IDs, and certificates」；`-authenticationKeyPath`、`-authenticationKeyID`、`-authenticationKeyIssuerID` 讓它用 App Store Connect 的金鑰登入 [man xcodebuild]。匯出設定的 `destination` 設成 `upload` 就直接上傳；自動簽章匯出時，Xcode 會建「managed cloud signing certificates」[man xcodebuild]。已確認。這條路只要 `.p8`、key ID、issuer ID 三個秘密（推論）。
   - 要用團隊金鑰：「Individual keys aren’t able to use Provisioning endpoints」[API 金鑰]。已確認。團隊金鑰「can access all apps」，不能只限一個 app [API 金鑰] [API 說明]。已確認。
   - 這把金鑰要什麼角色才夠雲端簽章：查不到。推論：發行憑證只有 Account Holder 和 Admin 能建 [憑證]，所以大概要 Admin。
3. fastlane `match`：把憑證和描述檔加密後放在另一個地方（Git repo、Google Cloud、Amazon S3），用 `MATCH_PASSWORD` 解開 [fl match]。Git 的那種，文件寫「enter the URL to your private (!) Git repo」[fl match]。已確認。推論：這要多一個私人 repo 或雲端空間，加上它的存取金鑰和 `MATCH_PASSWORD`，秘密最多。

**上傳和送審的工具**

- fastlane 的工具，哪些能用 API 金鑰 [fl API]；每個工具做什麼，照 fastlane 的動作列表 [fl 動作]。已確認：

| 工具 | 用 Apple ID | 用 API 金鑰 |
|---|---|---|
| pilot（上傳到 TestFlight） | 可以 | 可以 |
| deliver（上傳資料和建置到 App Store Connect） | 可以 | 可以 |
| sigh、cert、match（描述檔、憑證、在團隊間同步） | 可以 | 可以 |
| produce（在 App Store Connect 和開發者網站建 app） | 部分 | 不行 |
| pem（推播憑證） | 可以 | 不行 |
| precheck（送審前檢查資料） | 可以（App 內購買除外） | 可以（App 內購買除外） |

- 上傳隱私標示的 `upload_app_privacy_details_to_app_store`，登入用的參數是 `username`（Apple ID）和 `team_id`，參數表裡沒有 `api_key` [fl 隱私]。已確認。推論：這個要用 Apple ID 登入，CI 上不好用（要兩步驟驗證）。
- deliver 有 `submit_for_review`、`automatic_release`、`phased_release` 這些選項 [fl deliver]。已確認。
- macOS 26 的映像已經裝好 fastlane 2.242.0、Node.js 24.22.3 [GH macOS 26 映像]。已確認。

**公開 repo 要小心的**

全部已確認，除非另外標：

- fork：「With the exception of GITHUB_TOKEN, secrets are not passed to the runner when a workflow is triggered from a forked repository.」[GH 用秘密]
- 核准：「By default, all first-time contributors require approval to run workflows.」可以改成所有外部貢獻者都要核准 [GH repo 設定]。核准要由有寫入權限的人，在 PR 上看過改動後按「Approve workflows to run」[GH 核准 fork]。只看「第一次」的話，GitHub 自己警告：對方先送一個改錯字的 PR 被合併，之後就不用核准了 [GH repo 設定]。
- `pull_request_target`：「Workflows triggered by pull_request_target events are run in the context of the base branch. ... workflows triggered by these events will always run, regardless of approval settings.」[GH repo 設定]。這種 workflow 可能拿到秘密和寫入權限，「must not explicitly check out untrusted code, including from pull request forks」[GH 安全]。
- 自己的執行器：「self-hosted runners should almost never be used for public repositories on GitHub」[GH 安全]。推論：不要把自己的 Mac 掛成這個 repo 的執行器。
- 環境（environment）：秘密可以放在環境裡，設「required reviewers」，有人核准後工作才拿得到 [GH 秘密] [GH 環境]。「Environments, environment secrets, and deployment protection rules are available in public repositories for all current GitHub plans.」免費方案的私人 repo 不能用 [GH 環境]。推論：Apple 的秘密放在一個要本人核准的環境裡，比放在 repo 層級安全。
- 紀錄會自動遮秘密，但「this redaction is not guaranteed」[GH 秘密]；不要把 JSON 這種結構化資料整包當一個秘密 [GH 安全]。推論：fastlane 的金鑰 JSON 檔（[fl API]）就是這種，`.p8` 的內容、key ID、issuer ID 要分成三個秘密。
- 紀錄和產出檔：看紀錄要「Read access to the repository」，公開 repo 也要先登入 [GH 紀錄]；「People who are signed into GitHub and have read access to a repository can download workflow artifacts.」[GH 產出]。預設保留 90 天 [GH repo 設定]。推論：公開 repo 等於所有登入的人都能看紀錄、下載產出檔，所以 `.ipa`、`.p12`、`.p8` 不能當產出檔上傳，紀錄裡也會看到簽章用的團隊和憑證名字。
- 別人寫的 action 要釘在某個 commit SHA [GH 安全]。

### 不管走哪一種

- **Team ID 會跟著專案檔進 repo。** Xcode 選了團隊後，`DEVELOPMENT_TEAM` 存的是「The team ID of a development team」[建置設定]。Team ID 算不算秘密：Apple 的頁面沒寫，查不到。推論：照這個 repo 的規則不放；`xcodebuild` 可以在指令後面加 `DEVELOPMENT_TEAM=…` 蓋掉專案裡的設定 [man xcodebuild]，或放在不 commit 的 `.xcconfig`。但 Xcode Cloud 要 bundle ID 直接寫在專案裡 [XC 設定]，Team ID 不寫在專案裡 Xcode Cloud 跑不跑得動：查不到。
- **上傳前要先有 app 紀錄**：「After adding an app to your account, you can upload a build」[上傳建置]。「You can't add an app to your account until the Account Holder signs the latest agreement in the Business section.」[新增 app]。已確認。
- **API 金鑰的保管**：Apple 寫「Don’t share your keys, store keys in a code repository, or include keys in client-side code.」私鑰「available for download a single time」，Apple 不留副本；外洩要馬上撤銷 [API 金鑰]。已確認。

## 2. 送審能不能自動

### API 做得到的

查的是 Apple 公開的 OpenAPI 規格檔，`info.version` 是 4.6.1，跟 API 版本紀錄最新的一版相同 [API 規格] [API 版本紀錄]。下表的「路徑」都在規格裡，已確認。

| 步驟 | 路徑和方法 |
|---|---|
| 上傳建置 | `POST /v1/buildUploads`、`/v1/buildUploadFiles`；或用 Transporter 的命令列工具帶 API 的 JWT [上傳建置] |
| 每個建置的加密答案 | `PATCH /v1/builds/{id}`，欄位 `usesNonExemptEncryption` |
| 加密的問卷 | `POST /v1/appEncryptionDeclarations` |
| TestFlight 群組、測試者 | `/v1/betaGroups`、`/v1/betaTesters` |
| 外部測試的審查 | `POST /v1/betaAppReviewSubmissions` |
| 開新版本、改版本號、選發布方式 | `POST /v1/appStoreVersions`；`PATCH /v1/appStoreVersions/{id}` 的 `releaseType`（`MANUAL`、`AFTER_APPROVAL`、`SCHEDULED`） |
| 說明文字、截圖 | `/v1/appStoreVersionLocalizations`、`/v1/appInfoLocalizations`、`/v1/appScreenshotSets`、`/v1/appScreenshots` |
| 年齡分級 | `PATCH /v1/ageRatingDeclarations/{id}` |
| 有沒有用第三方內容 | `PATCH /v1/apps/{id}` 的 `contentRightsDeclaration` |
| 給審查的人的資料（測試帳號、備註） | `POST /v1/appStoreReviewDetails`、`/v1/appStoreReviewAttachments` |
| 價錢、上架地區 | `POST /v1/appPriceSchedules`、`POST /v2/appAvailabilities` |
| 送審 | `POST /v1/reviewSubmissions` → `POST /v1/reviewSubmissionItems` → `PATCH /v1/reviewSubmissions/{id}`，欄位 `submitted: true` [API 送審] |
| 撤回送審 | 同一個 `PATCH`，欄位 `canceled: true` |
| 過審後發布、分階段發布 | `POST /v1/appStoreVersionReleaseRequests`、`/v1/appStoreVersionPhasedReleases` |

- Apple 的送審說明頁有一行「Learn how to submit using the App Store Connect API.」[送審]。已確認。
- 新增 app 那一頁的問答：「Yes, you can manage In-App Purchases, subscriptions, metadata, and app pricing via the App Store Connect REST API」[新增 app]。已確認。
- 推論：第一次上架的版本，也是同一組路徑；規格裡沒有「第一次不能用 API」的限制，但也沒有明寫可以。

### 一定要人在網頁上做的

已確認（Apple 有原句）：

- **簽合約**：Account Holder「is the only user that can sign legal agreements, renew membership, request access to the App Store Connect API」[角色]。
- **合約更新後**：Account Holder 沒簽最新的合約，就不能新增 app [新增 app]。
- **申請 API 存取**：「the Account Holder must request access to the API in App Store Connect」；「your request is reviewed and approved on a case-by-case basis」[API 說明]。
- **產生、下載金鑰**：團隊金鑰要 Account Holder 或 Admin 在「Users and Access → Integrations」產生 [API 說明] [API 金鑰]；私鑰只能下載一次 [API 金鑰]。產生後不能改名字和權限，要改就撤銷重建 [API 說明]。

查核當天 4.6.1 規格裡沒有路徑的（所以推論要在網頁做）：

- **新建 app 紀錄**：`/v1/apps` 只有 `GET`，`/v1/apps/{id}` 只有 `GET`、`PATCH`，沒有 `POST` [API 規格]。fastlane 的 produce 用 API 金鑰也「不行」[fl API]。Apple 說明頁的做法是在 App Store Connect 的 Apps 按「+」[新增 app]。Xcode Cloud 第一次設定時，Xcode 也會幫忙建 [XC 第一個流程]。
- **隱私標示**：整份規格搜「privacy」，只有隱私權政策的網址和文字欄位（`privacyPolicyUrl`、`privacyChoicesUrl`、`privacyPolicyText`，在 `AppInfoLocalization`、`BetaAppLocalization` 裡），沒有填「收哪些資料」的路徑 [API 規格]。fastlane 上傳隱私標示的 action 也是用 Apple ID 登入 [fl 隱私]。#296 筆記寫過：隱私標示答案改了不用送新版本。
- **回覆審查訊息**：規格裡沒有讀或回 App Review 訊息的路徑 [API 規格]。Apple 說訊息在 App Store Connect 側邊欄的 App Review 區 [送審]。
- **DSA 商家身分**：整份規格搜「trader」，只出現在一組狀態值裡（例如 `TRADER_STATUS_NOT_PROVIDED`），沒有申報的路徑 [API 規格]。#296 筆記寫過：就算不在歐盟上架，也要申報一次。
- **加急審查**：要先送審，再到「Request an Expedited App Review」頁選 app 和平台送出 [加急]。規格裡搜「expedit」沒有結果 [API 規格]。

推論：這些大多只做一次（簽合約、申請 API、建 app、填隱私、申報商家身分）。每次出新版真正要重複的（上傳、加密答案、說明文字、送審、發布）API 都有。被退件時回覆審查的人，還是要上網頁。

## 3. 加密出口

### Apple 這邊：`ITSAppUsesNonExemptEncryption` 怎麼填

- 「Set the value for this key to `NO` in your app’s Information Property List file to indicate that your app—including any third-party libraries you link against—either uses no encryption, or only uses encryption that’s exempt from export compliance requirements」[ITS 鍵]。已確認。
- Apple 自己舉的例子：「Typically, the use of encryption that’s built into the operating system—for example, when your app makes HTTPS connections using URLSession—is exempt from export documentation upload requirements, whereas the use of proprietary encryption is not.」[加密文件]。已確認。
- 不加這個鍵：「App Store Connect walks you through an export compliance questionnaire every time you upload a new version of your app.」[ITS 鍵]。TestFlight 的建置沒答，會被標成「Missing Compliance」[出口：測試版]。已確認。
- Apple 列「要判斷出口」的例子裡，有一條就是「Crypto functionality within Apple’s operating system.」[出口總覽]。已確認。也就是說，只用系統的加密也要表態（答問卷或加鍵），只是不用交文件（推論，配合 [出口文件] 的表）。
- 不用交文件的情形，下一步只有一件：改 `Info.plist`，不用每次答 [出口總覽]。已確認。
- 推論，套到我們：
  - 殼用 WKWebView 連 HTTPS，用的是系統的 TLS，跟 Apple 舉的 URLSession 是同一類。Apple 只舉了 URLSession，WKWebView 沒有點名。
  - 網頁那邊，查核當天 `main` 的 `src/` 只有用 `crypto.getRandomValues` 產生隨機代碼，沒有用 `crypto.subtle` 加解密，`package.json` 沒有加密的套件。
  - 所以 `ITSAppUsesNonExemptEncryption` 設 `NO`。之後要是殼或網頁自己帶了加密的程式庫，要重看。
- API 裡也能答：每個建置的 `usesNonExemptEncryption`（`PATCH /v1/builds/{id}`）[API 規格]。已確認。

### App Store Connect 還會問什麼（含法國）

- 問卷「presenting you with a set of questions about your app and where you plan to make it available」[出口總覽]。網頁上的題目原文：要登入才看得到，查不到。
- API 的加密問卷（`AppEncryptionDeclarationCreateRequest`），必填的四個欄位是 `containsProprietaryCryptography`（有沒有自有的加密）、`containsThirdPartyCryptography`（有沒有第三方的加密）、`availableOnFrenchStore`（會不會在法國上架）、`appDescription`（app 說明）[API 規格]。已確認。`usesEncryption` 這個欄位已標成 deprecated [API 規格]。推論：網頁的題目跟這幾個欄位對應。
- 法國：「The import and export of encryption apps distributed in France are also controlled by the French Government. The main items of control for France are Secure Storage, Secure Communications, and Security Anti-Virus applications. Exemptions include Banking and Medical applications.」[出口總覽]。申報表「is only required if you’re distributing your app on the App Store in France」[出口文件]。已確認。推論：只在台灣上架，法國那題答否，也不用交法國的表。
- 真的要交文件時，Apple 大約 2 個工作天審完，審過會給一個代碼，填進 `ITSEncryptionExportComplianceCode` [出口判斷] [ITS 鍵]。已確認。跟我們無關。
- 判斷錯了的責任在開發者：「you're responsible for all liabilities associated with misinterpretation of export regulations or claiming exemption inaccurately.」[出口總覽]。已確認。

### 美國 BIS 這邊：年度自我分類報告還要不要交

**Apple 怎麼說**：「If your app uses exempt forms of encryption, you might alternatively be required to submit a year-end self-classification report to the U.S. government.」這句連到 BIS 的「Annual self-classification」頁 [加密文件]。已確認。Apple 也說，在美國以外發 app，不管開發者在哪個國家，都受美國出口法管，因為上傳是送到美國的伺服器 [加密文件]。

**法規條文**（eCFR，網頁寫 Title 15「up to date as of 2026-11-19」），已確認：

- 誰要交，寫在 740.17(e)(3)：「Specifically, this reporting requirement applies to “mass market” encryption components and 'executable software' that meet the criteria of the Cryptography Note—Note 3 to Category 5—Part 2 of the CCL (“mass market” note) and are classified under ECCN 5A992 or 5D992 following self-classification, as well as to non-“mass market” encryption commodities and software that remain classified in ECCN 5A002, 5B002, or 5D002 following self-classification, provided these items are not further described by paragraph (b)(2) or (3) of this section.」[eCFR 740.17]
- 'executable software' 的定義：「'executable software' means “software” in executable form, from an existing hardware component excluded from ECCN 5A002 by the Cryptography Note.」[eCFR 740.17]。也就是硬體元件的韌體、驅動這類，不是一般的 app（推論）。
- Note 3 的附註最後一句：「For mass market commodities and software that do not require a self-classification report pursuant to § 740.17(b) and (e)(3) of the EAR, such items are also released from “EI” and “NS” controls and controlled under ECCN 5A992 or 5D992.」[eCFR CCL]
- 740.17 開頭提醒：不用交報告的，還是要照 Part 762 留紀錄，被要求時要拿得出來：「exporters are reminded of the recordkeeping requirements in part 762 of the EAR and that they may be required to make such records available upon request.」[eCFR 740.17]
- 期限和交法：每年 2 月 1 日前，交前一年；CSV 格式；用電子郵件（或郵寄）交給 BIS 和「ENC Encryption Request Coordinator」；那一年沒有新產品，也要寄信說沒變 [eCFR 740.17]。
- 740.17 最後一次修改是 2024-04-19（89 FR 28599），2021 年那次是 86 FR 16487 [eCFR 740.17]。

**2021 年改了什麼**，已確認：

- 聯邦公報 86 FR 16482（2021-03-29 公布、當天生效），標題就有「Elimination of Reporting Requirements for Certain Encryption Items」[FR 2021]。
- 原句：「Under these revisions, “mass market” encryption items that fall under Sec. 740.17(b)(1) no longer require classification by BIS or submission of a self-classification report except as noted above.」「except as noted above」指的是元件和 'executable software' [FR 2021]。
- BIS 自己做的對照表，「5x992.c – mass market items described in 740.17(b)(1)」那一列：改之前「Required self-classification report or classification.」，改之後「No self-classification report or classification required.」[BIS 變更表]。
- 同一個規定也取消了「公開的加密原始碼」要寄信通知的規定，只剩「non-standard cryptography」還要通知 [FR 2021] [eCFR 742.15]。推論：這個 repo 是公開的，但裡面沒有自己寫的加密程式，這條管不到。

**BIS 網頁跟條文對不上**，已確認：

- BIS 的「Annual self-classification」頁（沒有寫日期）：「An annual self-classification report is a requirement for items exported under License Exception ENC - 740.17(b)(1), UNLESS a Commodity Classification (CCATS) has been submitted for the item.」[BIS 年報]。沒有寫 2021 年加的那個限定。
- BIS 的「Mass market」頁也寫「Mass market items that are described under in 740.17(b)(1) can be self-classified with an annual self-classification report.」[BIS 大眾市場]。
- BIS 的加密問答 PDF 寫「Published Date: March 2017」，比 2021 年的修改早 [BIS 問答]。
- 推論：有約束力的是法規條文（eCFR）和公告（Federal Register）；BIS 自己 2021 年的對照表也寫「不用交」。網頁是沒更新。Apple 那句「might」連的就是這個沒更新的頁。

**套到我們**，全部是推論，除非另外標：

- 「不用交」要同時成立這幾件：
  1. app 合乎 Note 3 的 a 款，算大眾市場。a 款的條件是：「Generally available to the public by being sold, without restriction, from stock at retail selling points」（含「Electronic transactions」）、使用者改不了加密功能、使用者自己裝不用廠商幫忙、主管機關要時拿得出細節 [eCFR CCL]。Note 3 的附註還要「The item is of potential interest to a wide range of individuals and businesses」，而且「The price and information about the main functionality of the item are available before purchase without the need to consult the vendor or supplier」[eCFR CCL]。已確認（條文）。我們的 app 免費、從 App Store 誰都能裝。條文寫的是「being sold」「price」，免費的算不算：查不到。下面幾條相關，但都沒有直接回答：
     - 2011 年的公告寫過：「a person or company does not violate the EAR if it posts “mass market” encryption software on the Internet for free and anonymous download」[FR 2011]。已確認。推論：BIS 當時的用法裡，免費的軟體也可以是大眾市場。但 App Store 要登入 Apple 帳號才能下載，算不算「anonymous」：查不到。
     - 現行 740.17(b) 的附註：「Mass market encryption software that would be considered publicly available under § 734.3(b)(3) of the EAR, and is authorized for export under this paragraph (b), remains subject to the EAR until all applicable classification or self-classification requirements set forth in this section are fulfilled.」[eCFR 740.17]。已確認。
     - 734.7：公開、不限制再散布的軟體算「published」，不受 EAR 管；但 (b) 款說 5D002 的加密軟體還是受管，除非是公開的 object code 而且原始碼合乎 742.15(b) [eCFR 734]。已確認。推論：這幾條講的是「公開的加密軟體受不受管」，不是「免費算不算 sold」，第 1 件還是查不到。
  2. app 不是元件，也不是 'executable software'。照上面的定義，一般的 app 不是。
  3. app 沒有用「non-standard cryptography」。只用系統的 TLS，沒有。
- 三件都成立，就是 (b)(1) 的大眾市場成品，歸 5D992.c，不用交年度報告，但要留紀錄。
- 第 1 件不成立（不算大眾市場）的話，就是自我分類後還在 5D002 的非大眾市場軟體，照 (e)(3) **要交**。
- 另一個可能：加密全是 iOS 做的，app 本身根本不算加密品項。CCL 5A002 的「Related Controls」舉過類似的例子（健身車內建的瀏覽器做了加密，健身車不算 5A002.a.4）[eCFR CCL]，但那是講硬體，軟體 app 只呼叫系統加密時 BIS 怎麼看：查不到。
- 誰算「出口商」（上傳的是我們，送出去的是 Apple 的伺服器）：Apple 說受美國法管 [加密文件]；BIS 怎麼認定：查不到。
- 想要確定，可以照 740.17(b) 送一份分類申請（CCATS）給 BIS；拿到 CCATS 的品項就不用交自我分類報告 [eCFR 740.17] [BIS 大眾市場]。這要不要做留給 #340。

## 4. 各工具現在的版本

查核日期 2026-11-22。

| 工具 | 現在的正式版 | 日期 | 來源 |
|---|---|---|---|
| Xcode | 27.2（27B52） | 2026-10-29 | [發行紀錄] |
| Xcode beta（不是正式版） | 27.3 beta 2（27C5035i） | 2026-11-16 | [發行紀錄] |
| Xcode 27.2 要的 macOS | macOS Tahoe 26.6 以上 | — | [系統需求] |
| Transporter | 1.4.5 | 2026-09-08 | [發行紀錄] |
| App Store Connect API | 4.6.1 | 規格檔日期 2026-11-19 | [API 規格] [API 版本紀錄] |
| fastlane | 2.242.0 | 2026-11-16 | [fl 版本] |
| GitHub `macos-latest` | macOS 26 Arm64，映像 20261117.0516.1；系統 macOS 26.7.2；預設 Xcode 26.6（17F113），另有 26.0.1 到 26.5 | 映像發布 2026-11-18 | [GH 映像] [GH macOS 26 映像] |
| GitHub `xcode-27`（preview） | 映像 20261104.0337.1；系統 macOS 27.0.1；有 Xcode 27.0、27.1（預設）、27.2 | 映像發布 2026-11-04 | [GH 映像] [GH Xcode 27 映像] [GH Xcode 27 公告] |
| GitHub `actions/checkout` | v7.0.1 | 2026-07-20 | [GH checkout] |
| macOS 26 映像裡的 fastlane、Node.js | 2.242.0、24.22.3 | — | [GH macOS 26 映像] |

說明，已確認：

- Xcode 的版本和日期從 Apple 的「Software Releases」頁讀的；那一頁上最新的非 beta 是 27.2 [發行紀錄]。
- `macos-latest` 指到 macOS 26 Arm64；README 寫「-latest」是「the latest OS image version that is GA」，換版前會先公告，換的過程要一到兩個月 [GH 映像]。
- `xcode-27` 在 README 上標「preview」[GH 映像]。公告寫：「The image is marked as "preview" for now. It means some software can be unstable on the new platform.」[GH Xcode 27 公告]。GitHub 的發行列表上，2026-11-04 那一版沒有標 prerelease、2026-11-19 那一版有標；這裡照 README 的標記算 preview。
- 每個 macOS 版本只放一個主版本的 Xcode；beta、RC 版只放在最新的 macOS 映像 [GH 映像]。
- 推論：Apple 的規定（2026-04-28 起要 Xcode 26 以上）現在 `macos-latest` 做得到；2027 年 4 月起要 iOS 27 SDK，`macos-latest` 到時候還是 Xcode 26 的話就不夠，要改用 `xcode-27` 或之後正式的 macOS 27 映像。macOS 27 映像什麼時候正式：查不到。
- Apple 另外規定：2026-09-09 起上傳的 app 最低支援版本要 iOS 13 以上 [近期要求]；2027 年 4 月起要 iOS 15 以上 [送審準備]。Xcode 27.2 能設的最低版本是 iOS 15 [系統需求]。

## 查不到的事

1. Xcode Cloud：從 fork 來的 PR 會不會觸發建置、拿不拿得到秘密變數、會不會跑 PR 裡改過的 `ci_scripts`。
2. Xcode Cloud 現在能選哪幾版 Xcode（要登入或用 API 才看得到）。
3. Team ID 算不算要保密的資料；Team ID 不寫在專案檔裡時，Xcode Cloud 跑不跑得動。
4. 讓 `xcodebuild` 用 API 金鑰雲端簽章，金鑰最少要什麼角色。
5. 第一次上架的版本，能不能全程用 API 送審（規格沒限制，也沒明寫）。
6. App Store Connect 網頁上加密問卷的題目原文。
7. 免費的 app 算不算 Note 3 a 款寫的「being sold」，也就是算不算大眾市場。讀過 Note 3 和它的附註、740.17(b) 的附註、734.3、734.7、76 FR 1059 的摘要和其中一段，都沒有直接回答。
8. 只呼叫系統加密的 app，BIS 算不算加密品項；上傳到 App Store 時誰算出口商。
9. GitHub 的 macOS 27 映像什麼時候轉正式、`macos-latest` 什麼時候換過去。
10. App Store Connect 說明目錄裡還有「Declare Regulated Medical Device Status」「Complete the Digital Goods and Services questionnaire」這兩頁，只看到標題、沒讀，我們要不要填。

## 來源

查核日期都是 2026-11-22。沒另外註明的，是整頁讀完的。標「讀了一部分」的，是整頁抓下來、只讀了寫明的那幾段。Apple 開發者文件（`/documentation/`）的網頁要跑程式才顯示，讀的是同一頁背後的資料檔（`/tutorials/data/documentation/….json`），內容相同。

**Apple：上傳、送審、API**

- [上傳建置] Upload builds。讀了一部分：開頭、支援的 Xcode 版本、用 API 和 `altool` 上傳；Transporter 那一段沒讀完。<https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds>
- [新增 app] Add a new app。<https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app>
- [送審] Submit for review。讀了一部分：開頭、App Review 區、用 API 送審的連結、問答的前兩題。<https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-for-review>
- [加急] Request an expedited review。讀了一部分：申請步驟。<https://developer.apple.com/help/app-review/after-submitting-for-review/request-expedited-review>
- [角色] Role permissions。讀了一部分：角色說明，沒讀各功能的權限表。<https://developer.apple.com/help/app-store-connect/reference/account-management/role-permissions>
- [API 說明] App Store Connect API（說明頁）。讀了一部分：申請存取、產生團隊金鑰和個人金鑰、管理金鑰。<https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api>
- [API 金鑰] Creating API Keys for App Store Connect API。<https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api>
- [API 規格] App Store Connect API 的 OpenAPI 規格檔，`info.version` 4.6.1，壓縮檔裡的檔案日期 2026-11-19。用程式列出路徑、方法和欄位，沒有逐行讀。<https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip>
- [API 送審] Review submissions。<https://developer.apple.com/documentation/appstoreconnectapi/review-submissions>
- [API 版本紀錄] App Store Connect API Release Notes。讀了一部分：版本列表。<https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-release-notes>

**Apple：簽章、Xcode**

- [憑證] Certificates overview。讀了一部分：開頭、保護帳號和憑證、憑證種類、到期或撤銷。<https://developer.apple.com/help/account/certificates/certificates-overview>
- [雲端憑證] Cloud-managed certificates。讀了一部分：說明的段落，沒讀列出的操作步驟。<https://developer.apple.com/help/account/certificates/cloud-managed-certificates>
- [Xcode 發行] Distributing your app for beta testing and releases。讀了一部分：簽章那幾段。<https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases>
- [man xcodebuild] Xcode 27.2（27B52）內附的 `man xcodebuild`，和 `xcodebuild -help` 的匯出設定說明。讀了一部分：`-allowProvisioningUpdates`、`-authenticationKey*`、`buildsetting=value`、`destination`、`method`、`signingStyle`。
- [建置設定] Build settings reference。讀了一部分：`DEVELOPMENT_TEAM`。<https://developer.apple.com/documentation/xcode/build-settings-reference>
- [發行紀錄] Software Releases。讀了一部分：2026-06 到 2026-11 的 Xcode、Transporter。<https://developer.apple.com/news/releases/>
- [系統需求] Xcode system requirements。讀了一部分：Xcode 27.3 beta 2、27.2 兩列。<https://developer.apple.com/xcode/system-requirements/>
- [近期要求] Upcoming Requirements。讀了一部分：最上面兩則。<https://developer.apple.com/news/upcoming-requirements/>
- [送審準備] Submit your apps and games today。讀了一部分：「Update for the latest OS releases」那一段。<https://developer.apple.com/app-store/submitting/>

**Apple：Xcode Cloud**

- [Xcode Cloud] Xcode Cloud（產品和價錢頁）。<https://developer.apple.com/xcode-cloud/>
- [XC 設定] Setting up your project to use Xcode Cloud。讀了一部分：用搜字找帳號、簽章、bundle ID、原始碼權限的段落。<https://developer.apple.com/documentation/xcode/setting-up-your-project-to-use-xcode-cloud>
- [XC 第一個流程] Configuring your first Xcode Cloud workflow。讀了一部分：用搜字找原始碼授權、建 app 紀錄的段落。<https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow>
- [XC 流程] Xcode Cloud workflow reference。<https://developer.apple.com/documentation/xcode/xcode-cloud-workflow-reference>
- [XC 觸發] Configuring start conditions。讀了一部分：開頭、PR 的觸發、檔案條件、排時間、手動。<https://developer.apple.com/documentation/xcode/configuring-start-conditions>
- [XC 動作] Configuring your Xcode Cloud workflow’s actions。讀了一部分：build、analyze、archive 和 Deployment Preparation 的三個選項。<https://developer.apple.com/documentation/xcode/configuring-your-xcode-cloud-workflow-s-actions>
- [XC 腳本] Writing custom build scripts。讀了一部分：用搜字找腳本名字、紀錄、秘密的段落。<https://developer.apple.com/documentation/xcode/writing-custom-build-scripts>
- [XC 相依] Making dependencies available to Xcode Cloud。讀了一部分：用自訂腳本裝第三方工具那一段。<https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud>
- [XC 變數] Environment variable reference。讀了一部分：PR 相關的變數。<https://developer.apple.com/documentation/xcode/environment-variable-reference>

**Apple：加密出口**

- [出口總覽] Overview of export compliance。讀了一部分：正文和「Scenario／Next Steps」表，沒讀側邊欄。<https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/>
- [出口判斷] Determine and upload app encryption documentation。讀了一部分：判斷要不要交、上傳文件、審查天數那幾段。<https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation>
- [出口文件] Export compliance documentation for encryption。<https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption>
- [出口：測試版] Provide export compliance information for beta builds。<https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds>
- [加密文件] Complying with Encryption Export Regulations。<https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations>
- [ITS 鍵] ITSAppUsesNonExemptEncryption。<https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption>

**GitHub**

- [GH 計費] GitHub Actions billing。讀了一部分：怎麼計量、免費的用量、內含額度、每分鐘價錢。<https://docs.github.com/en/billing/concepts/product-billing/github-actions>
- [GH 執行器] GitHub-hosted runners（標準執行器的標籤和規格）。讀了一部分：公開 repo 的標準執行器表、arm64 macOS 的限制。<https://docs.github.com/en/actions/reference/runners/github-hosted-runners>
- [GH 映像] actions/runner-images 的 README（`main` 分支）。讀了一部分：映像表、標籤規則、Beta 和 GA、預裝政策。<https://github.com/actions/runner-images>
- [GH macOS 26 映像] macOS 26 Arm64 映像的軟體清單。讀了一部分：開頭、Xcode、fastlane、Node.js。<https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md>
- [GH Xcode 27 映像] Xcode 27 映像的軟體清單。讀了一部分：開頭、Xcode、fastlane。<https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md>
- [GH Xcode 27 公告] actions/runner-images issue #14404「Xcode 27 is now available as a public preview」（2026-07-16，2026-09-16 補充）。讀了一部分：開頭到「Possible impact」。<https://github.com/actions/runner-images/issues/14404>
- [GH 簽章] Installing an Apple certificate on macOS runners for Xcode development。讀了一部分：建立秘密、加步驟；沒讀自己執行器的清理。<https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications>
- [GH 秘密] Secrets（概念）。讀了一部分：環境秘密、自動遮蔽。<https://docs.github.com/en/actions/concepts/security/secrets>
- [GH 用秘密] Using secrets in GitHub Actions。讀了一部分：fork 那一句。<https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets>
- [GH 安全] Secure use reference。讀了一部分：秘密、`pull_request_target`、釘 SHA、自己的執行器。<https://docs.github.com/en/actions/reference/security/secure-use>
- [GH repo 設定] Managing GitHub Actions settings for a repository。讀了一部分：fork 的核准、紀錄保留天數。<https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository>
- [GH 核准 fork] Approving workflow runs from forks。<https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks>
- [GH 環境] Managing environments for deployment。讀了一部分：哪些方案能用、required reviewers、環境秘密。<https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>
- [GH 紀錄] Using workflow run logs。讀了一部分：開頭和權限。<https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs>
- [GH 產出] Downloading workflow artifacts。讀了一部分：誰能下載。<https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts>
- [GH checkout] actions/checkout 的最新發行（GitHub API `releases/latest`）。<https://github.com/actions/checkout/releases>

**fastlane**

- [fl API] Using App Store Connect API。<https://docs.fastlane.tools/app-store-connect-api/>
- [fl match] match。讀了一部分：存放方式、加密、CI 設定。<https://docs.fastlane.tools/actions/match/>
- [fl deliver] upload_to_app_store（deliver）。讀了一部分：送審、發布、分階段的選項。<https://docs.fastlane.tools/actions/upload_to_app_store/>
- [fl 隱私] upload_app_privacy_details_to_app_store。讀了一部分：參數表裡跟登入有關的參數，和有沒有 `api_key`。<https://docs.fastlane.tools/actions/upload_app_privacy_details_to_app_store/>
- [fl 動作] fastlane 的動作列表（Available Actions）。讀了一部分：pilot、deliver、sigh、cert、match、produce、pem、precheck 那幾列。<https://docs.fastlane.tools/actions/>
- [fl 版本] fastlane 的發行列表（GitHub API `releases/latest` 和最近 5 版）。<https://github.com/fastlane/fastlane/releases>

**美國法規和 BIS**

eCFR 的內文都是從 eCFR 的 API（`/api/versioner/v1/full/2026-11-19/title-15.xml`）抓 2026-11-19 那一版，Title 15 的資料寫「up to date as of 2026-11-19」；下面列的是同一節的網頁網址，查核當天打得開。

- [eCFR 740.17] 15 CFR 740.17 Encryption commodities, software, and technology (ENC)。讀了一部分：開頭、(a)、(b) 開頭和它的附註、(b)(1)、(e)。<https://www.ecfr.gov/current/title-15/section-740.17>
- [eCFR 742.15] 15 CFR 742.15 Encryption items。讀了一部分：(b)。<https://www.ecfr.gov/current/title-15/section-742.15>
- [eCFR 734] 15 CFR 734.3 Items subject to the EAR、734.7 Published。兩節都讀完。<https://www.ecfr.gov/current/title-15/section-734.3>、<https://www.ecfr.gov/current/title-15/section-734.7>
- [eCFR CCL] 15 CFR Part 774 Supplement No. 1（Commerce Control List）。讀了一部分：Category 5 Part 2 的 Note 1 到 Note 3（含附註）、5A002 的 Related Controls 和 a 款。<https://www.ecfr.gov/current/title-15/part-774/appendix-Supplement%20No.%201%20to%20Part%20774>
- [FR 2021] 86 FR 16482，Export Administration Regulations: Implementation of Wassenaar Arrangement 2019 Plenary Decisions; Elimination of Reporting Requirements for Certain Encryption Items（2021-03-29）。讀了一部分：摘要、Category 5 Part 2 的修改說明、740.17 和 742.15 的修改說明。<https://www.federalregister.gov/documents/2021/03/29/2021-05481/export-administration-regulations-implementation-of-wassenaar-arrangement-2019-plenary-decisions>
- [FR 2011] 76 FR 1059，Publicly Available Mass Market Encryption Software and Other Specified Publicly Available Encryption Software in Object Code（2011-01-07）。讀了一部分：摘要，和「free and anonymous download」那一段。<https://www.federalregister.gov/documents/2011/01/07/2010-32803/publicly-available-mass-market-encryption-software-and-other-specified-publicly-available-encryption>
- [BIS 變更表] Elimination of Reporting Requirements for Certain Encryption Items, 86 FR 16482 (March 29, 2021)（BIS 做的對照表 PDF）。<https://www.bis.gov/media/documents/table-changes-enc-wa2019-rule-final-version.pdf>
- [BIS 大眾市場] Mass market (Section 740.17)。<https://www.bis.gov/learn-support/encryption-controls/mass-market>
- [BIS 年報] Annual self-classification。Apple 連的是舊網址 `bis.doc.gov/index.php/policy-guidance/encryption/4-reports-and-reviews/a-annual-self-classification`，讀的是新網址。<https://www.bis.gov/learn-support/encryption-controls/annual-self-classification>
- [BIS 問答] Encryption FAQs（PDF，Published Date: March 2017）。讀了一部分：Q.1 到 Q.3。<https://www.bis.gov/media/documents/encryption-faqs.pdf>

**沒讀到的**

- Xcode Cloud 的「Requirements for using Xcode Cloud」資料檔，猜的網址回「找不到」；改讀 [XC 設定]。
- Xcode Cloud 的版本說明（能選哪幾版 Xcode），試的網址回「找不到」。
- 搜尋工具用過兩次：一次找 BIS 加密說明頁的網址，一次找 `xcodebuild` 金鑰參數的文件（沒找到，改讀本機的 man page）。搜尋工具給的摘要沒有寫進這份筆記。
