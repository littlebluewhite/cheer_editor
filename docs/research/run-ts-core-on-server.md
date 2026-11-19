# 在伺服器上跑 TypeScript 流程核心：事實整理

Issue #188（地圖 #177）的補充調查：伺服器要怎麼跑流程核心的規則。

查核日期：2026-11-06。這份只整理事實，不做決定。

- 標「推論」的是我自己推的，沒有來源。
- 標「本機實測」的是我在這台 Mac（Apple Silicon、macOS）上跑的。數字只能看量級，不等於 Linux 伺服器上的數字。
- 實測用的檔案放在 `/tmp/ts-core-research/`。這是暫存資料夾，重開機可能就不見了。
- 版本、日期都會變，用之前請再查一次。

## 先講結論

### 哪個引擎可以直接跑

- **V8 系（Node、Deno、deno_core）和 Bun：不用改就能跑。** 本機實測 6 組輸入，輸出跟 Node 逐位元組一樣。
- **QuickJS（rquickjs）：一載入就失敗**，錯誤是 `Intl is not defined`。
  - 原因：`text-length.ts` 在模組最上層就執行 `new Intl.Segmenter(...)`。
  - 補一個約 20 行的 `Intl.Segmenter` 墊片之後就能跑。墊片切字的邊界由 Rust 的 `unicode-segmentation` 算。
  - 補上之後，輸出跟 Node 一樣。
- **Boa 0.22：解析就失敗。**
  - 原因：`roles.ts` 有個變數叫 `using`，Boa 把它當成新語法的關鍵字。
  - 這是 Boa 已知的錯（issue #5602），還沒修好。
  - 把這個變數改名後就能跑，輸出也一樣。要開 `intl_bundled` 才有 `Intl.Segmenter`。

### 各選項的成本

| 選項 | 不改能跑嗎 | 要補什麼 | 1 MB 流程每一步（本機實測） | 加到伺服器的東西 |
|---|---|---|---|---|
| deno_core（V8） | 能 | 先打包成一個 JS 檔；建 runtime 前要先進 tokio | 4.5–6.2 毫秒 | 執行檔 60 MB；建置時下載約 39 MB 的 V8 預建庫；不是 `Send`，要專用執行緒 |
| rquickjs（QuickJS-NG） | 不能 | `Intl.Segmenter` 墊片 | 23–52 毫秒 | 執行檔 1.7 MB；要編 C；預設不是 `Send`（`parallel` 是實驗性的） |
| boa_engine | 不能 | 改 `using` 變數名（或等 Boa 修），開 `intl_bundled` | 145–301 毫秒 | 執行檔 28 MB（含 ICU 資料）；不是 `Send` |
| 旁邊另開 Node／Bun／Deno 程序 | 能 | 先打包；自己定程序之間的傳話格式、管好子程序 | JS 裡 3.5–7.4 毫秒，另加傳 1 MB 進出的成本（沒量） | 多一個程序；映像檔 50–86 MB（壓縮後） |
| 改寫成 Rust | — | 約 25 個檔、約 3,400 行程式、53 個指令、112 處擋下的規則；相關測試約 7,500 行 | 沒量 | 規則變成兩套，要一直對齊 |

上表的「每一步」是：`JSON.parse` 整份流程 → 跑一個指令 → `JSON.stringify` 結果。

### 執行緒

- deno_core 的 `JsRuntime`、Boa 的 `Context`、rquickjs 的 `Runtime`（預設 feature）都**不是 `Send`**，不能跨執行緒傳。這是本機編譯檢查的結果，也跟官方文件一致。
- 推論：要跟 tokio 一起用，一般做法是開一條專用執行緒，讓它自己擁有 runtime，再用 channel 把工作送過去。
- ADR 0007 本來就要求同一支流程照順序一步一步套，所以單執行緒不衝突。

## 1. 流程核心用到哪些 JS 內建功能

範圍是 `src/lib/core/` 裡不是 `.test.ts` 的 34 個檔，共 6,042 行（含註解）。我用 grep 掃過一遍，再在六種引擎上實際跑過（見第 2 節）。

### 會讓嵌入式引擎卡住的

| 用到的東西 | 在哪裡 | 說明 |
|---|---|---|
| `Intl.Segmenter`（以 grapheme 切字） | `text-length.ts:24`，在模組最上層建立 | 核心裡唯一用到 `Intl` 的地方。用在 `charCount`、`firstChars`、`charStart`、`tooLong`（名字、備註的字數上限）。因為放在最上層，**引擎沒有 `Intl` 時，整包在載入時就失敗**，不是用到才失敗（本機實測，QuickJS）。 |
| ES2023 的陣列方法 | `toSorted` 4 處、`toSpliced` 10 處、`with` 8 處、`findLast` 2 處、`findLastIndex` 1 處 | QuickJS-NG 和 Boa 都有（本機實測）。打包工具不會補這些：esbuild 用 `--target=es2022` 打包後，這 14 處原封不動（本機實測）。 |
| ES2022 | `Array.prototype.at` 4 處、`Object.hasOwn` 2 處 | 一般引擎都有。 |

### 沒用到的

下面這些都掃過，沒找到：

- 瀏覽器或主機提供的：`structuredClone`、`crypto`（包括 `randomUUID`）、`TextEncoder/TextDecoder`（只出現在 fflate 裡，見下面）、`globalThis`、`window`、`document`、`navigator`、`performance`、`setTimeout`、`queueMicrotask`、`fetch`、`URL`、`Blob`、`console`、`process`、`Buffer`。
- 亂數和地區：`Math.random`、`localeCompare`、`Intl.Collator`、`Intl.NumberFormat`、`Intl.DateTimeFormat`、`toLocale…`。
- 語法和新功能：沒有 `async`/`await`；也沒有 ES2024 以後的東西（`Object.groupBy`、Set 的新方法、`Promise.withResolvers`）。

另外，`#` 開頭的都是顏色字串，不是私有欄位；`using` 是一個變數的名字，不是新語法。

推論：ADR 0007、0008 說以後 id 要改由手機發、不能撞號。那多半會用到 `crypto.randomUUID`。如果這段放進核心，嵌入式引擎要由 Rust 端提供這個函式。

### 跟地區、時間有關的

- **大小寫**：`toLowerCase`／`toUpperCase`（在 `members.ts`、`segment.ts`）不是 `toLocale…` 版本，結果不看地區設定。
- **排序**：`rates.ts:85`、`settle.ts:140` 的 `.sort()` 沒帶比較函式，照 UTF-16 碼排，各引擎結果一樣。
- **Date 只有兩處：**
  - `rates.ts:154` 用 `Date.UTC`，不受時區影響。
  - `success-rate.ts:286` 的 `isDate` 用本地時間 `new Date(y, mo - 1, d)`，檢查這一天存不存在。推論：它只比年月日，時區不會改變結果。
- **不看現在幾點**：核心裡沒有 `Date.now()` 或 `new Date()`，所以伺服器的輸出跟它現在幾點無關。
- **切字看 Unicode 版本**：`Intl.Segmenter(undefined, …)` 用預設地區。推論：grapheme 的切法實際上不看地區，但**會看引擎內建的 Unicode 版本**。
  - Node 26.13.0：Unicode 17.0（ICU 78.3）。
  - 本機的 Bun 1.3.5：Unicode 15.1（ICU 74.2）。
  - `unicode-segmentation` 1.13.3：Unicode 17.0.0（原始碼裡的 `UNICODE_VERSION`）。
  - 推論：各家瀏覽器的版本本來就不一樣，所以遇到極少數新的 emoji 或特殊文字，「字數」前後端本來就可能差一個。伺服器只要固定用一個版本。

### fflate 和 `flow-file.ts`

**誰用 fflate：**
- 核心裡只有 `flow-file.ts` import 外部套件：`fflate` 的 `zipSync`、`unzipSync`、`strToU8`、`strFromU8`。
- 其他檔只 import 同資料夾的檔，而且是不帶副檔名的相對路徑（例如 `'./flow'`）。核心裡沒有用到 `#lib/*`。

**fflate 的兩個版本（0.8.3）：**
- 給 Node 的 `esm/index.mjs`：一開頭就 `import { createRequire } from 'module'`，還會用 `worker_threads`。
- 給瀏覽器的 `esm/browser.js`：只有非同步函式會用 `Worker`，同步函式不用。用 `TextEncoder/TextDecoder` 之前會先檢查 `typeof`，沒有就改用純 JS 版。

**打包時要選瀏覽器版：**
- esbuild 用 `--platform=node` 會選到 Node 版。打包結果裡有 3 處 `createRequire`／`worker_threads`，嵌入式引擎跑不了。
- 用 `--platform=neutral` 就會選瀏覽器版，沒有這些（本機實測，esbuild 0.28.2）。
- rolldown `--platform neutral`、`bun build --target=browser` 也都選瀏覽器版（本機實測）。
- 用瀏覽器版時，zip 打包再解開在 QuickJS、Boa 上也都能跑（本機實測）。

**伺服器需不需要 `flow-file.ts`：**
- 照題目的假設（瀏覽器負責打包、解開 zip，伺服器只收 JSON），zip 那部分用不到。
- 但 `flow-file.ts` 裡還有**跟 zip 無關的東西**：
  - `isFlow`：檢查每個欄位的型別、指到的段／隊員／音樂檔在不在、拍點和成功率設定守不守規則。
  - 舊版升級 `UPGRADES`。
- 這兩樣現在都包在 `readFlowFile(bytes)` 裡，沒有單獨匯出。
- 推論：伺服器要檢查上傳的整份流程 JSON，就得把這一段拆出來。不管選哪個方案都一樣。

**打包後的大小**（本機實測，rolldown 1.2.16，打包整個 `index.ts`）：

| 形式 | 大小 |
|---|---|
| 未壓縮 | 232 KB |
| minify | 99 KB |
| minify 後再 gzip | 36 KB |

## 2. 本機實測：同一份核心在各引擎上跑

### 做法

1. 用 rolldown 把 `src/lib/core/index.ts` 打包成一個 IIFE 檔，後面接一段測試程式 `harness.js`。它定義 `step(flowJson, op)`：`JSON.parse` → 跑一個指令 → `JSON.stringify` 結果。
2. 用核心自己的指令做兩份流程：
   - 小的：98 KB（30 人、40 個動作、40 張站位、500 次紀錄）。
   - 大的：1.0 MB（36 人、80 個動作、80 張站位、8,000 次紀錄）。
3. 跑三種指令：
   - `rename`：改流程名字，幾乎只有 JSON 進出。
   - `record`：記一次成功率，就是 ADR 0008 說的規則。
   - `insertBeats`：先把段加長，再插入一個八拍，後面的動作、站位全部往後挪。
4. 嵌入式引擎從 Rust 呼叫，量到的時間包含 Rust 字串送進 JS、再拿回來。

### 能不能跑、輸出一不一樣

| 引擎 | 版本 | 不改能跑嗎 | 要做什麼 | 輸出跟 Node 一樣嗎 |
|---|---|---|---|---|
| Node | 26.13.0 | 能 | — | （基準） |
| Bun | 1.3.5（本機裝的，最新是 1.4.4） | 能 | — | 6/6 一樣 |
| Deno | 2.9.8（V8 15.0） | 能 | — | 6/6 一樣 |
| deno_core（V8） | 0.413.0（經由 `deno_v8` 0.5.0 用 `v8` 150.4.0） | 能，預設 feature 就有 `Intl.Segmenter` | 建 `JsRuntime` 前要先進 tokio runtime。沒進的話，V8 一排延遲工作程式就中止，訊息叫你先 `Runtime::enter()` | 6/6 一樣 |
| rquickjs（QuickJS-NG） | 0.14.0（內含 QuickJS-NG 0.16.2，依 `quickjs.h` 的 `QJS_VERSION_*`） | **不能**：`Intl is not defined` | 先放 `Intl.Segmenter` 墊片，Rust 端用 `unicode-segmentation` 算邊界 | 6/6 一樣 |
| boa_engine | 0.22.0，開 `intl_bundled` | **不能**：`SyntaxError: unexpected token 'using'` | 把 `roles.ts` 的變數 `using` 改名（我是在打包結果上改的） | 6/6 一樣 |

- 「一樣」是指 6 個輸出檔的 SHA-1 完全相同，座標的小數也一樣。
- 每個引擎另外都跑了一組小檢查，結果全部一樣：
  - 家庭 emoji 算 1 個字，國旗算 1 個字，`e` 加組合重音算 1 個字。
  - 名字太長時的訊息。
  - `periodRange`。
  - zip 打包再解開。
- Boa 這個錯的最小重現：`function f(xs){ const using = xs; return using.length }`。宣告那行能過，`return using.length` 就失敗。核心裡只有 `roles.ts` 的 `deleteCustomRole` 用這個名字（4 處）。
- QuickJS、Boa、deno_core 都沒有 `structuredClone`、`TextEncoder`。這兩個是 WHATWG 的 API，不是 ECMAScript 的一部分。核心沒用到，所以不影響。
- rquickjs 也能把 ESM 版（`core.esm.js`）當 ES module 載入，再從模組的 namespace 拿 `charCount` 呼叫（本機實測）。

### 每一步要多久（毫秒，本機實測）

| 引擎 | 小 rename | 小 record | 小 insertBeats | 大 rename | 大 record | 大 insertBeats |
|---|---|---|---|---|---|---|
| Node 26 | 0.62 | 0.64 | 1.30 | 5.6 | 5.9 | 7.4 |
| Bun 1.3.5 | 0.43 | 0.45 | 0.99 | 3.5 | 4.0 | 5.1 |
| Deno 2.9.8 | 0.46 | 0.48 | 1.07 | 4.0 | 4.3 | 5.8 |
| deno_core（從 Rust 呼叫） | 0.49 | 0.56 | 1.18 | 4.5 | 4.7 | 6.2 |
| rquickjs（從 Rust 呼叫） | 2.5 | 2.6 | 13.8 | 23 | 25 | 52 |
| Boa（從 Rust 呼叫） | 15.9 | 16.7 | 76 | 145 | 152 | 301 |

推論：`rename` 幾乎只有 JSON 進出，所以它約等於「把 100 KB／1 MB 傳進去再拿出來」的成本：

| 引擎 | 1 MB 進出一次 |
|---|---|
| V8 | 約 4–6 毫秒 |
| QuickJS | 約 23 毫秒 |
| Boa | 約 145 毫秒 |

### 記憶體、啟動、檔案大小（本機實測）

| | 只載入核心（整個程序最高 RSS） | 跑完上面全部（最高 RSS） | 載入核心的時間 | 執行檔大小（release） |
|---|---|---|---|---|
| Node 26 | 67 MB | 195 MB | 整個程序 0.04 秒 | （Node 本身） |
| Bun 1.3.5 | 42 MB | 200 MB | 整個程序 0.02 秒 | （Bun 本身） |
| Deno 2.9.8 | 60 MB | 188 MB | 整個程序 0.04 秒 | （Deno 本身） |
| deno_core | 32 MB | 167 MB | 25–66 毫秒 | 60 MB |
| rquickjs | 6.4 MB（QuickJS 自己算的用量約 1 MB） | 29 MB | 9–19 毫秒 | 1.7 MB |
| Boa（含 ICU 資料） | 38 MB | 176 MB | 76–193 毫秒 | 28 MB |

建置（本機實測）：

- rquickjs 加上 Boa（`intl_bundled`），一起從零做 release 建置，約 31 秒。
- deno_core 會從 GitHub 下載預先建好的 V8 靜態庫。build script 印出的網址是 `https://github.com/denoland/rusty_v8/releases/download/v150.4.0/librusty_v8_simdutf_release_aarch64-apple-darwin.a.gz`。
  - 同一個 release 的 Linux x86_64 檔是 38,806,672 位元組（約 39 MB，壓縮過）。
  - 解開後的 `.a` 在本機是 147 MB。
  - 來源：GitHub release API，v150.4.0，發布於 2026-07-24。
- `Send` 的編譯檢查：
  - `rquickjs::Runtime`、`rquickjs::Context`（預設 feature）、`boa_engine::Context`、`deno_core::JsRuntime` 都**不是** `Send`，因為裡面有 `Rc`。
  - rquickjs 開了 `parallel` feature 之後，`Runtime`、`Context` 都通過 `Send` 檢查。

## 3. 在 Rust 裡嵌 JS 引擎：各套件現況

crates.io 的資料都來自 `https://crates.io/api/v1/crates/<name>`，查於 2026-11-06。

### 總表

| | rquickjs | deno_core | v8（rusty_v8，直接用） | boa_engine | javy |
|---|---|---|---|---|---|
| 最新穩定版 | 0.14.0（2026-09-18） | 0.413.0（2026-10-21） | 152.2.0（2026-08-20） | 0.22.0（2026-08-28） | 8.1.0（2026-07-30） |
| 過去一年發版 | 6 版 | 46 版 | 30 版（跟 Chrome 每 4 週一版） | 2 版（0.21.1、0.22.0） | 4 版 |
| 最近一次 commit | 2026-11-05 | 2026-10-26（Deno 主 repo） | 2026-10-21 | 2026-10-31 | 2026-11-02 |
| 用的引擎 | QuickJS-NG | V8（經由 `deno_v8` 外殼） | V8 | Boa（純 Rust） | QuickJS-NG（經由 rquickjs 0.12） |
| test262（test262.fyi，2026-11-06 的資料） | QuickJS-NG：83.53%（`language` 98.16%；Temporal 0 分） | V8：97.66% | V8：97.66% | Boa main：95.50%；0.22 發版說明：95.60% | 同 QuickJS-NG |
| `Intl.Segmenter` | **沒有**，官方說不太可能支援 | **有**（本機實測：預設 feature 就能用） | 有（看 ICU 資料，見下） | 要開 `intl_bundled`（**不是預設**） | 沒有 |
| ES module | 可以 | 可以 | 可以（低階 API） | 可以 | — |
| `Send` | 預設不是；`parallel` 是（官方標實驗性） | 不是 | `OwnedIsolate` 不是 | 不是 | — |
| 建置 | 編 C 原始碼 | 下載 V8 預建庫 | 下載 V8 預建庫；從原始碼建約 30 分鐘 | 純 Rust | 產生 Wasm 模組 |
| 執行檔（本機實測） | 1.7 MB | 60 MB | — | 28 MB（含 ICU 資料） | README：模組至少 869 KB |

**各家都沒有公開記憶體用量、啟動時間或 JSON 進出成本的數字**。唯一的例外是 QuickJS 首頁的「一個 runtime 從建立到結束不到 300 微秒」。本機實測的數字請看第 2 節。

### rquickjs

- **包的是 QuickJS-NG，不是 bellard 的 QuickJS。**
  - README 寫「high level bindings of the QuickJS-NG JavaScript engine」。
  - submodule 指向 `quickjs-ng/quickjs`。
  - 0.14.0 釘的是 QuickJS-NG 0.16.2；QuickJS-NG 最新是 0.18.0（2026-11-01）。
  - README 還寫「支援 ES2020」，這句已經過時。
- **沒有 Intl。** QuickJS-NG 文件：「Due to size constraints it is unlikely QuickJS will ever support the Intl APIs.」
- **ES2023 的陣列方法都有。** QuickJS-NG 0.18.0 的原始碼有 `toSorted`、`toSpliced`、`with`、`findLast`、`Object.groupBy`。沒有 `structuredClone`。
- **執行緒：**
  - 沒開 `parallel` 時，`Runtime` 用 `Rc<RefCell<…>>`。
  - 開了之後改用 `Arc<Mutex<…>>`，docs.rs 寫「impl Send for Runtime — Available on crate feature parallel only」。
  - README 提醒：「Some experimental features like `parallel` may not works as expected. Use it for your own risk.」
- **JSON 進出：** 有 `Ctx::json_parse`、`Ctx::json_stringify`、`FromJs`／`IntoJs`；另有 `rquickjs-serde` 0.8.0。

### QuickJS（bellard 原版）

- 最新發布是 2026-06-04，首頁寫「It supports the ES2025 specification」。
- 2026-10-10 在 master 加了**實驗性**的 `Intl` 和 Temporal（commit 97f64ef9，「experimental AI coded Temporal and Intl support」），裡面有 `intl/segmenter.c`。
  - 這還沒出現在任何正式發布裡。
  - rquickjs 不能用它。
  - `quickjs_runtime` 0.18.0 有 `bellard` feature，但我沒確認它帶的是 Intl commit 之前還是之後的版本。

### deno_core

- **原 repo 已經封存。** `denoland/deno_core` 在 2026-02-27 封存（`archived=true`，我用 GitHub API 確認過）。程式碼搬到 `denoland/deno` 的 `libs/core`，crate 照樣在發新版。
- **依賴：**
  - 依賴 `deno_v8` 0.5.0，這是一層「JavaScript engine facade」。預設底下是 `v8` 150.4.0。
  - 另有實驗性的 `quickjs` feature，改用預發布版的 `v8x` 149.4.0-rc.4。
  - 這是我從本機下載的 `Cargo.toml` 看到的。
- **ICU：**
  - deno_core 有個非預設的 `include_icu_data` feature，會呼叫 `v8::icu::set_common_data_77(...)`。
  - 但本機實測，**沒開這個 feature，`Intl.Segmenter` 也能用，結果也對**。
  - rusty_v8 的 `.gn` 設了 `icu_use_data_file = false`。推論：ICU 資料直接編進了 V8 靜態庫，所以不用另外載入。
- **執行緒：**
  - docs.rs 寫 `impl !Send for JsRuntime`。
  - 原始碼註解：從 V8 11.6 起，所有 runtime 要有同一個初始化 V8 platform 的父執行緒。
  - README：event loop「must be executed in the context of Rust's future executor (eg. tokio, smol)」。
  - 官方文件沒寫 `spawn_blocking` 或專用執行緒的用法。
- **`structuredClone`：** 只有 `Deno.core.structuredClone`，不是全域的。全域版本在 `deno_runtime` 的 `ext/web`。
- **JSON 進出：** `serde_v8` 0.322.0（README 說轉成 `serde_json::Value`「will add extra overhead」），或 `v8::json::parse`／`stringify`。我實測時是直接傳字串，在 JS 裡 `JSON.parse`。
- **`deno_runtime` 0.268.0：** 包含整個 Deno 的 Web 和 Node API（69 個依賴），比 deno_core 重很多。流程核心用不到這些。

### v8（rusty_v8）

- **預設下載預建庫。** README：「Binary builds are the default」；設 `V8_FROM_SOURCE=1` 就從原始碼建，「often takes 30 minutes」。
- **控制下載的環境變數：** `RUSTY_V8_ARCHIVE`、`RUSTY_V8_MIRROR`（預設是 GitHub releases）、`RUSTY_V8_ARCHIVE_SHA256` 等。下載的檔案存在 `~/.cargo/.rusty_v8`。
- **v152.2.0 預建庫的大小（gzip）：** Linux x86_64 39,784,686 位元組；Linux aarch64 38,513,465 位元組；macOS aarch64 40,635,999 位元組。
- 推論：Docker 建置要能連到 GitHub，或先準備好鏡像。

### boa_engine

- **conformance：** 0.22 發版說明寫「our conformance has grown to 95.60%」；main 分支在 2026-10-31 是 96.03%。
- **`Intl` 不在預設 feature 裡。**
  - 預設 feature 是 `float16`、`xsum`、`temporal`。
  - `intl_bundled` 會開 `Intl` 並帶一份 ICU4X 資料；`intl` 則讓你自己提供比較小的資料。
  - test262.fyi 上，Boa 的 `Intl.Segmenter` 79 項全過。
- **已知的解析錯：** issue #5602（2026-10-20 開，未關）是「Parser rejects `using` as an identifier in expressions」。修正的 PR #5603（2026-10-21）還沒合併。
  - 這個錯在 test262 的總分裡看不出來。
- **執行緒：** docs.rs 寫 `impl !Send for Context`；垃圾回收器是 `thread_local!`。官方有 `tokio_event_loop.rs` 範例。
- **JSON 進出：** 有 `JsValue::from_json`／`to_json`。

### javy

- Javy 是「Configurable JavaScript runtime for WebAssembly」，底下用 rquickjs（0.12）。
- 它的產出是 Wasm 模組，README 用 `wasmtime` 執行。
- 推論：在 axum 裡用 Javy，等於多帶一個 wasmtime 再跑 QuickJS-NG。沒有 `Intl` 的問題一樣存在，又多一層。

### 其他選項

| 選項 | 現況 |
|---|---|
| `quickjs_runtime` 0.18.0（2026-09-22） | 可以選 bellard 或 NG，用量很少；所有 JS 都在一條執行緒的 event loop 上跑 |
| `rustyscript` 0.12.3 | 最後一次發布是 2025-08-21，底下是很舊的 deno_core 0.355 |
| `nova_vm` 1.0.0 | test262 76.85%，沒有 Intl |
| wasmtime＋StarlingMonkey | SpiderMonkey 編成 Wasm；README 沒提到 Intl |

### 沒有 `Intl.Segmenter` 時怎麼補

- **由 Rust 提供（本機實測可行）：** `unicode-segmentation` 1.13.3 的 `graphemes(s, true)` 依 UAX #29 切「extended grapheme clusters」，用的是 Unicode 17.0.0。
  - JS 端只要一個小類別：`segment()` 回傳 `{segment, index, input}` 的陣列。
  - 核心只用 `for…of` 和 `index`，所以這樣就夠。
  - 注意：Rust 回傳的位置要換成 UTF-16 的位置（JS 字串的索引）。
- **用 JS 墊片：** `@formatjs/intl-segmenter` 12.3.1（2026-10-31），解開後 1.28 MB。它能不能在完全沒有 `Intl` 物件的 QuickJS-NG 上跑，我沒測。

## 4. 旁邊另開 Node／Bun／Deno 程序（sidecar）

### 版本

| 執行環境 | 狀態 | 最新版（日期） | 停止支援 |
|---|---|---|---|
| Node 26 | Active LTS（2026-10-28 起） | 26.13.0（2026-10-28） | 2029-04-30 |
| Node 24 | Maintenance LTS | 24.22.2（2026-10-27） | 2028-04-30 |
| Node 22 | Maintenance LTS | 22.23.4（2026-10-20） | 2027-04-30 |
| Bun | 穩定版 | 1.4.4（2026-10-22） | — |
| Deno | 穩定版 | 2.9.8（2026-10-21） | — |

Node 從 27 起改了發版方式：每條版本線都先經過「Alpha」階段，而且每條都會變成 LTS。27 目前是 alpha。

### `Intl.Segmenter`

- **Node：** 文件寫「The full ICU data set is provided by Node.js by default」。
- **Bun：** 授權頁列出靜態連結「`libicu` 78」。不過本機的 Bun 1.3.5 回報的是 ICU 74.2。
- **Deno：** 我沒找到使用者文件明講預設帶完整 ICU，但本機實測能用。
- Linux 的 Docker 映像檔裡能不能用，沒測。

### 能不能直接跑 `.ts`

- Node 的 type stripping 從 v25.2.0／v24.12.0 起是 Stable。
- 但 Node 要求 import 路徑寫副檔名（「file extensions are mandatory」），而且不讀 `tsconfig` 的 `paths`。
- 核心的相對 import 都沒寫副檔名（`'./flow'`）；`#lib/*` 又指向 `.js`，但硬碟上的檔是 `.ts`。
- 研究時另外做了一個照本專案 `imports` 設定的小專案。Node 26.13.0 和 Deno 2.9.8 直接跑它的原始碼都找不到檔（`ERR_MODULE_NOT_FOUND`；Deno 建議加 `--sloppy-imports`）。
- 所以 **sidecar 也要先打包。**

### Docker Hub 映像檔大小

數字取自 Docker Hub API 的 `size` 欄位，跟 Hub 頁面顯示的壓縮後大小一致。格式是 amd64 / arm64，單位 MB。

| 映像檔 | 大小 |
|---|---|
| `node:26-slim` | 85.7 / 86.1 |
| `node:26-alpine` | 62.9 / 68.0 |
| `oven/bun:1.4.4-slim` | 84.0 / 85.3 |
| `oven/bun:1.4.4-alpine` | 57.3 / 58.1 |
| `oven/bun:1.4.4-distroless` | 58.9 / 59.8 |
| `denoland/deno:alpine-2.9.8` | 49.6 / 47.8 |
| `denoland/deno:distroless-2.9.8` | 53.8 / 52.8 |

### 包成單一執行檔

- **Node SEA：** 標「1.1 - Active development」。從 v25.5.0 起有 `--build-sea`。只能嵌一個腳本，所以要先打包。
- **Bun：** `bun build --compile`，可以交叉編譯到 `bun-linux-x64`、`bun-linux-arm64`。
- **Deno：** `deno compile`，可以交叉編譯，權限要在編譯時就給。

### 同一台機器用 Docker 部署

**兩個容器（Docker 建議的做法）：**
- Docker 文件說最好一個容器一個服務，用自訂網路或共用 volume 連起來。
- compose 可以用 `depends_on` 搭配 `condition: service_healthy`、`healthcheck`，加上 `restart: unless-stopped`。
- 推論：兩邊可以走內部網路的 HTTP，或透過共用 volume 走 Unix socket。

**一個容器、兩個程序：**
- 由 Rust 啟動子程序。這時 Rust 是 PID 1，要負責收掉結束的子程序。
- Docker 文件建議用 `--init`（compose 的 `init: true`）或 tini。
- Node 官方的 Docker 建議寫著「Node.js was not designed to run as PID 1」。

### 主要缺點

**有文件依據的：**
- **管線可能卡死。** Rust std 文件：寫進 stdin 的量超過管線緩衝、又沒有同時讀 stdout/stderr，「may cause a deadlock」。Linux 管線預設只有 65,536 位元組，而流程是 100 KB–1 MB。
- **子程序管理要自己顧。** tokio：`Child` 被丟掉後，子程序預設會繼續跑（要設 `kill_on_drop`）；收掉結束的子程序只是「best-effort」。
- **stdout 可能沒寫完。** Node 在 POSIX 上寫管線是非同步的；如果先呼叫了 `process.exit()`，輸出可能根本沒寫出去。

**推論，沒有來源：**
- 每一步要多一次「Rust 轉 JSON → 傳過去 → JS 解析」，回來再一次。傳的量是 0.1–1 MB。
- JS 裡的部分本機量過是 3.5–7.4 毫秒（第 2 節）；程序之間傳送的成本沒量。
- 用一行一個 JSON 的格式時，只要核心或依賴往 stdout 印了東西，格式就壞掉。log 一定要寫到 stderr。
- 一個 sidecar 一次只處理一步。很多支流程同時有人改時，要開好幾個，或排隊。
- 會多一個要建置、發版的東西，也要多做健康檢查和重啟。Rust 和 JS 兩邊的版本可能對不上。

## 5. 把 TS 核心打包成一個 JS 檔

### 版本（npm registry 的 latest，查於 2026-11-06）

| 套件 | 最新版 | 發布日 |
|---|---|---|
| esbuild | 0.28.2 | 2026-08-08 |
| rolldown | 1.3.0 | 2026-11-05 |
| vite | 8.3.6 | 2026-11-05 |
| tsdown | 0.23.7 | 2026-11-06 |
| tsup | 9.0.0 | 2026-10-14（README 說已經不維護，請改用 tsdown） |
| bun | 1.4.4 | 2026-10-22 |

### 本機實測可行的指令

本機用的 rolldown 是主 checkout 裡裝的 1.2.16。

```sh
# rolldown：ESM 或 IIFE（給 deno_core execute_script、QuickJS script 用）
rolldown src/lib/core/index.ts --format esm  --platform neutral --file core.esm.js
rolldown src/lib/core/index.ts --format iife --name Core --platform neutral --file core.iife.js
# esbuild
esbuild src/lib/core/index.ts --bundle --format=esm --platform=neutral --target=es2022 --outfile=core.js
# bun
bun build src/lib/core/index.ts --target=browser --format=esm --outfile=core.js
```

**重點：**
- **要用 `neutral`（或 browser）**，不然 fflate 會被換成 Node 版（第 1 節）。
- **打包工具只降語法，不補 API。** esbuild 文件：「this is only concerned with syntax features, not APIs. It does not automatically add polyfills for new APIs」。rolldown 我沒找到這方面的說明，但打包結果裡 `toSorted` 等原封不動（本機實測）。
- **Vite 8 用的就是 Rolldown**（2026-03-12 的發布文）。Vite 文件說 library mode 是給瀏覽器的；非瀏覽器的函式庫，建議直接用 tsdown 或 Rolldown。
- 推論：伺服器要的不一定是整個 `index.ts`。可以另寫一個只匯出指令和檢查的入口，順便把 `isFlow` 拆出來匯出（第 1 節）。

### `#lib/*` 有沒有影響

- **核心本身不用 `#lib/*`**（只有相對路徑），所以打包核心時沒影響。
- 會用到它的是 `src/lib/test-flows.ts` 這類檔。`package.json` 裡寫的是 `"#lib/core": "./src/lib/core/index.js"`，但硬碟上是 `.ts`。
- 各工具能不能解出來（`#lib/core` → `index.js` → 實際的 `index.ts`）：

| 工具 | 結果 |
|---|---|
| esbuild 0.28.2 | 解得出來（本機實測）；從 0.13.9 起支援 `imports` 欄位 |
| rolldown 1.2.16、1.3.0 | 解得出來（本機實測） |
| Bun 1.4.4 | 解得出來（研究時另外實測） |
| Bun 1.3.5 | **解不出來**：`Could not resolve: "#lib/core"`（本機實測） |
| Node、Deno 直接跑原始碼 | 都不行（見第 4 節） |

## 6. 改寫成 Rust 的大小（只分到檔案）

**做法：** 從會改流程的指令所在的檔出發，順著「執行時真的會 import」的關係（不算只 import 型別的）找出全部會被帶進來的檔。

**行數有兩種算法：**
- 檔案總行數（含註解）。
- 「程式行」：去掉空行，以及 `//`、`/* */`、`*` 開頭的行。

### 現在的規則分布

- **53 個指令：** 會改流程、回傳 `CommandResult` 的指令共 53 個，分在 12 個檔：`actions`、`cues`、`flow`、`formation`、`members`、`insert-beats`、`roles`、`records`、`phases`、`segment-order`、`segment`、`time-rules`。
- **112 處擋下：** 寫 `blocked(` 的地方共 112 處：

| 檔案 | 處數 |
|---|---|
| `formation` | 20 |
| `segment` | 17 |
| `records` | 16 |
| `roles` | 10 |
| `segment-order` | 9 |
| `members` | 8 |
| `phases` | 8 |
| `actions` | 7 |
| `cues` | 6 |
| `flow` | 4 |
| `insert-beats` | 4 |
| `time-rules` | 3 |

- **目前沒有一個「整份流程守不守規則」的函式。** 規則大多寫在各指令裡，做之前先檢查，不合就擋下。
  - `flow-file.ts` 的 `isFlow` 只檢查：型別、參照、拍點（`cueProblem`）、成功率設定（`successRateProblem`）、段長（`fileLengthProblem`）、有沒有開頭那張站位。
  - 它不檢查的例子：同一個人兩個動作撞在一起、名字長度、人數上限。
- 推論：ADR 0007 說「合起來違反規則就退回」。伺服器要嘛照順序重跑那個指令（需要全部指令），要嘛另外寫一個檢查整份流程的函式。後者現在不存在，用哪種語言都要新寫。

### 伺服器需要的（重跑全部指令的情況）

指令 import 進來的範圍共 25 個檔、4,634 行（含註解），約 **3,360 程式行**：

| 類別 | 檔案（程式行） |
|---|---|
| 指令本身 | `formation`(440)、`members`(331)、`segment`(251)、`actions`(243)、`cues`(204)、`records`(196)、`phases`(115)、`roles`(109)、`segment-order`(104)、`flow`(87)、`time-rules`(57)、`insert-beats`(46) |
| 指令用到的規則和工具 | `time`(222)、`success-rate`(208)、`settle`(165)、`snap`(117)、`beat-range`(94)、`field`(90)、`phase-beats`(82)、`action-types`(51)、`text-length`(41)、`phase-types`(35)、`result`(30)、`ids`(21)、`colors`(18) |
| 檢查上傳的整份 JSON | `flow-file` 裡的 `isFlow` 和舊版升級（整個檔 268 程式行，zip 部分只有十幾行） |

- 推論：這 25 個檔裡也有只給畫面用的函式，改寫時可以不搬。例如：
  - `time.ts` 的時間文字、`rulerMarks`。
  - `snap.ts` 的 `fieldPositionText`。
  - `colors.ts`。
- 但這些函式跟規則混在同一個檔裡。
- `snap` 會被帶進來，是因為 `flow.ts` 的 `adjustField`（改場地）會把人吸到格子上。
- **測試：** 同名的 `.test.ts` 約 6,000 行。跨檔的測試（`cascade`、`record-questions`、`round-trip`、`answers`、`adjust-field`、`flow-file`）約 1,500 行。合計約 7,500 行。
- 推論：改寫的話，要嘛把這些測試也改成 Rust，要嘛另做「同一份輸入，兩邊輸出要一樣」的對照測試。第 2 節的做法就是一種對照測試。

### 伺服器不需要的（畫面、列印、提醒用）

下面這些不在指令 import 的範圍裡，合計約 610 程式行：

| 檔案（程式行） | 用途 |
|---|---|
| `eight-count`(208) | 八拍表，列印用 |
| `rates`(127) | 成功率表的算法 |
| `clash`(85) | 撞位提醒，「不擋任何指令」 |
| `playback`(78) | 播放計畫 |
| `change-label`(54) | 「這一步改了什麼」那一句話 |
| `hints`(44) | 「只提醒，不擋」 |
| `tap-tempo`(12) | 敲擊測速 |

推論：
- `change-label` 可能跟 ADR 0007 的退回訊息（「你的『拖動作』沒改成」）有關。但這句話用戶端自己也能組，不一定要伺服器做。
- `rates` 只有以後要伺服器算報表時才需要。

### 只做成功率紀錄（ADR 0008）的情況

- ADR 0008 說伺服器要用同一套「記一次」的規則檢查。規則本體在 `success-rate.ts`：
  - `attemptProblem`（約 12 行）、`keptAttempt`（約 13 行）、`fitRecords`（約 13 行）。
  - 再加上 `whoFits`、`isDate`、`perPerson`、`MARKS`、`PRACTICE_KINDS`。
- `records.ts`（196 程式行）裡還有復原、重做用的部分。
- 照 import 算，`records` 會帶進 16 個檔、約 1,500 程式行。但大多是因為 `success-rate.ts` 執行時 import 了 `flow.ts`（為了 `memberName`），`flow.ts` 又帶進場地、吸附等檔。
- 推論：真正的紀錄規則大約一兩百行。而且 ADR 0008 本來就要改紀錄的存法，這部分不管選哪個方案都得重寫一些。

## 7. 真實案例

這裡只列有找到原始碼或官方文件的。我自己用 GitHub API 或網頁確認過的，標「已核對」。

### 在 Rust 程式裡跑 JS（嵌入或 sidecar）

- **Convex**（已核對）：最接近我們的情況。
  - Rust 後端用 `deno_core` 嵌 V8，跑使用者的函式。
  - 同時也把 Node 當 sidecar：`crates/node_executor/src/local.rs` 先寫出打包好的 `local.cjs`，再用 tokio 啟動 Node，透過 `.executor.sock`（Unix socket）傳話。
  - https://github.com/get-convex/convex-backend
- **Windmill**（已核對）：
  - Rust 後端用 Bun／Deno 子程序跑使用者的 TS 腳本。
  - 流程裡的運算式原本在程序內用 `deno_core` 跑，有一份文件分析搬到 QuickJS（rquickjs）。文件提到「60+ Parity Tests」，也列出數字處理等可能不相容的地方。
  - https://github.com/windmill-labs/windmill/blob/main/backend/QUICKJS_MIGRATION_ANALYSIS.md
- **Zed**：用 Node sidecar 跑 Prettier，透過 stdin 傳話，訊息帶 Content-Length 標頭。https://github.com/zed-industries/zed/blob/main/crates/prettier/src/prettier_server.js
- **Tauri**：官方有「Node.js as a sidecar」的教學。https://v2.tauri.app/learn/sidecar-nodejs/
- **Supabase Edge Runtime**：以 Deno runtime 為基礎的 Rust 伺服器，用的是分叉出去的 deno_core。https://github.com/supabase/edge-runtime
- **AWS LLRT**：用 QuickJS 的 Rust JS runtime。https://github.com/awslabs/llrt

### 從 JS 改寫成 Rust（另一條路的例子）

- **Apollo Router**（已核對）：
  - 舊的 query planner「was built using Deno and relied on the v8 engine」。
  - v1.49.0 加入 Rust 原生版，v1.59.0 起是預設，「As of v2.x, the legacy query planner has been removed」。
  - https://www.apollographql.com/docs/graphos/routing/query-planning/native-query-planner
- **yrs**：Yjs 的 Rust 移植版，目標是跟 Yjs 行為和二進位格式相容。https://github.com/y-crdt/y-crdt
- **Prisma**（方向相反）：從 Rust 引擎搬回 TypeScript，理由之一是資料要在 JS 和 Rust 之間來回轉換。https://www.prisma.io/blog/from-rust-to-typescript-a-new-chapter-for-prisma-orm

## 沒查到、沒確認的

- **在 Linux 上的表現。** 速度、記憶體、Docker 映像檔裡的 `Intl.Segmenter` 都沒在 Linux 上量。
- **sidecar 的傳送成本。** 程序之間傳 1 MB 要多久，沒量。
- **跑過的指令範圍。** 只跑了 3 種指令、2 份流程，不是全部 53 個指令。核心自己的 vitest 測試沒有在嵌入式引擎上跑。
- **跑過的 Boa 版本。** Boa 是在改過變數名的打包檔上跑的，不是原封不動。
- **deno_core 沒開 `include_icu_data` 也能用 `Intl.Segmenter` 的原因。** 「ICU 資料編進靜態庫」是推論，沒找到文件明講。
- **Deno CLI 怎麼載入 ICU。** 沒找到使用者文件。
- **`@formatjs/intl-segmenter` 能不能在 QuickJS-NG 上跑。** 沒測。
- **`quickjs_runtime` 的 `bellard` feature 帶哪一版 QuickJS。** 沒確認。
- **各引擎的官方數字。** 每個 runtime 的記憶體、啟動時間、JSON 進出成本都沒有官方數字，只有本機實測。
- **test262.fyi 的分數怎麼來的。** 它測的是各引擎命令列版本的某個 commit，不一定等於上面的 crate 版本。
- **Liveblocks、Replicache/Reflect、PartyKit。** 沒找到它們用 Rust 伺服器或嵌入式引擎的證據，所以沒列。

## 來源（查於 2026-11-06）

### 本專案

- 原始碼：`src/lib/core/*.ts`
- 決策紀錄：`docs/adr/0007-cloud-flow-concurrent-edits.md`、`docs/adr/0008-cloud-records-stored-apart.md`
- 套件設定：`package.json`
- fflate 0.8.3 的 `package.json`、`esm/browser.js`、`esm/index.mjs`（主 checkout 的 `node_modules`）

### 本機實測（`/tmp/ts-core-research/`）

- `build-fixtures.mjs`：做測試用的流程。
- `harness.js`：`step()` 和小檢查。
- `bench-native.mjs`：在 Node、Bun、Deno 上跑。
- `rust-embed/`：rquickjs 0.14.0、boa_engine 0.22.0、unicode-segmentation 1.13.3。
- `v8-embed/`：deno_core 0.413.0。
- `out/`：打包結果、流程、各引擎的輸出。

### crates 和引擎

- crates.io API：`https://crates.io/api/v1/crates/{rquickjs,deno_core,deno_runtime,v8,boa_engine,javy,quickjs_runtime,rquickjs-serde,deno_core_icudata,unicode-segmentation}`
- rquickjs：https://github.com/DelSkayn/rquickjs ，https://docs.rs/rquickjs/0.14.0/rquickjs/struct.Runtime.html
- QuickJS-NG：https://github.com/quickjs-ng/quickjs/releases/tag/v0.18.0 ，https://github.com/quickjs-ng/quickjs/blob/master/docs/docs/es_features.md
- QuickJS（bellard）：https://bellard.org/quickjs/ ，https://github.com/bellard/quickjs/commit/97f64ef9
- deno_core：https://github.com/denoland/deno_core （已封存），https://github.com/denoland/deno/tree/main/libs/core ，https://docs.rs/deno_core/0.413.0/deno_core/struct.JsRuntime.html
- rusty_v8：https://github.com/denoland/rusty_v8/blob/main/README.md ，https://github.com/denoland/rusty_v8/releases/tag/v150.4.0 ，https://github.com/denoland/rusty_v8/releases/tag/v152.2.0
- Boa：https://github.com/boa-dev/boa/releases/tag/v0.22 ，https://boajs.dev/conformance ，https://github.com/boa-dev/boa/issues/5602 ，https://github.com/boa-dev/boa/pull/5603 ，https://docs.rs/boa_engine/0.22.0/boa_engine/context/struct.Context.html
- javy：https://github.com/bytecodealliance/javy
- test262.fyi：https://test262.fyi （資料：https://data.test262.fyi/index.json ，產生於 2026-11-06）
- unicode-segmentation：https://github.com/unicode-rs/unicode-segmentation
- `@formatjs/intl-segmenter`：https://registry.npmjs.org/@formatjs%2Fintl-segmenter

### sidecar

- Node：https://github.com/nodejs/Release ，https://nodejs.org/dist/index.json ，https://nodejs.org/api/typescript.html ，https://nodejs.org/api/intl.html ，https://nodejs.org/api/single-executable-applications.html ，https://nodejs.org/api/process.html#a-note-on-process-io
- Bun：https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4 ，https://bun.com/docs/project/license ，https://bun.com/docs/compiler/executables ，https://bun.com/docs/runtime/module-resolution
- Deno：https://github.com/denoland/deno/releases/tag/v2.9.8 ，https://docs.deno.com/runtime/reference/cli/compile/
- Docker Hub API：https://hub.docker.com/v2/repositories/library/node/tags?name=26 ，https://hub.docker.com/v2/repositories/oven/bun/tags?name=1.4 ，https://hub.docker.com/v2/repositories/denoland/deno/tags?name=2.9.8
- Docker：https://docs.docker.com/engine/containers/multi-service_container/ ，https://docs.docker.com/reference/compose-file/services/ ，https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md
- Rust 和 Linux：https://doc.rust-lang.org/std/process/struct.Stdio.html ，https://man7.org/linux/man-pages/man7/pipe.7.html ，https://docs.rs/tokio/latest/tokio/process/index.html

### 打包

- esbuild：https://esbuild.github.io/api/ ，https://github.com/evanw/esbuild/blob/main/CHANGELOG-2021.md
- Rolldown：https://rolldown.rs/apis/cli
- Vite：https://vite.dev/blog/announcing-vite8 ，https://vite.dev/guide/build#library-mode
- tsup：https://github.com/egoist/tsup
- npm registry：https://registry.npmjs.org/{esbuild,rolldown,vite,tsdown,tsup,bun}

### 真實案例

連結在第 7 節。
