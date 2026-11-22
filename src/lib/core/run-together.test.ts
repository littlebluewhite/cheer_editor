// 一起記全上的表（#352、#353，ADR 0015、0020）：規則只在流程核心這裡，真的伺服器（server/src/run_together.rs）和假伺服器都叫它。時間用給的。
import { describe, expect, expectTypeOf, it } from 'vitest';
import { runTogether, runViews, type RunEvent, type RunsTogether, type RunTogetherView } from './index';
import { runTogetherJson, runViewsJson } from './bundle-entry';
import type { RunView } from '../api-types/RunView';

// 給能記的人看的一次全上跟伺服器的 RunView（src/lib/api-types/）各寫一次：兩邊不一樣時 npm run check 會錯。
expectTypeOf<RunTogetherView>().toEqualTypeOf<RunView>();

const RUN = 'rabc123def456';
const T0 = Date.UTC(2026, 10, 22, 9);
const sec = (n: number) => T0 + n * 1000;

const WANG = { userId: 1, conn: 11, name: '王教練' };
const LIN = { userId: 2, conn: 21, name: '林教練' };
const MEI = { userId: 3, conn: 31, name: '陳小美' };

function report(who: typeof WANG, keys: string[], touched: string[] = [], joining = false): RunEvent {
	return { kind: 'report', who, report: { id: RUN, date: '2026-11-22', startedAt: T0, keys, touched, joining } };
}
const claim = (who: typeof WANG, key: string, from: number | null): RunEvent => ({ kind: 'ask', who, run: RUN, ask: { kind: 'claim', key, from } });
const touch = (who: typeof WANG, key: string): RunEvent => ({ kind: 'ask', who, run: RUN, ask: { kind: 'touch', key } });
const release = (who: typeof WANG, key: string): RunEvent => ({ kind: 'ask', who, run: RUN, ask: { kind: 'release', key } });
const leave = (who: typeof WANG): RunEvent => ({ kind: 'ask', who, run: RUN, ask: { kind: 'leave' } });

/** 照順序做（每件事 [現在, 事]），回最後的表和最後一件的回答。 */
function play(steps: [number, RunEvent][], from: RunsTogether = []) {
	let last = { runs: from } as ReturnType<typeof runTogether>;
	for (const [now, event] of steps) last = runTogether(last.runs, event, now);
	return last;
}

/** 這次全上每組誰拿著：[組, 名字, 點過沒, 斷線了沒]（給 viewer 看的）。 */
function holders(runs: RunsTogether, now: number, viewer = 0) {
	return runViews(runs, viewer, now).flatMap((r) => r.keys.map((k) => [k.key, k.name, k.touched, k.away]));
}
/** 表裡的人的名字（還沒離開的）。 */
function people(runs: RunsTogether, now: number) {
	return runViews(runs, 0, now).flatMap((r) => r.people.map((p) => p.name));
}

describe('runTogether：表格（時間用給的）', () => {
	const cases: { name: string; steps: [number, RunEvent][]; answer: unknown; holders?: unknown[]; people?: string[]; at?: number }[] = [
		{
			name: '拿沒人拿著的：給他',
			steps: [[sec(0), report(WANG, ['n:1'])], [sec(1), report(LIN, [], [], true)], [sec(2), claim(LIN, 'n:2', null)]],
			answer: { kind: 'done' },
			holders: [['n:1', '王教練', false, false], ['n:2', '林教練', false, false]]
		},
		{
			name: '接手還沒點過的（說看到是他拿著）：給他',
			steps: [[sec(0), report(WANG, ['n:1'])], [sec(1), report(LIN, [], [], true)], [sec(2), claim(LIN, 'n:1', WANG.userId)]],
			answer: { kind: 'done' },
			holders: [['n:1', '林教練', false, false]]
		},
		{
			name: '點過的拿不走：退回，寫拿著的人、點過了',
			steps: [[sec(0), report(WANG, ['n:1'], ['n:1'])], [sec(1), report(LIN, [], [], true)], [sec(2), claim(LIN, 'n:1', WANG.userId)]],
			answer: { kind: 'refused', by: '王教練', touched: true },
			holders: [['n:1', '王教練', true, false]]
		},
		{
			name: '搶同一組後到的退回：看到沒人拿著，其實別人先拿了（沒點過）',
			steps: [
				[sec(0), report(WANG, [])],
				[sec(1), report(LIN, [], [], true)],
				[sec(1), report(MEI, [], [], true)],
				[sec(2), claim(MEI, 'n:4', null)],
				[sec(2), claim(LIN, 'n:4', null)]
			],
			answer: { kind: 'refused', by: '陳小美', touched: false },
			holders: [['n:4', '陳小美', false, false]]
		},
		{
			name: '點過的、看到的不是他：退回寫沒點過（是別人先拿了）',
			steps: [[sec(0), report(WANG, ['n:1'], ['n:1'])], [sec(1), report(LIN, [], [], true)], [sec(2), claim(LIN, 'n:1', null)]],
			answer: { kind: 'refused', by: '王教練', touched: false }
		},
		{
			name: '點別人拿著的：退回，寫他點過沒',
			steps: [[sec(0), report(WANG, ['n:1'])], [sec(1), report(LIN, [], [], true)], [sec(2), touch(LIN, 'n:1')]],
			answer: { kind: 'refused', by: '王教練', touched: false }
		},
		{
			name: '斷線不到 1 分鐘：寫斷線了，點過的還是拿不走',
			steps: [
				[sec(0), report(WANG, ['n:1'], ['n:1'])],
				[sec(1), report(LIN, [], [], true)],
				[sec(2), { kind: 'disconnect', conn: WANG.conn }],
				[sec(61), claim(LIN, 'n:1', WANG.userId)]
			],
			answer: { kind: 'refused', by: '王教練', touched: true },
			holders: [['n:1', '王教練', true, true]],
			people: ['王教練', '林教練']
		},
		{
			name: '斷線 1 分鐘之後可以接手（點過的也行），離開的人不在表裡了',
			steps: [
				[sec(0), report(WANG, ['n:1'], ['n:1'])],
				[sec(1), report(LIN, [], [], true)],
				[sec(2), { kind: 'disconnect', conn: WANG.conn }],
				[sec(62), claim(LIN, 'n:1', WANG.userId)]
			],
			answer: { kind: 'done' },
			holders: [['n:1', '林教練', false, false]],
			people: ['林教練']
		},
		{
			name: '斷線回來重報（1 分鐘內）：組還是他的，不寫斷線了',
			steps: [
				[sec(0), report(WANG, ['n:1'], ['n:1'])],
				[sec(1), report(LIN, ['n:2'], [], true)],
				[sec(2), { kind: 'disconnect', conn: WANG.conn }],
				[sec(32), report({ ...WANG, conn: 12 }, ['n:1'], ['n:1'])]
			],
			answer: { kind: 'done' },
			holders: [['n:1', '王教練', true, false], ['n:2', '林教練', false, false]],
			people: ['王教練', '林教練']
		},
		{
			name: '重報：自己拿著、沒報的放掉；別人拿著的不給',
			steps: [[sec(0), report(WANG, ['n:1', 'n:2'])], [sec(1), report(LIN, ['n:2', 'n:3'], [], true)], [sec(2), report(WANG, ['n:2'])]],
			answer: { kind: 'done' },
			holders: [['n:2', '王教練', false, false], ['n:3', '林教練', false, false]]
		},
		{
			name: '表裡的人都離開了不能加入',
			steps: [[sec(0), report(WANG, ['n:1'])], [sec(1), leave(WANG)], [sec(2), report(MEI, ['n:2'], [], true)]],
			answer: { kind: 'closed' },
			holders: [],
			people: []
		},
		{
			name: '表裡的人都斷線超過 1 分鐘：當他們離開，不能加入',
			steps: [[sec(0), report(WANG, ['n:1'])], [sec(1), { kind: 'disconnect', conn: WANG.conn }], [sec(61), report(MEI, [], [], true)]],
			answer: { kind: 'closed' }
		},
		{
			name: '表裡的人都離開了，自己開的（不是加入）可以再開',
			steps: [[sec(0), report(WANG, ['n:1'])], [sec(1), leave(WANG)], [sec(2), report(WANG, ['n:1'])]],
			answer: { kind: 'done' },
			holders: [['n:1', '王教練', false, false]]
		},
		{
			name: '請出去之後拿著的放掉，別人還在',
			steps: [[sec(0), report(WANG, ['n:1'])], [sec(1), report(LIN, ['n:2'], ['n:2'], true)], [sec(2), { kind: 'kick', userId: LIN.userId }]],
			answer: { kind: 'done' },
			holders: [['n:1', '王教練', false, false]],
			people: ['王教練']
		},
		{
			name: '放掉自己拿著的',
			steps: [[sec(0), report(WANG, ['n:1', 'n:2'])], [sec(1), release(WANG, 'n:1')]],
			answer: { kind: 'done' },
			holders: [['n:2', '王教練', false, false]]
		},
		...[claim(LIN, 'n:1', null), release(LIN, 'n:1'), touch(LIN, 'n:1'), leave(LIN)].map((event) => ({
			name: `沒有這次全上：${event.kind === 'ask' ? event.ask.kind : ''} 說不能加入`,
			steps: [[sec(0), event]] as [number, RunEvent][],
			answer: { kind: 'closed' }
		})),
		{
			name: '點了、放掉不會把人加進表裡（只有報、拿會）',
			steps: [[sec(0), report(WANG, ['n:1'])], [sec(1), touch(LIN, 'n:2')], [sec(2), release(MEI, 'n:1')]],
			answer: { kind: 'done' },
			holders: [['n:1', '王教練', false, false], ['n:2', '', true, true]],
			people: ['王教練']
		}
	];
	it.each(cases)('$name', ({ steps, answer, holders: want, people: who }) => {
		const out = play(steps);
		expect(out.answer).toEqual(answer);
		const at = steps[steps.length - 1][0];
		if (want) expect(holders(out.runs, at)).toEqual(want);
		if (who) expect(people(out.runs, at)).toEqual(who);
	});
});

describe('runViews：給某一個人看的', () => {
	it('寫哪些是他的、哪個是他自己；斷線的寫 away', () => {
		const { runs } = play([
			[sec(0), report(WANG, ['n:1'])],
			[sec(1), report(LIN, ['n:2'], ['n:2'], true)],
			[sec(2), { kind: 'disconnect', conn: LIN.conn }]
		]);
		expect(runViews(runs, LIN.userId, sec(3))).toEqual([
			{
				id: RUN,
				date: '2026-11-22',
				startedAt: T0,
				people: [
					{ name: '王教練', me: false, away: false },
					{ name: '林教練', me: true, away: true }
				],
				keys: [
					{ key: 'n:1', userId: 1, name: '王教練', mine: false, touched: false, away: false },
					{ key: 'n:2', userId: 2, name: '林教練', mine: true, touched: true, away: true }
				]
			}
		]);
	});
});

describe('runTogether：changed、不改傳進來的', () => {
	it('一個連線斷了，有別的連線還連著：changed，不寫斷線了', () => {
		const a = play([[sec(0), report(WANG, ['n:1'])], [sec(0), report({ ...WANG, conn: 12 }, ['n:1'])]]);
		const before = JSON.stringify(a.runs);
		const b = runTogether(a.runs, { kind: 'disconnect', conn: WANG.conn }, sec(1));
		expect(JSON.stringify(a.runs)).toBe(before);
		expect(b.changed).toBe(true);
		expect(holders(b.runs, sec(1))).toEqual([['n:1', '王教練', false, false]]);
	});
	it('拿自己拿著的：沒變', () => {
		const a = play([[sec(0), report(WANG, ['n:1'])]]);
		expect(runTogether(a.runs, claim(WANG, 'n:1', null), sec(1)).changed).toBe(false);
	});
	it('JSON 版：一次回新的表、回答、變了沒、給每個看的人的樣子', () => {
		const a = play([[sec(0), report(WANG, ['n:1'])], [sec(1), report(LIN, [], [], true)]]);
		const out = JSON.parse(runTogetherJson(JSON.stringify(a.runs), JSON.stringify({ ...claim(LIN, 'n:2', null), now: sec(2), viewers: [1, 2] })));
		const want = runTogether(a.runs, claim(LIN, 'n:2', null), sec(2));
		expect(out).toEqual({ ...want, views: [runViews(want.runs, 1, sec(2)), runViews(want.runs, 2, sec(2))] });
	});
	it('JSON 版只要樣子（打招呼、斷線 1 分鐘後再說一次）：照 viewers 的順序，表不變', () => {
		const a = play([[sec(0), report(WANG, ['n:1'], ['n:1'])], [sec(1), report(LIN, ['n:2'], [], true)], [sec(2), { kind: 'disconnect', conn: LIN.conn }]]);
		const runs = JSON.stringify(a.runs);
		const out = JSON.parse(runViewsJson(runs, JSON.stringify({ now: sec(70), viewers: [2, 1] })));
		const run = (me: number) => ({
			id: RUN,
			date: '2026-11-22',
			startedAt: T0,
			people: [{ name: '王教練', me: me === 1, away: false }],
			keys: [
				{ key: 'n:1', userId: 1, name: '王教練', mine: me === 1, touched: true, away: false },
				{ key: 'n:2', userId: 2, name: '林教練', mine: me === 2, touched: false, away: true }
			]
		});
		expect(out).toEqual([[run(2)], [run(1)]]);
		expect(JSON.parse(runViewsJson('[]', JSON.stringify({ now: sec(70), viewers: [1] })))).toEqual([[]]);
	});
});
