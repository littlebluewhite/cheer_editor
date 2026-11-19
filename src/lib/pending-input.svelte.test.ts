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

	it('中文輸入法還在選字：現在送出不送（注音不進流程），還算沒送出；選完了才送', async () => {
		const { input, sent } = field();
		await type(input, '小美ㄇㄟˇ');
		await fireEvent.compositionStart(input);
		domPendingInput.flush();
		expect(sent).toEqual([]);
		expect(domPendingInput.pending).toBe(true);
		await fireEvent.compositionEnd(input);
		await fireEvent.input(input, { target: { value: '小美美' } });
		domPendingInput.flush();
		expect(sent).toEqual(['小美美']);
	});
});

describe('在欄位裡按 Esc：丟掉沒送出的字（Apple 的 abortEditing）', () => {
	it('欄位退回上次送出的字、沒有沒送出的字；之後再發 change（Chrome 拆掉有焦點的欄位時會發）也不送（N06）', async () => {
		const { input, sent } = field();
		await type(input, '小美美');
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(input.value).toBe('小美');
		expect(domPendingInput.pending).toBe(false);
		await fireEvent.change(input);
		expect(sent).toEqual([]);
	});

	it('退回時發 input：bind:value 的狀態跟著退回', async () => {
		const { input } = field();
		const seen: string[] = [];
		input.addEventListener('input', () => seen.push(input.value));
		await type(input, '小美美');
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(seen.at(-1)).toBe('小美');
	});

	it('送出過一次再打字按 Esc：退回送出的那次，不是拿到焦點時的字', async () => {
		const { input, sent } = field();
		await type(input, '小美美');
		await fireEvent.change(input);
		await fireEvent.input(input, { target: { value: '小美美美' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(input.value).toBe('小美美');
		expect(sent).toEqual(['小美美']);
	});

	it('輸入法還在選字：Esc 是取消選字，不動欄位', async () => {
		const { input } = field();
		await type(input, '小美ㄇ');
		await fireEvent.compositionStart(input);
		await fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
		expect(input.value).toBe('小美ㄇ');
		expect(domPendingInput.pending).toBe(true);
	});

	it.each([
		['對話框裡（Esc 是關對話框，跟按 × 一樣送出，#93）', '<div role="dialog" aria-modal="true"></div>'],
		['還沒送出的表單（新動作、加隊員：字不在流程裡）', '<form data-native-undo></form>']
	])('%s：不退', async (_, html) => {
		const { input } = field();
		document.body.insertAdjacentHTML('beforeend', html);
		document.body.lastElementChild!.append(input);
		await type(input, '小美美');
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(input.value).toBe('小美美');
	});
});
