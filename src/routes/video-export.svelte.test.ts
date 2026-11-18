// 輸出影片（流程影片）：上方列的按鈕和對話框。準備 → 輸出中 → 做好了／失敗，取消、再試一次、存檔、瀏覽器不支援。
// 用假的編碼器（#lib/video/fake-encoder.js）：不畫圖，只記畫了哪幾格，release() 之前停在最後一格前。
// 窄不窄、是不是觸控螢幕是媒體查詢：jsdom 沒有 matchMedia，換一個假的。
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIDEO_FPS, createFlow, updateSegment, videoDurationSec, type Flow } from '#lib/core';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import { audioFlow, editorPage, teamFlow } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import { createFakeVideoEncoder } from '#lib/video/fake-encoder.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

/** teamFlow 只留一個八拍（3 秒）：影片 6 秒、180 格，假編碼器一格等一次 setTimeout，才不會等太久。 */
function shortFlow(): Flow {
	return flowOf(updateSegment(teamFlow(), 's1', { eights: 1, lastBeats: 8 }));
}
const framesOf = (flow: Flow) => Math.round(videoDurationSec(flow) * VIDEO_FPS);

const dialog = () => screen.getByRole('dialog', { name: '輸出影片' });
const button = () => screen.getByRole('button', { name: '輸出影片' });

/** 等做完：180 格每格一次 setTimeout，可能比預設的 1 秒久。 */
const DONE = { timeout: 5000 };

async function openDialog(flow: Flow, adapters: Parameters<typeof editorPage>[1] = {}) {
	const page = editorPage(flow, adapters);
	render(Page, page.props);
	await fireEvent.click(button());
	return page;
}

describe('輸出影片', () => {
	it('按「輸出影片」→「開始」→ 進度條 → 做好了 → 存檔存成 流程名.mp4', async () => {
		const flow = shortFlow();
		const page = await openDialog(flow);
		expect(await within(dialog()).findByText('影片長 0:06')).toBeTruthy();
		await fireEvent.click(await within(dialog()).findByRole('button', { name: '開始' }));
		const bar = (await within(dialog()).findByRole('progressbar')) as HTMLProgressElement;
		expect(bar.max).toBe(framesOf(flow));
		await waitFor(() => expect(within(dialog()).getByText(`做到第 ${framesOf(flow) - 1} 格／一共 ${framesOf(flow)} 格`)).toBeTruthy(), DONE);
		page.videoEncoder.release();
		expect(await within(dialog()).findByText(/^做好了，\d+\.\d MB$/, {}, DONE)).toBeTruthy();
		await fireEvent.click(within(dialog()).getByRole('button', { name: '存檔' }));
		await waitFor(() => expect(page.videoSaves).toHaveLength(1));
		expect(page.videoSaves[0].fileName).toBe('練習用.mp4');
	});

	it('沒有段：按鈕停用', () => {
		render(Page, editorPage(flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }))).props);
		expect((button() as HTMLButtonElement).disabled).toBe(true);
	});

	it('窄螢幕沒有這個按鈕', () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
		render(Page, editorPage(shortFlow()).props);
		expect(screen.queryByRole('button', { name: '輸出影片' })).toBeNull();
	});

	it('觸控螢幕（iPad 橫拿，不窄）沒有這個按鈕', () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
		render(Page, editorPage(shortFlow()).props);
		expect(screen.queryByRole('button', { name: '八拍表' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '輸出影片' })).toBeNull();
	});

	it('瀏覽器做不出來：還沒按開始就說，沒有「開始」，只有「關閉」', async () => {
		const save = async () => 'saved' as const;
		await openDialog(shortFlow(), { video: { encoder: createFakeVideoEncoder({ supported: false }), save } });
		expect(await within(dialog()).findByText('這個瀏覽器不能輸出影片，請用電腦的 Chrome 或 Edge')).toBeTruthy();
		expect(within(dialog()).queryByRole('button', { name: '開始' })).toBeNull();
		await fireEvent.click(within(dialog()).getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog', { name: '輸出影片' })).toBeNull();
	});

	it('失敗：寫原因，「再試一次」重新編一次', async () => {
		const encoder = createFakeVideoEncoder({ fail: '記憶體不夠' });
		const encode = vi.spyOn(encoder, 'encode');
		await openDialog(shortFlow(), { video: { encoder, save: async () => 'saved' } });
		await fireEvent.click(await within(dialog()).findByRole('button', { name: '開始' }));
		expect(await within(dialog()).findByText('沒做成：記憶體不夠')).toBeTruthy();
		expect(encode).toHaveBeenCalledTimes(1);
		await fireEvent.click(within(dialog()).getByRole('button', { name: '再試一次' }));
		await waitFor(() => expect(encode).toHaveBeenCalledTimes(2));
		expect(await within(dialog()).findByText('沒做成：記憶體不夠')).toBeTruthy();
	});

	it('輸出中按「取消」：編碼中止、對話框關掉；再開、再按開始，從第 0 格重新畫到最後一格', async () => {
		const flow = shortFlow();
		const page = await openDialog(flow);
		await fireEvent.click(await within(dialog()).findByRole('button', { name: '開始' }));
		await within(dialog()).findByRole('progressbar');
		await fireEvent.click(within(dialog()).getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('dialog', { name: '輸出影片' })).toBeNull();
		await waitFor(() => expect(page.videoEncoder.aborted).toBe(true));
		const before = page.videoEncoder.drawn.length;

		await fireEvent.click(button());
		await fireEvent.click(await within(dialog()).findByRole('button', { name: '開始' }));
		await waitFor(() => expect(page.videoEncoder.drawn.length - before).toBe(framesOf(flow) - 1), DONE);
		page.videoEncoder.release();
		await within(dialog()).findByText(/^做好了/, {}, DONE);
		const again = page.videoEncoder.drawn.slice(before);
		expect(again).toHaveLength(framesOf(flow));
		expect(again).toEqual([...Array(framesOf(flow)).keys()]);
	});

	it('輸出中按 Esc 當取消', async () => {
		const page = await openDialog(shortFlow());
		await fireEvent.click(await within(dialog()).findByRole('button', { name: '開始' }));
		await within(dialog()).findByRole('progressbar');
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: '輸出影片' })).toBeNull();
		await waitFor(() => expect(page.videoEncoder.aborted).toBe(true));
	});

	it('輸出中點背景當取消', async () => {
		const page = await openDialog(shortFlow());
		await fireEvent.click(await within(dialog()).findByRole('button', { name: '開始' }));
		await within(dialog()).findByRole('progressbar');
		const backdrop = dialog().parentElement!;
		await fireEvent.pointerDown(backdrop);
		await fireEvent.click(backdrop);
		expect(screen.queryByRole('dialog', { name: '輸出影片' })).toBeNull();
		await waitFor(() => expect(page.videoEncoder.aborted).toBe(true));
	});

	it('輸出中對話框蓋住編輯畫面：空白鍵不會開始播放', async () => {
		const page = await openDialog(shortFlow());
		await fireEvent.click(await within(dialog()).findByRole('button', { name: '開始' }));
		await within(dialog()).findByRole('progressbar');
		await fireEvent.keyDown(document.body, { key: ' ' });
		expect(page.editor.playback.playing).toBe(false);
		expect(document.querySelector<HTMLElement>('.editor')!.inert).toBe(true);
	});

	it('檢視模式也能輸出', async () => {
		const page = editorPage(shortFlow());
		render(Page, page.props);
		await fireEvent.click(screen.getByRole('button', { name: '檢視' }));
		expect(page.session.viewing).toBe(true);
		await fireEvent.click(button());
		await fireEvent.click(await within(dialog()).findByRole('button', { name: '開始' }));
		page.videoEncoder.release();
		expect(await within(dialog()).findByText(/^做好了/, {}, DONE)).toBeTruthy();
	});

	it('找不到音樂的段：寫出音樂檔名', async () => {
		await openDialog(audioFlow());
		expect(await within(dialog()).findByText('這幾段找不到音樂，影片裡沒有聲音：「主歌.mp3」')).toBeTruthy();
	});

	it('沒選音樂的音樂段：寫段名', async () => {
		await openDialog(shortFlow());
		expect(await within(dialog()).findByText('這幾段找不到音樂，影片裡沒有聲音：音樂 1（還沒選音樂）')).toBeTruthy();
	});
});
