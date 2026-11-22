import { host } from '#lib/host.js';

/** 殼會叫出系統的列印畫面（「問殼」的名字）。 */
export const PRINT_FEATURE = 'print';

/**
 * 列印的接口：八拍表、記一次全上表、總表的「列印」都叫這個（onclick 直接給它，event 是按的那下）。
 * 網頁版用瀏覽器列印；App 裡請殼叫出系統的列印畫面（#391，情境 bridge-scenarios/current/print.json），
 * 說按的那顆鈕在哪，iPad 上列印畫面從那裡跳出來。App 裡 window.print() 什麼都不會發生（docs/research/app-print.md）。
 * 測試換成假的（jsdom 沒有列印）。
 */
export function printPage(event?: Event): void {
	const shell = host().shell;
	if (!shell.can(PRINT_FEATURE)) {
		window.print();
		return;
	}
	const target = event?.currentTarget;
	const body =
		target instanceof Element ? { button: rectOf(target.getBoundingClientRect()) } : undefined;
	shell.send('print', body).catch((error: unknown) => console.error('殼印不出來', error));
}

function rectOf({ x, y, width, height }: DOMRect) {
	return { x, y, width, height };
}
