// 段設定（#153）：波形畫整個音樂檔、八拍數和長度好算、同一個檔沿用 BPM、延遲校正好輸入。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { addSegment, createFlow, loadSegmentAudio, recordAttempt, updateSegment, type Flow } from '#lib/core';
import type { DecodedAudio } from '#lib/audio/decode.js';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import { editorPage } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const oneMusic = () =>
	flowOf(addSegment(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })), 'music'));

/** 編輯頁開著 flow；音樂檔解碼出來都是 durationSec 秒。a1：流程裡的 a1 已經解碼好（跟開檔一樣）。 */
async function open(flow: Flow, durationSec: number, a1 = false, engine = createFakeEngine()) {
	const decode = async (): Promise<DecodedAudio> => ({ durationSec, peaks: Array(durationSec * 10).fill(0.5) });
	const page = editorPage(flow, { decode, createEngine: () => engine });
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

describe('從播放頭切段（#167）', () => {
	it('播放頭在 5-3 按「從播放頭這個八拍切成兩段」：多一段，各 4 個八拍', async () => {
		const { editor, session } = await open(oneMusic(), 30);
		// 150 BPM：5-3 = 34 拍 × 0.4 秒
		editor.playback.seek(13.6);
		const dialog = await settings('音樂 1');
		await fireEvent.click(dialog.getByRole('button', { name: '從播放頭這個八拍切成兩段' }));
		expect(session.flow!.segments.map((s) => s.kind === 'music' && s.halfBeats)).toEqual([64, 64]);
		expect(field(dialog, '八拍數').value).toBe('4');
		expect(screen.getByRole('button', { name: /^音樂 2/ })).toBeTruthy();
	});
});

describe('延遲校正', () => {
	it('打 5000 按 Enter：夾到 1000，提示範圍；欄位旁看得到「毫秒」', async () => {
		await open(oneMusic(), 30);
		await fireEvent.click(screen.getByRole('button', { name: '更多播放選項' }));
		const input = screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement;
		expect(input.closest('label')!.textContent).toContain('毫秒');
		input.value = '5000';
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(input.value).toBe('1000');
		expect(screen.getByRole('status').textContent).toBe('延遲校正要在 -1000 到 1000 毫秒之間，改成 1000');
		localStorage.clear();
	});
});

describe('段設定的拿掉音樂、重算八拍數、測速範圍（#230）', () => {
	it('拿掉音樂：段還在、沒有音樂檔，播放只響節拍器；⌘Z 音樂回來', async () => {
		const engine = createFakeEngine();
		const { session } = await open(flowOf(loadSegmentAudio(oneMusic(), 's1', '歌.mp3')), 30, true, engine);
		const dialog = await settings('音樂 1');
		await fireEvent.click(dialog.getByRole('button', { name: '拿掉音樂' }));
		expect(session.flow!.segments).toHaveLength(1);
		expect(session.flow!.segments[0]).toMatchObject({ kind: 'music', audioId: null, halfBeats: 128 });
		expect(dialog.getByText('還沒載入')).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: '關閉' }));
		expect(screen.getByRole('button', { name: /^音樂 1/ })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.clicks.length).toBeGreaterThan(0);
		expect(engine.clips).toEqual([]);
		await fireEvent.click(screen.getByRole('button', { name: '暫停' }));

		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(session.flow!.segments[0]).toMatchObject({ audioId: 'a1' });
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.clips.map((c) => c.audioId)).toEqual(['a1']);
	});

	it('改了 BPM，旁邊才出現「照音樂長度重算八拍數」；改 BPM 本身不動八拍數', async () => {
		await open(flowOf(loadSegmentAudio(oneMusic(), 's1', '歌.mp3')), 30, true);
		const dialog = await settings('音樂 1');
		expect(dialog.queryByRole('button', { name: '照音樂長度重算八拍數' })).toBeNull();
		await fireEvent.change(field(dialog, 'BPM'), { target: { value: '120' } });
		expect(field(dialog, '八拍數').value).toBe('8');
		await fireEvent.click(dialog.getByRole('button', { name: '照音樂長度重算八拍數' }));
		// 30 秒 × 120 ÷ 60 = 60 拍 = 7 個滿的八拍 + 4 拍
		expect(field(dialog, '八拍數').value).toBe('8');
		expect(field(dialog, '最後一個八拍有幾拍').value).toBe('4');
	});

	it('段設定開著時從時間軸點另一段：「照音樂長度重算八拍數」照新的那段的 BPM 判斷，沒改 BPM 就不出現', async () => {
		let flow = flowOf(loadSegmentAudio(oneMusic(), 's1', '歌.mp3'));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(updateSegment(flow, 's2', { audioId: 'a1', bpm: 120 }));
		await open(flow, 90, true);
		const first = await settings('音樂 1');
		expect(first.queryByRole('button', { name: '照音樂長度重算八拍數' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /^音樂 2/, hidden: true }));
		const second = within(screen.getByRole('dialog', { name: '音樂 2 設定' }));
		expect(field(second, 'BPM').value).toBe('120');
		expect(second.queryByRole('button', { name: '照音樂長度重算八拍數' })).toBeNull();
	});

	it('重算讓段變短：動作裁短到段尾，有紀錄會不見就先問，按確定才改', async () => {
		// libSample 的音樂 1 換成 3 秒的歌；Lib 1-1 到 1-8，第 1 組練過一次記了下法（1-7 到 1-8）
		let flow = flowOf(loadSegmentAudio(libSample(), 's1', '歌.mp3'));
		const lib = flow.actions[0];
		const dismount = lib.successRate!.phases[2].id;
		flow = flowOf(
			recordAttempt(flow, 'x1', { date: '2026-11-04', who: lib.members[0].squad!, practice: 'drill', whole: true, marks: { [dismount]: '✓' } })
		);
		const { session } = await open(flow, 3, true);
		const dialog = await settings('音樂 1');
		await fireEvent.change(field(dialog, 'BPM'), { target: { value: '120' } });
		const before = session.flow;
		await fireEvent.click(dialog.getByRole('button', { name: '照音樂長度重算八拍數' }));
		// 3 秒 × 120 ÷ 60 = 6 拍：Lib 裁短到 1-6，下法刪掉、紀錄不見
		const confirm = within(screen.getByRole('alertdialog'));
		expect(confirm.getByText(/縮短後/).textContent).toContain('會一起清掉 1 次紀錄（清掉的紀錄按「復原」會回來）');
		expect(confirm.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
			'裁短：動作「技巧·Lib」（1-1 起）8 拍 → 6 拍，會刪掉 1 個環節（清掉 1 次的記號）'
		]);
		expect(session.flow).toBe(before);
		await fireEvent.click(confirm.getByRole('button', { name: '確定刪除' }));
		expect(session.flow!.actions[0].length).toBe(12);
		expect(session.flow!.actions[0].successRate!.records).toEqual([]);
		expect(field(dialog, '八拍數').value).toBe('1');
	});

	it('敲擊測速超出 BPM 範圍：「套用」按不下去，說為什麼，BPM 不變', async () => {
		const { session } = await open(oneMusic(), 30);
		const dialog = await settings('音樂 1');
		const tap = dialog.getByRole('button', { name: '敲擊測速' });
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			// 0.3 秒一下 = 200 BPM，超過 170
			for (let i = 0; i < 8; i++) {
				vi.setSystemTime(10_000 + i * 300);
				await fireEvent.click(tap);
			}
		} finally {
			vi.useRealTimers();
		}
		const apply = dialog.getByRole('button', { name: /^套用/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
		expect(dialog.getByText(/約 200 BPM/).textContent).toContain('超出 60–170，不能套用');
		await fireEvent.click(apply);
		expect(session.flow!.segments[0]).toMatchObject({ bpm: 150 });
	});
});
