// 頁面：窄螢幕（寬不到 1024 或高不到 600）擋住編輯畫面的提示，上面的「回首頁」「去練習」（docs/adr/0005-ipad-touch.md）。
// 提示什麼時候蓋上來是媒體查詢的事，jsdom 量不到，在 check:layout 檢查；這裡只按提示上的兩顆按鈕。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { writeFlowFile } from '#lib/core';
import { audioFlow, editorPage, flush, openFile } from '#lib/test-fakes.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

function setup() {
	render(Page, editorPage().props);
}

async function newFlow() {
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

const hint = () => within(screen.getByRole('region', { name: '視窗太窄了' }));

describe('窄螢幕：擋住編輯畫面的提示', () => {
	it('「去練習」切到練習畫面，提示就不見了', async () => {
		setup();
		await flush();
		await newFlow();
		await fireEvent.click(hint().getByRole('button', { name: '去練習' }));
		expect(screen.getByRole('button', { name: '練習' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.queryByRole('region', { name: '視窗太窄了' })).toBeNull();
		// 切回編排又擋住
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		expect(hint().getByRole('button', { name: '回首頁' })).toBeTruthy();
	});

	it('隊員開了流程檔，按「看八拍表」直接看八拍表（只能看）；關掉回到提示', async () => {
		setup();
		await flush();
		await openFile(writeFlowFile(audioFlow(), {}));
		await flush();
		await fireEvent.click(hint().getByRole('button', { name: '看八拍表' }));
		const sheet = within(screen.getByRole('dialog', { name: '八拍表' }));
		expect(sheet.getByLabelText('印誰')).toBeTruthy();
		// 提示收起來，不蓋住八拍表
		expect(screen.queryByRole('region', { name: '視窗太窄了' })).toBeNull();
		await fireEvent.click(sheet.getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog', { name: '八拍表' })).toBeNull();
		expect(hint().getByRole('button', { name: '看八拍表' })).toBeTruthy();
	});

	it('剛建好的流程按「回首頁」：回到首頁，問要不要救回', async () => {
		setup();
		await flush();
		await newFlow();
		await fireEvent.click(hint().getByRole('button', { name: '回首頁' }));
		await flush();
		expect(screen.getByRole('alertdialog').textContent).toContain('全國賽');
	});

	it('有未存的修改按「回首頁」：跟「新建」一樣先問；取消就留著，「不存了，繼續」才回首頁', async () => {
		setup();
		await flush();
		await newFlow();
		// 改一下：加一段口號（jsdom 不套媒體查詢，提示底下的編輯畫面點得到）
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋口號段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await fireEvent.click(hint().getByRole('button', { name: '回首頁' }));
		const dialog = within(screen.getByRole('dialog', { name: '「全國賽」還沒存，改的東西會不見。' }));
		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(screen.getByText('全國賽')).toBeTruthy();

		await fireEvent.click(hint().getByRole('button', { name: '回首頁' }));
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		await flush();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		// 丟掉了，首頁不問要不要救回
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});
});
