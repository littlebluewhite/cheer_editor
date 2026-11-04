// 問教練 module：送一個指令，照結果交出新流程、留下原因或留下問題；回答後帶著選項再送一次。

import { describe, expect, it, vi } from 'vitest';
import type { CommandResult, ConfirmOption, Flow } from '#lib/core';
import { Ask } from './ask.svelte';

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
