// 拍點：動作裡從某一拍開始、佔幾拍的提示，分拍子、步驟、手位三種。
// 存在動作裡、從動作開始算半拍，所以拖動作、改 BPM 時跟著走；刪動作時一起刪。

import type { Action } from './actions';
import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import type { Segment } from './segment';

/** 拍子、步驟、手位。 */
export type CueKind = 'count' | 'step' | 'motion';
export const CUE_KINDS: CueKind[] = ['count', 'step', 'motion'];

/** 給誰：null = 動作裡全部的人；role = 某個任務角色的人；member = 某一個隊員。 */
export type Who = null | { role: string } | { member: string };

export interface Cue {
	kind: CueKind;
	/** 從動作開始算第幾個半拍（0 = 動作開始那一刻）。 */
	at: number;
	/** 幾個半拍長；一拍 = 2，手位一定是 2。 */
	len: number;
	word: string;
	who: Who;
}

/** 拍子只有這兩個字，不能自己打。 */
export const COUNT_WORDS = ['down', 'up'];

/** 一拍幾個半拍。 */
const BEAT = 2;

/** 拍點哪裡不守規則（給教練看的原因）；沒問題是 null。不要求在整拍上（動作被拖半拍時拍點跟著落在 &）。 */
export function cueProblem(segment: Segment, action: Action, cue: Cue): string | null {
	if (segment.kind !== 'music') return '口號段不數拍，不能放拍點';
	if (!CUE_KINDS.includes(cue.kind)) return '沒有這種拍點';
	if (!Number.isInteger(cue.at) || !Number.isInteger(cue.len)) return '拍點要落在半拍上';
	if (cue.len < BEAT || cue.len % BEAT !== 0) return '拍點要佔整數拍，至少 1 拍';
	if (cue.kind === 'motion' && cue.len !== BEAT) return '手位只佔一拍';
	if (cue.at < 0 || cue.at + cue.len > action.length) return '拍點要在動作裡面';
	if (cue.kind === 'count' && !COUNT_WORDS.includes(cue.word)) return '拍子只能是 down 或 up';
	if (!cue.word.trim()) return '請寫拍點的字';
	const who = cue.who;
	if (who !== null && 'role' in who && !action.members.some((m) => m.role === who.role)) {
		return `動作裡沒有人是「${who.role}」`;
	}
	if (who !== null && 'member' in who && !action.members.some((m) => m.memberId === who.member)) {
		return '這個隊員不在動作裡';
	}
	return null;
}

export interface NewCueInput {
	kind: CueKind;
	at: number;
	len: number;
	word: string;
	/** 不給就是全部。 */
	who?: Who;
}

/** 放拍點：同一個動作、同一種、同一個「給誰」裡被蓋到的拍點切短或拿掉。放的時候要對齊音樂的整拍。 */
export function placeCue(flow: Flow, actionId: string, input: NewCueInput): CommandResult {
	const found = find(flow, actionId);
	if (!found) return blocked('找不到這個動作');
	const { action, segment } = found;
	const cue: Cue = { ...input, word: input.word.trim(), who: input.who ?? null };
	const problem = cueProblem(segment, action, cue);
	if (problem) return blocked(problem);
	if ((action.start + cue.at) % BEAT !== 0) return blocked('拍點要放在整拍上');
	const kept = cut(action.cues ?? [], cue.kind, cue.at, cue.at + cue.len, (c) => sameWho(c.who, cue.who));
	return withCues(flow, action, [...kept, cue]);
}

/** 清拍點：把 [from, to) 半拍裡那一種的拍點都清掉，不管給誰；露在外面的部分留著。 */
export function clearCues(
	flow: Flow,
	actionId: string,
	kind: CueKind,
	from: number,
	to: number
): CommandResult {
	const found = find(flow, actionId);
	if (!found) return blocked('找不到這個動作');
	return withCues(flow, found.action, cut(found.action.cues ?? [], kind, from, to, () => true));
}

function find(flow: Flow, actionId: string): { action: Action; segment: Segment } | null {
	const action = flow.actions.find((a) => a.id === actionId);
	const segment = action && flow.segments.find((s) => s.id === action.segmentId);
	return action && segment ? { action, segment } : null;
}

function withCues(flow: Flow, action: Action, cues: Cue[]): CommandResult {
	const sorted = cues.toSorted((a, b) => a.at - b.at);
	return ok({ ...flow, actions: flow.actions.map((a) => (a.id === action.id ? { ...a, cues: sorted } : a)) });
}

/**
 * 把 [from, to) 裡、那一種而且 hit 的拍點切掉；兩邊露出來的留著。
 * 露出來的長度取到整拍（動作被拖半拍後，新舊拍點可能差半拍），不到一拍就拿掉。
 */
function cut(cues: Cue[], kind: CueKind, from: number, to: number, hit: (c: Cue) => boolean): Cue[] {
	return cues.flatMap((c) => {
		if (c.kind !== kind || !hit(c) || c.at >= to || c.at + c.len <= from) return [c];
		const pieces: Cue[] = [];
		if (c.at < from) pieces.push({ ...c, len: from - c.at });
		if (c.at + c.len > to) pieces.push({ ...c, at: to, len: c.at + c.len - to });
		return pieces
			.map((p) => ({ ...p, len: p.len - (p.len % BEAT) }))
			.filter((p) => p.len >= BEAT);
	});
}

function sameWho(a: Who, b: Who): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
