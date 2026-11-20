import { describe, expect, it } from 'vitest';
import {
	addBookmark,
	addSegment,
	bookmarkSeconds,
	checkFlowDocument,
	createFlow,
	deleteBookmark,
	flowProblem,
	insertBeats,
	readFlowFile,
	writeFlowFile,
	renameBookmark,
	runCommand,
	startAt,
	updateSegment,
	type Command,
	type Flow,
	type TimePosition
} from './index';
import { zipSync, strToU8 } from 'fflate';
import { flowOf } from '../test-flows';

/** 120 BPM：一拍 0.5 秒、一個半拍 0.25 秒、一個八拍 4 秒。音樂 1（s1）、音樂 2（s2）各 2 個八拍（32 個半拍、8 秒）。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	for (const id of ['s1', 's2']) {
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(updateSegment(flow, id, { bpm: 120, eights: 2, lastBeats: 8 }));
	}
	return flow;
}

const at = (segmentId: string, n: number): TimePosition => ({ segmentId, at: n });

/** 照名字＋參數跑（跟畫面、伺服器一樣，跑完會清掉放不下的書籤）。 */
function run(flow: Flow, command: Command) {
	return runCommand(flow, command, 'step');
}

describe('addBookmark', () => {
	it('存只有 A 的書籤，也可以存 A 到 B 的', () => {
		let flow = flowOf(addBookmark(sample(), '開場', at('s1', 0), null));
		flow = flowOf(addBookmark(flow, ' 翻騰 ', at('s1', 8), at('s2', 4)));
		expect(flow.bookmarks).toEqual([
			{ id: 'k1', name: '開場', a: at('s1', 0), b: null },
			{ id: 'k2', name: '翻騰', a: at('s1', 8), b: at('s2', 4) }
		]);
		expect(bookmarkSeconds(flow, flow.bookmarks![1])).toEqual({ a: 2, b: 9 });
	});

	it('B 剛好在段的交界：記成前一段的結尾（只在音樂 1 裡）', () => {
		const flow = flowOf(addBookmark(sample(), '音樂 1 全部', at('s1', 0), at('s2', 0)));
		expect(flow.bookmarks![0].b).toEqual(at('s1', 32));
	});

	it('A 剛好在段的交界：記成後一段的開頭', () => {
		const flow = flowOf(addBookmark(sample(), '音樂 2', at('s1', 32), null));
		expect(flow.bookmarks![0].a).toEqual(at('s2', 0));
	});

	it('名字空的、太長，A 在流程結尾，B 不在 A 後面：擋下', () => {
		const flow = sample();
		expect(addBookmark(flow, '  ', at('s1', 0), null)).toMatchObject({ kind: 'blocked', message: '請幫書籤取名字' });
		expect(addBookmark(flow, '一二三四五六七八九十一二三四五六七八九十一', at('s1', 0), null)).toMatchObject({ kind: 'blocked' });
		expect(addBookmark(flow, '尾', at('s2', 32), null)).toMatchObject({ kind: 'blocked' });
		expect(addBookmark(flow, '倒', at('s1', 8), at('s1', 8))).toMatchObject({ kind: 'blocked', message: 'B 要在 A 後面' });
		expect(addBookmark(flow, '沒段', at('s9', 0), null)).toMatchObject({ kind: 'blocked' });
	});

	it('同一個 A、B 已經有書籤：擋下，說是哪個（交界兩種寫法算同一個）', () => {
		let flow = flowOf(addBookmark(sample(), '音樂 1', at('s1', 0), at('s1', 32)));
		expect(addBookmark(flow, '又一個', at('s1', 0), at('s2', 0))).toEqual({
			kind: 'blocked',
			message: '這裡已經有書籤「音樂 1」了'
		});
		// 名字空的也先講位置重複（換名字也存不了）
		expect(addBookmark(flow, '  ', at('s1', 0), at('s1', 32))).toEqual({
			kind: 'blocked',
			message: '這裡已經有書籤「音樂 1」了'
		});
		flow = flowOf(addBookmark(flow, '開場', at('s1', 0), null));
		expect(addBookmark(flow, '開場 2', at('s1', 0), null)).toMatchObject({ kind: 'blocked' });
		// A 一樣、B 不一樣：可以
		expect(addBookmark(flow, '前半', at('s1', 0), at('s1', 16)).kind).toBe('ok');
	});
});

describe('renameBookmark、deleteBookmark', () => {
	it('改名、刪掉', () => {
		let flow = flowOf(addBookmark(sample(), '開場', at('s1', 0), null));
		flow = flowOf(renameBookmark(flow, 'k1', ' 起頭 '));
		expect(flow.bookmarks![0].name).toBe('起頭');
		expect(renameBookmark(flow, 'k1', '')).toMatchObject({ kind: 'blocked' });
		expect(renameBookmark(flow, 'k9', 'x')).toMatchObject({ kind: 'blocked', message: '找不到這個書籤' });
		flow = flowOf(deleteBookmark(flow, 'k1'));
		expect(flow.bookmarks).toEqual([]);
	});
});

describe('startAt', () => {
	it('吸到最近的整拍；段的交界算後一段', () => {
		const flow = sample();
		expect(startAt(flow, 2.1)).toEqual(at('s1', 8));
		expect(startAt(flow, 8)).toEqual(at('s2', 0));
	});
});

describe('改段時書籤跟著動', () => {
	const withBookmarks = () => {
		let flow = flowOf(addBookmark(sample(), '音樂 1', at('s1', 0), at('s1', 32)));
		flow = flowOf(addBookmark(flow, '跨段', at('s1', 16), at('s2', 8)));
		flow = flowOf(addBookmark(flow, '音樂 2', at('s2', 4), null));
		return flow;
	};
	const names = (flow: Flow) => flow.bookmarks!.map((b) => b.name);

	it('刪段：先問（列出書籤），確定後 A 或 B 在那段的書籤一起刪；只在別段的留著', () => {
		const flow = withBookmarks();
		const asked = run(flow, { name: 'deleteSegment', args: ['s2'] });
		expect(asked).toMatchObject({ kind: 'confirm' });
		expect(asked.kind === 'confirm' && asked.items).toEqual(['書籤「跨段」', '書籤「音樂 2」']);
		const done = flowOf(run(flow, { name: 'deleteSegment', args: ['s2'], options: { confirmed: true } }));
		expect(names(done)).toEqual(['音樂 1']);
	});

	it('段換順序：B 跑到 A 前面的書籤拿掉，其他照留（跟著自己的段走）', () => {
		const done = flowOf(run(withBookmarks(), { name: 'moveSegment', args: ['s2', -1] }));
		expect(names(done)).toEqual(['音樂 1', '音樂 2']);
		expect(bookmarkSeconds(done, done.bookmarks![0])).toEqual({ a: 8, b: 16 });
	});

	it('切段：開始在切點以後的搬到新段，結尾剛好在切點的留在前一段', () => {
		const flow = flowOf(addBookmark(sample(), '前半', at('s1', 0), at('s1', 16)));
		const withLate = flowOf(addBookmark(flow, '後半', at('s1', 16), at('s1', 32)));
		const done = flowOf(run(withLate, { name: 'splitSegment', args: ['s1', 4] }));
		const added = done.segments[1].id;
		expect(done.bookmarks!.map((b) => [b.a, b.b])).toEqual([
			[at('s1', 0), at('s1', 16)],
			[at(added, 0), at(added, 16)]
		]);
	});

	it('插入八拍：開始在插入點以後的往後延，結尾在插入點以後的也延；結尾在段尾的留在段尾', () => {
		let flow = flowOf(addBookmark(sample(), '中間', at('s1', 8), at('s1', 16)));
		flow = flowOf(addBookmark(flow, '到段尾', at('s1', 4), at('s1', 32)));
		flow = flowOf(addBookmark(flow, '前面', at('s1', 0), at('s1', 8)));
		const done = flowOf(insertBeats(flow, at('s1', 8), 4));
		expect(done.bookmarks!.map((b) => [b.a.at, b.b?.at])).toEqual([
			[12, 20],
			[4, 32],
			[0, 8]
		]);
	});

	it('插入八拍：書籤會被擠出段尾就擋下，說是哪個', () => {
		const flow = flowOf(addBookmark(sample(), '尾巴', at('s1', 24), at('s1', 28)));
		expect(insertBeats(flow, at('s1', 0), 8)).toMatchObject({ kind: 'blocked', message: expect.stringContaining('書籤「尾巴」') });
		expect(insertBeats(flow, at('s1', 0), 4).kind).toBe('ok');
	});

	it('插入八拍：會讓兩個書籤變成同一個地方就擋下，說是哪兩個', () => {
		let flow = flowOf(addBookmark(sample(), '前半', at('s1', 0), at('s1', 16)));
		flow = flowOf(addBookmark(flow, '整段', at('s1', 0), at('s1', 32)));
		const r = insertBeats(flow, at('s1', 8), 16);
		expect(r).toMatchObject({ kind: 'blocked', message: expect.stringMatching(/「前半」.*「整段」/) });
		expect(insertBeats(flow, at('s1', 8), 8).kind).toBe('ok');
	});

	it('段縮短：放不進段裡的書籤列在確認清單上，確定後拿掉', () => {
		const flow = withBookmarks();
		const asked = run(flow, { name: 'updateSegment', args: ['s2', { eights: 1, lastBeats: 3 }] });
		expect(asked.kind === 'confirm' && asked.items).toEqual(['刪掉：書籤「跨段」']);
		const done = flowOf(
			run(flow, { name: 'updateSegment', args: ['s2', { eights: 1, lastBeats: 3 }], options: { confirmed: true } })
		);
		expect(names(done)).toEqual(['音樂 1', '音樂 2']);
	});
});

describe('流程檔（第 16 版）', () => {
	const zipOf = (doc: unknown) => zipSync({ 'flow.json': strToU8(JSON.stringify(doc)) });
	const withBookmark = () => flowOf(addBookmark(sample(), '翻騰', at('s1', 8), at('s2', 4)));

	it('書籤存進檔，讀得回來', () => {
		const flow = withBookmark();
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.flow.bookmarks).toEqual(flow.bookmarks);
	});

	it('第 15 版的檔沒有書籤：資料不用動', () => {
		const flow = sample();
		const r = readFlowFile(zipOf({ formatVersion: 15, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
	});

	it.each([
		['書籤的名字不是字', (f: Flow) => ((f.bookmarks![0] as { name: unknown }).name = 3)],
		['書籤的格子不是整數', (f: Flow) => (f.bookmarks![0].a.at = 1.5)],
		['書籤不是清單', (f: Flow) => ((f as { bookmarks: unknown }).bookmarks = {})]
	])('%s：資料壞掉', (_, breakIt) => {
		const flow = structuredClone(withBookmark());
		breakIt(flow);
		expect(readFlowFile(zipOf({ formatVersion: 16, flow }))).toEqual({ kind: 'error', message: '流程檔裡的資料壞掉了' });
	});

	// 手改過的檔才會這樣（改段的指令跑完都會拿掉放不下的書籤）：只丟那一個、說出來，流程照開
	const LOST: [string, (f: Flow) => void][] = [
		['指到不存在的段', (f) => (f.bookmarks![0].a = at('s9', 0))],
		['B 指到不存在的段', (f) => (f.bookmarks![0].b = at('s9', 0))],
		['B 在段外', (f) => (f.bookmarks![0].b = at('s2', 40))],
		['B 在 A 前面', (f) => (f.bookmarks![0].b = at('s1', 4))]
	];
	const withTwo = () => structuredClone(flowOf(addBookmark(withBookmark(), '開場', at('s1', 0), null)));

	it.each(LOST)('開檔：書籤%s：拿掉那一個、說名字，其他照開', (_, breakIt) => {
		const flow = withTwo();
		breakIt(flow);
		const r = readFlowFile(zipOf({ formatVersion: 16, flow }));
		expect(r.kind === 'ok' && r.droppedBookmarks).toEqual(['翻騰']);
		expect(r.kind === 'ok' && r.flow.bookmarks!.map((b) => b.name)).toEqual(['開場']);
	});

	it('開檔：兩個書籤同一個 id：後面那個換一個新的 id，兩個都留著', () => {
		const flow = withTwo();
		flow.bookmarks![1].id = flow.bookmarks![0].id;
		const r = readFlowFile(zipOf({ formatVersion: 16, flow }));
		expect(r.kind === 'ok' && r.droppedBookmarks).toEqual([]);
		const ids = r.kind === 'ok' ? r.flow.bookmarks!.map((b) => b.id) : [];
		expect(ids[0]).toBe(flow.bookmarks![0].id);
		expect(new Set(ids).size).toBe(2);
	});

	it.each([
		...LOST,
		['兩個書籤同一個 id', (f: Flow) => (f.bookmarks![1].id = f.bookmarks![0].id)] as [string, (f: Flow) => void]
	])('傳上雲端（伺服器的檢查）：書籤%s照樣擋', (_, breakIt) => {
		const flow = withTwo();
		breakIt(flow);
		expect(checkFlowDocument({ formatVersion: 16, flow }).kind).toBe('error');
	});

	it('整份流程檢查：書籤跑到段外一律擋（開檔也擋）；名字太長、兩個書籤同一個地方只擋這一步新出現的', () => {
		const flow = withBookmark();
		const outside = { ...flow, bookmarks: [{ ...flow.bookmarks![0], b: at('s2', 40) }] };
		expect(flowProblem(outside, flow)).toBe('書籤「翻騰」的位置不在流程裡');
		expect(flowProblem(outside, outside)).toBe('書籤「翻騰」的位置不在流程裡');
		const long = { ...flow, bookmarks: [{ ...flow.bookmarks![0], name: '一'.repeat(21) }] };
		expect(flowProblem(long, flow)).toMatch(/書籤名字/);
		const twice = { ...flow, bookmarks: [...flow.bookmarks!, { ...flow.bookmarks![0], id: 'k9', name: '又一個' }] };
		expect(flowProblem(twice, flow)).toBe('書籤「翻騰」和「又一個」在同一個地方');
		expect(flowProblem(twice, twice)).toBeNull();
	});
});
