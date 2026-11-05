// 手機（窄螢幕）的檢視模式（#175，docs/adr/0005-ipad-touch.md）：上面場地、中間播放鈕、下面現在這一列八拍表；
// 從名單選一次「我」，這台裝置照流程記住（不進流程檔），之後打開就把我標亮。
// 窄不窄是媒體查詢（NARROW_SCREEN）的事：jsdom 沒有 matchMedia，換一個假的說「窄」。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFlowFile, writeFlowFile, type Flow } from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import { editorPage, flush, manualFrames, openFile } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
});
afterEach(() => vi.unstubAllGlobals());

/** 手機打開首頁，開一個流程檔（範例流程：小美 m1、小A m2、小B m3、小芳 m4，動作 Lib 在第 1 個八拍）。 */
async function openOnPhone(flow: Flow = libSample()) {
	const engine = createFakeEngine();
	const frames = manualFrames();
	const page = editorPage(null, { createEngine: () => engine, nextFrame: frames.nextFrame });
	render(Page, page.props);
	await flush();
	await openFile(writeFlowFile(flow, {}));
	return { ...page, engine, frames };
}

const row = () => screen.getByRole('region', { name: '八拍表這一列' });
const me = () => screen.getByLabelText('我') as HTMLSelectElement;
const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;

describe('手機的檢視模式', () => {
	it('開檔直接看到場地、播放鈕、八拍表這一列；按播放，播放頭和八拍表跟著走', async () => {
		const { engine, frames } = await openOnPhone();
		// 不停在被擋住的編排畫面
		expect(screen.queryByRole('region', { name: '視窗太窄了' })).toBeNull();
		expect(screen.getByRole('img', { name: '場地' })).toBeTruthy();
		expect(row().textContent).toContain('Lib');
		const at = screen.getByLabelText('目前位置').textContent;

		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		// 聲音走了 5 秒（120 BPM 一個八拍 4 秒）：到第 2 個八拍
		engine.audible = engine.time + 0.1 + 5;
		frames.step();
		await flush();
		expect(screen.getByLabelText('目前位置').textContent).not.toBe(at);
		expect(row().textContent).not.toContain('Lib');
	});

	it('一律是檢視模式：沒有「編輯」開關，也沒有復原、流程設定', async () => {
		const { session } = await openOnPhone();
		expect(session.viewing).toBe(true);
		expect(screen.queryByRole('switch', { name: '編輯' })).toBeNull();
		expect(screen.queryByRole('button', { name: '復原' })).toBeNull();
		expect(screen.queryByRole('button', { name: /設定/ })).toBeNull();
	});

	it('選「我」是小A：場上標亮小A，八拍表這一列只寫小A的；不算改流程', async () => {
		const { session } = await openOnPhone();
		expect(dot('m2').classList.contains('selected')).toBe(false);
		await fireEvent.change(me(), { target: { value: 'm2' } });
		expect(dot('m2').classList.contains('selected')).toBe(true);
		expect(dot('m1').classList.contains('selected')).toBe(false);
		expect(row().textContent).toContain('主底・第 1 組・同組：小美（上層）');
		expect(session.unsaved).toBe(false);
	});

	it('重新打開同一支流程，還是標亮小A；存出來的流程檔裡沒有「我」', async () => {
		await openOnPhone();
		await fireEvent.change(me(), { target: { value: 'm2' } });
		cleanup();

		const { saves } = await openOnPhone();
		expect(me().value).toBe('m2');
		expect(dot('m2').classList.contains('selected')).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: '存檔' }));
		await flush();
		const saved = readFlowFile(saves.at(-1)!);
		expect(saved.kind === 'ok' && saved.flow).toEqual(libSample());
	});

	it('別支流程（名字不一樣）不帶上一支的「我」', async () => {
		await openOnPhone();
		await fireEvent.change(me(), { target: { value: 'm2' } });
		cleanup();

		await openOnPhone({ ...libSample(), name: '別支' });
		expect(me().value).toBe('');
		expect(dot('m2').classList.contains('selected')).toBe(false);
	});

	it('「練習」照舊；切回「編排」又是檢視畫面', async () => {
		await openOnPhone();
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(screen.getByRole('region', { name: '練習' })).toBeTruthy();
		expect(screen.queryByRole('region', { name: '八拍表這一列' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		expect(row()).toBeTruthy();
	});

	it('上方列的「回首頁」：回到首頁，列在最近的流程', async () => {
		await openOnPhone();
		await fireEvent.click(screen.getByRole('button', { name: '回首頁' }));
		await flush();
		await vi.waitFor(() => expect(screen.getByRole('list', { name: '最近的流程' }).textContent).toContain('測試'));
	});

	it('有未存的修改（練習記了一次）按「回首頁」：跟「新建」一樣先問；取消就留著，「不存了，繼續」才回首頁', async () => {
		await openOnPhone();
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		for (const phase of ['上法', '中段', '下法']) {
			await fireEvent.click(screen.getByRole('button', { name: `第 1 組 小美 ${phase} 成功` }));
		}
		await fireEvent.click(within(screen.getByRole('region', { name: '第 1 組 小美' })).getByRole('button', { name: '存這一次' }));
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		await fireEvent.click(screen.getByRole('button', { name: '回首頁' }));
		const dialog = within(screen.getByRole('dialog', { name: '「測試」還沒存，改的東西會不見。' }));
		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(row()).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: '回首頁' }));
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		await flush();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});
});
