/// <reference types="@unplugin-pwa/core/vanillajs" />
import { registerSW } from 'virtual:pwa-register';
import { hasUnsavedChanges } from '#lib/unsaved.js';

// 可離線：註冊 service worker。部署新版後，使用者重新整理時新的 service worker 會裝好並接手，
// 接手後頁面自動再載入一次，就是新版（vite.config.ts 的 registerType: 'autoUpdate'）。
// 有還沒存的修改時不自動載入（會把修改弄丟）；下次打開或重新整理時就是新版。
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
