// 問教練 module：送一個指令，照結果交出新流程、留下原因或留下問題；回答後帶著選項再送一次。

import { describe, expect, it, vi } from 'vitest';
import {
	addSegment,
	deleteAction,
	recordAttempt,
	renameFlow,
	updateMember,
	type Command,
	type Flow
} from '#lib/core';
import { Ask, type SentStep } from './ask.svelte';
import { flowOf, libSample, ratedSample } from './test-flows';

// 畫面送的每一步都帶亂數的步驟 id，新東西的 id 是亂數（ADR 0011）。這個檔的測試照舊用編號的 id（m1、x1…）找東西，
// 所以不算步驟 id：新東西照舊發下一個編號。亂數的 id 在核心測試（commands、flow-file）和 ask-ids.test.ts 測。
vi.mock('#lib/core/ids.js', async (load) => ({
	...(await load<typeof import('#lib/core/ids.js')>()),
	inStep: <R>(_stepId: string, run: () => R) => run()
}));

/** ratedSample 的 x1 第 1 組記一次：刪 x1 要確認、改小美的名字要選、刪 x9 被擋、改流程名字成功。 */
function recorded(): Flow {
	const marks = { p1: '✓', p2: '△', p3: '✗' } as const;
	return flowOf(
		recordAttempt(ratedSample(), 'x1', {
			date: '2026-11-04',
			who: 'g1',
			practice: 'drill',
			whole: true,
			marks
		})
	);
}

/** 跟著 onchange 換流程的問教練（跟編輯 session 一樣）。onchange 記新的流程；state.step 是最後成功的那一步送了什麼。 */
function asker(flow: Flow = recorded(), options: { locked?: () => string; onfail?: (error: string) => void } = {}) {
	const state: { flow: Flow; step?: SentStep } = { flow };
	const onchange = vi.fn((f: Flow) => (state.flow = f));
	const ask = new Ask(
		(f, step) => {
			state.step = step;
			onchange(f);
		},
		{ ...options, flow: () => state.flow }
	);
	return { ask, onchange, state };
}

const rename: Command<'renameFlow'> = { name: 'renameFlow', args: ['決賽'] };
/** 被擋：找不到這個動作。 */
const missing: Command<'deleteAction'> = { name: 'deleteAction', args: ['x9'] };
/** 要確認：刪掉動作會清掉紀錄。 */
const removeX1: Command<'deleteAction'> = { name: 'deleteAction', args: ['x1'] };
/** 要選：改名字會動到紀錄。 */
const renameM1: Command<'updateMember'> = { name: 'updateMember', args: ['m1', { name: '小美美' }] };

describe('送指令', () => {
	it('成功：把新流程交出去，沒有原因、沒有問題', () => {
		const flow = recorded();
		const { ask, onchange } = asker(flow);
		const done = vi.fn();
		ask.send(rename, { done });
		expect(onchange).toHaveBeenCalledWith(flowOf(renameFlow(flow, '決賽')));
		expect(done).toHaveBeenCalledOnce();
		expect(ask.error).toBe('');
		expect(ask.question).toBeNull();
	});

	it('被擋：留下原因，流程沒交出去', () => {
		const { ask, onchange } = asker();
		ask.send(missing);
		expect(ask.error).toBe('找不到這個動作');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('要確認：留下問題（訊息、清單、不用選）', () => {
		const { ask } = asker();
		ask.send(removeX1);
		expect(ask.question).toEqual({ message: '刪掉動作「技巧·Lib」會清掉 1 次紀錄（清掉的紀錄按「復原」會回來）', items: [], choose: false, confirmLabel: '確定' });
		expect(ask.error).toBe('');
	});

	it('要確認的結果自己帶了確定鈕的字：照它的，不照問的地方給的（N19）', () => {
		// libSample：Lib 1-1 到 1-8；音樂 1 只剩 6 拍只會裁短 Lib。
		const state = { flow: libSample() };
		const ask = new Ask((f) => (state.flow = f), { confirmLabel: '確定刪除', flow: () => state.flow });
		ask.send({ name: 'updateSegment', args: ['s1', { eights: 1, lastBeats: 6 }] });
		expect(ask.question?.confirmLabel).toBe('確定裁短');
		ask.send({ name: 'deleteSegment', args: ['s1'] });
		expect(ask.question?.confirmLabel).toBe('確定刪除');
	});

	it('要選：留下問題（要選）', () => {
		const { ask } = asker();
		ask.send(renameM1);
		expect(ask.question?.choose).toBe(true);
		expect(ask.question?.confirmLabel).toBe('確定');
	});

	it('再送一個指令：上一個的原因和問題收掉', () => {
		const { ask } = asker();
		ask.send(missing);
		ask.send(removeX1);
		expect(ask.error).toBe('');
		ask.send(rename);
		expect(ask.question).toBeNull();
	});

	it('給了 onfail：被擋、要問時呼叫（給原因，要問時是空的），成功不呼叫', () => {
		const onfail = vi.fn();
		const { ask } = asker(recorded(), { onfail });
		ask.send(missing, { revert: () => {} });
		expect(onfail).toHaveBeenLastCalledWith('找不到這個動作，已還原');
		ask.send(removeX1);
		expect(onfail).toHaveBeenLastCalledWith('');
		ask.send(rename);
		expect(onfail).toHaveBeenCalledTimes(2);
	});

	it('回傳第一次送出的結果', () => {
		const { ask } = asker();
		expect(ask.send(renameM1).kind).toBe('choose');
	});
});

describe('回答', () => {
	it('保留舊紀錄：帶著保留再送一次', () => {
		const flow = recorded();
		const { ask, onchange } = asker(flow);
		ask.send(renameM1);
		ask.answer('keep');
		expect(onchange).toHaveBeenCalledWith(flowOf(updateMember(flow, 'm1', { name: '小美美' }, { records: 'keep' })));
	});

	it('取消：問題收掉、不再送、流程沒交出去；給了還原就還原（沒有原因）', () => {
		const { ask, onchange } = asker();
		const revert = vi.fn();
		ask.send(removeX1, { revert });
		ask.answer('cancel');
		expect(onchange).not.toHaveBeenCalled();
		expect(ask.question).toBeNull();
		expect(revert).toHaveBeenCalledOnce();
		expect(ask.error).toBe('');
	});

	it('給了 cancel：按取消才呼叫，被擋不呼叫、原因不加「，已還原」', () => {
		const cancel = vi.fn();
		const { ask } = asker();
		ask.send(missing, { cancel });
		expect(ask.error).toBe('找不到這個動作');
		expect(cancel).not.toHaveBeenCalled();
		ask.send(removeX1, { cancel });
		ask.answer('cancel');
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('回答後被擋：留下原因，加「，已還原」並還原', () => {
		const { ask, state } = asker();
		const revert = vi.fn();
		ask.send(removeX1, { revert });
		// 問的時候動作被刪掉了
		state.flow = flowOf(deleteAction(state.flow, 'x1', { confirmed: true }));
		ask.answer('confirm');
		expect(ask.error).toBe('找不到這個動作，已還原');
		expect(revert).toHaveBeenCalledOnce();
		expect(ask.question).toBeNull();
	});

	it('沒有問題時回答不做事', () => {
		const { ask, onchange } = asker();
		ask.answer('confirm');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('收掉：原因和問題都清掉', () => {
		const { ask } = asker();
		ask.send(removeX1);
		ask.clear();
		expect(ask.question).toBeNull();
		ask.send(missing);
		ask.clear();
		expect(ask.error).toBe('');
	});
});

describe('改了一格', () => {
	it('一格被擋有紅字，告訴它這格改了：那格的紅字收掉，別格的還在', () => {
		const { ask } = asker();
		ask.send(missing, { field: 'BPM' });
		ask.send(missing, { field: '拍數' });
		ask.edited('BPM');
		expect(ask.fieldErrors).toEqual({ 拍數: '「拍數」退回原本的值：找不到這個動作' });
	});

	it('沒給格名：收掉整張表單送出被擋的紅字，有格名的留著', () => {
		const { ask } = asker();
		ask.send(missing, { field: 'BPM' });
		ask.send({ name: 'renameFlow', args: [''] });
		expect(ask.error).not.toBe('');
		ask.edited();
		expect(ask.error).toBe('');
		expect(ask.fieldErrors).toEqual({ BPM: '「BPM」退回原本的值：找不到這個動作' });
	});
});

describe('用名字送指令', () => {
	it('成功：跑現在的流程，把新流程交出去；done 拿得到多帶的結果', () => {
		const flow = recorded();
		const { ask, onchange } = asker(flow);
		const done = vi.fn();
		const r = ask.send({ name: 'addSegment', args: ['music'] }, { done });
		expect(r).toEqual(addSegment(flow, 'music'));
		expect(onchange).toHaveBeenCalledWith(flowOf(addSegment(flow, 'music')));
		expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }));
		expect(ask.error).toBe('');
	});

	it('被擋：留下原因，給了還原就加「，已還原」', () => {
		const { ask, onchange } = asker(recorded());
		const revert = vi.fn();
		ask.send({ name: 'deleteAction', args: ['x9'] }, { revert });
		expect(ask.error).toBe('找不到這個動作，已還原');
		expect(revert).toHaveBeenCalledOnce();
		expect(onchange).not.toHaveBeenCalled();
	});

	it('要確認，按確定：帶著確定再送一次', () => {
		const flow = recorded();
		const { ask, onchange } = asker(flow);
		ask.send({ name: 'deleteAction', args: ['x1'] });
		expect(ask.question).toEqual({
			message: '刪掉動作「技巧·Lib」會清掉 1 次紀錄（清掉的紀錄按「復原」會回來）',
			items: [],
			choose: false,
			confirmLabel: '確定'
		});
		ask.answer('confirm');
		expect(onchange).toHaveBeenCalledWith(flowOf(deleteAction(flow, 'x1', { confirmed: true })));
		expect(ask.question).toBeNull();
	});

	it('成功的一步交出去送了什麼：步驟 id（問之前、之後同一個）、帶著回答的指令（雲端流程送給伺服器）', () => {
		const { ask, state } = asker(recorded());
		ask.send(rename);
		const first = state.step!;
		expect(first.commands).toEqual([rename]);
		expect(first.id).toMatch(/^[a-z0-9]{12}$/);

		ask.send({ name: 'deleteAction', args: ['x1'] });
		expect(state.step).toBe(first);
		ask.answer('confirm');
		expect(state.step!.commands).toEqual([{ name: 'deleteAction', args: ['x1'], options: { confirmed: true } }]);
		expect(state.step!.id).not.toBe(first.id);
	});

	it('要選，選清掉：帶著清掉再送一次', () => {
		const flow = recorded();
		const { ask, onchange } = asker(flow);
		ask.send({ name: 'updateMember', args: ['m1', { name: '小美美' }] });
		expect(ask.question?.choose).toBe(true);
		ask.answer('clear');
		expect(onchange).toHaveBeenCalledWith(flowOf(updateMember(flow, 'm1', { name: '小美美' }, { records: 'clear' })));
	});

	it('按確定時用那時候的流程再送', () => {
		const { ask, onchange, state } = asker(recorded());
		ask.send({ name: 'deleteAction', args: ['x1'] });
		const now = flowOf(renameFlow(state.flow, '決賽'));
		state.flow = now;
		ask.answer('confirm');
		expect(onchange).toHaveBeenCalledWith(flowOf(deleteAction(now, 'x1', { confirmed: true })));
	});

	it('一步帶好幾個指令：中間一個要問，回答只給它，整串再送一次', () => {
		const flow = recorded();
		const { ask, onchange } = asker(flow);
		ask.send([
			{ name: 'renameFlow', args: ['決賽'] },
			{ name: 'deleteAction', args: ['x1'] },
			{ name: 'updateMember', args: ['m1', { name: '小美美' }] }
		]);
		expect(onchange).not.toHaveBeenCalled();
		ask.answer('confirm');
		// 刪掉 x1 紀錄就沒了，改名不用再問
		const renamed = flowOf(renameFlow(flow, '決賽'));
		const after = flowOf(deleteAction(renamed, 'x1', { confirmed: true }));
		expect(onchange).toHaveBeenCalledWith(flowOf(updateMember(after, 'm1', { name: '小美美' })));
	});

	it('一步帶好幾個指令：後面的又要問，前面的回答留著，再回答一次', () => {
		const flow = recorded();
		const { ask, onchange } = asker(flow);
		ask.send([
			{ name: 'updateMember', args: ['m1', { name: '小美美' }] },
			{ name: 'deleteAction', args: ['x1'] }
		]);
		ask.answer('keep');
		expect(ask.question?.choose).toBe(false);
		ask.answer('confirm');
		const kept = flowOf(updateMember(flow, 'm1', { name: '小美美' }, { records: 'keep' }));
		expect(onchange).toHaveBeenCalledWith(flowOf(deleteAction(kept, 'x1', { confirmed: true })));
	});

	it('鎖著：不送，當被擋', () => {
		const { ask, onchange } = asker(recorded(), { locked: () => '檢視模式' });
		ask.send({ name: 'renameFlow', args: ['決賽'] });
		expect(ask.error).toBe('檢視模式');
		expect(onchange).not.toHaveBeenCalled();
	});
});

describe('只收指令名字＋參數', () => {
	it('包好的函式型別就不過', () => {
		const ask = new Ask(vi.fn());
		const sendFunction = () =>
			ask.send(
				// @ts-expect-error 不收包好的函式
				() => ({ kind: 'ok', flow: flowA }) as const
			);
		expect(sendFunction).toBeTypeOf('function');
	});
});

describe('不用送指令就被擋（教練打的字看不懂）', () => {
	it('留下原因，跟送出被擋一樣：給了格名記在那一格、給了還原就還原', () => {
		const onfail = vi.fn();
		const ask = new Ask(vi.fn(), { onfail });
		const revert = vi.fn();
		ask.block('看不懂出發', { field: '出發', revert });
		expect(ask.fieldErrors).toEqual({ 出發: '「出發」退回原本的值：看不懂出發' });
		expect(revert).toHaveBeenCalled();
		ask.block('看不懂到達');
		expect(ask.error).toBe('看不懂到達');
		expect(ask.failures).toBe(2);
		expect(onfail).toHaveBeenCalledWith('看不懂到達');
	});
});

describe('送之前就看得出不行', () => {
	it('當被擋：留下原因，給了還原就加「，已還原」並還原，回傳被擋', () => {
		const onchange = vi.fn();
		const onfail = vi.fn();
		const ask = new Ask(onchange, { onfail });
		const revert = vi.fn();
		const r = ask.block('長度看不懂', { revert });
		expect(r).toEqual({ kind: 'blocked', message: '長度看不懂' });
		expect(ask.error).toBe('長度看不懂，已還原');
		expect(revert).toHaveBeenCalledOnce();
		expect(onfail).toHaveBeenCalledWith('長度看不懂，已還原');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('給了格名：原因記在那一格', () => {
		const ask = new Ask(vi.fn());
		ask.block('看不懂', { field: '開始' });
		expect(ask.fieldErrors).toEqual({ 開始: '「開始」退回原本的值：看不懂' });
	});

	it('鎖著：原因是鎖給的那句', () => {
		const ask = new Ask(vi.fn(), { locked: () => '檢視模式' });
		ask.block('長度看不懂');
		expect(ask.error).toBe('檢視模式');
	});
});
