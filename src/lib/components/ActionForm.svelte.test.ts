import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	createFlow,
	addPhase,
	placeCue,
	setSquad,
	updateSegment,
	type ActionCategory,
	type Flow
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import { recordedFlow, testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
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

/** 等畫面跑一格。捲過去要等下一格：按 Tab 送出時，瀏覽器會先把下一個欄位捲進來，同一格捲的會被蓋掉。 */
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

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

/** 放一個帶著 flow 的編輯器 module（選了 actionId 和 selected 的人，播放頭在 playheadSec）進 context，畫動作表單；回傳 session。 */
function setup(flow: Flow, actionId: string | null, playheadSec = 0, selected: string[] = []) {
	const { editor, session } = testEditor(flow);
	editor.playback.seek(playheadSec);
	session.selectAction(actionId);
	session.selectMembers(selected);
	render(TestSession, { props: { editor, component: ActionForm, props: {} } });
	return session;
}

/** 沒選人時新動作表單收起來：按「＋ 新動作」打開。 */
const openNewForm = () => fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));

describe('動作表單：新增', () => {
	it('從播放頭開始，填大類、名稱、長度、人和任務角色、備註，按新增', async () => {
		const session = setup(sample(), null, 1);
		await openNewForm();
		const start = screen.getByLabelText('開始') as HTMLInputElement;
		expect(start.value).toBe('1-3&');

		await fireEvent.change(screen.getByLabelText('大類'), { target: { value: 'pyramid' } });
		await fireEvent.input(screen.getByLabelText('名稱'), { target: { value: '收尾' } });
		await fireEvent.input(screen.getByLabelText('長度'), { target: { value: '4.5' } });
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm2' } });
		await pickRole('小B', '中層');
		await fireEvent.input(screen.getByLabelText('備註'), { target: { value: '慢' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));

		expect(session.canUndo).toBe(true);
		expect(session.flow!.actions).toEqual([
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
		expect(session.selectedActionId).toBe('x1');
	});

	it('卡片標「新動作」、換了底色；標題就是名稱輸入框', async () => {
		setup(sample(), null);
		await openNewForm();
		const card = document.querySelector('section.action-form')!;
		expect(card.classList.contains('creating')).toBe(true);
		const header = card.querySelector('header')!;
		expect(within(header as HTMLElement).getByText('新動作')).toBeTruthy();
		expect(header.contains(screen.getByLabelText('名稱'))).toBe(true);
		expect(screen.queryByText('在播放頭新增動作')).toBeNull();
	});

	it('人那一區的小標寫「人（n）・任務角色」，不像新增按鈕', async () => {
		setup(sample(), null);
		await openNewForm();
		expect(screen.getByText('人（0）・任務角色')).toBeTruthy();
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm1' } });
		expect(screen.getByText('人（1）・任務角色')).toBeTruthy();
	});

	it('新增時挑辨識色，新動作帶著它', async () => {
		const session = setup(sample(), null);
		await openNewForm();
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm1' } });
		await fireEvent.click(screen.getByRole('radio', { name: '藍' }));
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(session.flow!.actions[0].color).toBe('#1565c0');
	});

	it('沒選人時「新增動作」是灰的，旁邊寫原因；選了人就能按', async () => {
		setup(sample(), null);
		await openNewForm();
		const add = screen.getByRole('button', { name: '新增動作' }) as HTMLButtonElement;
		expect(add.disabled).toBe(true);
		expect(document.getElementById(add.getAttribute('aria-describedby')!)!.textContent).toBe(
			'還沒有人：先選人才能新增'
		);
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm2' } });
		expect(add.disabled).toBe(false);
		expect(add.getAttribute('aria-describedby')).toBeNull();
	});

	it('新增被擋下後，改了表單（例如改開始）原因就收掉', async () => {
		setup(sample(), null, 0, ['m2']);
		await fireEvent.input(screen.getByLabelText('開始'), { target: { value: '9-9' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(screen.getByRole('alert')).toBeTruthy();
		await fireEvent.input(screen.getByLabelText('開始'), { target: { value: '1-1' } });
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('技巧有上層卻沒有底層：黃字提醒，照樣可以新增', async () => {
		const session = setup(sample(), null, 0, ['m1']);
		await pickRole('小A', '上層');
		expect(screen.getByRole('note').textContent).toBe('有上層，但沒有底層（底層、主底、側底）');
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm2' } });
		await pickRole('小B', '主底');
		expect(screen.queryByRole('note')).toBeNull();
		await pickRole('小B', '保護');
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(session.flow!.actions).toHaveLength(1);
	});

	it('在開始欄按 Enter 被擋：原因寫在開始欄旁邊，右邊欄不自己捲（#214）', async () => {
		scrolled.length = 0;
		setup(sample(), null, 0, ['m2']);
		const start = screen.getByLabelText('開始');
		await fireEvent.input(start, { target: { value: 'abc' } });
		await fireEvent.keyDown(start, { key: 'Enter' });
		await frame();
		const alert = screen.getByRole('alert');
		expect(alert.textContent).toContain('開始看不懂');
		expect(start.parentElement!.contains(alert)).toBe(true);
		expect(scrolled).toEqual([]);
	});

	it('按「新增動作」被擋：原因寫在「新增動作」鈕旁邊（黏在底部那一條裡），右邊欄不自己捲（#214）', async () => {
		scrolled.length = 0;
		setup(sample(), null, 0, ['m2']);
		await fireEvent.input(screen.getByLabelText('開始'), { target: { value: '9-9' } });
		const add = screen.getByRole('button', { name: '新增動作' });
		await fireEvent.click(add);
		await frame();
		expect(add.parentElement!.contains(screen.getByRole('alert'))).toBe(true);
		expect(scrolled).toEqual([]);
	});

	it('還沒有段時不能加動作', async () => {
		const flow = flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } }));
		setup(flow, null);
		await openNewForm();
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
		const session = setup(withTwo(), 'x1');
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		expect(length.value).toBe('4');

		await fireEvent.input(length, { target: { value: '6' } });
		await fireEvent.change(length);
		expect(screen.getByRole('alert').textContent).toBe('小A 同一時間已經在「技巧·B」裡：下一個動作從 1-5 就開始，已還原');
		expect(length.value).toBe('4');
		expect(session.canUndo).toBe(false);

		await pickRole('小A', '');
		expect(session.flow!.actions[0].members).toEqual([{ memberId: 'm1', role: null }]);
	});

	it('改長度被擋：原因寫在長度欄旁邊，右邊欄不自己捲（#214）', async () => {
		scrolled.length = 0;
		setup(withTwo(), 'x1');
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		await fireEvent.input(length, { target: { value: '6' } });
		await fireEvent.change(length);
		await frame();
		expect(length.parentElement!.contains(screen.getByRole('alert'))).toBe(true);
		expect(scrolled).toEqual([]);
	});

	it('名字底色照性別、旁邊標底層或上層；「?」說明顏色和快捷鍵', () => {
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
		const session = setup(flow, 'x1');
		const pickA = screen.getByRole('combobox', { name: '小A 的任務角色' });
		const pickB = screen.getByRole('combobox', { name: '小B 的任務角色' });
		// 選單打開時按鍵也是直接選好、關掉選單，不用再按確認。
		await fireEvent.click(pickA);
		expect(screen.getByRole('option', { name: /^上層/ }).textContent).toBe('上層4被撐在最上面的人。');
		pickA.focus();
		await fireEvent.keyDown(pickA, { key: '4' });
		expect(session.flow!.actions[0].members[0]).toEqual({ memberId: 'm1', role: '上層' });
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(pickA.textContent).toBe('上層');
		expect(document.activeElement).toBe(pickB);
		// 選單關著也可以。
		await fireEvent.keyDown(pickB, { key: '1' });
		expect(session.flow!.actions[0].members[1]).toEqual({ memberId: 'm2', role: '底層' });
		await fireEvent.keyDown(pickB, { key: 'Backspace' });
		expect(session.flow!.actions[0].members[1]).toEqual({ memberId: 'm2', role: null });
		// 中文輸入法還在選字時按的鍵（Safari 選字時 keyCode 是 229）不算快捷鍵。
		await fireEvent.keyDown(pickB, { key: '1', isComposing: true });
		await fireEvent.keyDown(pickB, { key: '1', keyCode: 229 });
		expect(session.flow!.actions[0].members[1]).toEqual({ memberId: 'm2', role: null });
	});

	it('任務角色選單每一項有一句說明，取自名詞對照表（自訂角色用教練寫的意思）', async () => {
		const flow = flowOf(addCustomRole(withTwo(), { name: '丟人的', meaning: '把上層丟出去的人' }));
		setup(flow, 'x1');
		await fireEvent.click(screen.getByRole('combobox', { name: '小A 的任務角色' }));
		const list = within(screen.getByRole('listbox'));
		const meaning = (name: RegExp) => list.getByRole('option', { name }).querySelector('.meaning')?.textContent;
		expect(meaning(/^主底/)).toBe('主要撐住上層腳的底層。單底層技巧的那位底層。');
		expect(meaning(/^騰翻/)).toBe('做騰翻的人。');
		expect(meaning(/^丟人的/)).toBe('把上層丟出去的人');
	});

	it('長度改短要確認時，確認框就在長度欄位旁邊（不在表單最底下）', async () => {
		let flow = flowOf(addAction(sample(), { segmentId: 's1', category: 'stunt', name: 'A', note: '', start: 0, length: 8, members: [{ memberId: 'm1', role: null }] }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 4, word: 'down' }));
		setup(flow, 'x1');
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		await fireEvent.input(length, { target: { value: '2' } });
		await fireEvent.change(length);
		const dialog = screen.getAllByRole('alertdialog');
		expect(dialog).toHaveLength(1);
		// 確認框緊接在開始、長度那一列後面，排在人、備註、拍點格子前面
		expect(length.closest('.grid')!.contains(dialog[0])).toBe(true);
		expect(
			dialog[0].compareDocumentPosition(screen.getByLabelText('備註')) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(length.value).toBe('4');
	});

	it('任務角色選單用滑鼠點也可以；最後一項是自訂任務角色', async () => {
		let flow = flowOf(addAction(sample(), { segmentId: 's1', category: 'stunt', name: 'A', note: '', start: 0, length: 4, members: [{ memberId: 'm1', role: null }] }));
		const session = setup(flow, 'x1');
		await pickRole('小A', '主底');
		expect(session.flow!.actions[0].members[0]).toEqual({ memberId: 'm1', role: '主底' });
		await fireEvent.click(screen.getByRole('combobox', { name: '小A 的任務角色' }));
		await fireEvent.click(screen.getByRole('option', { name: '＋自訂任務角色…' }));
		expect(screen.getByRole('dialog')).toBeTruthy();
	});

	it('任務角色選單用方向鍵選到的項目捲進畫面', async () => {
		let flow = flowOf(addAction(sample(), { segmentId: 's1', category: 'stunt', name: 'A', note: '', start: 0, length: 4, members: [{ memberId: 'm1', role: null }] }));
		setup(flow, 'x1');
		const pick = screen.getByRole('combobox', { name: '小A 的任務角色' });
		await fireEvent.keyDown(pick, { key: 'ArrowDown' });
		await fireEvent.keyDown(pick, { key: 'ArrowUp' });
		const last = screen.getByRole('option', { name: '＋自訂任務角色…' });
		expect(pick.getAttribute('aria-activedescendant')).toBe(last.id);
		expect(scrolled.at(-1)).toBe(last);
	});

	it('標題是動作的名稱，可以直接改', async () => {
		const session = setup(withTwo(), 'x2');
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		expect(name.value).toBe('B');
		expect(name.closest('header')).not.toBeNull();
		await fireEvent.input(name, { target: { value: 'Ext' } });
		await fireEvent.change(name);
		expect(session.flow!.actions[1].name).toBe('Ext');
	});

	it('挑辨識色馬上生效；挑「大類的顏色」就拿掉', async () => {
		const session = setup(withTwo(), 'x1');
		expect((screen.getByRole('radio', { name: '大類的顏色' }) as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(screen.getByRole('radio', { name: '紫' }));
		const colored = session.flow!;
		expect(colored.actions[0].color).toBe('#7b1fa2');

		document.body.innerHTML = '';
		const again = setup(colored, 'x1');
		expect((screen.getByRole('radio', { name: '紫' }) as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(screen.getByRole('radio', { name: '大類的顏色' }));
		expect('color' in again.flow!.actions[0]).toBe(false);
	});

	it('刪除動作', async () => {
		const session = setup(withTwo(), 'x2');
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(session.flow!.actions.map((a) => a.id)).toEqual(['x1']);
		expect(session.selectedActionId).toBe(null);
	});

	it('卡片外面的「＋ 開新的動作表單」取消選取，回到新增', async () => {
		const session = setup(withTwo(), 'x1');
		const button = screen.getByRole('button', { name: '開新的動作表單' });
		expect(button.closest('section')).toBeNull();
		await fireEvent.click(button);
		expect(session.selectedActionId).toBe(null);
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
		const session = setup(flow, 'x2');
		const copy = screen.getByLabelText('從別的動作複製人') as HTMLSelectElement;
		expect([...copy.options].map((o) => o.value)).toEqual(['', 'x1']);
		await fireEvent.change(copy, { target: { value: 'x1' } });
		expect(session.flow!.actions[1].members).toEqual([
			{ memberId: 'm1', role: '上層' },
			{ memberId: 'm2', role: '主底' }
		]);
	});
});

describe('動作表單：拍點格子', () => {
	const base = { category: 'stunt' as const, name: '', note: '', members: [{ memberId: 'm1', role: null }] };

	it('格子對齊音樂的整拍：動作從 1-2& 開始、2 拍，只有 1-3 整拍在動作裡；放的 down 從 1-3 開始', async () => {
		const flow = flowOf(addAction(sample(), { ...base, segmentId: 's1', start: 3, length: 4 }));
		const session = setup(flow, 'x1');
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
		expect(session.flow!.actions[0].cues).toEqual([
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
		const session = setup(flow, 'x1');
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		scrolled.length = 0;
		await fireEvent.input(length, { target: { value: '2' } });
		await fireEvent.change(length);
		expect(screen.getByRole('alertdialog').textContent).toContain('會拿掉 1 個拍點');
		// 問句在拍點格子下面，右邊欄看不到：出現時（下一格）捲過去
		expect(scrolled).toEqual([]);
		await frame();
		expect(scrolled).toHaveLength(1);
		expect(scrolled[0].contains(screen.getByRole('alertdialog'))).toBe(true);

		// 等的時候別的地方把小A 放進 1-2 開始的另一個動作。
		const other = { ...flow.actions[0], id: 'x2', name: 'B', start: 2, length: 4, cues: [] };
		const changed = { ...flow, actions: [...flow.actions, other] };
		session.change(changed);
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: '確定' }));

		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByRole('alert').textContent).toBe('小A 同一時間已經在「技巧·B」裡：下一個動作從 1-2 就開始，已還原');
		expect(length.value).toBe('4');
		expect(session.flow).toBe(changed);
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
		flowOf(addPhase(flow, actionId, { kind: 'whole', name: '', beats: { at: 0, len: 8 } }));

	/** 畫面跟著 session 的流程更新，像在編輯頁裡一樣。 */
	const live = (flow: Flow, actionId: string | null) => setup(flow, actionId);

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
		const session = live(rated(withLib(), 'x2'), 'x2');
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm2' } });
		expect(session.flow!.actions[1].members).toEqual([
			{ memberId: 'm1', role: '上層', squad: 'g1' },
			{ memberId: 'm2', role: '底層', squad: 'g1' }
		]);
		expect(squadTags()).toEqual(['第 1 組', '第 1 組']);
	});

	it('「從別的動作複製人（連任務角色和組）」連組一起帶', async () => {
		let flow = flowOf(setSquad(rated(withLib()), 'x1', ['m2'], 2));
		flow = rated(flow, 'x2');
		const session = live(flow, 'x2');
		const copy = screen.getByLabelText('從別的動作複製人') as HTMLSelectElement;
		expect(copy.options[0].text).toBe('從別的動作複製人（連任務角色和組）…');
		await fireEvent.change(copy, { target: { value: 'x1' } });
		expect(session.flow!.actions[1].members).toEqual([
			// 照號碼對：x1 的第 1 組對到 x2 本來的那一組（g3），第 2 組是新發的組 id。
			{ memberId: 'm1', role: '上層', squad: 'g3' },
			{ memberId: 'm2', role: '主底', squad: 'g4' }
		]);
		expect(squadTags()).toEqual(['第 1 組', '第 2 組']);
	});
});

describe('動作表單：改人會動到紀錄時（真的 session，好幾步）', () => {
	/** Lib 有環節：小美、小A 第 1 組（記了 2 次），小芳、小B 第 2 組（記了 1 次）。 */
	const records = (flow: Flow) => flow.actions[0].successRate!.records.map((t) => t.who);
	const people = (session: EditorSession) => session.flow!.actions[0].members.map((m) => m.memberId);
	const dialog = () => screen.getByRole('alertdialog');
	const press = (name: string) => fireEvent.click(within(dialog()).getByRole('button', { name }));

	it('移出小美：先問，按取消什麼都沒改；再移出一次，選保留舊紀錄，人少了、紀錄留著；可以復原', async () => {
		const flow = recordedFlow();
		const session = setup(flow, 'x1');

		await fireEvent.click(screen.getByRole('button', { name: '把 小美 移出這個動作' }));
		expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual(['保留舊紀錄', '清掉重算', '取消']);
		await press('取消');
		expect(session.flow).toBe(flow);
		expect(screen.getByRole('button', { name: '把 小美 移出這個動作' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: '把 小美 移出這個動作' }));
		await press('保留舊紀錄');
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(people(session)).toEqual(['m2', 'm3', 'm4']);
		expect(records(session.flow!)).toEqual(records(flow));
		expect(screen.queryByRole('button', { name: '把 小美 移出這個動作' })).toBeNull();

		session.undo();
		expect(people(session)).toEqual(['m1', 'm2', 'm3', 'm4']);
	});

	it('移出小美選清掉重算：第 1 組的紀錄清掉，第 2 組的留著', async () => {
		const session = setup(recordedFlow(), 'x1');
		await fireEvent.click(screen.getByRole('button', { name: '把 小美 移出這個動作' }));
		await press('清掉重算');
		expect(people(session)).toEqual(['m2', 'm3', 'm4']);
		expect(records(session.flow!)).toHaveLength(1);
	});
});

describe('新動作表單：移出最後一個人', () => {
	it('選一個人打開表單，把他移出：不出錯，表單收起來，焦點到「＋ 新動作」', async () => {
		setup(sample(), null, 0, ['m1']);
		await fireEvent.click(screen.getByRole('button', { name: '把 小A 移出這個動作' }));
		expect(document.activeElement).toBe(screen.getByRole('button', { name: '＋ 新動作' }));
	});
});
