// 「這一步收不收」（#315，ADR 0010、0014、0007、0018）：假伺服器和 Rust 伺服器都叫它，規則只有這一份。
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	addBookmark,
	addMembers,
	deleteBookmark,
	joinUndo,
	deletePhase,
	problemKeys,
	renameFlow,
	takeRecords,
	takeStep,
	undoChanges,
	type Command,
	type Flow,
	type RemoteChange,
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
		core: 'core',
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
		expect(r.logged).toEqual({ step: 4, id: 'new', tab: 'mine', by: '李教練', at: NOW, keys: ['name'], cleared: [], cured: [] });
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

describe('takeStep：復原可以帶回那一步治好的舊毛病（ADR 0020）', () => {
	const CORE = 'core-now';
	type Sent = StepAsk['sent'];

	/**
	 * 一支雲端流程（第 0 步），像伺服器一樣照 takeStep 收步、存起來：編排、第幾步、步驟紀錄、記著的毛病。
	 * held 預設是傳上雲端時記的（problemKeys）；給了就用給的（故意寫錯、流程核心換版）。
	 */
	function cloud(start: Flow, held: StepAsk['held'] = { keys: problemKeys(start), core: CORE }) {
		const s = { flow: start, step: 0, log: [] as LoggedStep[], held, flows: [start] };
		let n = 0;
		const send = (sent: Sent, tab: string) => {
			const r = takeStep({ flow: s.flow, step: s.step, records: [], log: s.log, now: NOW, canEdit: true, tab, by: tab, core: CORE, held: s.held, sent });
			if (r.kind === 'accepted') {
				s.flow = r.flow;
				s.step = r.logged.step;
				s.log = [...s.log, r.logged];
				s.held = { keys: r.held, core: CORE };
				s.flows.push(r.flow);
			}
			return r;
		};
		const id = () => `step${++n}`;
		return {
			s,
			/** 跑一串指令，回步驟 id（被擋就讓測試失敗）。 */
			run(commands: Command[], tab = 'mine'): string {
				const stepId = id();
				const r = send({ stepId, seen: s.step, commands }, tab);
				if (r.kind !== 'accepted') throw new Error(JSON.stringify(r));
				return stepId;
			},
			/** 復原（重做）步驟 id 是 of 的那一步：放回去的是 change；joined 是方向鍵合成的其他步。 */
			undo(of: string, change: RemoteChange, redo = false, joined?: string[]) {
				const stepId = id();
				return { stepId, r: send({ stepId, seen: s.step, undo: { of, redo, change, ...(joined && { joined }) } }, 'mine') };
			}
		};
	}
	/** 第 i 步（第 0 步是傳上雲端時）的復原、重做要送的。 */
	const changesOf = (c: ReturnType<typeof cloud>, i: number) => undoChanges(c.s.flows[i - 1], c.s.flows[i]);

	it('舊檔動作名字 25 個字，改短，復原：收了，名字回到 25 個字', () => {
		const long = '一二三四五六七八九十一二三四五六七八九十一二三四五';
		const old = server().flow;
		const c = cloud({ ...old, actions: old.actions.map((a, i) => (i === 0 ? { ...a, name: long } : a)) });
		const id = c.run([{ name: 'updateAction', args: [old.actions[0].id, { name: '短' }] }]);
		const { r } = c.undo(id, changesOf(c, 1).undo);
		expect(r.kind).toBe('accepted');
		expect(c.s.flow.actions[0].name).toBe(long);
	});

	it('舊檔流程名字 45 個字，改短，復原：收了，名字回到 45 個字', () => {
		const long = '流'.repeat(45);
		const c = cloud({ ...server().flow, name: long });
		const id = c.run([{ name: 'renameFlow', args: ['決賽'] }]);
		expect(c.undo(id, changesOf(c, 1).undo).r.kind).toBe('accepted');
		expect(c.s.flow.name).toBe(long);
	});

	it('舊檔 41 人，刪 1 人，復原：收了', () => {
		const c = cloud(fortyOne());
		const id = c.run([{ name: 'deleteMember', args: ['extra'], options: { confirmed: true } }]);
		expect(c.undo(id, changesOf(c, 1).undo).r.kind).toBe('accepted');
		expect(c.s.flow.members).toHaveLength(41);
	});

	it('舊檔同一拍兩張站位，刪一張，復原：收了', () => {
		const c = cloud(withFormations([[16, 'a'], [16, 'b']]));
		const id = c.run([{ name: 'deleteFormation', args: ['a'] }]);
		expect(c.undo(id, changesOf(c, 1).undo).r.kind).toBe('accepted');
		expect(c.s.flow.formations.map((f) => f.id).slice(1)).toEqual(['a', 'b']);
	});

	it('#290 的 [0, 20, 16a, 8, 16b]：刪 16a 馬上復原：收了，站位照時間排', () => {
		const c = cloud(withFormations([[20, 'f20'], [16, 'a'], [8, 'f8'], [16, 'b']]));
		const id = c.run([{ name: 'deleteFormation', args: ['a'] }]);
		expect(c.undo(id, changesOf(c, 1).undo).r.kind).toBe('accepted');
		expect(c.s.flow.formations.map((f) => f.id).slice(1)).toEqual(['f8', 'a', 'b', 'f20']);
	});

	it('匯入的舊檔（0、16、24、8、24 拍）：刪第一個 24 馬上復原：收了（#342 時擋下）', () => {
		const c = cloud(withFormations([[16, 'old1'], [24, 'old2'], [8, 'old3'], [24, 'old4']]));
		const id = c.run([{ name: 'deleteFormation', args: ['old2'] }]);
		expect(c.undo(id, changesOf(c, 1).undo).r.kind).toBe('accepted');
		expect(c.s.flow.formations.map((f) => f.id).slice(1)).toEqual(['old3', 'old1', 'old2', 'old4']);
	});

	it('復原、重做、再復原：都收', () => {
		const c = cloud(fortyOne());
		const id = c.run([{ name: 'deleteMember', args: ['extra'], options: { confirmed: true } }]);
		const { undo, redo } = changesOf(c, 1);
		const back = c.undo(id, undo);
		expect(back.r.kind).toBe('accepted');
		const again = c.undo(back.stepId, redo, true);
		expect(again.r.kind).toBe('accepted');
		expect(c.s.flow.members).toHaveLength(40);
		expect(c.undo(again.stepId, undo).r.kind).toBe('accepted');
		expect(c.s.flow.members).toHaveLength(41);
	});

	it('方向鍵連按，把舊檔裡站在場外的人一格一格挪回場內，復原（合成一步）：收了，回到場外', () => {
		const old = server().flow;
		const [first] = old.formations;
		const c = cloud({ ...old, formations: [{ ...first, pos: { ...first.pos, m1: [-10, 0] } }, ...old.formations.slice(1)] });
		const press = (x: number) => c.run([{ name: 'moveMembers', args: [0, { m1: [x, 0] }] }]);
		const ids = [press(-9), press(-8.5), press(-8)];
		const joined = [1, 2, 3].map((i) => changesOf(c, i)).reduce((a, b) => joinUndo(a, b));
		expect(c.undo(ids[0], joined.undo, false, ids.slice(1)).r.kind).toBe('accepted');
		expect(c.s.flow.formations[0].pos.m1).toEqual([-10, 0]);
	});

	/** 合成一步：第一步挪別人（沒治好什麼），第二步把站在場外的小美挪回場內（治好）。回兩步的步驟 id 和合起來的復原。 */
	function curedOnSecond() {
		const old = server().flow;
		const [first] = old.formations;
		const c = cloud({ ...old, formations: [{ ...first, pos: { ...first.pos, m1: [-10, 0] } }, ...old.formations.slice(1)] });
		const ids = [c.run([{ name: 'setPositions', args: [first.id, { m2: [1, 1] }] }]), c.run([{ name: 'setPositions', args: [first.id, { m1: [-9, 0] }] }])];
		return { c, ids, undo: joinUndo(changesOf(c, 1), changesOf(c, 2)).undo };
	}

	it('合成一步，治好的是中間的一步：送了合了哪幾步就收', () => {
		const { c, ids, undo } = curedOnSecond();
		expect(c.undo(ids[0], undo, false, ids.slice(1)).r.kind).toBe('accepted');
	});

	it('合成一步，部署前開著的分頁只送第一步：只算第一步治好的，擋下', () => {
		const { c, ids, undo } = curedOnSecond();
		expect(c.undo(ids[0], undo).r).toMatchObject({ kind: 'rejected', why: { code: 'undoBlocked' } });
	});

	/** 站在場外的小美（第一張站位 m1 在 [-10, 0]）的雲端流程。 */
	function outside() {
		const old = server().flow;
		const [first] = old.formations;
		const c = cloud({ ...old, formations: [{ ...first, pos: { ...first.pos, m1: [-10, 0] } }, ...old.formations.slice(1)] });
		const set = (pos: Record<string, [number, number]>, tab = 'mine') => c.run([{ name: 'setPositions', args: [first.id, pos] }], tab);
		return { c, set };
	}

	it('joined 中間跳過自己分頁的一步：整串不算，只算第一步治好的，擋下', () => {
		const { c, set } = outside();
		const ids = [set({ m2: [1, 1] }), set({ m1: [-9, 0] }), c.run([{ name: 'renameFlow', args: ['決賽'] }]), set({ m3: [2, 2] })];
		// 送的 joined 是第二步（跟第一步連著、治好的）和第四步（中間隔著改名字）
		const undo = [1, 2, 4].map((i) => changesOf(c, i)).reduce((a, b) => joinUndo(a, b)).undo;
		expect(c.undo(ids[0], undo, false, [ids[1], ids[3]]).r).toMatchObject({ kind: 'rejected', why: { code: 'undoBlocked' } });
	});

	it('joined 寫了已經復原過的步：那一步治好的不算，擋下', () => {
		const { c, set } = outside();
		const ids = [set({ m2: [1, 1] }), set({ m1: [-9, 0] })];
		// 復原第二步（小美回場外，收了），自己再把她挪進場內
		expect(c.undo(ids[1], changesOf(c, 2).undo).r.kind).toBe('accepted');
		set({ m1: [-9, 0] });
		const undo = undoChanges(c.s.flows[0], c.s.flows[4]).undo;
		expect(c.undo(ids[0], undo, false, [ids[1]]).r).toMatchObject({ kind: 'rejected', why: { code: 'undoBlocked' } });
	});

	it('合成一步中間夾著別的分頁的步：還是連著，治好的算，收了', () => {
		const { c, set } = outside();
		const ids = [set({ m2: [1, 1] }), c.run([{ name: 'renameFlow', args: ['決賽'] }], 'other'), set({ m1: [-9, 0] })];
		const undo = joinUndo(changesOf(c, 1), changesOf(c, 3)).undo;
		expect(c.undo(ids[0], undo, false, [ids[2]]).r.kind).toBe('accepted');
		expect(c.s.flow.formations[0].pos.m1).toEqual([-10, 0]);
	});

	it.each(['other', 'mine'])('joined 寫了要復原那一步之前的步（%s 分頁）：那一步治好的不算，擋下', (tab) => {
		const c = cloud(fortyOne());
		const earlier = c.run([{ name: 'deleteMember', args: ['extra'], options: { confirmed: true } }], tab);
		const mine = c.run([{ name: 'renameFlow', args: ['決賽'] }]);
		// 放回去的樣子連前一步一起（41 人）：只有 mine 治好的（沒有）可以帶回來
		const undo = undoChanges(c.s.flows[0], c.s.flows[2]).undo;
		expect(c.undo(mine, undo, false, [earlier]).r).toMatchObject({
			kind: 'rejected',
			why: { code: 'undoBlocked', reason: { why: { code: 'flow_check_max_members' } } }
		});
	});

	it('照樣擋下：你刪了 5 個人（35），別人加了 5 個（40），你復原變 45 人', () => {
		const c = cloud(full(40));
		const gone = c.s.flow.members.slice(-5).map((m) => m.id);
		const id = c.run(gone.map((m): Command => ({ name: 'deleteMember', args: [m], options: { confirmed: true } })));
		const five = Array.from({ length: 5 }, (_, i) => ({ name: `新${i}`, gender: 'M' as const, globalRole: 'base' as const }));
		c.run([{ name: 'addMembers', args: [five] }], 'other');
		expect(c.undo(id, changesOf(c, 1).undo).r).toMatchObject({
			kind: 'rejected',
			why: { code: 'undoBlocked', reason: { why: { code: 'flow_check_max_members' } } }
		});
	});

	it('部署前收的步（沒有 cured）：照以前的比法，擋下', () => {
		const c = cloud(fortyOne());
		const id = c.run([{ name: 'deleteMember', args: ['extra'], options: { confirmed: true } }]);
		c.s.log = c.s.log.map(({ cured: _, ...l }) => l);
		expect(c.undo(id, changesOf(c, 1).undo).r).toMatchObject({ kind: 'rejected', why: { code: 'undoBlocked' } });
	});

	it('記著的毛病故意寫錯（少了）：那一步記成沒治好什麼，復原擋下', () => {
		const c = cloud(fortyOne(), { keys: [], core: CORE });
		const id = c.run([{ name: 'deleteMember', args: ['extra'], options: { confirmed: true } }]);
		expect(c.s.log[0].cured).toEqual([]);
		expect(c.undo(id, changesOf(c, 1).undo).r).toMatchObject({ kind: 'rejected', why: { code: 'undoBlocked' } });
	});

	it('記著的毛病故意寫錯（多了「超過 40 人」）：刪 5 人、別人加 5 人、復原變 45 人，照樣擋下', () => {
		const c = cloud(full(40), { keys: ['members'], core: CORE });
		const gone = c.s.flow.members.slice(-5).map((m) => m.id);
		const id = c.run(gone.map((m): Command => ({ name: 'deleteMember', args: [m], options: { confirmed: true } })));
		expect(c.s.log[0].cured).toEqual([]);
		const five = Array.from({ length: 5 }, (_, i) => ({ name: `新${i}`, gender: 'M' as const, globalRole: 'base' as const }));
		c.run([{ name: 'addMembers', args: [five] }], 'other');
		expect(c.undo(id, changesOf(c, 1).undo).r).toMatchObject({ kind: 'rejected', why: { code: 'undoBlocked' } });
	});

	it('記著的是舊版流程核心算的（過期了）：那一步記成沒治好什麼，復原擋下；重算記著的', () => {
		const c = cloud(fortyOne(), { keys: problemKeys(fortyOne()), core: 'core-old' });
		const id = c.run([{ name: 'deleteMember', args: ['extra'], options: { confirmed: true } }]);
		expect(c.s.log[0].cured).toEqual([]);
		expect(c.s.held).toEqual({ keys: [], core: CORE });
		expect(c.undo(id, changesOf(c, 1).undo).r.kind).toBe('rejected');
	});

	it('記著沒有毛病的流程：一般的步不算（不多跑整份流程檢查），還是記著沒有', () => {
		const c = cloud(server().flow);
		expect(c.s.held).toEqual({ keys: [], core: CORE });
		c.run([{ name: 'renameFlow', args: ['決賽'] }]);
		expect(c.s.log[0].cured).toEqual([]);
		expect(c.s.held).toEqual({ keys: [], core: CORE });
	});

	/** n 個人的流程。 */
	function full(n: number): Flow {
		const base = server().flow;
		const more = Array.from({ length: n - base.members.length }, (_, i) => ({ name: `隊員${i}`, gender: 'F' as const, globalRole: 'base' as const }));
		return flowOf(addMembers(base, more));
	}
	/** 舊檔：41 人（第 41 個是 extra，addMembers 加不進去，手改的）。 */
	function fortyOne(): Flow {
		const f = full(40);
		return { ...f, members: [...f.members, { ...f.members[0], id: 'extra', name: '多一個' }] };
	}
	it('#346：調段順序、別的分頁刪了原本的開頭那張、復原調段順序：擋下（開頭那張會不在流程開頭）', () => {
		const old = server().flow;
		const [f1] = old.formations;
		const c = cloud({ ...old, segments: [...old.segments, { ...old.segments[0], id: 's2' }], formations: [f1, { ...f1, id: 'f2', segmentId: 's2' }] });
		const id = c.run([{ name: 'moveSegment', args: ['s2', -1] }]);
		expect(c.s.flow.formations.map((f) => f.id)).toEqual(['f2', 'f1']);
		c.run([{ name: 'deleteFormation', args: ['f1'] }], 'other');
		expect(c.undo(id, changesOf(c, 1).undo).r).toMatchObject({
			kind: 'rejected',
			why: { code: 'undoBlocked', reason: { why: { code: 'flow_check_formation_opening' } } }
		});
		expect(c.s.flow.segments.map((s) => s.id)).toEqual(['s2', 's1']);
	});

	/** 舊檔：開頭那張之後照給的順序放這幾張站位（第一段的第幾拍、id），不照時間排。 */
	function withFormations(list: [number, string][]): Flow {
		const old = server().flow;
		const pos = old.formations[0].pos;
		return { ...old, formations: [old.formations[0], ...list.map(([at, id]) => ({ id, segmentId: 's1', at, pos }))] };
	}
});
