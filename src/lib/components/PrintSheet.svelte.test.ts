import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	insertFormation,
	setPositions,
	type CommandResult,
	type Flow
} from '#lib/core';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import PrintSheet from './PrintSheet.svelte';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（150 BPM、8 個八拍），第 2 個八拍有一張站位；第 1 個八拍 小A 上層、小B 主底做 Lib，第 3 拍後半拍 小C 跳。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' },
			{ name: '小C', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(
		addAction(flow, {
			segmentId: 's1',
			category: 'stunt',
			name: 'Lib',
			start: 0,
			length: 16,
			note: '',
			members: [
				{ memberId: 'm1', role: '上層' },
				{ memberId: 'm2', role: '主底' }
			]
		})
	);
	flow = flowOf(
		addAction(flow, {
			segmentId: 's1',
			category: 'jump',
			name: '',
			start: 5,
			length: 2,
			note: '',
			members: [{ memberId: 'm3', role: null }]
		})
	);
	return flowOf(insertFormation(flow, 3.2));
}

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
/** 欄位：段、八拍、開始（秒）、動作、站位。小站位圖裡有隊員名字，所以只看動作那一格。 */
const actionsCell = (row: HTMLElement) => within(row).getAllByRole('cell')[3].textContent!;

describe('八拍表列印', () => {
	it('預設印全隊：一列一個八拍，寫段、第幾個八拍、開始秒數和這個八拍開始的動作', () => {
		render(PrintSheet, { flow: sample(), onclose: vi.fn(), print: vi.fn() });
		const rows = bodyRows();
		expect(rows).toHaveLength(8);
		expect(rows[1].textContent).toContain('音樂 1');
		expect(rows[1].textContent).toContain('3.2');
		const first = actionsCell(rows[0]);
		expect(first).toContain('技巧');
		expect(first).toContain('Lib');
		expect(first).toContain('小A（上層）');
		expect(first).toContain('小B（主底）');
		expect(first).toContain('3 的 &');
		expect(first).toContain('跳躍');
		expect(first).toContain('小C');
	});

	it('有站位開始的那一列附小站位圖', () => {
		render(PrintSheet, { flow: sample(), onclose: vi.fn(), print: vi.fn() });
		const rows = bodyRows();
		expect(within(rows[0]).getAllByRole('img', { name: '場地' })).toHaveLength(1);
		expect(within(rows[1]).getAllByRole('img', { name: '場地' })).toHaveLength(1);
		expect(within(rows[2]).queryByRole('img', { name: '場地' })).toBeNull();
		// 小圖只是看的：沒有放大縮小的按鈕
		expect(within(rows[0]).queryByRole('button', { name: '放大' })).toBeNull();
	});

	it('選一個隊員時只列他參加的動作和他的任務角色', async () => {
		render(PrintSheet, { flow: sample(), onclose: vi.fn(), print: vi.fn() });
		await fireEvent.change(screen.getByLabelText('印誰'), { target: { value: 'm2' } });
		const first = actionsCell(bodyRows()[0]);
		expect(first).toContain('小B（主底）');
		expect(first).not.toContain('小A');
		expect(first).not.toContain('跳躍');
		expect(screen.getByRole('heading').textContent).toContain('小B');
	});

	it('選一個隊員時，他出發的那一列在動作下面多寫一行走位；全隊不寫', async () => {
		let flow = sample();
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1, 2] }));
		render(PrintSheet, { flow, onclose: vi.fn(), print: vi.fn() });
		expect(screen.queryByText(/出發/)).toBeNull();
		await fireEvent.change(screen.getByLabelText('印誰'), { target: { value: 'm1' } });
		const first = actionsCell(bodyRows()[0]);
		expect(first).toContain('Lib');
		expect(first).toContain('1-1 出發 → 站位 2（2-1 到）');
		expect(actionsCell(bodyRows()[1])).not.toContain('出發');
	});

	it('按「列印」叫瀏覽器列印；「關閉」關掉', async () => {
		const print = vi.fn();
		const onclose = vi.fn();
		render(PrintSheet, { flow: sample(), onclose, print });
		await fireEvent.click(screen.getByRole('button', { name: '列印' }));
		expect(print).toHaveBeenCalledOnce();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(onclose).toHaveBeenCalledOnce();
	});
});
