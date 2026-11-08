# 第四輪實測的 62 個問題：照根本原因修，讓同類問題不再出現

研究紀錄，查核日期 2026-11-08。

- 問題來源：#233 第四輪瀏覽器實測，報告貼在 #196。編號 N01–N62 照那份報告。
- 程式碼看的是 `spec-196` @ 61ef215，只讀，沒有改。
- 一手來源的英文原文照抄，附網址。

標記方式：

- **已確認**：讀過程式碼，或有一手來源的原文。
- **推測**：照程式碼或文件推出來的，沒有實際跑過。
- **查不到**：一手來源裡沒找到。

## 結論

**62 個問題大多不是 62 個 bug，而是 11 種「少了一個集中的地方」。**

每一類都在好幾個元件裡各自手寫，漏掉一個地方就多一個 bug。所以每類都要做兩件事：

1. **一個集中機制**：讓同類的 bug 寫不出來。
2. **一個自動守門**：測試或版面檢查，讓 bug 不會再回來。

大廠的一手做法歸納成三條原則：

1. **「正在打字」是一種要登記的狀態。**
   - 存檔或關閉時，由一個中央的地方統一送出（commit）或丟掉（discard）。
   - **自動存檔是例外，不送出。** Apple NSDocument 的寫法就是這樣。[AppKit RN]
2. **被浮動元件蓋住的區域，要告訴捲動系統。**
   - 不要讓每個元件自己想辦法閃開。
   - Web 用 `scroll-padding`；iOS 用 safe area 或 `additionalSafeAreaInsets`。[C43][CSS-SNAP][UIKit SA]
3. **常見又能復原的動作，不要跳確認框。**
   - 做完給「已做了什麼・復原」的提示，提示裡寫清楚動作名稱。[HIG Alerts][HIG Undo]

現在已有的守門，以及缺的東西：

- `npm test`：已確認。用 vitest，分 core（node）和 components（jsdom）兩組，**沒有 setup 檔**。
- `npm run check:layout`：已確認。共 100 條，頁面丟例外算失敗；**console 警告不算**。
- property test 的工具（例如 fast-check）：沒有裝。
- 現在的守門只檢查「指令有沒有被擋」，**不檢查「畫面上看起來能不能用」**。
  - 例 1：檢視模式下，按鈕還在畫面上，按到最後一步才被擋。
  - 例 2：欄位存在，但被別的元件蓋住，看不到。

## 已做的決定（2026-11-08，使用者）

1. **B 群：推翻 ADR 0006 的「紀錄救不回來」。** 復原時，這一步清掉的練習紀錄要一起回來，重做時再清一次。要寫新的 ADR。
2. **C 群：場地固定留一條給選人工具列。** 工具列出不出現，場地都不跳，也不會蓋到人和條號。代價是場地小約 40px。
3. **I 群：手機號碼太小，先把兩種做法（太小就不畫、另疊一層 HTML）做成截圖比較，再決定。**

## 建議順序

| 順序 | 群 | 修好哪些 | 大小 | 要先決定的事 |
|---|---|---|---|---|
| 1 | A 打字中和送出（第 1–4 步） | N01、N06、N12、N08、N34 | S | 沒有 |
| 1 | G 鍵盤路由 | N22、N18、N06 | S | 沒有 |
| 1 | K 開發警告當失敗 | N16、N17，並防止以後再出現 | S | 沒有 |
| 2 | D 檢視模式 | N04，並防止以後再出現 | S–M | 編輯控制項要藏起來還是停用（見 D） |
| 2 | C 浮動元件蓋住東西 | N03（故事 67、68）、N05、N23、N24、N52 | M | 場地要不要固定留一條給工具列 |
| 2 | E 畫面狀態的壽命 | N07、N30、N43 | S–M | 沒有 |
| 3 | B 復原沒有整個還原 | N02、N25、N26 | M | **要推翻 ADR 0006 的一部分嗎** |
| 3 | F 做完沒提示 | N21、N46、N62、N19 | M | 沒有 |
| 4 | H 幾何誤差 | N44、N31、N10 | 各 S | 沒有 |
| 4 | I 字太小、對比不夠 | N15、N50、N41、N35、N42 | M | 手機上號碼太小時要放大、還是不畫 |
| 4 | J 使用說明跟畫面不同步 | N61、N53、N54 | S＋M | 沒有 |
| — | L 其他單點 | N11、N13、N14 等 | 各 S | N14 要產品決定 |

---

## A. 打到一半的字被當成送出

**問題：** N01、N06、N12、N33、N34、N08、N20

### 現在怎麼運作（已確認）

- **N01**：停手 1 秒會存草稿（`flow-file.svelte.ts:483`）。
  - `#saveDraftNow()` 在 `:492` 先呼叫 `pendingInput.flush()`。
  - flush 在 `pending-input.ts:104-109`：對有焦點的欄位發 `change`，等於幫使用者按了送出。
  - 切到背景的 `pageHidden()`（`:527`）也一樣。
- **N06**：按 Esc 會讓號碼框被拆掉（`MemberPanel.svelte:157-161`）。
  - Chrome 拆掉有焦點的欄位時，會發 change。`pending-input.ts:32-33` 的註解記下了這件事。
  - 這個 change 呼叫了 `renumber`，所以號碼被套用。
- **N12**：「未存」由 `editor.svelte.ts:118` 的 `hasUnsavedWork` 決定。
  - 只要任何文字欄打了字就算「未存」。
  - 跳時間的框不是在改流程，也被算進去。
- **N34（推測）**：
  - 打回原本的值時，`pending-input.ts:85-91` 吞掉了 change。
  - 紅字只在送出成功、或元件呼叫 `ask.edited()` 時收掉（`ask.svelte.ts:95-98`、`:111-113`）。
  - 全 repo 只有兩處呼叫 `edited`，所以紅字留著。
- **N08**：字數上限有兩套規則。
  - 畫面上的 `CharCount.svelte:41` 允許舊檔超過上限。
  - 核心的 `tooLong`（`text-length.ts:52`、`members.ts:228`、`actions.ts:185-190`）只看新的字。
- **N20（推測，很可能）**：
  - `action-draft.svelte.ts:338` 用「動作不見了，又剛好是剛新增的那個」來猜「這是復原」。
  - 刪掉剛新增的動作也符合這個條件，於是把舊草稿放回表單。

### 大廠怎麼做

- **Apple：「編輯中」要登記，由一個地方統一處理。**
  - Cocoa Bindings 的做法：控制器記住哪些欄位還有沒送出的改動，在適當時機叫它們送出或丟掉。
  - 原文："The controller is responsible for tracking which editors have uncommitted changes and requesting that they commit or discard any pending edits when appropriate—for example, if the user closes the window or quits the application." [Bindings]
  - 現行文件的寫法一樣："sending those editors commitEditing and discardEditing messages, as appropriate" [NSEditorRegistration]
- **NSDocument：手動存檔前送出，自動存檔時不送出。**
  - 原文："first makes sure that any editor registered using Cocoa Bindings' NSEditorRegistration informal protocol has committed its changes (except for autosave operations)" [AppKit RN]
  - 同一份文件："-close now tells editors to discard their changes." 和 "-isDocumentEdited now returns YES whenever there are registered key-value binding editors."
  - 也就是說，在 Apple 的做法裡，「正在打字」本身就算已修改。
  - **注意，可能過時：** 這是 Mac OS X 10.4 年代的 release notes。現行文件沒有重寫這段。
- **取消就是丟掉，而且不走送出的路。**
  - 原文："Terminates the current editing operation and discards any edited text. … it doesn't call controlTextDidEndEditing(_:)." [abortEditing]
- **HTML 規格：change 代表送出。**
  - 原文："The change event fires when the value is committed" [WHATWG input]
- **HTML 規格：拆掉有焦點的欄位，不會發 blur 或 change。**
  - 原文："no blur or change events are fired" [WHATWG removing]
  - 但 Chrome 實際上會發。這是 `pending-input.ts:32` 的註解和 N06 的實測結果。
  - **所以「欄位被拆掉時會送出」這件事，各家瀏覽器不一致，不能靠它。** 要有明確的送出和丟掉時機。（推測：Firefox、Safari 照規格不發，沒有實測。）
- **舊值超過上限不算錯，使用者改了才檢查。**
  - 原文："its dirty value flag is true, its value was last changed by a user edit … then the element is suffering from being too long." [WHATWG tooLong]

### 一勞永逸的做法：集中在 `pending-input.ts`

1. **自動存草稿不要送出。**
   - 拿掉 `#saveDraftNow` 裡的 `flush()`。
   - 想保住打到一半的字，就加 `pendingInput.peek(): {key, text} | null`，另外存成草稿的附帶資料，不放進 `flow.json`。
   - 重開時只提示「有一格沒送出：…」，不自動填回。自動填回要先把那一格畫出來，太脆弱。
2. **Esc 在中央處理。**
   - `pending-input` 加一個全域 keydown，用捕獲階段。
   - 在文字欄按 Esc（不在選字中）：把值改回 `typing.value`，再把 `typed=false`。
   - 之後拆元件時發的 change，會被 `:88` 吞掉。一處就修好 N06 這一整類。
   - 這就是 Apple 的 abortEditing 語意。
3. **不改流程的框不算「未存」。**
   - 跳時間、搜尋這類框標上 `data-scratch`，`isTextField` 排除它們。修好 N12。
4. **字數上限只留一條規則。**
   - 改成 `tooLong(kind, text, before?)`，照 HTML 的寫法：舊值可以超過，但這次的改動不能讓它更長。
   - `CharCount` 改用這條規則。修好 N08。
5. **長期：把欄位接線包成一個 attachment。**
   - 做 `{@attach commitField(ask, 'name')}`，裡面包好四件事：change 送出、Esc 還原、input 時呼叫 `ask.edited`、欄位 key。
   - 現在約 60 個 `onchange=` 各自接線，這類 bug 才會一直出現。這一步可以一個元件一個元件換。
6. **N20：** session 的 `#updated` 帶上原因（`'change'|'undo'|'redo'|'record'|'open'`），草稿就不用再猜。

### 自動守門

- components 測試加一張表，對每個流程欄位跑：
  - 打字 → 等 1.1 秒 → 流程沒變，`canUndo` 也沒變。
  - 打字 → 按 Esc → 流程沒變，欄位的值是原本的值。
- 核心測試：`tooLong` 和 `CharCount` 跑同一組資料，結果要一樣。

**大小：** 第 1–4 步是 S，風險低。第 5 步是 L，可以分批做。

---

## B. 復原沒有把事情整個還原

**問題：** N02、N25、N26、N62（N62 的標籤問題放在 F 一起修）

### 現在怎麼運作（已確認）

- 復原紀錄是 `Step {flow, label}`（`editor-session.svelte.ts:38-41`），只存改之前的流程。
- 復原和重做都呼叫 `carryRecords(prev.flow, this.#flow)`（`:338`；函式本體在 `records.ts:191-206`）。它拿的是「現在」的紀錄。
- 這是 ADR 0006 定的規則：「記」不算復原的一步，所以復原時要帶上現在的紀錄。
- 問題出在這裡：
  - 破壞性指令清掉的記號，復原後拿到的還是清過的版本。
  - `rates.ts:72-73` 靠「有沒有記號」判斷這個環節「當時就有」。
  - 記號沒了，就被當成之後才加的環節，整次算成功：**0% 變 100%**（N02）。
- 刪有紀錄的動作再復原，紀錄是空的（`records.ts:196-198`）。這是刻意的：`result.ts:61` 的 `RECORDS_GONE` 寫著「紀錄救不回來」。只是做完的提示沒講（N25）。

### 大廠怎麼做

- **Apple：同一次操作的所有副作用，自動合成同一步復原。**
  - 原文："automatically creates undo groups around each pass of the run loop." 而且 "The default is true." [groupsByEvent]
  - 換句話說，刪環節時清掉的記號，應該跟刪環節是同一步，一起復原回來。
- **HIG：復原的結果要看得到、能預期。**
  - 原文："Help people predict the results of undo and redo as much as possible." 以及 "it's crucial to highlight the result of each undo and redo to keep people from thinking that the action had no effect" [HIG Undo]
- **Figma：**
  - 原文："if you undo a lot, copy something, and redo back to the present (a common operation), the document should not change." [Figma]

### 一勞永逸的做法：`Step` 多存一份「之後」，復原時把這一步清掉的紀錄補回來

- 改成 `Step {flow: before, after, label}`。存的是參照，不佔多少空間。
- 加一個核心函式 `recordsPatch(before, after)`：算出這一步拿掉了哪些 attempt 和記號。
- **復原：** 先 `carryRecords`，再把這一步拿掉的東西加回去。之後才用「記」刪掉的不加回。
- **重做：** 反過來，再拿掉一次。
- **代價：** 會推翻 `RECORDS_GONE` 這句話和 ADR 0006 的一部分。要先補一份 ADR，也要改確認框的字。
- **最小的替代做法：** 不救回紀錄，但復原時把「當時有、記號被清掉」的環節標成「不明」，不算整次成功。至少數字不會錯。

### 自動守門

`editor-session.test.ts` 加一張表，涵蓋：段裁短、刪環節、刪動作、刪隊員、改名時選「清掉」。每一項檢查兩件事：

- 做 → 復原：`rateCounts` 和紀錄，要跟做之前完全相同（deep-equal）。
- 做 → 復原 → 重做：要跟做之後相同。

**大小：** M。**風險高：** 會影響成功率算得對不對，而且要做產品決定。

---

## C. 浮動的元件蓋住東西

**問題：** N03（故事 67、68 沒修好）、N05、N23、N24、N52、N54。N09、N48、N55、N58 不是疊層，是版面分配問題，個別修。

### 現在怎麼運作（已確認）

| 會蓋住東西的元件 | 位置 | 現在怎麼讓位 |
|---|---|---|
| 黏底的 `.add-bar` | `ActionForm.svelte:1026`，在右欄 `.panel` 裡捲動 | 只給 input 寫死 `scroll-margin-bottom:110px`（`:1037`）。錯誤 `errorAtSpot`（`:309-311`）沒有 `reveal`。連結沒有讓位 |
| 選人工具列 `.tools-bar` | `SelectionTools.svelte:195`，absolute，top:4px | `--tools-h` 只把提示和 `.readout` 往下推，沒推場地和條號 |
| 場地上的提示 `.field-toasts` | `+page.svelte:1844` | `toast-dodge.ts` 只躲開選到的人，會蓋住 `.picked`、`.readout`、沒選到的人、「正面／裁判」 |
| 使用說明的號碼標 | `scripts/guide-screenshots.mjs:129-135`，fixed | 沒檢查會不會蓋到東西 |

### 大廠怎麼做

- **WCAG 2.2 的 2.4.11（AA 級）：** 拿到焦點的元件，不可以被作者自己做的內容整個蓋住。
  - 原文："When a user interface component receives keyboard focus, the component is not entirely hidden due to author-created content." [WCAG22]
  - 官方說明舉的例子就是 "sticky footers, sticky headers, and non-modal dialogs"，**唯一列出的解法是 C43：CSS `scroll-padding`**。[U-2.4.11][C43]
- **`scroll-padding` 對所有捲動容器都有效，聚焦時也會照它讓位。**
  - 原文："This allows the author to exclude regions of the scrollport that are obscured by other content (such as fixed-positioned toolbars or sidebars)" [CSS-SNAP]
  - 原文："should affect whether an element or the caret is considered scrolled into view (e.g. for targeting or focusing operations)" [CSS-SNAP]
  - 從 2021 年 4 月起，各大瀏覽器都支援（MDN 標示 Baseline Widely available）。[MDN scroll-padding]
- **Apple：被蓋住的區域要登記到 safe area，內容自己避開。** 不是讓每個元件自己閃。
  - 原文："a drawing app might use this property to avoid displaying content underneath tool palettes." [additionalSafeAreaInsets]
  - 原文："Even when such views are partially transparent, they still occlude the content that's underneath them." [UIKit SA]
- **Apple 的編輯選單會移開，不蓋重要內容。**
  - 原文："you might need to move the menu to prevent it from covering important content or parts of your interface" [HIG Edit menus]
- **Google Material：snackbar 可以指定出現在哪個元件上方（`setAnchorView`）。** [Snackbar]
- **CSS 錨點定位的 `position-try-fallbacks`：放不下時會自動翻到另一邊。** [MDN position-try]
  - **注意：** 這是 2026 年 1 月才普遍支援的新功能（Baseline 2026），舊 iPad 要準備後備做法。

### 一勞永逸的做法

1. **右欄：改用容器的 `scroll-padding`，不再給每個元素寫 margin。**
   - 黏底條用 `ResizeObserver` 量自己的高度，寫進 `.panel` 的 `--sticky-bottom`。
   - `.panel` 設 `scroll-padding-bottom: var(--sticky-bottom)`。
   - 拿掉寫死的 110px。這樣 Tab 聚焦、`reveal()`、錯誤訊息、連結，全部一起讓位。
   - 表單一打開，就 `reveal` 第一個欄位。
   - 所有 `role=alert` 改走同一個會 `reveal` 的元件。
   - **推測：** `scrollIntoView({block:'nearest'})` 會照 scroll-padding 讓位，規格是這樣寫，要用下面的守門實測確認。
2. **場地：工具列要嘛讓位，要嘛避開人。二選一，要做設計決定。**
   - **讓位（像 safe area）：** Field 算 viewBox 時，固定留一條工具列高度的帶子，跟 `NUMBER_BAND` 同一種做法。場地不會跳，也不會蓋到人。代價是場地小約 40px，跟 N55「場地太小」衝突。
   - **避開（像 Apple 的編輯選單）：** 工具列放不下時移到場地下方，拖人時先收起來。場地大小不變，但工具列位置會換。
3. **提示：改成「躲開所有標了 `[data-keep-visible]` 的東西」。**
   - 不再寫死 selector。
   - 要標上的有：人、條號、`.picked`、`.readout`、「正面／裁判」。

### 自動守門（check:layout 加一條通用的遮擋掃描）

- 在 390、1024、1440 三種寬度，搭配幾種狀態跑：新動作表單開著、選了人、有提示、拖人中。
- 每個能聚焦的元素和每個 `[role=alert]`：
  1. 先 `focus()` 或 `scrollIntoView`。
  2. 在它的中心點和四個角跑 `elementFromPoint`。
  3. 拿到的必須是它自己或它裡面的元素。
- 每個 `[data-keep-visible]` 也做同樣的檢查。
- 截圖腳本的號碼標，也用同一條規則檢查（修 N54）。

**大小：** M。中風險。

---

## D. 檢視模式只在最後一步擋

**問題：** N04、N37、N39

### 現在怎麼運作（已確認）

- **指令層已經集中擋了。** `Ask.locked`（`ask.svelte.ts:89-92`）由 session 的 `#locked()`（`editor-session.svelte.ts:188-191`）提供，所以流程不會真的被改到。
- **畫面層是各處自己寫的：**
  - `+page.svelte` 用 `:819`、`:838` 的 `{#if}`，加上 `:697`、`:705`、`:715` 的 `disabled`。
  - `Timeline`、`SegmentSettings`、`FormationEditor`、`FormationRow` 都沒有讀 `viewing`。

### 大廠怎麼做

- **HTML `<fieldset disabled>`：** 一次停用裡面所有的表單控制項，被停用的控制項也收不到 click。[WHATWG fieldset]
- **`inert` 不適合拿來做「看得到但不能改」。**
  - 原文："Authors should not specify elements as inert unless the content they represent are also visually obscured in some way. … the disabled attribute is probably more appropriate." [WHATWG inert]
- **Apple 傾向停用，而不是藏起來。**
  - 原文："If a menu bar item isn't actionable, disable the action instead of hiding it from the menu." [HIG Menu bar]
- **Google Slides：** 有 Viewing 模式，用來 "prevent unwanted changes"。[Slides]
  - 這個模式會不會把編輯工具藏起來：**查不到**。

### 一勞永逸的做法

- **不能把整塊設成 `inert`。** 時間軸的播放頭和練習的「記」，在檢視模式也要能用（session 註解 :112-114）。
- **判斷只放一個地方：** `session.editable` 放進 context，當唯一的判斷來源。
- **只能編輯的控制項，標上 `data-edit`。**
  - 用一條 CSS 規則統一處理：`.viewing [data-edit]{display:none}`。
  - 決定：
    - 照現有做法，編輯欄已經是藏起來的，所以這裡建議**藏起來**。
    - Apple「停用不藏」的原則是給選單用的。場地這種畫布，藏起來更能讓位給內容。
- **Modal 加 `readonly` prop。** 內容包在 `<fieldset disabled>` 裡；「試聽」這類按鈕放在 fieldset 外面。

### 自動守門

`view-mode.svelte.test.ts` 加一個 DOM 掃描：

- 切到檢視模式。
- 每個看得到、沒停用的 button、input、`[role=button]` 都點一次。文字欄就打字再送出。
- 斷言兩件事：
  - 沒有出現 `VIEW_ONLY` 的提示。
  - 沒有出現含 `VIEW_ONLY` 的錯誤。
- 不管畫面怎麼寫，漏了一個就會紅。

**大小：** S–M。風險低。

---

## E. 畫面狀態的壽命不對

**問題：** N07、N43、N30（N20 已在 A 處理）

### 現在怎麼運作（已確認）

現在有三種方法管狀態的壽命，都是各處手寫：

1. 在 `open()` 清 session 欄位。
2. `{#key opened}`，只包了 MemberPanel 和 Practice。
3. `onswitch` 裡手寫的清單。

結果：

- **N07：** `RecordPage.chosenId` 是元件自己的狀態，元件一拆就不見。
- **N30：** `Timeline.insertCount` 換段時沒有清。
- **N43：** 時間軸沒有被 `{#key opened}` 包，捲動位置留著。

### 大廠怎麼做

- **SwiftUI：用「身分」決定狀態什麼時候清掉。**
  - 原文："When the proxy value specified by the id parameter changes, the identity of the view — for example, its state — is reset." [SwiftUI id]
  - 原文："Use state only for storage that's local to a view and its subviews." [SwiftUI State]
- **Svelte 也一樣：**
  - 原文："Key blocks destroy and recreate their contents when the value of an expression changes." [Svelte key]
  - 拆掉元件後還要留的狀態，要放到模組層級：`.svelte.ts` 裡也能宣告 state。[Svelte $state]

### 一勞永逸的做法：每個畫面狀態都決定好它的壽命

| 壽命 | 放哪裡 | 例子 |
|---|---|---|
| 跟著流程，拆元件也要留著 | session 的 `view = $state({...})`，`open()` 時整份重設 | `RecordPage.chosenId`、`Practice.page`、`SummaryPage` 的篩選、`DailyRates.picked` |
| 換流程就重設 | 整個編排區包進 `{#key opened}`，取代 `onswitch` 手寫的清單 | `Timeline.scrollX/fill/picked`、Lanes 的捲動位置、`Field.zoom/center` |
| 換段或重開小窗就重設 | 打開小窗時初始化 | `Timeline.insertCount/insertUnit`、`CueGrid` 的選擇、`FlowSettings.roleName` |

### 自動守門（整頁測試）

- 選第 2 個動作 → 切到總表 → 切回來：還是第 2 個。
- 開 A 檔，捲時間軸 → 開 B 檔：捲動位置是 0。
- 在插入小窗打數字 → 換到另一種段 → 再開小窗：是預設值。

**大小：** S–M。風險低。

---

## F. 做了能復原的事，卻沒有提示

**問題：** N21、N25、N46、N62、N19

### 現在怎麼運作（已確認）

- **每一步復原，都只從 `change()` 這一個地方進來**（`editor-session.svelte.ts:258-275`），而且 `change()` 已經有 label。
- 但 `change()` 不發提示。提示是約 24 個地方各自寫的。
- 各個問題：
  - `moved()` 三件事都是 false 時，提示是空字串（`:402-406`）。這是 N21 的一部分。
  - 拖人和 ⌘V 共用同一句提示（`:403`）。這是 N46。
  - 按鈕字 `confirmLabel` 綁在 Ask 上，不會跟著問題變（`SegmentSettings.svelte:62`）。這是 N19。
  - `changeLabel` 對段的改動，只分到「改第 N 段」（`change-label.ts:38`）。這是 N62。

### 大廠怎麼做

- **Apple：常見又能復原的動作，不要跳警告。**
  - 原文："Avoid displaying alerts for common, undoable actions, even when they're destructive." [HIG Alerts]
- **復原的名稱要寫清楚做了什麼。**
  - 原文："Briefly and precisely describe the operation to be undone or redone." 例如 "Undo Name" 或 "Redo Address Change." [HIG Undo]
  - 對應的 API 是 `setActionName`。[setActionName]
- **Google Material：snackbar 可以帶「復原」，一次只顯示一則。**
  - 原文："Only one snackbar will be shown at a time." [Snackbar]
  - M3 網站的原文抓不到，這裡用的是 Google 自己的 Android 元件文件。

### 一勞永逸的做法：提示由 `change()` 自動發

- `change()` 先記下 `pendingNotice = label`。
- 指令跑完後，如果沒有人自己設提示，就自動發「已＋label・復原」。
- 這樣「能復原就有提示」變成預設。各處只能改寫提示，不會漏掉。
- `needsConfirm` 的結果帶上按鈕字（刪除或裁短），Ask 照用。
- `changeLabel` 的段改動再細分：音樂、BPM、八拍數。

### 自動守門

- session 測試：每個會產生 `Step` 的指令跑完，`notice` 都不是空的，而且含有 label。
- 核心測試：每一種段欄位的改動，`changeLabel` 都不回「改第 N 段」這種泛稱。

**大小：** M。中風險：要改 24 處提示的時機。

---

## G. 鍵盤和焦點的路由

**問題：** N06、N18、N22

### 現在怎麼運作（已確認）

- **「什麼算打字欄」有 4 份不同的定義：**
  - `TYPING`（`+page.svelte:374`），把 checkbox 也算進去。這造成 N22。
  - `SPACE_NATIVE`（`:367`），排除 checkbox。
  - `NATIVE_UNDO`（`:376`）。
  - `pending-input.ts:42-47` 的 `isTextField`。
- **確認框不拿焦點：** `ConfirmList` 出現時沒有把焦點移進去，而且只有焦點在框裡時才處理 Esc（`:51-55`）。
- **頁面的 Esc 只會清選取**（`:455`），所以按 Esc 關不掉確認框。這是 N18。

### 大廠怎麼做

- **WAI-ARIA APG 對話框的規則：**
  - "Escape: Closes the dialog."
  - 打開時，焦點放在第一個能聚焦的元素上。
  - 不容易復原的操作，焦點放在 "the least destructive action"。
  - [APG Dialog]
- **APG 核取方塊：只用 Space 鍵。**
  - 原文："When the checkbox has focus, pressing the Space key changes the state of the checkbox."
  - 方向鍵、Home 不屬於它，所以它不該被當成打字欄。[APG Checkbox]
- **HTML 規格把 Esc 當成「關閉請求」。** `preventDefault()` 可以攔下它，所以 Esc 可以集中在一個地方處理。[WHATWG close request]

### 一勞永逸的做法

- **只留一份定義。** 新增一個模組，匯出 `isTextEntry(el)` 和 `ownsKey(el, key)`，4 個地方都改用它。
- **頁面的 Esc 照這個順序處理：**
  1. 有問題（確認框）開著：取消問題。
  2. 沒有問題開著：才清選取。
  - 跟 Modal 現在「Esc 先關問題」的做法一致。
- **確認框出現時，把焦點放進去。** 放在比較不會造成破壞的那顆按鈕上。

### 自動守門

`keyboard.svelte.test.ts` 加一張表：

- 焦點分別放在 checkbox、select、button、文字欄。
- 每種都按 Home、←、Space、Esc，檢查結果是不是預期的。
- 有問題開著時按 Esc：問題要收掉，選取要還在。

**大小：** S。風險低。

---

## H. 幾何和數字的誤差

**問題：** N44、N31、N10

### 現在怎麼運作（已確認）

- **N44：** `group-moves.ts:63-64` 選軸和排序時，都直接比較浮點數，沒有容差。
- **N31：** `flow.ts:96-133` 每次調整場地都會吸附到格點。9→4→9 時資訊就丟了，回不去原位。
- **N10：** `members.ts:188-193` 每張站位各自找空位，彼此沒有對照。

### 大廠怎麼做

- **MDN：浮點數不要用 `===` 比，要用適合數值大小的容差。**
  - 原文："Use a threshold that is appropriate for the magnitude and accuracy of the numbers you are comparing." [MDN EPSILON]
- 吸附誤差累積的問題，平台方的一手做法**查不到**。

### 一勞永逸的做法

- **加一個幾何用的 `POS_EPS`。** 跟 `time.ts` 的 `EPS` 同一種做法。
- **「兩端」改成距離最遠的兩個人。** 選軸和排序時加上容差，比不出來再看另一軸、再看 id。這樣結果固定。
- **加隊員時，先找「每張站位都空著」的點。** 找不到才讓每張各自找。
- **調整場地時提示：** 「吸附到新格子，改回去不會回原位，要回原狀請按復原」。

### 自動守門（核心測試）

- 平均分開：把輸入順序打亂、座標加上 ±1e-9 的誤差，結果要一樣。
- 加隊員：做得到的話，新人在每張站位的位置要相同。

**大小：** 各 S。風險低。

---

## I. 小螢幕上字太小、對比不夠

**問題：** N15、N50、N41、N35、N38、N42、N56

### 現在怎麼運作（已確認）

- **場地上的字用場地單位（公尺）。**
  - 隊員號碼是 `0.3px`（`Field.svelte:1063`）。
  - 條號是 `0.3*numScale`（`:758`）。
- **`numScale` 只看放大倍率，不看螢幕上每公尺幾 px。** 所以場地縮小，字也跟著縮。

### 大廠怎麼做

- **Apple HIG 的最小字級：**
  - iOS 預設 17 pt，**最小 11 pt**。
  - macOS 預設 13 pt，最小 10 pt。
  - [HIG Typography]
- **WCAG 2.2 的對比標準：**
  - 1.4.3：一般文字至少 4.5:1，大字 3:1。
  - 1.4.11：UI 元件和圖形至少 3:1。
  - [WCAG22]
- **SVG 沒有內建「字不隨縮放變小」的功能。**
  - `non-scaling-size` "have no implementations"。[MDN vector-effect]
  - 所以只能自己算。

### 一勞永逸的做法

- **場地上所有字都經過同一個函式算大小：**
  - `fontM(m, minPx) = Math.max(m, minPx / pxPerMeter)`
  - 其中 `pxPerMeter = stageSize[0] / view.width`。
- **要做設計決定：** 手機上 11px 大約等於 0.55 m，比圓點還大。
  - 做法 1：太小就不畫號碼。
  - 做法 2：號碼改放在另一層 HTML。
- **做一個 `truncate` attachment：** 文字被截短時，自動補上 `title`。修 N42。

### 自動守門（check:layout）

- 在 390、1024、1440 三種寬度，量場地上每個 `text` 的高度，要大於或等於最小字級。
- 掃描被截短、但沒有 `title` 的文字。
- 用 computed color 算對比，低於 4.5:1 就失敗。
  - 刻意調淡的（例如「閒」）要列進白名單，並寫清楚原因。

**大小：** M。中風險，要做視覺上的取捨。

---

## J. 使用說明跟畫面不同步

**問題：** N61、N53、N54、N52

### 現在怎麼運作（已確認）

- **快捷鍵字串沒有單一來源。**
  - 散在 `+page.svelte:696`、`:704`，以及 `guide/+page.svelte:978-979`、`:1152`、`:1227-1228`、`:1245`。
  - 寫成 `⌘⇧Z`。
- **截圖由 `scripts/guide-screenshots.mjs` 拍。** 但說明裡的數字（例如 0:12.8、×3.1）是手寫的，腳本不會比對。

### 大廠怎麼做

- **Apple HIG：修飾鍵的順序固定是 Control、Option、Shift、Command。**
  - 原文："always list them in this order: Control, Option, Shift, Command."
  - 同一頁寫重做是 "Shift–Command–Z"，也就是 `⇧⌘Z`。
  - [HIG Keyboards]

### 一勞永逸的做法

- **新增 `src/lib/shortcuts.ts`。**
  - 例如 `redo: {mac: '⇧⌘Z', other: 'Ctrl+Shift+Z、Ctrl+Y'}`。
  - 頁面的 title 和說明的表格都從這裡拿。
- **截圖腳本拍完，把時間、尺、倍率寫進一份 JSON。**
  - 說明頁從 JSON 讀這些數字，或在腳本裡比對。

### 自動守門

- **grep 測試：** 除了 `shortcuts.ts`，`.svelte` 檔裡不能直接出現 `⌘` 或 `Ctrl+`。
- **截圖腳本兩條檢查：**
  - 說明裡的數字跟畫面不一樣，就失敗。
  - 號碼標壓到 `[data-keep-visible]`，就失敗。這條跟 C 共用。

**大小：** 快捷鍵是 S，數字比對是 M。風險低。

---

## K. 開發警告沒有被擋下

**問題：** N16、N17

### 現在怎麼運作

- **N16（已確認）：** `Lanes.svelte:103` 的 `labs` 是一般物件，`:397` 用 `bind:this={labs[m.id]}` 綁上去。
- **N17（推測）：** 首頁 `{#each}` 裡的 `{@const}`，在元件拆掉時被讀到。
- **vitest 沒有 setup 檔。**
- **check-layout 只收頁面例外，不收 console 警告**（`scripts/check-layout.mjs:199`）。

### 一手文件

- **Svelte 對 `derived_inert` 的說明：**
  - 原文："A $derived value created inside an effect will stop updating when the effect is destroyed."
  - 原文："You should create the $derived outside the effect, or inside an $effect.root."
  - [Svelte warnings]
- **Vitest 的 `onConsoleLog` 只能把輸出藏起來，不能讓測試失敗。** [Vitest onConsoleLog]
  - 要讓警告算失敗，只能自己在 setup 檔包住 `console.warn`。這是推論，不是文件寫的做法。

### 一勞永逸的做法和守門

- **N16：** 把 `labs` 改成 `$state({})`。
- **vitest：** components 這一組加 `setupFiles`，遇到 Svelte 警告就 throw。
- **check-layout：** 收 `Runtime.consoleAPICalled` 裡 `type==='warning'` 的訊息，跟例外一樣算失敗。
- **注意：** 剛打開時可能先冒出一批既有的警告，要先清乾淨。

**大小：** S。風險低。

---

## L. 其他單點問題（個別修，不需要新機制）

- **N11：** 沒選人時，工具列也顯示「全隊跟第 N 張一樣」。照故事 72、115 的規格。
- **N13、N36：** 跳時間時，口號段要接受八拍寫法，或清楚說要加段名。例子不要寫死在 `time.ts:289`。
- **N14：** 練習卡要不要統一一種存法，**需要產品決定**。
- **N47、N48：** 重算按鈕只在有音樂時出現，而且先留好位置，版面不跳。
- **N57：** 載入音樂後偵測 BPM，或提示「先設 BPM 再算八拍數」。
- 其他文字問題：N26、N29、N40、N45、N51、N60 照報告個別改。

---

## 跟 #233 報告不一樣或要補充的地方

- **N19：** 實際行號是 `SegmentSettings.svelte:62`，不是 :61。
- **N25：** 「紀錄不會回來」是 ADR 0006 刻意的設計，不是漏做。B 的修法會推翻這個決定。
- **N06：** HTML 規格寫拆掉欄位時不發 change，但 Chrome 會發。**所以不能靠這個事件，要明確地送出或丟掉。**
- **C 群：** scroll-padding 會不會讓 Tab 聚焦和 `scrollIntoView` 讓位，還沒有實測，要先加遮擋掃描來確認。

## 來源

查核日期都是 2026-11-08。

- [AppKit RN] Apple, AppKit Release Notes（舊版，Mac OS X 10.4 年代）https://developer.apple.com/library/archive/releasenotes/AppKit/RN-AppKitOlderNotes/index.html
- [Bindings] Apple, How Do Bindings Work?（封存文件）https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/CocoaBindings/Concepts/HowDoBindingsWork.html
- [NSEditorRegistration] https://developer.apple.com/documentation/appkit/nseditorregistration
- [abortEditing] https://developer.apple.com/documentation/appkit/nscontrol/abortediting()
- [groupsByEvent] https://developer.apple.com/documentation/foundation/undomanager/groupsbyevent
- [setActionName] https://developer.apple.com/documentation/foundation/undomanager/setactionname(_:)-8lzip
- [HIG Undo] https://developer.apple.com/design/human-interface-guidelines/undo-and-redo
- [HIG Alerts] https://developer.apple.com/design/human-interface-guidelines/alerts
- [HIG Edit menus] https://developer.apple.com/design/human-interface-guidelines/edit-menus
- [HIG Menu bar] https://developer.apple.com/design/human-interface-guidelines/the-menu-bar
- [HIG Typography] https://developer.apple.com/design/human-interface-guidelines/typography
- [HIG Keyboards] https://developer.apple.com/design/human-interface-guidelines/keyboards
- [UIKit SA] https://developer.apple.com/documentation/uikit/positioning-content-relative-to-the-safe-area
- [additionalSafeAreaInsets] https://developer.apple.com/documentation/uikit/uiviewcontroller/additionalsafeareainsets
- [SwiftUI id] https://developer.apple.com/documentation/swiftui/view/id(_:)
- [SwiftUI State] https://developer.apple.com/documentation/swiftui/state
- [Figma] Evan Wallace, How Figma's multiplayer technology works（2019-10-16）https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- [WHATWG input] https://html.spec.whatwg.org/multipage/input.html#common-input-element-events
- [WHATWG removing] https://html.spec.whatwg.org/multipage/infrastructure.html
- [WHATWG tooLong]、[WHATWG fieldset] https://html.spec.whatwg.org/multipage/form-control-infrastructure.html
- [WHATWG inert]、[WHATWG close request] https://html.spec.whatwg.org/multipage/interaction.html
- [WCAG22] W3C Recommendation 2024-12-12 https://www.w3.org/TR/WCAG22/
- [U-2.4.11] https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- [C43] https://www.w3.org/WAI/WCAG22/Techniques/css/C43
- [CSS-SNAP] CSS Scroll Snap Module Level 1（CR Snapshot 2021-03-11）https://www.w3.org/TR/css-scroll-snap-1/
- [MDN scroll-padding] https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-padding
- [MDN position-try] https://developer.mozilla.org/en-US/docs/Web/CSS/position-try-fallbacks
- [MDN vector-effect] MDN 的 `vector-effect` 頁面（研究時沒記下確切網址，要再補）
- [MDN EPSILON] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/EPSILON
- [APG Dialog] https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- [APG Checkbox] https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/
- [Snackbar] Google, material-components-android Snackbar.md https://github.com/material-components/material-components-android/blob/master/docs/components/Snackbar.md
- [Slides] https://support.google.com/docs/answer/14917995
- [Svelte key] https://svelte.dev/docs/svelte/key
- [Svelte $state] https://svelte.dev/docs/svelte/$state
- [Svelte warnings] https://svelte.dev/docs/svelte/runtime-warnings
- [Vitest onConsoleLog] https://vitest.dev/config/onconsolelog
