# 部署與離線

## 部署

推上 `main` 後，`.github/workflows/deploy.yml` 會跑測試、型別檢查、建置，再部署到 GitHub Pages：
`https://littlebluewhite.github.io/cheer_editor/`。

第一次要在 GitHub 上設定一次：Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
之後每次推 `main` 都會自動部署；也可以在 Actions 頁手動按 Run workflow。

## 網址底下的路徑（base path）

網站放在 `/cheer_editor/` 底下，由建置時的環境變數 `BASE_PATH` 決定（workflow 會帶 `/cheer_editor`）。
本機 `npm run dev`、`npm run build` 不設，就是 `/`。

要在本機看部署後的樣子：

```sh
BASE_PATH=/cheer_editor npm run build
BASE_PATH=/cheer_editor npm run preview   # 開 http://localhost:4173/cheer_editor/
```

程式裡的連結和檔案路徑用 `$app/paths` 的 `resolve()`／`asset()`，或用相對路徑，部署到 `/cheer_editor/` 底下才找得到。

## 離線

`@vite-pwa/sveltekit` 在建置時產生 `sw.js`（service worker）和 `manifest.webmanifest`，
把整個網站先存在瀏覽器裡。開過一次之後，沒網路也能打開。

更新：部署新版後，使用者重新整理時新的 service worker 會裝好並接手，頁面自動再載入一次，就是新版。
`npm run dev` 不會啟用 service worker，要試離線請用上面的 build + preview。

手動檢查離線：用 preview 或正式網址開一次，等頁面載完，開發者工具 Network 勾 Offline（或關掉 preview），重新整理，編輯器還能打開。

輸出影片用的 `mediabunny` 是動態 `import()`，建置後自己一個 chunk（2026-11-18 量：約 235 KiB，gzip 約 60 KiB），
不在首頁一開就載的檔案裡（`build/index.html` 的 modulepreload 沒有它）。它跟其他 `_app/immutable` 的檔一樣被 service worker 先存起來
（`sw.js` 的先存清單裡有它）；編輯器打開時不會去載它。

離線輸出影片實測過（2026-11-19，Mac、headless Chrome 157，`npm run build` 加 `vite preview`）：先開一次網站，等 service worker 接手、
快取裡有影片工具那一塊，再把 preview 關掉（連不上伺服器）、頁面也設成離線（CDP `Network.emulateNetworkConditions`，`navigator.onLine` 是 false），
重新開首頁、用 `docs/samples/sample-flow.zip` 輸出：影片工具從 service worker 拿到，對話框寫「影片長 0:12」，約 5 秒做完（兩次：4.7、5.1 秒）「做好了，0.7 MB」，
存下來的檔開頭是 `ftyp`、有 `avc1` 和 `mp4a`。只試過這一台。

影片工具載不下來（例：service worker 還沒存好就斷網）時，對話框寫「影片工具載不下來，請連上網路再試一次；還是不行，請重新整理頁面」。
同一天實測（同一台，service worker 不回、改從網路拿）：斷網或擋掉那一塊時打開對話框是這句話，恢復網路後按「再試一次」就到「開始」，
不用重新整理（Chrome 沒記住上次載入失敗）。網站剛更新、舊的那一塊已經不在時，再試一次也沒用，要重新整理才拿到新版，所以話裡留著重新整理。
`npm run check:layout` 有一條在開發模式擋掉再放行，看「再試一次」走得到「開始」。

## App 圖示

圖示畫在 `static/favicon.svg`（墊子條紋加圓點，用 `src/app.css` 的顏色）。分頁上的 favicon、
iPhone／iPad 主畫面的 `apple-touch-icon.png`、PWA manifest 的 `pwa-192x192.png`／`pwa-512x512.png` 都從它產生。
`static/` 底下的檔會一起被 service worker 先存起來，離線也有圖示。

改了 SVG 就重新產生一次（要先裝 ImageMagick），產生的檔一起 commit：

```sh
sh scripts/app-icons.sh
```
