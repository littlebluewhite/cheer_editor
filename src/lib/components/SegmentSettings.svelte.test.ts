import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	loadSegmentAudio,
	updateSegment,
	type Flow,
	type MusicSegment
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { PEAKS_PER_SEC, type DecodedAudio } from '#lib/audio/decode.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import { flush, testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import SegmentSettings from './SegmentSettings.svelte';

function musicFlow(): Flow {
	const flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	return flowOf(addSegment(flow, 'music'));
}

const loaded = (durationSec: number): DecodedAudio => ({ durationSec, peaks: [0.2, 0.8, 0.5] });

/**
 * 放一個帶著 flow 的編輯器 module 進 context，畫段設定。
 * a1：音樂檔庫裡已經有的 a1（跟開檔一樣解碼好；'broken' 是解不開）。載入音樂檔時的假解碼是 95.2 秒。
 */
async function setup(flow: Flow, a1?: DecodedAudio | 'broken', segmentId = 's1') {
	const decode = vi.fn<(bytes: ArrayBuffer) => Promise<DecodedAudio>>(async () => ({
		durationSec: 95.2,
		peaks: [0.1, 0.4]
	}));
	const { editor, session } = testEditor(flow, { decode });
	if (a1) {
		if (a1 === 'broken') decode.mockRejectedValueOnce(new Error('壞檔'));
		else decode.mockResolvedValueOnce(a1);
		editor.switchMusic(await editor.readMusic({ a1: new Uint8Array(8) }));
		decode.mockClear();
	}
	// 假的「螢幕座標換波形秒數」：1 px = 0.05 秒
	const waveXToSec = (e: MouseEvent) => e.clientX * 0.05;
	const onclose = vi.fn();
	const props = { segmentId, onpreview: () => {}, onclose, waveXToSec };
	const { unmount } = render(TestSession, { props: { editor, component: SegmentSettings, props } });
	return { editor, session, decode, onclose, unmount };
}

const lastSegment = (session: EditorSession) => session.flow!.segments[0] as MusicSegment;

describe('音樂段設定', () => {
	it('點波形，把第一拍放在點的地方', async () => {
		const { session } = await setup(musicFlow());
		await fireEvent.click(screen.getByRole('img', { name: '波形' }), { clientX: 28 });
		expect(lastSegment(session).firstBeatSec).toBeCloseTo(1.4, 9);
	});

	it('波形畫這一段從第一拍到段尾用到的那一截（不是固定前 20 秒）', async () => {
		let flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		// 第一拍 30 秒、120 BPM、4 個八拍 = 16 秒：用到音樂檔的 30 到 46 秒
		flow = flowOf(updateSegment(flow, 's1', { firstBeatSec: 30, bpm: 120, eights: 4 }));
		// 60 秒的音樂，每格振幅照秒數編：第 n 秒那幾格都是 n / 100
		const peaks = Array.from({ length: 60 * PEAKS_PER_SEC }, (_, i) => Math.floor(i / PEAKS_PER_SEC) / 100);
		await setup(flow, { durationSec: 60, peaks });
		const wave = screen.getByRole('img', { name: '波形' });
		expect(wave.getAttribute('viewBox')).toBe('30 0 16 2');
		const columns = wave.querySelector('.peaks')!.getAttribute('d')!.split('M').slice(1);
		expect(columns).toHaveLength(16 * PEAKS_PER_SEC);
		// 第一格是第 30 秒（高 0.3：從 0.7 畫到 1.3）
		expect(columns[0]).toMatch(/^30 0\.7/);
		const beats = [...wave.querySelectorAll('line:not(.mid)')].map((l) => Number(l.getAttribute('x1')));
		expect(beats[0]).toBe(30);
		expect(beats).toHaveLength(32);
		expect(screen.getByText(/在波形上點一下/).textContent).not.toContain('前 20 秒');
	});

	it('也可以直接打第一拍的秒數', async () => {
		const { session } = await setup(musicFlow());
		await fireEvent.change(screen.getByLabelText('第一拍（秒）'), { target: { value: '0.42' } });
		expect(lastSegment(session).firstBeatSec).toBe(0.42);
	});

	it('照音樂長度算：算出幾個八拍、最後一個八拍幾拍', async () => {
		let flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		flow = flowOf(updateSegment(flow, 's1', { firstBeatSec: 0.4 }));
		const { session } = await setup(flow, loaded(30.5));
		await fireEvent.click(screen.getByRole('button', { name: '照音樂長度算' }));
		// (30.5 − 0.4) × 150 ÷ 60 = 75 拍 = 10 個八拍，最後一個 3 拍 = 150 個半拍
		expect(lastSegment(session).halfBeats).toBe(150);
	});

	it('第一拍打在音樂結束之後：擋下來，說音樂只有幾秒', async () => {
		const flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		const { session } = await setup(flow, loaded(90));
		await fireEvent.change(screen.getByLabelText('第一拍（秒）'), { target: { value: '100' } });
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('「第一拍（秒）」退回原本的值：第一拍要在音樂結束（90.0 秒）之前');
	});

	it('點波形點到音樂結束之後：一樣擋下來', async () => {
		const flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		const { session } = await setup(flow, loaded(5));
		await fireEvent.click(screen.getByRole('img', { name: '波形' }), { clientX: 120 });
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('第一拍要在音樂結束（5.0 秒）之前');
	});

	it('第一拍已經在音樂結束之後（換了短的檔）：照音樂長度算不給 0.5 秒，說原因', async () => {
		let flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		flow = flowOf(updateSegment(flow, 's1', { firstBeatSec: 40 }));
		const { session } = await setup(flow, loaded(30));
		await fireEvent.click(screen.getByRole('button', { name: '照音樂長度算' }));
		expect(lastSegment(session).halfBeats).toBe(flow.segments[0].kind === 'music' ? flow.segments[0].halfBeats : -1);
		expect(screen.getByRole('alert').textContent).toBe('第一拍要在音樂結束（30.0 秒）之前');
	});

	it('第一拍離音樂結尾不到一拍：照音樂長度算說剩下不到一拍，長度不改', async () => {
		let flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		flow = flowOf(updateSegment(flow, 's1', { firstBeatSec: 29.9 }));
		const { session } = await setup(flow, loaded(30));
		await fireEvent.click(screen.getByRole('button', { name: '照音樂長度算' }));
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('第一拍之後剩下不到一拍');
	});

	it('段比音樂檔長時提醒（不擋）；照音樂長度算之後就不提醒', async () => {
		const flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		// 預設 150 BPM、8 個八拍 = 25.6 秒，音樂只有 20 秒
		await setup(flow, loaded(20));
		expect(screen.getByRole('note').textContent).toContain('這一段比音樂檔長 5.6 秒');
		await fireEvent.click(screen.getByRole('button', { name: '照音樂長度算' }));
		expect(screen.queryByRole('note')).toBeNull();
	});

	it('還沒載入音樂就按照音樂長度算，提醒先載入', async () => {
		const { session } = await setup(musicFlow());
		await fireEvent.click(screen.getByRole('button', { name: '照音樂長度算' }));
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('先載入音樂檔');
	});

	it('八拍數和最後一個八拍可以自己改', async () => {
		const { session } = await setup(musicFlow());
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: '12' } });
		expect(lastSegment(session).halfBeats).toBe(12 * 16);
	});

	it('BPM 超出 60 到 170 時顯示流程核心的原因', async () => {
		const { session } = await setup(musicFlow());
		await fireEvent.change(screen.getByLabelText('BPM'), { target: { value: '200' } });
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alert').textContent).toBe('「BPM」退回原本的值：BPM 要在 60 到 170 之間');
	});

	it('載入音樂檔：解碼後流程記一筆音樂檔，位元組放在音樂檔庫', async () => {
		const { editor, session, decode } = await setup(musicFlow());
		const file = new File([new Uint8Array([1, 2, 3])], '主歌.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(screen.getByLabelText('載入音樂檔'), { target: { files: [file] } });
		await vi.waitFor(() => expect(session.canUndo).toBe(true));
		expect(decode).toHaveBeenCalledOnce();
		expect(session.flow!.audio).toEqual([
			{ id: 'a1', file: 'audio/a1.mp3', name: '主歌.mp3' }
		]);
		expect(editor.music.get('a1')).toEqual({
			bytes: expect.any(ArrayBuffer),
			durationSec: 95.2,
			peaks: [0.1, 0.4]
		});
		expect(screen.getByRole('dialog').textContent).toContain('主歌.mp3（95.2 秒）');
	});

	it('音樂檔還在解碼時關掉段設定：解碼完不放進流程', async () => {
		let finish = (_: DecodedAudio) => {};
		const { session, decode, unmount } = await setup(musicFlow());
		decode.mockImplementationOnce(() => new Promise((r) => (finish = r)));
		const file = new File([new Uint8Array([1])], '主歌.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(screen.getByLabelText('載入音樂檔'), { target: { files: [file] } });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
		unmount();
		finish({ durationSec: 30, peaks: [] });
		await flush();
		expect(session.flow!.audio).toEqual([]);
		expect(session.canUndo).toBe(false);
	});

	it('找不到音樂（流程指到、手上沒有）：寫「找不到音樂，請重新選檔」', async () => {
		await setup(flowOf(loadSegmentAudio(musicFlow(), 's1', '主歌.mp3')));
		expect(screen.getByRole('dialog').textContent).toContain('主歌.mp3（找不到音樂，請重新選檔）');
	});

	it('音樂檔壞了（解不開）：說「音樂檔壞了，請重新選檔」，不拿長度 0 去提醒段比音樂長、去擋第一拍', async () => {
		const { session } = await setup(flowOf(loadSegmentAudio(musicFlow(), 's1', '主歌.mp3')), 'broken');
		expect(screen.getByRole('dialog').textContent).toContain('主歌.mp3（音樂檔壞了，請重新選檔）');
		expect(screen.queryByRole('note')).toBeNull();
		await fireEvent.change(screen.getByLabelText('第一拍（秒）'), { target: { value: '0.5' } });
		expect(screen.queryByRole('alert')).toBeNull();
		expect(lastSegment(session).firstBeatSec).toBe(0.5);
		await fireEvent.click(screen.getByRole('button', { name: '照音樂長度算' }));
		expect(screen.getByRole('alert').textContent).toBe('音樂檔壞了，請重新選檔');
	});

	it('第二個音樂段可以選用已經載入的音樂檔（變速切段）', async () => {
		let flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		flow = flowOf(addSegment(flow, 'music'));
		const { session } = await setup(flow, loaded(30), 's2');
		await fireEvent.change(screen.getByLabelText('用已載入的音樂'), { target: { value: 'a1' } });
		expect(session.flow!.segments[1]).toMatchObject({ audioId: 'a1' });
	});
});

describe('段縮短', () => {
	/** 音樂 1 有 8 個八拍；一個動作從 5-1 開始。 */
	function withLateAction(): Flow {
		let flow = flowOf(
			addMembers(musicFlow(), [{ name: '小A', gender: 'F', globalRole: 'top' }])
		);
		return flowOf(
			addAction(flow, {
				segmentId: 's1',
				category: 'jump',
				name: 'T',
				start: 64,
				length: 16,
				note: '',
				members: [{ memberId: 'm1', role: null }]
			})
		);
	}

	it('有東西會掉出段外時先列出清單，按確定才改', async () => {
		const { session } = await setup(withLateAction());
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: '4' } });
		expect(session.canUndo).toBe(false);
		expect(screen.getByRole('alertdialog').textContent).toContain('動作「跳躍·T」（5-1 起）');
		await fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
		const flow = session.flow!;
		expect(flow.segments[0]).toMatchObject({ halfBeats: 64 });
		expect(flow.actions).toEqual([]);
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});

	it('按取消就不改，欄位回到原本的值', async () => {
		const { session } = await setup(withLateAction());
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: '4' } });
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(session.canUndo).toBe(false);
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect((screen.getByLabelText('八拍數') as HTMLInputElement).value).toBe('8');
	});

	it('還沒按確定就改回原本的長度：舊的確認清單收掉，按不到「確定刪除」', async () => {
		const { session } = await setup(withLateAction());
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: '4' } });
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: '8' } });
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(session.flow!.actions).toHaveLength(1);
	});
});

describe('口號段設定', () => {
	it('長度用秒設，最細 0.1 秒', async () => {
		const flow = flowOf(addSegment(musicFlow(), 'chant'));
		const { session } = await setup(flow, undefined, 's2');
		await fireEvent.change(screen.getByLabelText('長度（秒）'), { target: { value: '31.5' } });
		expect(session.flow!.segments[1]).toEqual({ id: 's2', kind: 'chant', tenths: 315 });
	});
});

describe('刪段、調段順序', () => {
	/** 音樂 1（s1）→ 口號 1（s2）；口號 1 裡有一個動作。 */
	function twoSegments(): Flow {
		let flow = flowOf(addSegment(musicFlow(), 'chant'));
		flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'top' }]));
		return flowOf(
			addAction(flow, {
				segmentId: 's2',
				category: 'dance',
				name: '喊',
				start: 0,
				length: 10,
				note: '',
				members: [{ memberId: 'm1', role: null }]
			})
		);
	}

	it('往前移、往後移：第一段不能往前、最後一段不能往後', async () => {
		const { session } = await setup(twoSegments(), undefined, 's2');
		expect((screen.getByRole('button', { name: '往後移' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: '往前移' }));
		expect(session.flow!.segments.map((s) => s.id)).toEqual(['s2', 's1']);
		expect((screen.getByRole('button', { name: '往前移' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('刪這一段：有動作先問，確定才刪、關掉段設定；可以復原', async () => {
		const { session, onclose } = await setup(twoSegments(), undefined, 's2');
		await fireEvent.click(screen.getByRole('button', { name: '刪除這一段' }));
		expect(screen.getByRole('alertdialog').textContent).toContain('刪掉口號 1，下面這些也會一起刪掉');
		expect(session.flow!.segments).toHaveLength(2);
		await fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
		expect(session.flow!.segments.map((s) => s.id)).toEqual(['s1']);
		expect(onclose).toHaveBeenCalled();
		session.undo();
		expect(session.flow!.segments).toHaveLength(2);
	});
});
