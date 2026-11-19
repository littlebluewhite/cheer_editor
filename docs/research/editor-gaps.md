# 編輯器還缺什麼：規則檢查、評分表、同類工具、練習需求

研究紀錄，查證日期：2026-11-04。名詞照 `GLOSSARY.md`。這份只整理事實和建議，不決定要做哪些。

問題：對競技啦啦隊教練來說，這個編輯器還有哪些重要的東西沒做，或做了但可以更好？分四個面向查：

1. 規則與安全檢查：台灣 CTCA、大專 CTUSF、ICU、USASF 的層級規定，哪些能自動提醒。
2. 評分表：編輯器能不能幫教練對照評分項目。
3. 同類工具：有哪些功能是它們有、我們沒有。
4. 練習流程：分享給隊員、影片、計時、出席與換人、多版本。

可信度標記（同 `floor-specs.md`）：

- **已確認**：讀過一手原文，包括官方 PDF 轉文字後的條文、工具官網、App Store 或 Google Play 頁。
- **摘錄**：只看到搜尋引擎對官方頁面的原文摘錄，頁面本身打不開。
- **推論**：由已確認的事實推出來的，沒有文件直接寫。
- **未確認**：找不到可信來源；只有二手說法也算這一類。

程式位置都指 `main` 分支 commit `4f02bb8`。來源代號見文末。

## 結論

1. **台灣規則的時間規定，編輯器只檢查了一半。** 時間規則警告只加總秒數（`src/lib/core/time-rules.ts:32`）。規則另外還規定兩件事：口號要放在「最前面或中間」，以及計時從「音樂第一聲響」開始。這兩件都沒檢查。已確認。
2. **每個組別有人數範圍，編輯器不知道組別。** CTCA 團體組是 12–25、12–24、12–20 或 16–24 人。ICU 世界賽是 16–24 人。編輯器只有一個固定的上限 40 人（`src/lib/core/members.ts:12`）。已確認。
3. **各級規則裡，有一部分只看「誰擔任什麼任務角色、幾個人」就能檢查。** 例如第一級禁止籃型拋投；拋投最多 4 位拋投底層，其中 1 位在上層背後；搖籃式抱接的接者人數。其他大多要知道高度、旋轉圈數或動作名稱，編輯器沒有這些資料。已確認。
4. **合法性只能提醒，不能保證。** USASF、IASF、ICU 都要求教練寄影片給官方判定，而且明講判定只對影片裡的做法有效。CTCA 也要教練把動作拍成影片寄去問。已確認。
5. **評分表看重「幾組、幾個底層、幾個人一起做」。** CTCA 和 ICU 的舞伴技巧項目都寫「底層人數多寡、實施組數多寡」。USASF、IASF 直接按隊伍人數列出 Majority、Most、Max 要幾組或幾人。編輯器已經有算這些數字需要的資料，但沒有算給教練看。已確認。
6. **同類工具幾乎都有手機或平板的隊員唯讀檢視，我們沒有。** CheerCraft、Pyware Viewer、UDBapp、Choreographic 都有。編輯器的使用說明寫「這一版沒有為手機設計」。台灣九成上網者最常用 LINE 傳訊息。已確認。
7. **排練工具也是常見功能：放慢、重複一段、預備拍。** UDBapp 有 Rehearsal Mode，Pyware Viewer 有 Repeat 和慢速。編輯器只有節拍器。已確認。
8. **使用說明有一處過時。** 第 1 章寫「還沒有：把站位整張移到別的時間」，但挪站位已經做了（commit `26b351b`）。已確認。

### 建議清單（照優先順序）

排序原則：價值高、工程小的排前面。工程大小的意思：

- **小**：只動流程核心的一個查詢或一個畫面元件，不改流程檔格式。
- **中**：要加欄位（流程檔升版），或要動好幾個元件。
- **大**：要新的畫面模式、新平台，或要碰影片編碼。

| # | 是什麼 | 為什麼教練需要 | 現在的狀況 | 工程 |
|---|---|---|---|---|
| 1 | **組別範本**：流程設定裡選組別（例如「國中團體 第 3 級 12–25 人」「ICU 世界賽 16–24 人」），帶入人數範圍和時間規則的數字；隊員人數不在範圍內就提醒。 | 每個組別的人數範圍都不同〔CTCA-R 第十二條〕；USASF 對人數不符扣 5.0 分〔USF-DED〕。規則警告的數字本來就要求教練每年自己改〔#15 第 37 條〕。 | 流程沒有組別欄位（`src/lib/core/flow.ts:13`），人數只有固定上限 40（`members.ts:12`）。時間規則可以改數字，但沒有範本（`time-rules.ts:14`）。 | 小（只有提醒）；要存進流程檔就是中 |
| 2 | **口號段位置檢查**：最後一段是口號段時提醒「口號要放在最前面或中間」。 | CTCA：口號流程要在「音樂流程實施前或中段部分」〔CTCA-S 十(一)〕。大專：「可置於流程的最前面或中間」〔CTUSF 十四〕。ICU 世界賽寫法相同〔ICU-WC25 V.A〕。 | `timeRuleWarnings` 只加總口號段的秒數，不看順序（`time-rules.ts:32-52`）。 | 小 |
| 3 | **用比賽的方式計時**：第一拍之前的音樂、最後一個八拍之後音樂還在響的時間都要算進去；另外可以設「預留緩衝秒數」。 | 計時從「流程第一個編排動作或音樂第一聲響」開始；動作和音樂取最晚結束的那個；規則「強烈建議…預留數秒時間緩衝」〔CTCA-S 十(三)(五)，CTUSF 十四(三)(五)〕。超時 5–10 秒，每位裁判扣 1 分。 | 音樂段從第一拍開始算，長度是半拍數乘拍長（`src/lib/core/time.ts:41-53`），播放也從第一拍開始（`playback.ts:50`）。音樂檔在第一拍前有前奏、或結尾有餘音，警告就會**低估**實際時間。推論。 | 小 |
| 4 | **參與度與組數統計**：在播放頭那一拍、或按大類整支流程，算出「技巧幾組（看上層有幾個）、幾位底層、幾人閒著」；騰翻、跳躍算幾個人一起做。 | 舞伴技巧的難度看「底層人數多寡、實施組數多寡」〔CTCA-S 十二，ICU-SS〕。USASF 按隊伍人數列出要幾組（例：18–22 人時 Majority 3 組、Most 4 組、Max 5 組）〔USF-RUB〕。 | 只有「閒」標示和「這一拍沒在動作裡的人」選人捷徑（`actions.ts:227`、`actions.ts:244`）。沒有組數或人數的統計。 | 小～中 |
| 5 | **排練工具：重複一段、預備拍**：選一段八拍重複播；開始前先響 1 個八拍的節拍器。 | UDBapp Pro 的 Rehearsal Mode 可以「slow the drill down, and add a count-in」〔UDB-PRO〕；Pyware Viewer 有 Repeat〔PY-VIEW〕。 | 播放只能從播放頭播到結尾（`playback.ts:38`）。節拍器已經有，排程的程式可以沿用。 | 小～中 |
| 6 | **個人八拍表的小站位圖標出自己**，可以再加上自己的走位線。 | FormationFlow 的 PDF 每位隊員有自己一頁，畫出自己的走位〔FF〕。隊員拿到個人八拍表，要在小站位圖上找到自己。推論。 | 小站位圖沒有傳 `selected`（`PrintSheet.svelte:83`）。`Field` 元件本來就支援 `selected`（`Field.svelte:47`）。 | 小 |
| 7 | **使用說明更新**：拿掉「還沒有：把站位整張移到別的時間」，補上挪站位的說明。 | 說明寫錯，教練會以為做不到。 | `src/routes/guide/+page.svelte:108`；說明裡沒有「挪站位」這個詞。 | 小 |
| 8 | **按級別的任務角色人數提醒**：拋投、技巧、搖籃式抱接時，算有幾位底層、接者、保護、後保，對照該級的規定。規則見第 2.2 節。可以加一個可有可無的「高度」欄位（地面／腰／肩／延伸），讓「肩部以上每位上層要 1 位保護」這類規則也能查。 | 這類規則是任務角色數一數就能判斷的，見第 2.2 節。USASF 對「少了合法需要的人數（例如搖籃式抱接的接者不夠）」扣 0.5 分〔USF-DED〕。 | 第一版刻意不做規則合法性檢查〔#15 Out of Scope〕。任務角色已經有 11 個（`roles.ts:25`），每人每個動作最多一個。動作沒有高度。 | 中 |
| 9 | **刪段、調換段的順序、調換隊員名單的順序**。 | Pyware 的 Count Track「任何位置都能增刪 counts」〔PY-3D〕。教練改歌、換口號位置時需要。推論。 | 只能在最後加段（`segment.ts:208`）；ADR 0003 定為第一版不做；使用說明也寫還沒有。 | 中 |
| 10 | **隊員手機唯讀檢視**：手機打開流程檔，只播放、看自己的走位和拍點，不能改。 | 競品幾乎都有：CheerCraft 的 Read-Only mode、Pyware Viewer、UDBapp、Choreographic 的 view 權限〔CC、PY-VIEW、UDB-PRO、CHG〕。18–29 歲上網率 100%，LINE 是 90.26% 上網者最常用的通訊軟體〔TWNIC〕，教練傳流程檔多半用 LINE。 | 使用說明：「這一版沒有為手機設計，手機畫面太小」（`guide/+page.svelte:105`）。唯讀模式在 #15 列為不做。 | 大 |
| 11 | **站位備註**：每張站位寫一段話，印在八拍表上。 | ArrangeUs 可以在每個站位留 comments，Choreographic 每個站位可以加 notes〔AU、CHG〕。 | 站位只有名稱（流程檔第 4 版），動作才有備註。 | 小～中（流程檔要升版） |
| 12 | **沿用別的流程的名單**：新建流程時從另一個流程檔匯入隊員。 | Choreographic 的 Crews 是可以重複用的名單；Pyware 可以匯入、匯出 cast list〔CHG、PY-3D〕。 | 只能在名單一行打一個名字（`MemberPanel.svelte:119`）。 | 小 |
| 13 | **慢速播放（不變調）**。 | 同 #5〔UDB-PRO、PY-VIEW〕。 | 用 `AudioBufferSourceNode` 播（`src/lib/audio/engine.ts:45`）。它的 `playbackRate` 是重新取樣，調慢就會變調〔MDN-ABS〕。要不變調，得改用 `HTMLMediaElement`，它的 `preservesPitch` 預設是 true〔MDN-PP〕。延遲校正也要重新驗證。 | 中 |
| 14 | **匯出影片**（場地動畫加音樂）。 | Choreographic 可匯出 720p／1080p／4K MP4；タチイチ、Pyware 也能匯出〔CHG、TACHI、PY-3DX〕。隊員用手機看影片，不需要另外裝任何東西。推論。 | #15 和地圖 #1 都列為不做：「太花工」。 | 中～大 |
| 15 | **站位排列工具**：等距、左右對稱、整組翻轉或旋轉、常用站位範本。 | Choreographic 有 presets 和翻轉；タチイチ有等距、對稱；Pyware 有 Morph、Push〔CHG、TACHI、PY-MOB〕。 | 只有吸附和整組拖（#15 第 66–67 條）。 | 中 |
| 16 | **走位碰撞、騰翻穿越提醒**：兩人的走位線交叉、同時到同一點；騰翻的走位線穿過其他隊員。 | Pyware Virtual Clinic 會「Checks and warns for … collisions」〔PY-3D〕。CTCA 第一級：騰翻「禁止自上、下或中間穿越任何 1 組技巧、隊員或道具」〔CTCA-S 第一級 一(二)〕。 | 只檢查走太快、很喘（`formation.ts:275-278`）。這兩個數字還沒跟教練確認過。 | 中 |
| 17 | **影片對照**：載入練習影片，跟流程同步播放。 | 只在第三方新聞看到 StageKeep 有這個功能，官方頁沒找到。未確認。 | 沒有。 | 大 |
| 18 | **出席與換人**：標記今天誰沒來，看哪些動作受影響。 | UDBapp 有 Live Attendance；CheerCraft 能管理 alternates（候補）〔UDB、CC〕。 | 候補不放進流程，換人就改名字（#13、`GLOSSARY.md`「隊員」）。 | 中 |
| 19 | **多版本比較**。 | 沒找到任何工具有這個功能。教練需不需要也查不到。未確認。 | 只有復原和重做，而且重新整理就清掉。 | 中 |
| 20 | **3D、曲線走位**。 | CheerCraft 有 3D 和高度；Choreographic 有曲線走位〔CC、CHG〕。 | 刻意不做：彎的走位用多插一張站位處理（`formation-walk-design.md`「不做的」）。 | 大，價值低 |

前 7 項都是小工程，而且不用改流程檔格式（#1 若只提醒不存，也一樣）。第 8 項要加高度欄位，是讓規則提醒真正有用的關鍵。

## 1. 編輯器現在有什麼

先列出已經有的，下面各節才不會把它們算成缺口。

- **時間**：音樂段、口號段、八拍尺、波形對第一拍、節拍器、延遲校正。另有三條時間規則警告：口號段少於 30 秒、音樂段超過 120 秒、整支流程超過 180 秒，數字可改，也可以關掉（`time-rules.ts`）。
- **隊員**：最多 40 人；有性別、全局角色和標記。一次可以加多人，一行一個。
- **動作**：分 7 個大類，有 11 個固定任務角色，也可以自訂。每人同一時間只能在一個動作裡。有辨識色、拍點（拍子、步驟、手位）、「閒」標示，以及選人捷徑。
- **站位**：吸附接縫和格線。有影子、走位線、出發和到達。走太快標紅、很喘標橘，也可以只看紅線和橘線。有跟上一張一樣、往後帶、挪站位、站位名稱。
- **檔案**：流程檔 zip 裡有音樂；草稿自動存；可離線；有復原和重做，最多 100 步。
- **八拍表**：可以印全隊或印一個人。個人表寫走位和拍點，附小站位圖。

所有 issue（#1–#47）都已關閉。第一版刻意不做的事列在 #15 的 Out of Scope：規則合法性檢查、帳號與雲端、換場地、匯出影片、唯讀模式、候補、組、自訂大類、面向、翻轉場地、進場和退場。

## 2. 規則與安全檢查

### 2.1 時間、口號、人數（台灣）

**CTCA 2025 安全規則**〔CTCA-S〕第十條（已確認）：

> 團體組音樂流程為 2 分鐘以內，並需於音樂流程實施前或中段部分實施至少 30 秒之口號流程，整體比賽流程不得超過 3 分鐘。

> (三) 競賽時間起始認定為流程第一個編排動作或音樂第一聲響；無論是流程編排最後一個動作或音樂聲響停止點，最終出現者即認定流程結束。

> (五) 由於超時罰則嚴厲，強烈建議各參賽隊伍仔細衡量流程編排長度，並預留數秒時間緩衝以備不同音樂播放設備差異產生之播放時間誤差。

超時罰則：音樂流程超時 5–10 秒，每位裁判扣總平均 1 分；超時 11–30 秒，扣 3 分。整段流程超時也一樣。進場、退場各限 20 秒，但幼兒組（L1）、國小組（L2）不受限制。

**大專 CTUSF 規則**〔CTUSF〕第十四條（已確認）：

> (1) 總流程：3 分鐘為限，需包含口號與音樂流程，中間不停秒。(2) 口號：可置於流程的最前面或中間，時間最少 30 秒。(3) 音樂流程：2 分鐘為限。

**CTCA 2025 規程**〔CTCA-R〕第十二條，組別表（已確認，節錄）：

| 組別 | 人數 | 採用規則 |
|---|---|---|
| 幼兒團體 | 12–25 人 | 第 1 級 |
| 國小團體 | 12–25 人 | 第 2 級 |
| 國中團體 | 12–25 人 | 第 3 級 |
| 高中團體（女生組 12–25；混合組、混合公開組 12–24） | 12–24 或 12–25 人 | 第 4 級；混合公開組第 5 級 |
| 大專團體 | 12–20 人 | 第 5 級或第 6 級 |
| 公開團體 | 12–24 人；混合超級組 16–24 人 | 第 3–6 級 |
| 多底技巧 | 4 或 5 人；混合組 4 人 | 照團體組，「本組不得實施單底層技術」 |
| 單底技巧 | 2 人 | 照團體組 |
| 金字塔 | 9 人 | 照團體組，1 分 30 秒 |

小組的時間都是 60 秒。團體組的時間寫在同一張表裡：口號至少 30 秒，音樂 2 分鐘，總流程 3 分鐘，進退場各 20 秒。

對編輯器的意思：

- 「口號段加總至少 30 秒」只對了一半，規則還要求口號在**最前面或中間**。口號段排在最後一段，現在不會被提醒。
- 30 秒是「一個口號段至少 30 秒」，還是「口號段加總至少 30 秒」？原文都寫「口號流程…至少 30 秒」，只講一個口號流程。拆成兩個口號段算不算數，**未確認**。現在的程式是加總。
- **推論**：音樂檔在第一拍前有前奏、或最後一個八拍後還有餘音時，比賽的計時會比編輯器算的長。最直接的做法是把「第一拍前的秒數」和「音樂檔剩下的秒數」也算進去。另一個做法是讓教練設「緩衝秒數」，規則本身就建議預留。
- 規則要求流程中不能換人：「比賽選手在流程開始實施後，自始自終都必須是同一批選手」〔CTCA-S 九(十七)〕。這跟編輯器「候補不放進流程」的設計一致。
- **場地外不能當成違規來提醒**：CTCA 第十一條寫「無出界罰則」。騰翻規定的「位於表演場地面」意思是要在地面上，不是要在場地範圍內。

### 2.2 各級規則裡哪些可以從任務角色檢查

CTCA 規則自述「參考 ICU 國際啦啦隊聯盟之規章訂定」〔CTCA-S 一(一)〕，結構和 ICU 一樣：每級分騰翻、技巧、金字塔、著落、拋投。下表把條文分成三種：

- **能查**：只用編輯器現有的資料就能判斷，也就是大類、任務角色、人數、走位。
- **加高度就能查**：動作要多一個高度欄位。
- **查不了**：需要動作名稱、旋轉圈數或身體姿勢。

| 規則（CTCA 2025，已確認） | 級別 | 分類 | 編輯器怎麼查（推論） |
|---|---|---|---|
| 「禁止實施籃型拋投」 | 第 1 級 | 能查 | 第 1 級的流程裡有大類「拋投」的動作就提醒。 |
| 「最多得由 4 位拋投底層實施籃型拋投，且其中 1 位須安排於上層背面」 | 第 2–4 級（第 5 級以上類似） | 能查 | 拋投動作裡，底層、主底、側底、後保合計超過 4 位，或沒有後保，就提醒。 |
| 「上層必須至少被 3 位原底層人員搖籃式抱接」 | 第 2–4 級 | 部分能查 | 拋投動作裡，底層少於 3 位就提醒。是不是「原」底層查不了。 |
| 「拋投動作實施過程中，底層須保持於實施位置…禁止有移位意圖」 | 第 2–4 級 | 能查 | 拋投動作的時間內，參加的人有走位就提醒。 |
| 「單底層實施搖籃式抱接須安排 1 位接者與 1 位保護人員」；「多底層…須安排 2 位接者與 1 位保護人員」 | 各級 | 部分能查 | 動作要能標「有搖籃式抱接」，例如拍點的步驟「落地」，才知道什麼時候查。 |
| 「實施單底層多上層動作時，每位上層必須個別安排 1 位保護人員」 | 第 3 級以上 | 能查 | 技巧動作裡只有 1 位底層、上層超過 1 位時，保護的人數要不少於上層的人數。 |
| 「所有肩部或肩部以上高度之技巧動作，其個別上層均須安排 1 位保護人員」 | 第 1、2 級（第 3 級以上是「肩部以上」） | 加高度就能查 | 動作有高度後，比對保護的人數和上層的人數。 |
| 「得實施至 2.5 段高度金字塔」；第 6 級「最高得實施 3 層 2.5 段」 | 各級 | 加高度就能查 | 要知道金字塔有幾層。中層這個任務角色已經有了。 |
| 「3 層 2.5 段金字塔動作中，每 1 位 3 層隊員必須於地面安排 2 位保護人員」 | 第 6 級 | 部分能查 | 要先知道誰是第 3 層。 |
| 騰翻「禁止自上、下或中間穿越任何 1 組技巧、隊員或道具」 | 第 1 級等 | 能查（幾何） | 騰翻動作期間，騰翻的人的走位線穿過別人的位置就提醒。 |
| 旋轉圈數、空翻、倒置、離手、延伸單足 | 各級 | 查不了 | 要有結構化的動作名稱或技術資料庫。 |

ICU 2027 規則和 USASF 2026-27 規則也有同類條文，原文已確認：

- ICU 和 USASF 都規定拋投最多 4 位拋投底層、1 位在背後，至少 3 位原底層接，一次只能拋 1 位上層。
- 多底層搖籃式抱接要 2 位接者加 1 位保護。
- USASF 第 1 級：保護「Required for prep level and above; Floor stunts」。
- ICU Beginner 和 Novice：「Tosses are not allowed」。

〔ICU-R27、USF-R〕

**一個人不能同時算底層和必要的保護**：ICU、USASF 名詞表的 Spotter 條都寫「may not be considered both a base and the required spotter at the same time」〔ICU-G、USF-R〕。編輯器本來就規定一個人在一個動作裡最多一個任務角色，所以這條已經做到了。

### 2.3 級別對照要小心

先前的筆記（`assist.md`、`bases.md`）把 CTCA 第 1–6 級對到 ICU 的 Novice 到 Premier。ICU 現在共有 9 級：Introductory、Beginner、Novice、Intermediate、Median、Advanced、Elite、Select、Premier。ICU 2027 規則寫的對照是：

- Novice「equivalent to L1」
- Elite「equivalent to L5/L6」
- Premier「equivalent to L7」

〔ICU-R27〕。所以 CTCA 第 6 級（＝ICU Premier）對到 USASF 是第 7 級，不是第 6 級。已確認。CTCA 規程的公開組寫「All Girl Premier Lv.6」，用的是 CTCA 自己的級數〔CTCA-R〕。

**推論**：組別範本只能存 CTCA 的級數，不能拿 USASF 的級數直接套。

### 2.4 編輯器只能提醒，不能保證合法

各協會都要求用影片判定，原文已確認：

- **USASF**：Coach App 的判定「valid only if the skill is performed exactly the same in the video as it is at the sanctioned competition」，而且整支流程的影片不予判定〔USF-APP〕。
- **IASF**：「Rulings are based on the skill as performed in the video and are not a guarantee of legality」〔IASF-VID〕。
- **ICU**：「it is recommended to send a video copy of any skill of question to cheer.rules@cheerunion.org」〔ICU-CWC26〕。
- **CTCA**：「請將您實施之技術動作拍攝成影片，並寄至 ctcajudge@gmail.com…最遲於領隊會議召開前一日寄達」〔CTCA-S 十七(二)〕。

**推論**：提醒的文字要寫「可能違反第 N 級規定，請對照規則」，不能寫「合法」或「通過」。規則數字每年會改，要像時間規則一樣可以關掉。

**授權**：USASF 規則封面寫「may not be disseminated to non-USASF members … may not … post on any website」〔USF-R〕。所以編輯器不宜收錄 USASF 條文全文。CTCA 規則能不能轉載，**未確認**。

## 3. 評分表能怎麼幫教練對照

### 3.1 CTCA 與 ICU：七個項目，看組數和底層人數

CTCA 2025 團體組評分〔CTCA-S 十二〕，100 分（已確認）：

| 項目 | 第 1 級 | 第 2、3 級 | 第 4–6 級 | 評分標準摘要 |
|---|---|---|---|---|
| 口號 | 10 | 10 | 10 | 帶領群眾；「實際應用技巧或金字塔等技術動作的實施帶領群眾情緒的能力」 |
| 舞伴技巧 | 25 | 25 | 25 | 「難度（技術難度等級、底層人數多寡、實施組數多寡）、實施同步性、變化多樣性」 |
| 金字塔 | 25 | 25 | 25 | 難度、轉接、完整性、節奏、創意 |
| 籃型拋投 | 無 | 10 | 15 | 完整性、高度、同步性、難度、變化 |
| 騰翻動作 | 10 | 10 | 10 | 「團體騰翻」、同步性 |
| 流暢度與轉接過程 | 15 | 10 | 5 | 流暢度、節奏、轉接 |
| 整體流程內容呈現、群眾感染力 | 15 | 10 | 10 | 展現力、舞蹈、觀眾反應 |

ICU 計分表〔ICU-SS〕的項目和配分跟上表一樣。Stunts 一項寫「Difficulty (Level of Skills, Number of Bases, Number of Stunt Groups), Synchronization」。ICU 計分表沒有百分比式的人數門檻。已確認。

### 3.2 USASF／IASF：直接列出要幾組、幾人

United Scoring System 2026-27 的 Level 1–5 評分細則〔USF-RUB〕（已確認）：

| 隊伍人數 | 技巧與金字塔要幾組：Majority／Most／Max | 騰翻與跳躍要幾人：Majority／Most／Max |
|---|---|---|
| 5–11 | 1／2／3 | 5／6／10 |
| 12–17 | 2／3／4 | 6／7／12 |
| 18–22 | 3／4／5 | 9／10／18 |
| 23–30 | 4／5／6 | 11／12／22 |
| 31–38 | 5／6／7 | 15／16／30 |

其他相關條文（已確認）：

- Stunt 3.0 分：「4 different level appropriate skills performed by MOST of the team at the same time … without recycling athletes」。
- Toss：「MAJORITY of the team performs a level appropriate toss」。
- Execution：「Teams that do not perform at least 1 level appropriate skill transition by 2 or more groups in Stunts and Pyramids will automatically receive .3 off for Synchronization」〔USF-EXE〕。
- Formations & Transitions：每一個不精準的站位或轉換扣 0.1〔USF-OVR〕。

### 3.3 編輯器能做什麼（推論）

- **組數**：編輯器刻意沒有「組」（#15）。但技巧動作裡每位上層大致就是一組，所以「同一時刻在技巧動作裡當上層的人數」可以當成組數。多上層的單底層技巧是例外。
- **人數**：同一時刻在騰翻或跳躍動作裡的人數，加上「閒」的人數，都能從現有資料算出來（`actions.ts:210-250`）。
- **呈現方式**：在播放頭那一拍顯示「技巧 4 組・底層 12 位・閒 2 人」，或做一張表，按大類列出每個動作的組數和人數。
- **不要算分**：評分是裁判的主觀判斷，各協會的定義也不同。只給數字，讓教練自己對照評分表。

## 4. 同類工具有、我們沒有的

讀過官方頁的工具如下。功能只列官方頁上寫的。

| 工具 | 平台 | 跟我們最相關的功能 | 來源 | 可信度 |
|---|---|---|---|---|
| CheerCraft – Choreo & Cheer（啦啦隊專用） | iPhone、iPad、Mac、Android | 跟音樂時間軸走的八拍表，可匯出 PDF、Excel；3D 檢視；每位隊員可設 Waist／Prep／Extended 高度；Read-Only mode 讓隊員在自己的裝置上看；Read & Write 讓教練們共編；管理 alternates；音樂和圖片可離線（v1.6.2） | 〔CC〕 | 已確認 |
| FormationFlow（啦啦隊專用） | iPhone、iPad、Mac | 中途點做出彎的走位，可在點上停留；角色分 Base、Flyer、Spotter、Backspot、Tumbler；PDF 每個站位一頁並畫出走位，v1.1.1 加了每位隊員自己的頁；不用帳號，資料只存在裝置上；沒提到音樂 | 〔FF〕 | 已確認 |
| CS 8-Count Sheet Creator（啦啦隊專用） | iPhone、iPad、Mac | 八拍表加上有顏色的段和標記（Clean、Dip、Toss），可匯出 Excel | 〔CS8〕 | 已確認 |
| Choreographic（舞蹈） | iPhone、iPad、Mac；Web 版在 beta | 對波形對拍；即時共編並設 view／edit 權限；匯出 720p／1080p／4K MP4；3D；彎的走位；道具；站位範本和翻轉；可重複用的名單（Crews）；站位 notes | 〔CHG〕 | 已確認 |
| ArrangeUs（舞蹈） | iOS、Android | 每個站位留 comments、自訂場地大小、對音樂、範本、復原 | 〔AU〕 | 已確認 |
| StageKeep（網頁） | Web | 站位對音樂；團隊留言；管理排練；用途有寫 cheerleading | 〔SK〕 | 已確認；「上傳影片並標注」只在第三方新聞看到，未確認 |
| Pyware 3D／3DX（行進樂隊） | Windows、macOS、iOS、Android | Count Track 任意增刪 counts；Virtual Clinic 檢查步距、碰撞、急轉；彎的走位；道具；列印和 PDF；Video Capture；Portal 推送更新到隊員手機 | 〔PY-3D、PY-3DX〕 | 已確認 |
| Pyware Viewer（隊員用） | iOS、Android | 切換整隊或個人視角、Spotlight 單一個人、最高 8 倍速、Repeat、停在任一 count；掃 QR code 載入，一鍵更新到最新版 | 〔PY-VIEW〕 | 已確認 |
| UDBapp／UDBapp Pro（行進樂隊，隊員用） | iOS、iPadOS、Mac | 個人座標表；Rehearsal Mode：「Swap out your show audio with a metronome, slow the drill down, and add a count-in」；loop；Field Notes 在場地上手寫註記並分享；Live Attendance 點名 | 〔UDB、UDB-PRO〕 | 已確認 |
| タチイチ（日本舞蹈站位） | iPhone、iPad | 匯出帶音樂的 MP4；A4 PDF；等距、左右對稱；離線、不用帳號 | 〔TACHI〕 | 已確認 |

ArrangeUs 官網 `arrangeus.com` 現在是網域待售的頁面，所以改看商店頁。

**我們有、它們大多沒有的**：

- 拍點：拍子、步驟、手位逐拍寫
- 有接縫的 9 條或 5 條場地
- 比賽時間規則警告
- 單一個流程檔裡帶著音樂

CheerCraft 也有每位隊員各自的出發和到達。（已確認，比對各官方頁）

**它們有、我們沒有的**（對應建議清單的編號）：

- 隊員手機唯讀檢視（#10）
- 排練工具：慢速、重複、預備拍（#5、#13）
- 匯出影片（#14）
- 站位註記（#11）
- 名單跨流程重用（#12）
- 排列工具（#15）
- 碰撞檢查（#16）
- 出席（#18）
- 任意增刪段（#9）
- 3D 和高度（#8、#20）
- 雲端共編、推送更新：跟「不登入、沒有伺服器」的前提衝突，不列入建議

## 5. 練習時的需求

這一節的需求多半找不到教練自己寫的一手資料。能找到的證據只有兩種：工具有做這個功能，以及官方統計。

- **分享給隊員**：
  - 已確認：LINE 是台灣 80.10% 民眾（上網者中 90.26%）最常用的即時通訊軟體；18–29 歲上網率 100%；18 歲以上的行動寬頻普及率 87.12%〔TWNIC〕。
  - 18 歲以下沒有數字：2025 年報告只調查 18 歲以上，國高中隊員的手機使用率**未確認**。
  - **推論**：教練用 LINE 傳流程檔，隊員多半在手機上收到，可是編輯器沒有為手機設計，中間有落差。
- **計時**：規則建議預留緩衝（見 2.1）。建議 #3。已確認。
- **影片對照**：教練要拿練習影片和流程比對，沒有一手資料。只知道各協會都用影片判定合法性（見 2.4），所以教練手上本來就有練習影片。需求本身**未確認**。
- **出席與換人**：UDBapp 有點名，CheerCraft 能管候補（已確認，是工具有這個功能）。台灣教練需不需要，**未確認**。
- **多版本比較**：沒找到工具做，也沒找到需求來源。**未確認**。
- **放慢、重複、預備拍**：只有工具證據（UDBapp、Pyware Viewer），已確認。啦啦隊教練練習時用不用，**未確認**。

## 6. 查不到或沒查清楚的

- 口號 30 秒是「單一個口號段」還是「加總」，規則沒寫清楚。
- 第一拍之前的前奏算不算時間：規則寫「音樂第一聲響」，所以要算。但前奏多長、隊伍通常剪成什麼樣子，查不到。
- 口號放在中間時，音樂怎麼處理：是剪成兩個檔，還是同一個檔中間留靜音？規則只寫要有人負責播放和停止音樂〔CTCA-S 十(六)〕。實務做法**未確認**。這會影響編輯器要不要提供「接成一個比賽用的音樂檔」。
- CTCA 2026 年以後的規則，以及級數會不會變：本次只讀到 2025 版。
- ICU 2026、2027 年世界賽（國家隊）的規則手冊：沒找到。用的是 2025 世界賽和 2026 Cheerleading World Cup 的規定。
- ICU 舊版連結 `cheerunion.eu` 的 2025 規則，TLS 失敗沒讀到，改讀 cheerunion.org 上的 2027 版。
- 走太快（4 m/s）、很喘（2.5 m/s）這兩個數字，程式註解寫「是猜的」，沒找到可信來源。
- StageKeep 的影片標注、ArrangeUs 的道具：只有第三方說法。
- 台灣教練實際怎麼用影片、怎麼點名、要不要比較版本：沒有書面一手資料，要直接問教練。

## 來源

台灣規則（已確認，本次重新下載）：

- 〔CTCA-S〕CTCA 2025 全國賽 競技啦啦隊 安全規則 Ver.2（SHA-1 `bf2c2761…`，與先前副本相同）：https://irp.cdn-website.com/09735818/files/uploaded/2025%E5%85%A8%E5%9C%8B%E5%95%A6%E5%95%A6%E9%9A%8A%E9%8C%A6%E6%A8%99%E8%B3%BD-%E7%AB%B6%E6%8A%80%E5%95%A6%E5%95%A6%E9%9A%8A-%E5%AE%89%E5%85%A8%E8%A6%8F%E5%89%87Ver.2.pdf
- 〔CTCA-R〕CTCA 2025 全國賽暨 114 學年度中學賽 競賽規程 Ver.3：https://irp.cdn-website.com/09735818/files/uploaded/2025%E5%85%A8%E5%9C%8B%E5%95%A6%E5%95%A6%E9%9A%8A%E9%8C%A6%E6%A8%99%E8%B3%BD%E6%9A%A8114%E5%AD%B8%E5%B9%B4%E5%BA%A6%E4%B8%AD%E5%AD%B8%E8%B3%BD%E7%AB%B6%E8%B3%BD%E8%A6%8F%E7%A8%8BVer.3.pdf
- 〔CTUSF〕中華民國大專校院啦啦隊競賽規則：https://ctusf.org.tw/upload/news/20260625104854_2.pdf

ICU（已確認，cheerunion.org）：

- 〔ICU-SS〕計分表頁：https://cheerunion.org/education-schedule/scoresheets/ ，例如 https://cheerunion.org/content/uploads/2024/02/ICU_Scoresheet_Adv-Prem.pdf（檔案日期 2024/02）
- 〔ICU-R27〕ICU 2027 Rules：https://cheerunion.org/content/uploads/2026/09/icu_2027_rules_ch-pc.pdf
- 〔ICU-WC25〕ICU World Championships 2025 Rules：https://cheerunion.org/content/uploads/2024/09/ICU_WC_2025_Rules.pdf
- 〔ICU-CWC26〕Cheerleading World Cup 2026 Rules & Regulations：https://cheerunion.org/content/uploads/2026/09/icu_cwc_26_rules-regs.pdf
- 〔ICU-G〕ICU 名詞表：https://cheerunion.org/cheerleading-glossary/

USASF、IASF（已確認）：

- 〔USF-R〕USASF Cheer Rules 2026-27：https://www.usasf.net/files/CheerRules-9.8.26.pdf
- 〔USF-RUB〕United Scoring Rubric Level 1–5（VERSION 10.15.26）：https://www.unitedscoringpartners.com/wp-content/uploads/2026/10/26-27-United-Scoring-Rubric-Level-1-5-Tiny-Mini-Youth-Junior-Senior-excluding-Coed.pdf ；文件總頁：https://www.unitedscoringpartners.com/united-states/
- 〔USF-EXE〕United Scoring Execution：https://www.unitedscoringpartners.com/wp-content/uploads/2026/10/26-27-United-Scoring-Execution.pdf
- 〔USF-OVR〕United Scoring Overall：https://www.unitedscoringpartners.com/wp-content/uploads/2026/10/26-27-United-Scoring-Overall.pdf
- 〔USF-DED〕Deduction System：https://www.unitedscoringpartners.com/wp-content/uploads/2026/10/Deduction-System.pdf
- 〔USF-APP〕USASF Coach App：https://resources.usasfmembers.net/rules/coach-app/
- 〔IASF-VID〕IASF Video Ruling Request：https://www.iasfworlds.net/wp-content/uploads/2023/11/IASF_Cheer_VIDEO-RULING-REQUEST.pdf

同類工具（已確認，除非另外標註）：

- 〔CC〕CheerCraft：https://apps.apple.com/app/id6761829240 、https://play.google.com/store/apps/details?id=com.lexsoftware.cheercraft
- 〔FF〕FormationFlow：https://apps.apple.com/us/app/formationflow/id6759989262
- 〔CS8〕CS 8-Count Sheet Creator：https://apps.apple.com/us/app/cs-8-count-sheet-creator/id1512316474
- 〔CHG〕Choreographic：https://choreographic.app 、https://apps.apple.com/us/app/choreographic-dance-formation/id1608391996
- 〔AU〕ArrangeUs：https://apps.apple.com/us/app/arrangeus/id1502182540 、https://play.google.com/store/apps/details?id=com.AndriyStefanchuk.ArrangeUs.main
- 〔SK〕StageKeep：https://www.stagekeep.com 、https://www.stagekeep.com/how-to-create-formations/
- 〔PY-3D〕Pyware 3D：https://www.pyware.com/3d/ ；〔PY-3DX〕https://www.pyware.com/3dx/ ；〔PY-VIEW〕https://www.pyware.com/viewer-app/ ；〔PY-MOB〕https://www.pyware.com/mobile-editor/
- 〔UDB〕Ultimate Drill Book：https://www.ultimatedrillbook.com/udbapp/ ；〔UDB-PRO〕https://apps.apple.com/us/app/udbapp-pro/id1455826724
- 〔TACHI〕タチイチ：https://apps.apple.com/jp/app/id6795413042

瀏覽器與統計（已確認）：

- 〔MDN-ABS〕AudioBufferSourceNode.playbackRate：https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/playbackRate 。原文寫「the AudioBufferSourceNode resamples the audio」；「所以會變調」是推論。
- 〔MDN-PP〕HTMLMediaElement.preservesPitch：https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch 。預設 true，Baseline Widely available。
- 〔TWNIC〕2025 台灣網路報告摘要：https://report.twnic.tw/2025/en/assets/download/TWNIC_TaiwanInternetReport_2025_CH_summary.pdf

查核限制：

- ICU、USASF、IASF 的文件由另一個研究流程下載並逐條讀過。本次抽查了以下幾項，原文都相符：
  - 人數對照表
  - ICU 世界賽「Minimum 16 athletes, maximum 24 athletes」與口號位置
  - ICU 計分表的「Number of Bases, Number of Stunt Groups」
  - Coach App 的「valid only if」
  - CheerCraft 與 UDBapp Pro 商店頁
- 讀不到的頁面：
  - `arrangeus.com`：網域待售
  - `cheercraft.app`：只有網頁 app 外殼
  - Choreographic FAQ：答案沒有渲染出來
  - UDB 說明中心：DNS 錯誤
  - Steppy by StageKeep 的 App Store 頁：404
- 「查無」都指「在上述來源中查無」，不是所有賽事規則的完整檢查。
