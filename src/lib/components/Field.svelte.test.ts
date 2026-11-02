import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Member, Position } from '#lib/core';
import Field from './Field.svelte';

/** 場地上寫的條編號，照畫的順序。 */
function stripNumbers(): string[] {
	return Array.from(document.querySelectorAll('[data-strip-number]'), (el) => el.textContent ?? '');
}

describe('場地', () => {
	it('9 條直放畫出 9 條，編號 1–9', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' } });
		expect(stripNumbers()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
	});

	it('5 條橫放畫出 5 條', () => {
		render(Field, { field: { strips: 5, layout: 'horizontal' } });
		expect(stripNumbers()).toHaveLength(5);
	});

	it('正面在下面，標「正面／裁判」', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' } });
		expect(screen.getByText(/正面／裁判/)).toBeTruthy();
	});
});

describe('在場上拖人', () => {
	const members: Member[] = [{ id: 'm1', name: '小A', gender: 'F', globalRole: 'top' }];
	/** 假的螢幕座標換算：1 px = 1 cm，原點對齊中心 X。 */
	const toMeters = (e: { clientX: number; clientY: number }): Position => [
		e.clientX / 100,
		e.clientY / 100
	];

	function setup() {
		const onmove = vi.fn<(moves: Record<string, Position>) => void>();
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members,
			positions: { m1: [0, 0] },
			onmove,
			toMeters
		});
		const dot = document.querySelector('[data-member-id="m1"]')!;
		return { onmove, dot };
	}

	it('放開時位置吸到附近的 1/4，送出公尺位置', async () => {
		const { onmove, dot } = setup();
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: 46, clientY: 3 });
		await fireEvent.pointerUp(dot, { clientX: 46, clientY: 3 });
		expect(onmove).toHaveBeenCalledTimes(1);
		const [moves] = onmove.mock.calls[0];
		expect(moves.m1[0]).toBeCloseTo(0.4572, 4);
		expect(moves.m1[1]).toBeCloseTo(0, 4);
	});

	it('拖的時候左下角顯示位置文字、冒出吸附小點；放開就收起來', async () => {
		const { dot } = setup();
		expect(document.querySelectorAll('[data-snap-point]')).toHaveLength(0);
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: 46, clientY: 3 });
		expect(screen.getByText(/^小A\s第 5 條 左起 3\/4｜前起第 4 格 1\/2$/)).toBeTruthy();
		expect(document.querySelectorAll('[data-snap-point]').length).toBeGreaterThan(0);
		await fireEvent.pointerUp(dot, { clientX: 46, clientY: 3 });
		expect(screen.queryByText(/第 5 條/)).toBeNull();
		expect(document.querySelectorAll('[data-snap-point]')).toHaveLength(0);
	});

	it('點一下沒有拖，就不改位置', async () => {
		const { onmove, dot } = setup();
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerUp(dot, { clientX: 0, clientY: 0 });
		expect(onmove).not.toHaveBeenCalled();
	});

	it('放大到 ×2 以上會吸到 1/8', async () => {
		const { onmove, dot } = setup();
		await fireEvent.click(screen.getByRole('button', { name: '放大' }));
		await fireEvent.click(screen.getByRole('button', { name: '放大' }));
		await fireEvent.click(screen.getByRole('button', { name: '放大' }));
		await fireEvent.click(screen.getByRole('button', { name: '放大' }));
		expect(screen.getByText(/×2\.\d/)).toBeTruthy();
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: 22, clientY: 0 });
		await fireEvent.pointerUp(dot, { clientX: 22, clientY: 0 });
		expect(onmove.mock.calls[0][0].m1[0]).toBeCloseTo(0.2286, 4);
	});
});
