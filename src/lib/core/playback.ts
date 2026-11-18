// 播放計畫：從流程的某一刻開始，哪些音樂檔在什麼時候從哪裡播、節拍器在哪些時間響。
// 時間都是流程秒數；音訊薄層照這份計畫排進 Web Audio，自己不算拍子。

import type { Action } from './action-types';
import type { Flow } from './flow';
import type { MusicSegment } from './segment';
import {
	EPS,
	segmentSpans,
	snapToBeat,
	toSeconds,
	totalSeconds,
	units,
	unitSec,
	type TimePosition
} from './time';

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

/**
 * 從流程第 fromSec 秒開始播，播到 untilSec（沒給是流程結尾；重複播一段時是那段的結尾）。
 * 口號段沒有音樂也沒有節拍器，時間照走。
 */
export function playbackPlan(flow: Flow, fromSec: number, untilSec = Infinity): PlaybackPlan {
	const clips: PlaybackClip[] = [];
	const clicks: MetronomeClick[] = [];
	const endSec = Math.min(totalSeconds(flow), untilSec);
	for (const { segment, startSec, durationSec } of segmentSpans(flow)) {
		const segEnd = Math.min(startSec + durationSec, endSec);
		if (segment.kind !== 'music' || segEnd <= Math.max(fromSec, startSec) + EPS) continue;
		const skip = Math.max(0, fromSec - startSec);
		if (segment.audioId) {
			clips.push({
				audioId: segment.audioId,
				sec: startSec + skip,
				fileSec: segment.firstBeatSec + skip,
				durationSec: segEnd - startSec - skip
			});
		}
		for (const click of beatClicks(segment, Math.ceil(segment.halfBeats / 2))) {
			const sec = startSec + click.sec;
			if (sec >= fromSec - EPS && sec < segEnd - EPS) clicks.push({ sec, accent: click.accent });
		}
	}
	return { clips, clicks, endSec };
}

/**
 * 重複範圍：A 到 B，記成哪一段的第幾格（不是秒數），改 BPM、插入八拍時才跟著音樂走。
 * 只放了 A 時 b 是 null。
 */
export interface RepeatRange {
	a: TimePosition;
	b: TimePosition | null;
}

/**
 * 重複範圍的一頭：sec 最近的整拍（口號段 0.1 秒）在哪一段的第幾格。要先有段。
 * 段的交界算後面那一段；流程結尾算最後一段的最後一格後面。格數四捨五入，浮點誤差不會掉到前一格。
 */
export function rangeEnd(flow: Flow, sec: number): TimePosition {
	const snapped = snapToBeat(flow, sec);
	const spans = segmentSpans(flow);
	const span = spans.find((s) => snapped < s.startSec + s.durationSec - EPS) ?? spans.at(-1)!;
	const at = Math.round((snapped - span.startSec) / unitSec(span.segment));
	return { segmentId: span.segment.id, at: Math.min(Math.max(at, 0), units(span.segment)) };
}

/** 動作拉成的重複範圍：兩頭都在動作自己那一段（B 是動作的結尾，不是下一段的開頭）。 */
export function actionRange(action: Action): RepeatRange {
	const { segmentId, start, length } = action;
	return { a: { segmentId, at: start }, b: { segmentId, at: start + length } };
}

/**
 * 重複範圍現在在哪（全域秒數）。A、B 所在的段不見了、段縮短到 A 或 B 後面，或段換了順序、B 跑到 A 前面，就不能用了：null。
 */
export function rangeSeconds(flow: Flow, range: RepeatRange): { a: number; b: number | null } | null {
	// 段縮短、格子落到段尾後面也不能用
	const sec = (p: TimePosition) => {
		const segment = flow.segments.find((s) => s.id === p.segmentId);
		return segment && p.at <= units(segment) ? toSeconds(flow, p) : null;
	};
	const a = sec(range.a);
	if (a === null) return null;
	if (!range.b) return { a, b: null };
	const b = sec(range.b);
	return b === null || b <= a + EPS ? null : { a, b };
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
