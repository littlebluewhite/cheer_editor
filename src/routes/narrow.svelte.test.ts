// 頁面：窄螢幕（寬不到 1024 或高不到 600）擋住編輯畫面的提示，上面的「回首頁」「去練習」（docs/adr/0005-ipad-touch.md）。
// 提示什麼時候蓋上來是媒體查詢的事，jsdom 量不到，在 check:layout 檢查；這裡只按提示上的兩顆按鈕。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { writeFlowFile } from '#lib/core';
import { audioFlow, editorPage, fakeDraftStore, flush, openFile } from '#lib/test-fakes.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

function setup(drafts = fakeDraftStore()) {
	render(Page, editorPage(null, { draftStore: drafts.store }).props);
	return drafts;
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

	it('剛建好的流程按「回首頁」：回到首頁，流程還在草稿裡，問要不要救回', async () => {
		const drafts = setup();
		await flush();
		await newFlow();
		await fireEvent.click(hint().getByRole('button', { name: '回首頁' }));
		await flush();
		expect(drafts.state.bytes).not.toBeNull();
		expect(screen.getByRole('alertdialog').textContent).toContain('全國賽');
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await flush();
		expect(screen.getByText('全國賽')).toBeTruthy();
	});

	it('剛開、沒改過的流程檔按「回首頁」：直接回首頁，不問', async () => {
		const drafts = setup();
		await flush();
		await openFile(writeFlowFile(audioFlow(), {}));
		await flush();
		expect(screen.getByText('練習用')).toBeTruthy();
		await fireEvent.click(hint().getByRole('button', { name: '回首頁' }));
		await flush();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(drafts.state.bytes).toBeNull();
	});
});
