# 在瀏覽器裡做流程影片

流程影片（按「輸出影片」做出來的 MP4）要在瀏覽器裡自己做。查的是：1080×1920、約 3 分鐘、H.264 + AAC 的 MP4，各瀏覽器做不做得到、用哪個函式庫、做不到時怎麼退。

2026-11-18 查。版本資料取自 MDN browser-compat-data（BCD）8.1.9（2026-11-12）、caniuse `features-json`（WebCodecs 檔 2026-11-11 提交）、W3C WebCodecs 工作草案（2026-11-17）、Chromium 與 Firefox `main` 原始碼（2026-11-18 讀）、npm（2026-11-18 查，下載 `mediabunny@1.66.0`、`@mediabunny/aac-encoder@1.66.0`、`@mediabunny/mp3-encoder@1.66.0`、`mp4-muxer@5.2.2` 的 tarball 來讀）。
標「推論」的是我自己算的或推的；標「未確認」的是有來源但很弱（只有一個、二手或個案）。

**注意**：BCD、caniuse 只說 `VideoEncoder` / `AudioEncoder` 這些介面有沒有，不說哪個 codec 能編。W3C 規格原文：「Implementers of WebCodecs are not required to support any particular codec nor registry entry」[W3C-REG]。下面 codec 層級的支援，來自瀏覽器原始碼、版本說明和 bug 追蹤。

## 1. WebCodecs 編碼

### 介面（BCD 8.1.9）

| API | Chrome | Edge | Firefox | Safari macOS | Safari iOS/iPadOS | Chrome Android | Firefox Android |
|---|---|---|---|---|---|---|---|
| `VideoEncoder`（含 `isConfigSupported`、`encodeQueueSize`） | 94 | 94 | 130 | 16.4 | 16.4 | 94 | 不支援 |
| `VideoEncoder` 的 `dequeue` 事件 | 106 | 106 | 130 | 16.4 | 16.4 | 106 | 不支援 |
| `AudioEncoder`、`AudioData`、`EncodedAudioChunk` | 94 | 94 | 130 | **26** | **26** | 94 | 不支援 |
| `VideoFrame`（建構子、`close()`） | 94 | 94 | 130 | 16.4 | 16.4 | 94 | 130 |
| `OffscreenCanvas` + 2D | 69 | 79 | 105 | 16.4 | 16.4 | 69 | 105 |
| `OfflineAudioContext`（無前綴） | 35 | 12 | 25 | 14.1 | 14.5 | 35 | 25 |

caniuse 一致：Safari 16.4–18.x 是「只有影像」，26.0 起完整；Firefox Android 不支援 [CANIUSE-WC]。
Apple：16.4「Added video-only support for Web Codecs」[SAF-16.4]；26.0 加了 `AudioEncoder` [SAF-26]。
Firefox 130 只在桌機版開 WebCodecs [MDN-FF130]。

### H.264（`avc1.*`）和 AAC（`mp4a.40.2`）能不能編

| 瀏覽器／系統 | H.264 | AAC | 來源 |
|---|---|---|---|
| Chrome Windows | 可以。內建軟體 OpenH264，也用硬體編碼器。 | 可以，用系統的 Media Foundation。**Windows「N」版不行。** 只接受 96／128／160／192 kbps、44100／48000 Hz、1／2／6 聲道。 | [CR-GNI] [CR-VENC] [CR-MOJO] [CR-AENC] [CR-SWITCH] |
| Chrome macOS | 可以。 | 可以（`kPlatformAudioEncoder` 預設開）。只接受 44100／48000 Hz。 | 同上 |
| **Chrome Linux、ChromeOS** | 可以（OpenH264）。 | **預設不行**：`kPlatformAudioEncoder` 在 Windows／macOS／Android 以外預設關。MDN：桌機 Linux 上任何瀏覽器都不能編 AAC。 | [CR-SWITCH] [MDN-CODEC] |
| Edge Windows／macOS | 可以（推論：同一份 Chromium 程式碼；第三方實測資料 99.8%／100%）。 | 可以（推論；實測資料 99.8%／99.96%）。 | [WCF-AVC] [WCF-AAC] |
| Firefox 桌機 | 可以，用系統編碼器（推論：從編碼模組清單看）。兩個未修的 bug：Windows、Linux 的 AVCC 描述錯（2082867）；時間戳記差一格（2082890）。 | **哪個系統都不行。** 原始碼只允許 `opus`、`vorbis`，MDN 也這樣寫。 | [FF-VENC] [FF-PEM] [FF-AENC] [MDN-CODEC] [REMOTION-BUGS] |
| Firefox Android | **不行**（`CanEncode` 在 Android 回傳 false）。 | 不行。 | [FF-VENC] [FF-AENC] |
| Safari 16.4–18.x（macOS、iOS、iPadOS） | 可以（只有影像）。Apple 沒寫 codec；實測資料 H.264 99.8%（macOS）、99.98%（iOS）。 | **完全沒有 `AudioEncoder`。** | [SAF-16.4] [WCF-AVC] [BCD] |
| Safari 26 以上 | 可以。**Safari 27.0.0、27.0.1：Main、High profile 在預設 `quality` 模式下一直不出東西；Baseline 正常。** WebKit 已修（PR 74602），哪一版 Safari 帶這個修正沒找到。 | 可以（MDN：Safari 26 起都支援）。兩個 bug：(a) 解碼設定 `description` 錯（WebKit 302253，2026-10-22 修進 WebKit main，回報者在 27.0.1 還看得到），直接封裝會變成無聲；(b) 前 1024 個取樣變成靜音（WebKit 328491，未修）。 | [MDN-CODEC] [MB-541] [WK-302253] [REMOTION-BUGS] |
| Chrome Android | 可以，實測資料 96.5%。32-bit ARM 沒有 OpenH264，靠硬體（推論）。 | 可以（預設開），實測資料 97.0%。 | [CR-GNI] [CR-SWITCH] [WCF-AVC] [WCF-AAC] |

補充：

- 實測資料是單一第三方資料集，按 user-agent 分組，沒寫日期，只當旁證。它說「Chrome on Linux」AAC 成功率 49%，和 Chromium 預設對不上，原因不知道（未確認）。
- Chrome 從哪一版開始能編 AAC：沒找到。最接近的是 Chrome 119 的「AudioEncoder bitrateMode」[CS-BITRATE]。
- 所以一定要執行時檢查：先看 `typeof AudioEncoder !== "undefined"`，再用 `VideoEncoder.isConfigSupported`、`AudioEncoder.isConfigSupported`。MDN 也這樣建議 [MDN-CODEC]。

### 不能編 AAC 的地方

1. Firefox 桌機，所有系統。
2. Linux、ChromeOS 上的 Chrome、Edge。
3. Safari 26 以前，包括還在 iOS／iPadOS 16.4–18.x 的 iPad、iPhone。
4. Windows「N」版上的 Chrome。
5. Safari 26、27 有，但有上面兩個 bug。

### Canvas 變成 `VideoFrame`

- 規格建構子 `VideoFrame(CanvasImageSource image, optional VideoFrameInit init)` [W3C-WC]。
- Mediabunny 的 `CanvasSource` 吃 `HTMLCanvasElement | OffscreenCanvas`；官方範例畫在 `OffscreenCanvas` 上 [MB-EXAMPLE]。
- Safari 16.4 曾有 bug：從 canvas 做的格子會重複上一格，結果約 1 fps。2023-10-25 修進 WebKit main，哪一版 Safari 沒寫 [WK-255869]。
- Chromium 的 worker 裡沒有 `AudioBuffer`（chromestatus 上還是「In development」[CS-LIST]）。畫面移到 worker 做的話，聲音要用 `Float32Array` 傳（推論）。

## 2. 另一條路：`MediaRecorder` 錄 canvas

`MediaRecorder` + `canvas.captureStream()` + `MediaStreamAudioDestinationNode`。

| 瀏覽器 | `MediaRecorder` 起始版本 | MP4（H.264 + AAC） | WebM | 來源 |
|---|---|---|---|---|
| Chrome／Edge 桌機 | 47／79 | **126 起**。Linux 上 AAC 可能不行（推論：AAC 編碼器預設關），用 `MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')` 檢查 | 可以 | [BCD] [CS-MP4] [CR-SWITCH] |
| Chrome Android | 47 | 126 起 | 可以 | [CS-MP4] |
| Safari macOS | 14.1 | 一開始就是：「Safari currently supports the MP4 file format with H.264 as video codec and AAC as audio codec」 | 18.4 起 | [BCD] [WK-MR] [SAF-18.4] |
| Safari iOS／iPadOS | 14（BCD）；caniuse 寫 14.5 | 可以 | 18.4 起 | [BCD] [CANIUSE-MR] [SAF-18.4] |
| Firefox 桌機 | 25 | **不行**。只收 `video/webm`、`audio/webm`、`audio/ogg`；bug 1631143 還是 NEW：「We don't support an mp4 muxer」 | 可以 | [FF-MR] [BZ-1631143] |
| Firefox Android | BCD 寫 25，caniuse 寫不支援（來源不一致） | 不行 | 不清楚 | [BCD] [CANIUSE-MR] |

這條路的問題：

- **只能即時錄。** `captureStream()` 是「a real-time video capture of the canvas's contents」[MDN-CAPTURE]。3 分鐘的流程至少錄 3 分鐘，每格都要準時畫，晚了就掉格或重複（推論）。
- `captureStream(0)` + `track.requestFrame()` 可以自己決定哪時抓一格 [MDN-CAPTURE]，但 Firefox 沒有 `requestFrame()` [BCD]，錄影時鐘還是真實時間（推論）。
- **切到別的分頁。** `requestAnimationFrame` 在背景分頁會暫停 [MDN-RAF]；計時器會被限速 [MDN-PAGEVIS] [CHROME-THROTTLE]。教練切分頁就錄不到畫面（推論）。聲音只送進 `MediaStreamAudioDestinationNode` 算不算「正在播聲音」而免限速：沒找到。
- iOS 會暫停背景分頁（WebKit 2024-01-11 改成「做完重要工作就暫停」）[WK-265064]。iPad 錄到一半切 app 大概會壞（推論）。
- 能調的很少：`videoBitsPerSecond` 只是建議值；Chrome 的關鍵格間隔選項「No active development」[CS-LIST]。

**結論（推論）**：只當沒有 WebCodecs 的瀏覽器（Safari 14.1–16.3）的最後退路。Firefox 用這條也做不出 MP4。

## 3. 封裝函式庫

npm 資料 2026-11-18 查。「最後發布」是最新版本的時間。

| 函式庫 | 版本 | 授權 | 最後發布 | 狀態 | 大小 | 打包後能離線 | canvas／AudioBuffer 輔助 |
|---|---|---|---|---|---|---|---|
| **`mediabunny`** | 1.66.0 | **MPL-2.0** | **2026-11-13** | 活躍：2025-06-16 起 203 版；repo 2026-11-16 有推送 | 實測：MP4 輸出 + `CanvasSource` + `AudioBufferSource` + target + `canEncode*`，打包後 **254 kB（minified）、63 kB gzip**（rolldown 1.2.16）。完整 bundle 757 kB／197 kB gzip。npm `unpackedSize` 11.9 MB 是整包含原始碼，不是實際出貨大小 | 可以：純 TypeScript，沒有執行期相依，沒有 `.wasm` | **有**。`CanvasSource` → `add(timestamp, duration)`；`AudioBufferSource` → `add(audioBuffer)`；`canEncodeVideo`、`canEncodeAudio`、`getFirstEncodableAudioCodec`；`BufferTarget`、`StreamTarget` |
| `mp4-muxer` | 5.2.2 | MIT | 2025-07-02 | **已棄用**：「This library is superseded by Mediabunny. Please migrate to it.」 | 31 kB／9 kB gzip（實測） | 可以 | 沒有，只封裝；編碼要自己做 |
| `webm-muxer` | 5.1.4 | MIT | 2025-07-02 | 已棄用（同上） | 沒量 | 可以 | 沒有；只做 WebM，不合用 |
| `mp4box` | 2.5.0 | BSD-3-Clause | 2026-10-25 | 有維護 | 2.5 MB 未打包 | 沒查 | 沒評估 |
| `@ffmpeg/ffmpeg` + `@ffmpeg/core` | 0.12.15／0.12.10 | 外殼 MIT／核心 **GPL-2.0-or-later** | 2025-01-07 | 約 22 個月沒發版 | 核心 64.7 MB 未打包 | 沒確認。憑記憶：核心是另外的 wasm 檔，多執行緒版要 cross-origin isolation header，GitHub Pages 據說設不了（未確認） | 沒評估 |
| `libav.js` | 6.11.9 | LGPL-2.1 | 2026-11-16 | 活躍 | 預設版 12 MB 未打包 | 沒查 | 沒評估 |
| `@remotion/webcodecs` | 4.0.544 | 自訂授權 | 2026-11-16 | 活躍 | 0.58 MB 未打包 | 沒查 | 沒評估；授權沒讀 |

來源：[NPM] [MB-REPO] [MB-README] [MP4MUX-README]、tarball 內容。

`mediabunny` 1.66.0 的原始碼裡已經繞過第 1 節的瀏覽器 bug：Safari AAC 描述錯（302253）、Safari AAC 前 1024 取樣靜音（328491）、Safari 27 H.264 卡住（在 WebKit 上改用 Constrained Baseline）、Firefox AVCC 錯（2082867）和時間戳記偏移（2082890）[MB-SRC]。`mp4-muxer` 在這些 bug 回報前就停更，都沒有。
官方範例就是這件事：畫 canvas、用 `OfflineAudioContext` 做聲音、「as fast as possible」寫出 MP4 [MB-EXAMPLE]。

### AAC 編碼器退路（純 JS／wasm）

| 套件 | 版本 | 授權 | 最後發布 | 大小 | 說明 |
|---|---|---|---|---|---|
| `@mediabunny/aac-encoder` | 1.66.0 | 外殼 **MPL-2.0**；裡面是 **FFmpeg 原生 AAC 編碼器，LGPL v2.1 以上**（沒開 GPL、v3、nonfree），授權文字在 `licenses/ffmpeg/` | 2026-11-13 | 1.13 MB／294 kB gzip | AAC-LC。wasm **內嵌**在 JS 裡（Emscripten `SINGLE_FILE`，沒有 `.wasm` 檔），在 Blob URL 建的 Worker 跑。執行時應該不用網路（推論：看打包方式；glue 程式碼裡還有通用 fetch，沒離線跑過）。2026-03-04 首發（8 個月）。 |
| `@mediabunny/mp3-encoder` | 1.66.0 | 外殼 MPL-2.0；裡面是 LAME，LGPL | 2026-11-13 | 474 kB／121 kB gzip | 只有走 MP3 退路才用得到（第 4 節）。 |

來源：[NPM] [AAC-README] [MP3-README]、tarball 內容。

用法（README）：`if (!(await canEncodeAudio('aac'))) registerAacEncoder();` [AAC-README]。

採用前要先決定的：

- LGPL 散布有義務（附授權文字、讓使用者能換掉函式庫；README 有重新編譯步驟）。要有人做授權審查，這不是法律意見。
- 以後如果加 Content-Security-Policy，要允許 `worker-src blob:`。目前 repo 沒有 CSP（查過 `src/`、`static/`、`docs/deploy.md`）。
- 離線：兩個套件都是普通 JS 模組，Vite 會打進 JS。已裝的 `@vite-pwa/sveltekit` 2.0.0 預設預先快取 `client/**/*.{js,css,ico,png,svg,webp,webmanifest}`，JS 有包到；另外的 `.wasm` 檔**不會**，所以偏好內嵌 wasm 的函式庫。沒建置、沒離線測（推論）。
- 預先快取大小上限：已裝的 `@vite-pwa/workbox-build` 8.0.13 預設跳過超過 2,097,152 bytes（2 MiB）的檔（`maximumFileSizeToCacheInBytes`）。AAC 編碼器 1.13 MB，要自己一個 chunk 才放得進去：用動態 `import()` 載入，並檢查建置結果（推論）。
- Safari 26 以前沒有 `AudioData`。Mediabunny 的 `AudioBufferSource` 用 `Float32Array` 組取樣，每次用 `AudioData` 前都先 `typeof` 檢查，所以 wasm 這條在那裡應該能跑（推論：讀原始碼；沒在裝置上跑）。

## 4. 不能原生編 AAC 時，還要能在 iPhone 上播

| 選項 | iPhone 能播嗎 | 結論 |
|---|---|---|
| **A. 一樣 H.264 + AAC，AAC 用 wasm 編**（`@mediabunny/aac-encoder`） | 可以，跟原生做出來的檔一樣 | **首選。** 聲音只有約 3 分鐘，代價小（推論；沒找到效能數據） |
| B. MP4 裝 Opus | Apple 唯一的文字：Safari 17「Added support for stereo-only Opus in MPEG-4 and WebM containers on macOS Sonoma」（macOS，不是 iOS）[SAF-17]。一位論壇使用者說 iOS 17 的 AVPlayer 能播、iOS 15 不能 [APPLE-FORUM]（未確認）。 | **不要。** iOS 沒有一手來源，通訊軟體更不知道。WhatsApp 商用文件只收 H.264 + AAC [META-WA]。 |
| C. MP4 裝 MP3 | MDN 說 MP4 可以裝 MP3 [MDN-AUDIO]。iOS 能不能播：沒找到。 | **不要。** 沒有瀏覽器的 WebCodecs 能編 MP3 [MDN-CODEC]，一樣要 wasm，沒比 A 好。 |
| D. WebM（VP8／VP9 + Opus） | MDN：WebM 裡的 VP9 在 macOS、iOS 沒有原生播放 [MDN-CODEC] | 不符合需求。 |
| E. `MediaRecorder` 錄 MP4，即時 | Safari 14.1 以上可以 [WK-MR] | 只給沒有 WebCodecs 的瀏覽器（Safari 16.4 以前）。Firefox 不行。 |
| F. 沒有聲音的影片 | 可以 | 流程配音樂，沒聲音很差；最後手段。 |

「Safari 能播」不等於「通訊軟體裡能播」。LINE、WhatsApp、Messenger、iMessage 收到 MP4 會怎麼處理（重新壓縮、自己的播放器、大小上限），沒找到來源。

## 5. 實際限制

### 數字（推論，算出來的）

- 格數：2.5–3 分鐘 × 30 fps = 4,500–5,400 格。
- 一格未壓縮 1080×1920 RGBA = 8.3 MB。排 100 格沒釋放就約 830 MB，所以一定要做背壓、一定要 `close()`。
- 解碼後的聲音：3 分鐘、48 kHz、立體聲、float32 = 69 MB。
- 檔案大小 = 位元率 × 時間。3 分鐘、聲音 128 kbps：影像 2 Mbps 約 48 MB、4 Mbps 約 93 MB、8 Mbps 約 183 MB。

### 記憶體和背壓

- 規格：解碼後的資料可能佔很多記憶體，「Authors are encouraged to call close() immediately when frames are no longer needed」[W3C-WC]。
- 編碼器忙不過來時，`encode()` 會排隊，`encodeQueueSize` 變大 [W3C-WC]。Chromium 在編碼器本身延遲之外，約允許 5 個同時編碼才開始排隊 [CR-VENC]。
- 等 `dequeue` 事件再送下一格。Mediabunny 已經做了：`encodeQueueSize >= 4` 就等，編完就 `close()`；`await source.add(...)` 就是背壓 [MB-SRC] [MB-SOURCES]。
- Chrome「`encodeQueueSize` behaves unpredictably after calling encode()」以不修結案 [REMOTION-BUGS]，不要靠這個數字寫精確邏輯。
- 兩個軌要輪流加（例如 10 秒影像、10 秒聲音），不然一個軌的資料會堆在記憶體等另一個 [MB-WRITING]。
- 各瀏覽器每個分頁的記憶體上限：沒找到。

### 編碼設定

- `hardwareAcceleration` 只是提示，規格說大多數人用預設 `no-preference` 最好 [W3C-WC] [MB-SOURCES]。
- `latencyMode` 用預設 `quality`，這時瀏覽器「MUST not drop frames」；`realtime` 可能掉格 [W3C-WC]。
- Chromium 的 H.264 不收奇數尺寸，並用 codec 字串裡的 level 檢查畫面面積 [CR-VENC]。1080×1920 是偶數。
- **H.264 level**：1080×1920 是 68 × 120 = 8,160 個 macroblock；Level 4、4.1 每格上限 8,192、每秒上限 245,760 [WIKI-AVC]。8,160 × 30 = 244,800，**30 fps 剛好放得進 Level 4，超過約 30.1 fps 要 Level 4.2**（推論）。Mediabunny 只看尺寸和位元率選 level：Chromium、Firefox 用 High Level 4（`avc1.640028`），WebKit 用 Constrained Baseline Level 4（`avc1.424028`），位元率到 20 Mbps 都一樣（推論：讀 codec.js，沒跑）。
- **Profile 和通訊軟體**：Meta 的 WhatsApp 商用文件說 Android WhatsApp 不支援 H.264 High profile 和 B-frame，建議 Main 不帶 B-frame 或 Baseline，並且「moov boxes before mdat」[META-WA]。那是商用 API 的文件，一般 app 是否一樣未確認。Mediabunny 可以用 `fullCodecString` 強制指定。瀏覽器編碼器會不會出 B-frame：沒找到。
- 關鍵格：Mediabunny 預設 2 秒（`keyFrameInterval`）[MB-SOURCES]。間隔拉長，簡單圖形的檔案會變小，但跳轉變慢（推論）。
- Chrome Windows 能用的聲音設定：48000 或 44100 Hz、1 或 2 聲道、96／128／160／192 kbps [CR-AENC]。用 `OfflineAudioContext` 在 48 kHz 混好，128 或 192 kbps 編（推論）。
- 舊裝置硬體編碼器收不收直的 1080×1920：沒找到。先用 `canEncodeVideo('avc', { width: 1080, height: 1920, bitrate })` 檢查，不行就給 720×1280（推論）。

### 要避開的已知 bug

| Bug | 影響 | 狀態 | 來源 |
|---|---|---|---|
| Chrome 414491381 | 頁面需要重繪時 `VideoEncoder` 效能大掉 | 未修（細節要登入，沒讀） | [REMOTION-BUGS] |
| WebKit PR 74602 | Safari 27.0.x H.264 Main／High 卡住 | WebKit 已修；Safari 版本沒找到。Mediabunny 有繞過 | [MB-541] |
| WebKit 302253、328491 | Safari AAC 描述錯；前 1024 取樣靜音 | 前者修進 main，後者未修。Mediabunny 都有繞過 | [WK-302253] [REMOTION-BUGS] [MB-SRC] |
| Firefox 2082867、2082890 | H.264 描述錯；時間戳記偏移 | 未修。Mediabunny 都有繞過 | [REMOTION-BUGS] [MB-SRC] |

因為 Chrome 這個 bug，加上規格建議「media pipelines operate in worker contexts ... where possible」[W3C-WC]：輸出時頁面盡量不要更新，或用 `OffscreenCanvas` 在 worker 畫（推論）。

### 輸出途中切到別的分頁

- 規格：瀏覽器「MUST NOT reclaim an active background codec if it is an encoder」，長時間編碼不會被中斷 [W3C-WC]。
- 這只保護編碼器，不保護頁面的 script。用 `requestAnimationFrame` 跑的迴圈在隱藏分頁會停 [MDN-RAF]，所以用一般的 `async` 迴圈（推論）。iOS 還是會暫停背景分頁 [WK-265064]，iPad 上教練離開 Safari，輸出大概會停（推論，沒測）。

### 存檔

| 做法 | 哪裡能用 | 怎麼做 | 說明 |
|---|---|---|---|
| 放記憶體 | 全部 | `BufferTarget` → `Blob` → `<a download>` 或 `navigator.share({ files })` | Mediabunny：適合「small-ish files (< 100 MB)」，更大會有記憶體耗盡的風險 [MB-WRITING]。這裡預設 `'in-memory'`，metadata 在檔頭 [MB-FORMATS]。 |
| 直接寫檔 | Chrome／Edge 桌機 86+、Chrome Android 132+ [BCD] | `new StreamTarget(await handle.createWritable())` | 吃 `FileSystemWritableFileStream`，有背壓 [MB-WRITING]。這裡預設 metadata 在**檔尾**；要放檔頭用 `fastStart: 'reserve'`（每軌要給 `maximumPacketCount`）[MB-FORMATS]。 |
| Fragmented MP4 | 全部 | `fastStart: 'fragmented'` | **要分享就不要用**：支援度不如一般 MP4，有些播放器不能跳轉 [MB-FORMATS]。 |

和現在的存檔程式（`src/lib/file/save.ts`：有存檔對話框就用，觸控裝置用分享，不然下載連結）的搭配：

- `showSaveFilePicker()` 和 `navigator.share()` 都要剛剛有使用者操作 [MDN-SSFP] [MDN-SHARE]。輸出要好幾分鐘，按下去的那次操作早就過期（推論）。要嘛**開始前**先開存檔對話框再寫進去，要嘛做完後顯示「存檔／分享」按鈕。
- iPad 的分享要完整的 `File`，所以用放記憶體的做法。`video/mp4` 在 MDN 的可分享類型清單裡 [MDN-SHARE]。位元率別太高，讓檔案遠低於 100 MB（推論）。

## 建議

**用 `mediabunny`（MPL-2.0，1.66.0，2026-11-13 發布）走 WebCodecs。** 每格畫到 canvas，`await canvasSource.add(t, 1/30)`；聲音用 `OfflineAudioContext` 做，經 `AudioBufferSource` 餵進去；用 `Mp4OutputFormat` 寫 H.264 + AAC。

1. 輸出時呼叫 `canEncodeVideo('avc', { width: 1080, height: 1920, ... })`。false（Firefox Android、Safari 16.4 以前）就藏起「輸出影片」或說明原因；`MediaRecorder` 是唯一另一條路，不值得先做。
2. 呼叫 `canEncodeAudio('aac')`。false（Firefox、Linux、Safari 26 以前）就載入 `@mediabunny/aac-encoder` 並 `registerAacEncoder()`。這樣每個地方出來都是 H.264 + AAC。
3. 30 fps、預設 `quality`、預設硬體偏好、48 kHz 立體聲 128 kbps、影像位元率適中。
4. **Profile：所有瀏覽器都用 `fullCodecString` 強制 Constrained Baseline Level 4（`avc1.424028`）**（沒測）。理由：Mediabunny 在 WebKit 本來就用它避開 Safari 27 卡住；其他地方預設 High，Meta 說 Android WhatsApp 不收；Main 在 Safari 27.0.x 也會卡。代價是同畫質下比 High 大，簡單圖形可以接受（推論）。每個瀏覽器先用 `canEncodeVideo` 確認收不收這個字串。
5. **全部放記憶體**（`BufferTarget`，預設 metadata 在檔頭，符合 Meta 的建議），做完顯示「存檔／分享」按鈕，接現在的存檔程式。除非真的檔案接近 100 MB，否則不用直接寫檔；真要寫，用 `StreamTarget` 加 `fastStart: 'reserve'`，因為它預設 metadata 在檔尾。
6. 不用 `mp4-muxer`（已棄用、沒繞 bug）、ffmpeg.wasm（GPL 核心、幾十 MB）、Opus 或 MP3 聲音。

**最大風險：iPad、iPhone 上的 Safari。** 這是最需要分享的平台，編碼最弱：26 以前沒有聲音編碼器，26／27 有兩個 AAC bug，27.0.x H.264 會卡。只能靠 Mediabunny 繞過（或 8 個月大的 wasm AAC 編碼器），而且這份調查都沒在裝置上跑過。決定前先做小原型，拿真的 iPad（一台 iPadOS 18、一台 26／27）測，再經真的通訊軟體傳到 iPhone 和 Android 手機看。

## 實測（2026-11-18）

只有一台機器，不能代表其他瀏覽器或裝置。

- 機器：這台 Mac，headless Chrome 157（Chrome 157.0.8103.79）。
- 試驗頁：`prototypes/video-export-spike/index.html`，mediabunny 1.66.0，Canvas 2D 畫 1080×1920、每秒 30 格，聲音用 OfflineAudioContext 做拍子聲。
- `canEncodeVideo('avc', avc1.424028)` 和 `canEncodeAudio('aac', 48 kHz 雙聲道)` 都是 true。
- 10.0 秒、300 格，做了約 5 秒，檔案 0.72 MB。
- ffprobe：H.264 Baseline level 4.0、1080×1920、30 fps、300 格；AAC LC 48 kHz 雙聲道；ffmpeg 從頭解到尾沒有錯誤。
- 推論：3 分鐘的流程約 1.5 分鐘做完、約 13 MB（照這次的比例算，畫面更複雜會變）。這是試驗頁的估計，編輯器真的輸出的實測見下面兩節（3 分鐘約 33 秒；動作少的 12.9 MiB，動作多的 34.0 MiB）。
- 還沒測：手機上能不能播、經過 LINE 等通訊軟體傳送後會怎樣、iPad。

### 編輯器的「輸出影片」（2026-11-18）

同一台 Mac、headless Chrome，`npm run dev`（開發版，沒壓縮），從對話框按「開始」到寫「做好了」。
**這一節是「每一格都重算八拍表」修掉之前量的**；修了以後用正式版重量的見下一節。

| 流程 | 影片長 | 格數 | 花了 | 檔案 | 記憶體 |
|---|---|---|---|---|---|
| `docs/samples/sample-flow.zip`（3 人、音樂 4 秒＋口號 5 秒） | 12.0 秒 | 360 | 約 4.6–4.8 秒 | 682,070 bytes（0.65 MiB） | JS heap 最高約 18 MB；Chrome 全部程序 RSS 1,375 → 1,446 MB（+71） |
| 另外做的 3 分鐘流程（20 人、音樂 150 秒＋口號 30 秒、4 張站位、3 個動作，音樂是程式產生的 44.1 kHz 單聲道 WAV） | 183.0 秒 | 5,490 | 約 31–32 秒 | 13,564,925 bytes（12.9 MiB） | JS heap 最高約 32 MB；Chrome 全部程序 RSS 1,651 → 1,768 MB（+117） |

- ffprobe（兩支一樣）：`h264` profile `Baseline`、level 40、1080×1920、`r_frame_rate=30/1`；`aac` profile `LC`、48000 Hz、2 聲道；
  長度 = 流程長 + 3 秒（9 → 12.0、180 → 183.0）。關鍵格在 0、2、4、6、8、10 秒。檔頭 `ftyp` 之後就是 `moov`（第 32 byte），`mdat` 在後面。
- `ffmpeg -v error -i out.mp4 -f null -` 沒有輸出。
- 範例流程兩次輸出的檔一模一樣大。
- 記憶體：JS heap 是 CDP `Performance.getMetrics` 的 `JSHeapUsedSize`，每 0.25 秒取一次的最大值；RSS 是 headless Chrome 和它所有子程序 `ps` 的 RSS 加起來，起點很高（正式版也有 1.3–1.8 GB，不只是開發版的模組），只看增加的量。
  `encoder.ts` 先把影像全部編完、聲音最後才加，編好的影像會在記憶體裡等聲音 [MB-WRITING]；`fastStart: 'in-memory'` 本來也把整支檔放在記憶體裡。3 分鐘的流程只多出約 120 MB，現在不用改成輪流加。
- 推論：正式版（壓縮過）會快一點；比較慢的筆電、人多的流程會慢一些，沒測。
- 每一格算內容（`videoFrame` 或 `videoFrames` ＋ `layoutFrame`，不含畫圖和編碼）：另外做的很密的流程（24 人、音樂 1 段 47 個八拍、80 個動作每個 8 個拍點，4,602 格），
  在 Node（vitest）裡用假的量字跑。原本每一格都重算八拍表：每格約 4.0 ms、整支約 18.4 秒（八拍表一次約 3.7 ms）；
  改成整支先算一次八拍表（`videoFrames`）後：每格約 0.33 ms、整支約 1.5 秒。上面表格的秒數是改之前在瀏覽器量的，改了以後的重量見下一節。

### 動作多的流程（2026-11-19）

- 機器：同一台 Mac（Apple M3 Max、16 核、128 GB 記憶體、macOS 26.6.2），headless Chrome 157.0.8103.79。**這台比一般筆電快很多**，不能代表一般筆電。
- 正式版：`npm run build` 加 `vite preview`。每次開一個新的 headless Chrome（新的設定檔），用「開啟流程檔」打開，按「輸出影片」→「開始」，計時到對話框寫「做好了」。量的時候沒有跑別的重的工作。
- 記憶體量法同上一節：JS heap 是 CDP `Performance.getMetrics` 的 `JSHeapUsedSize`，每 0.25 秒取一次的最大值；RSS 是 Chrome 和所有子程序的 RSS 加起來，寫「按開始前 → 最高」。
- 流程（用 `src/lib/core` 的指令做，寫成流程檔）：
  - **動作多的**：24 人、9 條直放；音樂 1 段 46 個八拍＋7 拍（BPM 150，150.0 秒，音樂是 ffmpeg 產生的 44.1 kHz 雙聲道 192 kbps MP3）＋口號 30 秒；10 張站位（位置亂數，每張都整隊換位置）；
    音樂段 80 個動作（6 組各 4 人輪流，技巧、金字塔、拋投、跳躍、騰翻、舞蹈，有任務角色，金字塔有中層），每個 16 拍、28 個拍點（拍子每拍一個、4 個步驟、8 個手位）、有環節，三分之一有備註；口號段 1 個全隊動作。一共 2,240 個拍點。
    47 個八拍裡有 41 個「有東西放不下」，所以大部分畫面走的是縮字、縮成一行、拿掉的那條路。
  - **舊的**：上一節那支 3 分鐘流程，照原本的程式原樣重做（20 人、4 張站位、3 個動作、程式產生的 WAV）。
  - **範例**：`docs/samples/sample-flow.zip`。

| 流程 | 影片長 | 格數 | 花了（每次） | 檔案 | JS heap 最高 | Chrome 全部 RSS |
|---|---|---|---|---|---|---|
| 動作多的 | 183.0 秒 | 5,490 | 32.7、32.7、32.8、33.1 秒 | 35,604,935 bytes（34.0 MiB） | 60–61 MB（開始前 29） | 1,782 → 2,283–2,345 MB（+500–563） |
| 舊的 | 183.0 秒 | 5,490 | 33.1、33.3 秒 | 13,497,446 bytes（12.9 MiB） | 18–21 MB（開始前 6） | 1,445 → 1,580 MB（+136） |
| 範例 | 12.0 秒 | 360 | 4.2、4.3 秒 | 681,691 bytes（0.65 MiB） | 6.5 MB（開始前 4） | 1,325 → 1,407 MB（+81） |

- 每支流程每次輸出的檔一樣大；動作多的兩次輸出 `cmp` 只差 10 個 byte（檔頭裡的建立時間）。
- ffprobe（三支一樣）：`h264` profile `Baseline`、level 40、1080×1920、`r_frame_rate=30/1`；`aac` profile `LC`、48000 Hz、2 聲道；關鍵格每 2 秒；檔頭 `ftyp` 之後就是 `moov`。
  影像軌長度剛好 = 流程長 + 3 秒（180 → 183.000、9 → 12.000），格數 5,490、360；容器寫的長度多 0.04 秒（183.039、12.031）是 AAC 最後一包的長度。
- `ffmpeg -v error -i out.mp4 -f null -` 都沒有輸出。動作多的那支用 `volumedetect` 看：開頭 2 秒和口號段是 −91 dB（沒聲音），音樂那段跟原本的 MP3 一樣（平均 −31.9 dB）。
- 舊的那支跟上一節比：時間差不多（開發版 31–32 秒 → 正式版 33 秒），檔案小一點（13,564,925 → 13,497,446 bytes，中間畫面有改）。
- **檔案**：動作多的 34.0 MiB，比原本估的約 13 MB 大很多（圓點一直在走、下面那一列字多）。超過第 5 節 Meta 商用文件寫的 16 MB [META-WA]；一般通訊軟體的上限沒找到。
- **記憶體**：動作多的 RSS 多了約 0.5 GB（舊的約 0.14 GB），JS heap 只多約 30 MB，所以多出來的不在 JS heap 裡，原因沒查出來。
  每 3 秒取一次的 RSS：開始後 6 秒內升到約 2,230 MB，之後持平，約 25 秒後（影片進到口號段，第 4,560 格附近）降到約 1,920–2,030 MB。
  推論：多的這一塊跟畫動作多的音樂段那幾格有關，不是做好的影片一直堆在記憶體裡；流程更長也不會一直漲（沒用更長的流程量）。
- **慢一點的電腦（模擬，不是真的筆電）**：用 CDP `Emulation.setCPUThrottlingRate` 把頁面的 CPU 放慢。
  | 流程 | 不放慢 | 放慢 2 倍 | 放慢 4 倍 |
  |---|---|---|---|
  | 動作多的 | 約 33 秒 | 55.6 秒 | 131.3 秒 |
  | 舊的 | 約 33 秒 | 沒量 | 32.8 秒 |

  舊的放慢 4 倍還是 33 秒：這台上它卡在編碼器，不在頁面。動作多的跟著放慢的倍數變慢：每一格在頁面裡畫（排版、量字、畫圖）要花的時間在這台已經跟編碼差不多（推論：約 6 ms 一格），
  頁面的 CPU 慢的電腦上會更明顯。上一節在 Node 量到算內容只要每格約 0.33 ms，所以花時間的主要是畫圖和量字（推論，沒有分開量）。放慢 4 倍時超過原本估的 1.5 分鐘。
- 還沒量：真的一般筆電（Windows、Intel／AMD）、輸出中切到別的分頁。
- **沒有另開 issue**：不放慢時約 33 秒，在估的 1.5 分鐘以內；放慢 4 倍的 131 秒是模擬，不是真的電腦。34 MiB 的檔案和多出來約 0.5 GB 的 RSS 記下來，讓網站主人在真的電腦上試（#275）時一起看。

## 沒找到

- LINE、WhatsApp、Messenger、iMessage 收到 MP4 怎麼處理（重新壓縮、大小或長度上限、收哪些 H.264 profile）。只有 Meta 商用 API 頁（16 MB、H.264 + AAC、Android 不收 High 和 B-frame）[META-WA]；一般 app 未確認。LINE 沒找到官方資料。
- iOS 播 MP4 裡的 Opus、MP3：沒有 Apple 一手來源，只有一則論壇貼文 [APPLE-FORUM]。
- Chrome 從哪一版開始能編 AAC。
- 哪一版 Safari 帶 WebKit PR 74602（H.264 卡住）和 302253（AAC 描述）的修正。
- 實測資料為什麼「Chrome on Linux」AAC 成功率 49%。
- Firefox 各系統 H.264 編碼是從編碼模組清單推的，不是版本說明。沒裝系統 FFmpeg 的 Linux 能不能編，未確認。
- Edge 的 AAC 是否和 Chrome 一樣（推論一樣，實測資料也一樣）。
- 1080×1920 在 iPad 或中階筆電上的編碼速度：沒找到效能數據。
- 舊裝置硬體 H.264 編碼器收不收直的 1080×1920。
- 瀏覽器 H.264 在 `quality` 模式會不會出 B-frame。
- 每個目標瀏覽器收不收 1080×1920 的 `avc1.424028`、Baseline 比 High 大多少：沒測（只有上面那一台 Chrome）。
- ffmpeg.wasm 的部署需求（另外的 wasm 檔、多執行緒要 cross-origin isolation）是憑記憶，沒讀文件。
- 每個分頁的記憶體上限；iOS canvas 記憶體上限沒查。
- Chrome bug 414491381 的細節（要登入）；WebKit 328491、Firefox 2082867／2082890 只透過 Remotion 清單和 Mediabunny 原始碼註解讀到，沒直接打開。
- 聲音只送進 `MediaStreamAudioDestinationNode`，隱藏分頁會不會免限速。
- Safari 進背景或螢幕鎖定時 iPad 還會不會繼續輸出（推論不會）；Screen Wake Lock 沒查。
- GitHub Pages 能不能設 COOP／COEP header：只在搜尋結果看到社群討論，沒看到 GitHub 文件。
- 軟體 AAC 編碼器的專利授權、wasm 編碼器的 LGPL 合規：沒查，要人工審查。MDN 對 H.264 也有同樣提醒 [MDN-CODEC]。
- `mp4box`、`libav.js`、`@remotion/webcodecs`、`@webav/av-cliper`：只有套件資料，API 和打包大小沒評估。
- 打包大小是在專案外用 rolldown 1.2.16 最小 import 量的；這個 app 實際增加多少沒量。

## 來源

規格和相容性資料

- [BCD] [MDN browser-compat-data](https://github.com/mdn/browser-compat-data) 8.1.9（2026-11-12），讀 [data.json](https://unpkg.com/@mdn/browser-compat-data/data.json)
- [CANIUSE-WC] [caniuse WebCodecs](https://caniuse.com/webcodecs)；[CANIUSE-MR] [caniuse MediaRecorder](https://caniuse.com/mediarecorder)（資料：[features-json](https://github.com/Fyrd/caniuse/tree/main/features-json)）
- [W3C-WC] [WebCodecs，W3C 工作草案 2026-11-17](https://www.w3.org/TR/webcodecs/)（§7.9、§7.11、§9.1、§11、§14）
- [W3C-REG] [WebCodecs Codec Registry](https://www.w3.org/TR/webcodecs-codec-registry/)；[AVC](https://www.w3.org/TR/webcodecs-avc-codec-registration/)；[AAC](https://www.w3.org/TR/webcodecs-aac-codec-registration/)
- [MDN-CODEC] [MDN Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)（2026-08-12 改過）
- [MDN-FF130] [MDN Firefox 130](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/130)
- [MDN-AUDIO] [MDN Web audio codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)
- [MDN-CAPTURE] [MDN captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
- [MDN-RAF] [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [MDN-PAGEVIS] [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [MDN-SHARE] [MDN navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- [MDN-SSFP] [MDN showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)
- [WIKI-AVC] [Wikipedia H.264 level 表](https://en.wikipedia.org/wiki/Advanced_Video_Coding)（二手，引 ITU-T H.264）

Chromium

- [CR-SWITCH] [media_switches.cc](https://github.com/chromium/chromium/blob/main/media/base/media_switches.cc)：`kPlatformAudioEncoder` 各系統預設
- [CR-MOJO] [mojo_audio_encoder.cc](https://github.com/chromium/chromium/blob/main/media/mojo/clients/mojo_audio_encoder.cc)：Windows N（2026-11-12 提交）
- [CR-AENC] [audio_encoder.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webcodecs/audio_encoder.cc)：AAC 參數檢查
- [CR-VENC] [video_encoder.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webcodecs/video_encoder.cc)：H.264 檢查、OpenH264、同時編碼上限
- [CR-GNI] [media_options.gni](https://github.com/chromium/chromium/blob/main/media/media_options.gni)：`media_use_openh264`
- [CS-MP4] [chromestatus：MP4 container support for MediaRecorder（126）](https://chromestatus.com/feature/5163469011943424)
- [CS-BITRATE] [chromestatus：WebCodecs AudioEncoder bitrateMode（119）](https://chromestatus.com/feature/5084320053592064)
- [CS-LIST] [chromestatus 搜尋](https://chromestatus.com/features)（「WebCodecs」「MediaRecorder」「AAC」）
- [CHROME-THROTTLE] [Chrome 88 計時器限速](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)

Firefox

- [FF-AENC] [AudioEncoder.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webcodecs/AudioEncoder.cpp)：`IsAudioEncodeSupported`（2026-08-17 提交）
- [FF-VENC] [VideoEncoder.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webcodecs/VideoEncoder.cpp)
- [FF-PEM] [PEMFactory.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/platforms/PEMFactory.cpp)
- [FF-MR] [MediaRecorder.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/MediaRecorder.cpp)：可用的容器（2026-08-26 提交）
- [BZ-1631143] [Bugzilla 1631143](https://bugzilla.mozilla.org/show_bug.cgi?id=1631143)

Safari／WebKit

- [SAF-16.4] [Safari 16.4 版本說明](https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes)
- [SAF-17] [Safari 17 版本說明](https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes)
- [SAF-18.4] [Safari 18.4 版本說明](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes)
- [SAF-26] [Safari 26 版本說明](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes)
- [SAF-27] [Safari 27 版本說明](https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes)
- [WK-MR] [WebKit 部落格：MediaRecorder API（2020-11-23）](https://webkit.org/blog/11353/mediarecorder-api/)
- [WK-302253] [WebKit 302253](https://bugs.webkit.org/show_bug.cgi?id=302253)
- [WK-255869] [WebKit 255869](https://bugs.webkit.org/show_bug.cgi?id=255869)
- [WK-265064] [WebKit 265064](https://bugs.webkit.org/show_bug.cgi?id=265064)
- [APPLE-FORUM] [Apple 開發者論壇貼文](https://developer.apple.com/forums/thread/775937)（使用者，不是 Apple 員工）

函式庫

- [NPM] 2026-11-18 `npm view`：[mediabunny](https://www.npmjs.com/package/mediabunny)、[mp4-muxer](https://www.npmjs.com/package/mp4-muxer)、[@mediabunny/aac-encoder](https://www.npmjs.com/package/@mediabunny/aac-encoder)、[@mediabunny/mp3-encoder](https://www.npmjs.com/package/@mediabunny/mp3-encoder)、[mp4box](https://www.npmjs.com/package/mp4box)、[@ffmpeg/core](https://www.npmjs.com/package/@ffmpeg/core)、[libav.js](https://www.npmjs.com/package/libav.js)、[@remotion/webcodecs](https://www.npmjs.com/package/@remotion/webcodecs)
- [MB-REPO] [Mediabunny repo](https://github.com/Vanilagy/mediabunny)；[MB-README] 1.66.0 tarball 裡的 README
- [MB-SRC] 1.66.0 tarball 原始碼：`src/codec.ts`（profile、level）、`src/media-source.ts`（排隊、Safari 和 Firefox 繞法）、`src/sample.ts`
- [MB-SOURCES] [Mediabunny：Media sources](https://mediabunny.dev/guide/media-sources)
- [MB-FORMATS] [Mediabunny：Output formats](https://mediabunny.dev/guide/output-formats)
- [MB-WRITING] [Mediabunny：Writing media files](https://mediabunny.dev/guide/writing-media-files)
- [MB-CODECS] [Mediabunny：Supported formats and codecs](https://mediabunny.dev/guide/supported-formats-and-codecs)
- [MB-EXAMPLE] [Mediabunny 範例：procedural generation](https://mediabunny.dev/examples/procedural-generation/)（[原始碼](https://github.com/Vanilagy/mediabunny/blob/main/examples/procedural-generation/procedural-generation.ts)）
- [MB-541] [Mediabunny issue #541](https://github.com/Vanilagy/mediabunny/issues/541)
- [AAC-README] `@mediabunny/aac-encoder` 1.66.0 tarball 的 README 和 `licenses/ffmpeg/`；[MP3-README] `@mediabunny/mp3-encoder` 同上
- [MP4MUX-README] [mp4-muxer repo](https://github.com/Vanilagy/mp4-muxer)
- [REMOTION-BUGS] [Remotion 整理的 WebCodecs bug 清單](https://www.remotion.dev/docs/mediabunny/webcodecs-bugs)（社群整理）

其他

- [WCF-AAC] [webcodecsfundamentals：mp4a.40.2](https://webcodecsfundamentals.org/codecs/mp4a.40.2.html)；[WCF-AVC] [webcodecsfundamentals：avc1.640028](https://webcodecsfundamentals.org/codecs/avc1.640028.html)（第三方實測資料）
- [META-WA] [Meta WhatsApp 商用文件：video messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/video-messages/)
