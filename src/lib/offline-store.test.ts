// 離線存放存的樣子（#260）：新版讀得懂舊版存的；幾筆沒傳；哪些瀏覽器存的會被清掉（要提醒加到主畫面）。
import { describe, expect, it } from 'vitest';
import {
	copiesToDrop,
	isVolatileSafari,
	readCopy,
	readUnsent,
	storedCopy,
	storedUnsent,
	unsentCount,
	type OfflineCopy,
	type UnsentRecords
} from '#lib/offline-store.js';

const row = { id: 'tabc123def456', date: '2026-11-07', action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false };
const record = { actionId: 'x1', attempt: { id: 'tabc123def456', date: '2026-11-07', who: 'g1', practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } } };

describe('離線存放存的樣子', () => {
	it('第 1 版存的（寫死在這裡，之後改版也要讀得懂）讀得回來', () => {
		const v1 = {
			v: 1,
			flowId: 'c1',
			flowName: '區賽 2026',
			records: [{ record, row }],
			amends: [{ ids: ['tdef456abc123'], request: { kind: 'deleteRecords', ids: ['tdef456abc123'] } }],
			dropped: [row]
		};
		expect(readUnsent(v1)).toEqual({
			flowId: 'c1',
			flowName: '區賽 2026',
			records: [{ record, row }],
			amends: [{ ids: ['tdef456abc123'], request: { kind: 'deleteRecords', ids: ['tdef456abc123'] } }],
			dropped: [row]
		});
	});

	it('存了再讀回來一樣；缺的欄位當空的；讀不懂的（沒有版號、不認得的版號）不算', () => {
		const u: UnsentRecords = { flowId: 'c1', flowName: '測試', records: [{ record, row }], amends: [], dropped: [] };
		expect(readUnsent(storedUnsent(u))).toEqual(u);
		expect(readUnsent({ v: 1, flowId: 'c2' })).toEqual({ flowId: 'c2', flowName: '', records: [], amends: [], dropped: [] });
		expect(readUnsent({ flowId: 'c1' })).toBeNull();
		expect(readUnsent({ v: 99, flowId: 'c1' })).toBeNull();
		expect(readUnsent('壞掉的')).toBeNull();
	});

	it('幾筆沒傳：記了沒傳的、改了刪了沒送到的，同一次只算一筆；沒存進去的不算', () => {
		const u: UnsentRecords = {
			flowId: 'c1',
			flowName: '測試',
			records: [{ record, row }],
			amends: [
				{ ids: ['tabc123def456'], request: { kind: 'deleteRecords', ids: ['tabc123def456'] } },
				{ ids: ['tdef456abc123'], request: { kind: 'deleteRecords', ids: ['tdef456abc123'] } }
			],
			dropped: [row]
		};
		expect(unsentCount(u)).toBe(2);
	});
});

describe('離線副本存的樣子（#261）', () => {
	const copy = (flowId: string, openedAt: number): OfflineCopy => ({
		flowId,
		name: flowId,
		savedAt: openedAt,
		openedAt,
		role: 'owner',
		step: 3,
		flow: { name: flowId },
		records: []
	});

	it('第 1 版存的讀得回來；讀不懂的不算', () => {
		const v1 = { v: 1, flowId: 'c1', name: '區賽', savedAt: 5, openedAt: 6, role: 'recorder', step: 2, flow: { name: '區賽' }, records: [] };
		expect(readCopy(v1)).toEqual({ flowId: 'c1', name: '區賽', savedAt: 5, openedAt: 6, role: 'recorder', step: 2, flow: { name: '區賽' }, records: [] });
		expect(readCopy(storedCopy(copy('c2', 1)))).toEqual(copy('c2', 1));
		expect(readCopy({ v: 99, flowId: 'c1', flow: {} })).toBeNull();
		expect(readCopy({ v: 1, flowId: 'c1' })).toBeNull();
	});

	it('留最近打開的 5 支，再舊的刪掉；還有紀錄沒傳的那支不刪', () => {
		const all = [1, 2, 3, 4, 5, 6, 7].map((i) => copy(`c${i}`, i));
		expect(copiesToDrop(all, [])).toEqual(['c2', 'c1']);
		const unsent: UnsentRecords = { flowId: 'c1', flowName: 'c1', records: [{ record, row }], amends: [], dropped: [] };
		expect(copiesToDrop(all, [unsent])).toEqual(['c2']);
		// 只剩沒存進去的清單（不算沒傳）：照樣刪
		expect(copiesToDrop(all, [{ ...unsent, records: [], dropped: [row] }])).toEqual(['c2', 'c1']);
	});
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

describe('存的會被清掉（提醒加到主畫面）', () => {
	it('iPhone、iPad 的 Safari，不是從主畫面打開的才算', () => {
		expect(isVolatileSafari(IPHONE, 5, false)).toBe(true);
		expect(isVolatileSafari(IPAD, 5, false)).toBe(true);
		// 從主畫面打開的
		expect(isVolatileSafari(IPHONE, 5, true)).toBe(false);
		// 電腦的 Safari（沒有觸控）、iPhone 上的 Chrome、Android
		expect(isVolatileSafari(IPAD, 0, false)).toBe(false);
		expect(isVolatileSafari(IOS_CHROME, 5, false)).toBe(false);
		expect(isVolatileSafari(ANDROID, 5, false)).toBe(false);
	});
});
