// 插入八拍（#168）：時間軸「段」那一格的「插入八拍」，在播放頭空出時間，後面的色條往後；⌘Z 回來。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { addAction } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 範例流程（Lib 1-1 起 1 個八拍，4 個八拍、150 BPM），加小A 的騰翻在 3-1 開始。時間軸 ×1：1 秒 16 px。 */
function setup() {
	const flow = flowOf(
		addAction(libSample(), {
			segmentId: 's1',
			category: 'tumbling',
			name: '',
			start: 32,
			length: 8,
			note: '',
			members: [{ memberId: 'm2', role: null }]
		})
	);
	const { session, editor, props } = editorPage(flow);
	render(Page, props);
	return { session, editor };
}

/** 色條的左邊（px）。半拍 0.2 秒 = 3.2 px。 */
const left = (id: string) => document.querySelector<HTMLElement>(`[data-lane="m2"] [data-action-id="${id}"]`)!.style.left;

describe('插入八拍', () => {
	it('播放頭在 2-1 插入 1 個八拍：後面的色條往後 1 個八拍、前面的不動；⌘Z 回來', async () => {
		const { editor } = setup();
		editor.playback.seek(16 * 0.2);
		expect(left('x2')).toBe(`${32 * 3.2}px`);
		await fireEvent.click(screen.getByRole('button', { name: '插入八拍' }));
		expect(screen.getByText('在音樂 1 2-1 插入')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '插入' }));
		expect(left('x2')).toBe(`${48 * 3.2}px`);
		expect(left('x1')).toBe('0px');
		expect(screen.getByRole('status').textContent).toContain('插入了 1 個八拍');
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'z', metaKey: true });
		expect(left('x2')).toBe(`${32 * 3.2}px`);
	});

	it('⌘Z 復原的提示寫「插入八拍」', async () => {
		const { editor } = setup();
		editor.playback.seek(16 * 0.2);
		await fireEvent.click(screen.getByRole('button', { name: '插入八拍' }));
		await fireEvent.click(screen.getByRole('button', { name: '插入' }));
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'z', metaKey: true });
		expect(screen.getByRole('status').textContent).toContain('已復原：插入八拍');
	});

	it('段尾後面沒有東西：沒插到，不說插入了，也不多一步復原', async () => {
		const { session, editor } = setup();
		const before = session.flow;
		// 4-8&：最後一個半拍，後面沒有站位、動作
		editor.playback.seek(63 * 0.2);
		await fireEvent.click(screen.getByRole('button', { name: '插入八拍' }));
		await fireEvent.input(screen.getByLabelText('插入幾個'), { target: { value: '1' } });
		await fireEvent.change(screen.getByLabelText('單位'), { target: { value: 'beat' } });
		await fireEvent.click(screen.getByRole('button', { name: '插入' }));
		expect(screen.getByRole('status').textContent).toBe('音樂 1 4-8& 後面沒有站位或動作，沒有東西要往後延');
		expect(session.flow).toBe(before);
		expect(session.canUndo).toBe(false);
	});

	it('可以改成插幾拍', async () => {
		const { editor } = setup();
		editor.playback.seek(16 * 0.2);
		await fireEvent.click(screen.getByRole('button', { name: '插入八拍' }));
		await fireEvent.input(screen.getByLabelText('插入幾個'), { target: { value: '2' } });
		await fireEvent.change(screen.getByLabelText('單位'), { target: { value: 'beat' } });
		await fireEvent.click(screen.getByRole('button', { name: '插入' }));
		expect(left('x2')).toBe(`${36 * 3.2}px`);
	});

	it('後面的動作放不下：擋下，說是哪個；流程不變', async () => {
		const { session, editor } = setup();
		const before = session.flow;
		editor.playback.seek(16 * 0.2);
		await fireEvent.click(screen.getByRole('button', { name: '插入八拍' }));
		await fireEvent.input(screen.getByLabelText('插入幾個'), { target: { value: '2' } });
		await fireEvent.click(screen.getByRole('button', { name: '插入' }));
		// 選的單位是八拍：照八拍講（T09）
		expect(screen.getByRole('alert').textContent).toBe('「騰翻」會超過這段的結尾，最多插 1 個八拍');
		expect(session.flow).toBe(before);
	});

	it('選「拍」時照拍講（T09）', async () => {
		const { editor } = setup();
		editor.playback.seek(16 * 0.2);
		await fireEvent.click(screen.getByRole('button', { name: '插入八拍' }));
		await fireEvent.input(screen.getByLabelText('插入幾個'), { target: { value: '13' } });
		await fireEvent.change(screen.getByLabelText('單位'), { target: { value: 'beat' } });
		await fireEvent.click(screen.getByRole('button', { name: '插入' }));
		expect(screen.getByRole('alert').textContent).toBe('「騰翻」會超過這段的結尾，最多插 12 拍');
	});
});
