// 畫面測試共用的假 adapter：存檔、草稿、解碼、座標換算（jsdom 沒有檔案系統、IndexedDB、Web Audio、SVG 座標），
// 和放好流程的編輯頁、開檔這些小工具。
// 只給測試用，頁面不 import。
import { fireEvent, screen } from '@testing-library/svelte';
import { afterEach, beforeEach } from 'vitest';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { Flow } from '#lib/core';
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
