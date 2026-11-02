// 時間查詢：段的開始秒數和長度、全域秒數和「段 ＋ 段內整數時間」互換、目前位置文字。
// 段內時間一律是整數：音樂段是第幾個半拍，口號段是第幾個 0.1 秒。
// 播放頭用全域秒數（從流程開頭算）表示；要給教練看或存檔時才換成段內時間。

import type { Flow } from './flow';
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

/** 浮點數誤差的容許值：算段內時間時，差這麼一點點不算掉到前一格。 */
const EPS = 1e-6;

/** 段內時間一格是幾秒：音樂段一個半拍，口號段 0.1 秒。 */
function unitSec(segment: Segment): number {
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

/** 八拍尺上的一個刻度（全域秒數）。大刻度有字。 */
export interface RulerMark {
	sec: number;
	major: boolean;
	label?: string;
}

/** 八拍尺：音樂段每拍一格，八拍的第一拍是大刻度並寫第幾個八拍；口號段每秒一格，每 5 秒寫秒數。 */
export function rulerMarks(flow: Flow): RulerMark[] {
	const marks: RulerMark[] = [];
	for (const { segment, startSec, durationSec } of segmentSpans(flow)) {
		if (segment.kind === 'music') {
			const spb = 60 / segment.bpm;
			for (let b = 0; b < Math.ceil(segment.halfBeats / 2); b++) {
				const sec = startSec + b * spb;
				marks.push(b % 8 === 0 ? { sec, major: true, label: `${b / 8 + 1}` } : { sec, major: false });
			}
		} else {
			for (let k = 0; k < durationSec - EPS; k++) {
				const sec = startSec + k;
				marks.push(k % 5 === 0 ? { sec, major: true, label: `${k}s` } : { sec, major: false });
			}
		}
	}
	return marks;
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

/** atText 的反向：教練打的時間點 → 段內整數時間；看不懂是 null。不檢查有沒有超出段（指令會擋）。 */
export function parseAt(segment: Segment, text: string): number | null {
	if (segment.kind === 'chant') return parseScaled(text, 10);
	const m = /^(\d+)-([1-8])(&?)$/.exec(text.trim());
	if (!m || Number(m[1]) < 1) return null;
	return ((Number(m[1]) - 1) * 8 + Number(m[2]) - 1) * 2 + (m[3] ? 1 : 0);
}

/** 長度給教練看的樣子：音樂段幾拍（可以 .5），口號段幾秒（到 0.1）。 */
export function lengthText(segment: Segment, length: number): string {
	return segment.kind === 'music' ? String(length / 2) : (length / 10).toFixed(1);
}

/** lengthText 的反向：拍數或秒數 → 半拍數或 0.1 秒數（取最近的）；看不懂是 null。 */
export function parseLength(segment: Segment, text: string): number | null {
	return parseScaled(text, segment.kind === 'music' ? 2 : 10);
}

/** 非負的數字乘上 scale 取最近的整數；空白、負數、看不懂是 null。 */
function parseScaled(text: string, scale: number): number | null {
	if (!text.trim()) return null;
	const v = Number(text);
	return Number.isFinite(v) && v >= 0 ? Math.round(v * scale) : null;
}
