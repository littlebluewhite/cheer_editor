import { describe, expect, it } from 'vitest';
import { libSample } from '#lib/test-flows.js';
import { fakePendingInput, testEditor } from '#lib/test-fakes.js';

describe('編輯器 module：建', () => {
	it('給一支流程：session 拿得到，算存過的', () => {
		const flow = libSample();
		const { editor } = testEditor(flow);
		expect(editor.session.flow).toBe(flow);
		expect(editor.session.unsaved).toBe(false);
	});

	it('沒給流程：在首頁', () => {
		const { editor } = testEditor();
		expect(editor.session.flow).toBeNull();
	});
});

describe('編輯器 module：右邊欄', () => {
	it('點色條：選這個動作（站位的選取清掉），右邊欄翻到「動作」；再點選著的那條也翻', () => {
		const { editor, session } = testEditor(libSample());
		session.selectFormation('f1');
		editor.inspectorTab = 'members';
		editor.pickAction('x1');
		expect(session.selectedActionId).toBe('x1');
		expect(session.selectedFormationId).toBeNull();
		expect(editor.inspectorTab).toBe('action');

		editor.inspectorTab = 'members';
		editor.pickAction('x1');
		expect(session.selectedActionId).toBe('x1');
		expect(editor.inspectorTab).toBe('action');
	});

	it('別的地方選動作（動作設定）不算點色條：右邊欄不翻', () => {
		const { editor, session } = testEditor(libSample());
		editor.inspectorTab = 'members';
		session.selectAction('x1');
		expect(editor.inspectorTab).toBe('members');
	});
});

describe('編輯器 module：有沒有沒存的東西（關分頁前的提醒、service worker 擋重新整理看這個）', () => {
	it('剛開的流程、沒打字：沒有；有沒存的改動：有', () => {
		const { editor, session } = testEditor(libSample());
		expect(editor.hasUnsavedWork).toBe(false);
		session.open(libSample());
		expect(editor.hasUnsavedWork).toBe(true);
	});

	it('欄位裡打了字還沒送出：有，沒有沒存的改動也一樣；送出了就沒有', () => {
		const pendingInput = fakePendingInput();
		const { editor, session } = testEditor(libSample(), { pendingInput });
		pendingInput.pending = true;
		expect(session.unsaved).toBe(false);
		expect(editor.hasUnsavedWork).toBe(true);
		pendingInput.flush();
		expect(editor.hasUnsavedWork).toBe(false);
	});

	it('首頁（沒開流程）打的字不算', () => {
		const pendingInput = fakePendingInput();
		const { editor } = testEditor(null, { pendingInput });
		pendingInput.pending = true;
		expect(editor.hasUnsavedWork).toBe(false);
	});
});
