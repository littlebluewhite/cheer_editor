/**
 * 列印的接口：八拍表、記一次全上表、總表的「列印」都叫這個。
 * 網頁用瀏覽器列印；App 裡之後換成請殼印（docs/research/app-print.md）。測試換成假的（jsdom 沒有列印）。
 */
export function printPage(): void {
	window.print();
}
