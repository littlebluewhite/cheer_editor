import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setUnsavedCheck } from '#lib/unsaved.js';
import LanguagePicker from './LanguagePicker.svelte';

// 真的 setLocale 會整頁重新載入（jsdom 做不到）：換成記下來就好
const switched = vi.hoisted(() => [] as string[]);
vi.mock('#lib/paraglide/runtime.js', async (load) => ({
	...(await load<typeof import('#lib/paraglide/runtime.js')>()),
	setLocale: (locale: string) => void switched.push(locale)
}));

// jsdom 沒有 scrollIntoView（擋住時的提醒捲過去，reveal.ts）。
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
	cleanup();
	switched.length = 0;
	setUnsavedCheck(() => false);
});

describe('換語言', () => {
	it('每個語言用它自己的字寫，選著現在的語言', () => {
		render(LanguagePicker);
		const picker = screen.getByRole('combobox', { name: '語言' }) as HTMLSelectElement;
		expect([...picker.options].map((o) => o.text)).toEqual(['中文', 'English']);
		expect(picker.value).toBe('zh-TW');
	});

	it('選 English 就換成英文', async () => {
		render(LanguagePicker);
		await fireEvent.change(screen.getByRole('combobox', { name: '語言' }), { target: { value: 'en' } });
		expect(switched).toEqual(['en']);
	});

	it('有還沒存的修改：不換，選單跳回中文，說先存檔', async () => {
		setUnsavedCheck(() => true);
		render(LanguagePicker);
		const picker = screen.getByRole('combobox', { name: '語言' }) as HTMLSelectElement;
		await fireEvent.change(picker, { target: { value: 'en' } });
		expect(switched).toEqual([]);
		expect(picker.value).toBe('zh-TW');
		expect(screen.getByRole('alert').textContent).toBe('有還沒存的修改，先存檔再換語言。');
	});
});
