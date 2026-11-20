<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	// app.html 在程式跑起來之前，不是中文就先藏起畫面（免得閃一下中文）；字換好了，這裡接手
	onMount(() => delete document.documentElement.dataset.localePending);
</script>

{@render children()}
