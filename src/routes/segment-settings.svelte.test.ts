// 段設定（#153）：波形畫整個音樂檔、八拍數和長度好算、同一個檔沿用 BPM、延遲校正好輸入。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { addSegment, createFlow, loadSegmentAudio, updateSegment, type Flow } from '#lib/core';
import type { DecodedAudio } from '#lib/audio/decode.js';
import { flowOf } from '#lib/test-flows.js';
import { editorPage } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const oneMusic = () =>
	flowOf(addSegment(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })), 'music'));

/** 編輯頁開著 flow；音樂檔解碼出來都是 durationSec 秒。a1：流程裡的 a1 已經解碼好（跟開檔一樣）。 */
async function open(flow: Flow, durationSec: number, a1 = false) {
	const decode = async (): Promise<DecodedAudio> => ({ durationSec, peaks: Array(durationSec * 10).fill(0.5) });
	const page = editorPage(flow, { decode });
	if (a1) page.editor.switchMusic(await page.editor.readMusic({ a1: new Uint8Array(8) }));
	render(Page, page.props);
	return page;
}

const settings = async (label: string) => {
	await fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
	return within(screen.getByRole('dialog', { name: `${label} 設定` }));
};

const field = (dialog: ReturnType<typeof within>, label: string) => dialog.getByLabelText(label) as HTMLInputElement;

describe('段設定的音樂檔', () => {
	it('第一次載入 30 秒的音樂（150 BPM）：八拍數自動照長度算好，算一步', async () => {
		const { session } = await open(oneMusic(), 30);
		const dialog = await settings('音樂 1');
		const file = new File([new Uint8Array([1])], '主歌.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(dialog.getByLabelText('載入音樂檔'), { target: { files: [file] } });
		// 30 × 150 ÷ 60 = 75 拍 = 10 個八拍，最後一個 3 拍
		await vi.waitFor(() => expect(field(dialog, '八拍數').value).toBe('10'));
		expect(field(dialog, '最後一個八拍有幾拍').value).toBe('3');
		expect(dialog.queryByRole('note')).toBeNull();
		session.undo();
		expect(session.flow!.segments[0]).toMatchObject({ audioId: null, halfBeats: 128 });
	});

	it('載入音樂後檔案欄位清空：復原後再選同一個檔，瀏覽器照樣會通知', async () => {
		await open(oneMusic(), 30);
		const dialog = await settings('音樂 1');
		const input = dialog.getByLabelText('載入音樂檔') as HTMLInputElement;
		// jsdom 的檔案欄位 value 一直是空的：換成記得設過什麼的假 value
		let value = 'C:\\fakepath\\主歌.mp3';
		Object.defineProperty(input, 'value', { configurable: true, get: () => value, set: (v: string) => (value = v) });
		const file = new File([new Uint8Array([1])], '主歌.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(input, { target: { files: [file] } });
		expect(value).toBe('');
	});

	it('第二段選同一個檔：BPM 跟第一段一樣，第一拍接在第一段後面', async () => {
		let flow = flowOf(loadSegmentAudio(oneMusic(), 's1', '歌.mp3'));
		flow = flowOf(updateSegment(flow, 's1', { bpm: 120, eights: 4 }));
		flow = flowOf(addSegment(flow, 'music'));
		await open(flow, 90, true);
		const dialog = await settings('音樂 2');
		await fireEvent.change(dialog.getByLabelText('用已載入的音樂'), { target: { value: 'a1' } });
		expect(field(dialog, 'BPM').value).toBe('120');
		// 120 BPM、4 個八拍 = 16 秒
		expect(field(dialog, '第一拍（秒）').value).toBe('16');
	});

	it('兩段用同一個檔又重疊：警告會重播哪一截', async () => {
		let flow = flowOf(loadSegmentAudio(oneMusic(), 's1', '歌.mp3'));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(updateSegment(flow, 's2', { audioId: 'a1' }));
		await open(flow, 90, true);
		const dialog = await settings('音樂 1');
		expect(dialog.queryByRole('note')).toBeNull();
		// 8 → 10 個八拍：音樂 1 用到 0 到 32 秒，音樂 2 從 25.6 秒起
		await fireEvent.change(field(dialog, '八拍數'), { target: { value: '10' } });
		expect(dialog.getByRole('note').textContent).toContain('跟音樂 2 用同一個音樂檔，有 6.4 秒重疊');
	});
});

describe('段設定的長度', () => {
	it('照音樂長度算出零頭後，自己改八拍數：最後一個八拍回到 8 拍', async () => {
		await open(flowOf(loadSegmentAudio(oneMusic(), 's1', '歌.mp3')), 30, true);
		const dialog = await settings('音樂 1');
		await fireEvent.click(dialog.getByRole('button', { name: '照音樂長度算' }));
		expect(field(dialog, '最後一個八拍有幾拍').value).toBe('3');
		await fireEvent.change(field(dialog, '八拍數'), { target: { value: '4' } });
		expect(field(dialog, '八拍數').value).toBe('4');
		expect(field(dialog, '最後一個八拍有幾拍').value).toBe('8');
	});
});

describe('段設定的波形', () => {
	it('波形畫整個音樂檔：點在第一拍前面，第一拍往前移', async () => {
		let flow = flowOf(loadSegmentAudio(oneMusic(), 's1', '歌.mp3'));
		// 第一拍 3 秒，段長 25.6 秒：用到 3 到 28.6 秒
		flow = flowOf(updateSegment(flow, 's1', { firstBeatSec: 3 }));
		await open(flow, 30, true);
		const dialog = await settings('音樂 1');
		const wave = dialog.getByRole('img', { name: '波形' });
		expect(wave.getAttribute('viewBox')).toBe('0 0 30 2');
		// 波形 300 px 寬 = 整個 30 秒的檔：1 px = 0.1 秒
		vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 100));
		await fireEvent.click(wave, { clientX: 20 });
		expect(field(dialog, '第一拍（秒）').value).toBe('2');
	});
});

describe('延遲校正', () => {
	it('打 5000 按 Enter：夾到 1000，提示範圍；欄位旁看得到「毫秒」', async () => {
		await open(oneMusic(), 30);
		const input = screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement;
		expect(input.closest('label')!.textContent).toContain('毫秒');
		input.value = '5000';
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(input.value).toBe('1000');
		expect(screen.getByRole('status').textContent).toBe('延遲校正要在 -1000 到 1000 毫秒之間，改成 1000');
		localStorage.clear();
	});
});
