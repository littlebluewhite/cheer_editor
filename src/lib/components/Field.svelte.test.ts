import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { addMembers, createFlow, setPositions, type Clash, type Flow, type Member, type Position } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import { Playback } from '#lib/playback.svelte.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import Field from './Field.svelte';

/** 這幾個人站在開頭那張站位的流程（還沒有段）。 */
function flowWith(members: Member[], positions: Record<string, Position>): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, members.map(({ name, gender, globalRole }) => ({ name, gender, globalRole }))));
	return flowOf(setPositions(flow, flow.formations[0].id, positions));
}

/** 編輯頁的場地：流程放進 session、選好人，播放頭在 0 秒。操作後讀 session。 */
function renderEditing(
	members: Member[],
	positions: Record<string, Position>,
	props: Record<string, unknown> = {},
	{ selected = [], multi = false }: { selected?: string[]; multi?: boolean } = {}
) {
	const { editor, session } = testEditor(flowWith(members, positions));
	session.selectMembers(selected);
	session.multiSelect = multi;
	render(TestSession, {
		props: {
			editor,
			component: Field,
			props: { field: { strips: 9, layout: 'vertical' }, members, positions, ...props }
		}
	});
	return session;
}

/** 開頭那張站位裡這個人的位置。 */
const posOf = (s: EditorSession, id: string) => s.flow!.formations[0].pos[id];

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
	it('點上寫標記；兩個字的標記字小一點', () => {
		const members: Member[] = ['王小明', '李美'].map((name, i) => ({
			id: `m${i + 1}`,
			name,
			gender: 'F',
			globalRole: 'base'
		}));
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members,
			markers: { m1: '王明', m2: '李' },
			positions: { m1: [0, 0], m2: [1, 0] }
		});
		const texts = [...document.querySelectorAll('[data-member-id] text')];
		expect(texts.map((t) => t.textContent)).toEqual(['王明', '李']);
		expect(texts.map((t) => t.classList.contains('long'))).toEqual([true, false]);
	});

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

describe('組號小圓', () => {
	const members: Member[] = ['小A', '小B', '小C'].map((name, i) => ({
		id: `m${i + 1}`,
		name,
		gender: 'F',
		globalRole: 'base'
	}));
	const badge = (id: string) => document.querySelector(`[data-member-id="${id}"] .badge`);

	it('給了組號的人頭上有小圓，寫號碼、塗組色；沒給的人沒有', () => {
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members,
			positions: { m1: [0, 0], m2: [1, 0], m3: [2, 0] },
			badges: { m1: { text: '1', color: '#2563eb' }, m2: { text: '?', color: '#9ca3af' } }
		});
		expect(badge('m1')?.textContent).toBe('1');
		expect(badge('m1')?.querySelector('circle')?.style.fill).toBe('rgb(37, 99, 235)');
		expect(badge('m2')?.textContent).toBe('?');
		expect(badge('m3')).toBeNull();
	});

	it('沒給組號就都沒有小圓', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' }, members, positions: { m1: [0, 0] } });
		expect(badge('m1')).toBeNull();
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
		const session = renderEditing(members, { m1: [0, 0] }, { toMeters });
		const dot = document.querySelector('[data-member-id="m1"]')!;
		return { session, dot };
	}

	it('放開時位置吸到附近的 1/4，改進播放頭這一拍的站位（公尺），算一步', async () => {
		const jump = vi.spyOn(Playback.prototype, 'jump');
		const { session, dot } = setup();
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: 46, clientY: 3 });
		await fireEvent.pointerUp(dot, { clientX: 46, clientY: 3 });
		expect(session.canUndo).toBe(true);
		expect(posOf(session, 'm1')[0]).toBeCloseTo(0.4572, 4);
		expect(posOf(session, 'm1')[1]).toBeCloseTo(0, 4);
		expect(jump).toHaveBeenCalledWith(0, false);
		jump.mockRestore();
	});

	it('拖的時候左下角顯示位置文字、冒出吸附小點；放開就收起來', async () => {
		const { dot } = setup();
		expect(document.querySelectorAll('[data-snap-point]')).toHaveLength(0);
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: 46, clientY: 3 });
		expect(screen.getByText(/^小A\s第 5 條 左起 3\/4｜正面起第 4 格 1\/2$/)).toBeTruthy();
		expect(document.querySelectorAll('[data-snap-point]').length).toBeGreaterThan(0);
		await fireEvent.pointerUp(dot, { clientX: 46, clientY: 3 });
		expect(screen.queryByText(/第 5 條/)).toBeNull();
		expect(document.querySelectorAll('[data-snap-point]')).toHaveLength(0);
	});

	it('點一下沒有拖，就不改位置', async () => {
		const { session, dot } = setup();
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerUp(dot, { clientX: 0, clientY: 0 });
		expect(session.canUndo).toBe(false);
	});

	it('鍵盤：Tab 停得到人，Enter 跟點一下一樣（Shift 加選、拿掉），空白鍵不選（留給播放）；方向鍵移 1/4 格、Shift 移一格，連續移算一步', async () => {
		const { session, dot } = setup();
		expect(dot.getAttribute('tabindex')).toBe('0');
		await fireEvent.keyDown(dot, { key: 'Enter' });
		expect(session.selectedMemberIds).toEqual(['m1']);
		await fireEvent.keyDown(dot, { key: 'Enter', shiftKey: true });
		expect(session.selectedMemberIds).toEqual([]);
		expect(await fireEvent.keyDown(dot, { key: ' ' })).toBe(true);
		expect(session.selectedMemberIds).toEqual([]);
		await fireEvent.keyDown(dot, { key: 'ArrowRight' });
		expect(posOf(session, 'm1')[0]).toBeCloseTo(0.4572, 4);
		await fireEvent.keyDown(dot, { key: 'ArrowDown', shiftKey: true });
		expect(posOf(session, 'm1')[1]).toBeCloseTo(1.8288, 4);
		session.undo();
		expect(posOf(session, 'm1')).toEqual([0, 0]);
		expect(session.canUndo).toBe(false);
	});

	it('八拍表的小站位圖（沒有 session）：人不能用 Tab 停', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' }, members, positions: { m1: [0, 0] }, controls: false });
		expect(document.querySelector('[data-member-id="m1"]')!.getAttribute('tabindex')).toBeNull();
	});

	it('放大到 ×2 以上會吸到 1/8', async () => {
		const { session, dot } = setup();
		await fireEvent.click(screen.getByRole('button', { name: '放大' }));
		await fireEvent.click(screen.getByRole('button', { name: '放大' }));
		await fireEvent.click(screen.getByRole('button', { name: '放大' }));
		await fireEvent.click(screen.getByRole('button', { name: '放大' }));
		expect(screen.getByText(/×2\.\d/)).toBeTruthy();
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: 22, clientY: 0 });
		await fireEvent.pointerUp(dot, { clientX: 22, clientY: 0 });
		expect(posOf(session, 'm1')[0]).toBeCloseTo(0.2286, 4);
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

	function setup(selected: string[] = [], multi = false) {
		const session = renderEditing(members, { m1: [0, 0], m2: [1, 0], m3: [3, 3] }, { toMeters }, { selected, multi });
		const svg = screen.getByRole('img', { name: '場地' }) as unknown as SVGSVGElement;
		const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
		return { session, svg, dot };
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
		const { session, dot } = setup(['m1']);
		await dragFrom(dot('m2'), [100, 0], [100, 0]);
		expect(session.selectedMemberIds).toEqual(['m2']);
		await dragFrom(dot('m3'), [300, 300], [300, 300], true);
		expect(session.selectedMemberIds).toEqual(['m2', 'm3']);
		await dragFrom(dot('m2'), [100, 0], [100, 0], true);
		expect(session.selectedMemberIds).toEqual(['m3']);
		expect(dot('m3').classList.contains('selected')).toBe(true);
	});

	it('拖空白處框選：框裡的人被選到，拖的時候畫出框；Shift 是加選', async () => {
		const { session, svg } = setup(['m3']);
		await fireEvent.pointerDown(svg, { clientX: -50, clientY: -50, button: 0 });
		await fireEvent.pointerMove(svg, { clientX: 150, clientY: 50 });
		expect(document.querySelector('[data-lasso]')).not.toBeNull();
		await fireEvent.pointerUp(svg, { clientX: 150, clientY: 50 });
		expect(session.selectedMemberIds).toEqual(['m1', 'm2']);
		expect(document.querySelector('[data-lasso]')).toBeNull();

		await dragFrom(svg, [250, 250], [350, 350], true);
		expect(session.selectedMemberIds).toEqual(['m1', 'm2', 'm3']);
	});

	it('多選開著：不按 Shift，點人、框選也是加進來或拿掉（iPad 沒有 Shift）', async () => {
		const { session, dot, svg } = setup(['m1'], true);
		await dragFrom(dot('m3'), [300, 300], [300, 300]);
		expect(session.selectedMemberIds).toEqual(['m1', 'm3']);
		await dragFrom(dot('m1'), [0, 0], [0, 0]);
		expect(session.selectedMemberIds).toEqual(['m3']);
		await dragFrom(svg, [50, 50], [150, -50]);
		expect(session.selectedMemberIds).toEqual(['m2', 'm3']);
	});

	it('兩根手指：捏合放大、一起拖移動畫面；不會選人、拖人', async () => {
		const { session, dot, svg } = setup();
		const finger = (id: number, x: number, y: number) => ({
			pointerType: 'touch',
			pointerId: id,
			button: 0,
			clientX: x,
			clientY: y
		});
		const zoomText = () => document.querySelector('.zoom')!.textContent;
		await fireEvent.pointerDown(dot('m1'), finger(1, 0, 0));
		await fireEvent.pointerDown(svg, finger(2, 100, 0));
		await fireEvent.pointerMove(svg, finger(2, 200, 0));
		expect(zoomText()).toBe('×2.0');
		const viewX = () => Number(svg.getAttribute('viewBox')!.split(' ')[0]);
		const before = viewX();
		// 兩指一起往右 50 px：畫面往左挪（看到更左邊）
		await fireEvent.pointerMove(svg, finger(1, 50, 0));
		await fireEvent.pointerMove(svg, finger(2, 250, 0));
		expect(viewX()).toBeLessThan(before);
		await fireEvent.pointerUp(svg, finger(2, 250, 0));
		// 剩一根手指也不接著拖人
		await fireEvent.pointerMove(svg, finger(1, 300, 0));
		await fireEvent.pointerUp(svg, finger(1, 300, 0));
		expect(session.canUndo).toBe(false);
		expect(session.selectedMemberIds).toEqual([]);
		// 都放開了，一根手指又能點人
		await fireEvent.pointerDown(dot('m2'), finger(3, 100, 0));
		await fireEvent.pointerUp(svg, finger(3, 100, 0));
		expect(session.selectedMemberIds).toEqual(['m2']);
	});

	it('觸控板捏合（一連串 Ctrl＋滾輪的小事件）照手指比例放大，不會一下跳到很大；滑鼠滾一格放大一點', async () => {
		const { svg } = setup();
		const zoomText = () => document.querySelector('.zoom')!.textContent;
		// 捏合一次：20 個 deltaY -2 的事件，加起來放大 e^0.4 ≈ 1.5 倍
		for (let i = 0; i < 20; i++) await fireEvent.wheel(svg, { deltaY: -2, ctrlKey: true, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×1.5');
		// 一直捏下去也有上限
		for (let i = 0; i < 100; i++) await fireEvent.wheel(svg, { deltaY: -20, ctrlKey: true, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×8.0');
		await fireEvent.click(screen.getByRole('button', { name: /全場/ }));
		await fireEvent.wheel(svg, { deltaY: -100, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×1.3');
	});

	it('手指沒剛好按在點上：22 px 以內最近的人也算按到；再遠就是框選或清除', async () => {
		const { session, svg } = setup();
		const touch = { pointerType: 'touch', pointerId: 1, button: 0 };
		await fireEvent.pointerDown(svg, { ...touch, clientX: 115, clientY: 10 });
		await fireEvent.pointerUp(svg, { ...touch, clientX: 115, clientY: 10 });
		expect(session.selectedMemberIds).toEqual(['m2']);
		await fireEvent.pointerDown(svg, { ...touch, clientX: 150, clientY: 0 });
		await fireEvent.pointerUp(svg, { ...touch, clientX: 150, clientY: 0 });
		expect(session.selectedMemberIds).toEqual([]);
	});

	it('點空白處清除選取', async () => {
		const { session, svg } = setup(['m1']);
		await dragFrom(svg, [500, 500], [500, 500]);
		expect(session.selectedMemberIds).toEqual([]);
	});

	it('選了好幾個人時，拖其中一個整組一起移（照拖的那個人吸附）', async () => {
		const { session, dot } = setup(['m1', 'm2']);
		await dragFrom(dot('m1'), [0, 0], [46, 3]);
		expect(session.canUndo).toBe(true);
		expect(posOf(session, 'm1')[0]).toBeCloseTo(0.4572, 4);
		expect(posOf(session, 'm2')[0]).toBeCloseTo(1.4572, 4);
		expect(posOf(session, 'm2')[1]).toBeCloseTo(0, 4);
		expect(posOf(session, 'm3')).toEqual([3, 3]);
	});

	it('鍵盤：選了好幾個人時，在其中一個上按方向鍵整組一起移', async () => {
		const { session, dot } = setup(['m1', 'm2']);
		await fireEvent.keyDown(dot('m1'), { key: 'ArrowLeft' });
		expect(posOf(session, 'm1')[0]).toBeCloseTo(-0.4572, 4);
		expect(posOf(session, 'm2')[0]).toBeCloseTo(1 - 0.4572, 4);
		expect(posOf(session, 'm3')).toEqual([3, 3]);
	});

	it('拖沒被選到的人，只移他一個', async () => {
		const { session, dot } = setup(['m1', 'm2']);
		await dragFrom(dot('m3'), [300, 300], [346, 300]);
		expect(posOf(session, 'm3')).not.toEqual([3, 3]);
		expect(posOf(session, 'm1')).toEqual([0, 0]);
		expect(posOf(session, 'm2')).toEqual([1, 0]);
	});
});

describe('影子和走位線', () => {
	const members: Member[] = ['小A', '小B', '小C'].map((name, i) => ({
		id: `m${i + 1}`,
		name,
		gender: 'F',
		globalRole: 'base'
	}));
	const walk = (memberId: string, from: Position, to: Position, tooFast = false, tiring = false) => ({
		memberId,
		from,
		to,
		departSec: 0,
		arriveSec: 1,
		speed: 1,
		tooFast,
		tiring
	});

	function setup(selected: string[]) {
		renderEditing(
			members,
			{ m1: [1, 0], m2: [2, 0], m3: [3, 0] },
			{
				ghosts: { m1: [0, 0], m2: [0, 1], m3: [3, 1] },
				walks: [
					walk('m1', [0, 0], [1, 0]),
					walk('m2', [0, 1], [2, 0], true),
					walk('m3', [3, 1], [3, 0], false, true)
				]
			},
			{ selected }
		);
		const ids = (key: 'ghost' | 'walkLine') =>
			[...document.querySelectorAll<SVGElement>('svg *')].flatMap((el) => el.dataset[key] ?? []);
		return { ghosts: () => ids('ghost'), lines: () => ids('walkLine') };
	}

	it('沒選人：畫全隊的影子和走位線', () => {
		const { ghosts, lines } = setup([]);
		expect(ghosts()).toEqual(['m1', 'm2', 'm3']);
		expect(lines()).toEqual(['m1', 'm2', 'm3']);
	});

	it('有選人：只畫選到的人', () => {
		const { ghosts, lines } = setup(['m2', 'm3']);
		expect(ghosts()).toEqual(['m2', 'm3']);
		expect(lines()).toEqual(['m2', 'm3']);
	});

	it('線從起點畫到終點；太快的線標紅', () => {
		setup([]);
		const line = document.querySelector('[data-walk-line="m2"]')!;
		expect([line.getAttribute('x1'), line.getAttribute('y1')]).toEqual(['0', '1']);
		expect([line.getAttribute('x2'), line.getAttribute('y2')]).toEqual(['2', '0']);
		expect(line.classList.contains('fast')).toBe(true);
		const slow = document.querySelector('[data-walk-line="m1"]')!;
		expect(slow.classList.contains('fast')).toBe(false);
		expect(slow.classList.contains('tiring')).toBe(false);
	});

	it('很喘的線標橘', () => {
		setup([]);
		const line = document.querySelector('[data-walk-line="m3"]')!;
		expect(line.classList.contains('tiring')).toBe(true);
		expect(line.classList.contains('fast')).toBe(false);
	});

	it('勾「只看橘紅走位線」：白線藏起來，紅、橘照畫；取消勾全部回來', async () => {
		const { ghosts, lines } = setup([]);
		const toggle = screen.getByRole<HTMLInputElement>('checkbox', { name: '只看橘紅走位線' });
		expect(toggle.checked).toBe(false);
		await fireEvent.click(toggle);
		expect(toggle.checked).toBe(true);
		expect(lines()).toEqual(['m2', 'm3']);
		// 影子不受影響。
		expect(ghosts()).toEqual(['m1', 'm2', 'm3']);
		await fireEvent.click(toggle);
		expect(lines()).toEqual(['m1', 'm2', 'm3']);
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

describe('撞位', () => {
	const members: Member[] = ['小A', '小B'].map((name, i) => ({
		id: `m${i + 1}`,
		name,
		gender: 'F',
		globalRole: 'base'
	}));
	const clash: Clash = { memberIds: ['m1', 'm2'], sec: 3.2, pos: [1, 0.5], startSec: 2.6, endSec: 3.8, formationId: 'f2' };

	it('在撞位的位置畫紫色 ✕，標出是哪兩個人', () => {
		renderEditing(members, { m1: [0, 0], m2: [2, 0] }, { clashes: [clash] });
		const marks = document.querySelectorAll<SVGElement>('[data-clash]');
		expect(marks).toHaveLength(1);
		expect(marks[0].getAttribute('transform')).toBe('translate(1,0.5)');
		expect(marks[0].textContent).toContain('小A');
		expect(marks[0].textContent).toContain('小B');
		expect(screen.getByText('撞位')).toBeTruthy();
	});

	it('沒給撞位就不畫', () => {
		renderEditing(members, { m1: [0, 0], m2: [2, 0] });
		expect(document.querySelector('[data-clash]')).toBeNull();
	});
});
