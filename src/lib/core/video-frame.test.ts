import { describe, expect, it } from 'vitest';
import {
	VIDEO_INTRO_SEC,
	VIDEO_OUTRO_SEC,
	addAction,
	addMembers,
	addSegment,
	createFlow,
	loadSegmentAudio,
	positionsAt,
	raisedAt,
	teamWho,
	totalSeconds,
	updateSegment,
	videoAudioClips,
	videoDurationSec,
	videoFrame,
	videoRows,
	type Flow
} from './index';
import { flowOf } from '../test-flows';

/**
 * 音樂 1（a1，150 BPM、一個半拍 0.2 秒、一個八拍 3.2 秒；2 個整八拍 ＋ 最後 4 拍 = 8 秒）→ 口號 1（20 秒）
 * → 音樂 2（a2，150 BPM，1 個八拍）；隊員 小A、小B。
 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試流程', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(loadSegmentAudio(flow, 's1', 'one.mp3'));
	flow = flowOf(loadSegmentAudio(flow, 's3', 'two.mp3'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 3, lastBeats: 4 }));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 20 }));
	flow = flowOf(updateSegment(flow, 's3', { eights: 1, lastBeats: 8 }));
	return flow;
}

/** 只有音樂 1：4 個八拍，最後一個只有 4 拍。 */
function musicOnly(): Flow {
	let flow = flowOf(createFlow({ name: '測試流程', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'top' }]));
	flow = flowOf(addSegment(flow, 'music'));
	return flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 4 }));
}

describe('videoDurationSec', () => {
	it('開頭 2 秒 ＋ 流程 ＋ 結尾 1 秒', () => {
		const flow = sample();
		expect(totalSeconds(flow)).toBeCloseTo(8 + 20 + 3.2, 6);
		expect(videoDurationSec(flow)).toBeCloseTo(2 + totalSeconds(flow) + 1, 6);
	});
});

describe('videoFrame：開頭和結尾', () => {
	it('第 0 秒是開頭：開場站位，沒有拍', () => {
		const flow = sample();
		const f = videoFrame(flow, 0);
		expect(f.part).toBe('intro');
		expect(f.flowSec).toBe(0);
		expect(f.where).toBe('開場站位');
		expect(f.beats).toBeNull();
		expect(f.title).toBe('測試流程');
		expect(f.clock).toBe('0:00.0');
		expect(f.positions).toEqual(positionsAt(flow, 0));
	});

	it('開頭最後一刻還是開頭，第 2 秒才開始播', () => {
		const flow = sample();
		expect(videoFrame(flow, VIDEO_INTRO_SEC - 0.01).part).toBe('intro');
		expect(videoFrame(flow, VIDEO_INTRO_SEC).part).toBe('play');
	});

	it('超過流程結尾是結尾，flowSec 停在流程長度', () => {
		const flow = sample();
		const f = videoFrame(flow, VIDEO_INTRO_SEC + totalSeconds(flow) + 0.5);
		expect(f.part).toBe('outro');
		expect(f.flowSec).toBe(totalSeconds(flow));
		expect(f.positions).toEqual(positionsAt(flow, totalSeconds(flow)));
		expect(f.raised).toEqual(raisedAt(flow, totalSeconds(flow)));
	});

	it('結尾停在最後一個音樂段的最後一個八拍的最後一拍，不畫不存在的拍', () => {
		const flow = musicOnly();
		const total = totalSeconds(flow);
		const f = videoFrame(flow, VIDEO_INTRO_SEC + total + 0.5);
		expect(f.part).toBe('outro');
		expect(f.where).toBe('音樂 1・第 4 個八拍');
		expect(f.beats).toEqual({ count: 4, lit: 4 });
		expect(f.row).toEqual(videoFrame(flow, VIDEO_INTRO_SEC + total - 0.01).row);
	});

	it('剛好在流程結尾那一刻也是結尾', () => {
		const flow = musicOnly();
		const f = videoFrame(flow, VIDEO_INTRO_SEC + totalSeconds(flow));
		expect(f.part).toBe('outro');
		expect(f.beats).toEqual({ count: 4, lit: 4 });
	});

	it('最後是口號段：結尾寫整段的秒數，沒有拍', () => {
		let flow = flowOf(createFlow({ name: '口號', field: { strips: 9, layout: 'vertical' } }));
		flow = flowOf(addSegment(flow, 'chant'));
		flow = flowOf(updateSegment(flow, 's1', { seconds: 12.3 }));
		const f = videoFrame(flow, VIDEO_INTRO_SEC + 99);
		expect(f.part).toBe('outro');
		expect(f.where).toBe('口號 1・12.3 秒');
		expect(f.beats).toBeNull();
	});
});

describe('videoFrame：播放中', () => {
	it('150 BPM 第 6 拍：count 8、lit 6，寫第 1 個八拍', () => {
		const f = videoFrame(sample(), VIDEO_INTRO_SEC + 5 * 0.4);
		expect(f.part).toBe('play');
		expect(f.beats).toEqual({ count: 8, lit: 6 });
		expect(f.where).toBe('音樂 1・第 1 個八拍');
		expect(f.flowSec).toBeCloseTo(2, 6);
	});

	it('最後一個八拍只有 4 拍：停在第 3 拍是 count 4、lit 3', () => {
		const flow = sample();
		// 第 3 個八拍從 6.4 秒開始，第 3 拍 = 再過 2 拍（0.8 秒）
		const f = videoFrame(flow, VIDEO_INTRO_SEC + 6.4 + 2 * 0.4);
		expect(f.where).toBe('音樂 1・第 3 個八拍');
		expect(f.beats).toEqual({ count: 4, lit: 3 });
	});

	it('口號段第 12.3 秒：沒有拍，寫段內秒數', () => {
		const f = videoFrame(sample(), VIDEO_INTRO_SEC + 8 + 12.3);
		expect(f.beats).toBeNull();
		expect(f.where).toBe('口號 1・12.3 秒');
		expect(f.clock).toBe('0:20.3');
	});

	it('音樂 → 口號 → 音樂：第二個音樂段第 1 拍寫「音樂 2・第 1 個八拍」', () => {
		const f = videoFrame(sample(), VIDEO_INTRO_SEC + 28 + 0.01);
		expect(f.where).toBe('音樂 2・第 1 個八拍');
		expect(f.beats).toEqual({ count: 8, lit: 1 });
	});

	it('positions、raised、markers 跟編輯器用的核心函式一樣', () => {
		const flow = sample();
		const f = videoFrame(flow, VIDEO_INTRO_SEC + 4.3);
		expect(f.positions).toEqual(positionsAt(flow, 4.3));
		expect(f.raised).toEqual(raisedAt(flow, 4.3));
	});

	it('八拍表合起來的列：where 還是現在這一個八拍', () => {
		// 站位 1 在第 1 個八拍，第 2、3 個八拍沒有新東西，合成一列
		const flow = sample();
		const rows = videoRows(flow);
		expect(rows[1].label).toBe('音樂 1 第 2 個八拍');
		const f = videoFrame(flow, VIDEO_INTRO_SEC + 7);
		expect(f.where).toBe('音樂 1・第 3 個八拍');
		expect(f.row).toEqual(rows[1].row);
	});
});

describe('row', () => {
	/** 一個動作從第 1 個八拍開到第 3 個八拍結束（跨 3 個八拍）。 */
	function withLongAction(): Flow {
		return flowOf(
			addAction(sample(), {
				segmentId: 's1',
				category: 'stunt',
				name: 'Lib',
				start: 0,
				length: 40,
				note: '備註',
				members: [{ memberId: 'm1', role: '上層' }]
			})
		);
	}

	it('動作開始的那一列：actions 有，continuing 沒有', () => {
		const flow = withLongAction();
		const f = videoFrame(flow, VIDEO_INTRO_SEC + 0.1);
		expect(f.row.actions).toEqual([{ title: '1-1 到 3-4・20 拍　技巧·Lib', who: '小A（上層）', note: '備註' }]);
		expect(f.row.continuing).toEqual([]);
		expect(f.row.empty).toBe(false);
	});

	it('跨 3 個八拍的動作：第 2 個八拍 continuing 有名字和 who，actions 是空的', () => {
		const flow = withLongAction();
		const f = videoFrame(flow, VIDEO_INTRO_SEC + 3.2 + 0.1);
		expect(f.where).toBe('音樂 1・第 2 個八拍');
		expect(f.row.actions).toEqual([]);
		expect(f.row.continuing).toEqual([{ name: 'Lib', who: teamWho(flow, flow.actions[0]) }]);
		expect(f.row.empty).toBe(false);
	});

	it('什麼都沒有的列 empty', () => {
		const f = videoFrame(sample(), VIDEO_INTRO_SEC + 3.3);
		expect(f.row).toEqual({ formations: [], actions: [], continuing: [], cues: [], empty: true });
	});
});

describe('videoRows', () => {
	it('音樂段寫第幾個八拍（合起來的列用第一個），口號段只有段名', () => {
		const rows = videoRows(sample());
		expect(rows.map((r) => r.label)).toEqual(['音樂 1 第 1 個八拍', '音樂 1 第 2 個八拍', '口號 1', '音樂 2 第 1 個八拍']);
	});
});

describe('videoAudioClips', () => {
	it('跟編輯器從頭播一樣，開始秒數都加 2；第二段 = 第一段長 ＋ 口號長 ＋ 2', () => {
		const clips = videoAudioClips(sample());
		expect(clips.map((c) => c.audioId)).toEqual(['a1', 'a2']);
		expect(clips[0].sec).toBeCloseTo(2, 6);
		expect(clips[1].sec).toBeCloseTo(8 + 20 + 2, 6);
		expect(clips[0].durationSec).toBeCloseTo(8, 6);
	});
});

describe('常數', () => {
	it('結尾停 1 秒', () => {
		expect(VIDEO_OUTRO_SEC).toBe(1);
	});
});
