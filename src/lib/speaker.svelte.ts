// 喇叭和延遲（#388）：播放頭要扣多少。存在哪看 #lib/host.js 的 speaker：
// 網頁版只有延遲校正（存在小設定，認不出喇叭、系統說的延遲當 0）；App 裡殼告訴網頁現在是哪個喇叭、系統說的延遲、
// 這個喇叭的延遲校正（#lib/shell-speaker.svelte.js）。±1000 毫秒的檢查在播放（setLatency），只管延遲校正。

import { loadLatencyMs, saveLatencyMs } from '#lib/local-settings.js';

export interface Speaker {
	/** 現在接的喇叭的名字；網頁版認不出，是 null。 */
	readonly name: string | null;
	/** 系統說的延遲（毫秒）；網頁版 0。 */
	readonly systemLatencyMs: number;
	/** 這個喇叭的延遲校正（毫秒）。 */
	readonly latencyMs: number;
	/** 開發版的 App：多顯示殼讀的和網頁讀的系統延遲。 */
	readonly debug: boolean;
	/** 改這個喇叭的延遲校正（已經檢查過範圍）。 */
	setLatency(ms: number): void;
	/** 喇叭斷線要停止播放時叫 listener；回傳「不聽了」的函式。網頁版永遠不叫。 */
	onStop(listener: () => void): () => void;
}

/** 網頁版：延遲校正存在小設定（這台裝置一個），不自動扣。 */
export function browserSpeaker(): Speaker {
	let latencyMs = $state(loadLatencyMs());
	return {
		name: null,
		systemLatencyMs: 0,
		get latencyMs() {
			return latencyMs;
		},
		debug: false,
		setLatency(ms) {
			latencyMs = ms;
			saveLatencyMs(ms);
		},
		onStop: () => () => {}
	};
}
