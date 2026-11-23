<script lang="ts">
	// 隱私權政策（#372）：照 #327 結論留言的大綱和「更正」四點寫，台灣法律的根據在 #326。網頁版和 App 用同一份，只寫繁中（ADR 0017 的例外）。
	// 沒登入也打得開，不問伺服器（App 裡離線也看得到）。留多久的數字對得上伺服器實際的行為：
	// server/src/accounts.rs（登入 30 天、cookie 400 天、設密碼連結 24 小時／1 小時）、daily.rs（每天台灣時間 5 點清）、
	// backup.rs（備份 30 天）、lockout.rs。改了那邊，這頁跟著改，最上面的日期也改。
	// 「資料處理條款」那句只寫已經適用的：Fly.io 的另外簽（#372，網站主人 2026-11-24 在 Fly.io Trust Center 簽好）。
	import { resolve } from '$app/paths';
	import AccountCard from '#lib/components/AccountCard.svelte';
	import { SUPPORT_EMAIL as SUPPORT } from '#lib/support-email.js';

	/** 網站主人的法定姓名（跟 App Store 上的賣家一樣）：由網站主人自己填，不寫進 issue、commit 訊息、PR 說明。 */
	const OWNER_NAME = '林峻緯';
	/** 最後更新日期：改了內容就改這裡；大改（多收一種資料、多一個第三方）還要寄信給所有使用者。 */
	const UPDATED = '2026-11-24';
</script>

<svelte:head><title>隱私權政策 — 流程編輯器</title></svelte:head>

<AccountCard wide>
	<article class="doc">
		<h1>隱私權政策</h1>
		<p class="updated">最後更新：{UPDATED}</p>
		<p>
			這份政策說明「競技啦啦隊流程編輯器」收哪些個人資料、怎麼收、拿來做什麼、交給誰、留多久，和你可以怎麼要求查、改、刪。有問題寫信到
			<a href="mailto:{SUPPORT}">{SUPPORT}</a>，或看<a href={resolve('/support')}>支援</a>頁。
		</p>

		<section>
			<h2>誰在收</h2>
			<p>{OWNER_NAME}（個人，跟 App Store 上的賣家同一人；以下稱「我們」）。聯絡方式：<a href="mailto:{SUPPORT}">{SUPPORT}</a>。</p>
		</section>

		<section>
			<h2>這份政策管什麼</h2>
			<p>網站 littlebluewhite.com 和 App「流程編輯器」。兩個是同一個服務，App 裡跑的是同一份網頁，用同一個帳號。</p>
		</section>

		<section>
			<h2>沒有帳號時</h2>
			<p>
				不用登入也能用。你在這台裝置上排的流程、草稿和小設定（例如語言）只存在這台裝置：網頁版存在瀏覽器裡，App 存在 App 自己的資料夾裡。這些不會傳到我們的伺服器。網頁和 App 只會從網站下載網站本身的檔案（App 也會去網站抓新版的網頁畫面）。
			</p>
		</section>

		<section>
			<h2>有帳號時收什麼、怎麼收、拿來做什麼</h2>
			<p>帳號由管理員邀請才有。收的資料都只拿來提供這個服務：登入、存雲端流程、分享、記成功率。</p>
			<ul>
				<li><b>email 和名字</b>：管理員邀請你時填的，名字之後你可以在帳號頁自己改。用來登入、寄信給你（邀請、設密碼、通知），和讓你分享的人認得你。</li>
				<li>
					<b>密碼</b>：我們只存密碼的雜湊（Argon2id），不存密碼本身。設密碼時，會把密碼 SHA-1 雜湊的前 5 碼送到 Pwned Passwords 查這個密碼有沒有外洩過；只靠這 5 碼認不出你的密碼，也認不出你是誰。
				</li>
				<li>
					<b>登入</b>：登入後，瀏覽器或 App 裡存一個 cookie（<code>__Host-id</code>），只用來認得這是你。這個 cookie 留在瀏覽器裡最多 400 天，但登入 30 天後就失效，要重新登入。沒有別的 cookie。
				</li>
				<li>
					<b>雲端流程</b>：你放上來的流程，包括裡面隊員的名字、性別、角色，和流程的音樂、成功率紀錄（會寫是誰記的）、誰改了哪一步。
				</li>
				<li>
					<b>分享</b>：流程的擁有者看得到分享對象的 email，其他被分享的人只看得到名字。拿到分享連結的人不用登入，就看得到那支流程裡的名字和音樂（看不到成功率）。
				</li>
				<li>
					<b>存在你裝置上的</b>：這台登入的是誰、雲端流程的離線副本、還沒傳上去的成功率紀錄。登出時清掉（還沒傳的紀錄，登出前會先問你）。
				</li>
				<li>
					<b>App 的備份</b>：App 的草稿和小設定，會跟著你裝置的 iCloud 備份（有開的話）存到你自己的 iCloud，我們看不到。
				</li>
			</ul>
			<p>
				沒有廣告、沒有分析工具、不追蹤你，也不賣資料。畫面用哪個語言只在你的裝置上判斷，不傳到伺服器。我們的伺服器不存你的 IP 位址（下面「交給哪些服務」寫了主機服務商會記的）。
			</p>
		</section>

		<section>
			<h2>不提供的話</h2>
			<p>不給 email 就沒有帳號，不能用雲端流程、分享、記成功率。不用帳號，本機流程照樣能用。</p>
		</section>

		<section>
			<h2>交給哪些服務、在哪裡</h2>
			<p>這個服務用下面幾家公司的服務來跑。Fly.io 跟我們另外簽了資料處理條款；Neon、Cloudflare、Resend 的服務條款附有它們的資料處理條款。</p>
			<div class="table-wrap">
				<table>
					<caption>交給哪些服務</caption>
					<thead><tr><th>服務</th><th>做什麼、拿到什麼</th><th>在哪裡</th></tr></thead>
					<tbody>
						<tr><td>Fly.io</td><td>網站的主機：經過所有連線、伺服器的日誌</td><td>新加坡；日誌的副本和抽樣的連線紀錄（含 IP 位址）在美國</td></tr>
						<tr><td>Neon</td><td>資料庫：上面「有帳號時」寫的全部</td><td>新加坡</td></tr>
						<tr><td>Cloudflare</td><td>R2 存音樂和每天的資料庫備份；把寄到 {SUPPORT} 的信轉給我們</td><td>R2 在亞太地區</td></tr>
						<tr><td>Resend</td><td>寄信：收信人的 email、名字、信的內容</td><td>美國</td></tr>
						<tr><td>Pwned Passwords</td><td>查密碼有沒有外洩：只拿到密碼 SHA-1 雜湊的前 5 碼</td><td>—</td></tr>
						<tr><td>Apple iCloud</td><td>App 的草稿和小設定，在你自己的 iCloud 備份裡</td><td>我們看不到</td></tr>
					</tbody>
				</table>
			</div>
			<p>寫信到 {SUPPORT} 時，信會轉到我們自己的信箱；我們回信時，你會看到回信的地址。</p>
			<p>安全措施：所有連線都走 HTTPS；密碼只存雜湊。</p>
		</section>

		<section>
			<h2>留多久</h2>
			<p>伺服器每天清一次到期的資料，所以下面的時間可能晚 1 天。服務商自己留的，照它們寫的最長時間寫。</p>
			<div class="table-wrap">
				<table>
					<caption>留多久</caption>
					<thead><tr><th>資料</th><th>留多久</th></tr></thead>
					<tbody>
						<tr><td>帳號（email、名字、密碼雜湊）</td><td>到刪除帳號。被停用的帳號留到管理員刪，或你要求刪</td></tr>
						<tr><td>流程、成功率紀錄</td><td>到流程的擁有者刪掉</td></tr>
						<tr><td>誰改了哪一步</td><td>30 天</td></tr>
						<tr><td>流程被擁有者刪掉的紀錄</td><td>30 天</td></tr>
						<tr><td>音樂</td><td>從流程拿掉或流程刪掉後 30 天，服務商可能再晚 1 天</td></tr>
						<tr><td>沒傳完的音樂</td><td>1 天，服務商可能再晚 1 天</td></tr>
						<tr><td>刪掉以後的備份</td><td>最多再留 31 天（我們的備份 30 天，加上 R2 可能晚 1 天；Neon 自己的備份 30 天；Neon 的歷史紀錄 6 小時）</td></tr>
						<tr><td>登入</td><td>瀏覽器裡的 cookie 最多 400 天；伺服器上的登入 30 天後失效，失效後清掉</td></tr>
						<tr><td>設密碼連結</td><td>邀請的 24 小時、忘記密碼的 1 小時後失效，失效後清掉</td></tr>
						<tr><td>猜錯密碼的紀錄</td><td>30 天沒再猜錯就清掉；猜錯太多次、密碼被停掉的，留到重設密碼（沒有帳號的 email 照 30 天清）</td></tr>
						<tr><td>寄出的信</td><td>Resend 留 30 天，不能調短</td></tr>
						<tr><td>伺服器的日誌</td><td>7 天；Fly.io 在美國另存一份副本 30 天</td></tr>
						<tr><td>抽樣的連線紀錄（含 IP 位址）</td><td>Fly.io 在美國最多留 60 天，不能調短</td></tr>
					</tbody>
				</table>
			</div>
		</section>

		<section>
			<h2>你的權利</h2>
			<ul>
				<li>
					<b>查、要一份、更正</b>：名字在帳號頁自己改。其他的（例如要一份你的資料、改 email）寫信到
					<a href="mailto:{SUPPORT}">{SUPPORT}</a>，我們 15 天內回覆；需要更久時會告訴你原因，最多再延 15 天。
				</li>
				<li>
					<b>刪除帳號</b>：在帳號頁按「要求刪除帳號」（App 和網頁版都有）。帳號馬上停用，30 天內刪好；刪掉後備份裡最多再留 31 天。登不進去的話，從帳號用的那個 email 寫信給我們。
				</li>
				<li>
					<b>家長（法定代理人）要刪未成年孩子的帳號</b>：寫信到支援信箱。管理員透過帶隊的教練確認你是家長後，照刪除帳號做：先停用，30 天內刪好。
				</li>
				<li>
					<b>不是使用者的隊員，要拿掉流程裡自己的名字</b>：先找那支流程的擁有者（通常是教練）改。找不到或對方不改，寫信到支援信箱，管理員會轉給擁有者，30 天內回覆你。管理員不會自己改別人的流程。
				</li>
				<li><b>撤回同意</b>：要求刪除帳號。存在你裝置上的資料，刪掉 App 或清掉瀏覽器的網站資料就沒了。</li>
			</ul>
		</section>

		<section>
			<h2>未滿 18 歲</h2>
			<p>
				未滿 18 歲的人要用帳號，要先得到家長或法定代理人同意。App 不問年齡；管理員邀請未成年的隊員本人之前，會先跟教練確認家長同意過。
			</p>
		</section>

		<section>
			<h2>外洩</h2>
			<p>如果個人資料被偷、外洩或被不當取得，我們查明後會用 email 通知受影響的使用者，說明發生了什麼和我們怎麼處理。</p>
		</section>

		<section>
			<h2>改版</h2>
			<p>
				這份政策改了，最上面的「最後更新」日期跟著改。大改（例如多收一種資料、多交給一家服務）時，會另外寄信給所有使用者。
			</p>
		</section>
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
	.updated {
		margin: 0;
		color: var(--ink-3);
		font-size: 13px;
	}
	.doc p,
	.doc ul {
		margin: 0 0 6px;
	}
	.doc ul {
		padding-left: 20px;
		display: grid;
		gap: 6px;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	caption {
		text-align: left;
		font-weight: 600;
		padding-bottom: 4px;
	}
	th,
	td {
		padding: 6px 8px;
		border-bottom: 1px solid var(--line-soft);
		text-align: left;
		vertical-align: top;
	}
	th {
		color: var(--ink-3);
		font-weight: 600;
	}
</style>
