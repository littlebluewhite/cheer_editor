// App 裡的喇叭和延遲（#388）：網頁認不出現在用哪個喇叭、也收不到換喇叭的通知，所以殼讀了告訴網頁：
// 一開始塞（boot 的 speaker），換喇叭時說 speakerChanged，三樣一起給：哪個喇叭、系統說的延遲、這個喇叭的延遲校正。
// 延遲校正每個喇叭各記一個，存在殼（speakerLatency，帶喇叭的 id），不用小設定的 cheer-editor:latencyMs。
// 藍牙喇叭、耳機斷線時 speakerChanged 帶 stop，播放停下來。說的話寫在 bridge-scenarios/current/speaker.json（殼那邊是 SpeakerPart）。
// App 一開始（useShellIfInApp）就建、就聽：在使用說明那頁換喇叭，回到編輯頁也是新的。

import type { Host, Shell } from '#lib/host.js';
import type { ShellBoot } from '#lib/app-shell.js';
import type { Speaker } from '#lib/speaker.svelte.js';

/** 「問殼」can() 的名字：殼會讀喇叭和系統說的延遲。 */
export const SPEAKER_FEATURE = 'speaker';

/** 殼說的喇叭：id 是殼認喇叭的編號（網頁不拆，改延遲校正時帶回去）。 */
export interface ShellSpeaker {
	id: string;
	name: string;
	systemLatencyMs: number;
	latencyMs: number;
}

declare module '#lib/app-shell.js' {
	interface ShellBoot {
		/** 一開始接的喇叭。殼會 speaker 才有。 */
		speaker?: ShellSpeaker;
		/** 開發版的 App 才有：顯示殼讀的和網頁讀的系統延遲。 */
		speakerDebug?: boolean;
	}
}

/** 殼會 speaker 就換上殼的版本：一開始建好、一直聽換喇叭，每次給同一個。不會（舊殼）就照網頁版。 */
export function speakerFromShell(shell: Shell, boot: ShellBoot): Partial<Pick<Host, 'speaker'>> {
	if (!shell.can(SPEAKER_FEATURE) || !boot.speaker) return {};
	const speaker = shellSpeaker(shell, boot.speaker, boot.speakerDebug);
	return { speaker: () => speaker };
}

export function shellSpeaker(shell: Shell, first: ShellSpeaker, debug = false): Speaker {
	let now = $state(first);
	const stops = new Set<() => void>();
	shell.on('speakerChanged', (body) => {
		const { stop, ...next } = body as ShellSpeaker & { stop?: boolean };
		now = next;
		if (stop) for (const listener of stops) listener();
	});
	return {
		get name() {
			return now.name;
		},
		get systemLatencyMs() {
			return now.systemLatencyMs;
		},
		get latencyMs() {
			return now.latencyMs;
		},
		debug,
		setLatency(ms) {
			now = { ...now, latencyMs: ms };
			shell.send('speakerLatency', { id: now.id, ms }).catch(() => {});
		},
		onStop(listener) {
			stops.add(listener);
			return () => stops.delete(listener);
		}
	};
}
