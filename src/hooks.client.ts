/// <reference types="@unplugin-pwa/core/vanillajs" />
import { registerSW } from 'virtual:pwa-register';
import { holdTabLocale } from '#lib/shown-locale.js';
import { hasUnsavedChanges } from '#lib/unsaved.js';
import { useShellIfInApp } from '#lib/app-shell.js';

// App（#375）：殼在 document start 塞了東西就換上殼的「問殼」，要在任何畫面讀 host() 之前。
const inApp = useShellIfInApp() !== undefined;

// 語言：這個分頁一直用打開時的語言，別的分頁換語言不會讓這頁變一半（ADR 0017）。
holdTabLocale();

// 可離線：註冊 service worker。部署新版後，使用者重新整理時新的 service worker 會裝好並接手，
// 接手後頁面自動再載入一次，就是新版（vite.config.ts 的 registerType: 'autoUpdate'）。
// 有還沒存的修改時不自動載入（會把修改弄丟）；下次打開或重新整理時就是新版。
// App 裡不註冊：網頁包在 App 裡，殼自己更新（ADR 0025）。
if (!inApp)
	registerSW({
		immediate: true,
		onNeedReload() {
			if (!hasUnsavedChanges()) window.location.reload();
		}
	});

// iPad Safari：在編輯畫面兩指捏合不放大整頁（畫面會跑掉，還要再捏回來）。場地、時間軸自己處理捏合。
// 首頁、使用說明照樣可以放大看字。打字時的自動放大由 app.html 的 maximum-scale=1 擋掉。
document.addEventListener('gesturestart', (e) => {
	if (document.querySelector('.editor')) e.preventDefault();
});
