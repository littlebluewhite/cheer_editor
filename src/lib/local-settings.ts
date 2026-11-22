// 本機設定（小設定）：跟著這台裝置存，不進流程檔。存在哪看 #lib/host.js（網頁版是瀏覽器的 localStorage）。
// 私密視窗、封鎖網站資料時 localStorage 可能讀寫失敗，那就用預設值、不存。

import { host } from '#lib/host.js';

const LATENCY_KEY = 'cheer-editor:latencyMs';

/** 延遲校正最多調幾毫秒（前後都是）。 */
export const MAX_LATENCY_MS = 1000;

/** 延遲校正（毫秒），預設 0；存的值超出 ±1000 也當 0。 */
export function loadLatencyMs(): number {
	try {
		const ms = Number(host().settings.get(LATENCY_KEY) ?? 0);
		return Math.abs(ms) <= MAX_LATENCY_MS ? ms : 0;
	} catch {
		return 0;
	}
}

export function saveLatencyMs(ms: number): void {
	try {
		host().settings.set(LATENCY_KEY, String(ms));
	} catch {
		// 存不了就只在這次用
	}
}

const RETURN_ON_STOP_KEY = 'cheer-editor:returnOnStop';

/** 停下來回到起播點，預設開著。 */
export function loadReturnOnStop(): boolean {
	try {
		return host().settings.get(RETURN_ON_STOP_KEY) !== '0';
	} catch {
		return true;
	}
}

export function saveReturnOnStop(on: boolean): void {
	try {
		host().settings.set(RETURN_ON_STOP_KEY, on ? '1' : '0');
	} catch {
		// 存不了就只在這次用
	}
}

const LEGEND_KEY = 'cheer-editor:legendOpen';

/** 場地左下的圖例開著嗎；沒按過「圖例」是 fallback（觸控又矮的螢幕收著，其他開著，N58）。 */
export function loadLegendOpen(fallback = true): boolean {
	try {
		const v = host().settings.get(LEGEND_KEY);
		return v === null ? fallback : v !== '0';
	} catch {
		return fallback;
	}
}

/** 按過「圖例」就記下開或關（預設看螢幕，所以開著也要記）。 */
export function saveLegendOpen(open: boolean): void {
	try {
		host().settings.set(LEGEND_KEY, open ? '1' : '0');
	} catch {
		// 存不了就只在這次用
	}
}

const LAST_FLOW_KEY = 'cheer-editor:lastFlow';

/** 上次那支（#378）：App 打開時回哪支本機流程（它的草稿 id）；沒記（上次停在首頁）是 ''。網頁版不記。 */
export function loadLastFlow(): string {
	try {
		return host().settings.get(LAST_FLOW_KEY) ?? '';
	} catch {
		return '';
	}
}

/** 存 ''（停在首頁）就刪掉。 */
export function saveLastFlow(draftId: string): void {
	try {
		if (draftId) host().settings.set(LAST_FLOW_KEY, draftId);
		else host().settings.remove(LAST_FLOW_KEY);
	} catch {
		// 存不了就下次停在首頁
	}
}

/** 拖分界改的大小：時間軸的高度（px）、右邊欄的寬度（視窗寬的比例）。存在 `cheer-editor:<名字>`。 */
export type LayoutSize = 'timelineHeightPx' | 'inspectorWidthRatio';

/** 拖分界改的大小；null = 預設（沒拖過，或雙擊回去了）。 */
export function loadLayoutPx(name: LayoutSize): number | null {
	try {
		const px = Number(host().settings.get(`cheer-editor:${name}`));
		return Number.isFinite(px) && px > 0 ? px : null;
	} catch {
		return null;
	}
}

export function saveLayoutPx(name: LayoutSize, px: number | null): void {
	try {
		if (px === null) host().settings.remove(`cheer-editor:${name}`);
		else host().settings.set(`cheer-editor:${name}`, String(px));
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
		return host().settings.get(`cheer-editor:${kind}:${flowName}`) ?? '';
	} catch {
		return '';
	}
}

/** 存 ''（沒選）就刪掉那一筆。 */
export function saveFlowSetting(kind: FlowSetting, flowName: string, value: string): void {
	try {
		if (value) host().settings.set(`cheer-editor:${kind}:${flowName}`, value);
		else host().settings.remove(`cheer-editor:${kind}:${flowName}`);
	} catch {
		// 存不了就只在這次用
	}
}
