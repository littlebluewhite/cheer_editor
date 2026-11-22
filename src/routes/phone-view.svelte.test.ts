// 手機（窄螢幕）的檢視模式（#175，docs/adr/0005-ipad-touch.md）：上面場地、中間播放鈕、下面前後八拍（這個和下一個八拍）；
// 從名單選一次「我」，這台裝置照流程記住（不進流程檔），之後打開就把我標亮。
// 窄不窄是媒體查詢（NARROW_SCREEN）的事：jsdom 沒有 matchMedia，換一個假的說「窄」。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertFormation, readFlowFile, setPositions, stepPlayhead, writeFlowFile, type Flow } from '#lib/core';
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

describe('手機的檢視模式', () => {
	it('開檔直接看到場地、播放鈕、前後八拍；按播放，播放頭和八拍表跟著走', async () => {
		const { engine, frames } = await openOnPhone();
		// 不停在被擋住的編排畫面
		expect(screen.queryByRole('region', { name: '視窗太窄了' })).toBeNull();
		expect(screen.getByRole('img', { name: '場地' })).toBeTruthy();
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
	const field = () => screen.getByRole('img', { name: '場地' });

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
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
		await fireEvent.pointerUp(window, { clientX: 120 });
		// 流程結尾不算八拍開頭：停在最後一個八拍的開頭
		expect(where()).toBe('音樂 1 4-1');
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
	});

	it('停著拖：放開照樣停著', async () => {
		await openOnPhone();
		await fireEvent.pointerDown(bar(), { clientX: 30, button: 0 });
		await fireEvent.pointerUp(window, { clientX: 30 });
		expect(where()).toBe('音樂 1 2-1');
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
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
