// 頁面：環節和拍點的小事。環節名字按 Enter 就加入、預設接上一個環節後面的種類；
// 分組浮動列標出選的人在哪一組、人員清單可以照組排；放手位、步驟也跳下一拍、新選取「給誰」回到全部、
// 「給誰」分任務角色和隊員兩組、按住 Shift 小窗不擋點擊；拍點可以複製、貼上（同一個動作、別的動作都行）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { addAction, placeCue, setSquad, type Flow } from '#lib/core';
import { flowOf, libSample } from '#lib/test-flows.js';
import { editorPage } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/**
 * libSample（x1：Lib 第 1 個八拍，有環節，小美、小A 第 1 組，小B、小芳 第 2 組）
 * 拍點：1-1 down、1-2 up（給全部）、1-2 high V（給上層）。
 * 再加 x2：Lib2（技巧，第 2 個八拍），小美上層、小A 主底，沒有拍點、沒有環節。
 */
function sample(): Flow {
	let flow = flowOf(placeCue(libSample(), 'x1', { kind: 'count', at: 0, len: 2, word: 'down' }));
	flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 2, len: 2, word: 'up' }));
	flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 2, len: 2, word: 'high V', who: { role: '上層' } }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	return flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib2', start: 16, length: 16, note: '', members }));
}

function open(flow = sample()) {
	const page = editorPage(flow);
	render(Page, page.props);
	return page;
}

const selectAction = (id: string) => fireEvent.click(document.querySelector(`[data-lane="m1"] [data-action-id="${id}"]`)!);
const grid = () => within(screen.getByRole('group', { name: '拍點' }));
const pop = () => within(screen.getByRole('dialog', { name: '拍點小窗' }));
const popPhase = () => within(pop().getByRole('group', { name: '環節' }));
/** 格子上選到的拍（aria-pressed 的數字格）。 */
const picked = () => grid().getAllByRole('button', { pressed: true }).map((b) => b.getAttribute('aria-label'));
/** 格子裡的環節（跨八拍的後半段不算）。 */
const gridPhases = () => grid().queryAllByRole('button', { name: /^環節 / }).map((b) => b.getAttribute('aria-label'));
/** 選的動作的拍點：「種類 字 at+len 給誰」。 */
const cuesOf = (session: ReturnType<typeof open>['session'], id: string) =>
	(session.flow!.actions.find((a) => a.id === id)!.cues ?? []).map(
		(c) => `${c.kind} ${c.word} ${c.at}+${c.len}${c.who ? ` ${JSON.stringify(c.who)}` : ''}`
	);

async function select(from: string, to = from) {
	await fireEvent.click(grid().getByRole('button', { name: from }));
	if (to !== from) await fireEvent.click(grid().getByRole('button', { name: to }), { shiftKey: true });
}

describe('加環節', () => {
	it('環節的名字欄按 Enter 就加入', async () => {
		open();
		await selectAction('x2');
		await select('2-1', '2-3');
		const name = popPhase().getByRole('textbox', { name: '環節的名字' });
		await fireEvent.input(name, { target: { value: '延伸' } });
		await fireEvent.keyDown(name, { key: 'Enter' });
		expect(gridPhases()).toEqual(['環節 上法 延伸 2-1 到 2-3']);
	});

	it('第二個環節預設接上一個環節後面的種類，不是上法', async () => {
		open();
		await selectAction('x2');
		await select('2-1', '2-3');
		const kind = () => popPhase().getByRole<HTMLSelectElement>('combobox', { name: '環節的種類' }).value;
		expect(kind()).toBe('load');
		await fireEvent.click(popPhase().getByRole('button', { name: '加入環節' }));
		await select('2-4', '2-6');
		expect(kind()).toBe('hold');
	});

	it('選到已經有環節的動作：預設接最後一個環節後面的種類', async () => {
		open();
		await selectAction('x1');
		await select('1-1');
		// Lib 的環節照順序是上法、中段、下法：下法後面還是下法。
		expect(popPhase().getByRole<HTMLSelectElement>('combobox', { name: '環節的種類' }).value).toBe('dismount');
	});
});

describe('分組', () => {
	it('選的人都在第 1 組：浮動列的「1」是按下的', async () => {
		open();
		await selectAction('x1');
		await fireEvent.click(document.querySelector('[data-lane="m1"] .lab')!);
		const bar = within(screen.getByRole('group', { name: '分組' }));
		expect(bar.getByRole('button', { name: '放進第 1 組' }).getAttribute('aria-pressed')).toBe('true');
		expect(bar.getByRole('button', { name: '放進第 2 組' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('人員清單打勾「照組排」就照組號排', async () => {
		let flow = flowOf(setSquad(libSample(), 'x1', ['m1', 'm3'], 1));
		flow = flowOf(setSquad(flow, 'x1', ['m2', 'm4'], 2));
		open(flow);
		await selectAction('x1');
		const names = () => [...document.querySelectorAll('.action-form .people li .name')].map((n) => n.textContent);
		expect(names()).toEqual(['小美', '小A', '小B', '小芳']);
		await fireEvent.click(screen.getByRole('checkbox', { name: '照組排' }));
		expect(names()).toEqual(['小美', '小B', '小A', '小芳']);
	});
});

describe('放拍點', () => {
	it('放一個手位、步驟：選取都跳到下一拍', async () => {
		open();
		await selectAction('x2');
		await select('2-1');
		await fireEvent.click(pop().getByRole('button', { name: 'high V' }));
		expect(picked()).toEqual(['2-2']);
		await fireEvent.click(pop().getByRole('button', { name: '下手' }));
		expect(picked()).toEqual(['2-3']);
	});

	it('「給誰」分成「任務角色」和「隊員」兩組', async () => {
		open();
		await selectAction('x2');
		await select('2-1');
		const who = within(pop().getByRole('combobox', { name: '給誰' }));
		const group = (name: string) => within(who.getByRole('group', { name })).getAllByRole('option').map((o) => o.textContent);
		expect(group('任務角色')).toEqual(['上層', '主底']);
		expect(group('隊員')).toEqual(['小美', '小A']);
	});

	it('點另一拍重新選：「給誰」回到全部；Shift 延長選取時不變', async () => {
		open();
		await selectAction('x2');
		await select('2-1');
		const who = () => pop().getByRole<HTMLSelectElement>('combobox', { name: '給誰' });
		const whoText = () => who().selectedOptions[0].textContent;
		await fireEvent.change(who(), { target: { value: '1' } });
		expect(whoText()).toBe('上層');
		await fireEvent.click(grid().getByRole('button', { name: '2-3' }), { shiftKey: true });
		expect(whoText()).toBe('上層');
		await fireEvent.click(grid().getByRole('button', { name: '2-5' }));
		expect(whoText()).toBe('全部');
	});

	it('按住 Shift 時小窗不擋點擊（點得到小窗下面的格子），放開就恢復', async () => {
		open();
		await selectAction('x2');
		await select('2-1');
		const box = () => screen.getByRole('dialog', { name: '拍點小窗' });
		await fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
		expect(box().classList).toContain('through');
		await fireEvent.keyUp(window, { key: 'Shift' });
		expect(box().classList).not.toContain('through');
	});
});

describe('複製、貼上拍點', () => {
	it('選兩拍 ⌘C，到別的動作選一拍 ⌘V：拍點照原本的相對位置貼上，給的角色也帶過去', async () => {
		const { session } = open();
		await selectAction('x1');
		await select('1-1', '1-2');
		await fireEvent.keyDown(grid().getByRole('button', { name: '1-2' }), { key: 'c', metaKey: true });
		await selectAction('x2');
		await select('2-3');
		await fireEvent.keyDown(grid().getByRole('button', { name: '2-3' }), { key: 'v', metaKey: true });
		expect(cuesOf(session, 'x2')).toEqual(['count down 4+2', 'count up 6+2', 'motion high V 6+2 {"role":"上層"}']);
	});

	it('小窗的「複製」「貼上」按鈕：貼在同一個動作的別的拍', async () => {
		const { session } = open();
		await selectAction('x1');
		await select('1-1', '1-2');
		await fireEvent.click(pop().getByRole('button', { name: '複製選的拍點' }));
		await select('1-5');
		await fireEvent.click(pop().getByRole('button', { name: '貼上拍點' }));
		expect(cuesOf(session, 'x1')).toEqual([
			'count down 0+2',
			'count up 2+2',
			'motion high V 2+2 {"role":"上層"}',
			'count down 8+2',
			'count up 10+2',
			'motion high V 10+2 {"role":"上層"}'
		]);
	});

	it('還沒複製時「貼上」不能按；貼到超出動作的地方就擋下並說原因', async () => {
		const { session } = open();
		await selectAction('x1');
		await select('1-1', '1-2');
		expect(pop().getByRole<HTMLButtonElement>('button', { name: '貼上拍點' }).disabled).toBe(true);
		await fireEvent.click(pop().getByRole('button', { name: '複製選的拍點' }));
		await select('1-8');
		await fireEvent.click(pop().getByRole('button', { name: '貼上拍點' }));
		expect(pop().getByRole('alert').textContent).toContain('動作裡面');
		expect(cuesOf(session, 'x1')).toHaveLength(3);
	});

	it('貼到別的動作，給的隊員不在那個動作裡：改成給全部', async () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'step', at: 8, len: 2, word: '上', who: { member: 'm3' } }));
		const { session } = open(flow);
		await selectAction('x1');
		await select('1-5');
		await fireEvent.click(pop().getByRole('button', { name: '複製選的拍點' }));
		await selectAction('x2');
		await select('2-1');
		await fireEvent.click(pop().getByRole('button', { name: '貼上拍點' }));
		expect(cuesOf(session, 'x2')).toEqual(['step 上 0+2']);
	});
});
