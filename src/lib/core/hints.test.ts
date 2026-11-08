import { describe, expect, it } from 'vitest';
import { actionHints, duplicateNames, musicOverrunSec, stackedMembers, type Member, type Segment } from './index';

const member = (id: string, name: string): Member => ({ id, name, gender: 'F', globalRole: 'base' });

describe('重複的名字', () => {
	it('去掉頭尾空白比，每個重複的名字列一次', () => {
		const members = [member('m1', '王小明'), member('m2', '阿強'), member('m3', ' 王小明'), member('m4', '王小明')];
		expect(duplicateNames(members)).toEqual(['王小明']);
	});

	it('沒有重複是空的', () => {
		expect(duplicateNames([member('m1', '甲'), member('m2', '乙')])).toEqual([]);
	});
});

describe('疊在同一點的人', () => {
	const members = [member('m1', '小A'), member('m2', '小B'), member('m3', '小C'), member('m4', '小D')];

	it('位置一樣的人一組，照名單順序；隔一格吸附點的不算', () => {
		const groups = stackedMembers(members, { m1: [1, 1], m2: [0, 0], m3: [1, 1], m4: [0.2286, 0] });
		expect(groups.map((g) => g.map((m) => m.name))).toEqual([['小A', '小C']]);
	});

	it('沒有位置的人不算', () => {
		expect(stackedMembers(members, { m1: [0, 0] })).toEqual([]);
	});
});

describe('動作的提醒', () => {
	const roles = (...r: (string | null)[]) => r.map((role, i) => ({ memberId: `m${i + 1}`, role }));

	it('技巧有上層卻沒有底層', () => {
		expect(actionHints({ category: 'stunt', members: roles('上層', '上層', '保護') })).toEqual([
			'有上層，但沒有底層（底層、主底、側底）'
		]);
	});

	it('有主底或側底就不提醒；還沒掛上層也不提醒', () => {
		expect(actionHints({ category: 'stunt', members: roles('上層', '主底') })).toEqual([]);
		expect(actionHints({ category: 'pyramid', members: roles('上層', '側底') })).toEqual([]);
		expect(actionHints({ category: 'stunt', members: roles(null, null) })).toEqual([]);
	});

	it('舞蹈、騰翻不看', () => {
		expect(actionHints({ category: 'dance', members: roles('上層') })).toEqual([]);
	});
});

describe('音樂段比音樂檔長', () => {
	const music = (firstBeatSec: number, halfBeats: number): Segment => ({
		id: 's1',
		kind: 'music',
		audioId: 'a1',
		bpm: 120,
		firstBeatSec,
		halfBeats
	});

	it('從第一拍算：第一拍 2 秒、段 32 秒，音樂 30 秒就超過 4 秒', () => {
		expect(musicOverrunSec(music(2, 128), 30)).toBeCloseTo(4);
	});

	it('第一拍在音樂結束之後：最多就是整段的長度（T06）', () => {
		expect(musicOverrunSec(music(40, 128), 30)).toBeCloseTo(32);
	});

	it('剛好或比較短是 0', () => {
		expect(musicOverrunSec(music(0, 120), 30)).toBe(0);
		expect(musicOverrunSec(music(0, 64), 30)).toBe(0);
	});
});
