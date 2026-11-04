import { fireEvent, render, screen } from '@testing-library/svelte';
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
import { EditorSession } from '#lib/editor-session.svelte.js';
import TestSession from '#lib/TestSession.svelte';
import MemberPanel from './MemberPanel.svelte';

function okFlow(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

const empty = okFlow(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));

/** 放一個帶著 flow 的 session 進 context，畫隊員名單；回傳 session。 */
function setup(flow: Flow = empty) {
	const session = new EditorSession(flow);
	render(TestSession, { props: { session, component: MemberPanel, props: {} } });
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

	it('滿 40 人時流程核心擋下，顯示原因', async () => {
		const forty = Array.from({ length: 40 }, (_, i) => ({
			name: `隊員${i + 1}`,
			gender: 'F' as const,
			globalRole: 'top' as const
		}));
		const session = setup(okFlow(addMembers(empty, forty)));
		expect(screen.getByText(/40 \/ 40/)).toBeTruthy();
		await fillNew('小A', 'F', 'base');
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('一支流程最多 40 人');
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

	it('按刪除先列出「他在 N 個動作裡，其中 M 個會被整個刪掉」，按確定才刪', async () => {
		const session = setup(twoWithAction());
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 1 位隊員' }));
		expect(session.canUndo).toBe(false);
		const box = screen.getByRole('alertdialog');
		expect(box.textContent).toContain('小A 在 1 個動作裡，其中 1 個會被整個刪掉');
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
