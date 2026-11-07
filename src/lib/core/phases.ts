// 環節的指令：加環節、把拍標給現有的環節、清標的拍、改環節、刪環節。環節 id 只在這裡發。
// 環節存在動作的成功率設定裡（Action.successRate.phases），有順序：音樂段的環節一定有標的拍、照拍的先後排；
// 口號段不標拍、照加的先後排。標的拍跟拍點一樣從動作開始算半拍，所以拖動作、改 BPM 時跟著走；環節之間不能重疊。
// 指令都走收尾（settle）：加第一個環節時開始分組、拿掉對不上的記號、一個環節都不剩就不記成功率。
// 會刪到環節（刪環節、清標的拍、標拍蓋掉別的環節）時只有一條確認路（見 withPhases）。

import { replaceAction, type Action } from './action-types';
import type { Flow } from './flow';
import { freshIds } from './ids';
import { cut, ordered } from './phase-beats';
import { phaseLabel, type Phase, type PhaseKind } from './phase-types';
import { RECORDS_GONE, answered, blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import type { Segment } from './segment';
import { settle } from './settle';
import { allPhaseIds, beatsProblem, markedCount } from './success-rate';

/** 加環節要給的東西：種類、名字；音樂段要給標的拍（從動作開始算第幾個半拍、幾個半拍長），口號段不能給。 */
export interface NewPhaseInput {
	kind: PhaseKind;
	name: string;
	beats?: { at: number; len: number };
}

/** 改環節要改的東西；沒給的不動。color 給 null 是回到種類的顏色。 */
export interface PhaseChange {
	kind?: PhaseKind;
	name?: string;
	color?: string | null;
}

/**
 * 加環節：給種類和名字（名字去掉頭尾空白，可以空），發新的 id，回傳新環節的 id。
 * 音樂段要給標的拍：蓋到別的環節的部分從那個環節拿掉（剩兩段留前面那段），拍清光的環節刪掉（有記號先問）。
 * 口號段不標拍，加在最後。動作還沒記成功率時，這就是第一個環節：動作開始記成功率（分組交給收尾）。
 */
export function addPhase(
	flow: Flow,
	actionId: string,
	input: NewPhaseInput,
	options: ConfirmOption = {}
): CommandResult<{ id: string }> {
	const found = findAction(flow, actionId);
	if (typeof found === 'string') return blocked(found);
	const { action, segment } = found;
	const { beats } = input;
	if (segment.kind === 'music' && !beats) return blocked('音樂段的環節要選拍標');
	const problem = beats && beatsProblem(segment, action, beats);
	if (problem) return blocked(problem);
	const issued = freshIds('p', 1, flow.lastIds, allPhaseIds(flow));
	const phase: Phase = { id: issued.ids[0], kind: input.kind, name: input.name.trim(), ...(beats && { beats: { ...beats } }) };
	const old = action.successRate?.phases ?? [];
	const phases = beats ? [...cut(old, beats.at, beats.at + beats.len), phase] : [...old, phase];
	const r = withPhases({ ...flow, lastIds: issued.lastIds }, segment, action, phases, options);
	return r.kind === 'ok' ? { ...r, id: phase.id } : r;
}

/**
 * 把拍標給現有的環節：從 at 起 len 個半拍，換掉它原來的拍。
 * 蓋到別的環節的部分從那個環節拿掉（剩兩段留前面那段），拍清光的環節刪掉（有記號先問）。
 */
export function markPhaseBeats(
	flow: Flow,
	actionId: string,
	phaseId: string,
	at: number,
	len: number,
	options: ConfirmOption = {}
): CommandResult {
	const found = findPhase(flow, actionId, phaseId);
	if (typeof found === 'string') return blocked(found);
	const { action, segment } = found;
	const problem = beatsProblem(segment, action, { at, len });
	if (problem) return blocked(problem);
	const phases = cut(action.successRate!.phases, at, at + len).map((p) => (p.id === phaseId ? { ...p, beats: { at, len } } : p));
	return withPhases(flow, segment, action, phases, options);
}

/** 清標的拍：拿掉 [from, to) 半拍裡的標的拍，被切到的照標拍的規則切短；拍清光的環節刪掉（有記號先問）。 */
export function clearPhaseBeats(
	flow: Flow,
	actionId: string,
	from: number,
	to: number,
	options: ConfirmOption = {}
): CommandResult {
	const found = findAction(flow, actionId);
	if (typeof found === 'string') return blocked(found);
	const { action, segment } = found;
	if (!action.successRate) return ok(flow);
	return withPhases(flow, segment, action, cut(action.successRate.phases, from, to), options);
}

/** 改環節：種類、名字（去掉頭尾空白）、顏色（PHASE_COLORS 裡的，或 null 回到種類的顏色）。 */
export function updatePhase(flow: Flow, actionId: string, phaseId: string, change: PhaseChange): CommandResult {
	const found = findPhase(flow, actionId, phaseId);
	if (typeof found === 'string') return blocked(found);
	const { action, segment, phase } = found;
	const { color: _, ...rest } = phase;
	const color = change.color === undefined ? phase.color : (change.color ?? undefined);
	const next: Phase = {
		...rest,
		...(change.kind !== undefined && { kind: change.kind }),
		...(change.name !== undefined && { name: change.name.trim() }),
		...(color !== undefined && { color })
	};
	return withPhases(flow, segment, action, action.successRate!.phases.map((p) => (p.id === phaseId ? next : p)), {});
}

/** 刪環節：有記號先問（見 withPhases）；拿掉後一個記號都沒有的那一次整筆拿掉。沒記號就直接刪。 */
export function deletePhase(flow: Flow, actionId: string, phaseId: string, options: ConfirmOption = {}): CommandResult {
	const found = findPhase(flow, actionId, phaseId);
	if (typeof found === 'string') return blocked(found);
	const { action, segment } = found;
	return withPhases(flow, segment, action, action.successRate!.phases.filter((p) => p.id !== phaseId), options);
}

/** 找動作和它在的段；找不到回給教練看的原因。 */
function findAction(flow: Flow, actionId: string): { action: Action; segment: Segment } | string {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return '找不到這個動作';
	const segment = flow.segments.find((s) => s.id === action.segmentId);
	return segment ? { action, segment } : '找不到這一段';
}

/** 找動作、它在的段和它的環節；找不到回給教練看的原因。 */
function findPhase(flow: Flow, actionId: string, phaseId: string): { action: Action; segment: Segment; phase: Phase } | string {
	const found = findAction(flow, actionId);
	if (typeof found === 'string') return found;
	const phase = found.action.successRate?.phases.find((p) => p.id === phaseId);
	return phase ? { ...found, phase } : '找不到這個環節';
}

/**
 * 換掉動作的環節清單，走收尾；不守規則就擋下來。音樂段沒標拍的環節刪掉。
 * 會刪到有記號的環節時，這是唯一的確認：「會刪掉 N 個環節，清掉 M 次的記號，確定就刪掉」（刪光時在「，確定就刪掉」前面加
 * 「；動作沒有環節了，不再記成功率」），清單一行一個「刪掉：環節 上法 延伸」；帶 { confirmed: true } 或 { records } 再送一次才刪。
 */
function withPhases(flow: Flow, segment: Segment, action: Action, phases: Phase[], options: ConfirmOption): CommandResult {
	const kept = segment.kind === 'music' ? phases.filter((p) => p.beats) : phases;
	const gone = (action.successRate?.phases ?? []).filter((p) => !kept.some((k) => k.id === p.id));
	const marked = markedCount(action, gone);
	if (marked && !answered(options)) {
		const empty = kept.length ? '' : '；動作沒有環節了，不再記成功率';
		return needsConfirm(
			`會刪掉 ${gone.length} 個環節，清掉 ${marked} 次的記號${RECORDS_GONE}${empty}，確定就刪掉`,
			gone.map((p) => `刪掉：環節 ${phaseLabel(p)}`)
		);
	}
	const after: Action = { ...action, successRate: { records: action.successRate?.records ?? [], phases: ordered(kept) } };
	const settled = settle(flow, action, after, options);
	return settled.kind === 'blocked' ? settled : ok(replaceAction(settled.flow, settled.action));
}
