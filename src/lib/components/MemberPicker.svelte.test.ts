import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	type CommandResult,
	type Flow
} from '#lib/core';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MemberPicker from './MemberPicker.svelte';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/**
 * 音樂 1（150 BPM，一個半拍 0.2 秒）；小A 上、小B 底、小C 底。
 * Lib（小A、小B）0–1.6 秒，跳躍（小C）1.6–2.4 秒。
 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' },
			{ name: '小C', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	const base = { segmentId: 's1', note: '', name: '' };
	flow = flowOf(
		addAction(flow, {
			...base,
			category: 'stunt',
			name: 'Lib',
			start: 0,
			length: 8,
			members: [
				{ memberId: 'm1', role: '上層' },
				{ memberId: 'm2', role: '主底' }
			]
		})
	);
	return flowOf(
		addAction(flow, {
			...base,
			category: 'jump',
			start: 8,
			length: 4,
			members: [{ memberId: 'm3', role: null }]
		})
	);
}

function setup(playheadSec: number, selected: string[] = []) {
	const onselect = vi.fn<(ids: string[]) => void>();
	render(MemberPicker, { flow: sample(), playheadSec, selected, onselect });
	return { onselect };
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('選人捷徑', () => {
	it('全隊、全部底層、全部上層、這一拍沒在動作裡的人、不選人', async () => {
		const { onselect } = setup(0.5, ['m1']);
		await click('全隊');
		expect(onselect).toHaveBeenLastCalledWith(['m1', 'm2', 'm3']);
		await click('全部底層');
		expect(onselect).toHaveBeenLastCalledWith(['m2', 'm3']);
		await click('全部上層');
		expect(onselect).toHaveBeenLastCalledWith(['m1']);
		await click('這一拍沒在動作裡的人');
		expect(onselect).toHaveBeenLastCalledWith(['m3']);
		await click('不選人');
		expect(onselect).toHaveBeenLastCalledWith([]);
	});

	it('「沿用上一個動作的人」取播放頭以前最晚結束的動作；再按一次換更早的', async () => {
		const { onselect } = setup(3);
		await click('沿用上一個動作的人');
		expect(onselect).toHaveBeenLastCalledWith(['m3']);
		expect(screen.getByRole('status').textContent).toMatch(/選了「跳躍」的 1 人/);
		await click('沿用上一個動作的人');
		expect(onselect).toHaveBeenLastCalledWith(['m1', 'm2']);
		expect(screen.getByRole('status').textContent).toMatch(/選了「技巧·Lib」的 2 人/);
	});

	it('播放頭前面還沒有動作就說一聲，不改選取', async () => {
		const { onselect } = setup(1);
		await click('沿用上一個動作的人');
		expect(onselect).not.toHaveBeenCalled();
		expect(screen.getByRole('status').textContent).toBe('播放頭前面還沒有動作');
	});

	it('顯示已選幾人、是誰', () => {
		setup(0, ['m3', 'm1']);
		expect(screen.getByText(/已選 2 人：小C、小A/)).toBeTruthy();
	});
});
