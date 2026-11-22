// App：殼自己從網站更新網頁（ADR 0025、#393，情境 bridge-scenarios/current/web-update.json）。
// 殼下載好新網頁會說 webBundleReady；不馬上換，等教練回到首頁，網頁才請殼換上（useNewWebBundle，殼重新載入網頁）。
// 網頁存的東西（草稿、小設定）都在同一個地方（app://local），換了照樣在。

import type { Shell } from '#lib/host.js';

/**
 * 回到首頁後等多久才換：離開流程時草稿是回到首頁以後才寫進去的（flow-file 的 leaveToHome），
 * 先讓它寫完，重新載入才不會把正在寫的草稿弄丟。
 */
export const SETTLE_MS = 1000;

/**
 * 跟著殼的新網頁：回傳 cameHome（每次回到首頁叫）和 stop。
 * idleAtHome：現在還在首頁、沒有沒存的東西（等完 SETTLE_MS 再問一次，不是就不換，下次回首頁或下次打開 App 再換）。
 * 殼不會（舊殼、網頁版）就什麼都不做。
 */
export function followWebUpdate(shell: Shell, idleAtHome: () => boolean) {
	if (!shell.can('webUpdate')) return { cameHome() {}, stop() {} };
	let downloaded = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stopListening = shell.on('webBundleReady', () => (downloaded = true));
	return {
		cameHome() {
			if (!downloaded) return;
			clearTimeout(timer);
			timer = setTimeout(() => {
				if (!downloaded || !idleAtHome()) return;
				downloaded = false;
				shell.send('useNewWebBundle').catch(() => {});
			}, SETTLE_MS);
		},
		stop() {
			clearTimeout(timer);
			stopListening();
		}
	};
}
