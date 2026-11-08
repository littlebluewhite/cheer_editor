// 檢視模式（電腦，#174）：上方列「編輯｜檢視」按「檢視」就只能看、只能播放；改流程的指令都擋下（不只藏按鈕），按回「編輯」又能改。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeCue, updateAction } from '#lib/core';
import { Ask } from '#lib/ask.svelte.js';
import { VIEW_ONLY } from '#lib/editor-session.svelte.js';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

/** 頁面放範例流程：音樂 1、小美（m1）、小A、小B、小芳，動作 Lib（x1）。 */
function setup() {
	const { session, props } = editorPage(libSample());
	render(Page, props);
	return session;
}

const editBtn = () => screen.getByRole('button', { name: '編輯' });
const viewBtn = () => screen.getByRole('button', { name: '檢視' });
const undoBtn = () => screen.getByRole('button', { name: '復原' }) as HTMLButtonElement;
const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
const playing = () => !!screen.queryByRole('button', { name: '暫停' });
const nameBox = () => screen.getByLabelText('第 1 位隊員的名字') as HTMLInputElement;

async function drag(id: string) {
	await fireEvent.pointerDown(dot(id), { clientX: 0, clientY: 0, button: 0 });
	await fireEvent.pointerMove(dot(id), { clientX: -200, clientY: -300 });
	await fireEvent.pointerUp(dot(id), { clientX: -200, clientY: -300 });
}

describe('檢視模式', () => {
	it('預設是編輯；按「檢視」後拖人、Delete、⌘Z、改名都不改流程', async () => {
		const session = setup();
		expect(editBtn().getAttribute('aria-pressed')).toBe('true');
		// 先改一次，⌘Z 才有東西可以退
		await drag('m1');
		expect(session.canUndo).toBe(true);
		// 隊員分頁先打開：檢視模式的右邊欄沒有分頁，名字框藏著，但改名照樣送到指令那一層
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		await fireEvent.click(viewBtn());
		expect(viewBtn().getAttribute('aria-pressed')).toBe('true');
		expect(editBtn().getAttribute('aria-pressed')).toBe('false');
		// 上方列換色、場地角落有標籤，一眼看得出是檢視模式
		expect(document.querySelector('.topbar')!.classList.contains('viewing')).toBe(true);
		expect(document.querySelector('.field-host')!.textContent).toContain('檢視模式・只能看');
		const before = session.flow;
		const where = dot('m2').getAttribute('transform');

		await drag('m2');
		expect(session.flow).toBe(before);
		expect(dot('m2').getAttribute('transform')).toBe(where);
		expect(screen.getByRole('status').textContent).toContain('檢視模式');

		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(session.flow).toBe(before);
		expect(document.querySelector('[data-action-id="x1"]')).not.toBeNull();

		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(session.flow).toBe(before);
		// 復原、重做、流程設定留在原地、變灰：換模式時按鈕不會跑
		expect(undoBtn().disabled).toBe(true);
		expect((screen.getByRole('button', { name: '重做' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: /設定/ }) as HTMLButtonElement).disabled).toBe(true);

		await fireEvent.change(nameBox(), { target: { value: '美美' } });
		expect(session.flow).toBe(before);
		expect(nameBox().value).toBe('小美');
	});

	it('檢視模式下空白鍵照樣播放', async () => {
		setup();
		await fireEvent.click(viewBtn());
		await fireEvent.keyDown(window, { key: ' ' });
		expect(playing()).toBe(true);
	});

	it('檢視模式拖走位條中間：提示「檢視模式」不能改，不是「已靠到邊界」', async () => {
		const session = setup();
		// 播放頭停在 3-5&（時間軸 1 秒 16 px），拖小美：插站位 2，小美有一條走位條
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: 8.25 * 16, button: 0, altKey: true });
		await fireEvent.pointerUp(window);
		await drag('m1');
		await fireEvent.click(viewBtn());
		const before = session.flow;
		// 往後拖：走位條本來就貼著站位 2，在編輯模式會停在邊界
		const bar = document.querySelector('[data-lane="m1"] [data-walk]')!;
		await fireEvent.pointerDown(bar, { clientX: 300, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 400 });
		await fireEvent.pointerUp(window, { clientX: 400 });
		expect(session.flow).toBe(before);
		expect(screen.getByRole('status').textContent).toContain('檢視模式');
		expect(screen.getByRole('status').textContent).not.toContain('已靠到邊界');
	});

	it('檢視模式改站位名稱被擋下：名稱框變回流程裡的名字', async () => {
		const session = setup();
		await fireEvent.click(viewBtn());
		const box = screen.getByLabelText('站位名稱') as HTMLInputElement;
		const name = box.value;
		await fireEvent.change(box, { target: { value: '開場' } });
		expect(session.flow!.formations[0].name ?? '').toBe(name);
		expect(box.value).toBe(name);
	});

	it('按回「編輯」就能改', async () => {
		const session = setup();
		await fireEvent.click(viewBtn());
		await fireEvent.click(editBtn());
		expect(editBtn().getAttribute('aria-pressed')).toBe('true');
		expect(document.querySelector('.topbar')!.classList.contains('viewing')).toBe(false);
		expect(document.querySelector('.field-host')!.textContent).not.toContain('檢視模式・只能看');
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		await fireEvent.change(nameBox(), { target: { value: '美美' } });
		expect(session.flow!.members[0].name).toBe('美美');
		expect(undoBtn().disabled).toBe(false);
	});

	it('檢視模式是「看的版面」：沒有站位編輯欄、右邊欄只有「我」、現在這一列、點到的動作的詳細內容', async () => {
		// 動作 Lib 加備註、一個給上層的拍點
		let flow = flowOf(updateAction(libSample(), 'x1', { note: '底層先蹲好' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 4, word: 'down', who: { role: '上層' } }));
		const { props } = editorPage(flow);
		render(Page, props);
		await fireEvent.click(viewBtn());

		// 編輯的東西都看不到：站位編輯欄、新動作表單、右邊欄的分頁
		expect(screen.queryByRole('textbox', { name: '站位名稱' })).toBeNull();
		expect(screen.queryByRole('textbox', { name: '名稱' })).toBeNull();
		expect(screen.queryByRole('tab', { name: '動作' })).toBeNull();
		expect(screen.queryByRole('button', { name: '放大' })).toBeNull();
		// 看的東西：「我」選單、八拍表這一列、還沒點動作時說怎麼看
		const me = screen.getByRole('combobox', { name: '我' }) as HTMLSelectElement;
		const now = screen.getByRole('region', { name: '八拍表這一列' });
		expect(now.textContent).toContain('Lib');
		const panel = screen.getByRole('complementary', { name: '右邊欄' });
		expect(panel.textContent).toContain('點時間軸上的動作');

		// 選「我」：這一列只看我的
		await fireEvent.change(me, { target: { value: 'm2' } });
		expect(me.value).toBe('m2');
		expect(now.textContent).toContain('主底');

		// 點時間軸上的動作：人、任務角色、拍點、備註，只能看（沒有輸入框）
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		const detail = screen.getByRole('region', { name: '動作詳細' });
		const text = detail.textContent!;
		expect(text).toContain('Lib');
		expect(text).toContain('音樂 1 1-1 到 1-8・8 拍');
		for (const words of ['小美', '上層', '小A', '主底', '小B', '小芳']) expect(text).toContain(words);
		expect(text).toContain('拍子 down 1-1 到 1-2・2 拍・給上層');
		expect(text).toContain('底層先蹲好');
		expect(detail.querySelectorAll('input, select, textarea, button')).toHaveLength(0);
	});

	it('切回編輯：站位編輯欄、分頁、動作表單、放大縮小都回來', async () => {
		setup();
		await fireEvent.click(viewBtn());
		await fireEvent.click(editBtn());
		expect(screen.getByRole('textbox', { name: '站位名稱' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '放大' })).toBeTruthy();
		expect(screen.getByRole('tab', { name: '動作' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('button', { name: '＋ 新動作' })).toBeTruthy();
		expect(screen.queryByRole('region', { name: '八拍表這一列' })).toBeNull();
		expect(screen.queryByRole('combobox', { name: '我' })).toBeNull();
	});
});

/** 看得到、按得到的控制項：不在藏起來（hidden、inert）的地方，沒停用。
 *  檢視模式下標了 data-edit 的整塊藏起來（+page.svelte 的 `.editor.viewing [data-edit]`），jsdom 不算 CSS，這裡照那條規則跳過。 */
function usable(el: Element): boolean {
	if (el.closest('[hidden], [inert]')) return false;
	if (el.closest('.viewing [data-edit]')) return false;
	return !el.matches(':disabled');
}

/** 離開這個畫面的（換流程、回首頁、切回編輯、切到練習、蓋滿畫面的八拍表）：不按，掃的是檢視模式的編排畫面。 */
const LEAVES = ['編輯', '新建', '開啟', '回首頁', '編排', '練習', '去練習', '八拍表', '看八拍表'];

function nameOf(el: Element): string {
	const label = el.getAttribute('aria-label') ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? el.textContent ?? '';
	return label.trim().replace(/\s+/g, ' ').slice(0, 30);
}

/** 文字欄打字、按 Enter、送出；下拉選別的；其他按一下。 */
async function use(el: HTMLElement) {
	if (el instanceof HTMLSelectElement) {
		const other = [...el.options].find((o) => o.value !== el.value);
		if (other) await fireEvent.change(el, { target: { value: other.value } });
		return;
	}
	const typing = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button', 'submit'].includes(el.type));
	if (!typing) return void (await fireEvent.click(el));
	el.focus();
	await fireEvent.input(el, { target: { value: '9' } });
	await fireEvent.keyDown(el, { key: 'Enter' });
	await fireEvent.change(el);
	el.blur();
}

describe('檢視模式：看得到的都按一遍，不會按了才說「檢視模式」（N04）', () => {
	afterEach(() => vi.restoreAllMocks());

	it('時間軸、段設定、站位縮圖、動作條、分組列：看得到、按得到的都不會被 VIEW_ONLY 擋下', async () => {
		const session = setup();
		// 有第二張站位（有 ✕、拖得動）：播放頭到 3-5&，拖小美
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: 8.25 * 16, button: 0, altKey: true });
		await fireEvent.pointerUp(window);
		await drag('m1');
		await fireEvent.click(viewBtn());
		// 選第二張站位、動作 Lib（有環節，分組列出來）
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		const before = session.flow;
		// 送到問題（Ask）的指令被檢視模式擋下幾次：表單旁的紅字同一句不會變多，所以數擋下的次數
		let locked = 0;
		const send = Ask.prototype.send;
		vi.spyOn(Ask.prototype, 'send').mockImplementation(function (this: Ask, ...args) {
			const r = send.apply(this, args);
			if (r.kind === 'blocked' && r.message === VIEW_ONLY) locked++;
			return r;
		});

		const tried = new WeakSet<Element>();
		const names: string[] = [];
		const blocked: string[] = [];
		for (let i = 0; i < 400; i++) {
			const left = [...document.querySelectorAll<HTMLElement>('button, input, select, textarea, [role=button]')].filter(
				(e) => !tried.has(e) && usable(e) && !LEAVES.includes(nameOf(e))
			);
			// 「關閉」最後才按：對話框裡的東西先按完
			const el = left.find((e) => nameOf(e) !== '關閉') ?? left[0];
			if (!el) break;
			tried.add(el);
			names.push(nameOf(el));
			const already = locked;
			await use(el);
			if (session.notice.includes(VIEW_ONLY) || locked > already) blocked.push(nameOf(el));
			session.notice = '';
		}
		expect(blocked).toEqual([]);
		expect(session.flow).toBe(before);
		// 真的掃到了：播放、時間軸縮放、站位縮圖、動作條，和點段名打開的只能看的段設定（試聽照樣能按）
		for (const name of ['播放', '時間軸放大', '站位 2', 'Lib 上層', '▶ 從第一拍聽 2 個八拍']) expect(names).toContain(name);
		// 段設定的欄位是停用的：按不到
		expect(names).not.toContain('BPM');
		expect(names).not.toContain('刪除這一段');
	});
});
