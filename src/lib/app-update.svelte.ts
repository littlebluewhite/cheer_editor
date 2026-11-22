// App：雲端流程被新版擋住時的「更新」（#394，#307 第 2、4 點，情境 bridge-scenarios/current/web-update.json）。
// 被擋時先問殼一次（checkWebBundle）：網站上的新網頁要比這個殼新的殼（清單的 minShellBuild）就寫「這版 App 太舊」、給開 App Store 的按鈕；
// 不然寫「有新版」、給「更新」按鈕：請殼馬上換（updateWebBundle，帶開著的流程代號），殼換好重新載入到首頁 ?cloud=<代號>，網頁打開同一支（reopenAfterUpdate）。
// 網頁版、殼不會（can('webUpdate')）：照舊寫「有新版，請重新整理」，沒有按鈕。

import type { CloudSteps } from '#lib/cloud-steps.svelte.js';
import type { Shell } from '#lib/host.js';

/**
 * App Store 上這個 App 的網址。上架後才有（網站主人填），先留這裡；沒有時按鈕按不下去。
 */
export const APP_STORE_URL: string | null = null;

/** checking 正在問殼；ready 殼有新網頁；none 殼還沒有（按了再抓一次）；tooOld 這個殼太舊；updating 按了、等殼換。 */
export type AppUpdateStatus = 'checking' | 'ready' | 'none' | 'tooOld' | 'updating';

export class AppUpdate {
	status = $state<AppUpdateStatus>('checking');
	readonly #shell: Shell;

	constructor(shell: Shell) {
		this.#shell = shell;
		shell
			.send('checkWebBundle')
			.then((answer) => {
				if (this.status === 'checking') this.status = answer === 'ready' ? 'ready' : answer === 'tooOld' ? 'tooOld' : 'none';
			})
			.catch(() => {
				if (this.status === 'checking') this.status = 'none';
			});
	}

	/** 按「更新」：殼換上了回 true（殼接著重新載入，不用做什麼）；這個殼太舊、新網頁抓不到回 false。 */
	async update(flowId: string): Promise<boolean> {
		this.status = 'updating';
		const answer = await this.#shell.send('updateWebBundle', { flow: flowId }).catch(() => 'none');
		if (answer === 'updated') return true;
		this.status = answer === 'tooOld' ? 'tooOld' : 'none';
		return false;
	}
}

const byCloud = new WeakMap<CloudSteps, AppUpdate>();

/** 這支雲端流程被擋時的更新（同一支只問殼一次）；沒被擋、不在 App 裡、殼不會是 null。 */
export function appUpdateFor(cloud: CloudSteps | null, shell: Shell): AppUpdate | null {
	if (!cloud?.newVersion || !shell.can('webUpdate')) return null;
	let found = byCloud.get(cloud);
	if (!found) byCloud.set(cloud, (found = new AppUpdate(shell)));
	return found;
}

/**
 * 換完回來：App 裡網址有 ?cloud=<代號> 就回傳代號，並把它從網址拿掉（重新整理、退回時不會又打開）。
 * 網頁版、沒有是 null。
 */
export function reopenAfterUpdate(shell: Shell): string | null {
	if (!shell.inApp) return null;
	const params = new URLSearchParams(location.search);
	const id = params.get('cloud');
	if (!id) return null;
	params.delete('cloud');
	const rest = params.toString();
	history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
	return id;
}
