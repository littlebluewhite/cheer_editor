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

describe('上層、中層畫在最上面', () => {
	it('raised 裡的人最後畫（蓋在別人上面），有黃框和陰影的樣式', () => {
		const members: Member[] = ['小A', '小B', '小C'].map((name, i) => ({
			id: `m${i + 1}`,
			name,
			gender: 'F',
			globalRole: 'base'
		}));
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members,
			positions: { m1: [0, 0], m2: [0, 0], m3: [1, 0] },
			raised: ['m1']
		});
		const dots = [...document.querySelectorAll<SVGGElement>('[data-member-id]')];
		expect(dots.map((d) => d.dataset.memberId)).toEqual(['m2', 'm3', 'm1']);
		expect(dots.map((d) => d.classList.contains('raised'))).toEqual([false, false, true]);
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

describe('在場上選人、整組拖', () => {
	const members: Member[] = ['小A', '小B', '小C'].map((name, i) => ({
		id: `m${i + 1}`,
		name,
		gender: 'F',
		globalRole: 'base'
	}));
	/** 假的螢幕座標換算：1 px = 1 cm，原點對齊中心 X。 */
	const toMeters = (e: { clientX: number; clientY: number }): Position => [
		e.clientX / 100,
		e.clientY / 100
	];

	function setup(selected: string[] = []) {
		const onmove = vi.fn<(moves: Record<string, Position>) => void>();
		const onselect = vi.fn<(ids: string[]) => void>();
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members,
			positions: { m1: [0, 0], m2: [1, 0], m3: [3, 3] },
			selected,
			onmove,
			onselect,
			toMeters
		});
		const svg = screen.getByRole('img', { name: '場地' }) as unknown as SVGSVGElement;
		const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
		return { onmove, onselect, svg, dot };
	}

	async function dragFrom(
		el: Element,
		from: [number, number],
		to: [number, number],
		shiftKey = false
	) {
		await fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], button: 0, shiftKey });
		await fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1] });
		await fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1] });
	}

	it('選到的人有記號', () => {
		const { dot } = setup(['m2']);
		expect(dot('m1').classList.contains('selected')).toBe(false);
		expect(dot('m2').classList.contains('selected')).toBe(true);
	});

	it('點人只選他；Shift＋點加進來或拿掉', async () => {
		const { onselect, dot } = setup(['m1']);
		await dragFrom(dot('m2'), [100, 0], [100, 0]);
		expect(onselect).toHaveBeenLastCalledWith(['m2']);
		await dragFrom(dot('m3'), [300, 300], [300, 300], true);
		expect(onselect).toHaveBeenLastCalledWith(['m1', 'm3']);
		await dragFrom(dot('m1'), [0, 0], [0, 0], true);
		expect(onselect).toHaveBeenLastCalledWith([]);
	});

	it('拖空白處框選：框裡的人被選到，拖的時候畫出框；Shift 是加選', async () => {
		const { onselect, svg } = setup(['m3']);
		await fireEvent.pointerDown(svg, { clientX: -50, clientY: -50, button: 0 });
		await fireEvent.pointerMove(svg, { clientX: 150, clientY: 50 });
		expect(document.querySelector('[data-lasso]')).not.toBeNull();
		await fireEvent.pointerUp(svg, { clientX: 150, clientY: 50 });
		expect(onselect).toHaveBeenLastCalledWith(['m1', 'm2']);
		expect(document.querySelector('[data-lasso]')).toBeNull();

		await dragFrom(svg, [50, 50], [-50, -50], true);
		expect(onselect).toHaveBeenLastCalledWith(['m1', 'm3']);
	});

	it('點空白處清除選取', async () => {
		const { onselect, svg } = setup(['m1']);
		await dragFrom(svg, [500, 500], [500, 500]);
		expect(onselect).toHaveBeenLastCalledWith([]);
	});

	it('選了好幾個人時，拖其中一個整組一起移（照拖的那個人吸附）', async () => {
		const { onmove, dot } = setup(['m1', 'm2']);
		await dragFrom(dot('m1'), [0, 0], [46, 3]);
		expect(onmove).toHaveBeenCalledOnce();
		const [moves] = onmove.mock.calls[0];
		expect(Object.keys(moves).sort()).toEqual(['m1', 'm2']);
		expect(moves.m1[0]).toBeCloseTo(0.4572, 4);
		expect(moves.m2[0]).toBeCloseTo(1.4572, 4);
		expect(moves.m2[1]).toBeCloseTo(0, 4);
	});

	it('拖沒被選到的人，只移他一個', async () => {
		const { onmove, dot } = setup(['m1', 'm2']);
		await dragFrom(dot('m3'), [300, 300], [346, 300]);
		expect(Object.keys(onmove.mock.calls[0][0])).toEqual(['m3']);
	});
});

describe('影子和走位線', () => {
	const members: Member[] = ['小A', '小B', '小C'].map((name, i) => ({
		id: `m${i + 1}`,
		name,
		gender: 'F',
		globalRole: 'base'
	}));
	const walk = (memberId: string, from: Position, to: Position, tooFast = false) => ({
		memberId,
		from,
		to,
		departSec: 0,
		arriveSec: 1,
		speed: 1,
		tooFast
	});

	function setup(selected: string[]) {
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members,
			positions: { m1: [1, 0], m2: [2, 0], m3: [3, 0] },
			selected,
			ghosts: { m1: [0, 0], m2: [0, 1], m3: [3, 0] },
			walks: [walk('m1', [0, 0], [1, 0]), walk('m2', [0, 1], [2, 0], true)]
		});
		const ids = (key: 'ghost' | 'walkLine') =>
			[...document.querySelectorAll<SVGElement>('svg *')].flatMap((el) => el.dataset[key] ?? []);
		return { ghosts: () => ids('ghost'), lines: () => ids('walkLine') };
	}

	it('沒選人：畫全隊的影子和走位線', () => {
		const { ghosts, lines } = setup([]);
		expect(ghosts()).toEqual(['m1', 'm2', 'm3']);
		expect(lines()).toEqual(['m1', 'm2']);
	});

	it('有選人：只畫選到的人', () => {
		const { ghosts, lines } = setup(['m2', 'm3']);
		expect(ghosts()).toEqual(['m2', 'm3']);
		expect(lines()).toEqual(['m2']);
	});

	it('線從起點畫到終點；太快的線標紅', () => {
		setup([]);
		const line = document.querySelector('[data-walk-line="m2"]')!;
		expect([line.getAttribute('x1'), line.getAttribute('y1')]).toEqual(['0', '1']);
		expect([line.getAttribute('x2'), line.getAttribute('y2')]).toEqual(['2', '0']);
		expect(line.classList.contains('fast')).toBe(true);
		const slow = document.querySelector('[data-walk-line="m1"]')!;
		expect(slow.classList.contains('fast')).toBe(false);
	});

	it('沒給影子和走位（八拍表的小站位圖）就不畫', () => {
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members,
			positions: { m1: [1, 0] }
		});
		expect(document.querySelector('[data-ghost], [data-walk-line]')).toBeNull();
	});
});
