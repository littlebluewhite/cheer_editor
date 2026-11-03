import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeEngine, type FakeEngine } from '#lib/audio/fake-engine.js';
import Page from './+page.svelte';

async function newFlow(engine: FakeEngine = createFakeEngine()) {
	render(Page, { createEngine: () => engine });
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
		// 時間軸 1 秒 = 16 px；150 BPM 的 3-5& 在 8.2 秒
		await fireEvent.pointerDown(ruler, { clientX: 8.2 * 16, button: 0 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-5&');
		await fireEvent.pointerMove(window, { clientX: 1.6 * 16 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-5');
		await fireEvent.pointerUp(window);
		await fireEvent.pointerMove(window, { clientX: 0 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-5');
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
		render(Page, { createEngine: () => createFakeEngine() });
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
		await fireEvent.change(screen.getByLabelText('小A 的任務角色'), { target: { value: '上層' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
	}

	const bar = () => document.querySelector('[data-lane="m1"] [data-action-id]');
	const dot = () => document.querySelector('[data-member-id="m1"]')!;

	it('新增的動作出現在泳道上；任務角色是上層的人在場上畫在最上面；閒著的人標「閒」', async () => {
		await withAction();
		expect(bar()?.textContent).toContain('上層');
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
		const steps = within(grid.getByRole('group', { name: '步驟' }));
		const motions = within(grid.getByRole('group', { name: '手位' }));
		const placed = () =>
			grid.queryAllByRole('button', { name: /^(拍子|步驟|手位) / }).map((b) => b.getAttribute('aria-label'));

		// 選 1-3 到 1-4，點「下手」放滿兩拍；手位只放在第一拍。
		await fireEvent.click(grid.getByRole('button', { name: '1-3' }));
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
		const who = within(grid.getByRole('group', { name: '給誰' }));
		const pressed = () =>
			who.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
		expect(who.getAllByRole('button').map((b) => b.textContent)).toEqual(['全部', '上層', '小A']);
		expect(pressed()).toEqual(['全部']);

		const motions = within(grid.getByRole('group', { name: '手位' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-7' }));
		await fireEvent.click(motions.getByRole('button', { name: 'T' }));
		await fireEvent.click(who.getByRole('button', { name: '上層' }));
		expect(pressed()).toEqual(['上層']);
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
		await fireEvent.click(within(grid.getByRole('group', { name: '給誰' })).getByRole('button', { name: '上層' }));
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
		await fireEvent.change(screen.getByLabelText('小A 的任務角色'), { target: { value: '上層' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));

		const grid = within(screen.getByRole('group', { name: '拍點' }));
		const who = within(grid.getByRole('group', { name: '給誰' }));
		await fireEvent.click(grid.getByRole('button', { name: '1-7' }));
		await fireEvent.click(who.getByRole('button', { name: '上層' }));
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
		expect(screen.getByRole('status').textContent).toBe('開始時間不能在段之前，已還原');
		expect((bar() as HTMLElement).style.left).toBe('0px');
	});
});

describe('站位與走位', () => {
	// jsdom 不算 SVG 座標：把場地預設的螢幕換公尺換成 1 px = 1 cm（見 ADR 0002）。
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

	async function seek(sec: number) {
		const ruler = document.querySelector('[data-ruler]')!;
		await fireEvent.pointerDown(ruler, { clientX: sec * 16, button: 0 });
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
		await fireEvent.click(screen.getByRole('button', { name: '清除' }));
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

	it('點縮圖跳到那一拍；✕ 刪掉站位；開頭那張沒有 ✕', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await seek(0);
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-1');
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-5&');

		expect(screen.queryByRole('button', { name: '刪掉站位 1' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '刪掉站位 2' }));
		expect(thumbs()).toHaveLength(1);
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

	it('有選人時只改選到的人；選到的人走法不一樣時欄位空白', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		await fireEvent.click(document.querySelector('[data-lane="m1"] .lab')!);
		await setWalk('1-1', '2-1');
		expect(depart()!.value).toBe('1-1');
		await fireEvent.keyDown(window, { key: 'Escape' });
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
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: 8.2 * 16, button: 0 });
		await fireEvent.pointerUp(window);
		await fireEvent.click(screen.getByRole('button', { name: '八拍表' }));
		const sheet = screen.getByRole('dialog', { name: '八拍表' });
		expect(within(sheet).getByRole('heading').textContent).toContain('全國賽');
		expect(within(sheet).getAllByRole('row')).toHaveLength(9);
		await fireEvent.click(within(sheet).getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog', { name: '八拍表' })).toBeNull();
		expect(position()).toBe('音樂 1 3-5&');
	});
});

describe('編輯器首頁', () => {
	it('新建流程後，上方畫出那個場地，沒有換場地的入口', async () => {
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

	it('按播放，播放頭跟著喇叭的時間走，口號段時間照走；再按一次暫停', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.resumed).toBe(true);
		const t0 = engine.clicks[0].when;
		engine.audible = t0 + 8.2;
		await nextFrame();
		expect(position()).toBe('音樂 1 3-5&');
		engine.audible = t0 + 25.6 + 3;
		await nextFrame();
		expect(position()).toBe('口號 1 3.0 秒');
		engine.audible = t0 + 35.6 + 0.4;
		await nextFrame();
		expect(position()).toBe('音樂 2 1-2');

		await fireEvent.click(screen.getByRole('button', { name: '暫停' }));
		expect(engine.clicks).toEqual([]);
		engine.audible = t0 + 50;
		await nextFrame();
		expect(position()).toBe('音樂 2 1-2');
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
	});

	it('從播放頭開始播：口號段沒有節拍器，第一聲是下一個音樂段的第一拍', async () => {
		const engine = await sample();
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, {
			clientX: 26.6 * 16,
			button: 0
		});
		await fireEvent.pointerUp(window);
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		engine.audible = engine.clicks[0].when;
		await nextFrame();
		expect(position()).toBe('音樂 2 1-1');
	});

	it('播放中在八拍尺上點，從那裡接著播', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, {
			clientX: 26.6 * 16,
			button: 0
		});
		await fireEvent.pointerUp(window);
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
		engine.audible = engine.clicks[0].when;
		await nextFrame();
		expect(position()).toBe('音樂 2 1-1');
	});

	it('空白鍵播放／暫停；在輸入框裡打字不算', async () => {
		const engine = await sample();
		await fireEvent.keyDown(window, { key: ' ' });
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
		await fireEvent.keyDown(window, { key: ' ' });
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
		await fireEvent.keyDown(screen.getByLabelText('延遲校正（毫秒）'), { key: ' ' });
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
		expect(engine.clicks).toEqual([]);
	});

	it('節拍器關掉就不響', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByLabelText('節拍器'));
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.clicks).toEqual([]);
		await fireEvent.click(screen.getByLabelText('節拍器'));
		expect(engine.clicks.length).toBeGreaterThan(0);
	});

	it('延遲校正：預設 0，存在瀏覽器；播放頭晚這麼多毫秒', async () => {
		const engine = await sample();
		const field = screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement;
		expect(field.value).toBe('0');
		await fireEvent.change(field, { target: { value: '200' } });
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		engine.audible = engine.clicks[0].when + 8.4;
		await nextFrame();
		expect(position()).toBe('音樂 1 3-5&');

		cleanup();
		await newFlow();
		expect((screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement).value).toBe('200');
	});

	it('段設定的「▶ 從第一拍聽 2 個八拍」播 16 拍節拍器，播放頭不動', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByRole('button', { name: /音樂 2/ }));
		await fireEvent.click(screen.getByRole('button', { name: '▶ 從第一拍聽 2 個八拍' }));
		expect(engine.resumed).toBe(true);
		expect(engine.clicks).toHaveLength(16);
		engine.audible = engine.clicks[0].when + 3;
		await nextFrame();
		expect(position()).toBe('音樂 1 1-1');
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
	});
});

describe('復原和重做', () => {
	// jsdom 不算 SVG 座標：把場地預設的螢幕換公尺換成 1 px = 1 cm（見 ADR 0002）。
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

	it('焦點在文字框或下拉選單裡時不攔，讓瀏覽器復原打的字', async () => {
		await setup();
		await seek(8.25);
		await dragFirstMember();
		const z = { key: 'z', ctrlKey: true };
		// fireEvent 回傳 false 表示被 preventDefault（瀏覽器自己的復原不會跑）
		expect(await fireEvent.keyDown(screen.getByLabelText('名稱'), z)).toBe(true);
		expect(thumbs()).toHaveLength(2);
		expect(await fireEvent.keyDown(screen.getByLabelText('加人'), z)).toBe(true);
		expect(thumbs()).toHaveLength(2);
		expect(await fireEvent.keyDown(window, z)).toBe(false);
		expect(thumbs()).toHaveLength(1);
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

	it('最多記 100 步', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const min = () => screen.getByLabelText('口號段最少（秒）') as HTMLInputElement;
		for (let i = 1; i <= 105; i++) await fireEvent.change(min(), { target: { value: String(i) } });
		for (let i = 0; i < 100; i++) await fireEvent.click(undoButton());
		expect(undoButton().disabled).toBe(true);
		expect(min().value).toBe('5');
	});

	it('復原後，選到的人、站位、動作已經不存在就清掉', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		await fireEvent.change(screen.getByLabelText('小A 的任務角色'), { target: { value: '上層' } });
		await fireEvent.change(screen.getByLabelText('小B 的任務角色'), { target: { value: '上層' } });
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
