// 畫面狀態的壽命（ux-root-causes E 群）：每個畫面狀態照它該活多久放對地方。
// 跟著流程（切頁拆掉元件也留著）、換流程就重設、重開小窗就重設。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { addSegment, writeFlowFile } from '#lib/core';
import { editorPage, openFile, practiceFlow } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

describe('畫面狀態的壽命', () => {
	it('記錄頁選第 2 個動作，切到總表再切回來：還是第 2 個（N07）', async () => {
		render(Page, editorPage(practiceFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const pressed = (label: string) =>
			screen.getByRole('button', { name: new RegExp(`^${label}`) }).getAttribute('aria-pressed');
		await fireEvent.click(screen.getByRole('button', { name: /^騰翻/ }));
		expect(pressed('騰翻')).toBe('true');

		await fireEvent.click(screen.getByRole('button', { name: '總表' }));
		await fireEvent.click(screen.getByRole('button', { name: '記錄' }));
		expect(pressed('騰翻')).toBe('true');
		expect(pressed('技巧·Lib')).toBe('false');

		// 切到編排再回來：還在總表或記錄的哪一頁、選的動作都留著
		await fireEvent.click(screen.getByRole('button', { name: '總表' }));
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(screen.getByRole('button', { name: '總表' }).getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(screen.getByRole('button', { name: '記錄' }));
		expect(pressed('騰翻')).toBe('true');
	});

	it('記錄頁選的動作：開另一個檔就回到第一個', async () => {
		render(Page, editorPage(practiceFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await fireEvent.click(screen.getByRole('button', { name: /^騰翻/ }));
		await openFile(writeFlowFile(practiceFlow(), {}), '開啟');
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(screen.getByRole('button', { name: /^技巧·Lib/ }).getAttribute('aria-pressed')).toBe('true');
	});

	it('開 A 檔捲了時間軸，再開 B 檔：時間軸捲回開頭（N43）', async () => {
		render(Page, editorPage(libSample()).props);
		const timeline = document.querySelector<HTMLElement>('.timeline')!;
		timeline.scrollLeft = 50;
		await fireEvent.scroll(timeline);
		// 段名跟著捲到看得到的左邊
		expect(screen.getByRole('button', { name: /^音樂 1/ }).style.paddingLeft).toBe('58px');

		await openFile(writeFlowFile(libSample(), {}), '開啟');
		expect(document.querySelector<HTMLElement>('.timeline')!.scrollLeft).toBe(0);
		expect(screen.getByRole('button', { name: /^音樂 1/ }).style.paddingLeft).toBe('8px');
	});

	it('插入小窗在口號段打了 40400 秒，換到音樂段再開：是預設的 1 個八拍（N30）', async () => {
		// 音樂 1（4 個八拍、150 BPM，12.8 秒）後面接口號 2
		const { editor, props } = editorPage(flowOf(addSegment(libSample(), 'chant')));
		render(Page, props);
		const insertBtn = () => screen.getByRole('button', { name: '插入八拍' });
		const count = () => screen.getByLabelText('插入幾個') as HTMLInputElement;

		editor.playback.seek(13);
		await fireEvent.click(insertBtn());
		await fireEvent.input(count(), { target: { value: '40400' } });
		await fireEvent.click(insertBtn());
		expect(screen.queryByLabelText('插入幾個')).toBeNull();

		editor.playback.seek(16 * 0.2);
		await fireEvent.click(insertBtn());
		expect(count().value).toBe('1');
		expect((screen.getByLabelText('單位') as HTMLSelectElement).value).toBe('eight');
	});

	it('插入小窗選了「拍」關掉再開：回到「個八拍」', async () => {
		const { editor, props } = editorPage(libSample());
		render(Page, props);
		const insertBtn = () => screen.getByRole('button', { name: '插入八拍' });
		editor.playback.seek(16 * 0.2);
		await fireEvent.click(insertBtn());
		await fireEvent.input(screen.getByLabelText('插入幾個'), { target: { value: '3' } });
		await fireEvent.change(screen.getByLabelText('單位'), { target: { value: 'beat' } });
		await fireEvent.click(insertBtn());
		await fireEvent.click(insertBtn());
		expect((screen.getByLabelText('插入幾個') as HTMLInputElement).value).toBe('1');
		expect((screen.getByLabelText('單位') as HTMLSelectElement).value).toBe('eight');
	});
});
