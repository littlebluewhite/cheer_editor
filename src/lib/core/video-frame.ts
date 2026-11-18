// 流程影片的一格：影片第幾秒要寫什麼。只算內容，不畫圖；畫面和聲音另外做。
// 站位、拍、八拍表的字都用編輯器播放用的同一批核心函式，影片才不會跟編輯器不一樣。

import { actionLabel, categoryLabel } from './action-types';
import { layersAt } from './actions';
import { eightCountRows, teamWho, type EightCountCueLine, type EightCountRow } from './eight-count';
import type { Flow } from './flow';
import { positionsAt, type Position } from './formation';
import { memberMarkers } from './members';
import { playbackPlan, type PlaybackClip } from './playback';
import {
	EPS,
	HALF_BEATS_PER_BEAT,
	HALF_BEATS_PER_EIGHT,
	clockText,
	segmentSpans,
	type SegmentSpan,
	toPosition,
	toSeconds,
	totalSeconds,
	units
} from './time';

/** 開頭停幾秒（沒聲音）、結尾停幾秒、每秒幾格。 */
export const VIDEO_INTRO_SEC = 2;
export const VIDEO_OUTRO_SEC = 1;
export const VIDEO_FPS = 30;

/** 影片多長：開頭 ＋ 流程 ＋ 結尾。 */
export function videoDurationSec(flow: Flow): number {
	return VIDEO_INTRO_SEC + totalSeconds(flow) + VIDEO_OUTRO_SEC;
}

/** 影片下面那一列八拍表要寫的字。 */
export interface VideoRow {
	/** 站位的說明：「站位 2 金字塔・2-5」。 */
	formations: string[];
	/** title 是「1-1　技巧·Lib」。 */
	actions: { title: string; who: string; note: string }[];
	/** 前面開始、還在做的動作。 */
	continuing: { name: string; who: string }[];
	/** 拍點和環節。 */
	cues: EightCountCueLine[];
	/** 四樣都沒有：畫「這一列沒有新的動作、站位」。 */
	empty: boolean;
}

/** 一格要畫什麼。不叫 VideoFrame，那是瀏覽器 WebCodecs 的名字。 */
export interface VideoFrameData {
	part: 'intro' | 'play' | 'outro';
	/** 這一格在流程第幾秒（開頭是 0，結尾是流程長度）。 */
	flowSec: number;
	/** 流程名。 */
	title: string;
	/** 開頭「開場站位」；音樂段「音樂 1・第 6 個八拍」；口號段「口號 1・12.3 秒」。 */
	where: string;
	clock: string;
	/** 音樂段才有。count 是這個八拍有幾拍（最後不滿的比 8 少），lit 是現在第幾拍（開頭是 null）。 */
	beats: { count: number; lit: number | null } | null;
	positions: Record<string, Position>;
	/** 這一刻在空中的人第幾層（2、3；地上的不列），跟場上一樣照層畫。 */
	levels: Record<string, number>;
	markers: Record<string, string>;
	row: VideoRow;
}

const EMPTY_ROW: VideoRow = { formations: [], actions: [], continuing: [], cues: [], empty: true };

function videoRow(flow: Flow, spans: SegmentSpan[], row: EightCountRow): VideoRow {
	const span = spans.find((s) => s.label === row.segmentLabel)!;
	// 合起來的列延續的動作都一樣，用第一個八拍算；口號段整段一列，沒有前面開始的動作
	const from = row.eight === null ? 0 : (row.eight - 1) * HALF_BEATS_PER_EIGHT;
	const continuing = flow.actions
		.filter((a) => a.segmentId === span.segment.id && a.start < from && a.start + a.length > from)
		.toSorted((a, b) => a.start - b.start)
		.map((a) => ({ name: a.name || categoryLabel(a.category), who: teamWho(flow, a) }));
	const actions = row.actions.map((a) => ({ title: `${a.at}　${actionLabel(a)}`, who: a.who, note: a.note }));
	const formations = row.formations.map((f) => f.caption);
	return {
		formations,
		actions,
		continuing,
		cues: row.cues,
		empty: !formations.length && !actions.length && !continuing.length && !row.cues.length
	};
}

/** 列的名字：「音樂 1 第 6 個八拍」，合起來的列「音樂 1 第 6–8 個八拍」，口號段只有段名。 */
function rowLabel(row: EightCountRow): string {
	if (row.eight === null) return row.segmentLabel;
	const eights = row.lastEight !== null && row.lastEight !== row.eight ? `${row.eight}–${row.lastEight}` : `${row.eight}`;
	return `${row.segmentLabel} 第 ${eights} 個八拍`;
}

/** 每個不同的列一份（合起來的八拍一份）。 */
export function videoRows(flow: Flow): { label: string; row: VideoRow }[] {
	const spans = segmentSpans(flow);
	return eightCountRows(flow, null).map((row) => ({ label: rowLabel(row), row: videoRow(flow, spans, row) }));
}

/**
 * 一支影片用的「影片第幾秒 → 一格」。整支用同一份流程，八拍表、列的字、隊員標記先算好一次，
 * 每一格只算會動的（八拍表每格重算的話，人多、動作多的流程每格要多花好幾毫秒）。
 * 影片第 t 秒 = 流程第 t − 2 秒（夾在 0 到結尾）。結尾跟流程最後一刻一樣：停在最後一拍，不畫不存在的拍或八拍。
 */
export function videoFrames(flow: Flow): (videoSec: number) => VideoFrameData {
	const total = totalSeconds(flow);
	const spans = segmentSpans(flow);
	const rows = eightCountRows(flow, null).map((r) => ({ startSec: r.startSec, row: videoRow(flow, spans, r) }));
	const markers = memberMarkers(flow);
	return (videoSec) => {
		const raw = videoSec - VIDEO_INTRO_SEC;
		const part: VideoFrameData['part'] = raw < 0 ? 'intro' : raw >= total - EPS ? 'outro' : 'play';
		const flowSec = Math.min(Math.max(raw, 0), total);
		// 拍和列都看這一刻所在的那一格；結尾 toPosition 會夾回最後一格
		const pos = toPosition(flow, flowSec);
		const span = pos && spans.find((s) => s.segment.id === pos.segmentId)!;
		const lookSec = pos ? toSeconds(flow, pos) : 0;
		const rowNow = rows.findLast((r) => r.startSec <= lookSec + EPS);
		const base = {
			part,
			flowSec,
			title: flow.name,
			clock: clockText(flowSec),
			positions: positionsAt(flow, flowSec),
			levels: layersAt(flow, flowSec),
			markers,
			row: rowNow ? rowNow.row : EMPTY_ROW
		};
		if (part === 'intro') return { ...base, where: '開場站位', beats: null };
		if (!pos || !span) return { ...base, where: '', beats: null };
		if (span.segment.kind === 'chant') {
			return { ...base, where: `${span.label}・${(flowSec - span.startSec).toFixed(1)} 秒`, beats: null };
		}
		const eightIndex = Math.floor(pos.at / HALF_BEATS_PER_EIGHT);
		const halfBeatsInEight = Math.min(HALF_BEATS_PER_EIGHT, units(span.segment) - eightIndex * HALF_BEATS_PER_EIGHT);
		return {
			...base,
			where: `${span.label}・第 ${eightIndex + 1} 個八拍`,
			beats: {
				count: Math.ceil(halfBeatsInEight / HALF_BEATS_PER_BEAT),
				lit: Math.floor((pos.at % HALF_BEATS_PER_EIGHT) / HALF_BEATS_PER_BEAT) + 1
			}
		};
	};
}

/** 只要一格時用（每次都重算八拍表）；一支影片一格一格畫的用 videoFrames。 */
export function videoFrame(flow: Flow, videoSec: number): VideoFrameData {
	return videoFrames(flow)(videoSec);
}

/** 影片要混的音樂：跟編輯器從頭播一樣，開始秒數都加上開頭停的那 2 秒。 */
export function videoAudioClips(flow: Flow): PlaybackClip[] {
	return playbackPlan(flow, 0).clips.map((c) => ({ ...c, sec: c.sec + VIDEO_INTRO_SEC }));
}
