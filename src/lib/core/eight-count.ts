// 八拍表：把流程照八拍一列一列寫下來，給列印用。
// 音樂段一個八拍一列（最後不滿一個八拍也算一列），連著好幾個沒有新東西的八拍合成一列；
// 口號段一整段一列，時間寫秒數。

import { ACTION_CATEGORIES, type ActionCategory } from './action-types';
import { actionEights } from './beat-range';
import { cueForMember, whoName, type CueKind } from './cues';
import { memberName, type Flow } from './flow';
import { formationWalks, memberWalk, type Position, type Walk } from './formation';
import { phaseColor, phaseLabel } from './phase-types';
import {
	HALF_BEATS_PER_BEAT,
	HALF_BEATS_PER_EIGHT,
	atText,
	segmentSpans,
	timeTextWithUnit,
	toSeconds,
	units,
	type TimePosition
} from './time';

/** 八拍表一列裡的一個動作（這一列開始的）。 */
export interface EightCountAction {
	/** 在這一列哪裡開始：音樂段「3」、半拍「3 的 &」；口號段段內秒數「12.3 秒」。 */
	at: string;
	category: ActionCategory;
	categoryLabel: string;
	name: string;
	/** 選一個人時只有他自己。 */
	members: { memberId: string; name: string; role: string | null }[];
	/** 給人看的：全隊都在寫「全隊」，不然「小A（上層）、小B（主底）」。 */
	who: string;
}

/** 八拍表一列裡開始的站位，給畫小站位圖。 */
export interface EightCountFormation {
	/** 第幾張站位（跟時間軸縮圖上的號碼一樣）。 */
	number: number;
	/** 站位名稱，沒取就沒有。 */
	name?: string;
	at: string;
	/** 給人看的：「站位 2 金字塔・第 5 拍」，口號段「站位 3・2.5 秒」。 */
	caption: string;
	pos: Record<string, Position>;
}

/** 八拍表一列裡的一個拍點（只算落在這一列的那一段）。 */
export interface EightCountCue {
	kind: CueKind;
	/** 這一列的第幾格到第幾格（1–8）。 */
	from: number;
	to: number;
	/** 照實寫的拍：「5」「6 到 7」；從 & 開始的「1& 到 2」。 */
	span: string;
	word: string;
	/** 給誰：任務角色或隊員名字；給全部的和個人表是 null。 */
	who: string | null;
}

/** 八拍表一列裡的一個環節（只算落在這一列的那一段；跨列的兩列都寫名字）。 */
export interface EightCountPhase {
	/** 種類和名字：「上法 延伸」，沒取名字就只有種類。 */
	label: string;
	/** 這一列的第幾格到第幾格（1–8）。 */
	from: number;
	to: number;
	/** 環節的顏色（畫面上用；黑白印靠框線和字）。 */
	color: string;
}

/** 八拍表一列裡、一個有拍點或標了拍的環節的動作那一排 8 格。 */
export interface EightCountCueLine {
	categoryLabel: string;
	name: string;
	cues: EightCountCue[];
	/** 這一列的環節，畫在拍點上面一行；環節不分給誰，個人表也一樣。沒標拍的不印。 */
	phases: EightCountPhase[];
}

export interface EightCountRow {
	/** 段名：音樂 1、口號 1… */
	segmentLabel: string;
	/** 第幾個八拍（從 1 起）；口號段整段一列是 null。合起來的列是第一個。 */
	eight: number | null;
	/** 合起來的列的最後一個八拍；沒合起來就跟 eight 一樣。 */
	lastEight: number | null;
	/** 八拍欄：「3」、合起來的「5–8」、口號段「整段 10.0 秒」。 */
	eightText: string;
	/** 這一列開始的全域秒數。 */
	startSec: number;
	/** 這一列多長（秒）；口號段就是整段的秒數。 */
	durationSec: number;
	actions: EightCountAction[];
	formations: EightCountFormation[];
	/** 只印一個隊員時，他在這一列出發的走位：「2-5 出發 → 站位 3（3-1 到達）」。全隊是空的。 */
	walks: string[];
	/** 這一列的拍點：每個在這一列有拍點的動作一排；跨列的拍點兩列各寫自己那一段。 */
	cues: EightCountCueLine[];
}

/**
 * 八拍表的列。memberId 是 null 印全隊；給一個隊員就只列他參加的動作和他的任務角色
 * （列還是每個八拍都有，站位也照樣附）。動作和站位只寫在它開始的那一列。
 */
export function eightCountRows(flow: Flow, memberId: string | null): EightCountRow[] {
	const rows: EightCountRow[] = [];
	const walks = memberId === null ? [] : memberWalks(flow, memberId);
	for (const { segment, label } of segmentSpans(flow)) {
		const inSegment = flow.actions
			.filter((a) => a.segmentId === segment.id)
			.map((a) => ({
				...a,
				members: a.members.filter((m) => memberId === null || m.memberId === memberId)
			}))
			.filter((a) => a.members.length > 0)
			.toSorted((a, b) => a.start - b.start);
		const at = (u: number) =>
			segment.kind === 'music' ? beatText(u) : `${atText(segment, u)} 秒`;
		const rowOf = (from: number, to: number, eight: number | null): EightCountRow => {
			const sec = toSeconds(flow, { segmentId: segment.id, at: from });
			const end = Math.min(to, units(segment));
			const durationSec = toSeconds(flow, { segmentId: segment.id, at: end }) - sec;
			return {
				segmentLabel: label,
				eight,
				lastEight: eight,
				eightText: eight === null ? `整段 ${durationSec.toFixed(1)} 秒` : `${eight}`,
				startSec: sec,
				durationSec,
				actions: inSegment
					.filter((a) => a.start >= from && a.start < to)
					.map((a) => {
						const members = a.members.map((m) => ({
							memberId: m.memberId,
							name: memberName(flow, m.memberId),
							role: m.role
						}));
						const wholeTeam = memberId === null && flow.members.every((m) => members.some((x) => x.memberId === m.id));
						return {
							at: at(a.start),
							category: a.category,
							categoryLabel: categoryLabel(a.category),
							name: a.name,
							members,
							who: wholeTeam
								? '全隊'
								: members.map((m) => (m.role ? `${m.name}（${m.role}）` : m.name)).join('、')
						};
					}),
				formations: flow.formations.flatMap((f, i) => {
					if (f.segmentId !== segment.id || f.at < from || f.at >= to) return [];
					const when = segment.kind === 'music' ? beatWhen(f.at) : at(f.at);
					const caption = `站位 ${i + 1}${f.name ? ` ${f.name}` : ''}・${when}`;
					return [{ number: i + 1, name: f.name, at: at(f.at), caption, pos: f.pos }];
				}),
				walks: walks
					.filter(
						({ walk: { depart } }) =>
							depart.segmentId === segment.id && depart.at >= from && depart.at < to
					)
					.map(({ number, walk }) => {
						const time = (p: TimePosition) => timeTextWithUnit(flow, segment.id, p);
						return `${time(walk.depart)} 出發 → 站位 ${number}（${time(walk.arrive)} 到達）`;
					}),
				cues: inSegment.flatMap((a) => {
					// 個人表只切給他的拍點；口號段整段一列，沒有拍點、標的拍
					const mine = (a.cues ?? []).filter((c) => memberId === null || cueForMember(c, a, memberId));
					const slice = actionEights(a, mine).find((e) => e.eight + 1 === eight);
					const cues = (slice?.cues ?? []).map(({ cue, start, end }) => ({
						kind: cue.kind,
						from: Math.floor(start / HALF_BEATS_PER_BEAT) + 1,
						to: Math.ceil(end / HALF_BEATS_PER_BEAT),
						span: spanText(start, end),
						word: cue.word,
						who: memberId === null ? whoName(flow, cue.who) || null : null
					}));
					const phases = (slice?.phases ?? []).map(({ phase, start, end }) => ({
						label: phaseLabel(phase),
						from: Math.floor(start / HALF_BEATS_PER_BEAT) + 1,
						to: Math.ceil(end / HALF_BEATS_PER_BEAT),
						color: phaseColor(phase)
					}));
					return cues.length || phases.length
						? [{ categoryLabel: categoryLabel(a.category), name: a.name, cues, phases }]
						: [];
				})
			};
		};
		if (segment.kind === 'music') {
			for (let from = 0; from < segment.halfBeats; from += HALF_BEATS_PER_EIGHT) {
				const row = rowOf(from, from + HALF_BEATS_PER_EIGHT, from / HALF_BEATS_PER_EIGHT + 1);
				const prev = rows.at(-1);
				// 連著沒有新東西的八拍合成一列（同一段裡）
				if (prev && prev.segmentLabel === label && prev.eight !== null && isEmpty(prev) && isEmpty(row)) {
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

/** 這一列沒有新東西：沒有動作開始、沒有站位、沒有走位、沒有拍點或環節。 */
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

function categoryLabel(category: ActionCategory): string {
	return ACTION_CATEGORIES.find((c) => c.key === category)?.label ?? '';
}

/**
 * 一列裡 [start, end) 半拍照實寫，兩頭是佔到的第一個和最後一個半拍：整拍開始的「6 到 7」（最後一拍佔到它的 &），
 * 從 & 開始的「1& 到 2」；只有一拍（或半拍）就只寫一個。
 */
function spanText(start: number, end: number): string {
	const half = (h: number) => `${Math.floor(h / HALF_BEATS_PER_BEAT) + 1}${h % 2 === 1 ? '&' : ''}`;
	const last = end - 1;
	const first = half(start);
	// 整拍開始、佔到最後一拍的 &：寫那一拍就好
	const lastText = start % 2 === 0 && last % 2 === 1 ? half(last - 1) : half(last);
	return lastText === first ? first : `${first} 到 ${lastText}`;
}

/** 站位在八拍裡的哪一拍：「第 5 拍」，半拍「第 3 拍的 &」。 */
function beatWhen(at: number): string {
	const beat = (Math.floor(at / 2) % 8) + 1;
	return at % 2 === 1 ? `第 ${beat} 拍的 &` : `第 ${beat} 拍`;
}

/** 八拍裡的第幾拍：「3」，半拍「3 的 &」。 */
function beatText(at: number): string {
	const beat = (Math.floor(at / 2) % 8) + 1;
	return at % 2 === 1 ? `${beat} 的 &` : `${beat}`;
}
