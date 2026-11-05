// 段：音樂段和口號段，一串緊接著排。時間一律存整數：
// 音樂段長度存半拍數（halfBeats），口號段長度存 0.1 秒數（tenths）。
// 音樂檔本身（位元組）不在流程裡；流程只有 `audio` 清單，段用 audioId 指過去。

import { actionLabel } from './action-types';
import type { Flow } from './flow';
import { nextId } from './ids';
import { answered, blocked, needsConfirm, ok, readOr, type CommandResult, type ConfirmOption, type ReadResult } from './result';
import { atText, parseNumber, segmentSpans, units } from './time';

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
/** 一個音樂段最多幾個八拍、口號段最長幾秒：再長時間軸會畫到分頁卡住。 */
export const MAX_EIGHTS = 200;
export const MAX_CHANT_SEC = 300;
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

/**
 * 段的長度合不合上限：音樂段 1 到 MAX_EIGHTS 個八拍（最後一個八拍 1 到 8 拍），口號段 0.1 到 MAX_CHANT_SEC 秒。
 * 改段的指令和讀流程檔都照這一份擋（音樂段給 musicLength）。回第一個不合的原因，合就是 null。
 */
export function lengthProblem(length: MusicLength | Pick<ChantSegment, 'tenths'>): string | null {
	if ('tenths' in length) {
		const { tenths } = length;
		return tenths >= 1 && tenths <= MAX_CHANT_SEC * 10 ? null : OUT_OF_RANGE.seconds;
	}
	const { eights, lastBeats } = length;
	// 兩格各說各的：教練才知道是哪一格錯。
	if (!(eights >= 1 && eights <= MAX_EIGHTS)) return OUT_OF_RANGE.eights;
	if (!Number.isInteger(eights)) return '八拍數要是整數';
	if (!(Number.isInteger(lastBeats) && lastBeats >= 1 && lastBeats <= 8)) return OUT_OF_RANGE.lastBeats;
	return null;
}

/**
 * 流程檔裡一段的長度合不合上限（開檔時擋）：照 lengthProblem，但音樂段說整段的範圍
 * （改段時八拍數、最後一個八拍分兩格說；檔案裡只有一個長度）。合就是 null。
 */
export function fileLengthProblem(segment: Segment): string | null {
	if (segment.kind === 'chant') return lengthProblem(segment);
	return lengthProblem(musicLength(segment)) ? `音樂段要在 1 到 ${MAX_EIGHTS} 個八拍之間` : null;
}

export interface BeatTiming {
	bpm: number;
	/** 第一拍在音樂檔的第幾秒 */
	firstBeatSec: number;
}

/** 從第一拍算到音樂結束有幾個完整的拍；不到一拍是 null。 */
function musicLengthFromAudio(input: BeatTiming & { durationSec: number }): MusicLength | null {
	const beats = Math.floor(((input.durationSec - input.firstBeatSec) * input.bpm) / 60 + 1e-9);
	if (beats < 1) return null;
	const eights = Math.ceil(beats / 8);
	return { eights, lastBeats: beats - (eights - 1) * 8 };
}

/**
 * 音樂檔多長（秒），用 audioId 對應（音樂檔庫給的）。null 是壞了：這個瀏覽器解不開，不知道多長。
 * 沒有這個 id 是手上沒有那個檔（還沒載入、找不到），也不知道多長。
 */
export type AudioLengths = Readonly<Record<string, number | null>>;

/** 音樂檔壞了（解不開）：段設定的音樂檔那一行也寫這一句。 */
export const BROKEN_AUDIO = '音樂檔壞了，請重新選檔';

/** 第一拍要在音樂結束之前：知道音樂多長才擋（壞了、手上沒有就不擋）。 */
function pastEnd(firstBeatSec: number, durationSec: number | null | undefined): string | null {
	return durationSec != null && firstBeatSec >= durationSec
		? `第一拍要在音樂結束（${durationSec.toFixed(1)} 秒）之前`
		: null;
}

/** 「照音樂長度算」：音樂段的長度改成從第一拍到音樂結束的完整拍數。音樂多長從 lengths 拿（音樂檔庫給的）。 */
export function fitSegmentToAudio(
	flow: Flow,
	segmentId: string,
	lengths: AudioLengths,
	options: ConfirmOption = {}
): CommandResult {
	const segment = flow.segments.find((s) => s.id === segmentId);
	if (!segment) return blocked('找不到這一段');
	if (segment.kind !== 'music') return blocked('口號段沒有音樂');
	const durationSec = segment.audioId === null ? undefined : lengths[segment.audioId];
	if (durationSec === null) return blocked(BROKEN_AUDIO);
	if (durationSec === undefined) return blocked('先載入音樂檔');
	const late = pastEnd(segment.firstBeatSec, durationSec);
	if (late) return blocked(late);
	const length = musicLengthFromAudio({ ...segment, durationSec });
	if (!length) return blocked('第一拍之後剩下不到一拍');
	return updateSegment(flow, segmentId, length, options);
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

/** 段設定裡打數字的欄位。 */
export type SegmentNumberField = 'bpm' | 'firstBeatSec' | 'eights' | 'lastBeats' | 'seconds';

/** 每個數字欄位超出範圍時說的話（說能填的範圍）；看不懂也說這一句。 */
const OUT_OF_RANGE: Record<SegmentNumberField, string> = {
	bpm: `BPM 要在 ${MIN_BPM} 到 ${MAX_BPM} 之間`,
	firstBeatSec: '第一拍要是 0 秒以上',
	eights: `八拍數要在 1 到 ${MAX_EIGHTS} 之間`,
	lastBeats: '最後一個八拍的拍數要在 1 到 8 之間',
	seconds: `口號段長度要在 0.1 到 ${MAX_CHANT_SEC} 秒之間`
};

/**
 * 段設定的數字欄位打的字（全形當成半形）。空白、看不懂就擋下，說能填的範圍；
 * 超出範圍的照讀，交給 updateSegment 擋下（說同一句）。
 */
export function readSegmentNumber(field: SegmentNumberField, text: string): ReadResult<number> {
	const value = parseNumber(text);
	return readOr(Number.isNaN(value) ? null : value, OUT_OF_RANGE[field]);
}

/**
 * 改段。改 BPM 時動作和站位存的是拍，所以拍不變、秒數跟著變。
 * 段縮短、有動作或站位放不進段裡時回「要確認」並列出清單；帶 { confirmed: true } 再送一次才刪。
 * lengths：音樂多長（音樂檔庫給的），改第一拍時擋在音樂結束之後的。
 */
export function updateSegment(
	flow: Flow,
	segmentId: string,
	patch: SegmentPatch,
	options: ConfirmOption = {},
	lengths: AudioLengths = {}
): CommandResult {
	const index = flow.segments.findIndex((s) => s.id === segmentId);
	if (index === -1) return blocked('找不到這一段');
	const old = flow.segments[index];
	let next: Segment;
	if (old.kind === 'music') {
		const continued = continuedFrom(flow, index, patch);
		const bpm = patch.bpm ?? continued?.bpm ?? old.bpm;
		if (!(bpm >= MIN_BPM && bpm <= MAX_BPM)) return blocked(OUT_OF_RANGE.bpm);
		const audioId = patch.audioId === undefined ? old.audioId : patch.audioId;
		// 先看音樂結束：大到算不出來的第一拍也說要在音樂結束之前。
		const late = patch.firstBeatSec === undefined || audioId === null ? null : pastEnd(patch.firstBeatSec, lengths[audioId]);
		if (late) return blocked(late);
		// 第一拍最細 0.01 秒，也比較好讀。
		const firstBeatSec = Math.round((patch.firstBeatSec ?? (continued && continued.firstBeatSec + (continued.halfBeats * 30) / continued.bpm) ?? old.firstBeatSec) * 100) / 100;
		if (!(firstBeatSec >= 0 && Number.isFinite(firstBeatSec))) {
			return blocked(OUT_OF_RANGE.firstBeatSec);
		}
		// 只改八拍數：最後一個八拍回到滿的 8 拍，不留著上次算出的零頭。
		const full = patch.eights !== undefined && patch.lastBeats === undefined ? { lastBeats: 8 } : {};
		const length = { ...musicLength(old), ...full, ...pick(patch, 'eights', 'lastBeats') };
		const tooLong = lengthProblem(length);
		if (tooLong) return blocked(tooLong);
		const { eights, lastBeats } = length;
		const halfBeats = ((eights - 1) * 8 + lastBeats) * 2;
		if (audioId !== null && !flow.audio.some((a) => a.id === audioId)) {
			return blocked('找不到這個音樂檔');
		}
		next = { ...old, audioId, bpm, firstBeatSec, halfBeats };
	} else {
		const tenths = patch.seconds === undefined ? old.tenths : Math.round(patch.seconds * 10);
		const tooLong = lengthProblem({ tenths });
		if (tooLong) return blocked(tooLong);
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

/**
 * 變速切段：還沒有音樂的段選了跟前一個音樂段同一個檔，接著前一段：第一拍接在前一段後面（前一段的第一拍＋長度），
 * BPM 沿用前一段。回前一段；其他情況是 undefined（第一拍、BPM 不動）。
 */
function continuedFrom(flow: Flow, index: number, patch: SegmentPatch): MusicSegment | undefined {
	const old = flow.segments[index];
	if (old.kind !== 'music' || old.audioId !== null || !patch.audioId) return undefined;
	const prev = flow.segments.slice(0, index).findLast((s) => s.kind === 'music');
	return prev?.kind === 'music' && prev.audioId === patch.audioId ? prev : undefined;
}

/** 這一段跟另一段用同一個音樂檔、用到的時間重疊：那一截播放時會聽兩次。 */
export interface AudioOverlap {
	/** 另一段的名字，例：音樂 2 */
	label: string;
	/** 重疊幾秒 */
	sec: number;
}

/** 跟這一段用同一個音樂檔、用到的那一截（第一拍到段尾）重疊的其他段。 */
export function audioOverlaps(flow: Flow, segmentId: string): AudioOverlap[] {
	const used = (span: ReturnType<typeof segmentSpans>[number]) =>
		span.segment.kind === 'music' && span.segment.audioId !== null
			? { audioId: span.segment.audioId, from: span.segment.firstBeatSec, to: span.segment.firstBeatSec + span.durationSec }
			: null;
	const spans = segmentSpans(flow);
	const self = spans.find((s) => s.segment.id === segmentId);
	const mine = self && used(self);
	if (!mine) return [];
	return spans.flatMap((span) => {
		const other = span === self ? null : used(span);
		if (!other || other.audioId !== mine.audioId) return [];
		const sec = Math.min(mine.to, other.to) - Math.max(mine.from, other.from);
		return sec > 1e-9 ? [{ label: span.label, sec }] : [];
	});
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

/** 加一段（給 afterId 就插在那一段後面，沒給就加在最後），回傳新段的 id。 */
export function addSegment(flow: Flow, kind: SegmentKind, afterId?: string): CommandResult<{ id: string }> {
	const after = afterId === undefined ? flow.segments.length - 1 : flow.segments.findIndex((s) => s.id === afterId);
	if (afterId !== undefined && after === -1) return blocked('找不到這一段');
	const index = after + 1;
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
	return { kind: 'ok', flow: { ...flow, segments: flow.segments.toSpliced(index, 0, segment), formations }, id };
}
