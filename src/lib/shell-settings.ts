// App 裡的小設定（#378）：不存在網頁的 localStorage（系統可能清掉），存在殼（App 自己的 Application Support）。
// 網頁建編輯器時就同步讀，所以殼在 document start 塞一份（boot 的 settings）；改了先改這份，再馬上寫回殼。
// 說的話寫在 bridge-scenarios/current/settings.json（殼那邊是 ios/ShellCore 的 SettingsPart）。網頁版照舊用 localStorage。

import type { SettingsStore, Shell } from '#lib/host.js';

/** 「問殼」can() 的名字：殼會存小設定。 */
export const SETTINGS_FEATURE = 'settings';

declare module '#lib/app-shell.js' {
	interface ShellBoot {
		/** 殼存著的小設定（key → 字串，key 跟網頁版 localStorage 的一樣）。殼會 settings 才有。 */
		settings?: Record<string, string>;
	}
}

export function shellSettings(shell: Shell, saved: Record<string, string> = {}): SettingsStore {
	const values = new Map(Object.entries(saved));
	return {
		get: (key) => values.get(key) ?? null,
		set(key, value) {
			values.set(key, value);
			shell.send('settingSet', { key, value }).catch(() => {});
		},
		remove(key) {
			values.delete(key);
			shell.send('settingRemove', { key }).catch(() => {});
		}
	};
}
