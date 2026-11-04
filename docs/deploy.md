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
