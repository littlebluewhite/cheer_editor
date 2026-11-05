<script lang="ts" module>
	/** 任務角色的快捷鍵，照名詞對照表的順序；超過的角色沒有快捷鍵。 */
	const ROLE_KEYS = '1234567890qwertyuiop';
	export const roleKey = (i: number) => ROLE_KEYS[i] ?? '';
	/** 選單裡「＋自訂任務角色…」那一項。 */
	const NEW: unique symbol = Symbol('new');
</script>

<script lang="ts">
	// 任務角色選單：不用原生 <select>，因為 Mac 上原生選單打開時按鍵只會移到那一項、還要再按確認。
	// 這裡按快捷鍵就直接選好（選單開著或關著都一樣），Backspace、Delete 是沒有任務。
	// 焦點一直留在按鈕上，選單裡的項目用 aria-activedescendant 指。
	// 選單開在最上層（popover.svelte.ts）：右邊欄裁不到它，下面放不下就往上開。
	import { composing } from '#lib/ime.js';
	import { below, popover } from '#lib/popover.svelte.js';

	interface Props {
		label: string;
		value: string | null;
		/** 角色名稱和一句說明，照名詞對照表的順序。 */
		roles: { name: string; meaning: string }[];
		/** byKey：是按快捷鍵選的（外面可以跳到下一個人）。 */
		onpick: (role: string | null, byKey: boolean) => void;
		/** 選了「＋自訂任務角色…」。 */
		onnew: () => void;
	}

	let { label, value, roles, onpick, onnew }: Props = $props();
	const names = $derived(roles.map((r) => r.name));

	const uid = $props.id();
	let open = $state(false);
	/** 選單開著時，方向鍵指到第幾項（0 = 沒有任務，最後一項 = 自訂）。 */
	let active = $state(0);
	let button = $state<HTMLButtonElement>();

	/** 選單跟按鈕一樣寬，放在按鈕下面；下面放不下就放上面，不超出畫面。 */
	function place(pop: HTMLElement) {
		pop.style.width = `${button!.offsetWidth}px`;
		return below(button!, { gap: 4, align: 'left', flip: true })(pop);
	}

	// 方向鍵選到的項目捲進畫面（選單太長、自己捲的時候）。
	$effect(() => {
		if (open) document.getElementById(`${uid}-${active}`)?.scrollIntoView({ block: 'nearest' });
	});

	/** 選單的項目：沒有任務、每個角色、自訂。 */
	const items = $derived<(string | null | typeof NEW)[]>([null, ...names, NEW]);

	export function focus() {
		button?.focus();
	}

	function toggle() {
		open = !open;
		active = Math.max(0, items.indexOf(value));
	}

	function choose(item: string | null | typeof NEW, byKey = false) {
		open = false;
		if (item === NEW) onnew();
		else onpick(item, byKey);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.ctrlKey || e.metaKey || e.altKey || composing(e)) return;
		const at = ROLE_KEYS.indexOf(e.key.toLowerCase());
		if (at >= 0 && at < names.length) choose(names[at], true);
		else if (e.key === 'Backspace' || e.key === 'Delete') choose(null, true);
		else if (e.key === 'Escape' && open) open = false;
		else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (!open) toggle();
			else active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		} else if ((e.key === 'Enter' || e.key === ' ') && open) choose(items[active]);
		else return;
		// 頁面的快捷鍵（Backspace 刪動作、空白鍵播放、方向鍵）不要再收到。
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<div class="picker" onfocusout={() => (open = false)}>
	<button
		type="button"
		bind:this={button}
		role="combobox"
		aria-label={label}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls="{uid}-list"
		aria-activedescendant={open ? `${uid}-${active}` : undefined}
		onclick={toggle}
		{onkeydown}
	>
		<span class:none={!value}>{value ?? '（沒有任務）'}</span>
	</button>
	{#if open}
		<!-- 按下去不要搶走按鈕的焦點，不然 focusout 先把選單關掉。 -->
		<ul
			role="listbox"
			id="{uid}-list"
			aria-label={label}
			onmousedown={(e) => e.preventDefault()}
			{@attach popover({ place, close: () => (open = false), inside: [button] })}
		>
			{#each items as item, k (k)}
				<!-- 鍵盤操作在上面的 combobox 上（焦點一直在那裡），項目只收滑鼠。 -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{uid}-{k}"
					role="option"
					aria-selected={item === value}
					class:active={k === active}
					onclick={() => choose(item)}
					onmouseenter={() => (active = k)}
				>
					{#if item === NEW}＋自訂任務角色…{:else if item === null}（沒有任務）<kbd>⌫</kbd>{:else}{item}{#if roleKey(k - 1)}<kbd>{roleKey(k - 1)}</kbd>{/if}{#if roles[k - 1].meaning}<span class="meaning">{roles[k - 1].meaning}</span>{/if}{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		min-width: 0;
	}
	/* 長得跟全站的 <select> 一樣（右邊的小箭頭也是）。 */
	button {
		width: 100%;
		display: block;
		font: inherit;
		font-size: 13px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 5px 24px 5px 8px;
		text-align: left;
		cursor: pointer;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2366718a' stroke-width='1.5'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 8px center;
	}
	button:focus {
		outline: none;
		border-color: var(--sel);
		box-shadow: 0 0 0 3px var(--sel-soft);
	}
	button > span {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.none {
		color: var(--muted, #66718a);
	}
	ul {
		/* 開在最上層（popover）：蓋掉瀏覽器給 popover 的置中、框線、顏色；寬度和位置由 place 給 */
		position: fixed;
		inset: auto;
		color: inherit;
		list-style: none;
		margin: 0;
		padding: 4px;
		max-height: min(300px, calc(100vh - 16px));
		overflow-y: auto;
		background: var(--surface, #fff);
		border: 1px solid var(--line, #d8dee9);
		border-radius: 8px;
		box-shadow: var(--shadow-pop);
	}
	li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 2px 8px;
		padding: 5px 8px;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
	}
	li.active {
		background: var(--sel-soft, #dcf4fa);
	}
	/* 名詞對照表的意思：換行寫在名稱下面 */
	.meaning {
		flex-basis: 100%;
		font-size: 11px;
		font-weight: 400;
		line-height: 1.4;
		color: var(--muted, #66718a);
	}
	li[aria-selected='true'] {
		font-weight: 600;
	}
	kbd {
		font-family: inherit;
		font-size: 11px;
		padding: 0 5px;
		border: 1px solid var(--line, #d8dee9);
		border-radius: 4px;
		background: var(--surface-2, #f6f8fb);
		color: var(--muted, #66718a);
	}
</style>
