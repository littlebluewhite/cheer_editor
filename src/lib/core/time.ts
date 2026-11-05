// 時間查詢：段的開始秒數和長度、全域秒數和「段 ＋ 段內整數時間」互換、目前位置文字。
// 段內時間一律是整數：音樂段是第幾個半拍，口號段是第幾個 0.1 秒。
// 播放頭用全域秒數（從流程開頭算）表示；要給教練看或存檔時才換成段內時間。

import type { Flow } from './flow';
import { readOr, type ReadResult } from './result';
import type { Segment } from './segment';

/** 流程裡的一個時間點：哪一段 ＋ 段內第幾個半拍（音樂段）或第幾個 0.1 秒（口號段）。 */
export interface TimePosition {
	segmentId: string;
	at: number;
}

export interface SegmentSpan {
	segment: Segment;
	/** 給教練看的段名：音樂 1、音樂 2、口號 1…（各自照順序編號） */
	label: string;
	startSec: number;
	durationSec: number;
}

/** 秒數的浮點數誤差容許值：差這麼一點點當成同一刻（例：算段內時間時不算掉到前一格）。 */
export const EPS = 1e-6;

/** 一拍是幾個半拍。 */
export const HALF_BEATS_PER_BEAT = 2;

/** 一個八拍是幾個半拍。 */
export const HALF_BEATS_PER_EIGHT = 16;

/** 段內時間一格是幾秒：音樂段一個半拍，口號段 0.1 秒。 */
export function unitSec(segment: Segment): number {
	return segment.kind === 'music' ? 30 / segment.bpm : 0.1;
}

/** 段內時間的格數：音樂段的半拍數，口號段的 0.1 秒數。 */
export function units(segment: Segment): number {
	return segment.kind === 'music' ? segment.halfBeats : segment.tenths;
}

export function segmentSpans(flow: Flow): SegmentSpan[] {
	const count = { music: 0, chant: 0 };
	let startSec = 0;
	return flow.segments.map((segment) => {
		count[segment.kind] += 1;
		const name = segment.kind === 'music' ? '音樂' : '口號';
		const durationSec =
			segment.kind === 'music' ? (segment.halfBeats * 30) / segment.bpm : segment.tenths / 10;
		const span = { segment, label: `${name} ${count[segment.kind]}`, startSec, durationSec };
		startSec += durationSec;
		return span;
	});
}

export function totalSeconds(flow: Flow): number {
	return segmentSpans(flow).reduce((sum, s) => sum + s.durationSec, 0);
}

export function toSeconds(flow: Flow, pos: TimePosition): number {
	const span = segmentSpans(flow).find((s) => s.segment.id === pos.segmentId);
	if (!span) return 0;
	return span.startSec + pos.at * unitSec(span.segment);
}

function spanAt(flow: Flow, sec: number): { span: SegmentSpan; at: number } | null {
	const spans = segmentSpans(flow);
	for (const [i, span] of spans.entries()) {
		const last = i === spans.length - 1;
		if (sec < span.startSec + span.durationSec - EPS || last) {
			const raw = Math.floor((sec - span.startSec) / unitSec(span.segment) + EPS);
			const at = Math.min(Math.max(raw, 0), units(span.segment) - 1);
			return { span, at };
		}
	}
	return null;
}

/**
 * 這一刻在哪一段的第幾個半拍／0.1 秒（取這一刻所在的那一格，不四捨五入）。
 * 剛好在交界算後面那一段；超出流程頭尾就夾回來。沒有段時是 null。
 */
export function toPosition(flow: Flow, sec: number): TimePosition | null {
	const found = spanAt(flow, sec);
	return found && { segmentId: found.span.segment.id, at: found.at };
}

/**
 * 全域秒數最近的那一格（音樂段半拍、口號段 0.1 秒），給拖東西時吸附用。流程開頭之前、結尾之後不夾回來，
 * 照樣往外數成超出的格子，交給指令擋下。要先有段。
 */
export function nearestPosition(flow: Flow, sec: number): TimePosition {
	const p = toPosition(flow, sec)!;
	const lo = toSeconds(flow, p);
	const hi = toSeconds(flow, { ...p, at: p.at + 1 });
	if (sec < lo || sec >= hi) return { ...p, at: p.at + Math.round((sec - lo) / (hi - lo)) };
	return sec - lo > (hi - lo) / 2 ? toPosition(flow, hi)! : p;
}

/**
 * 播放頭可以停的點（全域秒數，照時間排）：音樂段每 musicStep 個半拍、口號段每 chantStep 個 0.1 秒，
 * 加上每段的開頭和流程結尾。
 */
function stops(flow: Flow, musicStep: number, chantStep: number): number[] {
	const out: number[] = [];
	for (const { segment, startSec, durationSec } of segmentSpans(flow)) {
		const step = segment.kind === 'music' ? musicStep : chantStep;
		for (let u = 0; u < units(segment); u += step) out.push(startSec + u * unitSec(segment));
		out.push(startSec + durationSec);
	}
	return out;
}

/** 在八拍尺上點、拖播放頭：音樂段吸到最近的整拍（half：半拍），口號段吸到 0.1 秒。沒有段時照原樣。 */
export function snapToBeat(flow: Flow, sec: number, half = false): number {
	const points = stops(flow, half ? 1 : HALF_BEATS_PER_BEAT, 1);
	if (!points.length) return sec;
	return points.reduce((best, p) => (Math.abs(p - sec) < Math.abs(best - sec) ? p : best));
}

/**
 * 方向鍵移播放頭：往 dir（1 往後、-1 往前）移到下一個停點。音樂段一拍（big：一個八拍），
 * 口號段 1 秒（big：5 秒）；跨段時先停在段的開頭。到頭尾就停住。沒有段時照原樣。
 */
export function stepPlayhead(flow: Flow, sec: number, dir: 1 | -1, big: boolean): number {
	const points = big ? stops(flow, HALF_BEATS_PER_EIGHT, 50) : stops(flow, HALF_BEATS_PER_BEAT, 10);
	if (!points.length) return sec;
	if (dir > 0) return points.find((p) => p > sec + EPS) ?? points.at(-1)!;
	return points.findLast((p) => p < sec - EPS) ?? 0;
}

/** 八拍尺上的一個刻度（全域秒數）。大刻度有字；start：段的第一個刻度。 */
export interface RulerMark {
	sec: number;
	major: boolean;
	label?: string;
	start?: true;
}

/** 八拍尺：音樂段每拍一格，八拍的第一拍是大刻度並寫第幾個八拍；口號段每秒一格，每 5 秒寫「n 秒」。 */
export function rulerMarks(flow: Flow): RulerMark[] {
	const marks: RulerMark[] = [];
	for (const { segment, startSec, durationSec } of segmentSpans(flow)) {
		if (segment.kind === 'music') {
			const spb = 60 / segment.bpm;
			for (let b = 0; b < Math.ceil(segment.halfBeats / 2); b++) {
				const sec = startSec + b * spb;
				const label = `${b / 8 + 1}`;
				marks.push(b % 8 !== 0 ? { sec, major: false } : b === 0 ? { sec, major: true, label, start: true } : { sec, major: true, label });
			}
		} else {
			for (let k = 0; k < durationSec - EPS; k++) {
				const sec = startSec + k;
				const label = `${k} 秒`;
				marks.push(k % 5 !== 0 ? { sec, major: false } : k === 0 ? { sec, major: true, label, start: true } : { sec, major: true, label });
			}
		}
	}
	return marks;
}

/** 刻度字大約多寬（px，11px 粗體）：數字 7、空白 3、中文 11，加上離刻度線 4、跟下一個字留 4。 */
function labelWidth(label: string): number {
	return 8 + [...label].reduce((w, c) => w + (/\d/.test(c) ? 7 : c === ' ' ? 3 : 11), 0);
}

/**
 * 1 秒 pxPerSec 時，拿掉會疊在一起的刻度字（刻度照畫）：號碼太密就跳著寫。
 * 每段開頭的字先放（段交界太近時，拿掉的是前一段不滿八拍的號碼），其他的照時間放得下才寫。
 */
export function spacedLabels(marks: RulerMark[], pxPerSec: number): RulerMark[] {
	const taken: [number, number][] = [];
	const shown = new Set<RulerMark>();
	const labeled = marks.filter((m) => m.label);
	for (const m of [...labeled.filter((m) => m.start), ...labeled.filter((m) => !m.start)]) {
		const left = m.sec * pxPerSec;
		const right = left + labelWidth(m.label!);
		if (taken.every(([l, r]) => right <= l || left >= r)) {
			taken.push([left, right]);
			shown.add(m);
		}
	}
	return marks.map((m) => (m.label && !shown.has(m) ? { sec: m.sec, major: m.major } : m));
}

/** 上方列的目前位置，例：「音樂 1 3-5&」、「口號 1 12.3 秒」。沒有段時是空字串。 */
export function positionText(flow: Flow, sec: number): string {
	const found = spanAt(flow, sec);
	if (!found) return '';
	const { span, at } = found;
	const unit = span.segment.kind === 'chant' ? ' 秒' : '';
	return `${span.label} ${atText(span.segment, at)}${unit}`;
}

/** 段內時間點給教練看的樣子：音樂段「3-5&」（第幾個八拍-第幾拍，半拍加 &），口號段秒數「12.3」。 */
export function atText(segment: Segment, at: number): string {
	if (segment.kind === 'chant') return (at / 10).toFixed(1);
	const beat = Math.floor(at / 2);
	const and = at % 2 === 1 ? '&' : '';
	return `${Math.floor(beat / 8) + 1}-${(beat % 8) + 1}${and}`;
}

/** 動作的開始：atText 的反向，教練打的時間點 → 段內整數時間。不檢查有沒有超出段（指令會擋）。 */
export function readStart(segment: Segment, text: string): ReadResult<number> {
	const hint = segment.kind === 'music' ? '例：3-5&' : '請打秒數';
	return readOr(parseAt(segment, text), `開始看不懂，${hint}`);
}

/** atText 的反向：教練打的時間點 → 段內整數時間；看不懂是 null。不檢查有沒有超出段（指令會擋）。 */
function parseAt(segment: Segment, text: string): number | null {
	if (segment.kind === 'chant') return parseScaled(text, 10);
	const m = /^(\d+)-([1-8])(&?)$/.exec(halfWidth(text).trim());
	if (!m || Number(m[1]) < 1) return null;
	return ((Number(m[1]) - 1) * 8 + Number(m[2]) - 1) * 2 + (m[3] ? 1 : 0);
}

/**
 * 出發和到達這類時間點的文字：在 homeSegmentId 那一段裡只寫段內時間（「2-5」、口號段「12.3」），
 * 在別的段前面加段名，跟上方列一樣（「口號 1 12.3」）。
 */
export function timeText(flow: Flow, homeSegmentId: string, p: TimePosition): string {
	const span = segmentSpans(flow).find((s) => s.segment.id === p.segmentId);
	if (!span) return '';
	const at = atText(span.segment, p.at);
	return p.segmentId === homeSegmentId ? at : `${span.label} ${at}`;
}

/** timeText，口號段後面再加「 秒」（例：「2-5」、「12.3 秒」、「口號 1 12.3 秒」）。 */
export function timeTextWithUnit(flow: Flow, homeSegmentId: string, p: TimePosition): string {
	const kind = flow.segments.find((s) => s.id === p.segmentId)?.kind;
	return timeText(flow, homeSegmentId, p) + (kind === 'chant' ? ' 秒' : '');
}

/** 用 timeText 寫法打時間的欄位：走位的出發、到達，站位小編輯的站位時間。 */
export type TimeField = '出發' | '到達' | '站位時間';

/**
 * 出發、到達、站位時間：timeText 的反向。只有段內時間就是 homeSegmentId 那一段；
 * 前面有段名（可以帶上方列的「秒」）就是那一段。寫法不對、沒有這一段都算看不懂，原因寫出是哪一格（field）。
 * 不檢查有沒有超出段（指令會擋）。
 */
export function readTime(flow: Flow, homeSegmentId: string, text: string, field: TimeField): ReadResult<TimePosition> {
	return readOr(parseTime(flow, homeSegmentId, text), `${field}看不懂，例：2-5（別的段前面加段名，例：口號 1 12.3）`);
}

/** readTime 讀的那一步：看不懂或沒有這一段是 null。 */
function parseTime(flow: Flow, homeSegmentId: string, text: string): TimePosition | null {
	const m = /^(?:(音樂|口號)\s*(\d+)\s+)?(.+?)\s*秒?$/.exec(halfWidth(text).trim());
	if (!m) return null;
	const spans = segmentSpans(flow);
	const span = m[1]
		? spans.find((s) => s.label === `${m[1]} ${Number(m[2])}`)
		: spans.find((s) => s.segment.id === homeSegmentId);
	if (!span) return null;
	const at = parseAt(span.segment, m[3]);
	return at === null ? null : { segmentId: span.segment.id, at };
}

/** 長度給教練看的樣子：音樂段幾拍（可以 .5），口號段幾秒（到 0.1）。 */
export function lengthText(segment: Segment, length: number): string {
	return segment.kind === 'music' ? String(length / 2) : (length / 10).toFixed(1);
}

/** 動作的長度：lengthText 的反向，拍數或秒數 → 半拍數或 0.1 秒數（取最近的）。負的照讀，交給指令擋下、說範圍。 */
export function readLength(segment: Segment, text: string): ReadResult<number> {
	return readOr(parseScaled(text, segment.kind === 'music' ? 2 : 10), '長度看不懂');
}

/** 數字乘上 scale 取最近的整數；空白、看不懂是 null。負的照算，交給指令擋下、說範圍。 */
function parseScaled(text: string, scale: number): number | null {
	const v = parseNumber(text);
	return Number.isFinite(v) ? Math.round(v * scale) : null;
}

/** 欄位裡打的數字：全形當成半形（中文輸入法不用切換）。空白、看不懂是 NaN。 */
export function parseNumber(text: string): number {
	const t = halfWidth(text).trim();
	return t ? Number(t) : Number.NaN;
}

/** 全形的數字和符號（０–９、．、－、＋、＆）換成半形；全形空白換成半形空白。 */
function halfWidth(text: string): string {
	return text
		.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
		.replace(/\u3000/g, ' ');
}
