# 給審查的人的備註（草稿 v1.0，#399）

**網站主人看過才貼到 App Store Connect 的「App 審查資訊 → 備註」。** 審查帳號的 email、密碼只填在 App Store Connect 的「登入資訊」欄，**不寫進 repo**；下面的 `<…>` 是空位。

- 用英文寫（推論：審查的人不一定看得懂中文）；繁中那份給網站主人對照，不用貼。
- 按鈕的英文照 App 裡的英文字（`messages/en.json`）；App 照裝置的語言顯示，也可以在首頁右上角換。
- 備註最多 4000 字（`src/lib/app-store.test.ts` 檢查）。

### Notes (English)

```text
WHAT THE APP IS
A tool for competitive cheerleading coaches to plan a routine: music, 8-counts, where each athlete stands, and what each athlete does in each skill, on one timeline. The app is free, has no in-app purchases, no ads and no analytics.

DEVICES
- iPad: please hold it in LANDSCAPE. Editing works only in landscape (touch only). In portrait, an open routine shows "Turn your iPad sideways" with buttons for the 8-count sheet and Practice.
- iPhone: view mode by design (field, playback with music, 8-count sheet) plus recording practice success rates. Editing is not available on iPhone.

SIGN-IN IS OPTIONAL
Without an account, everything works with routines stored on the device. An account (created by an administrator; there is no self sign-up) adds cloud routines, sharing and live co-editing.
Demo account: the email and password are in the Sign-In Information fields. On the home screen tap "Sign in" (top right). After signing in, the home screen lists a cloud routine named "<雲端流程的名字>" under "My routines": fake athlete names (A–L style), synthesized beat music. Tap it, then press play.

WHAT THE NATIVE APP ADDS (beyond the website)
- Routines, drafts and settings are stored in the app; tapping the icon reopens the last routine.
- Opens routine files: tap a .cheer file in the Files app (it opens in place, and "Save" writes back to that file), or hand a .cheer/.zip to the app from the share sheet (e.g. LINE; this is a copy, so the first "Save" asks where to save). "Open routine file" uses the system document picker. "Send to others" (Menu) opens the share sheet.
- Reads the current audio output; each speaker (e.g. a Bluetooth speaker) keeps its own latency offset ("..." next to the play button → "Latency offset"). Playback stops when a Bluetooth speaker or headphones disconnect.
- Lock screen / Control Center play and pause; music keeps playing with the screen locked.
- "Print" on the 8-count sheet and practice tables uses the system print sheet (Command-P with a keyboard); Share in the print sheet saves a PDF.
- Text follows the system Text Size setting.
The app downloads updated web screens (HTML/JS/CSS) from our own website (littlebluewhite.com) to fix and adjust the interface. These updates do not change the app's purpose or add features that would need review; native code changes always ship as a new App Store version.

ACCOUNT DELETION
My account (tap your name at the top right of the home screen → "My account") → "Request account deletion". This really deactivates the account at once: every device is signed out and the account cannot sign in again; the administrator deletes it within 30 days. Please try this button last, or use the second demo account: <第二個審查帳號：在 App Store Connect 備註寫 email，密碼另外給，或不給第二個就刪掉這句>. We will restore the demo account after review.

SAMPLE FILE
If you would like to test opening a file without signing in, the same routine is available as a file: <放範例流程檔的網址，或刪掉這段>.

CONTACT
Support page: https://littlebluewhite.com/support/
```

### 繁中對照（不用貼）

- **這是什麼**：教練排競技啦啦隊流程的工具；免費、沒有 App 內購買、沒有廣告和分析。
- **裝置**：iPad 請橫著拿，只有橫拿能編；直拿打開流程只有「請把 iPad 轉成橫的」和「看八拍表」「去練習」。iPhone 是檢視模式加記成功率。
- **登入不是必要的**：不登入用本機流程。帳號由管理員建立（沒有自己註冊），多雲端流程、分享、一起改。審查帳號登入後，首頁「我的流程」有一支 `<雲端流程的名字>`（假名、合成的節拍聲）。
- **App 多做的**：資料存在 App 裡、點圖示回上次那支；「檔案」點 .cheer 原地打開、存檔蓋回原檔，分享選單交來的是副本、第一次存檔問存到哪，「開啟流程檔」叫出系統的選檔畫面，「傳給別人」；每個喇叭各記一個延遲校正、斷線就停；鎖定畫面播放鍵、鎖螢幕繼續播；「列印」用系統的列印畫面（⌘P），「分享」存 PDF；字跟著「文字大小」。（沒寫自動填密碼：真機還沒驗，#401；驗過再加）
- **網頁畫面從自己的網站更新**（ADR 0025），App 的用途、功能不變；殼的程式改了一定出新版送審。
- **刪除帳號**：「我的帳號」→「要求刪除帳號」會真的停用（每台登出、不能登入），管理員 30 天內刪。請最後才試，或用第二個審查帳號；審完管理員按「恢復」（#325）。
- **範例檔**：要不要另外給檔案的網址，網站主人決定。

### 每句話的根據

| 說法 | 根據 |
|---|---|
| 免費、沒有內購 | #302 |
| 沒有廣告、分析 | 隱私權政策頁（`src/routes/privacy/+page.svelte`） |
| iPad 只有橫拿能編、直拿的畫面；iPhone 是檢視模式加記成功率 | 使用說明 1「開始前要知道」；直拿的 iPad 在模擬器上看到的（`editor_rotate_title`）。英文「Turn your iPad sideways」是 `messages/en.json` 的 `editor_rotate_title` |
| 登入在首頁右上角、沒有自己註冊 | 使用說明 4.13「登入和帳號」 |
| 「我的流程」 | 使用說明 4.13「雲端流程和本機流程」 |
| 殼多做的事 | `ios/README.md` #376、#377、#378、#384、#385、#388、#389、#391 各節。**真機沒驗的**：「檔案」裡點檔存回原檔（#379）、藍牙斷線就停、延遲（#390） |
| 從自己的網站更新網頁畫面 | `ios/README.md`「殼自己更新網頁」、ADR 0025 |
| 要求刪除帳號真的停用、30 天內刪、恢復 | #325；使用說明 4.13 |
| 英文按鈕名 | `messages/en.json`：`home_login`、`account_title`、`account_request_delete`、`editor_open_file`、`editor_save`、`editor_send_to_others`、`editor_menu`、`editor_latency`、`print_print` |
| 審查帳號的雲端流程名字 | `[NEEDS SOURCE]`：網站主人傳上雲端後填（建議用檔裡的「示範流程」） |
| 「My routines」 | `messages/en.json` 的 `home_mine` |
| 雲端流程裡是假名、合成的音樂 | `review-sample.cheer`（`src/lib/store-sample.ts` 產生）；網站主人要把它「傳上雲端」到審查帳號 |
