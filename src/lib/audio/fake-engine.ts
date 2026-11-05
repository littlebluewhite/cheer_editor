// 測試用的假音訊引擎：時鐘自己撥，排了什麼聲音記下來。Node 和 jsdom 都沒有 Web Audio。

import type { AudioEngine } from './engine.js';

export interface FakeEngine extends AudioEngine {
	/** 排程時鐘（currentTime） */
	time: number;
	/** 喇叭正在播的時間（audibleTime） */
	audible: number;
	resumed: boolean;
	/** 目前排著的聲音；stopAll 會清掉。 */
	clips: { audioId: string; when: number; offset: number; duration: number; rate: number }[];
	clicks: { when: number; accent: boolean }[];
}

export function createFakeEngine(): FakeEngine {
	const engine: FakeEngine = {
		time: 0,
		audible: 0,
		resumed: false,
		clips: [],
		clicks: [],
		resume: () => void (engine.resumed = true),
		currentTime: () => engine.time,
		audibleTime: () => engine.audible,
		prepare: () => {},
		playClip: (audioId, when, offset, duration, rate) =>
			void engine.clips.push({ audioId, when, offset, duration, rate }),
		click: (when, accent) => void engine.clicks.push({ when, accent }),
		stopAll() {
			engine.clips = [];
			engine.clicks = [];
		}
	};
	return engine;
}
