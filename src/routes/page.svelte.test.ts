import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEngine, type FakeEngine } from '#lib/audio/fake-engine.js';
import {
	addAction,
	addMembers,
	addSegment as addSegmentTo,
	createFlow,
	insertFormation,
	renameFlow,
	setMarkers,
	setPositions
} from '#lib/core';
import { flowOf, libSample } from '#lib/test-flows.js';
import { editorPage } from '#lib/test-fakes.js';
import Page from './+page.svelte';

/** 放進 session 的流程：「全國賽」，什麼都還沒有。 */
const sessionFlow = () => flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));

/** 打開某個人的任務角色選單，點一個角色（空字串是沒有任務）。 */
async function pickRole(who: string, role: string) {
	await fireEvent.click(screen.getByRole('combobox', { name: `${who} 的任務角色` }));
	await fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${role || '（沒有任務）'}`) }));
}

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 新建一個流程。jsdom 不算 SVG 座標：場地的螢幕換公尺換成 1 px = 1 cm（見 ADR 0002）。 */
async function newFlow(engine: FakeEngine = createFakeEngine()) {
	render(Page, editorPage(null, { createEngine: () => engine }).props);
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

/** 右邊欄換頁：「動作」或「隊員」。 */
const tab = (name: '動作' | '隊員') => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));

describe('段、八拍尺、上方列', () => {
	it('「＋」在最後加音樂段，打開段設定；關掉後點段可以再打開', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		expect(screen.getByRole('dialog', { name: '音樂 1 設定' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /音樂 1/ }));
		expect(screen.getByRole('dialog', { name: '音樂 1 設定' })).toBeTruthy();
	});

	it('在八拍尺上點或拖，上方列顯示播放頭的位置', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		const ruler = document.querySelector('[data-ruler]')!;
		// 時間軸 1 秒 = 16 px；150 BPM 一拍 0.4 秒，3-5& 在 8.2 秒、3-6 在 8.4 秒：點在 8.3 秒吸到整拍 3-6
		await fireEvent.pointerDown(ruler, { clientX: 8.3 * 16, button: 0 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-6');
		await fireEvent.pointerMove(window, { clientX: 1.7 * 16 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-5');
		await fireEvent.pointerUp(window);
		await fireEvent.pointerMove(window, { clientX: 0 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-5');
		// 按著 Option／Alt 點，吸到半拍
		await fireEvent.pointerDown(ruler, { clientX: 8.25 * 16, button: 0, altKey: true });
		await fireEvent.pointerUp(window);
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-5&');
	});

	it('段旁的「＋」：選「＋口號段」就插在這段後面', async () => {
		await newFlow();
		await addSegment('＋音樂段');
		await addSegment('＋音樂段');
		await fireEvent.click(screen.getAllByRole('button', { name: '在這段後面加一段' })[0]);
		expect(screen.getByText('加在音樂 1 後面')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '＋口號段' }));
		expect(screen.getByRole('dialog', { name: '口號 1 設定' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		const segs = [...document.querySelectorAll('.timeline .segs .seg b')].map((b) => b.textContent);
		expect(segs).toEqual(['音樂 1', '口號 1', '音樂 2']);
	});

	it('點八拍數字：播放頭停在那個八拍的第 1 拍', async () => {
		await newFlow();
		await addSegment('＋音樂段');
		const ruler = document.querySelector('[data-ruler]')!;
		const three = within(ruler as HTMLElement).getByText('3');
		// 數字寫在刻度右邊一點：點在數字上（3-1 是 6.4 秒，往右 10 px）
		await fireEvent.pointerDown(three, { clientX: 6.4 * 16 + 10, button: 0 });
		await fireEvent.pointerUp(window);
		expect(position()).toBe('音樂 1 3-1');
	});

	it('沒有段時播放鍵是灰的，提示先加一段', async () => {
		await newFlow();
		const play = screen.getByRole('button', { name: '播放' }) as HTMLButtonElement;
		expect(play.disabled).toBe(true);
		expect(play.title).toBe('先加一段');
		await addSegment('＋音樂段');
		expect((screen.getByRole('button', { name: '播放' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('方向鍵移播放頭：一次一拍，Shift 一個八拍；在輸入框裡不算（怎麼移在 playback 測）', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		const position = () => screen.getByLabelText('目前位置').textContent;
		await fireEvent.keyDown(window, { key: 'ArrowRight' });
		expect(position()).toBe('音樂 1 1-2');
		await fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
		expect(position()).toBe('音樂 1 2-1');
		await fireEvent.keyDown(window, { key: 'ArrowLeft' });
		expect(position()).toBe('音樂 1 1-8');
		await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'ArrowRight' });
		expect(position()).toBe('音樂 1 1-8');
	});

	it('在八拍尺上拖到右邊緣時時間軸不自己捲走（不然尺跟著滑鼠跑，播放頭會亂跳）', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		const timeline = document.querySelector('.timeline') as HTMLElement;
		// jsdom 沒有排版：假裝時間軸看得到 400 px（扣掉名字欄 148 px，剩 252 px）
		Object.defineProperty(timeline, 'clientWidth', { value: 400 });
		const ruler = document.querySelector('[data-ruler]')!;
		await fireEvent.pointerDown(ruler, { clientX: 0, button: 0 });
		// 1 秒 = 16 px；拖到 15 秒（240 px），已經在右邊緣附近
		await fireEvent.pointerMove(window, { clientX: 15 * 16 });
		await tick();
		expect(timeline.scrollLeft).toBe(0);
		await fireEvent.pointerUp(window);
	});

	it('超過時間規則時上方列提醒；流程設定可以關掉或改數字', async () => {
		await newFlow();
		expect(screen.queryByText(/口號段共/)).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(screen.getByText(/口號段共 0.0 秒，少於 30 秒/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		await fireEvent.change(screen.getByLabelText('口號段最少（秒）'), { target: { value: '0' } });
		expect(screen.queryByText(/口號段共/)).toBeNull();
		await fireEvent.change(screen.getByLabelText('口號段最少（秒）'), { target: { value: '30' } });
		expect(screen.getByText(/口號段共 0.0 秒/)).toBeTruthy();
		await fireEvent.click(screen.getByLabelText('規則警告（只提醒，不擋）'));
		expect(screen.queryByText(/口號段共/)).toBeNull();
	});

	it('首頁和上方列都有「使用說明」，開在新分頁（編輯畫面留著，還沒存的修改不會不見）', async () => {
		render(Page, editorPage().props);
		const check = () => {
			const link = screen.getByRole('link', { name: '使用說明' }) as HTMLAnchorElement;
			expect(link.getAttribute('href')).toMatch(/\/guide$/);
			expect(link.target).toBe('_blank');
		};
		check();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		check();
	});

	it('流程名字最多 40 個字：新建和流程設定都擋下，說最多幾個字', async () => {
		render(Page, editorPage().props);
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '字'.repeat(41) } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(screen.getByRole('alert').textContent).toContain('流程名字最多 40 個字');
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '字'.repeat(40) } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const name = screen.getByLabelText('流程名字') as HTMLInputElement;
		await fireEvent.change(name, { target: { value: '名'.repeat(41) } });
		expect(screen.getByRole('alert').textContent).toContain('流程名字最多 40 個字');
		expect(name.value).toBe('字'.repeat(40));
	});

	it('段設定：口號段超過 300 秒、八拍數超過 200 擋下，訊息寫範圍，欄位退回，流程不改', async () => {
		await newFlow();
		await addSegment('＋音樂段');
		await addSegment('＋口號段');
		await fireEvent.click(screen.getByRole('button', { name: /^口號 1/ }));
		const seconds = screen.getByLabelText('長度（秒）') as HTMLInputElement;
		await fireEvent.change(seconds, { target: { value: '99999999' } });
		expect(screen.getByRole('alert').textContent).toBe('「長度（秒）」退回原本的值：口號段長度要在 0.1 到 300 秒之間');
		expect(seconds.value).toBe('10');
		await fireEvent.change(seconds, { target: { value: '-3' } });
		expect(screen.getByRole('alert').textContent).toContain('要在 0.1 到 300 秒之間');
		await fireEvent.pointerDown(screen.getByRole('button', { name: '關閉' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		const eights = screen.getByLabelText('八拍數') as HTMLInputElement;
		await fireEvent.change(eights, { target: { value: '50000' } });
		expect(screen.getByRole('alert').textContent).toBe('「八拍數」退回原本的值：八拍數要在 1 到 200 之間');
		expect(eights.value).toBe('8');
		expect(screen.getByRole('dialog').textContent).toContain('共 25.6 秒');
	});

	it('段設定：八拍數和最後一拍各自說自己的錯；全形數字當成半形', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: '0' } });
		await fireEvent.change(screen.getByLabelText('最後一個八拍有幾拍'), { target: { value: '9' } });
		expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
			'「八拍數」退回原本的值：八拍數要在 1 到 200 之間',
			'「最後一個八拍有幾拍」退回原本的值：最後一個八拍的拍數要在 1 到 8 之間'
		]);
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: '１２' } });
		await fireEvent.change(screen.getByLabelText('最後一個八拍有幾拍'), { target: { value: '４' } });
		expect(screen.queryAllByRole('alert')).toEqual([]);
		expect(screen.getByRole('dialog').textContent).toContain('共 36.8 秒');
	});

	it('流程設定可以改流程名字；空白會被擋，欄位還原', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const name = screen.getByLabelText('流程名字') as HTMLInputElement;
		await fireEvent.change(name, { target: { value: ' 臺灣盃 ' } });
		expect(document.querySelector('.topbar b')?.textContent).toBe('臺灣盃');
		await fireEvent.change(name, { target: { value: ' ' } });
		expect(screen.getByRole('alert').textContent).toContain('請幫流程取名字');
		expect(name.value).toBe('臺灣盃');
		expect(document.querySelector('.topbar b')?.textContent).toBe('臺灣盃');
	});

	it('流程設定可以把標記換成開頭字：場上、泳道、名單都跟著換，可以復原', async () => {
		await newFlow();
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '王小明\n王大華\n李美' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
		await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'base' } });
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		const dots = () => [...document.querySelectorAll('[data-member-id] text')].map((t) => t.textContent);
		const lanes = () => [...document.querySelectorAll('[data-lane] .no')].map((el) => el.textContent);
		expect(dots()).toEqual(['1', '2', '3']);

		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const dialog = screen.getByRole('dialog', { name: '流程設定' });
		await fireEvent.click(within(dialog).getByLabelText('開頭字（名字的第一個字）'));
		// 預覽：每個人的標記和名字
		expect(within(dialog).getByText('王小明').previousElementSibling?.textContent).toBe('王小');
		expect(dots()).toEqual(['王小', '王大', '李']);
		expect(lanes()).toEqual(['王小', '王大', '李']);
		expect([...document.querySelectorAll('.members li .no')].map((el) => el.textContent)).toEqual([
			'王小',
			'王大',
			'李'
		]);

		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await fireEvent.click(screen.getByRole('button', { name: /復原/ }));
		expect(dots()).toEqual(['1', '2', '3']);
	});
});

describe('動作', () => {
	async function withAction(engine?: FakeEngine) {
		await newFlow(engine);
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
		await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'base' } });
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		await tab('動作');
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm1' } });
		await pickRole('小A', '上層');
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
	}

	const bar = () => document.querySelector('[data-lane="m1"] [data-action-id]');
	const dot = () => document.querySelector('[data-member-id="m1"]')!;

	it('在任務角色選單上按 Backspace 只是改成沒有任務，不會刪掉選到的動作', async () => {
		await withAction();
		const picker = screen.getByRole('combobox', { name: '小A 的任務角色' });
		picker.focus();
		await fireEvent.keyDown(picker, { key: 'Backspace' });
		expect(bar()).not.toBeNull();
		expect(screen.getByRole('combobox', { name: '小A 的任務角色' }).textContent).toBe('（沒有任務）');
	});

	it('新增的動作出現在泳道上；任務角色是上層的人在場上畫在最上面；閒著的人標「閒」', async () => {
		await withAction();
		expect(bar()?.textContent).toContain('上層');
		// 新增後播放頭跳到動作結束：移回動作裡
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: 0, button: 0 });
		await fireEvent.pointerUp(window);
		expect(dot().classList.contains('raised')).toBe(true);
		expect(document.querySelector('[data-lane="m1"] .idle-tag')).toBeNull();
		// 播放頭移到動作之後（一個八拍 = 3.2 秒）
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: 4 * 16, button: 0 });
		await fireEvent.pointerUp(window);
		expect(document.querySelector('[data-lane="m1"] .idle-tag')).toBeTruthy();
		expect(dot().classList.contains('raised')).toBe(false);
	});

	it('新增後就選到這個動作；Esc 清除選取，按 Delete 不會刪', async () => {
		await withAction();
		expect(bar()?.classList.contains('selected')).toBe(true);
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(bar()?.classList.contains('selected')).toBe(false);
		expect(screen.getByRole('button', { name: '新增動作' })).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(bar()).toBeTruthy();
	});

	describe('場地左邊的「多選」「取消選取」只在觸控螢幕上有（docs/adr/0005-ipad-touch.md）', () => {
		afterEach(() => vi.unstubAllGlobals());

		const touchScreen = () =>
			vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
		const multi = () => screen.queryByRole('checkbox', { name: '多選' }) as HTMLInputElement | null;
		const clear = () => screen.queryByRole('button', { name: '取消選取' }) as HTMLButtonElement | null;
		const name = () => document.querySelector('[data-lane="m1"] .lab')!;

		it('電腦上沒有；Shift＋點、Esc 照舊', async () => {
			vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: fine)' }));
			await withAction();
			expect(multi()).toBeNull();
			expect(clear()).toBeNull();

			await fireEvent.keyDown(window, { key: 'Escape' });
			await fireEvent.click(name());
			expect(dot().classList.contains('selected')).toBe(true);
			await fireEvent.click(name(), { shiftKey: true });
			expect(dot().classList.contains('selected')).toBe(false);
			await fireEvent.click(name());
			await fireEvent.keyDown(window, { key: 'Escape' });
			expect(dot().classList.contains('selected')).toBe(false);
		});

		it('觸控螢幕：「取消選取」跟 Esc 一樣，動作和人的選取都清掉；沒有選東西時按不了', async () => {
			touchScreen();
			await withAction();
			await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
			expect(clear()!.disabled).toBe(false);
			await fireEvent.click(clear()!);
			expect(bar()?.classList.contains('selected')).toBe(false);
			expect(dot().classList.contains('selected')).toBe(false);
			expect(clear()!.disabled).toBe(true);
		});

		it('觸控螢幕：打開「多選」，不按 Shift 點泳道名字也是加進來或拿掉', async () => {
			touchScreen();
			await withAction();
			await fireEvent.keyDown(window, { key: 'Escape' });
			await fireEvent.click(multi()!);
			await fireEvent.click(name());
			expect(dot().classList.contains('selected')).toBe(true);
			await fireEvent.click(name());
			expect(dot().classList.contains('selected')).toBe(false);
		});
	});

	it('名詞對照表開著時按 Esc 只關掉它，不清除選到的動作', async () => {
		await withAction();
		await fireEvent.click(screen.getByRole('button', { name: '名詞對照表' }));
		expect(screen.getByRole('dialog', { name: '名詞對照表' })).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: '名詞對照表' })).toBeNull();
		expect(bar()?.classList.contains('selected')).toBe(true);
	});

	it('點色條選動作，按 Delete 刪掉；在輸入框裡按 Delete 不刪', async () => {
		await withAction();
		await fireEvent.keyDown(window, { key: 'Escape' });
		await fireEvent.click(bar()!);
		await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'Delete' });
		expect(bar()).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(bar()).toBeNull();
	});

	it('選人：一鍵全隊、點泳道上的名字，場上的點有記號；Esc 清除', async () => {
		await withAction();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(dot().classList.contains('selected')).toBe(false);
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		expect(dot().classList.contains('selected')).toBe(true);
		expect(screen.getByText('已選 1 人：小A')).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(dot().classList.contains('selected')).toBe(false);
		await fireEvent.click(document.querySelector('[data-lane="m1"] .lab')!);
		expect(dot().classList.contains('selected')).toBe(true);
	});

	it('拍子：點格子、按 ＋、點 down 和 up，拍子出現在格子裡；可以復原', async () => {
		await withAction();
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		const selection = () => grid.getByText(/^選了/).textContent;
		await fireEvent.click(grid.getByRole('button', { name: '1-3' }));
		expect(selection()).toBe('選了 1-3・1 拍');
		await fireEvent.click(grid.getByRole('button', { name: '多選一拍' }));
		expect(selection()).toBe('選了 1-3 到 1-4・2 拍');
		await fireEvent.click(grid.getByRole('button', { name: 'down' }));
		// 放完跳到下一拍，直接點 up 就接上。
		expect(selection()).toBe('選了 1-5・1 拍');
		await fireEvent.click(grid.getByRole('button', { name: 'up' }));
		const placed = () => grid.queryAllByRole('button', { name: /^拍子 / }).map((b) => b.getAttribute('aria-label'));
		expect(placed()).toEqual(['拍子 down 1-3 到 1-4・2 拍', '拍子 up 1-5・1 拍']);

		// 點放好的拍子，選回它佔的那幾拍；清掉拍子只清選到的。
		await fireEvent.click(grid.getByRole('button', { name: '拍子 down 1-3 到 1-4・2 拍' }));
		expect(selection()).toBe('選了 1-3 到 1-4・2 拍');
		await fireEvent.click(grid.getByRole('button', { name: '少選一拍' }));
		await fireEvent.click(grid.getByRole('button', { name: '清掉拍子' }));
		expect(placed()).toEqual(['拍子 down 1-4・1 拍', '拍子 up 1-5・1 拍']);

		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(placed()).toEqual(['拍子 down 1-3 到 1-4・2 拍', '拍子 up 1-5・1 拍']);
	});

	/** 拍點小窗開著時，在「給誰」選一個。 */
	async function pickWho(label: string) {
		const who = screen.getByRole('combobox', { name: '給誰' }) as HTMLSelectElement;
		const i = [...who.options].findIndex((o) => o.textContent === label);
		await fireEvent.change(who, { target: { value: String(i) } });
	}

	/** 在動作上放 down 1-1 到 1-2、up 1-3。 */
	async function withCounts() {
		await withAction();
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-1' }));
		await fireEvent.click(grid.getByRole('button', { name: '多選一拍' }));
		await fireEvent.click(grid.getByRole('button', { name: 'down' }));
		await fireEvent.click(grid.getByRole('button', { name: 'up' }));
	}
	const placedCues = () =>
		within(screen.getByRole('group', { name: '拍點' }))
			.queryAllByRole('button', { name: /^拍子 / })
			.map((b) => b.getAttribute('aria-label'));

	it('在表單把動作改短、會切到拍點：先問；取消就還原，確定才切', async () => {
		await withCounts();
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		await fireEvent.input(length, { target: { value: '1' } });
		await fireEvent.change(length);
		const dialog = within(screen.getByRole('alertdialog'));
		expect(dialog.getByText('動作「技巧」變短，會拿掉 1 個、切短 1 個拍點')).toBeTruthy();
		expect(dialog.getByText('切短：拍子 down 1-1 到 1-2 → 1-1')).toBeTruthy();
		expect(dialog.getByText('拿掉：拍子 up 1-3')).toBeTruthy();

		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(length.value).toBe('8');
		expect(placedCues()).toEqual(['拍子 down 1-1 到 1-2・2 拍', '拍子 up 1-3・1 拍']);

		await fireEvent.input(length, { target: { value: '1' } });
		await fireEvent.change(length);
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '確定' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(length.value).toBe('1');
		expect(placedCues()).toEqual(['拍子 down 1-1・1 拍']);
	});

	it('在泳道上拉色條變短、會切到拍點：放開後在上方列問；取消就回到原來的長度', async () => {
		await withCounts();
		const handle = () => bar()!.querySelector('[data-resize]')!;
		const width = () => (bar() as HTMLElement).style.width;
		const before = width();
		// 1 秒 16 px，一個半拍 0.2 秒：往左拉 38.4 px = 12 個半拍，剩 2 拍。
		const shrink = async () => {
			await fireEvent.pointerDown(handle(), { clientX: 51, button: 0 });
			await fireEvent.pointerMove(window, { clientX: 51 - 38.4 });
			await fireEvent.pointerUp(window, { clientX: 51 - 38.4 });
		};
		await shrink();
		const dialog = within(screen.getByRole('alertdialog'));
		expect(dialog.getByText('動作「技巧」變短，會拿掉 1 個拍點')).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(width()).toBe(before);

		await shrink();
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '確定' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(width()).not.toBe(before);
		expect(placedCues()).toEqual(['拍子 down 1-1 到 1-2・2 拍']);
	});

	it('步驟和手位：點按鈕放好；自己打字加入後變成按鈕；三個清除鈕各清各的', async () => {
		await withAction();
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		const placed = () =>
			grid.queryAllByRole('button', { name: /^(拍子|步驟|手位) / }).map((b) => b.getAttribute('aria-label'));

		// 選 1-3 到 1-4，點「下手」放滿兩拍；手位只放在第一拍。
		await fireEvent.click(grid.getByRole('button', { name: '1-3' }));
		const steps = within(grid.getByRole('group', { name: '步驟' }));
		const motions = within(grid.getByRole('group', { name: '手位' }));
		await fireEvent.click(grid.getByRole('button', { name: '多選一拍' }));
		await fireEvent.click(steps.getByRole('button', { name: '下手' }));
		await fireEvent.click(motions.getByRole('button', { name: 'high V' }));
		await fireEvent.click(grid.getByRole('button', { name: 'down' }));
		expect(placed()).toEqual(['拍子 down 1-3 到 1-4・2 拍', '步驟 下手 1-3 到 1-4・2 拍', '手位 high V 1-3・1 拍']);

		// 自己打步驟：空著時「加入」按不下去；中文輸入法選字時的 Enter 不算；Enter 才加入。
		const stepInput = steps.getByRole('textbox', { name: '自己打步驟' });
		const addStep = steps.getByRole('button', { name: '加入步驟' }) as HTMLButtonElement;
		expect(stepInput.getAttribute('placeholder')).not.toMatch(/cradle/i);
		expect(addStep.disabled).toBe(true);
		await fireEvent.click(grid.getByRole('button', { name: '1-4' }));
		await fireEvent.input(stepInput, { target: { value: ' 抬腳 ' } });
		expect(addStep.disabled).toBe(false);
		await fireEvent.keyDown(stepInput, { key: 'Enter', isComposing: true });
		expect(placed()).toContain('步驟 下手 1-3 到 1-4・2 拍');
		await fireEvent.keyDown(stepInput, { key: 'Enter' });
		expect(placed()).toContain('步驟 抬腳 1-4・1 拍');
		expect((stepInput as HTMLInputElement).value).toBe('');
		expect(steps.getByRole('button', { name: '抬腳' })).toBeTruthy();

		// 自己打手位，按「加入」。
		await fireEvent.input(motions.getByRole('textbox', { name: '自己打手位' }), { target: { value: '拳頭' } });
		await fireEvent.click(motions.getByRole('button', { name: '加入手位' }));
		expect(placed()).toContain('手位 拳頭 1-4・1 拍');
		expect(motions.getByRole('button', { name: '拳頭' })).toBeTruthy();

		// 點放好的步驟，選回它佔的拍。
		await fireEvent.click(grid.getByRole('button', { name: '步驟 下手 1-3・1 拍' }));
		expect(grid.getByText(/^選了/).textContent).toBe('選了 1-3・1 拍');
		await fireEvent.click(grid.getByRole('button', { name: '多選一拍' }));

		await fireEvent.click(grid.getByRole('button', { name: '清掉步驟' }));
		expect(placed()).toEqual(['拍子 down 1-3 到 1-4・2 拍', '手位 high V 1-3・1 拍', '手位 拳頭 1-4・1 拍']);
		await fireEvent.click(grid.getByRole('button', { name: '清掉手位' }));
		expect(placed()).toEqual(['拍子 down 1-3 到 1-4・2 拍']);
		await fireEvent.click(grid.getByRole('button', { name: '清掉拍子' }));
		expect(placed()).toEqual([]);
	});

	it('給誰：預設全部；選「上層」再點 high V，它下面寫「上層」，跟全部的手位疊在同一拍', async () => {
		await withAction();
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-7' }));
		const who = grid.getByRole('combobox', { name: '給誰' }) as HTMLSelectElement;
		const chosen = () => who.selectedOptions[0].textContent;
		expect([...who.options].map((o) => o.textContent)).toEqual(['全部', '上層', '小A']);
		expect(chosen()).toBe('全部');

		const motions = within(grid.getByRole('group', { name: '手位' }));
		await fireEvent.click(motions.getByRole('button', { name: 'T' }));
		await pickWho('上層');
		expect(chosen()).toBe('上層');
		await fireEvent.click(motions.getByRole('button', { name: 'high V' }));

		const highV = grid.getByRole('button', { name: '手位 high V 1-7・1 拍・給上層' });
		expect(highV.textContent).toContain('上層');
		const t = grid.getByRole('button', { name: '手位 T 1-7・1 拍' });
		expect(t.textContent?.trim()).toBe('T');
	});

	it('播放到拍點上：場地左上角大字寫現在的步驟、拍子和走到第幾拍，下面預告下一個', async () => {
		const engine = createFakeEngine();
		await withAction(engine);
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		const more = async (n: number) => {
			for (let i = 0; i < n; i++) await fireEvent.click(grid.getByRole('button', { name: '多選一拍' }));
		};
		await fireEvent.click(grid.getByRole('button', { name: '1-3' }));
		await more(3);
		await fireEvent.click(within(grid.getByRole('group', { name: '步驟' })).getByRole('button', { name: '下手' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-3' }));
		await more(1);
		await fireEvent.click(grid.getByRole('button', { name: 'down' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-7' }));
		await pickWho('上層');
		await fireEvent.click(within(grid.getByRole('group', { name: '手位' })).getByRole('button', { name: 'high V' }));

		// 播放頭在 1-1：還沒有拍點亮，先預告 1-3 的兩個。
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: 0, button: 0 });
		await fireEvent.pointerUp(window);
		const card = () => screen.getByRole('region', { name: '這一拍' }).textContent!.replace(/\s+/g, ' ');
		expect(card()).toContain('技巧');
		expect(card()).toContain('下一個 1-3：下手、down');

		// 播到 1-4（150 BPM 一拍 0.4 秒，1-4 在 1.2 秒）。
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		engine.audible = engine.clicks[0].when + 1.3;
		await nextFrame();
		expect(card()).toContain('下手 2/4');
		expect(card()).toContain('down 2/2');
		expect(card()).toContain('下一個 1-7：high V（上層）');

		engine.audible = engine.clicks[0].when + 2.5;
		await nextFrame();
		expect(card()).toContain('上層 high V');
		expect(screen.getByRole('region', { name: '這一拍' }).getAttribute('aria-live')).toBe('polite');
	});

	it('從動作拿掉隊員、有拍點給他：先問並列出拍點；取消就留著，確定才拿掉人和拍點', async () => {
		await newFlow();
		for (const name of ['小A', '小B']) {
			await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: name } });
			await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
			await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'base' } });
			await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		}
		await tab('動作');
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm1' } });
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm2' } });
		await pickRole('小A', '上層');
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));

		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-7' }));
		await pickWho('上層');
		await fireEvent.click(within(grid.getByRole('group', { name: '手位' })).getByRole('button', { name: 'high V' }));
		const placed = () =>
			within(screen.getByRole('group', { name: '拍點' }))
				.queryAllByRole('button', { name: /^手位 / })
				.map((b) => b.getAttribute('aria-label'));
		expect(placed()).toEqual(['手位 high V 1-7・1 拍・給上層']);

		const removeA = () => screen.getByRole('button', { name: '把 小A 移出這個動作' });
		await fireEvent.click(removeA());
		const dialog = within(screen.getByRole('alertdialog'));
		expect(dialog.getByText('動作「技巧」換了人或任務角色，會拿掉 1 個拍點')).toBeTruthy();
		expect(dialog.getByText('拿掉：手位 high V 1-7・給上層')).toBeTruthy();

		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByLabelText('小A 的任務角色')).toBeTruthy();
		expect(placed()).toEqual(['手位 high V 1-7・1 拍・給上層']);

		await fireEvent.click(removeA());
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '確定' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.queryByLabelText('小A 的任務角色')).toBeNull();
		expect(placed()).toEqual([]);
	});

	it('拖色條被擋就還原，上方列說原因', async () => {
		await withAction();
		await fireEvent.pointerDown(bar()!, { clientX: 100, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 84 });
		await fireEvent.pointerUp(window, { clientX: 84 });
		expect(screen.getByRole('status').textContent).toBe('動作的開始不能在段之前，已還原');
		expect((bar() as HTMLElement).style.left).toBe('0px');
	});
});

describe('站位與走位', () => {
	/** 新流程、一個音樂段（150 BPM）、兩個隊員。 */
	async function setup() {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A\n小B' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
		await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'top' } });
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		await tab('動作');
	}

	/** 按著 Alt 點八拍尺：吸到半拍（站位要插在 3-5& 這種地方）。 */
	async function seek(sec: number) {
		const ruler = document.querySelector('[data-ruler]')!;
		await fireEvent.pointerDown(ruler, { clientX: sec * 16, button: 0, altKey: true });
		await fireEvent.pointerUp(window);
	}

	async function dragFirstMember(id = 'm1') {
		const dot = document.querySelector(`[data-member-id="${id}"]`)!;
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: -200, clientY: -300 });
		await fireEvent.pointerUp(dot, { clientX: -200, clientY: -300 });
	}

	const thumbs = () => screen.queryAllByRole('button', { name: /^站位 \d+$/ });

	it('播放頭不在站位上時拖人，自動在這一拍插一張站位並提醒；在站位上拖人就改那張', async () => {
		await setup();
		expect(thumbs()).toHaveLength(1);
		await seek(8.25);
		await dragFirstMember();
		expect(screen.getByRole('status').textContent).toMatch(/插了一張站位/);
		expect(thumbs()).toHaveLength(2);
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-5&');

		await dragFirstMember();
		expect(thumbs()).toHaveLength(2);
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('尺上點：一小段距離內先停到站位（不吸到旁邊的整拍）；停在站位上拖人改的是那張', async () => {
		await setup();
		await seek(8.25); // 3-5&（8.2 秒）
		await dragFirstMember();
		const ruler = document.querySelector('[data-ruler]')!;
		// 沒按 Alt 點在 8.3 秒：最近的整拍是 3-6（8.4 秒），但站位 2 只差 1.6 px
		await fireEvent.pointerDown(ruler, { clientX: 8.3 * 16, button: 0 });
		await fireEvent.pointerUp(window);
		expect(screen.getByText(/^拖人會/).textContent).toBe('拖人會改：站位 2（3-5&）');
		await dragFirstMember('m2');
		expect(thumbs()).toHaveLength(2);
		// 離站位遠一點就照樣吸到整拍
		await fireEvent.pointerDown(ruler, { clientX: 9.6 * 16, button: 0 });
		await fireEvent.pointerUp(window);
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 4-1');
	});

	it('拖人之後，後面還站在舊位置的站位跟著改，提示往後帶到幾張；同時插站位就合成一則', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember(); // 插站位 2；小B 在站位 1、2 都站在原地
		await seek(0);
		await dragFirstMember('m2');
		expect(screen.getByRole('status').textContent).toBe('後面 1 張站位也跟著改了');

		await seek(4);
		await dragFirstMember('m2');
		expect(screen.getByRole('status').textContent).toBe(
			'插了一張站位，大家的位置自動帶入；後面 1 張站位也跟著改了'
		);
	});

	it('場地旁邊那一行字跟著播放頭變：會改哪一張站位，還是會插一張新的', async () => {
		const line = () => screen.getByText(/^拖人會/).textContent;
		await setup();
		expect(line()).toBe('拖人會改：站位 1（開頭）');
		await seek(8.25);
		expect(line()).toBe('拖人會在 3-5& 插一張新站位');
		await dragFirstMember();
		expect(line()).toBe('拖人會改：站位 2（3-5&）');
		await seek(4);
		expect(line()).toBe('拖人會在 2-3 插一張新站位');
	});

	it('站位名稱：播放頭在站位上才能取名；縮圖跟著寫名字；可以復原；不在站位上沒有名稱欄', async () => {
		const nameBox = () => screen.queryByLabelText('站位名稱') as HTMLInputElement | null;
		await setup();
		await fireEvent.change(nameBox()!, { target: { value: '  開場 ' } });
		expect(screen.getByRole('button', { name: '站位 1 開場' }).textContent).toContain('開場');
		expect(nameBox()!.value).toBe('開場');

		await seek(8.25);
		expect(nameBox()).toBeNull();
		await dragFirstMember();
		expect(nameBox()!.value).toBe('');

		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(screen.getByRole('button', { name: '站位 1' })).toBeTruthy();
	});

	it('站位名稱改好了：別的提示照舊留著（場上的問題成功才收掉提示）', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		const notice = screen.getByRole('status').textContent;
		expect(notice).toMatch(/插了一張站位/);
		await fireEvent.change(screen.getByLabelText('站位名稱'), { target: { value: '開場' } });
		expect(screen.getByRole('button', { name: '站位 2 開場' })).toBeTruthy();
		expect(screen.getByRole('status').textContent).toBe(notice);
	});

	it('站位名稱：中文輸入法選字時按的 Enter 不離開輸入框（不然字會重複），選完再按 Enter 才離開', async () => {
		await setup();
		const box = screen.getByLabelText('站位名稱') as HTMLInputElement;
		box.focus();
		await fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
		expect(document.activeElement).toBe(box);
		await fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
		expect(document.activeElement).toBe(box);
		await fireEvent.keyDown(box, { key: 'Enter' });
		expect(document.activeElement).not.toBe(box);
	});

	it('跟上一張一樣：沒選人、在開頭那張時按不下去並說原因；在站位上改成上一張的位置；不在站位上先插一張', async () => {
		const button = () => screen.getByRole('button', { name: '跟上一張一樣' }) as HTMLButtonElement;
		const at = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!.getAttribute('transform');
		await setup();
		const start = at('m1');
		expect(button().disabled).toBe(true);
		expect(screen.getByText('先選人')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		expect(button().disabled).toBe(true);
		expect(screen.getByText('開頭那張前面沒有站位')).toBeTruthy();

		await seek(8.25);
		await fireEvent.click(screen.getByRole('button', { name: '不選人' }));
		await dragFirstMember(); // 插站位 2，小A 換位置
		expect(at('m1')).not.toBe(start);
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		expect(button().disabled).toBe(false);
		await fireEvent.click(button());
		expect(at('m1')).toBe(start);
		expect(thumbs()).toHaveLength(2);
		expect(screen.queryByRole('status')).toBeNull();

		await seek(4);
		await fireEvent.click(button());
		expect(thumbs()).toHaveLength(3);
		expect(screen.getByRole('status').textContent).toBe('插了一張站位，大家的位置自動帶入');
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 2-3');
	});

	it('影子和走位線：在站位上畫上一張的影子和線、在兩張中間只畫線、有選人只畫選到的人', async () => {
		const marked = (attr: string) =>
			[...document.querySelectorAll(`.field [${attr}]`)].map((el) => el.getAttribute(attr));
		await setup();
		expect(marked('data-ghost')).toEqual([]);
		expect(marked('data-walk-line')).toEqual([]);

		await seek(8.25);
		await dragFirstMember(); // 插站位 2，小A 換位置
		expect(marked('data-ghost')).toEqual(['m1', 'm2']);
		expect(marked('data-walk-line')).toEqual(['m1']);

		await seek(4);
		expect(marked('data-ghost')).toEqual([]);
		expect(marked('data-walk-line')).toEqual(['m1']);

		await seek(8.25);
		const dot = document.querySelector('[data-member-id="m2"]')!;
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerUp(dot, { clientX: 0, clientY: 0 });
		expect(marked('data-ghost')).toEqual(['m2']);
		expect(marked('data-walk-line')).toEqual([]);
	});

	/** 小A [0, 0]、小B [2, 0]；站位 2 在 4.8 秒兩人換位置，1.6–4.8 秒走位，3.2 秒在 [1, 0] 撞在一起；站位 3 在 8 秒。 */
	function swapping() {
		let flow = flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));
		flow = flowOf(addMembers(flow, ['小A', '小B'].map((name) => ({ name, gender: 'F', globalRole: 'base' }))));
		flow = flowOf(addSegmentTo(flow, 'music'));
		flow = flowOf(setPositions(flow, 'f1', { m1: [0, 0], m2: [2, 0] }));
		flow = flowOf(insertFormation(flow, 4.8));
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [2, 0], m2: [0, 0] }));
		return flowOf(insertFormation(flow, 8));
	}

	it('撞位只看騰翻：兩個人一般走位交錯，場上沒有 ✕、走位條沒有紫色', async () => {
		render(Page, editorPage(swapping()).props);
		await seek(3.2);
		expect(document.querySelector('[data-walk-line]')).not.toBeNull();
		expect(document.querySelectorAll('.field [data-clash]')).toHaveLength(0);
		expect(document.querySelectorAll('[data-walk-clash]')).toHaveLength(0);
	});

	it('撞位：播放頭所在那兩張站位之間的撞位，在場上畫紫色 ✕、寫是誰撞誰；走位條撞到的那段變紫；拖人照樣能拖', async () => {
		// swapping 再讓小A 1.6–4.8 秒在騰翻動作裡。
		const flow = flowOf(
			addAction(swapping(), {
				segmentId: 's1',
				category: 'tumbling',
				name: '',
				start: 8,
				length: 16,
				note: '',
				members: [{ memberId: 'm1', role: null }]
			})
		);
		const { session, props } = editorPage(flow);
		render(Page, props);
		const marks = () => [...document.querySelectorAll('.field [data-clash]')];

		// 播放頭在開頭那張：前面沒有走位，不畫。
		expect(marks()).toEqual([]);
		await seek(2);
		expect(marks().map((el) => el.getAttribute('transform'))).toEqual(['translate(1,0)']);
		expect(marks()[0].querySelector('title')?.textContent).toBe('撞位：小A、小B');
		await seek(4.8);
		expect(marks()).toHaveLength(1);
		// 站位 2 → 站位 3 之間沒人走，不畫。
		await seek(6);
		expect(marks()).toEqual([]);

		expect(document.querySelectorAll('[data-lane="m1"] [data-walk-clash]')).toHaveLength(1);
		expect(document.querySelectorAll('[data-lane="m2"] [data-walk-clash]')).toHaveLength(1);

		// 只是提醒：在站位 2 上照樣拖人。
		await seek(4.8);
		await dragFirstMember();
		expect(session.flow!.formations[1].pos.m1).not.toEqual([2, 0]);
	});

	it('點縮圖跳到那一拍；✕ 刪除站位；開頭那張沒有 ✕', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await seek(0);
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-1');
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-5&');

		expect(screen.queryByRole('button', { name: '刪除站位 1' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '刪除站位 2' }));
		expect(thumbs()).toHaveLength(1);
	});

	it('刪站位後提示「已刪掉站位 N」和「復原」；按「復原」等於按一次復原', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(screen.getByRole('button', { name: '刪除站位 2' }));
		expect(screen.getByRole('status').textContent).toBe('已刪掉站位 2');
		await fireEvent.click(screen.getByRole('button', { name: '復原刪掉的站位' }));
		expect(thumbs()).toHaveLength(2);
		expect(screen.queryByRole('status')).toBeNull();
		// 只復原一步：拖人插的站位還在，再按上方列的復原才退掉拖人
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(thumbs()).toHaveLength(1);
	});

	it('提示泡泡過幾秒自己消失；下一個操作也讓它消失', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(screen.getByRole('button', { name: '刪除站位 2' }));
		expect(screen.getByRole('status')).toBeTruthy();
		// 點別的地方（下一個操作）：收起來
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: 0, button: 0 });
		await fireEvent.pointerUp(window);
		expect(screen.queryByRole('status')).toBeNull();

		vi.useFakeTimers();
		try {
			await fireEvent.keyDown(window, { key: 'z', metaKey: true });
			expect(thumbs()).toHaveLength(2);
			await fireEvent.click(screen.getByRole('button', { name: '刪除站位 2' }));
			expect(screen.getByRole('status')).toBeTruthy();
			// 有「復原」的提示留 10 秒
			await vi.advanceTimersByTimeAsync(9000);
			expect(screen.getByRole('status')).toBeTruthy();
			await vi.advanceTimersByTimeAsync(1500);
			expect(screen.queryByRole('status')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('選到站位按 Delete 刪掉；開頭那張刪不掉', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(thumbs()).toHaveLength(1);

		await fireEvent.click(screen.getByRole('button', { name: '站位 1' }));
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(thumbs()).toHaveLength(1);
		expect(screen.getByRole('status').textContent).toBe('流程開頭一定有一張站位，不能刪');
	});

	it('選了站位、又拖人插了新的一張：舊的選取清掉，按 Delete 不會刪到看不到的那張', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		await seek(20);
		await dragFirstMember();
		expect(thumbs()).toHaveLength(3);
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(thumbs()).toHaveLength(3);
	});

	it('段設定、流程設定、八拍表開著時：後面的編輯畫面不吃快捷鍵（復原、空白鍵暫停除外，見 keyboard 測試），也點不到、Tab 不到（inert）', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		const editor = document.querySelector('.editor') as HTMLElement;
		expect(editor.inert).toBe(false);

		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		expect(screen.getByRole('dialog', { name: '音樂 1 設定' })).toBeTruthy();
		expect(editor.inert).toBe(true);
		await fireEvent.keyDown(window, { key: 'Delete' });
		await fireEvent.keyDown(window, { key: 'Backspace' });
		await fireEvent.keyDown(window, { key: ' ' });
		expect(thumbs()).toHaveLength(2);
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(editor.inert).toBe(false);

		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		expect(editor.inert).toBe(true);
		await fireEvent.keyDown(window, { key: ' ' });
		expect(thumbs()).toHaveLength(2);
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));

		await fireEvent.click(screen.getByRole('button', { name: '八拍表' }));
		expect(editor.inert).toBe(true);
		await fireEvent.click(within(screen.getByRole('dialog', { name: '八拍表' })).getByRole('button', { name: '關閉' }));
		expect(editor.inert).toBe(false);
	});

	/** 第 n 張站位縮圖的左邊在時間軸上幾 px（1 秒 16 px）。 */
	const thumbLeft = (n: number) =>
		parseFloat((screen.getByRole('button', { name: `站位 ${n}` }).parentElement as HTMLElement).style.left);

	async function dragThumb(n: number, dx: number) {
		const thumb = screen.getByRole('button', { name: `站位 ${n}` });
		await fireEvent.pointerDown(thumb, { clientX: 300, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 300 + dx });
		await fireEvent.pointerUp(window, { clientX: 300 + dx });
	}

	it('拖縮圖挪站位：吸到最近一格，播放頭跟過去；算一步復原；手抖一下不算拖', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember(); // 站位 2 在 3-5&（8.2 秒）
		await seek(0);
		await dragThumb(2, -3);
		expect(thumbLeft(2)).toBeCloseTo(131.2);
		// 往左 52 px（3.25 秒），吸到 5 秒的 2-5&
		await dragThumb(2, -52);
		expect(thumbLeft(2)).toBeCloseTo(80);
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 2-5&');
		expect(screen.getByText(/^拖人會/).textContent).toBe('拖人會改：站位 2（2-5&）');
		expect(screen.queryByRole('status')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(thumbLeft(2)).toBeCloseTo(131.2);
	});

	it('手指：沒選中的縮圖拖不動（留給時間軸捲動），點一下選中了才拖得動', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await seek(0);
		const thumb = screen.getByRole('button', { name: '站位 2' });
		const touch = { button: 0, pointerType: 'touch', pointerId: 5 };
		const drag = async () => {
			await fireEvent.pointerDown(thumb, { ...touch, clientX: 300 });
			await fireEvent.pointerMove(window, { ...touch, clientX: 248 });
			await fireEvent.pointerUp(window, { ...touch, clientX: 248 });
		};
		await drag();
		expect(thumbLeft(2)).toBeCloseTo(131.2);
		await fireEvent.click(thumb);
		await drag();
		expect(thumbLeft(2)).toBeCloseTo(80);
	});

	it('拖縮圖被擋就彈回去，上方說原因；開頭那張拖不動', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await dragThumb(2, -200);
		expect(thumbLeft(2)).toBeCloseTo(131.2);
		expect(screen.getByRole('status').textContent).toBe(
			'站位 2 要挪到站位 1（1-1）之後、流程結尾之前，已還原'
		);
		await dragThumb(1, 50);
		expect(thumbLeft(1)).toBe(0);
	});

	it('拖縮圖被系統打斷（pointercancel）就彈回去，之後別處放開也不會挪', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await seek(0);
		const thumb = screen.getByRole('button', { name: '站位 2' });
		await fireEvent.pointerDown(thumb, { clientX: 300, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 248 });
		expect(thumbLeft(2)).toBeCloseTo(80);
		await fireEvent.pointerCancel(window);
		expect(thumbLeft(2)).toBeCloseTo(131.2);
		await fireEvent.pointerUp(window, { clientX: 248 });
		expect(thumbLeft(2)).toBeCloseTo(131.2);
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-1');
	});

	it('站位時間框：打拍子挪站位，下面寫能挪的範圍；看不懂、被擋或按 Esc 就變回原本的', async () => {
		const box = () => screen.queryByLabelText<HTMLInputElement>('站位時間');
		await setup();
		expect(box()!.disabled).toBe(true);
		expect(screen.getByText('開頭那張不能挪')).toBeTruthy();
		await seek(4);
		expect(box()).toBeNull();

		await seek(8.25);
		await dragFirstMember(); // 站位 2 在 3-5&
		expect(box()!.value).toBe('3-5&');
		expect(screen.getByText('可以挪到 1-1 之後')).toBeTruthy();

		await fireEvent.change(box()!, { target: { value: '2-5' } });
		expect(box()!.value).toBe('2-5');
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 2-5');
		expect(thumbLeft(2)).toBeCloseTo(76.8);

		await fireEvent.change(box()!, { target: { value: 'abc' } });
		expect(screen.getByRole('status').textContent).toBe(
			'站位時間看不懂，例：2-5（別的段前面加段名，例：口號 1 12.3）'
		);
		expect(box()!.value).toBe('2-5');

		await fireEvent.change(box()!, { target: { value: '1-1' } });
		expect(screen.getByRole('status').textContent).toBe(
			'站位 2 要挪到站位 1（1-1）之後、流程結尾之前，已還原'
		);
		expect(box()!.value).toBe('2-5');

		await fireEvent.input(box()!, { target: { value: '9-9' } });
		await fireEvent.keyDown(box()!, { key: 'Escape' });
		expect(box()!.value).toBe('2-5');

		// 小A 本來最後一個八拍才走（3.2 秒），挪到 1-2（0.4 秒）只剩 0.4 秒
		await fireEvent.change(box()!, { target: { value: '1-2' } });
		expect(screen.getByRole('status').textContent).toBe('走位被壓短：小A');
	});

	const depart = () => screen.queryByLabelText<HTMLInputElement>('出發');
	const arrive = () => screen.getByLabelText<HTMLInputElement>('到達');
	const dotAt = (id = 'm1') => document.querySelector(`[data-member-id="${id}"]`)!.getAttribute('transform');

	async function setWalk(d: string, a: string) {
		await fireEvent.input(depart()!, { target: { value: d } });
		await fireEvent.input(arrive(), { target: { value: a } });
		await fireEvent.click(screen.getByRole('button', { name: '套用' }));
	}

	it('出發和到達的表單：只在播放頭停在站位上、不是開頭那張時出現，顯示現在的走法', async () => {
		await setup();
		expect(depart()).toBeNull();
		await seek(8.25);
		expect(depart()).toBeNull();
		await dragFirstMember();
		// 預設：最後一個八拍才走
		expect(depart()!.value).toBe('2-5&');
		expect(arrive().value).toBe('3-5&');
		await seek(0);
		expect(depart()).toBeNull();
	});

	it('沒選人時套用到全隊；按「用預設」清掉，回到最後一個八拍才走', async () => {
		await setup();
		const start = dotAt();
		await seek(8.25);
		await dragFirstMember();
		const end = dotAt();
		await setWalk('1-1', '2-1');
		await seek(3.25);
		expect(dotAt()).toBe(end);

		await seek(8.25);
		expect(depart()!.value).toBe('1-1');
		expect(arrive().value).toBe('2-1');
		await fireEvent.click(screen.getByRole('button', { name: '用預設' }));
		expect(depart()!.value).toBe('2-5&');
		await seek(3.25);
		expect(dotAt()).toBe(start);

		// 一次套用算復原的一步
		await seek(8.25);
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(depart()!.value).toBe('1-1');
	});

	it('沒選人時只寫進有走位的人：站著不動的人不寫', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember(); // 只有小A 走位
		expect(screen.getByText('（全隊有走位的 1 人）')).toBeTruthy();
		await setWalk('1-1', '2-1');
		await fireEvent.click(document.querySelector('[data-lane="m2"] .lab')!);
		// 小B 沒被寫進去，還是預設
		expect(depart()!.value).toBe('2-5&');
	});

	it('在出發或到達按 Enter 就套用；不合法時顯示錯誤；選字中的 Enter 不算', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.input(depart()!, { target: { value: '1-1' } });
		await fireEvent.input(arrive(), { target: { value: '2-1' } });
		await fireEvent.keyDown(arrive(), { key: 'Enter', isComposing: true });
		await seek(0);
		await seek(8.25);
		expect(depart()!.value).toBe('2-5&');
		await fireEvent.input(depart()!, { target: { value: '1-1' } });
		await fireEvent.input(arrive(), { target: { value: '2-1' } });
		await fireEvent.keyDown(arrive(), { key: 'Enter' });
		await seek(0);
		await seek(8.25);
		expect(depart()!.value).toBe('1-1');

		await fireEvent.input(depart()!, { target: { value: '3-1' } });
		await fireEvent.keyDown(depart()!, { key: 'Enter' });
		expect(screen.getByRole('alert').textContent).toBe('出發要早於到達');
	});

	it('有選人時只改選到的人；選到的人走法不一樣時欄位空白', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(document.querySelector('[data-lane="m1"] .lab')!);
		await setWalk('1-1', '2-1');
		expect(depart()!.value).toBe('1-1');
		await fireEvent.click(document.querySelector('[data-lane="m2"] .lab')!, { shiftKey: true });
		expect(depart()!.value).toBe('');
		expect(depart()!.placeholder).toBe('每人不一樣');
		expect(arrive().value).toBe('');
	});

	it('打的時間不合理或看不懂：擋下來說原因，流程不改', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		const alert = () => screen.getByRole('alert').textContent;
		await setWalk('3-1', '2-1');
		expect(alert()).toBe('出發要早於到達');
		await setWalk('1-1', '4-1');
		expect(alert()).toBe('出發和到達要在前一張和這一張站位之間');
		await setWalk('abc', '2-1');
		expect(alert()).toMatch(/^出發看不懂/);
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		// 復原的是拖人，表單跟著消失：被擋的那幾次沒有改流程
		expect(depart()).toBeNull();
	});

	async function setEights(eights: string, confirm: boolean) {
		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		await fireEvent.change(screen.getByLabelText('八拍數'), { target: { value: eights } });
		if (confirm) await fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
	}

	it('段縮短連帶刪掉選到的站位：選取跟著清掉，之後再插的站位（id 重用）不會是選到的', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		await setEights('1', true);
		expect(thumbs()).toHaveLength(1);
		await setEights('8', false);
		await seek(8.25);
		await dragFirstMember();
		expect(screen.getByRole('button', { name: '站位 2' }).getAttribute('aria-pressed')).toBe('false');
	});
});

describe('八拍表', () => {
	it('上方列「八拍表」打開列印畫面；關閉回到編輯，流程和播放頭照舊', async () => {
		await newFlow();
		await addSegment('＋音樂段');
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: 8.25 * 16, button: 0, altKey: true });
		await fireEvent.pointerUp(window);
		await fireEvent.click(screen.getByRole('button', { name: '八拍表' }));
		const sheet = screen.getByRole('dialog', { name: '八拍表' });
		expect(within(sheet).getByRole('heading').textContent).toContain('全國賽');
		// 標題一列；第 1 個八拍有開頭那張站位，第 2 到第 8 個八拍空的合成一列
		expect(within(sheet).getAllByRole('row')).toHaveLength(3);
		await fireEvent.click(within(sheet).getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog', { name: '八拍表' })).toBeNull();
		expect(position()).toBe('音樂 1 3-5&');
	});
});

describe('編輯器首頁', () => {
	it('新建流程後，上方畫出那個場地，沒有換場地的入口', async () => {
		// 沒給編輯器 module：頁面用真的 adapter 自己建（jsdom 沒有 IndexedDB、Web Audio，用不到就不會壞）
		render(Page);
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '臺灣盃' } });
		await fireEvent.click(screen.getByRole('radio', { name: /5 條橫放/ }));
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));

		expect(screen.getByText('臺灣盃')).toBeTruthy();
		expect(document.querySelectorAll('[data-strip-number]')).toHaveLength(5);
		expect(screen.queryByRole('radio')).toBeNull();
		expect(screen.queryByText(/場地/, { selector: 'button' })).toBeNull();
	});

	it('加的隊員出現在名單上，也在場上（開頭站位）', async () => {
		render(Page);
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));

		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A\n小B' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
		await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'top' } });
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));

		expect((screen.getByLabelText('第 2 位隊員的名字') as HTMLInputElement).value).toBe('小B');
		expect(document.querySelectorAll('[data-member-id]')).toHaveLength(2);
	});

	it('空場的提示照實說新隊員排在哪；場地中間的 ＋ 有說明', async () => {
		await newFlow();
		expect(document.querySelector('.field-empty')!.textContent).toContain('排進場地中間的空格點');
		expect(document.querySelector('.center title')?.textContent).toBe('場地正中心');
	});

	it('從試算表貼三欄加隊員：直接排進場地中間的格點，認不得的行列出原因', async () => {
		await newFlow();
		await fireEvent.input(screen.getByLabelText(/^名字/), {
			target: { value: '王小明\t男\t底層\n李美\t女\t上層\n阿強\t男\t中層' }
		});
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		expect(screen.getByRole('alert').textContent).toBe('第 3 行「阿強」：全局角色要寫「底層」或「上層」');
		// 9 條直放：中間四個格點離中心各差半格（0.9144 m），先排正面左邊、再正面右邊。
		const at = (id: string) =>
			document.querySelector(`[data-member-id="${id}"]`)!.getAttribute('transform')!.match(/-?[\d.]+/g)!.map(Number);
		expect(at('m1')).toEqual([expect.closeTo(-0.9144, 4), expect.closeTo(0.9144, 4)]);
		expect(at('m2')).toEqual([expect.closeTo(0.9144, 4), expect.closeTo(0.9144, 4)]);
		expect(document.querySelectorAll('[data-member-id]')).toHaveLength(2);
	});

	it('刪掉選到的人：選取跟著清掉，之後加的新人（id 重用）不會被選到', async () => {
		await newFlow();
		const addOne = async (name: string) => {
			await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: name } });
			await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
			await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'top' } });
			await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		};
		await addOne('小A');
		await tab('動作');
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		expect(screen.getByText('已選 1 人：小A')).toBeTruthy();
		await tab('隊員');
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 1 位隊員' }));
		await fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
		await addOne('小B');
		expect(screen.getByText('已選 0 人')).toBeTruthy();
		expect(document.querySelector('[data-member-id].selected')).toBeNull();
	});
});

async function addSegment(kind: '＋音樂段' | '＋口號段') {
	await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
	await fireEvent.click(screen.getByRole('button', { name: kind }));
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
}

/** 等畫面跑一格（播放頭在 requestAnimationFrame 裡更新）。 */
async function nextFrame() {
	await new Promise((r) => requestAnimationFrame(() => r(null)));
	await tick();
}

const position = () => screen.getByLabelText('目前位置').textContent;

// 播放的規則在 src/lib/playback.test.ts（Node）；這裡只看頁面接到播放。
describe('播放', () => {
	beforeEach(() => localStorage.clear());

	/** 音樂 1（150 BPM、8 個八拍 = 25.6 秒）→ 口號 1（10 秒）→ 音樂 2 */
	async function sample() {
		const engine = createFakeEngine();
		await newFlow(engine);
		await addSegment('＋音樂段');
		await addSegment('＋口號段');
		await addSegment('＋音樂段');
		return engine;
	}

	it('播放鍵：按了播，上方列的位置跟著喇叭的時間走；再按一次暫停', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.resumed).toBe(true);
		engine.audible = engine.clicks[0].when + 8.2;
		await nextFrame();
		expect(position()).toBe('音樂 1 3-5&');
		await fireEvent.click(screen.getByRole('button', { name: '暫停' }));
		expect(engine.clicks).toEqual([]);
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
	});

	it('節拍器勾選框：關掉就不響', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByLabelText('節拍器'));
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.clicks).toEqual([]);
	});

	it('延遲校正欄位：存在這台電腦；清空或超出範圍時欄位回到現在的值；存的值超出範圍當 0', async () => {
		await sample();
		const field = screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement;
		expect(field.value).toBe('0');
		await fireEvent.change(field, { target: { value: '200' } });
		await fireEvent.change(field, { target: { value: '' } });
		expect(field.value).toBe('200');
		await fireEvent.change(field, { target: { value: '1001' } });
		expect(field.value).toBe('200');

		cleanup();
		await newFlow();
		expect((screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement).value).toBe('200');

		cleanup();
		localStorage.setItem('cheer-editor:latencyMs', '99999');
		await newFlow();
		expect((screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement).value).toBe('0');
	});

	it('段設定的試聽：按「▶ 從第一拍聽」響、按「■ 停止試聽」停、播完換回來；關掉段設定就停', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByRole('button', { name: /音樂 1/ }));
		await fireEvent.click(screen.getByRole('button', { name: '▶ 從第一拍聽 2 個八拍' }));
		expect(engine.clicks).toHaveLength(16);
		await fireEvent.click(screen.getByRole('button', { name: '■ 停止試聽' }));
		expect(engine.clicks).toEqual([]);
		await fireEvent.click(screen.getByRole('button', { name: '▶ 從第一拍聽 2 個八拍' }));
		// 2 個八拍、150 BPM = 6.4 秒
		engine.audible = engine.clicks[0].when + 6.5;
		await nextFrame();
		expect(screen.getByRole('button', { name: '▶ 從第一拍聽 2 個八拍' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: '▶ 從第一拍聽 2 個八拍' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(engine.clicks).toEqual([]);
	});
});

describe('復原和重做', () => {
	const undoButton = () => screen.getByRole('button', { name: '復原' }) as HTMLButtonElement;
	const redoButton = () => screen.getByRole('button', { name: '重做' }) as HTMLButtonElement;
	const thumbs = () => screen.queryAllByRole('button', { name: /^站位 \d+$/ });
	const dotAt = () => document.querySelector('[data-member-id="m1"]')!.getAttribute('transform');

	/** 新流程、一個音樂段、兩個隊員：三步。 */
	async function setup() {
		await newFlow();
		await addSegment('＋音樂段');
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A\n小B' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
		await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'top' } });
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		await tab('動作');
	}

	async function seek(sec: number) {
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: sec * 16, button: 0 });
		await fireEvent.pointerUp(window);
	}

	async function dragFirstMember() {
		const dot = document.querySelector('[data-member-id="m1"]')!;
		await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot, { clientX: -200, clientY: -300 });
		await fireEvent.pointerUp(dot, { clientX: -200, clientY: -300 });
	}

	it('新流程沒東西可以復原或重做：兩個按鈕按不下去', async () => {
		await newFlow();
		expect(undoButton().disabled).toBe(true);
		expect(redoButton().disabled).toBe(true);
	});

	it('拖人（自動插站位）算一步：按「復原」整個回去，按「重做」再回來', async () => {
		await setup();
		await seek(8.25);
		const before = dotAt();
		await dragFirstMember();
		expect(thumbs()).toHaveLength(2);
		const after = dotAt();
		expect(after).not.toBe(before);

		await fireEvent.click(undoButton());
		expect(thumbs()).toHaveLength(1);
		expect(dotAt()).toBe(before);
		expect(redoButton().disabled).toBe(false);

		await fireEvent.click(redoButton());
		expect(thumbs()).toHaveLength(2);
		expect(dotAt()).toBe(after);
		expect(redoButton().disabled).toBe(true);
	});

	it('跟上一張一樣（自動插站位）算一步：按一次「復原」整個回去', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember(); // 插站位 2
		await seek(7); // 小A 正走向站位 2（最後一個八拍才走）
		const before = dotAt();
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		await fireEvent.click(screen.getByRole('button', { name: '跟上一張一樣' }));
		expect(thumbs()).toHaveLength(3);
		expect(dotAt()).not.toBe(before);

		await fireEvent.click(undoButton());
		expect(thumbs()).toHaveLength(2);
		expect(dotAt()).toBe(before);
	});

	it('一路復原到流程剛建立的樣子：隊員、段都回去；再重做回來', async () => {
		await setup();
		await fireEvent.click(undoButton());
		expect(document.querySelectorAll('[data-member-id]')).toHaveLength(0);
		await fireEvent.click(undoButton());
		expect(screen.queryByRole('button', { name: /^音樂 1/ })).toBeNull();
		expect(undoButton().disabled).toBe(true);
		await fireEvent.click(redoButton());
		await fireEvent.click(redoButton());
		expect(document.querySelectorAll('[data-member-id]')).toHaveLength(2);
	});

	it('⌘/Ctrl+Z 復原；⌘/Ctrl+Shift+Z 和 Ctrl+Y 重做', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
		expect(thumbs()).toHaveLength(1);
		await fireEvent.keyDown(window, { key: 'Z', metaKey: true, shiftKey: true });
		expect(thumbs()).toHaveLength(2);
		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(thumbs()).toHaveLength(1);
		await fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
		expect(thumbs()).toHaveLength(2);
	});

	it('焦點在文字框或下拉選單裡也是退回流程，不讓瀏覽器自己復原（打了沒送出的字見 keyboard 測試）', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		const z = { key: 'z', ctrlKey: true };
		// fireEvent 回傳 false 表示被 preventDefault（瀏覽器自己的復原不會跑）
		expect(await fireEvent.keyDown(screen.getByLabelText('加人'), z)).toBe(false);
		expect(thumbs()).toHaveLength(1);
		expect(await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'y', ctrlKey: true })).toBe(false);
		expect(thumbs()).toHaveLength(2);
	});

	it('做了新的一步，重做的紀錄就清掉', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(undoButton());
		expect(redoButton().disabled).toBe(false);
		await dragFirstMember();
		expect(redoButton().disabled).toBe(true);
	});

	// 最多記 100 步在 session 測（src/lib/editor-session.test.ts）；這裡只看按鈕接到 session 的復原、重做。
	it('復原、重做按鈕接到 session：session 裡有幾步就能按幾次', async () => {
		const { session, props } = editorPage(sessionFlow());
		session.change(flowOf(renameFlow(session.flow!, 'A')));
		session.change(flowOf(renameFlow(session.flow!, 'B')));
		render(Page, props);
		await fireEvent.click(undoButton());
		await fireEvent.click(undoButton());
		expect(undoButton().disabled).toBe(true);
		expect(session.flow!.name).toBe('全國賽');
		await fireEvent.click(redoButton());
		expect(session.flow!.name).toBe('A');
		expect(document.querySelector('.topbar b')?.textContent).toBe('A');
	});

	it('復原後，選到的人、站位、動作已經不存在就清掉', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		await pickRole('小A', '上層');
		await pickRole('小B', '上層');
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		const bar = () => document.querySelector('[data-lane="m1"] [data-action-id]');
		expect(bar()?.classList.contains('selected')).toBe(true);
		await fireEvent.click(undoButton());
		expect(bar()).toBeNull();
		await fireEvent.click(redoButton());
		// 動作回來了，但沒有選著（id 會重用，不一定是同一個）
		expect(bar()?.classList.contains('selected')).toBe(false);

		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		await fireEvent.click(undoButton());
		await fireEvent.click(redoButton());
		expect(screen.getByRole('button', { name: '站位 2' }).getAttribute('aria-pressed')).toBe('false');

		// 復原到還沒有隊員：選到的人也清掉
		for (let i = 0; i < 3; i++) await fireEvent.click(undoButton());
		expect(document.querySelectorAll('[data-member-id]')).toHaveLength(0);
		await fireEvent.click(redoButton());
		expect(screen.getByText('已選 0 人')).toBeTruthy();
	});

	it('新建別的流程時清空復原紀錄', async () => {
		await setup();
		expect(undoButton().disabled).toBe(false);
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '第二支' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(undoButton().disabled).toBe(true);
		expect(redoButton().disabled).toBe(true);
	});
});

describe('放一個帶好流程的 session 進頁面', () => {
	it('頁面畫 session 的流程；操作後讀 session 的流程', async () => {
		const { session, props } = editorPage(sessionFlow());
		render(Page, props);
		expect(document.querySelector('.topbar b')?.textContent).toBe('全國賽');
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: '臺灣盃' } });
		expect(session.flow!.name).toBe('臺灣盃');
		expect(session.unsaved).toBe(true);
	});

	it('在「隊員」頁點色條（再點選著的那條也一樣）：右邊欄翻到「動作」', async () => {
		const { session, props } = editorPage(libSample());
		render(Page, props);
		const actionTab = () => screen.getByRole('tab', { name: /^動作/ });
		const bar = () => document.querySelector<HTMLElement>('[data-lane="m1"] [data-action-id="x1"]')!;
		await tab('隊員');
		await fireEvent.click(bar());
		expect(session.selectedActionId).toBe('x1');
		expect(actionTab().getAttribute('aria-selected')).toBe('true');
		await tab('隊員');
		await fireEvent.click(bar());
		expect(actionTab().getAttribute('aria-selected')).toBe('true');
	});
});

describe('隊員名單：排順序、開頭字標記、刪隊員確認', () => {
	/** libSample（小美、小A、小B、小芳）放進頁面，翻到「隊員」頁。 */
	async function sample(flow = libSample()) {
		const { session, props } = editorPage(flow);
		render(Page, props);
		await tab('隊員');
		return session;
	}
	const lanes = () => [...document.querySelectorAll('[data-lane]')].map((el) => el.getAttribute('data-lane'));
	const dotText = (id: string) => document.querySelector(`[data-member-id="${id}"] text`)!.textContent;

	it('按「往上」：名單、泳道順序和場上的號碼跟著變；按復原回去', async () => {
		await sample();
		expect(lanes()).toEqual(['m1', 'm2', 'm3', 'm4']);
		await fireEvent.click(screen.getByRole('button', { name: '第 3 位隊員往上' }));
		expect((screen.getByLabelText('第 2 位隊員的名字') as HTMLInputElement).value).toBe('小B');
		expect(lanes()).toEqual(['m1', 'm3', 'm2', 'm4']);
		expect(dotText('m3')).toBe('2');
		expect(dotText('m2')).toBe('3');
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(lanes()).toEqual(['m1', 'm2', 'm3', 'm4']);
		expect(dotText('m3')).toBe('3');
	});

	it('按「往下」和拖曳一樣能排', async () => {
		const session = await sample();
		await fireEvent.click(screen.getByRole('button', { name: '第 1 位隊員往下' }));
		expect(lanes()).toEqual(['m2', 'm1', 'm3', 'm4']);
		const rows = document.querySelectorAll('.members li');
		await fireEvent.dragStart(rows[3].querySelector('[draggable="true"]')!);
		await fireEvent.dragOver(rows[0]);
		await fireEvent.drop(rows[0]);
		expect(lanes()).toEqual(['m4', 'm2', 'm1', 'm3']);
		expect(session.flow!.members.map((m) => m.name)).toEqual(['小芳', '小A', '小美', '小B']);
	});

	it('開頭字標記：新人1 到新人10 每個人都不同，新人10 寫「新10」', async () => {
		const names = Array.from({ length: 10 }, (_, i) => ({ name: `新人${i + 1}`, gender: 'F' as const, globalRole: 'top' as const }));
		await sample(flowOf(setMarkers(flowOf(addMembers(sessionFlow(), names)), 'initial')));
		const texts = Array.from({ length: 10 }, (_, i) => dotText(`m${i + 1}`));
		expect(texts[9]).toBe('新10');
		expect(new Set(texts).size).toBe(10);
	});

	it('刪隊員的確認出現在那一列下面，寫名字、標記、全局角色；不在動作裡不寫「0 個動作裡」', async () => {
		await sample(flowOf(addMembers(libSample(), [{ name: '阿強', gender: 'M', globalRole: 'base' }])));
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 5 位隊員' }));
		const box = screen.getByRole('alertdialog');
		expect(box.closest('li')).toBe(document.querySelectorAll('.members li')[4]);
		expect(box.textContent).toContain('刪掉隊員「阿強」（標記 5、底層）：他不在任何動作裡');
		expect(box.textContent).not.toContain('0 個');
		await fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
		expect(lanes()).toEqual(['m1', 'm2', 'm3', 'm4']);
	});
});

describe('場地和時間軸的分界', () => {
	beforeEach(() => localStorage.clear());

	const bar = () => screen.getByRole('separator', { name: '場地和時間軸的分界' });
	const height = () => Number(bar().getAttribute('aria-valuenow'));
	const editorVar = () => (document.querySelector('.editor') as HTMLElement).style.getPropertyValue('--timeline-h');

	it('↑ 時間軸變高、↓ 變矮；存在瀏覽器，下次打開一樣；雙擊回到預設', async () => {
		await newFlow();
		expect(editorVar()).toBe('');
		const before = height();
		await fireEvent.keyDown(bar(), { key: 'ArrowUp' });
		expect(height()).toBe(before + 24);
		expect(editorVar()).toContain(`${before + 24}px`);
		await fireEvent.keyDown(bar(), { key: 'ArrowDown' });
		await fireEvent.keyDown(bar(), { key: 'ArrowDown' });
		expect(height()).toBe(before - 24);

		cleanup();
		await newFlow();
		expect(height()).toBe(before - 24);

		await fireEvent.dblClick(bar());
		expect(editorVar()).toBe('');
		cleanup();
		await newFlow();
		expect(editorVar()).toBe('');
	});

	it('拖分界：往上拖時間軸變高', async () => {
		await newFlow();
		const before = height();
		await fireEvent.pointerDown(bar(), { clientY: 500, button: 0 });
		await fireEvent.pointerMove(bar(), { clientY: 440 });
		await fireEvent.pointerUp(bar(), { clientY: 440 });
		expect(height()).toBe(before + 60);
	});
});

describe('場地和右邊欄的分界', () => {
	const realWidth = window.innerWidth;
	beforeEach(() => {
		localStorage.clear();
		Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
	});
	afterEach(() => Object.defineProperty(window, 'innerWidth', { value: realWidth, configurable: true }));

	const bar = () => screen.getByRole('separator', { name: '場地和右邊欄的分界' });
	const width = () => Number(bar().getAttribute('aria-valuenow'));
	const editorVar = () => (document.querySelector('.editor') as HTMLElement).style.getPropertyValue('--inspector-w');

	it('沒拖過時照螢幕自動分；← 變寬、→ 變窄；存在瀏覽器，下次打開一樣；雙擊回到自動', async () => {
		await newFlow();
		const auto = width();
		expect(auto).toBeGreaterThan(360);
		expect(editorVar()).toBe(`${auto}px`);
		await fireEvent.keyDown(bar(), { key: 'ArrowLeft' });
		expect(width()).toBe(auto + 24);
		expect(editorVar()).toBe(`${auto + 24}px`);
		await fireEvent.keyDown(bar(), { key: 'ArrowRight' });
		await fireEvent.keyDown(bar(), { key: 'ArrowRight' });
		expect(width()).toBe(auto - 24);

		cleanup();
		await newFlow();
		expect(width()).toBe(auto - 24);

		await fireEvent.dblClick(bar());
		expect(width()).toBe(auto);
		cleanup();
		await newFlow();
		expect(width()).toBe(auto);
	});

	it('「版面回原狀」兩條分界都回到預設；沒改過就不出現', async () => {
		await newFlow();
		const reset = () => screen.queryByRole('button', { name: '版面回原狀' });
		expect(reset()).toBeNull();
		const auto = width();
		await fireEvent.keyDown(bar(), { key: 'ArrowLeft' });
		const rows = screen.getByRole('separator', { name: '場地和時間軸的分界' });
		await fireEvent.keyDown(rows, { key: 'ArrowUp' });
		await fireEvent.click(reset()!);
		expect(width()).toBe(auto);
		expect((document.querySelector('.editor') as HTMLElement).style.getPropertyValue('--timeline-h')).toBe('');
		expect(reset()).toBeNull();
	});

	it('拖分界：往左拖右邊欄變寬，但場地那一欄至少留 560 px', async () => {
		await newFlow();
		const before = width();
		await fireEvent.pointerDown(bar(), { clientX: 900, button: 0 });
		await fireEvent.pointerMove(bar(), { clientX: 860 });
		expect(width()).toBe(before + 40);
		await fireEvent.pointerMove(bar(), { clientX: 0 });
		await fireEvent.pointerUp(bar(), { clientX: 0 });
		expect(width()).toBe(1600 - 560);
	});
});

describe('小選單和小窗：按 Esc 或點外面就收起來', () => {
	/** 打開範例流程、選好動作 x1。 */
	async function withSample() {
		const { session, props } = editorPage(libSample());
		render(Page, props);
		session.selectAction('x1');
		await tick();
		return session;
	}

	it('加段的「＋」選單', async () => {
		const session = await withSample();
		const add = screen.getByRole('button', { name: '在最後加一段' });
		await fireEvent.click(add);
		expect(screen.getByRole('button', { name: '＋音樂段' })).toBeTruthy();
		// 在輸入框裡用中文輸入法選字時的 Esc 不算
		await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'Escape', isComposing: true });
		await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'Escape', keyCode: 229 });
		expect(screen.getByRole('button', { name: '＋音樂段' })).toBeTruthy();
		await fireEvent.keyDown(add, { key: 'Escape' });
		expect(screen.queryByRole('button', { name: '＋音樂段' })).toBeNull();
		expect(add.getAttribute('aria-expanded')).toBe('false');
		// Esc 只收選單，動作還選著
		expect(session.selectedActionId).toBe('x1');

		await fireEvent.click(add);
		await fireEvent.pointerDown(document.querySelector('.topbar')!);
		expect(screen.queryByRole('button', { name: '＋音樂段' })).toBeNull();

		// 點選單裡面不算外面
		await fireEvent.click(add);
		await fireEvent.pointerDown(screen.getByRole('button', { name: '＋口號段' }));
		expect(screen.getByRole('button', { name: '＋口號段' })).toBeTruthy();
	});

	it('動作設定的「!」說明小窗', async () => {
		const session = await withSample();
		const bang = screen.getByRole('button', { name: '顏色和快捷鍵說明' });
		const tip = document.getElementById(bang.getAttribute('aria-describedby')!)!;
		expect(tip.hidden).toBe(true);
		await fireEvent.click(bang);
		expect(tip.hidden).toBe(false);
		await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'Escape', isComposing: true });
		await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'Escape', keyCode: 229 });
		expect(tip.hidden).toBe(false);
		await fireEvent.keyDown(bang, { key: 'Escape' });
		expect(tip.hidden).toBe(true);
		expect(bang.getAttribute('aria-expanded')).toBe('false');
		expect(session.selectedActionId).toBe('x1');

		await fireEvent.click(bang);
		await fireEvent.pointerDown(tip);
		expect(tip.hidden).toBe(false);
		await fireEvent.pointerDown(document.querySelector('.topbar')!);
		expect(tip.hidden).toBe(true);
	});

	it('拍點小窗', async () => {
		const session = await withSample();
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-1' }));
		expect(screen.getByRole('dialog', { name: '拍點小窗' })).toBeTruthy();
		await fireEvent.keyDown(grid.getByRole('button', { name: '1-1' }), { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: '拍點小窗' })).toBeNull();
		expect(session.selectedActionId).toBe('x1');

		await fireEvent.click(grid.getByRole('button', { name: '1-1' }));
		await fireEvent.pointerDown(screen.getByRole('dialog', { name: '拍點小窗' }));
		expect(screen.getByRole('dialog', { name: '拍點小窗' })).toBeTruthy();
		await fireEvent.pointerDown(document.querySelector('.topbar')!);
		expect(screen.queryByRole('dialog', { name: '拍點小窗' })).toBeNull();
	});
});

describe('動作設定：任務角色先照全局角色填、角色說明、Esc、新增鈕、改長度的確認框', () => {
	async function withSample() {
		const { session, props } = editorPage(libSample());
		render(Page, props);
		await tick();
		return session;
	}
	const role = (who: string) => screen.getByRole('combobox', { name: `${who} 的任務角色` }).textContent;

	it('沒選人時「新增動作」是灰的、寫原因；按「全隊」後任務角色照全局角色填好，選單每項有說明', async () => {
		await withSample();
		const add = screen.getByRole('button', { name: '新增動作' }) as HTMLButtonElement;
		expect(add.disabled).toBe(true);
		expect(screen.getByText('還沒有人：先選人才能新增')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		expect(add.disabled).toBe(false);
		expect(screen.queryByText('還沒有人：先選人才能新增')).toBeNull();
		// 技巧：小美、小芳全局上層，小A、小B 全局底層
		expect(['小美', '小A', '小B', '小芳'].map(role)).toEqual(['上層', '底層', '底層', '上層']);

		await fireEvent.click(screen.getByRole('combobox', { name: '小美 的任務角色' }));
		const option = within(screen.getByRole('listbox')).getByRole('option', { name: /^側底/ });
		expect(option.textContent).toContain('多底層技巧裡，在主底旁邊一起撐的底層。');
	});

	it('新動作表單：任務角色選單開著時連按兩次 Esc，只收起選單，選好的人和任務角色都還在', async () => {
		const session = await withSample();
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		await pickRole('小A', '主底');
		const picker = screen.getByRole('combobox', { name: '小A 的任務角色' });
		await fireEvent.click(picker);
		expect(screen.getByRole('listbox')).toBeTruthy();
		await fireEvent.keyDown(picker, { key: 'Escape' });
		expect(screen.queryByRole('listbox')).toBeNull();
		await fireEvent.keyDown(picker, { key: 'Escape' });
		expect(session.selectedMemberIds).toEqual(['m1', 'm2', 'm3', 'm4']);
		expect(['小美', '小A'].map(role)).toEqual(['上層', '主底']);

		// 表單裡其他地方（例：名稱框）按 Esc 也不清
		await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'Escape' });
		expect(session.selectedMemberIds).toHaveLength(4);
		// 表單外面按 Esc 照舊取消選人
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(session.selectedMemberIds).toEqual([]);
	});

	it('改動作長度要確認時，確認框出現在長度欄位旁邊', async () => {
		const session = await withSample();
		session.selectAction('x1');
		await tick();
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		await fireEvent.input(length, { target: { value: '2' } });
		await fireEvent.change(length);
		const dialog = screen.getByRole('alertdialog');
		expect(length.closest('.grid')!.contains(dialog)).toBe(true);
		await fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
		expect(length.value).toBe('8');
	});
});
