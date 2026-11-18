// 流程影片的聲音：照編輯器從頭播的音樂片段混成一軌，開頭停的 2 秒沒聲音。
// 「哪個片段放哪」是純函式（mixClips，可以測）；真的混音要 OfflineAudioContext，只在瀏覽器跑。

import { segmentSpans, videoAudioClips, videoDurationSec, type Flow } from '#lib/core';

export const VIDEO_SAMPLE_RATE = 48000;

/** 一個音樂片段放進影片：when 是影片第幾秒開始放，offset 是從音樂檔第幾秒開始，duration 放多久。 */
export interface MixClip {
	audioId: string;
	when: number;
	offset: number;
	duration: number;
}

/**
 * 哪些片段放哪。音樂檔沒載入、壞掉（loaded 回 false）、或根本沒選音樂的音樂段：
 * 那段沒聲音，列進 silentSegments（段 id），照樣輸出。
 */
export function mixClips(flow: Flow, loaded: (audioId: string) => boolean): { clips: MixClip[]; silentSegments: string[] } {
	const silentSegments = segmentSpans(flow)
		.filter(({ segment }) => segment.kind === 'music' && (segment.audioId === null || !loaded(segment.audioId)))
		.map(({ segment }) => segment.id);
	const clips = videoAudioClips(flow)
		.filter((c) => loaded(c.audioId))
		.map((c) => ({ audioId: c.audioId, when: c.sec, offset: c.fileSec, duration: c.durationSec }));
	return { clips, silentSegments };
}

/** 混成一軌：48 kHz 雙聲道，長度跟影片一樣。沒載入的音樂檔那段沒聲音。 */
export async function renderSoundtrack(flow: Flow, getBuffer: (id: string) => AudioBuffer | undefined): Promise<AudioBuffer> {
	const ctx = new OfflineAudioContext(2, Math.ceil(videoDurationSec(flow) * VIDEO_SAMPLE_RATE), VIDEO_SAMPLE_RATE);
	const { clips } = mixClips(flow, (id) => getBuffer(id) !== undefined);
	for (const clip of clips) {
		const source = ctx.createBufferSource();
		source.buffer = getBuffer(clip.audioId)!;
		source.connect(ctx.destination);
		source.start(clip.when, clip.offset, clip.duration);
	}
	return ctx.startRendering();
}
