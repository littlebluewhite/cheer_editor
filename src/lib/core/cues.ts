// 拍點：動作裡從某一拍開始、佔幾拍的提示，分拍子、步驟、手位三種。
// 存在動作裡、從動作開始算半拍，所以拖動作、改 BPM 時跟著走；刪動作時一起刪。

import { replaceAction, type Action } from './action-types';
import { cutOut, fitRange, rangeProblem, rangeText } from './beat-range';
import { memberName, type Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import type { Segment } from './segment';
import {
	atText,
	EPS,
	HALF_BEATS_PER_BEAT as BEAT,
	HALF_BEATS_PER_EIGHT,
	toSeconds,
	unitSec
} from './time';

/** 拍子、步驟、手位。 */
export type CueKind = 'count' | 'step' | 'motion';
export const CUE_KINDS: CueKind[] = ['count', 'step', 'motion'];

/** 給教練看的種類名稱。 */
export const CUE_KIND_LABELS: Record<CueKind, string> = { count: '拍子', step: '步驟', motion: '手位' };

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
/** 內建的步驟；也可以自己打字。 */
export const STEP_WORDS = ['下手', '落地', '放', '上', '直下', '跳'];
/** 內建的手位；也可以自己打字。 */
export const MOTION_WORDS = ['high V', 'low V', 'T', 'touchdown', 'K', 'L', 'diagonal', '雙手並攏'];

/** 這支流程用過、不是內建的步驟和手位（照第一次出現的順序），表單把它們變成按鈕。 */
export function usedWords(flow: Flow): { step: string[]; motion: string[] } {
	const words = (kind: CueKind, builtIn: string[]) => [
		...new Set(
			flow.actions.flatMap((a) =>
				(a.cues ?? []).filter((c) => c.kind === kind && !builtIn.includes(c.word)).map((c) => c.word)
			)
		)
	];
	return { step: words('step', STEP_WORDS), motion: words('motion', MOTION_WORDS) };
}

/** 拍點給不給這個人：給全部的，動作裡每個人都算；給角色的，算動作裡是這個角色的人；給隊員的，只算那個人。 */
export function cueForMember(cue: Cue, action: Action, memberId: string): boolean {
	const member = action.members.find((m) => m.memberId === memberId);
	if (!member) return false;
	const who = cue.who;
	if (who === null) return true;
	return 'role' in who ? member.role === who.role : who.member === memberId;
}

/** 拿掉給到沒人的拍點（給的隊員不在動作裡、動作裡沒人是那個角色），例如刪隊員之後。 */
export function dropOrphanCues(action: Action): Action {
	if (!action.cues) return action;
	return { ...action, cues: action.cues.filter((c) => givenToSomeone(c, action)) };
}

/** 動作裡有沒有人要做這個拍點。 */
function givenToSomeone(cue: Cue, action: Action): boolean {
	return action.members.some((m) => cueForMember(cue, action, m.memberId));
}

/** 拍點排的順序：步驟、拍子、手位。 */
const KIND_ORDER: CueKind[] = ['step', 'count', 'motion'];

export interface LiveCues {
	action: Action;
	/** 現在亮著的拍點，和走到第幾拍（從 1 起）、一共幾拍。依步驟、拍子、手位排。 */
	now: { cue: Cue; beat: number; beats: number }[];
	/** 下一個拍點在哪一拍（例：「3-7」）；同一拍開始的都在 cues 裡。沒有了是 null。 */
	next: { at: string; cues: Cue[] } | null;
}

/**
 * 這一刻（全域秒數）的拍點：每個有拍點的動作一份，現在亮哪些、下一個是什麼。
 * 動作開始前一個八拍就開始預告；最後一個拍點過了也留著（沒有亮的、也沒有下一個），動作結束那一刻起才不出現。
 * 口號段沒有拍點。場地的大字用它。
 */
export function cuesAt(flow: Flow, sec: number): LiveCues[] {
	const byKind = (a: Cue, b: Cue) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
	return flow.actions.flatMap((action) => {
		const segment = flow.segments.find((s) => s.id === action.segmentId);
		if (!segment || segment.kind !== 'music' || !action.cues?.length) return [];
		// 從動作開始算第幾個半拍（可以是小數、可以是負的）。
		const rel = (sec - toSeconds(flow, { segmentId: segment.id, at: action.start })) / unitSec(segment) + EPS;
		if (rel < -HALF_BEATS_PER_EIGHT || rel >= action.length) return [];
		const now = action.cues
			.filter((c) => c.at <= rel && rel < c.at + c.len)
			.toSorted(byKind)
			.map((cue) => ({ cue, beat: Math.floor((rel - cue.at) / BEAT) + 1, beats: cue.len / BEAT }));
		const later = action.cues.filter((c) => c.at > rel).map((c) => c.at);
		const nextAt = later.length ? Math.min(...later) : undefined;
		const next =
			nextAt === undefined
				? null
				: {
						at: atText(segment, action.start + nextAt),
						cues: action.cues.filter((c) => c.at === nextAt).toSorted(byKind)
					};
		return [{ action, now, next }];
	});
}

/** 拍點哪裡不守規則（給教練看的原因）；沒問題是 null。不要求在整拍上（拍的範圍的規則在 beat-range）。 */
export function cueProblem(segment: Segment, action: Action, cue: Cue): string | null {
	if (segment.kind !== 'music') return '口號段不數拍，不能放拍點';
	if (!CUE_KINDS.includes(cue.kind)) return '沒有這種拍點';
	const problem = rangeProblem('cue', action, cue);
	if (problem) return problem;
	if (cue.kind === 'motion' && cue.len !== BEAT) return '手位只佔一拍';
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

/** 放拍點：同一個動作、同一種、同一個「給誰」裡被蓋到的拍點切短或拿掉。可以落在 &（例：在動作被拖半拍後的拍點上換字）。 */
export function placeCue(flow: Flow, actionId: string, input: NewCueInput): CommandResult {
	const found = find(flow, actionId);
	if (!found) return blocked('找不到這個動作');
	const { action, segment } = found;
	const cue: Cue = { ...input, word: input.word.trim(), who: input.who ?? null };
	const problem = cueProblem(segment, action, cue);
	if (problem) return blocked(problem);
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

/**
 * 改動作會動到的拍點：換到口號段全部拿掉；給的人或角色已經不在動作裡的拿掉（orphaned 算這種有幾個）；
 * 變短時跨出去的切短（取到整拍，不到一拍拿掉）、整個在外面的拿掉。
 * 沒動到任何拍點是 null；不然回傳剩下的拍點、拿掉和切短幾個，和給教練確認的清單（時間照改之前的位置寫）。
 */
export function cueFallout(
	from: Segment,
	to: Segment,
	before: Action,
	after: Action,
	flow: Flow
): { cues: Cue[]; removed: number; cut: number; orphaned: number; items: string[] } | null {
	const kept: Cue[] = [];
	const items: string[] = [];
	let removed = 0;
	let orphaned = 0;
	for (const c of before.cues ?? []) {
		const text = cueText(c.kind, c.word, rangeText(from, before, c.at, c.len), whoName(flow, c.who));
		if (to.kind === 'music' && !givenToSomeone(c, after)) {
			removed++;
			orphaned++;
			items.push(`拿掉：${text}`);
			continue;
		}
		const fitted = to.kind === 'music' ? fitRange('cue', after, c)?.len : undefined;
		if (fitted === c.len) {
			kept.push(c);
		} else if (fitted) {
			kept.push({ ...c, len: fitted });
			items.push(`切短：${text} → ${rangeText(from, before, c.at, fitted)}`);
		} else {
			removed++;
			items.push(`拿掉：${text}`);
		}
	}
	return items.length ? { cues: kept, removed, cut: items.length - removed, orphaned, items } : null;
}

/** 給誰的名字：角色名或隊員名；給全部的是空字串。 */
export function whoName(flow: Flow, who: Who): string {
	return who === null ? '' : 'role' in who ? who.role : memberName(flow, who.member);
}

/** 「拍子 down 1-3 到 1-4」；span 是時間那段的字，who 是給誰的名字（空的不寫），有就接「・給上層」。 */
export function cueText(kind: CueKind, word: string, span: string, who: string): string {
	return `${CUE_KIND_LABELS[kind]} ${word} ${span}${who ? `・給${who}` : ''}`;
}

function find(flow: Flow, actionId: string): { action: Action; segment: Segment } | null {
	const action = flow.actions.find((a) => a.id === actionId);
	const segment = action && flow.segments.find((s) => s.id === action.segmentId);
	return action && segment ? { action, segment } : null;
}

function withCues(flow: Flow, action: Action, cues: Cue[]): CommandResult {
	const sorted = cues.toSorted((a, b) => a.at - b.at);
	return ok(replaceAction(flow, { ...action, cues: sorted }));
}

/** 把 [from, to) 裡、那一種而且 hit 的拍點切掉；兩邊露出來的都留著（取到整拍，見 cutOut）。 */
function cut(cues: Cue[], kind: CueKind, from: number, to: number, hit: (c: Cue) => boolean): Cue[] {
	return cues.flatMap((c) => {
		const pieces = c.kind === kind && hit(c) ? cutOut(c, from, to) : null;
		return pieces ? pieces.map((p) => ({ ...c, ...p })) : [c];
	});
}

/** 給的是不是同一群人。 */
export function sameWho(a: Who, b: Who): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
