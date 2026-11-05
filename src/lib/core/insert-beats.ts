// 插入八拍：在一個段的某一拍空出幾拍（音樂段幾個半拍、口號段幾個 0.1 秒），
// 這個段裡在那之後的站位、動作（拍點記在動作裡，跟著走）、走位的出發和到達一起往後延。
// 段不變長：後面的東西超過段尾就擋下。

import { actionLabel } from './action-types';
import type { Flow } from './flow';
import type { Walk } from './formation';
import { blocked, ok, type CommandResult } from './result';
import { lengthTextWithUnit, units, type TimePosition } from './time';

/**
 * 在 at 插入 length 格：這一段裡從 at 起（含 at）開始的站位、動作、出發、到達都晚 length 格。
 * 在 at 以前開始、跨過 at 的動作不動；開頭那張站位不動。
 * 擋下：length 不是正整數、at 不在段的格子上、有東西會超過段尾（說卡最緊的那個和最多插多少）。
 */
export function insertBeats(flow: Flow, at: TimePosition, length: number): CommandResult {
	const segment = flow.segments.find((s) => s.id === at.segmentId);
	if (!segment) return blocked('找不到這一段');
	if (!Number.isInteger(length) || length < 1) return blocked('插入的長度要大於 0');
	const end = units(segment);
	if (!Number.isInteger(at.at) || at.at < 0 || at.at >= end) return blocked('插入的地方不在這一段裡');

	const moves = (p: TimePosition) => p.segmentId === at.segmentId && p.at >= at.at;
	const later = (p: TimePosition): TimePosition => (moves(p) ? { ...p, at: p.at + length } : p);
	// 卡最緊的那個：往後延之後還能再晚幾格（站位、出發和到達要在段裡，動作的結尾可以剛好是段尾）
	const rooms: { name: string; room: number }[] = [];
	const fits = (name: string, room: number) => rooms.push({ name, room });

	const formations = flow.formations.map((f, i) => {
		const name = `站位 ${i + 1} `;
		const walks = f.walks && Object.fromEntries(
			Object.entries(f.walks).map(([id, w]): [string, Walk] => {
				for (const p of [w.depart, w.arrive]) if (moves(p)) fits(name, end - 1 - p.at);
				return [id, { depart: later(w.depart), arrive: later(w.arrive) }];
			})
		);
		const moved = i > 0 && f.segmentId === at.segmentId && f.at >= at.at;
		if (moved) fits(name, end - 1 - f.at);
		return { ...f, ...(moved && { at: f.at + length }), ...(walks && { walks }) };
	});
	const actions = flow.actions.map((a) => {
		if (a.segmentId !== at.segmentId || a.start < at.at) return a;
		fits(`「${actionLabel(a)}」`, end - a.start - a.length);
		return { ...a, start: a.start + length };
	});

	const limit = rooms.reduce<(typeof rooms)[number] | null>((t, r) => (!t || r.room < t.room ? r : t), null);
	if (limit && limit.room < length) {
		const most = limit.room > 0 ? `最多插 ${lengthTextWithUnit(segment, limit.room)}` : '這段後面已經沒有空了';
		return blocked(`${limit.name}會超過這段的結尾，${most}`);
	}
	return ok({ ...flow, formations, actions });
}
