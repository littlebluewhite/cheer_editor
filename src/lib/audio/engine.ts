// 音訊引擎：播放器和 Web Audio 之間的接縫。真的用 AudioContext；測試換成 fake-engine.ts。
// 時間都是 AudioContext 的時鐘（秒）。

import { sharedAudioContext } from './decode.js';

export interface AudioEngine {
	/** Safari、Firefox 要在使用者動作裡 resume 才出聲，所以播放一定由按鈕或空白鍵呼叫。 */
	resume(): void;
	/** 排程用的時鐘（AudioContext.currentTime）。 */
	currentTime(): number;
	/** 喇叭正在播的那一刻，換成 AudioContext 時鐘（用 getOutputTimestamp 算）。 */
	audibleTime(): number;
	/** 在 when 從音樂檔的 offset 秒播 duration 秒。 */
	playClip(audioId: string, when: number, offset: number, duration: number): void;
	/** 節拍器在 when 響一聲。 */
	click(when: number, accent: boolean): void;
	/** 停掉所有排了的聲音。 */
	stopAll(): void;
}

/** 用 AudioContext 播。音樂檔用 audioId 跟呼叫端拿解碼好的 AudioBuffer；拿不到就不播那一段。 */
export function createWebAudioEngine(
	getBuffer: (audioId: string) => AudioBuffer | undefined
): AudioEngine {
	const ctx = sharedAudioContext();
	const nodes = new Set<AudioScheduledSourceNode>();

	function track(node: AudioScheduledSourceNode) {
		nodes.add(node);
		node.onended = () => nodes.delete(node);
	}

	return {
		resume: () => void ctx.resume(),
		currentTime: () => ctx.currentTime,
		audibleTime() {
			// performanceTime 是 contextTime 那一格出聲的時刻；從那時到現在又過了多久要加回去。
			const { contextTime = 0, performanceTime = 0 } = ctx.getOutputTimestamp();
			if (performanceTime === 0) return contextTime;
			return contextTime + (performance.now() - performanceTime) / 1000;
		},
		playClip(audioId, when, offset, duration) {
			const buffer = getBuffer(audioId);
			if (!buffer) return;
			const src = ctx.createBufferSource();
			src.buffer = buffer;
			src.connect(ctx.destination);
			src.start(when, offset, duration);
			track(src);
		},
		click(when, accent) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.frequency.value = accent ? 1500 : 900;
			gain.gain.setValueAtTime(0.0001, when);
			gain.gain.exponentialRampToValueAtTime(accent ? 0.45 : 0.2, when + 0.003);
			gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
			osc.connect(gain).connect(ctx.destination);
			osc.start(when);
			osc.stop(when + 0.06);
			track(osc);
		},
		stopAll() {
			for (const node of nodes) {
				node.onended = null;
				node.stop();
				node.disconnect();
			}
			nodes.clear();
		}
	};
}
