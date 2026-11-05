// 播放（編輯器 module 的 playback）：在 Node 測，音訊引擎是假的、畫面時鐘手動撥一格。
import { describe, expect, it } from 'vitest';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	deleteSegment,
	insertFormation,
	moveFormation,
	moveMembers,
	moveSegment,
	positionText,
	updateSegment,
	type Flow
} from '#lib/core';
import { flowOf, libSample } from '#lib/test-flows.js';
import { manualFrames, testEditor } from '#lib/test-fakes.js';

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
	const position = () => positionText(session.flow!, playback.sec);
	return { session, playback, engine, frames, position };
}

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
	it('按播放，播放頭跟著喇叭的時間走，口號段時間照走；再按一次暫停，聲音停掉、播放頭不動', () => {
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
		engine.audible = t0 + 50;
		frames.step();
		expect(position()).toBe('音樂 2 1-2');
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

	it('播到結尾自己停，播放頭停在結尾', () => {
		const { playback, engine, frames } = setup();
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
		session.ask.send(() => moveMembers(session.flow!, 2, { m1: [1, 1] }), { done: (r) => session.moved(r) });
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
		session.ask.send(() => moveFormation(session.flow!, id, to), { done: (r) => session.formationMoved(id, r) });
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
