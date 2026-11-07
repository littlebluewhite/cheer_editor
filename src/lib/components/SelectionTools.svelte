<script lang="ts" module>
	/** 工具列佔場地上緣多高（px，含上面的空隙）：場上的提示往下排這麼多，不蓋到工具列（見 Field 的 --tools-h）。 */
	export const TOOLS_H_PX = 40;
</script>

<script lang="ts">
	// 選人工具列和右鍵選單：選到人時固定浮在場地正上方（不佔位置，場地不跳）；右鍵選單是同一份清單（selectionActions）。
	// 按一項：選到的人照那一項算新位置，走 moveGroup（跟拖人同一條路）：這一拍沒有站位就插一張、往後帶、算一步復原，
	// 提示和播放頭也跟拖人一樣（session.moved）。播放中就先暫停在整拍（跟開始拖人一樣）。
	import { moveGroup } from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { below, menuKeys, popover } from '#lib/popover.svelte.js';
	import { selectionActions, type SelectionAction } from '#lib/selection-actions.js';

	let {
		zoom,
		menu,
		onclosemenu
	}: {
		/** 場地放大倍數：新位置照它吸附（跟拖人一樣）。 */
		zoom: number;
		/** 右鍵選單開在哪（畫面座標）；null = 沒開。 */
		menu: { x: number; y: number } | null;
		onclosemenu: () => void;
	} = $props();

	const session = getEditorSession();
	const { playback } = getEditor();
	const actions = $derived(selectionActions(session.selectedMemberIds.length));

	/** 畫出來的一項：一個動作自己一顆鈕；同一組（group）的收成一顆「組名 ▾」，點了才看到裡面幾項。 */
	interface Item {
		label: string;
		title: string;
		actions: SelectionAction[];
	}
	const items = $derived(
		actions.reduce<Item[]>((list, a) => {
			if (!a.group) return [...list, { label: a.label, title: a.title, actions: [a] }];
			const label = `${a.group} ▾`;
			const at = list.find((i) => i.label === label);
			if (at) {
				at.actions.push(a);
				at.title = at.actions.map((x) => x.label).join('或');
				return list;
			}
			return [...list, { label, title: a.label, actions: [a] }];
		}, [])
	);
	const isGroup = (i: Item) => i.label.endsWith(' ▾');

	/** 工具列上打開的那一組（▾ 小選單）和它的鈕。 */
	let openGroup = $state<{ label: string; button: HTMLElement } | null>(null);
	let open = $state<{ menu: typeof menu; label: string } | null>(null);
	/** 右鍵選單裡展開的那一組（換一次右鍵選單就收回去）。 */
	const expanded = $derived(open && open.menu === menu ? open.label : null);

	function run(a: SelectionAction) {
		onclosemenu();
		openGroup = null;
		playback.pauseOnBeat();
		const flow = session.flow!;
		const sec = playback.sec;
		const ids = session.selectedMemberIds;
		session.ask.send(() => moveGroup(flow, sec, ids, (pos) => a.place(flow, pos, zoom)), {
			done: (r) => session.moved(r)
		});
	}

	/** 選單放在按右鍵的地方，不超出畫面。 */
	const at = (p: { x: number; y: number }) => (pop: HTMLElement) => ({
		top: Math.max(8, Math.min(p.y, innerHeight - 8 - pop.offsetHeight)),
		left: Math.max(8, Math.min(p.x, innerWidth - 8 - pop.offsetWidth))
	});
</script>

{#if actions.length}
	<div class="tools-bar" role="toolbar" aria-label="選人工具列">
		{#each items as i (i.label)}
			{#if isGroup(i)}
				<button
					type="button"
					title={i.title}
					aria-haspopup="menu"
					aria-expanded={openGroup?.label === i.label}
					onclick={(e) =>
						(openGroup = openGroup?.label === i.label ? null : { label: i.label, button: e.currentTarget })}
				>
					{i.label}
				</button>
			{:else}
				<button type="button" title={i.title} onclick={() => run(i.actions[0])}>{i.label}</button>
			{/if}
		{/each}
	</div>
{/if}

{#if openGroup}
	{@const group = items.find((i) => i.label === openGroup?.label)}
	{#if group}
		<!-- 工具列上「組名 ▾」的小選單：點外面、按 Esc 就收 -->
		<div
			class="menu"
			role="menu"
			aria-label={group.label.replace(' ▾', '')}
			{@attach popover({
				place: below(openGroup.button, { gap: 4, align: 'left', flip: true }),
				close: () => (openGroup = null),
				inside: [openGroup.button]
			})}
			{@attach menuKeys}
		>
			{#each group.actions as a (a.label)}
				<button type="button" role="menuitem" title={a.title} onclick={() => run(a)}>{a.label}</button>
			{/each}
		</div>
	{/if}
{/if}

{#if menu && actions.length}
	<!-- 右鍵選單：點外面、按 Esc 就收（popover.svelte.ts） -->
	<div
		class="menu"
		role="menu"
		aria-label="選人選單"
		{@attach popover({ place: at(menu), close: onclosemenu })}
		{@attach menuKeys}
	>
		{#each items as i (i.label)}
			{#if isGroup(i)}
				<button
					type="button"
					role="menuitem"
					title={i.title}
					aria-expanded={expanded === i.label}
					onclick={() => (open = expanded === i.label ? null : { menu, label: i.label })}
				>
					{i.label}
				</button>
				{#if expanded === i.label}
					{#each i.actions as a (a.label)}
						<button type="button" role="menuitem" class="sub" title={a.title} onclick={() => run(a)}>{a.label}</button>
					{/each}
				{/if}
			{:else}
				<button type="button" role="menuitem" title={i.title} onclick={() => run(i.actions[0])}>{i.label}</button>
			{/if}
		{/each}
	</div>
{/if}

<style>
	/* 固定浮在場地正上方的中間：出現、收起都不推動場地。 */
	.tools-bar {
		position: absolute;
		top: 4px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 11;
		display: flex;
		gap: 4px;
		height: 36px;
		box-sizing: border-box;
		padding: 3px;
		border-radius: 10px;
		background: var(--surface, #fff);
		border: 1px solid var(--line, #d8dee9);
		box-shadow: var(--shadow-pop);
	}
	.tools-bar button {
		border: none;
		padding: 0 12px;
	}
	.menu {
		/* 開在最上層（popover）：蓋掉瀏覽器給 popover 的置中、框線、顏色 */
		position: fixed;
		inset: auto;
		margin: 0;
		color: inherit;
		z-index: 30;
		display: grid;
		gap: 2px;
		min-width: 130px;
		background: var(--surface, #fff);
		border: 1px solid var(--line, #d8dee9);
		border-radius: 10px;
		padding: 4px;
		box-shadow: var(--shadow-pop);
	}
	.menu button {
		justify-content: flex-start;
		border: none;
		padding: 6px 10px;
	}
	.menu button.sub {
		padding-left: 22px;
	}
</style>
