// 八拍表：把流程照八拍一列一列寫下來，給列印用。
// 音樂段一個八拍一列（最後不滿一個八拍也算一列）；口號段一整段一列，時間寫秒數。

import { ACTION_CATEGORIES, type ActionCategory } from './actions';
import { memberName, type Flow } from './flow';
import { formationWalks, memberWalk, type Position, type Walk } from './formation';
import {
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
}

/** 八拍表一列裡開始的站位，給畫小站位圖。 */
export interface EightCountFormation {
	/** 第幾張站位（跟時間軸縮圖上的號碼一樣）。 */
	number: number;
	at: string;
	pos: Record<string, Position>;
}

export interface EightCountRow {
	/** 段名：音樂 1、口號 1… */
	segmentLabel: string;
	/** 第幾個八拍（從 1 起）；口號段整段一列是 null。 */
	eight: number | null;
	/** 這一列開始的全域秒數。 */
	startSec: number;
	/** 這一列多長（秒）；口號段就是整段的秒數。 */
	durationSec: number;
	actions: EightCountAction[];
	formations: EightCountFormation[];
	/** 只印一個隊員時，他在這一列出發的走位：「2-5 出發 → 站位 3（3-1 到）」。全隊是空的。 */
	walks: string[];
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
			return {
				segmentLabel: label,
				eight,
				startSec: sec,
				durationSec: toSeconds(flow, { segmentId: segment.id, at: end }) - sec,
				actions: inSegment
					.filter((a) => a.start >= from && a.start < to)
					.map((a) => ({
						at: at(a.start),
						category: a.category,
						categoryLabel: ACTION_CATEGORIES.find((c) => c.key === a.category)?.label ?? '',
						name: a.name,
						members: a.members.map((m) => ({
							memberId: m.memberId,
							name: memberName(flow, m.memberId),
							role: m.role
						}))
					})),
				formations: flow.formations.flatMap((f, i) =>
					f.segmentId === segment.id && f.at >= from && f.at < to
						? [{ number: i + 1, at: at(f.at), pos: f.pos }]
						: []
				),
				walks: walks
					.filter(
						({ walk: { depart } }) =>
							depart.segmentId === segment.id && depart.at >= from && depart.at < to
					)
					.map(({ number, walk }) => {
						const time = (p: TimePosition) => timeTextWithUnit(flow, segment.id, p);
						return `${time(walk.depart)} 出發 → 站位 ${number}（${time(walk.arrive)} 到）`;
					})
			};
		};
		if (segment.kind === 'music') {
			for (let from = 0; from < segment.halfBeats; from += HALF_BEATS_PER_EIGHT) {
				rows.push(rowOf(from, from + HALF_BEATS_PER_EIGHT, from / HALF_BEATS_PER_EIGHT + 1));
			}
		} else {
			rows.push(rowOf(0, segment.tenths, null));
		}
	}
	return rows;
}

/** 一個隊員的每一次走位（A、B 位置不一樣才算），number 是到達那張站位的號碼。 */
function memberWalks(flow: Flow, memberId: string): { number: number; walk: Walk }[] {
	return flow.formations.flatMap((b, i) =>
		formationWalks(flow, b.id).some((w) => w.memberId === memberId)
			? [{ number: i + 1, walk: memberWalk(flow, b.id, memberId)! }]
			: []
	);
}

/** 八拍裡的第幾拍：「3」，半拍「3 的 &」。 */
function beatText(at: number): string {
	const beat = (Math.floor(at / 2) % 8) + 1;
	return at % 2 === 1 ? `${beat} 的 &` : `${beat}`;
}
