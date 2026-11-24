// 喇叭和延遲（#388）：App 裡播放頭扣「系統說的延遲＋這個喇叭的延遲校正」，換喇叭馬上換，藍牙斷線就停。
// 殼用照情境檔演的假殼（bridge-scenarios/current/speaker.json），殼的測試跑同一份。網頁版照舊只扣延遲校正。
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { addSegment, createFlow, positionWhy, type Flow } from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import { useShellIfInApp } from '#lib/app-shell.js';
import { playScenario, scenario, scenarioShell } from '#lib/scenario-shell.js';
import { whyText } from '#lib/reason-text.js';
import { editorPage, flush, manualFrames, testEditor } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import Page from '../routes/+page.svelte';

afterEach(() => {
	cleanup();
	delete window.__cheerShell;
	localStorage.clear();
});

/** 音樂 1（150 BPM、8 個八拍 = 25.6 秒）。 */
function sample(): Flow {
	return flowOf(addSegment(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })), 'music'));
}

/** 照情境換上殼（跟 App 一開始一樣），再建編輯器。這個測試跑完換回網頁版。 */
function inApp(fake: ReturnType<typeof playScenario>) {
	window.__cheerShell = fake.bridge;
	const undo = useShellIfInApp();
	onTestFinished(() => undo?.());
	return setup();
}

function setup() {
	const engine = createFakeEngine();
	const frames = manualFrames();
	const { editor, session } = testEditor(sample(), { createEngine: () => engine, nextFrame: frames.nextFrame });
	const { playback } = editor;
	onTestFinished(playback.followSpeaker());
	/** 喇叭播到第一拍後 sec 秒時，上方列寫的播放頭位置。 */
	const positionAt = (sec: number) => {
		engine.audible = engine.clicks[0].when + sec;
		frames.step();
		return whyText(positionWhy(session.flow!, playback.sec));
	};
	return { playback, positionAt };
}

const SPEAKER = 'speaker.json';
const SWITCH = '換喇叭：每個喇叭各記一個延遲校正，換回來還是那個值';

describe('App 裡的喇叭和延遲', () => {
	it('播放頭扣「系統說的延遲＋延遲校正」：系統說 10、延遲校正 190，跟網頁版延遲校正 200 一樣', async () => {
		const base = scenario(SPEAKER, SWITCH);
		const fake = playScenario({
			...base,
			steps: [{ from: 'web', name: 'speakerLatency', body: { id: 'Speaker|built-in', ms: 190 }, reply: null }]
		});
		const { playback, positionAt } = inApp(fake);
		playback.setLatency(190);
		await flush();
		playback.play();
		expect(positionAt(8.4)).toBe('音樂 1 3-5&');
		fake.done();
	});

	it('換喇叭（播放中也算）：喇叭的名字、延遲校正馬上換；改的記到那個喇叭，換回來還是那個值；不碰小設定', async () => {
		const fake = scenarioShell(SPEAKER, SWITCH);
		const { playback } = inApp(fake);
		expect(playback.speakerName).toBe('iPhone 喇叭');
		expect(playback.latencyMs).toBe(0);
		playback.play();
		playback.setLatency(100);
		await flush();
		fake.say();
		expect(playback.speakerName).toBe('練習場喇叭');
		expect(playback.latencyMs).toBe(0);
		expect(playback.setLatency(1001)).toBe(false);
		fake.say();
		expect(playback.speakerName).toBe('iPhone 喇叭');
		expect(playback.latencyMs).toBe(100);
		expect(playback.playing).toBe(true);
		expect(localStorage.getItem('cheer-editor:latencyMs')).toBeNull();
		fake.done();
	});

	it('系統說 2000 毫秒（AirPlay）照扣，不會變 0；延遲校正還是 0', () => {
		const base = scenario(SPEAKER, SWITCH);
		const fake = playScenario({
			...base,
			boot: { ...base.boot, speaker: { id: 'AirPlay|tv', name: '客廳', systemLatencyMs: 2000, latencyMs: 0 } },
			steps: []
		});
		const { playback, positionAt } = inApp(fake);
		playback.play();
		expect(positionAt(10.2)).toBe('音樂 1 3-5&');
		expect(playback.latencyMs).toBe(0);
		fake.done();
	});

	it('藍牙斷線：播放停下來（接上藍牙那次不停）', () => {
		const fake = scenarioShell(SPEAKER, '藍牙斷線就停');
		const { playback } = inApp(fake);
		playback.play();
		fake.say();
		expect(playback.playing).toBe(true);
		fake.say();
		expect(playback.playing).toBe(false);
		fake.done();
	});
});

describe('網頁版、還不會 speaker 的舊殼', () => {
	it('照現在：只扣延遲校正，存在小設定，沒有喇叭的名字', () => {
		const { playback, positionAt } = setup();
		expect(playback.speakerName).toBeNull();
		playback.setLatency(200);
		expect(localStorage.getItem('cheer-editor:latencyMs')).toBe('200');
		playback.play();
		expect(positionAt(8.4)).toBe('音樂 1 3-5&');
	});
});

describe('App 裡「⋯」小窗的延遲校正', () => {
	it('寫出現在是哪個喇叭、提示講五件事、不寫系統說的毫秒數；換喇叭馬上換名字和數字', async () => {
		const fake = scenarioShell(SPEAKER, SWITCH);
		window.__cheerShell = fake.bridge;
		const undo = useShellIfInApp();
		onTestFinished(() => undo?.());
		render(Page, editorPage(sample(), { createEngine: createFakeEngine }).props);
		await fireEvent.click(screen.getByRole('button', { name: '更多播放選項' }));
		const field = () => screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement;
		const hint = () => screen.getByText(/自動扣掉/).textContent!;
		expect(hint()).toBe(
			'現在接的是「iPhone 喇叭」，這個喇叭的延遲已經自動扣掉了。內建喇叭、有線耳機放 0 就好；藍牙喇叭、耳機：畫面比聲音快就調大，每次加 10。每個喇叭各記一個，存在這台裝置，不進流程檔。'
		);
		await fireEvent.change(field(), { target: { value: '100' } });
		await flush();
		fake.say();
		await tick();
		expect(hint()).toContain('「練習場喇叭」');
		expect(hint()).not.toContain('112');
		expect(field().value).toBe('0');
		fake.say();
		await tick();
		expect(hint()).toContain('「iPhone 喇叭」');
		expect(field().value).toBe('100');
		fake.done();
	});

	it('開發版多一個小框：殼讀的和網頁讀的系統延遲；上架版沒有', async () => {
		vi.stubGlobal('AudioContext', class { outputLatency = 0.031; });
		onTestFinished(() => void vi.unstubAllGlobals());
		const base = scenario(SPEAKER, SWITCH);
		for (const debug of [true, false]) {
			window.__cheerShell = playScenario({ ...base, boot: { ...base.boot, speakerDebug: debug }, steps: [] }).bridge;
			const undo = useShellIfInApp();
			render(Page, editorPage(sample(), { createEngine: createFakeEngine }).props);
			await fireEvent.click(screen.getByRole('button', { name: '更多播放選項' }));
			const box = screen.queryByText(/系統延遲/);
			expect(box?.textContent?.trim() ?? null).toBe(debug ? '系統延遲：殼 10 ms／網頁 31 ms' : null);
			cleanup();
			undo?.();
		}
	});
});
