// 播放計畫：從流程的某一刻開始，哪些音樂檔在什麼時候從哪裡播、節拍器在哪些時間響。
// 時間都是流程秒數；音訊薄層照這份計畫排進 Web Audio，自己不算拍子。

import type { Flow } from './flow';
import type { MusicSegment } from './segment';
import { EPS, segmentSpans, totalSeconds } from './time';

/** 一段要播的音樂：流程第 sec 秒開始，從音樂檔第 fileSec 秒播 durationSec 秒。 */
export interface PlaybackClip {
	audioId: string;
	sec: number;
	fileSec: number;
	durationSec: number;
}

/** 節拍器的一聲。八拍的第一拍 accent = true。 */
export interface MetronomeClick {
	sec: number;
	accent: boolean;
}

export interface PlaybackPlan {
	clips: PlaybackClip[];
	clicks: MetronomeClick[];
	/** 播到這一刻就停（流程秒數）。 */
	endSec: number;
}

/** 播完停下時播放頭可能差結尾一點點；差不到這麼多秒就算播完了。 */
const AT_END_SEC = 0.01;

/** 按播放時從哪一秒開始：從播放頭（sec）開始；已經播完就從頭。 */
export function playStartSec(flow: Flow, sec: number): number {
	return sec >= totalSeconds(flow) - AT_END_SEC ? 0 : sec;
}

/**
 * 段變短、刪段之後播放頭該在哪：夾回流程裡（不回到 0）。ended：夾到結尾（播完了），播放中就停下來。
 */
export function resumeSec(flow: Flow, sec: number): { sec: number; ended: boolean } {
	const total = totalSeconds(flow);
	const clamped = Math.min(Math.max(sec, 0), total);
	return { sec: clamped, ended: clamped >= total - AT_END_SEC };
}

/** 從流程第 fromSec 秒開始播。口號段沒有音樂也沒有節拍器，時間照走。 */
export function playbackPlan(flow: Flow, fromSec: number): PlaybackPlan {
	const clips: PlaybackClip[] = [];
	const clicks: MetronomeClick[] = [];
	let endSec = 0;
	for (const { segment, startSec, durationSec } of segmentSpans(flow)) {
		endSec = startSec + durationSec;
		if (segment.kind !== 'music' || endSec <= fromSec + EPS) continue;
		const skip = Math.max(0, fromSec - startSec);
		if (segment.audioId) {
			clips.push({
				audioId: segment.audioId,
				sec: startSec + skip,
				fileSec: segment.firstBeatSec + skip,
				durationSec: durationSec - skip
			});
		}
		for (const click of beatClicks(segment, Math.ceil(segment.halfBeats / 2))) {
			const sec = startSec + click.sec;
			if (sec >= fromSec - EPS) clicks.push({ sec, accent: click.accent });
		}
	}
	return { clips, clicks, endSec };
}

/** 段設定的「▶ 從第一拍聽 2 個八拍」：從第一拍播 16 拍的音樂加節拍器，時間從 0 算。 */
export function firstBeatPreview(flow: Flow, segmentId: string): PlaybackPlan {
	const segment = flow.segments.find((s) => s.id === segmentId);
	if (segment?.kind !== 'music') return { clips: [], clicks: [], endSec: 0 };
	const endSec = (16 * 60) / segment.bpm;
	const clips = segment.audioId
		? [{ audioId: segment.audioId, sec: 0, fileSec: segment.firstBeatSec, durationSec: endSec }]
		: [];
	return { clips, clicks: beatClicks(segment, 16), endSec };
}

/** 從段的第一拍起 beats 拍，時間從 0 算。 */
function beatClicks(segment: MusicSegment, beats: number): MetronomeClick[] {
	const spb = 60 / segment.bpm;
	return Array.from({ length: beats }, (_, b) => ({ sec: b * spb, accent: b % 8 === 0 }));
}
