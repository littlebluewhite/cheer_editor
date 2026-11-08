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

const LEGEND_KEY = 'cheer-editor:legendOpen';

/** 場地左下的圖例開著嗎；沒按過「圖例」是 fallback（觸控又矮的螢幕收著，其他開著，N58）。 */
export function loadLegendOpen(fallback = true): boolean {
	try {
		const v = localStorage.getItem(LEGEND_KEY);
		return v === null ? fallback : v !== '0';
	} catch {
		return fallback;
	}
}

/** 按過「圖例」就記下開或關（預設看螢幕，所以開著也要記）。 */
export function saveLegendOpen(open: boolean): void {
	try {
		localStorage.setItem(LEGEND_KEY, open ? '1' : '0');
	} catch {
		// 存不了就只在這次用
	}
}

/** 拖分界改的大小：時間軸的高度（px）、右邊欄的寬度（視窗寬的比例）。存在 `cheer-editor:<名字>`。 */
export type LayoutSize = 'timelineHeightPx' | 'inspectorWidthRatio';

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

/**
 * 照流程名字分開記的設定（流程檔裡沒有固定的 id；教練傳新版、名字一樣就還在），不進流程檔。存在 `cheer-editor:<kind>:<流程名字>`。
 * me：手機檢視模式的「我」（隊員 id）。print：八拍表「印誰」上次選的（隊員 id、'role:top' 之類的全局角色）。
 * 沒選（全隊）是 ''。
 */
export type FlowSetting = 'me' | 'print';

export function loadFlowSetting(kind: FlowSetting, flowName: string): string {
	try {
		return localStorage.getItem(`cheer-editor:${kind}:${flowName}`) ?? '';
	} catch {
		return '';
	}
}

/** 存 ''（沒選）就刪掉那一筆。 */
export function saveFlowSetting(kind: FlowSetting, flowName: string, value: string): void {
	try {
		if (value) localStorage.setItem(`cheer-editor:${kind}:${flowName}`, value);
		else localStorage.removeItem(`cheer-editor:${kind}:${flowName}`);
	} catch {
		// 存不了就只在這次用
	}
}
