# 邀請信、設密碼、登入：怎麼做才安全

Issue #182（地圖 #177）。範圍：「管理員加人 → 使用者收信 → 設密碼 → 登入」這一套。沒有自己註冊，只有一個管理員能加人。這裡只整理公認的做法和數字，真正怎麼定留給 #183。

查核日期 2026-11-06。用詞照 `GLOSSARY.md`「帳號」那節：使用者、管理員、擁有者。

標記方式：

- **已確認**：有原文，方括號是來源代號，見文末「來源」。
- **推論**：我自己推的，或拿來源的規則套到我們的情況。會寫明「推論」。
- 原文的 SHALL 寫成「一定要」，SHOULD 寫成「應該」，MAY 寫成「可以」。

## 先講幾個詞

- **token**：一串很長的隨機字，像一次性的鑰匙。邀請信、重設密碼的連結裡都有一個。
- **雜湊（hash）**：把一段字單向打亂。存的是打亂後的樣子，看不出原本的字；但同一段字打亂後永遠一樣，所以拿來比對。
- **安全的亂數產生器（CSPRNG）**：專門給密碼學用的亂數，猜不出下一個。一般的 `random()` 不算。
- **session**：「這個瀏覽器已經登入了」的紀錄。伺服器記一筆，瀏覽器拿一個 cookie 當號碼牌。
- **cookie 屬性**：`Secure` 只走 HTTPS；`HttpOnly` 網頁上的 JavaScript 讀不到；`SameSite` 別的網站發出的請求不帶這個 cookie。
- **CSRF（跨站請求偽造）**：壞網站趁你登入著，偷偷叫你的瀏覽器對我們的網站送出請求。
- **列舉（enumeration）**：從錯誤訊息或回應快慢，猜出某個 email 有沒有帳號。
- **撞庫（credential stuffing）**：拿別的網站外洩的帳號密碼來試。
- **兩步驟驗證（MFA）**：密碼之外再要一樣東西，例如手機 App 上 30 秒換一次的六位數（TOTP），或 passkey（用手機或電腦的指紋、臉、PIN 登入，網址不對就不會動）。

## 結論

1. **連結裡的 token：用安全亂數、至少 128 bits、只存雜湊、用一次就作廢、寄到 email 的最多 24 小時。** 128 bits 來自 OWASP 和 ASVS 對 session token 的要求；NIST 對復原碼要求至少 64 bits。NIST 寄到 email 的確認碼、復原碼最多 24 小時有效，用過就作廢 [800-63A §3.8] [800-63B §4.2]。OWASP 和 ASVS 只說「短時間」「用過就失效」，沒給數字 [OWASP 忘記密碼] [ASVS 6.4.1]。已確認。
2. **密碼：只用密碼登入時最短 15 個字；有兩步驟驗證才能降到 8。不准規定大小寫符號，不准定期強迫換。一定要擋常見和外洩過的密碼。** 這是 NIST 的 SHALL [800-63B §3.1.1.2]，OWASP 跟著寫 [OWASP 登入]。ASVS 第 1 級只要 8 個字，但「強烈建議」15 [ASVS 6.2.1]。至少要能輸入 64 個字 [800-63B §3.1.1.2]。已確認。
3. **密碼雜湊用 Argon2id，最低 19 MiB 記憶體、跑 2 次、1 條平行（m=19456, t=2, p=1）。** 這是 OWASP 的第一選擇；RFC 9106 給的「省記憶體版」是 64 MiB、3 次、4 條 [OWASP 存密碼] [RFC 9106 §4]。NIST 只要求「加鹽、用抗離線破解的雜湊、成本盡量高」，鹽至少 32 bits [800-63B §3.1.1.2]。已確認。
4. **登入狀態用伺服器端 session + cookie，不要把 token 放 `localStorage`。** cookie 設 `__Host-` 開頭、`Secure`、`HttpOnly`、`SameSite=Lax` 或 `Strict`、`Path=/`、不設 `Domain` [OWASP Session] [800-63B §5.1.1]。登入時一定要換一個新的 session 號碼 [ASVS 7.2.4]。已確認。
5. **iPad 不想常重登：NIST 最低等級（只用密碼）的「多久一定要重登」應該不超過 30 天，閒置登出可有可無。** 有兩步驟的等級是 24 小時、閒置 1 小時 [800-63B §2.1.3、§2.2.3]。OWASP 的例子比較嚴（辦公室整天用的，4–8 小時）[OWASP Session]。cookie 的到期日不能拿來當登出的依據，要伺服器自己算 [800-63B §5.1.1]。已確認。
6. **忘記密碼：不管 email 有沒有帳號，都回一樣的話、一樣快；不准用安全問題；重設後不要自動登入，要通知本人，並登出其他裝置。** [OWASP 忘記密碼] [800-63B §3.1.1.2] [ASVS 6.4.2]。已確認。
7. **擋暴力猜密碼：每個帳號連續失敗最多 100 次就要停用那個密碼（要重設才能用）；在那之前可以越等越久。** NIST 說 100 是上限，可以更低 [800-63B §3.2.2]。OWASP 提醒鎖帳號會被拿來惡意鎖別人，建議計數跟著帳號走、鎖住時仍可走忘記密碼 [OWASP 登入]。已確認。
8. **第一個管理員：不准有預設帳號或預設密碼，密碼和金鑰不進 repo。管理員要開兩步驟驗證。** [ASVS 6.3.2] [OWASP Top 10 A07] [OWASP 金鑰] [OWASP MFA]。怎麼建出來，OWASP 和 NIST 都沒寫流程；第 9 節的做法是推論。
9. **停用或刪掉帳號時，要馬上結束這個人所有已登入的 session。** ASVS 第 1 級就要求 [ASVS 7.4.2]。這也是選伺服器端 session、不選 JWT 的主要理由：JWT 要另外做黑名單才收得回來 [ASVS 7.4]。已確認。
10. **用 cookie 登入就要擋 CSRF。`SameSite` 只算多一層，不能單靠它。** 改資料的請求不准用 GET；API 可以要求自訂 header 配嚴格的 CORS 名單，或檢查 `Sec-Fetch-Site`／`Origin` [OWASP CSRF]。已確認。

## 1. 邀請信和設密碼連結

我們的邀請信其實就是「第一次設密碼」的連結，跟忘記密碼的重設連結幾乎一樣。下面兩種一起講。

### token 本身

| 項目 | 一手來源怎麼說 | 來源 |
|---|---|---|
| 怎麼產生 | 用安全亂數。 | [OWASP 忘記密碼] [ASVS 6.4.1] |
| 多長 | OWASP 忘記密碼只說「夠長，擋得住暴力猜」，沒給數字。session token 至少 128 bits；自己存驗證值時「最好 160 bits 以上」。 | [OWASP 忘記密碼] [OWASP Session] [ASVS 7.2.3] |
| 多長（NIST） | 復原碼至少 64 bits；接續碼（continuation code）至少 64 bits、存雜湊、用過作廢。 | [800-63B §4.2] [800-63A §3.9] |
| 怎麼存 | 「安全地存」。OWASP Session 對 session 號碼的寫法：怕資料庫被讀走，就只存 SHA-256 雜湊，不存原字。 | [OWASP 忘記密碼] [OWASP Session] |
| 用幾次 | 用過就作廢。 | [OWASP 忘記密碼] [ASVS 6.4.1] [800-63A §3.8] |
| 多久失效 | OWASP：「適當的時間」，沒數字。NIST：寄到 email 的確認碼、復原碼最多 24 小時；簡訊 10 分鐘；郵寄 21 天。 | [OWASP 忘記密碼] [800-63A §3.8] [800-63B §4.2] |
| 連結網址 | 不要用請求裡的 Host header 組網址，要寫死或比對信任的網域名單。一定要 HTTPS。 | [OWASP 忘記密碼] |
| 設密碼那一頁 | 加 `Referrer-Policy: no-referrer`，免得 token 從 Referer 漏給別的網站。 | [OWASP 忘記密碼] |
| 擋猜 token | 對猜 token 也要限制次數。 | [OWASP 忘記密碼] |

對照：GitHub 邀人進組織的邀請 7 天沒接受就失效，可以重寄 [GitHub 邀請]。但那是邀「已經有帳號的人」，信裡的連結不能直接設密碼，風險比我們的小。

推論：

- token 用 32 bytes（256 bits）安全亂數，base64url 編碼是 43 個字，放進網址剛好。比 128 bits 多，但沒有成本。
- token 本身已經夠亂，資料庫存 SHA-256 就好，不用像密碼那樣用 Argon2id（OWASP Session 也是用 SHA-256 存驗證值）。
- 打開連結（GET）只顯示「設密碼」表單；按下送出（POST）才用掉 token。理由是改資料不准用 GET [OWASP CSRF]。另外常聽說公司信箱的安全掃描會先幫你點開信裡的連結，如果 GET 就用掉 token，使用者自己點時已經失效。這點沒找到一手來源。
- 重寄邀請時，舊的連結作廢，同一個人同時只有一條有效。OWASP 沒直接寫；它寫懷疑被盜時要作廢「所有還沒用的重設連結」[OWASP 忘記密碼]。一次只留一條，比較好管。
- 前端是靜態網站。連結可以指到前端的「設密碼」頁，token 放在網址 `#` 後面；`#` 後面的字瀏覽器不會送給伺服器，也不會出現在 Referer 和伺服器紀錄裡。頁面再用 POST 把 token 交給後端。

### 信裡寫什麼

OWASP 只說：重設成功後寄信通知，**信裡不准放密碼** [OWASP 忘記密碼]。NIST 說復原之後一定要通知本人 [800-63B §4.2]。

推論，邀請信可以寫：誰邀你（管理員的顯示名稱）、網站名稱、按鈕連結、幾點以前有效、「沒預期收到這封信就不用理」。不寫密碼，不寫內部 ID。

### 設完密碼之後

- OWASP 對重設密碼說：不要自動登入，因為會讓 session 處理變複雜 [OWASP 忘記密碼]。邀請信沒有直接的規定。
- 設完密碼、改密碼、重設密碼，都寄一封通知信 [OWASP 忘記密碼] [ASVS 6.3.7]。
- 管理員可以替人「發起」重設，但不能替人「決定」密碼 [ASVS 6.4.6]。我們的流程本來就是這樣：管理員只填 email，密碼是使用者自己設的。

## 2. 密碼規則

全部出自 [800-63B §3.1.1.2]，除非另外標。

| 規則 | 內容 |
|---|---|
| 最短 | 只用密碼登入：一定要至少 15 個字。密碼搭配兩步驟時：至少 8 個字。OWASP 一樣 [OWASP 登入]。ASVS 第 1 級 8 個字，強烈建議 15 [ASVS 6.2.1]。 |
| 最長 | 應該至少允許 64 個字 [ASVS 6.2.9]。 |
| 字元 | 應該接受所有可列印 ASCII、空白、Unicode；一個 Unicode 碼點算一個字。用 Unicode 時，雜湊前應該先做 NFC 正規化（把看起來一樣的字統一成同一種寫法）。 |
| 組成規則 | 一定不能規定「要有大寫、數字、符號」這類規則。 |
| 擋常見密碼 | 一定要。新密碼要比對「常見的、猜得到的、外洩過的」名單，包括網站名稱、使用者名稱。被擋要說原因。整個密碼比對，不是比片段。名單不用太大，太大反而讓人選不出好記的密碼（附錄 A）。ASVS 第 1 級：至少前 3000 個常見密碼；第 2 級：比對外洩密碼 [ASVS 6.2.4、6.2.12]。OWASP Top 10：前 10,000 個最爛密碼 [OWASP Top 10 A07]。 |
| 定期換密碼 | 一定不能強迫定期換；確定外洩時才一定要換。 |
| 提示、安全問題 | 一定不能有密碼提示，一定不能問安全問題 [ASVS 6.4.2]。 |
| 貼上、密碼管理器 | 一定要允許密碼管理器和自動填入；應該允許貼上；應該能按一下顯示密碼 [ASVS 6.2.7]。 |
| 截斷 | 一定要比對整個密碼，不能只取前幾個字。 |
| 改密碼 | 要輸入目前的密碼和新密碼 [ASVS 6.2.3]。 |

外洩密碼怎麼查：Have I Been Pwned 的 Pwned Passwords 範圍 API。把密碼做 SHA-1，只送前 5 個字，對方回傳所有同開頭的雜湊尾巴，在自己這邊比對；對方不會看到完整的雜湊。免費、不用金鑰、沒有次數限制；也可以整包下載自己放 [HIBP]。OWASP 登入也推薦它 [OWASP 登入]。

讓密碼管理器和 iPad 的自動填入認得欄位：設密碼頁用 `autocomplete="new-password"`，登入頁用 `username` 和 `current-password` [HTML autofill]。

## 3. 密碼怎麼存

| 項目 | 內容 | 來源 |
|---|---|---|
| 演算法 | Argon2id 第一；沒有才用 scrypt；bcrypt 只給舊系統；要 FIPS 才用 PBKDF2。 | [OWASP 存密碼] |
| Argon2id 最低參數 | 五組等強度，任選一組：46 MiB/1 次/1 條、**19 MiB/2 次/1 條**、12 MiB/3 次/1 條、9 MiB/4 次/1 條、7 MiB/5 次/1 條。 | [OWASP 存密碼] |
| RFC 9106 建議 | 第一建議：2 GiB、1 次、4 條。記憶體不夠時：64 MiB、3 次、4 條。鹽 128 bits，輸出 256 bits。 | [RFC 9106 §4] |
| 鹽（salt） | 每個密碼一個不同的隨機鹽。NIST：至少 32 bits；RFC 9106：128 bits。 | [OWASP 存密碼] [800-63B §3.1.1.2] [RFC 9106 §4] |
| 成本 | 應該在不拖慢伺服器的前提下越高越好，並且隨時間調高；演算法和參數應該跟著每筆雜湊一起存，方便以後升級（例：PHC 字串格式 `$argon2id$v=19$m=19456,t=2,p=1$...`）。 | [800-63B §3.1.1.2] [OWASP 存密碼] |
| pepper（全站共用的秘密） | NIST：應該再加一道用秘密金鑰的步驟，金鑰要跟雜湊分開放。OWASP：可選，不能放在資料庫旁邊；換 pepper 等於全部人要重設密碼。 | [800-63B §3.1.1.2] [OWASP 存密碼] |

NIST 說雜湊方式「應該」用 SP 800-132（PBKDF2）[800-63B §3.1.1.2]。我們不是美國政府單位，跟 OWASP 用 Argon2id 沒問題。推論。

推論：Argon2id 每次登入吃 19 MiB 記憶體。免費主機常只有 256–512 MB，十幾個人同時登入就可能吃緊。要限制同時算雜湊的數量，或挑記憶體大一點的方案（主機見 #181）。

## 4. 登入後怎麼記住

### session 還是 token

- 不要把 session 號碼、token、JWT 放 `localStorage`／`sessionStorage`，因為網頁上任何一段被塞進來的 JavaScript（XSS）都讀得到 [OWASP Session] [800-63B §5.1]。
- 用 `HttpOnly; Secure; SameSite` 的 cookie [OWASP Session]。
- 驗 session 要在後端做 [ASVS 7.2.1]。自己帶資料的 token（JWT 這類）要另外做黑名單或換簽章金鑰才收得回來 [ASVS 7.4]。

推論：用「隨機 session 號碼 + PostgreSQL 一張 session 表」。資料庫只存號碼的 SHA-256 [OWASP Session]，資料庫外洩也拿不到能用的號碼。要登出某人，刪掉他的 session 列就好。

### cookie 怎麼設

| 屬性 | 內容 | 來源 |
|---|---|---|
| 號碼 | 安全亂數，至少 128 bits [ASVS 7.2.3]；OWASP 最低 64 bits，自己產生用 128 以上 [OWASP Session]；NIST 至少 64 bits [800-63B §5.1]。 | |
| 名字 | 用不洩漏框架的名字，例如 `id`。 | [OWASP Session] |
| `__Host-` 開頭 | 應該用。瀏覽器會強制它一定 `Secure`、`Path=/`、沒有 `Domain`，只送回設它的那台主機。 | [800-63B §5.1.1] [OWASP Session] [RFC 6265bis §4.1.3.2] |
| `Secure` | 一定要。 | [800-63B §5.1.1] |
| `HttpOnly` | 應該。 | [800-63B §5.1.1] |
| `SameSite` | 應該設 `Lax` 或 `Strict`。`Strict` 連從別的網站點進來的第一頁都不帶；`Lax` 從別的網站用連結點進來（GET 換頁）會帶，別的網站送 POST 不帶。 | [800-63B §5.1.1] [RFC 6265bis §5.6.7.1] |
| 到期日 | 設 `Max-Age` 才會在關掉瀏覽器後還留著。瀏覽器最多只留 400 天。但 cookie 到期日不能拿來當登出依據，要伺服器自己算。 | [OWASP Session] [RFC 6265bis §5.5] [800-63B §5.1.1] |
| 換號碼 | 登入、重新登入、改密碼、權限變了，都要換新的號碼（擋「session 固定」攻擊：壞人先塞一個號碼給你，等你登入後拿來用）。 | [OWASP Session] [ASVS 7.2.4] |

RFC 6265bis 是新版 cookie 規格，到 2026-11-06 還是草稿（-22，等 RFC Editor 最後核准），還沒有 RFC 編號 [RFC 6265bis 狀態]。

### 多久登出

| 來源 | 多久一定要重登 | 閒置多久登出 |
|---|---|---|
| NIST AAL1（只要一個因素，例如只用密碼） | 一定要有上限，應該不超過 30 天 | 可以有，不強制 |
| NIST AAL2（兩步驟） | 一定要有上限，應該不超過 24 小時 | 應該不超過 1 小時 |
| NIST AAL3（硬體金鑰這類） | 一定不超過 12 小時 | 應該不超過 15 分鐘 |
| OWASP | 例子：整天用的辦公室系統 4–8 小時 | 高價值 2–5 分鐘；低風險 15–30 分鐘 |
| ASVS | 要有閒置上限和絕對上限，並寫進文件（第 2 級） | 同左 |

來源：[800-63B §2.1.3、§2.2.3、§2.3.3] [OWASP Session] [ASVS 7.1.1、7.3.1、7.3.2]。

- NIST：重新登入成功才會把兩個計時都歸零 [800-63B §5.2]。也就是說「一直在用」不會延長「多久一定要重登」那個上限。
- 同時好幾個裝置登入，是設計上的選擇。建議讓使用者看得到自己登入了哪些裝置、能遠端登出 [OWASP Session] [ASVS 7.5.2]。
- 登出時：伺服器端作廢 session；cookie 清空並設成過期；可以加 `Clear-Site-Data` [OWASP Session]。

### iPad Safari 要注意的

- Safari 會刪掉 JavaScript 寫的 cookie 和 `localStorage` 這類資料，條件是 7 天沒互動。規則只寫「JavaScript 寫的」，沒有寫到伺服器用 HTTP 回應設的 cookie。但如果後端網址是「看起來是自己的子網域、其實指到別家」（CNAME 或 IP 偽裝），HTTP 回應設的 cookie 也最多只留 7 天 [WebKit 追蹤防護]。
- Safari 預設擋掉所有第三方 cookie，沒有例外 [WebKit 追蹤防護]。前端在 `github.io`、後端在別的網域時，登入 cookie 就算第三方。這題歸 #181。
- 加到主畫面的網頁 App，資料跟 Safari 分開 [WebKit 追蹤防護]。推論：教練從主畫面打開時要另外登入一次。

## 5. 忘記密碼

| 項目 | 內容 | 來源 |
|---|---|---|
| 回應 | 不管 email 有沒有帳號，都回一樣的訊息。例：「如果這個 email 有帳號，我們已經寄出重設密碼的信。」 | [OWASP 忘記密碼] [OWASP 登入] |
| 回應時間 | 一樣快。不要「沒這個人就馬上回」。 | [OWASP 忘記密碼] [OWASP 登入] |
| HTTP 狀態碼 | 也不能不一樣。 | [OWASP 登入] |
| 次數 | 每個帳號限制重設請求的次數，或加 CAPTCHA。 | [OWASP 忘記密碼] |
| 鎖帳號 | 不要因為有人一直按「忘記密碼」就鎖帳號。 | [OWASP 忘記密碼] |
| 安全問題 | 不能當唯一的方法；NIST 和 ASVS 根本不准用。 | [OWASP 忘記密碼] [800-63B §3.1.1.2] [ASVS 6.4.2] |
| 重設之後 | 不要自動登入；寄通知信；問使用者要不要登出其他裝置，或直接全部登出。 | [OWASP 忘記密碼] |
| 懷疑被盜 | 作廢所有 session、所有還沒用的重設連結，並通知本人。 | [OWASP 忘記密碼] |
| 有開兩步驟的人 | 重設密碼不能繞過兩步驟。 | [ASVS 6.4.3] |

推論：要「一樣快」，最簡單是寄信交給背景工作去做，API 不等寄信就回。

推論：被停用的帳號、還沒設密碼的帳號，按忘記密碼也回同一句話。要不要真的寄信（例：還沒設密碼的人改寄一封新邀請），留給 #183。

## 6. 擋暴力猜密碼

| 來源 | 內容 |
|---|---|
| NIST | 同一個密碼連續失敗一定不超過 100 次，到了就停用那個密碼，要重設才能再用。100 是上限，可以更低。在那之前可以：越等越久（例：30 秒到 1 小時）、擋機器人、看 IP 和地點這類風險訊號。登入成功應該把失敗次數歸零。[800-63B §3.2.2] |
| OWASP 登入 | 失敗次數跟著帳號算，不是跟著 IP 算。三個要定的數字：失敗幾次鎖、在多長時間內、鎖多久。可以用「越鎖越久」：從 1 秒開始，每次失敗加倍。鎖帳號可能被拿來惡意鎖別人，所以鎖住時仍可以走忘記密碼。CAPTCHA 可以在失敗幾次之後才出現。兩步驟驗證是最有效的防法。[OWASP 登入] |
| OWASP Top 10 | 限制或逐漸延遲失敗的登入，但小心別變成讓人鎖死別人。記錄失敗，被攻擊時通知管理員。[OWASP Top 10 A07] |
| ASVS | 要有擋撞庫和暴力猜的機制，而且寫進文件，並說明怎麼避免惡意鎖帳號。[ASVS 6.1.1、6.3.1] |

錯誤訊息只寫「email 或密碼不對」。不要分「沒有這個帳號」「密碼錯」「帳號被停用」「帳號被鎖」[OWASP 登入] [ASVS 6.3.8]。

## 7. 管理員帳號

### 第一個管理員怎麼來

一手來源只講「不能怎樣」：

- 不准有預設帳號（例：`admin`、`root`），有的話要停用 [ASVS 6.3.2]。
- 不准帶著預設帳密上線，尤其是管理員 [OWASP Top 10 A07]。
- 秘密不要寫在原始碼裡；提交前就要掃描有沒有秘密 [OWASP 金鑰]。
- 環境變數會被其他程式讀到，也可能出現在紀錄和錯誤傾印裡；不要寫進 Docker 的 `ENV`/`ARG` [OWASP 金鑰]。

推論，兩種常見做法，都不會讓密碼進 repo：

1. **伺服器上跑一次指令**：例如 `建立管理員 --email ...`。程式建好帳號，產生一條一次性的設密碼連結，寄出或印在畫面上；連結照第 1 節的規則失效。
2. **第一次啟動時看設定**：設定裡只放管理員的 email（不是密碼）。資料庫一個使用者都沒有時，自動建管理員並寄邀請信。

兩種都不要用「把管理員密碼放環境變數」，理由見上面 [OWASP 金鑰]。「只有一個管理員」可以在資料庫裡用限制條件擋住（推論）。

### 要不要兩步驟驗證

- OWASP：管理員和高權限帳號要開兩步驟 [OWASP MFA]。
- ASVS 第 2 級：所有人都要兩步驟（或等效組合）[ASVS 6.3.3]。第 1 級沒要求。
- 首選 passkey／WebAuthn（防釣魚）；其次手機 App 的 TOTP，30 秒一組（RFC 6238 預設），每組只能用一次 [OWASP MFA] [ASVS 6.5.1、6.5.5]。
- 不要用簡訊；email 不能當登入的因素 [OWASP MFA] [ASVS 6.3.6] [800-63B §3.1.3.1]。
- 開兩步驟時給一次性的復原碼；NIST 要求復原碼至少 64 bits，用過作廢再發新的 [OWASP MFA] [800-63B §4.2]。

推論：我們只有一個管理員。他掉了手機又沒有復原碼，網站裡沒有第二個人能幫他重設。所以管理員的最後一條路，要是「上面那個伺服器指令」。

## 8. 停用帳號

- 停用或刪除帳號時，一定要結束這個人所有已登入的 session。ASVS 第 1 級 [ASVS 7.4.2]。
- 改密碼或換兩步驟之後，要給「登出其他所有裝置」的選項（第 2 級）[ASVS 7.4.3]。
- 帳號不存在了，所有登入用的東西都要馬上作廢 [800-63B §4.5]。
- 登出或過期後，舊的 session 一定不能再用 [ASVS 7.4.1]。

推論：用第 4 節的「資料庫 session 表」，停用時刪掉這個人的所有 session 列，順便作廢他還沒用的邀請和重設連結。他下一個請求就會被擋。

推論：隊員在手機上離線記的成功率，帳號被停用後才連上網上傳，要不要收？這不在安全規則裡，留給成功率的票。

## 9. 擋 CSRF（因為用 cookie 登入）

- XSS 能破掉所有 CSRF 防法 [OWASP CSRF]。
- `SameSite` 只算多一層，大部分情況不能取代真正的 CSRF 防法 [OWASP CSRF]。
- 改資料的請求不准用 GET [OWASP CSRF]。
- 給前端呼叫的 API：可以要求一個自訂 header（例 `X-CSRF-Token`），靠瀏覽器的 CORS 預檢擋掉別的網站；CORS 只放行自己控制的幾個網址，不要用萬用字元 [OWASP CSRF]。
- 也可以檢查 `Sec-Fetch-Site`，沒有的話退回檢查 `Origin`／`Referer`；兩個都沒有就拒絕 [OWASP CSRF]。
- 登入表單也會被 CSRF（把你登入成壞人的帳號）[OWASP CSRF]。
- 全站和所有登入後的頁面只走 HTTPS [OWASP 登入]。

## 10. 改 email（#183 要問）

- 要求重新輸入密碼才能改 [ASVS 7.5.1] [OWASP 登入]。
- 舊信箱寄「只通知」的信，新信箱寄確認信，確認了才生效 [OWASP 登入]。
- 改了要通知 [ASVS 6.3.7]。

## 沒找到

- OWASP 和 NIST 都沒有「邀請信」專門的規則。第 1 節把它當成「確認 email 的連結」加上「重設密碼連結」來看，是推論。
- 重設連結建議多久失效的具體數字，OWASP 沒給；只有 NIST 的「email 最多 24 小時」。
- 信箱安全掃描會不會先點開連結、用掉一次性 token：常聽說，沒找到一手文件。
- 「記住我」（勾了就登入很久）OWASP Session 沒有專門講。
- 第一個管理員怎麼建的標準做法：只找到「不能有預設帳號、不能放 repo」的規則。

## 來源

全部查核日期 2026-11-06。

- [800-63B] NIST SP 800-63B-4《Digital Identity Guidelines: Authentication and Authenticator Management》，2025-07-31 正式版（Final），取代 2020 年的 800-63B。<https://pages.nist.gov/800-63-4/sp800-63b.html>；狀態頁 <https://csrc.nist.gov/pubs/sp/800/63/b/4/final>（列出的最後一筆是 2026-10-06 的「Implementation Resource Hub」補充資料，不是改版）。用到的節：§2.1.3、§2.2.3、§2.3.3（重新登入時間）、§3.1.1.1–3.1.1.2（密碼）、§3.1.3.1（email 不能當驗證）、§3.2.2（限制次數）、§4.2（帳號復原）、§4.5（作廢）、§5.1、§5.1.1、§5.2（session、cookie）、附錄 A。
- [800-63A] NIST SP 800-63A-4（同一套 800-63-4）。<https://pages.nist.gov/800-63-4/sp800-63a.html>。§3.8 確認碼、§3.9 接續碼。
- [OWASP 登入] OWASP Cheat Sheet Series：Authentication Cheat Sheet。<https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- [OWASP 存密碼] OWASP：Password Storage Cheat Sheet。<https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>（頁面沒有更新日期）
- [OWASP 忘記密碼] OWASP：Forgot Password Cheat Sheet。<https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>
- [OWASP Session] OWASP：Session Management Cheat Sheet。<https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- [OWASP CSRF] OWASP：Cross-Site Request Forgery Prevention Cheat Sheet。<https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- [OWASP MFA] OWASP：Multifactor Authentication Cheat Sheet。<https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html>
- [OWASP 金鑰] OWASP：Secrets Management Cheat Sheet（§1、§2.7.2、§5.1、§8.1）。<https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html>
- [OWASP Top 10 A07] OWASP Top 10:2025，A07 Authentication Failures。<https://top10.owasp.org/2025/A07_2025-Authentication_Failures>
- [ASVS] OWASP ASVS 5.0：V6 Authentication <https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md>、V7 Session Management <https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md>。條目後面的級數：第 1 級是最低標準，第 2 級是大多數網站的建議。
- [RFC 9106] Argon2（IRTF，Informational，2021-09）§4。<https://www.rfc-editor.org/rfc/rfc9106.html>
- [RFC 6265bis] draft-ietf-httpbis-rfc6265bis-22（新版 cookie 規格草稿）§4.1.3.2、§5.5、§5.6.7.1。<https://greenbytes.de/tech/specs/draft-ietf-httpbis-rfc6265bis-22.txt>
- [RFC 6265bis 狀態] IETF Datatracker。<https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/>
- [HIBP] Have I Been Pwned API v3，Pwned Passwords。<https://haveibeenpwned.com/API/v3>
- [HTML autofill] WHATWG HTML Living Standard，autofill 欄位名稱。<https://html.spec.whatwg.org/multipage/form-control-infrastructure.html>
- [WebKit 追蹤防護] WebKit：Tracking Prevention in WebKit。<https://webkit.org/tracking-prevention/>；另見 2020-03-24〈Full Third-Party Cookie Blocking and More〉<https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/>
- [GitHub 邀請] GitHub Docs：Inviting users to join your organization。<https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization>

## 對我們的帳號流程代表什麼

### 建議的預設（照上面的來源，不用再討論）

- **token**：32 bytes 安全亂數，資料庫只存 SHA-256；用一次就作廢；重寄時舊的作廢。打開連結只顯示表單，送出才用掉。連結網址寫死，不看 Host header；設密碼頁加 `Referrer-Policy: no-referrer`。
- **密碼**：不規定大小寫符號，不定期強迫換，沒有提示和安全問題。至少允許 64 個字。擋常見密碼和網站相關的字，並用 Pwned Passwords 範圍 API 查外洩。允許貼上和密碼管理器，有「顯示密碼」按鈕，欄位設好 `autocomplete`。改密碼要輸入舊密碼。
- **雜湊**：Argon2id，至少 m=19456（19 MiB）、t=2、p=1，鹽 16 bytes，存 PHC 字串。
- **登入狀態**：資料庫裡的 session，cookie `__Host-` 開頭、`Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`。登入時換新號碼；資料庫只存號碼的雜湊；登出時伺服器端作廢。不用 `localStorage`，不用 JWT。
- **錯誤訊息**：登入只說「email 或密碼不對」；忘記密碼一律說「如果有帳號，信已寄出」，而且一樣快。
- **擋猜密碼**：失敗次數跟著帳號算，失敗幾次後越等越久；連續失敗 100 次內停用密碼、要重設。鎖住時仍能用忘記密碼。失敗都記錄下來。
- **通知信**：設密碼、改密碼、重設密碼、改 email 都寄信；信裡不放密碼。
- **重設密碼後**：不自動登入，登出所有其他裝置，作廢其他還沒用的連結。
- **停用帳號**：馬上刪掉這個人所有 session，作廢他還沒用的連結。
- **CSRF**：改資料不用 GET；API 要自訂 header，CORS 只放行自己的前端網址；檢查 `Sec-Fetch-Site`／`Origin`。
- **第一個管理員**：沒有預設帳號；密碼、金鑰都不進 repo。用伺服器指令或「設定裡只放 email」來建，寄一次性設密碼連結。

### 留給人決定的（#183）

1. **密碼最短幾個字，跟要不要兩步驟一起定。** 只用密碼：NIST 要 15 個字（可以是一句話，例如四五個詞）。有兩步驟：8 個字就夠。iPad 上打 15 個字比較煩，但密碼管理器能幫忙。
2. **管理員要不要強制兩步驟？用 passkey 還是 TOTP？一般使用者要不要能開？** OWASP 建議管理員一定要。管理員掉了手機，最後的路是伺服器指令。
3. **多久一定要重登。** NIST 只用密碼的上限是 30 天；有兩步驟是 24 小時（教練會覺得太常）。要不要閒置登出、閒置多久。
4. **邀請連結多久失效。** NIST 對 email 的上限是 24 小時；GitHub 邀請是 7 天（但它的連結不能設密碼）。重設密碼連結要不要更短（例：1 小時）。
5. **管理員能不能重寄邀請、能不能幫人發起重設密碼**（不能幫人決定密碼）。
6. **設完密碼後要不要直接登入。** OWASP 對重設密碼說不要；邀請信沒規定。
7. **被停用的人登入時看到什麼。** 安全上要跟「密碼錯」一樣；但被停用的教練可能看不懂為什麼進不去。
8. **還沒設密碼、或被停用的人按「忘記密碼」要不要真的寄信**（畫面上的回覆都一樣）。
9. **要不要能看「我登入了哪些裝置」並遠端登出。** ASVS 第 2 級要有。
10. **要不要能改 email。** 要的話：重新輸入密碼，舊信箱通知、新信箱確認。
11. **第一個管理員用哪種方式建**：伺服器上跑一次指令，還是第一次啟動時看設定的 email。

另外兩件跟別的票有關：

- 前端在 `github.io`、後端在別的網域時，Safari 會擋登入 cookie；`SameSite` 和 `__Host-` 也假設前後端在同一個網站。這要看 #181 的主機結論。
- Argon2id 每次登入吃約 19 MiB，免費主機記憶體小時要注意，也看 #181。
