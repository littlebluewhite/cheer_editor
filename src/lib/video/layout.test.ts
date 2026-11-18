import { describe, expect, it } from 'vitest';
import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	createFlow,
	fullView,
	updateSegment,
	videoFrame,
	type EightCountCueLine,
	type FieldConfig,
	type Flow,
	type VideoFrameData,
	type VideoRow
} from '#lib/core';
import { flowOf } from '../test-flows';
import { MIN_TEXT_PX, VIDEO_H, VIDEO_W, layoutFrame, overflowEights, type FrameLayout, type Measure } from './layout';

/** 假的量字：英數字 0.6 個字高寬，其他（中文、全形符號）1 個字高寬。 */
const measure: Measure = (t, px) => [...t].reduce((w, c) => w + (/[\x00-\x7f]/.test(c) ? 0.6 : 1) * px, 0);

const FIELD: FieldConfig = { strips: 9, layout: 'vertical' };
/** 三塊：上方 0–320、場地 320–1160、下面那一列 1160–1880。 */
const FIELD_TOP = 320;
const ROW_TOP = 1160;
const ROW_BOTTOM = 1880;
/** 字左右留的邊：寬 984。 */
const LEFT = 48;
const WIDTH = 984;
/** 28 px 時一行放 35 個中文字（984 / 28）、一行高 35 px（1.25 倍），沒有拍點時下面那一列放 20 行。 */
const PER_LINE = 35;
const LINES = 20;
/** 28 px 剛好 k 行的字：後面再接的前綴（「↳ 甲 繼續：」「備註：」）不超過 8 個字寬，不會多出一行。 */
const lines = (k: number) => '字'.repeat((k - 1) * PER_LINE + 10);

function row(r: Partial<VideoRow>): VideoRow {
	return { formations: [], actions: [], continuing: [], cues: [], empty: false, ...r };
}

function frame(r: VideoRow, more: Partial<VideoFrameData> = {}): VideoFrameData {
	return {
		part: 'play',
		flowSec: 1,
		title: '測試流程',
		where: '音樂 1・第 1 個八拍',
		clock: '0:01.0',
		beats: { count: 8, lit: 3 },
		positions: {},
		raised: [],
		markers: {},
		row: r,
		...more
	};
}

const act = (title: string, who: string, note = '') => ({ title, who, note });

/** 一個動作的拍點那一排：第 1、2 格一個 down。 */
function cueLine(name: string, word = 'down', from = 1, to = 2): EightCountCueLine {
	return {
		category: 'stunt',
		name,
		cues: [{ kind: 'count', from, to, span: `1-${from} 到 1-${to}・${to - from + 1} 拍`, lead: '', continued: false, word, who: null }],
		phases: []
	};
}

const layout = (r: VideoRow, more: Partial<VideoFrameData> = {}) => layoutFrame(FIELD, frame(r, more), measure);
/** 下面那一列的字，從上到下。 */
const bottom = (l: FrameLayout) => l.texts.filter((t) => t.y >= ROW_TOP).toSorted((a, b) => a.y - b.y || a.x - b.x);
/** 下面那一列的字級（只有一種）。 */
function rowPx(l: FrameLayout): number {
	const sizes = [...new Set(bottom(l).map((t) => t.px))];
	expect(sizes).toHaveLength(1);
	return sizes[0];
}
const strings = (l: FrameLayout) => bottom(l).map((t) => t.text);

/** 每個字都在畫面裡、不小於 28 px，量起來不超出左右的邊。 */
function expectInside(l: FrameLayout) {
	for (const t of l.texts) {
		expect(t.px).toBeGreaterThanOrEqual(MIN_TEXT_PX);
		expect(t.y).toBeGreaterThanOrEqual(0);
		expect(t.y + t.px).toBeLessThanOrEqual(t.y >= ROW_TOP ? ROW_BOTTOM : VIDEO_H);
		const w = measure(t.text, t.px, t.weight);
		const left = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
		expect(left).toBeGreaterThanOrEqual(0);
		expect(left + w).toBeLessThanOrEqual(VIDEO_W);
	}
}

/** 沒有拍點時，下面那一列一行一行往下排，不疊在一起。 */
function expectStacked(l: FrameLayout) {
	const b = bottom(l);
	for (let i = 1; i < b.length; i++) expect(b[i].y).toBeGreaterThanOrEqual(b[i - 1].y + b[i - 1].px);
}

describe('場地', () => {
	it('9 條直放：圓點、標記、條號格號都夠大，整塊在 320–1160 裡', () => {
		const { field } = layout(row({ empty: true }));
		expect(field.dotPx).toBeGreaterThanOrEqual(64);
		expect(field.markerPx).toBeGreaterThanOrEqual(28);
		expect(field.numberPx).toBeGreaterThanOrEqual(28);
		expect(field.box.y).toBeGreaterThanOrEqual(FIELD_TOP);
		expect(field.box.y + field.box.h).toBeLessThanOrEqual(ROW_TOP);
	});

	it('1–12 條、直放橫放：整個場地照比例不裁切、左右置中，字都不小於 28 px', () => {
		for (const layoutKind of ['vertical', 'horizontal'] as const) {
			for (let strips = 1; strips <= 12; strips++) {
				const f: FieldConfig = { strips, layout: layoutKind };
				const { field } = layoutFrame(f, frame(row({ empty: true })), measure);
				const view = fullView(f);
				expect(field.box.w).toBeCloseTo(view.width * field.pxPerM, 6);
				expect(field.box.h).toBeCloseTo(view.height * field.pxPerM, 6);
				expect(field.box.x + field.box.w / 2).toBeCloseTo(VIDEO_W / 2, 6);
				expect(field.box.x).toBeGreaterThanOrEqual(0);
				expect(field.box.x + field.box.w).toBeLessThanOrEqual(VIDEO_W);
				// 浮點數誤差：場地剛好塞滿那一塊的高時，上緣可能是 319.99999…
				expect(field.box.y).toBeGreaterThanOrEqual(FIELD_TOP - 1e-6);
				expect(field.box.y + field.box.h).toBeLessThanOrEqual(ROW_TOP);
				expect(field.dotPx).toBeGreaterThanOrEqual(64);
				expect(field.markerPx).toBeGreaterThanOrEqual(MIN_TEXT_PX);
				expect(field.numberPx).toBeGreaterThanOrEqual(MIN_TEXT_PX);
			}
		}
	});
});

describe('上方', () => {
	/** 1–8 那一排的格子，從左到右。 */
	const bar = (l: FrameLayout) => l.boxes.filter((b) => b.y < FIELD_TOP).toSorted((a, b) => a.x - b.x);

	it('流程名、在哪、時間都寫，在場地上面', () => {
		const l = layout(row({ empty: true }));
		const top = l.texts.filter((t) => t.y < FIELD_TOP);
		expect(top.map((t) => t.text)).toEqual(expect.arrayContaining(['測試流程', '音樂 1・第 1 個八拍', '0:01.0']));
		for (const t of top) expect(t.y + t.px).toBeLessThanOrEqual(FIELD_TOP);
		expect(top.find((t) => t.text === '0:01.0')!.align).toBe('right');
		expectInside(l);
	});

	it('1–8 一排：最後一個八拍只有 4 拍時第 5–8 格灰掉，現在這拍亮', () => {
		const l = layout(row({ empty: true }), { beats: { count: 4, lit: 2 } });
		const boxes = bar(l);
		expect(boxes).toHaveLength(8);
		expect(boxes.map((b) => b.fill)).toEqual(['beatIdle', 'beatLit', 'beatIdle', 'beatIdle', 'beatOff', 'beatOff', 'beatOff', 'beatOff']);
		for (const b of boxes) expect(b.y + b.h).toBeLessThanOrEqual(FIELD_TOP);
		// 格子裡寫 1–8，在格子的正中間
		const nums = l.texts.filter((t) => /^[1-8]$/.test(t.text) && t.y < FIELD_TOP).toSorted((a, b) => a.x - b.x);
		expect(nums.map((t) => t.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
		expect(nums[1].x).toBeCloseTo(boxes[1].x + boxes[1].w / 2, 6);
		expect(nums[1].color).toBe('beatLitInk');
	});

	it('口號段沒有 1–8 那一排', () => {
		const l = layout(row({ empty: true }), { where: '口號 1・12.3 秒', beats: null });
		expect(bar(l)).toEqual([]);
		expect(l.texts.map((t) => t.text)).toContain('口號 1・12.3 秒');
	});

	it('開頭：寫開場站位，沒有 1–8，下面那一列照樣排', () => {
		const l = layout(row({ formations: ['站位 1・1-1'] }), { part: 'intro', where: '開場站位', beats: null, clock: '0:00.0' });
		expect(bar(l)).toEqual([]);
		expect(l.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['測試流程', '開場站位', '站位 1・1-1']));
	});

	it('40 個字的流程名：縮小換行，不超出畫面，也不蓋到下面的字', () => {
		const title = '流'.repeat(40);
		const l = layout(row({ empty: true }), { title });
		const parts = l.texts.filter((t) => t.text.startsWith('流'));
		expect(parts.map((t) => t.text).join('')).toBe(title);
		const where = l.texts.find((t) => t.text === '音樂 1・第 1 個八拍')!;
		for (const t of parts) expect(t.y + t.px).toBeLessThanOrEqual(where.y);
		expect(l.overflow).toBe(false);
		expectInside(l);
	});
});

describe('下面那一列：排得下', () => {
	it('一個動作、一行誰：不縮字（40 px），沒有拿掉東西', () => {
		const l = layout(row({ actions: [act('1-1 到 1-8・8 拍　技巧·Lib', '小A（上層）、小B（主底）')] }));
		expect(rowPx(l)).toBe(40);
		expect(l.overflow).toBe(false);
		expect(strings(l)).toEqual(['1-1 到 1-8・8 拍　技巧·Lib', '小A（上層）、小B（主底）']);
		expect(bottom(l)[0].x).toBe(LEFT);
		expectStacked(l);
		expectInside(l);
	});

	it('站位、動作、誰、備註、還在做的動作，照這個順序', () => {
		const l = layout(
			row({
				formations: ['站位 2 金字塔・1-1'],
				actions: [act('1-1　技巧·Lib', '小A（上層）', '慢一點')],
				continuing: [{ name: '舞蹈', who: '全隊' }]
			})
		);
		expect(strings(l)).toEqual(['站位 2 金字塔・1-1', '1-1　技巧·Lib', '小A（上層）', '備註：慢一點', '↳ 舞蹈 繼續：全隊']);
		expect(l.overflow).toBe(false);
	});

	it('什麼都沒有的列寫一句', () => {
		const l = layout(row({ empty: true }));
		expect(strings(l)).toEqual(['這一列沒有新的動作、站位']);
	});

	it('長的一行一個字一個字換行（中文沒有空白），不超出左右', () => {
		const who = '小'.repeat(60);
		const l = layout(row({ actions: [act('1-1　技巧·Lib', who)] }));
		const px = rowPx(l);
		const whoLines = strings(l).slice(1);
		expect(whoLines.join('')).toBe(who);
		expect(whoLines[0]).toHaveLength(Math.floor(WIDTH / px));
		expectStacked(l);
		expectInside(l);
	});

	it('放不下時字級一路 40、38、36…到 28，只縮字不算拿掉東西', () => {
		const seen: number[] = [];
		for (let n = 10; n <= 700; n += 10) {
			const l = layout(row({ actions: [act('1-1　技巧·Lib', '小'.repeat(n))] }));
			const px = rowPx(l);
			if (!seen.includes(px)) seen.push(px);
			if (px > MIN_TEXT_PX) expect(l.overflow).toBe(false);
			expectInside(l);
		}
		expect(seen).toEqual([40, 38, 36, 34, 32, 30, 28]);
	});

	it('6 個同時開始、每個有拍點的動作：放得下', () => {
		const names = ['甲', '乙', '丙', '丁', '戊', '己'];
		const l = layout(
			row({
				actions: names.map((n) => act(`1-1 到 1-8・8 拍　技巧·${n}`, `${n}1（上層）、${n}2（主底）、${n}3（側底）、${n}4（後保）`)),
				cues: names.map((n) => cueLine(n))
			})
		);
		expect(l.overflow).toBe(false);
		const s = strings(l);
		for (const n of names) {
			expect(s).toContain(`1-1 到 1-8・8 拍　技巧·${n}`);
			expect(s).toContain(`${n}1（上層）、${n}2（主底）、${n}3（側底）、${n}4（後保）`);
			expect(s).toContain(`技巧·${n}`);
		}
		expect(s.filter((t) => t === 'down')).toHaveLength(6);
		expectInside(l);
	});
});

describe('下面那一列：拍點格子', () => {
	/** 拍點格子：下面那一列裡的框，從左到右。 */
	const gridBoxes = (l: FrameLayout) => l.boxes.filter((b) => b.y >= ROW_TOP);

	it('8 格寫 1–8，現在這拍那一欄框起來，拍點佔它的格子', () => {
		const l = layout(row({ actions: [act('1-1　技巧·Lib', '小A')], cues: [cueLine('Lib', 'down', 3, 4)] }), {
			beats: { count: 8, lit: 6 }
		});
		const nums = bottom(l).filter((t) => /^[1-8]$/.test(t.text));
		expect(nums.map((t) => t.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
		const columns = gridBoxes(l).filter((b) => b.fill === 'bg' || b.fill === 'gridNow');
		expect(columns).toHaveLength(8);
		const now = columns.find((b) => b.fill === 'gridNow')!;
		expect(now.stroke).toBe('beatLit');
		expect(now.x + now.w / 2).toBeCloseTo(nums[5].x, 6);
		const cue = gridBoxes(l).find((b) => b.fill === 'cueDown')!;
		const third = columns.toSorted((a, b) => a.x - b.x)[2];
		const fourth = columns.toSorted((a, b) => a.x - b.x)[3];
		expect(cue.x).toBeGreaterThanOrEqual(third.x);
		expect(cue.x + cue.w).toBeLessThanOrEqual(fourth.x + fourth.w);
		const word = bottom(l).find((t) => t.text === 'down')!;
		expect(word.color).toBe('cueCountInk');
		expect(word.y).toBeGreaterThanOrEqual(cue.y);
		expect(word.y + word.px).toBeLessThanOrEqual(cue.y + cue.h);
		expect(bottom(l).find((t) => t.text === '技巧·Lib')).toBeDefined();
		expectInside(l);
	});

	it('格子在字的下面，不疊到字', () => {
		const l = layout(row({ actions: [act('1-1　技巧·Lib', '小A')], cues: [cueLine('Lib')] }));
		const who = bottom(l).find((t) => t.text === '小A')!;
		for (const b of gridBoxes(l)) expect(b.y).toBeGreaterThanOrEqual(who.y + who.px);
		for (const b of gridBoxes(l)) expect(b.y + b.h).toBeLessThanOrEqual(ROW_BOTTOM);
	});

	it('拍點的字比格子寬：在格子裡換行，不截掉、不蓋到下一格', () => {
		const word = '一二三四五六七八九十';
		const l = layout(row({ cues: [cueLine('Lib', word, 1, 1)] }));
		const parts = bottom(l).filter((t) => /^[一二三四五六七八九十]+$/.test(t.text));
		expect(parts.length).toBeGreaterThan(1);
		expect(parts.map((t) => t.text).join('')).toBe(word);
		const cue = gridBoxes(l).find((b) => b.fill === 'cueDown')!;
		for (const t of parts) {
			expect(t.x).toBeGreaterThanOrEqual(cue.x);
			expect(t.x + measure(t.text, t.px, t.weight)).toBeLessThanOrEqual(cue.x + cue.w);
			expect(t.y + t.px).toBeLessThanOrEqual(cue.y + cue.h);
		}
		expect(l.overflow).toBe(false);
	});

	it('環節寫在拍點上面一行，佔它的格子', () => {
		const line: EightCountCueLine = { ...cueLine('Lib'), phases: [{ label: '上法', from: 1, to: 3, color: '#c62828' }] };
		const l = layout(row({ cues: [line] }));
		const phase = bottom(l).find((t) => t.text === '上法')!;
		const down = bottom(l).find((t) => t.text === 'down')!;
		expect(phase.y + phase.px).toBeLessThanOrEqual(down.y);
		const box = gridBoxes(l).find((b) => b.stroke === 'phaseLine')!;
		expect(phase.x).toBeGreaterThanOrEqual(box.x);
		expect(l.overflow).toBe(false);
	});
});

describe('下面那一列：放不下時照順序拿掉', () => {
	it('第 1 步：還在做的動作從最下面那個縮成「↳ 名字 繼續」就放得下', () => {
		// 2 ＋ 12 ＋ 2 ＋ 5 = 21 行放不下；最下面那個縮成一行：2 ＋ 12 ＋ 2 ＋ 1 = 17 行
		const l = layout(
			row({
				actions: [act('1-1　技巧·Lib', '小A（上層）', lines(12))],
				continuing: [
					{ name: '甲', who: lines(2) },
					{ name: '乙', who: lines(5) }
				]
			})
		);
		const s = strings(l);
		expect(rowPx(l)).toBe(MIN_TEXT_PX);
		expect(l.overflow).toBe(true);
		expect(s.at(-1)).toBe('↳ 乙 繼續');
		expect(s.some((t) => t.startsWith('↳ 甲 繼續：'))).toBe(true);
		expect(s.some((t) => t.startsWith('備註：'))).toBe(true);
		expect(s.some((t) => t.startsWith('⋯'))).toBe(false);
		expectStacked(l);
		expectInside(l);
	});

	it('第 2 步：還在做的都縮了還放不下，從最下面拿掉備註就放得下', () => {
		// 4 ＋ 5 ＋ 12 ＋ 3 = 24；縮了 22；拿掉第二個備註 4 ＋ 5 ＋ 1 = 10
		const l = layout(
			row({
				actions: [act('1-1　技巧·甲', '小A', lines(5)), act('1-1　技巧·乙', '小B', lines(12))],
				continuing: [{ name: '丙', who: lines(3) }]
			})
		);
		const s = strings(l);
		expect(l.overflow).toBe(true);
		expect(s).toEqual(expect.arrayContaining(['1-1　技巧·甲', '小A', '1-1　技巧·乙', '小B', '↳ 丙 繼續']));
		expect(s.filter((t) => t.startsWith('備註：'))).toHaveLength(1);
		expect(s.indexOf('1-1　技巧·乙')).toBeGreaterThan(s.findIndex((t) => t.startsWith('備註：')));
		expect(s.some((t) => t.startsWith('⋯'))).toBe(false);
		expectStacked(l);
		expectInside(l);
	});

	it('第 3 步：從最下面拿掉整個動作，最後一行寫「⋯還有 N 個動作」，拍點格子照樣在', () => {
		// 有拍點格子時字放 18 行。3 × (1 ＋ 6) ＋ 1 ＋ 2 = 24；縮了、拿掉備註 22；拿掉丙：2 × 7 ＋ 1 ＋ 1 = 16
		const l = layout(
			row({
				actions: [act('1-1　技巧·甲', lines(6), '小心'), act('1-1　技巧·乙', lines(6)), act('1-1　技巧·丙', lines(6))],
				continuing: [{ name: '丁', who: lines(2) }],
				cues: [cueLine('丙')]
			})
		);
		const s = strings(l);
		expect(l.overflow).toBe(true);
		expect(s).toContain('1-1　技巧·甲');
		expect(s).toContain('1-1　技巧·乙');
		expect(s).not.toContain('1-1　技巧·丙');
		expect(s.some((t) => t.startsWith('備註：'))).toBe(false);
		expect(s).toContain('↳ 丁 繼續');
		// 字的最後一行（格子上面）
		const grid = l.boxes.filter((b) => b.y >= ROW_TOP);
		const gridTop = Math.min(...grid.map((b) => b.y));
		expect(bottom(l).filter((t) => t.y < gridTop).at(-1)!.text).toBe('⋯還有 1 個動作');
		// 拿掉的丙的拍點還在
		expect(s).toContain('技巧·丙');
		expect(s).toContain('down');
		expectInside(l);
	});

	it('拿掉兩個動作時寫「⋯還有 2 個動作」', () => {
		const l = layout(row({ actions: [act('1-1　技巧·甲', lines(10)), act('1-1　技巧·乙', lines(10)), act('1-1　技巧·丙', lines(10))] }));
		const s = strings(l);
		expect(s).toContain('1-1　技巧·甲');
		expect(s).not.toContain('1-1　技巧·乙');
		expect(s.at(-1)).toBe('⋯還有 2 個動作');
		expect(bottom(l).length).toBeLessThanOrEqual(LINES);
	});
});

describe('Review Focus 3：25 人、每人有任務角色的全隊動作', () => {
	/** 名字 20 個字、任務角色 8 個字：誰那一行換行後比整塊還長。音樂 1 有 2 個八拍，動作在第 1 個八拍。 */
	function bigTeam(): Flow {
		let flow = flowOf(createFlow({ name: '全隊', field: FIELD }));
		const names = Array.from({ length: 25 }, (_, i) => `第${String(i + 1).padStart(2, '0')}位` + '名'.repeat(16));
		flow = flowOf(addMembers(flow, names.map((name) => ({ name, gender: 'F' as const, globalRole: 'base' as const }))));
		flow = flowOf(addCustomRole(flow, { name: '後保側底主底上層', meaning: '' }));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(updateSegment(flow, 's1', { eights: 2, lastBeats: 8 }));
		return flowOf(
			addAction(flow, {
				segmentId: 's1',
				category: 'stunt',
				name: '金字塔',
				start: 0,
				length: 16,
				note: '',
				members: flow.members.map((m) => ({ memberId: m.id, role: '後保側底主底上層' }))
			})
		);
	}

	it('誰那一行換行後截在區塊底，最後一行結尾是「⋯」，不畫出畫面', () => {
		const l = layoutFrame(FIELD, videoFrame(bigTeam(), 2.1), measure);
		const b = bottom(l);
		expect(l.overflow).toBe(true);
		expect(rowPx(l)).toBe(MIN_TEXT_PX);
		// 流程開頭的站位 1 也在這一列
		expect(b[0].text).toBe('站位 1・1-1');
		expect(b[1].text).toBe('1-1 到 1-8・8 拍　技巧·金字塔');
		expect(b[2].text.startsWith('全隊：第01位')).toBe(true);
		expect(b.at(-1)!.text.endsWith('⋯')).toBe(true);
		expect(b).toHaveLength(LINES);
		for (const t of l.texts) expect(t.y).toBeLessThan(ROW_BOTTOM);
		expectStacked(l);
		expectInside(l);
	});

	it('overflowEights 列出放不下的八拍', () => {
		expect(overflowEights(bigTeam(), measure)).toEqual(['音樂 1 第 1 個八拍']);
	});
});
