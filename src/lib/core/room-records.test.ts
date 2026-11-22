// 「這串紀錄收不收」（#348，ADR 0011、0015、0018）：規則的先後照真的伺服器（records.rs 的 record）。
import { describe, expect, it } from 'vitest';
import { receiveRecords, type KnownRecord, type RecordsAsk, type StoredAttempt } from './index';
import { receiveRecordsJson } from './bundle-entry';
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
	it('收 JSON、回 JSON（跟 receiveRecords 一樣）：編排另外一個參數', () => {
		const a = ask({ sent: [rec('tnew000000001'), rec('tnew000000001')] });
		const { flow, ...rest } = a;
		expect(JSON.parse(receiveRecordsJson(JSON.stringify(flow), JSON.stringify(rest)))).toEqual(receiveRecords(a));
	});
});
