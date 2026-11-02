# 瀏覽器做得到哪些事

Issue #10。範圍：第一版在電腦瀏覽器跑、不用登入、檔案存在教練自己的電腦。

版本資料取自 MDN browser-compat-data 8.1.7（2026-10-22）與 caniuse-db（2026-11-02 抓取）。
標「推論」的是我自己算的或推的，沒有一手來源直接寫。

## 1. 音樂和拍子、動畫對齊

### 可用的時鐘

| 時鐘 | 怎麼走 | 用來對齊的問題 |
|---|---|---|
| `HTMLAudioElement.currentTime` | 瀏覽器「大約」更新。同一段 script 裡讀到的值不變。 | 不保證多久更新一次，也不保證和喇叭同步。小數位數不代表精度。[MDN currentTime] |
| `timeupdate` 事件 | 約 4–66 Hz（每 15–250 ms 一次），看系統負載 | 太粗，不能拿來畫動畫。[MDN timeupdate] |
| `AudioContext.currentTime` | 每次前進一個 render quantum（預設 128 frames） | 一格約 2.67 ms（48 kHz）或 2.90 ms（44.1 kHz），這是算出來的。[Web Audio §1.1.1] |
| `AudioContext.getOutputTimestamp()` | 回傳 `{contextTime, performanceTime}`：喇叭正在播的那一格，和它對應的 `performance.now()` 時間 | 可以把音訊時間換算到畫面時鐘。`performanceTime` 是估計值。[MDN getOutputTimestamp] |
| `AudioContext.outputLatency` | 從瀏覽器交出音訊，到裝置真的出聲，估計幾秒 | 估計值，依平台和硬體不同。[MDN outputLatency] |
| `requestAnimationFrame` | 通常跟螢幕更新率一樣（60/120/144 Hz），背景分頁會暫停 | 畫面一格 16.7 ms（60 Hz）。[MDN rAF] |
| `performance.now()` | 一般網頁解析度 100 µs | 夠用。[MDN performance.now] |

### 支援度

| API | Chrome | Edge | Firefox | Safari | 來源 |
|---|---|---|---|---|---|
| `AudioContext.getOutputTimestamp` | 57 | 79 | 70 | 14.1 | BCD |
| `AudioContext.outputLatency` | 102 | 102 | 70 | 18.4 | BCD、web.dev |
| `AudioContext.baseLatency` | 58 | 79 | 70 | 14.1 | BCD |
| `BaseAudioContext.decodeAudioData` | 14 | 12 | 25 | 6 | BCD |
| `HTMLMediaElement.preservesPitch` | 86 | 86 | 101 | 17.2 | BCD |

Safari 14.1 起，新的 AudioContext 一開始是暫停的，要在使用者點擊時呼叫 `resume()`（BCD 對 Safari 的註記）。
Firefox 預設也要有過使用者互動，Web Audio 才會出聲 [MDN Autoplay]。
所以「播放」一定要從按鈕觸發。

### 建議做法（推論）

1. 用 Web Audio 播音樂：讀檔 → `decodeAudioData` → `AudioBufferSourceNode.start(when, offset)`。`offset` 可以直接從某一拍開始播 [MDN start]。
2. 每個 rAF 裡用 `getOutputTimestamp()` 算出「喇叭現在播到第幾秒」：
   `audible = contextTime + (performance.now() - performanceTime) / 1000`
   再換算成這個音樂段檔案裡的秒數。
3. 拍數 = `(檔案秒數 - 第一拍) × BPM / 60`。動畫用這個拍數內插位置。

為什麼不用 `<audio>.currentTime`：規格沒保證它多常更新，也沒保證扣掉輸出延遲 [MDN currentTime]。
不是不能用，但要自己做平滑。誤差多少，沒找到一手數據。

### 誤差估計

| 來源 | 大小 | 依據 |
|---|---|---|
| 畫面格數 | 最多 1 格：16.7 ms（60 Hz）、8.3 ms（120 Hz） | 推論：rAF 跟螢幕更新率 |
| Web Audio 時鐘顆粒 | 約 3 ms | 推論：128 frames ÷ 取樣率 |
| 有線／內建喇叭輸出延遲 | 未知，執行時讀 `outputLatency` | 沒找到可信的一般數值 |
| 藍牙耳機 | 常見說法 100–250 ms，而且會飄 | 只有二手資料和 Apple 開發者論壇回報（193→260 ms），未確認 |

對照：60 BPM 一拍 1000 ms；150 BPM 一拍 400 ms；170 BPM 一拍 353 ms。
一格畫面（16.7 ms）約 150 BPM 一拍的 4%，應該看不出來（推論）。
藍牙延遲接近半拍，會看得出來。`outputLatency` 是估計值，藍牙可能低估（推論）。
所以建議留一個「手動延遲校正」設定（推論）。

人對音畫不同步的察覺門檻，常被引用的是 ITU-R BT.1359（聲音早 45 ms、晚 125 ms 開始察覺）。
我只讀到該建議書的目錄頁，沒讀到原文，這組數字未確認。

### 多個音樂段

每段解碼成一個 AudioBuffer，各自有 BPM 和第一拍。
下一段可以用 `start(when)` 排在前一段結束的時間點，`when` 用的是 AudioContext 的時鐘 [MDN start]。
這樣不會有 `<audio>` 換檔的空隙（推論）。

## 2. 存檔在自己電腦

### 支援度

| 功能 | Chrome | Edge | Firefox | Safari | 來源 |
|---|---|---|---|---|---|
| `showOpenFilePicker` / `showSaveFilePicker` / `showDirectoryPicker` | 86 | 86 | 不支援 | 不支援 | BCD、caniuse |
| `FileSystemHandle.queryPermission` / `requestPermission` | 86 | 86 | 不支援 | 不支援 | BCD |
| 拖放取得 handle（`DataTransferItem.getAsFileSystemHandle`） | 86 | 86 | 不支援 | 不支援 | BCD |
| `FileSystemWritableFileStream`（寫入） | 86 | 86 | 111 | 26 | BCD |
| 瀏覽器私有空間 OPFS（`navigator.storage.getDirectory`） | 86 | 86 | 111 | 15.2 | BCD |
| `<a download>` | 15 | 13 | 20 | 10.1 | BCD |
| `<input type=file>` | 全部 | 全部 | 全部 | 全部 | — |

注意：Firefox 111、Safari 26 的「寫入」只能寫 OPFS。
OPFS 是瀏覽器自己的空間，不是使用者看得到的檔案。它們沒有存檔對話框。
caniuse 把 File System Access API 的 Chrome/Edge 86 標成「部分」（「Parts of the API are still missing」），近期版本標成完整支援。

### 各家立場

- **WebKit：反對**（`position: oppose`、`concerns: security`，2023-03 結案）。理由：看不到能安全地讓網頁寫入本機檔案的做法。讀取可以接受。[WebKit standards-positions #28]
- **Mozilla：negative**（2024-09 標記）。OPFS 不在反對範圍。[Mozilla standards-positions #154]
- 所以 Safari、Firefox 近期不會有存檔對話框（推論）。

### Chrome / Edge 能做到的

- 存檔：`showSaveFilePicker({ suggestedName, types })` 跳出存檔對話框，回傳 handle。之後 `createWritable()` 寫入，`close()` 才真的寫進磁碟。[MDN showSaveFilePicker][Chrome FSA]
- 拿到 handle 後，再存一次可以直接蓋掉原檔，不用再選位置。存檔不再詢問的狀態，維持到這個網站的分頁全部關掉。[Chrome FSA]
- handle 可以存進 IndexedDB，下次打開網頁可以「開啟最近的檔案」。[Chrome FSA]
- Chrome 122 起，重新要權限時有「每次造訪都允許」選項。[Chrome persistent permissions]
- 需要 secure context（HTTPS），而且要由使用者操作觸發。[MDN showSaveFilePicker]

### Safari / Firefox 只能這樣

- 開檔：`<input type=file>`。
- 存檔：做一個 Blob，用 `<a download="名稱">` 下載。**不能蓋掉原檔**，每次存都是新的下載。[Chrome FSA]
- 瀏覽器只給檔名，不給完整路徑（`<input type=file>` 的 value 是假路徑 `C:\fakepath\…`）[MDN input file]。
- 所以不能記住「上次開的檔在哪」，也不能自己重新讀音樂檔（推論）。

`browser-fs-access` 函式庫就是包這兩條路：有 API 就用，沒有就退回 input + download [Chrome FSA]。

### 音樂要不要包進專案檔

瀏覽器沒有內建 zip 的 API（推論：MDN、BCD 都找不到）。可選做法：

| 做法 | 好處 | 壞處 |
|---|---|---|
| 一個 zip（JSON + 音樂檔） | 一個檔帶得走，換電腦也能開 | 要用函式庫或自己寫 zip 檔頭。`CompressionStream('deflate-raw')` 有支援（Chrome 103、Firefox 113、Safari 16.4，BCD） |
| JSON 內嵌 base64 音樂 | 最簡單 | 檔案變大約 1/3（base64 是 4/3 倍，推論） |
| JSON 只存檔名，音樂另外放 | 專案檔小 | Safari/Firefox 每次開專案都要再選一次音樂。Chrome 可以用目錄 handle 解決（推論） |

mp3、m4a 本來就壓縮過，zip 用「不壓縮」模式也可以（推論）。

### 大小估計（推論，用位元率算）

| 一段 2:30 的音樂 | 大小 |
|---|---|
| mp3 128 kbps | 約 2.4 MB |
| mp3 320 kbps | 約 6 MB |
| wav 44.1 kHz 16-bit 立體聲 | 約 26.5 MB |
| 解碼後放在記憶體（48 kHz float32 立體聲） | 約 57.6 MB |

幾段 mp3 加起來在幾十 MB 內，應該沒問題（推論；沒找到各瀏覽器 Blob 上限的一手文件）。
全部用 wav 會到上百 MB，存檔、開檔會慢（推論）。

## 3. SVG 還是 Canvas

沒找到直接比較兩者效能的一手文件。下表的功能差異有出處；效能結論是推論。

| | SVG | Canvas 2D |
|---|---|---|
| 點選／拖曳 | 每個隊員是 DOM 元素，直接收 pointer 事件 [MDN pointer-events] | 要自己算點到誰：`isPointInPath` 或自己比距離（`Path2D`、`isPointInPath` 各家都支援，BCD） |
| 座標換算 | `getScreenCTM()` 拿到元素到畫面的矩陣，反矩陣換回場地座標 [MDN getScreenCTM] | 自己維護矩陣 |
| 文字標籤 | `<text>`，縮放不會糊（推論） | `fillText`；要乘 `devicePixelRatio` 才不糊；MDN 建議能不畫字就不畫 [MDN Optimizing canvas] |
| 無障礙 | 元素在 DOM 裡（推論） | 只是點陣圖，輔助工具看不到 [MDN canvas] |
| 效能 | 元素很多時 DOM 成本高（推論） | 每格重畫；可分層、離屏預畫 [MDN Optimizing canvas] |

結論（推論）：25 個隊員加場地格線，只有幾十到一兩百個元素，兩種都能跑 60 fps。
這個量級下，SVG 寫點選、拖曳、文字比較省事。效能差距要到上千個物件才會明顯。
如果之後要畫軌跡、殘影，可以「SVG 放隊員，底下一層 Canvas 畫背景」。
建議在「第一版用什麼技術做」前，用小原型實測一次。

## 4. mp3、m4a、wav 能不能播

`decodeAudioData` 支援的格式和 `<audio>` 相同。規格原文：「any of the formats supported by the audio element」[Web Audio §1.1.2]。
它只吃完整檔案，不吃片段；解碼後會重取樣到 AudioContext 的取樣率 [MDN decodeAudioData]。

| 格式 | Chrome | Edge | Firefox | Safari | 來源 |
|---|---|---|---|---|---|
| mp3 | 4+ | 12+ | 3.5+（早期限部分作業系統；71 起內建） | 4+ | caniuse mp3、MDN codecs |
| m4a（AAC in MP4） | 12+ | 12+ | 22+「部分」：只限 MP4 容器，而且作業系統要有解碼器 | 4+ | caniuse aac |
| wav（PCM） | 8+ | 12+ | 3.5+ | 4+ | caniuse wav |

補充：

- Firefox 的 AAC 靠作業系統 [MDN codecs、caniuse aac]。Windows、macOS 一般有（推論）。
- MDN 寫「AAC 在 Chromium 開源版不可用」。一般 Chrome、Edge 不受影響（推論）。
- MDN 寫 Chrome 只支援 AAC Main Profile。這和常見的 AAC-LC 檔（例如 iTunes 匯出）對不上，未確認。要拿真的 m4a 測。
- wav 幾乎都是 LPCM；其他編碼（ADPCM、µ-law）瀏覽器不支援 [MDN containers]。
- 執行時可以用 `canPlayType` 先檢查（推論）。

## 沒找到

- 各瀏覽器 `<audio>.currentTime` 實際更新間隔、是否扣掉輸出延遲。
- 有線喇叭、內建喇叭 `outputLatency` 的一般數值。
- 藍牙延遲的一手規格數字。
- ITU-R BT.1359 原文的數字。
- SVG vs Canvas 在 25 個物件下的一手效能數據。
- 各瀏覽器 Blob／下載大小上限的一手文件。
- 24-bit、32-bit float wav 在各瀏覽器的支援。

## 來源

- [Web Audio API 規格（W3C）](https://www.w3.org/TR/webaudio/)：§1.1.1 currentTime、§1.1.2 decodeAudioData、§1.2.2 baseLatency / outputLatency
- [MDN AudioContext.getOutputTimestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)
- [MDN AudioContext.outputLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- [web.dev：Synchronize audio and video playback on the web](https://web.dev/articles/audio-output-latency)
- [MDN HTMLMediaElement.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)
- [MDN timeupdate 事件](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event)
- [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [MDN performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)
- [MDN AudioBufferSourceNode.start](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)
- [MDN Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [MDN decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)
- [MDN showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)
- [Chrome：File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Chrome：Persistent permissions（Chrome 122）](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [WebKit standards-positions #28](https://github.com/WebKit/standards-positions/issues/28)
- [Mozilla standards-positions #154](https://github.com/mozilla/standards-positions/issues/154)
- [MDN input type=file](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
- [MDN Media container formats](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers)
- [MDN Web audio codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)
- [caniuse AAC](https://caniuse.com/aac)、[caniuse MP3](https://caniuse.com/mp3)、[caniuse WAV](https://caniuse.com/wav)、[caniuse File System Access API](https://caniuse.com/native-filesystem-api)
- [MDN SVG pointer-events](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/pointer-events)
- [MDN getScreenCTM](https://developer.mozilla.org/en-US/docs/Web/API/SVGGraphicsElement/getScreenCTM)
- [MDN Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [MDN canvas 元素](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas)
- [MDN browser-compat-data](https://github.com/mdn/browser-compat-data)（8.1.7）：上面的版本號
- [ITU-R BT.1359-1](https://www.itu.int/rec/R-REC-BT.1359-1-199811-I/en)（只讀到目錄頁）
