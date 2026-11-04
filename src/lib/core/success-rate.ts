// 成功率：動作打開「記成功率」後，分成幾個環節（上法、中段…），動作裡的人分組。
// 設定存在動作裡（Action.successRate），組存在動作裡的人身上（ActionMember.squad）。

import type { Action, ActionCategory } from './actions';
import type { Flow } from './flow';
import type { Segment } from './segment';
import { freshIds } from './ids';
import { blocked, ok, type CommandResult } from './result';

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

/** 動作的「記成功率」設定。動作沒有這個欄位就是沒打開。 */
export interface SuccessRate {
	/** 環節，有順序。 */
	phases: Phase[];
	/** 紀錄，一次一筆。還沒有「記一次」，所以一定是空的。 */
	records: never[];
}

/** 環節在畫面上的顏色：挑了辨識色用辨識色，沒有就用種類的顏色。 */
export function phaseColor(phase: Phase): string {
	return phase.color ?? PHASE_KIND_COLORS[phase.kind];
}

/** 騰翻、跳躍是自己做的：不分組，每個人自己算。值是大類的名字（給教練看的原因用）。 */
const PER_PERSON: Partial<Record<ActionCategory, string>> = { tumbling: '騰翻', jump: '跳躍' };

/** 這個大類的動作是不是每個人自己算（不分組）。 */
export function perPerson(category: ActionCategory): boolean {
	return category in PER_PERSON;
}

/** 打開記成功率時先填的環節（照大類）。 */
const PREFILL: Record<ActionCategory, { kind: PhaseKind; name: string }[]> = {
	stunt: [
		{ kind: 'load', name: '' },
		{ kind: 'hold', name: '' },
		{ kind: 'dismount', name: '' }
	],
	pyramid: [
		{ kind: 'load', name: '' },
		{ kind: 'dismount', name: '' }
	],
	toss: [{ kind: 'whole', name: '拋投' }],
	tumbling: [{ kind: 'whole', name: '騰翻' }],
	jump: [],
	dance: [],
	other: []
};

/** 打開記成功率：照大類先填環節；金字塔通常整個一起算，所以全部的人先放第 1 組。已經打開就不動。 */
export function enableSuccessRate(flow: Flow, actionId: string): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	if (action.successRate) return ok(flow);
	const prefill = PREFILL[action.category];
	const issued = freshIds('p', prefill.length, flow.lastIds, phaseIds(flow));
	const phases = prefill.map((p, i) => ({ id: issued.ids[i], ...p }));
	const members =
		action.category === 'pyramid' ? action.members.map((m) => ({ ...m, squad: 1 })) : action.members;
	return withAction(
		{ ...flow, lastIds: issued.lastIds },
		{ ...action, members, successRate: { phases, records: [] } }
	);
}

/** 關掉記成功率：環節、組、紀錄都拿掉。 */
export function disableSuccessRate(flow: Flow, actionId: string): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	const { successRate: _, ...rest } = action;
	return withAction(flow, { ...rest, members: action.members.map(({ squad: _, ...m }) => m) });
}

/** 設組：給動作裡一個隊員第幾組（1 起）；null 是沒分組。 */
export function setSquad(
	flow: Flow,
	actionId: string,
	memberId: string,
	squad: number | null
): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	const segment = action && flow.segments.find((s) => s.id === action.segmentId);
	if (!action || !segment) return blocked('找不到這個動作');
	if (!action.members.some((m) => m.memberId === memberId)) return blocked('這個隊員不在動作裡');
	const members = action.members.map((m) => {
		if (m.memberId !== memberId) return m;
		const { squad: _, ...rest } = m;
		return squad === null ? rest : { ...rest, squad };
	});
	const changed = { ...action, members };
	const problem = successRateProblem(segment, changed);
	return problem ? blocked(problem) : withAction(flow, changed);
}

const isSquad = (n: number) => Number.isInteger(n) && n >= 1;

/** 動作的成功率設定和組哪裡不守規則（給教練看的原因）；沒問題是 null。指令和讀流程檔都照這個檢查。 */
export function successRateProblem(segment: Segment, action: Action): string | null {
	for (const { squad } of action.members) {
		if (squad === undefined) continue;
		if (!isSquad(squad)) return '組要是正整數';
		if (!action.successRate) return '先打開記成功率才能分組';
		const label = PER_PERSON[action.category];
		if (label) return `${label}的動作不分組，每個人自己算`;
	}
	return null;
}

/** 組的名字：「第 1 組 小美」，後面是組裡任務角色是上層的人（好幾個就用名單上第一個）；沒有上層就只叫「第 1 組」。 */
export function squadName(flow: Flow, action: Action, squad: number): string {
	const top = flow.members.find((member) =>
		action.members.some((m) => m.memberId === member.id && m.squad === squad && m.role === '上層')
	);
	return top ? `第 ${squad} 組 ${top.name}` : `第 ${squad} 組`;
}

/** 流程裡全部環節的 id。 */
function phaseIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => a.successRate?.phases.map((p) => p.id) ?? []);
}

function withAction(flow: Flow, action: Action): CommandResult {
	return ok({ ...flow, actions: flow.actions.map((a) => (a.id === action.id ? action : a)) });
}
