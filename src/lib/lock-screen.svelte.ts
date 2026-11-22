// 鎖定畫面的播放鍵（#389，App 裡；情境 bridge-scenarios/current/nowPlaying.json）。
// 跟殼說現在播什麼：流程的名字、在不在播（第一次按播放才說；回首頁說 null，收掉）。只送名字，不送秒數：
// 重複、慢速、跳來跳去時鎖定畫面自己往下算的秒數會對不上。
// 鎖定畫面、耳機按了播放、暫停：殼說 remote，這裡叫播放的 play()、pause()（暫停不回起播點，按播放接著播）。
// 殼不會 nowPlaying（網頁版、舊殼）就什麼都不做。

import { host, type Shell } from '#lib/host.js';
import type { Editor } from '#lib/editor.svelte.js';

/** 接上鎖定畫面；回傳「拆掉」的函式。編輯頁一開始叫一次。 */
export function lockScreen(editor: Pick<Editor, 'session' | 'playback'>, shell: Shell = host().shell): () => void {
	if (!shell.can('nowPlaying')) return () => {};
	const { session, playback } = editor;
	const off = shell.on('remote', (body) => {
		const command = (body as { command?: unknown } | null)?.command;
		if (command === 'play' && !playback.playing) playback.play();
		else if (command === 'pause') playback.pause();
	});
	let shown = false;
	let said = 'null';
	const stopEffects = $effect.root(() => {
		$effect(() => {
			const flow = session.flow;
			const playing = playback.playing;
			if (!flow) shown = false;
			else if (playing) shown = true;
			const body = shown && flow ? { title: flow.name, playing } : null;
			const text = JSON.stringify(body);
			if (text === said) return;
			said = text;
			shell.send('nowPlaying', body).catch(() => {});
		});
	});
	return () => {
		off();
		stopEffects();
	};
}
