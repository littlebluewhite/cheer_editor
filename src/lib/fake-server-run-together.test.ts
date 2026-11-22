// 假伺服器的一起記全上（#352）：叫流程核心的 runTogether，跟真的伺服器一樣斷線 1 分鐘當他離開、被收回請出表。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomMessage } from '#lib/api-types/RoomMessage.js';
import { fakeServer, type FakeCloudFlow } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false };
const RUN = 'rwang0000001x';
const flow = (): FakeCloudFlow => ({ id: 'c1', owner: wang.email, flow: libSample(), updatedAt: '2026-11-22T01:00:00Z', people: { [lin.email]: 'recorder' } });

/** 房間的回答都是下一個 microtask 才送（假時鐘不撥 microtask）。 */
const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
/** 聽到的最後一則 runThroughs 裡的每組：[組, 名字, 點過沒, 斷線了沒]。 */
function holders(heard: RoomMessage[]) {
	const last = heard.filter((m) => m.kind === 'runThroughs').at(-1);
	return last?.kind === 'runThroughs' ? last.runs.flatMap((r) => r.keys.map((k) => [k.key, k.name, k.touched, k.away])) : null;
}
function people(heard: RoomMessage[]) {
	const last = heard.filter((m) => m.kind === 'runThroughs').at(-1);
	return last?.kind === 'runThroughs' ? last.runs.flatMap((r) => r.people.map((p) => p.name)) : null;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 10, 22, 1));
});
afterEach(() => vi.useRealTimers());

async function wangOpensLinJoins() {
	const s = fakeServer({ users: [lin, wang], flows: [flow()] });
	const coach = s.joinAs('c1', wang.email);
	const phone = s.joinAs('c1', lin.email);
	await settle();
	coach.room.send({ kind: 'runThrough', id: RUN, date: '2026-11-22', startedAt: Date.now(), keys: ['n:1'], touched: ['n:1'], joining: false });
	await settle();
	phone.room.send({ kind: 'runThrough', id: RUN, date: '2026-11-22', startedAt: Date.now(), keys: [], touched: [], joining: true });
	await settle();
	return { s, coach, phone };
}

describe('假伺服器：一起記全上斷線 1 分鐘', () => {
	it('斷線寫斷線了、點過的拿不走；超過 1 分鐘當他離開，再說一次，點過的也能接手', async () => {
		const { s, phone } = await wangOpensLinJoins();
		s.disconnect(wang.email);
		await settle();
		expect(holders(phone.heard)).toEqual([['n:1', '王教練', true, true]]);
		expect(people(phone.heard)).toEqual(['王教練', '林教練']);

		vi.advanceTimersByTime(50_000);
		phone.room.send({ kind: 'claim', run: RUN, key: 'n:1', from: 2 });
		await settle();
		expect(phone.heard.at(-1)).toEqual({ kind: 'claimRefused', run: RUN, key: 'n:1', by: '王教練', touched: true });

		vi.advanceTimersByTime(11_000);
		await settle();
		expect(people(phone.heard)).toEqual(['林教練']);
		phone.room.send({ kind: 'claim', run: RUN, key: 'n:1', from: 2 });
		await settle();
		expect(holders(phone.heard)).toEqual([['n:1', '林教練', false, false]]);
	});

	it('被降成檢視者：請出表，拿著的組放掉，別人看到的跟著變', async () => {
		const { s, coach, phone } = await wangOpensLinJoins();
		phone.room.send({ kind: 'claim', run: RUN, key: 'n:2', from: null });
		await settle();
		expect(holders(coach.heard)).toEqual([['n:1', '王教練', true, false], ['n:2', '林教練', false, false]]);
		s.changeRole('c1', lin.email, 'viewer');
		await settle();
		expect(holders(coach.heard)).toEqual([['n:1', '王教練', true, false]]);
		expect(people(coach.heard)).toEqual(['王教練']);
	});

	it('表沒變不告訴大家（拿自己拿著的）', async () => {
		const { coach, phone } = await wangOpensLinJoins();
		const told = phone.heard.length;
		coach.room.send({ kind: 'claim', run: RUN, key: 'n:1', from: null });
		await settle();
		expect(phone.heard.length).toBe(told);
	});

	it('這支流程沒有連著的房間了，表就沒了：再連上加入不了', async () => {
		const { s } = await wangOpensLinJoins();
		s.disconnect(wang.email);
		s.disconnect(lin.email);
		const tablet = s.joinAs('c1', lin.email);
		await settle();
		tablet.room.send({ kind: 'runThrough', id: RUN, date: '2026-11-22', startedAt: Date.now(), keys: [], touched: [], joining: true });
		await settle();
		expect(tablet.heard.at(-1)).toEqual({ kind: 'runClosed', run: RUN });
	});
});
