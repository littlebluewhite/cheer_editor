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

/** 太長時的原因（「動作名稱最多 20 個字」）；沒超過是 null。頭尾空白不算。 */
export function tooLong(field: LimitedText, text: string): string | null {
	const max = MAX_CHARS[field];
	return charCount(text.trim()) > max ? `${LABELS[field]}最多 ${max} 個字` : null;
}
