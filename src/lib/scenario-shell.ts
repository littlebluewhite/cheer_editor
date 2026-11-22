// 照共用情境檔演的假殼（#375）：情境在 repo 根目錄 bridge-scenarios/，殼的測試（ios/ShellCore）跑同一份。
// 只給測試用，頁面不 import。用法：
//   const fake = scenarioShell('ready.json', '網頁畫面出來以後跟殼說好了');
//   window.__cheerShell = fake.bridge;   // 或 fakeHost({ shell: appShell(fake.bridge) })
//   …讓網頁做事…
//   fake.done();                         // 情境裡網頁該說的話都說了
import { expect } from 'vitest';
import type { ShellBoot, ShellBridge } from '#lib/app-shell.js';

export interface ScenarioStep {
	from: 'web' | 'shell';
	name: string;
	body?: unknown;
	reply?: unknown;
	error?: string;
}
export interface Scenario {
	name: string;
	boot: ShellBoot;
	steps: ScenarioStep[];
}

const files = import.meta.glob<{ scenarios: Scenario[] }>('/bridge-scenarios/current/*.json', {
	eager: true,
	import: 'default'
});

/** 情境檔（bridge-scenarios/current/ 底下的檔名）裡叫 name 的那個情境。 */
export function scenario(file: string, name: string): Scenario {
	const found = files[`/bridge-scenarios/current/${file}`]?.scenarios.find((s) => s.name === name);
	if (!found) throw new Error(`情境檔沒有這個情境：${file}「${name}」`);
	return found;
}

/**
 * 照情境演的殼：一開始塞情境的 boot；網頁說的每一句要照情境的順序、內容一樣，回情境寫的 reply 或 error。
 * 說錯、說多了，那一句的 Promise 會 reject，done() 也會失敗。
 */
export function scenarioShell(file: string, name: string) {
	const { boot, steps } = scenario(file, name);
	let next = 0;
	const problems: string[] = [];
	const bridge: ShellBridge = {
		boot,
		async send(name, body) {
			const step = steps[next];
			if (!step || step.from !== 'web' || step.name !== name) {
				problems.push(`網頁說了「${name}」，情境下一句是 ${step ? `${step.from}「${step.name}」` : '（沒有了）'}`);
				throw new Error('情境沒有這句');
			}
			next++;
			expect(body ?? null, `網頁說「${name}」帶的東西`).toEqual(step.body ?? null);
			if (step.error !== undefined) throw new Error(step.error);
			return step.reply ?? null;
		},
		on: () => () => {}
	};
	return {
		bridge,
		/** 情境裡的話都說完了，也沒說錯。 */
		done() {
			expect(problems).toEqual([]);
			expect(steps.slice(next).map((s) => `${s.from}「${s.name}」`), '還沒說的話').toEqual([]);
		}
	};
}
