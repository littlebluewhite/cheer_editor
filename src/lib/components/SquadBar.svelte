<script lang="ts">
	// 分組浮動列：選到有環節、要分組的動作時，在場地下面（「正面／裁判」那一排）出現。只在編排畫面。
	// 有選人：按號碼放進那一組、「＋」放進新的一組、「✕」拿出組；選的人一次改好，是一個復原步驟。
	// 沒選人：按號碼把那一組的人全選起來。「n 人沒分組」把沒分組的人選起來。
	// 電腦上選好人按數字鍵 1–9、0 也一樣（頁面收鍵盤，呼叫 press）。
	import { setSquad, squadColor, squadsOf, type Action, type CommandResult, type ConfirmOption, type Flow } from '#lib/core';
	import ConfirmList from './ConfirmList.svelte';

	interface Props {
		flow: Flow;
		action: Action;
		/** 選到的人（可能有不在這個動作裡的人）。 */
		selected: string[];
		onchange: (flow: Flow) => void;
		onselectmembers: (ids: string[]) => void;
	}

	let { flow, action, selected, onchange, onselectmembers }: Props = $props();

	/** 現在有的組，1 到 n 不跳號（核心會補號）。 */
	const groups = $derived(squadsOf(action));
	const next = $derived(groups.length + 1);
	const picked = $derived(selected.filter((id) => action.members.some((m) => m.memberId === id)));
	const outside = $derived(selected.length - picked.length);
	const loose = $derived(action.members.filter((m) => m.squad === undefined).map((m) => m.memberId));
	const outsideText = $derived(outside ? `另外 ${outside} 人不在這個動作，不算` : '');

	/** 換組會動到紀錄時，等教練回答（保留舊紀錄／清掉重算，或確定）。 */
	let pending = $state<{
		message: string;
		items: string[];
		choose: boolean;
		send: (o: ConfirmOption) => CommandResult;
	} | null>(null);
	let error = $state('');

	// 換動作時，沒回答的問題和原因收掉。
	$effect(() => {
		void action.id;
		pending = null;
		error = '';
	});

	/** 把選的人放進第 n 組（null = 拿出組）。 */
	function assign(squad: number | null) {
		if (!picked.length) return;
		const ids = picked;
		const id = action.id;
		const send = (o: ConfirmOption = {}) => setSquad(flow, id, ids, squad, o);
		settle(send(), send);
	}

	function settle(r: CommandResult, send: (o: ConfirmOption) => CommandResult) {
		pending = null;
		error = '';
		if (r.kind === 'ok') return onchange(r.flow);
		if (r.kind === 'blocked') return void (error = r.message);
		pending = { message: r.message, items: r.items, choose: r.kind === 'choose', send };
	}

	/** 號碼：有選人是放進那一組；沒選人是把那一組的人選起來。 */
	function number(n: number) {
		if (picked.length) assign(n);
		else onselectmembers(action.members.filter((m) => m.squad === n).map((m) => m.memberId));
	}

	/** 數字鍵：1–9 放進那一組（最多到新的一組），0 拿出組。沒選人不算。回傳有沒有用掉這個鍵。 */
	export function press(n: number): boolean {
		if (!picked.length || n > next) return false;
		assign(n === 0 ? null : n);
		return true;
	}
</script>

<div class="squad-bar" role="group" aria-label="分組">
	{#if pending}
		<div class="ask">
			<ConfirmList
				message={pending.message}
				items={pending.items}
				confirmLabel={pending.choose ? '清掉重算' : '確定'}
				onconfirm={() => pending && settle(pending.send(pending.choose ? { records: 'clear' } : { confirmed: true }), pending.send)}
				onkeep={pending.choose ? () => pending && settle(pending.send({ records: 'keep' }), pending.send) : undefined}
				oncancel={() => (pending = null)}
			/>
		</div>
	{/if}
	<span class="who">
		{#if picked.length}選了 {picked.length} 人{#if outside}（{outsideText}）{/if}
		{:else if outside}{outsideText}；按號碼選起那一組
		{:else}在場上選人；按號碼選起那一組{/if}
	</span>
	{#each groups as n (n)}
		<button
			type="button"
			class="num"
			style:--c={squadColor(n)}
			aria-label={picked.length ? `放進第 ${n} 組` : `選起第 ${n} 組`}
			onclick={() => number(n)}>{n}</button
		>
	{/each}
	<button type="button" class="num new" aria-label="放進新的一組" disabled={!picked.length} onclick={() => assign(next)}
		>＋</button
	>
	<button type="button" class="num out" aria-label="拿出組" disabled={!picked.length} onclick={() => assign(null)}>✕</button>
	{#if loose.length}
		<button type="button" class="link" onclick={() => onselectmembers(loose)}>{loose.length} 人沒分組</button>
	{/if}
	{#if error}<span class="error" role="alert">{error}</span>{/if}
</div>

<style>
	.squad-bar {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		background: var(--surface, #fff);
		border: 1px solid var(--line);
		border-radius: 999px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
		font-size: 13px;
	}
	/* 問紀錄的確認框浮在浮動列上面。 */
	.ask {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		width: min(420px, 90vw);
		z-index: 5;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
		border-radius: 10px;
	}
	.who {
		margin-right: 4px;
	}
	.num {
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 50%;
		border: 0;
		background: var(--c);
		color: #fff;
		font-weight: 700;
		font-size: 14px;
	}
	.num.new {
		background: #fff;
		color: #111;
		border: 2px dashed #9ca3af;
	}
	.num.out {
		background: #e5e7eb;
		color: #374151;
	}
	.num:disabled {
		opacity: 0.35;
	}
	.link {
		border: 0;
		background: none;
		text-decoration: underline;
		padding: 0 4px;
	}
	.error {
		color: var(--danger, #c8372d);
	}
	/* 觸控螢幕按鈕變大（docs/adr/0005-ipad-touch.md）。 */
	@media (pointer: coarse) {
		.num {
			width: 40px;
			height: 40px;
			font-size: 16px;
		}
		.link {
			min-height: 40px;
		}
	}
</style>
