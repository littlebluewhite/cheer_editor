// 環節標的拍怎麼跟著動作走：改動作時標的拍切短、刪掉（phaseFallout，收尾用），
// 標拍、清標的拍時從別的環節切掉一段（cut），照拍的先後排（ordered）。環節的指令在 phases.ts。

import type { Action } from './action-types';
import { cutOut, fitRange, onBeat, rangeText, type BeatRange } from './beat-range';
import { phaseLabel, type Phase } from './phase-types';
import type { Segment } from './segment';
import { markedCount } from './success-rate';

/** 改動作動到的標的拍：見 phaseFallout。 */
export interface PhaseFallout {
	phases: Phase[];
	cut: number;
	dropped: number;
	marked: number;
	empty: boolean;
	shifted: boolean;
	items: string[];
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
): PhaseFallout | null {
	const old = after.successRate?.phases ?? [];
	const music = to.kind === 'music';
	const shifted = music && old.some((p) => p.beats && !onBeat(after, p.beats.at));
	/** 挪 by 個半拍（落在 & 的才挪）、留在動作裡、取到整拍後的標的拍；不到一拍是 undefined。 */
	const place = (p: Phase, by: 1 | -1) => (music ? fitRange('phase', after, p.beats!, by) : undefined);
	const kept = (by: 1 | -1) => old.filter((p) => p.beats && place(p, by)?.len === p.beats.len).length;
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
export function phaseFalloutText({ cut, dropped, marked, empty }: PhaseFallout): string {
	const parts = [
		cut ? `切短 ${cut} 個環節標的拍` : '',
		dropped ? `刪掉 ${dropped} 個環節${marked ? `（清掉 ${marked} 次的記號）` : ''}` : ''
	];
	return parts.filter(Boolean).join('、') + (empty ? '，動作不再記成功率' : '');
}

/**
 * 把 [from, to) 半拍從每個環節標的拍裡拿掉：露在外面的留著，兩邊都露出來時留前面那段。
 * 露出來的長度取到整拍（動作被拖半拍後可能差半拍），不到一拍就變沒標拍（之後由環節的指令刪掉）。
 */
export function cut(phases: Phase[], from: number, to: number): Phase[] {
	return phases.map((p) => {
		const pieces = p.beats && cutOut(p.beats, from, to);
		return pieces ? withBeats(p, pieces[0]) : p;
	});
}

/** 換掉環節標的拍；沒給就是沒標拍（拿掉欄位）。 */
function withBeats({ beats: _, ...p }: Phase, beats?: BeatRange): Phase {
	return beats ? { ...p, beats } : p;
}

/** 標了拍的照時間排在前面；沒標的（口號段）排在後面，照原來的順序。 */
export function ordered(phases: Phase[]): Phase[] {
	const marked = phases.filter((p) => p.beats).sort((a, b) => a.beats!.at - b.beats!.at);
	return [...marked, ...phases.filter((p) => !p.beats)];
}
