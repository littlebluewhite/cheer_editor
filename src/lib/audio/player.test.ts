import { describe, expect, it } from 'vitest';
import type { PlaybackPlan } from '#lib/core';
import { createPlayer } from './player.js';
import { createFakeEngine } from './fake-engine.js';

const plan: PlaybackPlan = {
	clips: [
		{ audioId: 'a1', sec: 0, fileSec: 0.42, durationSec: 3.2 },
		{ audioId: 'a2', sec: 5.2, fileSec: 1, durationSec: 1.5 }
	],
	clicks: [
		{ sec: 0, accent: true },
		{ sec: 0.4, accent: false },
		{ sec: 5.2, accent: true }
	],
	endSec: 6.7
};

describe('播放器', () => {
	it('播放時先 resume（使用者按下的那一刻），把音樂排在流程時間對應的 AudioContext 時間', () => {
		const engine = createFakeEngine();
		engine.time = 10;
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: false });
		expect(engine.resumed).toBe(true);
		expect(engine.clicks).toEqual([]);
		// 第二個音樂段在第一段開始後 5.2 秒（中間是口號段）
		const [c1, c2] = engine.clips;
		expect(c1.audioId).toBe('a1');
		expect(c1.offset).toBe(0.42);
		expect(c1.duration).toBe(3.2);
		expect(c2.when - c1.when).toBeCloseTo(5.2, 9);
		expect(c1.when).toBeGreaterThanOrEqual(10);
	});

	it('節拍器打開時，每一聲排在對應的時間', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: true });
		const t0 = engine.clips[0].when;
		expect(engine.clicks.map((c) => [Math.round((c.when - t0) * 1e6) / 1e6, c.accent])).toEqual([
			[0, true],
			[0.4, false],
			[5.2, true]
		]);
	});

	it('播放頭 = 喇叭正在播的時間換回流程秒數，口號段時間照走', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: false });
		const t0 = engine.clips[0].when;
		engine.audible = t0 - 0.05; // 還沒出聲
		expect(player.tick(0)).toBe(0);
		engine.audible = t0 + 4.1; // 口號段中間
		expect(player.tick(0)).toBeCloseTo(4.1, 9);
		expect(player.playing).toBe(true);
	});

	it('從中間播：播放頭從那一刻起算', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start({ ...plan, clips: [plan.clips[1]] }, { fromSec: 5.2, metronome: false });
		engine.audible = engine.clips[0].when + 1;
		expect(player.tick(0)).toBeCloseTo(6.2, 9);
	});

	it('延遲校正：畫面晚這麼多毫秒', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: false });
		engine.audible = engine.clips[0].when + 2;
		expect(player.tick(200)).toBeCloseTo(1.8, 9);
	});

	it('延遲校正是負的（畫面提早）：音樂還是播到最後才停', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: false });
		engine.audible = engine.clips[0].when + 6.6; // 喇叭還在播最後 0.1 秒
		expect(player.tick(-200)).toBeLessThanOrEqual(6.7);
		expect(player.playing).toBe(true);
		expect(engine.clips).toHaveLength(2);
	});

	it('延遲校正是正的（畫面晚一點）：播放頭也走完最後那一小段才停', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: false });
		engine.audible = engine.clips[0].when + 6.8; // 聲音播完了，畫面還差 0.1 秒
		expect(player.tick(200)).toBeCloseTo(6.6, 9);
		expect(player.playing).toBe(true);
		engine.audible = engine.clips[0].when + 6.9;
		expect(player.tick(200)).toBe(6.7);
		expect(player.playing).toBe(false);
	});

	it('播到最後自己停，播放頭停在結尾', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: false });
		engine.audible = engine.clips[0].when + 7;
		expect(player.tick(0)).toBe(6.7);
		expect(player.playing).toBe(false);
		expect(engine.clips).toEqual([]);
	});

	it('暫停：停掉所有聲音', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: true });
		player.stop();
		expect(player.playing).toBe(false);
		expect(engine.clips).toEqual([]);
		expect(engine.clicks).toEqual([]);
	});

	it('再播一次前，先停掉上一次排的聲音', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		player.start(plan, { fromSec: 0, metronome: true });
		player.start({ ...plan, clips: [plan.clips[1]] }, { fromSec: 5.2, metronome: false });
		expect(engine.clips.map((c) => c.audioId)).toEqual(['a2']);
		expect(engine.clicks).toEqual([]);
	});

	it('重複、延遲校正是負的（畫面提早）：圈很短時播放頭照樣一圈一圈走，不會卡在 B', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		const lap = { plan: { clips: [], clicks: [], endSec: 0.4 }, fromSec: 0 };
		player.start(lap.plan, { fromSec: 0, metronome: false, loop: () => lap });
		// t0 = 0.1；喇叭在第一圈的 0.25 秒，畫面提早 1 秒 = 第 1.25 秒 = 第 4 圈的 0.05 秒
		engine.audible = 0.35;
		expect(player.tick(-1000)).toBeCloseTo(0.05, 6);
	});

	it('重複、播放中把負的延遲校正改回 0：播放頭跟著喇叭走，不會卡在 A', () => {
		const engine = createFakeEngine();
		const player = createPlayer(engine);
		const lap = { plan: { clips: [], clicks: [], endSec: 0.4 }, fromSec: 0 };
		player.start(lap.plan, { fromSec: 0, metronome: false, loop: () => lap });
		engine.audible = 0.35; // 喇叭在第一圈的 0.25 秒
		player.tick(-1000);
		expect(player.tick(0)).toBeCloseTo(0.25, 6);
	});

	it('慢速重複：下一圈要用的音樂檔也先拉長（不然第一次跳回 A 時才拉，聲音會晚）', () => {
		const engine = createFakeEngine();
		const prepared: string[] = [];
		engine.prepare = (ids) => void prepared.push(...ids);
		const player = createPlayer(engine);
		const first = { clips: [plan.clips[1]], clicks: [], endSec: 6.7 };
		const lap = { plan: { clips: [plan.clips[0]], clicks: [], endSec: 6.7 }, fromSec: 0 };
		player.start(first, { fromSec: 5.2, metronome: false, rate: 0.5, loop: () => lap });
		expect(prepared).toContain('a1');
		expect(prepared).toContain('a2');
	});
});
