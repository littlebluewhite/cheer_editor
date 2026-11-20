// 編輯器的提示、確認框、開檔錯誤照畫面的語言寫（ADR 0017）：英文畫面一個中文字都沒有（教練取的名字用英文）。
import { render, screen } from '@testing-library/svelte';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordAttempt, renameFlow, type Flow } from '#lib/core';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import { viewOnlyReason } from '#lib/editor-layout.js';
import { selectionActions } from '#lib/selection-actions.js';
import { saveFailureReason } from '#lib/file/save.js';
import { testEditor } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import ConfirmList from '#lib/components/ConfirmList.svelte';

const HAN = /\p{Script=Han}/u;

/** libSample 換成英文的名字（固定的任務角色照存的中文，畫面再翻）。 */
function sample(): Flow {
	const flow = libSample();
	const names = ['Amy', 'Al', 'Bo', 'Fay'];
	return { ...flow, name: 'Test', members: flow.members.map((m, i) => ({ ...m, name: names[i] })) };
}

const attempt = { date: '2026-11-05', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } as const;

describe('英文畫面：編輯器的提示', () => {
	beforeEach(() => localStorage.setItem(localStorageKey, 'en'));

	it('改了、復原、重做的提示和復原鈕', () => {
		const s = new EditorSession(sample());
		s.change(flowOf(renameFlow(s.flow!, 'Final')));
		expect(s.notice).toBe('Done: Rename routine');
		expect(s.noticeButton).toMatchObject({ label: 'Undo', name: 'Undo: Rename routine' });
		s.undo();
		expect(s.notice).toBe('Undid: Rename routine');
		s.redo();
		expect(s.notice).toBe('Redid: Rename routine');
		s.removeAction('x1');
		expect(s.notice).not.toMatch(HAN);
	});

	it('確認框（要確認、要選）的字和鈕', async () => {
		const s = new EditorSession(sample());
		s.record(flowOf(recordAttempt(s.flow!, 'x1', attempt)));
		s.ask.send({ name: 'deleteAction', args: ['x1'] });
		const { unmount } = render(ConfirmList, { ask: s.ask });
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
		expect(document.body.textContent).not.toMatch(HAN);
		unmount();

		s.ask.answer('cancel');
		s.ask.send({ name: 'updateMember', args: ['m1', { name: 'Amelia' }] });
		expect(s.ask.question?.choose).toBe(true);
		render(ConfirmList, { ask: s.ask });
		for (const name of ['Keep old reps', 'Clear and recount', 'Cancel']) expect(screen.getByRole('button', { name })).toBeTruthy();
		expect(document.body.textContent).not.toMatch(HAN);
	});

	it('開檔錯誤：壞掉的檔、太新的檔、拿音樂檔來開', async () => {
		const { editor } = testEditor();
		await editor.file.open(new File([new TextEncoder().encode('not a zip')], 'junk.zip'));
		expect(editor.file.openError).toBe("Can't open “junk.zip”: The file is damaged, or it isn't a routine file saved by this editor");
		const tooNew = zipSync({ 'flow.json': strToU8(JSON.stringify({ formatVersion: 99, flow: {} })) });
		await editor.file.open(new File([tooNew], 'new.zip'));
		expect(editor.file.openError).not.toMatch(HAN);
		await editor.file.open(new File([new Uint8Array([1, 2, 3])], 'song.mp3'));
		expect(editor.file.openError).toMatch(/^Can't open “song\.mp3”: This is a music file/);
		expect(editor.file.openError).not.toMatch(HAN);
	});

	it('選人工具列、窄螢幕、存影片失敗的字', () => {
		const texts = selectionActions(3).flatMap((a) => [a.label, a.title, a.group ?? '']);
		texts.push(viewOnlyReason(400, 800, false), viewOnlyReason(400, 300, false), viewOnlyReason(800, 1200, true));
		texts.push(saveFailureReason(new DOMException('', 'QuotaExceededError')), saveFailureReason(null));
		for (const text of texts) expect(text).not.toMatch(HAN);
		expect(selectionActions(0)[0].label).toContain('[_]');
	});
});
