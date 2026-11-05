// 頁面：存檔、開檔、Ctrl+S、缺音樂的接線。存檔薄層換成假的 FileSaver（真的要手動在四家瀏覽器檢查）。
// 開檔、存檔、「沒存先問」的規則在編輯器 module 的流程檔測（src/lib/flow-file.test.ts）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createFlow, insertFormation, readFlowFile, writeFlowFile } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { FileSaver } from '#lib/file/save.js';
import { audioFlow, editorPage, fakeSaver, openFile, flush } from '#lib/test-fakes.js';
import { hasUnsavedChanges } from '#lib/unsaved.js';
import Page from './+page.svelte';

function setup(saver: FileSaver = fakeSaver().saver) {
	render(Page, editorPage(null, { createSaver: () => saver }).props);
}

async function newFlow() {
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

async function addChant() {
	await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
	await fireEvent.click(screen.getByRole('menuitem', { name: '＋口號段' }));
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
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
		await flush();
		expect(fileNames).toEqual(['全國賽.zip']);
		const r = readFlowFile(saves[0]);
		expect(r.kind === 'ok' && r.flow.name).toBe('全國賽');
	});

	it('焦點在輸入框裡也能 Ctrl+S（Mac 是 ⌘S）', async () => {
		const { saver, saves } = fakeSaver();
		setup(saver);
		await newFlow();
		await fireEvent.keyDown(screen.getByLabelText(/^名字/), { key: 's', metaKey: true });
		await flush();
		expect(saves).toHaveLength(1);
	});

	it('打字打到一半按 Ctrl+S：先送出那個欄位，存的檔有剛打的字', async () => {
		const { saver, saves } = fakeSaver();
		setup(saver);
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const name = screen.getByLabelText('流程名字') as HTMLInputElement;
		name.focus();
		await fireEvent.input(name, { target: { value: '縣賽' } });
		await ctrlS(name);
		await flush();
		const r = readFlowFile(saves[0]);
		expect(r.kind === 'ok' && r.flow.name).toBe('縣賽');
		expect(hasUnsavedChanges()).toBe(false);
		// 送出不靠讓欄位失去焦點：存完還在欄位裡
		expect(document.activeElement).toBe(name);
	});

	it('按「存檔」也可以；存了就沒有未存的修改，改了又有', async () => {
		setup();
		await newFlow();
		await addChant();
		expect(hasUnsavedChanges()).toBe(true);
		expect(screen.getByText('未存')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '存檔' }));
		await flush();
		expect(hasUnsavedChanges()).toBe(false);
		expect(screen.queryByText('未存')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: '＋口號段' }));
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('存好了：提示寫存到哪個檔', async () => {
		setup();
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '存檔' }));
		await flush();
		expect(screen.getByRole('status').textContent).toBe('已存到「全國賽.zip」');
	});

	it('有未存的修改時關分頁或重新整理，瀏覽器先問；沒有就不問', async () => {
		setup();
		await newFlow();
		const leave = () => {
			const e = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(e);
			return e.defaultPrevented;
		};
		expect(leave()).toBe(false);
		await addChant();
		expect(leave()).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: '存檔' }));
		await flush();
		expect(leave()).toBe(false);
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

	it('開好了：提示寫開的是哪個檔', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) }), '開啟流程檔', '縣賽 第二版.zip');
		expect(screen.getByRole('status').textContent).toBe('已開啟「縣賽 第二版.zip」');
	});

	it('瀏覽器能選檔（Chrome、Edge）：點「開啟流程檔」改用選檔視窗打開', async () => {
		const bytes = writeFlowFile(sampleFlow(), {});
		const file = new File([bytes as Uint8Array<ArrayBuffer>], '縣賽.zip', { type: 'application/zip' });
		const pickFlowFile = async () => ({ file, saver: fakeSaver().saver });
		render(Page, editorPage(null, { pickFlowFile }).props);
		await fireEvent.click(screen.getByLabelText('開啟流程檔'));
		await flush();
		expect(screen.getByText('練習用')).toBeTruthy();
	});

	it('編輯中也可以從上方列開別的檔；沒有未存的修改就不問', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) }));
		const other = flowOf(createFlow({ name: '另一支', field: { strips: 9, layout: 'vertical' } }));
		await openFile(writeFlowFile(other, {}), '開啟');
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByText('另一支')).toBeTruthy();
	});

	it('開了另一個流程檔：右邊欄捲回最上面', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) }));
		const panels = [...document.querySelectorAll('.panel')];
		// jsdom 不會捲：換成記得住的數字，看開檔後有沒有歸零
		for (const p of panels) Object.defineProperty(p, 'scrollTop', { value: 300, writable: true });
		const other = flowOf(createFlow({ name: '另一支', field: { strips: 9, layout: 'vertical' } }));
		await openFile(writeFlowFile(other, {}), '開啟');
		expect(screen.getByText('另一支')).toBeTruthy();
		expect(panels.map((p) => p.scrollTop)).toEqual([0, 0]);
	});

	it('有未存的修改時開別的檔先問；取消就留在原本的流程，確定才打開', async () => {
		setup();
		await newFlow();
		await addChant();
		const file = writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) });
		await openFile(file, '開啟');
		expect(screen.getByRole('alertdialog').textContent).toContain('「全國賽」還沒存');
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByText('全國賽')).toBeTruthy();

		await openFile(file, '開啟');
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		await flush();
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

	it('問「還沒存」時可以按「先存檔」：存好了才繼續', async () => {
		const { saver, fileNames } = fakeSaver();
		setup(saver);
		await newFlow();
		await addChant();
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		await fireEvent.click(screen.getByRole('button', { name: '先存檔' }));
		await flush();
		expect(fileNames).toEqual(['全國賽.zip']);
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});

	it('首頁開檔失敗：流程檔給的原因寫在首頁，留在首頁', async () => {
		setup();
		await openFile(zipSync({ 'flow.json': strToU8(JSON.stringify({ formatVersion: 99, flow: {} })) }));
		expect(screen.getByRole('alert').textContent).toBe('打不開「練習用.zip」：是新版編輯器存的，請重新整理，更新編輯器');
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});

	it('開到壞掉的 zip：寫「檔案壞掉了，或不是這個編輯器存的流程檔」', async () => {
		setup();
		await openFile(new TextEncoder().encode('PK 壞掉了'), '開啟流程檔', 'broken.zip');
		expect(screen.getByRole('alert').textContent).toBe('打不開「broken.zip」：檔案壞掉了，或不是這個編輯器存的流程檔');
	});

	it('開到音樂檔：提示音樂要在段設定裡載入', async () => {
		setup();
		await openFile(new TextEncoder().encode('RIFF....WAVE'), '開啟流程檔', '主歌.wav');
		expect(screen.getByRole('alert').textContent).toBe(
			'打不開「主歌.wav」：這是音樂檔，不是流程檔。先建好流程，再點段列上的段，在段設定按「載入音樂檔」'
		);
	});

	it('編輯中從上方列開到音樂檔：提示點段列上的段去載入', async () => {
		setup();
		await newFlow();
		await openFile(new TextEncoder().encode('ID3'), '開啟', '主歌.MP3');
		expect(screen.getByRole('status').textContent).toBe(
			'打不開「主歌.MP3」：這是音樂檔，不是流程檔。音樂要點段列上的段，在段設定按「載入音樂檔」'
		);
	});

	it('播放時音訊引擎從音樂檔庫拿解碼好的音樂', async () => {
		const engine = createFakeEngine();
		let getBuffer: (id: string) => AudioBuffer | undefined = () => undefined;
		const buffer = {} as AudioBuffer;
		const decode = async () => ({ durationSec: 30, peaks: [], buffer });
		render(Page, editorPage(null, { createEngine: (get) => ((getBuffer = get), engine), decode }).props);
		await openFile(writeFlowFile(sampleFlow(), { a1: new Uint8Array([1, 2]) }));
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.clips).toHaveLength(1);
		expect(getBuffer(engine.clips[0].audioId)).toStrictEqual(buffer);
	});

	it('開的檔缺音樂：時間軸那段標紅「找不到音樂」', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), {}));
		const seg = screen.getByRole('button', { name: /音樂 1/ });
		expect(seg.textContent).toContain('找不到音樂');
		expect(seg.classList.contains('missing')).toBe(true);
	});
});

describe('「還沒存」確認框是對話框', () => {
	/** 新建、改一下（加一段口號），焦點放在「新建」再按它：跳出「還沒存」。 */
	async function asking() {
		const page = editorPage(null, { createSaver: () => fakeSaver().saver });
		render(Page, page.props);
		await newFlow();
		await addChant();
		const button = screen.getByRole('button', { name: '新建' });
		button.focus();
		await fireEvent.click(button);
		return { session: page.session, button };
	}

	it('開著時按 ⌘Z、⌘⇧Z：底下的流程不動，還是「未存」', async () => {
		const { session } = await asking();
		const before = session.flow;
		expect(screen.getByRole('alertdialog').textContent).toContain('還沒存');
		expect(session.canUndo).toBe(true);
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'z', metaKey: true });
		expect(session.flow).toBe(before);
		expect(screen.getByText('未存')).toBeTruthy();
		// 重做也不動（關掉之後還能復原那一步）
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'z', metaKey: true, shiftKey: true });
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'y', ctrlKey: true });
		expect(session.flow).toBe(before);
		expect(session.canUndo).toBe(true);
	});

	it('一打開焦點就在「取消」上；對話框有 aria-modal，名字是問的問題', async () => {
		await asking();
		const dialog = screen.getByRole('dialog', { name: '「全國賽」還沒存，改的東西會不見。' });
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '取消' }));
	});

	it('按 Escape 等於取消：關掉，流程還在；焦點回到「新建」', async () => {
		const { session, button } = await asking();
		const before = session.flow;
		await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		await flush();
		expect(screen.queryByText(/還沒存/)).toBeNull();
		expect(session.flow).toBe(before);
		expect(document.activeElement).toBe(button);
	});
});

describe('有未存的修改時按「開啟」：先問再選檔', () => {
	it('選檔欄位（Safari、iPad、Firefox）：先問「要開別的流程檔」，按「取消」不跳選檔', async () => {
		setup();
		await newFlow();
		await addChant();
		const notPrevented = await fireEvent.click(screen.getByLabelText('開啟'));
		expect(notPrevented).toBe(false);
		const dialog = screen.getByRole('dialog', { name: /還沒存/ });
		expect(dialog.textContent).toContain('要開別的流程檔');
		await fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByText('全國賽')).toBeTruthy();
	});

	it('選檔視窗（Chrome、Edge）：「取消」不跳選檔視窗；「不存了，繼續」才選，選到的檔直接打開不再問', async () => {
		const bytes = writeFlowFile(sampleFlow(), {});
		const file = new File([bytes as Uint8Array<ArrayBuffer>], '縣賽.zip', { type: 'application/zip' });
		let picks = 0;
		const pickFlowFile = async () => (picks++, { file, saver: fakeSaver().saver });
		render(Page, editorPage(null, { pickFlowFile }).props);
		await newFlow();
		await addChant();
		await fireEvent.click(screen.getByLabelText('開啟'));
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(picks).toBe(0);

		await fireEvent.click(screen.getByLabelText('開啟'));
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		await flush();
		expect(picks).toBe(1);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByText('練習用')).toBeTruthy();
	});
});
