# App Store 上架的規定和發 app 的方法

Issue #296（地圖 #292）。查核日期 2026-11-20。範圍：iPhone、iPad app 要從 App Store 這類地方裝，Apple 有哪些規定會擋到我們、有哪幾種發法。只整理事實；選哪種發法留給 #302。

我們這邊的前提照 #183：只有管理員能加人，沒有自己註冊；使用者只能停用，不能刪除。不登入也能用本機流程，登入才有雲端流程。

來源全部是 Apple 自己的網頁（審查準則、開發者計畫、App Store Connect 說明、授權合約），列在最後。審查準則那一頁寫的最後更新日是 2026-10-16。價錢、天數、人數 Apple 隨時會改，每個數字後面都有來源代號。這份不是法律意見。

用詞照 `GLOSSARY.md`：使用者、管理員、邀請、停用、本機流程、雲端流程。Apple 那邊付年費的資格，這裡叫「開發者計畫」。

標記方式：

- **已確認**：Apple 的頁面上有原句。方括號是來源代號，見文末「來源」。引號裡的英文是照抄的原句，條號寫在前面。
- **推論**：把 Apple 的規則套到我們的 app，是我的讀法，Apple 沒有直接寫。
- **查不到**：讀過的 Apple 頁面都沒寫。

## 先講幾個詞

- **審查（App Review）**：Apple 的人把 app 裝起來看，照審查準則決定能不能上架。
- **審查準則（App Review Guidelines）**：Apple 列的上架規定，有條號，例如 4.2、5.1.1(v)。
- **開發者計畫（Apple Developer Program）**：一年付一次錢的資格。有了才能上架、用 TestFlight。
- **App Store Connect**：Apple 給開發者管 app 的後台：上傳版本、填資料、送審。
- **公開上架**：在 App Store 上搜尋得到，誰都能裝。
- **不公開上架（Unlisted）**：app 在 App Store 上，但搜尋、分類、排行都找不到，只有拿到連結的人能裝。
- **TestFlight**：Apple 的測試版服務。測試者先裝 TestFlight 這個 app，再從裡面裝我們的測試版。
- **登記裝置直接裝（Ad Hoc）**：把每台 iPhone、iPad 的識別碼（UDID）登記到開發者帳號，app 只能裝在這些裝置上。
- **描述檔（provisioning profile）**：Apple 簽發的一個檔，寫明「這個 app 可以裝在哪些裝置上、能用哪些系統功能」。過期了 app 就打不開。
- **免費帳號（Xcode 裡叫 Personal Team）**：只用 Apple 帳號登入 Xcode，沒付年費。
- **賣家名稱（seller name）**：App Store 上 app 底下顯示的開發者名字。
- **測試帳號（demo account）**：交給審查的人登入用的帳號。
- **隱私標示（Privacy Nutrition Label）**：App Store 頁面上「這個 app 收哪些資料」的那一塊，由開發者自己填。

## 結論

1. **年費個人和公司一樣，一年 99 美元。** 差在賣家名稱：個人顯示本人的法定姓名，公司顯示公司的法定名稱。公司要是法人，還要 D-U-N-S 號碼、公司網域的信箱和網站 [加入] [加入說明]。已確認。
2. **不付年費，也能把 app 裝到自己的 iPhone、iPad 上試。** 用免費帳號從 Xcode 裝：最多 3 台裝置、每台 3 個 app，描述檔 7 天過期，過期要重新建置、重新裝。免費帳號不能用 TestFlight 和 App Store Connect [帳號總覽]。已確認。
3. **給別人裝的路有五條：公開上架、不公開上架、只給指定組織、TestFlight、登記裝置直接裝。** 前三條和 TestFlight 的外部測試都要過 Apple 審查 [審查頁] [不公開上架] [自訂 app] [TestFlight 總覽]。登記裝置直接裝不用審，但一年每種裝置最多 100 台 [裝置] [裝到開發裝置]。已確認。
4. **TestFlight：外部測試者每個 app 最多 10,000 人，內部測試者最多 100 人，每一版最多能用 90 天** [TestFlight 總覽]。授權合約寫明 TestFlight 不能拿來長期發 app、繞過 App Store [授權合約 7.4]。未滿 13 歲不能用 TestFlight [TestFlight 條款]。已確認。
5. **不公開上架要另外申請。** 先照一般程序送審，再填申請表；還在測試階段的 app 會被拒絕。拿到連結的人都能裝，Apple 建議自己在 app 裡擋沒被授權的人 [不公開上架]。已確認。多久核准、用什麼標準：查不到。
6. **要登入才能用的功能，一定要給審查的人測試帳號（或 Apple 事先同意的示範模式），審查期間後端要開著** [準則 2.1(a)] [審查說明：完整資料]。已確認。「不能自己註冊」本身，整份準則搜過「註冊、建立帳號、邀請」這些字，沒有一條禁止；最接近的是 3.2.2(v)「任意限制誰能用」（推論）。
7. **「要能刪除帳號」的條文，條件是「app 支援建立帳號」。** 原句：「If your app supports account creation, you must also offer account deletion within the app.」[準則 5.1.1(v)]。Apple 另外寫明只給停用不夠 [刪除帳號說明]。帳號是管理員加的、app 裡沒有註冊畫面時算不算「支援建立帳號」：查不到。兩種讀法見第 3 節。
8. **只是把網站包起來的 app，準則明講不收。** 原句：「Your app should include features, content, and UI that elevate it beyond a repackaged website.」[準則 4.2]。準則沒有禁止用網頁技術做畫面；到什麼程度才算「不只是包起來」沒有客觀標準，由審查的人判斷（推論）。
9. **隱私權政策的網址一定要有**，要填在 App Store Connect，app 裡也要找得到 [準則 5.1.1(i)] [管理隱私]。在 App Store 上架還要填隱私標示 [隱私細節]。已確認。
10. **年齡分級一定要填**，問卷答完由 Apple 算出 4+、9+、13+、16+、18+ 其中一級 [年齡分級] [設年齡分級]。「兒童類（Kids Category）」是自己選才進去，不選就不適用那一套規定 [準則 1.3]。但只要會收未成年人的個人資料，就一定要有隱私權政策，並遵守各地保護兒童隱私的法律 [準則 5.1.4]。已確認。
11. **只用系統內建的加密（例如用 URLSession 連 HTTPS），通常不用上傳出口文件**，但每次送版本都要回答加密的問題，或在 app 的設定檔裡寫一個鍵跳過 [出口文件] [加密文件]。已確認；「通常」是 Apple 的用詞。
12. **審查時間：Apple 寫「通常」至少一半在 24 小時內、九成在 48 小時內審完；沒有審查紀錄的新 app 可能更久** [審查頁] [審查說明：狀態]。每個新版本都要再審。緊急修正可以申請加急審查 [審查說明：加急]。已確認。
13. **台灣：Apple 的頁面上只找到報稅那一項，而且只有賣東西（簽付費 App 合約）才要填** [報稅] [合約]。免費 app 不用簽那份合約。個人開發者的法定姓名會顯示在 App Store 上 [加入說明]。地址、電話、email 要公開顯示的規定是歐盟的，只在歐盟上架時才適用 [DSA]。已確認。台灣其他的規定：查不到。

## 1. 開發者帳號

### 三種身分

| | 免費帳號（只註冊） | 開發者計畫：個人 | 開發者計畫：公司或組織 |
|---|---|---|---|
| 年費 | 0 | 99 美元 | 99 美元（非營利、學校、政府可申請免年費） |
| 資格 | 有 Apple 帳號，同意開發者協議 | 到所在地的法定成年年齡；Apple 帳號開兩步驟驗證；用法定姓名 | 要是法人；要 D-U-N-S 號碼；申請的人要有權代表組織簽約；信箱和網站要用組織的網域 |
| 賣家名稱 | 不能上架 | 本人的法定姓名 | 組織的法定名稱 |
| 能加多少人 | — | 最多再加 50 個 App Store Connect 使用者，他們不算開發團隊的人 | 團隊人數不限 |
| 能做的事 | 用 Xcode 裝到自己的裝置上試 | 上架、TestFlight、登記裝置直接裝、App Store Connect | 同左 |

來源和原句：

- 年費：「The Apple Developer Program annual fee is 99 USD and the Apple Developer Enterprise Program annual fee is 299 USD, in local currency where available. Prices may vary by region and are listed in local currency during the enrollment process.」[加入說明]。已確認。
- 個人的賣家名稱：「If you’re an individual or sole proprietor/single-person business, your personal legal name will be listed as the seller on the App Store.」[加入說明]。已確認。
- 公司的賣家名稱：「The legal entity name will appear as the seller for apps you distribute.」；不接受商號、分公司：「We don’t accept DBAs, fictitious businesses, trade names, or branches.」[加入說明]。已確認。
- 想用組織的名字，就一定要用組織身分加入：「To have your organization’s name appear as the seller, your organization must be recognized as a legal entity and you must be enrolled as an organization.」個人之後要改成組織，要聯絡 Apple [加入說明]。已確認。
- 成年：「To enroll, you’ll need an Apple Account with two-factor authentication turned on and be the legal age of majority in your region.」[加入說明]。授權合約 3.1 也寫要到法定成年年齡 [授權合約 3.1]。已確認。
- 個人加人：「Individuals enrolled in the Apple Developer Program can give up to 50 additional users access to their content in App Store Connect. These users receive access to App Store Connect but aren’t part of the Apple Developer Program team.」；組織：「Organizations enrolled in the Apple Developer Program can add an unlimited number of members to their team.」[帳號和角色]。已確認。
- 免年費的條件：要是非營利組織、立案的教育機構或政府機關的法人，不能是個人，沒簽付費 App 合約，也不透過 app 賣數位商品 [免年費]。已確認。
- 用 Apple Developer 這個 app 加入時，要拍有照片的身分證件；Apple 說大多數地區收護照 [用 app 加入]。已確認。

### 新台幣多少

- 台灣 App Store 上 Apple Developer 這個 app 的頁面，App 內購買列著「Apple Developer Program $3,390.00」[台灣商店：Apple Developer]。已確認（查核當天）。台灣商店的幣別是新台幣，所以是 3,390 元（推論）。這是「在 app 裡訂閱」的價錢，每年自動續訂 [用 app 加入]。
- 從網頁加入的新台幣價錢：查不到。Apple 只寫加入過程中會用當地幣別顯示 [加入說明]，要登入才看得到。
- 稅：「When applicable, your membership purchase will be taxed using the tax rate for your region or state.」[加入說明]。台灣實際加多少：查不到。

### 申請要多久

查不到一個總天數。Apple 寫的只有這幾段：

- 個人：資料驗證完，當場就能看合約、付年費 [加入說明]。
- 付完錢：「If you haven’t received a membership confirmation within 24 hours of your purchase, contact us.」[加入說明]。這是「超過 24 小時沒收到確認信就聯絡我們」，不是保證 24 小時內好。
- 組織：要等 Apple 的人驗證完資料、寄信通知，才能付年費 [加入說明]。沒寫幾天。
- 組織還沒有 D-U-N-S 號碼時：申請後最多 5 個工作天拿到號碼，拿到後再等最多 2 個工作天 Apple 才收得到資料 [D-U-N-S]。
- 名字填的不是法定姓名，或個人用別人的信用卡付款，都會拖慢 [加入說明]。

### 年費沒續

「If your Apple Developer Program membership expires, your apps will no longer be available for download and you won’t be able to submit new apps or updates or access Certificates, Identifiers & Profiles. However, your apps will still function for users who have already installed or downloaded them」[續約]。已確認。

過期後再續：免費 app 會在 24 小時內恢復下載，不用重新送審 [續約]。已確認。

年費沒續時，TestFlight 上的測試版還能不能用：查不到。

## 2. 發 app 的方法

### 對照表

| 發法 | 誰裝得到 | 人數或裝置上限 | 一版能用多久 | 要不要審查 | 要年費嗎 |
|---|---|---|---|---|---|
| 公開上架 | 上架地區的任何人，搜尋得到 | 沒有 | 開發者計畫沒過期就一直能下載 | 要，每一版都要 | 要 |
| 不公開上架 | 拿到連結的任何人；搜尋不到 | 沒有 | 同上 | 要：一般審查，再加一份「不公開」申請 | 要 |
| 只給指定組織（Private，也叫 Custom App） | 開發者指定的組織，在 Apple Business 或 Apple School Manager 裡才看得到 | 沒寫 | 沒寫 | 要 | 要 |
| TestFlight 外部測試 | 用 email 邀的人，或拿到公開連結的人 | 每個 app 10,000 人；每人最多 30 台裝置 | 90 天 | 要：第一版送 TestFlight 審查；之後的版本「might not」要完整審查 | 要 |
| TestFlight 內部測試 | 自己的 App Store Connect 使用者 | 100 人 | 90 天 | Apple 只寫外部要審（推論：內部不用） | 要 |
| 登記裝置直接裝（Ad Hoc） | 登記了識別碼的裝置 | 每個年度 iPhone 100 台、iPad 100 台 | 查不到 | 不用 | 要 |
| 從 Xcode 裝（免費帳號） | 自己的裝置，要接上有 Xcode 的 Mac | 3 台裝置，每台 3 個 app | 7 天 | 不用 | 不用 |
| 企業計畫（Enterprise Program） | 組織內部的員工 | — | — | — | 299 美元；組織要有 100 名以上員工 |

另外還有「別的 app 商店、從網站直接發」這種路。Apple 的頁面寫的是只有某些地區才有：「Learn about the options available in Brazil, Japan and the European Union.」[App Store 頁]。沒列台灣。已確認。

授權合約把路寫死了：iPhone、iPad app 只能經 App Store、只給指定組織、登記裝置、TestFlight 這幾種方式發，沒有另外簽約就不能用別的方式發給別人 [授權合約 7.6]。已確認。

### 公開上架

- 每個 app、每次更新都要審：「We review all apps, app updates, app bundles, in-app purchases, and in-app events submitted to App Store Connect」[審查頁]。已確認。
- 可以選上架的地區。App Store 有 175 個國家或地區，可以全選，也可以只選幾個 [上架地區]。已確認。只選台灣是可以的（推論：頁面說能選「Specific Countries or Regions」）。
- 免費 app 只要有開發者計畫就能上架；要賣 app 或做 app 內購買，才要另外簽付費 App 合約 [合約]。已確認。
- 準則前言有一句跟我們有關：「If you build an app that you just want to show to family and friends, the App Store isn’t the best way to do that. Consider using Xcode to install your app on a device for free or use Ad Hoc distribution available to Apple Developer Program members.」[準則 前言]。已確認。

### 不公開上架

全部出自 [不公開上架]，除非另外標。已確認。

- 是什麼：「Unlisted apps don’t appear in any App Store categories, recommendations, charts, search results, or other listings.」
- Apple 舉的適用例子：「Apps for partner sales tools, employee resources, or research studies are examples of good candidates for unlisted distribution.」對象的例子：「Limited audiences (such as part-time employees, franchisees, partners, business affiliates, higher-education students, or conference attendees)」。
- 怎麼申請：「Before you request unlisted app distribution, your app must either already be on the App Store or be ready for final distribution and submitted to App Review. Add a note in the Review Notes section of your submission to indicate that your app is intended for unlisted distribution. Then, submit a request for unlisted app distribution.」
- 什麼會被拒：「Requests will be declined for unlisted distribution if your app hasn’t been submitted to App Review, or if your app is in a beta or prerelease state.」
- 核准後：發法變成 Unlisted，之後的版本也都是。已經在 App Store 上的 app，連結不變。
- 連結不是鎖：「Unlisted apps are available to anyone who has access to the link. Consider implementing a mechanism within your app to prevent unauthorized use.」
- 能從公開改成不公開。改不回「只給指定組織」，那要開新的 app 紀錄重送 [發法設定]。
- 申請多久核准、Apple 用什麼標準決定准不准：查不到。
- 推論：不公開上架的 app 走的是同一套審查，第 3 節的每一條都一樣適用。

### 只給指定組織

- 「Private Distribution: Your app will be available only on Apple Business or Apple School Manager to specific businesses and organizations that you specify in App Store Connect.」[發法設定]。已確認。
- 對方組織要有 Apple Business 或 Apple School Manager 的帳號，再用裝置管理（MDM）或兌換碼發給人 [自訂 app]。已確認。
- 一樣要審：「If your app contains sensitive data, provide sample data and authentication for the App Store Review team.」[自訂 app]。已確認。
- 核准之後不能改成公開或不公開，要開新的 app 紀錄 [發法設定]。已確認。
- Apple Business 的功能表上，台灣那一列有「Get Apps」[Apple Business 功能]。已確認（只讀了台灣那一列，頁面日期 2026-04-14）。台灣的組織能不能收 Custom App，表上沒有單獨一欄：查不到。

### TestFlight

數字，已確認：

| 項目 | 數字 | 來源 |
|---|---|---|
| 外部測試者 | 每個 app 最多 10,000 人 | [外部測試者] |
| 內部測試者 | 最多 100 人，要是有權限的 App Store Connect 使用者 | [內部測試者] |
| 一版能用多久 | 上傳那天起最多 90 天 | [TestFlight 總覽] [TestFlight 測試者頁] |
| 同時能分享的版本 | 最多 100 個 | [TestFlight] |
| 每個測試者能裝的裝置 | 最多 30 台 | [TestFlight] |
| 送 TestFlight 審查 | 24 小時內最多 6 個版本 | [外部測試者] |
| 測試者的系統 | iOS 16／iPadOS 16 以上 | [TestFlight 測試者頁] |

- 90 天：「You can test a build for up to 90 days.」「Your build becomes unavailable for testers after 90 days.」[TestFlight 總覽]。到期後測試者打不開那一版，要有新的版本才能繼續用 [TestFlight 測試者頁]。已確認。
- 外部要審：「When you add the first build of your app to a group, the build gets sent to App Review to make sure it follows the App Review Guidelines. A review is required only for the first build. Subsequent builds may not require a full review.」[TestFlight 總覽]。已確認。
- 審查準則也管 TestFlight：「Any app submitted for beta distribution via TestFlight should be intended for public distribution and should comply with the App Review Guidelines.」[準則 2.2]。已確認。
- 外部測試者怎麼邀：用 email，或用公開連結。公開連結誰拿到都能加入，可以設人數上限（1 到 10,000）、可以關掉 [外部測試者]。已確認。
- 內部測試者要是 App Store Connect 的使用者，角色是 Account Holder、Admin、App Manager、Developer 或 Marketing [內部測試者]。已確認。個人身分最多只能再加 50 個使用者（第 1 節），所以個人身分的內部測試者到不了 100 人（推論）。這些人同時拿到 App Store Connect 的權限。
- 內部要不要審：授權合約只對「組織以外的測試者」要求先送審：「If You would like to distribute Your Application to Beta Testers outside of Your company or organization through TestFlight, You must first submit Your Application to Apple for review.」[授權合約 6.5]。沒有一句直接寫「內部不用審」，所以標推論。
- **TestFlight 不能當成長期的發法**：「You may not use TestFlight for purposes that are not related to improving the quality, performance, or usability of pre-release versions of Your Application (e.g., continuous distribution of demo versions of Your Application in an attempt to circumvent the App Store or providing trial versions of Your Applications for purposes of soliciting favorable App Store ratings are prohibited uses).」[授權合約 7.4]。已確認。
- 準則也寫：「Demos, betas, and trial versions of your app don’t belong on the App Store – use TestFlight instead.」[準則 2.2]。
- 不能跟測試者收錢 [授權合約 7.4] [準則 2.2]。已確認。
- 年齡：「Children under the age of 13, or equivalent minimum age in the relevant jurisdiction, are not permitted to use TestFlight.」[TestFlight 條款]。也就是未滿 13 歲不行。滿 13、未滿 18 歲的人，Apple 寫「應該」跟家長一起看過條款。已確認。
- 授權合約另有一句：「if Your Application is primarily intended for children, You must verify that Your Beta Testers are of the age of majority in their jurisdiction.」[授權合約 7.4]。已確認。我們的 app 不是主要給兒童用的（推論），這句不適用；但寫在這裡，免得之後改定位時漏掉。
- 外部測試前要填測試資訊：測試版的說明、收意見的 email；還要回答加密出口的問題 [測試資訊] [出口：測試版]。已確認。

### 登記裝置直接裝（Ad Hoc）

- 「Members of the Apple Developer Program and Apple Developer Enterprise Program can register up to 100 of the following devices, per product family, per membership year」，iPhone 和 iPad 各算一種 [裝置]。已確認。
- 中途停用一台裝置，名額不會多出來：「You may disable a device on your list during the year, but doing so won’t increase your number of available devices.」新的年度開始時才能清掉重算 [裝置]。已確認。
- 不用審：「you can distribute builds to a limited set of testers on known devices without having to go through beta app review.」[裝到開發裝置]。已確認。
- 能給誰：公司、組織、學校、團體裡的人，或跟開發者有關係的人 [授權合約 7.3]。已確認。
- 怎麼裝：先收集每台裝置的識別碼登記上去，匯出 `.ipa` 檔，對方再用 Mac 上的工具（Xcode 的 Device Hub 或 Apple Configurator）裝進去 [裝到開發裝置]。已確認。裝置要不要開「開發者模式」：Apple 寫用 Apple Configurator 裝 `.ipa` 屬於要開的情形 [開發者模式]。已確認。
- Ad Hoc 的描述檔多久過期：查不到。

### 企業計畫

只給大組織發內部用的 app。條件包括「Have 100 or more employees.」，一年 299 美元，還要通過 Apple 的面談 [企業計畫]。已確認。跟我們無關，列出來只是為了排除。

## 3. 審查會看的幾件事

公開上架、不公開上架、只給指定組織，走的都是同一個 App Review，這一節每一條都適用；TestFlight 外部測試照準則 2.2 也要符合。

### 要登入、又不能自己註冊

已確認的原句：

- [準則 送審前]：「Provide App Review with full access to your app. If your app includes account-based features, provide either an active demo account or fully-featured demo mode, plus any other hardware or resources that might be needed to review your app (such as login credentials or a sample QR code).」
- [準則 送審前]：「Enable backend services so that they’re live and accessible during review.」
- [準則 2.1(a)]：「include demo account info (and turn on your back-end service!) if your app includes a login. If you are unable to provide a demo account due to legal or security obligations, you may include a built-in demo mode in lieu of a demo account with prior approval by Apple.」
- [審查說明：完整資料]：「Enter a username and password that work at the time of submission. Credentials that expire or change before your review starts may result in the submission being rejected.」
- [審查說明：完整資料]：「If your app has multiple account types, such as administrative and general user accounts, use the Notes field to add additional credentials for each type.」
- [版本資料]：「The demo account is used during the App Review process and must not expire.」
- 需要驗證碼才能登入時，要事先寫在備註裡，不然要約電話：「Calls are typically completed within three to five business days.」[審查說明：完整資料]
- 送審時還要寫清楚 app 是做什麼的、給誰用、用到哪些外部服務 [審查說明：完整資料]。

套到我們（推論）：

- 管理員要先加一個給審查用的使用者，設好密碼，把 email 和密碼填進 App Store Connect。這個帳號在審查期間不能停用。#183 定的「30 天一定要重登」不影響：審查的人是每次自己輸入密碼。
- 管理員的畫面如果也做進 app，照上面那句要多給一組管理員的帳號。
- 示範模式：「送審前」那份清單把它跟測試帳號並列；但 2.1(a) 的條文寫要 Apple「事先同意」，而且條件是法律或資安上給不出帳號。我們給得出帳號。
- 「不能自己註冊」沒有條文直接禁止。相關的只有兩處。一是 [準則 3.2.2(v)] 列為不接受的做法：「Arbitrarily restricting who may use the app, such as by location or carrier.」我們限制的只有雲端功能，本機流程誰都能用；審查的人會不會引這一條：查不到。二是 Apple 自己說，給特定少數人用的 app 適合不公開上架（第 2 節）。

### 不登入也能用本機流程，算不算數

已確認的原句：

- [準則 5.1.1(v)]：「If your app doesn’t include significant account-based features, let people use it without a login.」
- [HIG 帳號]：「Ask people to create an account only if your core functionality requires it; otherwise, let people enjoy your app or game without one.」
- [HIG 帳號]：「Delay sign-in for as long as possible.」

套到我們（推論）：

- 算數的地方：這幾句要的是「不登入也能用」。本機流程不登入就能編、能播、能練，方向一致。
- 不算數的地方：雲端流程是要登入的功能，審查的人還是要看。有不用登入的部分，不能免掉測試帳號。
- 截圖不能只放登入畫面：「Screenshots should show the app in use, and not merely the title art, login page, or splash screen.」[準則 2.3.3]。截圖裡的帳號資料要用假的：「you should display fictional account information instead of data from a real person.」[準則 2.3.9]。已確認。

### 要能刪除帳號

已確認的原句：

- [準則 5.1.1(v)]：「If your app supports account creation, you must also offer account deletion within the app.」
- [刪除帳號說明]：「Apps submitted to the App Store that support account creation must also let people initiate deletion of their account within the app.」
- [刪除帳號說明]：「Offer to delete the entire account record, along with associated personal data. You may include additional options, but only offering to temporarily deactivate or disable an account is insufficient.」
- [刪除帳號說明]：一般的 app「should not require people to make a phone call, send an email, use a chat support flow, or go through other support flows.」
- [刪除帳號說明]：刪除可以是人工處理、不用馬上完成：「If your process for account deletion is manual or otherwise takes a reasonable amount of time to complete, this is acceptable.」
- [刪除帳號說明]：使用者做的、分享給別人的內容也要刪：「People expect that all data associated with their account will be deleted when the account is deleted. This includes user-generated content that's shared with others」
- [HIG 帳號]：「If you help people create an account within your app or game, you must also help them delete it, not just deactivate it.」
- Apple 把「建立帳號」讀得很寬。問答裡，連到瀏覽器去註冊的、app 自動幫人建帳號的，答案都是「Yes」，都要能刪 [刪除帳號說明]。

管不管得到我們：**查不到**。讀過的 Apple 頁面都沒有寫「帳號由管理員建立、使用者不能自己註冊」這種情形。兩種讀法都是推論：

- 讀法一：條文的條件是「app supports account creation」。app 裡沒有註冊畫面，也沒有加人的畫面（加人、設密碼都在網頁上做）時，這個 app 不支援建立帳號，條文字面上管不到。
- 讀法二：管理員「新增使用者」的畫面如果做在 app 裡，app 就支援建立帳號了。加上 Apple 把連到瀏覽器、自動建立都算進去，審查的人有可能認定管得到。

如果管得到，現在 #183 的規則過不了這一條，原因有兩個：只有停用、沒有刪除；而且條文要的是使用者「自己」能在 app 裡發起，不是管理員代做。

這一條寫在審查準則裡，準則 2.2 說 TestFlight 的 app 也應該符合。登記裝置直接裝和免費帳號不經審查；不過授權合約 7.3 要開發者自己保證，登記裝置直接裝的 app 符合 Apple 的「Documentation and Program Requirements」[授權合約 7.3]。那個範圍包不包括這一條：查不到。

### 只是把網站包起來

已確認的原句：

- [準則 4.2]：「Your app should include features, content, and UI that elevate it beyond a repackaged website. If your app is not particularly useful, unique, or “app-like,” it doesn’t belong on the App Store.」
- [準則 4.2.2]：「Other than catalogs, apps shouldn’t primarily be marketing materials, advertisements, web clippings, content aggregators, or a collection of links.」
- [審查頁] 列的常見退件原因：「Websites served in an iOS app, web content that is not formatted for iOS, and limited web interactions do not make a quality app.」
- [準則 2.5.2]：「Apps should be self-contained in their bundles, and may not read or write data outside the designated container area, nor may they download, install, or execute code which introduces or changes features or functionality of the app, including other apps.」
- [授權合約 3.3.1(B)]：「Interpreted code may be downloaded to an Application but only so long as such code: (a) does not change the primary purpose of the Application by providing features or functionality that are inconsistent with the intended and advertised purpose of the Application (b) does not bypass signing, sandbox, or other security features of the OS; and (c) for Applications distributed on the App Store, does not create a store or storefront for other Applications.」
- [準則 2.5.6]：「Apps that browse the web must use the appropriate WebKit framework and WebKit JavaScript.」

套到我們（推論）：

- 準則沒有一句說「不准用網頁技術做畫面」。它擋的是「repackaged website」，也就是除了把網站裝進殼裡，沒有多出什麼。
- 走地圖上的 (B)（把現在的網頁包進 app）會不會被退，條文沒有客觀門檻，要看審查的人怎麼判斷。4.2 的原句給了三個方向：功能、內容、畫面要「超過」網站。
- 網頁的程式放在哪裡有差。包在 app 裡一起送審的，審查看到的就是全部。app 打開後才從伺服器抓網頁程式來跑的，會碰到 2.5.2 和授權合約 3.3.1(B)：抓下來的程式不能改變 app 的主要用途。
- 包網頁還會連到另外兩處。隱私標示：「Data collected via web traffic must be declared, unless you are enabling the user to navigate the open web.」[隱私細節]。年齡分級：app 裡能隨意開任何網頁，算「Unrestricted Web Access」，分級會到 16+ [年齡分級]；只顯示自己的畫面、不能亂逛，不算（推論）。

### 其他順帶查到的

- **第三方登入**：用 Facebook、Google 這類登入時，才要另外提供一種同等的登入方式。只用自己的帳號系統不用：「Your app exclusively uses your company’s own account setup and sign-in systems.」[準則 4.8]。已確認。我們只用 email 加密碼，這一條管不到（推論）。
- **使用者做的內容**：[準則 1.2] 要求讓使用者發布內容的 app 要有過濾、檢舉、封鎖、公開的聯絡方式。它舉的例子是社群、內容平台、AI 產生內容的 app。我們的雲端流程只分享給擁有者指定的使用者，分享連結則是不登入就能看。審查的人會不會把這個當成 1.2 管的內容：查不到。
- **聯絡方式**：「Make sure your app and its Support URL include an easy way to contact you」[準則 1.5]。支援網址是必填的，要連到真的聯絡資料 [版本資料]。已確認。
- **新功能要寫清楚**：每次送審，新功能和改動要在備註裡具體寫，籠統的說明會被退 [準則 2.3.1(a)]。已確認。
- **不再維護會被下架**：「If your app no longer functions as intended or you’re no longer actively supporting it, it will be removed from the App Store.」[準則 送審前]。已確認。
- Apple 說，沒過審的問題平均四成以上跟 2.1（app 不完整：當掉、假內容、資料沒填齊）有關 [審查頁]。已確認。

## 4. 隱私

### 隱私權政策的網址

- [準則 5.1.1(i)]：「All apps must include a link to their privacy policy in the App Store Connect metadata field and within the app in an easily accessible manner.」已確認。
- 政策裡一定要寫的三件事 [準則 5.1.1(i)]：收哪些資料、怎麼收、拿來做什麼；拿到資料的第三方會給同等的保護；資料留多久、怎麼刪，使用者怎麼撤回同意或要求刪除。已確認。
- App Store Connect 的欄位：「Privacy Policy URL … This is required for all apps.」另一個「User Privacy Choices URL」是選填 [隱私欄位]。已確認。
- 網址要公開連得到：「The URL to your publicly accessible privacy policy.」[隱私細節]。已確認。

### 隱私標示要填什麼

- 在 App Store 上架就要填：「This information is required to submit new apps and app updates to the App Store.」[隱私細節]。已確認。
- 什麼叫「收」：「“Collect” refers to transmitting data off the device in a way that allows you and/or your third-party partners to access it for a period longer than what is necessary to service the transmitted request in real time.」[隱私細節]。已確認。
- 只留在裝置上的不算：「Data that is processed only on device is not “collected” and does not need to be disclosed in your answers.」[隱私細節]。已確認。
- 只為了讓功能能用而收的，也要填：「if you collect data solely for the purpose of app functionality, declare the data on your label and indicate that it is only being used for that purpose.」[隱私細節]。已確認。
- 每一種資料要答三件事：拿來做什麼（六種用途，其中一種是「App Functionality」）、有沒有連到使用者的身分、有沒有用來追蹤 [隱私細節]。已確認。
- 用到的第三方程式收的資料也要算進去 [隱私細節]。已確認。
- 答案隨時能改，改答案不用送新版本 [隱私細節]。已確認。
- 只用 TestFlight 發、不上 App Store 時要不要填：查不到。Apple 的句子是「if you're distributing your app on the App Store, you're required to explain your data handling practices」[管理隱私]。

套到我們（推論）。下面是照 Apple 的資料種類表對出來的，真正要填哪些，要等 app 做出來、看它實際送什麼到伺服器：

| Apple 的資料種類 | 我們的哪個東西 | 會不會算「收」 |
|---|---|---|
| Email Address | 使用者登入用的 email | 會，存在伺服器上 |
| Name | 管理員加人時填的名字 | 會 |
| User ID | 帳號的識別碼 | 會 |
| Other User Content | 雲端流程的內容、成功率的紀錄 | 會 |
| Audio Data | Apple 的定義是「The user’s voice or sound recordings」。雲端流程裡的音樂檔算不算：查不到 | 不確定 |
| 其他 | 本機流程、草稿、沒登入時做的事 | 不會，只在裝置上 |

- 這些都連到使用者的身分。用途是「App Functionality」。沒有廣告、沒有追蹤。
- 伺服器紀錄裡的 IP 位址：Apple 說要看怎麼用來決定算哪一種 [隱私細節]。留不留、留多久是後端的事，這裡沒查。
- 流程裡隊員的名字是使用者自己打的字。Apple 說自由輸入的欄位填「Other User Content」就好，不用列出使用者可能打進去的每一種資料；但如果是 app 指定要使用者填某一種資料（例如他的名字、email），就要照那一種填 [隱私細節]。已確認。隊員名字是「別人的名字」，算哪一邊：查不到。

## 5. 未成年的使用者、年齡分級

### 年齡分級

- 一定要填。在 App Store Connect 答一份問卷，Apple 算出分級。現在有五級：4+、9+、13+、16+、18+ [年齡分級] [兒少頁]。已確認。
- 要誠實答：「Answer the age rating questions in App Store Connect honestly so that your app aligns properly with parental controls.」[準則 2.3.6]。已確認。
- 問卷問的是 app 裡有沒有這些東西、多常出現：暴力、性、粗話、賭博、醫療資訊等等；還有幾種「功能」：使用者做的內容、訊息和聊天、社群媒體、廣告、能隨意上網 [年齡分級]。已確認。
- 4+ 這一級可以有「User-generated content」和「Messaging and chat」；「Social media」是 13+；「Unrestricted web access」是 16+ [年齡分級]。已確認。
- 「使用者做的內容」的定義是「Includes the broad distribution of content created by users as a component of the app's intended user experience.」[年齡分級]。雲端流程只分享給指定的使用者，算不算「broad distribution」：查不到。不管算不算，都還在 4+ 裡（推論）。
- 可以自己把分級調高；頁面上只有「調高」這個選項，沒有調低 [設年齡分級]。已確認。
- 我們的 app 會落在哪一級：要實際答問卷才知道。照上面的表，沒有暴力、賭博那些內容的話是 4+（推論）。

### 兒童類（Kids Category）

- 是自己選的：算出來是 4+ 或 9+，又選了「Made for Kids」，才會進兒童類。選了、過審之後就不能改 [設年齡分級]。已確認。
- 進了兒童類才有那一套比較嚴的規定：不能有往外的連結和購買（除非放在家長關卡後面）、不能把個人資料傳給第三方、不該有第三方分析和廣告 [準則 1.3]。已確認。
- 沒進兒童類的 app，名稱、說明、截圖不能暗示主要是給兒童用的：「Apps not in the Kids Category cannot include any terms in app name, subtitle, icon, screenshots or description that imply the main audience for the app is children.」[準則 5.1.4]。已確認。

### 使用者可能未成年

- [準則 5.1.4]：「apps in the Kids Category or those that collect, transmit, or have the capability to share personal information (such as name, address, email, location, photos, videos, drawings, the ability to chat, other personal data, or persistent identifiers used in combination with any of the above) from a minor must include a privacy policy and must comply with all applicable children’s privacy statutes.」已確認。
- 同一條還寫：要小心處理兒童的個人資料，並點名美國的 COPPA、歐盟的 GDPR「and any other applicable regulations or laws」[準則 5.1.4]。已確認。
- 準則前言：「Make sure kids are getting age-appropriate experiences inside your app.」[準則 前言]。已確認。
- 套到我們（推論）：使用者可以是隊員本人，隊員可能未成年。我們收 email 和名字，所以 5.1.4 這一句管得到：要有隱私權政策，要守「適用的」兒童隱私法律。哪些法律適用，看 app 在哪些地區上架、使用者在哪裡。台灣的法律怎麼規定：這張票沒查，Apple 的頁面也不會寫。
- **有些地區有年齡確認的法律**。Apple 在 2026-02-24 的公告點名巴西、澳洲、新加坡、美國猶他州和路易斯安那州 [年齡確認公告]。在那些地區，開發者要用 Apple 的 Declared Age Range API 查使用者的年齡層 [年齡確認問答]。這一則公告沒有列台灣。已確認（公告只讀了前半）。但這只是其中一則：它用的字是「including」，還提到「previously announced」的工具；Apple 的問答只寫「certain regions」，沒有列名。完整的地區清單：查不到。Apple 的問答說審查流程沒有因此改變：「No, there are no changes to the App Review process.」[年齡確認問答]。
- 未滿 13 歲不能用 TestFlight（第 2 節）。
- App Store 上的 app：家長可以用「螢幕使用時間」照分級限制；app 的分級比限制高時，孩子可以請家長放行。Apple 的問答舉的例子是 13+ 的 app，未滿 13 歲的孩子經家長同意還是能下載 [年齡確認問答]。已確認。
- 開發者帳號的持有人要成年（第 1 節）。

## 6. 加密出口申報

app 只用 HTTPS 要不要報：**要回答問題，通常不用交文件。**

已確認的原句：

- 誰要管：「If your app uses, accesses, contains, implements, or incorporates encryption, and you intend to upload, test, and distribute it, you need to determine your export compliance requirements in App Store Connect.」[出口總覽]
- 台灣的開發者也一樣：「If you distribute your app outside the U.S. or Canada, your app is subject to U.S. export laws, regardless of where your legal entity is based.」[加密文件]。原因是 app 上傳到美國的伺服器。
- 三種情形 [出口文件]：

| app 用的加密 | 要交什麼 |
|---|---|
| 「Your app uses encryption limited to that within the Apple operating system」 | 「No documentation required in App Store Connect.」 |
| 「Your app uses an industry standard algorithm, not provided within the Apple operating system」 | 法國的加密申報表，只有在法國上架才要 |
| 自己發明的、沒被國際標準組織接受的加密 | 美國的 CCATS 分類文件，加上法國的申報表 |

- HTTPS 的例子是 Apple 自己舉的：「Typically, the use of encryption that’s built into the operating system—for example, when your app makes HTTPS connections using URLSession—is exempt from export documentation upload requirements, whereas the use of proprietary encryption is not.」[加密文件]
- 怎麼跳過每次的問題：在 app 的 `Info.plist` 加 `ITSAppUsesNonExemptEncryption`，值設成 `NO`。條件是 app（連同用到的第三方程式）不用加密，或只用免交文件的加密 [加密文件] [ITS 鍵]。沒加這個鍵，每上傳一個新版本都要答一次問卷 [ITS 鍵]。
- TestFlight 的版本也要答，不答會被標成「Missing Compliance」[出口：測試版]。
- 還有一件不在 Apple 這邊的事：「If your app uses exempt forms of encryption, you might alternatively be required to submit a year-end self-classification report to the U.S. government.」[加密文件]。Apple 用的是「might」。
- 判斷錯了的責任在開發者，Apple 寫明要自己看美國的出口管理規則 [出口總覽]。
- 真的要交文件時，Apple 預計大約 2 個工作天審完 [出口判斷]。

套到我們（推論）：

- app 只透過系統連 HTTPS（原生的 URLSession，或系統的網頁元件）時，是表上第一種：答完問題、不用交文件，鍵可以設 `NO`。密碼的雜湊在伺服器上做，不在 app 裡。
- 如果 app 裡自己帶了加密的程式庫（不是系統給的），就變成第二種。這要等技術選定才知道。
- 年底那份給美國政府的自我分類報告要不要交：查不到。Apple 只說「might」，判斷標準在美國商務部那邊，這裡沒查。

## 7. 還沒付年費：免費帳號能做什麼

能。原句：「No. You can install apps on your personal device with Xcode.」（問題是「要加入開發者計畫才能把 app 裝到裝置上嗎？」）[加入說明]。開發者計畫的首頁也把「Test your apps directly on your own devices using Xcode」列在免費帳號能做的事裡 [開發者計畫]。已確認。

限制，全部出自 [帳號總覽]，已確認：

- 「To install and test your apps on a personal device, you’ll need to sign in to your Apple Account in Xcode.」
- 「You can register up to 10 App IDs, which expire after 7 days.」
- 「You can register up to 3 devices, which expire after 7 days.」
- 「You can install up to 3 apps per device. Provisioning profiles that enable apps to be installed on a device will expire 7 days from issuance. You’ll need to rebuild and reinstall your app to your device after expiration.」

免費帳號沒有的東西 [帳號總覽]，已確認：App Store Connect、TestFlight、Certificates, Identifiers & Profiles、Apple 的程式技術支援。登記裝置直接裝也沒有：那是加入開發者計畫的人才有的 [裝置] [準則 前言]。

系統功能也少。[功能表] 上，免費帳號（表上那一欄叫「Apple Developer」）打勾的只有這幾項：App groups、Background modes、Data protection、HealthKit、HomeKit、Inter-App Audio、Keychain sharing、Maps、Wireless Accessory Configuration。沒打勾、可能跟我們有關的：Associated domains、Push notifications、iCloud、Sign in with Apple、AutoFill credential provider。已確認。

要準備的東西：

- 完整的 Xcode。從 Mac App Store 下載，不用加入開發者計畫 [計畫總覽]。已確認。地圖上寫這台 Mac 現在只有 Command Line Tools。
- 裝置要開「開發者模式」：在「設定」的「隱私權與安全性」裡打開，會要求重新開機 [開發者模式]。已確認。那個開關要先把裝置跟 Mac 配對過才會出現 [開發者模式]。

套到原型票（推論）：

- 網站主人的一台 iPhone 加一台 iPad 是 2 台，在 3 台以內。兩個小樣是 2 個 app，在每台 3 個以內。
- 每 7 天要接回 Mac 重新建置、重新裝一次。
- 「Background modes」有打勾，背景播音樂這類試得了。「Associated domains」沒打勾：點網址直接開 app、app 跟網站共用存好的密碼這類功能，在免費帳號上試不了。

## 8. 審查要幾天、出新版、緊急修正

### 幾天

- 「App Review works around the clock, typically reviewing at least 50% of submissions in less than 24 hours and 90% in less than 48 hours.」[審查頁]。另兩頁把同一組數字寫成「with the goal of」[審查說明：加急] [審查說明：狀態]。已確認。這是目標，不是保證。
- 小改動比較快：「While updates with minor changes and bug fixes typically move through review quickly, other submissions may take longer to verify.」[審查說明：狀態]。已確認。
- 會比較久的三種情形，第一種就是新 app：「Limited review history: Apps with little or no prior App Review history.」另外兩種是要查證文件的、內容複雜或敏感的 [審查說明：狀態]。已確認。
- 同一條準則一直被退，或被發現想騙過審查，之後會審更久 [準則 送審後]。已確認。
- 過審後：「it can take up to 24-hours for your app to appear on all selected storefronts.」[準則 送審後]。已確認。
- 送審前想先問：可以約 30 分鐘的視訊，跟審查團隊談 [審查頁]。已確認。

### 出新版

- 每個新版本都要送審（第 2 節）。
- 做法：在同一個 app 紀錄底下開新版本、填版本號、上傳新的建置、送審 [新版本]。已確認。
- 不能退回舊版：「it's not possible to revert to a previous version on the App Store if you have an issue with your app. You must create and submit a new version.」[新版本]。已確認。
- 過審後什麼時候上架，有三種選法：自己按、過審就自動上、過審後不早於某個時間自動上 [發行選項]。已確認。
- 可以分 7 天慢慢放給開自動更新的人：1%、2%、5%、10%、20%、50%、100%。中途可以暫停，合計最多停 30 天。使用者自己去 App Store 按更新，隨時拿得到新版 [分階段]。已確認。
- 被退的原因如果改說明文字或改伺服器就能解決（例如測試帳號沒開），在 App Store Connect 回覆就好，不用重新送 [審查說明：狀態]。已確認。
- 上傳的版本要用夠新的工具做：2026-04-28 起要用 Xcode 26 以上、iOS 26 的 SDK [近期要求]；Apple 已經預告 2027 年 4 月起要用 iOS 27 的 SDK，而且 app 設定的最低系統版本要是 iOS 15 以上 [送審準備]。已確認。
- TestFlight 外部測試：同一個版本號第一個建置要完整審查，之後的「might not」[外部測試者]。改動大的要再審 [授權合約 6.5] [準則 2.2]。已確認。

### 緊急修正

- 加急審查：「if you're facing extenuating circumstances, such as fixing a critical bug or timing your release to coincide with an event, you can request an expedited review.」[審查說明：加急]。已確認。
- 要先送審，才能申請加急：「Only submissions that have already been sent to App Review can be expedited.」修重大錯誤的，要在備註寫怎麼在現在的版本上重現 [審查說明：加急] [審查頁]。已確認。
- 不保證准：「App Review will evaluate your request and expedite the app's review as allowed by availability and demand.」濫用的話以後可能不理 [審查說明：加急] [準則 送審後]。已確認。加急後要多久：查不到。
- 修錯誤的更新被退時的另一條路：已經上架過的 app，修錯誤的更新如果被挑出別的問題，只要不涉及法律或安全，可以回覆說「這版先過，下一版再改」，同一個問題不能延兩次 [審查說明：錯誤修正]。已確認。
- 推論：app 裡的畫面如果是網頁做的、程式包在 app 裡，改一個字也要出新版、再審一次。從伺服器載入的內容不用，但受第 3 節 2.5.2 和授權合約 3.3.1(B) 的限制。

## 9. 台灣的開發者

Apple 的頁面上，寫到台灣的只找到下面這些。

**稅**

- 報稅表單是簽了付費 App 合約之後才有的事：「In order to submit tax forms, you first need to sign the Paid Apps Agreement.」[報稅]。免費 app 不用簽：「By joining the Apple Developer Program, you can distribute free apps on the App Store under the Apple Developer Program License Agreement.」[合約]。已確認。所以免費 app 不用填稅表、不用填銀行資料（推論）。
- 要賣東西時，台灣那一節寫：對象是「Developers based in Taiwan or developers that have a Taiwan Tax Identification Number (TIN).」；「If you don’t file taxes in Taiwan, Taiwanese tax forms aren’t required. Apple collects and remits taxes to the appropriate tax authorities in Taiwan, consistent with Schedule 2 of the Paid Apps Agreement.」[報稅]。已確認。另外所有賣東西的開發者都要填一份美國的稅表 [報稅]。
- 年費本身的稅：見第 1 節，實際數字查不到。

**聯絡資料公開**

- 個人身分：本人的法定姓名會當成賣家名稱顯示在 App Store 上（第 1 節）。已確認。不公開上架的 app 也有 App Store 頁面，所以一樣會顯示（推論）。
- 支援網址必填：「This URL must lead to actual contact information (legal address, email address, telephone number), as may be required by local law」[版本資料]。已確認。台灣的法律要求哪些：查不到。
- 給審查團隊的聯絡人（姓名、email、電話）不會給使用者看：「It isn’t visible to customers」[版本資料]。已確認。
- 把地址、電話、email 顯示在 App Store 頁面上，是歐盟《數位服務法》對「商家（trader）」的要求，只在歐盟上架時顯示。但不管有沒有在歐盟上架，都要申報自己是不是商家：「Even if you don’t distribute apps in the EU, you’ll still need to declare a trader status.」不在歐盟上架的：「you're not acting as a trader on the App Store.」[DSA]。已確認。
- App Store Connect 說明的「合規資料」那一區有 8 頁，標題寫到的地區是歐盟、韓國、中國大陸，沒有一頁的標題寫台灣（查核當天的目錄；只讀了歐盟那一頁的內文）。已確認。

**其他**

- 上架地區可以只選台灣（第 2 節）。
- 別的 app 商店、從網站直接發：Apple 列的地區沒有台灣（第 2 節）。
- 年齡確認的法律：讀到的那一則 Apple 公告沒有列台灣；完整的地區清單查不到（第 5 節）。
- 台灣自己的法律（個人資料、兒童及少年、消費者保護）對 app 有什麼要求：不在這張票的範圍，Apple 的頁面也不寫。查不到。

## 查不到的事

1. 申請開發者帳號總共要幾天。
2. 從網頁加入開發者計畫的新台幣價錢，和年費的稅。
3. 不公開上架的申請多久核准、用什麼標準。
4. 帳號由管理員建立、不能自己註冊時，5.1.1(v)「要能刪除帳號」管不管得到。
5. 「不能自己註冊」會不會被引 3.2.2(v) 退件。
6. 把網站包起來要多到什麼程度才不算「repackaged website」。
7. TestFlight 內部測試有沒有一句明文說不用審（現在是推論）。
8. 只用 TestFlight 發時，要不要填隱私標示。
9. 登記裝置直接裝的描述檔多久過期。
10. 開發者計畫過期後，TestFlight 上的版本還能不能用。
11. 加急審查通常多快。
12. 雲端流程裡的音樂檔在隱私標示上算哪一種資料；雲端流程算不算準則 1.2 和年齡分級說的「使用者做的內容」。
13. 給美國政府的年度加密自我分類報告，我們要不要交。
14. 台灣的組織能不能透過 Apple Business 收「只給指定組織」的 app。
15. 台灣的法律對未成年使用者、對開發者公開聯絡資料的要求。
16. 有年齡確認法律的地區，完整的清單。

## 來源

查核日期都是 2026-11-20。沒另外註明的，是整頁讀完的。標「讀了一部分」的，是整頁抓下來、只讀了寫明的那幾段。開發者文件（`/documentation/`、`/design/`）的網頁要跑程式才顯示，讀的是同一頁背後的資料檔，內容相同。

**審查**

- [準則] App Review Guidelines（頁面寫 Last Updated: October 16, 2026）。「前言」指 Introduction，「送審前」指 Before You Submit，「送審後」指 After You Submit。讀了一部分：前言、送審前、1.2、1.3、1.5、2.1 到 2.5、3.1.3、3.2、4.1、4.2、4.7、4.8、5.1、5.6、送審後；其他只看了標題。<https://developer.apple.com/app-store/review/guidelines/>
- [審查頁] App Review。<https://developer.apple.com/distribute/app-review/>
- [審查說明：完整資料] Provide information for a complete review。<https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review>
- [審查說明：狀態] Track a submission’s review status。<https://developer.apple.com/help/app-review/after-submitting-for-review/review-status>
- [審查說明：加急] Request an expedited review。<https://developer.apple.com/help/app-review/after-submitting-for-review/request-expedited-review>
- [審查說明：錯誤修正] Accept Bug Fix Submission offers。<https://developer.apple.com/help/app-review/after-submitting-for-review/bug-fix-submissions>
- [刪除帳號說明] 5.1.1(v) - Offering account deletion in your app。<https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion>
- [HIG 帳號] Human Interface Guidelines：Managing accounts。<https://developer.apple.com/design/human-interface-guidelines/managing-accounts>

**開發者帳號**

- [開發者計畫] Apple Developer Program。<https://developer.apple.com/programs/>
- [加入] Become a member。<https://developer.apple.com/programs/enroll/>
- [加入說明] Program enrollment。<https://developer.apple.com/help/account/membership/program-enrollment/>
- [帳號總覽] Developer account overview。<https://developer.apple.com/help/account/basics/about-your-developer-account>
- [計畫總覽] Programs overview。<https://developer.apple.com/help/account/membership/programs-overview>
- [用 app 加入] Enrolling, verifying, and renewing with the Apple Developer app。<https://developer.apple.com/help/account/membership/enrolling-in-the-app>
- [D-U-N-S] D-U-N-S Number。<https://developer.apple.com/help/account/membership/D-U-N-S/>
- [免年費] Apple Developer Program fee waiver。<https://developer.apple.com/help/account/membership/fee-waivers/>
- [續約] Program Renewal。<https://developer.apple.com/help/account/membership/renewal/>
- [帳號和角色] Overview of accounts and roles。<https://developer.apple.com/help/app-store-connect/manage-your-team/overview-of-accounts-and-roles>
- [功能表] Supported capabilities (iOS)。<https://developer.apple.com/help/account/reference/supported-capabilities-ios>
- [企業計畫] Apple Developer Enterprise Program。<https://developer.apple.com/programs/enterprise/>
- [台灣商店：Apple Developer] 台灣 App Store 上 Apple Developer app 的頁面。讀了一部分：App 內購買的清單。<https://apps.apple.com/tw/app/apple-developer/id640199958>

**發法**

- [不公開上架] Unlisted app distribution。<https://developer.apple.com/support/unlisted-app-distribution/>
- [發法設定] Set distribution methods。<https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/set-distribution-methods>
- [自訂 app] Distributing Apps on Apple Business and Apple School Manager。<https://developer.apple.com/support/volume-purchase-and-custom-apps/>
- [Apple Business 功能] Apple Business feature availability（Published Date: April 14, 2026）。讀了一部分：台灣那一列。<https://support.apple.com/guide/business/feature-availability-axmef1c47twq/web>
- [TestFlight] Beta testing made simple with TestFlight。<https://developer.apple.com/testflight/>
- [TestFlight 總覽] TestFlight Overview。<https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/>
- [內部測試者] Add internal testers。<https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers>
- [外部測試者] Invite external testers。<https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers>
- [測試資訊] Provide test information。<https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information>
- [TestFlight 測試者頁] Testing Apps with TestFlight。讀了一部分：開頭到 iPhone、iPad 的安裝方式。<https://testflight.apple.com/>
- [TestFlight 條款] TestFlight Terms of Service。讀了一部分：開頭和年齡那一段。英文版和台灣的中文版都對過，年齡那一句一樣。<https://www.apple.com/legal/internet-services/itunes/testflight/tw/terms.html>
- [裝置] Devices overview。<https://developer.apple.com/help/account/devices/devices-overview>
- [裝到開發裝置] Distributing apps to your development devices。<https://developer.apple.com/documentation/xcode/distributing-apps-to-your-development-devices>
- [開發者模式] Enabling Developer Mode on a device。<https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device>
- [App Store 頁] App Store（發行總覽）。<https://developer.apple.com/distribute/>
- [上架地區] Manage availability for your app on the App Store。<https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-for-your-app-on-the-app-store>
- [授權合約] Apple Developer Program License Agreement。讀了一部分：開頭的 Purpose、3.1、3.3.1(B)、6.5、7.1 到 7.6。合約列表頁寫 Last update: October 29, 2026。<https://developer.apple.com/support/terms/apple-developer-program-license-agreement/>
- [合約] Sign and update agreements。<https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements>

**隱私、年齡**

- [隱私細節] App privacy details on the App Store。<https://developer.apple.com/app-store/app-privacy-details/>
- [管理隱私] Manage app privacy。<https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy>
- [隱私欄位] App privacy（欄位說明）。<https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy>
- [版本資料] Platform version information。讀了一部分：Support URL 和 App Review information。<https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information>
- [年齡分級] Age ratings values and definitions。讀了一部分：種類的定義和全球通用的分級表；各地區的表只看了開頭。<https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions>
- [設年齡分級] Set an app age rating。<https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating>
- [兒少頁] Design safe and age-appropriate experiences for your apps and games。<https://developer.apple.com/kids/>
- [年齡確認問答] Age assurance frameworks Q&A。讀了一部分：最後「回報問題」那一段沒讀完。<https://developer.apple.com/support/age-assurance/>
- [年齡確認公告] Age requirements for apps distributed in Brazil, Australia, Singapore, Utah, and Louisiana（February 24, 2026）。讀了一部分：前半。<https://developer.apple.com/news/?id=f5zj08ey>

**加密出口**

- [出口總覽] Overview of export compliance。<https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/>
- [出口文件] Export compliance documentation for encryption。<https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption>
- [出口判斷] Determine and upload app encryption documentation。<https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation>
- [出口：測試版] Provide export compliance information for beta builds。<https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds>
- [加密文件] Complying with Encryption Export Regulations。<https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations>
- [ITS 鍵] ITSAppUsesNonExemptEncryption。<https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption>

**出新版**

- [新版本] Create a new version。<https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version>
- [發行選項] Select an App Store version release option。<https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option>
- [分階段] Release a version update in phases。<https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases>
- [近期要求] Upcoming Requirements。讀了一部分：最上面兩則。<https://developer.apple.com/news/upcoming-requirements/>
- [送審準備] Submit your apps and games today。<https://developer.apple.com/app-store/submitting/>

**台灣、稅**

- [報稅] Provide tax information。讀了一部分：開頭和 Taiwan 一節。<https://developer.apple.com/help/app-store-connect/manage-tax-information/provide-tax-information>
- [DSA] Manage European Union Digital Services Act trader requirements。<https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements>

**沒讀到的**

- Apple 說明「別的 app 商店、從網站直接發」的支援頁（`/support/alternative-app-distribution/`）回「找不到這一頁」。這裡只用了 [App Store 頁] 上列地區的那一句。
- Apple Business 使用手冊裡講 Custom Apps 的那一頁，網址被轉到手冊首頁，沒讀到。
- Xcode 文件「在模擬器或裝置上執行 app」那一頁，試的網址回「找不到」，沒讀到。
- 搜尋工具只用過一次，拿來找 Apple Business 功能表的網址。它給的摘要沒有寫進這份筆記。
