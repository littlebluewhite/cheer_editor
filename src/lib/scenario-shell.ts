// 照共用情境檔演的假殼（#375）：情境在 repo 根目錄 bridge-scenarios/，殼的測試（ios/ShellCore）跑同一份。
// 只給測試用，頁面不 import。用法：
//   const fake = scenarioShell('ready.json', '網頁畫面出來以後跟殼說好了');
//   window.__cheerShell = fake.bridge;   // 或 fakeHost({ shell: appShell(fake.bridge) })
//   …讓網頁做事…
//   fake.say();                          // 情境下一句是殼主動說的：送給網頁
//   fake.done();                         // 情境裡的話都說了
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

/** 情境檔裡叫 name 的那個情境，演成假殼（playScenario）。 */
export function scenarioShell(file: string, name: string) {
	return playScenario(scenario(file, name));
}

/**
 * 照情境演的殼：一開始塞情境的 boot；網頁說的每一句要照情境的順序、內容一樣，回情境寫的 reply 或 error。
 * 情境下一句是殼主動說的（from: shell），測試叫 say() 把它送給網頁用 on() 聽的人。
 * 說錯、說多了，那一句的 Promise 會 reject，done() 也會失敗。
 */
export function playScenario({ boot, steps }: Scenario) {
	let next = 0;
	const problems: string[] = [];
	const listeners = new Map<string, Set<(body: unknown) => void>>();
	const describe = (step: ScenarioStep | undefined) => (step ? `${step.from}「${step.name}」` : '（沒有了）');
	const bridge: ShellBridge = {
		boot,
		async send(name, body) {
			const step = steps[next];
			if (!step || step.from !== 'web' || step.name !== name) {
				problems.push(`網頁說了「${name}」，情境下一句是 ${describe(step)}`);
				throw new Error('情境沒有這句');
			}
			next++;
			// 帶的東西不對也記下來：網頁接住了 reject，done() 照樣不過
			try {
				expect(body ?? null, `網頁說「${name}」帶的東西`).toEqual(step.body ?? null);
			} catch (e) {
				problems.push(`網頁說「${name}」帶的東西不對：${(e as Error).message}`);
				throw e;
			}
			if (step.error !== undefined) throw new Error(step.error);
			return step.reply ?? null;
		},
		on(name, listener) {
			if (!listeners.has(name)) listeners.set(name, new Set());
			listeners.get(name)!.add(listener);
			return () => void listeners.get(name)?.delete(listener);
		}
	};
	return {
		bridge,
		/** 殼主動說情境的下一句（要是 from: shell）。 */
		say() {
			const step = steps[next];
			if (!step || step.from !== 'shell') throw new Error(`情境下一句不是殼說的：${describe(step)}`);
			next++;
			for (const listener of [...(listeners.get(step.name) ?? [])]) listener(step.body ?? null);
		},
		/** 情境裡的話都說完了，也沒說錯。 */
		done() {
			expect(problems).toEqual([]);
			expect(steps.slice(next).map(describe), '還沒說的話').toEqual([]);
		}
	};
}

