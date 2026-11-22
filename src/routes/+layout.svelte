<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { host } from '#lib/host.js';
	import '../app.css';

	let { children } = $props();

	// app.html 在程式跑起來之前，不是中文就先藏起畫面（免得閃一下中文）；字換好了，這裡接手
	// 也問一次語言：Paraglide 第一次問會把挑到的存起來，沒用到翻譯的頁直接打開也一樣（之後改瀏覽器語言不會跟著變）
	onMount(() => {
		getLocale();
		delete document.documentElement.dataset.localePending;
	});
	// App：網頁畫面出來了，跟殼說「好了」（殼換上新網頁後靠這句判斷打不打得開，ADR 0025）
	onMount(() => {
		if (host().shell.inApp) host().shell.send('ready').catch(() => {});
	});
</script>

{@render children()}
