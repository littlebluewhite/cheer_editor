<script lang="ts">
	// 支援頁（#372，照 #327 結論留言的大綱）：支援信箱、使用說明、怎麼要求刪除帳號、家長和隊員怎麼要求、多久回、隱私權政策。
	// 沒登入也打得開，不問伺服器。網頁版和 App 用同一份，只寫繁中（ADR 0017 的例外）。
	import { resolve } from '$app/paths';
	import AccountCard from '#lib/components/AccountCard.svelte';
	import { SUPPORT_EMAIL as SUPPORT } from '#lib/support-email.js';
</script>

<svelte:head><title>支援 — 流程編輯器</title></svelte:head>

<AccountCard wide>
	<article class="doc">
		<h1>支援</h1>

		<section>
			<h2>寫信給我們</h2>
			<p>
				有問題、要回報錯誤，寫信到 <a href="mailto:{SUPPORT}">{SUPPORT}</a>。怎麼用編輯器，先看<a href={resolve('/guide')}>使用說明</a>。
			</p>
		</section>

		<section>
			<h2>要求刪除帳號</h2>
			<p>
				登入後到<a href={resolve('/account')}>帳號頁</a>，按「要求刪除帳號」（App 和網頁版都有）。帳號馬上停用，30 天內刪好，刪好會寄信告訴你。不想刪了，回「收到了」那封信。
			</p>
			<p>登不進去的話，從帳號用的那個 email 寫信到 <a href="mailto:{SUPPORT}">{SUPPORT}</a>。</p>
		</section>

		<section>
			<h2>家長要刪孩子的帳號</h2>
			<p>家長（法定代理人）寫信到支援信箱。管理員透過帶隊的教練確認你是家長後，先停用帳號，30 天內刪好。</p>
		</section>

		<section>
			<h2>不是使用者的隊員</h2>
			<p>
				要拿掉流程裡自己的名字，先找那支流程的擁有者（通常是教練）改。找不到或對方不改，寫信到支援信箱；管理員會轉給擁有者，30 天內回覆你。
			</p>
		</section>

		<section>
			<h2>多久回</h2>
			<p>要查、要一份你的資料、要改資料：15 天內回覆，需要更久時會告訴你原因，最多再延 15 天。要刪除：30 天內回覆或刪好。</p>
		</section>

		<p>我們收什麼、交給誰、留多久，寫在<a href={resolve('/privacy')}>隱私權政策</a>。</p>
	</article>
</AccountCard>

<style>
	.doc {
		display: grid;
		gap: 12px;
		line-height: 1.7;
	}
	.doc h1 {
		margin: 0;
	}
	.doc h2 {
		margin: 8px 0 4px;
		font-size: 16px;
	}
	.doc p {
		margin: 0 0 6px;
	}
</style>
