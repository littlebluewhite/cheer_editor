// 「這串紀錄收不收」（#348，ADR 0011、0015、0018）：規則的先後照真的伺服器（records.rs 的 record）。
import { describe, expect, it } from 'vitest';
import { amendRecords, receiveRecords, type AmendAsk, type AmendRecord, type KnownRecord, type RecordsAsk, type StoredAttempt } from './index';
import { amendRecordsJson, receiveRecordsJson } from './bundle-entry';
import { libSample } from '../test-flows';

const RUN = 'rabc123def456';

/** x1（Lib）第 who 組的一次：上法 ✓；run 給了是那一次全上的。 */
function rec(id: string, who = 'g1', run?: string): StoredAttempt {
	return {
		actionId: 'x1',
		attempt: { id, date: '2026-11-22', who, practice: run ? 'runThrough' : 'drill', whole: true, marks: { p1: '✓' }, ...(run && { runThroughId: run }) }
	};
}

function ask(over: Partial<RecordsAsk> = {}): RecordsAsk {
	return { flow: libSample(), canRecord: true, by: '李教練', sent: [rec('tnew000000001')], records: [], ...over };
}

describe('receiveRecords：表格（一條規則一列）', () => {
	const stored: KnownRecord = { ...rec('told000000001'), by: '王教練' };
	const cases: { name: string; ask: Partial<RecordsAsk>; expected: unknown[] }[] = [
		{
			name: '新的：收，帶檢查過的樣子',
			ask: {},
			expected: [{ kind: 'accepted', id: 'tnew000000001', record: rec('tnew000000001') }]
		},
		{
			name: '同一批重複的 id：只算第一筆，後面的兩邊都不放',
			ask: { sent: [rec('tnew000000001'), { ...rec('tnew000000001', 'g2') }] },
			expected: [{ kind: 'accepted', id: 'tnew000000001', record: rec('tnew000000001') }, { kind: 'skipped' }]
		},
		{
			name: '沒有 id 的：兩邊都不放（伺服器挑掉）',
			ask: { sent: [{ actionId: 'x1', attempt: { ...rec('x').attempt, id: 3 } } as unknown as StoredAttempt, rec('tnew000000001')] },
			expected: [{ kind: 'skipped' }, { kind: 'accepted', id: 'tnew000000001', record: rec('tnew000000001') }]
		},
		{
			name: '收過的 id：回存著的那一筆（不再檢查）',
			ask: { sent: [{ ...rec('told000000001', 'g2') }], records: [stored] },
			expected: [{ kind: 'again', id: 'told000000001', record: stored }]
		},
		{
			name: '收過、後來清掉的：兩邊都不放',
			ask: { sent: [rec('told000000001')], records: [{ ...stored, gone: true }] },
			expected: [{ kind: 'skipped' }]
		},
		{
			name: '不能記：新的不收，收過的照樣回存著的那一筆',
			ask: { canRecord: false, sent: [rec('told000000001'), rec('tnew000000001')], records: [stored] },
			expected: [
				{ kind: 'again', id: 'told000000001', record: stored },
				{ kind: 'refused', id: 'tnew000000001', why: { code: 'viewOnly' } }
			]
		},
		{
			name: '被「記一次」的規則擋下：帶流程核心給的原因',
			ask: { sent: [rec('tnew000000001', 'g9')] },
			expected: [{ kind: 'refused', id: 'tnew000000001', why: { code: 'blocked', reason: { message: '這一組沒有人了' } } }]
		},
		{
			name: '同一次全上的同一組，別人先存了：寫是誰',
			ask: { sent: [rec('tnew000000001', 'g1', RUN)], records: [{ ...rec('tfirst0000001', 'g1', RUN), by: '王教練' }] },
			expected: [{ kind: 'refused', id: 'tnew000000001', why: { code: 'takenInRun', by: '王教練' } }]
		},
		{
			name: '同一次全上的同一組，先存的沒有記的人（從流程檔來的）：不知道是誰',
			ask: { sent: [rec('tnew000000001', 'g1', RUN)], records: [rec('tfirst0000001', 'g1', RUN)] },
			expected: [{ kind: 'refused', id: 'tnew000000001', why: { code: 'takenInRun' } }]
		},
		{
			name: '同一次全上的同一組，先存的清掉了：收',
			ask: { sent: [rec('tnew000000001', 'g1', RUN)], records: [{ ...rec('tfirst0000001', 'g1', RUN), gone: true }] },
			expected: [{ kind: 'accepted', id: 'tnew000000001', record: rec('tnew000000001', 'g1', RUN) }]
		},
		{
			name: '同一批裡前後兩筆是同一組：前面的收，後面的不收、寫送的人',
			ask: { sent: [rec('tnew000000001', 'g1', RUN), rec('tnew000000002', 'g1', RUN), rec('tnew000000003', 'g2', RUN)] },
			expected: [
				{ kind: 'accepted', id: 'tnew000000001', record: rec('tnew000000001', 'g1', RUN) },
				{ kind: 'refused', id: 'tnew000000002', why: { code: 'takenInRun', by: '李教練' } },
				{ kind: 'accepted', id: 'tnew000000003', record: rec('tnew000000003', 'g2', RUN) }
			]
		},
		{
			name: '先看收過的 id，再看同一次全上的同一組（重送收過的全上那一格回存著的）',
			ask: {
				sent: [rec('told000000001', 'g1', RUN)],
				records: [{ ...rec('told000000001', 'g1', RUN), by: '李教練' }, { ...rec('tfirst0000001', 'g1', RUN), by: '王教練' }]
			},
			expected: [{ kind: 'again', id: 'told000000001', record: { ...rec('told000000001', 'g1', RUN), by: '李教練' } }]
		},
		{
			name: '流程核心看不懂（空著的環節不是陣列）：這一批新的都不收',
			ask: {
				sent: [rec('tnew000000001'), { actionId: 'x1', attempt: { ...rec('tnew000000002').attempt, blanks: 3 } } as unknown as StoredAttempt]
			},
			expected: [
				{ kind: 'refused', id: 'tnew000000001', why: { code: 'notUnderstood' } },
				{ kind: 'refused', id: 'tnew000000002', why: { code: 'notUnderstood' } }
			]
		}
	];
	for (const c of cases) {
		it(c.name, () => {
			expect(receiveRecords(ask(c.ask))).toEqual(c.expected);
		});
	}
});

describe('receiveRecords：不改傳進來的東西', () => {
	it('ask 原封不動', () => {
		const a = ask({ sent: [rec('tnew000000001', 'g1', RUN), rec('tnew000000002', 'g1', RUN)], records: [rec('tfirst0000001', 'g2', RUN)] });
		Object.freeze(a.sent);
		Object.freeze(a.records);
		const before = JSON.stringify(a);
		receiveRecords(a);
		expect(JSON.stringify(a)).toBe(before);
	});
});

describe('receiveRecordsJson', () => {
	it('收 JSON、回 JSON（跟 receiveRecords 一樣）', () => {
		const a = ask({ sent: [rec('tnew000000001'), rec('tnew000000001')] });
		expect(JSON.parse(receiveRecordsJson(JSON.stringify(a)))).toEqual(receiveRecords(a));
	});
});

// 「改、刪、救回」（#350，ADR 0007、0015、0018）：規則照真的伺服器（records.rs 的 amend）。
describe('amendRecords', () => {
	/** x1 第 who 組分段練只練上法的一次：記號 mark。 */
	const drill = (id: string, mark: '✓' | '△' | '✗' = '✓', who = 'g1'): StoredAttempt => ({
		actionId: 'x1',
		attempt: { id, date: '2026-11-22', who, practice: 'drill', whole: false, marks: { p1: mark } }
	});
	/** x1 第 1 組 RUN 那一次全上的一次（整個做、都 ✓）。 */
	const run = (id: string, by: string, gone?: boolean): AmendRecord => ({
		actionId: 'x1',
		attempt: { id, date: '2026-11-22', who: 'g1', practice: 'runThrough', runThroughId: RUN, whole: true, marks: { p1: '✓', p2: '✓', p3: '✓' } },
		by,
		...(gone && { gone })
	});
	/** 李（送的人）記的、王記的。 */
	const mine: AmendRecord = { ...drill('tmine00000001'), by: 'u-li' };
	const theirs: AmendRecord = { ...drill('ttheirs000001'), by: 'u-wang' };
	const amendAsk = (over: Partial<AmendAsk> = {}): AmendAsk => ({
		flow: libSample(),
		step: 7,
		role: 'recorder',
		by: 'u-li',
		sent: { kind: 'delete', ids: [] },
		records: [mine, theirs],
		...over
	});
	const nothing = { deleted: [], changed: [], restored: [], amended: [], told: [] };

	describe('每一種權限乘上改、刪、救回', () => {
		const roles: { name: string; role: AmendAsk['role']; target: AmendRecord; may: boolean }[] = [
			{ name: '擁有者', role: 'owner', target: theirs, may: true },
			{ name: '編輯者', role: 'editor', target: theirs, may: true },
			{ name: '記錄者動自己記的', role: 'recorder', target: mine, may: true },
			{ name: '記錄者動別人記的', role: 'recorder', target: theirs, may: false },
			{ name: '檢視者（他自己記的也一樣）', role: 'viewer', target: mine, may: false }
		];
		for (const { name, role, target, may } of roles) {
			const id = target.attempt.id;
			it(`${name}：改記號${may ? '' : '不算'}`, () => {
				const out = amendRecords(amendAsk({ role, sent: { kind: 'change', attempts: [drill(id, '✗')] } }));
				expect(out).toEqual(may ? { ...nothing, changed: [drill(id, '✗')], amended: [{ id, step: 7 }], told: [id] } : nothing);
			});
			it(`${name}：刪${may ? '' : '不算'}`, () => {
				const out = amendRecords(amendAsk({ role, sent: { kind: 'delete', ids: [id] } }));
				expect(out).toEqual(may ? { ...nothing, deleted: [id], amended: [{ id, step: 7 }] } : nothing);
			});
			it(`${name}：救回${may ? '' : '不算'}`, () => {
				const records = [mine, theirs].map((r) => (r === target ? { ...r, gone: true } : r));
				const out = amendRecords(amendAsk({ role, records, sent: { kind: 'restore', ids: [id] } }));
				expect(out).toEqual(may ? { ...nothing, restored: [drill(id)], amended: [{ id, step: 7 }], told: [id] } : nothing);
			});
		}
	});

	describe('規則', () => {
		const goneMine: AmendRecord = { ...mine, gone: true };
		it('清掉的不能改', () => {
			const out = amendRecords(amendAsk({ records: [goneMine], sent: { kind: 'change', attempts: [drill('tmine00000001', '✗')] } }));
			expect(out).toEqual(nothing);
		});
		it('清掉的不能再刪', () => {
			expect(amendRecords(amendAsk({ records: [goneMine], sent: { kind: 'delete', ids: ['tmine00000001'] } }))).toEqual(nothing);
		});
		it('還在的不能救回', () => {
			expect(amendRecords(amendAsk({ sent: { kind: 'restore', ids: ['tmine00000001'] } }))).toEqual(nothing);
		});
		it('伺服器上沒有的 id 不算', () => {
			expect(amendRecords(amendAsk({ sent: { kind: 'delete', ids: ['tnone00000001'] } }))).toEqual(nothing);
		});
		it('救回時同一次全上的同一組別人已經記了：不救', () => {
			const records = [run('tmine00000001', 'u-li', true), run('ttheirs000001', 'u-wang')];
			expect(amendRecords(amendAsk({ records, sent: { kind: 'restore', ids: ['tmine00000001'] } }))).toEqual(nothing);
		});
		it('一次救回同一次全上的同一組兩筆：照送來的先後，只救前面那筆', () => {
			const records = [run('tfirst0000001', 'u-li', true), run('tsecond000001', 'u-li', true)];
			const out = amendRecords(amendAsk({ records, sent: { kind: 'restore', ids: ['tsecond000001', 'tfirst0000001'] } }));
			const { by: _, gone: __, ...second } = run('tsecond000001', 'u-li');
			expect(out).toEqual({ ...nothing, restored: [second], amended: [{ id: 'tsecond000001', step: 7 }], told: ['tsecond000001'] });
		});
		it('再送一次一樣的記號：照樣改好（告訴別人），不算用手動過', () => {
			const out = amendRecords(amendAsk({ sent: { kind: 'change', attempts: [drill('tmine00000001', '✓')] } }));
			expect(out).toEqual({ ...nothing, changed: [drill('tmine00000001')], told: ['tmine00000001'] });
		});
		it('改記號照「改一次」的規則留：被擋下的不算', () => {
			// p9 不是這個動作的環節：記號丟光了，「改一次」擋下來
			const sent = { actionId: 'x1', attempt: { ...drill('tmine00000001').attempt, marks: { p9: '✓' } } } as StoredAttempt;
			expect(amendRecords(amendAsk({ sent: { kind: 'change', attempts: [sent] } }))).toEqual(nothing);
		});
		it('一次改好幾筆照先後做：同一筆改兩次，後到的贏', () => {
			const attempts = [drill('ttheirs000001', '✗'), drill('tmine00000001', '△'), drill('ttheirs000001', '△')];
			const out = amendRecords(amendAsk({ role: 'editor', sent: { kind: 'change', attempts } }));
			expect(out).toEqual({
				...nothing,
				changed: [drill('ttheirs000001', '△'), drill('tmine00000001', '△')],
				amended: [
					{ id: 'ttheirs000001', step: 7 },
					{ id: 'tmine00000001', step: 7 }
				],
				told: ['ttheirs000001', 'tmine00000001']
			});
		});
		it('一次刪好幾筆照先後做；重複的只算一次', () => {
			const out = amendRecords(amendAsk({ role: 'owner', sent: { kind: 'delete', ids: ['ttheirs000001', 'tmine00000001', 'ttheirs000001'] } }));
			expect(out).toEqual({
				...nothing,
				deleted: ['ttheirs000001', 'tmine00000001'],
				amended: [
					{ id: 'ttheirs000001', step: 7 },
					{ id: 'tmine00000001', step: 7 }
				]
			});
		});
	});

	it('不改傳進來的東西', () => {
		const a = amendAsk({ role: 'owner', sent: { kind: 'change', attempts: [drill('tmine00000001', '✗')] } });
		Object.freeze(a.records);
		const before = JSON.stringify(a);
		amendRecords(a);
		expect(JSON.stringify(a)).toBe(before);
	});

	it('amendRecordsJson：收 JSON、回 JSON（跟 amendRecords 一樣）', () => {
		const a = amendAsk({ sent: { kind: 'restore', ids: ['tmine00000001'] }, records: [{ ...mine, gone: true }] });
		expect(JSON.parse(amendRecordsJson(JSON.stringify(a)))).toEqual(amendRecords(a));
	});
});
