<script lang="ts">
	// 元件測試用：把一個 session 放進 context，再畫要測的元件。只給測試用，頁面不 import。
	// 用法：render(TestSession, { props: { session, component: AttemptCard, props: { ... } } })，操作後讀 session.flow。
	import type { Component } from 'svelte';
	import { setEditorSession, type EditorSession } from './editor-session.svelte.js';

	interface Props {
		session: EditorSession;
		/** 要測的元件（什麼元件都可以）。 */
		component: Component<any>;
		props: Record<string, unknown>;
	}

	let { session, component: Inner, props }: Props = $props();
	// svelte-ignore state_referenced_locally
	setEditorSession(session);
</script>

<Inner {...props} />
