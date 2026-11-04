import {
	addAction,
	addMembers,
	addSegment,
	clearPhaseBeats,
	createFlow,
	insertFormation,
	addPhase,
	placeCue,
	setMarkers,
	setPositions,
	setWalks,
	type Flow
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import { EditorSession } from '#lib/editor-session.svelte.js';
import TestSession from '#lib/TestSession.svelte';
import Lanes from './Lanes.svelte';

/** 音樂 1（150 BPM，一個半拍 0.2 秒）：Lib（小A 上層、小B 沒任務）0–3.2 秒，小C 騰翻 1.6–2.4 秒、跳躍 3.2–4.0 秒。 */
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
	flow = flowOf(
		addAction(flow, {
			...base,
			category: 'tumbling',
			name: '',
			start: 8,
			length: 4,
			members: [{ memberId: 'm3', role: '騰翻' }]
		})
	);
	return flowOf(
		addAction(flow, {
			...base,
			category: 'jump',
			name: '',
			start: 16,
			length: 4,
			members: [{ memberId: 'm3', role: null }]
		})
	);
}

/** 把流程放進 session、選好東西，畫泳道；操作後讀 session。 */
function renderLanes(
	flow: Flow,
	{
		playheadSec = 0,
		selectedActionId = null,
		selectedMemberIds = [],
		multi = false
	}: { playheadSec?: number; selectedActionId?: string | null; selectedMemberIds?: string[]; multi?: boolean } = {}
) {
	const session = new EditorSession(flow);
	session.selectAction(selectedActionId);
	session.selectMembers(selectedMemberIds);
	session.multiSelect = multi;
	render(TestSession, { props: { session, component: Lanes, props: { playheadSec, pxPerSec: 10 } } });
	return { session, ask: session.ask };
}

function setup(
	playheadSec: number,
	selectedActionId: string | null = null,
	selectedMemberIds: string[] = [],
	multi = false
) {
	return renderLanes(sample(), { playheadSec, selectedActionId, selectedMemberIds, multi });
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

	it('有辨識色的色條塗辨識色，左邊留一條大類的顏色', () => {
		const flow = sample();
		flow.actions[0].color = '#1565c0';
		renderLanes(flow);
		const [a] = bars(lanes()[0]);
		expect(a.style.background).toBe('rgb(21, 101, 192)');
		expect(a.style.boxShadow).toContain('#d9603b');
		// 沒挑辨識色的照大類塗，不加左邊那條
		expect(bars(lanes()[2])[0].style.boxShadow).toBe('');
	});

	it('每個人的色條都寫動作名稱，不寫大類（顏色就是大類）；沒取名才寫大類', () => {
		setup(0);
		const name = (el: HTMLElement) => el.querySelector('b')?.textContent;
		// Lib 裡的小A、小B 都寫
		expect(name(bars(lanes()[0])[0])).toBe('Lib');
		expect(name(bars(lanes()[1])[0])).toBe('Lib');
		// 小C 的跳躍沒取名
		expect(name(bars(lanes()[2])[1])).toBe('跳躍');
	});

	it('播放頭那一拍沒在動作裡的人名字變灰、標「閒」', () => {
		setup(0.5);
		const idle = lanes().map((l) => l.querySelector('.idle-tag') !== null);
		expect(idle).toEqual([false, false, true]);
	});

	it('點色條選這個動作；選到的色條有框', async () => {
		const { session } = setup(0, 'x1');
		expect(bars(lanes()[0])[0].classList.contains('selected')).toBe(true);
		await fireEvent.click(bars(lanes()[2])[0]);
		expect(session.selectedActionId).toBe('x2');
		expect(bars(lanes()[0])[0].classList.contains('selected')).toBe(false);
		expect(bars(lanes()[2])[0].classList.contains('selected')).toBe(true);
	});
});

describe('拖色條', () => {
	/** 小C 的騰翻色條（1.6–2.4 秒 = 16–24 px）。 */
	const tumble = () => bars(lanes()[2])[0];

	async function dragBy(el: Element, dx: number) {
		await fireEvent.pointerDown(el, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 100 + dx });
		await fireEvent.pointerUp(window, { clientX: 100 + dx });
	}

	it('拖色條移動動作，吸到最近的半拍；拖的時候色條跟著走', async () => {
		const { session, ask } = setup(0);
		await fireEvent.pointerDown(tumble(), { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 95 });
		expect(tumble().style.left).toBe('11px');
		await fireEvent.pointerUp(window, { clientX: 95 });
		// 往左 5 px = 0.5 秒：1.1 秒最近的是第 6 個半拍
		expect(session.canUndo).toBe(true);
		expect(session.flow!.actions[1]).toMatchObject({ id: 'x2', start: 6, length: 4 });
		expect(ask.error).toBe('');
	});

	it('撞到同一人就還原，說原因', async () => {
		const { session, ask } = setup(0);
		await dragBy(tumble(), 10);
		expect(session.canUndo).toBe(false);
		expect(ask.error).toBe('小C 同一時間已經在「跳躍」裡，已還原');
		expect(tumble().style.left).toBe('16px');
	});

	it('拉右邊改長度；撞到同一人就還原', async () => {
		const { session, ask } = setup(0);
		const handle = () => tumble().querySelector('[data-resize]')!;
		// 往右 6 px = 0.6 秒：結束 3.0 秒 = 第 15 個半拍
		await dragBy(handle(), 6);
		expect(session.flow!.actions[1]).toMatchObject({ id: 'x2', start: 8, length: 7 });
		expect(parseFloat(tumble().style.width)).toBeCloseTo(14, 6);
		await dragBy(handle(), 10);
		expect(ask.error).toBe('小C 同一時間已經在「跳躍」裡，已還原');
		expect(parseFloat(tumble().style.width)).toBeCloseTo(14, 6);
	});

	it('只是點一下，不改動作', async () => {
		const { session, ask } = setup(0);
		await dragBy(tumble(), 1);
		expect(session.canUndo).toBe(false);
		expect(ask.error).toBe('');
	});
});

describe('手指拖色條（docs/adr/0005-ipad-touch.md）', () => {
	const tumble = () => bars(lanes()[2])[0];
	const touch = { button: 0, pointerType: 'touch', pointerId: 7 };

	it('沒選中的色條：手指拖不動（留給畫面捲動），點一下選中', async () => {
		const { session } = setup(0);
		expect(tumble().classList.contains('selected')).toBe(false);
		await fireEvent.pointerDown(tumble(), { ...touch, clientX: 100 });
		await fireEvent.pointerMove(window, { ...touch, clientX: 95 });
		expect(tumble().style.left).toBe('16px');
		await fireEvent.pointerUp(window, { ...touch, clientX: 95 });
		expect(session.canUndo).toBe(false);
		await fireEvent.click(tumble());
		expect(session.selectedActionId).toBe('x2');
	});

	it('選中的色條：手指拖得動', async () => {
		const { session } = setup(0, 'x2');
		await fireEvent.pointerDown(tumble(), { ...touch, clientX: 100 });
		await fireEvent.pointerMove(window, { ...touch, clientX: 95 });
		expect(tumble().style.left).toBe('11px');
		await fireEvent.pointerUp(window, { ...touch, clientX: 95 });
		expect(session.flow!.actions[1]).toMatchObject({ id: 'x2', start: 6 });
	});

	it('拖的時候多放一根手指，不會把色條搶走；系統打斷就還原', async () => {
		const { session } = setup(0, 'x2');
		await fireEvent.pointerDown(tumble(), { ...touch, clientX: 100 });
		await fireEvent.pointerMove(window, { ...touch, pointerId: 8, clientX: 300 });
		await fireEvent.pointerUp(window, { ...touch, pointerId: 8, clientX: 300 });
		expect(tumble().style.left).toBe('16px');
		await fireEvent.pointerMove(window, { ...touch, clientX: 95 });
		expect(tumble().style.left).toBe('11px');
		await fireEvent.pointerCancel(window, { ...touch });
		expect(tumble().style.left).toBe('16px');
		await fireEvent.pointerUp(window, { ...touch, clientX: 95 });
		expect(session.canUndo).toBe(false);
	});
});

describe('點泳道上的名字選人', () => {
	const name = (i: number) => lanes()[i].querySelector<HTMLElement>('.lab')!;

	it('名字前面的圓圈寫標記：號碼或開頭字', () => {
		renderLanes(flowOf(setMarkers(sample(), 'initial')));
		const marks = [...document.querySelectorAll('[data-lane] .no')].map((el) => el.textContent);
		expect(marks).toEqual(['小A', '小B', '小C']);
	});

	it('點名字只選這個人；Shift＋點加進來或拿掉', async () => {
		const { session } = setup(0, null, ['m1']);
		expect(name(0).classList.contains('selected')).toBe(true);
		await fireEvent.click(name(1));
		expect(session.selectedMemberIds).toEqual(['m2']);
		await fireEvent.click(name(2), { shiftKey: true });
		expect(session.selectedMemberIds).toEqual(['m2', 'm3']);
		await fireEvent.click(name(1), { shiftKey: true });
		expect(session.selectedMemberIds).toEqual(['m3']);
		expect(name(2).classList.contains('selected')).toBe(true);
	});

	it('多選開著：不按 Shift 點名字也是加進來或拿掉', async () => {
		const { session } = setup(0, null, ['m1'], true);
		await fireEvent.click(name(2));
		expect(session.selectedMemberIds).toEqual(['m1', 'm3']);
		await fireEvent.click(name(0));
		expect(session.selectedMemberIds).toEqual(['m3']);
	});
});

describe('走位條', () => {
	/** 再插一張站位 f2 在 4.8 秒（第 24 個半拍），小A、小B 換位置，小C 不動。預設走位：出發 1.6 秒、到達 4.8 秒。 */
	function walking(): Flow {
		let flow = flowOf(insertFormation(sample(), 4.8));
		const f2 = flow.formations[1];
		flow = flowOf(setPositions(flow, f2.id, { m1: f2.pos.m2, m2: f2.pos.m1 }));
		return flow;
	}

	function setupWalks(selectedMemberIds: string[] = []) {
		const flow = walking();
		return { ...renderLanes(flow, { selectedMemberIds }), f2: flow.formations[1].id };
	}

	const walkBars = (lane: HTMLElement) => [...lane.querySelectorAll<HTMLElement>('[data-walk]')];
	const walkBar = (i: number) => walkBars(lanes()[i])[0];
	const end = (i: number, which: 'depart' | 'arrive') =>
		walkBar(i).querySelector<HTMLElement>(`[data-end="${which}"]`)!;

	async function dragBy(el: Element, dx: number) {
		await fireEvent.pointerDown(el, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 100 + dx });
		await fireEvent.pointerUp(window, { clientX: 100 + dx });
	}

	it('手指：沒選到的人的走位條拖不動，點一下選他；選到了才拖得動', async () => {
		const touch = { button: 0, pointerType: 'touch', pointerId: 3 };
		const { session } = renderLanes(walking());
		await fireEvent.pointerDown(walkBar(0), { ...touch, clientX: 100 });
		await fireEvent.pointerMove(window, { ...touch, clientX: 120 });
		expect(walkBar(0).style.left).toBe('16px');
		await fireEvent.pointerUp(window, { ...touch, clientX: 120 });
		await fireEvent.click(walkBar(0));
		expect(session.selectedMemberIds).toEqual(['m1']);
		expect(session.canUndo).toBe(false);

		await fireEvent.pointerDown(walkBar(0), { ...touch, clientX: 100 });
		await fireEvent.pointerMove(window, { ...touch, clientX: 96 });
		expect(walkBar(0).style.left).toBe('12px');
		await fireEvent.pointerUp(window, { ...touch, clientX: 96 });
		expect(session.canUndo).toBe(true);
	});

	it('有走位的人才有走位條，從出發畫到到達，跟動作色條分開', () => {
		setupWalks();
		expect(walkBars(lanes()[0])).toHaveLength(1);
		expect(walkBars(lanes()[1])).toHaveLength(1);
		expect(walkBars(lanes()[2])).toHaveLength(0);
		expect(walkBar(0).style.left).toBe('16px');
		expect(parseFloat(walkBar(0).style.width)).toBeCloseTo(32, 6);
		expect(walkBar(0).dataset.actionId).toBeUndefined();
	});

	it('走太快的走位條標紅', () => {
		let flow = walking();
		const f2 = flow.formations[1].id;
		flow = flowOf(setPositions(flow, 'f1', { m1: [0, 0] }));
		flow = flowOf(setPositions(flow, f2, { m1: [4, 0] }));
		// 小A 4 公尺 0.2 秒（第 23 到 24 個半拍）。
		flow = flowOf(
			setWalks(flow, f2, {
				m1: { depart: { segmentId: 's1', at: 23 }, arrive: { segmentId: 's1', at: 24 } }
			})
		);
		renderLanes(flow);
		expect(walkBar(0).classList.contains('fast')).toBe(true);
		expect(walkBar(1).classList.contains('fast')).toBe(false);
	});

	it('很喘的走位條標橘', () => {
		let flow = walking();
		const f2 = flow.formations[1].id;
		flow = flowOf(setPositions(flow, 'f1', { m1: [0, 0] }));
		flow = flowOf(setPositions(flow, f2, { m1: [4, 0] }));
		// 小A 4 公尺 1.2 秒（第 18 到 24 個半拍），每秒 3.3 公尺。
		flow = flowOf(
			setWalks(flow, f2, {
				m1: { depart: { segmentId: 's1', at: 18 }, arrive: { segmentId: 's1', at: 24 } }
			})
		);
		renderLanes(flow);
		expect(walkBar(0).classList.contains('tiring')).toBe(true);
		expect(walkBar(0).classList.contains('fast')).toBe(false);
	});

	it('拖左端改出發，吸到最近的半拍；只改這個人', async () => {
		const { session, ask, f2 } = setupWalks();
		// 往右 4 px = 0.4 秒：出發 2.0 秒 = 第 10 個半拍
		await dragBy(end(0, 'depart'), 4);
		expect(ask.error).toBe('');
		const walks = session.flow!.formations[1].walks;
		expect(walks).toEqual({
			m1: { depart: { segmentId: 's1', at: 10 }, arrive: { segmentId: 's1', at: 24 } }
		});
		expect(session.flow!.formations[1].id).toBe(f2);
	});

	it('拖中間兩端一起挪；拖的時候走位條跟著走', async () => {
		const { session } = setupWalks();
		await fireEvent.pointerDown(walkBar(0), { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 96 });
		expect(walkBar(0).style.left).toBe('12px');
		await fireEvent.pointerUp(window, { clientX: 96 });
		expect(session.flow!.formations[1].walks).toEqual({
			m1: { depart: { segmentId: 's1', at: 6 }, arrive: { segmentId: 's1', at: 22 } }
		});
	});

	it('被拖的人在選取裡：選到、同一個間隔有走位的人一起挪一樣多', async () => {
		const { session } = setupWalks(['m1', 'm2', 'm3']);
		await dragBy(walkBar(1), -4);
		expect(session.canUndo).toBe(true);
		expect(session.flow!.formations[1].walks).toEqual({
			m1: { depart: { segmentId: 's1', at: 6 }, arrive: { segmentId: 's1', at: 22 } },
			m2: { depart: { segmentId: 's1', at: 6 }, arrive: { segmentId: 's1', at: 22 } }
		});
	});

	it('被拖的人不在選取裡：只挪他自己', async () => {
		const { session } = setupWalks(['m2']);
		await dragBy(walkBar(0), -4);
		expect(Object.keys(session.flow!.formations[1].walks!)).toEqual(['m1']);
	});

	it('拖出前後兩張站位之間就還原，說原因；整組也一樣', async () => {
		const { session, ask } = setupWalks(['m1', 'm2']);
		await dragBy(end(1, 'arrive'), 4);
		expect(session.canUndo).toBe(false);
		expect(ask.error).toBe('出發和到達要在前一張和這一張站位之間，已還原');
		expect(walkBar(0).style.left).toBe('16px');
		expect(parseFloat(walkBar(1).style.width)).toBeCloseTo(32, 6);
	});

	it('前一張在流程開頭時，出發拖到流程開頭之前也還原，說原因', async () => {
		const { session, ask } = setupWalks();
		// 往左 20 px = 2 秒：出發 -0.4 秒，在流程開頭之前
		await dragBy(end(0, 'depart'), -20);
		expect(ask.error).toBe('出發和到達要在前一張和這一張站位之間，已還原');
		ask.clear();
		await dragBy(walkBar(0), -20);
		expect(session.canUndo).toBe(false);
		expect(ask.error).toBe('出發和到達要在前一張和這一張站位之間，已還原');
		expect(walkBar(0).style.left).toBe('16px');
	});

	it('這一張在流程最後一格時，拖中間拖過流程結尾也還原，不偷偷縮短', async () => {
		// f2 在最後一個半拍（第 127 個，25.4 秒），預設走位 22.4 → 25.4 秒
		let flow = flowOf(insertFormation(sample(), 25.4));
		const f2 = flow.formations[1];
		flow = flowOf(setPositions(flow, f2.id, { m1: f2.pos.m2, m2: f2.pos.m1 }));
		const { session, ask } = renderLanes(flow);
		await dragBy(walkBar(0), 10);
		expect(session.canUndo).toBe(false);
		expect(ask.error).toBe('出發和到達要在前一張和這一張站位之間，已還原');
	});

	it('出發拖到到達之後就還原，說原因', async () => {
		const { session, ask } = setupWalks();
		await dragBy(end(0, 'depart'), 40);
		expect(session.canUndo).toBe(false);
		expect(ask.error).toBe('出發要早於到達，已還原');
		expect(walkBar(0).style.left).toBe('16px');
	});

	it('只是點一下，不改流程', async () => {
		const { session, ask } = setupWalks();
		await dragBy(walkBar(0), 1);
		expect(session.canUndo).toBe(false);
		expect(ask.error).toBe('');
	});
});

describe('色條上的拍點', () => {
	/** Lib（0–3.2 秒 = 0–32 px，一個半拍 2 px）：down 1-1 到 1-2、步驟下手 1-3 到 1-4 給全部，手位 high V 1-5 只給上層。 */
	function cued(): Flow {
		let flow = sample();
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 4, len: 4, word: '下手' }));
		return flowOf(
			placeCue(flow, 'x1', { kind: 'motion', at: 8, len: 2, word: 'high V', who: { role: '上層' } })
		);
	}

	function setupCues() {
		return renderLanes(cued());
	}

	/** 色條上的拍點：種類、字、位置（px，從色條左邊算）、長度。 */
	const cuesOn = (bar: HTMLElement) =>
		[...bar.querySelectorAll<HTMLElement>('[data-cue]')].map((c) => ({
			kind: c.dataset.cue,
			word: c.textContent?.trim(),
			left: c.style.left,
			width: c.style.width || `≥${c.style.minWidth}`
		}));

	it('每個人的色條只畫給他的拍點：步驟和拍子佔幾拍畫多長，手位寫小字（至少一拍寬，字長就撐開）', () => {
		setupCues();
		const down = { kind: 'count', word: 'down', left: '0px', width: '8px' };
		const step = { kind: 'step', word: '下手', left: '8px', width: '8px' };
		expect(cuesOn(bars(lanes()[0])[0])).toEqual([
			down,
			step,
			{ kind: 'motion', word: 'high V', left: '16px', width: '≥4px' }
		]);
		// 小B 沒任務：沒有給上層的 high V
		expect(cuesOn(bars(lanes()[1])[0])).toEqual([down, step]);
		// 小C 的動作沒有拍點
		expect(bars(lanes()[2]).map(cuesOn)).toEqual([[], []]);
	});

	it('最後一拍的手位靠色條右邊往左撐開，字不會被色條右邊切掉', () => {
		const flow = flowOf(
			placeCue(cued(), 'x1', { kind: 'motion', at: 14, len: 2, word: 'T', who: null })
		);
		renderLanes(flow);
		const [highV, last] = [...bars(lanes()[0])[0].querySelectorAll<HTMLElement>('[data-cue="motion"]')];
		expect(highV.style.left).toBe('16px');
		expect(highV.style.transform).toBe('');
		expect(last.textContent?.trim()).toBe('T');
		// 右邊對齊第 32 px（最後一拍的結尾），往左撐開
		expect(last.style.left).toBe('32px');
		expect(last.style.transform).toBe('translateX(-100%)');
		expect(last.style.minWidth).toBe('4px');
	});

	it('拉色條右邊時，最後一拍的手位留在它那一拍，不跟著把手跑', async () => {
		const flow = flowOf(
			placeCue(cued(), 'x1', { kind: 'motion', at: 14, len: 2, word: 'T', who: null })
		);
		renderLanes(flow);
		const bar = bars(lanes()[0])[0];
		const last = () => [...bars(lanes()[0])[0].querySelectorAll<HTMLElement>('[data-cue="motion"]')][1];
		await fireEvent.pointerDown(bar.querySelector('[data-resize]')!, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 106 });
		// 色條拉長 6 px，T 的右邊還是在原本的第 32 px
		expect(bars(lanes()[0])[0].style.width).toBe('38px');
		expect(last().style.left).toBe('32px');
		await fireEvent.pointerMove(window, { clientX: 96 });
		expect(last().style.left).toBe('32px');
	});

	it('有拍點的色條：名稱和任務角色在上半，拍點在下半，一種一條；提示照舊', () => {
		setupCues();
		const [a] = bars(lanes()[0]);
		const top = (kind: string) => a.querySelector<HTMLElement>(`[data-cue="${kind}"]`)!.style.top;
		expect(new Set(['count', 'step', 'motion'].map(top)).size).toBe(3);
		expect(a.classList.contains('has-cues')).toBe(true);
		expect(a.querySelector('b')?.textContent).toBe('Lib');
		expect(a.querySelector('.role')?.textContent).toBe('上層');
		expect(a.title).toBe('技巧·Lib（上層）');
		expect(bars(lanes()[2])[0].classList.contains('has-cues')).toBe(false);
		// 有拍點的人泳道變高，放得下每一種；小B 只有兩種，比小A 矮；沒拍點的小C 不變
		const h = lanes().map((l) => parseFloat(l.style.height) || 0);
		expect(h[0]).toBeGreaterThan(h[1]);
		expect(h[1]).toBeGreaterThan(26);
		expect(h[2]).toBe(0);
	});

	it('拍點讓開泳道下緣 5 px 的走位條', () => {
		setupCues();
		for (const lane of lanes().slice(0, 2)) {
			const bar = bars(lane)[0];
			const bottoms = [...bar.querySelectorAll<HTMLElement>('[data-cue]')].map(
				// 色條離泳道上緣 3 px
				(c) => 3 + parseFloat(c.style.top) + parseFloat(c.style.height)
			);
			expect(Math.max(...bottoms)).toBeLessThanOrEqual(parseFloat(lane.style.height) - 5);
		}
	});

	it('拉短會切到拍點：先問，流程還沒變；按確定才改短，算一步', async () => {
		const { session, ask } = setupCues();
		const before = session.flow;
		// 往左 20 px = 2 秒：Lib 剩 1.2 秒（6 個半拍），切到 1-3 開始的步驟和 1-5 的手位
		await fireEvent.pointerDown(bars(lanes()[0])[0].querySelector('[data-resize]')!, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 80 });
		await fireEvent.pointerUp(window, { clientX: 80 });
		expect(ask.question).not.toBeNull();
		expect(session.flow).toBe(before);
		expect(bars(lanes()[0])[0].style.width).toBe('32px');

		ask.answer('confirm');
		await tick();
		expect(ask.question).toBeNull();
		expect(session.flow!.actions[0]).toMatchObject({ id: 'x1', length: 6 });
		expect(session.canUndo).toBe(true);
		expect(parseFloat(bars(lanes()[0])[0].style.width)).toBeCloseTo(12, 6);
	});

	it('拉短要問時按取消：流程不變，色條留在原來的長度', async () => {
		const { session, ask } = setupCues();
		const before = session.flow;
		await fireEvent.pointerDown(bars(lanes()[0])[0].querySelector('[data-resize]')!, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 80 });
		await fireEvent.pointerUp(window, { clientX: 80 });
		ask.answer('cancel');
		await tick();
		expect(ask.question).toBeNull();
		expect(session.flow).toBe(before);
		expect(session.canUndo).toBe(false);
		expect(bars(lanes()[0])[0].style.width).toBe('32px');
	});

	it('按在拍點上照樣能拖色條、點色條', async () => {
		const { session } = setupCues();
		const cue = bars(lanes()[0])[0].querySelector('[data-cue="step"]')!;
		await fireEvent.click(cue);
		expect(session.selectedActionId).toBe('x1');
		await fireEvent.pointerDown(cue, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 104 });
		expect(bars(lanes()[0])[0].style.left).toBe('4px');
		await fireEvent.pointerUp(window, { clientX: 104 });
		// 往右 4 px = 0.4 秒 = 2 個半拍；拍點跟著動作走
		expect(session.flow!.actions[0]).toMatchObject({ id: 'x1', start: 2, length: 16 });
		expect(session.flow!.actions[0].cues).toHaveLength(3);
	});
});

describe('色條上的環節', () => {
	/**
	 * Lib（0–3.2 秒 = 0–32 px，一個半拍 2 px）的環節：上法「延伸」1-1 到 1-3、中段 1-4 到 1-6、
	 * 下法（標了 1-7 到 1-8 再清掉，沒標拍）。withCues 時再放 1-1 到 1-2 的 down。
	 */
	function phased(withCues = false): Flow {
		let flow = flowOf(addPhase(sample(), 'x1', { kind: 'load', name: '延伸', beats: { at: 0, len: 6 } }));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'hold', name: '', beats: { at: 6, len: 6 } }));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'dismount', name: '', beats: { at: 12, len: 4 } }));
		flow = flowOf(clearPhaseBeats(flow, 'x1', 12, 16));
		return withCues ? flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 4, word: 'down' })) : flow;
	}

	function setupPhases(flow: Flow) {
		return renderLanes(flow);
	}

	/** 色條上的環節細條：名字、位置、寬度、顏色。 */
	const strips = (bar: HTMLElement) =>
		[...bar.querySelectorAll<HTMLElement>('[data-phase]')].map((p) => ({
			phase: p.dataset.phase,
			left: p.style.left,
			width: p.style.width,
			color: p.style.background
		}));

	it('動作裡每個人的色條上都有一條細細的環節（環節的顏色），底下鋪同色淡底；沒標拍的不畫', () => {
		setupPhases(phased());
		const want = [
			{ phase: '上法 延伸', left: '0px', width: '12px', color: 'rgb(0, 121, 107)' },
			{ phase: '中段', left: '12px', width: '12px', color: 'rgb(71, 85, 105)' }
		];
		expect(strips(bars(lanes()[0])[0])).toEqual(want);
		expect(strips(bars(lanes()[1])[0])).toEqual(want);
		const tints = [...bars(lanes()[0])[0].querySelectorAll<HTMLElement>('[data-phase-tint]')];
		expect(tints.map((t) => [t.style.left, t.style.width, t.style.background])).toEqual([
			['0px', '12px', 'rgb(0, 121, 107)'],
			['12px', '12px', 'rgb(71, 85, 105)']
		]);
		// 小C 的動作沒記成功率
		expect(bars(lanes()[2]).map(strips)).toEqual([[], []]);
		// 名稱和提示照舊
		expect(bars(lanes()[0])[0].querySelector('b')?.textContent).toBe('Lib');
		expect(bars(lanes()[0])[0].title).toBe('技巧·Lib（上層）');
	});

	it('有拍點時環節細條在名稱上面，拍點往下讓開，泳道變高放得下，最下面還是留給走位條', () => {
		setupPhases(phased(true));
		const lane = lanes()[0];
		const bar = bars(lane)[0];
		const strip = bar.querySelector<HTMLElement>('[data-phase]')!;
		const cue = bar.querySelector<HTMLElement>('[data-cue]')!;
		expect(parseFloat(strip.style.top) + parseFloat(strip.style.height)).toBeLessThanOrEqual(3);
		// 名稱那一行（12 px）從細條底下開始，拍點在名稱下面
		expect(parseFloat(cue.style.top)).toBeGreaterThanOrEqual(3 + 12);
		expect(3 + parseFloat(cue.style.top) + parseFloat(cue.style.height)).toBeLessThanOrEqual(
			parseFloat(lane.style.height) - 5
		);
		expect(bar.classList.contains('has-phases')).toBe(true);
	});

	it('按在環節上照樣能拖色條、拉長度、點色條', async () => {
		const { session } = setupPhases(phased());
		const strip = () => bars(lanes()[0])[0].querySelector('[data-phase]')!;
		await fireEvent.click(strip());
		expect(session.selectedActionId).toBe('x1');
		await fireEvent.pointerDown(strip(), { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 104 });
		expect(bars(lanes()[0])[0].style.left).toBe('4px');
		await fireEvent.pointerUp(window, { clientX: 104 });
		// 往右 4 px = 2 個半拍；環節標的拍跟著動作走
		expect(session.flow!.actions[0]).toMatchObject({ id: 'x1', start: 2, length: 16 });
		expect(session.flow!.actions[0].successRate?.phases[0].beats).toEqual({ at: 0, len: 6 });
		// 拉長度的把手還在
		await fireEvent.pointerDown(bars(lanes()[0])[0].querySelector('[data-resize]')!, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 104 });
		expect(bars(lanes()[0])[0].style.width).toBe('36px');
	});
});

it('沒有人時沒有泳道', () => {
	const flow = flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } }));
	renderLanes(flow);
	expect(screen.queryAllByRole('button')).toHaveLength(0);
	expect(lanes()).toHaveLength(0);
});
