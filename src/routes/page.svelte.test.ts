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
	async function withAction() {
		await newFlow();
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
