// 播放器：把流程核心算好的播放計畫排進音訊引擎，再把「喇叭正在播的時間」換回流程秒數。
// 拍子和段的換算都在流程核心；這裡只做時鐘的加減。播放（#lib/playback.svelte.js）的內部，只有它在用。

import type { PlaybackPlan } from '#lib/core';
import type { AudioEngine } from './engine.js';

/** 排程往後留一點時間，第一個音才不會被切掉。 */
const LEAD_SEC = 0.1;

/** 「重複」：喇叭播到這一圈結尾前這麼多秒，才排下一圈。排得晚，播放中改的流程、換選的動作下一圈就聽得到；留的時間夠畫面掉幾格也接得上。 */
const LAP_AHEAD_SEC = 0.5;

/** 「重複」每一圈播的：從流程第 fromSec 秒播 plan。 */
export interface Lap {
	plan: PlaybackPlan;
	fromSec: number;
}

export interface Player {
	readonly playing: boolean;
	/**
	 * 從流程第 fromSec 秒播 plan。一定要在使用者動作（按鈕、空白鍵）裡呼叫。
	 * rate：播放速度（0.5 = 慢一半；沒給是 1）。音樂交給引擎拉長，音高不變。
	 * loop：「重複」；播完 plan 緊接著一直播 loop 給的下一圈（每一圈快播完時才問，圈和圈之間不停）。給 null 就播完這圈停。
	 */
	start(
		plan: PlaybackPlan,
		options: { fromSec: number; metronome: boolean; rate?: number; loop?: () => Lap | null }
	): void;
	stop(): void;
	/**
	 * 每一格畫面呼叫一次：喇叭正在播的那一刻（流程秒數），扣掉延遲校正（毫秒）。
	 * 播到 plan.endSec 就自己停，回傳 endSec（重複時不停）。
	 */
	tick(latencyMs: number): number;
}

/** 排進引擎的一圈：流程第 fromSec 秒在 AudioContext 的 t0。 */
interface Scheduled {
	t0: number;
	fromSec: number;
	endSec: number;
}

export function createPlayer(engine: AudioEngine): Player {
	let session: { laps: Scheduled[]; rate: number; metronome: boolean; loop: (() => Lap | null) | null } | null = null;

	function stop() {
		engine.stopAll();
		session = null;
	}

	/** 把一圈排進引擎：流程第 fromSec 秒 = AudioContext 的 t0；慢速時流程 1 秒是 1 / rate 秒。 */
	function schedule({ plan, fromSec }: Lap, t0: number, rate: number, metronome: boolean): Scheduled {
		const at = (sec: number) => t0 + (sec - fromSec) / rate;
		for (const c of plan.clips) engine.playClip(c.audioId, at(c.sec), c.fileSec, c.durationSec, rate);
		if (metronome) for (const c of plan.clicks) engine.click(at(c.sec), c.accent);
		return { t0, fromSec, endSec: plan.endSec };
	}

	/**
	 * 重複：喇叭（audible）快播到最後排好的那一圈結尾，就跟 loop 要下一圈，緊接著排在結尾。
	 * 留著前兩圈：延遲校正時畫面上還在播上一圈的尾巴。
	 */
	function queueLap(audible: number) {
		if (!session?.loop) return;
		const last = session.laps.at(-1)!;
		const t0 = last.t0 + (last.endSec - last.fromSec) / session.rate;
		if (audible < t0 - LAP_AHEAD_SEC) return;
		const lap = session.loop();
		if (!lap) {
			session.loop = null;
			return;
		}
		session.laps = [...session.laps.slice(-2), schedule(lap, t0, session.rate, session.metronome)];
	}

	return {
		get playing() {
			return session !== null;
		},
		start(plan, { fromSec, metronome, rate = 1, loop }) {
			stop();
			engine.resume();
			// 慢速的音樂先拉長（可能要一點時間），拉好才定 t0，第一個音才對得上
			if (rate !== 1) engine.prepare(plan.clips.map((c) => c.audioId), rate);
			const t0 = engine.currentTime() + LEAD_SEC;
			session = { laps: [schedule({ plan, fromSec }, t0, rate, metronome)], rate, metronome, loop: loop ?? null };
			queueLap(t0);
		},
		stop,
		tick(latencyMs) {
			if (!session) return 0;
			const { rate } = session;
			const audible = engine.audibleTime();
			// 重複：快播完排好的最後一圈，就再排下一圈（看喇叭的時間，不看扣掉延遲校正的，才不會排晚）
			queueLap(audible);
			// 畫面上的播放頭扣掉延遲校正；延遲校正是真的時間，慢速時換成流程秒數也要乘上速度
			const shownAt = audible - latencyMs / 1000;
			// 剛好在接縫（差一點點浮點誤差）算下一圈的開頭，不顯示成上一圈的結尾
			const lap = session.laps.findLast((l) => l.t0 <= shownAt + 1e-6) ?? session.laps[0];
			const { t0, fromSec, endSec } = lap;
			const sec = fromSec + (audible - t0) * rate;
			const shown = fromSec + (shownAt - t0) * rate;
			// 聲音播完、畫面上的播放頭（扣掉延遲校正）也走到結尾，才停；不切掉聲音，也不跳過最後一段。
			if (!session.loop && Math.min(sec, shown) >= endSec) {
				stop();
				return endSec;
			}
			return Math.min(Math.max(shown, fromSec), endSec);
		}
	};
}
