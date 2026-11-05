// 環節的資料型別和小工具：型別、種類清單、顏色、名字。環節的指令在 phases.ts。

/** 環節的種類：上法、中段、轉接、下法、整體。流程檔存英文代號。 */
export type PhaseKind = 'load' | 'hold' | 'transition' | 'dismount' | 'whole';

export const PHASE_KINDS: { key: PhaseKind; label: string }[] = [
	{ key: 'load', label: '上法' },
	{ key: 'hold', label: '中段' },
	{ key: 'transition', label: '轉接' },
	{ key: 'dismount', label: '下法' },
	{ key: 'whole', label: '整體' }
];

/**
 * 加下一個環節時預設的種類：接在上一個環節（last）後面，照上法、中段、轉接、下法的順序；
 * 下法、整體後面還是一樣，還沒有環節是上法。
 */
export function nextPhaseKind(last: PhaseKind | undefined): PhaseKind {
	const order: PhaseKind[] = ['load', 'hold', 'transition', 'dismount'];
	if (!last) return 'load';
	const i = order.indexOf(last);
	return i < 0 ? last : order[Math.min(i + 1, order.length - 1)];
}

/**
 * 種類的顏色（環節沒挑辨識色時用）：上法青、中段石板灰、轉接金、下法紫、整體灰。
 * 避開拍子 down 的藍（#1f5fbf）、up 的綠（#2b7a2f），環節和拍子畫在一起時才分得出來。
 */
export const PHASE_KIND_COLORS: Record<PhaseKind, string> = {
	load: '#00796b',
	hold: '#475569',
	transition: '#8d6200',
	dismount: '#7b1fa2',
	whole: '#6b7280'
};

/** 環節：動作裡要分開算成功率的一部分。 */
export interface Phase {
	/** 整個流程裡不重複，刪了也不重用（紀錄跨復原時靠 id 對回環節），例：p3。 */
	id: string;
	kind: PhaseKind;
	/** 教練取的名字，例：延伸；可以是空的。 */
	name: string;
	/** 辨識色（#rrggbb）；沒有就用種類的顏色。 */
	color?: string;
	/** 標的拍：跟拍點一樣，從動作開始算第幾個半拍、幾個半拍長。沒有就是沒標拍。 */
	beats?: { at: number; len: number };
}

/** 環節在畫面上的顏色：挑了辨識色用辨識色，沒有就用種類的顏色。 */
export function phaseColor(phase: Phase): string {
	return phase.color ?? PHASE_KIND_COLORS[phase.kind];
}

/** 環節的名字：種類加名字，例：上法 延伸；沒名字就是種類。 */
export function phaseLabel(phase: Phase): string {
	const kind = PHASE_KINDS.find((k) => k.key === phase.kind)?.label ?? '';
	return phase.name ? `${kind} ${phase.name}` : kind;
}
