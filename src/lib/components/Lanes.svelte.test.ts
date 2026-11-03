import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	insertFormation,
	placeCue,
	setMarkers,
	setPositions,
	setWalks,
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

function setup(
	playheadSec: number,
	selectedActionId: string | null = null,
	selectedMemberIds: string[] = [],
	multi = false
) {
	const onselectaction = vi.fn();
	const onchange = vi.fn<(flow: Flow) => void>();
	const onblocked = vi.fn<(message: string) => void>();
	const onselectmembers = vi.fn<(ids: string[]) => void>();
	render(Lanes, {
		flow: sample(),
		playheadSec,
		pxPerSec: 10,
		selectedActionId,
		onselectaction,
		onchange,
		onblocked,
		selectedMemberIds,
		onselectmembers,
		multi
	});
	return { onselectaction, onchange, onblocked, onselectmembers };
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
		render(Lanes, {
			flow,
			playheadSec: 0,
			pxPerSec: 10,
			selectedActionId: null,
			onselectaction: vi.fn(),
			onchange: vi.fn(),
			onblocked: vi.fn()
		});
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
		const { onselectaction } = setup(0, 'x1');
		await fireEvent.click(bars(lanes()[2])[0]);
		expect(onselectaction).toHaveBeenCalledWith('x2');
		expect(bars(lanes()[0])[0].classList.contains('selected')).toBe(true);
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
		const { onchange, onblocked } = setup(0);
		await fireEvent.pointerDown(tumble(), { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 95 });
		expect(tumble().style.left).toBe('11px');
		await fireEvent.pointerUp(window, { clientX: 95 });
		// 往左 5 px = 0.5 秒：1.1 秒最近的是第 6 個半拍
		expect(onchange).toHaveBeenCalledOnce();
		expect(onchange.mock.calls[0][0].actions[1]).toMatchObject({ id: 'x2', start: 6, length: 4 });
		expect(onblocked).not.toHaveBeenCalled();
	});

	it('撞到同一人就還原，說原因', async () => {
		const { onchange, onblocked } = setup(0);
		await dragBy(tumble(), 10);
		expect(onchange).not.toHaveBeenCalled();
		expect(onblocked).toHaveBeenCalledWith('小C 同一時間已經在「跳躍」裡');
		expect(tumble().style.left).toBe('16px');
	});

	it('拉右邊改長度；撞到同一人就還原', async () => {
		const { onchange, onblocked } = setup(0);
		const handle = tumble().querySelector('[data-resize]')!;
		// 往右 6 px = 0.6 秒：結束 3.0 秒 = 第 15 個半拍
		await dragBy(handle, 6);
		expect(onchange.mock.calls[0][0].actions[1]).toMatchObject({ id: 'x2', start: 8, length: 7 });
		await dragBy(handle, 10);
		expect(onblocked).toHaveBeenCalledWith('小C 同一時間已經在「跳躍」裡');
		expect(parseFloat(tumble().style.width)).toBeCloseTo(8, 6);
	});

	it('只是點一下，不改動作', async () => {
		const { onchange, onblocked } = setup(0);
		await dragBy(tumble(), 1);
		expect(onchange).not.toHaveBeenCalled();
		expect(onblocked).not.toHaveBeenCalled();
	});
});

describe('點泳道上的名字選人', () => {
	const name = (i: number) => lanes()[i].querySelector<HTMLElement>('.lab')!;

	it('名字前面的圓圈寫標記：號碼或開頭字', () => {
		render(Lanes, {
			flow: flowOf(setMarkers(sample(), 'initial')),
			playheadSec: 0,
			pxPerSec: 10,
			selectedActionId: null,
			onselectaction: vi.fn()
		});
		const marks = [...document.querySelectorAll('[data-lane] .no')].map((el) => el.textContent);
		expect(marks).toEqual(['小A', '小B', '小C']);
	});

	it('點名字只選這個人；Shift＋點加進來或拿掉', async () => {
		const { onselectmembers } = setup(0, null, ['m1']);
		expect(name(0).classList.contains('selected')).toBe(true);
		await fireEvent.click(name(1));
		expect(onselectmembers).toHaveBeenLastCalledWith(['m2']);
		await fireEvent.click(name(2), { shiftKey: true });
		expect(onselectmembers).toHaveBeenLastCalledWith(['m1', 'm3']);
		await fireEvent.click(name(0), { shiftKey: true });
		expect(onselectmembers).toHaveBeenLastCalledWith([]);
	});

	it('多選開著：不按 Shift 點名字也是加進來或拿掉', async () => {
		const { onselectmembers } = setup(0, null, ['m1'], true);
		await fireEvent.click(name(2));
		expect(onselectmembers).toHaveBeenLastCalledWith(['m1', 'm3']);
		await fireEvent.click(name(0));
		expect(onselectmembers).toHaveBeenLastCalledWith([]);
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
		const onchange = vi.fn<(flow: Flow) => void>();
		const onblocked = vi.fn<(message: string) => void>();
		render(Lanes, {
			flow,
			playheadSec: 0,
			pxPerSec: 10,
			selectedActionId: null,
			onselectaction: vi.fn(),
			onchange,
			onblocked,
			selectedMemberIds
		});
		return { onchange, onblocked, f2: flow.formations[1].id };
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
		render(Lanes, { flow, playheadSec: 0, pxPerSec: 10, selectedActionId: null, onselectaction: vi.fn() });
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
		render(Lanes, { flow, playheadSec: 0, pxPerSec: 10, selectedActionId: null, onselectaction: vi.fn() });
		expect(walkBar(0).classList.contains('tiring')).toBe(true);
		expect(walkBar(0).classList.contains('fast')).toBe(false);
	});

	it('拖左端改出發，吸到最近的半拍；只改這個人', async () => {
		const { onchange, onblocked, f2 } = setupWalks();
		// 往右 4 px = 0.4 秒：出發 2.0 秒 = 第 10 個半拍
		await dragBy(end(0, 'depart'), 4);
		expect(onblocked).not.toHaveBeenCalled();
		const walks = onchange.mock.calls[0][0].formations[1].walks;
		expect(walks).toEqual({
			m1: { depart: { segmentId: 's1', at: 10 }, arrive: { segmentId: 's1', at: 24 } }
		});
		expect(onchange.mock.calls[0][0].formations[1].id).toBe(f2);
	});

	it('拖中間兩端一起挪；拖的時候走位條跟著走', async () => {
		const { onchange } = setupWalks();
		await fireEvent.pointerDown(walkBar(0), { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 96 });
		expect(walkBar(0).style.left).toBe('12px');
		await fireEvent.pointerUp(window, { clientX: 96 });
		expect(onchange.mock.calls[0][0].formations[1].walks).toEqual({
			m1: { depart: { segmentId: 's1', at: 6 }, arrive: { segmentId: 's1', at: 22 } }
		});
	});

	it('被拖的人在選取裡：選到、同一個間隔有走位的人一起挪一樣多', async () => {
		const { onchange } = setupWalks(['m1', 'm2', 'm3']);
		await dragBy(walkBar(1), -4);
		expect(onchange).toHaveBeenCalledOnce();
		expect(onchange.mock.calls[0][0].formations[1].walks).toEqual({
			m1: { depart: { segmentId: 's1', at: 6 }, arrive: { segmentId: 's1', at: 22 } },
			m2: { depart: { segmentId: 's1', at: 6 }, arrive: { segmentId: 's1', at: 22 } }
		});
	});

	it('被拖的人不在選取裡：只挪他自己', async () => {
		const { onchange } = setupWalks(['m2']);
		await dragBy(walkBar(0), -4);
		expect(Object.keys(onchange.mock.calls[0][0].formations[1].walks!)).toEqual(['m1']);
	});

	it('拖出前後兩張站位之間就還原，說原因；整組也一樣', async () => {
		const { onchange, onblocked } = setupWalks(['m1', 'm2']);
		await dragBy(end(1, 'arrive'), 4);
		expect(onchange).not.toHaveBeenCalled();
		expect(onblocked).toHaveBeenCalledWith('出發和到達要在前一張和這一張站位之間');
		expect(walkBar(0).style.left).toBe('16px');
		expect(parseFloat(walkBar(1).style.width)).toBeCloseTo(32, 6);
	});

	it('前一張在流程開頭時，出發拖到流程開頭之前也還原，說原因', async () => {
		const { onchange, onblocked } = setupWalks();
		// 往左 20 px = 2 秒：出發 -0.4 秒，在流程開頭之前
		await dragBy(end(0, 'depart'), -20);
		await dragBy(walkBar(0), -20);
		expect(onchange).not.toHaveBeenCalled();
		expect(onblocked.mock.calls).toEqual([
			['出發和到達要在前一張和這一張站位之間'],
			['出發和到達要在前一張和這一張站位之間']
		]);
		expect(walkBar(0).style.left).toBe('16px');
	});

	it('這一張在流程最後一格時，拖中間拖過流程結尾也還原，不偷偷縮短', async () => {
		// f2 在最後一個半拍（第 127 個，25.4 秒），預設走位 22.4 → 25.4 秒
		let flow = flowOf(insertFormation(sample(), 25.4));
		const f2 = flow.formations[1];
		flow = flowOf(setPositions(flow, f2.id, { m1: f2.pos.m2, m2: f2.pos.m1 }));
		const onchange = vi.fn<(flow: Flow) => void>();
		const onblocked = vi.fn<(message: string) => void>();
		render(Lanes, {
			flow,
			playheadSec: 0,
			pxPerSec: 10,
			selectedActionId: null,
			onselectaction: vi.fn(),
			onchange,
			onblocked
		});
		await dragBy(walkBar(0), 10);
		expect(onchange).not.toHaveBeenCalled();
		expect(onblocked).toHaveBeenCalledWith('出發和到達要在前一張和這一張站位之間');
	});

	it('出發拖到到達之後就還原，說原因', async () => {
		const { onchange, onblocked } = setupWalks();
		await dragBy(end(0, 'depart'), 40);
		expect(onchange).not.toHaveBeenCalled();
		expect(onblocked).toHaveBeenCalledWith('出發要早於到達');
		expect(walkBar(0).style.left).toBe('16px');
	});

	it('只是點一下，不改流程', async () => {
		const { onchange, onblocked } = setupWalks();
		await dragBy(walkBar(0), 1);
		expect(onchange).not.toHaveBeenCalled();
		expect(onblocked).not.toHaveBeenCalled();
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
		const onchange = vi.fn<(flow: Flow) => void>();
		const onselectaction = vi.fn();
		render(Lanes, { flow: cued(), playheadSec: 0, pxPerSec: 10, selectedActionId: null, onselectaction, onchange });
		return { onchange, onselectaction };
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
		render(Lanes, { flow, playheadSec: 0, pxPerSec: 10, selectedActionId: null, onselectaction: vi.fn(), onchange: vi.fn() });
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
		render(Lanes, { flow, playheadSec: 0, pxPerSec: 10, selectedActionId: null, onselectaction: vi.fn(), onchange: vi.fn() });
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

	it('按在拍點上照樣能拖色條、點色條', async () => {
		const { onchange, onselectaction } = setupCues();
		const cue = bars(lanes()[0])[0].querySelector('[data-cue="step"]')!;
		await fireEvent.click(cue);
		expect(onselectaction).toHaveBeenCalledWith('x1');
		await fireEvent.pointerDown(cue, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 104 });
		expect(bars(lanes()[0])[0].style.left).toBe('4px');
		await fireEvent.pointerUp(window, { clientX: 104 });
		// 往右 4 px = 0.4 秒 = 2 個半拍；拍點跟著動作走
		expect(onchange.mock.calls[0][0].actions[0]).toMatchObject({ id: 'x1', start: 2, length: 16 });
		expect(onchange.mock.calls[0][0].actions[0].cues).toHaveLength(3);
	});
});

it('沒有人時沒有泳道', () => {
	const flow = flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } }));
	render(Lanes, { flow, playheadSec: 0, pxPerSec: 10, selectedActionId: null, onselectaction: vi.fn() });
	expect(screen.queryAllByRole('button')).toHaveLength(0);
	expect(lanes()).toHaveLength(0);
});
