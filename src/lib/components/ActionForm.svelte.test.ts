import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	markPhaseBeats,
	placeCue,
	setSquad,
	updateSegment,
	type ActionCategory,
	type CommandResult,
	type Flow
} from '#lib/core';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ActionForm from './ActionForm.svelte';

/** 打開某個人的任務角色選單，點一個角色（空字串是沒有任務）。 */
async function pickRole(who: string, role: string) {
	await fireEvent.click(screen.getByRole('combobox', { name: `${who} 的任務角色` }));
	await fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${role || '（沒有任務）'}`) }));
}

// jsdom 沒有 scrollIntoView：記下被捲過去的元素。
const scrolled: Element[] = [];
Element.prototype.scrollIntoView = function () {
	scrolled.push(this);
};

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（150 BPM、2 個八拍，一個半拍 0.2 秒）；隊員小A、小B。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	return flowOf(updateSegment(flow, 's1', { eights: 2, lastBeats: 8 }));
}

function setup(flow: Flow, actionId: string | null, playheadSec = 0) {
	const onchange = vi.fn();
	const onselect = vi.fn();
	render(ActionForm, { flow, playheadSec, actionId, onchange, onselect });
	return { onchange, onselect };
}

describe('動作表單：新增', () => {
	it('從播放頭開始，填大類、名稱、長度、人和任務角色、備註，按新增', async () => {
		const { onchange, onselect } = setup(sample(), null, 1);
		const start = screen.getByLabelText('開始') as HTMLInputElement;
		expect(start.value).toBe('1-3&');

		await fireEvent.change(screen.getByLabelText('大類'), { target: { value: 'pyramid' } });
		await fireEvent.input(screen.getByLabelText('名稱'), { target: { value: '收尾' } });
		await fireEvent.input(screen.getByLabelText('長度'), { target: { value: '4.5' } });
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm2' } });
		await pickRole('小B', '中層');
		await fireEvent.input(screen.getByLabelText('備註'), { target: { value: '慢' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));

		expect(onchange).toHaveBeenCalledOnce();
		expect(onchange.mock.calls[0][0].actions).toEqual([
			{
				id: 'x1',
				segmentId: 's1',
				category: 'pyramid',
				name: '收尾',
				start: 5,
				length: 9,
				note: '慢',
				members: [{ memberId: 'm2', role: '中層' }]
			}
		]);
		expect(onselect).toHaveBeenCalledWith('x1');
	});

	it('卡片標「新動作」、換了底色；標題就是名稱輸入框', () => {
		setup(sample(), null);
		const card = document.querySelector('section.action-form')!;
		expect(card.classList.contains('creating')).toBe(true);
		const header = card.querySelector('header')!;
		expect(within(header as HTMLElement).getByText('新動作')).toBeTruthy();
		expect(header.contains(screen.getByLabelText('名稱'))).toBe(true);
		expect(screen.queryByText('在播放頭新增動作')).toBeNull();
	});

	it('新增時挑辨識色，新動作帶著它', async () => {
		const { onchange } = setup(sample(), null);
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm1' } });
		await fireEvent.click(screen.getByRole('radio', { name: '藍' }));
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(onchange.mock.calls[0][0].actions[0].color).toBe('#1565c0');
	});

	it('沒有人就被流程核心擋下，顯示原因', async () => {
		const { onchange } = setup(sample(), null);
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(screen.getByRole('alert').textContent).toBe('一個動作至少要有 1 個人');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('被擋下的原因在右邊欄看不到的地方時，捲過去讓它看得到', async () => {
		scrolled.length = 0;
		setup(sample(), null);
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(scrolled).toEqual([screen.getByRole('alert')]);
	});

	it('還沒有段時不能加動作', () => {
		const flow = flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } }));
		setup(flow, null);
		expect(screen.queryByRole('button', { name: '新增動作' })).toBeNull();
		expect(screen.getByText(/先加一段/)).toBeTruthy();
	});
});

describe('動作表單：改選到的動作', () => {
	function withTwo(): Flow {
		const base = {
			segmentId: 's1',
			category: 'stunt' as const,
			note: '',
			members: [{ memberId: 'm1', role: '上層' }]
		};
		let flow = flowOf(addAction(sample(), { ...base, name: 'A', start: 0, length: 8 }));
		flow = flowOf(addAction(flow, { ...base, name: 'B', start: 8, length: 8 }));
		return flow;
	}

	it('改了馬上生效；撞到同一個人就顯示原因並還原', async () => {
		const { onchange } = setup(withTwo(), 'x1');
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		expect(length.value).toBe('4');

		await fireEvent.input(length, { target: { value: '6' } });
		await fireEvent.change(length);
		expect(screen.getByRole('alert').textContent).toBe('小A 同一時間已經在「技巧·B」裡，已還原');
		expect(length.value).toBe('4');
		expect(onchange).not.toHaveBeenCalled();

		await pickRole('小A', '');
		expect(onchange.mock.calls[0][0].actions[0].members).toEqual([{ memberId: 'm1', role: null }]);
	});

	it('名字底色照性別、旁邊標底層或上層；驚嘆號說明顏色和快捷鍵', () => {
		let flow = flowOf(addAction(sample(), { segmentId: 's1', category: 'stunt', name: 'A', note: '', start: 0, length: 4, members: [{ memberId: 'm1', role: null }, { memberId: 'm2', role: null }] }));
		setup(flow, 'x1');
		const rowA = screen.getByLabelText('小A 的任務角色').closest('li')!;
		const rowB = screen.getByLabelText('小B 的任務角色').closest('li')!;
		expect(rowA.querySelector('.name.F')?.textContent).toBe('小A');
		expect(rowB.querySelector('.name.M')?.textContent).toBe('小B');
		expect(rowA.querySelector('.gr.top')?.textContent).toBe('上');
		expect(rowB.querySelector('.gr.base')?.textContent).toBe('底');
		const legend = screen.getByRole('button', { name: '顏色和快捷鍵說明' });
		const tip = document.getElementById(legend.getAttribute('aria-describedby')!)!;
		expect(tip.textContent).toContain('女');
		expect(tip.textContent).toContain('男');
		expect(tip.textContent).toContain('底層');
		expect(tip.textContent).toContain('上層');
		expect(tip.textContent).toContain('1 底層');
	});

	it('任務角色選單按快捷鍵就選好，跳到下一個人；Backspace 是沒有任務', async () => {
		let flow = flowOf(addAction(sample(), { segmentId: 's1', category: 'stunt', name: 'A', note: '', start: 0, length: 4, members: [{ memberId: 'm1', role: null }, { memberId: 'm2', role: null }] }));
		const { onchange } = setup(flow, 'x1');
		const pickA = screen.getByRole('combobox', { name: '小A 的任務角色' });
		const pickB = screen.getByRole('combobox', { name: '小B 的任務角色' });
		// 選單打開時按鍵也是直接選好、關掉選單，不用再按確認。
		await fireEvent.click(pickA);
		expect(screen.getByRole('option', { name: /^上層/ }).textContent).toBe('上層4');
		pickA.focus();
		await fireEvent.keyDown(pickA, { key: '4' });
		expect(onchange.mock.calls.at(-1)![0].actions[0].members[0]).toEqual({ memberId: 'm1', role: '上層' });
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(pickA.textContent).toBe('上層');
		expect(document.activeElement).toBe(pickB);
		// 選單關著也可以。
		await fireEvent.keyDown(pickB, { key: '1' });
		expect(onchange.mock.calls.at(-1)![0].actions[0].members[1]).toEqual({ memberId: 'm2', role: '底層' });
		await fireEvent.keyDown(pickB, { key: 'Backspace' });
		expect(onchange.mock.calls.at(-1)![0].actions[0].members[1]).toEqual({ memberId: 'm2', role: null });
	});

	it('任務角色選單用滑鼠點也可以；最後一項是自訂任務角色', async () => {
		let flow = flowOf(addAction(sample(), { segmentId: 's1', category: 'stunt', name: 'A', note: '', start: 0, length: 4, members: [{ memberId: 'm1', role: null }] }));
		const { onchange } = setup(flow, 'x1');
		await pickRole('小A', '主底');
		expect(onchange.mock.calls.at(-1)![0].actions[0].members[0]).toEqual({ memberId: 'm1', role: '主底' });
		await fireEvent.click(screen.getByRole('combobox', { name: '小A 的任務角色' }));
		await fireEvent.click(screen.getByRole('option', { name: '＋自訂任務角色…' }));
		expect(screen.getByRole('dialog')).toBeTruthy();
	});

	it('標題是動作的名稱，可以直接改', async () => {
		const { onchange } = setup(withTwo(), 'x2');
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		expect(name.value).toBe('B');
		expect(name.closest('header')).not.toBeNull();
		await fireEvent.input(name, { target: { value: 'Ext' } });
		await fireEvent.change(name);
		expect(onchange.mock.calls[0][0].actions[1].name).toBe('Ext');
	});

	it('挑辨識色馬上生效；挑「大類的顏色」就拿掉', async () => {
		const { onchange } = setup(withTwo(), 'x1');
		expect((screen.getByRole('radio', { name: '大類的顏色' }) as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(screen.getByRole('radio', { name: '紫' }));
		const colored = onchange.mock.calls[0][0];
		expect(colored.actions[0].color).toBe('#7b1fa2');

		document.body.innerHTML = '';
		const again = setup(colored, 'x1');
		expect((screen.getByRole('radio', { name: '紫' }) as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(screen.getByRole('radio', { name: '大類的顏色' }));
		expect('color' in again.onchange.mock.calls[0][0].actions[0]).toBe(false);
	});

	it('刪除動作', async () => {
		const { onchange, onselect } = setup(withTwo(), 'x2');
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(onchange.mock.calls[0][0].actions.map((a: { id: string }) => a.id)).toEqual(['x1']);
		expect(onselect).toHaveBeenCalledWith(null);
	});

	it('卡片外面的「＋ 開新的動作表單」取消選取，回到新增', async () => {
		const { onselect } = setup(withTwo(), 'x1');
		const button = screen.getByRole('button', { name: '開新的動作表單' });
		expect(button.closest('section')).toBeNull();
		await fireEvent.click(button);
		expect(onselect).toHaveBeenCalledWith(null);
	});
});

describe('動作表單：選人', () => {
	/** Lib：小A 上層、小B 主底，0–1.6 秒。 */
	function withLib(): Flow {
		return flowOf(
			addAction(sample(), {
				segmentId: 's1',
				category: 'stunt',
				name: 'Lib',
				note: '',
				start: 0,
				length: 8,
				members: [
					{ memberId: 'm1', role: '上層' },
					{ memberId: 'm2', role: '主底' }
				]
			})
		);
	}

	function setupSel(
		flow: Flow,
		actionId: string | null,
		selectedMemberIds: string[],
		playheadSec = 0
	) {
		const onchange = vi.fn();
		const onselect = vi.fn();
		const onselectmembers = vi.fn<(ids: string[]) => void>();
		render(ActionForm, {
			flow,
			playheadSec,
			actionId,
			onchange,
			onselect,
			selectedMemberIds,
			onselectmembers
		});
		return { onchange, onselect, onselectmembers };
	}

	const people = () =>
		[...document.querySelectorAll('.people li .who > .name')].map((el) => el.textContent);

	it('在播放頭新增動作時，人就是選到的人；加人、移出也改選取', async () => {
		const { onchange, onselectmembers } = setupSel(sample(), null, ['m2']);
		expect(people()).toEqual(['小B']);
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm1' } });
		expect(onselectmembers).toHaveBeenLastCalledWith(['m2', 'm1']);
		await fireEvent.click(screen.getByRole('button', { name: '把 小B 移出這個動作' }));
		expect(onselectmembers).toHaveBeenLastCalledWith(['m1']);
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(onchange.mock.calls[0][0].actions[0].members).toEqual([{ memberId: 'm1', role: null }]);
	});

	it('新增時「從別的動作複製人」連任務角色一起帶，也改選取', async () => {
		const { onchange, onselectmembers } = setupSel(withLib(), null, [], 2);
		await fireEvent.change(screen.getByLabelText('從別的動作複製人'), { target: { value: 'x1' } });
		expect(onselectmembers).toHaveBeenLastCalledWith(['m1', 'm2']);
		expect(screen.getByRole('combobox', { name: '小B 的任務角色' }).textContent).toBe('主底');
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(onchange.mock.calls[0][0].actions[1].members).toEqual([
			{ memberId: 'm1', role: '上層' },
			{ memberId: 'm2', role: '主底' }
		]);
	});

	it('改動作時「從別的動作複製人」連任務角色一起換掉，馬上生效；選單裡沒有自己', async () => {
		let flow = withLib();
		flow = flowOf(
			addAction(flow, {
				segmentId: 's1',
				category: 'jump',
				name: '',
				note: '',
				start: 16,
				length: 8,
				members: [{ memberId: 'm2', role: null }]
			})
		);
		const { onchange } = setupSel(flow, 'x2', []);
		const copy = screen.getByLabelText('從別的動作複製人') as HTMLSelectElement;
		expect([...copy.options].map((o) => o.value)).toEqual(['', 'x1']);
		await fireEvent.change(copy, { target: { value: 'x1' } });
		expect(onchange.mock.calls[0][0].actions[1].members).toEqual([
			{ memberId: 'm1', role: '上層' },
			{ memberId: 'm2', role: '主底' }
		]);
	});
});

describe('動作表單：拍點格子', () => {
	const base = { category: 'stunt' as const, name: '', note: '', members: [{ memberId: 'm1', role: null }] };

	it('格子對齊音樂的整拍：動作從 1-2& 開始、2 拍，只有 1-3 整拍在動作裡；放的 down 從 1-3 開始', async () => {
		const flow = flowOf(addAction(sample(), { ...base, segmentId: 's1', start: 3, length: 4 }));
		const { onchange } = setup(flow, 'x1');
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		const enabled = grid
			.getAllByRole('button', { name: /^1-\d$/ })
			.filter((b) => !(b as HTMLButtonElement).disabled)
			.map((b) => b.getAttribute('aria-label'));
		expect(enabled).toEqual(['1-3']);
		await fireEvent.click(grid.getByRole('button', { name: '1-3' }));
		expect(grid.getByText(/^選了/).textContent).toBe('選了 1-3・1 拍');
		// 再多選一拍就超出動作，選不到。
		await fireEvent.click(grid.getByRole('button', { name: '多選一拍' }));
		expect(grid.getByText(/^選了/).textContent).toBe('選了 1-3・1 拍');
		await fireEvent.click(grid.getByRole('button', { name: 'down' }));
		expect(onchange.mock.calls[0][0].actions[0].cues).toEqual([
			{ kind: 'count', at: 1, len: 2, word: 'down', who: null }
		]);
	});

	it('流程裡別的動作用過的字（例如打開別人的流程檔）也是按鈕', async () => {
		let flow = flowOf(addAction(sample(), { ...base, segmentId: 's1', start: 0, length: 4 }));
		flow = flowOf(addAction(flow, { ...base, segmentId: 's1', start: 8, length: 4 }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 0, len: 2, word: '抬腳' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: '拳頭' }));
		setup(flow, 'x2');
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-5' }));
		const words = (lane: string) =>
			within(grid.getByRole('group', { name: lane }))
				.getAllByRole('button')
				.map((b) => b.textContent);
		expect(words('步驟')).toEqual(['下手', '落地', '放', '上', '直下', '跳', '抬腳', '加入', '清掉']);
		expect(words('手位')).toEqual(['high V', 'low V', 'T', 'touchdown', 'K', 'L', 'diagonal', '雙手並攏', '拳頭', '加入', '清掉']);
	});

	it('變短要先問；等確認時流程變了、按確定被擋：顯示原因並還原', async () => {
		let flow = flowOf(addAction(sample(), { ...base, segmentId: 's1', start: 0, length: 8 }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 4, word: 'down' }));
		const onchange = vi.fn();
		const { rerender } = render(ActionForm, { flow, playheadSec: 0, actionId: 'x1', onchange, onselect: vi.fn() });
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		scrolled.length = 0;
		await fireEvent.input(length, { target: { value: '2' } });
		await fireEvent.change(length);
		expect(screen.getByRole('alertdialog').textContent).toContain('會拿掉 1 個拍點');
		// 問句在拍點格子下面，右邊欄看不到：出現時捲過去
		expect(scrolled).toHaveLength(1);
		expect(scrolled[0].contains(screen.getByRole('alertdialog'))).toBe(true);

		// 等的時候別的地方把小A 放進 1-2 開始的另一個動作。
		const other = { ...flow.actions[0], id: 'x2', name: 'B', start: 2, length: 4, cues: [] };
		await rerender({ flow: { ...flow, actions: [...flow.actions, other] } });
		await fireEvent.click(screen.getByRole('button', { name: '確定' }));

		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByRole('alert').textContent).toBe('小A 同一時間已經在「技巧·B」裡，已還原');
		expect(length.value).toBe('4');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('口號段的動作沒有格子：寫一句，只有環節那一列', () => {
		let flow = flowOf(addSegment(sample(), 'chant'));
		flow = flowOf(addAction(flow, { ...base, segmentId: 's2', start: 0, length: 30 }));
		setup(flow, 'x1');
		const group = screen.getByRole('group', { name: '拍點' });
		expect(group.textContent).toContain('口號段不數拍，不能放拍點');
		expect(within(group).queryByRole('button', { name: '1-1' })).toBeNull();
		expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
			'加入環節',
			'清掉環節'
		]);
	});
});

describe('動作表單：成功率', () => {
	/** 小A（上層）、小B 做的 Lib，大類照給的；x2 是後面另一個動作，只有小A。 */
	function withLib(category: ActionCategory = 'stunt'): Flow {
		const base = { segmentId: 's1', name: '', note: '', length: 8 };
		const members = [
			{ memberId: 'm1', role: '上層' },
			{ memberId: 'm2', role: '主底' }
		];
		let flow = flowOf(addAction(sample(), { ...base, category, name: 'Lib', start: 0, members }));
		return flowOf(addAction(flow, { ...base, category: 'stunt', start: 16, members: [members[0]] }));
	}

	/** 動作加一個整個動作的環節（開始記成功率；分組的大類全部的人先進第 1 組）。 */
	const rated = (flow: Flow, actionId = 'x1') =>
		flowOf(markPhaseBeats(flow, actionId, { kind: 'whole', name: '' }, 0, 8));

	/** 畫面跟著 onchange 送出的流程更新，像在編輯頁裡一樣。 */
	function live(flow: Flow, actionId: string | null) {
		const onchange = vi.fn();
		const { rerender } = render(ActionForm, { flow, playheadSec: 0, actionId, onchange, onselect: vi.fn() });
		onchange.mockImplementation((f: Flow) => rerender({ flow: f }));
		return onchange;
	}

	/** 每個人旁邊的唯讀組標籤（沒有標籤是 null）。 */
	const squadTags = () =>
		[...document.querySelectorAll('.people li')].map((li) => li.querySelector('.squad-tag')?.textContent ?? null);

	it('沒有「記成功率」勾勾、沒有環節清單：環節在拍點格子上', () => {
		live(rated(withLib()), 'x1');
		expect(screen.queryByRole('checkbox', { name: '記成功率' })).toBeNull();
		expect(screen.queryByRole('group', { name: '成功率' })).toBeNull();
		expect(screen.queryByRole('list', { name: '環節' })).toBeNull();
		expect(screen.getByRole('button', { name: /^環節 整體/ })).toBeTruthy();
	});

	it('有環節後每個人旁邊寫第幾組（唯讀，沒有選單）；沒分組寫「沒分組」', () => {
		live(withLib(), 'x1');
		expect(squadTags()).toEqual([null, null]);

		document.body.innerHTML = '';
		live(flowOf(setSquad(rated(withLib()), 'x1', ['m2'], null)), 'x1');
		expect(squadTags()).toEqual(['第 1 組', '沒分組']);
		expect(screen.queryByRole('combobox', { name: '小A 的組' })).toBeNull();
	});

	it.each([['tumbling'], ['jump']] as const)('%s 的動作有環節也不分組', (category) => {
		live(rated(withLib(category)), 'x1');
		expect(squadTags()).toEqual([null, null]);
	});

	it('「＋加人…」：動作只有一組，新的人進第 1 組（核心放的），旁邊寫「第 1 組」', async () => {
		const onchange = live(rated(withLib(), 'x2'), 'x2');
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm2' } });
		expect(onchange.mock.calls.at(-1)![0].actions[1].members).toEqual([
			{ memberId: 'm1', role: '上層', squad: 1 },
			{ memberId: 'm2', role: null, squad: 1 }
		]);
		expect(squadTags()).toEqual(['第 1 組', '第 1 組']);
	});

	it('「從別的動作複製人（連任務角色和組）」連組一起帶', async () => {
		let flow = flowOf(setSquad(rated(withLib()), 'x1', ['m2'], 2));
		flow = rated(flow, 'x2');
		const onchange = live(flow, 'x2');
		const copy = screen.getByLabelText('從別的動作複製人') as HTMLSelectElement;
		expect(copy.options[0].text).toBe('從別的動作複製人（連任務角色和組）…');
		await fireEvent.change(copy, { target: { value: 'x1' } });
		expect(onchange.mock.calls.at(-1)![0].actions[1].members).toEqual([
			{ memberId: 'm1', role: '上層', squad: 1 },
			{ memberId: 'm2', role: '主底', squad: 2 }
		]);
		expect(squadTags()).toEqual(['第 1 組', '第 2 組']);
	});
});
