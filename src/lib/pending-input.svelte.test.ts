// 沒送出的字：真的 adapter（看 DOM 的焦點、打字、change）。編輯器 module 的測試用假的（#lib/test-fakes.js）。
import { fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { domPendingInput } from '#lib/pending-input.js';

/** 一個欄位：值是「小美」，每次送出（change 到了欄位自己）記下那時的值。 */
function field() {
	const input = document.createElement('input');
	input.value = '小美';
	const sent: string[] = [];
	input.addEventListener('change', () => sent.push(input.value));
	document.body.append(input);
	return { input, sent };
}

/** 在欄位裡打字，還沒離開欄位（沒有 change）。 */
async function type(input: HTMLInputElement, value: string) {
	input.focus();
	await fireEvent.input(input, { target: { value } });
}

afterEach(() => document.body.replaceChildren());

describe('沒送出的字（真的 adapter）', () => {
	it('在欄位打字：有沒送出的字；按 Enter 送出（change）就沒有', async () => {
		const { input } = field();
		await type(input, '小美美');
		expect(domPendingInput.pending).toBe(true);
		await fireEvent.change(input);
		expect(domPendingInput.pending).toBe(false);
	});

	it('離開欄位：沒有', async () => {
		const { input } = field();
		await type(input, '小美美');
		input.blur();
		expect(domPendingInput.pending).toBe(false);
	});

	it('現在送出：欄位發出 change，送的是打的字；之後就沒有了', async () => {
		const { input, sent } = field();
		await type(input, '小美美');
		domPendingInput.flush();
		expect(sent).toEqual(['小美美']);
		expect(domPendingInput.pending).toBe(false);
		// 沒有沒送出的字：不再送一次
		domPendingInput.flush();
		expect(sent).toEqual(['小美美']);
	});

	it('當作已經送出了：沒有；離開欄位時值沒變，不再送一次', async () => {
		const { input, sent } = field();
		await type(input, '小美美');
		domPendingInput.settle();
		expect(domPendingInput.pending).toBe(false);
		await fireEvent.change(input);
		expect(sent).toEqual([]);
	});

	it('打了字又刪回原來的字：還是算有；現在送出不發 change（值沒變），之後就沒有了', async () => {
		const { input, sent } = field();
		await type(input, '小美美');
		await fireEvent.input(input, { target: { value: '小美' } });
		expect(domPendingInput.pending).toBe(true);
		domPendingInput.flush();
		expect(sent).toEqual([]);
		expect(domPendingInput.pending).toBe(false);
	});

	it('畫面改了欄位的值（沒打字）：不算沒送出；現在送出照樣送（跟離開欄位一樣）', () => {
		const { input, sent } = field();
		input.focus();
		input.value = '小芳';
		expect(domPendingInput.pending).toBe(false);
		domPendingInput.flush();
		expect(sent).toEqual(['小芳']);
	});
});
