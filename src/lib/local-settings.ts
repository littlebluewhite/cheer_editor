// 本機設定：跟著這台電腦的瀏覽器存（localStorage），不進流程檔。
// 私密視窗、封鎖網站資料時 localStorage 可能讀寫失敗，那就用預設值、不存。

const LATENCY_KEY = 'cheer-editor:latencyMs';

/** 延遲校正最多調幾毫秒（前後都是）。 */
export const MAX_LATENCY_MS = 1000;

/** 延遲校正（毫秒），預設 0；存的值超出 ±1000 也當 0。 */
export function loadLatencyMs(): number {
	try {
		const ms = Number(localStorage.getItem(LATENCY_KEY) ?? 0);
		return Math.abs(ms) <= MAX_LATENCY_MS ? ms : 0;
	} catch {
		return 0;
	}
}

export function saveLatencyMs(ms: number): void {
	try {
		localStorage.setItem(LATENCY_KEY, String(ms));
	} catch {
		// 存不了就只在這次用
	}
}

/** 拖分界改的大小（px）：時間軸的高度、右邊欄的寬度。存在 `cheer-editor:<名字>`。 */
export type LayoutSize = 'timelineHeightPx' | 'inspectorWidthPx';

/** 拖分界改的大小；null = 預設（沒拖過，或雙擊回去了）。 */
export function loadLayoutPx(name: LayoutSize): number | null {
	try {
		const px = Number(localStorage.getItem(`cheer-editor:${name}`));
		return Number.isFinite(px) && px > 0 ? px : null;
	} catch {
		return null;
	}
}

export function saveLayoutPx(name: LayoutSize, px: number | null): void {
	try {
		if (px === null) localStorage.removeItem(`cheer-editor:${name}`);
		else localStorage.setItem(`cheer-editor:${name}`, String(px));
	} catch {
		// 存不了就只在這次用
	}
}
