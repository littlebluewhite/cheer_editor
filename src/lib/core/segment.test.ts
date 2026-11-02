import { describe, expect, it } from 'vitest';
import {
	addSegment,
	beatLines,
	createFlow,
	loadSegmentAudio,
	musicLength,
	musicLengthFromAudio,
	updateSegment,
	type CommandResult,
	type Flow,
	type MusicSegment
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

const newFlow = () =>
	flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));

describe('加段', () => {
	it('新流程沒有段，在最後加音樂段和口號段，段的 id 不重複', () => {
		let flow = newFlow();
		expect(flow.segments).toEqual([]);
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(addSegment(flow, 'chant'));
		expect(flow.segments).toEqual([
			{ id: 's1', kind: 'music', audioId: null, bpm: 150, firstBeatSec: 0, halfBeats: 128 },
			{ id: 's2', kind: 'chant', tenths: 100 }
		]);
	});

	it('不改傳進來的流程', () => {
		const flow = newFlow();
		addSegment(flow, 'music');
		expect(flow.segments).toEqual([]);
	});
});

describe('改音樂段', () => {
	const withMusic = () => flowOf(addSegment(newFlow(), 'music'));

	it('改 BPM 和第一拍', () => {
		const flow = flowOf(updateSegment(withMusic(), 's1', { bpm: 128, firstBeatSec: 0.42 }));
		expect(flow.segments[0]).toMatchObject({ bpm: 128, firstBeatSec: 0.42 });
	});

	it.each([59, 171, Number.NaN])('BPM %s 不在 60–170 就擋下', (bpm) => {
		expect(updateSegment(withMusic(), 's1', { bpm })).toEqual({
			kind: 'blocked',
			message: 'BPM 要在 60–170 之間'
		});
	});

	it('BPM 60 和 170 都可以', () => {
		expect(updateSegment(withMusic(), 's1', { bpm: 60 }).kind).toBe('ok');
		expect(updateSegment(withMusic(), 's1', { bpm: 170 }).kind).toBe('ok');
	});

	it('第一拍不能是負的', () => {
		expect(updateSegment(withMusic(), 's1', { firstBeatSec: -0.1 })).toEqual({
			kind: 'blocked',
			message: '第一拍要是 0 秒以上'
		});
	});

	it('長度用「幾個八拍、最後一個八拍幾拍」設，存成半拍數；最後一個八拍可以不滿', () => {
		const flow = flowOf(updateSegment(withMusic(), 's1', { eights: 10, lastBeats: 4 }));
		// 9 個滿的八拍 + 4 拍 = 76 拍 = 152 個半拍
		expect(flow.segments[0]).toMatchObject({ halfBeats: 152 });
		expect(musicLength(flow.segments[0] as MusicSegment)).toEqual({ eights: 10, lastBeats: 4 });
	});

	it.each([
		[0, 8],
		[1.5, 8],
		[3, 0],
		[3, 9]
	])('八拍數 %s、最後一個八拍 %s 拍不合理就擋下', (eights, lastBeats) => {
		expect(updateSegment(withMusic(), 's1', { eights, lastBeats })).toEqual({
			kind: 'blocked',
			message: '八拍數至少 1；最後一個八拍要有 1–8 拍'
		});
	});
});

describe('照音樂長度算', () => {
	it('從第一拍算到音樂結束有幾拍，換成幾個八拍、最後一個八拍幾拍', () => {
		// (30.5 − 0.4) 秒 × 150 ÷ 60 = 75.25 拍 → 75 拍 = 9 個滿的八拍 + 3 拍
		expect(musicLengthFromAudio({ durationSec: 30.5, firstBeatSec: 0.4, bpm: 150 })).toEqual({
			eights: 10,
			lastBeats: 3
		});
	});

	it('剛好整數個八拍時，最後一個八拍是滿的 8 拍', () => {
		// 32 秒 × 120 ÷ 60 = 64 拍 = 8 個八拍
		expect(musicLengthFromAudio({ durationSec: 32, firstBeatSec: 0, bpm: 120 })).toEqual({
			eights: 8,
			lastBeats: 8
		});
	});

	it('第一拍之後不到一拍時，至少給 1 拍', () => {
		expect(musicLengthFromAudio({ durationSec: 1, firstBeatSec: 0.9, bpm: 150 })).toEqual({
			eights: 1,
			lastBeats: 1
		});
	});
});

describe('波形上的拍子線', () => {
	it('從第一拍起照 BPM 畫，每個八拍的第一拍另外標，只到視窗為止', () => {
		expect(beatLines({ bpm: 150, firstBeatSec: 0.4, windowSec: 4 })).toEqual([
			{ sec: 0.4, kind: 'first' },
			...[0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2].map((sec) => ({ sec: expect.closeTo(sec, 9), kind: 'beat' })),
			{ sec: expect.closeTo(3.6, 9), kind: 'eight' }
		]);
	});
});

describe('改口號段', () => {
	const withChant = () => flowOf(addSegment(newFlow(), 'chant'));

	it('長度用秒設，最細 0.1 秒，存成 0.1 秒數', () => {
		const flow = flowOf(updateSegment(withChant(), 's1', { seconds: 32.44 }));
		expect(flow.segments[0]).toEqual({ id: 's1', kind: 'chant', tenths: 324 });
	});

	it('短於 0.1 秒就擋下', () => {
		expect(updateSegment(withChant(), 's1', { seconds: 0.04 })).toEqual({
			kind: 'blocked',
			message: '口號段至少 0.1 秒'
		});
	});
});

describe('音樂檔', () => {
	const twoMusic = () => flowOf(addSegment(flowOf(addSegment(newFlow(), 'music')), 'music'));

	it('音樂段載入 mp3、m4a、wav：流程記一筆音樂檔，段指過去', () => {
		const flow = flowOf(loadSegmentAudio(twoMusic(), 's1', '主歌.MP3'));
		expect(flow.audio).toEqual([{ id: 'a1', file: 'audio/a1.mp3', name: '主歌.MP3' }]);
		expect(flow.segments[0]).toMatchObject({ audioId: 'a1' });
		expect(loadSegmentAudio(twoMusic(), 's1', 'x.m4a').kind).toBe('ok');
		expect(loadSegmentAudio(twoMusic(), 's1', 'x.wav').kind).toBe('ok');
	});

	it('其他格式擋下', () => {
		expect(loadSegmentAudio(twoMusic(), 's1', '歌.ogg')).toEqual({
			kind: 'blocked',
			message: '只能載入 mp3、m4a、wav'
		});
	});

	it('口號段不能載入音樂', () => {
		const flow = flowOf(addSegment(newFlow(), 'chant'));
		expect(loadSegmentAudio(flow, 's1', '歌.mp3')).toEqual({
			kind: 'blocked',
			message: '口號段沒有音樂'
		});
	});

	it('變速切段：第二個音樂段用同一個音樂檔，清單裡還是只有一筆', () => {
		let flow = flowOf(loadSegmentAudio(twoMusic(), 's1', '歌.mp3'));
		flow = flowOf(updateSegment(flow, 's2', { audioId: 'a1' }));
		expect(flow.segments.map((s) => s.kind === 'music' && s.audioId)).toEqual(['a1', 'a1']);
		expect(flow.audio).toHaveLength(1);
	});

	it('指到不存在的音樂檔就擋下', () => {
		expect(updateSegment(twoMusic(), 's1', { audioId: 'a9' })).toEqual({
			kind: 'blocked',
			message: '找不到這個音樂檔'
		});
	});

	it('換掉音樂檔後，沒有段在用的那筆從清單拿掉', () => {
		let flow = flowOf(loadSegmentAudio(twoMusic(), 's1', '舊.mp3'));
		flow = flowOf(loadSegmentAudio(flow, 's1', '新.wav'));
		expect(flow.audio).toEqual([{ id: 'a2', file: 'audio/a2.wav', name: '新.wav' }]);
	});
});
