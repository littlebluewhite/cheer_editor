// 環節的資料型別和小工具：型別、種類清單、顏色、名字。環節的指令在 phases.ts。

import type { ActionCategory } from './action-types';
import { zh, type WhyParam } from './why';

/** 環節的種類：上法、中段、轉接、下法、拋法、翻法、跳法。流程檔存英文代號。 */
export type PhaseKind = 'load' | 'hold' | 'transition' | 'dismount' | 'toss' | 'tumble' | 'jump';

export const PHASE_KINDS: { key: PhaseKind; label: string }[] = [
	{ key: 'load', label: '上法' },
	{ key: 'hold', label: '中段' },
	{ key: 'transition', label: '轉接' },
	{ key: 'dismount', label: '下法' },
	{ key: 'toss', label: '拋法' },
	{ key: 'tumble', label: '翻法' },
	{ key: 'jump', label: '跳法' }
];

/** 第 10 版以前的種類（多了整體 whole，少了拋法、翻法、跳法）；升級舊檔時才認。 */
export const V10_PHASE_KINDS = ['load', 'hold', 'transition', 'dismount', 'whole'];

const BUILDING: PhaseKind[] = ['load', 'hold', 'transition', 'dismount'];

/** 每個大類能用的環節種類：技巧、金字塔用上法到下法，拋投只用拋法，騰翻只用翻法，跳躍只用跳法，舞蹈、其他沒有環節。 */
const KINDS_BY_CATEGORY: Record<ActionCategory, PhaseKind[]> = {
	stunt: BUILDING,
	pyramid: BUILDING,
	toss: ['toss'],
	tumbling: ['tumble'],
	jump: ['jump'],
	dance: [],
	other: []
};

/** 這個大類的環節能不能佔同樣的拍：只有金字塔（第一個三層停在中段時，第二個三層還在上法；docs/adr/0009）。 */
export function phasesMayShareBeats(category: ActionCategory): boolean {
	return category === 'pyramid';
}

/** 這個大類的動作能用的環節種類，照選單的順序；沒有（舞蹈、其他）就是不記成功率。 */
export function phaseKindsFor(category: ActionCategory): PhaseKind[] {
	return KINDS_BY_CATEGORY[category];
}

/**
 * 換到這個大類時，環節的種類換成什麼：能用的照留；只能用一種的大類換成那一種；
 * 技巧、金字塔裡舊檔的整體換成中段，其他換成上法；舞蹈、其他是 null（環節拿掉）。
 */
export function fitPhaseKind(category: ActionCategory, kind: string): PhaseKind | null {
	const kinds = phaseKindsFor(category);
	if (!kinds.length) return null;
	if ((kinds as string[]).includes(kind)) return kind as PhaseKind;
	if (kinds.length === 1) return kinds[0];
	return kind === 'whole' ? 'hold' : 'load';
}

/**
 * 加下一個環節時預設的種類：只能用一種的大類就是那一種；技巧、金字塔接在上一個環節（last）後面，
 * 照上法、中段、轉接、下法的順序，下法後面還是下法，還沒有環節是上法。舞蹈、其他是 null。
 */
export function nextPhaseKind(category: ActionCategory, last: PhaseKind | undefined): PhaseKind | null {
	const kinds = phaseKindsFor(category);
	if (kinds.length <= 1) return kinds[0] ?? null;
	if (!last) return kinds[0];
	const i = kinds.indexOf(last);
	return i < 0 ? kinds[0] : kinds[Math.min(i + 1, kinds.length - 1)];
}

/**
 * 種類的顏色（環節沒挑辨識色時用）：上法青、中段石板灰、轉接金、下法紫、拋法洋紅、翻法棕、跳法灰。
 * 避開拍子 down 的藍（#1f5fbf）、up 的綠（#2b7a2f），環節和拍子畫在一起時才分得出來。
 */
export const PHASE_KIND_COLORS: Record<PhaseKind, string> = {
	load: '#00796b',
	hold: '#475569',
	transition: '#8d6200',
	dismount: '#7b1fa2',
	toss: '#c2185b',
	tumble: '#6d4c41',
	jump: '#6b7280'
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
	const why = phaseWhy(phase);
	return typeof why === 'object' ? zh(why) : String(why);
}

/** 環節種類的名字的代號（畫面照語言寫，見 why.ts）；不認得的種類是空的。 */
export const phaseKindWhy = (kind: PhaseKind): WhyParam => (PHASE_KINDS.some((k) => k.key === kind) ? { code: `phase_kind_${kind}` } : '');

/** 環節名字的代號（同 phaseLabel）：教練取的名字照原樣，種類照語言寫。 */
export function phaseWhy(phase: Phase): WhyParam {
	const kind = phaseKindWhy(phase.kind);
	return phase.name ? { code: 'phase_label', kind, name: phase.name } : kind;
}
