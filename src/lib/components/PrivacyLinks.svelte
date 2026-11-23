<script lang="ts">
	// 「隱私權政策・支援」一行小字（#372）：首頁（登入前後）、登入頁、帳號頁最下面。使用說明的放在授權小字那一行。
	// 站內連結、不開新分頁：App 裡開的是 App 裡那包網頁的頁面，離線也看得到。
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
</script>

<p class="privacy-links">
	<a href={resolve('/privacy')}>{m.privacy_policy()}</a>・<a href={resolve('/support')}>{m.support_page()}</a>
</p>

<style>
	.privacy-links {
		margin: 20px 0 0;
		text-align: center;
		font-size: 12px;
		color: var(--muted);
	}
	.privacy-links a {
		color: inherit;
	}
</style>
