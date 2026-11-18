// 標記塞進小圓圈：中文字算兩格寬，數字、英文算一格；超過兩格（兩個中文字、中文加英文）就畫成橫的膠囊。

/** 標記有幾格寬（中文字兩格，數字、英文一格）；一格大約半個字高。 */
export function markerWidth(label: string): number {
	return Array.from(label).reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 2 : 1), 0);
}

export function isLongMarker(label: string): boolean {
	return markerWidth(label) > 2;
}
