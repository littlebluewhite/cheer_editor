import { describe, expect, it } from 'vitest';
import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	createFlow,
	defaultRoles,
	deleteCustomRole,
	pickableRoles,
	placeCue,
	roleGlossary,
	updateCustomRole
} from './index';
import { flowOf } from '../test-flows';

const empty = () => flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));

describe('任務角色', () => {
	it('名詞對照表先列 13 個固定角色（名稱、意思、規則上的叫法），照撐人的、被撐的、保護的、其他分群', () => {
		const rows = roleGlossary(empty());
		expect(rows.map((r) => r.name)).toEqual([
			'底層', '主底', '側底', '肩底', '上層', '中層', '三層', '支撐', '保護', '前保', '後保', '接者', '騰翻'
		]);
		expect(rows.map((r) => r.group)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3]);
		expect(rows[3]).toEqual({
			name: '肩底',
			meaning: '金字塔裡站在地上、讓中層站在自己肩上的底層。只有金字塔有。',
			ruleName: '底層人員（規則沒有「肩底」）',
			custom: false,
			group: 0
		});
		expect(rows[1]).toEqual({
			name: '主底',
			meaning: '主要撐住上層腳的底層。單底層技巧的那位底層。',
			ruleName: '底層人員（台灣規則沒有「主底」）',
			custom: false,
			group: 0
		});
	});

	it('任務角色選單：三層、肩底只有金字塔有；已經是的人換了大類也看得到這一項', () => {
		const names = (category: Parameters<typeof pickableRoles>[1], current?: string) =>
			pickableRoles(empty(), category, current ? [current] : []).map((r) => r.name);
		for (const role of ['三層', '肩底']) {
			expect(names('pyramid')).toContain(role);
			expect(names('stunt')).not.toContain(role);
			expect(names('toss')).not.toContain(role);
			expect(names('stunt', role)).toContain(role);
		}
	});

	it('快捷鍵跟著角色固定：技巧沒有肩底，上層還是 5；自訂角色接在固定的後面', () => {
		const flow = flowOf(addCustomRole(empty(), { name: '旗手', meaning: '' }));
		const keys = (category: Parameters<typeof pickableRoles>[1]) =>
			Object.fromEntries(pickableRoles(flow, category, []).map((r) => [r.name, r.key]));
		expect(keys('stunt')).toMatchObject({ 底層: '1', 上層: '5', 中層: '6', 支撐: '8', 騰翻: 'e', 旗手: 'r' });
		expect(keys('pyramid')).toMatchObject({ 肩底: '4', 上層: '5', 三層: '7', 旗手: 'r' });
	});

	it('自訂角色存在這支流程裡，接在對照表後面', () => {
		const flow = flowOf(addCustomRole(empty(), { name: ' 丟人的 ', meaning: '把上層丟給中層接' }));
		expect(flow.customRoles).toEqual([{ id: 'r1', name: '丟人的', meaning: '把上層丟給中層接' }]);
		expect(roleGlossary(flow).at(-1)).toEqual({
			name: '丟人的',
			meaning: '把上層丟給中層接',
			ruleName: '',
			custom: true,
			group: 4
		});
	});

	it('名稱不能空、不能跟固定或自訂角色重複', () => {
		const flow = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' }));
		expect(addCustomRole(flow, { name: ' ', meaning: '' })).toEqual({
			kind: 'blocked',
			message: '請填任務角色名稱',
			why: { code: 'roles_no_name' }
		});
		expect(addCustomRole(flow, { name: '丟人的', meaning: '' })).toEqual({
			kind: 'blocked',
			message: '已經有「丟人的」這個任務角色了',
			why: { code: 'roles_name_taken', name: '丟人的' }
		});
		expect(addCustomRole(flow, { name: '後保', meaning: '' })).toEqual({
			kind: 'blocked',
			message: '已經有「後保」這個任務角色了',
			why: { code: 'roles_name_taken', name: '後保' }
		});
	});

	it('名稱不能跟隊員同名（拍點的「給誰」才分得出是角色還是人）：加的時候和改名的時候都擋', () => {
		let flow = flowOf(addMembers(empty(), [{ name: '小華', gender: 'F', globalRole: 'top' }]));
		const message = '已經有叫「小華」的隊員了，任務角色取別的名稱，拍點的「給誰」才分得出是角色還是人';
		const why = { code: 'roles_member_name_taken', name: '小華' };
		expect(addCustomRole(flow, { name: ' 小華 ', meaning: '' })).toEqual({ kind: 'blocked', message, why });
		flow = flowOf(addCustomRole(flow, { name: '丟人的', meaning: '' }));
		expect(updateCustomRole(flow, 'r1', { name: '小華', meaning: '' })).toEqual({ kind: 'blocked', message, why });
	});

	it('名稱最多 8 個字：加的時候和改名的時候都擋；開檔進來就超過的，沒改名可以改意思', () => {
		expect(addCustomRole(empty(), { name: '一二三四五六七八', meaning: '' }).kind).toBe('ok');
		expect(addCustomRole(empty(), { name: '一二三四五六七八九', meaning: '' })).toEqual({
			kind: 'blocked',
			message: '任務角色名稱最多 8 個字'
		});
		const added = flowOf(addCustomRole(empty(), { name: '丟人的', meaning: '' }));
		expect(updateCustomRole(added, 'r1', { name: '一二三四五六七八九', meaning: '' }).kind).toBe('blocked');
		const long = '字'.repeat(30);
		const flow = { ...added, customRoles: [{ ...added.customRoles[0], name: long }] };
		expect(flowOf(updateCustomRole(flow, 'r1', { name: long, meaning: '新的意思' })).customRoles[0].meaning).toBe('新的意思');
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
		expect(updateCustomRole(flow, 'r1', { name: ' ', meaning: '' })).toEqual({
			kind: 'blocked',
			message: '請填任務角色名稱',
			why: { code: 'roles_no_name' }
		});
		expect(updateCustomRole(flow, 'r1', { name: '抬腳的', meaning: '' })).toEqual({
			kind: 'blocked',
			message: '已經有「抬腳的」這個任務角色了',
			why: { code: 'roles_name_taken', name: '抬腳的' }
		});
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
			why: { code: 'roles_delete_used_one', name: '丟人的', count: 1 },
			items: ['金字塔·收尾']
		});
		const flow = flowOf(deleteCustomRole(used(), 'r1', { confirmed: true }));
		expect(flow.customRoles).toEqual([]);
		expect(flow.actions[0].members[0].role).toBeNull();
		expect(flow.actions[0].cues!.map((c) => c.word)).toEqual(['上']);
	});

	it('用在好幾個動作裡：一樣先問，寫幾個動作', () => {
		const flow = flowOf(
			addAction(used(), {
				segmentId: 's1',
				category: 'stunt',
				name: '托',
				start: 8,
				length: 8,
				note: '',
				members: [{ memberId: 'm1', role: '丟人的' }]
			})
		);
		expect(deleteCustomRole(flow, 'r1')).toMatchObject({
			kind: 'confirm',
			message: '「丟人的」用在 2 個動作裡：刪掉後那些人變成沒有任務，給「丟人的」的拍點也會刪掉',
			why: { code: 'roles_delete_used', name: '丟人的', count: 2 }
		});
	});

	it('找不到角色就擋下', () => {
		const notFound = { kind: 'blocked', message: '找不到這個任務角色', why: { code: 'roles_not_found' } };
		expect(deleteCustomRole(empty(), 'r9')).toEqual(notFound);
		expect(updateCustomRole(empty(), 'r9', { name: '甲', meaning: '' })).toEqual(notFound);
	});
});

describe('任務角色的預設值（加人進動作時先照全局角色填）', () => {
	/** 小A 上層、小B 底層、小C 底層。 */
	const team = () =>
		flowOf(
			addMembers(empty(), [
				{ name: '小A', gender: 'F', globalRole: 'top' },
				{ name: '小B', gender: 'M', globalRole: 'base' },
				{ name: '小C', gender: 'M', globalRole: 'base' }
			])
		);
	const blank = [
		{ memberId: 'm1', role: null },
		{ memberId: 'm2', role: null }
	];

	it('技巧、金字塔、拋投：全局底層填「底層」、全局上層填「上層」', () => {
		for (const category of ['stunt', 'pyramid', 'toss'] as const) {
			expect(defaultRoles(team(), category, blank)).toEqual([
				{ memberId: 'm1', role: '上層' },
				{ memberId: 'm2', role: '底層' }
			]);
		}
	});

	it('騰翻：都填「騰翻」', () => {
		expect(defaultRoles(team(), 'tumbling', blank)).toEqual([
			{ memberId: 'm1', role: '騰翻' },
			{ memberId: 'm2', role: '騰翻' }
		]);
	});

	it('跳躍、舞蹈、其他：不填', () => {
		for (const category of ['jump', 'dance', 'other'] as const) {
			expect(defaultRoles(team(), category, blank)).toEqual(blank);
		}
	});

	it('已經指定任務角色的人不動（組也留著）', () => {
		const members = [
			{ memberId: 'm1', role: '中層', squad: 'g1' },
			{ memberId: 'm2', role: null }
		];
		expect(defaultRoles(team(), 'stunt', members)).toEqual([
			{ memberId: 'm1', role: '中層', squad: 'g1' },
			{ memberId: 'm2', role: '底層' }
		]);
	});

	it('換大類（from）：還是舊大類預設值的人換成新大類的；改過的、清掉的不動', () => {
		const members = [
			{ memberId: 'm1', role: '上層' },
			{ memberId: 'm2', role: '主底' },
			{ memberId: 'm3', role: null }
		];
		expect(defaultRoles(team(), 'tumbling', members, 'stunt')).toEqual([
			{ memberId: 'm1', role: '騰翻' },
			{ memberId: 'm2', role: '主底' },
			{ memberId: 'm3', role: null }
		]);
		// 從不填的大類換過來：沒有任務的人照新大類填
		expect(defaultRoles(team(), 'stunt', [{ memberId: 'm3', role: null }], 'jump')).toEqual([
			{ memberId: 'm3', role: '底層' }
		]);
	});
});
