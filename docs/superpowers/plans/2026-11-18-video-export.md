# 流程影片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 編輯器多一個「輸出影片」按鈕，把整支流程做成一支直式 1080×1920 的 MP4（流程影片），給隊員用手機看。

**Architecture:** 流程核心算「影片第 t 秒這一格要寫什麼」（純函式、vitest 測）；`src/lib/video/` 把那一格排版（量字收成參數）、畫到 Canvas、交給編碼 adapter（真的用 `mediabunny`，測試換假的）。對話框元件管開始、進度、取消、存檔。場地算位置的程式從 `Field.svelte` 搬進核心，編輯器和影片共用。

**Tech Stack:** Svelte 5、SvelteKit（adapter-static、PWA）、TypeScript、vitest＋jsdom、Canvas 2D、Web Audio `OfflineAudioContext`、WebCodecs 透過 `mediabunny@1.66.0`。

**Spec:** `docs/superpowers/specs/2026-11-18-video-export-design.md`（研究：`docs/research/video-export.md`；試驗：`prototypes/video-export-spike/index.html`）

## Global Constraints

- 用詞照 `GLOSSARY.md`：**流程影片**；按鈕叫「輸出影片」。不用「匯出影片、錄影、動畫」。
- 影片 1080×1920、每秒 30 格；H.264 `avc1.424028`（Constrained Baseline 4.0）、每 2 秒一個關鍵格；AAC-LC 48 kHz 雙聲道 128 kbps；MP4 moov 在前（`fastStart: 'in-memory'`）。
- 開頭停 2 秒（流程名＋「開場站位」，沒聲音），結尾停 1 秒；影片第 t 秒 = 流程第 t − 2 秒（夾在 0 到結尾）。
- 正常速度、有音樂、沒有節拍器聲；只做全隊。
- 只在電腦（不是窄螢幕、不是觸控螢幕）的編輯畫面出現；只開 Chromium（Chrome、Edge）；按下去時再問 `canEncodeVideo`／`canEncodeAudio`。不行就寫：「這個瀏覽器不能輸出影片，請用電腦的 Chrome 或 Edge」。
- 下面那一列的字不小於 28 px；場地上的標記、條號、格號、「正面／裁判」也不小於 28 px。
- 不改流程檔格式，`FORMAT_VERSION` 不動。
- 新套件只有 `mediabunny`（MPL-2.0），只能用動態 `import()` 載入；不加 `@mediabunny/aac-encoder`。
- 搬場地的程式時，`Field.svelte` 畫出來要跟原本一模一樣。
- 註解、字串用繁體中文，照現有的寫法（短句、說為什麼）。
- 只 commit 到本機分支，不推、不開 PR（使用者的 CLAUDE.md §5）。

## Review Focus

1. 最後一個八拍不滿（例：只有 4 拍）：1–8 那一排多的格子灰掉，亮的格子不會跑到第 5 格以後。→ Task 2 測。
2. 音樂段 → 口號段 → 音樂段：上方的字和時鐘接得上，第二個音樂段的音樂放在對的時間（加上開頭 2 秒）。→ Task 2、Task 5 測。
3. 全隊 20 人以上、每人都有任務角色的動作：「誰」那一行本身就比整塊還長，縮到下限照樣放不下時，那一行換行後截掉、尾巴加「⋯」，不會蓋到別的字或畫出畫面。→ Task 3 測。
4. 輸出到一半取消，再按一次開始：從頭做一支新的，不會混到上一次的格子；取消後編碼 adapter 收到 abort。→ Task 7 測。
5. 流程名有 `/ : * ?` 之類的字：檔名照流程檔的規則換成「_」，副檔名 `.mp4`。→ Task 6 測。

---

## 檔案

| 檔案 | 做什麼 |
|---|---|
| `src/lib/core/field.ts`（改） | 加 `NUMBER_BAND`、`fullView`、`fieldNumbers`、`frontLabelAt`（從 `Field.svelte` 搬過來） |
| `src/lib/components/Field.svelte`（改） | 改用核心的那幾個，畫面不變 |
| `src/lib/core/video-frame.ts`（新） | 一格的內容：`videoFrame`、`videoDurationSec`、`videoAudioClips` |
| `src/lib/core/eight-count.ts`（改） | `teamWho` 改成 export（影片寫還在做的動作的人） |
| `src/lib/video/layout.ts`（新） | 把一格排進 1080×1920；放不下的規則；`overflowEights` |
| `src/lib/video/colors.ts`（新） | 影片用的顏色常數 |
| `src/lib/video/draw.ts`（新） | 照排好的版面畫到 Canvas |
| `src/lib/video/soundtrack.ts`（新） | 用 `OfflineAudioContext` 混好整支的聲音 |
| `src/lib/video/encoder.ts`（新） | 編碼 adapter 介面和真的（`mediabunny`） |
| `src/lib/video/fake-encoder.ts`（新） | 測試用的假編碼器 |
| `src/lib/file/save.ts`（改） | 抽出 `safeFileBase`；加 `videoFileName`、`saveVideo` |
| `src/lib/editor.svelte.ts`（改） | `EditorAdapters` 加 `video` |
| `src/lib/test-fakes.ts`（改） | `testEditor` 帶假的 `video` |
| `src/lib/components/VideoExport.svelte`（新） | 對話框 |
| `src/routes/+page.svelte`（改） | 「輸出影片」按鈕、開對話框 |
| `src/routes/guide/+page.svelte`、`docs/deploy.md`、`scripts/check-layout.mjs`（改） | 使用說明、離線、版面檢查 |

---

### Task 1: 場地算位置的程式搬進核心

**Files:**
- Modify: `src/lib/core/field.ts`、`src/lib/core/index.ts`、`src/lib/components/Field.svelte:1-20,230-255`
- Test: `src/lib/core/field.test.ts`

**Interfaces:**
- Produces:
  - `export const NUMBER_BAND = 1.3`
  - `export function fullView(field: FieldConfig): Rect`
  - `export function fieldNumbers(field: FieldConfig, view: Rect, stripFont: number, cellFont: number): { strips: { n: number; at: Position }[]; cells: { n: number; at: Position }[] }`：跟現在的 `numberAt`、`topNumberAt`、`sideNumberAt`、`cellNumbers` 同一套公式（`crop` 時 `Field.svelte` 自己把 cells 當空的）。
  - `export function frontLabelAt(field: FieldConfig): Position`：`[0, outer.y + outer.height + 0.7]`。
  - `Position` 從 `./formation` 拿；不要讓 `field.ts` 跟 `formation.ts` 循環依賴（`Position` 只是 `[number, number]`，必要時在 `field.ts` 自己寫型別）。

- [ ] **Step 1: 寫會失敗的測試** `fieldNumbers`：9 條直放、`view = fullView(field)`、`stripFont = 0.3`、`cellFont = 0.26`：`strips` 有 9 個，第 1 個 `at` 是 `[mat.x + CELL_M/2, outer.y - NUMBER_BAND + 1.1*0.3]`；`cells` 有 7 個，第 1 個是 `[outer.x - NUMBER_BAND + 0.65*0.26, mat.y + mat.height - 0.5*CELL_M + 0.3*0.26]`。5 條橫放各一條同樣的斷言（條號在左、格號在上）。`fullView` 的斷言抄 `Field.svelte` 的公式。
- [ ] **Step 2:** `npx vitest --run src/lib/core/field.test.ts` → FAIL（`fieldNumbers is not a function`）。
- [ ] **Step 3:** 在 `field.ts` 實作；`Field.svelte` 的 module script 改成從 `#lib/core` re-export `NUMBER_BAND`、`fullView`（編輯頁有別的地方 import 它們，路徑不變），`topNumberAt`、`sideNumberAt`、`numberAt`、`cellNumbers`、「正面／裁判」的 y 改用核心。
- [ ] **Step 4:** `npx vitest --run` 全過；`npm run check` 過；`npm run check:layout` 全過（畫面不變的證據）。
- [ ] **Step 5: Commit** `場地：條號、格號、正面的位置搬進流程核心（畫面不變，給流程影片共用）`

### Task 2: 一格的內容（流程核心）

**Files:**
- Create: `src/lib/core/video-frame.ts`、`src/lib/core/video-frame.test.ts`
- Modify: `src/lib/core/eight-count.ts`（`teamWho` 加 export）、`src/lib/core/index.ts`

**Interfaces:**
- Consumes: `eightCountRows(flow, null)`、`positionsAt`、`raisedAt`、`memberMarkers`、`toPosition`、`segmentSpans`、`totalSeconds`、`clockText`、`actionLabel`、`playbackPlan`、`teamWho`。
- Produces:
```ts
export const VIDEO_INTRO_SEC = 2;
export const VIDEO_OUTRO_SEC = 1;
export const VIDEO_FPS = 30;
export function videoDurationSec(flow: Flow): number; // INTRO + totalSeconds + OUTRO
export interface VideoFrame {
  part: 'intro' | 'play' | 'outro';
  flowSec: number;
  title: string;            // 流程名
  where: string;            // intro：「開場站位」；音樂段：「音樂 1・第 6 個八拍」；口號段：「口號 1・12.3 秒」
  clock: string;            // clockText(flowSec)
  beats: { count: number; lit: number | null } | null; // 音樂段才有；count = 這個八拍有幾拍（1–8），lit = 現在第幾拍（intro 是 null）
  positions: Record<string, Position>;
  raised: string[];
  markers: Record<string, string>;
  row: VideoRow;
}
export interface VideoRow {
  formations: string[];                                 // EightCountFormation.caption
  actions: { title: string; who: string; note: string }[];  // title = `${at}　${actionLabel}`
  continuing: { name: string; who: string }[];          // 還在做的動作：名字和 teamWho
  cues: EightCountCueLine[];
  empty: boolean;                                       // 都沒有時：畫「這一列沒有新的動作、站位」
}
export function videoFrame(flow: Flow, videoSec: number): VideoFrame;
export function videoRows(flow: Flow): { label: string; row: VideoRow }[]; // 每個不同的列一份（給 overflowEights），label 如「音樂 1 第 6 個八拍」
export function videoAudioClips(flow: Flow): PlaybackClip[]; // playbackPlan(flow, 0).clips，sec 都加 VIDEO_INTRO_SEC
```

- [ ] **Step 1: 寫會失敗的測試**（用 `test-flows.ts` 或 `test-fakes.ts` 現成的流程，不夠再在測試裡建）：
  - `videoFrame(flow, 0).part === 'intro'`、`flowSec === 0`、`where === '開場站位'`、`beats === null`。
  - `videoFrame(flow, VIDEO_INTRO_SEC + totalSeconds(flow) + 0.5).part === 'outro'`、`flowSec === totalSeconds(flow)`。
  - 150 BPM 音樂段、`videoSec = 2 + 5 * 0.4`（第 6 拍）：`beats` 是 `{ count: 8, lit: 6 }`，`where` 是「音樂 1・第 1 個八拍」。
  - 最後一個八拍只有 4 拍：停在它的第 3 拍 → `{ count: 4, lit: 3 }`（Review Focus 1）。
  - 口號段第 12.3 秒：`beats === null`、`where === '口號 1・12.3 秒'`。
  - 音樂 → 口號 → 音樂：第二個音樂段第 1 拍的 `where` 是「音樂 2・第 1 個八拍」；`videoAudioClips` 第二段的 `sec` = 第一段長 + 口號長 + 2（Review Focus 2）。
  - 一個跨 3 個八拍的動作：第 2 個八拍的 `row.continuing` 是 `[{ name, who: teamWho(...) }]`，`row.actions` 是空的。
  - `positions` 等於 `positionsAt(flow, flowSec)`；`raised` 等於 `raisedAt`。
  - `videoDurationSec` = 2 + 總長 + 1。
- [ ] **Step 2:** `npx vitest --run src/lib/core/video-frame.test.ts` → FAIL。
- [ ] **Step 3: 實作。** 列：`eightCountRows(flow, null)` 裡 `startSec ≤ flowSec + EPS` 的最後一列（合起來的列也一樣，上方的八拍數用 `toPosition` 算現在這一個）。`continuing` 從流程裡找「開始在這一列之前、結束在這一列開始之後」的動作，`who` 用 `teamWho`。`clock` 用 `clockText`。
- [ ] **Step 4:** 測試過；`npm run check` 過。
- [ ] **Step 5: Commit** `流程影片：每一格要寫什麼（流程核心）`

### Task 3: 排版和放不下的規則

**Files:**
- Create: `src/lib/video/layout.ts`、`src/lib/video/layout.test.ts`

**Interfaces:**
- Consumes: `VideoFrame`、`VideoRow`、`fullView`、`fieldNumbers`、`frontLabelAt`、`fieldGeometry`（Task 1、2）。
- Produces:
```ts
export const VIDEO_W = 1080, VIDEO_H = 1920;
export const MIN_TEXT_PX = 28;
export type Measure = (text: string, px: number, weight: number) => number; // 字寬（px）
export interface TextItem { text: string; x: number; y: number; px: number; weight: number; color: ColorKey; align?: 'left' | 'center' | 'right' }
export interface FrameLayout {
  texts: TextItem[];
  boxes: { x: number; y: number; w: number; h: number; fill: ColorKey; stroke?: ColorKey; lineWidth?: number; radius?: number }[];
  field: FieldLayout;          // 公尺 → px 的換算、圓點直徑、標記字級
  overflow: boolean;           // 有拿掉東西
}
export interface FieldLayout { box: { x: number; y: number; w: number; h: number }; pxPerM: number; dotPx: number; markerPx: number; numberPx: number }
export function layoutFrame(field: FieldConfig, frame: VideoFrame, measure: Measure): FrameLayout;
export function overflowEights(flow: Flow, measure: Measure): string[]; // videoRows 裡放不下的 label
```
- 區塊：上方 0–320（流程名、where、clock、1–8 一排）；場地 320–1160；下面那一列 1160–1880。實際數字照試驗起步，可以調，但三塊不重疊。
- `ColorKey` 在 Task 4 的 `colors.ts` 定義；這個 task 先建 `colors.ts` 只放 `export type ColorKey = ...` 的 key 清單。

- [ ] **Step 1: 寫會失敗的測試**，假的量字：`(t, px) => [...t].reduce((w, c) => w + (/[\x00-\x7f]/.test(c) ? 0.6 : 1) * px, 0)`。
  - 場地：9 條直放 `field.dotPx ≥ 64`、`markerPx ≥ 28`、`numberPx ≥ 28`，場地整塊在 320–1160 裡。
  - 一個動作、一行誰：沒縮字（下面那一列的字級是起始的 40）、`overflow === false`。
  - 下面那一列的字級一路 40、38、36…到 28，任何 `TextItem.px` 都不小於 28。
  - 6 個同時開始、每個有拍點的動作：放得下，`overflow === false`（設計文件說的量）。
  - 放不下的順序：先把 `continuing` 縮成「↳ 名字 繼續」，再拿備註，再從最下面拿動作、最後一行是「⋯還有 N 個動作」；拍點格子（`cues`）一律在。各寫一個剛好在那一步就放得下的例子。
  - Review Focus 3：一個 25 人、每人有任務角色的全隊動作，誰那一行換行後截在區塊底，最後一行結尾是「⋯」，所有 `TextItem` 的 y 都 < 1880。
  - 1–8 一排：`beats.count = 4` 時第 5–8 格的 box fill 是灰的 key；`lit` 那格是亮的 key。
  - `overflowEights`：把上面放不下的流程丟進去，回 `['音樂 1 第 1 個八拍']`。
- [ ] **Step 2:** `npx vitest --run src/lib/video/layout.test.ts` → FAIL。
- [ ] **Step 3: 實作。** 換行用 `measure` 一個字一個字量（中文沒有空白）。先排一次，太高就降字級重排；到 28 還太高照順序拿東西。
- [ ] **Step 4:** 測試過。
- [ ] **Step 5: Commit** `流程影片：排版，放不下時縮字、照順序拿掉`

### Task 4: 顏色和畫

**Files:**
- Modify: `src/lib/video/colors.ts`
- Create: `src/lib/video/draw.ts`、`src/lib/video/colors.test.ts`

**Interfaces:**
- Produces: `export const VIDEO_COLORS: Record<ColorKey, string>`；`export function drawFrame(ctx: CanvasRenderingContext2D, field: FieldConfig, frame: VideoFrame, layout: FrameLayout): void`。
- 顏色來源：場地的 margin、mat、seam、grid、圓點（base、top）、上層黃框、文字，抄 `Field.svelte` 的 CSS 和 `app.css` 的變數值；拍點四種（down、up、step、motion）抄 `app.css` 的 `--cue-*`。

- [ ] **Step 1: 寫會失敗的測試** `colors.test.ts`：用 `fs.readFileSync` 讀 `src/lib/components/Field.svelte` 和 `src/app.css`（跟 `src/lib/source-guards.test.ts` 同一種做法），每個 `VIDEO_COLORS` 的值都出現在對應的 CSS 規則裡（例：`.seam` 的 `stroke`、`--cue-down`）。
- [ ] **Step 2:** 跑 → FAIL。
- [ ] **Step 3:** 補齊 `VIDEO_COLORS`；寫 `drawFrame`：場地用 `fieldGeometry` 的條、接縫、格線，`fieldNumbers` 的條號格號，`frontLabelAt` 的「▼ 正面／裁判 ▼」，圓點照 `layout.field`，上層、中層最後畫、加黃框；其他照 `layout.texts`、`layout.boxes`。字型 `"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`。`drawFrame` 不寫自動測試。
- [ ] **Step 4:** 測試過；`npm run check` 過。
- [ ] **Step 5: Commit** `流程影片：顏色跟場地對齊、畫一格`

### Task 5: 聲音和編碼 adapter

**Files:**
- Create: `src/lib/video/soundtrack.ts`、`src/lib/video/encoder.ts`、`src/lib/video/fake-encoder.ts`、`src/lib/video/soundtrack.test.ts`
- Modify: `package.json`、`package-lock.json`（`npm install mediabunny@1.66.0 --save-exact`）

**Interfaces:**
- Consumes: `videoAudioClips`、`videoDurationSec`、`VIDEO_FPS`（Task 2）。
- Produces:
```ts
// soundtrack.ts
export const VIDEO_SAMPLE_RATE = 48000;
export interface MixClip { audioId: string; when: number; offset: number; duration: number } // 影片秒數
export function mixClips(flow: Flow, loaded: (audioId: string) => boolean): { clips: MixClip[]; silentSegments: string[] }; // 純函式：哪些片段放哪；沒載入、壞掉的段列進 silentSegments（段 id）
export function renderSoundtrack(flow: Flow, getBuffer: (id: string) => AudioBuffer | undefined): Promise<AudioBuffer>; // OfflineAudioContext(2, ceil(durationSec*48000), 48000)
// encoder.ts
export interface VideoJob { frames: number; draw: (i: number, canvas: OffscreenCanvas | HTMLCanvasElement) => void; audio: () => Promise<AudioBuffer | null>; onProgress: (done: number) => void; signal: AbortSignal }
export interface VideoEncoderAdapter { supported(): Promise<boolean>; encode(job: VideoJob): Promise<Uint8Array> }
export function browserVideoEncoder(): VideoEncoderAdapter; // supported：Chromium（navigator.userAgentData?.brands 有 'Chromium'）且 canEncodeVideo('avc', {width:1080,height:1920,frameRate:30,fullCodecString:'avc1.424028'}) 且 canEncodeAudio('aac',{numberOfChannels:2,sampleRate:48000})
// fake-encoder.ts
export function createFakeVideoEncoder(o?: { supported?: boolean; fail?: string }): VideoEncoderAdapter & { drawn: number[]; aborted: boolean; release(): void } // encode 每畫一格記一個 i；release() 之前停在最後一格前，讓測試看得到「輸出中」
```
- `encoder.ts` 裡 `mediabunny` 一律 `await import('mediabunny')`，不在檔頭 import。設定照 Global Constraints；`signal` abort 時呼叫 `output.cancel()` 並 throw `DOMException('AbortError')`。

- [ ] **Step 1: 寫會失敗的測試** `soundtrack.test.ts`（只測 `mixClips`）：一個音樂段 → 一個片段，`when = 2`、`offset = firstBeatSec`；音樂 → 口號 → 音樂，第二片段 `when = 2 + 第一段 + 口號`（Review Focus 2）；`loaded` 回 false 的段 → 沒有片段、列在 `silentSegments`。
- [ ] **Step 2:** 跑 → FAIL。
- [ ] **Step 3:** 實作三個檔；`npm install mediabunny@1.66.0 --save-exact`。
- [ ] **Step 4:** 測試過；`npm run check` 過；`npm run build` 後看 `build/` 裡 mediabunny 在自己的 chunk，不在首頁一開就載的 chunk 裡（`grep -l "fullCodecString" build/_app/immutable/**/*.js` 只出現在一個非 entry 的 chunk），而且那個 chunk 小於 2 MiB。
- [ ] **Step 5: Commit** `流程影片：混聲音、編碼 adapter（mediabunny 只在輸出時載入）`

### Task 6: 存影片

**Files:**
- Modify: `src/lib/file/save.ts`、`src/lib/editor.svelte.ts`、`src/lib/test-fakes.ts`
- Test: `src/lib/file/save.test.ts`（沒有就新建）

**Interfaces:**
- Produces:
  - `export function safeFileBase(name: string, fallback: string): string`（`flowFileName` 改用它，行為不變）
  - `export function videoFileName(flowName: string): string` → `${safeFileBase(flowName, '流程')}.mp4`
  - `export function saveVideo(bytes: Uint8Array, fileName: string): Promise<SaveOutcome>`：有 `showSaveFilePicker` 用它（types `{ description: '流程影片', accept: { 'video/mp4': ['.mp4'] } }`），沒有就 `<a download>`；不記 handle，每次都問。
  - `EditorAdapters` 加 `video: { encoder: VideoEncoderAdapter; save: (bytes: Uint8Array, fileName: string) => Promise<SaveOutcome> }`；`browserAdapters()` 給 `browserVideoEncoder()` 和 `saveVideo`；`testEditor` 預設 `createFakeVideoEncoder()` 和記下存了什麼的假 save（回 `{ editor, session, saves, videoSaves }`）。

- [ ] **Step 1: 寫會失敗的測試**：`videoFileName('A/B: C?')` 是 `'A_B_ C_.mp4'`；`videoFileName('  ')` 是 `'流程.mp4'`；`flowFileName` 原本的測試照過（Review Focus 5）。
- [ ] **Step 2:** 跑 → FAIL。
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** `npx vitest --run` 全過；`npm run check` 過。
- [ ] **Step 5: Commit** `流程影片：存成 流程名.mp4（另外一套，不碰流程檔的存檔）`

### Task 7: 對話框和按鈕

**Files:**
- Create: `src/lib/components/VideoExport.svelte`、`src/routes/video-export.svelte.test.ts`
- Modify: `src/routes/+page.svelte`（按鈕在八拍表按鈕旁邊、`videoOpen` 加進 `overlayOpen`）、`src/lib/components/Icon.svelte`（加一個 `video` 圖示）

**Interfaces:**
- Consumes: `Modal`、`getEditor().adapters.video`、`videoFrame`、`videoDurationSec`、`VIDEO_FPS`、`layoutFrame`、`overflowEights`、`drawFrame`、`renderSoundtrack`、`mixClips`、`missingAudioNames`、`videoFileName`。
- Produces: `<VideoExport flow={flow} onclose={() => void} />`。量字：真的用一個 `OffscreenCanvas` 的 `measureText`；jsdom 沒有，元件收 `measure?: Measure` prop，測試給假的。

畫面狀態（文字照抄）：
- **準備**：「影片長 m:ss」；有放不下的寫「這幾個八拍有東西放不下，會縮成一行或拿掉：…」；有沒聲音的段寫「這幾段找不到音樂，影片裡沒有聲音：…」；按鈕「開始」、「取消」。
- **不支援**：「這個瀏覽器不能輸出影片，請用電腦的 Chrome 或 Edge」，按鈕「關閉」。
- **輸出中**：進度條（`<progress max={frames} value={done}>`），「做到第 N 格／一共 M 格」，按鈕「取消」。Esc、點背景都當取消。
- **做好了**：「做好了，X.X MB」，按鈕「存檔」、「關閉」。
- **失敗**：「沒做成：<原因>」，按鈕「再試一次」、「關閉」。
- 開始時把當下的 `flow` 存一份，整支用它。

- [ ] **Step 1: 寫會失敗的測試**（`testEditor` ＋ `editorPage`）：
  - 有段的流程：按「輸出影片」→ 看到「開始」；按「開始」→ 看到進度條；`release()` 後看到「做好了」；按「存檔」→ `videoSaves[0].fileName === '<流程名>.mp4'`。
  - 沒有段：按鈕 disabled。
  - 窄螢幕、觸控螢幕：沒有這個按鈕（照現有窄螢幕測試的做法設定）。
  - `supported: false`：按「開始」前就顯示不支援那句話，沒有「開始」。
  - `fail: '記憶體不夠'`：顯示「沒做成：記憶體不夠」，按「再試一次」重新開始。
  - Review Focus 4：輸出中按「取消」→ 假編碼器 `aborted === true`、對話框關掉；再開、再按開始 → `drawn` 從 0 重新算，最後 `drawn.length === frames`。
  - 輸出中：對話框蓋住，`Space` 不會開始播放（`overlayOpen`）。
  - 檢視模式也能輸出。
- [ ] **Step 2:** `npx vitest --run src/routes/video-export.svelte.test.ts` → FAIL。
- [ ] **Step 3:** 實作元件和按鈕（窄的時候跟八拍表一樣只留圖示，用同一組 `*-hide` class）。
- [ ] **Step 4:** `npx vitest --run` 全過；`npm run check` 過。
- [ ] **Step 5: Commit** `流程影片：輸出影片的按鈕和對話框`

### Task 8: 真瀏覽器檢查、使用說明、離線

**Files:**
- Modify: `scripts/check-layout.mjs`、`src/routes/guide/+page.svelte`、`src/routes/guide/guide.svelte.test.ts`（有列章節的話）、`docs/deploy.md`、`docs/guide-diagrams/README.md` 提到的截圖

- [ ] **Step 1:** `check-layout.mjs` 加兩條，先跑一次確定會失敗再修：
  - 「1024×768：輸出影片按鈕整個在上方列裡、點得到」（`elementFromPoint` 打到按鈕本身）。
  - 「輸出影片：用 `docs/samples/sample-flow.zip` 做出來的檔，開頭是 `ftyp`，有 `avc1` 和 `mp4a`」：在頁面裡呼叫輸出、拿回 bytes 檢查前 64 KB 的字串（headless Chrome 的 `canEncode*` 試驗時是 true）。
- [ ] **Step 2:** `npm run check:layout` 全過。
- [ ] **Step 3:** 用 `docs/samples/sample-flow.zip` 在電腦 Chrome 實際輸出一次，`ffprobe` 確認：`h264` profile `Baseline`、level 40（試驗時 ffprobe 對 `avc1.424028` 就是這樣寫）、1080×1920 30 fps、`aac` 48000 Hz 2 聲道、長度 = 流程長 + 3 秒；`ffmpeg -v error -i out.mp4 -f null -` 沒有輸出。抽開頭、中間、口號段各一格看字有沒有被切掉。記下花了幾秒、檔案多大，寫進 `docs/research/video-export.md` 的「實測」。
- [ ] **Step 4:** 使用說明加一段「輸出影片」：做什麼、哪些瀏覽器可以、放不下時會怎樣、流程改了要再輸出一次；照 `docs/guide-diagrams/README.md` 重拍有上方列的截圖（`npm run guide:shots`）。`docs/deploy.md` 寫 mediabunny 的 chunk 會被預先快取（Task 5 量到的大小）。
- [ ] **Step 5:** `npm test`、`npm run check`、`npm run check:layout` 全過。
- [ ] **Step 6: Commit** `流程影片：版面檢查、實際輸出一次、使用說明`
