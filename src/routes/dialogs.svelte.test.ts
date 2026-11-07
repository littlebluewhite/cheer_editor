// 流程設定、八拍表、段設定、名詞對照表四個對話框的共用行為（#93）：
// Esc、×、點背景結果一樣；焦點進去、Tab 只在裡面轉、關掉回到打開它的按鈕；填錯退回實際值並說哪一格。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import { addAction, addSegment as addSegmentTo } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

async function newFlow() {
	render(Page, editorPage().props);
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

/** 在最後加一段（會打開段設定），再關掉。 */
async function addSegment(kind: '＋音樂段' | '＋口號段') {
	await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
	await fireEvent.click(screen.getByRole('menuitem', { name: kind }));
	await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '關閉' }));
}

/** 點一個按鈕，跟真的一樣先讓它拿到焦點。 */
async function press(button: HTMLElement) {
	button.focus();
	await fireEvent.pointerDown(button);
	await fireEvent.click(button);
}

const dialog = (name: string | RegExp) => screen.getByRole('dialog', { name });

/** 三種關法。點 × 和點背景前先按下滑鼠（真的瀏覽器裡，欄位這時候失去焦點）。 */
const closers = {
	Esc: async () => {
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
	},
	'×': async () => {
		const close = within(screen.getByRole('dialog')).getByRole('button', { name: '關閉' });
		await fireEvent.pointerDown(close);
		await fireEvent.click(close);
	},
	背景: async () => {
		const backdrop = screen.getByRole('dialog').parentElement!;
		await fireEvent.pointerDown(backdrop);
		await fireEvent.click(backdrop);
	}
} as const;

/** 在欄位裡打字，還沒離開欄位（沒有 change）。 */
async function type(input: HTMLElement, value: string) {
	input.focus();
	await fireEvent.input(input, { target: { value } });
}

const microtasks = () => new Promise<void>((r) => setTimeout(r, 0));

describe('三種關法結果一樣', () => {
	for (const [how, close] of Object.entries(closers)) {
		it(`段設定：打了合法的八拍數還沒離開欄位就按${how}，改動留下`, async () => {
			await newFlow();
			await addSegment('＋音樂段');
			await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
			await type(screen.getByLabelText('八拍數'), '6');
			await close();
			expect(screen.queryByRole('dialog')).toBeNull();
			await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
			expect((screen.getByLabelText('八拍數') as HTMLInputElement).value).toBe('6');
		});

		it(`段設定：打了不合法的八拍數就按${how}，先不關、欄位退回、說哪一格；再關一次才關`, async () => {
			await newFlow();
			await addSegment('＋音樂段');
			await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
			const eights = screen.getByLabelText('八拍數') as HTMLInputElement;
			await type(eights, '0');
			await close();
			expect(dialog('音樂 1 設定')).toBeTruthy();
			expect(eights.value).toBe('8');
			expect(screen.getByRole('alert').textContent).toContain('「八拍數」');
			await close();
			expect(screen.queryByRole('dialog')).toBeNull();
		});

		it(`流程設定：打了合法的名字按${how}會留下；空白名字先不關、退回、說哪一格`, async () => {
			await newFlow();
			await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
			await type(screen.getByLabelText('流程名字'), '臺灣盃');
			await close();
			expect(screen.queryByRole('dialog')).toBeNull();
			expect(document.querySelector('.topbar b')?.textContent).toBe('臺灣盃');

			await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
			const name = screen.getByLabelText('流程名字') as HTMLInputElement;
			await type(name, ' ');
			await close();
			expect(dialog('流程設定')).toBeTruthy();
			expect(name.value).toBe('臺灣盃');
			expect(screen.getByRole('alert').textContent).toContain('「流程名字」');
			await close();
			expect(screen.queryByRole('dialog')).toBeNull();
		});
	}

	it('名詞對照表：點背景會關', async () => {
		await newFlow();
		await addSegment('＋音樂段');
		await fireEvent.click(screen.getByRole('tab', { name: /^動作/ }));
		await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
		await fireEvent.click(screen.getByRole('button', { name: '名詞對照表' }));
		await closers['背景']();
		expect(screen.queryByRole('dialog', { name: '名詞對照表' })).toBeNull();
	});

	it('在對話框裡按下滑鼠、拖到背景才放開，不算點背景', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const box = dialog('流程設定');
		await fireEvent.pointerDown(screen.getByLabelText('流程名字'));
		await fireEvent.click(box.parentElement!);
		expect(dialog('流程設定')).toBeTruthy();
	});
});

describe('焦點', () => {
	const openers: [string, () => HTMLElement, string | RegExp][] = [
		['流程設定', () => screen.getByRole('button', { name: '流程設定' }), '流程設定'],
		['八拍表', () => screen.getByRole('button', { name: '八拍表' }), '八拍表'],
		['段設定', () => screen.getByRole('button', { name: /^音樂 1/ }), '音樂 1 設定'],
		['名詞對照表', () => screen.getByRole('button', { name: '名詞對照表' }), '名詞對照表']
	];

	for (const [label, opener, name] of openers) {
		it(`${label}：打開時焦點進去、有 aria-modal；Tab、Shift+Tab 只在裡面轉；Esc 關掉後焦點回到打開它的按鈕`, async () => {
			await newFlow();
			await addSegment('＋音樂段');
			await fireEvent.click(screen.getByRole('tab', { name: /^動作/ }));
			// 名詞對照表在新動作表單裡：沒選人時表單收起來，先打開
			await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
			const button = opener();
			await press(button);
			const box = dialog(name);
			expect(box.getAttribute('aria-modal')).toBe('true');
			expect(box.contains(document.activeElement)).toBe(true);

			const focusables = [...box.querySelectorAll<HTMLElement>('button, input, select, textarea')].filter(
				(el) => !(el as HTMLButtonElement).disabled
			);
			const last = focusables.at(-1)!;
			last.focus();
			await fireEvent.keyDown(last, { key: 'Tab' });
			expect(document.activeElement).toBe(focusables[0]);
			await fireEvent.keyDown(focusables[0], { key: 'Tab', shiftKey: true });
			expect(document.activeElement).toBe(last);

			await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
			expect(screen.queryByRole('dialog', { name })).toBeNull();
			await microtasks();
			expect(document.activeElement).toBe(opener());
		});
	}

	it('段設定：往前移到第一段、按鈕變灰，焦點還在段設定裡', async () => {
		await newFlow();
		await addSegment('＋音樂段');
		await addSegment('＋口號段');
		await fireEvent.click(screen.getByRole('button', { name: /^口號 1/ }));
		const box = screen.getByRole('dialog');
		const forward = within(box).getByRole('button', { name: '往前移' }) as HTMLButtonElement;
		await press(forward);
		await tick();
		expect(forward.disabled).toBe(true);
		expect(box.contains(document.activeElement)).toBe(true);
		expect((document.activeElement as HTMLButtonElement).disabled).toBeFalsy();
	});
});

describe('對話框裡的確認框', () => {
	it('段設定的刪段確認框按 Esc 只關確認框，段設定還開著', async () => {
		await newFlow();
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
		await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'base' } });
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
		await fireEvent.click(screen.getByRole('tab', { name: /^動作/ }));
		await addSegment('＋音樂段');
		await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
		await fireEvent.change(screen.getByLabelText('加人'), { target: { value: 'm1' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));

		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		await fireEvent.click(screen.getByRole('button', { name: '刪除這一段' }));
		expect(screen.getByRole('alertdialog')).toBeTruthy();
		// 中文輸入法還在選字時的 Esc（Safari 選字時 keyCode 是 229）是給輸入法的，不關。
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape', isComposing: true });
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape', keyCode: 229 });
		expect(screen.getByRole('alertdialog')).toBeTruthy();
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(dialog('音樂 1 設定')).toBeTruthy();
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});

describe('被擋下的欄位', () => {
	it('段設定：擋下的欄位馬上回到實際值；改好別格，紅字也收掉（#163）', async () => {
		await newFlow();
		await addSegment('＋音樂段');
		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		const eights = screen.getByLabelText('八拍數') as HTMLInputElement;
		await fireEvent.change(eights, { target: { value: '0' } });
		expect(eights.value).toBe('8');
		expect(screen.getByRole('alert').textContent).toContain('「八拍數」');

		await fireEvent.change(screen.getByLabelText('BPM'), { target: { value: '140' } });
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('流程設定：擋下的數字欄位馬上回到實際值；改好別格，紅字也收掉（#163）', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const min = screen.getByLabelText('口號段加起來最少（秒）') as HTMLInputElement;
		const before = min.value;
		await fireEvent.change(min, { target: { value: '-5' } });
		expect(min.value).toBe(before);
		expect(screen.getByRole('alert').textContent).toContain('「口號段加起來最少（秒）」');

		await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: '臺灣盃' } });
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('口號段長度填錯留下紅字，再按「刪除這一段」：確認框出現時舊紅字已收掉（#210）', async () => {
		let flow = flowOf(addSegmentTo(libSample(), 'chant'));
		flow = flowOf(addAction(flow, { segmentId: 's2', category: 'other', name: '口號', start: 0, length: 10, note: '', members: [{ memberId: 'm1', role: '上層' }] }));
		render(Page, editorPage(flow).props);
		await fireEvent.click(screen.getByRole('button', { name: /^口號 1/ }));
		await fireEvent.change(screen.getByLabelText('長度（秒）'), { target: { value: '99999' } });
		expect(screen.getByRole('alert').textContent).toContain('「長度（秒）」');

		await fireEvent.click(screen.getByRole('button', { name: '刪除這一段' }));
		expect(screen.getByRole('alertdialog')).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
	});
});

describe('流程設定看得到場地', () => {
	it('寫現在的場地：幾條、直放或橫放；調整場地的欄位填好現在的值（#169）', async () => {
		render(Page, editorPage().props);
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '臺灣盃' } });
		await fireEvent.click(screen.getByRole('radio', { name: /5 條橫放/ }));
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const settings = within(dialog('流程設定'));
		expect(settings.getByText(/現在 5 條橫放/)).toBeTruthy();
		expect((settings.getByLabelText('條數') as HTMLInputElement).value).toBe('5');
		expect((settings.getByLabelText('橫放') as HTMLInputElement).checked).toBe(true);
		expect((settings.getByRole('button', { name: '調整場地' }) as HTMLButtonElement).disabled).toBe(true);
	});
});
