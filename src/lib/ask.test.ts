// 問教練 module：送一個指令，照結果交出新流程、留下原因或留下問題；回答後帶著選項再送一次。

import { describe, expect, it, vi } from 'vitest';
import {
	addSegment,
	deleteAction,
	recordAttempt,
	renameFlow,
	updateMember,
	type CommandResult,
	type ConfirmOption,
	type Flow
} from '#lib/core';
import { Ask } from './ask.svelte';
import { flowOf, ratedSample } from './test-flows';

const flowA = { name: 'A' } as unknown as Flow;
const flowB = { name: 'B' } as unknown as Flow;

/** 假的指令：照順序回 results，記下每次帶的選項。 */
function command(...results: CommandResult[]) {
	const options: ConfirmOption[] = [];
	const send = (o: ConfirmOption = {}) => {
		options.push(o);
		return results[Math.min(options.length - 1, results.length - 1)];
	};
	return { send, options };
}

const ok = (flow: Flow): CommandResult => ({ kind: 'ok', flow });
const blocked = (message: string): CommandResult => ({ kind: 'blocked', message });
const confirm = (message: string, items: string[] = []): CommandResult => ({ kind: 'confirm', message, items });
const choose = (message: string, items: string[] = []): CommandResult => ({ kind: 'choose', message, items });

describe('送指令', () => {
	it('成功：把新流程交出去，沒有原因、沒有問題', () => {
		const onchange = vi.fn();
		const ask = new Ask(onchange);
		const done = vi.fn();
		ask.send(command(ok(flowA)).send, { done });
		expect(onchange).toHaveBeenCalledWith(flowA);
		expect(done).toHaveBeenCalledOnce();
		expect(ask.error).toBe('');
		expect(ask.question).toBeNull();
	});

	it('被擋：留下原因，流程沒交出去', () => {
		const onchange = vi.fn();
		const ask = new Ask(onchange);
		ask.send(command(blocked('長度看不懂')).send);
		expect(ask.error).toBe('長度看不懂');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('被擋又給了還原：原因後面加「，已還原」並還原', () => {
		const ask = new Ask(vi.fn());
		const revert = vi.fn();
		ask.send(command(blocked('長度看不懂')).send, { revert });
		expect(ask.error).toBe('長度看不懂，已還原');
		expect(revert).toHaveBeenCalledOnce();
	});

	it('要確認：留下問題（訊息、清單、不用選）', () => {
		const ask = new Ask(vi.fn());
		ask.send(command(confirm('會刪掉拍點', ['3-5'])).send);
		expect(ask.question).toEqual({ message: '會刪掉拍點', items: ['3-5'], choose: false });
		expect(ask.error).toBe('');
	});

	it('要選：留下問題（要選）', () => {
		const ask = new Ask(vi.fn());
		ask.send(command(choose('換了人', ['第 1 組'])).send);
		expect(ask.question).toEqual({ message: '換了人', items: ['第 1 組'], choose: true });
	});

	it('再送一個指令：上一個的原因和問題收掉', () => {
		const ask = new Ask(vi.fn());
		ask.send(command(blocked('不行')).send);
		ask.send(command(confirm('要確認')).send);
		expect(ask.error).toBe('');
		ask.send(command(ok(flowA)).send);
		expect(ask.question).toBeNull();
	});

	it('給了 onfail：被擋、要問時呼叫（給原因，要問時是空的），成功不呼叫', () => {
		const onfail = vi.fn();
		const ask = new Ask(vi.fn(), { onfail });
		ask.send(command(blocked('不行')).send, { revert: () => {} });
		expect(onfail).toHaveBeenLastCalledWith('不行，已還原');
		ask.send(command(confirm('要確認')).send);
		expect(onfail).toHaveBeenLastCalledWith('');
		ask.send(command(ok(flowA)).send);
		expect(onfail).toHaveBeenCalledTimes(2);
	});

	it('回傳第一次送出的結果', () => {
		const ask = new Ask(vi.fn());
		expect(ask.send(command(choose('換了人')).send).kind).toBe('choose');
	});
});

describe('回答', () => {
	it('確定：帶 confirmed 再送一次，成功就交出流程、問題收掉', () => {
		const onchange = vi.fn();
		const done = vi.fn();
		const ask = new Ask(onchange);
		const c = command(confirm('要確認'), ok(flowB));
		ask.send(c.send, { done });
		ask.answer('confirm');
		expect(c.options[1]).toEqual({ confirmed: true });
		expect(onchange).toHaveBeenCalledWith(flowB);
		expect(done).toHaveBeenCalledOnce();
		expect(ask.question).toBeNull();
	});

	it('保留舊紀錄、清掉重算：帶對的選項再送一次', () => {
		const ask = new Ask(vi.fn());
		const keep = command(choose('換了人'), ok(flowA));
		ask.send(keep.send);
		ask.answer('keep');
		expect(keep.options[1]).toEqual({ records: 'keep' });

		const clear = command(choose('換了人'), ok(flowA));
		ask.send(clear.send);
		ask.answer('clear');
		expect(clear.options[1]).toEqual({ records: 'clear' });
	});

	it('取消：問題收掉、不再送、流程沒交出去；給了還原就還原（沒有原因）', () => {
		const onchange = vi.fn();
		const revert = vi.fn();
		const ask = new Ask(onchange);
		const c = command(confirm('要確認'), ok(flowA));
		ask.send(c.send, { revert });
		ask.answer('cancel');
		expect(c.options).toHaveLength(1);
		expect(onchange).not.toHaveBeenCalled();
		expect(ask.question).toBeNull();
		expect(revert).toHaveBeenCalledOnce();
		expect(ask.error).toBe('');
	});

	it('給了 cancel：按取消才呼叫，被擋不呼叫、原因不加「，已還原」', () => {
		const cancel = vi.fn();
		const ask = new Ask(vi.fn());
		ask.send(command(blocked('BPM 不對')).send, { cancel });
		expect(ask.error).toBe('BPM 不對');
		expect(cancel).not.toHaveBeenCalled();
		ask.send(command(confirm('要確認')).send, { cancel });
		ask.answer('cancel');
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('回答後被擋：留下原因，加「，已還原」並還原', () => {
		const revert = vi.fn();
		const ask = new Ask(vi.fn());
		ask.send(command(confirm('要確認'), blocked('動作不見了')).send, { revert });
		ask.answer('confirm');
		expect(ask.error).toBe('動作不見了，已還原');
		expect(revert).toHaveBeenCalledOnce();
		expect(ask.question).toBeNull();
	});

	it('再送又要問：換成新的問題，再回答一次', () => {
		const onchange = vi.fn();
		const ask = new Ask(onchange);
		const c = command(confirm('會刪掉拍點'), choose('換了人', ['第 2 組']), ok(flowB));
		ask.send(c.send);
		ask.answer('confirm');
		expect(ask.question).toEqual({ message: '換了人', items: ['第 2 組'], choose: true });
		ask.answer('keep');
		expect(c.options[2]).toEqual({ records: 'keep' });
		expect(onchange).toHaveBeenCalledWith(flowB);
	});

	it('沒有問題時回答不做事', () => {
		const onchange = vi.fn();
		const ask = new Ask(onchange);
		ask.answer('confirm');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('收掉：原因和問題都清掉', () => {
		const ask = new Ask(vi.fn());
		ask.send(command(confirm('要確認')).send);
		ask.clear();
		expect(ask.question).toBeNull();
		ask.send(command(blocked('不行')).send);
		ask.clear();
		expect(ask.error).toBe('');
	});
});

describe('改了一格', () => {
	it('一格被擋有紅字，告訴它這格改了：那格的紅字收掉，別格的還在', () => {
		const ask = new Ask(vi.fn());
		ask.send(command(blocked('BPM 不對')).send, { field: 'BPM' });
		ask.send(command(blocked('拍數不對')).send, { field: '拍數' });
		ask.edited('BPM');
		expect(ask.fieldErrors).toEqual({ 拍數: '「拍數」退回原本的值：拍數不對' });
	});

	it('沒給格名：收掉整張表單送出被擋的紅字，有格名的留著', () => {
		const ask = new Ask(vi.fn());
		ask.send(command(blocked('BPM 不對')).send, { field: 'BPM' });
		ask.send(command(blocked('請幫流程取名字')).send);
		ask.edited();
		expect(ask.error).toBe('');
		expect(ask.fieldErrors).toEqual({ BPM: '「BPM」退回原本的值：BPM 不對' });
	});
});

describe('用名字送指令', () => {
	/** ratedSample 的 x1 第 1 組記一次：刪 x1 要確認、改小美的名字要選。 */
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

	/** 跟著 onchange 換流程的問教練（跟編輯 session 一樣）。 */
	function asker(flow: Flow, options: { locked?: () => string } = {}) {
		const state = { flow };
		const onchange = vi.fn((f: Flow) => (state.flow = f));
		const ask = new Ask(onchange, { ...options, flow: () => state.flow });
		return { ask, onchange, state };
	}

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
			message: '刪掉動作「技巧·Lib」會清掉 1 次紀錄',
			items: [],
			choose: false
		});
		ask.answer('confirm');
		expect(onchange).toHaveBeenCalledWith(flowOf(deleteAction(flow, 'x1', { confirmed: true })));
		expect(ask.question).toBeNull();
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
