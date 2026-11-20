import { createEvent, fireEvent, render, screen } from '@testing-library/svelte';
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

	it('條編號寫在外圍框外面（直放在後面、橫放在左邊）：場外排的人不會蓋到', () => {
		const coords = (attr: 'x' | 'y') =>
			Array.from(document.querySelectorAll('[data-strip-number]'), (el) => Number(el.getAttribute(attr)));
		const outer = (attr: 'x' | 'y') => Number(document.querySelector('rect.margin')!.getAttribute(attr));
		render(Field, { field: { strips: 9, layout: 'vertical' } });
		for (const y of coords('y')) expect(y).toBeLessThan(outer('y'));
		document.body.innerHTML = '';
		render(Field, { field: { strips: 5, layout: 'horizontal' } });
		for (const x of coords('x')) expect(x).toBeLessThan(outer('x'));
	});

	it('格號（#227）：直放寫在左邊外圍框外、正面起 1–7，每個號碼在那一格的前後範圍裡', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' } });
		const els = [...document.querySelectorAll('[data-cell-number]')];
		expect(els.map((el) => el.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
		const outerX = Number(document.querySelector('rect.margin')!.getAttribute('x'));
		// 7 格 × 6 呎 ≈ 12.8 m，中心在 0：第 1 格（正面）在 y 4.6–6.4 m
		const cell = 6 * 0.3048;
		els.forEach((el, i) => {
			const y = Number(el.getAttribute('y'));
			expect(Number(el.getAttribute('x'))).toBeLessThan(outerX);
			expect(y).toBeLessThan(3.5 * cell - i * cell);
			expect(y).toBeGreaterThan(2.5 * cell - i * cell);
		});
	});

	it('格號（#227）：橫放寫在後面外圍框外、左起 1–7，每個號碼在那一格的左右範圍裡', () => {
		render(Field, { field: { strips: 5, layout: 'horizontal' } });
		const els = [...document.querySelectorAll('[data-cell-number]')];
		expect(els.map((el) => el.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
		const outerY = Number(document.querySelector('rect.margin')!.getAttribute('y'));
		const cell = 6 * 0.3048;
		els.forEach((el, i) => {
			const x = Number(el.getAttribute('x'));
			expect(Number(el.getAttribute('y'))).toBeLessThan(outerY);
			expect(x).toBeGreaterThan(-3.5 * cell + i * cell);
			expect(x).toBeLessThan(-2.5 * cell + i * cell);
		});
	});

	it('八拍表的小站位圖（只畫一塊）不寫格號：擠在裁切的邊上會跟條號疊在一起', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' }, controls: false, crop: { x: -2, y: -2, width: 4, height: 4 } });
		expect(document.querySelectorAll('[data-cell-number]')).toHaveLength(0);
		expect(stripNumbers().length).toBeGreaterThan(0);
	});

	it('正面在下面，標「正面／裁判」', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' } });
		expect(screen.getByText(/正面／裁判/)).toBeTruthy();
	});
});

describe('上層、中層畫在最上面', () => {
	it('多字的標記畫成橫的膠囊，字放得下；一個字的照樣是圓點', () => {
		const members: Member[] = ['隊員25', '李美'].map((name, i) => ({
			id: `m${i + 1}`,
			name,
			gender: 'F',
			globalRole: 'base'
		}));
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members,
			markers: { m1: '隊25', m2: '李' },
			positions: { m1: [0, 0], m2: [2, 0] }
		});
		const pill = document.querySelector('[data-member-id="m1"] rect.base')!;
		expect(Number(pill.getAttribute('width'))).toBeGreaterThan(Number(pill.getAttribute('height')));
		expect(document.querySelector('[data-member-id="m1"] circle.base')).toBeNull();
		expect(document.querySelector('[data-member-id="m2"] circle.base')).not.toBeNull();
	});

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

	const trio: Member[] = ['小A', '小B', '小C'].map((name, i) => ({
		id: `m${i + 1}`,
		name,
		gender: 'F',
		globalRole: 'base'
	}));
	const dotOf = (id: string) => document.querySelector<SVGGElement>(`[data-member-id="${id}"]`)!;
	/** 圓點裡那一層 g 的 transform（放大）。 */
	const inner = (id: string) => dotOf(id).querySelector(':scope > g')!.getAttribute('transform')!;

	it('照層畫：高的層後畫（蓋在上面）；第 2 層以上黃框加陰影，三層再加橘框', () => {
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members: trio,
			positions: { m1: [0, 0], m2: [0, 0], m3: [1, 0] },
			levels: { m1: 3, m3: 2 }
		});
		const dots = [...document.querySelectorAll<SVGGElement>('[data-member-id]')];
		expect(dots.map((d) => d.dataset.memberId)).toEqual(['m2', 'm3', 'm1']);
		expect(dots.map((d) => d.classList.contains('raised'))).toEqual([false, true, true]);
		expect(dots.map((d) => d.classList.contains('lv3'))).toEqual([false, false, true]);
	});

	it('跟下面一層的人疊在同一點時還是畫在真的位置、原本大小（走位時不會跳）', () => {
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members: trio,
			positions: { m1: [0, 0], m2: [0, 0], m3: [3, 0] },
			levels: { m1: 2, m3: 3 }
		});
		for (const id of ['m1', 'm2', 'm3']) expect(inner(id)).toMatch(/^scale\([\d.]+\)$/);
		expect(dotOf('m1').getAttribute('transform')).toBe('translate(0,0)');
	});

	it('只是站在隔壁（圓點碰到邊，位置沒疊在同一點）：不畫虛線圈', () => {
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members: trio,
			// 隔 1/4 格（約 0.46 公尺）比圓點（0.6 公尺）窄：隔壁的圓點一定碰到
			positions: { m1: [0, 0], m2: [0.45, 0], m3: [0, 0.45] },
			levels: { m1: 2 }
		});
		expect(document.querySelectorAll('.covered')).toHaveLength(0);
	});

	it('被不同層蓋到的人多畫一圈虛線；同一層擠在一起的不畫', () => {
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members: [...trio, { id: 'm4', name: '小D', gender: 'F', globalRole: 'base' }],
			positions: { m1: [0, 0], m2: [0, 0], m3: [3, 0], m4: [3.1, 0] },
			levels: { m1: 2 }
		});
		expect(document.querySelectorAll('circle.covered')).toHaveLength(1);
	});

	it('多字膠囊：疊在同一點時下面的人照膠囊的形狀畫虛線框；只有兩端碰到的不畫', () => {
		const markers = { m1: '隊員二十五', m2: '隊員二十六' };
		const positions = { m1: [0, 0] as Position, m2: [0, 0] as Position };
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members: trio.slice(0, 2),
			markers,
			positions,
			levels: { m1: 2 }
		});
		const w = Number(dotOf('m1').querySelector('rect')!.getAttribute('width'));
		expect(document.querySelectorAll('rect.covered')).toHaveLength(1);
		document.body.innerHTML = '';
		// 中心隔得比兩個圓點遠、比兩個膠囊近：只有兩端疊在一起
		render(Field, {
			field: { strips: 9, layout: 'vertical' },
			members: trio.slice(0, 2),
			markers,
			positions: { m1: [0, 0], m2: [w - 0.1, 0] },
			levels: { m1: 2 }
		});
		expect(w - 0.1).toBeGreaterThan(0.6);
		expect(document.querySelectorAll('.covered')).toHaveLength(0);
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
		// 圓點的 <title>（滑鼠停上去的說明）也寫位置，不算
		expect(screen.getByText(/^小A\s第 5 條 左起 3\/4｜正面起第 4 格 1\/2$/, { ignore: 'title' })).toBeTruthy();
		expect(document.querySelectorAll('[data-snap-point]').length).toBeGreaterThan(0);
		await fireEvent.pointerUp(dot, { clientX: 46, clientY: 3 });
		// 拖的人被選到：場地下面改寫「選到的人在哪」
		expect(screen.queryByText(/第 5 條/, { ignore: 'title, [role=note]' })).toBeNull();
		expect(document.querySelectorAll('[data-snap-point]')).toHaveLength(0);
	});

	it('拖的時候的位置文字太長、尾巴變「…」時，title 照樣寫完整的位置（N42）', async () => {
		const { dot } = setup();
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: 46, clientY: 3 });
		const readout = document.querySelector('.readout')!;
		expect(readout.getAttribute('title')).toBe(readout.textContent);
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
		const svg = screen.getByRole('group', { name: '場地' }) as unknown as SVGSVGElement;
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

	it('整組拖出界：停在最遠的合法位置（隊形不變），提示「已靠到邊界」', async () => {
		const { session, dot } = setup(['m1', 'm2']);
		// m2 往左拖 20 m：m1 在他左邊 1 m，先碰到邊界（墊子外 1 m）；整組停在 m1 出界之前
		await dragFrom(dot('m2'), [100, 0], [-1900, 0]);
		const [m1, m2] = [posOf(session, 'm1'), posOf(session, 'm2')];
		expect(m2[0]).toBeCloseTo(-8.2296, 4);
		expect(m2[0] - m1[0]).toBeCloseTo(1, 6);
		expect(session.notice).toBe('已改站位 1；已靠到邊界');
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

	it('觸控板捏合（一連串 Ctrl＋滾輪的小事件）照手指比例放大，不會一下跳到很大；⌘＋滑鼠滾一格放大一點', async () => {
		const { svg } = setup();
		const zoomText = () => document.querySelector('.zoom')!.textContent;
		// 捏合一次：20 個 deltaY -2 的事件，加起來放大 e^0.4 ≈ 1.5 倍
		for (let i = 0; i < 20; i++) await fireEvent.wheel(svg, { deltaY: -2, ctrlKey: true, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×1.5');
		// 一直捏下去也有上限
		for (let i = 0; i < 100; i++) await fireEvent.wheel(svg, { deltaY: -20, ctrlKey: true, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×8.0');
		await fireEvent.click(screen.getByRole('button', { name: '整個場地' }));
		await fireEvent.wheel(svg, { deltaY: -100, metaKey: true, clientX: 0, clientY: 0 });
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

	it('沒有「只看橘紅走位線」的勾選：白、紅、橘的線一律都畫', () => {
		const { lines } = setup([]);
		expect(screen.queryByRole('checkbox', { name: '只看橘紅走位線' })).toBeNull();
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
		expect(screen.getByText('撞位（只看騰翻）')).toBeTruthy();
	});

	it('✕ 畫在隊員圓點上面（SVG 後畫的蓋前面）；按在圓點上的 ✕ 照樣拖得動那個人', async () => {
		const toMeters = (e: { clientX: number; clientY: number }): Position => [e.clientX / 100, e.clientY / 100];
		// 小B 站在 ✕ 的位置上
		const session = renderEditing(members, { m1: [0, 0], m2: [1, 0.5] }, { clashes: [clash], toMeters });
		const mark = document.querySelector('[data-clash]')!;
		const dot = document.querySelector('[data-member-id="m2"]')!;
		expect(dot.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		await fireEvent.pointerDown(mark, { clientX: 100, clientY: 50, button: 0 });
		await fireEvent.pointerMove(mark, { clientX: 146, clientY: 53 });
		await fireEvent.pointerUp(mark, { clientX: 146, clientY: 53 });
		// 往右拖約半公尺：吸到 3/4 格（1.3716 公尺）
		expect(posOf(session, 'm2')[0]).toBeCloseTo(1.3716, 4);
	});

	it('圖例寫出走位速度的門檻：很喘、走太快各是每秒幾公尺', () => {
		renderEditing(members, { m1: [0, 0], m2: [2, 0] });
		expect(screen.getByText('很喘 >2.5 m/s').title).toMatch(/每秒超過 2\.5 公尺/);
		expect(screen.getByText('走太快 >4 m/s').title).toMatch(/每秒超過 4 公尺/);
	});

	it('沒給撞位就不畫', () => {
		renderEditing(members, { m1: [0, 0], m2: [2, 0] });
		expect(document.querySelector('[data-clash]')).toBeNull();
	});
});

describe('放大場地來看（手機的檢視畫面：沒有按鈕、不裁）', () => {
	const members: Member[] = ['小A', '小B'].map((name, i) => ({ id: `m${i + 1}`, name, gender: 'F', globalRole: 'base' }));
	/** 假的螢幕座標換算：1 px = 1 cm，原點對齊中心 X。 */
	const toMeters = (e: { clientX: number; clientY: number }): Position => [e.clientX / 100, e.clientY / 100];

	function setup(props: Record<string, unknown> = {}) {
		render(Field, { field: { strips: 9, layout: 'vertical' }, members, positions: { m1: [0, 0], m2: [3, 0] }, controls: false, toMeters, ...props });
		const svg = screen.getByRole('img', { name: '場地' }) as unknown as SVGSVGElement;
		const viewBox = () => svg.getAttribute('viewBox')!.split(' ').map(Number);
		return { svg, viewBox };
	}
	const finger = (id: number, x: number, y: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: y });
	async function tap(el: Element, x: number, y: number, id = 1) {
		await fireEvent.pointerDown(el, finger(id, x, y));
		await fireEvent.pointerUp(el, finger(id, x, y));
	}
	/** 9 條直放整個場地的範圍（公尺）：外圍框外左右上各 1.3、下面 1。 */
	const FULL = [-10.5296, -8.7008, 21.0592, 17.1016];
	const close = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 4));
	const fit = () => screen.queryByRole('button', { name: '整個場地' });

	it('點兩下放大到 ×2（點的那一點留在手指下面），再點兩下回整個場地', async () => {
		const { svg, viewBox } = setup();
		close(viewBox(), FULL);
		await tap(svg, 100, 50);
		await tap(svg, 100, 50);
		// 看到的範圍剩一半寬、一半高；點的 (1, 0.5) 公尺還在原本那個比例的位置
		close(viewBox(), [-4.7648, -4.1004, 10.5296, 8.5508]);
		await tap(svg, 300, 200);
		await tap(svg, 300, 200);
		close(viewBox(), FULL);
	});

	it('隔很久才點第二下、或點在別的地方：不算點兩下，不放大', async () => {
		const { svg, viewBox } = setup();
		const slow = async (type: 'pointerDown' | 'pointerUp', at: number) => {
			const e = createEvent[type](svg, finger(1, 100, 50));
			Object.defineProperty(e, 'timeStamp', { value: at });
			await fireEvent(svg, e);
		};
		await slow('pointerDown', 1000);
		await slow('pointerUp', 1010);
		await slow('pointerDown', 2000);
		await slow('pointerUp', 2010);
		close(viewBox(), FULL);
		await tap(svg, 400, 50);
		await tap(svg, 100, 50);
		close(viewBox(), FULL);
	});

	it('放大時角落有「整個場地」，按了回整個場地；沒放大時沒有', async () => {
		const { svg, viewBox } = setup();
		expect(fit()).toBeNull();
		await tap(svg, 0, 0);
		await tap(svg, 0, 0);
		await fireEvent.click(fit()!);
		close(viewBox(), FULL);
		expect(fit()).toBeNull();
	});

	it('放大後一根手指拖是移動畫面（指到的那一點跟著手指）；沒放大時拖不動', async () => {
		const { svg, viewBox } = setup();
		const drag = async () => {
			await fireEvent.pointerDown(svg, finger(1, 0, 0));
			await fireEvent.pointerMove(svg, finger(1, -100, -50));
			await fireEvent.pointerUp(svg, finger(1, -100, -50));
		};
		await drag();
		close(viewBox(), FULL);
		await tap(svg, 0, 0);
		await tap(svg, 0, 0);
		const [x, y] = viewBox();
		await drag();
		// 往左上拖 100、50 px（1 px = 1 cm）：看到的範圍往右下移 1、0.5 公尺
		close(viewBox(), [x + 1, y + 0.5, 10.5296, 8.5508]);
	});

	it('兩根手指捏開：放大', async () => {
		const { svg, viewBox } = setup();
		await fireEvent.pointerDown(svg, finger(1, 0, 0));
		await fireEvent.pointerDown(svg, finger(2, 100, 0));
		await fireEvent.pointerMove(svg, finger(2, 200, 0));
		expect(viewBox()[2]).toBeCloseTo(10.5296, 4);
		await fireEvent.pointerUp(svg, finger(2, 200, 0));
		await fireEvent.pointerUp(svg, finger(1, 0, 0));
		expect(fit()).not.toBeNull();
	});

	const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;

	it('點一下圓點：告訴外面點到誰（手指差一點也算）；點空白處是 null；點兩下的第二下是放大，不再說一次', async () => {
		const ontap = vi.fn();
		const { svg, viewBox } = setup({ ontap });
		await tap(dot('m2'), 300, 0);
		await tap(svg, 10, 15);
		await tap(svg, 600, 400);
		expect(ontap.mock.calls).toEqual([['m2'], ['m1'], [null]]);
		await tap(svg, 600, 400);
		expect(viewBox()[2]).toBeCloseTo(10.5296, 4);
		expect(ontap).toHaveBeenCalledTimes(3);
	});

	it('放大場地時圓點在螢幕上一樣大：×2 時圓點在場地單位裡縮成一半', async () => {
		const { svg } = setup();
		const scale = () => Number(/scale\((.+)\)/.exec(dot('m1').querySelector('g')!.getAttribute('transform')!)![1]);
		expect(scale()).toBe(1);
		await tap(svg, 0, 300);
		await tap(svg, 0, 300);
		expect(scale()).toBe(0.5);
	});

	it('號碼條給 0.7 公尺：整個場地的範圍照窄的號碼條', () => {
		const { viewBox } = setup({ numberBand: 0.7 });
		close(viewBox(), [-9.9296, -8.1008, 19.8592, 16.5016]);
	});

	describe('標了「我」，別人畫淡', () => {
		const three: Member[] = [...members, { id: 'm3', name: '小C', gender: 'F', globalRole: 'top' }];
		const positions = { m1: [0, 0], m2: [3, 0], m3: [-3, 3] };
		const dimmed = () => three.filter((m) => dot(m.id).classList.contains('dim')).map((m) => m.id);
		const ringed = () => three.filter((m) => dot(m.id).classList.contains('selected')).map((m) => m.id);

		it('「我」是小A：小B、小C 淡，小A 圈起來', () => {
			setup({ members: three, positions, marked: ['m1'] });
			expect(dimmed()).toEqual(['m2', 'm3']);
			expect(ringed()).toEqual(['m1']);
		});

		it('點到小B：他不淡，跟「我」一樣圈起來；小C 還是淡的', () => {
			setup({ members: three, positions, marked: ['m1'], tapped: 'm2' });
			expect(dimmed()).toEqual(['m3']);
			expect(ringed()).toEqual(['m1', 'm2']);
		});

		it('沒標「我」：點到小B 只圈他，沒有人淡', () => {
			setup({ members: three, positions, tapped: 'm2' });
			expect(dimmed()).toEqual([]);
			expect(ringed()).toEqual(['m2']);
		});

		it('八拍表的小站位圖（只畫一塊）：標的人塗滿，別人不淡', () => {
			setup({ members: three, positions, marked: ['m1'], crop: { x: -4, y: -1, width: 8, height: 5 } });
			expect(dimmed()).toEqual([]);
		});
	});
});

describe('檢視模式（有編輯器、不能改）的場地：手指跟手機的檢視畫面一樣放大來看', () => {
	const members: Member[] = ['小A', '小B', '小C'].map((name, i) => ({ id: `m${i + 1}`, name, gender: 'F', globalRole: 'base' }));
	const positions: Record<string, Position> = { m1: [0, 0], m2: [3, 0], m3: [-3, 3] };
	const toMeters = (e: { clientX: number; clientY: number }): Position => [e.clientX / 100, e.clientY / 100];

	/** 檢視模式：左欄藏起來（頁面給 rail={false}）。 */
	function setup(props: Record<string, unknown> = {}) {
		const { editor, session } = testEditor(flowWith(members, positions));
		session.viewing = true;
		render(TestSession, {
			props: { editor, component: Field, props: { field: { strips: 9, layout: 'vertical' }, members, positions, toMeters, rail: false, ...props } }
		});
		const svg = screen.getByRole('group', { name: '場地' }) as unknown as SVGSVGElement;
		const width = () => Number(svg.getAttribute('viewBox')!.split(' ')[2]);
		const x = () => Number(svg.getAttribute('viewBox')!.split(' ')[0]);
		return { session, svg, width, x };
	}
	const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
	const point = (pointerType: string, x: number, y: number) => ({ pointerType, pointerId: 1, button: 0, clientX: x, clientY: y });
	async function tap(el: Element, x: number, y: number, pointerType = 'touch') {
		await fireEvent.pointerDown(el, point(pointerType, x, y));
		await fireEvent.pointerUp(el, point(pointerType, x, y));
	}
	async function dragBlank(svg: Element) {
		await fireEvent.pointerDown(svg, point('touch', 600, 400));
		await fireEvent.pointerMove(svg, point('touch', 500, 400));
		const lasso = !!document.querySelector('[data-lasso]');
		await fireEvent.pointerUp(svg, point('touch', 500, 400));
		return lasso;
	}

	it('手指點兩下放大到 ×2，右下角有「整個場地」；滑鼠點兩下不放大', async () => {
		const { svg, width } = setup();
		await tap(svg, 600, 400, 'mouse');
		await tap(svg, 600, 400, 'mouse');
		expect(width()).toBeCloseTo(21.0592, 4);
		expect(screen.queryAllByRole('button', { name: '整個場地' })).toHaveLength(0);
		await tap(svg, 600, 400);
		await tap(svg, 600, 400);
		expect(width()).toBeCloseTo(10.5296, 4);
		await fireEvent.click(screen.getByRole('button', { name: '整個場地' }));
		expect(width()).toBeCloseTo(21.0592, 4);
	});

	it('沒放大時手指拖空白處照舊是框選；放大後是移動畫面，不框選', async () => {
		const { svg, x } = setup();
		expect(await dragBlank(svg)).toBe(true);
		await tap(svg, 600, 400);
		await tap(svg, 600, 400);
		const before = x();
		expect(await dragBlank(svg)).toBe(false);
		// 往左拖 100 px（1 px = 1 cm）：看到的範圍往右移 1 公尺
		expect(x()).toBeCloseTo(before + 1, 4);
	});

	it('放大後點一下人照樣選到他，點空白處清掉；按在人身上拖也是移動畫面，不會跳「檢視模式只能看」', async () => {
		const { session, svg, x } = setup();
		await tap(svg, 600, 400);
		await tap(svg, 600, 400);
		await tap(dot('m2'), 300, 0);
		expect(session.selectedMemberIds).toEqual(['m2']);
		const before = x();
		await fireEvent.pointerDown(dot('m2'), point('touch', 300, 0));
		await fireEvent.pointerMove(svg, point('touch', 200, 0));
		await fireEvent.pointerUp(svg, point('touch', 200, 0));
		expect(x()).toBeCloseTo(before + 1, 4);
		expect(session.notice).toBe('');
		await tap(svg, 600, 100);
		expect(session.selectedMemberIds).toEqual([]);
	});

	it('點兩下人：第一下選到他，第二下只放大（選取不變）', async () => {
		const { session, width } = setup();
		await tap(dot('m2'), 300, 0);
		await tap(dot('m2'), 300, 0);
		expect(session.selectedMemberIds).toEqual(['m2']);
		expect(width()).toBeCloseTo(10.5296, 4);
	});

	it('圓點在螢幕上不跟著變大：×2 時在場地單位裡縮成一半', async () => {
		const { svg } = setup();
		await tap(svg, 600, 400);
		await tap(svg, 600, 400);
		expect(dot('m1').querySelector('g')!.getAttribute('transform')).toBe('scale(0.5)');
	});

	it('標了「我」：別人畫淡；點到小B，他不淡（「我」也不淡）', async () => {
		const { svg } = setup({ marked: ['m1'] });
		const dimmed = () => members.filter((m) => dot(m.id).classList.contains('dim')).map((m) => m.id);
		expect(dimmed()).toEqual(['m2', 'm3']);
		await tap(dot('m2'), 300, 0);
		expect(dimmed()).toEqual(['m3']);
		await tap(svg, 600, 400);
		expect(dimmed()).toEqual(['m2', 'm3']);
	});
});
