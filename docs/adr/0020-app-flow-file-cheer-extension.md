# iPhone、iPad app：流程檔存在「檔案」裡叫 `.cheer`，傳出去照舊是 `.zip`

流程檔本來只有一種名字：`流程名.zip`。

app 要做到「檔案」App 點一下就打開流程檔（#299 第 2 條）。可是「檔案」App 點 `.zip`，一定會自己解開成資料夾，app 搶不走。這點 Apple 文件有寫，兩支小樣也在 iPhone 上試過。所以 **app 存進「檔案」的流程檔，改叫 `流程名.cheer`**。

可是 LINE 不收自己取的副檔名（真機試的）：
- iPhone 的 LINE 會說「不支援這種檔案」。
- Mac 的 LINE 會把它包成同名的 `.zip` 再傳出去。

所以**要傳出去的照舊用 `.zip`**：
- app 的「傳給別人」送出 `.zip`。
- 網頁存檔照舊存 `.zip`。

兩種名字的內容一模一樣，app 和網頁都打得開。

為什麼這樣分：
- 教練自己的檔放在「檔案」裡，點一下就開，改完蓋回同一個檔（app 的存檔會蓋回原檔，見 #306）。
- 傳給隊員多半走 LINE，`.zip` 最穩。
- 分享主要走雲端流程（#177）。「傳給別人」是給沒帳號、用本機流程的人用的。

## Considered Options

- **兩種名字（選這個）**：理由見上面。
- **全部照舊用 `.zip`**：LINE 最好傳。可是在「檔案」裡點一下會解開，#299 第 2 條過不了。
- **全部換成 `.cheer`，網頁也換**：iPhone 的 LINE 傳不出去。教練用 Mac 的 LINE 傳，隊員會收到包了兩層的 zip。
- **副檔名叫 `.cheerroutine`**：比較不會跟別的 app 撞名，可是太長。
  - `.cheer` 在 FileInfo、FilExt 兩個副檔名網站都查不到有人用（次級來源，2026-11-22）。
  - 如果兩個 app 都宣告同一個副檔名，系統會用哪一個打開，Apple 沒寫。

決定的細節在 #306。研究筆記在本機分支 `research/app-flow-file-open`。

## Consequences

- **流程檔格式不變**：`flow.json` 不動，`FORMAT_VERSION` 不用加。`docs/flow-file-format.md` 要補兩件事：流程檔有兩種名字，還有下一點的「拆兩層」。
- **開檔多一條規則**（給 Mac LINE 包兩層的檔用）：
  - zip 的最上層沒有 `flow.json`，唯一一層資料夾裡也沒有；
  - 但 zip 裡只有一個檔，而且那個檔本身就是流程檔；
  - 這時就打開裡面那個檔。
- **網頁選檔不能只篩 `.zip`**：
  - 沒裝 app 的 iPhone Safari，會把 `.cheer` 藏起來。
  - Android Chrome 用 `showOpenFilePicker` 篩 `application/zip` 時，推論也會藏起來。
  - 這兩點是讀 WebKit、Chromium 原始碼得到的。
  - 所以改成不篩，選錯檔就照現在的錯誤訊息講。
  - 錯誤訊息裡講到「zip」的地方要換個說法。
- **app 宣告自己的檔案型別**：
  - 型別 conform 到 `public.data`、`public.content`，不 conform 到 `public.zip-archive`。Apple 自己那些用 zip 做底的格式（docx、xlsx 等）也是這樣。
  - 不向 IANA 登記 MIME。
- **「檔案」裡的 `.zip`**：點了還是會解開。要用 app 打開，請從 app 裡按「開啟流程檔」。
- **LINE 收到的檔**：
  - 第一次要點四下：點檔案 → 分享 → 更多 → app。
  - 使用說明教大家把 app 移到分享選單的第一排，之後就只要三下。
- **跟 ADR 0005 不一樣的地方**：ADR 0005 說 iPad 存檔改用分享選單，那是指 Safari。app 裡的存檔會蓋回原檔；要傳給隊員，另外按「傳給別人」。
- **還沒驗**：iPhone、iPad 的 LINE 從分享選單收不收 `.zip`。LINE 官方只叫電腦版把不支援的檔轉成 zip。如果不收，app 裡的本機流程就只能靠雲端流程或電腦傳出去。
