import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { localStorageKey, overwriteSetLocale } from '#lib/paraglide/runtime.js';
import { holdTabLocale } from '#lib/shown-locale.js';
import { setUnsavedCheck } from '#lib/unsaved.js';
import LanguagePicker from './LanguagePicker.svelte';

// 真的 setLocale 會整頁重新載入（jsdom 做不到）：換成記下來就好
const switched: string[] = [];
overwriteSetLocale((locale) => void switched.push(locale));

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

	it('別的分頁已經換成英文、這頁還是中文（回首頁選單重新出現）：選單還是中文，選 English 照樣換', async () => {
		holdTabLocale(); // src/hooks.client.ts 一開始做的
		render(LanguagePicker);
		localStorage.setItem(localStorageKey, 'en');
		cleanup();
		render(LanguagePicker);
		const picker = screen.getByRole('combobox', { name: '語言' }) as HTMLSelectElement;
		expect(picker.value).toBe('zh-TW');
		await fireEvent.change(picker, { target: { value: 'en' } });
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
