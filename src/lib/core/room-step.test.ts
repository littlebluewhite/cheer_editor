// 「這一步收不收」（#315，ADR 0010、0014、0007、0018）：假伺服器和 Rust 伺服器都叫它，規則只有這一份。
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	addBookmark,
	deleteBookmark,
	deletePhase,
	renameFlow,
	takeRecords,
	takeStep,
	undoChanges,
	type Flow,
	type LoggedStep,
	type StepAsk,
	type StepRefusal,
	type StoredAttempt
} from './index';
import { inStep } from './ids';
import { flowOf, libSample, ratedSample } from '../test-flows';
import type { SentBack } from '../api-types/SentBack';

const NOW = Date.UTC(2026, 10, 21, 12);
const DAY = 24 * 60 * 60 * 1000;

/** 伺服器上的樣子：ratedSample 拆成不帶紀錄的編排和紀錄，現在第 3 步。 */
function server(): { flow: Flow; records: StepAsk['records'] } {
	return takeRecords(ratedSample());
}

/** 步驟紀錄的一筆（預設：別的分頁、王教練、一小時前、沒改到東西）。 */
function logged(step: number, over: Partial<LoggedStep> = {}): LoggedStep {
	return { step, id: `step${step}`, tab: 'other', by: '王教練', at: NOW - 60 * 60 * 1000, keys: [], cleared: [], ...over };
}

/** 送來一步：在第 3 步、上次看到第 3 步、改流程名字。 */
function ask(over: Partial<StepAsk> = {}): StepAsk {
	return {
		...server(),
		step: 3,
		log: [logged(1), logged(2), logged(3)],
		now: NOW,
		canEdit: true,
		tab: 'mine',
		by: '李教練',
		sent: { stepId: 'new', seen: 3, commands: [{ name: 'renameFlow', args: ['決賽'] }] },
		...over
	};
}

// 退回的原因跟伺服器的 SentBack（src/lib/api-types/）各寫一次：兩邊不一樣時 npm run check 會錯（只查型別，Vitest 不算）。
expectTypeOf<StepRefusal>().toEqualTypeOf<SentBack>();

describe('takeStep：收了', () => {
	it('跑指令：回改好的編排、要送給別人的改動、要記的步驟紀錄', () => {
		const r = takeStep(ask());
		expect(r.kind).toBe('accepted');
		if (r.kind !== 'accepted') return;
		expect(r.flow.name).toBe('決賽');
		expect(r.change).toEqual({ things: [{ key: 'name', after: '決賽' }], orders: {} });
		expect(r.logged).toEqual({ step: 4, id: 'new', tab: 'mine', by: '李教練', at: NOW, keys: ['name'], cleared: [] });
		expect(r.changed).toEqual([]);
		expect(r.deleted).toEqual([]);
		expect(flowOf(renameFlow(server().flow, '決賽'))).toEqual(r.flow);
	});

	it('舊檔有同一拍兩張站位（16、16），一般的一步在前面插 8 拍：收（一般的步不跑整份流程檢查），兩張變 24、24', () => {
		const old = server().flow;
		const pos = old.formations[0].pos;
		const flow: Flow = { ...old, formations: [old.formations[0], ...['a', 'b'].map((id) => ({ id, segmentId: 's1', at: 16, pos }))] };
		const commands = [{ name: 'insertBeats' as const, args: [{ segmentId: 's1', at: 8 }, 8] as [{ segmentId: string; at: number }, number] }];
		const r = takeStep(ask({ flow, sent: { stepId: 'new', seen: 3, commands } }));
		expect(r.kind).toBe('accepted');
		if (r.kind !== 'accepted') return;
		expect(r.flow.formations.map((f) => f.at)).toEqual([0, 24, 24]);
	});
});

describe('takeStep：表格', () => {
	const rename = { stepId: 'new', seen: 3, commands: [{ name: 'renameFlow' as const, args: ['決賽'] as [string] }] };
	const cases: { name: string; ask: Partial<StepAsk>; expected: unknown }[] = [
		{
			name: '改到同一個東西：上次看到之後別的分頁改過名字，退回、寫最後改到的人',
			ask: { step: 5, log: [logged(3), logged(4, { keys: ['name'], by: '王教練' }), logged(5, { keys: ['member:m1'], by: '陳教練' })] },
			expected: { kind: 'rejected', why: { code: 'sameThing' }, by: '王教練' }
		},
		{
			name: '改到同一個東西：是自己別的步（同一個分頁）改的，收',
			ask: { step: 4, log: [logged(3), logged(4, { keys: ['name'], tab: 'mine' })] },
			expected: 'accepted'
		},
		{
			name: '改到別的東西，收',
			ask: { step: 4, log: [logged(3), logged(4, { keys: ['member:m1'] })] },
			expected: 'accepted'
		},
		{
			name: '被退回之後、還在退回那一步之前看到的步：一起退回',
			ask: { sentBack: 4, step: 4, log: [logged(3), logged(4)] },
			expected: { kind: 'rejected', why: { code: 'afterSentBack' } }
		},
		{
			name: '被退回之後換上了伺服器的樣子（上次看到不在之前）：收',
			ask: { sentBack: 3 },
			expected: 'accepted'
		},
		{
			name: '上次看到的下一步已經沒留（超過 30 天）：退回、換成伺服器的樣子',
			ask: { step: 5, log: [logged(5)], sent: rename },
			expected: { kind: 'rejected', why: { code: 'tooOld' } }
		},
		{
			name: '檢視者、記錄者送步：退回',
			ask: { canEdit: false },
			expected: { kind: 'rejected', why: { code: 'viewOnly' } }
		},
		{
			name: '同一個步驟 id 重送：回原本的結果（不能改的人也是，跟伺服器一樣先查）',
			ask: { canEdit: false, taken: { step: 2, change: { things: [{ key: 'name', after: '區賽' }], orders: {} } } },
			expected: { kind: 'again', step: 2, change: { things: [{ key: 'name', after: '區賽' }], orders: {} } }
		},
		{
			name: '同一個步驟 id 重送、那一步沒記改動：回第幾步',
			ask: { taken: { step: 2, change: null } },
			expected: { kind: 'again', step: 2, change: null }
		},
		{
			name: '同一個步驟 id 重送：不用紀錄、步驟紀錄就回（伺服器收過的不讀它們，給空的）',
			ask: { step: 9, records: [], log: [], sent: { ...rename, seen: 1 }, taken: { step: 2, change: null } },
			expected: { kind: 'again', step: 2, change: null }
		},
		{
			name: '伺服器看不懂（沒有這個指令）：退回',
			ask: { sent: { stepId: 'new', seen: 3, commands: [{ name: 'nope', args: [] } as never] } },
			expected: { kind: 'rejected', why: { code: 'notUnderstood' } }
		},
		{
			name: '要問（刪環節會清掉記號）而沒問：退回、寫上次看到之後最後改過的人',
			ask: {
				step: 4,
				log: [logged(3), logged(4, { by: '陳教練' })],
				sent: { stepId: 'new', seen: 3, commands: [{ name: 'deletePhase', args: ['x1', 'p1'] }] },
				records: [once('t1', { p1: '✓' })]
			},
			expected: {
				kind: 'rejected',
				why: { code: 'blocked', ask: true, reason: expect.objectContaining({ message: expect.any(String) }) },
				by: '陳教練'
			}
		},
		{
			name: '被規則擋下、上次看到之後沒人改過：退回、不寫人',
			ask: { sent: { stepId: 'new', seen: 3, commands: [{ name: 'deletePhase', args: ['x9', 'p1'] }] } },
			expected: { kind: 'rejected', why: { code: 'blocked', ask: false, reason: expect.objectContaining({ message: expect.any(String) }) } }
		}
	];
	it.each(cases)('$name', ({ ask: over, expected }) => {
		const r = takeStep(ask(over));
		if (expected === 'accepted') expect(r.kind).toBe('accepted');
		else expect(r).toEqual(expected);
	});
});

/** x1 的一次（小美、小A 那組）。 */
function once(id: string, marks: Record<string, '✓' | '✗'>, extra: Partial<StoredAttempt['attempt']> = {}): StoredAttempt {
	const who = libSample().actions[0].members[0].squad!;
	return { actionId: 'x1', attempt: { id, date: '2026-11-04', who, practice: 'drill', whole: true, marks, ...extra } };
}

describe('takeStep：復原、重做', () => {
	/** 第 2 步把名字改成「決賽」（王教練在別的分頁、或我自己）；現在要復原它。 */
	function undoRename(over: Partial<StepAsk> = {}, of: Partial<LoggedStep> = {}): StepAsk {
		const before = server().flow;
		const after = flowOf(renameFlow(before, '決賽'));
		const { undo } = undoChanges(before, after);
		return ask({
			flow: after,
			log: [logged(1), logged(2, { id: 'renamed', tab: 'mine', keys: ['name'], ...of }), logged(3)],
			sent: { stepId: 'new', seen: 3, undo: { of: 'renamed', redo: false, change: undo } },
			...over
		});
	}

	it('放得回去：收，改動是放回去的樣子', () => {
		const r = takeStep(undoRename());
		expect(r.kind).toBe('accepted');
		if (r.kind !== 'accepted') return;
		expect(r.flow.name).toBe(server().flow.name);
		expect(r.logged.keys).toEqual(['name']);
	});

	it('要復原的那一步超過 30 天：退回「太久以前的」', () => {
		const r = takeStep(undoRename({}, { at: NOW - 30 * DAY }));
		expect(r).toEqual({ kind: 'rejected', why: { code: 'undoTooOld', redo: false } });
	});

	it('要復原的那一步 29 天前：收', () => {
		expect(takeStep(undoRename({}, { at: NOW - 29 * DAY })).kind).toBe('accepted');
	});

	it('要復原的那一步已經沒留：退回「太久以前的」（重做也是）', () => {
		const a = undoRename();
		const sent = a.sent as Extract<StepAsk['sent'], { undo: unknown }>;
		const r = takeStep({ ...a, sent: { ...sent, undo: { ...sent.undo, of: 'gone', redo: true } } });
		expect(r).toEqual({ kind: 'rejected', why: { code: 'undoTooOld', redo: true } });
	});

	it('那一步之後別的分頁改過那些東西：退回、寫最後改到的人', () => {
		const r = takeStep(undoRename({ log: [logged(1), logged(2, { id: 'renamed', tab: 'mine', keys: ['name'] }), logged(3, { keys: ['name'], by: '陳教練' })] }));
		expect(r).toEqual({ kind: 'rejected', why: { code: 'undoChangedLater', by: '陳教練', redo: false } });
	});

	it('那一步之後改那些東西的是自己這個分頁：收', () => {
		const r = takeStep(undoRename({ log: [logged(1), logged(2, { id: 'renamed', tab: 'mine', keys: ['name'] }), logged(3, { keys: ['name'], tab: 'mine' })] }));
		expect(r.kind).toBe('accepted');
	});

	it('放回去整份檢查不合（同一個地方兩個書籤）：退回帶原因', () => {
		const sample = libSample();
		const seg = sample.segments[0].id;
		const flow = flowOf(addBookmark(sample, '翻騰', { segmentId: seg, at: 8 }, { segmentId: seg, at: 16 }));
		const mine = flowOf(deleteBookmark(flow, flow.bookmarks![0].id));
		const { undo } = undoChanges(flow, mine);
		const others = takeRecords(flowOf(inStep('step-other', () => addBookmark(mine, '又一個', { segmentId: seg, at: 8 }, { segmentId: seg, at: 16 }))));
		const r = takeStep(
			ask({
				...others,
				log: [logged(1), logged(2, { id: 'mine', tab: 'mine', keys: ['bookmark:x'] }), logged(3)],
				sent: { stepId: 'new', seen: 3, undo: { of: 'mine', redo: false, change: undo } }
			})
		);
		expect(r).toEqual({
			kind: 'rejected',
			why: {
				code: 'undoBlocked',
				redo: false,
				reason: { message: '書籤「又一個」和「翻騰」在同一個地方', why: { code: 'flow_check_same_bookmark', first: '又一個', second: '翻騰' } }
			}
		});
	});
});

describe('takeStep：紀錄跟著變（ADR 0007）', () => {
	it('刪環節清掉的記號：改好的存起來、整筆清掉的清掉，記在這一步', () => {
		const t1 = once('t1', { p1: '✓', p3: '✗' });
		const t2 = once('t2', { p3: '✗' });
		const r = takeStep(
			ask({ records: [t1, t2], sent: { stepId: 'new', seen: 3, commands: [{ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } }] } })
		);
		expect(r.kind).toBe('accepted');
		if (r.kind !== 'accepted') return;
		const t1after = once('t1', { p1: '✓' });
		expect(r.changed).toEqual([t1after]);
		expect(r.deleted).toEqual(['t2']);
		expect(r.logged.cleared).toEqual([
			{ was: t1, now: t1after },
			{ was: t2, now: null }
		]);
	});

	it('復原刪環節：清掉的那一筆加回來、改掉的換回改之前的；之後用手刪掉的不拿回來', () => {
		const t1 = once('t1', { p1: '✓', p3: '✗' });
		const t2 = once('t2', { p3: '✗' });
		const t3 = once('t3', { p3: '✓' });
		const before = libSample();
		const after = flowOf(deletePhase(before, 'x1', 'p3', { confirmed: true }));
		const { undo } = undoChanges(before, after);
		const r = takeStep(
			ask({
				flow: takeRecords(after).flow,
				records: [once('t1', { p1: '✓' }), { ...t2, gone: true }, { ...t3, gone: true, amendedStep: 2 }],
				log: [
					logged(1),
					logged(2, { id: 'cut', tab: 'mine', keys: ['phase:x1:p3'], cleared: [{ was: t1, now: once('t1', { p1: '✓' }) }, { was: t2, now: null }, { was: t3, now: null }] }),
					logged(3)
				],
				sent: { stepId: 'new', seen: 3, undo: { of: 'cut', redo: false, change: undo } }
			})
		);
		expect(r.kind).toBe('accepted');
		if (r.kind !== 'accepted') return;
		expect(r.changed).toEqual([t1, t2]);
		expect(r.deleted).toEqual([]);
		expect(r.logged.cleared).toEqual([
			{ was: once('t1', { p1: '✓' }), now: t1 },
			{ was: null, now: t2 }
		]);
	});

	it('復原把一筆換回原來的組，跟同一次全上別人存的那一筆撞在一起：只算先存的，這一筆清掉', () => {
		const flow = libSample();
		const [a, b] = [...new Set(flow.actions[0].members.map((m) => m.squad!))];
		const run = { practice: 'runThrough' as const, runThroughId: 'r1', runThroughStartedAt: 1 };
		const wasA = once('t1', { p1: '✓' }, { ...run, who: a });
		const nowB = once('t1', { p1: '✓' }, { ...run, who: b });
		const theirs = once('t2', { p1: '✗' }, { ...run, who: a });
		const after = flowOf(renameFlow(takeRecords(flow).flow, '決賽'));
		const { undo } = undoChanges(takeRecords(flow).flow, after);
		const r = takeStep(
			ask({
				flow: after,
				records: [nowB, theirs],
				log: [logged(1), logged(2, { id: 'moved', tab: 'mine', keys: ['name'], cleared: [{ was: wasA, now: nowB }] }), logged(3)],
				sent: { stepId: 'new', seen: 3, undo: { of: 'moved', redo: false, change: undo } }
			})
		);
		expect(r.kind).toBe('accepted');
		if (r.kind !== 'accepted') return;
		expect(r.changed).toEqual([]);
		expect(r.deleted).toEqual(['t1']);
		expect(r.logged.cleared).toEqual([{ was: nowB, now: null }]);
	});

	it('復原加回來的一筆，清掉之後同一次全上的這一組別人記了：不拿回來', () => {
		const flow = libSample();
		const [a] = [...new Set(flow.actions[0].members.map((m) => m.squad!))];
		const run = { practice: 'runThrough' as const, runThroughId: 'r1', runThroughStartedAt: 1 };
		const mine = once('t1', { p1: '✓' }, { ...run, who: a });
		const theirs = once('t2', { p1: '✗' }, { ...run, who: a });
		const after = flowOf(renameFlow(takeRecords(flow).flow, '決賽'));
		const { undo } = undoChanges(takeRecords(flow).flow, after);
		const r = takeStep(
			ask({
				flow: after,
				records: [{ ...mine, gone: true }, theirs],
				log: [logged(1), logged(2, { id: 'cut', tab: 'mine', keys: ['name'], cleared: [{ was: mine, now: null }] }), logged(3)],
				sent: { stepId: 'new', seen: 3, undo: { of: 'cut', redo: false, change: undo } }
			})
		);
		expect(r.kind).toBe('accepted');
		if (r.kind !== 'accepted') return;
		expect(r.changed).toEqual([]);
		expect(r.logged.cleared).toEqual([]);
	});
});
