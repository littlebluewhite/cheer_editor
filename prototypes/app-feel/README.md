# 小樣：app 的手感（#300，比完就丟）

這個資料夾只在本機分支 `prototype/app-feel`，不進 `main`、不推上 GitHub。
比的是三組：**現在的網頁在 Safari 裡（基準）**、**(A) 原生小樣**、**(B) 網頁小樣**。尺照「用起來更順」那張票（#299）。

## 裡面有什麼

| | 是什麼 | 只做了什麼 |
|---|---|---|
| `native/`（A 原生小樣） | SwiftUI 殼、UIKit 畫場地；JavaScriptCore 跑同一包流程核心；AVAudioEngine 播音樂 | 場地和 20 個人、播放、每拍閃一下（右上角方塊，八拍的 1 是紅的）、iPad 橫拿先選中再拖、打開 `.cheera`／zip、打開就回上次那支。**不是完整的編輯器** |
| `web/`（B 網頁小樣） | WKWebView 包現在的網頁 | 「包在app裡」：網頁檔在安裝包裡；多兩個掛鉤（打開 `.cheerb`／zip、打開就回上次那支）。「連到網站」：開正式站，沒有掛鉤 |
| `make-flow.mjs` | 假流程 | 20 人（測01–測20）、3 分鐘、120 BPM 滴答聲、23 張站位 |
| `build.sh` | 建、裝、打開 | `./build.sh native\|web [iphone\|ipad\|both\|sim]` |

免費帳號：**裝到 2026-11-28 下午 2 點多（台灣時間）就打不開**，要重建重裝：

```sh
cd .claude/worktrees/app-feel   # 這個分支的 worktree
npm ci && npm run i18n          # 第一次才要
cd prototypes/app-feel && ./build.sh native both && ./build.sh web both
```

`.local.env`（不進 git）要有 `LOCAL_TEAM_ID`、`LOCAL_BUNDLE_PREFIX`、`IPHONE_UDID`、`IPAD_UDID`。

B 沒放 `WKAppBoundDomains`：模擬器上試過，放了以後 `limitsNavigationsToAppBoundDomains` 開著，`app://` 整頁空白；關著，殼塞的 script 不跑。所以「連到網站」那一種沒有 service worker（小框寫 `SW無`）。

## 量測小框

- **A**：左上角。`格`＝一秒幾格；`卡`＝每秒卡住幾毫秒（Apple：5 以下算好）；`慢`＝最慢的一格幾毫秒；`延遲`＝系統說的出聲延遲／緩衝；`核心`＝流程核心算一格位置幾毫秒；`拖一步`＝放手後流程核心改站位幾毫秒；`開到看到流程`＝點圖示到畫出流程幾毫秒。下面「扣延遲」按鈕：畫面扣掉出聲延遲（預設開）。
- **B**：左下角，一樣的格、卡、慢、延遲；`SW` 是 service worker 有沒有管這頁；`存` 是網頁的資料會不會被清；黃字切「扣延遲」（預設關，就是現在網頁的樣子）；藍字切「包在app裡／連到網站」。
- **Safari**：要數字的話，Mac 的 Safari →「開發」→ iPhone → 那一頁 → 主控台，貼 `window.__shellState={mode:'Safari',latencyFix:false};` 再貼 `web/CheerFeelWeb/hud.js` 的全文。

## 怎麼測（網站主人）

先把 Mac 桌面 `app-feel-test` 資料夾的三個檔（`out/to-device/` 的副本）用 AirDrop 傳到 iPhone、iPad（存到「檔案」），再用 LINE 傳給自己一次。

0. **先試兩分鐘**：兩台都在 A、B 打開流程檔、按播放，有聲音、人會走就好。有問題先回報，不用往下做。

每一項先正常做一次，再開「低耗電模式」做一次。錄影時，每段開頭在鏡頭前拍一下手（扣掉錄影那台自己的聲音、畫面差）。

1. **iPhone 檢視模式，播一整首**：Safari（`https://littlebluewhite.com` 開 zip）、A、B 各一次。內建喇叭一次、藍牙喇叭一次。
   - 看：會不會頓（第 4 條，眼睛說了算）。
   - 用 iPad 錄影（慢動作更好），拍到畫面和聽到滴答聲。A 看右上角方塊亮起來；Safari、B 看八拍表那一格跳過去。A、B 的「扣延遲」開、關各錄一段。影片傳到 Mac，我來數格（第 5 條）。
2. **iPad 橫拿編輯，選一個人拖 10 次，拖完播一段**：Safari、A、B。看跟不跟手、頓不頓。
3. **打開流程檔**（第 2 條），兩台都做，數點幾下：
   - 「檔案」App 點 `app-feel-test.zip`：會怎樣？
   - 「檔案」App 點 `app-feel-test.cheera`（應該開 A）、`.cheerb`（應該開 B）。
   - LINE 裡點那三個檔：要點幾下才到 app？
4. **關掉再點圖示**（第 1 條）：兩台、三組都做。從 app 切換器把它滑掉，再點圖示，用另一台錄影，數到看到場地幾秒。A 的小框也會寫毫秒。Safari 量兩段：點書籤到首頁、再點最近的流程到場地。
5. **順便看**（加分、研究票查不到的）：
   - B 在 120 Hz 的機器上 `格` 是多少；低耗電模式下 Safari 和 B 是多少。
   - 播放中鎖螢幕、切到別的 app，聲音和畫面還走不走（A、B、Safari）。
   - B 切「連到網站」：`SW` 寫什麼；登入正式站，把 app 滑掉再開，還在登入嗎。
   - 飛航模式：把 B（包在app裡）滑掉再開，打得開嗎；Safari 呢。

有空就做，做不完的跟我說哪幾項沒做。
