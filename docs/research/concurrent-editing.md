# 多人同時改：大廠怎麼做

Issue #179（地圖 #177）。問題：好幾個人同時改同一份東西時，怎麼不互相蓋掉？哪幾種做法適合我們的流程和成功率紀錄？

資料都在 2026-11-06 查。版本號取自 npm registry、crates.io（同一天）和 MDN browser-compat-data 8.1.8（2026-11-02）。
標「推論」的是我自己推的，沒有一手來源直接寫。
Linear 同步引擎的細節有一部分來自社群逆向工程的文件，不是 Linear 官方寫的，用到的地方標 [逆向 LSE]。

## 先講結論

1. 大廠多半是「伺服器說了算」：改動送到伺服器排隊，伺服器定先後，再發給大家。Google 文件、Figma、Linear、Notion 都是。
2. 只有一個字一個字打的文字，才用 OT 或 CRDT 這種複雜的合併。其他資料（位置、顏色、狀態），Figma、Linear、Excalidraw 都是「同一個欄位，最後寫的贏」。
3. 「最後寫的贏」差在單位。整份檔案最後存的贏，會整份蓋掉別人；每個欄位最後寫的贏，只有兩人改同一個欄位才會蓋。
4. 只會往後加的紀錄最好處理：每筆在手機上就發一個不會撞的 id，伺服器看到同一個 id 就不再加。Stripe 的「冪等鍵」也是這個想法。
5. 斷網：Linear、Notion 都把還沒送出的改動存在瀏覽器裡，有網路再重送。iPhone 的 Safari 沒有「背景同步」，要等使用者打開網頁才送得出去。
6. 讓別人看到改動：Figma、Linear、Excalidraw 都用 WebSocket。
7. CRDT 函式庫（Yjs／yrs、Automerge、Loro）都有 Rust 版，也都能配 TypeScript 前端。但它們不管權限，也不管資料要守的規則。

## 先解釋幾個詞

- **互相蓋掉**（lost update）：A、B 打開同一份。A 先存，B 後存。B 那份沒有 A 改的，A 的改動就不見了。HTTP 規格就用這個名字 [RFC 9110 §13.1.1]。
- **樂觀更新**：先改自己的畫面，不等伺服器；伺服器說不行再退回。網路慢也不卡。Google 文件、Figma、Linear、Notion 都這樣做。
- **OT**（operational transformation，改動轉換）：別人的改動傳過來時，先照我自己還沒送出的改動「挪位置」，再套上。
  例：我在開頭加了 2 個字，對方要刪第 9–11 個字，我這邊要改成刪第 11–13 個字 [Google 2010b]。
- **CRDT**（conflict-free replicated data type）：每個改動帶著「誰改的、他的第幾個改動」。大家只要收到同一批改動，不管先後，結果都一樣。不需要伺服器排隊。
- **最後寫的贏**（last writer wins，LWW）：同一個東西兩人同時改，留「後面那個」。「後面」可以是伺服器收到的順序（Figma），也可以是版本號加一個固定的比法（Excalidraw）。
- **墓碑**（tombstone）：刪掉的東西不真的拿掉，只標「已刪除」。這樣晚到的舊資料不會把它加回來。
- **冪等**（idempotent）：同一個請求送一次和送好幾次，結果一樣 [RFC 9110 §9.2.2]。

## 1. 大廠和常見的 app 怎麼做

| | 誰定先後 | 兩人同時改同一個東西 | 斷網 | 怎麼傳 |
|---|---|---|---|---|
| Google 文件 | 伺服器 | OT 合併文字 | 沒查 | 伺服器轉發 |
| Figma | 伺服器（每份檔一個程序） | 每個屬性最後寫的贏 | 可以離線多久都行 | WebSocket |
| Linear | 伺服器（全域遞增的編號） | 欄位最後寫的贏；說明文字可以多人同時打 | 存在本機，有網路再送；官方說可能蓋掉別人 | WebSocket |
| Notion | 伺服器（先檢查權限和資料） | 一般資料沒寫；離線的頁面用 CRDT | 2025 年起可以離線 | 一條一直連著的連線 |
| Excalidraw | 沒有，伺服器只轉發 | 每個元素版本號大的贏 | 沒查 | Socket.IO |

### Google 文件：OT（2010 年的三篇）

- 舊版 Google 文件：伺服器比對兩份版本再合併。常合錯。
  例：一人把「brown fox」變粗體，另一人同時把 fox 換成 dog。只看兩份版本，分不出該合成「brown dog」還是「brown fox dog」[Google 2010a]。
- 他們考慮過「一段只能一個人改」（段落上鎖）。但他們說這是繞開問題，而且兩人還是可能同時開始改同一段；以為拿到鎖的人改的東西，最後要合併或丟掉 [Google 2010a]。
- 新版：文件存成一串改動（revision log），例 `{InsertText 'T' @10}`。看文件就是從頭重播這串改動 [Google 2010b]。
- 改動只有三種：插字、刪字、套樣式。OT 要處理這三種兩兩配對的情況 [Google 2010b]。
- 傳的方法：客戶端一次只送一個改動，等伺服器回「收到了」才送下一個。伺服器收到根據舊版本改的改動，先跟中間別人的改動做 OT，再編成下一版 [Google 2010c]。
- 他們說的好處：打字速度不受網路影響；伺服器不用記每個人的狀態，人多也不變複雜 [Google 2010c]。
- 為什麼要這麼麻煩（推論）：文字是一個一個位置，兩人同時打，位置一直在動，不挪就會改錯地方。

### Figma：伺服器說了算、每個屬性最後寫的贏（2019）

- 不用 OT：對他們的問題「太複雜」，Figma 不是文字編輯器 [Figma 2019]。
- 「受 CRDT 啟發」，但不是真的 CRDT：伺服器是中心，可以簡化很多 [Figma 2019]。
- 文件是一堆物件，每個物件有一堆屬性。兩人同時改同一個物件的同一個屬性，留伺服器最後收到的值。改不同屬性不衝突 [Figma 2019]。
- 文字也只是一個屬性：一人改成「AB」、一人改成「BC」，結果是 AB 或 BC，不會是 ABC [Figma 2019]。
- 自己改了、伺服器還沒確認的屬性，伺服器傳來的舊值先不套，畫面才不會閃回去 [Figma 2019]。
- 新物件的 id 由客戶端發，id 裡有客戶端自己的編號。這樣離線也能建物件，不會撞號 [Figma 2019]。
- 刪掉的物件，伺服器不留它的資料；要復原時，資料在刪的那個人的復原紀錄裡 [Figma 2019]。
- 前後順序：存成 0 到 1 之間的分數（fractional indexing）。插在兩個中間，就取兩個數的中間，不用改別人的位置 [Figma 2019]。
- 復原：原則是「復原很多步、複製一個東西、再重做回來，文件不該變」[Figma 2019]。
- 離線：可以離線多久都行。連回來時先下載最新的一份，再把離線的改動套上去 [Figma 2019]。
- 存在哪：每份檔案在伺服器的記憶體裡。每 30–60 秒把整份寫到 S3（存檔點）；中間的改動每 0.5 秒左右寫進一個日誌。當機時讀最後的存檔點，再重播日誌。目標是最多丟不到 1 秒；95% 的改動 600 ms 內存好 [Figma 2022]。
- 多人伺服器裡最吃效能的部分，2018 年改用 Rust 寫 [Figma 2018]。

### Linear：同步引擎

官方文件寫的：

- 改動即時同步。送不出去就存在本機，有網路再重試；重開 app 也會重試。側邊欄顯示「Syncing」和還有幾個改動沒送 [Linear docs]。
- 離線模式是「保險，不是完整的功能」。不檢查每個改動是什麼時候做的，離線改很多，可能蓋掉隊友的改動（例：你改了說明，他改了狀態）[Linear docs]。
- 2023-12 起，issue 說明和文件可以多人同時打字，看得到別人的游標 [Linear 2023]。

社群逆向工程的文件寫的（Linear 的 CTO 稱它「大概是內外最好的文件」；作者說沒問過 Linear，可能有出入）[逆向 LSE]：

- 每個改動是一筆交易：先改記憶體裡的資料，交易存進 IndexedDB 排隊，再送給伺服器。
- 新資料的 id（UUID）由客戶端發。
- 伺服器給每個改動一個全域遞增的編號（sync id），定出唯一的先後。
- 伺服器用 WebSocket 把改動發給所有人，包括送出的那個人。連回來時比對「我最後收到第幾號」，補拿漏掉的。
- 同一個欄位：最後寫的贏。自己還沒被伺服器確認的改動，畫面上先保留自己的值。
- 斷網：交易留在 IndexedDB，連上後重送。文件提醒：有些交易重送會失敗，例如刪一個已經不在的東西。
- 復原：每種交易有自己的「反向交易」，復原也是送一筆新的交易。

### Notion

- 一個動作拆成幾個「操作」，一組操作是一筆「交易」，伺服器整筆收或整筆不收 [Notion 2021]。
- 客戶端先改畫面，交易存在 IndexedDB 或 SQLite 的佇列裡，再送到伺服器 [Notion 2021]。
- 伺服器先算出「改之前」「改之後」兩份，檢查權限和資料對不對，對了才寫進去 [Notion 2021]。
- 每個客戶端跟 MessageStore（即時更新的服務）一直連著。有人存了，MessageStore 推新的版本號；客戶端發現版本對不上，就去拿新的 [Notion 2021]。
- 2025 年 8 月推出離線。標成「可離線」的頁面，會換成新的 CRDT 資料模型來合併。文章說難處之一是「富文字的衝突」[Notion 2025]。
- 連回來時，每頁比對「我最後下載的時間」和伺服器的「最後更新時間」，伺服器比較新才下載 [Notion 2025]。
- 文章沒寫文字以外的欄位怎麼合併。

### Excalidraw

- 伺服器不協調，只把端對端加密的訊息轉給同一個房間的人 [Excalidraw 2020]。
- 每個元素（一個框、一條線）有 `version`，改一次加 1。合併時留版本大的。版本一樣時比 `versionNonce`（每次改都換的亂數），小的贏，所以每個人結果一樣 [Excalidraw 2020][Excalidraw code]。
- 自己正在拖、正在打字的元素，別人傳來的先不套 [Excalidraw code]。
- 刪掉是標 `isDeleted`（墓碑），存檔時才清掉 [Excalidraw 2020]。
- 前後順序現在也用分數排（fractional index）[Excalidraw code]。
- 多人時的復原，2020 年還沒解決：別人的改動傳來，就清掉自己的復原紀錄 [Excalidraw 2020]。

### 共同點（推論）

- 改動是小塊的：一個屬性、一個元素、一筆交易，不是整份。兩人改不同地方，就不會互蓋。
- id 在客戶端發（Figma、Linear、Excalidraw），不撞號，離線也能建。
- 先改自己的畫面，背後排隊送。
- 只有文字花大功夫（OT、CRDT）。其他都是最後寫的贏。
- 復原只處理自己的改動，不然就乾脆清掉。

## 2. 比較簡單的做法

### 上鎖：一次只讓一個人改

- 做法：要改時跟伺服器拿鎖。別人只能看，看得到「誰正在改」。
- 例：微軟 SharePoint 的「簽出」。簽出後別人不能改，直到簽入。微軟自己說，要多人同時改就不要簽出 [Microsoft]。
- 鎖一定要會過期：拿鎖的人可能直接關掉分頁或斷網。WebDAV 規格：鎖有時效，客戶端要定期續；時效到了，伺服器就當作解鎖 [RFC 4918 §6.6]。
- 好處：最簡單；沒有合併；整份換回去的復原照樣能用。
- 壞處：別人要等；斷網、忘了關，要等鎖過期。Google 也說鎖是繞開問題，而且搶鎖本身有時間差 [Google 2010a]。

### 存檔時比對版本號

- 做法：每份有一個版本號。存檔時帶「我是從第 n 版改的」。伺服器現在不是第 n 版，就拒絕，請他重新載入。
- 這是標準做法：HTTP 的 `If-Match` 就是為了防互相蓋掉，條件不符回 412 [RFC 9110 §13.1.1]。Google 的 API 設計規範也一樣：帶 etag，對不上回 `ABORTED` [Google AIP-154]。
- 好處：不會悄悄蓋掉；伺服器很簡單（推論：一句 `UPDATE … WHERE version = n`）。
- 壞處：後存的人被擋。他改的東西怎麼辦？整份比對再合併很難做對（就是 Google 舊版的問題）。簡單的做法是讓他另存一份，或丟掉重來。

### 最後存的贏（整份）

- 做法：誰最後存，就是那一份。
- 好處：什麼都不用做。
- 壞處：悄悄蓋掉別人的改動，而且沒有人知道。

### 比一比

| 做法 | 會不會悄悄蓋掉 | 兩人能同時改嗎 | 要做的事 | 夠用的時候 |
|---|---|---|---|---|
| 最後存的贏（整份） | 會 | 能，但會蓋 | 沒有 | 真的只有一個人用 |
| 存檔時比對版本號 | 不會，後存的被擋 | 能，但後存的要重來 | 一個版本號 | 很少同時改，撞到能接受重來 |
| 上鎖 | 不會 | 不能 | 拿鎖、續鎖、過期、顯示誰在改 | 通常一次一個人改，而且改的人在線上 |
| 每個欄位最後寫的贏（Figma、Linear） | 只有同一個欄位會 | 能 | 送小塊改動、伺服器排隊、即時連線 | 常常同時改，但很少改到同一個地方 |
| OT／CRDT | 不會，自動合併 | 能 | 最多 | 一個字一個字同時打 |

## 3. CRDT 函式庫現在的狀態

| | TypeScript／JS | Rust | 授權 |
|---|---|---|---|
| Yjs | `yjs` 13.6.33（2026-09-23）；14 版還在 beta（`14.0.0-16`） | `yrs` 0.28.1（2026-11-04） | MIT |
| Automerge | `@automerge/automerge` 3.5.0（2026-09-16） | `automerge` 0.12.0（2026-09-16） | MIT |
| Loro | `loro-crdt` 1.17.1（2026-10-22） | `loro` 1.17.1（2026-10-22） | MIT |

### Yjs／yrs

- 有 Map、Array、Text 等共用型別，改了自動合併；「不需要中央的真相來源」[Yjs README]。
- Map 的同一個 key：用最後插進去的那筆，其他標成刪除 [Yjs INTERNALS]。
- 周邊：`y-websocket`（3.1.0）負責傳，`y-indexeddb`（9.0.12，2023 年後沒有新版）負責離線時存在瀏覽器 [Yjs README]。
- awareness：誰在線上、游標、名字。每人一筆，30 秒沒更新就當他離開 [y-protocols]。
- 復原（UndoManager）預設不會蓋掉別人的改動 [Yjs README]。
- yrs 是 Yjs 的 Rust 版，目標是跟 Yjs 的行為和二進位格式相容 [yrs README]。
- Rust 伺服器：Y-Sweet（Rust 寫的 Yjs 伺服器，存到 S3 這類儲存，有文件層級的權限）[Y-Sweet]；`yrs-warp` 0.9.0；社群的 `yrs-axum` 0.8.2。

### Automerge

- 核心是 Rust，JS 版是 Rust 編成 WebAssembly [Automerge README]。
- 官方說 Rust 的 API 很低階、文件少，建議 Rust 程式用 autosurgeon（0.14.0）[Automerge README]。crates.io 上另有一個 `1.0.0-beta.3` 預先版（2025-06）。
- 同一個屬性同時寫：選一個贏家，每個人選的一樣。比的是內部編號（計數器，再比誰寫的），不是時鐘。輸的值用 `getConflicts` 拿得到，可以顯示給使用者 [Automerge conflicts]。
- 不需要伺服器，有伺服器也可以 [Automerge docs]。
- 傳和存用 automerge-repo（JS 穩定版 2.5.6）。Rust 版 `samod` 0.16.0，作者自己寫「還不要用在正式的地方」[samod]。
- 3 版（2025-07）：記憶體少 10 倍以上。例：貼上整本《白鯨記》，2 版約 700 MB，3 版約 1.3 MB。檔案格式跟 2 版一樣 [Automerge 3]。

### Loro

- 核心是 Rust，JS 用 WebAssembly，也有 Swift [Loro README]。
- Map 是「最後寫的贏」；有 Text、List、MovableList（可以移動的列表）、Tree（可以移動的樹）、Counter [Loro README][Loro refs]。
- Loro 自己寫「不適合單獨用」的地方：金錢、帳目這類要守規則的；獨佔、上鎖；寫入時要檢查權限。它「本身不提供中央上鎖、可序列化的交易（serializable transactions）、寫入時的權限檢查」[Loro refs]。
- 游標、誰在線上這類資料，建議放另外的 EphemeralStore，不放進文件 [Loro refs]。

### 檔案會變多大

- CRDT 要記「誰改的、第幾個」，刪掉的東西也要留記號，所以比純資料大，而且通常只會變大 [Yjs README]。
- Yjs 的省法：連著打的字合成一塊；刪掉的內容丟掉，只留記號；整個刪掉的東西可以完全清掉 [Yjs README]。
- Loro 可以存「淺快照」：只留現在的狀態和一部分歷史，通常小很多；但對方的版本要比快照的起點新才能同步 [Loro refs]。
- 基準測試 crdt-benchmarks（Yjs 作者維護；最後更新 2024-02，版本比現在舊：yjs 13.6.11、loro 0.10.1、automerge 2.1.10）[crdt-benchmarks]：

| 測試 | Yjs | Loro | Automerge |
|---|---|---|---|
| 重播一份論文的真實打字紀錄（26 萬次插刪，最後 10.5 萬字），存起來多大 | 160 KB | 258 KB | 129 KB |
| 很多人同時寫 Map 裡的數字，存起來多大 | 32 KB | 22 KB | 86 KB |
| 前端套件（gzip 後） | 20 KB | 399 KB | 604 KB |

- 對照（推論）：最後的文字本身約 105 KB。所以這份紀錄存成 CRDT，約是純文字的 1.2–2.5 倍。
- 套件大小對我們有關（推論）：隊員在場館用手機開，網路不一定好；Loro、Automerge 多幾百 KB。

## 4. 只會往後加的紀錄：斷網先存、有網路再傳、不變兩筆

### 斷網時先存

- Linear、Notion 都把還沒送出的改動存在 IndexedDB（Notion 也用 SQLite），重開還在，有網路再送 [Linear docs][Notion 2021]。
- 瀏覽器的「背景同步」（Background Sync：網頁關掉後，有網路時由 service worker 代送）只有 Chrome、Edge 有；Firefox、Safari、iPhone 都沒有 [MDN][BCD]。
  所以在 iPhone 上，要等使用者打開網頁才能送（推論：打開時、`online` 事件時、開著時定時重試；`online` 事件各瀏覽器都有 [BCD]）。
- iPhone 的 Safari 會清資料：Safari 用了 7 天，這段時間都沒碰過這個網站，就刪掉這個網站存的資料，包括 IndexedDB 和 localStorage [WebKit 2020]。
  加到主畫面的網頁 app 另外算，照實際用的天數算 [WebKit 2020]。
  Safari 17 起，空間不夠時照「最久沒用」先刪；`navigator.storage.persist()`（要求不要刪）准不准，看的是有沒有從主畫面打開之類的條件 [WebKit 2023]。
- 對我們（推論）：記了沒傳的紀錄，手機放一個多禮拜不開，可能就沒了。畫面上要看得到「還有幾筆沒傳」。

### 不變兩筆

- 問題：手機送出，伺服器收到也存了，但回應在路上斷了。手機以為沒送到，再送一次，就變兩筆。
- 做法一：每筆紀錄在手機上就發一個不會撞的 id，伺服器拿它當唯一的鍵。同一個 id 第二次來，就不再加。
  - UUID 不用中央發號 [RFC 9562 §1]。v7 照時間排，資料庫的索引比較集中 [RFC 9562 §6.11]。
  - PostgreSQL 18 有 `uuidv7()`。`INSERT … ON CONFLICT DO NOTHING`：撞到唯一的鍵就不加，也不報錯 [PG INSERT]。
  - Figma 的新物件 id、Linear 的新資料 id 都是客戶端發的 [Figma 2019][逆向 LSE]。
- 做法二：冪等鍵（Idempotency-Key）。每個請求帶一個亂數的鍵，伺服器記住第一次的結果，重送就回同一個結果 [Stripe]。
  - Stripe 建議用 v4 UUID；鍵至少留 24 小時；同一個鍵帶了不同內容會報錯 [Stripe]。
  - IETF 正在寫成標準（草案第 8 版，2026-10-22，還不是 RFC）：還在處理中就回 409，同鍵不同內容回 422 [IETF 草案]。
- 對只會往後加的紀錄，做法一比較簡單（推論）：紀錄自己的 id 就是冪等鍵，不用另外存鍵，也不會過期。
- 現在的 id 會撞（推論，看 `src/lib/core/records.ts`）：一次的 id 是流程裡依序發的 `t1`、`t2`…（`lastIds`）。兩支手機離線各記一筆，會發成同一個號。全上的 `runThroughId`（`r1`…）也一樣。

### 合併

- 每筆有自己的 id、只加不改：合併就是「全部收進來，同一個 id 只留一筆」，誰先誰後結果都一樣（推論）。這是最簡單的一種 CRDT（只會變多的集合，grow-only set），不需要函式庫。
- 會變複雜的地方（推論）：
  - **刪和改**：現在可以「刪掉上一次」、改一次的記號（`deleteLastAttempt`、`changeAttempt`）。好幾支手機時，「上一次」是誰的上一次？刪掉要留墓碑（像 Excalidraw 的 `isDeleted`），不然晚到的重傳會把它加回來。改記號是最後寫的贏，還是只能改自己記的？
  - **紀錄指到流程裡的東西**：`who` 指到組或隊員，`marks` 指到環節。現在的規則是指到不存在的組、環節，`flow.json` 就算壞掉（`docs/flow-file-format.md`）。教練刪掉環節之後，才傳上來的舊紀錄就會違反這條。
  - **日期**：`date` 是手機的當地日期。伺服器收到的時間可以另外記。

## 5. 讓別人看到你改了什麼

| 做法 | 方向 | 好處 | 壞處 |
|---|---|---|---|
| 輪詢（每幾秒問一次「有新的嗎」） | 客戶端問 | 最簡單，一般的 HTTP 就行 | 有延遲；人多時請求多 |
| SSE（伺服器推送事件） | 只有伺服器 → 客戶端 | 一般的 HTTP | 只能單向；沒用 HTTP/2 時，一個瀏覽器對同一個網域最多開 6 條，分頁一多就不夠 [MDN EventSource] |
| WebSocket | 雙向 | Figma、Linear 都用；改動和「誰在線上」走同一條 | 要處理斷線重連、補拿漏掉的改動；主機要能撐長連線 |

- 斷線後補拿：Linear 比對全域編號 [逆向 LSE]；Notion 比對每頁的更新時間 [Notion 2025]；Figma 直接下載整份最新的 [Figma 2019]。
- 誰在線上、游標：Yjs 是每人一筆、30 秒沒更新就當離開 [y-protocols]。這種資料不存進文件 [Loro refs]。
- 後端不只一台時（推論）：一台收到改動，要通知其他台。PostgreSQL 的 `LISTEN`／`NOTIFY` 可以做：交易 commit 了才送出；內容預設要小於 8000 bytes，大的放在表裡、只送 id [PG NOTIFY]。只有一台就不需要。
- Rust：axum 0.8.9 有 WebSocket（`ws` 功能）和 SSE [axum]。
- 前端放在 GitHub Pages 時（推論）：Pages 只放靜態檔，長連線要直接連到後端的主機。

## 對我們的流程和成功率紀錄代表什麼

這節只列選項和取捨，不做決定。流程在 #185 決定，成功率紀錄在 #186 決定。

### 現在的程式

- 一次改動算出一整份新的流程，換上去（`EditorSession.change`）。復原是整份換回上一份，最多 100 步。
- 「記」（記一次、刪掉上一次）不算復原的一步。復原時帶著現在的紀錄（`carryRecords`）。所以在程式裡，紀錄已經跟編排分開處理。
- 存檔是整份（zip 流程檔、瀏覽器草稿）。

### 流程：兩個可以編輯的人同時打開（#185）

**A. 上鎖：一次一個人改**

- 合我們的猜測「通常一次一個教練」，也合「改雲端流程一定要有網路」。
- 整份存檔、整份復原都能照用。
- 要做：拿鎖、續鎖（開著時每隔一段時間跟伺服器說「我還在」）、過期、顯示「誰正在改」；擁有者能不能把鎖搶過來。
- 別人只能看。要不要即時看到改的人在改什麼，另外決定。

**B. 存檔時比對版本號**

- 伺服器最簡單。
- 兩人同時改，後存的人被擋，要重新載入。他改的東西要另存一份，還是丟掉？
- 可以跟 A 一起用（推論）：A 擋住大部分，B 防萬一，例如鎖過期了，但舊分頁還開著在存。

**C. 伺服器說了算、每個欄位最後寫的贏（Figma、Linear 的做法）**

- 兩人改不同的動作、不同的站位，不會互蓋。
- 要把「換上整份新流程」改成「送小塊的改動」。我們很多改動會連帶改別的地方（拖人連帶插站位、刪段連帶刪動作和站位），要定什麼算一塊（推論）。
- 復原要改成只復原自己的改動。現在整份換回去，會把別人的改動也換掉（推論）。
- 兩個各自沒問題的改動，合起來可能違反流程的規則（例：兩人各移一個環節，合起來重疊）。伺服器要再檢查一次，擋下來或修掉（推論）。

**D. CRDT（Yjs／Automerge／Loro）**

- 能離線改、自動合併，有現成的伺服器和游標。
- 我們沒有長文字要同時打（動作備註最多 200 字），CRDT 最大的好處用不太到（推論）。
- 流程的規則（環節不重疊、組號連續、每張站位都有全隊）CRDT 不管，合併後還要檢查、修；Loro 自己也說它不管這種規則和權限 [Loro refs]。
- 前端多 20 KB（Yjs）到 600 KB（Automerge）的套件（gzip 後，2024 年的版本）[crdt-benchmarks]。
- 流程的資料要換成 CRDT 的型別，zip 流程檔進出都要轉換（推論）。

**#185 其他要決定的，大廠的參考**

- 多久存一次：Figma 每 30–60 秒存整份，中間的改動另外存日誌 [Figma 2022]。
- 以前的版本：Google 文件存整串改動，所以每一版都看得到 [Google 2010b]。A、B 最簡單的是每次存檔留一份整份的流程（推論）；音樂檔不用每版都存一份。
- 復原只復原自己改的：Yjs 的復原預設不蓋別人的 [Yjs README]；Excalidraw 是別人一改就清掉復原 [Excalidraw 2020]。用 A 的話，同一時間只有一個人改，現在的復原就是「只復原自己的」。

### 成功率紀錄：好幾個人同時記、斷網（#186）

**E. 紀錄留在流程裡（現在這樣）**

- 不用改格式。
- 記一筆就是改一次流程。好幾個人同時記，就是好幾個人同時改流程，會撞到 A 的鎖或 B 的版本號（推論）。
- 會越來越大（推論）：一筆約 117 bytes（`docs/flow-file-format.md` 的例子）。假設 8 組 × 8 個動作 × 每次練 10 次 × 一週 3 次 × 40 週，約 7.7 萬筆、約 9 MB。每次開、每次存都要整份傳。

**F. 紀錄分開存，一筆一列；流程裡只留環節和組**

- 一筆一列（推論）：手機發的 UUID 當主鍵，加上哪支流程、哪個動作、`who`、`marks`、`date`、誰記的、伺服器收到的時間。
- 重傳不變兩筆：`ON CONFLICT DO NOTHING`。
- 好幾個人同時記不會互擋，也不用跟改流程的人搶鎖。
- 斷網：手機上存在 IndexedDB 排隊，打開網頁、連上網時送。
- 下載成 zip 時把紀錄組回 `records`，上傳 zip 時拆出來（推論）。
- 要決定：
  - iPhone 要不要請隊員把網頁加到主畫面（不然 7 天沒開，沒傳的紀錄可能被清）。
  - 沒傳成功時怎麼提示；「還有幾筆沒傳」放哪裡。
  - 刪和改：只加不改最簡單。要刪就記一筆「刪掉 X」（墓碑）。改記號是最後寫的贏，還是只能改自己記的。
  - 「刪掉上一次」在好幾個人記時，是不是只刪自己記的上一次。
  - 教練刪了環節或組之後才傳上來的紀錄：收下但不算、收下並標出來、還是拒收並告訴記的人；或環節和組不真的刪，只標刪除。
  - 全上：同一次全上，不同手機要用同一個 `runThroughId`。誰開的、別人怎麼加進來（例：開的人那支手機發 UUID，別人加入時拿到）（推論）。

**G. 紀錄用 CRDT（例：Yjs 的 Array、Loro 的 List）**

- 自動合併。但只加不改的紀錄，F 就有一樣的效果（推論），G 多了函式庫和檔案大小。
- 「只能記成功率」的人不能改流程，這個權限還是要伺服器另外擋 [Loro refs]。

### 讓別人看到（流程和紀錄都有）

- 輪詢最簡單。記成功率時，別人晚幾秒看到可能就夠（推論）。
- WebSocket：要即時看到別人改了什麼、誰在線上、誰正在改時才需要。

## 沒找到

- Google 文件 2010 年以後的做法、離線怎麼合併：只讀到 2010 年的三篇。
- Linear 官方寫的同步引擎細節：官方部落格只有演講的公告 [Linear 演講]，沒有逐字稿；細節來自社群逆向工程的文件。
- Notion 離線頁面的 CRDT 管到哪些欄位；文字以外的欄位怎麼合併。
- Excalidraw 現在的協作伺服器怎麼做：只讀到 2020 年的文章和現在的合併程式。
- Loro 官網（loro.dev）擋自動讀取。Loro 的內容取自它 GitHub repo 的 README 和 `skills/loro/references/`（2026-04-25 更新）。
- 用 2026 年版本比的 CRDT 檔案大小：crdt-benchmarks 最後更新是 2024-02。
- CRDT 原始論文（只會變多的集合那類）的原文：網站擋自動讀取，所以那句標推論。

## 來源

都在 2026-11-06 讀。

- [Google 2010a] [What's different about the new Google Docs: Working together, even apart](https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs_21.html)（2010-09-21）
- [Google 2010b] [What's different about the new Google Docs: Conflict resolution](https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs_22.html)（2010-09-22）
- [Google 2010c] [What's different about the new Google Docs: Making collaboration fast](https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs.html)（2010-09-23）
- [Figma 2019] [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)（2019-10-16）
- [Figma 2022] [Making multiplayer more reliable](https://www.figma.com/blog/making-multiplayer-more-reliable/)（2022-10-20）
- [Figma 2018] [Rust in production at Figma](https://www.figma.com/blog/rust-in-production-at-figma/)（2018-05-02）
- [Linear docs] [Download Linear：Real time sync and offline](https://linear.app/docs/get-the-app)（也有 [Markdown 版](https://linear.app/docs/get-the-app.md)）
- [Linear 2023] [Linear changelog 2023-12-06](https://linear.app/changelog/2023-12-06-editor-improvements)
- [Linear 演講] [Scaling the Linear Sync Engine](https://linear.app/blog/scaling-the-linear-sync-engine)（2023-06-29，只有公告和影片）
- [逆向 LSE] [reverse-linear-sync-engine](https://github.com/Aslam97/reverse-linear-sync-engine)（社群文件，最後 commit 2025-05-29）
- [Notion 2021] [The data model behind Notion's flexibility](https://www.notion.com/blog/data-model-behind-notion)（2021-05-18）
- [Notion 2025] [How we made Notion available offline](https://www.notion.com/blog/how-we-made-notion-available-offline)（2025-12-11）
- [Excalidraw 2020] [Building Excalidraw's P2P Collaboration Feature](https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature)（2020-03-29）
- [Excalidraw code] [packages/excalidraw/data/reconcile.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/reconcile.ts)（master 分支）
- [Microsoft] [Check out, check in, or discard changes to files in a library](https://support.microsoft.com/en-us/office/check-out-check-in-or-discard-changes-to-files-in-a-library-7e2c12a9-a874-4393-9511-1378a700f6de)
- [RFC 9110] [HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)：§9.2.2 冪等、§13.1.1 If-Match
- [RFC 4918] [WebDAV](https://www.rfc-editor.org/rfc/rfc4918.html)：§6.6 鎖的時效
- [RFC 9562] [UUIDs](https://www.rfc-editor.org/rfc/rfc9562.html)（2024-05）：§1、§5.7、§6.11
- [Google AIP-154] [Resource freshness validation](https://google.aip.dev/154)
- [Stripe] [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [IETF 草案] [The Idempotency-Key HTTP Header Field, draft-08](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)（2026-10-22）
- [PG INSERT] [PostgreSQL 18 INSERT（ON CONFLICT）](https://www.postgresql.org/docs/current/sql-insert.html)；[UUID 函式](https://www.postgresql.org/docs/current/functions-uuid.html)（18.6；19 還在 RC）
- [PG NOTIFY] [PostgreSQL 18 NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)
- [BCD] [MDN browser-compat-data](https://github.com/mdn/browser-compat-data) 8.1.8：`api.SyncManager`、`api.Window.online_event`、`api.StorageManager.persist`
- [MDN] [Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [MDN EventSource] [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [WebKit 2020] [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)（2020-03-24）：7 天上限
- [WebKit 2023] [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)（2023-08-10）
- [Yjs README] [yjs/yjs README](https://github.com/yjs/yjs)：Providers、Y.UndoManager、Yjs CRDT Algorithm
- [Yjs INTERNALS] [yjs/yjs INTERNALS.md](https://github.com/yjs/yjs/blob/main/INTERNALS.md)
- [y-protocols] [yjs/y-protocols README：Awareness](https://github.com/yjs/y-protocols)
- [yrs README] [y-crdt/y-crdt](https://github.com/y-crdt/y-crdt)
- [Y-Sweet] [jamsocket/y-sweet](https://github.com/jamsocket/y-sweet)
- [Automerge docs] [Automerge：Hello](https://automerge.org/docs/hello/)
- [Automerge conflicts] [Automerge：Conflicts](https://automerge.org/docs/reference/documents/conflicts/)
- [Automerge 3] [Automerge 3.0](https://automerge.org/blog/automerge-3/)（2025-07）
- [Automerge README] [automerge/automerge](https://github.com/automerge/automerge)：Status、Rust
- [samod] [alexjg/samod](https://github.com/alexjg/samod)
- [Loro README] [loro-dev/loro](https://github.com/loro-dev/loro)
- [Loro refs] [loro-dev/loro skills/loro/references](https://github.com/loro-dev/loro/tree/main/skills/loro/references)：fit-and-architecture、containers-and-encoding、performance-and-tradeoffs
- [crdt-benchmarks] [dmonad/crdt-benchmarks](https://github.com/dmonad/crdt-benchmarks)（最後更新 2024-02-12）
- [axum] [docs.rs axum 0.8.9](https://docs.rs/axum/latest/axum/)
- 版本號：[npm registry](https://registry.npmjs.org/)（yjs、y-websocket、y-indexeddb、@automerge/automerge、@automerge/automerge-repo、loro-crdt）、
  [crates.io](https://crates.io/)（yrs、yrs-warp、yrs-axum、y-sweet、automerge、autosurgeon、samod、loro、axum）
