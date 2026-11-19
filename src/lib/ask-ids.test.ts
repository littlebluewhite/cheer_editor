// 問教練送的每一步帶一個亂數的步驟 id：新東西的 id 由它算出來（ADR 0014）。要問、回答後再送還是同一步、同一個步驟 id。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordAttempt, runCommands, type Command, type Flow } from '#lib/core';
import { Ask } from './ask.svelte';
import { flowOf, ratedSample } from './test-flows';

/** ratedSample 的 x1 記一次：刪 x1 要確認。 */
const recorded = () =>
	flowOf(
		recordAttempt(ratedSample(), 'x1', { date: '2026-11-04', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } })
	);

function asker(flow: Flow) {
	const state = { flow };
	const ask = new Ask((f) => (state.flow = f), { flow: () => state.flow });
	return { ask, state };
}

const addMusic: Command<'addSegment'> = { name: 'addSegment', args: ['music'] };

afterEach(() => vi.restoreAllMocks());

describe('送的每一步帶步驟 id', () => {
	it('新東西的 id 是亂數；每一步的不一樣', () => {
		const { ask, state } = asker(recorded());
		ask.send(addMusic);
		ask.send(addMusic);
		const ids = state.flow.segments.slice(-2).map((s) => s.id);
		for (const id of ids) expect(id).toMatch(/^s[a-z0-9]{12}$/);
		expect(ids[0]).not.toBe(ids[1]);
	});

	it('要問、回答後再送：還是同一步，新東西的 id 跟同一個步驟 id 跑一次一樣', () => {
		// 第一次發的步驟 id 是 0123456789ab，之後每發一次都不一樣（1234…、2345…）。
		let calls = 0;
		vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
			const k = calls++;
			(array as Uint8Array).forEach((_, i, a) => (a[i] = i + k));
			return array;
		});
		const flow = recorded();
		const { ask, state } = asker(flow);
		const step: Command[] = [addMusic, { name: 'deleteAction', args: ['x1'] }];
		ask.send(step);
		expect(ask.question).not.toBeNull();
		ask.answer('confirm');
		const expected = runCommands(flow, [addMusic, { ...step[1], options: { confirmed: true } }], '0123456789ab');
		expect(expected.kind === 'ok' && expected.flow).toEqual(state.flow);
	});
});
