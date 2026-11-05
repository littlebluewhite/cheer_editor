// 音訊引擎：播放器和 Web Audio 之間的接縫。真的用 AudioContext；測試換成 fake-engine.ts。
// 時間都是 AudioContext 的時鐘（秒）。

import { sharedAudioContext } from './decode.js';
import { stretch } from './stretch.js';

export interface AudioEngine {
	/** Safari、Firefox 要在使用者動作裡 resume 才出聲，所以播放一定由按鈕或空白鍵呼叫。 */
	resume(): void;
	/** 排程用的時鐘（AudioContext.currentTime）。 */
	currentTime(): number;
	/** 喇叭正在播的那一刻，換成 AudioContext 時鐘（用 getOutputTimestamp 算）。 */
	audibleTime(): number;
	/** 慢速播放前先把這些音樂檔拉長成 rate 的速度（音高不變）；拉過的留著。 */
	prepare(audioIds: string[], rate: number): void;
	/** 在 when 從音樂檔的 offset 秒播 duration 秒（音樂檔的秒數）；rate：速度，小於 1 是拉長的音樂、音高不變。 */
	playClip(audioId: string, when: number, offset: number, duration: number, rate: number): void;
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
	/** 拉長過的音樂：原本的 AudioBuffer → 速度 → 拉長的。 */
	const stretched = new WeakMap<AudioBuffer, Map<number, AudioBuffer>>();

	/** 這個速度要播的 AudioBuffer：1 就是原本的；慢速第一次用到時才拉長（3 分鐘的歌約半秒）。 */
	function bufferAt(audioId: string, rate: number): AudioBuffer | undefined {
		const buffer = getBuffer(audioId);
		if (!buffer || rate === 1) return buffer;
		const byRate = stretched.get(buffer) ?? new Map<number, AudioBuffer>();
		stretched.set(buffer, byRate);
		let out = byRate.get(rate);
		if (!out) {
			const data = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
			const channels = stretch(data, buffer.sampleRate, rate);
			out = ctx.createBuffer(channels.length, channels[0].length, buffer.sampleRate);
			for (const [c, ch] of channels.entries()) out.copyToChannel(ch, c);
			byRate.set(rate, out);
		}
		return out;
	}

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
		prepare(audioIds, rate) {
			for (const id of audioIds) bufferAt(id, rate);
		},
		playClip(audioId, when, offset, duration, rate) {
			const buffer = bufferAt(audioId, rate);
			if (!buffer) return;
			const src = ctx.createBufferSource();
			src.buffer = buffer;
			src.connect(ctx.destination);
			// 拉長的音樂裡，原本第 offset 秒在 offset / rate 秒
			src.start(when, offset / rate, duration / rate);
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
