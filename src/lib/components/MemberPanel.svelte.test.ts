import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	setMarkers,
	type CommandResult,
	type Flow
} from '#lib/core';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import MemberPanel from './MemberPanel.svelte';

function okFlow(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

// jsdom 沒有 scrollIntoView：記下被捲過去的元素。
const scrolled: Element[] = [];
Element.prototype.scrollIntoView = function () {
	scrolled.push(this);
};

/** 等畫面跑一格（捲過去是等下一格才捲）。 */
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

const empty = okFlow(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));

/** 放一個帶著 flow 的 session 進 context，畫隊員名單；回傳 session。 */
function setup(flow: Flow = empty) {
	const { editor, session } = testEditor(flow);
	render(TestSession, { props: { editor, component: MemberPanel, props: {} } });
	return session;
}

async function fillNew(names: string, gender: string, role: string) {
	await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: names } });
	await fireEvent.change(screen.getByLabelText('性別'), { target: { value: gender } });
	await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: role } });
	await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
}

describe('隊員名單', () => {
	it('加一個隊員：名字、性別、全局角色', async () => {
		const session = setup();
		await fillNew('小A', 'F', 'base');
		expect(session.canUndo).toBe(true);
		expect(session.flow!.members).toEqual([
			expect.objectContaining({ name: '小A', gender: 'F', globalRole: 'base' })
		]);
	});

	it('加隊員被擋下的原因，改了加隊員的欄位就收掉', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		expect(screen.getByRole('alert')).toBeTruthy();
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A' } });
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('有同名的隊員時提醒（不擋）', async () => {
		setup();
		await fillNew('王小明\n阿強', 'M', 'base');
		expect(screen.queryByRole('note')).toBeNull();
		await fillNew('王小明', 'M', 'base');
		expect(screen.getByRole('note').textContent).toContain('有同名的隊員：「王小明」');
	});

	it('一行一個名字，一次加多人', async () => {
		const session = setup();
		await fillNew('小A\n小B\n\n小C', 'M', 'top');
		expect(session.flow!.members.map((m) => m.name)).toEqual(['小A', '小B', '小C']);
	});

	it('選性別不會帶入全局角色；沒選全局角色就被擋下', async () => {
		const session = setup();
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'M' } });
		expect((screen.getByLabelText('全局角色') as HTMLSelectElement).value).toBe('');
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('請選全局角色');
	});

	it('名單上的圓圈寫標記，跟場上一樣', () => {
		const flow = okFlow(
			addMembers(empty, [
				{ name: '王小明', gender: 'F', globalRole: 'top' },
				{ name: '李美', gender: 'M', globalRole: 'base' }
			])
		);
		setup(okFlow(setMarkers(flow, 'initial')));
		expect([...document.querySelectorAll('li .no')].map((el) => el.textContent)).toEqual(['王', '李']);
	});

	it('名單照順序列出，可以改名字', async () => {
		const flow = okFlow(
			addMembers(empty, [
				{ name: '小A', gender: 'F', globalRole: 'top' },
				{ name: '小B', gender: 'M', globalRole: 'base' }
			])
		);
		const session = setup(flow);
		const second = screen.getByLabelText('第 2 位隊員的名字') as HTMLInputElement;
		expect(second.value).toBe('小B');
		await fireEvent.change(second, { target: { value: '候補小C' } });
		expect(session.flow!.members.map((m) => m.name)).toEqual(['小A', '候補小C']);
	});

	it('滿 40 人時加隊員表單停用，寫為什麼', () => {
		const forty = Array.from({ length: 40 }, (_, i) => ({
			name: `隊員${i + 1}`,
			gender: 'F' as const,
			globalRole: 'top' as const
		}));
		setup(okFlow(addMembers(empty, forty)));
		expect(screen.getByText(/40 \/ 40/)).toBeTruthy();
		expect(screen.getByRole('button', { name: '加隊員' }).matches(':disabled')).toBe(true);
		expect(screen.getByText('已經 40 人了（一支流程最多 40 人），刪掉隊員才能再加')).toBeTruthy();
	});

	it('超過 40 人時寫還能加幾人，一個都不加', async () => {
		const some = Array.from({ length: 38 }, (_, i) => ({
			name: `隊員${i + 1}`,
			gender: 'F' as const,
			globalRole: 'top' as const
		}));
		const session = setup(okFlow(addMembers(empty, some)));
		await fillNew('小A\n小B\n小C', 'F', 'base');
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('一支流程最多 40 人，這次加 3 人，只能再加 2 人');
	});

	it('從試算表貼「名字<Tab>性別<Tab>全局角色」：每個人用自己那一行的性別和全局角色', async () => {
		const session = setup();
		await fillNew('王小明\t男\t底層\n李美\t女\t上層\n阿強', 'M', 'top');
		expect(session.flow!.members).toEqual([
			expect.objectContaining({ name: '王小明', gender: 'M', globalRole: 'base' }),
			expect.objectContaining({ name: '李美', gender: 'F', globalRole: 'top' }),
			expect.objectContaining({ name: '阿強', gender: 'M', globalRole: 'top' })
		]);
	});

	it('有幾行認不得：其他行照加，所有錯誤一次列出，輸入框只留下沒加進去的行', async () => {
		const session = setup();
		await fillNew('小A\n小B\t男孩\t底層\n小C\n小D\t女\t中層', 'F', 'base');
		expect(session.flow!.members.map((m) => m.name)).toEqual(['小A', '小C']);
		expect(screen.getByRole('alert').textContent).toBe(
			'「小B」：性別要寫「男」或「女」「小D」：「中層」是任務角色（每個動作各自設），全局角色要寫「底層」或「上層」'
		);
		expect((screen.getByLabelText(/^名字/) as HTMLTextAreaElement).value).toBe('小B\t男孩\t底層\n小D\t女\t中層');
	});

	it('加完之後表單記住這次選的性別和全局角色，名字清掉', async () => {
		setup();
		await fillNew('小A', 'F', 'top');
		expect((screen.getByLabelText(/^名字/) as HTMLTextAreaElement).value).toBe('');
		expect((screen.getByLabelText('性別') as HTMLSelectElement).value).toBe('F');
		expect((screen.getByLabelText('全局角色') as HTMLSelectElement).value).toBe('top');
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('名字超過 20 個字：加的時候擋下；改名字時切到前 20 個字存進去，不整段退回', async () => {
		const session = setup();
		const long = '一二三四五六七八九十一二三四五六七八九十一';
		await fillNew(long, 'F', 'top');
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('隊員名字最多 20 個字');
		await fillNew('小A', 'F', 'top');
		const input = screen.getByLabelText('第 1 位隊員的名字') as HTMLInputElement;
		await fireEvent.change(input, { target: { value: long } });
		expect(screen.queryByRole('alert')).toBeNull();
		expect(input.value).toBe(long.slice(0, 20));
		expect(session.flow!.members[0].name).toBe(long.slice(0, 20));
	});

	it('被擋下的原因在名單下面看不到時，捲過去讓它看得到', async () => {
		const forty = Array.from({ length: 39 }, (_, i) => ({
			name: `隊員${i + 1}`,
			gender: 'F' as const,
			globalRole: 'top' as const
		}));
		setup(okFlow(addMembers(empty, forty)));
		scrolled.length = 0;
		await fillNew('小A\n小B', 'F', 'base');
		await frame();
		expect(scrolled).toEqual([screen.getByRole('alert')]);
	});
});

describe('排順序', () => {
	const three = () =>
		okFlow(
			addMembers(empty, [
				{ name: '小A', gender: 'F', globalRole: 'top' },
				{ name: '小B', gender: 'M', globalRole: 'base' },
				{ name: '小C', gender: 'M', globalRole: 'base' }
			])
		);
	const names = () => [...document.querySelectorAll<HTMLInputElement>('li input')].map((i) => i.value);
	const markers = () => [...document.querySelectorAll('li .no')].map((el) => el.textContent);

	it('每一列有「往上」「往下」：換位置，號碼跟著變，可以復原', async () => {
		const session = setup(three());
		await fireEvent.click(screen.getByRole('button', { name: '第 3 位隊員往上' }));
		expect(names()).toEqual(['小A', '小C', '小B']);
		expect(markers()).toEqual(['1', '2', '3']);
		expect(session.flow!.members.map((m) => m.id)).toEqual(['m1', 'm3', 'm2']);
		await fireEvent.click(screen.getByRole('button', { name: '第 1 位隊員往下' }));
		expect(names()).toEqual(['小C', '小A', '小B']);
		session.undo();
		session.undo();
		expect(session.flow!.members.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
	});

	it('第一個不能往上、最後一個不能往下', () => {
		setup(three());
		expect((screen.getByRole('button', { name: '第 1 位隊員往上' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: '第 3 位隊員往下' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: '第 2 位隊員往上' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('移到頭、尾按鈕變灰時，焦點換到同一列的另一顆，不掉到 body', async () => {
		setup(three());
		const up = screen.getByRole('button', { name: '第 2 位隊員往上' });
		up.focus();
		await fireEvent.click(up);
		await tick();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: '第 1 位隊員往下' }));
	});

	it('拖一列的把手放到別列：移到那一列的位置', async () => {
		const session = setup(three());
		const rows = document.querySelectorAll('li');
		await fireEvent.dragStart(rows[0].querySelector('[draggable="true"]')!);
		await fireEvent.dragOver(rows[2]);
		await fireEvent.drop(rows[2]);
		expect(session.flow!.members.map((m) => m.name)).toEqual(['小B', '小C', '小A']);
	});
});

describe('刪隊員', () => {
	/** 小A 和小B；小A 一個人做一個動作。 */
	function twoWithAction(): Flow {
		let flow = okFlow(
			addMembers(empty, [
				{ name: '小A', gender: 'F', globalRole: 'top' },
				{ name: '小B', gender: 'M', globalRole: 'base' }
			])
		);
		flow = okFlow(addSegment(flow, 'music'));
		return okFlow(
			addAction(flow, {
				segmentId: 's1',
				category: 'jump',
				name: 'T',
				start: 0,
				length: 16,
				note: '',
				members: [{ memberId: 'm1', role: null }]
			})
		);
	}

	it('確認框在名單下面看不到時，捲過去讓它看得到', async () => {
		setup(twoWithAction());
		scrolled.length = 0;
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 1 位隊員' }));
		await frame();
		expect(scrolled).toHaveLength(1);
		expect(scrolled[0].contains(screen.getByRole('alertdialog'))).toBe(true);
	});

	it('確認出現在那一列旁邊，寫名字、標記、全局角色', async () => {
		setup(twoWithAction());
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 2 位隊員' }));
		const box = screen.getByRole('alertdialog');
		expect(box.closest('li')).toBe(document.querySelectorAll('li')[1]);
		expect(box.textContent).toContain('刪掉隊員「小B」（標記 2、底層）：他不在任何動作裡');
		expect(box.textContent).not.toContain('0 個');
	});

	it('按刪除先列出「他在 N 個動作裡，其中 M 個會被整個刪掉」，按確定才刪', async () => {
		const session = setup(twoWithAction());
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 1 位隊員' }));
		expect(session.canUndo).toBe(false);
		const box = screen.getByRole('alertdialog');
		expect(box.textContent).toContain('刪掉隊員「小A」（標記 1、上層）：他在 1 個動作裡，其中 1 個會被整個刪掉');
		expect(box.textContent).toContain('動作「跳躍·T」（音樂 1 1-1 起）');
		await fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
		const flow = session.flow!;
		expect(flow.members.map((m) => m.name)).toEqual(['小B']);
		expect(flow.actions).toEqual([]);
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});

	it('按取消就不刪', async () => {
		const session = setup(twoWithAction());
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 2 位隊員' }));
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(session.canUndo).toBe(false);
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});
});
