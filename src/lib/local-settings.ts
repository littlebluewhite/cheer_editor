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
