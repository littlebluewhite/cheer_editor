// 照情境演的假殼本身（#lib/scenario-shell.js）：網頁問、殼主動說都照情境；說錯了測試會紅。
import { describe, expect, it } from 'vitest';
import { playScenario, type Scenario } from '#lib/scenario-shell.js';

const ping: Scenario = {
	name: 'ping',
	boot: { shellVersion: '1', shellBuild: 1, features: ['ping'] },
	steps: [
		{ from: 'web', name: 'ping', body: { n: 1 }, reply: 'pong' },
		{ from: 'shell', name: 'knocked', body: { times: 2 } }
	]
};

describe('照情境演的假殼', () => {
	it('網頁問一句回情境寫的；殼主動說的送給在聽的人', async () => {
		const fake = playScenario(ping);
		const heard: unknown[] = [];
		fake.bridge.on('knocked', (body) => heard.push(body));
		expect(await fake.bridge.send('ping', { n: 1 })).toBe('pong');
		fake.say();
		expect(heard).toEqual([{ times: 2 }]);
		fake.done();
	});

	it('不聽了就收不到', async () => {
		const fake = playScenario(ping);
		const heard: unknown[] = [];
		const stop = fake.bridge.on('knocked', (body) => heard.push(body));
		await fake.bridge.send('ping', { n: 1 });
		stop();
		fake.say();
		expect(heard).toEqual([]);
	});

	it('網頁說了情境沒有的話：那一句 reject，done 也不過', async () => {
		const fake = playScenario(ping);
		await expect(fake.bridge.send('other')).rejects.toThrow();
		expect(() => fake.done()).toThrow();
	});

	it('網頁說對了話、帶的東西不對（被接住了）：done 也不過', async () => {
		const fake = playScenario(ping);
		await fake.bridge.send('ping', { n: 2 }).catch(() => {});
		fake.say();
		expect(() => fake.done()).toThrow();
	});

	it('還輪不到殼說話就 say：丟錯', () => {
		expect(() => playScenario(ping).say()).toThrow('不是殼說的');
	});

	it('情境的話沒說完：done 不過', () => {
		expect(() => playScenario(ping).done()).toThrow();
	});
});
