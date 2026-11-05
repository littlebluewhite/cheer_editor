import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	atText,
	createFlow,
	parseAt,
	placeCue,
	updateAction,
	updateSegment,
	type Flow
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { EditorSession } from './editor-session.svelte.js';

/** 音樂 1（4 個八拍）；小A、小B。動作 x1 從 3-3 到 4-2（8 拍），小A 當上層。 */
function sampleFlow(start = 36): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [{ memberId: 'm1', role: '上層' }];
	return flowOf(addAction(flow, { segmentId: 's1', start, length: 16, category: 'stunt', name: '', note: '', members }));
}

/** 選了 x1 的 session。 */
function selected(flow = sampleFlow()) {
	const s = new EditorSession(flow);
	s.selectAction('x1');
	return s;
}

/** session 選到的動作。 */
const chosen = (s: EditorSession) => s.flow!.actions.find((a) => a.id === s.selectedActionId)!;
/** 段內時間（例：3-5）→ 從選到的動作開始算的半拍。 */
const at = (s: EditorSession, text: string) => parseAt(s.flow!.segments[0], text)! - chosen(s).start;
/** 選的拍，寫成「3-5」或「3-5 到 3-6」。 */
function picked(s: EditorSession): string {
	const text = (h: number) => atText(s.flow!.segments[0], chosen(s).start + h);
	const [from, last] = [text(s.beats.from), text(s.beats.to)];
	return from === last ? from : `${from} 到 ${last}`;
}

describe('編輯 session：拍點格子選的拍', () => {
	it('選了動作：從動作的第一拍開始，給誰是全部', () => {
		const s = selected();
		expect(picked(s)).toBe('3-3');
		expect(s.beats.who).toBeNull();
	});

	it('點一格選一拍；Shift＋點從上次點的那一格選到這一格（往前點也可以）', () => {
		const s = selected();
		s.beats.click(at(s, '3-5'));
		expect(picked(s)).toBe('3-5');
		s.beats.click(at(s, '4-1'), true);
		expect(picked(s)).toBe('3-5 到 4-1');
		s.beats.click(at(s, '3-3'), true);
		expect(picked(s)).toBe('3-3 到 3-5');
	});

	it('拖：從按下的那一格選到拖到的那一格，往回拖也可以；拖到動作外面停在動作的第一拍或最後一拍', () => {
		const s = selected();
		s.beats.click(at(s, '3-5'));
		s.beats.dragTo(at(s, '3-6'));
		expect(picked(s)).toBe('3-5 到 3-6');
		s.beats.click(at(s, '4-1'));
		s.beats.dragTo(at(s, '3-7'));
		expect(picked(s)).toBe('3-7 到 4-1');
		s.beats.click(at(s, '3-5'));
		s.beats.dragTo(at(s, '4-8'));
		expect(picked(s)).toBe('3-5 到 4-2');
		s.beats.dragTo(at(s, '3-1'));
		expect(picked(s)).toBe('3-3 到 3-5');
	});

	it('Shift 按著拖：從上次點的那一格拖起', () => {
		const s = selected();
		s.beats.click(at(s, '3-4'));
		s.beats.click(at(s, '3-7'), true);
		s.beats.dragTo(at(s, '3-8'));
		expect(picked(s)).toBe('3-4 到 3-8');
	});

	it('方向鍵左右移選一拍；Shift＋方向鍵移不固定的那一端；回動到的那一格（焦點跟著它）', () => {
		const s = selected();
		s.beats.click(at(s, '3-5'));
		expect(s.beats.arrow(1, false)).toBe(at(s, '3-6'));
		expect(picked(s)).toBe('3-6');
		s.beats.arrow(1, true);
		expect(s.beats.arrow(1, true)).toBe(at(s, '3-8'));
		expect(picked(s)).toBe('3-6 到 3-8');
		expect(s.beats.arrow(-1, true)).toBe(at(s, '3-7'));
		expect(picked(s)).toBe('3-6 到 3-7');
		s.beats.arrow(-1, false);
		expect(picked(s)).toBe('3-5');
	});

	it('方向鍵到動作頭尾就停住：選取不動，回 null', () => {
		const s = selected();
		s.beats.click(at(s, '3-3'));
		expect(s.beats.arrow(-1, false)).toBeNull();
		expect(picked(s)).toBe('3-3');
		s.beats.click(at(s, '4-2'));
		expect(s.beats.arrow(1, true)).toBeNull();
		expect(picked(s)).toBe('4-2');
	});

	it('點拍點：帶回它的範圍和給誰；點環節只帶回範圍', () => {
		const s = selected();
		s.beats.pick({ at: at(s, '3-5'), len: 4 }, { member: 'm1' });
		expect(picked(s)).toBe('3-5 到 3-6');
		expect(s.beats.who).toEqual({ member: 'm1' });
		s.beats.pick({ at: at(s, '3-3'), len: 2 });
		expect(picked(s)).toBe('3-3');
		expect(s.beats.who).toEqual({ member: 'm1' });
	});

	it('從 & 開始的拍點：點它選回它原本的範圍，碰到的兩格各只選到半格；再 Shift＋點從它所在的那一格算', () => {
		const s = selected(sampleFlow(37)); // 動作從 3-3& 開始，第一格是 3-4
		s.beats.pick({ at: 0, len: 2 }, null);
		expect(picked(s)).toBe('3-3&');
		const halves = (text: string) => [s.beats.covers(at(s, text)), s.beats.covers(at(s, `${text}&`))];
		expect(halves('3-3')).toEqual([false, true]);
		expect(halves('3-4')).toEqual([true, false]);
		s.beats.click(at(s, '3-6'), true);
		expect(picked(s)).toBe('3-4 到 3-6');
	});

	it('＋、－：多選或少選一拍，最少一拍、不超出動作', () => {
		const s = selected();
		s.beats.click(at(s, '3-5'));
		s.beats.grow(1);
		s.beats.grow(1);
		s.beats.grow(-1);
		expect(picked(s)).toBe('3-5 到 3-6');
		expect(s.beats.len).toBe(4);
		s.beats.grow(-1);
		s.beats.grow(-1);
		expect(picked(s)).toBe('3-5');
		s.beats.click(at(s, '4-2'));
		s.beats.grow(1);
		expect(picked(s)).toBe('4-2');
	});

	it('放完拍子選下一拍；動作裡沒有下一拍就不動', () => {
		const s = selected();
		s.beats.click(at(s, '3-5'));
		s.beats.click(at(s, '3-6'), true);
		expect(s.beats.next()).toBe(true);
		expect(picked(s)).toBe('3-7');
		s.beats.click(at(s, '4-2'));
		expect(s.beats.next()).toBe(false);
		expect(picked(s)).toBe('4-2');
	});

	it('動作變短：選的拍跑到外面就回到第一拍；還在裡面就不動', () => {
		const s = selected();
		s.beats.click(at(s, '3-5'));
		s.change(flowOf(updateAction(s.flow!, 'x1', { length: 12 })));
		expect(picked(s)).toBe('3-5');
		s.beats.click(at(s, '3-8'));
		s.change(flowOf(updateAction(s.flow!, 'x1', { length: 8 })));
		expect(picked(s)).toBe('3-3');
	});

	it('動作挪一整拍：選取跟著動作走；挪到半拍上，選取不在整拍上了，回到第一拍', () => {
		const s = selected();
		s.beats.click(at(s, '3-5'));
		s.change(flowOf(updateAction(s.flow!, 'x1', { start: 38 })));
		expect(picked(s)).toBe('3-6');
		s.change(flowOf(updateAction(s.flow!, 'x1', { start: 39 })));
		expect(picked(s)).toBe('3-5');
	});

	it('動作沒挪、沒變短：改了別的（放拍子），從 & 開始的選取也不動', () => {
		const s = selected(sampleFlow(37));
		s.beats.pick({ at: 0, len: 2 }, null);
		s.change(flowOf(placeCue(s.flow!, 'x1', { kind: 'count', at: 0, len: 2, word: 'down', who: null })));
		expect(picked(s)).toBe('3-3&');
	});

	it('換動作：從新動作的第一拍開始，給誰回到全部；再選同一個不動；取消選了再選也從頭', () => {
		const flow = flowOf(
			addAction(sampleFlow(), {
				segmentId: 's1',
				start: 5,
				length: 8,
				category: 'stunt',
				name: '',
				note: '',
				members: [{ memberId: 'm2', role: null }]
			})
		);
		const s = selected(flow);
		s.beats.click(at(s, '3-5'));
		s.beats.who = { member: 'm1' };
		s.selectAction('x1');
		expect(picked(s)).toBe('3-5');
		expect(s.beats.who).toEqual({ member: 'm1' });

		s.selectAction('x2'); // 從 1-3& 開始，第一格是 1-4
		expect(picked(s)).toBe('1-4');
		expect(s.beats.who).toBeNull();

		s.selectAction('x1');
		s.beats.click(at(s, '3-5'));
		s.clearSelection();
		s.selectAction('x1');
		expect(picked(s)).toBe('3-3');
	});

	it('給的人或角色不在動作裡了（改了、復原）：給誰回到全部', () => {
		const s = selected();
		const members = (...m: { memberId: string; role: string | null }[]) =>
			s.change(flowOf(updateAction(s.flow!, 'x1', { members: m })));
		s.beats.who = { role: '上層' };
		members({ memberId: 'm1', role: null });
		expect(s.beats.who).toBeNull();

		s.beats.who = { member: 'm1' };
		members({ memberId: 'm1', role: null }, { memberId: 'm2', role: null });
		expect(s.beats.who).toEqual({ member: 'm1' });
		s.beats.who = { member: 'm2' };
		s.undo();
		expect(s.beats.who).toBeNull();
	});

	it('復原：動作變回短的，選的拍跑到外面就回到第一拍', () => {
		const s = selected();
		s.change(flowOf(updateAction(s.flow!, 'x1', { length: 20 })));
		s.beats.click(at(s, '4-4'));
		s.undo();
		expect(picked(s)).toBe('3-3');
	});
});
