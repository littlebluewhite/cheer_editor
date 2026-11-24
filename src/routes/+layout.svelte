<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
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
	// App：從「檔案」、分享選單交來流程檔時停在別頁（使用說明、帳號、登入…）：回編輯器，編輯器一開就拿那個檔打開（#384）
	onMount(() =>
		host().shell.on('fileOpened', () => {
			if (page.route.id !== '/') void goto(resolve('/'));
		})
	);
</script>

{@render children()}
