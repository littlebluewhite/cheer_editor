// 鎖定畫面的播放鍵（#389）：照情境檔 bridge-scenarios/current/nowPlaying.json 演的假殼，殼的測試跑同一份。
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { addSegment, createFlow, type Flow } from '#lib/core';
import { appShell } from '#lib/app-shell.js';
import { lockScreen } from '#lib/lock-screen.svelte.js';
import { playScenario, scenarioShell } from '#lib/scenario-shell.js';
import { cloudEditor, flush, manualFrames, testEditor } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';

function sample(): Flow {
	return flowOf(addSegment(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })), 'music'));
}

function setup(fake: ReturnType<typeof playScenario>) {
	const { editor, session } = testEditor(sample(), { nextFrame: manualFrames().nextFrame });
	const stop = lockScreen(editor, appShell(fake.bridge));
	return { playback: editor.playback, session, stop };
}

describe('鎖定畫面的播放鍵', () => {
	it('鎖定畫面按暫停真的停，按播放接著播；每次都跟殼說現在播什麼', () => {
		const fake = scenarioShell('nowPlaying.json', '鎖定畫面按暫停、再按播放');
		const { playback, stop } = setup(fake);
		playback.play();
		flushSync();
		fake.say();
		expect(playback.playing).toBe(false);
		flushSync();
		fake.say();
		expect(playback.playing).toBe(true);
		flushSync();
		fake.done();
		stop();
	});

	it('回首頁：收掉鎖定畫面', () => {
		const fake = scenarioShell('nowPlaying.json', '回首頁收掉鎖定畫面');
		const { playback, session, stop } = setup(fake);
		playback.play();
		flushSync();
		session.open(null);
		flushSync();
		fake.done();
		stop();
	});

	it('還沒播過：不跟殼說（打開流程不會在鎖定畫面多一個播放鍵）', () => {
		const fake = playScenario({
			name: '殼會 nowPlaying、網頁什麼都沒說',
			boot: { shellVersion: '0.1.0', shellBuild: 1, features: ['nowPlaying'] },
			steps: []
		});
		const { playback, stop } = setup(fake);
		flushSync();
		playback.seek(3);
		flushSync();
		fake.done();
		stop();
	});

	it('舊殼不會 nowPlaying：播放時什麼都不說', () => {
		const fake = scenarioShell('shell.json', '一開始塞殼的版本、建置號、會什麼');
		const { playback, stop } = setup(fake);
		playback.play();
		flushSync();
		fake.done();
		stop();
	});
});

describe('切到背景時雲端流程斷線（#381）', () => {
	it('斷線不停音樂', async () => {
		const t = await cloudEditor({}, { nextFrame: manualFrames().nextFrame });
		t.editor.playback.play();
		expect(t.editor.playback.playing).toBe(true);
		t.disconnect();
		await flush();
		expect(t.editor.file.cloud?.offline).toBe(true);
		expect(t.editor.playback.playing).toBe(true);
	});
});
