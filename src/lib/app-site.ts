// App 裡的網站網址（#380，ADR 0023）：網頁照舊 fetch('/api/…')，在 App 裡是 app://local/api/…，殼轉到網站
// （ios/ShellCore/Sources/ShellCore/Forward/Forwarder.swift），網頁不用改。只有「網站網址」要換：
// App 裡 location.href 是 app://local/，分享連結、雲端流程的連線要用殼一開始說的網站網址（情境 bridge-scenarios/current/network.json）。
import type { Host } from '#lib/host.js';
import type { ShellBoot } from '#lib/app-shell.js';

declare module '#lib/app-shell.js' {
	interface ShellBoot {
		/** 殼轉到哪個網站（例：https://littlebluewhite.com/）。 */
		siteUrl?: string;
	}
}

/** useShellIfInApp 換上的：殼說了網站網址就用它。 */
export function appSite(boot: ShellBoot): Partial<Host> {
	const site = boot.siteUrl;
	return site ? { siteUrl: () => site } : {};
}
