import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { addMembers, createFlow, type CommandResult, type Flow } from '#lib/core';
import MemberPanel from './MemberPanel.svelte';

function okFlow(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

const empty = okFlow(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));

function setup(flow: Flow = empty) {
	const onchange = vi.fn<(flow: Flow) => void>();
	render(MemberPanel, { flow, onchange });
	return { onchange };
}

async function fillNew(names: string, gender: string, role: string) {
	await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: names } });
	await fireEvent.change(screen.getByLabelText('性別'), { target: { value: gender } });
	await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: role } });
	await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
}

describe('隊員名單', () => {
	it('加一個隊員：名字、性別、全局角色', async () => {
		const { onchange } = setup();
		await fillNew('小A', 'F', 'base');
		expect(onchange).toHaveBeenCalledTimes(1);
		expect(onchange.mock.calls[0][0].members).toEqual([
			expect.objectContaining({ name: '小A', gender: 'F', globalRole: 'base' })
		]);
	});

	it('一行一個名字，一次加多人', async () => {
		const { onchange } = setup();
		await fillNew('小A\n小B\n\n小C', 'M', 'top');
		expect(onchange.mock.calls[0][0].members.map((m) => m.name)).toEqual(['小A', '小B', '小C']);
	});

	it('選性別不會帶入全局角色；沒選全局角色就被擋下', async () => {
		const { onchange } = setup();
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'M' } });
		expect((screen.getByLabelText('全局角色') as HTMLSelectElement).value).toBe('');
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		expect(onchange).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toBe('請選全局角色');
	});

	it('名單照順序列出，可以改名字', async () => {
		const flow = okFlow(
			addMembers(empty, [
				{ name: '小A', gender: 'F', globalRole: 'top' },
				{ name: '小B', gender: 'M', globalRole: 'base' }
			])
		);
		const { onchange } = setup(flow);
		const second = screen.getByLabelText('第 2 位隊員的名字') as HTMLInputElement;
		expect(second.value).toBe('小B');
		await fireEvent.change(second, { target: { value: '候補小C' } });
		expect(onchange.mock.calls[0][0].members.map((m) => m.name)).toEqual(['小A', '候補小C']);
	});

	it('滿 40 人時流程核心擋下，顯示原因', async () => {
		const forty = Array.from({ length: 40 }, (_, i) => ({
			name: `隊員${i + 1}`,
			gender: 'F' as const,
			globalRole: 'top' as const
		}));
		const { onchange } = setup(okFlow(addMembers(empty, forty)));
		expect(screen.getByText(/40 \/ 40/)).toBeTruthy();
		await fillNew('小A', 'F', 'base');
		expect(onchange).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toBe('一支流程最多 40 人');
	});
});
