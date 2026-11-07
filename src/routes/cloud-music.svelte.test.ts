// 頁面：雲端流程的音樂放雲端（#249）。選音樂檔先傳上去（超過 60 MB 先擋），再送那一步；打開雲端流程時把音樂拿下來，播得出來。
// 伺服器換成測試共用的假伺服器（fakeServer）：音樂檔放在它的記憶體裡（假的 R2）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { loadSegmentAudio, type MusicSegment } from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { DecodedAudio } from '#lib/audio/decode.js';
import { MAX_CLOUD_AUDIO_BYTES } from '#lib/music-library.svelte.js';
import { editorPage, fakeServer, flush } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: true, password: '我們這一隊今年一定會贏 go go' };

/** 登入、首頁「我的流程」有一支 c1（名字「測試」），點它打開。音樂檔解碼出來都是 30 秒，帶 buffer。 */
async function openCloud(flow = libSample(), audio: Record<string, Uint8Array> = {}) {
	const fake = fakeServer({
		users: [lin],
		signedIn: lin.email,
		flows: [{ id: 'c1', owner: lin.email, flow, updatedAt: new Date(2026, 10, 7).toISOString(), audio }]
	});
	const engine = createFakeEngine();
	let buffer: (id: string) => AudioBuffer | undefined = () => undefined;
	const decoded = new Map<number, AudioBuffer>();
	const decode = async (bytes: ArrayBuffer): Promise<DecodedAudio> => {
		const first = new Uint8Array(bytes)[0];
		if (!decoded.has(first)) decoded.set(first, { first } as unknown as AudioBuffer);
		return { durationSec: 30, peaks: [], buffer: decoded.get(first) };
	};
	const page = editorPage(null, { server: fake.server, decode, createEngine: (get) => ((buffer = get), engine) });
	render(Page, page.props);
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
	return { ...fake, page, engine, played: () => engine.clips.map((c) => buffer(c.audioId)) };
}

/** 點「音樂 1」開段設定，選一個音樂檔。 */
async function pick(file: File) {
	await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
	const dialog = within(screen.getByRole('dialog', { name: '音樂 1 設定' }));
	await fireEvent.change(dialog.getByLabelText('載入音樂檔'), { target: { files: [file] } });
	await flush();
	return dialog;
}

const mp3 = (first = 7, name = '主歌.mp3') => new File([new Uint8Array([first, 2, 3])], name, { type: 'audio/mpeg' });

describe('雲端流程的音樂', () => {
	it('選超過 60 MB 的檔：擋下並說「音樂檔太大，請轉成 mp3」，沒傳、流程沒改', async () => {
		const s = await openCloud();
		const big = mp3();
		Object.defineProperty(big, 'size', { value: MAX_CLOUD_AUDIO_BYTES + 1 });
		const dialog = await pick(big);

		expect(dialog.getByRole('alert').textContent).toContain('音樂檔太大，請轉成 mp3');
		expect(s.state.flows[0].audio).toEqual({});
		expect(s.page.session.flow!.audio).toEqual([]);
		expect(s.state.flows[0].step ?? 0).toBe(0);
	});

	it('放音樂：先傳上去再存那一步，播得出來；重新打開從雲端拿下來也播得出來', async () => {
		const s = await openCloud();
		await pick(mp3(7));

		const audioId = (s.page.session.flow!.segments[0] as MusicSegment).audioId!;
		expect(audioId).toMatch(/^a[a-z0-9]{12}$/);
		expect(s.state.flows[0].audio?.[audioId]).toEqual(new Uint8Array([7, 2, 3]));
		expect(s.state.flows[0].flow.audio.map((a) => a.id)).toEqual([audioId]);

		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(s.played()).toEqual([{ first: 7 }]);
	});

	it('打開有音樂的雲端流程：音樂從雲端拿下來，播得出來', async () => {
		const flow = flowOf(loadSegmentAudio(libSample(), 's1', '主歌.mp3'));
		const s = await openCloud(flow, { a1: new Uint8Array([5, 1]) });

		expect(screen.getByRole('button', { name: /^音樂 1/ }).textContent).not.toContain('找不到音樂');
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(s.played()).toEqual([{ first: 5 }]);
	});

	it('雲端上沒有那個音樂檔：照樣打開，那段標「找不到音樂」', async () => {
		const flow = flowOf(loadSegmentAudio(libSample(), 's1', '主歌.mp3'));
		await openCloud(flow);
		expect(screen.getByRole('button', { name: /^音樂 1/ }).textContent).toContain('找不到音樂');
	});

	it('伺服器查到太大（傳上去才知道）：擋下同一句，流程沒改', async () => {
		const s = await openCloud();
		s.state.audioTooBig = true;
		const dialog = await pick(mp3());
		expect(dialog.getByRole('alert').textContent).toContain('音樂檔太大，請轉成 mp3');
		expect(s.page.session.flow!.audio).toEqual([]);
		expect(s.state.flows[0].audio).toEqual({});
	});

	it('連不上伺服器：沒傳上去，說原因，流程沒改', async () => {
		const s = await openCloud();
		s.state.unreachable = true;
		const dialog = await pick(mp3());
		expect(dialog.getByRole('alert').textContent).toContain('連不上伺服器，音樂檔沒傳上去');
		expect(s.page.session.flow!.audio).toEqual([]);
	});
});
