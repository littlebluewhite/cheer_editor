// 段：音樂段和口號段，一串緊接著排。時間一律存整數：
// 音樂段長度存半拍數（halfBeats），口號段長度存 0.1 秒數（tenths）。
// 音樂檔本身（位元組）不在流程裡；流程只有 `audio` 清單，段用 audioId 指過去。

import { actionLabel } from './action-types';
import type { Flow } from './flow';
import { nextId } from './ids';
import { answered, blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { atText, segmentSpans, units } from './time';

export interface MusicSegment {
	id: string;
	kind: 'music';
	/** 指到 flow.audio 裡的一筆；還沒載入音樂檔時是 null。兩個音樂段可以指同一個檔（變速切段）。 */
	audioId: string | null;
	bpm: number;
	/** 第一拍在音樂檔的第幾秒。第一拍之前的音樂不算在流程裡。 */
	firstBeatSec: number;
	halfBeats: number;
}

export interface ChantSegment {
	id: string;
	kind: 'chant';
	tenths: number;
}

export type Segment = MusicSegment | ChantSegment;
export type SegmentKind = Segment['kind'];

/** 流程用到的一個音樂檔。位元組另外放，存檔時寫到 zip 裡的 `file`。 */
export interface AudioRef {
	id: string;
	/** zip 裡的路徑，例：audio/a1.mp3 */
	file: string;
	/** 教練選的原始檔名，給畫面顯示。 */
	name: string;
}

export const MIN_BPM = 60;
export const MAX_BPM = 170;
export const DEFAULT_BPM = 150;
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav'] as const;

/** 音樂段長度給教練看的樣子：幾個八拍、最後一個八拍幾拍（1–8）。 */
export interface MusicLength {
	eights: number;
	lastBeats: number;
}

export function musicLength(segment: MusicSegment): MusicLength {
	const beats = Math.ceil(segment.halfBeats / 2);
	const eights = Math.max(1, Math.ceil(beats / 8));
	return { eights, lastBeats: beats - (eights - 1) * 8 };
}

export interface BeatTiming {
	bpm: number;
	/** 第一拍在音樂檔的第幾秒 */
	firstBeatSec: number;
}

/** 「照音樂長度算」：從第一拍算到音樂結束有幾個完整的拍（至少 1 拍）。結果可以直接給 updateSegment。 */
export function musicLengthFromAudio(input: BeatTiming & { durationSec: number }): MusicLength {
	const beats = Math.max(
		1,
		Math.floor(((input.durationSec - input.firstBeatSec) * input.bpm) / 60 + 1e-9)
	);
	const eights = Math.ceil(beats / 8);
	return { eights, lastBeats: beats - (eights - 1) * 8 };
}

/** 波形上的一條拍子線。秒數是音樂檔裡的秒數。 */
export interface BeatLine {
	sec: number;
	/** first = 第一拍；eight = 之後每個八拍的第一拍；beat = 其他拍 */
	kind: 'first' | 'eight' | 'beat';
}

/** 段設定的波形上，照 BPM 從第一拍起畫的拍子線，只畫到 windowSec（不含）。 */
export function beatLines(input: BeatTiming & { windowSec: number }): BeatLine[] {
	const spb = 60 / input.bpm;
	const lines: BeatLine[] = [];
	for (let b = 0; ; b++) {
		const sec = input.firstBeatSec + b * spb;
		if (sec >= input.windowSec - 1e-9) return lines;
		lines.push({ sec, kind: b === 0 ? 'first' : b % 8 === 0 ? 'eight' : 'beat' });
	}
}

/** 改段時可以帶的欄位；跟段的種類不合的欄位不理。 */
export interface SegmentPatch {
	/** 音樂段 */
	bpm?: number;
	/** 最細 0.01 秒 */
	firstBeatSec?: number;
	eights?: number;
	lastBeats?: number;
	/** 改用流程裡已經有的音樂檔（例：變速切段，兩段用同一個檔）；null = 拿掉音樂 */
	audioId?: string | null;
	/** 口號段，最細 0.1 秒 */
	seconds?: number;
}

/**
 * 改段。改 BPM 時動作和站位存的是拍，所以拍不變、秒數跟著變。
 * 段縮短、有動作或站位放不進段裡時回「要確認」並列出清單；帶 { confirmed: true } 再送一次才刪。
 */
export function updateSegment(
	flow: Flow,
	segmentId: string,
	patch: SegmentPatch,
	options: ConfirmOption = {}
): CommandResult {
	const index = flow.segments.findIndex((s) => s.id === segmentId);
	if (index === -1) return blocked('找不到這一段');
	const old = flow.segments[index];
	let next: Segment;
	if (old.kind === 'music') {
		const bpm = patch.bpm ?? old.bpm;
		if (!(bpm >= MIN_BPM && bpm <= MAX_BPM)) return blocked(`BPM 要在 ${MIN_BPM}–${MAX_BPM} 之間`);
		// 第一拍最細 0.01 秒，也比較好讀。
		const firstBeatSec =
			patch.firstBeatSec === undefined ? old.firstBeatSec : Math.round(patch.firstBeatSec * 100) / 100;
		if (!(firstBeatSec >= 0 && Number.isFinite(firstBeatSec))) {
			return blocked('第一拍要是 0 秒以上');
		}
		const length = { ...musicLength(old), ...pick(patch, 'eights', 'lastBeats') };
		const { eights, lastBeats } = length;
		if (
			!Number.isInteger(eights) ||
			eights < 1 ||
			!Number.isInteger(lastBeats) ||
			lastBeats < 1 ||
			lastBeats > 8
		) {
			return blocked('八拍數至少 1；最後一個八拍要有 1–8 拍');
		}
		const halfBeats = ((eights - 1) * 8 + lastBeats) * 2;
		const audioId = patch.audioId === undefined ? old.audioId : patch.audioId;
		if (audioId !== null && !flow.audio.some((a) => a.id === audioId)) {
			return blocked('找不到這個音樂檔');
		}
		next = { ...old, audioId, bpm, firstBeatSec, halfBeats };
	} else {
		const tenths = patch.seconds === undefined ? old.tenths : Math.round(patch.seconds * 10);
		if (!(tenths >= 1)) return blocked('口號段至少 0.1 秒');
		next = { ...old, tenths };
	}
	// 段縮短：動作要整個放得進段裡；站位的時間點要在段裡（段尾那一刻已經是下一段）。
	const end = units(next);
	const actions = flow.actions.filter((a) => a.segmentId !== segmentId || a.start + a.length <= end);
	const formations = flow.formations.filter((f) => f.segmentId !== segmentId || f.at < end);
	const droppedActions = flow.actions.filter((a) => !actions.includes(a));
	const droppedFormations = flow.formations.filter((f) => !formations.includes(f));
	if (!answered(options) && (droppedActions.length || droppedFormations.length)) {
		const label = segmentSpans(flow)[index].label;
		const records = droppedActions.reduce((n, a) => n + (a.successRate?.records.length ?? 0), 0);
		const cleared = records ? `，會一起清掉 ${records} 次紀錄` : '';
		return needsConfirm(`${label} 縮短後，下面這些放不進段裡，確定就刪掉${cleared}`, [
			...droppedActions.map((a) => `動作「${actionLabel(a)}」（${atText(old, a.start)} 起）`),
			...droppedFormations.map(
				(f) => `站位 ${flow.formations.indexOf(f) + 1}（${atText(old, f.at)}）`
			)
		]);
	}
	return ok(
		withoutUnusedAudio({ ...flow, segments: flow.segments.with(index, next), actions, formations })
	);
}

/**
 * 音樂段載入一個新的音樂檔：流程記一筆音樂檔，這一段指過去。
 * 位元組由呼叫端自己留著，用這一段新的 audioId 對應。
 * heldIds：呼叫端還留著位元組的 id（流程不用了、復原還會用到），不拿來給新的檔。
 */
export function loadSegmentAudio(
	flow: Flow,
	segmentId: string,
	fileName: string,
	heldIds: readonly string[] = []
): CommandResult<{ audioId: string }> {
	const segment = flow.segments.find((s) => s.id === segmentId);
	if (!segment) return blocked('找不到這一段');
	if (segment.kind !== 'music') return blocked('口號段沒有音樂');
	const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
	if (!(AUDIO_EXTENSIONS as readonly string[]).includes(ext) || !fileName.includes('.')) {
		return blocked(`只能載入 ${AUDIO_EXTENSIONS.join('、')}`);
	}
	const id = nextId('a', [...flow.audio.map((a) => a.id), ...heldIds]);
	const audio = [...flow.audio, { id, file: `audio/${id}.${ext}`, name: fileName }];
	const r = updateSegment({ ...flow, audio }, segmentId, { audioId: id });
	return r.kind === 'ok' ? { ...r, audioId: id } : r;
}

/** 存檔只帶用到的音樂，所以沒有段在用的音樂檔直接拿掉。 */
function withoutUnusedAudio(flow: Flow): Flow {
	const used = new Set(flow.segments.map((s) => (s.kind === 'music' ? s.audioId : null)));
	return { ...flow, audio: flow.audio.filter((a) => used.has(a.id)) };
}

/** 只留下有給值的欄位，免得 undefined 蓋掉原本的值。 */
function pick<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Partial<Pick<T, K>> {
	const out: Partial<Pick<T, K>> = {};
	for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
	return out;
}

/** 在最後加一段，回傳新段的 id。 */
export function addSegment(flow: Flow, kind: SegmentKind): CommandResult<{ id: string }> {
	const id = nextId('s', flow.segments.map((s) => s.id));
	const segment: Segment =
		kind === 'music'
			? { id, kind, audioId: null, bpm: DEFAULT_BPM, firstBeatSec: 0, halfBeats: 8 * 8 * 2 }
			: { id, kind, tenths: 100 };
	// 開頭站位在第一段的時間 0：加第一段時把它指過去。
	const formations =
		flow.segments.length === 0
			? flow.formations.with(0, { ...flow.formations[0], segmentId: id, at: 0 })
			: flow.formations;
	return { kind: 'ok', flow: { ...flow, segments: [...flow.segments, segment], formations }, id };
}
