// 手機（窄螢幕）的檢視模式（#175，docs/adr/0005-ipad-touch.md）：上面場地、中間播放鈕、下面前後八拍（這個和下一個八拍）；
// 從名單選一次「我」，這台裝置照流程記住（不進流程檔），之後打開就把我標亮。
// 窄不窄是媒體查詢（NARROW_SCREEN）的事：jsdom 沒有 matchMedia，換一個假的說「窄」。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addSegment, fieldGeometry, insertFormation, readFlowFile, setPositions, stepPlayhead, updateSegment, writeFlowFile, type Flow } from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import { editorPage, flush, fromMenu, manualFrames, openFile } from '#lib/test-fakes.js';
import { flowOf, libSample, ratedSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
});
afterEach(() => vi.unstubAllGlobals());

/** 手機打開首頁，開一個流程檔（範例流程：小美 m1、小A m2、小B m3、小芳 m4，動作 Lib 在第 1 個八拍）。 */
async function openOnPhone(flow: Flow = libSample()) {
	const engine = createFakeEngine();
	const frames = manualFrames();
	const page = editorPage(null, { createEngine: () => engine, nextFrame: frames.nextFrame });
	render(Page, page.props);
	await flush();
	await openFile(writeFlowFile(flow, {}));
	return { ...page, engine, frames };
}

const row = () => screen.getByRole('region', { name: '前後八拍' });
const me = () => screen.getByLabelText('我') as HTMLSelectElement;
const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
/** 這個人的圓點在看到的範圍（viewBox：x y 寬 高，公尺）裡。 */
function dotInView(id: string, [vx, vy, w, h]: number[]) {
	const [x, y] = dot(id).getAttribute('transform')!.match(/translate\(([^,]+),([^)]+)\)/)!.slice(1).map(Number);
	return x >= vx && x <= vx + w && y >= vy && y <= vy + h;
}

describe('手機的檢視模式', () => {
	it('開檔直接看到場地、播放鈕、前後八拍；按播放，播放頭和八拍表跟著走', async () => {
		const { engine, frames } = await openOnPhone();
		// 不停在被擋住的編排畫面
		expect(screen.queryByRole('region', { name: '視窗太窄了' })).toBeNull();
		expect(screen.getByLabelText('場地')).toBeTruthy();
		expect(row().textContent).toContain('Lib');
		// 手機放不下七列：只有這個八拍和下一個
		expect([...row().querySelectorAll('[data-slot]')].map((s) => s.getAttribute('data-slot'))).toEqual(['1', '2']);
		const at = screen.getByLabelText('目前位置').textContent;

		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		// 聲音走了 5 秒（120 BPM 一個八拍 4 秒）：到第 2 個八拍
		engine.audible = engine.time + 0.1 + 5;
		frames.step();
		await flush();
		expect(screen.getByLabelText('目前位置').textContent).not.toBe(at);
		expect(row().textContent).not.toContain('Lib');
	});

	it('一律是檢視模式：沒有「編輯｜檢視」切換，也沒有復原、流程設定', async () => {
		const { session } = await openOnPhone();
		expect(session.viewing).toBe(true);
		expect(screen.queryByRole('group', { name: '編輯｜檢視' })).toBeNull();
		expect(screen.queryByRole('button', { name: '復原' })).toBeNull();
		expect(screen.queryByRole('button', { name: /設定/ })).toBeNull();
	});

	it('選「我」是小A：場上標亮小A，前後八拍只寫小A的；不算改流程', async () => {
		const { session } = await openOnPhone();
		expect(dot('m2').classList.contains('selected')).toBe(false);
		await fireEvent.change(me(), { target: { value: 'm2' } });
		expect(dot('m2').classList.contains('selected')).toBe(true);
		expect(dot('m1').classList.contains('selected')).toBe(false);
		// 列裡只寫我的任務角色；點動作名字，同組的人寫在下面
		expect(row().textContent).toContain('主底');
		expect(row().textContent).not.toContain('小美');
		await fireEvent.click(within(row()).getByRole('button', { name: /^技巧·Lib/ }));
		expect(screen.getByRole('region', { name: '動作詳細' }).textContent).toContain('小美');
		expect(session.unsaved).toBe(false);
	});

	it('重新打開同一支流程，還是標亮小A；存出來的流程檔裡沒有「我」', async () => {
		await openOnPhone();
		await fireEvent.change(me(), { target: { value: 'm2' } });
		cleanup();

		const { saves } = await openOnPhone();
		expect(me().value).toBe('m2');
		expect(dot('m2').classList.contains('selected')).toBe(true);
		await fromMenu('存檔');
		await flush();
		const saved = readFlowFile(saves.at(-1)!);
		expect(saved.kind === 'ok' && saved.flow).toEqual(libSample());
	});

	it('別支流程（名字不一樣）不帶上一支的「我」', async () => {
		await openOnPhone();
		await fireEvent.change(me(), { target: { value: 'm2' } });
		cleanup();

		await openOnPhone({ ...libSample(), name: '別支' });
		expect(me().value).toBe('');
		expect(dot('m2').classList.contains('selected')).toBe(false);
	});

	it('「練習」照舊；切回「編排」又是檢視畫面', async () => {
		await openOnPhone();
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(screen.getByRole('region', { name: '練習' })).toBeTruthy();
		expect(screen.queryByRole('region', { name: '前後八拍' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		expect(row()).toBeTruthy();
	});

	it('選單的「回首頁」：回到首頁，列在最近的流程', async () => {
		await openOnPhone();
		await fromMenu('回首頁');
		await flush();
		await vi.waitFor(() => expect(screen.getByRole('list', { name: '最近的流程' }).textContent).toContain('測試'));
	});

	it('有未存的修改（練習記了一次）按「回首頁」：跟「新建」一樣先問；取消就留著，「不存了，繼續」才回首頁', async () => {
		await openOnPhone();
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		for (const phase of ['上法', '中段', '下法']) {
			await fireEvent.click(screen.getByRole('button', { name: `第 1 組 小美 ${phase} 成功` }));
		}
		await fireEvent.click(within(screen.getByRole('region', { name: '第 1 組 小美' })).getByRole('button', { name: '存這一次' }));
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		await fromMenu('回首頁');
		const dialog = within(screen.getByRole('dialog', { name: '「測試」還沒存，改的東西會不見。' }));
		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(row()).toBeTruthy();

		await fromMenu('回首頁');
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		await flush();
		// 回到首頁了（編輯畫面的選單裡也有「開啟流程檔」，所以看首頁那一塊）
		expect(document.querySelector('.home-open')).toBeTruthy();
	});
});

describe('手機的檢視畫面：點場上的圓點看是誰', () => {
	/** 場地左下角那一塊：平常寫現在的站位，點了圓點寫那個人。 */
	const corner = () => document.querySelector('.phone-field .formation-now')!.textContent;
	const tap = async (el: Element, x = 0, y = 0) => {
		await fireEvent.pointerDown(el, { button: 0, clientX: x, clientY: y });
		await fireEvent.pointerUp(el, { button: 0, clientX: x, clientY: y });
	};
	/** 場地（用名字找，不管是 img 還是 group）。 */
	const field = () => screen.getByLabelText('場地');

	it('點小A：左下角寫他的名字和這個八拍做什麼，他圈起來；點空白處變回現在的站位', async () => {
		const { session } = await openOnPhone();
		expect(corner()).toBe('站位 1');
		await tap(dot('m2'), 100, 100);
		expect(corner()).toBe('小A　技巧·Lib 主底');
		expect(dot('m2').classList.contains('selected')).toBe(true);
		await tap(field(), 400, 300);
		expect(corner()).toBe('站位 1');
		expect(dot('m2').classList.contains('selected')).toBe(false);
		expect(session.unsaved).toBe(false);
	});

	it('播放頭走到下一個八拍：左下角跟著換成他那個八拍做的事', async () => {
		await openOnPhone();
		await tap(dot('m2'), 100, 100);
		await fireEvent.click(screen.getByRole('button', { name: '下一個八拍' }));
		expect(corner()).toBe('小A');
	});

	it('選了「我」是小A：別人畫淡；點到小美，小美不淡', async () => {
		await openOnPhone();
		const dimmed = () => ['m1', 'm2', 'm3', 'm4'].filter((id) => dot(id).classList.contains('dim'));
		expect(dimmed()).toEqual([]);
		await fireEvent.change(me(), { target: { value: 'm2' } });
		expect(dimmed()).toEqual(['m1', 'm3', 'm4']);
		await tap(dot('m1'), 100, 100);
		expect(dimmed()).toEqual(['m3', 'm4']);
	});

	it('鍵盤、讀螢幕軟體：場上每個人是 Tab 停得到的按鈕，念得出名字', async () => {
		await openOnPhone();
		// 場地是一群（group）隊員，不是圖片：圖片裡面的人讀螢幕軟體讀不到
		expect(screen.queryByRole('img', { name: '場地' })).toBeNull();
		expect(screen.getByRole('group', { name: '場地' })).toBe(field());
		const dots = within(field()).getAllByRole('button', { name: /^(小美|小A|小B|小芳)/ });
		expect(dots).toHaveLength(4);
		for (const d of dots) expect(d.getAttribute('tabindex')).toBe('0');
		expect(dot('m2').getAttribute('aria-label')).toMatch(/^小A/);
	});

	it('停在小A按 Enter：跟用手指點一下一樣，左下角寫他的名字和這個八拍做什麼', async () => {
		const { session } = await openOnPhone();
		await fireEvent.keyDown(dot('m2'), { key: 'Enter' });
		expect(corner()).toBe('小A　技巧·Lib 主底');
		expect(dot('m2').classList.contains('selected')).toBe(true);
		expect(session.unsaved).toBe(false);
	});

	it('讀螢幕軟體按小A（只送 click，沒有手指的事件）：跟用手指點一下一樣', async () => {
		await openOnPhone();
		await fireEvent.click(dot('m2'));
		expect(corner()).toBe('小A　技巧·Lib 主底');
	});

	it('手指點小美（瀏覽器補了 click），緊接著讀螢幕軟體按小A：選到小A', async () => {
		await openOnPhone();
		const at = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 0, clientY: 0 };
		await fireEvent.pointerDown(dot('m1'), at);
		await fireEvent.pointerUp(dot('m1'), at);
		await fireEvent.click(dot('m1'));
		await fireEvent.click(dot('m2'));
		expect(corner()).toBe('小A　技巧·Lib 主底');
	});

	it('手指按下去被取消（沒有 click），之後讀螢幕軟體按小A：照樣選得到', async () => {
		await openOnPhone();
		const at = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 0, clientY: 0 };
		await fireEvent.pointerDown(dot('m1'), at);
		await fireEvent.pointerCancel(dot('m1'), at);
		await fireEvent.click(dot('m2'));
		expect(corner()).toBe('小A　技巧·Lib 主底');
	});

	it('手指點兩下（瀏覽器在每次放開後補一個 click）：照樣放大，click 不再多算一次', async () => {
		await openOnPhone();
		const before = screen.getByLabelText('場地').getAttribute('viewBox');
		const at = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 0, clientY: 183 };
		for (let i = 0; i < 2; i++) {
			await fireEvent.pointerDown(dot('m2'), at);
			await fireEvent.pointerUp(dot('m2'), at);
			await fireEvent.click(dot('m2'));
		}
		expect(screen.getByLabelText('場地').getAttribute('viewBox')).not.toBe(before);
		expect(corner()).toBe('小A　技巧·Lib 主底');
	});

	it('停在人身上按空白鍵：照樣播放／暫停', async () => {
		const { editor } = await openOnPhone();
		expect(editor.playback.playing).toBe(false);
		await fireEvent.keyDown(dot('m1'), { key: ' ' });
		expect(editor.playback.playing).toBe(true);
		await fireEvent.keyDown(dot('m1'), { key: ' ' });
		expect(editor.playback.playing).toBe(false);
	});

	it('停在人身上按方向鍵（加不加 Shift）：人不動，流程沒有被改', async () => {
		const { session } = await openOnPhone();
		const at = ['m1', 'm2'].map((id) => dot(id).getAttribute('transform'));
		for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
			await fireEvent.keyDown(dot('m1'), { key });
			await fireEvent.keyDown(dot('m1'), { key, shiftKey: true });
		}
		expect(['m1', 'm2'].map((id) => dot(id).getAttribute('transform'))).toEqual(at);
		expect(dot('m2').classList.contains('selected')).toBe(false);
		expect(session.unsaved).toBe(false);
	});

	it('選了「我」是小A，再點小美：兩個人的走位線都畫', async () => {
		// 「下一個八拍」跳到的那一拍多一張站位，小美、小A 都換位置
		const two = flowOf(insertFormation(libSample(), stepPlayhead(libSample(), 0, 1, true)));
		const flow = flowOf(setPositions(two, two.formations[1].id, { m1: [2, 2], m2: [-2, 2] }));
		await openOnPhone(flow);
		const lines = () => [...document.querySelectorAll('[data-walk-line]')].map((el) => el.getAttribute('data-walk-line')).sort();
		await fireEvent.click(screen.getByRole('button', { name: '下一個八拍' }));
		await fireEvent.change(me(), { target: { value: 'm2' } });
		expect(lines()).toEqual(['m2']);
		await tap(dot('m1'), 100, 100);
		expect(lines()).toEqual(['m1', 'm2']);
	});

	it('點了小A，換成一般版面再換回手機版面（iPad 轉橫再轉直）：不再寫剛剛點的人', async () => {
		// 會換的媒體查詢：記住頁面掛上的 change 監聽，換版面時叫它
		const query = { matches: true, listeners: [] as (() => void)[] };
		vi.stubGlobal('matchMedia', (q: string) =>
			q === NARROW_SCREEN
				? Object.assign(query, {
						addEventListener: (_: string, f: () => void) => query.listeners.push(f),
						removeEventListener: () => {}
					})
				: { matches: false }
		);
		const turn = async (narrow: boolean) => {
			query.matches = narrow;
			query.listeners.forEach((f) => f());
			await flush();
		};
		await openOnPhone();
		await tap(dot('m2'), 100, 100);
		expect(corner()).toBe('小A　技巧·Lib 主底');
		await turn(false);
		await turn(true);
		expect(corner()).toBe('站位 1');
	});

	it('切到「練習」再回來、開別支流程：不再寫剛剛點的人', async () => {
		await openOnPhone();
		await tap(dot('m2'), 100, 100);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		expect(corner()).toBe('站位 1');
		await tap(dot('m2'), 100, 100);
		await fromMenu('回首頁');
		await flush();
		await openFile(writeFlowFile({ ...libSample(), name: '別支' }, {}));
		expect(corner()).toBe('站位 1');
	});
});

describe('手機的檢視畫面：放大後播放，畫面跟著「我」', () => {
	/** 範例流程在第 3 個八拍（8 秒）加一張站位：小A 從 (0, 1.83) 走到右下 (7, 6)。 */
	function walkingFlow(): Flow {
		const flow = libSample();
		const added = flowOf(insertFormation(flow, 8));
		const formation = added.formations.find((f) => !flow.formations.some((o) => o.id === f.id))!;
		return flowOf(setPositions(added, formation.id, { m2: [7, 6] }));
	}
	const stage = () => screen.getByLabelText('場地');
	/** 場地看到的範圍（公尺）：x y 寬 高。 */
	const viewBox = () => stage().getAttribute('viewBox')!.split(' ').map(Number);
	const inView = (id: string) => dotInView(id, viewBox());
	/** 整個場地的範圍（公尺）：x y 寬 高（場地 19.8592 × 16.5016，中心 (0, 0.15)）。 */
	const full = () => [-9.9296, -8.1008, 19.8592, 16.5016];
	const finger = (x: number, y: number) => ({ pointerType: 'touch', pointerId: 1, button: 0, clientX: x, clientY: y });
	/** 在小A站的地方（0, 1.83 公尺；1 px = 1 cm）很快點兩下：放大 ×2。 */
	async function zoomIn() {
		for (let i = 0; i < 2; i++) {
			await fireEvent.pointerDown(dot('m2'), finger(0, 183));
			await fireEvent.pointerUp(dot('m2'), finger(0, 183));
		}
	}
	/** 一根手指往左上拖一下：移動畫面。 */
	async function drag() {
		await fireEvent.pointerDown(stage(), finger(0, 0));
		await fireEvent.pointerMove(stage(), finger(-50, -50));
		await fireEvent.pointerUp(stage(), finger(-50, -50));
	}
	/** 按播放，聲音每次走半秒、走到第 4 個八拍（14 秒）；每一步都記下小A在不在畫面裡。 */
	async function playThrough({ engine, frames }: Awaited<ReturnType<typeof openOnPhone>>) {
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		const seen: boolean[] = [];
		const start = engine.time;
		for (let s = 0.5; s <= 14; s += 0.5) {
			engine.audible = start + 0.1 + s;
			frames.step();
			await flush();
			seen.push(inView('m2'));
		}
		return seen;
	}

	it('選了「我」是小A、放大、播放：小A走出畫面之前畫面跟過去，一直在畫面裡', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		const before = viewBox();
		expect(await playThrough(opened)).not.toContain(false);
		expect(viewBox()).not.toEqual(before);
	});

	it('先用手指拖一下畫面再播放：畫面不動', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		await drag();
		const before = viewBox();
		expect(await playThrough(opened)).toContain(false);
		expect(viewBox()).toEqual(before);
	});

	it('放大後用兩根手指移動畫面再播放：畫面也不動', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		const two = (id: number, x: number, y: number) => ({ ...finger(x, y), pointerId: id });
		await fireEvent.pointerDown(stage(), two(1, 0, 0));
		await fireEvent.pointerDown(stage(), two(2, 100, 0));
		await fireEvent.pointerMove(stage(), two(2, 80, -60));
		await fireEvent.pointerUp(stage(), two(2, 80, -60));
		await fireEvent.pointerUp(stage(), two(1, 0, 0));
		const before = viewBox();
		expect(await playThrough(opened)).toContain(false);
		expect(viewBox()).toEqual(before);
	});

	it('先用手指拖一下畫面，再用兩根手指放大：還是不跟（拖過了這次放大就不跟）', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		await drag();
		const two = (id: number, x: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: 0 });
		await fireEvent.pointerDown(stage(), two(1, 0));
		await fireEvent.pointerDown(stage(), two(2, 100));
		await fireEvent.pointerMove(stage(), two(2, 150));
		await fireEvent.pointerUp(stage(), two(2, 150));
		await fireEvent.pointerUp(stage(), two(1, 0));
		const before = viewBox();
		expect(await playThrough(opened)).toContain(false);
		expect(viewBox()).toEqual(before);
	});

	it('放大後兩根手指放上去沒動就放開：畫面沒動，播放照樣跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		const two = (id: number, x: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: 0 });
		await fireEvent.pointerDown(stage(), two(1, 0));
		await fireEvent.pointerDown(stage(), two(2, 100));
		await fireEvent.pointerUp(stage(), two(2, 100));
		await fireEvent.pointerUp(stage(), two(1, 0));
		expect(await playThrough(opened)).not.toContain(false);
	});

	it('放大後兩根手指拖走再拖回原處：移動過畫面，不再跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		const two = (id: number, x: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: 0 });
		await fireEvent.pointerDown(stage(), two(1, 0));
		await fireEvent.pointerDown(stage(), two(2, 100));
		await fireEvent.pointerMove(stage(), two(2, 150));
		await fireEvent.pointerMove(stage(), two(1, 50));
		await fireEvent.pointerMove(stage(), two(1, 0));
		await fireEvent.pointerMove(stage(), two(2, 100));
		await fireEvent.pointerUp(stage(), two(2, 100));
		await fireEvent.pointerUp(stage(), two(1, 0));
		expect(await playThrough(opened)).toContain(false);
	});

	it('放大後點小美一下（手抖了幾 px）看是誰：不算拖，播放照樣跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		await fireEvent.pointerDown(dot('m1'), finger(0, 0));
		await fireEvent.pointerMove(dot('m1'), finger(3, 2));
		await fireEvent.pointerUp(dot('m1'), finger(3, 2));
		expect(await playThrough(opened)).not.toContain(false);
	});

	it('拖過之後按「整個場地」，再放大、播放：又會跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		await drag();
		await fireEvent.click(screen.getByRole('button', { name: '整個場地' }));
		await zoomIn();
		expect(await playThrough(opened)).not.toContain(false);
	});

	/** 兩根手指：一根按在 (0, 0)，另一根從 (100, 0) 移到 (x, 0)，再一起放開（放大 x / 100 倍）。 */
	async function pinchTo(x: number) {
		const two = (id: number, cx: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: cx, clientY: 0 });
		await fireEvent.pointerDown(stage(), two(1, 0));
		await fireEvent.pointerDown(stage(), two(2, 100));
		await fireEvent.pointerMove(stage(), two(2, x));
		await fireEvent.pointerUp(stage(), two(2, x));
		await fireEvent.pointerUp(stage(), two(1, 0));
	}

	it('從整個場地用兩根手指放大、播放：跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await pinchTo(300);
		const before = viewBox();
		await playThrough(opened);
		expect(viewBox()).not.toEqual(before);
	});

	it('從整個場地用兩根手指放大一點點（不到 1.1 倍）、播放：照樣跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await pinchTo(105);
		expect(viewBox()[2]).toBeCloseTo(full()[2] / 1.05);
		const before = viewBox();
		await playThrough(opened);
		expect(viewBox()).not.toEqual(before);
	});

	it('跟著的時候用兩根手指縮小一點（還沒回整個場地）、播放：不跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		await pinchTo(80);
		expect(viewBox()[2]).toBeCloseTo(full()[2] / 1.6);
		const before = viewBox();
		await playThrough(opened);
		expect(viewBox()).toEqual(before);
	});

	it('拖過之後用兩根手指縮回整個場地，再點兩下放大、播放：又會跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		await drag();
		await pinchTo(10);
		expect(viewBox()).toEqual(full());
		await zoomIn();
		expect(viewBox()[2]).toBeCloseTo(full()[2] / 2);
		expect(await playThrough(opened)).not.toContain(false);
	});

	it('拖過之後兩根手指一起移動（中途兩指變近，一下子縮到整個場地又放大回來）、播放：還是不跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await pinchTo(105);
		await drag();
		const two = (id: number, x: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: 0 });
		await fireEvent.pointerDown(stage(), two(1, 0));
		await fireEvent.pointerDown(stage(), two(2, 100));
		await fireEvent.pointerMove(stage(), two(1, 15));
		await fireEvent.pointerMove(stage(), two(2, 115));
		await fireEvent.pointerUp(stage(), two(2, 115));
		await fireEvent.pointerUp(stage(), two(1, 15));
		expect(viewBox()[2]).toBeLessThan(full()[2]);
		const before = viewBox();
		await playThrough(opened);
		expect(viewBox()).toEqual(before);
	});

	it('放到最大、靠在左邊，兩根手指再張開（畫面放不大也移不動）、播放：照樣跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		const left = full()[0] * 100;
		const two = (id: number, x: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: 0 });
		const spread = async (a: number, b: number, to: number) => {
			await fireEvent.pointerDown(stage(), two(1, a));
			await fireEvent.pointerDown(stage(), two(2, b));
			await fireEvent.pointerMove(stage(), two(2, to));
			await fireEvent.pointerUp(stage(), two(2, to));
			await fireEvent.pointerUp(stage(), two(1, a));
		};
		await spread(left, left + 100, left + 2000);
		const maxed = viewBox();
		expect(maxed[2]).toBeCloseTo(full()[2] / 8);
		expect(maxed[0]).toBeCloseTo(full()[0]);
		await spread(0, 100, 300);
		expect(viewBox()).toEqual(maxed);
		await playThrough(opened);
		expect(viewBox()).not.toEqual(maxed);
	});

	it('放大到 1.2 倍，兩根手指放上去、送了一個位置沒變的移動就放開、播放：照樣跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await pinchTo(120);
		expect(viewBox()[2]).toBeCloseTo(full()[2] / 1.2);
		const before = viewBox();
		// 1.2 × 109 ÷ 109 在 JavaScript 是 1.1999999999999997
		const two = (id: number, x: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: 0 });
		await fireEvent.pointerDown(stage(), two(1, 0));
		await fireEvent.pointerDown(stage(), two(2, 109));
		await fireEvent.pointerMove(stage(), two(2, 109));
		await fireEvent.pointerUp(stage(), two(2, 109));
		await fireEvent.pointerUp(stage(), two(1, 0));
		expect(viewBox()).toEqual(before);
		await playThrough(opened);
		expect(viewBox()).not.toEqual(before);
	});

	it('沒選「我」放大播放：畫面不動', async () => {
		const opened = await openOnPhone(walkingFlow());
		await zoomIn();
		const before = viewBox();
		expect(await playThrough(opened)).toContain(false);
		expect(viewBox()).toEqual(before);
	});

	it('停著不播放（按下一個八拍跳過去）：畫面不動', async () => {
		await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await zoomIn();
		const before = viewBox();
		for (let i = 0; i < 3; i++) await fireEvent.click(screen.getByRole('button', { name: '下一個八拍' }));
		await flush();
		expect(inView('m2')).toBe(false);
		expect(viewBox()).toEqual(before);
	});
});

describe('手機的檢視畫面：只看有人的地方', () => {
	/** 範例流程在第 3 個八拍（8 秒）加一張站位：小A 從 (0, 1.83) 走到 (7, 6)。大家站過的地方：x −1.83～7、y 0～6（−1.83 其實是 6 呎 −1.8288）。 */
	function walkingFlow(): Flow {
		const flow = libSample();
		const added = flowOf(insertFormation(flow, 8));
		const formation = added.formations.find((f) => !flow.formations.some((o) => o.id === f.id))!;
		return flowOf(setPositions(added, formation.id, { m2: [7, 6] }));
	}
	const stage = () => document.querySelector('.phone-field svg.field')!;
	/** 場地看到的範圍（公尺）：x y 寬 高。 */
	const viewBox = () => stage().getAttribute('viewBox')!.split(' ').map(Number);
	/** 看到的範圍包住 x0～x1、y0～y1。 */
	const covers = ([x0, y0, x1, y1]: number[]) => {
		const [vx, vy, w, h] = viewBox();
		return vx <= x0 + 1e-9 && vy <= y0 + 1e-9 && vx + w >= x1 - 1e-9 && vy + h >= y1 - 1e-9;
	};
	const people = () => screen.queryByRole('button', { name: '只看有人的地方' });

	it('按「只看有人的地方」：放大到整支流程大家站過的地方，四周留 1 公尺', async () => {
		await openOnPhone(walkingFlow());
		const full = viewBox();
		await fireEvent.click(people()!);
		expect(viewBox()[2]).toBeLessThan(full[2]);
		expect(covers([-2.82, -1, 8, 7])).toBe(true);
	});

	/** 按播放，聲音每次走半秒、走到第 4 個八拍（14 秒）；每一步都記下看到的範圍。 */
	async function playThrough({ engine, frames }: Awaited<ReturnType<typeof openOnPhone>>) {
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		const seen: string[] = [];
		const start = engine.time;
		for (let s = 0.5; s <= 14; s += 0.5) {
			engine.audible = start + 0.1 + s;
			frames.step();
			await flush();
			seen.push(viewBox().join(' '));
		}
		return seen;
	}

	it('播放到後面（小A走到右下）：範圍不變', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.click(people()!);
		const fitted = viewBox().join(' ');
		expect(new Set(await playThrough(opened))).toEqual(new Set([fitted]));
	});

	it('選了「我」是小A，在這個畫面播放：畫面不跟著小A動', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await fireEvent.click(people()!);
		const fitted = viewBox().join(' ');
		expect(new Set(await playThrough(opened))).toEqual(new Set([fitted]));
	});

	it('在這個畫面照樣點得到人、捏合得了', async () => {
		await openOnPhone(walkingFlow());
		await fireEvent.click(people()!);
		await fireEvent.pointerDown(dot('m2'), { pointerType: 'touch', pointerId: 1, button: 0, clientX: 0, clientY: 183 });
		await fireEvent.pointerUp(dot('m2'), { pointerType: 'touch', pointerId: 1, button: 0, clientX: 0, clientY: 183 });
		expect(document.querySelector('.phone-field .formation-now')!.textContent).toBe('小A　技巧·Lib 主底');
		const fitted = viewBox();
		const two = (id: number, x: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: 0 });
		await fireEvent.pointerDown(stage(), two(1, 0));
		await fireEvent.pointerDown(stage(), two(2, 100));
		await fireEvent.pointerMove(stage(), two(2, 200));
		await fireEvent.pointerUp(stage(), two(2, 200));
		await fireEvent.pointerUp(stage(), two(1, 0));
		expect(viewBox()[2]).toBeLessThan(fitted[2]);
	});

	it('按「整個場地」回到整個場地，又是「只看有人的地方」', async () => {
		await openOnPhone(walkingFlow());
		const full = viewBox();
		await fireEvent.click(people()!);
		expect(people()).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '整個場地' }));
		expect(viewBox()).toEqual(full);
		expect(people()).not.toBeNull();
	});

	// 在裡面再放大照 #331 的規則：兩根手指放開時比按下時張開了，是又放大一次，跟著「我」；只移動畫面（兩指距離不變）就不跟。
	// 點兩下跟別的放大一樣回到整個場地
	/** 兩根手指：一根按在 (0, 0)，另一根從 (100, 0) 移到 to，再一起放開。 */
	async function twoFingers(to: [number, number]) {
		const two = (id: number, x: number, y: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: y });
		await fireEvent.pointerDown(stage(), two(1, 0, 0));
		await fireEvent.pointerDown(stage(), two(2, 100, 0));
		await fireEvent.pointerMove(stage(), two(2, ...to));
		await fireEvent.pointerUp(stage(), two(2, ...to));
		await fireEvent.pointerUp(stage(), two(1, 0, 0));
	}
	const inView = (id: string) => dotInView(id, viewBox());

	it('選了「我」是小A，在這個畫面捏合再放大、播放：畫面跟著小A，一直在畫面裡', async () => {
		const { engine, frames } = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await fireEvent.click(people()!);
		const fitted = viewBox();
		await twoFingers([200, 0]);
		const pinched = viewBox();
		expect(pinched[2]).toBeLessThan(fitted[2]);
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		const start = engine.time;
		// 播到 12 秒（小A 8 秒走到右下）；再播下去流程完了，停下來回到起播點
		for (let s = 0.5; s <= 12; s += 0.5) {
			engine.audible = start + 0.1 + s;
			frames.step();
			await flush();
			expect(inView('m2'), `${s} 秒`).toBe(true);
		}
		expect(viewBox()).not.toEqual(pinched);
	});

	it('選了「我」是小A，在這個畫面用兩根手指移動畫面（倍數不變）、播放：畫面不跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await fireEvent.click(people()!);
		const fitted = viewBox();
		await twoFingers([80, -60]);
		const moved = viewBox();
		expect(moved[2]).toBeCloseTo(fitted[2]);
		expect(new Set(await playThrough(opened))).toEqual(new Set([moved.join(' ')]));
	});

	it('選了「我」是小A，在這個畫面兩根手指一起移動（中途兩指變近，一下子縮到整個場地又放大回來）、播放：畫面不跟', async () => {
		const opened = await openOnPhone(walkingFlow());
		await fireEvent.change(me(), { target: { value: 'm2' } });
		await fireEvent.click(people()!);
		const two = (id: number, x: number) => ({ pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: 0 });
		await fireEvent.pointerDown(stage(), two(1, 0));
		await fireEvent.pointerDown(stage(), two(2, 100));
		await fireEvent.pointerMove(stage(), two(1, 60));
		await fireEvent.pointerMove(stage(), two(2, 160));
		await fireEvent.pointerUp(stage(), two(2, 160));
		await fireEvent.pointerUp(stage(), two(1, 60));
		const moved = viewBox();
		expect(people()).toBeNull();
		expect(new Set(await playThrough(opened))).toEqual(new Set([moved.join(' ')]));
	});

	it('在這個畫面很快點兩下：回到整個場地', async () => {
		await openOnPhone(walkingFlow());
		const full = viewBox();
		await fireEvent.click(people()!);
		for (let i = 0; i < 2; i++) {
			await fireEvent.pointerDown(stage(), { pointerType: 'touch', pointerId: 1, button: 0, clientX: 0, clientY: 0 });
			await fireEvent.pointerUp(stage(), { pointerType: 'touch', pointerId: 1, button: 0, clientX: 0, clientY: 0 });
		}
		expect(viewBox()).toEqual(full);
	});

	it('用鍵盤按「只看有人的地方」：焦點留在同一個位置的「整個場地」上', async () => {
		await openOnPhone(walkingFlow());
		people()!.focus();
		await fireEvent.click(people()!);
		expect(document.activeElement).toBe(screen.getByRole('button', { name: '整個場地' }));
	});

	it('流程裡沒有人站好：沒有這顆', async () => {
		const flow = libSample();
		await openOnPhone({ ...flow, formations: flow.formations.map((f) => ({ ...f, pos: {} })) });
		expect(people()).toBeNull();
	});

	it('大家站滿整個場地（四個人站在外圍框的四個角）：沒有這顆', async () => {
		const flow = libSample();
		const { outer } = fieldGeometry(flow.field);
		const [l, t, r, b] = [outer.x, outer.y, outer.x + outer.width, outer.y + outer.height];
		await openOnPhone(flowOf(setPositions(flow, flow.formations[0].id, { m1: [l, t], m2: [r, t], m3: [l, b], m4: [r, b] })));
		expect(people()).toBeNull();
	});
});

describe('手機的播放列：一排', () => {
	const inBar = (name: string) => within(document.querySelector<HTMLElement>('.transport')!).queryByRole('button', { name });

	it('播放、上一個八拍、時間、下一個八拍、速度、「⋯」；回開頭、節拍器、重複收在「⋯」裡', async () => {
		await openOnPhone();
		for (const name of ['播放', '上一個八拍', '跳到哪裡', '下一個八拍', '更多播放選項']) expect(inBar(name)).toBeTruthy();
		expect(screen.getByRole('combobox', { name: '播放速度' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '回開頭' })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: /節拍器/ })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: /重複/ })).toBeNull();

		await fireEvent.click(inBar('更多播放選項')!);
		const more = within(screen.getByRole('group', { name: '更多播放選項' }));
		expect(more.getByRole('button', { name: '回開頭' })).toBeTruthy();
		expect(more.getByRole('checkbox', { name: /節拍器/ })).toBeTruthy();
		expect(more.getByRole('checkbox', { name: /重複/ })).toBeTruthy();
		expect(more.getByRole('spinbutton', { name: '延遲校正（毫秒）' })).toBeTruthy();
	});

	it('「⋯」裡關節拍器（本來開著）：小窗留著，節拍器關了', async () => {
		const { editor } = await openOnPhone();
		expect(editor.playback.metronome).toBe(true);
		await fireEvent.click(inBar('更多播放選項')!);
		await fireEvent.click(screen.getByRole('checkbox', { name: /節拍器/ }));
		expect(editor.playback.metronome).toBe(false);
		expect(screen.getByRole('group', { name: '更多播放選項' })).toBeTruthy();
	});
});

describe('手機的進度條', () => {
	// 假的座標換算（editorPage）：手指在 clientX 就是整支流程的 clientX%（範例 4 個八拍 16 秒，66 是 10.56 秒，在 3-6）
	const bar = () => screen.getByRole('slider', { name: '進度條' });
	const where = () => screen.getByLabelText('目前位置').textContent;

	it('拖到中間：播放頭跟著手指，看得到第幾個八拍；放開對齊最近的八拍開頭，前後八拍跟著換；不算改流程', async () => {
		const { session } = await openOnPhone();
		expect(bar().getAttribute('aria-valuetext')).toBe('音樂 1 1-1');
		await fireEvent.pointerDown(bar(), { clientX: 40, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 66 });
		// 拖的時候還沒對齊：在 3-6，進度條上寫「3-6」
		expect(where()).toBe('音樂 1 3-6');
		expect(bar().textContent).toBe('3-6');
		await fireEvent.pointerUp(window, { clientX: 66 });
		// 10.56 秒離 4-1（12 秒）比 3-1（8 秒）近
		expect(where()).toBe('音樂 1 4-1');
		expect(bar().getAttribute('aria-valuetext')).toBe('音樂 1 4-1');
		expect(bar().textContent).toBe('');
		expect([...row().querySelectorAll('[data-slot]')].map((s) => s.getAttribute('data-slot'))).toEqual(['4', '']);
		expect(session.unsaved).toBe(false);
	});

	it('播放中拖（拖過最右邊也一樣）：放開照樣在播，從對齊的八拍開頭接著播', async () => {
		await openOnPhone();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		await fireEvent.pointerDown(bar(), { clientX: 10, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 120 });
		// 按著的時候先停（播放頭留在手指那裡），放開才接著播
		await fireEvent.pointerUp(window, { clientX: 120 });
		// 流程結尾不算八拍開頭：停在最後一個八拍的開頭
		expect(where()).toBe('音樂 1 4-1');
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
	});

	it('播放中按住在最右邊不放、播到結尾：放開照樣在播（按著的時候播完不算停）', async () => {
		const { engine, frames } = await openOnPhone();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		await fireEvent.pointerDown(bar(), { clientX: 10, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 120 });
		// 按著一秒：播放頭從結尾前 0.1 秒播到結尾
		engine.audible = engine.time + 0.1 + 1;
		frames.step();
		await flush();
		await fireEvent.pointerUp(window, { clientX: 120 });
		expect(where()).toBe('音樂 1 4-1');
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
	});

	it('播放中按住不動：播放頭停在手指那裡，不跟著播放跑；放開接著播', async () => {
		const { engine, frames } = await openOnPhone();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		await fireEvent.pointerDown(bar(), { clientX: 25, button: 0 });
		expect(where()).toBe('音樂 1 2-1');
		engine.audible = engine.time + 0.1 + 3;
		frames.step();
		await flush();
		expect(where()).toBe('音樂 1 2-1');
		expect(bar().textContent).toBe('2-1');
		await fireEvent.pointerUp(window, { clientX: 25 });
		expect(where()).toBe('音樂 1 2-1');
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
	});

	it('拖的時候第二根手指按到進度條：不搶走，照樣跟著第一根手指', async () => {
		await openOnPhone();
		await fireEvent.pointerDown(bar(), { clientX: 25, button: 0, pointerId: 1 });
		await fireEvent.pointerDown(bar(), { clientX: 60, button: 0, pointerId: 2 });
		expect(where()).toBe('音樂 1 2-1');
		await fireEvent.pointerUp(window, { clientX: 60, pointerId: 2 });
		expect(bar().textContent).toBe('2-1');
		await fireEvent.pointerUp(window, { clientX: 25, pointerId: 1 });
		expect(where()).toBe('音樂 1 2-1');
	});

	it('停著拖：放開照樣停著', async () => {
		await openOnPhone();
		await fireEvent.pointerDown(bar(), { clientX: 30, button: 0 });
		await fireEvent.pointerUp(window, { clientX: 30 });
		expect(where()).toBe('音樂 1 2-1');
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
	});

	it('流程最後是口號段：拖進口號段裡，播放頭跟著手指在段裡跑；放開回到口號段的開頭', async () => {
		// 音樂 1 16 秒後面接口號 1：拖到 80% 在口號 1 的中間（不是開頭）
		const flow = flowOf(updateSegment(flowOf(addSegment(libSample(), 'chant')), 's2', { seconds: 10 }));
		await openOnPhone(flow);
		await fireEvent.pointerDown(bar(), { clientX: 10, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 80 });
		expect(where()).toMatch(/^口號 1 [1-9]\.\d 秒$/);
		await fireEvent.pointerUp(window, { clientX: 80 });
		expect(where()).toBe('口號 1 0.0 秒');
	});

	it('橫拿的 iPad（一般版面）：檢視模式也有進度條，拖了一樣對齊八拍開頭；編輯時沒有', async () => {
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		const { session } = await openOnPhone();
		expect(screen.queryByRole('slider', { name: '進度條' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '檢視' }));
		await fireEvent.pointerDown(bar(), { clientX: 30, button: 0 });
		await fireEvent.pointerUp(window, { clientX: 30 });
		expect(where()).toBe('音樂 1 2-1');
		expect(session.unsaved).toBe(false);
	});
});

describe('手機的練習頁', () => {
	/** 範例流程拿掉環節：沒有要記的動作。 */
	function noPhases(): Flow {
		const flow = libSample();
		return { ...flow, actions: flow.actions.map(({ successRate: _, ...a }) => a) };
	}

	it('流程還沒有環節：記錄、總表都說要用電腦或橫放的 iPad 加環節，沒有「記一次全上」', async () => {
		await openOnPhone(noPhases());
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const practice = screen.getByRole('region', { name: '練習' });
		expect(practice.textContent).toContain('電腦或橫放的 iPad');
		expect(screen.queryByRole('button', { name: /記一次全上/ })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '總表' }));
		expect(practice.textContent).toContain('電腦或橫放的 iPad');
		expect(screen.queryByRole('button', { name: /記一次全上/ })).toBeNull();
	});

	it('動作清單是下拉選單：選一個動作，顯示它的卡片並捲過去', async () => {
		const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
		await openOnPhone(ratedSample());
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(screen.queryByRole('list', { name: '記成功率的動作' })).toBeNull();
		const pick = screen.getByRole('combobox', { name: '記哪個動作' }) as HTMLSelectElement;
		expect([...pick.options].map((o) => o.textContent)).toEqual(['技巧·Lib', '騰翻']);
		expect(screen.getByRole('region', { name: '第 1 組 小美' })).toBeTruthy();

		scrolled.mockClear();
		await fireEvent.change(pick, { target: { value: pick.options[1].value } });
		expect(screen.getByRole('region', { name: '小美' })).toBeTruthy();
		expect(screen.queryByRole('region', { name: '第 1 組 小美' })).toBeNull();
		expect(scrolled).toHaveBeenCalled();
		scrolled.mockRestore();
	});
});

describe('為什麼不能編：照螢幕寫轉成橫的、太窄或太矮', () => {
	const real = { w: window.innerWidth, h: window.innerHeight };
	/** 視窗多大、是不是觸控螢幕（pointer: coarse）。 */
	function screenOf(w: number, h: number, touch: boolean) {
		Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
		Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN || (touch && query === '(pointer: coarse)') }));
	}
	afterEach(() => {
		Object.defineProperty(window, 'innerWidth', { value: real.w, configurable: true });
		Object.defineProperty(window, 'innerHeight', { value: real.h, configurable: true });
	});
	const why = () => document.querySelector('.phone-why')?.textContent ?? '';

	it('直拿的 iPad（768×1024 觸控）：請轉成橫的，不寫太窄', async () => {
		screenOf(768, 1024, true);
		await openOnPhone();
		expect(why()).toContain('請轉成橫的');
		expect(why()).not.toContain('太窄');
	});

	it('很矮的視窗（1440×500）：寫太矮，不寫太窄', async () => {
		screenOf(1440, 500, false);
		await openOnPhone();
		expect(why()).toContain('太矮');
		expect(why()).not.toContain('太窄');
	});

	it('手機直拿（390×844 觸控）轉過來也不夠寬：寫太窄，不叫人轉', async () => {
		screenOf(390, 844, true);
		await openOnPhone();
		expect(why()).toContain('太窄');
		expect(why()).not.toContain('轉成橫的');
	});

	it('窄的桌面視窗（800×900）：寫太窄', async () => {
		screenOf(800, 900, false);
		await openOnPhone();
		expect(why()).toContain('太窄');
	});

	it('手機（390×844 觸控）：跟電腦叫法一樣寫「檢視模式・只能看」，為什麼不能編不寫「像素」這種技術用語（N37）', async () => {
		screenOf(390, 844, true);
		await openOnPhone();
		expect(why()).toContain('檢視模式・只能看');
		expect(why()).not.toContain('像素');
	});
});
