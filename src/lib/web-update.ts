// App：殼自己從網站更新網頁（ADR 0025、#393，情境 bridge-scenarios/current/web-update.json）。
// 殼下載好新網頁會說 webBundleReady；不馬上換，等教練回到首頁，網頁才請殼換上（useNewWebBundle，殼重新載入網頁）。
// 網頁存的東西（草稿、小設定）都在同一個地方（app://local），換了照樣在。

import type { Shell } from '#lib/host.js';

/** 殼會自己更新網頁（「問殼」的名字）。 */
export const WEB_UPDATE_FEATURE = 'webUpdate';

/**
 * 回到首頁後等多久才換：離開流程時草稿是回到首頁以後才寫進去的（flow-file 的 leaveToHome），
 * 先讓它寫完，重新載入才不會把正在寫的草稿弄丟。
 */
export const SETTLE_MS = 1000;

/**
 * 每個殼下載好新網頁了沒。殼只說一次 webBundleReady：第一次跟著就一直聽著，
 * 在帳號頁（首頁不在畫面上，同一個網頁換頁）時殼說的也記著，回到首頁照樣換。
 * 整頁重新載入（登出、刪帳號回首頁，App 裡的使用說明：新分頁的連結殼在原地開）這裡就清掉了，
 * 所以聽到的也記在 sessionStorage（DOWNLOADED_KEY），重新載入後回到首頁照樣換。
 * 使用說明那一頁上殼才說的這裡收不到，要等下次打開 App。
 */
const ready = new WeakMap<Shell, { downloaded: boolean }>();

/** 殼說過新網頁下載好了、還沒請它換（重新載入也留著；App 關掉就沒了，殼下次打開自己換）。 */
const DOWNLOADED_KEY = 'cheer-editor:webBundleReady';

/** sessionStorage 讀寫（讀不到、寫不進去當沒有）。 */
function remembered(): boolean {
	try {
		return sessionStorage.getItem(DOWNLOADED_KEY) === '1';
	} catch {
		return false;
	}
}
function remember(downloaded: boolean) {
	try {
		if (downloaded) sessionStorage.setItem(DOWNLOADED_KEY, '1');
		else sessionStorage.removeItem(DOWNLOADED_KEY);
	} catch {
		// 存不了：只記在網頁裡
	}
}

/**
 * 跟著殼的新網頁：回傳 cameHome（每次回到首頁叫）和 stop。
 * idleAtHome：現在還在首頁、沒有沒存的東西（等完 SETTLE_MS 再問一次，不是就不換，下次回首頁或下次打開 App 再換）。
 * 殼不會（舊殼、網頁版）就什麼都不做。
 */
export function followWebUpdate(shell: Shell, idleAtHome: () => boolean) {
	if (!shell.can(WEB_UPDATE_FEATURE)) return { cameHome() {}, stop() {} };
	let bundle = ready.get(shell);
	if (!bundle) {
		const heard = { downloaded: remembered() };
		shell.on('webBundleReady', () => {
			heard.downloaded = true;
			remember(true);
		});
		ready.set(shell, heard);
		bundle = heard;
	}
	const state = bundle;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		cameHome() {
			if (!state.downloaded) return;
			clearTimeout(timer);
			timer = setTimeout(() => {
				if (!state.downloaded || !idleAtHome()) return;
				state.downloaded = false;
				remember(false);
				shell.send('useNewWebBundle').catch(() => {});
			}, SETTLE_MS);
		},
		stop() {
			clearTimeout(timer);
		}
	};
}
