// 播放（編輯器 module 的 playback）：在 Node 測，音訊引擎是假的、畫面時鐘手動撥一格。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import {
	addAction,
	addBookmark,
	addMembers,
	addSegment,
	createFlow,
	deleteSegment,
	insertFormation,
	moveSegment,
	positionWhy,
	updateAction,
	updateSegment,
	type Flow
} from '#lib/core';
import { whyText } from '#lib/reason-text.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import { manualFrames, testEditor } from '#lib/test-fakes.js';
import { animationFrame } from '#lib/playback.svelte.js';

/** 音樂 1（150 BPM、8 個八拍 = 25.6 秒）→ 口號 1（10 秒）→ 音樂 2（25.6 秒）。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));
	for (const kind of ['music', 'chant', 'music'] as const) flow = flowOf(addSegment(flow, kind));
	return flow;
}

/** 編輯器 module 帶著假的音訊引擎和手動撥的畫面時鐘。 */
function setup(flow: Flow = sample()) {
	const engine = createFakeEngine();
	const frames = manualFrames();
	const { editor, session } = testEditor(flow, { createEngine: () => engine, nextFrame: frames.nextFrame });
	const { playback } = editor;
	/** 上方列寫的播放頭位置（例：音樂 1 3-5&）。 */
	const position = () => whyText(positionWhy(session.flow!, playback.sec));
	return { session, playback, engine, frames, position };
}

describe('播放：畫面時鐘', () => {
	it('一格之內按停再按播（例：很快點一下進度條）：每一格還是只排一次，不會越排越多', () => {
		const engine = createFakeEngine();
		const queued: (() => void)[][] = [[]];
		const nextFrame = (run: () => void) => void queued[queued.length - 1].push(run);
		const { editor } = testEditor(sample(), { createEngine: () => engine, nextFrame });
		const { playback } = editor;
		playback.play();
		for (let i = 0; i < 3; i++) {
			playback.pause();
			playback.play();
		}
		for (let i = 0; i < 3; i++) {
			const run = queued[queued.length - 1];
			queued.push([]);
			for (const f of run) f();
		}
		expect(queued.map((q) => q.length)).toEqual([1, 1, 1, 1]);
	});
});

describe('播放：真的畫面時鐘（#389）', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('畫面不來（App 鎖螢幕、切到別的 App）：0.25 秒後照樣跑一次，重複的下一圈才排得上', () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', () => 1);
		vi.stubGlobal('cancelAnimationFrame', () => {});
		let runs = 0;
		animationFrame(() => runs++);
		vi.advanceTimersByTime(249);
		expect(runs).toBe(0);
		vi.advanceTimersByTime(1);
		expect(runs).toBe(1);
	});

	it('畫面先來：只跑一次', () => {
		vi.useFakeTimers();
		let frame: () => void = () => {};
		vi.stubGlobal('requestAnimationFrame', (f: () => void) => ((frame = f), 1));
		vi.stubGlobal('cancelAnimationFrame', () => {});
		let runs = 0;
		animationFrame(() => runs++);
		frame();
		vi.advanceTimersByTime(1000);
		expect(runs).toBe(1);
	});
});

describe('播放：畫面停著時（App 鎖螢幕、切到別的 App，#389）', () => {
	it('按暫停：播放頭停在喇叭播到的地方，不是畫面最後一格；再按播放從那裡接著播', () => {
		const { playback, engine, frames } = setup();
		playback.play();
		const t0 = engine.clicks[0].when;
		engine.audible = t0 + 1;
		frames.step();
		// 鎖螢幕 20 秒：畫面沒在走，聲音照播
		engine.audible = t0 + 21;
		engine.time = t0 + 21;
		playback.pause();
		expect(playback.sec).toBeCloseTo(21, 6);
		playback.play();
		// 21 秒在音樂 1 的 6-6&：下一拍 21.2 秒，0.2 秒後（加上起播留的 0.1 秒）響
		expect(engine.clicks[0].when - engine.time).toBeCloseTo(0.3, 6);
	});

	it('鎖著的時候播完了：按暫停停在結尾', () => {
		const { playback, engine } = setup();
		playback.play();
		engine.audible = engine.clicks[0].when + 100;
		playback.pause();
		expect(playback.sec).toBeCloseTo(61.2, 6);
		expect(playback.playing).toBe(false);
	});
});

describe('播放：播放中改了流程', () => {
	it('改人、改動作（沒動到段）：聲音不重排，不會中斷', () => {
		const { session, playback, engine } = setup();
		playback.play();
		const scheduled = engine.clicks;
		session.change(flowOf(addMembers(session.flow!, [{ name: '王小明', gender: 'F', globalRole: 'base' }])));
		const members = [{ memberId: 'm1', role: '主底' }];
		session.change(
			flowOf(addAction(session.flow!, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members }))
		);
		expect(session.flow!.members).toHaveLength(1);
		expect(playback.playing).toBe(true);
		expect(engine.clicks).toBe(scheduled);
	});

	it('換段的順序：照新的順序重排聲音（不然還在播舊的順序）', () => {
		const { session, playback, engine } = setup();
		playback.play();
		const t0 = engine.clicks[0].when;
		session.change(flowOf(moveSegment(session.flow!, 's2', -1)));
		// 現在口號段（10 秒）在最前面，第一聲節拍器是 10 秒後音樂 1 的第一拍
		expect(engine.clicks[0].when).toBeCloseTo(t0 + 10, 6);
		expect(playback.playing).toBe(true);
	});

	it('刪掉正在播的段：播放頭夾到結尾停下，不回到 0 重播', () => {
		const { session, playback, engine, frames } = setup();
		playback.play();
		engine.audible = engine.clicks[0].when + 40;
		frames.step();
		session.change(flowOf(deleteSegment(session.flow!, 's3')));
		expect(playback.sec).toBeCloseTo(35.6, 6);
		expect(playback.playing).toBe(false);
		expect(engine.clicks).toEqual([]);
	});

	it('刪掉前面的段：從同一秒接著播（不回到 0）', () => {
		const { session, playback, engine, frames } = setup();
		playback.play();
		const t0 = engine.clicks[0].when;
		engine.audible = t0 + 30.2;
		frames.step();
		session.change(flowOf(deleteSegment(session.flow!, 's2')));
		expect(playback.playing).toBe(true);
		// 30.2 秒現在在音樂 2 的 4.6 秒：第一聲節拍器是 0.2 秒後的 2-5（從 0 重播的話是馬上響）
		expect(engine.clicks[0].when - t0).toBeCloseTo(0.2, 6);
	});

	it('改 BPM：從同一秒照新的拍子重排', () => {
		const { session, playback, engine, frames } = setup();
		playback.play();
		const t0 = engine.clicks[0].when;
		engine.audible = t0 + 1.1;
		frames.step();
		session.change(flowOf(updateSegment(session.flow!, 's1', { bpm: 120 })));
		expect(playback.playing).toBe(true);
		// 120 BPM 一拍 0.5 秒：1.1 秒之後下一拍在 1.5 秒，0.4 秒後響（照 150 BPM 是 1.2 秒）
		expect(engine.clicks[0].when - t0).toBeCloseTo(0.4, 6);
	});

	it('復原、重做之後，播放頭不會停在流程結尾後面', () => {
		const { session, playback } = setup();
		// 復原加的段
		session.change(flowOf(addSegment(session.flow!, 'chant')));
		playback.toEnd();
		expect(playback.sec).toBeCloseTo(71.2, 6);
		session.undo();
		expect(playback.sec).toBeCloseTo(61.2, 6);
		// 重做刪的段
		session.change(flowOf(deleteSegment(session.flow!, 's3')));
		session.undo();
		playback.toEnd();
		session.redo();
		expect(playback.sec).toBeCloseTo(35.6, 6);
	});

	it('沒在播時刪段：播放頭夾到流程結尾，不會超過總長', () => {
		const { session, playback } = setup();
		playback.toEnd();
		session.change(flowOf(deleteSegment(session.flow!, 's3')));
		expect(playback.sec).toBeCloseTo(35.6, 6);
		expect(playback.playing).toBe(false);
	});
});

describe('播放：播放、暫停、從哪裡播', () => {
	it('按播放，播放頭跟著喇叭的時間走，口號段時間照走；再按一次停下，聲音停掉、播放頭回到起播點', () => {
		const { playback, engine, frames, position } = setup();
		playback.toggle();
		expect(engine.resumed).toBe(true);
		const t0 = engine.clicks[0].when;
		engine.audible = t0 + 8.2;
		frames.step();
		expect(position()).toBe('音樂 1 3-5&');
		engine.audible = t0 + 25.6 + 3;
		frames.step();
		expect(position()).toBe('口號 1 3.0 秒');
		engine.audible = t0 + 35.6 + 0.4;
		frames.step();
		expect(position()).toBe('音樂 2 1-2');

		playback.toggle();
		expect(playback.playing).toBe(false);
		expect(engine.clicks).toEqual([]);
		expect(position()).toBe('音樂 1 1-1');
		engine.audible = t0 + 50;
		frames.step();
		expect(position()).toBe('音樂 1 1-1');
	});

	it('起播點：停下來回到開始播的地方；播放中改節拍器、速度不算重新開始播', () => {
		const { playback, engine, frames, position } = setup();
		playback.seek(3.2); // 2-1
		playback.play();
		expect(playback.startSec).toBeCloseTo(3.2, 6);
		const t0 = engine.clicks[0].when;
		engine.audible = t0 + 2;
		frames.step();
		expect(position()).toBe('音樂 1 2-6');
		playback.setMetronome(false);
		playback.setRate(0.75);
		expect(playback.startSec).toBeCloseTo(3.2, 6);
		playback.toggle();
		expect(position()).toBe('音樂 1 2-1');
		expect(playback.startSec).toBeNull();
	});

	it('起播點：播放中點八拍尺跳過去，起播點跟著過去（停下來回到點的地方）', () => {
		const { playback, engine, frames, position } = setup();
		playback.play();
		playback.seek(12.8); // 5-1
		engine.audible = engine.clicks[0].when + 1;
		frames.step();
		playback.toggle();
		expect(position()).toBe('音樂 1 5-1');
	});

	it('Shift＋空白鍵：停在原地；開關關掉時反過來，Shift＋空白鍵才回去', () => {
		const { playback, engine, frames, position } = setup();
		playback.play();
		engine.audible = engine.clicks[0].when + 8.2;
		frames.step();
		expect(playback.space(false, true)).toBe(true);
		expect(playback.playing).toBe(false);
		expect(position()).toBe('音樂 1 3-5&');

		playback.setReturnOnStop(false);
		expect(playback.returnOnStop).toBe(false);
		playback.space(false);
		engine.audible = engine.clicks[0].when + 1.2; // 3-6 再 3 拍
		frames.step();
		playback.space(false);
		expect(position()).toBe('音樂 1 4-1');
		playback.space(false);
		engine.audible = engine.clicks[0].when + 1;
		frames.step();
		playback.space(false, true);
		expect(position()).toBe('音樂 1 4-1');
	});

	it('播放中拖人（停到整拍）、試聽、切到練習：停在原地，不回起播點', () => {
		const { playback, engine, frames, position } = setup();
		playback.play();
		engine.audible = engine.clicks[0].when + 8.3;
		frames.step();
		playback.pauseOnBeat();
		expect(position()).toBe('音樂 1 3-6');
		playback.play();
		engine.audible = engine.clicks[0].when + 0.4;
		frames.step();
		playback.pause();
		expect(position()).toBe('音樂 1 3-7');
	});

	it('從播放頭開始播：口號段沒有節拍器，第一聲是下一個音樂段的第一拍', () => {
		const { playback, engine, frames, position } = setup();
		playback.seek(26.6);
		playback.play();
		engine.audible = engine.clicks[0].when;
		frames.step();
		expect(position()).toBe('音樂 2 1-1');
	});

	it('播放頭在結尾：從頭播', () => {
		const { playback, engine, position } = setup();
		playback.toEnd();
		expect(playback.sec).toBeCloseTo(61.2, 6);
		playback.play();
		expect(position()).toBe('音樂 1 1-1');
		// 兩個音樂段各 64 拍都排了
		expect(engine.clicks).toHaveLength(128);
	});

	it('播放中跳到某一秒（點八拍尺）：從那裡接著播', () => {
		const { playback, engine, frames, position } = setup();
		playback.play();
		playback.seek(26.6);
		expect(playback.playing).toBe(true);
		engine.audible = engine.clicks[0].when;
		frames.step();
		expect(position()).toBe('音樂 2 1-1');
	});

	it('播放中按 End（或點到時間尺最尾端）：停在結尾，不從頭重播', () => {
		const { playback, engine } = setup();
		playback.play();
		playback.toEnd();
		expect(playback.playing).toBe(false);
		expect(playback.sec).toBeCloseTo(61.2, 6);
		expect(engine.clicks).toEqual([]);
		playback.play();
		playback.seek(999);
		expect(playback.playing).toBe(false);
		expect(playback.sec).toBeCloseTo(61.2, 6);
	});

	it('跳的時候夾在 0 到流程結尾之間', () => {
		const { playback } = setup();
		playback.seek(-3);
		expect(playback.sec).toBe(0);
		playback.seek(999);
		expect(playback.sec).toBeCloseTo(61.2, 6);
	});

	it('Home 跳到開頭、End 跳到結尾；一次一拍，Shift 一個八拍（到頭就停在頭）', () => {
		const { playback, position } = setup();
		playback.toEnd();
		expect(playback.sec).toBeCloseTo(61.2, 6);
		playback.toStart();
		expect(position()).toBe('音樂 1 1-1');
		playback.step(1, false);
		expect(position()).toBe('音樂 1 1-2');
		playback.step(1, true);
		expect(position()).toBe('音樂 1 2-1');
		playback.step(-1, false);
		expect(position()).toBe('音樂 1 1-8');
		playback.step(-1, true);
		expect(position()).toBe('音樂 1 1-1');
		playback.step(-1, false);
		expect(position()).toBe('音樂 1 1-1');
	});

	it('空白鍵：播放／暫停；對話框開著時只能暫停，不開始播（那時不用這個鍵）', () => {
		const { playback } = setup();
		expect(playback.space(false)).toBe(true);
		expect(playback.playing).toBe(true);
		expect(playback.space(true)).toBe(true);
		expect(playback.playing).toBe(false);
		expect(playback.space(true)).toBe(false);
		expect(playback.playing).toBe(false);
		expect(playback.space(false)).toBe(true);
		expect(playback.playing).toBe(true);
	});

	it('沒有段時不能播', () => {
		const { playback, engine } = setup(flowOf(createFlow({ name: '空的', field: { strips: 9, layout: 'vertical' } })));
		playback.toggle();
		expect(playback.playing).toBe(false);
		expect(engine.resumed).toBe(false);
	});

	it('播到結尾自己停，播放頭回到起播點；開關關掉就停在結尾', () => {
		const { playback, engine, frames } = setup();
		playback.seek(3.2);
		playback.play();
		engine.audible = engine.clicks[0].when + 70;
		frames.step();
		expect(playback.playing).toBe(false);
		expect(playback.sec).toBeCloseTo(3.2, 6);

		playback.setReturnOnStop(false);
		playback.play();
		engine.audible = engine.clicks[0].when + 70;
		frames.step();
		expect(playback.playing).toBe(false);
		expect(playback.sec).toBeCloseTo(61.2, 6);
	});
});

describe('播放：session 改完跳播放頭', () => {
	it('拖人插了站位：播放頭停到那張；播放中不重排（照樣跟著音樂走）', () => {
		const { session, playback, engine } = setup(libSample());
		playback.play();
		const scheduled = engine.clicks;
		session.ask.send({ name: 'moveMembers', args: [2, { m1: [1, 1] }] }, { done: (r) => session.moved(r) });
		expect(session.flow!.formations).toHaveLength(2);
		expect(playback.sec).toBe(2);
		expect(playback.playing).toBe(true);
		expect(engine.clicks).toBe(scheduled);
	});

	it('挪站位：播放頭跳到新的站位時間；播放中從那裡重排', () => {
		const { session, playback, engine } = setup(flowOf(insertFormation(libSample(), 2)));
		playback.play();
		const id = session.flow!.formations[1].id;
		const to = { segmentId: 's1', at: 16 };
		session.ask.send({ name: 'moveFormation', args: [id, to] }, { done: (r) => session.formationMoved(id, r) });
		// 2-1（3.2 秒）
		expect(playback.sec).toBeCloseTo(3.2, 6);
		expect(playback.playing).toBe(true);
		// 從 2-1 重排：4 個八拍剩 3 個
		expect(engine.clicks).toHaveLength(24);
	});
});

describe('播放：換一支流程', () => {
	it('開檔、新建、回首頁：播放和試聽停下，播放頭回到開頭', () => {
		const { session, playback, engine, frames } = setup();
		playback.play();
		engine.audible = engine.clicks[0].when + 5;
		frames.step();
		session.open(sample());
		expect(playback.playing).toBe(false);
		expect(playback.sec).toBe(0);
		expect(engine.clicks).toEqual([]);

		playback.preview('s1');
		session.open(null);
		expect(playback.previewing).toBe(false);
		expect(engine.clicks).toEqual([]);
	});
});

describe('播放：段設定的試聽（▶ 從第一拍聽 2 個八拍）', () => {
	it('先停掉正在播的流程，從第一拍播 16 拍節拍器；播放頭不動', () => {
		const { playback, engine, frames, position } = setup();
		playback.play();
		playback.preview('s3');
		expect(playback.playing).toBe(false);
		expect(playback.previewing).toBe(true);
		expect(engine.clicks).toHaveLength(16);
		engine.audible = engine.clicks[0].when + 3;
		frames.step();
		expect(position()).toBe('音樂 1 1-1');
		expect(playback.previewing).toBe(true);
	});

	it('播完自己停（2 個八拍、150 BPM = 6.4 秒）', () => {
		const { playback, engine, frames } = setup();
		playback.preview('s1');
		engine.audible = engine.clicks[0].when + 6.5;
		frames.step();
		expect(playback.previewing).toBe(false);
	});

	it('停止試聽：聲音停掉；沒在試聽時不動正在播的流程', () => {
		const { playback, engine } = setup();
		playback.preview('s1');
		playback.stopPreview();
		expect(playback.previewing).toBe(false);
		expect(engine.clicks).toEqual([]);
		playback.play();
		playback.stopPreview();
		expect(playback.playing).toBe(true);
		expect(engine.clicks.length).toBeGreaterThan(0);
	});
});

describe('播放：節拍器、延遲校正', () => {
	it('節拍器關掉就不響；播放中打開，馬上照新的設定重排', () => {
		const { playback, engine } = setup();
		expect(playback.metronome).toBe(true);
		playback.setMetronome(false);
		playback.play();
		expect(engine.clicks).toEqual([]);
		playback.setMetronome(true);
		expect(engine.clicks.length).toBeGreaterThan(0);
		expect(playback.playing).toBe(true);
	});

	it('延遲校正只移播放頭（晚這麼多毫秒），聲音排的時間不變', () => {
		const { playback, engine, frames, position } = setup();
		playback.play();
		const scheduled = engine.clicks.map((c) => c.when);
		playback.pause();
		expect(playback.setLatency(200)).toBe(true);
		expect(playback.latencyMs).toBe(200);
		playback.toStart();
		playback.play();
		expect(engine.clicks.map((c) => c.when)).toEqual(scheduled);
		engine.audible = engine.clicks[0].when + 8.4;
		frames.step();
		expect(position()).toBe('音樂 1 3-5&');
	});

	it('延遲校正限制在 −1000 到 +1000 毫秒；空白、不是數字或超出範圍就不改', () => {
		const { playback } = setup();
		expect(playback.latencyMs).toBe(0);
		expect(playback.setLatency(-1000)).toBe(true);
		expect(playback.setLatency(NaN)).toBe(false);
		expect(playback.setLatency(1001)).toBe(false);
		expect(playback.latencyMs).toBe(-1000);
		expect(playback.setLatency(1000)).toBe(true);
		expect(playback.latencyMs).toBe(1000);
	});
});

describe('播放：慢速、重複', () => {
	it('0.5x：播放頭走一半速度，節拍器照慢的時間排', () => {
		const { playback, engine, frames, position } = setup();
		playback.setRate(0.5);
		playback.play();
		const t0 = engine.clicks[0].when;
		// 150 BPM 一拍 0.4 秒，慢一半就是 0.8 秒響一聲
		expect(engine.clicks[1].when - t0).toBeCloseTo(0.8, 6);
		engine.audible = t0 + 6.4;
		frames.step();
		expect(playback.sec).toBeCloseTo(3.2, 6);
		expect(position()).toBe('音樂 1 2-1');
	});

	it('重複、選了動作：按重複就把重複範圍拉成那個動作；從動作開始播，播到動作結束跳回動作開始，一直播', () => {
		const members = [{ memberId: 'm1', role: '主底' }];
		let flow = flowOf(addMembers(sample(), [{ name: '小A', gender: 'M', globalRole: 'base' }]));
		// 第 2 個八拍（3.2 到 6.4 秒）
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 16, length: 16, note: '', members }));
		const { session, playback, engine, frames, position } = setup(flow);
		session.selectAction('x1');
		expect(playback.canRepeat).toBe(true);
		playback.setRepeat(true);
		expect(playback.range).toEqual({ a: 3.2, b: expect.closeTo(6.4, 6) });
		playback.play();
		expect(position()).toBe('音樂 1 2-1');
		let t0 = engine.clicks[0].when;
		// 這一圈排到動作結束：8 拍
		expect(engine.clicks).toHaveLength(8);
		engine.audible = t0 + 2;
		frames.step();
		expect(position()).toBe('音樂 1 2-6');
		engine.audible = t0 + 3.3;
		frames.step();
		// 快播完時下一圈（再 8 拍）緊接著排上
		expect(engine.clicks).toHaveLength(16);
		expect(engine.clicks[8].when - t0).toBeCloseTo(3.2, 6);
		expect(playback.playing).toBe(true);
		expect(position()).toBe('音樂 1 2-1');
		t0 = engine.clicks[8].when;
		engine.audible = t0 + 0.5;
		frames.step();
		expect(position()).toBe('音樂 1 2-2');
	});

	it('沒有重複範圍、沒選動作：重複按不下去', () => {
		const { playback } = setup();
		expect(playback.canRepeat).toBe(false);
		playback.setRepeat(true);
		expect(playback.repeat).toBe(false);
		expect(playback.range).toBeNull();
	});

	it('A、B：放在播放頭最近的整拍；放好 B 重複自己打開，播放頭在範圍裡就從那裡播，播到 B 跳回 A', () => {
		const { playback, engine, frames, position } = setup();
		playback.seek(6.5); // 3-1 再過一點
		playback.setA();
		expect(playback.range).toEqual({ a: 6.4, b: null });
		expect(playback.repeat).toBe(false);
		// B 要在 A 後面：放不下去
		playback.seek(6.3);
		playback.setB();
		expect(playback.range).toEqual({ a: 6.4, b: null });
		playback.seek(9.7); // 4-1 再過一點
		playback.setB();
		expect(playback.range).toEqual({ a: 6.4, b: expect.closeTo(9.6, 6) });
		expect(playback.repeat).toBe(true);
		playback.seek(8.2); // 3-5&
		playback.play();
		const t0 = engine.clicks[0].when;
		// 3-6 到 3-8 三聲；第 4 個八拍不排
		expect(engine.clicks).toHaveLength(3);
		engine.audible = t0 + 1.3;
		frames.step();
		expect(playback.playing).toBe(true);
		expect(position()).toBe('音樂 1 3-1');
	});

	it('播放中按 B：馬上跳回 A 開始重複（B 吸到後面那一拍也一樣）', () => {
		const { playback, position } = setup();
		playback.seek(3.3); // 2-1 再過一點
		playback.setA();
		playback.play();
		playback.seek(6.3); // 2-8&，B 吸到 3-1，在播放頭後面
		playback.setB();
		expect(playback.range).toEqual({ a: 3.2, b: expect.closeTo(6.4, 6) });
		expect(playback.playing).toBe(true);
		expect(position()).toBe('音樂 1 2-1');
		expect(playback.startSec).toBeCloseTo(3.2, 6);
	});

	it('播放中拖範圍：吸到的整拍沒變就不重排聲音（拖的時候不會一直斷）', () => {
		const { playback, engine } = setup();
		playback.setRange(3.2, 6.4);
		playback.play();
		const scheduled = engine.clicks;
		playback.setRange(3.25, 6.45);
		expect(engine.clicks).toBe(scheduled);
	});

	it('段縮短，重複範圍落到段尾後面：範圍拿掉、重複關掉（不然按播放馬上停）', () => {
		const { session, playback } = setup();
		playback.setRange(33.6, 34.6); // 口號 1 的 8 到 9 秒
		session.change(flowOf(updateSegment(session.flow!, 's2', { seconds: 5 })));
		expect(playback.range).toBeNull();
		expect(playback.repeat).toBe(false);
	});

	it('B 放在流程結尾：整拍不會被浮點誤差算成前一個半拍；口號段結尾的 0.1 秒也一樣', () => {
		const short = flowOf(updateSegment(flowOf(addSegment(flowOf(createFlow({ name: '短', field: { strips: 9, layout: 'vertical' } })), 'music')), 's1', { eights: 3 }));
		const { playback } = setup(short); // 24 拍 = 9.6 秒
		playback.setRange(8, 9.6);
		expect(playback.range).toEqual({ a: 8, b: expect.closeTo(9.6, 6) });
		const chant = flowOf(addSegment(flowOf(createFlow({ name: '口號', field: { strips: 9, layout: 'vertical' } })), 'chant', undefined, 3));
		const c = setup(chant).playback; // 0.3 秒
		c.seek(0.2);
		c.setA();
		c.seek(0.3);
		expect(c.canSetB).toBe(true);
	});

	it('動作拉成的範圍：B 是動作自己那一段的結尾，後面插一段也不會跑到下一段去', () => {
		const members = [{ memberId: 'm1', role: '主底' }];
		let flow = flowOf(addMembers(sample(), [{ name: '小A', gender: 'M', globalRole: 'base' }]));
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 96, length: 32, note: '', members }));
		const { session, playback } = setup(flow);
		session.selectAction('x1');
		playback.setRepeat(true);
		expect(playback.range).toEqual({ a: expect.closeTo(19.2, 6), b: expect.closeTo(25.6, 6) });
		session.change(flowOf(addSegment(session.flow!, 'chant', 's1')));
		expect(playback.range).toEqual({ a: expect.closeTo(19.2, 6), b: expect.closeTo(25.6, 6) });
	});

	it('拖範圍的一頭：另一頭照原本的位置不動，不會被重新吸到整拍；拖過另一頭就對調', () => {
		const members = [{ memberId: 'm1', role: '主底' }];
		let flow = flowOf(addMembers(sample(), [{ name: '小A', gender: 'M', globalRole: 'base' }]));
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 1, length: 20, note: '', members }));
		const { session, playback } = setup(flow);
		session.selectAction('x1');
		playback.setRepeat(true);
		expect(playback.range).toEqual({ a: expect.closeTo(0.2, 6), b: expect.closeTo(4.2, 6) });
		const drag = playback.dragRangeEnd('b');
		drag(6.3);
		expect(playback.range).toEqual({ a: expect.closeTo(0.2, 6), b: expect.closeTo(6.4, 6) });
		drag(0);
		expect(playback.range).toEqual({ a: 0, b: expect.closeTo(0.2, 6) });
	});

	it('A 不能放在流程結尾', () => {
		const { playback } = setup();
		expect(playback.canSetA).toBe(true);
		playback.toEnd();
		expect(playback.canSetA).toBe(false);
		playback.setA();
		expect(playback.range).toBeNull();
	});

	it('A 放到 B 後面：B 拿掉、重複關掉，再放一次 B', () => {
		const { playback } = setup();
		playback.setRange(3.2, 6.4);
		playback.seek(8);
		playback.setA();
		expect(playback.range).toEqual({ a: 8, b: null });
		expect(playback.repeat).toBe(false);
		expect(playback.canRepeat).toBe(false);
	});

	it('在尺上拉出重複範圍：兩頭吸到整拍、可以倒著拉，重複自己打開；不到一拍不算', () => {
		const { playback } = setup();
		playback.setRange(3.25, 3.3);
		expect(playback.range).toBeNull();
		playback.setRange(6.5, 3.1);
		expect(playback.range).toEqual({ a: 3.2, b: expect.closeTo(6.4, 6) });
		expect(playback.repeat).toBe(true);
	});

	it('重複關掉，範圍留著；再打開還是那一段。✕ 拿掉範圍，重複也關掉', () => {
		const members = [{ memberId: 'm1', role: '主底' }];
		let flow = flowOf(addMembers(sample(), [{ name: '小A', gender: 'M', globalRole: 'base' }]));
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 48, length: 16, note: '', members }));
		const { session, playback } = setup(flow);
		playback.setRange(3.2, 6.4);
		playback.setRepeat(false);
		expect(playback.range).toEqual({ a: 3.2, b: expect.closeTo(6.4, 6) });
		// 已經有範圍：選著動作按重複也不換掉範圍
		session.selectAction('x1');
		playback.setRepeat(true);
		expect(playback.range).toEqual({ a: 3.2, b: expect.closeTo(6.4, 6) });
		playback.clearRange();
		expect(playback.range).toBeNull();
		expect(playback.repeat).toBe(false);
	});

	it('重複開著只在範圍裡播：播放中點到外面跳回 A；停著點外面可以看那一拍，按播放還是從 A 播，起播點是 A', () => {
		const { playback, engine, frames, position } = setup();
		playback.setRange(3.2, 6.4);
		playback.play();
		expect(position()).toBe('音樂 1 2-1');
		playback.seek(13); // 5-1，在範圍外面
		expect(playback.playing).toBe(true);
		expect(position()).toBe('音樂 1 2-1');
		expect(playback.startSec).toBeCloseTo(3.2, 6);
		// 跳到結尾也一樣：跳回 A，不停
		playback.toEnd();
		expect(playback.playing).toBe(true);
		expect(position()).toBe('音樂 1 2-1');
		engine.audible = engine.clicks[0].when + 1;
		frames.step();
		playback.toggle();
		expect(position()).toBe('音樂 1 2-1');

		playback.seek(12.8);
		expect(position()).toBe('音樂 1 5-1');
		playback.play();
		expect(position()).toBe('音樂 1 2-1');
		expect(playback.startSec).toBeCloseTo(3.2, 6);
	});

	it('重複範圍跟著音樂：改 BPM 還在同一拍；刪掉範圍所在的段就拿掉；開別的流程也拿掉', () => {
		const { session, playback } = setup();
		playback.setRange(26.6, 27.6); // 口號 1 的 1.0 到 2.0 秒
		session.change(flowOf(updateSegment(session.flow!, 's1', { bpm: 120 })));
		// 音樂 1 變成 32 秒：口號 1 從 32 秒開始
		expect(playback.range).toEqual({ a: expect.closeTo(33, 6), b: expect.closeTo(34, 6) });
		expect(playback.repeat).toBe(true);
		session.change(flowOf(deleteSegment(session.flow!, 's2')));
		expect(playback.range).toBeNull();
		expect(playback.repeat).toBe(false);

		playback.setRange(3.2, 6.4);
		session.open(sample());
		expect(playback.range).toBeNull();
		expect(playback.repeat).toBe(false);
	});

	it('最短的重複範圍（170 BPM 的一拍，0.35 秒）、畫面卡到一秒只有 2.5 格：一拍一聲，圈和圈之間不斷', () => {
		const flow = flowOf(updateSegment(sample(), 's1', { bpm: 170 }));
		const { playback, engine, frames } = setup(flow);
		const heard: number[] = [];
		const click = engine.click;
		engine.click = (when, accent) => {
			heard.push(when);
			click(when, accent);
		};
		playback.setRange(0, 0.3);
		expect(playback.range).toEqual({ a: 0, b: expect.closeTo(60 / 170, 6) });
		playback.play();
		const t0 = heard[0];
		for (let t = 0; t < 4; t += 0.4) {
			engine.time = engine.audible = t0 + t;
			frames.step();
		}
		expect(playback.playing).toBe(true);
		const times = heard.filter((w) => w < t0 + 4).sort((a, b) => a - b);
		expect(times.length).toBeGreaterThanOrEqual(11);
		for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(60 / 170, 6);
	});

	for (const latency of [0, 500]) {
		it(`重複：每一圈接得很緊，圈和圈之間沒有多停一下（延遲校正 ${latency} 毫秒）（#205）`, () => {
			const { playback, engine, frames, position } = setup();
			// 排過的每一聲節拍器都記下來（引擎停掉時會清掉排著的，這裡不清）
			const heard: number[] = [];
			const click = engine.click;
			engine.click = (when, accent) => {
				heard.push(when);
				click(when, accent);
			};
			playback.setLatency(latency);
			playback.setRange(3.2, 6.4); // 重複第 2 個八拍
			playback.play();
			const t0 = heard[0];
			const positions = new Set<string>();
			// 畫面一秒 60 格，跑三圈多；喇叭的時間和排程的時鐘一起走
			for (let t = 0; t < 3 * 3.2 + 1; t += 1 / 60) {
				engine.time = engine.audible = t0 + t;
				frames.step();
				positions.add(position());
			}
			expect(playback.playing).toBe(true);
			const times = heard.filter((w) => w < t0 + 3 * 3.2 + 0.2).sort((a, b) => a - b);
			// 150 BPM：三圈 24 拍，每一拍都隔 0.4 秒，連圈和圈的接縫也是
			expect(times.length).toBeGreaterThanOrEqual(24);
			for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(0.4, 6);
			// 播放頭一直在第 2 個八拍裡
			expect([...positions].filter((p) => !p.startsWith('音樂 1 2-'))).toEqual([]);
		});
	}

	/** 播放頭停在第 2 個八拍、選了兩個動作（x1 在第 2 個八拍、x2 在第 4 個八拍），開著重複播 x1。 */
	function repeatingAction() {
		const members = [{ memberId: 'm1', role: '主底' }];
		let flow = flowOf(addMembers(sample(), [{ name: '小A', gender: 'M', globalRole: 'base' }]));
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 16, length: 16, note: '', members }));
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Cradle', start: 48, length: 16, note: '', members }));
		const ctx = setup(flow);
		// 排過的每一聲節拍器都記下來（引擎停掉時會清掉排著的，這裡不清）
		const heard: number[] = [];
		const click = ctx.engine.click;
		ctx.engine.click = (when, accent) => {
			heard.push(when);
			click(when, accent);
		};
		ctx.session.selectAction('x1');
		ctx.playback.setRepeat(true);
		ctx.playback.play();
		const t0 = heard[0];
		/** 喇叭和排程時鐘一起走到 t0 + t 秒，一秒 60 格。 */
		let now = 0;
		const runTo = (t: number) => {
			for (; now < t; now += 1 / 60) {
				ctx.engine.time = ctx.engine.audible = t0 + now;
				ctx.frames.step();
			}
		};
		return { ...ctx, heard, t0, runTo };
	}

	it('重複中改了動作長度：重複範圍拉好了就不跟著動作變，照樣播整個第 2 個八拍', () => {
		const { session, playback, position, runTo } = repeatingAction();
		runTo(1);
		// 第一圈播到一半，x1 改成 2 拍（0.8 秒）
		session.change(flowOf(updateAction(session.flow!, 'x1', { length: 4 })));
		runTo(3.2 + 0.8 + 0.1);
		expect(playback.playing).toBe(true);
		expect(position()).toBe('音樂 1 2-3');
	});

	it('重複中選了另一個動作：重複範圍不跟著換', () => {
		const { session, playback, position, runTo } = repeatingAction();
		runTo(1);
		session.selectAction('x2');
		runTo(3.2 + 0.5);
		expect(playback.playing).toBe(true);
		expect(position()).toBe('音樂 1 2-2');
	});

	it('重複半拍的動作、延遲校正 +1000 毫秒：播放頭照樣跟著每一圈走，不卡在動作開頭（#205）', () => {
		const members = [{ memberId: 'm1', role: '主底' }];
		let flow = flowOf(addMembers(sample(), [{ name: '小A', gender: 'M', globalRole: 'base' }]));
		// 2-1 那半拍（3.2 到 3.4 秒）
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 16, length: 1, note: '', members }));
		const { session, playback, engine, frames } = setup(flow);
		session.selectAction('x1');
		playback.setLatency(1000);
		playback.setRepeat(true);
		playback.play();
		const t0 = engine.clicks[0].when;
		// 畫面一秒 60 格跑 3 秒；畫面晚 1 秒，播放頭是 1 秒前喇叭播的那一圈裡的位置
		const shown: number[] = [];
		for (let t = 0; t < 3; t += 1 / 60) {
			engine.time = engine.audible = t0 + t;
			frames.step();
			if (t > 1.5) shown.push(playback.sec);
		}
		expect(playback.playing).toBe(true);
		expect(Math.max(...shown) - Math.min(...shown)).toBeGreaterThan(0.1);
		for (const sec of shown) {
			expect(sec).toBeGreaterThanOrEqual(3.2 - 1e-6);
			expect(sec).toBeLessThanOrEqual(3.4 + 1e-6);
		}
	});

	it('重複中切到別的分頁 30 秒再回來：錯過的圈不補播，從現在接著播，聲音不疊在一起（#205）', () => {
		const { playback, engine, frames } = setup();
		// 排過的每一聲節拍器，連同排的那一刻的時鐘都記下來
		const heard: { when: number; at: number }[] = [];
		const click = engine.click;
		engine.click = (when, accent) => {
			heard.push({ when, at: engine.time });
			click(when, accent);
		};
		playback.setRange(3.2, 6.4); // 重複第 2 個八拍（3.2 秒）
		playback.play();
		const t0 = heard[0].when;
		// 分頁在背景：30 秒沒有畫面，時鐘照走；回來後一秒 60 格跑 4 秒
		for (let t = 30; t < 34; t += 1 / 60) {
			engine.time = engine.audible = t0 + t;
			frames.step();
		}
		expect(playback.playing).toBe(true);
		// 沒有排在已經過去的時間（排了就馬上一起響）
		expect(heard.filter((c) => c.when < c.at)).toEqual([]);
		// 回來後一拍一聲，隔 0.4 秒，沒有疊在一起
		const times = heard
			.filter((c) => c.when > t0 + 30)
			.map((c) => c.when)
			.sort((a, b) => a - b);
		expect(times.length).toBeGreaterThanOrEqual(8);
		for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(0.4, 6);
	});
});

describe('播放：書籤', () => {
	/** 120 BPM 兩段、各 4 個八拍（一個半拍 0.25 秒、一段 16 秒）；書籤「後面」只有 A（音樂 1 3-1，8 秒），「翻騰」1-5 到 2-1（2 到 4 秒）。 */
	function withBookmarks(): Flow {
		let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
		for (const id of ['s1', 's2']) {
			flow = flowOf(addSegment(flow, 'music'));
			flow = flowOf(updateSegment(flow, id, { bpm: 120, eights: 4, lastBeats: 8 }));
		}
		flow = flowOf(addBookmark(flow, '後面', { segmentId: 's1', at: 32 }, null));
		return flowOf(addBookmark(flow, '翻騰', { segmentId: 's1', at: 8 }, { segmentId: 's1', at: 16 }));
	}
	const bookmark = (flow: Flow, name: string) => flow.bookmarks!.find((b) => b.name === name)!;

	it('用有 B 的：重複範圍換成 A 到 B、重複打開、播放頭跳到 A；它就是正在播的書籤，重複關掉就不是', () => {
		const { session, playback } = setup(withBookmarks());
		expect(playback.playingBookmark).toBeNull();
		playback.useBookmark(bookmark(session.flow!, '翻騰'));
		expect(playback.range).toEqual({ a: 2, b: 4 });
		expect(playback.repeat).toBe(true);
		expect(playback.sec).toBe(2);
		expect(playback.playingBookmark).toBe(bookmark(session.flow!, '翻騰').id);
		playback.setRepeat(false);
		expect(playback.range).toEqual({ a: 2, b: 4 });
		expect(playback.playingBookmark).toBeNull();
	});

	it('用只有 A 的、重複關著：播放頭跳到 A，重複範圍拿掉；只有 A 的書籤不算正在播', () => {
		const { session, playback } = setup(withBookmarks());
		playback.setRange(20, 24);
		playback.setRepeat(false);
		playback.useBookmark(bookmark(session.flow!, '後面'));
		expect(playback.sec).toBe(8);
		expect(playback.range).toBeNull();
		expect(playback.repeat).toBe(false);
		expect(playback.playingBookmark).toBeNull();
	});

	it('重複開著、A 在重複範圍外：重複關掉、範圍拿掉，停著按播放從書籤的 A 播', () => {
		const { session, playback } = setup(withBookmarks());
		playback.useBookmark(bookmark(session.flow!, '翻騰'));
		playback.useBookmark(bookmark(session.flow!, '後面'));
		expect(playback.repeat).toBe(false);
		expect(playback.range).toBeNull();
		playback.play();
		expect(playback.sec).toBe(8);
	});

	it('重複開著、播放中用 A 在範圍外的：從書籤的 A 接著播', () => {
		const { session, playback } = setup(withBookmarks());
		playback.useBookmark(bookmark(session.flow!, '翻騰'));
		playback.play();
		playback.useBookmark(bookmark(session.flow!, '後面'));
		expect(playback.playing).toBe(true);
		expect(playback.repeat).toBe(false);
		expect(playback.sec).toBe(8);
	});

	it('重複開著、A 在重複範圍裡：一樣關掉重複、範圍拿掉，原本的書籤不再亮', () => {
		const flow = flowOf(addBookmark(withBookmarks(), '中間', { segmentId: 's1', at: 12 }, null));
		const { session, playback } = setup(flow);
		playback.useBookmark(bookmark(session.flow!, '翻騰'));
		playback.useBookmark(bookmark(session.flow!, '中間'));
		expect(playback.repeat).toBe(false);
		expect(playback.range).toBeNull();
		expect(playback.playingBookmark).toBeNull();
		expect(playback.sec).toBe(3);
	});

	it('播放中、A 在重複範圍裡：從書籤的 A 一直往下播，過了原本的 B 不跳回去', () => {
		const flow = flowOf(addBookmark(withBookmarks(), '中間', { segmentId: 's1', at: 12 }, null));
		const { session, playback, engine, frames } = setup(flow);
		playback.useBookmark(bookmark(session.flow!, '翻騰'));
		playback.play();
		playback.useBookmark(bookmark(session.flow!, '中間'));
		expect(playback.playing).toBe(true);
		const t0 = engine.time;
		for (let t = 0; t < 2; t += 1 / 60) {
			engine.time = engine.audible = t0 + t;
			frames.step();
		}
		expect(playback.sec).toBeGreaterThan(4);
	});

	it('用只有 A 的之後存書籤：存播放頭那裡，不是舊的範圍', () => {
		const { session, playback } = setup(withBookmarks());
		playback.useBookmark(bookmark(session.flow!, '翻騰'));
		playback.useBookmark(bookmark(session.flow!, '後面'));
		expect(playback.bookmarkSpot).toEqual({ a: { segmentId: 's1', at: 32 }, b: null });
	});

	it('用半拍開始的書籤：重複範圍照書籤原樣，不吸到整拍', () => {
		const flow = flowOf(addBookmark(withBookmarks(), '半拍', { segmentId: 's1', at: 41 }, { segmentId: 's1', at: 44 }));
		const { session, playback } = setup(flow);
		playback.useBookmark(bookmark(session.flow!, '半拍'));
		expect(playback.range).toEqual({ a: 10.25, b: 11 });
		expect(playback.sec).toBe(10.25);
		expect(playback.playingBookmark).toBe(bookmark(session.flow!, '半拍').id);
	});

	it('正在播的書籤：尺上拉的範圍 B 是下一段的開頭，跟 B 記成前一段結尾的書籤算同一個', () => {
		const flow = flowOf(addBookmark(withBookmarks(), '音樂 1', { segmentId: 's1', at: 0 }, { segmentId: 's1', at: 64 }));
		const { session, playback } = setup(flow);
		playback.setRange(0, 16);
		expect(playback.rangeAt!.b).toEqual({ segmentId: 's2', at: 0 });
		expect(playback.playingBookmark).toBe(bookmark(session.flow!, '音樂 1').id);
	});

	it('現在要抓的 A、B：沒有範圍是播放頭最近的整拍（段的交界算後一段）；有範圍照原樣（只有 A、重複關著、半拍的動作都一樣）', () => {
		const { session, playback } = setup(withBookmarks());
		playback.seek(16.1);
		expect(playback.bookmarkSpot).toEqual({ a: { segmentId: 's2', at: 0 }, b: null });
		playback.seek(5.1);
		playback.setA();
		expect(playback.bookmarkSpot).toEqual({ a: { segmentId: 's1', at: 20 }, b: null });
		playback.setRange(20, 24);
		playback.setRepeat(false);
		expect(playback.bookmarkSpot).toEqual({ a: { segmentId: 's2', at: 16 }, b: { segmentId: 's2', at: 32 } });
		session.change(flowOf(addMembers(session.flow!, [{ name: '小A', gender: 'F', globalRole: 'top' }])));
		const members = [{ memberId: 'm1', role: '騰翻' }];
		session.change(
			flowOf(addAction(session.flow!, { segmentId: 's1', category: 'tumbling', name: '半拍翻', start: 41, length: 3, note: '', members }))
		);
		playback.clearRange();
		session.selectAction(session.flow!.actions[0].id);
		playback.setRepeat(true);
		expect(playback.bookmarkSpot).toEqual({ a: { segmentId: 's1', at: 41 }, b: { segmentId: 's1', at: 44 } });
	});

	it('現在要抓的 A、B：沒有段就沒有', () => {
		const { playback } = setup(flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } })));
		expect(playback.bookmarkSpot).toBeNull();
	});
});
