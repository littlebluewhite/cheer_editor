import { describe, expect, it } from 'vitest';
import {
	addSegment,
	audioOverlaps,
	beatLines,
	createFlow,
	loadSegmentAudio,
	fitSegmentToAudio,
	musicLength,
	readSegmentNumber,
	updateSegment,
	type AudioLengths,
	type MusicSegment
} from './index';
import { flowOf } from '../test-flows';

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

	it('回傳新段的 id（畫面用來打開段設定）', () => {
		const r = addSegment(flowOf(addSegment(newFlow(), 'music')), 'chant');
		expect(r.kind === 'ok' && r.id).toBe('s2');
	});

	it('指定加在哪一段後面：插在那一段後面，開頭那張站位不動', () => {
		let flow = flowOf(addSegment(flowOf(addSegment(newFlow(), 'music')), 'music'));
		flow = flowOf(addSegment(flow, 'chant', 's1'));
		expect(flow.segments.map((s) => s.id)).toEqual(['s1', 's3', 's2']);
		expect(flow.formations[0]).toMatchObject({ segmentId: 's1', at: 0 });
	});

	it('指定的段找不到就擋下', () => {
		expect(addSegment(flowOf(addSegment(newFlow(), 'music')), 'chant', 's9').kind).toBe('blocked');
	});
});

describe('改音樂段', () => {
	const withMusic = () => flowOf(addSegment(newFlow(), 'music'));

	it('改 BPM 和第一拍', () => {
		const flow = flowOf(updateSegment(withMusic(), 's1', { bpm: 128, firstBeatSec: 0.42 }));
		expect(flow.segments[0]).toMatchObject({ bpm: 128, firstBeatSec: 0.42 });
	});

	it.each([59, 171, -5, Number.NaN])('BPM %s 不在 60 到 170 就擋下，訊息寫範圍', (bpm) => {
		expect(updateSegment(withMusic(), 's1', { bpm })).toEqual({
			kind: 'blocked',
			message: 'BPM 要在 60 到 170 之間'
		});
	});

	it('BPM 60 和 170 都可以', () => {
		expect(updateSegment(withMusic(), 's1', { bpm: 60 }).kind).toBe('ok');
		expect(updateSegment(withMusic(), 's1', { bpm: 170 }).kind).toBe('ok');
	});

	it('第一拍最細 0.01 秒（例：在波形上點的位置）', () => {
		const flow = flowOf(updateSegment(withMusic(), 's1', { firstBeatSec: 1.40625 }));
		expect(flow.segments[0]).toMatchObject({ firstBeatSec: 1.41 });
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

	it.each([0, -3, 201, 50000, Number.NaN])('八拍數 %s 不在 1 到 200 就擋下，訊息寫範圍', (eights) => {
		expect(updateSegment(withMusic(), 's1', { eights })).toEqual({
			kind: 'blocked',
			message: '八拍數要在 1 到 200 之間'
		});
	});

	it('八拍數最多 200', () => {
		const flow = flowOf(updateSegment(withMusic(), 's1', { eights: 200 }));
		expect(musicLength(flow.segments[0] as MusicSegment)).toEqual({ eights: 200, lastBeats: 8 });
	});

	it('八拍數要是整數', () => {
		expect(updateSegment(withMusic(), 's1', { eights: 1.5 })).toEqual({
			kind: 'blocked',
			message: '八拍數要是整數'
		});
	});

	it('只改八拍數：最後一個八拍回到滿的 8 拍（不留著上次算出的零頭）', () => {
		let flow = flowOf(updateSegment(withMusic(), 's1', { eights: 10, lastBeats: 1 }));
		flow = flowOf(updateSegment(flow, 's1', { eights: 4 }));
		expect(musicLength(flow.segments[0] as MusicSegment)).toEqual({ eights: 4, lastBeats: 8 });
	});

	it.each([0, -1, 9, 2.5, Number.NaN])('最後一個八拍 %s 拍不合理就擋下，訊息只講這一格', (lastBeats) => {
		expect(updateSegment(withMusic(), 's1', { lastBeats })).toEqual({
			kind: 'blocked',
			message: '最後一個八拍的拍數要在 1 到 8 之間'
		});
	});
});

describe('段設定欄位裡打的數字', () => {
	it('全形當成半形；負的、超出範圍的照讀（交給指令擋下、說範圍）', () => {
		expect(readSegmentNumber('bpm', ' １２．５ ')).toEqual({ kind: 'ok', value: 12.5 });
		expect(readSegmentNumber('seconds', '－３')).toEqual({ kind: 'ok', value: -3 });
		expect(readSegmentNumber('eights', '200')).toEqual({ kind: 'ok', value: 200 });
		expect(readSegmentNumber('lastBeats', '9')).toEqual({ kind: 'ok', value: 9 });
	});

	it.each([
		['bpm', 'BPM 要在 60 到 170 之間'],
		['firstBeatSec', '第一拍要是 0 秒以上'],
		['eights', '八拍數要在 1 到 200 之間'],
		['lastBeats', '最後一個八拍的拍數要在 1 到 8 之間'],
		['seconds', '口號段長度要在 0.1 到 300 秒之間']
	] as const)('%s 空白、看不懂就擋下，訊息跟超出範圍一樣寫能填的範圍', (field, message) => {
		expect(readSegmentNumber(field, '')).toEqual({ kind: 'blocked', message });
		expect(readSegmentNumber(field, 'abc')).toEqual({ kind: 'blocked', message });
	});
});

/** 音樂 1 載入了歌.mp3（a1），第一拍、BPM 照給的。 */
const withMusic = (firstBeatSec = 0, bpm = 150) =>
	flowOf(updateSegment(flowOf(loadSegmentAudio(flowOf(addSegment(newFlow(), 'music')), 's1', '歌.mp3')), 's1', { firstBeatSec, bpm }));

describe('照音樂長度算（音樂多長由音樂檔庫給）', () => {
	const lengthOf = (flow: ReturnType<typeof withMusic>) => musicLength(flow.segments[0] as MusicSegment);

	it('從第一拍算到音樂結束有幾拍，換成幾個八拍、最後一個八拍幾拍', () => {
		// (30.5 − 0.4) 秒 × 150 ÷ 60 = 75.25 拍 → 75 拍 = 9 個滿的八拍 + 3 拍
		const flow = flowOf(fitSegmentToAudio(withMusic(0.4), 's1', { a1: 30.5 }));
		expect(lengthOf(flow)).toEqual({ eights: 10, lastBeats: 3 });
	});

	it('剛好整數個八拍時，最後一個八拍是滿的 8 拍', () => {
		// 32 秒 × 120 ÷ 60 = 64 拍 = 8 個八拍
		const flow = flowOf(fitSegmentToAudio(withMusic(0, 120), 's1', { a1: 32 }));
		expect(lengthOf(flow)).toEqual({ eights: 8, lastBeats: 8 });
	});

	it('第一拍之後剩下不到一拍：擋下，說剩下不到一拍（不叫教練再按一次）', () => {
		// 30 秒的檔、第一拍 29.9：150 BPM 一拍 0.4 秒
		expect(fitSegmentToAudio(withMusic(29.9), 's1', { a1: 30 })).toEqual({
			kind: 'blocked',
			message: '第一拍之後剩下不到一拍'
		});
	});

	it('音樂比 200 個八拍長：擋下，訊息寫範圍', () => {
		// 30 分鐘 × 170 BPM = 5100 拍
		expect(fitSegmentToAudio(withMusic(0, 170), 's1', { a1: 1800 })).toEqual({
			kind: 'blocked',
			message: '八拍數要在 1 到 200 之間'
		});
	});

	it('音樂檔壞了（不知道多長）、還沒載入音樂：擋下，說原因', () => {
		expect(fitSegmentToAudio(withMusic(), 's1', { a1: null })).toEqual({
			kind: 'blocked',
			message: '音樂檔壞了，請重新選檔'
		});
		expect(fitSegmentToAudio(withMusic(), 's1', {})).toEqual({ kind: 'blocked', message: '先載入音樂檔' });
		expect(fitSegmentToAudio(flowOf(addSegment(newFlow(), 'music')), 's1', { a1: 30 })).toEqual({
			kind: 'blocked',
			message: '先載入音樂檔'
		});
	});
});

describe('第一拍要在音樂結束之前（音樂多長由音樂檔庫給）', () => {
	const pastEnd = (sec: string) => ({ kind: 'blocked', message: `第一拍要在音樂結束（${sec} 秒）之前` });

	it('改第一拍：在音樂結束那一刻或之後就擋下，說音樂只有幾秒', () => {
		expect(updateSegment(withMusic(), 's1', { firstBeatSec: 100 }, {}, { a1: 90 })).toEqual(pastEnd('90.0'));
		expect(updateSegment(withMusic(), 's1', { firstBeatSec: 6 }, {}, { a1: 5 })).toEqual(pastEnd('5.0'));
		expect(updateSegment(withMusic(), 's1', { firstBeatSec: 5 }, {}, { a1: 5 })).toEqual(pastEnd('5.0'));
		expect(flowOf(updateSegment(withMusic(), 's1', { firstBeatSec: 4.9 }, {}, { a1: 5 })).segments[0]).toMatchObject({
			firstBeatSec: 4.9
		});
	});

	it('第一拍打了大到算不出來的數（1e309、1e308）：還是說要在音樂結束之前，不說要 0 秒以上', () => {
		for (const text of ['1e309', '1e308']) {
			const value = readSegmentNumber('firstBeatSec', text);
			expect(value.kind).toBe('ok');
			if (value.kind !== 'ok') continue;
			expect(updateSegment(withMusic(), 's1', { firstBeatSec: value.value }, {}, { a1: 30 })).toEqual(pastEnd('30.0'));
		}
	});

	it('照音樂長度算：第一拍已經在音樂結束之後（換了短的檔），說同一句', () => {
		expect(fitSegmentToAudio(withMusic(40), 's1', { a1: 30 })).toEqual(pastEnd('30.0'));
		expect(fitSegmentToAudio(withMusic(31), 's1', { a1: 30 })).toEqual(pastEnd('30.0'));
	});

	it('不知道音樂多長（壞了、手上沒有、沒給）：第一拍照改', () => {
		const unknown: (AudioLengths | undefined)[] = [{ a1: null }, {}, undefined];
		for (const lengths of unknown) {
			expect(flowOf(updateSegment(withMusic(), 's1', { firstBeatSec: 100 }, {}, lengths)).segments[0]).toMatchObject({
				firstBeatSec: 100
			});
		}
	});

	it('改別的欄位（BPM、長度）不看第一拍：第一拍已經在音樂結束之後也照改', () => {
		const flow = flowOf(updateSegment(withMusic(40), 's1', { bpm: 120 }, {}, { a1: 30 }));
		expect(flow.segments[0]).toMatchObject({ bpm: 120, firstBeatSec: 40 });
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

	it.each([0.04, -3, 300.1, 99999999, Number.NaN])('%s 秒不在 0.1 到 300 秒就擋下，訊息寫範圍', (seconds) => {
		expect(updateSegment(withChant(), 's1', { seconds })).toEqual({
			kind: 'blocked',
			message: '口號段長度要在 0.1 到 300 秒之間'
		});
	});

	it('口號段最長 300 秒', () => {
		const flow = flowOf(updateSegment(withChant(), 's1', { seconds: 300 }));
		expect(flow.segments[0]).toEqual({ id: 's1', kind: 'chant', tenths: 3000 });
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

	it('回傳新音樂檔的 id（畫面用它對應解碼好的音樂）', () => {
		const flow = flowOf(loadSegmentAudio(twoMusic(), 's1', 'a.mp3'));
		const r = loadSegmentAudio(flow, 's2', 'b.mp3');
		expect(r.kind === 'ok' && r.audioId).toBe('a2');
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

	it('新音樂段選了跟前一個音樂段同一個檔：第一拍接在前一段後面（前一段第一拍＋長度）', () => {
		let flow = flowOf(loadSegmentAudio(twoMusic(), 's1', '歌.mp3'));
		// 前一段：第一拍 1.2 秒、120 BPM、4 個八拍 = 16 秒
		flow = flowOf(updateSegment(flow, 's1', { firstBeatSec: 1.2, bpm: 120, eights: 4 }));
		flow = flowOf(updateSegment(flow, 's2', { audioId: 'a1' }));
		expect(flow.segments[1]).toMatchObject({ audioId: 'a1', firstBeatSec: 17.2 });
		// 教練可以再改
		flow = flowOf(updateSegment(flow, 's2', { firstBeatSec: 17.5 }));
		expect(flow.segments[1]).toMatchObject({ firstBeatSec: 17.5 });
	});

	it('中間隔著口號段也一樣接上前一個音樂段；已經有音樂的段換檔不動第一拍', () => {
		let flow = flowOf(addSegment(flowOf(addSegment(newFlow(), 'music')), 'chant'));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(loadSegmentAudio(flow, 's1', '歌.mp3'));
		// 前一段：150 BPM、8 個八拍 = 25.6 秒
		expect(flowOf(updateSegment(flow, 's3', { audioId: 'a1' })).segments[2]).toMatchObject({ firstBeatSec: 25.6 });
		flow = flowOf(loadSegmentAudio(flow, 's3', '別首.mp3'));
		flow = flowOf(updateSegment(flow, 's3', { firstBeatSec: 3 }));
		expect(flowOf(updateSegment(flow, 's3', { audioId: 'a1' })).segments[2]).toMatchObject({ firstBeatSec: 3 });
	});

	it('新音樂段選了跟前一個音樂段同一個檔：BPM 也沿用前一段', () => {
		let flow = flowOf(loadSegmentAudio(twoMusic(), 's1', '歌.mp3'));
		flow = flowOf(updateSegment(flow, 's1', { bpm: 128 }));
		flow = flowOf(updateSegment(flow, 's2', { audioId: 'a1' }));
		expect(flow.segments[1]).toMatchObject({ audioId: 'a1', bpm: 128 });
	});

	it('前一個音樂段用的是別的檔：第一拍不動', () => {
		let flow = flowOf(loadSegmentAudio(twoMusic(), 's1', '歌.mp3'));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(loadSegmentAudio(flow, 's2', '別首.mp3'));
		expect(flowOf(updateSegment(flow, 's3', { audioId: 'a1' })).segments[2]).toMatchObject({ firstBeatSec: 0, bpm: 150 });
	});

	it('兩段用同一個檔、用到的時間重疊：說跟哪一段重疊、重疊幾秒', () => {
		let flow = flowOf(loadSegmentAudio(twoMusic(), 's1', '歌.mp3'));
		// 音樂 1：0 到 25.6 秒；音樂 2 接在後面（25.6 秒起），不重疊
		flow = flowOf(updateSegment(flow, 's2', { audioId: 'a1' }));
		expect(audioOverlaps(flow, 's1')).toEqual([]);
		// 音樂 1 拉長到 10 個八拍 = 32 秒：音樂 2 的 25.6 到 32 秒播兩次
		flow = flowOf(updateSegment(flow, 's1', { eights: 10 }));
		expect(audioOverlaps(flow, 's1')).toEqual([{ label: '音樂 2', sec: expect.closeTo(6.4, 9) }]);
		expect(audioOverlaps(flow, 's2')).toEqual([{ label: '音樂 1', sec: expect.closeTo(6.4, 9) }]);
	});

	it('用不同的檔、沒有音樂：不算重疊', () => {
		let flow = flowOf(loadSegmentAudio(twoMusic(), 's1', '歌.mp3'));
		expect(audioOverlaps(flow, 's1')).toEqual([]);
		flow = flowOf(loadSegmentAudio(flow, 's2', '別首.mp3'));
		expect(audioOverlaps(flow, 's2')).toEqual([]);
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
