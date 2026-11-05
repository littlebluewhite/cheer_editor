import { describe, expect, it } from 'vitest';
import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	createFlow,
	deleteCustomRole,
	placeCue,
	roleGlossary,
	updateCustomRole
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

describe('改、刪自訂任務角色', () => {
	/** 自訂角色「丟人的」(r1)；小A 在 x1 是丟人的，x1 有一個給丟人的拍點、一個給全部的。 */
	function used() {
		let flow = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' }));
		flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'base' }]));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(
			addAction(flow, {
				segmentId: 's1',
				category: 'pyramid',
				name: '收尾',
				start: 0,
				length: 8,
				note: '',
				members: [{ memberId: 'm1', role: '丟人的' }]
			})
		);
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 0, len: 2, word: '放', who: { role: '丟人的' } }));
		return flowOf(placeCue(flow, 'x1', { kind: 'step', at: 2, len: 2, word: '上' }));
	}

	it('改名：名詞對照表、動作裡的人、給這個角色的拍點都跟著改', () => {
		const flow = flowOf(updateCustomRole(used(), 'r1', { name: ' 拋人的 ', meaning: '把上層拋給中層' }));
		expect(flow.customRoles).toEqual([{ id: 'r1', name: '拋人的', meaning: '把上層拋給中層' }]);
		expect(flow.actions[0].members[0].role).toBe('拋人的');
		expect(flow.actions[0].cues!.map((c) => c.who)).toEqual([{ role: '拋人的' }, null]);
	});

	it('改名不能空、不能跟別的角色重複；跟自己原本的名字一樣可以（只改意思）', () => {
		let flow = flowOf(addCustomRole(used(), { name: '抬腳的', meaning: '' }));
		expect(updateCustomRole(flow, 'r1', { name: ' ', meaning: '' })).toEqual({ kind: 'blocked', message: '請填任務角色名稱' });
		expect(updateCustomRole(flow, 'r1', { name: '抬腳的', meaning: '' }).kind).toBe('blocked');
		expect(updateCustomRole(flow, 'r1', { name: '主底', meaning: '' }).kind).toBe('blocked');
		flow = flowOf(updateCustomRole(flow, 'r1', { name: '丟人的', meaning: '新的意思' }));
		expect(flow.customRoles[0].meaning).toBe('新的意思');
	});

	it('刪掉沒人用的角色：直接刪', () => {
		const flow = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' }));
		expect(flowOf(deleteCustomRole(flow, 'r1')).customRoles).toEqual([]);
	});

	it('有人用的角色先問，列出動作；確定後那些人變成沒有任務，給這個角色的拍點刪掉', () => {
		const r = deleteCustomRole(used(), 'r1');
		expect(r).toEqual({
			kind: 'confirm',
			message: '「丟人的」用在 1 個動作裡：刪掉後那些人變成沒有任務，給「丟人的」的拍點也會刪掉',
			items: ['金字塔·收尾']
		});
		const flow = flowOf(deleteCustomRole(used(), 'r1', { confirmed: true }));
		expect(flow.customRoles).toEqual([]);
		expect(flow.actions[0].members[0].role).toBeNull();
		expect(flow.actions[0].cues!.map((c) => c.word)).toEqual(['上']);
	});

	it('找不到角色就擋下', () => {
		expect(deleteCustomRole(empty(), 'r9').kind).toBe('blocked');
		expect(updateCustomRole(empty(), 'r9', { name: '甲', meaning: '' }).kind).toBe('blocked');
	});
});
