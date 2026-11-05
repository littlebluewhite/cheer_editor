import { describe, expect, it } from 'vitest';
import { libSample } from '#lib/test-flows.js';
import { testEditor } from '#lib/test-fakes.js';

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
