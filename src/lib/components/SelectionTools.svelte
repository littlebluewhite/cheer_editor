<script lang="ts" module>
	/** 工具列佔場地上緣多高（px，含上面的空隙）：場上的提示往下排這麼多，不蓋到工具列（見 Field 的 --tools-h）。 */
	export const TOOLS_H_PX = 40;
</script>

<script lang="ts">
	// 選人工具列和右鍵選單：選到人時固定浮在場地正上方（不佔位置，場地不跳）；右鍵選單是同一份清單（selectionActions）。
	// 按一項：選到的人照那一項算新位置，走 moveGroup（跟拖人同一條路）：這一拍沒有站位就插一張、往後帶、算一步復原，
	// 提示和播放頭也跟拖人一樣（session.moved）。播放中就先暫停在整拍（跟開始拖人一樣）。
	// 沒選人時工具列收起來；在場上空白處按右鍵，選單上是套用全隊的項目（跟第 [_] 張一樣）。
	import { currentFormation, formationAt, moveGroup } from '#lib/core';
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
	const count = $derived(session.selectedMemberIds.length);
	const actions = $derived(selectionActions(count));

	/** 播放頭在哪張站位（在站位上、還是在它後面）和選到誰：換了，框裡打的數字就不算了。 */
	const where = $derived.by(() => {
		const { number } = currentFormation(session.flow!, playback.sec);
		const on = !!formationAt(session.flow!, playback.sec);
		return { number, on, key: `${number}${on ? '' : '+'}|${session.selectedMemberIds.join()}` };
	});
	/** 「第幾張站位」框打的數字（打的時候在哪）；沒打過或換過地方，就是播放頭前面那一張（以前的「跟上一張一樣」）。 */
	let typed = $state<{ n: number; key: string } | null>(null);
	const nth = $derived(typed?.key === where.key ? typed.n : Math.max(1, where.on ? where.number - 1 : where.number));
	/** 沒選人時名字前面加「全隊」。 */
	const team = $derived(count ? '' : '全隊');
	/** 按鈕的名字：[_] 換成框裡的數字。 */
	const nameOf = (a: SelectionAction) => team + a.label.replace('[_]', String(nth));

	/** 畫出來的一項：一個動作自己一顆鈕；同一組（group）的收成一顆「組名 ▾」，點了才看到裡面幾項。 */
	interface Item {
		label: string;
		title: string;
		/** 收成一組時是組名；一個動作自己一顆鈕時沒有。 */
		group?: string;
		actions: SelectionAction[];
	}
	const items = $derived(
		actions.reduce<Item[]>((list, a) => {
			if (!a.group) return [...list, { label: a.label, title: a.title, actions: [a] }];
			const at = list.find((i) => i.group === a.group);
			if (at) {
				at.actions.push(a);
				at.title = at.actions.map((x) => x.label).join('或');
				return list;
			}
			return [...list, { label: `${a.group} ▾`, title: a.label, group: a.group, actions: [a] }];
		}, [])
	);

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
		const ids = count ? session.selectedMemberIds : flow.members.map((m) => m.id);
		const n = nth;
		if (a.nth && !flow.formations[n - 1]) return void (session.notice = `沒有站位 ${n}`);
		session.ask.send(() => moveGroup(flow, sec, ids, (pos) => a.place(flow, pos, zoom, n)), {
			done: (r) => session.moved(r)
		});
	}

	/** 選單放在按右鍵的地方，不超出畫面。 */
	const at = (p: { x: number; y: number }) => (pop: HTMLElement) => ({
		top: Math.max(8, Math.min(p.y, innerHeight - 8 - pop.offsetHeight)),
		left: Math.max(8, Math.min(p.x, innerWidth - 8 - pop.offsetWidth))
	});
</script>

<!-- 跟第 [_] 張一樣：[_] 是數字框，後半段是按鈕（按 Enter 也算按） -->
{#snippet item(a: SelectionAction, role: 'menuitem' | undefined)}
	{#if a.nth}
		{@const [before, after] = a.label.split('[_]')}
		<span class="nth">
			{team}{before.trim()}
			<input
				type="number"
				min="1"
				max={session.flow!.formations.length}
				aria-label="跟第幾張站位一樣"
				value={nth}
				oninput={(e) => {
					const n = e.currentTarget.valueAsNumber;
					typed = n ? { n, key: where.key } : null;
				}}
				onkeydown={(e) => e.key === 'Enter' && run(a)}
			/>
			<button type="button" {role} title={a.title} aria-label={nameOf(a)} onclick={() => run(a)}>{after.trim()}</button>
		</span>
	{:else}
		<button type="button" {role} title={a.title} onclick={() => run(a)}>{a.label}</button>
	{/if}
{/snippet}

{#if count && actions.length}
	<div class="tools-bar" role="toolbar" aria-label="選人工具列">
		{#each items as i (i.label)}
			{#if i.group}
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
				{@render item(i.actions[0], undefined)}
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
			aria-label={group.group}
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
			{#if i.group}
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
				{@render item(i.actions[0], 'menuitem')}
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
	/* 跟第 [_] 張一樣：字、數字框、按鈕排一行 */
	.nth {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-left: 8px;
		white-space: nowrap;
	}
	.nth input {
		width: 3.5em;
		text-align: center;
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
