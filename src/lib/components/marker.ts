// 標記塞進小圓圈：中文字算兩格寬，數字、英文算一格；超過兩格（兩個中文字、中文加英文）就把字縮小。

export function isLongMarker(label: string): boolean {
	const width = Array.from(label).reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 2 : 1), 0);
	return width > 2;
}
