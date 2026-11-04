// 畫面測試共用的假 adapter：存檔、草稿、解碼、座標換算（jsdom 沒有檔案系統、IndexedDB、Web Audio、SVG 座標），
// 放好流程的編輯頁、開檔這些小工具，和頁面測試常用的範例流程。flowOf 用核心測試那份（#lib/core/test-flows.js）。
// 只給測試用，頁面不 import。
import { fireEvent, screen } from '@testing-library/svelte';
import { afterEach, beforeEach } from 'vitest';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	loadSegmentAudio,
	addPhase,
	recordAttempt,
	setSquad,
	updateSegment,
	type Flow
} from '#lib/core';
import { flowOf } from '#lib/core/test-flows.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import type { DraftStore } from '#lib/file/draft.js';
import type { FileSaver, SaveOutcome } from '#lib/file/save.js';

/** 假的存檔：每次存的位元組和檔名照順序記下來，回傳給的結果。 */
export function fakeSaver(outcome: SaveOutcome = 'saved') {
	const saves: Uint8Array[] = [];
	const fileNames: string[] = [];
	const saver: FileSaver = {
		async save(bytes, fileName) {
			saves.push(bytes);
			fileNames.push(fileName);
			return outcome;
		}
	};
	return { saver, saves, fileNames };
}

/** 假的草稿：存在記憶體（state.bytes），一開始可以先放一份。 */
export function fakeDraftStore(initial: Uint8Array | null = null) {
	const state = { bytes: initial };
	const store: DraftStore = {
		async load() {
			return state.bytes;
		},
		async save(bytes) {
			state.bytes = bytes;
		},
		async clear() {
			state.bytes = null;
		}
	};
	return { store, state };
}

/** 假的解碼：每個音樂檔都是 30 秒、沒有波形。 */
export const fakeDecode = async () => ({ durationSec: 30, peaks: [] });

/** 等 async 的存檔、開檔跑完。 */
export const settle = () => new Promise((r) => setTimeout(r, 0));

/** 從「開啟流程檔」（首頁）或「開啟」（上方列）開一個檔：只有測檔案本身才用，其他測試用 editorPage 放流程。 */
export async function openFile(bytes: Uint8Array, label = '開啟流程檔') {
	const file = new File([bytes as Uint8Array<ArrayBuffer>], '練習用.zip', { type: 'application/zip' });
	await fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
	await settle();
}

/**
 * 編輯頁放一個帶好流程的 session（算存過的，跟剛開檔一樣），其他 adapter 都是假的：`render(Page, page.props)`。
 * 測試讀 `page.session.flow`；`page.saves` 是按存檔存下來的檔，只有測檔案本身才讀。
 */
export function editorPage(flow: Flow | null = null) {
	const session = new EditorSession(flow);
	const { saver, saves } = fakeSaver();
	const props = { session, createEngine: () => createFakeEngine(), createSaver: () => saver, decode: fakeDecode };
	return { session, saves, props };
}

/**
 * 假的座標換算：把場地預設的螢幕換公尺換成 1 px = 1 cm（見 ADR 0002）。在 describe 裡呼叫，每個測試前裝上、測完拿掉。
 * 頁面還不能收座標換算的 prop，所以先換掉 SVG 的 getScreenCTM、createSVGPoint。
 */
export function useFakeSvgCoordinates() {
	beforeEach(() => {
		const proto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
		proto.getScreenCTM = () => ({ inverse: () => ({}) });
		proto.createSVGPoint = () => {
			const p = { x: 0, y: 0, matrixTransform: () => ({ x: p.x / 100, y: p.y / 100 }) };
			return p;
		};
	});
	afterEach(() => {
		const proto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
		delete proto.getScreenCTM;
		delete proto.createSVGPoint;
	});
}

// 頁面測試常用的範例流程。都叫「練習用」。

/** 音樂 1（a1.mp3）；小A 在一個動作裡（Lib，技巧）。測存檔、草稿用。 */
export function audioFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'top' }]));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(loadSegmentAudio(flow, 's1', '主歌.mp3'));
	return flowOf(
		addAction(flow, {
			segmentId: 's1',
			category: 'stunt',
			name: 'Lib',
			start: 0,
			length: 16,
			note: '',
			members: [{ memberId: 'm1', role: '上層' }]
		})
	);
}

/**
 * 音樂 1（4 個八拍）；小美、小芳是上層，小A、小B 是底層（m1 到 m4）。
 * x1：Lib（技巧，第 1 個八拍），四個人都在，還沒有環節。
 */
export function teamFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' },
			{ name: '小芳', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' },
		{ memberId: 'm3', role: '上層' },
		{ memberId: 'm4', role: '主底' }
	];
	return flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members }));
}

/** teamFlow 的 Lib 加上環節：p1 上法 1-1 到 1-2、p2 中段 1-3 到 1-6、p3 下法 1-7 到 1-8（全部的人先在第 1 組）。 */
export function phasedFlow(): Flow {
	let flow = teamFlow();
	for (const [kind, at, len] of [['load', 0, 4], ['hold', 4, 8], ['dismount', 12, 4]] as const) {
		flow = flowOf(addPhase(flow, 'x1', { kind, name: '', beats: { at: at, len: len } }));
	}
	return flow;
}

/** phasedFlow 再分組：小美、小A 第 1 組，小芳、小B 第 2 組。 */
function squadFlow(): Flow {
	let flow = phasedFlow();
	for (const [id, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
		flow = flowOf(setSquad(flow, 'x1', [id], squad));
	}
	return flow;
}

/** squadFlow 加上紀錄（11/4 分段練，上法 ✓）：第 1 組記了 2 次，第 2 組記了 1 次。 */
export function recordedFlow(): Flow {
	let flow = squadFlow();
	for (const who of ['g1', 'g1', 'g2']) {
		const attempt = { date: '2026-11-04', who, practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } };
		flow = flowOf(recordAttempt(flow, 'x1', attempt));
	}
	return flow;
}

/**
 * squadFlow 再加：
 * x2：拋投（第 2 個八拍的前 4 拍），還沒有環節；小芳。
 * x3：騰翻（第 3 個八拍），環節整體「騰翻」整個動作；小美、小A。
 */
export function practiceFlow(): Flow {
	let flow = squadFlow();
	const toss = [{ memberId: 'm3', role: '上層' }];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'toss', name: '', start: 16, length: 8, note: '', members: toss }));
	const tumbling = [
		{ memberId: 'm1', role: '騰翻' },
		{ memberId: 'm2', role: '騰翻' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'tumbling', name: '', start: 32, length: 16, note: '', members: tumbling }));
	return flowOf(addPhase(flow, 'x3', { kind: 'whole', name: '騰翻', beats: { at: 0, len: 16 } }));
}
