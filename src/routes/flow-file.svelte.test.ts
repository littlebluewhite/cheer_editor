// 頁面：存檔、開檔、Ctrl+S、缺音樂。存檔薄層換成假的 FileSaver（真的要手動在四家瀏覽器檢查）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
	createFlow,
	insertFormation,
	addPhase,
	readFlowFile,
	writeFlowFile
} from '#lib/core';
import { flowOf } from '#lib/core/test-flows.js';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { FileSaver } from '#lib/file/save.js';
import { audioFlow, fakeDecode, fakeSaver, openFile, settle } from '#lib/test-fakes.js';
import { hasUnsavedChanges } from '#lib/unsaved.js';
import Page from './+page.svelte';

function setup(saver: FileSaver = fakeSaver().saver) {
	render(Page, { createEngine: () => createFakeEngine(), createSaver: () => saver, decode: fakeDecode });
}

async function newFlow() {
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

const ctrlS = (target: Element | Window = window) => fireEvent.keyDown(target, { key: 's', ctrlKey: true });

/** audioFlow 再加第 2 張站位在 1 秒。 */
const sampleFlow = () => flowOf(insertFormation(audioFlow(), 1));

describe('存檔', () => {
	it('Ctrl+S 存成「流程名.zip」，存的就是這支流程', async () => {
		const { saver, saves, fileNames } = fakeSaver();
		setup(saver);
		await newFlow();
		await ctrlS();
		await settle();
		expect(fileNames).toEqual(['全國賽.zip']);
		const r = readFlowFile(saves[0]);
		expect(r.kind === 'ok' && r.flow.name).toBe('全國賽');
	});

	it('焦點在輸入框裡也能 Ctrl+S（Mac 是 ⌘S）', async () => {
		const { saver, saves } = fakeSaver();
		setup(saver);
		await newFlow();
		await fireEvent.keyDown(screen.getByLabelText(/^名字/), { key: 's', metaKey: true });
		await settle();
		expect(saves).toHaveLength(1);
	});

	it('打字打到一半按 Ctrl+S：先送出那個欄位，存的檔有剛打的字', async () => {
		const { saver, saves } = fakeSaver();
		setup(saver);
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const name = screen.getByLabelText('流程名字') as HTMLInputElement;
		// 瀏覽器在欄位失去焦點時送 change；jsdom 不會，這裡補上。
		name.addEventListener('blur', () => name.dispatchEvent(new Event('change', { bubbles: true })));
		name.focus();
		await fireEvent.input(name, { target: { value: '縣賽' } });
		await ctrlS(name);
		await settle();
		const r = readFlowFile(saves[0]);
		expect(r.kind === 'ok' && r.flow.name).toBe('縣賽');
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('打字打到一半按存檔按鈕（iPad 點按鈕不一定會讓輸入框失去焦點）：一樣先送出那個欄位', async () => {
		const { saver, saves } = fakeSaver();
		setup(saver);
		await openFile(writeFlowFile(sampleFlow(), {}));
		const name = screen.getByLabelText('站位名稱') as HTMLInputElement;
		name.addEventListener('blur', () => name.dispatchEvent(new Event('change', { bubbles: true })));
		name.focus();
		await fireEvent.input(name, { target: { value: '開場' } });
		await fireEvent.click(screen.getByRole('button', { name: '存檔' }));
		await settle();
		const r = readFlowFile(saves[0]);
		expect(r.kind === 'ok' && r.flow.formations[0].name).toBe('開場');
	});

	it('音樂檔還在解碼時關掉段設定、新增別段：解碼完不會放進新的那段，也不會弄丟新段', async () => {
		let finish: ((a: { durationSec: number; peaks: number[] }) => void) | undefined;
		const decode = () => new Promise<{ durationSec: number; peaks: number[] }>((r) => (finish = r));
		const { saver, saves } = fakeSaver();
		render(Page, { createEngine: () => createFakeEngine(), createSaver: () => saver, decode });
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		const file = new File([new Uint8Array([1])], '主歌.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(screen.getByLabelText('載入音樂檔'), { target: { files: [file] } });
		await vi.waitFor(() => expect(finish).toBeDefined());
		await fireEvent.click(within(screen.getByRole('dialog', { name: /設定/ })).getByRole('button', { name: '關閉' }));
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		finish!({ durationSec: 30, peaks: [] });
		await settle();
		await ctrlS();
		await settle();
		const r = readFlowFile(saves[0]);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.segments).toHaveLength(2);
		expect(r.flow.segments[1]).toMatchObject({ audioId: null });
	});

	it('音樂檔還在解碼時開了別的流程檔：解碼完不會放進新流程', async () => {
		let finish: ((a: { durationSec: number; peaks: number[] }) => void) | undefined;
		const decode = () => new Promise<{ durationSec: number; peaks: number[] }>((r) => (finish = r));
		const { saver, saves } = fakeSaver();
		render(Page, { createEngine: () => createFakeEngine(), createSaver: () => saver, decode });
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		const file = new File([new Uint8Array([1])], '別首.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(screen.getByLabelText('載入音樂檔'), { target: { files: [file] } });
		await vi.waitFor(() => expect(finish).toBeDefined());
		const pendingDecode = finish!;
		await fireEvent.click(within(screen.getByRole('dialog', { name: /設定/ })).getByRole('button', { name: '關閉' }));
		await openFile(writeFlowFile(sampleFlow(), {}), '開啟');
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		pendingDecode({ durationSec: 30, peaks: [] });
		await settle();
		await ctrlS();
		await settle();
		const r = readFlowFile(saves.at(-1)!);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.name).toBe('練習用');
		expect(r.flow.audio.map((a) => a.name)).toEqual(['主歌.mp3']);
	});

	it('按「存檔」也可以；存了就沒有未存的修改，改了又有', async () => {
		setup();
		await newFlow();
		expect(hasUnsavedChanges()).toBe(true);
		expect(screen.getByText('未存')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '存檔' }));
		await settle();
		expect(hasUnsavedChanges()).toBe(false);
		expect(screen.queryByText('未存')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋口號段' }));
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('在存檔對話框按取消：還是未存', async () => {
		setup(fakeSaver('cancelled').saver);
		await newFlow();
		await ctrlS();
		await settle();
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('Safari、Firefox 下載新檔時，寫一行說明', async () => {
		setup(fakeSaver('downloaded').saver);
		await newFlow();
		await ctrlS();
		await settle();
		expect(screen.getByRole('status').textContent).toContain('這個瀏覽器不能存回原檔');
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('iPad 交給分享選單：算存好了，不寫說明', async () => {
		setup(fakeSaver('shared').saver);
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '存檔' }));
		await settle();
		expect(hasUnsavedChanges()).toBe(false);
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('音樂資料也存進去', async () => {
		const { saver, saves } = fakeSaver();
		setup(saver);
		await openFile(writeFlowFile(sampleFlow(), { a1: new Uint8Array([7, 7, 7]) }));
		await ctrlS();
		await settle();
		const r = readFlowFile(saves[0]);
		expect(r.kind === 'ok' && r.audio).toEqual({ a1: new Uint8Array([7, 7, 7]) });
	});
});

describe('開檔', () => {
	it('首頁可以選流程檔打開；打開後沒有未存的修改', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) }));
		expect(screen.getByText('練習用')).toBeTruthy();
		expect(document.querySelector('[data-lane="m1"] [data-action-id]')).toBeTruthy();
		expect(screen.queryByText(/找不到音樂/)).toBeNull();
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('編輯中也可以從上方列開別的檔；沒有未存的修改就不問', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) }));
		const other = flowOf(createFlow({ name: '另一支', field: { strips: 9, layout: 'vertical' } }));
		await openFile(writeFlowFile(other, {}), '開啟');
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByText('另一支')).toBeTruthy();
	});

	it('有未存的修改時開別的檔先問；取消就留在原本的流程，確定才打開', async () => {
		setup();
		await newFlow();
		const file = writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) });
		await openFile(file, '開啟');
		expect(screen.getByRole('alertdialog').textContent).toContain('「全國賽」還沒存');
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByText('全國賽')).toBeTruthy();

		await openFile(file, '開啟');
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		await settle();
		expect(screen.getByText('練習用')).toBeTruthy();
	});
});

describe('新建', () => {
	it('上方列「新建」：沒有未存的修改就直接回到新建流程', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) }));
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		await newFlow();
		expect(screen.getByText('全國賽')).toBeTruthy();
		expect(screen.getByText('已選 0 人')).toBeTruthy();
	});

	it('有未存的修改先問；取消就留著，確定才回到新建流程', async () => {
		setup();
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		expect(screen.getByRole('alertdialog').textContent).toContain('「全國賽」還沒存');
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(screen.getByText('全國賽')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});

	it('開別的檔：選到的人和動作都清掉（另一支流程的 m1 是另一個人）', async () => {
		setup();
		const file = writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) });
		await openFile(file);
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id]')!);
		expect(screen.getByText('已選 1 人：小A')).toBeTruthy();
		await openFile(file, '開啟');
		expect(screen.getByText('已選 0 人')).toBeTruthy();
		expect(document.querySelector('.bar.selected')).toBeNull();
	});

	it('比編輯器新的檔不打開，提示重新整理', async () => {
		setup();
		await openFile(zipSync({ 'flow.json': strToU8(JSON.stringify({ formatVersion: 99, flow: {} })) }));
		expect(screen.getByRole('alert').textContent).toContain('請重新整理，更新編輯器');
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});

	it('開第 6 版的檔：音樂段沒標拍的環節和它的記號拿掉、組號補成第 1 組，存出來是第 8 版（組是組 id）', async () => {
		const { saver, saves } = fakeSaver();
		setup(saver);
		const flow = JSON.parse(JSON.stringify(flowOf(addPhase(sampleFlow(), 'x1', { kind: 'load', name: '', beats: { at: 0, len: 4 } }))));
		const action = flow.actions[0];
		action.successRate.phases.push({ id: 'p2', kind: 'dismount', name: '' });
		action.members[0].squad = 3;
		action.successRate.records = [
			{ id: 't1', date: '2026-11-04', who: 3, practice: 'drill', whole: true, marks: { p1: '✓', p2: '✗' } },
			{ id: 't2', date: '2026-11-04', who: 3, practice: 'drill', whole: false, marks: { p2: '✓' } }
		];
		delete flow.lastIds.g;
		await openFile(zipSync({ 'flow.json': strToU8(JSON.stringify({ formatVersion: 6, flow })) }));
		expect(screen.getByText('練習用')).toBeTruthy();
		await ctrlS();
		await settle();
		const json = JSON.parse(new TextDecoder().decode(unzipSync(saves[0])['flow.json']));
		expect(json.formatVersion).toBe(8);
		const saved = json.flow.actions[0];
		expect(saved.successRate.phases.map((p: { id: string }) => p.id)).toEqual(['p1']);
		expect(saved.successRate.records).toEqual([
			{ id: 't1', date: '2026-11-04', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } }
		]);
		expect(saved.members[0].squad).toBe('g1');
	});

	it('第 7 版的檔裡音樂段的環節沒標拍：提示「這不是流程檔」，留在首頁', async () => {
		setup();
		const flow = JSON.parse(JSON.stringify(flowOf(addPhase(sampleFlow(), 'x1', { kind: 'load', name: '', beats: { at: 0, len: 4 } }))));
		delete flow.actions[0].successRate.phases[0].beats;
		await openFile(zipSync({ 'flow.json': strToU8(JSON.stringify({ formatVersion: 7, flow })) }));
		expect(screen.getByRole('alert').textContent).toContain('這不是流程檔');
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});

	it('flow.json 壞掉（例：flow 只有名字）：提示「這不是流程檔」，留在首頁', async () => {
		setup();
		await openFile(zipSync({ 'flow.json': strToU8(JSON.stringify({ formatVersion: 1, flow: { name: '壞' } })) }));
		expect(screen.getByRole('alert').textContent).toContain('這不是流程檔');
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});

	it('開檔清空復原紀錄', async () => {
		setup();
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋口號段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect((screen.getByRole('button', { name: '復原' }) as HTMLButtonElement).disabled).toBe(false);
		await openFile(writeFlowFile(sampleFlow(), {}), '開啟');
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		expect(screen.getByText('練習用')).toBeTruthy();
		expect((screen.getByRole('button', { name: '復原' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('選音樂檔後復原再重做：解碼過的音樂還在，照樣能播', async () => {
		const engine = createFakeEngine();
		let getBuffer: (id: string) => AudioBuffer | undefined = () => undefined;
		const buffer = {} as AudioBuffer;
		render(Page, {
			createEngine: (get) => ((getBuffer = get), engine),
			createSaver: () => fakeSaver().saver,
			decode: async () => ({ durationSec: 30, peaks: [], buffer })
		});
		await openFile(writeFlowFile(sampleFlow(), {}));
		await fireEvent.click(screen.getByRole('button', { name: /音樂 1/ }));
		const file = new File([new Uint8Array([1, 2])], '主歌.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(screen.getByLabelText('載入音樂檔'), { target: { files: [file] } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(screen.getByRole('button', { name: /音樂 1/ }).textContent).toContain('找不到音樂');
		await fireEvent.click(screen.getByRole('button', { name: '重做' }));
		expect(screen.getByRole('button', { name: /音樂 1/ }).textContent).not.toContain('找不到音樂');
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.clips).toHaveLength(1);
		expect(getBuffer(engine.clips[0].audioId)).toStrictEqual(buffer);
	});

	it('缺音樂檔照開：那段標紅「找不到音樂」，點開重新選檔就好了；動作和站位都還在', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), {}));
		const seg = screen.getByRole('button', { name: /音樂 1/ });
		expect(seg.textContent).toContain('找不到音樂');
		expect(seg.classList.contains('missing')).toBe(true);
		expect(document.querySelector('[data-lane="m1"] [data-action-id]')).toBeTruthy();
		await fireEvent.click(seg);
		expect(screen.getByRole('dialog').textContent).toContain('找不到音樂');
		const file = new File([new Uint8Array([1, 2])], '主歌.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(screen.getByLabelText('載入音樂檔'), { target: { files: [file] } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(screen.getByRole('button', { name: /音樂 1/ }).textContent).not.toContain('找不到音樂');
		expect(document.querySelector('[data-lane="m1"] [data-action-id]')).toBeTruthy();
	});
});
