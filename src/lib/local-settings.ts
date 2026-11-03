// 本機設定：跟著這台電腦的瀏覽器存（localStorage），不進流程檔。
// 私密視窗、封鎖網站資料時 localStorage 可能讀寫失敗，那就用預設值、不存。

const LATENCY_KEY = 'cheer-editor:latencyMs';

/** 延遲校正（毫秒），預設 0。 */
export function loadLatencyMs(): number {
	try {
		const ms = Number(localStorage.getItem(LATENCY_KEY) ?? 0);
		return Number.isFinite(ms) ? ms : 0;
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

const TIMELINE_KEY = 'cheer-editor:timelineHeightPx';

/** 時間軸的高度（px，拖場地和時間軸中間的分界改的）；null = 預設。 */
export function loadTimelineHeight(): number | null {
	try {
		const px = Number(localStorage.getItem(TIMELINE_KEY));
		return Number.isFinite(px) && px > 0 ? px : null;
	} catch {
		return null;
	}
}

export function saveTimelineHeight(px: number | null): void {
	try {
		if (px === null) localStorage.removeItem(TIMELINE_KEY);
		else localStorage.setItem(TIMELINE_KEY, String(px));
	} catch {
		// 存不了就只在這次用
	}
}

const INSPECTOR_KEY = 'cheer-editor:inspectorWidthPx';

/** 右邊欄的寬度（px，拖場地和右邊欄中間的分界改的）；null = 自動。 */
export function loadInspectorWidth(): number | null {
	try {
		const px = Number(localStorage.getItem(INSPECTOR_KEY));
		return Number.isFinite(px) && px > 0 ? px : null;
	} catch {
		return null;
	}
}

export function saveInspectorWidth(px: number | null): void {
	try {
		if (px === null) localStorage.removeItem(INSPECTOR_KEY);
		else localStorage.setItem(INSPECTOR_KEY, String(px));
	} catch {
		// 存不了就只在這次用
	}
}
