<script lang="ts">
	// 元件測試用：把一個編輯器 module（和它的 session）放進 context，再畫要測的元件。只給測試用，頁面不 import。
	// 用法：const { editor, session } = testEditor(flow)（#lib/test-fakes.js）；
	// render(TestSession, { props: { editor, component: AttemptCard, props: { ... } } })，操作後讀 session.flow。
	import type { Component } from 'svelte';
	import { setEditor, type Editor } from './editor.svelte.js';

	interface Props {
		editor: Editor;
		/** 要測的元件（什麼元件都可以）。 */
		component: Component<any>;
		props: Record<string, unknown>;
	}

	let { editor, component: Inner, props }: Props = $props();
	// svelte-ignore state_referenced_locally
	setEditor(editor);
</script>

<Inner {...props} />
