// 播放器：把流程核心算好的播放計畫排進音訊引擎，再把「喇叭正在播的時間」換回流程秒數。
// 拍子和段的換算都在流程核心；這裡只做時鐘的加減。播放（#lib/playback.svelte.js）的內部，只有它在用。

import type { PlaybackPlan } from '#lib/core';
import type { AudioEngine } from './engine.js';

/** 排程往後留一點時間，第一個音才不會被切掉。 */
const LEAD_SEC = 0.1;

export interface Player {
	readonly playing: boolean;
	/** 從流程第 fromSec 秒播 plan。一定要在使用者動作（按鈕、空白鍵）裡呼叫。 */
	start(plan: PlaybackPlan, options: { fromSec: number; metronome: boolean }): void;
	stop(): void;
	/**
	 * 每一格畫面呼叫一次：喇叭正在播的那一刻（流程秒數），扣掉延遲校正（毫秒）。
	 * 播到 plan.endSec 就自己停，回傳 endSec。
	 */
	tick(latencyMs: number): number;
}

export function createPlayer(engine: AudioEngine): Player {
	let session: { t0: number; fromSec: number; endSec: number } | null = null;

	function stop() {
		engine.stopAll();
		session = null;
	}

	return {
		get playing() {
			return session !== null;
		},
		start(plan, { fromSec, metronome }) {
			stop();
			engine.resume();
			// 流程第 fromSec 秒 = AudioContext 的 t0
			const t0 = engine.currentTime() + LEAD_SEC;
			const at = (sec: number) => t0 + sec - fromSec;
			for (const c of plan.clips) engine.playClip(c.audioId, at(c.sec), c.fileSec, c.durationSec);
			if (metronome) for (const c of plan.clicks) engine.click(at(c.sec), c.accent);
			session = { t0, fromSec, endSec: plan.endSec };
		},
		stop,
		tick(latencyMs) {
			if (!session) return 0;
			const { t0, fromSec, endSec } = session;
			// 聲音播完、畫面上的播放頭（扣掉延遲校正）也走到結尾，才停；不切掉聲音，也不跳過最後一段。
			const sec = fromSec + engine.audibleTime() - t0;
			const shown = sec - latencyMs / 1000;
			if (Math.min(sec, shown) >= endSec) {
				stop();
				return endSec;
			}
			return Math.min(Math.max(shown, fromSec), endSec);
		}
	};
}
