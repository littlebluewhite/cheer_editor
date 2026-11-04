import { describe, expect, it } from 'vitest';
import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	createFlow,
	roleGlossary
} from './index';
import { flowOf } from '../test-flows';

const empty = () => flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));

describe('任務角色', () => {
	it('名詞對照表先列 11 個固定角色（名稱、意思、規則上的叫法）', () => {
		const rows = roleGlossary(empty());
		expect(rows.map((r) => r.name)).toEqual([
			'底層', '主底', '側底', '上層', '中層', '保護', '前保', '後保', '接者', '支撐', '騰翻'
		]);
		expect(rows[1]).toEqual({
			name: '主底',
			meaning: '主要撐住上層腳的底層。單底層技巧的那位底層。',
			ruleName: '底層人員（台灣規則沒有「主底」）',
			custom: false
		});
	});

	it('自訂角色存在這支流程裡，接在對照表後面', () => {
		const flow = flowOf(addCustomRole(empty(), { name: ' 丟人的 ', meaning: '把上層丟給中層接' }));
		expect(flow.customRoles).toEqual([{ id: 'r1', name: '丟人的', meaning: '把上層丟給中層接' }]);
		expect(roleGlossary(flow).at(-1)).toEqual({
			name: '丟人的',
			meaning: '把上層丟給中層接',
			ruleName: '',
			custom: true
		});
	});

	it('名稱不能空、不能跟固定或自訂角色重複', () => {
		const flow = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' }));
		expect(addCustomRole(flow, { name: ' ', meaning: '' })).toEqual({
			kind: 'blocked',
			message: '請填任務角色名稱'
		});
		expect(addCustomRole(flow, { name: '丟人的', meaning: '' })).toEqual({
			kind: 'blocked',
			message: '已經有「丟人的」這個任務角色了'
		});
		expect(addCustomRole(flow, { name: '後保', meaning: '' }).kind).toBe('blocked');
	});

	it('自訂角色可以掛在動作裡的人身上', () => {
		let flow = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' }));
		flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'base' }]));
		flow = flowOf(addSegment(flow, 'music'));
		const r = addAction(flow, {
			segmentId: 's1',
			category: 'pyramid',
			name: '',
			start: 0,
			length: 8,
			note: '',
			members: [{ memberId: 'm1', role: '丟人的' }]
		});
		expect(r.kind).toBe('ok');
	});
});
