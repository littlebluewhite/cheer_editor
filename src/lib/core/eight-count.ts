// 八拍表：把流程照八拍一列一列寫下來，給列印用。
// 音樂段一個八拍一列（最後不滿一個八拍也算一列），連著好幾個沒有新東西的八拍合成一列；
// 口號段一整段一列，時間寫秒數。

import { actionLabel, actionNameWhy, actionWhy, type Action, type ActionCategory } from './action-types';
import { actionEights, beatSpanWhy } from './beat-range';
import { cueForMember, whoWhy, type CueKind } from './cues';
import type { Rect } from './field';
import { memberName, type Flow } from './flow';
import { currentFormation, formationWalks, memberWalk, type Position, type Walk } from './formation';
import { phaseColor, phaseWhy } from './phase-types';
import { roleWhy } from './roles';
import { squadNumber } from './success-rate';
import {
	EPS,
	HALF_BEATS_PER_BEAT,
	HALF_BEATS_PER_EIGHT,
	atText,
	atWhy,
	labelWhy,
	lengthWhy,
	segmentSpans,
	timeWhy,
	toPosition,
	toSeconds,
	units,
	type TimePosition
} from './time';
import { joined, zh, type Why, type WhyParam } from './why';

/** 八拍表一列裡的一個動作（這一列開始的）。 */
export interface EightCountAction {
	/** 什麼時候：音樂段跟拍點小窗一樣寫「1-3& 到 2-2&・8 拍」；口號段段內秒數和長度「12.3 到 14.3 秒・2.0 秒」。 */
	at: WhyParam;
	category: ActionCategory;
	name: string;
	/** 選一個人時只有他自己。 */
	members: { memberId: string; name: string; role: string | null }[];
	/**
	 * 給人看的。全隊的表：「小A（上層）、小B（主底）」，全隊都在寫「全隊」（有任務角色就接著列「全隊：小A（上層）…」）。
	 * 個人表不寫名字：「主底・第 2 組・同組：小A（上層）」，沒角色也沒分組是空的。
	 */
	who: WhyParam;
	/** 動作的備註，沒寫是空的。 */
	note: string;
}

/** 八拍表一列裡開始的站位，給畫小站位圖。 */
export interface EightCountFormation {
	/** 第幾張站位（跟時間軸縮圖上的號碼一樣）。 */
	number: number;
	/** 站位名稱，沒取就沒有。 */
	name?: string;
	at: WhyParam;
	/**
	 * 給人看的：「站位 2 金字塔・2-5」，口號段「站位 3・2.5 秒」。有人走過來時後面寫出發：「站位 2・3-1（2-1 出發）」，
	 * 大家出發不一樣寫最早的「（最早 2-1 出發）」；個人表只看他自己的走位。
	 */
	caption: Why;
	pos: Record<string, Position>;
}

/** 八拍表一列裡的一個拍點（只算落在這一列的那一段）。 */
export interface EightCountCue {
	kind: CueKind;
	/** 這一列的第幾格到第幾格（1–8）。 */
	from: number;
	to: number;
	/** 這一列的第幾個半拍到第幾個半拍（0–16，不含 end）：從 & 開始、結束的拍點佔不滿頭尾那兩格。 */
	start: number;
	end: number;
	/** 整個拍點，跟拍點小窗一樣：「1-6 到 1-7・2 拍」「2-1&・1 拍」（跨列的兩列都寫整個）。 */
	span: WhyParam;
	/** 從 & 開始的拍點在開始那一列寫在字前面的拍：「1-1&」（格子只能整格）；其他是空的。 */
	lead: string;
	/** 從上一列接過來的那一段：不再寫字和給誰。 */
	continued: boolean;
	/** 拍點的字（流程檔存的；給人看用 cueWordWhy）。 */
	word: string;
	/** 給誰：任務角色或隊員名字；給全部的和個人表是 null。 */
	who: WhyParam | null;
}

/** 八拍表一列裡的一個環節（只算落在這一列的那一段；跨列的兩列都寫名字）。 */
export interface EightCountPhase {
	/** 種類和名字：「上法 延伸」，沒取名字就只有種類。 */
	label: WhyParam;
	/** 這一列的第幾格到第幾格（1–8）。 */
	from: number;
	to: number;
	/** 環節的顏色（畫面上用；黑白印靠框線和字）。 */
	color: string;
	/** 第幾排（從 0 起）：金字塔疊著的環節往下多一排，跟拍點格子同一排（流程核心整個動作算一次）。沒疊就是 0。 */
	row: number;
}

/** 八拍表一列裡、一個有拍點或標了拍的環節的動作那一排 8 格。 */
export interface EightCountCueLine {
	category: ActionCategory;
	name: string;
	cues: EightCountCue[];
	/** 這一列的環節，畫在拍點上面一行；環節不分給誰，個人表也一樣。沒標拍的不印。 */
	phases: EightCountPhase[];
}

/** 前後八拍一列裡的一個動作那一排（這一列開始的和做到一半的都有）：佔第幾格到第幾格，加上拍點和環節。 */
export interface EightCountLane extends EightCountCueLine {
	actionId: string;
	/** 這一列的第幾格到第幾格（1–8）；口號段不數拍是 1 到 8。 */
	from: number;
	to: number;
	/** 前面的列開始、做到這一列的。 */
	continued: boolean;
	/** 個人表寫他的任務角色；全隊和沒角色是空的。 */
	role: WhyParam;
}

export interface EightCountRow {
	/** 段名：音樂 1、口號 1…（認段用；給人看用 segmentWhy） */
	segmentLabel: string;
	/** 段名給人看（畫面照語言寫）。 */
	segmentWhy: Why;
	/** 第幾個八拍（從 1 起）；口號段整段一列是 null。合起來的列是第一個。 */
	eight: number | null;
	/** 合起來的列的最後一個八拍；沒合起來就跟 eight 一樣。 */
	lastEight: number | null;
	/** 八拍欄：「3」、合起來的「5–8」、口號段「整段 10.0 秒」。 */
	eightText: WhyParam;
	/** 這一列開始的全域秒數。 */
	startSec: number;
	/** 這一列多長（秒）；口號段就是整段的秒數。 */
	durationSec: number;
	actions: EightCountAction[];
	/** 前面的列開始、延續到這一列的動作名字（沒取名字寫大類），印成「↳ Lib 繼續」。 */
	continuing: WhyParam[];
	formations: EightCountFormation[];
	/** 只印一個隊員時，他在這一列出發的走位：「2-5 出發 → 站位 3（3-1 到達）」。全隊是空的。 */
	walks: Why[];
	/** 這一列的拍點：每個在這一列有拍點的動作一排；跨列的拍點兩列各寫自己那一段。 */
	cues: EightCountCueLine[];
	/** 檢視模式的前後八拍：這一列碰到的每個動作一排（沒拍點的也有）。 */
	lanes: EightCountLane[];
}

/**
 * 八拍表的列。memberId 是 null 印全隊；給一個隊員就只列他參加的動作和他的任務角色
 * （列還是每個八拍都有，站位也照樣附）。動作和站位只寫在它開始的那一列。
 */
export function eightCountRows(flow: Flow, memberId: string | null, merge = true): EightCountRow[] {
	const rows: EightCountRow[] = [];
	const walks = memberId === null ? [] : memberWalks(flow, memberId);
	const original = (id: string) => flow.actions.find((a) => a.id === id)!;
	for (const span of segmentSpans(flow)) {
		const { segment, label } = span;
		const inSegment = flow.actions
			.filter((a) => a.segmentId === segment.id)
			.map((a) => ({
				...a,
				members: a.members.filter((m) => memberId === null || m.memberId === memberId)
			}))
			.filter((a) => a.members.length > 0)
			.toSorted((a, b) => a.start - b.start);
		const at = (u: number) => atWhy(segment, u);
		const describe = (a: (typeof inSegment)[number]): EightCountAction => ({
			at:
				segment.kind === 'music'
					? beatSpanWhy(segment, a.start, a.length)
					: { code: 'eight_count_chant_span', at: atText(segment, a.start), end: at(a.start + a.length), length: lengthWhy(segment, a.length) },
			category: a.category,
			name: a.name,
			members: a.members.map((m) => ({
				memberId: m.memberId,
				name: memberName(flow, m.memberId),
				role: m.role
			})),
			who: memberId === null ? teamWho(flow, a) : memberWho(flow, original(a.id), memberId),
			note: a.note
		});
		const rowOf = (from: number, to: number, eight: number | null): EightCountRow => {
			const sec = toSeconds(flow, { segmentId: segment.id, at: from });
			const end = Math.min(to, units(segment));
			const durationSec = toSeconds(flow, { segmentId: segment.id, at: end }) - sec;
			const carried = inSegment.filter((a) => a.start < from && a.start + a.length > from);
			const lanes = inSegment
				.filter((a) => a.start < to && a.start + a.length > from)
				.map((a): EightCountLane => {
					// 個人表只切給他的拍點；口號段整段一列，沒有拍點、標的拍
					const mine = (a.cues ?? []).filter((c) => memberId === null || cueForMember(c, a, memberId));
					const slice = actionEights(a, mine).find((e) => e.eight + 1 === eight);
					const cues = (slice?.cues ?? []).map(({ cue, start, end, first }) => ({
						kind: cue.kind,
						from: Math.floor(start / HALF_BEATS_PER_BEAT) + 1,
						to: Math.ceil(end / HALF_BEATS_PER_BEAT),
						start,
						end,
						span: beatSpanWhy(segment, a.start + cue.at, cue.len),
						lead: first && (a.start + cue.at) % HALF_BEATS_PER_BEAT === 1 ? atText(segment, a.start + cue.at) : '',
						continued: !first,
						word: cue.word,
						who: memberId === null ? whoWhy(flow, cue.who) || null : null
					}));
					const phases = (slice?.phases ?? []).map(({ phase, start, end, row }) => ({
						label: phaseWhy(phase),
						from: Math.floor(start / HALF_BEATS_PER_BEAT) + 1,
						to: Math.ceil(end / HALF_BEATS_PER_BEAT),
						color: phaseColor(phase),
						row
					}));
					const music = eight !== null;
					return {
						actionId: a.id,
						category: a.category,
						name: a.name,
						from: music ? Math.floor((Math.max(a.start, from) - from) / HALF_BEATS_PER_BEAT) + 1 : 1,
						to: music ? Math.ceil((Math.min(a.start + a.length, to) - from) / HALF_BEATS_PER_BEAT) : 8,
						continued: a.start < from,
						role: memberId !== null && a.members[0]?.role ? roleWhy(a.members[0].role) : '',
						cues,
						phases
					};
				});
			return {
				segmentLabel: label,
				segmentWhy: labelWhy(span),
				eight,
				lastEight: eight,
				eightText: eight === null ? { code: 'eight_count_whole_segment', n: durationSec.toFixed(1) } : `${eight}`,
				startSec: sec,
				durationSec,
				actions: inSegment.filter((a) => a.start >= from && a.start < to).map(describe),
				continuing: carried.map(actionNameWhy),
				formations: flow.formations.flatMap((f, i) => {
					if (f.segmentId !== segment.id || f.at < from || f.at >= to) return [];
					return [{ number: i + 1, name: f.name, at: at(f.at), caption: caption(flow, i, at(f.at), memberId), pos: f.pos }];
				}),
				walks: walks
					.filter(
						({ walk: { depart } }) =>
							depart.segmentId === segment.id && depart.at >= from && depart.at < to
					)
					.map(({ number, walk }): Why => {
						const time = (p: TimePosition) => timeWhy(flow, segment.id, p);
						return { code: 'eight_count_walk', depart: time(walk.depart), n: number, arrive: time(walk.arrive) };
					}),
				cues: lanes.filter((l) => l.cues.length || l.phases.length).map(({ category, name, cues, phases }) => ({ category, name, cues, phases })),
				lanes
			};
		};
		if (segment.kind === 'music') {
			for (let from = 0; from < segment.halfBeats; from += HALF_BEATS_PER_EIGHT) {
				const row = rowOf(from, from + HALF_BEATS_PER_EIGHT, from / HALF_BEATS_PER_EIGHT + 1);
				const prev = rows.at(-1);
				// 連著沒有新東西、延續的動作也一樣的八拍合成一列（同一段裡）
				if (
					merge &&
					prev &&
					prev.segmentLabel === label &&
					prev.eight !== null &&
					isEmpty(prev) &&
					isEmpty(row) &&
					JSON.stringify(prev.continuing) === JSON.stringify(row.continuing)
				) {
					prev.lastEight = row.eight;
					prev.eightText = `${prev.eight}–${row.eight}`;
					prev.durationSec += row.durationSec;
				} else {
					rows.push(row);
				}
			}
		} else {
			rows.push(rowOf(0, segment.tenths, null));
		}
	}
	return rows;
}

/** 前後八拍：播放頭那個八拍和它前後幾個八拍（見 nearbyEights）。 */
export interface NearbyEights {
	/** before ＋ 1 ＋ after 格，播放頭那個八拍在第 before 格；流程開頭、結尾不夠的格是 null。 */
	rows: (EightCountRow | null)[];
	/** 播放頭在這個八拍的第幾拍（1–8）；口號段不數拍是 null。 */
	beat: number | null;
	/** 播放頭在這個八拍的第幾個半拍（0–15，對 EightCountCue 的 start、end）；口號段是 null。 */
	half: number | null;
}

/**
 * 前後八拍：檢視模式跟著播放頭看的那幾列。一個八拍一列（空的八拍不合起來，才數得出前後幾個），
 * 可以跨段；口號段整段一列。rows 是 eightCountRows(flow, memberId, false)，跟著流程和「我」先算好傳進來。
 */
export function nearbyEights(
	flow: Flow,
	memberId: string | null,
	sec: number,
	before: number,
	after: number,
	rows: EightCountRow[] = eightCountRows(flow, memberId, false)
): NearbyEights {
	const i = Math.max(rows.findLastIndex((r) => r.startSec <= sec + EPS), 0);
	const slots = Array.from({ length: before + 1 + after }, (_, k) => rows[i - before + k] ?? null);
	const pos = rows.length ? toPosition(flow, sec) : null;
	const segment = pos && flow.segments.find((s) => s.id === pos.segmentId);
	const half = segment?.kind === 'music' ? Math.floor(pos!.at % HALF_BEATS_PER_EIGHT) : null;
	const beat = half === null ? null : Math.floor(half / HALF_BEATS_PER_BEAT) + 1;
	return { rows: slots, beat, half };
}

/**
 * 檢視模式場地角落寫的站位：播放頭這一刻的「站位 13 三層直下」。
 * 已經有人出發往下一張走了，就寫要去的那張，前面加箭頭「→ 站位 14 …」；到了就拿掉箭頭。
 */
export function formationNowWhy(flow: Flow, sec: number): Why {
	const { formation, number } = currentFormation(flow, sec);
	const next = flow.formations[number];
	const text = (n: number, f: { name?: string }): Why =>
		f.name ? { code: 'eight_count_formation_now_named', n, name: f.name } : { code: 'eight_count_formation_now', n };
	if (next && formationWalks(flow, next.id).some((w) => w.departSec <= sec + EPS)) {
		return { code: 'eight_count_formation_next', formation: text(number + 1, next) };
	}
	return text(number, formation);
}

/**
 * 手機的檢視畫面點了圓點，場地角落寫的那個人：名字，和播放頭這個八拍他做的動作、任務角色「小A　技巧·Lib 主底」；
 * 這個八拍他沒事只寫名字。任務角色跟動作同名（騰翻的「騰翻」）不重複寫。
 * rows 是 eightCountRows(flow, memberId, false)，跟著流程和點到的人先算好傳進來（播放時每一格畫面都問）。
 */
export function memberNowWhy(
	flow: Flow,
	memberId: string,
	sec: number,
	rows: EightCountRow[] = eightCountRows(flow, memberId, false)
): WhyParam {
	const row = nearbyEights(flow, memberId, sec, 0, 0, rows).rows[0];
	const doing = (row?.lanes ?? []).map((l): WhyParam => {
		const action = actionWhy(l);
		// 比的是存的中文（任務角色「騰翻」和大類「騰翻」同名）
		return l.role && zhOf(l.role) !== actionLabel(l) ? { code: 'eight_count_doing_role', action, role: l.role } : action;
	});
	return joined('eight_count_now_parts', [memberName(flow, memberId), ...doing]);
}

const zhOf = (text: WhyParam) => (typeof text === 'object' ? zh(text) : String(text));

/** 一串接成「小A、小B」（parts 不能是空的）。 */
const listed = (parts: WhyParam[]) => joined('members_list', parts);

const withRole = (m: { name: string; role: string | null }): WhyParam =>
	m.role ? { code: 'eight_count_with_role', name: m.name, role: roleWhy(m.role) } : m.name;

/** 全隊的表：「小A（上層）、小C」；全隊都在寫「全隊」，有任務角色再列出來「全隊：小A（上層）、小B（主底）」。 */
export function teamWho(flow: Flow, action: Action): WhyParam {
	const members = action.members.map((m) => ({ name: memberName(flow, m.memberId), role: m.role }));
	const wholeTeam = flow.members.every((m) => action.members.some((x) => x.memberId === m.id));
	if (!wholeTeam) return members.length ? listed(members.map(withRole)) : '';
	const roles = members.filter((m) => m.role);
	return roles.length ? { code: 'eight_count_whole_team_roles', members: listed(roles.map(withRole)) } : { code: 'eight_count_whole_team' };
}

/** 個人表：不寫他的名字，寫他的任務角色、第幾組和同組的人：「主底・第 2 組・同組：小A（上層）」；都沒有是空的。 */
function memberWho(flow: Flow, action: Action, memberId: string): WhyParam {
	const me = action.members.find((m) => m.memberId === memberId)!;
	const parts: WhyParam[] = me.role ? [roleWhy(me.role)] : [];
	if (me.squad) {
		const n = squadNumber(action, me.squad);
		if (n) parts.push({ code: 'success_rate_squad', n });
		const mates = action.members
			.filter((m) => m.squad === me.squad && m.memberId !== memberId)
			.map((m) => withRole({ name: memberName(flow, m.memberId), role: m.role }));
		if (mates.length) parts.push({ code: 'eight_count_mates', mates: listed(mates) });
	}
	return parts.length ? joined('eight_count_parts', parts) : '';
}

/**
 * 八拍表小站位圖的範圍（公尺）：所有站位裡有人的地方合起來，同一張表每張圖都用它，才比得出前後張的差別。
 * 哪一張都沒有人是 null（畫整個場地）。
 */
export function eightCountView(flow: Flow): Rect | null {
	const placed = flow.formations.flatMap((f) => Object.values(f.pos));
	if (!placed.length) return null;
	const xs = placed.map(([x]) => x);
	const ys = placed.map(([, y]) => y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** 八拍表的站位說明（見 EightCountFormation.caption）：「站位 2 金字塔・2-5（2-1 出發）」。 */
function caption(flow: Flow, index: number, at: WhyParam, memberId: string | null): Why {
	const f = flow.formations[index];
	const depart = departWhy(flow, f.id, memberId);
	const n = index + 1;
	if (depart) {
		return f.name ? { code: 'eight_count_caption_named_depart', n, name: f.name, at, depart } : { code: 'eight_count_caption_depart', n, at, depart };
	}
	return f.name ? { code: 'eight_count_caption_named', n, name: f.name, at } : { code: 'eight_count_caption', n, at };
}

/** 走到這張站位的出發：「2-1 出發」「最早 2-1 出發」；沒人走是 null。 */
function departWhy(flow: Flow, formationId: string, memberId: string | null): Why | null {
	const walks = formationWalks(flow, formationId).filter((w) => memberId === null || w.memberId === memberId);
	if (!walks.length) return null;
	const first = walks.reduce((a, b) => (b.departSec < a.departSec ? b : a));
	const late = walks.some((w) => w.departSec > first.departSec + EPS);
	const home = flow.formations.find((f) => f.id === formationId)!.segmentId!;
	const at = timeWhy(flow, home, memberWalk(flow, formationId, first.memberId)!.depart);
	return { code: late ? 'eight_count_depart_earliest' : 'eight_count_depart', at };
}

/** 這一列沒有新東西：沒有動作開始、沒有站位、沒有走位、沒有拍點或環節（只有延續的動作也算）。 */
function isEmpty(row: EightCountRow): boolean {
	return !row.actions.length && !row.formations.length && !row.walks.length && !row.cues.length;
}

/** 一個隊員的每一次走位（A、B 位置不一樣才算），number 是到達那張站位的號碼。 */
function memberWalks(flow: Flow, memberId: string): { number: number; walk: Walk }[] {
	return flow.formations.flatMap((b, i) =>
		formationWalks(flow, b.id).some((w) => w.memberId === memberId)
			? [{ number: i + 1, walk: memberWalk(flow, b.id, memberId)! }]
			: []
	);
}
