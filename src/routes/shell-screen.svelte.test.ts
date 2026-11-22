// App 的手感（#376）：網頁跟殼說現在是哪一種畫面，殼決定整頁回不回彈。
// 打開一支流程是編輯畫面（不回彈），回首頁是會捲的頁（照樣回彈）。殼用照情境檔演的假殼，殼的測試跑同一份。
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { browserHost } from '#lib/host.js';
import { appShell } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { editorPage, fakeHost, fakeShell, flush } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

describe('跟殼說現在是哪一種畫面', () => {
	it('App：打開流程說是編輯畫面，回首頁說是會捲的頁', async () => {
		const fake = scenarioShell('screen.json', '打開流程說是編輯畫面_回首頁說是會捲的頁');
		fakeHost({ shell: appShell(fake.bridge) });
		const { editor, props } = editorPage(libSample());
		render(Page, props);
		await flush();
		await editor.file.leaveToHome();
		await flush();
		expect(screen.queryByRole('textbox', { name: /流程名/ })).not.toBeNull();
		fake.done();
	});

	it('App：首頁不說（殼一開始就當是會捲的頁）', async () => {
		const send = vi.fn(() => Promise.resolve(null));
		fakeHost({ shell: { ...fakeShell(['screen']), send } });
		render(Page, editorPage().props);
		await flush();
		expect(send).not.toHaveBeenCalled();
	});

	it('舊的殼不會分畫面：不問', async () => {
		const send = vi.fn(() => Promise.resolve(null));
		fakeHost({ shell: { ...fakeShell([]), send } });
		render(Page, editorPage(libSample()).props);
		await flush();
		expect(send).not.toHaveBeenCalled();
	});

	it('網頁版：不跟誰說', async () => {
		const send = vi.fn(browserHost.shell.send);
		fakeHost({ shell: { ...browserHost.shell, send } });
		render(Page, editorPage(libSample()).props);
		await flush();
		expect(send).not.toHaveBeenCalled();
	});
});
