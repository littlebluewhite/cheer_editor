<script module lang="ts">
	import { unsentCount, type OfflineStore, type UnsentRecords } from '#lib/offline-store.js';

	/** 這台還有沒傳的紀錄的那幾支流程（登出前看；讀不到當作沒有）。 */
	export async function unsentFlows(store: OfflineStore): Promise<UnsentRecords[]> {
		return (await store.unsent().catch(() => [])).filter((u) => unsentCount(u) > 0);
	}
</script>

<script lang="ts">
	// 登出時這台還有沒傳的成功率紀錄（#260、#191 的 A）：小框列每支流程幾筆，「先不要登出」（預設）、「丟掉，登出」。
	// 首頁的帳號選單、我的帳號頁按登出時跳。
	import Modal from './Modal.svelte';

	interface Props {
		flows: UnsentRecords[];
		onstay: () => void;
		/** 丟掉這台沒傳的，登出。 */
		ondiscard: () => void;
	}
	let { flows, onstay, ondiscard }: Props = $props();
	const total = $derived(flows.reduce((n, u) => n + unsentCount(u), 0));
	const title = $derived(`還有 ${total} 筆成功率紀錄沒傳`);
</script>

<Modal label={title} class="dialog unsent-logout" onclose={onstay}>
	{#snippet children()}
		<div class="box">
			<h2>{title}</h2>
			<p>登出就丟掉，別人看不到。先連上網路，等它傳完再登出。</p>
			<ul>
				{#each flows as u (u.flowId)}
					<li><span>{u.flowName}</span><b>{unsentCount(u)} 筆</b></li>
				{/each}
			</ul>
			<div class="buttons">
				<button type="button" class="danger" onclick={ondiscard}>丟掉，登出</button>
				<button type="button" class="primary" data-autofocus onclick={onstay}>先不要登出</button>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	:global(.unsent-logout) {
		width: min(400px, 100%);
		border-radius: 10px;
		box-shadow: var(--shadow-pop);
	}
	.box {
		display: grid;
		gap: 10px;
		padding: 18px;
	}
	h2 {
		margin: 0;
		font-size: 17px;
	}
	p {
		margin: 0;
		color: var(--muted);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 4px;
	}
	li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	li span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
