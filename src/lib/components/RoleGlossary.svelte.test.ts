import { addCustomRole, createFlow, type CommandResult, type Flow } from '#lib/core';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RoleGlossary from './RoleGlossary.svelte';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

const empty = () => flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));

describe('名詞對照表', () => {
	it('列出固定角色和自訂角色：名稱、意思、規則上的叫法', () => {
		const flow = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '把上層丟給中層接' }));
		render(RoleGlossary, { flow, onchange: vi.fn(), onclose: vi.fn() });

		const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
		expect(rows).toHaveLength(12);
		expect(rows[3].textContent).toContain('上層');
		expect(rows[3].textContent).toContain('被撐在最上面的人。');
		expect(rows[3].textContent).toContain('上層人員');
		expect(rows[11].textContent).toContain('丟人的');
		expect(rows[11].textContent).toContain('把上層丟給中層接');
		expect(rows[11].textContent).toContain('自訂');
	});

	it('新增自訂角色；名稱重複時顯示原因', async () => {
		const onchange = vi.fn();
		render(RoleGlossary, { flow: empty(), onchange, onclose: vi.fn() });

		await fireEvent.input(screen.getByLabelText('角色名稱'), { target: { value: '丟人的' } });
		await fireEvent.input(screen.getByLabelText('意思'), { target: { value: '把上層丟上去' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增角色' }));
		expect(onchange).toHaveBeenCalledOnce();
		expect(onchange.mock.calls[0][0].customRoles).toMatchObject([{ name: '丟人的' }]);

		await fireEvent.input(screen.getByLabelText('角色名稱'), { target: { value: '上層' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增角色' }));
		expect(screen.getByRole('alert').textContent).toBe('已經有「上層」這個角色了');
	});
});
