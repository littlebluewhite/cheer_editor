// 改環節清單：加環節、改環節、刪環節、換順序（成功率區的環節清單用）。
// 環節存在動作的成功率設定裡（Action.successRate.phases），有順序；標了拍的照時間排在前面，沒標拍的才能換順序。

import type { Action } from './actions';
import type { Flow } from './flow';
import { freshIds } from './ids';
import { blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { fitRecords, PHASE_KINDS, successRateProblem, type Phase, type PhaseKind } from './success-rate';

/** 改環節要改的東西；沒給的不動。color 給 null 是回到種類的顏色。 */
export interface PhaseChange {
	kind?: PhaseKind;
	name?: string;
	color?: string | null;
}

/** 加環節：給種類和名字（名字去掉頭尾空白，可以空），加在最後、不標拍。回傳新環節的 id。 */
export function addPhase(
	flow: Flow,
	actionId: string,
	input: { kind: PhaseKind; name: string }
): CommandResult<{ id: string }> {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	if (!action.successRate) return blocked('先打開記成功率才能加環節');
	const issued = freshIds('p', 1, flow.lastIds, allPhaseIds(flow));
	const phase: Phase = { id: issued.ids[0], kind: input.kind, name: input.name.trim() };
	const phases = [...action.successRate.phases, phase];
	const r = withPhases({ ...flow, lastIds: issued.lastIds }, action, phases);
	return r.kind === 'ok' ? { ...r, id: phase.id } : r;
}

/** 改環節：種類、名字（去掉頭尾空白）、顏色（PHASE_COLORS 裡的，或 null 回到種類的顏色）。 */
export function updatePhase(flow: Flow, actionId: string, phaseId: string, change: PhaseChange): CommandResult {
	const found = findPhase(flow, actionId, phaseId);
	if (typeof found === 'string') return blocked(found);
	const { action, phase } = found;
	const { color: _, ...rest } = phase;
	const color = change.color === undefined ? phase.color : (change.color ?? undefined);
	const next: Phase = {
		...rest,
		...(change.kind !== undefined && { kind: change.kind }),
		...(change.name !== undefined && { name: change.name.trim() }),
		...(color !== undefined && { color })
	};
	return withPhases(flow, action, action.successRate!.phases.map((p) => (p.id === phaseId ? next : p)));
}

/**
 * 刪環節：有紀錄（有一次打了它的記號）就回「要確認」，寫出會清掉幾次的記號；確定後拿掉環節和它的記號，
 * 拿掉後一個記號都沒有的那一次整筆拿掉。沒紀錄就直接刪。
 */
export function deletePhase(
	flow: Flow,
	actionId: string,
	phaseId: string,
	{ confirmed = false }: ConfirmOption = {}
): CommandResult {
	const found = findPhase(flow, actionId, phaseId);
	if (typeof found === 'string') return blocked(found);
	const { action, phase } = found;
	const marked = action.successRate!.records.filter((r) => phaseId in r.marks).length;
	if (marked && !confirmed) {
		return needsConfirm(`${phaseLabel(phase)} 有紀錄，刪掉會清掉 ${marked} 次的記號，確定就刪掉`, []);
	}
	return withPhases(flow, action, action.successRate!.phases.filter((p) => p.id !== phaseId));
}

/** 換順序：把沒標拍的環節換到第 to 個（0 起）。標了拍的照時間排在前面，不能換，也不能被越過。 */
export function movePhase(flow: Flow, actionId: string, phaseId: string, to: number): CommandResult {
	const found = findPhase(flow, actionId, phaseId);
	if (typeof found === 'string') return blocked(found);
	const { action } = found;
	const phases = action.successRate!.phases;
	const from = phases.findIndex((p) => p.id === phaseId);
	if (!Number.isInteger(to) || to < 0 || to >= phases.length) return blocked('環節換不到那裡');
	const passed = phases.slice(Math.min(from, to), Math.max(from, to) + 1);
	if (passed.some((p) => p.beats)) return blocked('標了拍的環節照時間排，只有沒標拍的能換順序');
	if (from === to) return ok(flow);
	const next = phases.filter((p) => p.id !== phaseId);
	next.splice(to, 0, phases[from]);
	return withPhases(flow, action, next);
}

/** 環節的名字：種類加名字，例：上法 延伸；沒名字就是種類。 */
function phaseLabel(phase: Phase): string {
	const kind = PHASE_KINDS.find((k) => k.key === phase.kind)?.label ?? '';
	return phase.name ? `${kind} ${phase.name}` : kind;
}

/** 找動作和它的環節；找不到回給教練看的原因。 */
function findPhase(flow: Flow, actionId: string, phaseId: string): { action: Action; phase: Phase } | string {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return '找不到這個動作';
	const phase = action.successRate?.phases.find((p) => p.id === phaseId);
	return phase ? { action, phase } : '找不到這個環節';
}

/** 換掉動作的環節清單，紀錄裡對不上的記號跟著拿掉；不守規則就擋下來。 */
function withPhases(flow: Flow, action: Action, phases: Phase[]): CommandResult {
	const segment = flow.segments.find((s) => s.id === action.segmentId);
	if (!segment) return blocked('找不到這一段');
	const changed = fitRecords({ ...action, successRate: { ...action.successRate!, phases } });
	const problem = successRateProblem(segment, changed);
	if (problem) return blocked(problem);
	return ok({ ...flow, actions: flow.actions.map((a) => (a.id === action.id ? changed : a)) });
}

/** 流程裡全部環節的 id（發新 id 時用）。 */
function allPhaseIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => a.successRate?.phases.map((p) => p.id) ?? []);
}
