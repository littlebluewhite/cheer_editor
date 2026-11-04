// 環節標的拍：在拍點格子選幾拍標給一個環節（標拍）、拿掉一段拍裡的標的拍（清標的拍）。
// 標的拍跟拍點一樣從動作開始算半拍，所以拖動作、改 BPM 時跟著走。環節之間不能重疊；標拍、清標的拍都不動拍點。
// 音樂段的環節一定有拍：拍清光的環節自動刪掉（有記號先問），環節照拍的先後排；一個都不剩就不記成功率。

import { replaceAction, type Action } from './actions';
import { rangeText } from './cues';
import type { Flow } from './flow';
import { freshIds } from './ids';
import { phaseLabel } from './phases';
import type { Segment } from './segment';
import { blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import {
	allPhaseIds,
	firstSquad,
	markedCount,
	replacePhases,
	successRateProblem,
	type Phase,
	type PhaseKind
} from './success-rate';
import { HALF_BEATS_PER_BEAT as BEAT } from './time';

/** 標給誰：現有的環節，或新的環節（給種類和名字）。 */
export type BeatsTarget = { phaseId: string } | { kind: PhaseKind; name: string };

/**
 * 標拍：把從 at 起 len 個半拍標給一個環節。新的環節發新 id；現有的換掉它原來的拍。
 * 蓋到別的環節的部分從那個環節拿掉（剩兩段留前面那段），拍清光的環節刪掉（有記號先問）。回傳環節的 id。
 * 動作還沒記成功率時，加的這個環節就是第一個：動作開始記成功率，只有這一個環節（見 firstSquad）。
 */
export function markPhaseBeats(
	flow: Flow,
	actionId: string,
	target: BeatsTarget,
	at: number,
	len: number,
	options: ConfirmOption = {}
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
	const r = withPhases({ ...flow, ...(lastIds && { lastIds }) }, base, phases, options);
	return r.kind === 'ok' ? { ...r, id } : r;
}

/**
 * 清標的拍：拿掉 [from, to) 半拍裡的標的拍，被切到的照標拍的規則切短。
 * 拍清光的環節刪掉；要刪的有記號先回「要確認」，帶 { confirmed: true } 再送一次才刪。
 */
export function clearPhaseBeats(
	flow: Flow,
	actionId: string,
	from: number,
	to: number,
	options: ConfirmOption = {}
): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	if (!action.successRate) return ok(flow);
	return withPhases(flow, action, cut(action.successRate.phases, from, to), options);
}

/**
 * 改動作會動到的標的拍（跟拍點的 cueFallout 一起問）：換到口號段全部拿掉、環節照原本的先後留著，不用問；
 * 變短時跨出去的切短（取到整拍），不到一拍的刪掉。拖到半拍上時，標的拍一起挪半拍、對齊音樂的整拍
 * （往後挪，會切到比較多才往前），挪了跑出動作的一樣切短或刪掉。換到音樂段時沒標拍的環節刪掉。
 * 拖動作（整拍）、改 BPM 不會動到（標的拍從動作開始算）。
 * 沒動到是 null；不然回傳留下的環節（照拍排）、切短、刪掉各幾個、刪掉的有幾次記號、
 * 是不是刪光了、是不是挪了半拍，和給教練確認的清單（只挪沒切到的不列；時間照改之前的位置寫，切短後的照改之後的）。
 */
export function phaseFallout(
	from: Segment,
	to: Segment,
	before: Action,
	after: Action
): {
	phases: Phase[];
	cut: number;
	dropped: number;
	marked: number;
	empty: boolean;
	shifted: boolean;
	items: string[];
} | null {
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
	const gone: Phase[] = [];
	let cut = 0;
	const phases = old.flatMap((p) => {
		if (!p.beats) {
			if (!music) return [p];
			gone.push(p);
			items.push(`刪掉：環節 ${phaseLabel(p)}`);
			return [];
		}
		const { at, len } = p.beats;
		const beats = place(p, by);
		if (beats?.at === at && beats.len === len) return [p];
		const text = `環節 ${phaseLabel(p)} ${rangeText(from, before, at, len)}`;
		if (beats?.len === len) return [withBeats(p, beats)];
		if (beats) {
			cut++;
			items.push(`切短：${text} → ${rangeText(to, after, beats.at, beats.len)}`);
			return [withBeats(p, beats)];
		}
		if (!music) return [withBeats(p)];
		gone.push(p);
		items.push(`刪掉：${text}`);
		return [];
	});
	if (!gone.length && phases.every((p, i) => p === old[i])) return null;
	return {
		phases: ordered(phases),
		cut,
		dropped: gone.length,
		marked: markedCount(after, gone),
		empty: !phases.length,
		shifted,
		items
	};
}

/** 「切短 1 個環節標的拍、刪掉 1 個環節（清掉 2 次的記號），動作不再記成功率」（確認訊息裡標的拍那一段）。 */
export function phaseFalloutText({
	cut,
	dropped,
	marked,
	empty
}: {
	cut: number;
	dropped: number;
	marked: number;
	empty: boolean;
}): string {
	const parts = [
		cut ? `切短 ${cut} 個環節標的拍` : '',
		dropped ? `刪掉 ${dropped} 個環節${marked ? `（清掉 ${marked} 次的記號）` : ''}` : ''
	];
	return parts.filter(Boolean).join('、') + (empty ? '，動作不再記成功率' : '');
}

/**
 * 把 [from, to) 半拍從每個環節標的拍裡拿掉：露在外面的留著，兩邊都露出來時留前面那段。
 * 露出來的長度取到整拍（動作被拖半拍後可能差半拍），不到一拍就變沒標拍（之後在 withPhases 刪掉）。
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

/** 標了拍的照時間排在前面；沒標的（口號段）排在後面，照原來的順序。 */
function ordered(phases: Phase[]): Phase[] {
	const marked = phases.filter((p) => p.beats).sort((a, b) => a.beats!.at - b.beats!.at);
	return [...marked, ...phases.filter((p) => !p.beats)];
}

/**
 * 換掉動作的環節清單；不守規則就擋下來。音樂段沒標拍的環節刪掉：有記號先回「要確認」，
 * 寫會清掉幾次的記號（刪光了也說動作不再記成功率），帶 { confirmed: true } 再送一次才刪。
 */
function withPhases(flow: Flow, action: Action, phases: Phase[], { confirmed = false }: ConfirmOption): CommandResult {
	const segment = flow.segments.find((s) => s.id === action.segmentId);
	if (!segment) return blocked('找不到這一段');
	const kept = segment.kind === 'music' ? phases.filter((p) => p.beats) : phases;
	const gone = phases.filter((p) => !kept.includes(p));
	const marked = markedCount(action, gone);
	if (marked && !confirmed) {
		const empty = kept.length ? '' : '；動作沒有環節了，不再記成功率';
		return needsConfirm(
			`拍清光的環節會刪掉，清掉 ${marked} 次的記號${empty}，確定就刪掉`,
			gone.map((p) => `刪掉：環節 ${phaseLabel(p)}`)
		);
	}
	const changed = replacePhases(action, ordered(kept));
	const problem = successRateProblem(segment, changed);
	if (problem) return blocked(problem);
	return ok(replaceAction(flow, changed));
}
