# iPhone、iPad app：網頁不自己上網，由殼帶自己的 cookie 轉送

app 裡的網頁是包在 app 裡的，用自訂網址（ADR 0022）。伺服器只認自己網址發的登入 cookie（ADR 0012），也會擋不是從自己網址來的改資料請求和雲端流程的連線（`server/src/csrf.rs`）。所以 app 裡的網頁不自己上網：打 API、雲端流程的連線、上傳和下載音樂，全部交給殼。殼用原生的網路函式庫送，cookie 存在殼自己那裡，網頁讀不到。送的時候標上網站自己的網址（`Origin`），伺服器的登入和這個檢查都不用改。

為什麼：帳號和登入的規則照後端第一版（#177），不重談。這樣伺服器的登入和檢查都不用改，登入 cookie 照舊是 `HttpOnly`，網頁裡的程式拿不到。殼本來就要做（ADR 0022），多轉送網路不算多。伺服器那個檢查是防別的網站叫瀏覽器帶著 cookie 送請求。app 的 cookie 只在殼裡；只要殼守住下面「殼要守的規矩」那條，標上網站的網址就不會變得比較不安全。

## Considered Options

- **殼轉送，標上網站的網址（選這個）**：見上面。
- **伺服器多一種給 app 用的登入（token），網頁自己連**：伺服器要加 token、CORS，還要放行 `app://` 網址。token 要放在網頁讀得到的地方，後端研究當初說不要這樣（`docs/research/auth-safety.md`：不用 `localStorage`，不用 JWT）。
- **cookie 加 `Partitioned`**：要 Safari 26.2，app 最低是 iOS 18.4（#301）。
- **網頁直接連，靠 App-Bound Domains 放行第三方 cookie**：看原始碼，放行的模式藏在一個寫死的開關後面，會不會通沒驗（`docs/research/app-webview-shell.md`）。而且伺服器照樣擋 `app://` 來的請求。
- **殼轉送，改伺服器多認一種「app 來的」請求**：要多寫伺服器的程式，沒有比較安全。
- **音樂：R2 也放行 `app://` 網址**：R2 收不收這種網址，查不到。全部經過殼，規則只有一條。

決定的細節在 #304；伺服器現在怎麼認人、擋什麼（附程式行號）也在 #304 的留言。

## Consequences

- 殼要守的規矩：網頁畫面只開 app 裡那包網頁，或殼從自己網站抓來的新版（ADR 0025），外面的連結一律交給 Safari 開；殼只轉這包網頁送的請求。
- app 和 Safari 各登各的，各自 30 天。邀請信、忘記密碼的連結在 Safari 開，設好密碼回 app 登入；第一版不做 Universal Links。
- 網頁要把「怎麼連雲端流程」分出來：Safari 用 `WebSocket`，app 用殼給的同樣介面。現在 `src/lib/server-api.ts` 照 `location.href` 改成 `ws:`，在 app 裡會變成 `ws://local/…`。
- 分享連結在 app 裡要用網站的網址做。現在 `src/lib/share-link.ts` 照 `location.href`，在 app 裡會做出 `app://` 開頭、別人打不開的連結。
- app 切到背景、鎖螢幕就關掉雲端流程的連線，回來自己連上、補齊。只有 app 這樣；Safari（手機、電腦）照現在，不改。iPhone 的 Safari 本來就有「分頁被凍住、伺服器以為人還在」的問題，不在這次處理。這樣 app 不用管 iOS 在背景怎麼處理連線（查不到）。一起記全上的 60 秒規則照舊。
- 還沒驗：`WKURLSchemeHandler` 收不收得到 POST 和上傳的內容。收不到就改走 `messageHandlers`，還是殼送；上傳音樂改由殼自己讀檔。
- 自動填密碼用 Associated Domains，伺服器要送出 `apple-app-site-association` 這個檔（伺服器唯一要加的東西）。檔裡有 Apple 開發者團隊編號（Team ID），這個檔直接放進 repo，專案檔的 `DEVELOPMENT_TEAM` 也一樣：網站本來就要公開送出這個檔，裝了 app 的人也看得到，不算秘密（#340）。伺服器怎麼送出、檔案類型對不對，開工時驗。包在 app 裡會不會出現自動填，還沒驗；驗不過就拿掉。
