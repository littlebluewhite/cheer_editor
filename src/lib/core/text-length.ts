// 字數上限：所有打字的欄位共用一個算法，照看得到的字算（一個中文字、一個家庭 emoji 都算一個）。

/** 每種欄位最多幾個字。 */
export const MAX_CHARS = {
	flowName: 40,
	memberName: 20,
	actionName: 20,
	formationName: 20,
	roleName: 8,
	note: 200
} as const;

export type LimitedText = keyof typeof MAX_CHARS;

const LABELS: Record<LimitedText, string> = {
	flowName: '流程名字',
	memberName: '隊員名字',
	actionName: '動作名稱',
	formationName: '站位名稱',
	roleName: '任務角色名稱',
	note: '備註'
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
export function tooLong(field: LimitedText, text: string, before = ''): string | null {
	const max = MAX_CHARS[field];
	const limit = charLimit(field, before);
	if (charCount(text.trim()) <= limit) return null;
	return limit > max
		? `${LABELS[field]}最多 ${max} 個字（原本就有 ${limit} 個字，不能再變長）`
		: `${LABELS[field]}最多 ${max} 個字`;
}
