import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
	BOOKMARK_EDGES,
	REPEAT_EDGES,
	addBookmark,
	addSegment,
	anchoredSeconds,
	bookmarkSeconds,
	createFlow,
	flowProblem,
	insertBeats,
	rangeSeconds,
	readFlowFile,
	runCommand,
	updateSegment,
	type Command,
	type Flow,
	type TimePosition
} from './index';
import { flowOf } from '../test-flows';

/** 120 BPM：一拍 0.5 秒、一個半拍 0.25 秒。音樂 1（s1）、音樂 2（s2）各 2 個八拍（32 個半拍、8 秒）。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	for (const id of ['s1', 's2']) {
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(updateSegment(flow, id, { bpm: 120, eights: 2, lastBeats: 8 }));
	}
	return flow;
}

const at = (segmentId: string, n: number): TimePosition => ({ segmentId, at: n });
const run = (flow: Flow, command: Command) => runCommand(flow, command, 'step');

describe('錨在段上的範圍：秒數、放不放得下', () => {
	it('A 在段頭：書籤和重複範圍都放得下', () => {
		const r = { a: at('s2', 0), b: null };
		expect(anchoredSeconds(sample(), r, BOOKMARK_EDGES)).toEqual({ a: 8, b: null });
		expect(anchoredSeconds(sample(), r, REPEAT_EDGES)).toEqual({ a: 8, b: null });
	});

	it('A 在段尾：重複範圍可以（就是下一段的開頭），書籤不行（書籤的 A 記成下一段的開頭）', () => {
		const r = { a: at('s1', 32), b: at('s2', 8) };
		expect(anchoredSeconds(sample(), r, REPEAT_EDGES)).toEqual({ a: 8, b: 10 });
		expect(anchoredSeconds(sample(), r, BOOKMARK_EDGES)).toBeNull();
		expect(rangeSeconds(sample(), r)).toEqual({ a: 8, b: 10 });
		expect(bookmarkSeconds(sample(), r)).toBeNull();
	});

	it('B 在段尾：兩邊都可以', () => {
		const r = { a: at('s1', 0), b: at('s1', 32) };
		expect(anchoredSeconds(sample(), r, BOOKMARK_EDGES)).toEqual({ a: 0, b: 8 });
		expect(anchoredSeconds(sample(), r, REPEAT_EDGES)).toEqual({ a: 0, b: 8 });
	});

	it('B 在段頭：重複範圍可以（播放頭停在段的交界拉出來的範圍），書籤不行（書籤的 B 記成上一段的結尾）', () => {
		const r = { a: at('s1', 0), b: at('s2', 0) };
		expect(anchoredSeconds(sample(), r, REPEAT_EDGES)).toEqual({ a: 0, b: 8 });
		expect(anchoredSeconds(sample(), r, BOOKMARK_EDGES)).toBeNull();
	});

	it('半拍：格子照原樣換成秒數，不吸到整拍', () => {
		const r = { a: at('s1', 3), b: at('s1', 5) };
		expect(anchoredSeconds(sample(), r, BOOKMARK_EDGES)).toEqual({ a: 0.75, b: 1.25 });
		expect(anchoredSeconds(sample(), r, REPEAT_EDGES)).toEqual({ a: 0.75, b: 1.25 });
	});

	it('格子不是整數、是負的：書籤放不下；重複範圍不檢查（範圍都是吸過或動作拉出來的整數格）', () => {
		expect(anchoredSeconds(sample(), { a: at('s1', 2.5), b: null }, BOOKMARK_EDGES)).toBeNull();
		expect(anchoredSeconds(sample(), { a: at('s1', -1), b: null }, BOOKMARK_EDGES)).toBeNull();
		expect(anchoredSeconds(sample(), { a: at('s1', 2.5), b: null }, REPEAT_EDGES)).toEqual({ a: 0.625, b: null });
	});

	it('段不見、格子在段尾後面、B 不在 A 後面：兩邊都放不下', () => {
		for (const edges of [BOOKMARK_EDGES, REPEAT_EDGES]) {
			expect(anchoredSeconds(sample(), { a: at('s9', 0), b: null }, edges)).toBeNull();
			expect(anchoredSeconds(sample(), { a: at('s1', 0), b: at('s9', 4) }, edges)).toBeNull();
			expect(anchoredSeconds(sample(), { a: at('s1', 0), b: at('s1', 33) }, edges)).toBeNull();
			expect(anchoredSeconds(sample(), { a: at('s1', 8), b: at('s1', 8) }, edges)).toBeNull();
			expect(anchoredSeconds(sample(), { a: at('s2', 0), b: at('s1', 8) }, edges)).toBeNull();
		}
	});
});

describe('新增書籤被同一個地方的書籤擋下', () => {
	it('結果帶撞到的那個書籤的 id，字照舊', () => {
		let flow = flowOf(addBookmark(sample(), '開場', at('s1', 0), null));
		flow = flowOf(addBookmark(flow, '音樂 1', at('s1', 0), at('s1', 32)));
		// 交界兩種寫法算同一個地方
		expect(addBookmark(flow, '又一個', at('s1', 0), at('s2', 0))).toEqual({
			kind: 'blocked',
			message: '這裡已經有書籤「音樂 1」了',
			why: { code: 'bookmarks_same_place', name: '音樂 1' },
			bookmarkId: 'k2'
		});
	});

	it('照名字跑指令（畫面、伺服器）也帶著 id', () => {
		const flow = flowOf(addBookmark(sample(), '開場', at('s1', 3), null));
		expect(run(flow, { name: 'addBookmark', args: ['開場 2', at('s1', 3), null] })).toMatchObject({
			kind: 'blocked',
			bookmarkId: 'k1'
		});
	});

	it('別的原因擋下（例：段不見了）不帶 id', () => {
		const flow = flowOf(addBookmark(sample(), '開場', at('s1', 0), null));
		const r = addBookmark(flow, '沒段', at('s9', 0), null);
		expect(r.kind).toBe('blocked');
		expect(r).not.toHaveProperty('bookmarkId');
	});
});

describe('改段時錨在段上的範圍', () => {
	it('插入八拍讓兩個書籤撞在一起：擋下，說是哪兩個', () => {
		let flow = flowOf(addBookmark(sample(), '前半', at('s1', 0), at('s1', 16)));
		flow = flowOf(addBookmark(flow, '整段', at('s1', 0), at('s1', 32)));
		expect(insertBeats(flow, at('s1', 8), 16)).toMatchObject({
			kind: 'blocked',
			why: { code: 'insert_beats_same_bookmark', first: '前半', second: '整段' }
		});
	});

	it('插入八拍：A 在插入點延後，B 剛好在插入點的不動；A 在段尾的下一段開頭不動', () => {
		let flow = flowOf(addBookmark(sample(), '前面', at('s1', 0), at('s1', 8)));
		flow = flowOf(addBookmark(flow, '後面', at('s1', 8), at('s1', 16)));
		flow = flowOf(addBookmark(flow, '音樂 2', at('s1', 32), null));
		const done = flowOf(insertBeats(flow, at('s1', 8), 4));
		expect(done.bookmarks!.map((b) => [b.a, b.b])).toEqual([
			[at('s1', 0), at('s1', 8)],
			[at('s1', 12), at('s1', 20)],
			[at('s2', 0), null]
		]);
	});

	it('段換順序讓 B 跑到 A 前面：書籤拿掉，重複範圍放不下', () => {
		const flow = flowOf(addBookmark(sample(), '跨段', at('s1', 16), at('s2', 8)));
		const done = flowOf(run(flow, { name: 'moveSegment', args: ['s2', -1] }));
		expect(done.bookmarks).toEqual([]);
		expect(rangeSeconds(done, { a: at('s1', 16), b: at('s2', 8) })).toBeNull();
	});

	it('段縮短：A 會落在段尾的書籤列進確認清單；B 剛好在新的段尾的留著', () => {
		let flow = flowOf(addBookmark(sample(), '尾', at('s1', 16), null));
		flow = flowOf(addBookmark(flow, '前半', at('s1', 0), at('s1', 16)));
		const asked = run(flow, { name: 'updateSegment', args: ['s1', { eights: 1, lastBeats: 8 }] });
		expect(asked.kind === 'confirm' && asked.items).toEqual(['刪掉：書籤「尾」']);
	});

	it('刪段：A 或 B 在那段的書籤列進確認清單；A、B 在別段、跨過那段的留著', () => {
		let flow = flowOf(addSegment(sample(), 'music'));
		flow = flowOf(updateSegment(flow, 's3', { bpm: 120, eights: 2, lastBeats: 8 }));
		flow = flowOf(addBookmark(flow, '跨過', at('s1', 0), at('s3', 8)));
		flow = flowOf(addBookmark(flow, '在中間', at('s2', 4), null));
		flow = flowOf(addBookmark(flow, '到中間', at('s1', 4), at('s2', 4)));
		const asked = run(flow, { name: 'deleteSegment', args: ['s2'] });
		expect(asked.kind === 'confirm' && asked.items).toEqual(['書籤「在中間」', '書籤「到中間」']);
		const done = flowOf(run(flow, { name: 'deleteSegment', args: ['s2'], options: { confirmed: true } }));
		expect(done.bookmarks!.map((b) => b.name)).toEqual(['跨過']);
	});
});

describe('手改過的流程檔', () => {
	const zipOf = (doc: unknown) => zipSync({ 'flow.json': strToU8(JSON.stringify(doc)) });

	it('A 寫在段尾、B 寫在段頭的書籤：開檔拿掉並說出來，整份流程檢查也擋', () => {
		const flow = flowOf(addBookmark(sample(), '開場', at('s1', 0), null));
		const edited = { ...flow, bookmarks: [...flow.bookmarks!, { id: 'k9', name: '手改', a: at('s1', 32), b: at('s2', 0) }] };
		const r = readFlowFile(zipOf({ formatVersion: 16, flow: edited }));
		expect(r.kind === 'ok' && r.droppedBookmarks).toEqual(['手改']);
		expect(r.kind === 'ok' && r.flow.bookmarks!.map((b) => b.name)).toEqual(['開場']);
		expect(flowProblem(edited, flow)).toEqual({ code: 'flow_file_bookmark_lost', name: '手改' });
	});
});
