// 雲端流程復原、重做時清單怎麼排（#311）：只動那一步加的、刪的、調了位置的，其他照現在畫面上的。
// 每一列是 Codex 第 5 到 8 輪修過的情況（編輯器 module 配假伺服器的版本在 src/lib/cloud-same-thing.test.ts）。
import { describe, expect, it } from 'vitest';
import { travelChange, travelOrder, type Flow } from './index';
import { undoChanges } from './cloud-undo';
import { libSample } from '../test-flows';

/** 'A B C' → ['A', 'B', 'C'] */
const ids = (s: string) => s.split(' ').filter(Boolean);

describe('travelOrder（一個清單復原、重做之後的順序）', () => {
	// before、after：那一步改之前、改之後；now：現在畫面上的；anchor：動到的放在這裡它前一個的後面
	// （復原用改之前的；重做用復原前畫面上的）
	it.each([
		{
			commit: '382add9',
			what: '我加 H，別人把 B 調到最前面，我復原：只拿掉 H，B 還在最前面',
			before: 'A B',
			after: 'A B H',
			now: 'B A H',
			redo: false,
			anchor: 'A B',
			want: 'B A'
		},
		{
			commit: '382add9',
			what: '我刪 X，別人加 N、我復原、別人把 N 調到最前面，我重做：只刪 X，N 還在最前面',
			before: 'A X B',
			after: 'A B',
			now: 'N A X B',
			redo: true,
			anchor: 'A B N',
			want: 'N A B'
		},
		{
			commit: '3f0cdf1',
			what: '我把 S2 調到 S3 後面、復原，別人在 S2 後面插 N 再刪 S2，我重做：順序不動',
			before: 'S1 S2 S3',
			after: 'S1 S3 S2',
			now: 'S1 N S3',
			redo: true,
			anchor: 'S1 S3 S2',
			want: 'S1 N S3'
		},
		{
			commit: 'd178497',
			what: '別人刪 X，我把 A 調到最後、復原，別人加回 X、刪 C，我重做：調的還是 A',
			before: 'A B C',
			after: 'B C A',
			now: 'A X B',
			redo: true,
			anchor: 'B C A',
			want: 'X B A'
		}
	])('$commit：$what', ({ before, after, now, redo, anchor, want }) => {
		const got = travelOrder({ before: ids(before), after: ids(after), now: ids(now), anchor: ids(anchor) }, redo);
		expect(got).toEqual(ids(want));
	});

	it.each([
		{
			commit: '382add9',
			what: '一步加 H 又把 B 調到最前面，復原再重做：回到同一個順序',
			before: 'A B C',
			after: 'B A C H'
		},
		{
			commit: '16acd41',
			what: '我把 S3 調到第二、別人在它後面插 N，復原再重做：回到復原前的順序',
			before: 'S1 S2 S3',
			after: 'S1 S3 S2',
			shown: 'S1 S3 N S2'
		}
	])('$commit：$what', ({ before, after, shown = after }) => {
		const lists = { before: ids(before), after: ids(after) };
		const back = travelOrder({ ...lists, now: ids(shown), anchor: ids(before) }, false);
		expect(travelOrder({ ...lists, now: back, anchor: ids(shown) }, true)).toEqual(ids(shown));
	});
});

describe('travelChange（整步復原、重做要送的改動）', () => {
	it('改到的東西照那一邊的，清單順序照 travelOrder 排（我加隊員，別人把第二個調到最前面，復原只拿掉我加的）', () => {
		const start: Flow = libSample();
		const [a, b] = start.members;
		const added: Flow = { ...start, members: [...start.members, { ...a, id: 'mine', name: '小華' }] };
		const changes = undoChanges(start, added);
		const now: Flow = { ...added, members: [b, a, ...added.members.slice(2)] };
		const change = travelChange(now, changes, false, changes.undo.orders);
		expect(change.things).toEqual(changes.undo.things);
		expect(change.orders.members).toEqual([b, a, ...start.members.slice(2)].map((m) => m.id));
	});
});
