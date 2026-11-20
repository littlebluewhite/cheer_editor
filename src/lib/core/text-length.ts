// 字數上限：所有打字的欄位共用一個算法，照看得到的字算（一個中文字、一個家庭 emoji 都算一個）。

import type { Why, WhyCode } from './why';

/** 每種欄位最多幾個字。 */
export const MAX_CHARS = {
	flowName: 40,
	memberName: 20,
	actionName: 20,
	formationName: 20,
	roleName: 8,
	bookmarkName: 20,
	note: 200
} as const;

export type LimitedText = keyof typeof MAX_CHARS;

/** 原因裡的欄位名（代號，見 why.ts）。 */
const LABELS: Record<LimitedText, WhyCode> = {
	flowName: 'text_length_flow_name',
	memberName: 'text_length_member_name',
	actionName: 'text_length_action_name',
	formationName: 'text_length_formation_name',
	roleName: 'text_length_role_name',
	bookmarkName: 'text_length_bookmark_name',
	note: 'text_length_note'
};

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 看得到的字數。 */
export function charCount(text: string): number {
	let n = 0;
	for (const _ of graphemes.segment(text)) n++;
	return n;
}

/** 前 n 個看得到的字。 */
export function firstChars(text: string, n: number): string {
	for (const { index } of graphemes.segment(text)) {
		if (n-- <= 0) return text.slice(0, index);
	}
	return text;
}

/** 第 i 個 code unit 所在那個字的開頭（i 在 emoji 中間時退到 emoji 前面）。 */
export function charStart(text: string, i: number): number {
	let start = 0;
	for (const { index } of graphemes.segment(text)) {
		if (index > i) break;
		start = index;
	}
	return start;
}

/**
 * 這一格最多可以有幾個字：上限，或原本的字（before，開檔進來就超過的）有幾個字，取大的。頭尾空白不算。
 * 流程核心（tooLong）和欄位旁邊的字數（CharCount）都用它，規則只有一條（N08）。
 */
export function charLimit(field: LimitedText, before = ''): number {
	return Math.max(MAX_CHARS[field], charCount(before.trim()));
}

/**
 * 太長時的原因（「動作名稱最多 20 個字」）；沒超過是 null。頭尾空白不算。
 * before：改之前的字。照 HTML 的 tooLong：舊的字超過上限照收，但這次的改動不能讓它更長（N08）。
 */
export function tooLong(field: LimitedText, text: string, before = ''): Why | null {
	const max = MAX_CHARS[field];
	const limit = charLimit(field, before);
	if (charCount(text.trim()) <= limit) return null;
	const label: Why = { code: LABELS[field] };
	return limit > max
		? { code: 'text_length_too_long_kept', field: label, max, count: limit }
		: { code: 'text_length_too_long', field: label, max };
}
