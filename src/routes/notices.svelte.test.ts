// 「已做了・復原」提示和確認框（#211）：能復原的事不問，跳一則提示帶一個按鈕（「復原」「救回」）；
// 會清掉練習紀錄的事跳確認框，寫明按「復原」紀錄會一起回來（ADR 0007）。
// 編輯器只有一個提示位置：同時只有一則，新的取代舊的；練習畫面的提示也浮在上面，不擠在卡片裡推動版面。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { addAction } from '#lib/core';
import { editorPage, practiceFlow, recordedFlow, teamFlow } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const bar = (id: string) => document.querySelector<HTMLElement>(`[data-action-id="${id}"]`);
const dialog = () => screen.getByRole('alertdialog');
const card = (who: string) => within(screen.getByRole('region', { name: who }));

describe('能復原的事不問，跳「已做了・復原」', () => {
	it('刪動作：不跳確認框，提示「已刪動作…」；按「復原」動作回來', async () => {
		const { session, props } = editorPage(teamFlow());
		render(Page, props);
		await fireEvent.click(bar('x1')!);
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(session.flow!.actions).toHaveLength(0);
		expect(screen.getByRole('status').textContent).toBe('已刪動作 技巧·Lib');
		await fireEvent.click(screen.getByRole('button', { name: '復原：刪動作 技巧·Lib' }));
		expect(session.flow!.actions.map((a) => a.id)).toEqual(['x1']);
	});

	it('「從別的動作複製人」整批取代：不問，提示「已取代…」；按「復原」人回來', async () => {
		const flow = flowOf(
			addAction(teamFlow(), {
				segmentId: 's1',
				category: 'toss',
				name: '',
				start: 16,
				length: 8,
				note: '',
				members: [{ memberId: 'm3', role: '上層' }]
			})
		);
		const { session, props } = editorPage(flow);
		render(Page, props);
		await fireEvent.click(bar('x2')!);
		await fireEvent.change(screen.getByRole('combobox', { name: '從別的動作複製人' }), { target: { value: 'x1' } });
		expect(screen.queryByRole('alertdialog')).toBeNull();
		const people = () => session.flow!.actions.find((a) => a.id === 'x2')!.members.map((m) => m.memberId);
		expect(people()).toEqual(['m1', 'm2', 'm3', 'm4']);
		expect(screen.getByRole('status').textContent).toBe('已取代：人換成「技巧·Lib」的 4 人');
		await fireEvent.click(screen.getByRole('button', { name: '復原取代的人' }));
		expect(people()).toEqual(['m3']);
	});
});

describe('會丟紀錄的事才跳確認框', () => {
	it('刪有紀錄的動作：確認框寫按「復原」紀錄會回來；確定才刪；按「復原」動作和紀錄都回來（N25）', async () => {
		const { session, props } = editorPage(recordedFlow());
		render(Page, props);
		await fireEvent.click(bar('x1')!);
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(dialog().textContent).toContain('清掉的紀錄按「復原」會回來');
		expect(session.flow!.actions).toHaveLength(1);
		const records = session.flow!.actions[0].successRate!.records;
		await fireEvent.click(within(dialog()).getByRole('button', { name: '確定' }));
		expect(session.flow!.actions).toHaveLength(0);
		await fireEvent.click(screen.getByRole('button', { name: /^復原：刪動作/ }));
		expect(session.flow!.actions[0].successRate!.records).toEqual(records);
	});
});

describe('同時只有一則提示', () => {
	it('練習：一張卡存好的「已記下」，被另一張卡「刪掉上一次」的提示換掉；提示不擠在卡片裡', async () => {
		render(Page, editorPage(practiceFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		// 騰翻只有一個環節：點了就存
		await fireEvent.click(screen.getByRole('button', { name: /^騰翻/ }));
		await fireEvent.click(screen.getByRole('button', { name: /^小美 .* 成功$/ }));
		expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual(['已記下']);
		await fireEvent.click(screen.getByRole('button', { name: /^小A .* 失敗$/ }));
		await fireEvent.click(card('小美').getByRole('button', { name: '刪掉上一次' }));
		expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual(['已刪掉 ✓（第 1 次）']);
		expect(card('小美').queryByRole('status')).toBeNull();
		expect(card('小A').queryByRole('status')).toBeNull();
		// 按「救回」放回去，提示換成「已救回」
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual(['已救回']);
	});

	it('編排刪了動作的提示，到練習存一次就換成「已記下」，不會兩則一起出現', async () => {
		const flow = flowOf(
			addAction(practiceFlow(), {
				segmentId: 's1',
				category: 'stunt',
				name: '多的',
				start: 56,
				length: 4,
				note: '',
				members: [{ memberId: 'm4', role: '主底' }]
			})
		);
		render(Page, editorPage(flow).props);
		await fireEvent.click(bar('x4')!);
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(screen.getByRole('status').textContent).toBe('已刪動作 技巧·多的');
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await fireEvent.click(screen.getByRole('button', { name: /^騰翻/ }));
		await fireEvent.click(screen.getByRole('button', { name: /^小美 .* 成功$/ }));
		expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual(['已記下']);
	});

	it('練習存好一次寫「已記下」，不寫「已存」：上方列這時寫「未存」（流程檔還沒存），兩句不打架（T07）', async () => {
		render(Page, editorPage(practiceFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await fireEvent.click(screen.getByRole('button', { name: /^騰翻/ }));
		await fireEvent.click(screen.getByRole('button', { name: /^小美 .* 成功$/ }));
		expect(screen.getByRole('status').textContent).toBe('已記下');
		expect(document.querySelector('.unsaved')?.textContent).toBe('未存');
	});
});
