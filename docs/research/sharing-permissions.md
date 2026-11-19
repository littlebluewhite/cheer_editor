# 分享和權限：大廠怎麼設計

研究紀錄，查核日期 2026-11-06。後端第一版要讓一支流程能分享給別人（地圖 #177、研究票 #178）。這裡整理 Google 雲端硬碟、文件、試算表、表單，Figma，Notion，以及兩個運動隊伍 App（TeamSnap、GameChanger）怎麼做。只整理事實，不決定設計；要怎麼做由 #184 決定。

標記方式：

- **已確認**：產品自己的說明頁有寫。下方附原句。
- **未確認**：查不到官方原文，或只是推論。推論會寫明「推論」。
- **非官方**：論壇、大學 IT 網頁、第三方文章。

「查無」都指「在下方來源中查無」。來源代號見文末。產品的角色名稱照原文寫英文，第一次出現時附中文。「組織管理員」指公司或學校替整個組織管帳號的人，不是我們名詞表裡的「管理員」。

## 結論

1. **角色都是一條由少到多的梯子：看 → 留言 → 編輯 → 擁有者。** Google 是 Viewer（檢視者）、Commenter（加註者）、Editor（編輯者），另有 owner；Figma 是 can view、can edit、owner；Notion 是 Can view、Can comment、Can edit、Full access。看的人都不能改、不能再分享（Figma 例外，見第 4 節）。已確認。
2. **「能不能再分享」常常和「能不能編輯」分開。** Google 的編輯者預設能再分享，擁有者可以關掉。Notion 把它拆成兩級：Can edit 不能分享，Full access 才能。TeamSnap 只有擁有者能把別人升成 manager。已確認。
3. **用連結分享時，不登入的人大多只能看。** Google 的「知道連結的任何人」不用登入就能開，沒登入的人顯示成匿名動物。Notion 不登入能看，要留言或編輯就得登入。Figma 公開連結不登入能看原型。只有 Google 讓不登入的人也能留言、編輯（連結角色可選 Editor），推論；說明頁沒有逐字寫這種組合。已確認（推論處另標）。
4. **邀請沒有帳號的人：大多要對方先註冊。** Figma、Notion 都寫要有帳號才能接受邀請。Google 舊做法（2013）讓沒帳號的人能看、但編輯和留言要登入；公司版另有「訪客分享」，用 email 收驗證碼，一次給 7 天。已確認。
5. **擁有者只有一個，可以轉移。** Google 個人帳號要對方接受，接受後原擁有者降成編輯者；公司帳號只能轉給同組織，不用接受。Figma 只能轉給已經在分享名單上的人，轉了不能取消。TeamSnap 只能轉給已經是 manager 的人，要對方接受，原擁有者降成 manager。已確認。
6. **擁有者帳號刪掉時，三家做法差很多。** Google 個人帳號刪掉，檔案一起沒了；公司帳號由組織管理員在 20 天內把檔案轉給別人。Figma 的檔案變成「沒有擁有者」，有權限的人照樣能開，但沒人能認領。Notion 的頁面屬於工作區；唯一的工作區管理者刪帳號，整個工作區一起刪。已確認。
7. **「只能填某一部分」有兩種做法。** 一種是「疊在編輯者上」：Google 試算表的保護範圍，要先是編輯者，才談得上哪些格子能改；Google 明寫「This shouldn't be used as a security measure.」另一種是「另開一個角色」：Notion 的 Can edit content（只能改資料庫的內容、不能改結構）、Can create（只能新增、看不到別人的）、依「人員」欄位給權限；Google 表單只能填、看不到別人的回覆；GameChanger 有單獨的「記分」權限，不用占教練名額。已確認。
8. **權限會一層一層往下傳，而且下層只能給更多，不能給更少。** Google 資料夾裡的檔案繼承資料夾的權限，「You cannot give someone less access to a specific file than they have to its parent folder.」Figma 一樣：檔案能比資料夾多給，不能少給。Notion 子頁面繼承母頁面，衝突時取最寬的那個。要擋住下層，Google 另有「限制存取」資料夾。已確認。
9. **收回權限的方式都一樣：在分享視窗把人移除，或把連結改回「限制」。** Google 公司版、Figma、Notion 都能替連結或某個人設到期日。擁有者不能被移除。已移除的人之前開過、下載過的內容怎麼辦，查無。已確認（最後一句查無）。

## 1. 有哪幾種權限

### Google 雲端硬碟、文件、試算表

[分享說明頁][g-share]：

- Viewer：「People can view the file or folder and open all files within a shared folder.」不能改、不能留言、不能分享。
- Commenter：「People can make comments and suggestions on files.」
- Editor：「People can open, edit, delete, or move any files within the folder, as well as add new files.」「Editors can also change permissions and share items with others by default.」
- 擁有者不是分享視窗裡的一個選項；說明頁只寫「You can transfer ownership if you want someone else to be the owner.」

[Drive API 角色表][g-roles] 把角色寫得更細：`owner`、`organizer`、`fileOrganizer`、`writer`、`commenter`、`reader`。和我們有關的幾列：

| 能做什麼 | owner | writer（編輯者） | commenter | reader |
|---|---|---|---|---|
| 讀內容 | 是 | 是 | 是 | 是 |
| 留言 | 是 | 是 | 是 | 否 |
| 改內容 | 是 | 是 | 否 | 否 |
| 看歷史版本 | 是 | 是 | 否 | 否 |
| 分享 | 是 | 是 | 否 | 否 |
| 看詳細權限 | 是 | 是 | 否 | 否 |
| 丟進垃圾桶 | 是 | 否 | 否 | 否 |
| 刪除 | 是 | 否 | 否 | 否 |

- 依角色表，編輯者能改內容、能分享，但「丟進垃圾桶」「刪除」只有 owner 能做（共用雲端硬碟是 organizer）。說明頁卻寫資料夾的編輯者能「delete, or move any files within the folder」。推論：說明頁指的是把檔案從資料夾移出（角色表的「Remove items from the My Drive folder」編輯者是「是」）。兩頁說法不同，**未確認**。
- 共用雲端硬碟（公司版，檔案屬於組織）另有 Manager、Content manager、Contributor、Commenter、Viewer 五級；只有 Manager 能加減成員、改成員權限、刪掉整個硬碟（[共用雲端硬碟說明][g-shared-drive]）。已確認。

### Figma

[檔案和資料夾權限][f-perm]：

- Owner（檔案）：「The person who created the file. They have full editing access.」
- Can edit（檔案）：「Full file editing access.」
- Can view（檔案）：「View and comment on the file, but not edit it.」看的人也能留言，這點和 Google 不同。
- 資料夾的 can edit 是「Create files and folders in the folder.」能不能改裡面的檔案，看檔案自己的權限。
- [分享總覽][f-guide] 只列 can view、can edit 兩級，另寫付費方案的組織管理員能改整個方案的權限，就算自己沒有 can edit。已確認。

### Notion

[分享與權限][n-share]：

- Full access：「People with full access to a page can edit any of the content it contains and share the page with anyone they want.」
- Can edit：「Select this level of access for people who should be able to edit the content on the page, but not share the page with others.」
- Can edit content：只有資料庫才有。能新增、編輯資料庫裡的頁面和欄位的值，不能改資料庫的結構、欄位、檢視、排序、篩選。
- Can create：只有資料庫才有，Business、Enterprise 方案。能新增，但看不到、改不到別人的，除非另外給權限。
- Can comment：只能留言，「They won't be able to edit or share the content.」
- Can view：「People with this level of access can read the content on the page, but they won't be able to comment, edit, or share.」

已確認。

### 運動隊伍 App

[TeamSnap 角色說明][ts-roles]（2023-06-15 更新）：

- Team Owner：「full administrative access over the team」，能把別人升成 manager，綁付款。
- Team Manager：「administrative access to the team including the ability to manage the schedule, roster, and create invoices」；能改統計數據（要方案有包含）。人數不限。
- Player：預設角色，能設定出席、填健康檢查、收發訊息，「have no administrative capabilities」。
- 搜尋摘要另引 TeamSnap 商用版說明：「There can only be one team owner assigned per team.」沒有開原頁核對。

[GameChanger 記分權限][gc-2025]（2025-01-28）：

- 教練（Staff）可以把「trusted team community member」設成記分的人，不用占教練名額。棒壘球的教練名額是四個。
- 棒壘球預設只有教練能記分；其他運動預設「confirmed members」（確認過的隊員和家長）都能記。
- [2026-03-26 的公告][gc-2026]：教練在 Team Settings 的「Scoring Permissions」選「Confirmed Members」，隊員和家長在每一場比賽都會看到「Score Game」按鈕；也可以切回「Only Staff」。
- 記分的人不能做什麼，兩篇都沒寫。已確認（記分的人能做什麼：查無）。

## 2. 用連結分享

### Google

[分享說明頁][g-share]「一般存取權」有三種：

- 限制：「Only people who have been given access can open the file.」
- 知道連結的任何人：「Anyone on the internet who has the link can open the file without signing in to a Google Account.」
- 你的組織（只有公司、學校帳號）：「Anyone in your organization can access the file, based on sharing levels allowed by your administrator.」
- 選好對象後再選角色（檢視者、加註者、編輯者）。
- 「People who aren't signed in to a Google Account will show up as anonymous animals.」

已確認。

- [發布到網路][g-publish] 是另一條路：產生一個新網址，看到的是不能編輯、樣子也不同的版本；試算表會把公式藏起來。已確認。
- 連結角色選「編輯者」時，不登入的人能不能直接改：說明頁沒有逐字寫。從「不用登入就能開」加上「匿名動物」推論可以。**未確認**。

### Figma

[分享檔案和原型][f-share] 的對象設定：

- Anyone：「Anyone, even those outside your organization, will be able to access this file」
- Only invited people：「Only those directly invited to the file can access it」
- 組織：「Anyone at your organization can access the file (Organization/Enterprise plan only).」
- 選好對象後再選「view or edit」。

不登入的人：

- [手機看原型][f-proto-mobile]：「If you are sharing your prototype via public link access, anyone with the link will be able to view your prototype.」「If the file isn't shared via public link access, you will only need a free Figma account to view the file.」已確認。
- 不登入能不能看「設計檔」本身（不只原型）：官方頁查無。Figma 論壇有人說「anyone with the link can view」不用帳號，也有人回報還是被要求註冊（[論壇][f-forum]，只讀到搜尋摘要）。非官方，**未確認**。
- [公開連結管理][f-public]：組織管理員能要求公開連結加密碼、加到期日，或整個關掉公開連結。FigJam 有「open session」：不用帳號就能進來一起改，24 小時自動結束（[open session][f-open]）。已確認。

### Notion

[分享與權限][n-share]：

- 「`Anyone on the web with link`: This means that anyone who has the link to your page can access it」
- 「Note that page visitors will need to be logged into Notion if they want to comment on or edit your page.」
- 連結可以設到期日。Enterprise 能整個關掉公開連結。
- 另有[發布成 Notion Site][n-sites]：「Anyone on the web can view it.」可以開「Duplicate as template」讓人複製，可以開搜尋引擎收錄。

已確認。

## 3. 用 email 邀請，對方還沒有帳號

- **Google（個人帳號，2013 年公告）**：寄給沒有 Google 帳號的 email，「can be viewed without having to sign in or create a new Google Account」；但要編輯或留言，「the recieving user must still sign in with a Google Account」（原文拼錯 receiving）（[Workspace 公告][g-2013]）。這是 2013 年的公告，現在的分享說明頁查無同樣的話。已確認（是否還適用：**未確認**）。
- **Google（公司、學校帳號，訪客分享）**：組織管理員要先打開。對方先收分享信，再收一封驗證碼信，輸入驗證碼後可以用 7 天；過了再用原信裡的連結重新驗證。能給檢視者、加註者、編輯者。訪客不能擁有檔案（[訪客分享][g-visitor]）。已確認。
- **Figma**：「You need to have a Figma account to accept a file, team, or organization invitation.」（[接受邀請][f-invite]）邀請是寄到 email，但接受時要登入對的帳號。已確認。
- **Notion**：邀請工作區以外的人當 guest，對方收信點連結；「To access your page, your guest will need their own Notion account.」（[分享與權限][n-share]）已確認。
- 邀請一直沒被接受時會不會過期，三家都查無。

## 4. 誰能再分享、誰能改別人的權限、怎麼收回

### 再分享

| 產品 | 誰能再分享 | 能不能關掉 |
|---|---|---|
| Google | 擁有者、編輯者（預設） | 擁有者取消勾選「Allow editors to change permissions and share」（[分享說明頁][g-share]）。在共用雲端硬碟裡這項永遠當作打開（[Drive API][g-api-share]） |
| Figma | 擁有者、can edit 能改權限（[檔案和資料夾權限][f-perm]）；can view 預設也能「copy, share, and export」 | 付費方案取消勾選「Viewers can copy, share, and export from this file」，要有 can edit 才能改（[限制複製和分享][f-restrict]） |
| Notion | 只有 Full access | 不用關：要不要給 Full access 就是開關 |
| TeamSnap | 只有擁有者能把人升成 manager | 不適用 |

已確認。

- Google 的檢視者、加註者可以不讓他們下載、列印、複製：分享設定裡取消勾選對應的角色（[分享說明頁][g-share]）。已確認。
- 沒權限的人可以送出存取要求。Notion：「This request will go to the page creator, who can accept or ignore it.」Google 的分享按鈕旁出現小點表示有待處理的要求。已確認。

### 收回

- Google：在分享視窗人名旁的箭頭選「Remove access」；連結改回「限制」就關掉連結分享（[分享說明頁][g-share]）。
- Notion：分享視窗人名旁選 Remove；或把頁面拖到側邊欄的 Private，只剩自己看得到（[分享與權限][n-share]）。
- 到期日：Google 只有公司、學校帳號能設，一年內，資料夾只能替檢視者設（[分享說明頁][g-share]）；Google API 寫到期日只能設在個人和群組，不能設在「知道連結的任何人」（[Drive API][g-api-share]）。Figma 的設計檔公開連結可以設一小時到一年後到期，到期後「Figma automatically changes the access setting on the file back to the last-used private setting.」只有 Education（K-12）、Government、Enterprise 方案（[公開連結到期][f-expire]）。Notion 的公開連結可以設到期（[分享與權限][n-share]）。
- 擁有者不能被移除。TeamSnap：「Team owners cannot be removed from a team that they own.」要先轉移（[TeamSnap 轉移][ts-transfer]）。Google 的編輯者能改分享，但「can't take permissions away from owners」（[保護範圍][g-protect]，這句是講保護範圍）。
- 被收回的人之前開過或下載過的內容怎麼辦：查無。

已確認（最後一點查無）。

## 5. 擁有者轉移和擁有者帳號刪掉

### 轉移

[Google][g-owner]：

- 個人帳號只能轉給已經分享過的人，不能轉給公司、學校帳號。
- 「The pending owner is notified by email that if they accept the transfer request, they become the file owner.」「Until then, you remain the owner.」等待中的人先升成編輯者。
- 對方接受後，「you're downgraded to Editor. The new owner can remove you.」接受了就不能取消。
- 公司、學校帳號只能轉給同組織的人，「The transfer doesn't require the new owner to accept.」

[Figma][f-transfer]：

- 「Only the current owner can transfer ownership.」
- 草稿裡的檔案能轉給任何分享過的人，包括團隊外；資料夾裡的檔案「the new owner needs to already be a collaborator on it.」
- 轉移不改原擁有者的權限，也不能復原：「The new owner will need to assign ownership back to you if you change your mind.」
- 轉資料夾不轉裡面的檔案：「Files inside the folder keep their current owners.」

[TeamSnap][ts-transfer]：

- 「The transfer initiator must be the current team owner.」
- 只能轉給「any active roster member that has been granted manager access to the team」。
- 對方收信，要接受才算。原擁有者「will be downgraded to a team manager」。

已確認。

### 擁有者帳號刪掉

| 產品 | 擁有者帳號刪掉時 | 來源 |
|---|---|---|
| Google 個人帳號 | 「You'll lose all the data and content in that account, like emails, files, calendars, and photos.」說明頁沒提已分享給別人的檔案 | [刪除帳號][g-del-acct] |
| Google 公司帳號 | 組織管理員刪人後，「These files are saved for 20 days but are only accessible if you restore the user.」要留檔案就要先轉給別人。共用雲端硬碟的檔案屬於組織，不會刪 | [刪除使用者][g-del-user] |
| Figma | 「The file becomes ownerless.」「Ownerless files cannot be claimed but are still accessible by those with file access.」官方建議刪帳號前先轉移。免費方案的草稿會打不開 | [刪除帳號][f-delete] |
| Notion | 頁面屬於工作區。「Any shared workspaces in which you were the only admin will be deleted.」有別的管理者時，只把你移出工作區 | [刪除帳號][n-delete] |
| TeamSnap | 擁有者不能直接離隊，要先轉移 | [TeamSnap 轉移][ts-transfer] |

已確認。

- 非官方：一所大學的公告（2026-04-17）說要刪掉四年沒用的帳號，提醒「分享給你的連結可能失效」，建議把共用檔案移到單位的共用雲端硬碟（[大學公告][alaska]）。這是學校的決定，不是 Google 的。

## 6. 只能填某一部分

這節對「隊員只能記成功率」最有參考價值。

### 疊在編輯者上：Google 試算表保護範圍

[保護、隱藏工作表][g-protect]：

- 資料 → 保護工作表和範圍。可以保護一個範圍，或整張工作表再勾「Except certain cells」留幾格不保護。
- 「Restrict who can edit this range」選 Only you、Only domain（只限組織）、Custom（「Only the people you choose can edit the range or sheet.」）。另一種是「Show a warning when editing this range」，只跳警告，不擋。
- 編輯者能設保護，但不能拿掉擁有者的權限。檢視者、加註者：「You won't be able to make any changes.」
- 推論：要讓人「只能改某幾格」，先給他編輯者，再把其他地方保護起來。說明頁沒有逐字這樣寫。**未確認**。
- 同一段開頭就寫：「This shouldn't be used as a security measure.」「People can print, copy, paste, and import and export copies of a protected spreadsheet.」「Only share spreadsheets with people you trust.」
- 隱藏工作表也不是保護：「Spreadsheet viewers can still access content in hidden sheets.」

已確認（推論處另標）。

### 另開一個角色

- **Google 表單**：分享時有「Responder」（回覆者）一級。回覆者預設看不到結果；要打開「View results summary」，而且打開後「visible to anyone who can respond to the form」（[發布表單][g-forms]）。「Limit to 1 response」時，填表的人要登入 Google 帳號。已確認。
- **Notion 表單**：「Who can fill out」可選工作區成員、「Anyone on the web with link」（不用 Notion 帳號也能填）、No access（停收）。公開表單的回覆一定匿名。填的人事後能不能看、能不能改自己的回覆，用「Access to submission」設，只有工作區內、不匿名的表單能設（[Notion 表單][n-forms]）。已確認。
- **Notion 資料庫的 Can edit content、Can create**：見第 1 節。Can create 的例子是 IT 報修單：「You might have an IT ticket database where you want ticket creators to be able to edit their tickets.」已確認。
- **Notion 依「人員」欄位給權限（Page-level access）**：「If your database has at least one person property, you'll be able to assign specific permissions to the people in that person property.」例子：Anna 對任務資料庫只能留言；加一條規則「被指派的人 Can edit」，把任務 1 指派給 Anna，她就能改任務 1。她要是根本沒有資料庫的權限，打開資料庫會看到錯誤，只能從通知或連結進任務 1（[分享與權限][n-share]）。已確認。
- **Notion 欄位權限**：每一欄能設「Can edit property & values」「Can edit values only」「Can view property & values」「No access」等。「A column rule never gives someone access to a database page that they can't already open.」Business、Enterprise 方案（[欄位權限][n-prop]）。已確認。
- **GameChanger 記分權限**：只給「記分」這一件事，見第 1 節。已確認。
- **TeamSnap**：隊員能設定自己的出席，統計數據只有 manager、擁有者能改（[TeamSnap 角色說明][ts-roles]）。已確認。

### 兩種做法比一比

| | 疊在編輯者上 | 另開一個角色 |
|---|---|---|
| 例子 | Google 試算表保護範圍 | Google 表單、Notion Can edit content／Can create、GameChanger 記分 |
| 能看到什麼 | 整份都看得到（包括隱藏的工作表） | 看得到的範圍另外設 |
| 官方怎麼說安全性 | 「This shouldn't be used as a security measure.」 | 查無類似警語 |

推論：「疊在編輯者上」是在前端擋，「另開一個角色」是在伺服器擋。官方沒有這樣寫。**未確認**。

## 7. 一份一份設，還是一層一層繼承

- **Google**：「When you share a folder, all files and subfolders inside it inherit those same sharing permissions.」「You cannot give someone less access to a specific file than they have to its parent folder.」檔案在共用資料夾裡時，「the folder's permissions override any settings you choose for the file.」（[分享說明頁][g-share]）Drive API 也寫「You cannot remove or reduce an inherited permission on a child item.」（[Drive API][g-api-share]）已確認。
- **Google 限制存取資料夾**：只有直接加進資料夾的人能開；靠上層繼承的人「can see the restricted folder in Drive but can't open it.」只能用在資料夾，不能用在檔案。My Drive 只有擁有者、共用雲端硬碟只有 organizer 能開關（[限制存取][g-limited]）。已確認。
- **Figma**：「anyone who was directly invited to the parent gets the same level of access to everything inside it.」檔案能比資料夾多給，不能少給。另有團隊一層，但「Being in a team doesn't always guarantee folder or file access」（[檔案和資料夾權限][f-perm]、[分享總覽][f-guide]）。已確認。
- **Notion**：「When you create a subpage inside of a page, that subpage will take on the permissions of its parent page.」要改就改子頁面自己的設定。「Notion respects the broadest level of access given to a user.」（[分享與權限][n-share]）已確認。
- 三家都有：組織或團隊（Google 組織、Figma 團隊、Notion 工作區）→ 資料夾或母頁面 → 檔案。也都能直接分享單一檔案給人。

## 來源

Google（官方說明頁、API 文件、官方公告）：

- [分享和管理存取權][g-share]：Share and manage access to files and folders in Google Drive。
- [Drive API 角色表][g-roles]、[Drive API 分享][g-api-share]、[Drive API 限制存取][g-limited]。
- [轉移擁有權][g-owner]：Make someone else the owner of your file。
- [訪客分享][g-visitor]：Share documents with visitors。
- [Workspace 公告：分享給沒有 Google 帳號的人][g-2013]：2013-10-07。
- [共用雲端硬碟的存取權][g-shared-drive]：How file access works in shared drives。
- [刪除使用者][g-del-user]：Delete or remove a user from your organization（組織管理員用）。
- [刪除 Google 帳號][g-del-acct]。
- [保護、隱藏工作表][g-protect]：Protect, hide & edit sheets。
- [發布表單][g-forms]：Publish & share your form with responders。
- [發布到網路][g-publish]：Make Google Docs, Sheets, Slides & Forms public。

Figma（官方說明頁）：

- [分享總覽][f-guide]、[分享檔案和原型][f-share]、[檔案和資料夾權限][f-perm]。
- [公開連結和 open session][f-public]、[open session 訪客][f-open]、[手機看原型][f-proto-mobile]。
- [接受邀請][f-invite]、[限制複製和分享][f-restrict]、[公開連結到期][f-expire]、[轉移擁有權][f-transfer]、[刪除帳號][f-delete]。

Notion（官方說明頁）：

- [分享與權限][n-share]、[表單][n-forms]、[欄位權限][n-prop]、[發布成 Notion Site][n-sites]、[成員和 guest][n-members]、[刪除帳號][n-delete]。

運動隊伍 App（官方說明頁、官方部落格）：

- [TeamSnap 角色說明][ts-roles]：2023-06-15 更新。
- [TeamSnap 轉移擁有權][ts-transfer]。
- [GameChanger 記分權限更新][gc-2025]：2025-01-28。
- [GameChanger 隊員和家長記分][gc-2026]：2026-03-26。

非官方：

- [Figma 論壇：設成知道連結能看，還是被要求註冊][f-forum]：只讀到搜尋摘要。
- [阿拉斯加大學 IT 公告][alaska]：2026-04-17。

查核限制：

- 所有網頁都經過摘要工具讀取，引文是工具回傳的原句，沒有逐字比對原頁。
- 官方說明頁多半沒有寫更新日期。產品會改，選項名稱、方案限制都要再核對。
- 只看說明頁，沒有實際操作任何一個產品。
- 說明頁是英文版；分享視窗裡的中文名稱（檢視者、加註者、編輯者）是 Google 台灣介面的用字，沒有逐一核對 Figma、Notion 的中文介面。
- GameChanger 的說明中心（help.gc.com）回 403，只讀到官方部落格。
- Figma 設計檔不登入能不能看、Google 連結設成編輯者時不登入能不能改、Google 現在寄給沒帳號 email 會怎樣，都沒找到現行的官方原句。

## 對我們的流程代表什麼

這裡只列選項，不做決定。要怎麼做由 #184 決定。

**1. 角色要幾級**

- A. 照地圖寫的三級：可以編輯、只能記成功率、只能看，加上擁有者。
- B. 再加「可以留言」。三家都有這一級，但我們的流程現在沒有留言功能。
- C. 把「能再分享」從「可以編輯」拆出來（像 Notion 的 Can edit 和 Full access）。

**2. 「只能記成功率」用哪種做法**

- A. 另開一個角色，伺服器只收他的成功率紀錄（像 Google 表單、Notion Can edit content、GameChanger 記分）。
- B. 給「可以編輯」再在畫面上鎖住其他地方（像 Google 試算表保護範圍）。Google 自己說這不是安全措施。
- 另一個要定的：他能記全部的組，還是只能記自己那組（像 Notion 依人員欄位給權限）。這要先定「使用者和隊員要不要對起來」，地圖的 Not yet specified 已經列了。

**3. 連結分享**

- A. 連結只給「只能看」，不用登入（像 Google、Notion、Figma 原型）。
- B. 連結也能給「只能記成功率」或「可以編輯」，但開連結的人要登入（像 Notion 留言、編輯要登入）。
- C. 加到期日、加密碼（Google 公司版、Figma、Notion 都有）。
- 不登入的人要不要顯示成「匿名」（像 Google 的匿名動物），還是根本不顯示。

**4. 分享給還沒有帳號的人**

- A. 只能分享給已經有帳號的使用者（從清單挑）。
- B. 輸入 email 時，如果還沒帳號，就請管理員加人；加好之後分享自動生效。
- C. 沒帳號的人只能拿「只能看」的連結。
- 我們沒有自己註冊，所以不能照 Figma、Notion「先去註冊」的做法。

**5. 誰能再分享、改權限**

- A. 只有擁有者。
- B. 擁有者和可以編輯的人（Google 預設），擁有者可以關掉。
- 擁有者都不能被移除，要先轉移（Google、TeamSnap）。

**6. 擁有者轉移**

- A. 只能轉給已經能編輯這支流程的人（像 Figma、TeamSnap）。
- B. 對方要按接受才算（Google 個人帳號、TeamSnap）；或不用接受（Google 公司帳號）。
- C. 轉完原擁有者降成可以編輯（Google、TeamSnap），或權限不變（Figma）。

**7. 擁有者帳號被停用或刪掉**

- A. 先擋：還有流程時不能刪，要先轉移（像 TeamSnap 擁有者不能離隊）。
- B. 由管理員把流程轉給別人，給一段寬限期（像 Google 公司版 20 天）。
- C. 流程變成沒有擁有者，有權限的人照樣能用（像 Figma）。
- D. 流程跟著刪掉（像 Google 個人帳號）。

**8. 繼承**

- A. 第一版一支流程一支流程設，沒有資料夾、隊伍。
- B. 以後有「隊伍」或「資料夾」時，照三家的規則：下層只能多給，不能少給；衝突時取最寬的。

**9. 收回**

- 從分享清單移除人、把連結關掉，三家都有。
- 要不要能「換一條新連結」讓舊連結失效：本次來源查無直接對應的功能。
- 已經下載成 zip 的流程收不回來；三家也沒有說開過的內容怎麼辦。

[g-share]: https://support.google.com/drive/answer/2494822?hl=en
[g-roles]: https://developers.google.com/workspace/drive/api/guides/ref-roles
[g-api-share]: https://developers.google.com/workspace/drive/api/guides/manage-sharing
[g-limited]: https://developers.google.com/workspace/drive/api/guides/limited-expansive-access
[g-owner]: https://support.google.com/drive/answer/2494892?hl=en
[g-visitor]: https://support.google.com/drive/answer/9195194?hl=en
[g-2013]: https://workspaceupdates.googleblog.com/2013/10/share-docs-slides-and-drawings-with.html
[g-shared-drive]: https://support.google.com/a/users/answer/12380484?hl=en
[g-del-user]: https://knowledge.workspace.google.com/admin/users/delete-or-remove-a-user-from-your-organization?hl=en
[g-del-acct]: https://support.google.com/accounts/answer/32046?hl=en
[g-protect]: https://support.google.com/docs/answer/1218656?hl=en
[g-forms]: https://support.google.com/docs/answer/160000?hl=en
[g-publish]: https://support.google.com/docs/answer/183965?hl=en
[f-guide]: https://help.figma.com/hc/en-us/articles/1500007609322-Guide-to-sharing-and-permissions
[f-share]: https://help.figma.com/hc/en-us/articles/360040531773-Share-files-and-prototypes
[f-perm]: https://help.figma.com/hc/en-us/articles/35361119554711-File-and-folder-permissions
[f-public]: https://help.figma.com/hc/en-us/articles/5726756336791-Manage-public-link-sharing-and-open-sessions
[f-open]: https://help.figma.com/hc/en-us/articles/4410786053911-Invite-visitors-to-an-open-session
[f-proto-mobile]: https://help.figma.com/hc/en-us/articles/360040321093-View-prototypes-on-a-mobile-device
[f-invite]: https://help.figma.com/hc/en-us/articles/1500008023902-Accept-invitations
[f-restrict]: https://help.figma.com/hc/en-us/articles/360040045574-Restrict-copying-and-sharing-on-files
[f-transfer]: https://help.figma.com/hc/en-us/articles/360038512093-Transfer-ownership-of-files-or-folders
[f-delete]: https://help.figma.com/hc/en-us/articles/360039826814-Delete-your-Figma-account
[f-expire]: https://help.figma.com/hc/en-us/articles/16142157359255-Set-an-expiration-on-public-links-in-design-files
[f-forum]: https://forum.figma.com/archive-21/file-set-to-anyone-with-link-can-view-but-people-are-still-required-to-sign-up-to-view-the-file-30183
[n-share]: https://www.notion.com/help/sharing-and-permissions
[n-forms]: https://www.notion.com/help/forms
[n-prop]: https://www.notion.com/help/database-property-access
[n-sites]: https://www.notion.com/help/public-pages-and-web-publishing
[n-members]: https://www.notion.com/help/add-members-admins-guests-and-groups
[n-delete]: https://www.notion.com/help/delete-your-account
[ts-roles]: https://helpme.teamsnap.com/article/241-member-types
[ts-transfer]: https://helpme.teamsnap.com/article/328-transfer-team-ownership
[gc-2025]: https://gc.com/post/updated-scoring-and-live-streaming-permissions
[gc-2026]: https://gc.com/post/family-and-player-scorekeeping
[alaska]: https://www.alaska.edu/news/it/2026-Google-accounts-shared-files-inactive-users-will-be-deleted.php
