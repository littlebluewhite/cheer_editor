// App 的殼（ADR 0022，#375）：殼在 document start 塞 window.__cheerShell（ios/ShellCore/Sources/ShellCore/Resources/bridge.js）。
// 有就換上殼的「問殼」（#lib/host.js）；網頁版沒有，照舊。網頁和殼之間說的話寫在 repo 根目錄的 bridge-scenarios/。

import { swapHost, type Shell } from '#lib/host.js';

/** 殼一開始塞的：殼的版本、建置號（網頁的清單的 minShellBuild 比這個）、會什麼（「問殼」can() 的名字）。 */
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

/** 在 App 裡就換上殼的「問殼」，回傳換回去的函式；網頁版回 undefined。程式一開始叫一次（src/hooks.client.ts）。 */
export function useShellIfInApp(): (() => void) | undefined {
	const bridge = window.__cheerShell;
	if (!bridge) return undefined;
	return swapHost({ shell: appShell(bridge) });
}
