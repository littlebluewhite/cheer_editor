# app 裡音樂和拍子、動畫怎麼對齊：原生和 WKWebView

研究紀錄，查核日期 2026-11-20。Issue #297「查 app 裡音樂和拍子、動畫怎麼對齊」（地圖 #292）。

要回答的問題：在 iPhone、iPad 的 app 裡，怎麼讓音樂、拍子和場地上的動畫對齊？原生的做法，跟包在 app 裡的網頁（WKWebView），各差多少？

這份筆記接在 [`browser-capabilities.md`](browser-capabilities.md) 第 1 節後面，表格用同樣的欄位，多一欄「平台」。平台分三種：**網頁（Safari）**是現在的做法；**WKWebView** 是把現在的網頁包進 app；**原生**是用 Apple 的 AVFAudio 重寫播放。

這裡只整理事實，不選做法。

**這台 Mac 沒有 Xcode 和模擬器，沒有任何數字是在真機上量的。** 要量才知道的事集中寫在「要在真機上量的事」。

標記方式：

- **已確認**：Apple 開發者文件、WWDC 講稿、W3C 規格有原文，下方附引文。
- **已確認（原始碼）**：WebKit 原始碼這樣寫。讀的是 2026-11-20 `main` 分支的一個固定 commit（`7bd8f0d`），不是某一版 iOS 裡的 WebKit。手機上跑的版本可能不同。
- **本機 SDK 標頭**：文字出自這台 Mac 上 Command Line Tools 的 `MacOSX27.0.sdk` 裡 AVFAudio 的標頭檔註解。是 Apple 寫的，但沒有網址。
- **非官方**：WebKit bug 的回報者、開發者論壇的回報。WebKit 工程師在 bug 上的留言會寫明是誰、哪一天。
- **推論**：我自己算的或推的，沒有一手來源直接寫。
- **查不到**：在下方來源裡沒找到。不代表不存在。

## 票上七點，各查到多少

| 票上要查的 | 查到多少 |
|---|---|
| 原生播音樂的時鐘：喇叭現在播到第幾秒、輸出延遲 | 讀得到：API 和文件原文都有。**準不準：查不到**，文件沒寫，要真機量 |
| 藍牙喇叭、AirPods、AirPlay 的延遲，系統會不會告訴 app | **薄**。AirPlay 有一句（「can result in a 2-second delay」）。藍牙：文件沒給數字，也沒寫回報的延遲含不含藍牙那一段、準不準。**查不到** |
| 六件事原生各怎麼做（從某一拍播、變速不變調、重複範圍、段接段、節拍器、拍點提示音） | 有：每件都有對應的 API 和文件原文。變速時播放頭怎麼換算，**查不到** |
| 背景、鎖定、來電、靜音鍵；鎖定畫面的播放鍵 | 原生：有。WKWebView：靠 WebKit 原始碼和 bug 留言，**薄** |
| 120 Hz 畫面和聲音時鐘怎麼對 | 有。畫面合成之後到真的亮在螢幕上還要多久，**查不到** |
| WKWebView 裡的 Web Audio：延遲、`outputLatency` 準不準、背景播不播、跟 Safari 一不一樣 | 查到原始碼層級：`outputLatency` 怎麼算、背景怎麼擋。**沒有任何實測數字**。跟 Safari 的差別只找到兩點。**薄** |
| 跟現在網頁的做法放同一張表 | 有，見「可用的時鐘」「誤差估計」兩張表 |

## 結論（事實）

1. **原生讀得到「播到哪」和「輸出延遲」，是分開的兩個值。** `AVAudioPlayerNode` 的 `lastRenderTime` 加 `playerTime(forNodeTime:)` 給出播放器算到第幾個 sample；`AVAudioSession.outputLatency`、輸出節點的 `presentationLatency` 給出延遲幾秒。這些 API 都已確認。文件裡沒找到一個 API 直接回答「喇叭現在播到第幾秒」；要自己相減是推論。
2. **這些延遲值準不準，Apple 文件沒寫。** 藍牙的延遲沒有一手數字。AirPlay 只有一句：「can result in a 2-second delay」。已確認有這句；其他查不到。
3. **原生的排程以 sample 為單位。** `scheduleSegment` 可以從音樂檔的某一個 frame 開始播幾個 frame；`when` 不給就緊接在上一段後面。已確認。
4. **原生有現成的變速不變調**：`AVAudioUnitTimePitch`，速度 1/32 到 32 倍。`AVAudioPlayer` 也有不變調的 0.5 到 2.0 倍。已確認。`AVAudioUnitTimePitch` 是引擎裡的一個節點；邊播邊變速、不用先把整個檔拉長是推論，文件沒有這樣寫。變速後「播放器的 sample」怎麼換回「喇叭的時間」，查不到。
5. **背景和鎖定**：原生要兩件事才會繼續播，audio session 設成 `playback`，Info.plist 的 `UIBackgroundModes` 加 `audio`。`playback` 也不受靜音鍵影響。已確認。
6. **來電會打斷 audio session**，系統發通知，app 自己決定要不要接著播。iOS 27 起換了一組新的通知，舊的 `interruptionNotification` 在 27 標成淘汰。已確認。
7. **鎖定畫面的播放鍵**是 `MPNowPlayingInfoCenter`（顯示）加 `MPRemoteCommandCenter`（按鍵）。已確認。
8. **原生的畫面時鐘和聲音時鐘是同一個系統時鐘**（`mach_absolute_time()`）。`CADisplayLink.targetTimestamp` 是下一格畫面合成的時間。iPhone 要在 Info.plist 加一個 key 才拿得到 60 Hz 以上。已確認。
9. **WKWebView 和 Safari 是同一套 Web Audio。** MDN 的相容資料裡，這次查的每一列 `webview_ios` 都寫成「照 Safari」。已確認。
10. **WebKit 的 `outputLatency` 在 iOS 上就是 `AVAudioSession.outputLatency` 加輸出 audio unit 的延遲。** 所以 WKWebView 讀到的延遲，來源跟原生一樣。已確認（原始碼）。
11. **WebKit 的 `getOutputTimestamp()` 沒有扣輸出延遲。** 它回的是「算到哪」和「算的那一刻」，不是「喇叭播到哪」。現在的網頁只用這個函式，沒讀 `outputLatency`。已確認（原始碼）。所以畫面會比喇叭早一個輸出延遲（推論，要真機量）。
12. **iOS 上的 Web Audio 預設算「環境音」**：靜音鍵會靜音，app 到背景就被擋。網頁把 `navigator.audioSession.type` 設成 `playback` 可以改掉這兩件事。現在的網頁已經有設。已確認（原始碼、WebKit 工程師留言）。
13. **WebKit 預設把網頁的畫面更新壓在 60 fps 附近**，不跟 120 Hz 的螢幕。已確認（原始碼的設定預設值）。
14. **WKWebView 跟 Safari 不一樣的地方只找到兩點**：app 的 `UIBackgroundModes` 要有 `audio`（WebKit 工程師留言）；有一張還開著的 bug 說來電後 Web Audio 永久沒聲音（非官方回報，iOS 15.6）。另外，Web Audio 的 audio session 不是 app 自己的那一個：它設在 WebKit 的 GPU process 裡，再標記成屬於顯示網頁的 app（原始碼）。

## 可用的時鐘

欄位跟 `browser-capabilities.md` 第 1 節的「可用的時鐘」一樣，多一欄「平台」。網頁那幾列是照抄原表。同一種用途的列排在一起。

| 平台 | 時鐘 | 怎麼走 | 用來對齊的問題 |
|---|---|---|---|
| 網頁（Safari） | `AudioContext.currentTime` | 每次前進一個 render quantum（預設 128 frames） | 一格約 2.67 ms（48 kHz）或 2.90 ms（44.1 kHz），這是算出來的。[Web Audio §1.1.1] |
| WKWebView | `AudioContext.currentTime` | 同上。WebKit 的 render quantum 是 128（原始碼） | 同上 |
| 原生 | `AVAudioNode.lastRenderTime` | 「The most recent render time.」是一個 `AVAudioTime`，裡面有 sample 數和 host time | 引擎沒在跑或節點沒接到輸出時是 `nil`。多久更新一次文件沒寫；每個 I/O 週期一次是推論 [lastRenderTime] |
| 原生 | `AVAudioPlayerNode.playerTime(forNodeTime:)` | 把上面的節點時間換成「從播放器開始播算起」的時間，暫停的時間不算 | 沒在播時回 `nil`。`stop()` 會把它歸零 [AVAudioPlayerNode] |
| 網頁（Safari） | `AudioContext.getOutputTimestamp()` | 回傳 `{contextTime, performanceTime}`：喇叭正在播的那一格，和它對應的 `performance.now()` 時間 | 可以把音訊時間換算到畫面時鐘。`performanceTime` 是估計值。[MDN getOutputTimestamp] |
| WKWebView | `AudioContext.getOutputTimestamp()` | 同一個函式。WebKit 回的是最近一次算聲音時的位置和那一刻的時間 | **沒有扣輸出延遲**（原始碼）。所以不是「喇叭正在播的那一格」 |
| 原生 | `AVAudioTime` 的 `hostTime` 和 `sampleTime` | 同一刻的兩種寫法：系統時鐘、sample 數 | `extrapolateTime(fromAnchor:)` 可以在兩種之間換算 [AVAudioTime] |
| 網頁（Safari） | `AudioContext.outputLatency` | 從瀏覽器交出音訊，到裝置真的出聲，估計幾秒 | 估計值，依平台和硬體不同。[MDN outputLatency] |
| WKWebView | `AudioContext.outputLatency` | `AVAudioSession.outputLatency` 加輸出 audio unit 的延遲（原始碼） | 沒在播時回 0；開了防指紋追蹤的雜訊保護時回固定值 512 ÷ 取樣率（原始碼） |
| 原生 | `AVAudioSession.outputLatency` | 「The latency for audio output, in seconds.」 | 含不含藍牙那一段、準不準，文件沒寫 [outputLatency] |
| 原生 | `AVAudioIONode.presentationLatency`、`AVAudioNode.outputPresentationLatency` | 輸出裝置的延遲；某個節點之後整條路最多還要多久 | 0 可能是「沒有延遲」，也可能是「不知道」 [presentationLatency]、[outputPresentationLatency] |
| 原生 | `AVAudioPlayer.deviceCurrentTime` | 「The time value, in seconds, of the audio output device’s clock.」 | 這是比較簡單的 `AVAudioPlayer` 的時鐘，用 `play(atTime:)` 排開始時間 [deviceCurrentTime] |
| 網頁（Safari） | `requestAnimationFrame` | 通常跟螢幕更新率一樣（60/120/144 Hz），背景分頁會暫停 | 畫面一格 16.7 ms（60 Hz）。[MDN rAF] |
| WKWebView | `requestAnimationFrame` | WebKit 預設把畫面更新壓在 60 fps 附近（原始碼的設定預設值） | 120 Hz 的機器上多半也是一格 16.7 ms（推論，要真機量） |
| 原生 | `CADisplayLink` 的 `timestamp`、`targetTimestamp` | 每次螢幕更新叫一次。`targetTimestamp` 是下一格畫面合成的時間 | ProMotion 的更新率會變：10 到 120 Hz（iPhone）、24 到 120 Hz（iPad Pro）[CADisplayLink]、[ProMotion] |
| 網頁（Safari） | `performance.now()` | 一般網頁解析度 100 µs | 夠用。[MDN performance.now] |
| WKWebView | `performance.now()` | 同上 | 同上 |
| 原生 | `mach_absolute_time()`、`CACurrentMediaTime()` | 系統時鐘。`AVAudioTime` 的 host time 和 `CACurrentMediaTime()` 都用它 | 聲音和畫面用同一個時鐘 [AVAudioTime]、[CACurrentMediaTime] |

`<audio>.currentTime` 和 `timeupdate` 那兩列沒有重查，照原表。

**讀這張表和下面「誤差估計」要注意：** WKWebView 那幾列寫「原始碼」的事（`getOutputTimestamp()` 沒有扣輸出延遲、`outputLatency` 怎麼算、畫面更新壓在 60 fps 附近），出自 Safari 也在用的同一段 WebKit 程式，所以 Safari 也一樣。網頁（Safari）那幾列是照抄原表的寫法（出自 W3C 規格和 MDN，講的是一般瀏覽器），沒有改。兩列寫得不一樣，不代表 Safari 和 WKWebView 的行為不一樣。

### WKWebView 的支援度

取自 MDN browser-compat-data 8.1.10（2026-11-19 發布）。下表每一列的 `webview_ios` 都寫 `mirror`，意思是照 `safari_ios`；`safari_ios` 也寫 `mirror`，照 Safari。BCD 目前列的 `webview_ios` 最新正式版是 27.2（2026-10-26）。已確認。

| API | Safari | iOS 的 Safari | iOS 的 WKWebView | 來源 |
|---|---|---|---|---|
| `AudioContext.getOutputTimestamp` | 14.1 | 照 Safari | 照 Safari | BCD |
| `AudioContext.outputLatency` | 18.4 | 照 Safari | 照 Safari | BCD |
| `AudioContext.baseLatency` | 14.1 | 照 Safari | 照 Safari | BCD |
| `AudioContext` 的 `interrupted` 狀態 | 9 | 照 Safari | 照 Safari | BCD |
| `navigator.audioSession`、`AudioSession.type` | 16.4（標成實驗性） | 照 Safari | 照 Safari | BCD、Safari 16.4 版本說明 |
| `AudioSession.state`、`statechange` 事件 | 不支援 | 照 Safari | 照 Safari | BCD |
| `MediaSession`（`setActionHandler`、`setPositionState`） | 15 | 照 Safari | 照 Safari | BCD |

- Apple 的「Safari Release Notes」這一組文件，摘要寫它涵蓋「Safari and Safari View Controller」和「WKWebView for iOS, iPadOS, macOS, watchOS, and in visionOS」。已確認。[safari-notes]
- `navigator.audioSession` 的版本有兩種說法：BCD 和 Safari 16.4 版本說明寫 16.4（「Added support for a subset of the AudioSession Web API.」）；WebKit 工程師 Jean-Yves Avenard 在 [bug 237322][bug-237322]（2024-09-25）寫「Since iOS 17, you can set the audio session type to "playback".」。哪個對沒有查到。
- Safari 18.4 的版本說明裡找不到 `outputLatency`。18.4 這個數字只有 BCD。

## 誤差估計

欄位跟第 1 節的「誤差估計」一樣，多一欄「平台」。網頁那幾列照抄原表。

| 來源 | 平台 | 大小 | 依據 |
|---|---|---|---|
| 畫面格數 | 網頁（Safari） | 最多 1 格：16.7 ms（60 Hz）、8.3 ms（120 Hz） | 推論：rAF 跟螢幕更新率 |
| 畫面格數 | WKWebView | 最多 1 格。WebKit 預設壓在 60 fps 附近，所以多半是 16.7 ms | 原始碼的設定預設值；實際幾格要真機量 |
| 畫面格數 | 原生 | 最多 1 格：8 ms（120 Hz）、16 ms（60 Hz）。省電模式、機器過熱、輔助使用設定的 Limit Frame Rate 會壓到 60 Hz | Apple 文件的表、WWDC21 講稿。iPhone 沒加 Info.plist 的 key 就只有 60 Hz |
| Web Audio 時鐘顆粒 | 網頁（Safari） | 約 3 ms | 推論：128 frames ÷ 取樣率 |
| Web Audio 時鐘顆粒 | WKWebView | 約 3 ms | 同上。WebKit 有 Web Audio 在播時，會跟系統要 128 frames 的 I/O buffer（原始碼）；系統給不給要真機量 |
| 聲音時鐘顆粒 | 原生 | 一個 I/O 週期。預設約 20 ms，可以要求到 5 ms 或更短，一般最長 93 ms | 推論：`lastRenderTime` 每個 I/O 週期更新一次。數字出自 Apple 文件（20 ms 那句在封存的舊文件）。用 host time 外插可以更細（推論） |
| 有線／內建喇叭輸出延遲 | 網頁（Safari） | 未知，執行時讀 `outputLatency` | 沒找到可信的一般數值 |
| 有線／內建喇叭輸出延遲 | WKWebView | 未知，執行時讀 `outputLatency` | 值來自 `AVAudioSession.outputLatency`（原始碼）。現在的網頁沒有讀它 |
| 有線／內建喇叭輸出延遲 | 原生 | 未知，執行時讀 `AVAudioSession.outputLatency` | Apple 文件沒給一般數值 |
| 藍牙耳機 | 網頁（Safari） | 常見說法 100–250 ms，而且會飄 | 只有二手資料和 Apple 開發者論壇回報（193→260 ms），未確認 |
| 藍牙喇叭、耳機 | WKWebView | 查不到 | 讀到的值跟原生同一個來源（原始碼） |
| 藍牙喇叭、耳機 | 原生 | 查不到 | Apple 文件沒有藍牙延遲的數字，也沒寫 `outputLatency` 在藍牙上準不準。論壇的討論串這次打不開 |
| AirPlay | 原生 | 「can result in a 2-second delay」 | `AVAudioSession.outputLatency` 的文件。這句話沒說 `outputLatency` 會不會回報這 2 秒 |
| AirPlay | 網頁（Safari）、WKWebView | 查不到 | — |
| 畫面合成到真的亮在螢幕上 | 三種都是 | 查不到 | `targetTimestamp` 是合成的時間，之後的延遲文件沒寫 |

對照（照第 1 節）：60 BPM 一拍 1000 ms；150 BPM 一拍 400 ms；170 BPM 一拍 353 ms。AirPlay 的 2 秒在 150 BPM 是 5 拍（推論：2000 ÷ 400）。

## 現在的網頁怎麼做

出自這個 repo 的程式，不是外部來源。`src/lib/audio/engine.ts`、`player.ts`、`stretch.ts`、`decode.ts`、`src/lib/playback.svelte.ts`、`src/lib/local-settings.ts`。

- 用 Web Audio 播：每個音樂段是一個 `AudioBufferSourceNode.start(when, offset, duration)`，一次把整個播放計畫排進去。
- 播放頭每一格畫面（`requestAnimationFrame`）算一次：`getOutputTimestamp()` 的 `contextTime`，加上從 `performanceTime` 到現在過了多久。**沒有讀 `outputLatency`。**
- 使用者可以自己調**延遲校正**（±1000 毫秒，存在瀏覽器裡，預設 0）。畫面上的播放頭會扣掉它。
- 起播往後留 0.1 秒（`LEAD_SEC`）才出聲。
- **重複**：喇叭播到這一圈結尾前 0.5 秒（`LAP_AHEAD_SEC`）才排下一圈，緊接在結尾。
- **慢速**（0.75、0.5 倍）：先用自己寫的 WSOLA 把整個音樂檔拉長成另一份 `AudioBuffer`，再照常排。程式註解寫 3 分鐘的歌約半秒。
- **節拍器**：每一拍一個 `OscillatorNode`，排在 Web Audio 的時鐘上。
- **拍點的提示音：現在沒有。** `src` 裡找不到。
- `navigator.audioSession.type = 'playback'`：有設（`decode.ts`），為了 iPad、iPhone 開靜音時照樣出聲。
- 沒有用 Media Session API，所以鎖定畫面的播放鍵不會叫到網頁的程式。
- 分頁到背景時 `requestAnimationFrame` 會停，播放頭不動；回來後錯過的圈不補（`player.ts` 的註解）。

## 原生：喇叭現在播到第幾秒、輸出延遲

### 播到哪

`AVAudioTime` 同時帶兩種時間。[AVAudioTime]：

> The `AVAudioTime` object represents a single moment in time in two ways:
> As host time, using the system’s basic clock with `mach_absolute_time()`
> As audio samples at a particular sample rate

`AVAudioPlayerNode` 有自己的時間軸。[AVAudioPlayerNode]：

> The usual `AVAudioNode` sample times, which `lastRenderTime` observes, have an arbitrary zero point. The `AVAudioPlayerNode` class superimposes a second player timeline on top of this to reflect when the player starts and intervals when it pauses. The methods `nodeTime(forPlayerTime:)` and `playerTime(forNodeTime:)` convert between the two.

- `lastRenderTime`：「This value is `nil` if the engine isn’t running or if you don’t connect the node to an input or output node.」已確認。
- `playerTime(forNodeTime:)` 回傳「A time relative to the player’s start time, or `nil` if the player isn’t playing.」已確認。
- `pause()`：「The player’s sample time doesn’t advance while the node is in a paused state.」已確認。
- `stop()`：「It resets the node’s sample time to `0`」。已確認。
- `lastRenderTime` 的 host time 指的是「算的那一刻」還是「出聲的那一刻」，文件沒寫。**查不到。**
- `lastRenderTime` 多久更新一次，文件沒寫。**查不到。** 每個 I/O 週期一次是推論。

把 host time 換成 sample 數的函式。[extrapolateTime]：

> If `anchorTime` is an `AVAudioTime` instance where both host time and sample time are valid, and the receiver is another timestamp where only one of the two is valid, this method returns a new `AVAudioTime`.

所以「現在這一刻的 host time」可以用最近一次的 `lastRenderTime` 當錨，換成 sample 數（推論：文件說有這個函式，沒有示範這種用法）。

### 輸出延遲

讀得到的值有四個，都已確認有這個 API：

| 值 | 文件怎麼寫 | 來源 |
|---|---|---|
| `AVAudioSession.outputLatency` | 「The latency for audio output, in seconds.」 | [outputLatency] |
| `AVAudioIONode.presentationLatency`（引擎的 `outputNode`） | 「The presentation or hardware latency, applicable when rendering to or from an audio device.」「This corresponds to `kAudioDevicePropertyLatency` and `kAudioStreamPropertyLatency`.」 | [presentationLatency] |
| `AVAudioNode.outputPresentationLatency` | 「The maximum render pipeline latency downstream of the node, in seconds.」「This latency describes the maximum time it takes to present the audio at the output of a node.」 | [outputPresentationLatency] |
| `AVAudioNode.latency` | 「The processing latency of the node, in seconds.」「A value of `0` indicates either no latency or an unknown latency.」 | [latency] |

- 本機 SDK 標頭對 `AVAudioSession.outputLatency` 的註解是「The current hardware output latency in seconds.」。
- 本機 SDK 標頭對 `outputPresentationLatency` 多寫了一段：這個值會隨引擎重新設定而變，「it is recommended not to cache this value and fetch it whenever it's needed」。
- 播完的回呼也分三種。`dataPlayedBack`：「It accounts for both signal processing latencies downstream of the player in the engine, and (possibly significant) latency in the audio playback device.」`dataRendered`：「This case doesn’t account for any signal processing latencies downstream of the player in the engine.」已確認。[callback]
- 這四個值在內建喇叭、有線耳機、藍牙上各是多少、準不準：**查不到**。

### I/O buffer

`AVAudioSession.setPreferredIOBufferDuration(_:)`。[ioBuffer]：

> The typical maximum I/O buffer duration is 0.093 seconds (corresponding to 4,096 sample frames at a sample rate of 44.1 kHz). The minimum I/O buffer duration is at least 0.005 seconds (256 frames) but might be lower depending on the hardware in use.

- 這是「要求」，實際值要讀 `ioBufferDuration`。已確認。
- 預設值：封存的舊文件 Audio Session Programming Guide 寫「The default audio I/O buffer duration (about 0.02 seconds for 44.1 kHz audio) provides sufficient responsiveness for most apps.」。已確認，但這是封存文件，現在的機器是不是還這樣要真機量。

## 藍牙、AirPods、AirPlay

- **AirPlay**：`AVAudioSession.outputLatency` 的文件整段只有這兩句：「Using an AirPlay-enabled device for your audio content can result in a 2-second delay. Check for this delay in game content.」已確認。它沒說 `outputLatency` 的值會不會等於這個延遲。
- **藍牙**：Apple 文件有藍牙的輸出種類（`bluetoothA2DP`：「An output to a Bluetooth A2DP device.」；`bluetoothLE`；`bluetoothHFP`），app 可以從 `currentRoute.outputs` 的 `portType` 知道現在是不是接藍牙（`bluetoothLE` 那一頁有這樣的範例程式）。已確認。[bluetoothA2DP]、[bluetoothLE]
- A2DP：「A2DP is a stereo, output-only profile intended for higher bandwidth audio use cases, such as music playback. The system automatically routes to A2DP ports if you configure an app’s audio session to use the `ambient`, `soloAmbient`, or `playback` categories.」已確認。[allowBluetoothA2DP]
- **藍牙延遲幾毫秒**：Apple 文件**查不到**。
- **`outputLatency` 在藍牙上含不含無線那一段、準不準、會不會飄**：Apple 文件**查不到**。
- 換了輸出裝置時 app 會收到 `routeChangeNotification`，可以在那時重讀延遲（推論：文件說有通知，沒說延遲值何時更新）。[route]
- 輸出裝置的聲道數或取樣率變了，`AVAudioEngine` 會自己停下來：「the audio engine stops, uninitializes itself, and issues this notification」。已確認。換到藍牙會不會觸發，文件沒寫。[configChange]
- Apple 開發者論壇有兩串回報（搜尋結果的摘要寫：回報的值約 160 ms、實測開頭約 180 ms；另一串寫一分鐘內從 193 飄到 260 ms）。**這次兩串都打不開**（論壇擋自動存取），只看過搜尋工具的摘要，**未確認**，而且是非官方。

## 這六件事原生各怎麼做

| 事 | 現在的網頁 | 原生的 API | 狀態 |
|---|---|---|---|
| 從某一拍開始播 | `start(when, offset, duration)` | `scheduleSegment(_:startingFrame:frameCount:at:…)`：`startingFrame` 是「The starting frame position in the stream.」，`frameCount` 是「The number of frames to play.」 | 已確認。拍換成 frame 是自己算（第一拍、BPM、取樣率） |
| 變速不變調 | 先用 WSOLA 拉長整個檔 | `AVAudioUnitTimePitch`：引擎裡的一個節點，速度 1/32 到 32。或 `AVAudioPlayer.rate`：0.5 到 2.0，不變調 | 已確認有 API 和範圍。邊播邊變速、不用先拉長整個檔是推論。音質、對拍準不準要真機聽 |
| 重複範圍 | 每圈快播完才排下一圈 | 再排一段 `scheduleSegment`，`when` 給 `nil` 就緊接上一段。buffer 另有 `.loops`、`.interruptsAtLoop` | 已確認 |
| 音樂段接音樂段 | 都排在同一個 Web Audio 時鐘 | 同一個播放器連排幾段，或給每段一個 sample time | 已確認 |
| 節拍器 | 每拍一個 `OscillatorNode` | `scheduleBuffer(_:at:…)` 排一小段聲音，或 `AVAudioSourceNode` 自己算波形 | 已確認有 API |
| 拍點的提示音 | 現在沒有 | 同節拍器。要唸字的話，`AVSpeechSynthesizer.write(_:toBufferCallback:)` 可以先把語音做成 buffer | 已確認有 API |

### 排程

[AVAudioPlayerNode] 的原文：

> You can schedule buffers and segments to play at specific points in time or to play immediately following preceding segments.

`when` 的規則（同一頁）：

- `nil`：「If there are previous commands, the new one plays immediately following the last one.」
- sample time：照這個 sample 播。本機 SDK 標頭多寫一句：「relative to the node's start time (which begins at 0 when the node is started)」。
- host time：「the system ignores it unless the sample time is invalid when the engine is rendering to an audio device」。

注意的地方：

- 「When playing buffers, there’s an implicit assumption that the buffers are at the same sample rate as the node’s output format.」已確認。
- 播檔案的一段時，取樣率不同節點會自己轉。已確認。
- `play(at:)` 可以指定播放器從哪個時間開始走。文件的例子是往後 0.5 秒。**`play()` 和 `play(at:)` 在 iOS 27.0 標成淘汰**，新的是 `playAudio()`、`playAudio(at:)`（iOS 27.0 起）。已確認。
- `playAudio(at:)`：「Note that providing an AVAudioTime which is past (before lastRenderTime) will cause the player to begin playback immediately.」已確認。
- `stop()`：「Clears all events you schedule, including any events in the middle of playing.」已確認。
- buffer 的選項：`.loops`「An option that indicates the buffer loops indefinitely.」；`.interruptsAtLoop`「An option that indicates the buffer interrupts any buffer in a playing state at its loop point.」已確認。[bufferOptions]
- 完成的回呼：「Don’t stop a player within a completion handler callback because it can deadlock while trying to unschedule already scheduled buffers.」已確認。
- 播放器停了，引擎和硬體不會跟著停：「Pausing or stopping all of the players you connect to an engine doesn’t pause or stop the engine or the underlying hardware.」已確認。

### 變速不變調

- `AVAudioUnitTimePitch`：「An object that provides a good-quality playback rate and pitch shifting independently of each other.」`rate`：「The default value is 1.0. The range of supported values is `1/32` to `32.0`.」`overlap`：「A higher value results in fewer artifacts in the output signal. The default value is `8.0`. The range of values is `3.0` to `32.0`.」已確認。[TimePitch]
- 它繼承 `AVAudioUnitTimeEffect`，那一頁的摘要是「An object that processes audio in nonreal time.」，內文寫「These effects don’t process audio in real time.」，舉的例子是 `AVAudioUnitVarispeed`。這句話對 `AVAudioUnitTimePitch` 的意思（輸入和輸出的 sample 數不是一比一）是推論。[TimeEffect]
- `AVAudioUnitTimePitch` 自己那一頁只有上面那句摘要和三個屬性，沒有寫它是不是邊播邊處理。它是引擎裡的一種節點：文件的繼承關係是 `AVAudioUnitTimePitch` → `AVAudioUnitTimeEffect` → `AVAudioUnit`；本機 SDK 標頭 `AVAudioUnit.h` 寫「An AVAudioUnit is an AVAudioNode implemented by an audio unit.」。把它接在播放器節點後面、播放時邊播邊變速、不用先把整個檔拉長，是**推論**。
- `AVAudioUnitVarispeed`：會變調。「changing the playback rate also changes the pitch」。範圍 0.25 到 4.0。已確認。
- `AVAudioPlayer.rate`：「This property supports values in the range of `0.5` for half-speed playback to `2.0` for double-speed playback.」「Adjusting the audio’s playback rate doesn’t alter its pitch.」要先把 `enableRate` 設成 `true`。已確認。[AVAudioPlayer.rate]
- `AVPlayer` 另有 `AVAudioTimePitchAlgorithm`：`spectral`「A highest-quality time pitch algorithm that’s suitable for music.」；`timeDomain`「A modest quality time pitch algorithm that’s suitable for voice.」已確認。[TimePitchAlgorithm]
- 引擎可以離線算，比即時快：「You can configure the engine to operate in manual rendering mode when you need to render at, or faster than, real time.」已確認。[AVAudioEngine]
- **播放器後面接了 `AVAudioUnitTimePitch`、速度不是 1 時，`playerTime` 怎麼換成喇叭的時間：查不到。** 文件沒寫。
- `AVAudioUnitTimePitch` 自己的處理延遲會不會算進 `latency`、`outputPresentationLatency`：這兩個屬性的定義包含節點的處理延遲（已確認），但 0 也可能是「不知道」。實際值**查不到**。

### 節拍器、拍點的提示音

- 排一小段 buffer：`scheduleBuffer(_:at:…)` 的 `when` 跟音樂用同一種 sample time。已確認有 API。
- 節拍器和音樂用兩個播放器時怎麼對齊起點：文件有 `AVAudioPlayer.play(atTime:)` 的例子（「Use this method to precisely synchronize the playback of two or more audio player objects」），`AVAudioPlayerNode` 的例子沒找到。兩個節點用同一個 `play(at:)` 時間是推論。[`play(atTime:)`][playAtTime]
- `AVAudioSourceNode`：自己在回呼裡填聲音。回呼會拿到 `timestamp`：「The HAL time the audio data renders.」「When rendering to a device, avoid making blocking calls within the block.」已確認。[SourceNode]
- 語音：`AVSpeechSynthesizer.write(_:toBufferCallback:)`：「Call this method to receive audio buffers to store or further process synthesized speech.」已確認。[speech]

## 背景、鎖定螢幕、來電、靜音鍵、鎖定畫面的播放鍵

| 情況 | 原生 | WKWebView | 網頁（Safari） |
|---|---|---|---|
| 靜音鍵 | 預設（`soloAmbient`）會靜音。設成 `playback` 就不會。已確認 | Web Audio 預設是 ambient，會靜音；`navigator.audioSession.type = 'playback'` 就不會。已確認（原始碼、WebKit 工程師留言） | 同 WKWebView（同一套程式）。現在的網頁有設 |
| 鎖定螢幕、切到背景 | `playback` 加 `UIBackgroundModes` 的 `audio`，聲音繼續。已確認 | WebKit 在 app 進背景時會中斷 Web Audio；audio session 的種類是 `playback` 或 `play-and-record` 時不中斷。已確認（原始碼）。WebKit 工程師說 WKWebView 的 app 還要有 `UIBackgroundModes` 的 `audio`。實際行為要真機量 | 原始碼同一條路。Safari 實際怎樣沒有實測資料 |
| 背景時畫面 | `CADisplayLink` 在背景還叫不叫，沒查 | `requestAnimationFrame` 會停（第 1 節）；回前景後播放頭怎麼接上要真機量 | 同 WKWebView |
| 來電 | audio session 被打斷，收到通知；結束時系統建議要不要接著播。已確認 | 有一張還開著的 bug：來電後 Web Audio 永久沒聲音（iOS 15.6，非官方回報；WebKit 工程師在 iOS 16 測試版重現不出來） | 那張 bug 的回報者說 Safari 沒這個問題（非官方） |
| 鎖定畫面的播放鍵 | `MPNowPlayingInfoCenter` 加 `MPRemoteCommandCenter`。已確認 | Media Session API（BCD：Safari 15 起，WKWebView 照 Safari）。WebKit 只在 audio session 種類是 `playback` 或 `play-and-record` 時，才讓 Web Audio 有資格當「播放中」。已確認（原始碼）。現在的網頁沒用 Media Session | 同 WKWebView |
| 拔掉耳機、藍牙斷線 | 收到 `routeChangeNotification`；Apple 要 app 自己暫停。已確認 | 查不到 | 查不到 |

### 原生的引文

audio session 的種類。[playback]：

> When using this category, your app audio continues with the Silent switch set to silent or when the screen locks. (The switch is called the Ring/Silent switch on iPhone.) To continue playing audio when your app transitions to the background (for example, when the screen locks), add the `audio` value to the `UIBackgroundModes` key in your information property list file.

- 預設的 `soloAmbient`：「Your audio is silenced by screen locking and by the Silent switch (called the Ring/Silent switch on iPhone).」已確認。
- `ambient`：「Screen locking and the Silent switch (on iPhone, the Ring/Silent switch) silence your audio.」已確認。
- 背景模式。[mediaPlayback]：「With this capability enabled, your app’s audio continues when people switch to another app or lock their iOS device.」已確認。
- 系統把 app 暫停時：「Starting in iOS 10, the system deactivates the audio session of most apps when it suspends the app process.」已確認。[appWasSuspended]

打斷。[interruptions]：

> In iOS 27, tvOS 27, visionOS 27, and watchOS 27 and later, `AVAudioSession` posts a set of life-cycle notifications that model interruptions as deactivation and resumption events rather than as begin and end signals.

- 新的三個通知：`didBecomeActiveNotification`、`didBecomeInactiveNotification`、`resumptionRecommendationNotification`。已確認。
- 舊的：「When deploying to iOS 26, tvOS 26, visionOS 26, or watchOS 26 and earlier, observe `interruptionNotification` directly. In later releases, the system deprecates this notification」。`AVAudioSession.InterruptionType` 在 iOS 27.0 標成淘汰。已確認。
- 來電用橫幅顯示時，可以要求先不打斷：`setPrefersNoInterruptionsFromSystemAlerts(_:)`，「The system only interrupts the audio session if the user accepts the call.」用全螢幕顯示來電時沒有用。已確認。[noInterruptions]
- 被打斷時 `AVAudioEngine` 和播放器的時間軸會怎樣（停在哪、回來後 sample time 接不接得上），文件**查不到**。
- 系統的媒體服務重啟時（很少見），要把播放器、audio session 全部重建。已確認。[mediaReset]

拔耳機。[route]：

> Applications should respect this implicit privacy request and automatically pause playback when users disconnect their headphones.

鎖定畫面。

- `MPNowPlayingInfoCenter`：「The system displays Now Playing information on the device’s Lock Screen and in the media controls in Control Center.」已確認。[nowPlaying]
- 播了多久不用一直更新：「Elapsed time is automatically calculated, by the system, from the previously provided elapsed time and the playback rate.」慢速要另外填 `MPNowPlayingInfoPropertyPlaybackRate`（0.5 是一半的速度）。已確認。
- `MPRemoteCommandCenter`：「An object that responds to remote control events sent by external accessories and system controls.」有播放、暫停、切換、上一首、下一首、改播放位置、改速度等指令。已確認。[remoteCommand]
- `longFormAudio` 的文件寫播音樂這類長內容的 app「should also use the `Media Player` framework to add support for remote control events and to provide Now Playing information」。已確認。

## 畫面更新（120 Hz）和聲音時鐘

### 原生

哪些機器是 ProMotion。[ProMotion]：

> ProMotion displays are capable of dynamically switching between frame rates ranging from 24Hz to 120Hz on iPad Pro, and from 10Hz to 120Hz on supported iPhone devices.

- 同一頁列的機器：「iPhone 13 Pro and later」「iPhone 13 Pro Max and later」「iPhone 17 and later」「iPhone Air」；iPad Pro 10.5 吋、11 吋、12.9 吋（第 2 代起）、13 吋。表上的 iPad 只有 iPad Pro。已確認。
- 更新率和一格多久（同一頁的表）：120 Hz（8 ms）、80 Hz（12 ms）、60 Hz（16 ms）、48 Hz（20 ms）、40 Hz（25 ms）、30 Hz（33 ms）、24 Hz（41 ms），再往下到 10 Hz。80 Hz、48 Hz 和 20 Hz 以下只有 iPhone。已確認。
- iPhone 要另外開：「If you don’t enable this support, Core Animation won’t access higher frame rates (above 60Hz).」「The iPad Pro doesn’t require this special configuration.」key 是 `CADisableMinimumFrameDurationOnPhone`。已確認。
- app 不能指定更新率：「you can’t force a ProMotion display to show your content at any specific rate」。已確認。
- 會被壓到 60 Hz 的情況（WWDC21 講稿）：「The user can turn on Limit Frame Rate toggle in Accessibility settings that caps the maximum frame rate to 60Hz. Also, when the device gets hot, the system may apply restrictions on the availability of 120Hz. With iPadOS 15, we'll also enforce the 60Hz cap in Low Power Mode.」已確認。[WWDC21]

每一格要用哪個時間。[ProMotion]：

> Always use `targetTimestamp` to drive any animation, physics, or other time-related content provided in your `CADisplayLink` callback.

- WWDC21 講稿：`timestamp`「denotes when the callback is scheduled to be invoked」，`targetTimestamp`「is when the next frame will be composited by CoreAnimation」。已確認。
- 回呼可能被跳過：「If the completion time for a `CADisplayLink` callback exceeds the `targetTimestamp`, the next refresh interval doesn’t receive a callback.」已確認。
- 「Don’t use timers or other strategies that don’t properly align with the Core Animation display refresh cycle.」已確認。

跟聲音時鐘的關係：

- `CACurrentMediaTime()` 回傳「A `CFTimeInterval` derived by calling `mach_absolute_time()` and converting the result to seconds.」已確認。[CACurrentMediaTime]
- Apple 的文件直接拿 `CACurrentMediaTime()` 跟 `targetTimestamp` 相減、相比（「subtract the value returned by `CACurrentMediaTime()` from `targetTimestamp`」）。所以 `targetTimestamp` 也是這個時鐘。已確認。[ProMotion]
- `AVAudioTime` 的 host time 用 `mach_absolute_time()`，`AVAudioTime.seconds(forHostTime:)` 把它換成秒。已確認。
- 所以「下一格畫面的時間」可以換成聲音的 sample 數，不用猜（推論：兩邊文件各自寫了同一個時鐘，沒有一頁把兩件事寫在一起）。
- `targetTimestamp` 是「合成」的時間。合成完到螢幕真的亮，還要多久：**查不到**。

### WKWebView 和 Safari

- WebKit 有一個設定 `PreferPageRenderingUpdatesNear60FPSEnabled`，說明是「Prefer page rendering updates near 60 frames per second rather than using the display's refresh rate」，預設 `true`（visionOS 是 `false`），狀態 `stable`。已確認（原始碼）。[wk-prefs]
- 這個設定在 WKWebView 的 app 裡能不能改：公開的 WKWebView API 裡**查不到**。
- 所以網頁的播放頭在 120 Hz 的機器上多半一秒只更新約 60 次（推論，要真機量）。

## WKWebView 裡的 Web Audio

以下都是 WebKit 原始碼（commit `7bd8f0d`，2026-11-20）。

### `outputLatency` 怎麼算

[`AudioContext.cpp`][wk-AudioContext]：

```cpp
double AudioContext::outputLatency()
{
    lazyInitialize();

    if (!isPlaying())
        return 0;
    if (noiseInjectionPolicies())
        return 512 / sampleRate(); // A fixed, but reasonable value for most platforms.

    return protect(destination())->outputLatency().toDouble();
}
```

- 沒在播時是 0。
- 有 `noiseInjectionPolicies()`（防指紋追蹤的雜訊保護）時回固定值，不是真的延遲。什麼情況下 WKWebView 會開這個保護：**查不到**。
- 真的值來自 [`RemoteAudioDestinationProxy.cpp`][wk-RemoteDest]：輸出 audio unit 的延遲，加 `AudioSession::singleton().outputLatency()`。
- iOS 上後者就是 [`AudioSessionIOS.mm`][wk-AudioSessionIOS]：`[[AVAudioSession sharedInstance] outputLatency]` 乘取樣率。
- 所以 WKWebView（和 Safari）讀到的 `outputLatency`，準不準跟原生的 `AVAudioSession.outputLatency` 一樣（推論：同一個來源；中間多一段把聲音從網頁的 process 送到 GPU process 的緩衝，有沒有算進去沒看到）。

### `getOutputTimestamp()` 怎麼算

[`AudioContext.cpp`][wk-AudioContext]：

```cpp
AudioTimestamp AudioContext::getOutputTimestamp()
{
    auto position = outputPosition();

    // The timestamp of what is currently being played (contextTime) cannot be
    // later than what is being rendered. (currentTime)
    position.position = Seconds { std::min(position.position.seconds(), currentTime()) };
```

- `outputPosition()` 是最近一次算聲音時存下來的 `{position, timestamp}`（`BaseAudioContext::handlePreRenderTasks`）。
- 在 GPU process 那條路（[`RemoteAudioDestinationProxy::renderAudio`][wk-RemoteDest]），`position` 是「已經算了幾個 frame ÷ 取樣率」，`timestamp` 是算的那一刻的 `mach_absolute_time()`。
- 這個函式裡**沒有扣 `outputLatency`**。已確認（原始碼）。
- `performanceTime` 經過 `relativeTimeFromTimeOriginInReducedResolution`，解析度被降低過。已確認（原始碼）。
- 所以現在網頁算的「喇叭正在播的那一刻」，在 Safari 和 WKWebView 上其實是「聲音算到的那一刻」。畫面會比喇叭早大約一個輸出延遲，加上中間的緩衝（推論，要真機量）。延遲校正現在就是在補這一段。

### I/O buffer 和 audio session

[`MediaSessionManagerCocoa.mm`][wk-MSMCocoa] 的 `updateSessionState()`：

- 有 Web Audio 時，跟系統要的 buffer 是 `AudioUtilities::renderQuantumSize`（128 frames）。已確認（原始碼）。
- audio session 的種類：網頁有指定（`navigator.audioSession.type`）就用指定的；有 `<audio>`、`<video>` 在出聲是 `MediaPlayback`；**只有 Web Audio 是 `AmbientSound`**。已確認（原始碼）。
- 這段規則前面有一個開關（`shouldManageAudioSessionCategory()`），關著就不設種類。GPU process 啟動時在 iOS 系列把它打開（[`GPUProcess.cpp`][wk-GPUProcess]）。已確認（原始碼）。
- `navigator.audioSession.type` 對到的種類（[`DOMAudioSession.cpp`][wk-DOMAudioSession]）：`playback` → `MediaPlayback`；`ambient`、`transient` → `AmbientSound`；`transient-solo` → `SoloAmbientSound`；`play-and-record` → `PlayAndRecord`；`auto` → 交給上面的規則。已確認（原始碼）。
- W3C 的 Audio Session 規格（2024-11-13 工作草案）也寫 `AudioContext`「Its default type is ambient」，`HTMLMediaElement`「Its default type is playback」。已確認。[w3c-audio-session]
- WebKit 工程師 Jean-Yves Avenard（[bug 237322][bug-237322]，2024-09-25）：「By default the type is `ambient` and so audio will be muted if the phone is muted.」
- 這個 audio session 設在 WebKit 的 GPU process 裡，再標記成屬於顯示網頁的那個 app（[`RemoteAudioSessionProxyManager.cpp`][wk-RASPM]、`AudioSessionIOS::setHostProcessAttribution`、`setPresentingProcesses`）。已確認（原始碼）。
- app 自己的 `AVAudioSession` 設定管不管得到 WKWebView 的聲音：**查不到**。

### 背景

[`MediaSessionManagerIOS.mm`][wk-MSMIOS]：

```cpp
addRestriction(PlatformMediaSession::MediaType::WebAudio, MediaSessionRestriction::BackgroundProcessPlaybackRestricted);
```

- app 進背景時，有這個限制的都會被中斷（`MediaSessionManagerInterface::applicationDidEnterBackground`）。已確認（原始碼）。
- 例外在 [`AudioContext::shouldOverrideBackgroundPlaybackRestriction`][wk-AudioContext]：進背景時，如果這個頁面的 audio session 種類是 `Playback` 或 `PlayAndRecord`，就不中斷。已確認（原始碼）。
- WebKit 工程師 Jer Noble（[bug 198277][bug-198277]，2022-02-08）：「On iOS, WebAudio is considered "Ambient" audio from the system's perspective, and ambient audio is blocked by the system once the app producing it is no longer foreground.」
- [bug 237878][bug-237878]「AudioContext is suspended on iOS when page is backgrounded」狀態是 RESOLVED FIXED（最後更動 2023-02-01）。WebKit 工程師 youenn fablet 在 2022-06-07 寫修正「should be in the iOS 16 beta 1」；有回報者說 iOS 16 測試版還是會停（非官方）。
- WKWebView 特有的一點，youenn fablet（[bug 226620][bug-226620]，2022-03-23）：「for WKWebView, muting is happening on iOS in case UIBackgroundModes … does not contain "audio".」這句是在講麥克風那張 bug 時說的。
- 被中斷時 `AudioContext.state` 會變成 `interrupted`：`AudioContext::suspendPlayback()` 在 media session 是 `Interrupted` 時把狀態設成 `State::Interrupted`。已確認（原始碼）。BCD 也有 `interrupted` 這一列。

### 來電

- [bug 243727][bug-243727]「Web Audio API in WKWebView permanently muted after incoming call」：2022-08-09 回報，iOS 15.6。回報者寫 `AudioContext` 的狀態還是 `running` 但沒聲音，不用接電話、響鈴再掛掉就會發生，Safari 沒這個問題。非官方。
- 同一張 bug，youenn fablet（2022-08-16）在 iOS 16 測試版用 WKWebView 試：「It seems to work fine for me on the latest iOS 16 beta. I did not test on 15.6 though.」
- 這張 bug 到 2026-11-20 狀態還是 NEW，最後更動 2022-08-16。現在的 iOS 上還會不會發生：**查不到**，要真機量。

### 要使用者動作才出聲

- WebKit 的設定 `RequiresUserGestureForAudioPlayback`，iOS 系列預設 `true`。已確認（原始碼）。
- BCD 對 `AudioContext` 的註記：「New audio contexts are suspended until the `resume()` method is called via user action, such as the `click` event.」已確認。
- WKWebView 的 app 可以設 `WKWebViewConfiguration.mediaTypesRequiringUserActionForPlayback`：「Use `WKAudiovisualMediaTypeNone` to indicate that no user gestures are required to begin playing media.」已確認。這個設定管不管得到 Web Audio 的 `resume()`：文件**查不到**。

### 跟 Safari 一不一樣

- 一樣的：API 支援度（BCD 這次查的幾列都寫照 Safari）、`outputLatency` 和 `getOutputTimestamp()` 的算法、Web Audio 預設是 ambient、進背景的中斷規則。這些在原始碼裡沒有分 Safari 和 WKWebView。已確認（原始碼、BCD）。
- 找到的不同：`UIBackgroundModes` 要 app 自己加（WebKit 工程師留言）；來電後沒聲音的 bug 只在 WKWebView（非官方回報）。
- 同一段程式、結果跟著 app 走的：audio session 會標記成屬於顯示網頁的那個 app，在 WKWebView 就是包它的 app（原始碼）。
- 實際的延遲毫秒數兩邊一不一樣：**查不到**，沒有任何一手的實測數字。

## 要在真機上量的事

這些是文件和原始碼都答不了的。這台 Mac 沒有 Xcode，這次都沒量。

1. `AVAudioSession.outputLatency`、`outputNode.presentationLatency` 在內建喇叭、有線、場館用的藍牙喇叭、AirPods、AirPlay 上各回多少；跟實際聽到的差多少；播放中會不會變。
2. `lastRenderTime` 的 host time 是「算的那一刻」還是「出聲的那一刻」；多久更新一次。
3. 用 `lastRenderTime` 加輸出延遲算出來的播放頭，跟喇叭實際的聲音差幾毫秒。
4. 同一台機器、同一個喇叭：網頁（Safari）、WKWebView、原生三種的播放頭各比聲音早或晚多少。
5. WKWebView 裡 `AudioContext.outputLatency` 回多少，跟原生讀到的 `AVAudioSession.outputLatency` 一不一樣；`baseLatency` 回多少。
6. WKWebView 裡 `requestAnimationFrame` 在 120 Hz 的 iPad Pro、iPhone 上一秒叫幾次。
7. 原生 `CADisplayLink` 在 iPhone 有沒有加 `CADisableMinimumFrameDurationOnPhone` 時各是幾 Hz；省電模式下幾 Hz。
8. WKWebView 的 app 有 `UIBackgroundModes` 的 `audio`、網頁設了 `audioSession.type = 'playback'` 時：鎖定螢幕、切到別的 app，Web Audio 還播不播；回來後播放頭接不接得上。
9. 來電（接、不接都試）之後：WKWebView 的 Web Audio 有沒有聲音、`AudioContext.state` 是什麼；原生的引擎和播放器時間軸停在哪。
10. 靜音鍵開著時三種各有沒有聲音。
11. 播放中接上、拔掉藍牙喇叭：三種各會怎樣（停、繼續、播放頭偏掉）；`AVAudioEngine` 會不會自己停。
12. `AVAudioUnitTimePitch` 在 0.75、0.5 倍的音質，跟現在的 WSOLA 比；它的 `latency` 回多少；變速時播放頭怎麼換算才對得上拍。
13. 原生連排兩段（重複範圍的 B 接 A、音樂段接音樂段）有沒有空隙或爆音。
14. 節拍器和音樂用兩個播放器節點時，起點對不對得齊。
15. WKWebView 裡 Media Session 的播放鍵會不會出現在鎖定畫面、按了叫不叫得到網頁。

## 沒找到

- Apple 對藍牙（A2DP、AirPods）延遲的任何數字。
- `AVAudioSession.outputLatency` 含不含藍牙無線那一段、準不準的官方說法。
- AirPlay 時 `outputLatency` 會不會回報那 2 秒。
- `lastRenderTime` 的更新頻率，和它的 host time 指哪一刻。
- 變速（`AVAudioUnitTimePitch`）時播放器時間和喇叭時間的換算。
- 被打斷（來電）時 `AVAudioEngine`、`AVAudioPlayerNode` 的時間軸會怎樣。
- 畫面合成之後到螢幕真的亮的延遲。
- WKWebView 能不能關掉「畫面更新壓在 60 fps 附近」。
- app 自己的 `AVAudioSession` 設定對 WKWebView 的聲音有沒有作用。
- `mediaTypesRequiringUserActionForPlayback` 對 Web Audio 有沒有作用。
- WKWebView 什麼情況下會讓 `outputLatency` 回固定值（雜訊保護）。
- 任何 Safari、WKWebView、原生三種的實測延遲比較。
- 人對音畫不同步的察覺門檻（第 1 節的 ITU-R BT.1359 那一條）這次沒有重查。
- 2014 到 2017 年 WWDC 的音訊場次講稿。試了 Apple 網站的 `videos/play/wwdc2014/501`、`wwdc2014/502`、`wwdc2015/507`、`wwdc2016/507`、`wwdc2017/501`、`wwdc2017/509`，都轉到該年的影片列表，沒有講稿可讀。這幾個場次編號是憑印象試的，沒有確認各是哪一場。

## 來源

查核日期都是 2026-11-20。

Apple 開發者文件（頁面是 JavaScript 產生的；讀的是同一份內容的 JSON，網址是把 `https://developer.apple.com/documentation/…` 換成 `https://developer.apple.com/tutorials/data/documentation/….json`。下載後，每一頁的說明文字整段讀完；只列成員名稱的清單沒有細讀）：

- AVFAudio：[AVAudioEngine]、[AVAudioPlayerNode]、[AVAudioTime]、[extrapolateTime]、[lastRenderTime]、[latency]、[outputPresentationLatency]、[presentationLatency]、[callback]、[bufferOptions]、[`play(at:)`][playAt]、[`playAudio(at:)`][playAudioAt]、[`scheduleSegment`][scheduleSegment]、[`stop()`][stop]、[TimePitch]、[TimeEffect]、[Varispeed]、[SourceNode]、[speech]、[configChange]
- AVAudioSession：[outputLatency]、[ioBuffer]、[playback]、[ambient]、[soloAmbient]、[bluetoothA2DP]、[bluetoothLE]、[allowBluetoothA2DP]、[interruptions]、[route]、[noInterruptions]、[appWasSuspended]、[mediaReset]、[longFormAudio]
- AVAudioPlayer：[deviceCurrentTime]、[`play(atTime:)`][playAtTime]、[AVAudioPlayer.rate]
- AVFoundation：[mediaPlayback]、[TimePitchAlgorithm]
- 背景模式：[UIBackgroundModes]、[backgroundModes]
- MediaPlayer：[nowPlaying]、[remoteCommand]、[elapsed]
- 畫面：[CADisplayLink]、[targetTimestamp]、[ProMotion]、[CACurrentMediaTime]、[minFrameDuration]
- WebKit（app 這邊）：[mediaTypesRequiringUserAction]
- Safari 版本說明：[16.4][safari-16.4]、[18.4][safari-18.4]、[總頁][safari-notes]。用關鍵字找，沒有整頁讀。

Apple 的封存文件：

- [Audio Session Programming Guide：Optimizing for Device Hardware][aspg]。封存頁，只用了 I/O buffer 預設值那一句。

WWDC 講稿（Apple 網站的影片頁，下載後整篇讀完）：

- [WWDC21 #10147 Optimize for variable refresh rate displays][WWDC21]
- [WWDC19 #510 What's New in AVAudioEngine][WWDC19]：整篇讀完，跟這張票有關的只有 `AVAudioSourceNode`，沒有引用。

本機 SDK 標頭（沒有網址）：

- `MacOSX27.0.sdk` 的 `AVFAudio.framework/Headers`：`AVAudioPlayerNode.h`、`AVAudioNode.h`、`AVAudioIONode.h`、`AVAudioSession.h`、`AVAudioEngine.h`、`AVAudioUnit.h`。只讀了相關的註解。這是 macOS 的 SDK，不是 iOS 的；標頭檔裡自己標了 iOS 的可用版本（例如 `outputLatency` 標 `ios(6.0)`）。

WebKit 原始碼（GitHub 上的 `WebKit/WebKit`，commit `7bd8f0da9022db94c4f8cbd77f1acc44b674e490`，2026-11-20。只讀了相關的函式，沒有整檔讀）：

- [`AudioContext.cpp`][wk-AudioContext]、[`BaseAudioContext.cpp`][wk-BaseAudioContext]、[`RemoteAudioDestinationProxy.cpp`][wk-RemoteDest]、[`AudioDestinationCocoa.cpp`][wk-DestCocoa]、[`AudioSessionIOS.mm`][wk-AudioSessionIOS]、[`MediaSessionManagerCocoa.mm`][wk-MSMCocoa]、[`MediaSessionManagerIOS.mm`][wk-MSMIOS]、[`MediaSessionManagerInterface.cpp`][wk-MSMInterface]、[`PlatformMediaSession.cpp`][wk-PMS]、[`DOMAudioSession.cpp`][wk-DOMAudioSession]、[`RemoteAudioSessionProxyManager.cpp`][wk-RASPM]、[`GPUProcess.cpp`][wk-GPUProcess]、[`AudioUtilities.h`][wk-AudioUtilities]、[`AudioContextState.idl`][wk-state-idl]、[`UnifiedWebPreferences.yaml`][wk-prefs]

WebKit bug（bugs.webkit.org，下載原頁；讀了第一則和 WebKit 工程師的留言，回報者的留言沒有全讀；狀態用 Bugzilla 的 REST API 查）：

- [198277][bug-198277]（RESOLVED DUPLICATE of 232909）、[237322][bug-237322]（RESOLVED CONFIGURATION CHANGED）、[226620][bug-226620]（RESOLVED CONFIGURATION CHANGED）、[237878][bug-237878]（RESOLVED FIXED）、[243727][bug-243727]（NEW）

其他：

- [MDN browser-compat-data][bcd] 8.1.10（2026-11-19 發布）：`api/AudioContext.json`、`api/BaseAudioContext.json`、`api/AudioSession.json`、`api/Navigator.json`、`api/MediaSession.json`、`browsers/webview_ios.json`。下載原檔讀。讀的是 `main` 分支 2026-11-19 的 commit `5892024`，那時 `package.json` 的版本是 8.1.10。
- [W3C Audio Session][w3c-audio-session]：2024-11-13 工作草案。下載原頁，讀了種類的定義和 `AudioContext` 那一節。
- [WebKit Features in Safari 16.4][webkit-16.4]（webkit.org）：下載原頁，用關鍵字找。

查核限制：

- **沒有真機、沒有 Xcode。** 所有「會怎樣」都出自文件或原始碼，沒有一件是量的。
- **WebKit 原始碼是 `main` 分支當天的樣子。** 哪一版 iOS 帶哪一段程式沒有查。iOS 27.2 上的行為可能不同。
- **原始碼只讀了相關函式。** 「沒有扣 `outputLatency`」是指 `getOutputTimestamp()` 和它用到的 `outputPosition` 這條路上沒看到；別處有沒有補償沒有全部查過。
- **Apple 開發者論壇**（`developer.apple.com/forums/thread/679274`、`/126277`）下載只拿到「Security verification」的頁面，沒讀到內容。這兩串只看過搜尋工具的摘要，文中標成未確認。
- **搜尋工具**只用來找 bug 編號和論壇網址，沒有拿它的摘要當事實；bug 的引文都是從下載的原頁抄的。
- **WWDC 舊場次**（2014–2017 的音訊場次）：試的六個網址都轉到該年的影片列表，沒讀到。沒有用第三方的逐字稿。
- Apple 文件的引文裡，反引號是這份筆記加的（原頁是程式字體），其餘照原文。
- 英文引文都用程式比對過下載的原文，逐字相符（只忽略空白、反引號和彎引號的差別）。
- Apple 文件會改版。`play(at:)` 淘汰、iOS 27 的新通知這些都是 2026-11-20 讀到的樣子。

[Web Audio §1.1.1]: https://www.w3.org/TR/webaudio/
[MDN getOutputTimestamp]: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp
[MDN outputLatency]: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency
[MDN rAF]: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
[MDN performance.now]: https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
[AVAudioEngine]: https://developer.apple.com/documentation/avfaudio/avaudioengine
[AVAudioPlayerNode]: https://developer.apple.com/documentation/avfaudio/avaudioplayernode
[AVAudioTime]: https://developer.apple.com/documentation/avfaudio/avaudiotime
[extrapolateTime]: https://developer.apple.com/documentation/avfaudio/avaudiotime/extrapolatetime(fromanchor:)
[lastRenderTime]: https://developer.apple.com/documentation/avfaudio/avaudionode/lastrendertime
[latency]: https://developer.apple.com/documentation/avfaudio/avaudionode/latency
[outputPresentationLatency]: https://developer.apple.com/documentation/avfaudio/avaudionode/outputpresentationlatency
[presentationLatency]: https://developer.apple.com/documentation/avfaudio/avaudioionode/presentationlatency
[callback]: https://developer.apple.com/documentation/avfaudio/avaudioplayernodecompletioncallbacktype
[bufferOptions]: https://developer.apple.com/documentation/avfaudio/avaudioplayernodebufferoptions
[playAt]: https://developer.apple.com/documentation/avfaudio/avaudioplayernode/play(at:)
[playAudioAt]: https://developer.apple.com/documentation/avfaudio/avaudioplayernode/playaudio(at:)
[scheduleSegment]: https://developer.apple.com/documentation/avfaudio/avaudioplayernode/schedulesegment(_:startingframe:framecount:at:completioncallbacktype:completionhandler:)
[stop]: https://developer.apple.com/documentation/avfaudio/avaudioplayernode/stop()
[TimePitch]: https://developer.apple.com/documentation/avfaudio/avaudiounittimepitch
[TimeEffect]: https://developer.apple.com/documentation/avfaudio/avaudiounittimeeffect
[Varispeed]: https://developer.apple.com/documentation/avfaudio/avaudiounitvarispeed/rate
[SourceNode]: https://developer.apple.com/documentation/avfaudio/avaudiosourcenoderenderblock
[speech]: https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/write(_:tobuffercallback:)
[configChange]: https://developer.apple.com/documentation/avfaudio/avaudioengineconfigurationchangenotification
[outputLatency]: https://developer.apple.com/documentation/avfaudio/avaudiosession/outputlatency
[ioBuffer]: https://developer.apple.com/documentation/avfaudio/avaudiosession/setpreferrediobufferduration(_:)
[playback]: https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback
[ambient]: https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/ambient
[soloAmbient]: https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/soloambient
[bluetoothA2DP]: https://developer.apple.com/documentation/avfaudio/avaudiosession/port/bluetootha2dp
[bluetoothLE]: https://developer.apple.com/documentation/avfaudio/avaudiosession/port/bluetoothle
[allowBluetoothA2DP]: https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetootha2dp
[interruptions]: https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions
[route]: https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes
[noInterruptions]: https://developer.apple.com/documentation/avfaudio/avaudiosession/setprefersnointerruptionsfromsystemalerts(_:)
[appWasSuspended]: https://developer.apple.com/documentation/avfaudio/avaudiosession/interruptionreason/appwassuspended
[mediaReset]: https://developer.apple.com/documentation/avfaudio/avaudiosession/mediaserviceswereresetnotification
[longFormAudio]: https://developer.apple.com/documentation/avfaudio/avaudiosession/routesharingpolicy-swift.enum/longformaudio
[deviceCurrentTime]: https://developer.apple.com/documentation/avfaudio/avaudioplayer/devicecurrenttime
[playAtTime]: https://developer.apple.com/documentation/avfaudio/avaudioplayer/play(attime:)
[AVAudioPlayer.rate]: https://developer.apple.com/documentation/avfaudio/avaudioplayer/rate
[mediaPlayback]: https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback
[TimePitchAlgorithm]: https://developer.apple.com/documentation/avfoundation/avaudiotimepitchalgorithm
[UIBackgroundModes]: https://developer.apple.com/documentation/bundleresources/information-property-list/uibackgroundmodes
[backgroundModes]: https://developer.apple.com/documentation/xcode/configuring-background-execution-modes
[nowPlaying]: https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter
[remoteCommand]: https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter
[elapsed]: https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfopropertyelapsedplaybacktime
[CADisplayLink]: https://developer.apple.com/documentation/quartzcore/cadisplaylink
[targetTimestamp]: https://developer.apple.com/documentation/quartzcore/cadisplaylink/targettimestamp
[ProMotion]: https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays
[CACurrentMediaTime]: https://developer.apple.com/documentation/quartzcore/cacurrentmediatime()
[minFrameDuration]: https://developer.apple.com/documentation/bundleresources/information-property-list/cadisableminimumframedurationonphone
[mediaTypesRequiringUserAction]: https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/mediatypesrequiringuseractionforplayback
[safari-16.4]: https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes
[safari-18.4]: https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes
[safari-notes]: https://developer.apple.com/documentation/safari-release-notes
[aspg]: https://developer.apple.com/library/archive/documentation/Audio/Conceptual/AudioSessionProgrammingGuide/OptimizingForDeviceHardware/OptimizingForDeviceHardware.html
[WWDC21]: https://developer.apple.com/videos/play/wwdc2021/10147/
[WWDC19]: https://developer.apple.com/videos/play/wwdc2019/510/
[wk-AudioContext]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/Modules/webaudio/AudioContext.cpp
[wk-BaseAudioContext]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/Modules/webaudio/BaseAudioContext.cpp
[wk-RemoteDest]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebKit/WebProcess/GPU/media/RemoteAudioDestinationProxy.cpp
[wk-DestCocoa]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/platform/audio/cocoa/AudioDestinationCocoa.cpp
[wk-AudioSessionIOS]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/platform/audio/ios/AudioSessionIOS.mm
[wk-MSMCocoa]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm
[wk-MSMIOS]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/platform/audio/ios/MediaSessionManagerIOS.mm
[wk-MSMInterface]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/platform/audio/MediaSessionManagerInterface.cpp
[wk-PMS]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/platform/audio/PlatformMediaSession.cpp
[wk-DOMAudioSession]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/Modules/audiosession/DOMAudioSession.cpp
[wk-RASPM]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebKit/GPUProcess/media/RemoteAudioSessionProxyManager.cpp
[wk-GPUProcess]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebKit/GPUProcess/GPUProcess.cpp
[wk-AudioUtilities]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/platform/audio/AudioUtilities.h
[wk-state-idl]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WebCore/Modules/webaudio/AudioContextState.idl
[wk-prefs]: https://github.com/WebKit/WebKit/blob/7bd8f0da9022db94c4f8cbd77f1acc44b674e490/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml
[bug-198277]: https://bugs.webkit.org/show_bug.cgi?id=198277
[bug-237322]: https://bugs.webkit.org/show_bug.cgi?id=237322
[bug-226620]: https://bugs.webkit.org/show_bug.cgi?id=226620
[bug-237878]: https://bugs.webkit.org/show_bug.cgi?id=237878
[bug-243727]: https://bugs.webkit.org/show_bug.cgi?id=243727
[bcd]: https://github.com/mdn/browser-compat-data
[w3c-audio-session]: https://www.w3.org/TR/audio-session/
[webkit-16.4]: https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
