// 裝置的當地日期（練習畫面記一次用）。

/** 「2026-11-04」：用裝置的當地時間。不用 toISOString（那是 UTC，台灣早上 8 點以前會變成前一天）。 */
export function localDate(date: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
