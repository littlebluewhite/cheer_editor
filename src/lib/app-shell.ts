// App 的殼（ADR 0022，#375）：殼在 document start 塞 window.__cheerShell（ios/ShellCore/Sources/ShellCore/Resources/bridge.js）。
// 有就換上殼的「問殼」（#lib/host.js）；網頁版沒有，照舊。網頁和殼之間說的話寫在 repo 根目錄的 bridge-scenarios/。

import { swapHost, type Shell } from '#lib/host.js';
import { DRAFTS_FEATURE, shellDraftStore } from '#lib/shell-drafts.js';
import { appSite } from '#lib/app-site.js';
import { SETTINGS_FEATURE, shellSettings } from '#lib/shell-settings.js';

/**
 * 殼一開始塞的：殼的版本、建置號（網頁的清單的 minShellBuild 比這個）、會什麼（「問殼」can() 的名字）。
 * 一塊要多塞東西時，在自己的檔裡補欄位，不改這裡：
 *   declare module '#lib/app-shell.js' { interface ShellBoot { settings?: Record<string, string> } }
 */
export interface ShellBoot {
	shellVersion: string;
	shellBuild: number;
	features: string[];
}

/** 殼塞進來的 window.__cheerShell。怎麼傳（messageHandlers、自訂網址）網頁不用管。 */
export interface ShellBridge {
	boot: ShellBoot;
	/** 網頁 → 殼。殼回錯誤（不認得是 'unknown'）時 reject。 */
	send(name: string, body?: unknown): Promise<unknown>;
	/** 殼 → 網頁。回傳「不聽了」的函式。 */
	on(name: string, listener: (body: unknown) => void): () => void;
}

declare global {
	interface Window {
		__cheerShell?: ShellBridge;
	}
}

export function appShell(bridge: ShellBridge): Shell {
	return {
		inApp: true,
		can: (feature) => bridge.boot.features.includes(feature),
		send: (name, body) => bridge.send(name, body),
		on: (name, listener) => bridge.on(name, listener)
	};
}

/**
 * 在 App 裡就換上殼的版本，回傳換回去的函式；網頁版回 undefined。程式一開始叫一次（src/hooks.client.ts）。
 * 一張票一格，各改自己那一格（中間空一行，幾張票同時加也合得起來，ios/README.md）。
 */
export function useShellIfInApp(): (() => void) | undefined {
	const bridge = window.__cheerShell;
	if (!bridge) return undefined;
	return swapHost({
		shell: appShell(bridge),
		// #377（小設定、離線存放）
		...(bridge.boot.features.includes(DRAFTS_FEATURE) && { createDraftStore: () => shellDraftStore(appShell(bridge)) }),

		// #378（小設定）
		...(bridge.boot.features.includes(SETTINGS_FEATURE) && { settings: shellSettings(appShell(bridge), bridge.boot.settings) }),

		// #380（網站網址）
		...appSite(bridge.boot),
	});
}
