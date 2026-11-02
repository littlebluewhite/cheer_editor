import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	updateSegment,
	type CommandResult,
	type Flow
} from '#lib/core';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ActionForm from './ActionForm.svelte';

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
		await fireEvent.change(screen.getByLabelText('小B 的任務角色'), { target: { value: '中層' } });
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

	it('沒有人就被流程核心擋下，顯示原因', async () => {
		const { onchange } = setup(sample(), null);
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(screen.getByRole('alert').textContent).toBe('一個動作至少要有 1 個人');
		expect(onchange).not.toHaveBeenCalled();
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

		await fireEvent.change(screen.getByLabelText('小A 的任務角色'), { target: { value: '' } });
		expect(onchange.mock.calls[0][0].actions[0].members).toEqual([{ memberId: 'm1', role: null }]);
	});

	it('刪除動作', async () => {
		const { onchange, onselect } = setup(withTwo(), 'x2');
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(onchange.mock.calls[0][0].actions.map((a: { id: string }) => a.id)).toEqual(['x1']);
		expect(onselect).toHaveBeenCalledWith(null);
	});
});
