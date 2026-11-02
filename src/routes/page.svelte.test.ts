import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

async function newFlow() {
	render(Page);
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

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
});

describe('動作', () => {
	async function withAction() {
		await newFlow();
		await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: '小A' } });
		await fireEvent.change(screen.getByLabelText('性別'), { target: { value: 'F' } });
		await fireEvent.change(screen.getByLabelText('全局角色'), { target: { value: 'base' } });
		await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
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

	it('點色條選動作，按 Delete 刪掉；在輸入框裡按 Delete 不刪', async () => {
		await withAction();
		await fireEvent.keyDown(window, { key: 'Escape' });
		await fireEvent.click(bar()!);
		await fireEvent.keyDown(screen.getByLabelText('名稱'), { key: 'Delete' });
		expect(bar()).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(bar()).toBeNull();
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
});
