import {
	addAction,
	addMembers,
	addSegment,
	clearPhaseBeats,
	createFlow,
	insertFormation,
	markPhaseBeats,
	resizeAction,
	placeCue,
	setMarkers,
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

	it('小站位圖和標題寫的標記跟編輯畫面一樣', async () => {
		render(PrintSheet, { flow: flowOf(setMarkers(sample(), 'initial')), onclose: vi.fn(), print: vi.fn() });
		const dots = [...bodyRows()[0].querySelectorAll('[data-member-id] text')].map((t) => t.textContent);
		expect(dots).toEqual(['小A', '小B', '小C']);
		await fireEvent.change(screen.getByLabelText('印誰'), { target: { value: 'm2' } });
		expect(screen.getByRole('heading').textContent).toContain('小B（場上寫「小B」）');
	});

	it('號碼標記的標題寫「場上 2 號」', async () => {
		render(PrintSheet, { flow: sample(), onclose: vi.fn(), print: vi.fn() });
		await fireEvent.change(screen.getByLabelText('印誰'), { target: { value: 'm2' } });
		expect(screen.getByRole('heading').textContent).toContain('小B（場上 2 號）');
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
		expect(first).toContain('1-1 出發 → 站位 2（2-1 到達）');
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

	describe('拍點', () => {
		/** Lib（小A 上層、小B 主底）：1-5 下手、1-6 到 1-7 down、1-8 上層 high V。 */
		function cued(): Flow {
			let flow = sample();
			flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 8, len: 2, word: '下手' }));
			flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 10, len: 4, word: 'down' }));
			return flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 14, len: 2, word: 'high V', who: { role: '上層' } }));
		}

		it('有拍點的列下面多一排：動作名字和 8 格，拍點的字寫在它佔的格子裡', () => {
			render(PrintSheet, { flow: cued(), onclose: vi.fn(), print: vi.fn() });
			const line = screen.getByRole('group', { name: '技巧·Lib 的拍點' });
			expect(line.textContent).toContain('技巧·Lib');
			expect(within(line).getAllByText(/^[1-8]$/).map((c) => c.textContent)).toEqual([
				'1', '2', '3', '4', '5', '6', '7', '8'
			]);
			const step = within(line).getByLabelText('步驟 下手 1-5');
			expect(step.textContent).toBe('下手');
			expect(step.style.gridColumn).toBe('5 / 6');
			const down = within(line).getByLabelText('拍子 down 1-6 到 1-7');
			expect(down.textContent).toBe('down');
			expect(down.style.gridColumn).toBe('6 / 8');
			const motion = within(line).getByLabelText('手位 high V 1-8・給上層');
			expect(motion.textContent).toContain('high V');
			expect(motion.textContent).toContain('上層');
			expect(motion.style.gridColumn).toBe('8 / 9');
		});

		it('沒有拍點的八拍表跟原本一樣，不多印格子', () => {
			render(PrintSheet, { flow: sample(), onclose: vi.fn(), print: vi.fn() });
			expect(bodyRows()).toHaveLength(8);
			expect(screen.queryByRole('group', { name: /的拍點$/ })).toBeNull();
		});

		it('印一個隊員時只印給他的拍點，不寫給誰', async () => {
			render(PrintSheet, { flow: cued(), onclose: vi.fn(), print: vi.fn() });
			await fireEvent.change(screen.getByLabelText('印誰'), { target: { value: 'm2' } });
			const line = screen.getByRole('group', { name: '技巧·Lib 的拍點' });
			expect(within(line).getByLabelText('拍子 down 1-6 到 1-7')).toBeTruthy();
			expect(line.textContent).not.toContain('high V');
			await fireEvent.change(screen.getByLabelText('印誰'), { target: { value: 'm1' } });
			const mine = screen.getByRole('group', { name: '技巧·Lib 的拍點' });
			const motion = within(mine).getByLabelText('手位 high V 1-8');
			expect(motion.textContent).toBe('high V');
		});
	});

	describe('環節', () => {
		/** Lib 拉長到 2-2，環節：下法（標了 1-1 再清掉，沒標拍）、上法「延伸」1-1 到 1-3、中段 1-4 到 2-2（跨列）；1-6 到 1-7 down。 */
		function phased(): Flow {
			let flow = flowOf(resizeAction(sample(), 'x1', 4));
			flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'dismount', name: '' }, 0, 2));
			flow = flowOf(clearPhaseBeats(flow, 'x1', 0, 2));
			flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'load', name: '延伸' }, 0, 6));
			flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'hold', name: '' }, 6, 14));
			return flowOf(placeCue(flow, 'x1', { kind: 'count', at: 10, len: 4, word: 'down' }));
		}
		const lines = () => screen.getAllByRole('group', { name: '技巧·Lib 的拍點' });
		const phasesIn = (line: HTMLElement) =>
			[...line.querySelectorAll<HTMLElement>('[data-phase]')].map((p) => [
				p.getAttribute('aria-label'),
				p.textContent?.trim(),
				p.style.gridColumn
			]);

		it('拍點上面多一行環節：寫種類和名字，框出它佔的格子；沒標拍的不印', () => {
			render(PrintSheet, { flow: phased(), onclose: vi.fn(), print: vi.fn() });
			const [first] = lines();
			expect(phasesIn(first)).toEqual([
				['環節 上法 延伸 1-1 到 1-3', '上法 延伸', '1 / 4'],
				['環節 中段 1-4 到 1-8', '中段', '4 / 9']
			]);
			// 環節那一行在拍點那一排上面
			const phaseRow = first.querySelector('[data-phase]')!.parentElement!;
			const down = within(first).getByLabelText('拍子 down 1-6 到 1-7');
			expect(phaseRow.compareDocumentPosition(down) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
			expect(document.body.textContent).not.toContain('下法');
		});

		it('跨到下一列的環節兩列各畫自己那一段，名字兩列都寫', () => {
			render(PrintSheet, { flow: phased(), onclose: vi.fn(), print: vi.fn() });
			expect(lines().map(phasesIn)[1]).toEqual([['環節 中段 2-1 到 2-2', '中段', '1 / 3']]);
		});

		it('個人表也印環節', async () => {
			render(PrintSheet, { flow: phased(), onclose: vi.fn(), print: vi.fn() });
			await fireEvent.change(screen.getByLabelText('印誰'), { target: { value: 'm2' } });
			expect(lines().map((l) => phasesIn(l).map(([, text]) => text))).toEqual([['上法 延伸', '中段'], ['中段']]);
			await fireEvent.change(screen.getByLabelText('印誰'), { target: { value: 'm3' } });
			expect(screen.queryAllByRole('group', { name: '技巧·Lib 的拍點' })).toHaveLength(0);
		});
	});
});
