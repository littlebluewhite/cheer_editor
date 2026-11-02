import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import {
	addSegment,
	createFlow,
	loadSegmentAudio,
	updateSegment,
	type CommandResult,
	type Flow,
	type MusicSegment
} from '#lib/core';
import type { DecodedAudio, LoadedAudio } from '#lib/audio/decode.js';
import SegmentSettings from './SegmentSettings.svelte';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

function musicFlow(): Flow {
	const flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	return flowOf(addSegment(flow, 'music'));
}

const loaded = (durationSec: number): LoadedAudio => ({
	bytes: new ArrayBuffer(8),
	durationSec,
	peaks: [0.2, 0.8, 0.5]
});

function setup(flow: Flow, audios: Record<string, LoadedAudio> = {}, segmentId = 's1') {
	const onchange = vi.fn<(flow: Flow) => void>();
	const onaudioload = vi.fn<(audioId: string, audio: LoadedAudio) => void>();
	const decode = vi.fn<(bytes: ArrayBuffer) => Promise<DecodedAudio>>(async () => ({
		durationSec: 95.2,
		peaks: [0.1, 0.4]
	}));
	// 假的「螢幕座標換波形秒數」：1 px = 0.05 秒
	const waveXToSec = (e: MouseEvent) => e.clientX * 0.05;
	render(SegmentSettings, {
		flow,
		segmentId,
		audios,
		onchange,
		onaudioload,
		onpreview: () => {},
		onclose: () => {},
		decode,
		waveXToSec
	});
	return { onchange, onaudioload, decode };
}

const lastSegment = (fn: { mock: { calls: [Flow][] } }) =>
	fn.mock.calls.at(-1)![0].segments[0] as MusicSegment;

describe('音樂段設定', () => {
	it('點波形，把第一拍放在點的地方', async () => {
		const { onchange } = setup(musicFlow());
		await fireEvent.click(screen.getByRole('img', { name: '波形' }), { clientX: 28 });
		expect(lastSegment(onchange).firstBeatSec).toBeCloseTo(1.4, 9);
	});

	it('也可以直接打第一拍的秒數', async () => {
		const { onchange } = setup(musicFlow());
		await fireEvent.change(screen.getByLabelText('第一拍（秒）'), { target: { value: '0.42' } });
		expect(lastSegment(onchange).firstBeatSec).toBe(0.42);
	});

	it('照音樂長度算：算出幾個八拍、最後一個八拍幾拍', async () => {
		let flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		flow = flowOf(updateSegment(flow, 's1', { firstBeatSec: 0.4 }));
		const { onchange } = setup(flow, { a1: loaded(30.5) });
		await fireEvent.click(screen.getByRole('button', { name: '照音樂長度算' }));
		// (30.5 − 0.4) × 150 ÷ 60 = 75 拍 = 10 個八拍，最後一個 3 拍 = 150 個半拍
		expect(lastSegment(onchange).halfBeats).toBe(150);
	});

	it('還沒載入音樂就按照音樂長度算，提醒先載入', async () => {
		const { onchange } = setup(musicFlow());
		await fireEvent.click(screen.getByRole('button', { name: '照音樂長度算' }));
		expect(onchange).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toBe('先載入音樂檔');
	});

	it('八拍數和最後一個八拍可以自己改', async () => {
		const { onchange } = setup(musicFlow());
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: '12' } });
		expect(lastSegment(onchange).halfBeats).toBe(12 * 16);
	});

	it('BPM 超出 60–170 時顯示流程核心的原因', async () => {
		const { onchange } = setup(musicFlow());
		await fireEvent.change(screen.getByLabelText('BPM'), { target: { value: '200' } });
		expect(onchange).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toBe('BPM 要在 60–170 之間');
	});

	it('載入音樂檔：解碼後流程記一筆音樂檔，位元組另外交給呼叫端', async () => {
		const { onchange, onaudioload, decode } = setup(musicFlow());
		const file = new File([new Uint8Array([1, 2, 3])], '主歌.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(screen.getByLabelText('載入音樂檔'), { target: { files: [file] } });
		await vi.waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(decode).toHaveBeenCalledOnce();
		expect(onchange.mock.calls[0][0].audio).toEqual([
			{ id: 'a1', file: 'audio/a1.mp3', name: '主歌.mp3' }
		]);
		expect(onaudioload).toHaveBeenCalledWith('a1', {
			bytes: expect.any(ArrayBuffer),
			durationSec: 95.2,
			peaks: [0.1, 0.4]
		});
	});

	it('第二個音樂段可以選用已經載入的音樂檔（變速切段）', async () => {
		let flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '歌.mp3'));
		flow = flowOf(addSegment(flow, 'music'));
		const { onchange } = setup(flow, { a1: loaded(30) }, 's2');
		await fireEvent.change(screen.getByLabelText('用已載入的音樂'), { target: { value: 'a1' } });
		expect(onchange.mock.calls[0][0].segments[1]).toMatchObject({ audioId: 'a1' });
	});
});

describe('口號段設定', () => {
	it('長度用秒設，最細 0.1 秒', async () => {
		const flow = flowOf(addSegment(musicFlow(), 'chant'));
		const { onchange } = setup(flow, {}, 's2');
		await fireEvent.change(screen.getByLabelText('長度（秒）'), { target: { value: '31.5' } });
		expect(onchange.mock.calls[0][0].segments[1]).toEqual({ id: 's2', kind: 'chant', tenths: 315 });
	});
});
