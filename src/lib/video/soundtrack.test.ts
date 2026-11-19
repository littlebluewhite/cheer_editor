import { describe, expect, it } from 'vitest';
import { addSegment, createFlow, segmentSpans, type Flow } from '#lib/core';
import { flowOf } from '../test-flows';
import { mixClips } from './soundtrack';

/** 給每個音樂段指一個音樂檔（a1、a2…），第一拍都在 1.5 秒。 */
function withAudio(flow: Flow): Flow {
	let n = 0;
	const segments = flow.segments.map((s) => (s.kind === 'music' ? { ...s, audioId: `a${++n}`, firstBeatSec: 1.5 } : s));
	const audio = Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, file: `audio/a${i + 1}.mp3`, name: `a${i + 1}.mp3` }));
	return { ...flow, audio, segments };
}

function flowOfKinds(kinds: ('music' | 'chant')[]): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	for (const kind of kinds) flow = flowOf(addSegment(flow, kind));
	return withAudio(flow);
}

describe('mixClips', () => {
	it('一個音樂段：一個片段，從影片第 2 秒放、從音樂檔的第一拍開始', () => {
		const flow = flowOfKinds(['music']);
		const { clips, silentSegments } = mixClips(flow, () => true);
		expect(clips).toEqual([{ audioId: 'a1', when: 2, offset: 1.5, duration: segmentSpans(flow)[0].durationSec }]);
		expect(silentSegments).toEqual([]);
	});

	it('音樂、口號、音樂：第二個片段接在第一段加口號之後', () => {
		const flow = flowOfKinds(['music', 'chant', 'music']);
		const spans = segmentSpans(flow);
		const { clips } = mixClips(flow, () => true);
		expect(clips.map((c) => c.audioId)).toEqual(['a1', 'a2']);
		expect(clips[1].when).toBeCloseTo(2 + spans[0].durationSec + spans[1].durationSec);
		expect(clips[1].offset).toBe(1.5);
	});

	it('沒載入的音樂檔：那段沒有片段，列進 silentSegments', () => {
		const flow = flowOfKinds(['music', 'chant', 'music']);
		const { clips, silentSegments } = mixClips(flow, (id) => id !== 'a1');
		expect(clips.map((c) => c.audioId)).toEqual(['a2']);
		expect(silentSegments).toEqual([flow.segments[0].id]);
	});
});
