// 環節標的拍：在拍點格子選幾拍標給一個環節（標拍）、拿掉一段拍裡的標的拍（清標的拍）。
// 標的拍跟拍點一樣從動作開始算半拍，所以拖動作、改 BPM 時跟著走。環節之間不能重疊；標拍、清標的拍都不動拍點和紀錄。

import { replaceAction, type Action } from './actions';
import { rangeText, type Cue } from './cues';
import type { Flow } from './flow';
import { freshIds } from './ids';
import { phaseLabel } from './phases';
import type { Segment } from './segment';
import { blocked, ok, type CommandResult } from './result';
import { allPhaseIds, fitRecords, perPerson, successRateProblem, type Phase, type PhaseKind } from './success-rate';
import { HALF_BEATS_PER_BEAT as BEAT } from './time';

/** 標給誰：現有的環節，或新的環節（給種類和名字）。 */
export type BeatsTarget = { phaseId: string } | { kind: PhaseKind; name: string };

/**
 * 標拍：把從 at 起 len 個半拍標給一個環節。新的環節發新 id；現有的換掉它原來的拍。
 * 蓋到別的環節的部分從那個環節拿掉（剩兩段留前面那段，不到一拍就變沒標拍）。回傳環節的 id。
 * 動作還沒記成功率時，加的這個環節就是第一個：動作開始記成功率，只有這一個環節（見 firstSquad）。
 */
export function markPhaseBeats(
	flow: Flow,
	actionId: string,
	target: BeatsTarget,
	at: number,
	len: number
): CommandResult<{ id: string }> {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	const music = flow.segments.find((s) => s.id === action.segmentId)?.kind === 'music';
	if (music && (action.start + at) % BEAT !== 0) return blocked('環節要標在整拍上');
	let phases = action.successRate?.phases ?? [];
	let lastIds = flow.lastIds;
	let id: string;
	if ('phaseId' in target) {
		if (!phases.some((p) => p.id === target.phaseId)) return blocked('找不到這個環節');
		id = target.phaseId;
	} else {
		const issued = freshIds('p', 1, flow.lastIds, allPhaseIds(flow));
		id = issued.ids[0];
		lastIds = issued.lastIds;
		phases = [...phases, { id, kind: target.kind, name: target.name.trim() }];
	}
	phases = cut(phases, at, at + len).map((p) => (p.id === id ? { ...p, beats: { at, len } } : p));
	const base = action.successRate ? action : firstSquad(action);
	const r = withPhases({ ...flow, ...(lastIds && { lastIds }) }, base, phases);
	return r.kind === 'ok' ? { ...r, id } : r;
}

/** 動作加第一個環節（開始記成功率）時：分組的大類把動作裡的人全部放進第 1 組；騰翻、跳躍不分組。 */
function firstSquad(action: Action): Action {
	return perPerson(action.category) ? action : { ...action, members: action.members.map((m) => ({ ...m, squad: 1 })) };
}

/** 清標的拍：拿掉 [from, to) 半拍裡的標的拍，被切到的照標拍的規則切短。環節和紀錄留著。 */
export function clearPhaseBeats(flow: Flow, actionId: string, from: number, to: number): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	if (!action.successRate) return ok(flow);
	return withPhases(flow, action, cut(action.successRate.phases, from, to));
}

/** 環節標的拍的範圍（照八拍寫，例：1-1 到 1-3）和範圍裡的拍點（碰到範圍的都算，照時間排）；沒標拍是 null。 */
export function phaseSpan(flow: Flow, action: Action, phase: Phase): { range: string; cues: Cue[] } | null {
	const segment = flow.segments.find((s) => s.id === action.segmentId);
	const b = phase.beats;
	if (!b || !segment) return null;
	const cues = (action.cues ?? []).filter((c) => c.at < b.at + b.len && c.at + c.len > b.at);
	return { range: rangeText(segment, action, b.at, b.len), cues };
}

/**
 * 改動作會動到的標的拍（跟拍點的 cueFallout 一起問）：換到口號段全部拿掉；變短時跨出去的切短（取到整拍），
 * 不到一拍的變沒標拍。拖到半拍上時，標的拍一起挪半拍、對齊音樂的整拍（往後挪，會切到比較多才往前），
 * 挪了跑出動作的一樣切短。環節本身和紀錄都留著。拖動作（整拍）、改 BPM 不會動到（標的拍從動作開始算）。
 * 沒動到是 null；不然回傳新的環節清單、切短和變沒標拍各幾個、是不是挪了半拍，
 * 和給教練確認的清單（只挪沒切到的不列；時間照改之前的位置寫，切短後的照改之後的）。
 */
export function phaseFallout(
	from: Segment,
	to: Segment,
	before: Action,
	after: Action
): { phases: Phase[]; cut: number; unmarked: number; shifted: boolean; items: string[] } | null {
	const old = after.successRate?.phases ?? [];
	const music = to.kind === 'music';
	const offBeat = (p: Phase) => !!p.beats && (after.start + p.beats.at) % BEAT !== 0;
	const shifted = music && old.some(offBeat);
	/** 挪 by 個半拍（落在 & 的才挪）、留在動作裡、取到整拍後的標的拍；不到一拍是 undefined。 */
	const place = (p: Phase, by: number) => {
		const { at, len } = p.beats!;
		if (!music) return undefined;
		const moved = offBeat(p) ? at + by : at;
		const start = moved < 0 ? moved + BEAT : moved;
		const fit = Math.min(moved + len, after.length) - start;
		const fitted = fit - (fit % BEAT);
		return fitted >= BEAT ? { at: start, len: fitted } : undefined;
	};
	const kept = (by: number) => old.filter((p) => p.beats && place(p, by)?.len === p.beats.len).length;
	const by = shifted && kept(-1) > kept(1) ? -1 : 1;
	const items: string[] = [];
	let cut = 0;
	let unmarked = 0;
	const phases = old.map((p) => {
		if (!p.beats) return p;
		const { at, len } = p.beats;
		const beats = place(p, by);
		if (beats?.at === at && beats.len === len) return p;
		const text = `環節 ${phaseLabel(p)} ${rangeText(from, before, at, len)}`;
		if (beats?.len === len) return withBeats(p, beats);
		if (beats) {
			cut++;
			items.push(`切短：${text} → ${rangeText(to, after, beats.at, beats.len)}`);
			return withBeats(p, beats);
		}
		unmarked++;
		items.push(`變沒標拍：${text}`);
		return withBeats(p);
	});
	return phases.some((p, i) => p !== old[i]) ? { phases: ordered(phases), cut, unmarked, shifted, items } : null;
}

/** 「切短 1 個環節標的拍、讓 1 個環節變沒標拍」（確認訊息裡標的拍那一段）。 */
export function phaseFalloutText({ cut, unmarked }: { cut: number; unmarked: number }): string {
	return [cut ? `切短 ${cut} 個環節標的拍` : '', unmarked ? `讓 ${unmarked} 個環節變沒標拍` : '']
		.filter(Boolean)
		.join('、');
}

/**
 * 把 [from, to) 半拍從每個環節標的拍裡拿掉：露在外面的留著，兩邊都露出來時留前面那段。
 * 露出來的長度取到整拍（動作被拖半拍後可能差半拍），不到一拍就變沒標拍。
 */
function cut(phases: Phase[], from: number, to: number): Phase[] {
	return phases.map((p) => {
		const b = p.beats;
		if (!b || b.at >= to || b.at + b.len <= from) return p;
		const pieces = [
			...(b.at < from ? [{ at: b.at, len: from - b.at }] : []),
			...(b.at + b.len > to ? [{ at: to, len: b.at + b.len - to }] : [])
		]
			.map((x) => ({ ...x, len: x.len - (x.len % BEAT) }))
			.filter((x) => x.len >= BEAT);
		return withBeats(p, pieces[0]);
	});
}

/** 換掉環節標的拍；沒給就是沒標拍（拿掉欄位）。 */
function withBeats({ beats: _, ...p }: Phase, beats?: { at: number; len: number }): Phase {
	return beats ? { ...p, beats } : p;
}

/** 標了拍的照時間排在前面；沒標的排在後面，照原來的順序。 */
function ordered(phases: Phase[]): Phase[] {
	const marked = phases.filter((p) => p.beats).sort((a, b) => a.beats!.at - b.beats!.at);
	return [...marked, ...phases.filter((p) => !p.beats)];
}

/** 換掉動作的環節清單；不守規則就擋下來。 */
function withPhases(flow: Flow, action: Action, phases: Phase[]): CommandResult {
	const segment = flow.segments.find((s) => s.id === action.segmentId);
	if (!segment) return blocked('找不到這一段');
	const records = action.successRate?.records ?? [];
	const changed = fitRecords({ ...action, successRate: { records, phases: ordered(phases) } });
	const problem = successRateProblem(segment, changed);
	if (problem) return blocked(problem);
	return ok(replaceAction(flow, changed));
}
