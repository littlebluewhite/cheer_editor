// 改環節：加環節、改環節、刪環節。
// 環節存在動作的成功率設定裡（Action.successRate.phases），有順序；音樂段照標的拍的先後排（見 phase-beats），
// 口號段不標拍、照加的先後排。

import { replaceAction, type Action } from './actions';
import type { Flow } from './flow';
import { freshIds } from './ids';
import { blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { allPhaseIds, firstSquad, PHASE_KINDS, replacePhases, successRateProblem, type Phase, type PhaseKind } from './success-rate';

/** 改環節要改的東西；沒給的不動。color 給 null 是回到種類的顏色。 */
export interface PhaseChange {
	kind?: PhaseKind;
	name?: string;
	color?: string | null;
}

/**
 * 口號段加環節：給種類和名字（名字去掉頭尾空白，可以空），加在最後、不標拍。回傳新環節的 id。
 * 動作還沒記成功率時，這就是第一個環節：動作開始記成功率（見 firstSquad）。音樂段的環節要選拍標（markPhaseBeats）。
 */
export function addPhase(
	flow: Flow,
	actionId: string,
	input: { kind: PhaseKind; name: string }
): CommandResult<{ id: string }> {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	if (flow.segments.find((s) => s.id === action.segmentId)?.kind === 'music') return blocked('音樂段的環節要選拍標');
	const issued = freshIds('p', 1, flow.lastIds, allPhaseIds(flow));
	const phase: Phase = { id: issued.ids[0], kind: input.kind, name: input.name.trim() };
	const phases = [...(action.successRate?.phases ?? []), phase];
	const r = applyPhases({ ...flow, lastIds: issued.lastIds }, firstSquad(action), phases);
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
	return applyPhases(flow, action, action.successRate!.phases.map((p) => (p.id === phaseId ? next : p)));
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
	const phases = action.successRate!.phases.filter((p) => p.id !== phaseId);
	if (marked && !confirmed) {
		const empty = phases.length ? '' : NO_PHASES_LEFT;
		return needsConfirm(`${phaseLabel(phase)} 有紀錄，刪掉會清掉 ${marked} 次的記號${empty}，確定就刪掉`, []);
	}
	return applyPhases(flow, action, phases);
}

/** 確認訊息裡刪光環節時接的那一句。 */
export const NO_PHASES_LEFT = '；動作沒有環節了，不再記成功率';

/** 環節的名字：種類加名字，例：上法 延伸；沒名字就是種類。 */
export function phaseLabel(phase: Phase): string {
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

/** 換掉動作的環節清單，紀錄裡對不上的記號跟著拿掉，一個都不剩就不記成功率；不守規則就擋下來。 */
export function applyPhases(flow: Flow, action: Action, phases: Phase[]): CommandResult {
	const segment = flow.segments.find((s) => s.id === action.segmentId);
	if (!segment) return blocked('找不到這一段');
	const changed = replacePhases(action, phases);
	const problem = successRateProblem(segment, changed);
	if (problem) return blocked(problem);
	return ok(replaceAction(flow, changed));
}
