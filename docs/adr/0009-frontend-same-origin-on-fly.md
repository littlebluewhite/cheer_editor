# 前端搬離 GitHub Pages，跟後端用同一個網址

前端現在放在 `littlebluewhite.github.io`。`github.io` 在公共後綴清單上，後端放在任何別的網址，登入用的 cookie 都算第三方 cookie，iPad、iPhone 的 Safari 一律擋掉。所以買一個自己的 `.com` 網域（在 Cloudflare 買），在 Fly.io 新加坡開一台一直開著的機器，跑 Rust 伺服器。這台伺服器同時送出前端的檔案和 API，兩邊在同一個網址。這樣 cookie 跟網頁同源（`HttpOnly; Secure; SameSite=Lax`），Safari 不會擋，也不會把壽命砍到 7 天，登入可以照 #183 定的 30 天才要重登。

## Considered Options

- **同一個網址（選這個）**：Safari 不擋，沒有 7 天上限，也不用設 CORS。每月約 US$5–6（Fly 新加坡 512 MB 約 US$4.69，網域一年約 US$11）。
- **前端留在 GitHub Pages，登入改用 token**：每月 $0。可是 token 存在瀏覽器裡，Safari 分頁 7 天沒開就被清掉，要重新登入，跟 30 天對不上；網頁的 JS 也讀得到 token。後端放 Cloud Run 的話，WebSocket 每 60 分鐘斷一次。
- **買網域，前端 `cheer.網域` 留在 GitHub Pages，後端 `api.網域`**：cookie 不會被擋，可是 Safari 會把後端設的 cookie 壽命砍到 7 天（CNAME／IP 偽裝防護）。
- **cookie 加 `Partitioned`（CHIPS）**：Safari 26.2 才支援，舊 iPad 不行；用 `fetch` 有沒有效，WebKit 沒寫。

研究筆記：`research/hosting` 分支的 `docs/research/hosting.md`（#181）、`research/hosting-gaps` 分支的 `docs/research/hosting-gaps.md`。決定的細節在 #188。

## Consequences

- 瀏覽器裡的草稿綁網址，新網址看不到舊網址的草稿。舊網址先留一陣子：照舊能用、不能登入，上面寫「搬到新網址了，請把草稿下載成流程檔，到新網址打開」。大家搬好，網站主人再關。
- 新網址底下沒有 `/cheer_editor/`，`BASE_PATH` 是空的。`docs/deploy.md` 的部署要改：建好前端，放進伺服器的映像檔，再部署到 Fly。舊網址那份照舊用 GitHub Pages 建。
- 機器要一直開著（WebSocket，ADR 0007），所以每月固定付錢；Fly 沒有免費方案。
- 寄信要用自己的網域（Resend），所以買網域本來就躲不掉。
