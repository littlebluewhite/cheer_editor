import { addCustomRole, createFlow, type Flow } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { fakePendingInput, testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RoleGlossary from './RoleGlossary.svelte';

/** 放一個帶著 flow 的 session 進 context，畫名詞對照表；回傳 session。 */
function setup(flow: Flow) {
	const { editor, session } = testEditor(flow);
	render(TestSession, { props: { editor, component: RoleGlossary, props: { onclose: vi.fn() } } });
	return session;
}

const empty = () => flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));

describe('名詞對照表', () => {
	it('列出固定角色和自訂角色：名稱、意思、規則上的叫法', () => {
		const flow = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '把上層丟給中層接' }));
		setup(flow);

		const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
		expect(rows).toHaveLength(12);
		expect(rows[3].textContent).toContain('上層');
		expect(rows[3].textContent).toContain('被撐在最上面的人。');
		expect(rows[3].textContent).toContain('上層人員');
		// 自訂角色的名稱、意思是可以改的輸入框
		expect((within(rows[11]).getByLabelText('「丟人的」的名稱') as HTMLInputElement).value).toBe('丟人的');
		expect((within(rows[11]).getByLabelText('「丟人的」的意思') as HTMLInputElement).value).toBe('把上層丟給中層接');
		expect(rows[11].textContent).toContain('自訂');
	});

	it('新增自訂任務角色；名稱重複時顯示原因', async () => {
		const session = setup(empty());

		await fireEvent.input(screen.getByLabelText('任務角色名稱'), { target: { value: '丟人的' } });
		await fireEvent.input(screen.getByLabelText('意思'), { target: { value: '把上層丟上去' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增任務角色' }));
		expect(session.canUndo).toBe(true);
		expect(session.flow!.customRoles).toMatchObject([{ name: '丟人的' }]);

		await fireEvent.input(screen.getByLabelText('任務角色名稱'), { target: { value: '上層' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增任務角色' }));
		expect(screen.getByRole('alert').textContent).toBe('已經有「上層」這個任務角色了');
	});

	it('自訂角色可以改名稱、意思；固定角色不能改', async () => {
		const session = setup(flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' })));
		expect(screen.queryByLabelText('「上層」的名稱')).toBeNull();
		await fireEvent.change(screen.getByLabelText('「丟人的」的名稱'), { target: { value: '拋人的' } });
		expect(session.flow!.customRoles).toMatchObject([{ name: '拋人的' }]);
		await fireEvent.change(screen.getByLabelText('「拋人的」的意思'), { target: { value: '把上層拋上去' } });
		expect(session.flow!.customRoles).toMatchObject([{ name: '拋人的', meaning: '把上層拋上去' }]);
	});

	it('改名後同一列不重畫：游標不會掉出對照表（按 Tab 還能接著改意思）', async () => {
		setup(flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' })));
		const box = screen.getByLabelText('「丟人的」的名稱');
		await fireEvent.change(box, { target: { value: '拋人的' } });
		expect(screen.getByLabelText('「拋人的」的名稱')).toBe(box);
	});

	it('改名被擋下：顯示原因，欄位回到原本的名字', async () => {
		let flow = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' }));
		flow = flowOf(addCustomRole(flow, { name: '抬腳的', meaning: '' }));
		setup(flow);
		const box = screen.getByLabelText('「丟人的」的名稱') as HTMLInputElement;
		await fireEvent.change(box, { target: { value: '抬腳的' } });
		expect(screen.getByRole('alert').textContent).toBe('已經有「抬腳的」這個任務角色了');
		expect(box.value).toBe('丟人的');
	});

	it('刪自訂角色：沒人用直接刪，可以復原', async () => {
		const session = setup(flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' })));
		await fireEvent.click(screen.getByRole('button', { name: '刪除任務角色「丟人的」' }));
		expect(session.flow!.customRoles).toEqual([]);
		expect(session.canUndo).toBe(true);
	});

	it('關掉之前先送出編輯器裡沒送出的字（跟離開欄位一樣）', async () => {
		const pendingInput = fakePendingInput();
		const { editor } = testEditor(empty(), { pendingInput });
		const onclose = vi.fn();
		render(TestSession, { props: { editor, component: RoleGlossary, props: { onclose } } });
		pendingInput.pending = true;
		pendingInput.onflush = vi.fn();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(pendingInput.onflush).toHaveBeenCalledOnce();
		expect(onclose).toHaveBeenCalledOnce();
	});
});
