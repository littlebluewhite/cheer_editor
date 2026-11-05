// 測試共用的假 adapter：存檔、草稿、解碼、座標換算（jsdom 沒有檔案系統、IndexedDB、Web Audio、SVG 座標），
// 一行建好帶假 adapter 的編輯器 module（testEditor，Node 也能用）、放好流程的編輯頁、開檔這些小工具，
// 和頁面測試常用的範例流程。flowOf 用測試共用那份（#lib/test-flows.js）。只給測試用，頁面不 import。
import { fireEvent, screen } from '@testing-library/svelte';
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
	type Flow,
	type Position
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { Editor, type EditorAdapters } from '#lib/editor.svelte.js';
import type { DraftStore } from '#lib/file/draft.js';
import type { FileSaver, SaveOutcome } from '#lib/file/save.js';
import { domPendingInput, type PendingInput } from '#lib/pending-input.js';

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

/** 假的草稿：存在記憶體（state.bytes、state.savedAt），一開始可以先放一份。 */
export function fakeDraftStore(initial: Uint8Array | null = null, savedAt = new Date()) {
	const state = { bytes: initial, savedAt };
	const store: DraftStore = {
		async load() {
			return state.bytes && { bytes: state.bytes, savedAt: state.savedAt };
		},
		async save(bytes) {
			state.bytes = bytes;
			state.savedAt = new Date();
		},
		async clear() {
			state.bytes = null;
		}
	};
	return { store, state };
}

/** 假的解碼：每個音樂檔都是 30 秒、沒有波形。 */
export const fakeDecode = async () => ({ durationSec: 30, peaks: [] });

/**
 * 假的沒送出的字：測試自己設 pending（欄位裡打了字還沒送出）和 onflush（送出時欄位交給流程的改動）；
 * 送出、當作已送出都是清掉。
 */
export function fakePendingInput(): PendingInput & { pending: boolean; onflush: () => void } {
	return {
		pending: false,
		onflush: () => {},
		flush() {
			if (this.pending) this.onflush();
			this.pending = false;
		},
		settle() {
			this.pending = false;
		}
	};
}

/**
 * 一行建好編輯器 module：帶好流程的 session（算存過的，跟剛開檔一樣），adapter 全是假的。Node 和 jsdom 的測試都用它。
 * 要換掉哪個 adapter 就放進 adapters（例：慢的解碼、先放一份草稿的草稿存放），換掉的自己留著它的把手。
 * saves 是預設的假存檔存下來的檔（換掉 createSaver 就不會有）。
 */
export function testEditor(flow: Flow | null = null, adapters: Partial<EditorAdapters> = {}) {
	const { saver, saves } = fakeSaver();
	const editor = new Editor(
		{
			createEngine: () => createFakeEngine(),
			createSaver: () => saver,
			pickFlowFile: null,
			decode: fakeDecode,
			draftStore: fakeDraftStore().store,
			pendingInput: fakePendingInput(),
			...adapters
		},
		flow
	);
	return { editor, session: editor.session, saves };
}

/** 等 async 的存檔、開檔跑完。 */
export const flush = () => new Promise((r) => setTimeout(r, 0));

/** 從「開啟流程檔」（首頁）或「開啟」（上方列）開一個檔：只有測檔案本身才用，其他測試用 editorPage 放流程。 */
export async function openFile(bytes: Uint8Array, label = '開啟流程檔') {
	const file = new File([bytes as Uint8Array<ArrayBuffer>], '練習用.zip', { type: 'application/zip' });
	await fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
	await flush();
}

/**
 * 編輯頁放一個 testEditor 建的編輯器 module（給了流程就是開著它，沒給在首頁），座標換算也是假的：`render(Page, page.props)`。
 * adapters 跟 testEditor 一樣，只有沒送出的字用真的（jsdom 有焦點和 change，存檔、⌘Z、關分頁要看到欄位裡打的字）。
 * 測試讀 `page.session.flow`；`page.saves` 是按存檔存下來的檔，只有測檔案本身才讀。
 */
export function editorPage(flow: Flow | null = null, adapters: Partial<EditorAdapters> = {}) {
	const t = testEditor(flow, { pendingInput: domPendingInput, ...adapters });
	return { ...t, props: { editor: t.editor, toMeters: fakeToMeters, cellAt: fakeCellAt } };
}

/** 假的座標換算：場地的螢幕換公尺換成 1 px = 1 cm（見 ADR 0002）。 */
export const fakeToMeters = (e: { clientX: number; clientY: number }): Position => [e.clientX / 100, e.clientY / 100];

/**
 * 假的「指標位置 → 拍點格子」（jsdom 不算版面，見 ADR 0002）：
 * clientX 是第幾個格子（照畫面順序），clientY 是第幾條（0 數字格、1 拍子、2 步驟、3 手位）。
 */
export function fakeCellAt(sheet: HTMLElement, x: number, y: number): HTMLElement {
	const kind = ['.cell', '.slot.count', '.slot.step', '.slot.motion'][y];
	return sheet.querySelectorAll<HTMLElement>(kind)[x];
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
