// 一步記下的鍵、收到一步時要查的鍵（#254）：伺服器用它判斷「上次看到之後別的分頁改過同一個東西」。
import { describe, expect, it } from 'vitest';
import { addMembers, insertFormation, renameFlow, setPositions, updateMember } from './index';
import { stepKeys } from './step-keys';
import { flowOf, ratedSample } from '../test-flows';

const overlap = (a: string[], b: string[]) => a.some((k) => b.includes(k));

describe('stepKeys', () => {
	it('記下改到的東西', () => {
		const before = ratedSample();
		expect(stepKeys(before, flowOf(renameFlow(before, '新名字'))).keys).toEqual(['name']);
	});

	it('別人加了隊員，我插的站位（伺服器跑時多了那個人）算改到同一個東西', () => {
		const before = ratedSample();
		const withNew = flowOf(addMembers(before, [{ name: '小新', gender: 'F', globalRole: 'top' }]));
		const added = stepKeys(before, withNew);
		const inserted = stepKeys(withNew, flowOf(insertFormation(withNew, 3.2)));
		expect(overlap(inserted.watch, added.keys)).toBe(true);
	});

	it('改隊員名字跟拖那個人不算同一個東西', () => {
		const before = ratedSample();
		const renamed = stepKeys(before, flowOf(updateMember(before, 'm1', { name: '小美美' })));
		const opening = before.formations[0].id;
		const moved = stepKeys(before, flowOf(setPositions(before, opening, { m1: [1, 1] })));
		expect(overlap(moved.watch, renamed.keys)).toBe(false);
		expect(overlap(renamed.watch, moved.keys)).toBe(false);
	});
});
