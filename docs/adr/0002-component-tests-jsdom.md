# 畫面元件測試用 jsdom，「螢幕座標換公尺」做成可以換掉

畫面元件測試跑在 Vitest + jsdom（`@testing-library/svelte`）。jsdom 不算版面，`getScreenCTM()`、`getBoundingClientRect()` 拿不到真的值，所以場地上「滑鼠的螢幕座標 → 場地公尺座標」這一步要做成可以換掉的函式：場地元件收一個換算函式（prop），預設用 SVG 的 `getScreenCTM()` 反矩陣算；測試傳一個簡單的假換算（例如 1 px = 1 cm），再用 `fireEvent` 送 pointer 事件，斷言送進流程核心的公尺位置和畫面結果。吸附、位置文字這些規則都在流程核心，直接用公尺測，不經過換算。

沒選 Vitest 瀏覽器模式：它要裝 Playwright 和瀏覽器，規格（#15）把 Playwright 留到之後；而且要測的規則都在流程核心，畫面元件只要驗證「使用者做的事 → 對的核心指令」。代價是預設那個換算函式（幾行 `getScreenCTM()`）沒有自動測試，靠手動檢查。之後加 Playwright 時再補。

## 2026-11 更新：真瀏覽器版面檢查

jsdom 量不到的東西（點擊命中、溢出、捲動、媒體查詢、列印樣式）放到 `npm run check:layout`（`scripts/check-layout.mjs`）。它跟重拍使用說明截圖一樣，自己開 `vite dev` 和 headless Chrome、用 CDP 操作，沒有裝 Playwright。每一條檢查都是「做某件事 → 用真的版面量一個東西」，怎麼加一條寫在腳本開頭。其他行為照舊放 jsdom 的整頁測試和流程核心的測試。
