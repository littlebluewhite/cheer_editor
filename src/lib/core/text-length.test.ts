// 字數上限只有一條規則（N08）：照 HTML 的 tooLong，舊的字（開檔進來的）可以超過上限，但這次的改動不能讓它更長。
// 欄位旁邊的字數（CharCount）要跟它一樣：src/lib/components/CharCount.svelte.test.ts 拿同樣的資料比兩邊。
import { describe, expect, it } from 'vitest';
import { renameFlow } from './flow';
import { moveMembers, renameFormation } from './formation';
import { updateMember } from './members';
import { updateCustomRole } from './roles';
import { tooLong } from './text-length';
import { flowOf, libSample } from '#lib/test-flows.js';

const chars = (n: number) => '字'.repeat(n);

/** [欄位, 原本的字, 改成的字, 擋不擋]：上限 20（隊員名字）。 */
const LIMIT_CASES: [string, string, string, boolean][] = [
	['上限內改上限內', chars(5), chars(20), false],
	['上限內改超過', chars(5), chars(21), true],
	['舊檔超過、改短一點還是超過', chars(25), chars(24), false],
	['舊檔超過、一樣長', chars(25), chars(25), false],
	['舊檔超過、再變長', chars(25), chars(26), true],
	['舊檔超過、改到上限內', chars(25), chars(3), false],
	['頭尾空白不算', chars(5), ` ${chars(20)} `, false]
];

describe('tooLong：舊的字可以超過，改了不能更長', () => {
	it.each(LIMIT_CASES)('%s', (_, before, text, blocked) => {
		expect(tooLong('memberName', text, before) !== null).toBe(blocked);
	});

	it('沒給原本的字（新加的）：照上限', () => {
		expect(tooLong('memberName', chars(20))).toBeNull();
		expect(tooLong('memberName', chars(21))).toBe('隊員名字最多 20 個字');
	});

	it('舊檔超過、再變長：訊息說原本就超過、不能再長', () => {
		expect(tooLong('memberName', chars(26), chars(25))).toBe('隊員名字最多 20 個字（原本就有 25 個字，不能再變長）');
	});
});

describe('舊檔超過上限的名字，改短一點（還是超過）照收（N08）', () => {
	const base = flowOf(moveMembers(libSample(), 8, { m1: [3, 3] }));

	it('隊員名字 25 字刪 1 個字', () => {
		const flow = { ...base, members: base.members.map((m, i) => (i ? m : { ...m, name: chars(25) })) };
		const r = updateMember(flow, flow.members[0].id, { name: chars(24) });
		expect(r.kind).toBe('ok');
		expect(updateMember(flow, flow.members[0].id, { name: chars(26) }).kind).toBe('blocked');
	});

	it('流程名字 45 字刪 1 個字', () => {
		const flow = { ...base, name: chars(45) };
		expect(renameFlow(flow, chars(44)).kind).toBe('ok');
		expect(renameFlow(flow, chars(46)).kind).toBe('blocked');
	});

	it('站位名稱 25 字刪 1 個字', () => {
		const flow = { ...base, formations: base.formations.map((f, i) => (i ? { ...f, name: chars(25) } : f)) };
		const id = flow.formations[1].id;
		expect(renameFormation(flow, id, chars(24)).kind).toBe('ok');
		expect(renameFormation(flow, id, chars(26)).kind).toBe('blocked');
	});

	it('任務角色名稱 10 字刪 1 個字', () => {
		const flow = { ...base, customRoles: [{ id: 'r1', name: chars(10), meaning: '' }] };
		expect(updateCustomRole(flow, 'r1', { name: chars(9), meaning: '' }).kind).toBe('ok');
		expect(updateCustomRole(flow, 'r1', { name: chars(11), meaning: '' }).kind).toBe('blocked');
	});
});
