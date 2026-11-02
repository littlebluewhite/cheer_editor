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
import Lanes from './Lanes.svelte';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（150 BPM，一個半拍 0.2 秒）：Lib（小A 上層、小B 沒任務）0–3.2 秒，小C 騰翻 1.6–2.4 秒。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, ['小A', '小B', '小C'].map((name) => ({ name, gender: 'F', globalRole: 'base' })))
	);
	flow = flowOf(addSegment(flow, 'music'));
	const base = { segmentId: 's1', note: '' };
	flow = flowOf(
		addAction(flow, {
			...base,
			category: 'stunt',
			name: 'Lib',
			start: 0,
			length: 16,
			members: [
				{ memberId: 'm1', role: '上層' },
				{ memberId: 'm2', role: null }
			]
		})
	);
	return flowOf(
		addAction(flow, {
			...base,
			category: 'tumbling',
			name: '',
			start: 8,
			length: 4,
			members: [{ memberId: 'm3', role: '騰翻' }]
		})
	);
}

function setup(playheadSec: number, selectedActionId: string | null = null) {
	const onselectaction = vi.fn();
	render(Lanes, { flow: sample(), playheadSec, pxPerSec: 10, selectedActionId, onselectaction });
	return { onselectaction };
}

const lanes = () => [...document.querySelectorAll<HTMLElement>('[data-lane]')];
const bars = (lane: HTMLElement) => [...lane.querySelectorAll<HTMLElement>('[data-action-id]')];

describe('泳道', () => {
	it('一人一條，照名單順序；動作是色條，顏色照大類，上面寫那個人的任務角色', () => {
		setup(0);
		expect(lanes().map((l) => l.dataset.lane)).toEqual(['m1', 'm2', 'm3']);
		const [a] = bars(lanes()[0]);
		expect(a.dataset.actionId).toBe('x1');
		expect(a.textContent).toContain('上層');
		expect(a.style.left).toBe('0px');
		expect(a.style.width).toBe('32px');
		const [c] = bars(lanes()[2]);
		expect(c.textContent).toContain('騰翻');
		expect(c.style.left).toBe('16px');
		// 不同大類不同顏色
		expect(a.style.background).not.toBe(c.style.background);
	});

	it('播放頭那一拍沒在動作裡的人名字變灰、標「閒」', () => {
		setup(0.5);
		const idle = lanes().map((l) => l.querySelector('.idle-tag') !== null);
		expect(idle).toEqual([false, false, true]);
	});

	it('點色條選這個動作；選到的色條有框', async () => {
		const { onselectaction } = setup(0, 'x1');
		await fireEvent.click(bars(lanes()[2])[0]);
		expect(onselectaction).toHaveBeenCalledWith('x2');
		expect(bars(lanes()[0])[0].classList.contains('selected')).toBe(true);
	});
});

it('沒有人時沒有泳道', () => {
	const flow = flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } }));
	render(Lanes, { flow, playheadSec: 0, pxPerSec: 10, selectedActionId: null, onselectaction: vi.fn() });
	expect(screen.queryAllByRole('button')).toHaveLength(0);
	expect(lanes()).toHaveLength(0);
});
