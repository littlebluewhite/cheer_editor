<script lang="ts">
	// 隊員名單：加隊員、改隊員、排順序、刪隊員。名單順序 = 泳道順序和號碼。規則（40 人上限、必填、名字長度、貼上的行認不認得）都交給流程核心判斷；
	// 已經滿 40 人時加隊員表單停用，寫為什麼。
	// 排順序：每一列「往上」「往下」，拖圓圈（標記）放到別列，或點圓圈打號碼（打 1 就移到第一個）。
	// 刪隊員先在那一列下面顯示流程核心給的「要確認」說明，按確定才刪；他在的組有紀錄時跟在動作裡移人一樣，選保留舊紀錄或清掉重算。改名字被擋下的原因也畫在那一列下面。
	// 改名字而他有紀錄時，核心回「要選」：保留舊紀錄（改錯字）、清掉重算（換人了）、取消（名字還原）。
	import { tick } from 'svelte';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import CharCount from './CharCount.svelte';
	import ConfirmList from './ConfirmList.svelte';
	import Icon from './Icon.svelte';
	import { isLongMarker } from './marker';
	import { reveal } from './reveal';
	import {
		GENDERS,
		GLOBAL_ROLES,
		MAX_MEMBERS,
		addMemberLines,
		deleteMember,
		duplicateNames,
		memberMarkers,
		memberName,
		moveMember,
		updateMember,
		type ConfirmOption,
		type Gender,
		type GlobalRole,
		type MemberChanges
	} from '#lib/core';

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	let names = $state('');
	/** 每一列的名字欄（旁邊的字數要看它）。 */
	const nameInputs = $state<HTMLInputElement[]>([]);
	let gender = $state<Gender | ''>('');
	let globalRole = $state<GlobalRole | ''>('');
	/**
	 * 等教練回答的事和流程核心給的說明：刪隊員（確定刪除），或改了有紀錄的人的名字（保留舊紀錄／清掉重算）。
	 */
	const ask = session.changeAsk({ confirmLabel: '確定刪除' });
	/** 問題是哪一列送的（刪隊員、改名字、排順序）：問題和被擋的原因畫在那一列下面；null 是加隊員表單送的。 */
	let askingId = $state<string | null>(null);
	/** 正在打號碼的那個人（圓圈換成輸入框）。 */
	let numbering = $state<string | null>(null);
	/** 正在拖的那個人。 */
	let dragging = $state<string | null>(null);
	const markers = $derived(memberMarkers(flow));
	const dupes = $derived(duplicateNames(flow.members));
	/** 滿了：加隊員表單停用，寫為什麼（開檔進來超過的也算滿）。 */
	const full = $derived(flow.members.length >= MAX_MEMBERS);

	function add(e: SubmitEvent) {
		e.preventDefault();
		// 性別、全局角色加完不清掉：下一批常常一樣。有幾行沒加進去：輸入框留下那幾行，原因一次列出。
		askingId = null;
		ask.send(() => addMemberLines(flow, names, { gender: gender || null, globalRole: globalRole || null }), {
			done: (r) => {
				names = r.rejected.join('\n');
				ask.error = r.errors.join('\n');
			}
		});
	}

	function edit(id: string, changes: MemberChanges, input?: HTMLInputElement) {
		askingId = id;
		const r = ask.send((o: ConfirmOption = {}) => updateMember(flow, id, changes, o));
		// 被擋下（或要問）時把輸入框還原成原本的名字；選好了核心改的名字會再畫上去。
		if (r.kind !== 'ok' && input) input.value = memberName(flow, id);
	}

	/** 移到名單上第 to 個。按的那顆變灰（移到頭、尾）時，焦點換到同一列的另一顆，不掉到 body。 */
	async function move(id: string, to: number, button?: HTMLButtonElement) {
		askingId = id;
		ask.send(() => moveMember(flow, id, to));
		await tick();
		if (!button) return;
		const target = button.disabled ? button.parentElement?.querySelector<HTMLButtonElement>('.move:not(:disabled)') : button;
		target?.focus();
	}

	/** 打的號碼：移到第幾個（超過人數就排最後）；不是號碼就不動。打完焦點回到他的圓圈。 */
	async function renumber(id: string, text: string) {
		numbering = null;
		const n = Number(text.normalize('NFKC').trim());
		if (!Number.isInteger(n)) return;
		const to = Math.min(Math.max(n, 1), flow.members.length) - 1;
		if (to !== flow.members.findIndex((m) => m.id === id)) await move(id, to);
		await focusCircle(id);
	}

	/** 號碼欄收起來：焦點回到他的圓圈，不掉到整個頁面。這段時間又點開別人的號碼：不搶焦點。 */
	async function focusCircle(id: string) {
		await tick();
		if (numbering === null) document.querySelector<HTMLElement>(`.members .no[data-id="${id}"]`)?.focus();
	}

	/** attachment：出現就把焦點放進來，選起整串（直接打新的號碼）。 */
	function focusSelect(el: HTMLInputElement) {
		el.focus();
		el.select();
	}

	function drop(e: DragEvent, to: number) {
		e.preventDefault();
		if (dragging) move(dragging, to);
		dragging = null;
	}

	/** 刪隊員。刪掉了焦點給補上來的那一列（刪的是最後一個就給上一列）的刪除鈕；取消就回到他的刪除鈕：不掉回 body。 */
	function remove(id: string) {
		askingId = id;
		const at = flow.members.findIndex((m) => m.id === id);
		const focusRemove = async (i: number) => {
			await tick();
			const buttons = document.querySelectorAll<HTMLElement>('.members .remove');
			buttons[Math.min(i, buttons.length - 1)]?.focus();
		};
		ask.send((o: ConfirmOption = {}) => deleteMember(flow, id, o), {
			done: () => focusRemove(at),
			cancel: () => focusRemove(at)
		});
	}
</script>

<section class="members">
	<header>
		<h3>隊員（{flow.members.length} / {MAX_MEMBERS}）</h3>
		<span class="hint">名單順序就是泳道順序和場上的號碼，按 ↑ ↓、拖圓圈，或點圓圈打號碼排順序；在「流程設定」可以把號碼換成開頭字（名字的第一個字）</span>
	</header>

	{#if dupes.length}
		<p class="hint-warn" role="note">
			有同名的隊員：{dupes.map((n) => `「${n}」`).join('、')}。泳道、動作表單上分不出誰是誰，可以加個字分開。
		</p>
	{/if}

	{#if flow.members.length}
		<ol>
			{#each flow.members as m, i (m.id)}
				<li
					class:dragging={dragging === m.id}
					ondragover={(e) => dragging && e.preventDefault()}
					ondrop={(e) => drop(e, i)}
				>
					<!-- 拖曳是滑鼠、手指的捷徑；鍵盤用「往上」「往下」，或按圓圈打號碼。 -->
					{#if numbering === m.id}
						<input
							class="no-input"
							aria-label="第 {i + 1} 位隊員的號碼"
							inputmode="numeric"
							value={i + 1}
							{@attach focusSelect}
							onchange={(e) => renumber(m.id, e.currentTarget.value)}
							onblur={() => (numbering = null)}
							onkeydown={(e) => {
								if (e.key !== 'Escape') return;
								numbering = null;
								void focusCircle(m.id);
							}}
						/>
					{:else}
						<span
							class="no {m.globalRole}"
							class:long={isLongMarker(markers[m.id])}
							role="button"
							tabindex="0"
							aria-label="改第 {i + 1} 位隊員的號碼"
							data-id={m.id}
							draggable="true"
							title="拖曳排順序；按一下打號碼"
							onclick={() => (numbering = m.id)}
							onkeydown={(e) => {
								if (e.key !== 'Enter' && e.key !== ' ') return;
								e.preventDefault();
								numbering = m.id;
							}}
							ondragstart={(e) => {
								dragging = m.id;
								e.dataTransfer?.setData('text/plain', m.name);
							}}
							ondragend={() => (dragging = null)}>{markers[m.id]}</span
						>
					{/if}
					<span class="name-cell">
						<input
							aria-label="第 {i + 1} 位隊員的名字"
							value={m.name}
							bind:this={nameInputs[i]}
							onchange={(e) => edit(m.id, { name: e.currentTarget.value }, e.currentTarget)}
						/>
						<CharCount field="memberName" input={nameInputs[i]} value={m.name} quiet />
					</span>
					<select
						aria-label="第 {i + 1} 位隊員的性別"
						value={m.gender}
						onchange={(e) => edit(m.id, { gender: e.currentTarget.value as Gender })}
					>
						{#each GENDERS as g (g.key)}<option value={g.key}>{g.label}</option>{/each}
					</select>
					<select
						aria-label="第 {i + 1} 位隊員的全局角色"
						value={m.globalRole}
						onchange={(e) => edit(m.id, { globalRole: e.currentTarget.value as GlobalRole })}
					>
						{#each GLOBAL_ROLES as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
					</select>
					<button
						type="button"
						class="ghost icon move"
						aria-label="第 {i + 1} 位隊員往上"
						disabled={i === 0}
						onclick={(e) => move(m.id, i - 1, e.currentTarget)}>↑</button
					>
					<button
						type="button"
						class="ghost icon move"
						aria-label="第 {i + 1} 位隊員往下"
						disabled={i === flow.members.length - 1}
						onclick={(e) => move(m.id, i + 1, e.currentTarget)}>↓</button
					>
					<button
						type="button"
						class="ghost icon remove"
						aria-label="刪除第 {i + 1} 位隊員"
						onclick={() => remove(m.id)}><Icon name="trash" size={14} /></button
					>
					<!-- 名單很長時問句可能在看得到的範圍外，按了像沒反應：出現時捲過去。 -->
					{#if ask.question && askingId === m.id}
						<div class="asking" {@attach reveal(ask.failures)}><ConfirmList {ask} /></div>
					{:else if ask.error && askingId === m.id}
						<p class="error asking" role="alert" {@attach reveal(ask.failures)}>{ask.error}</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}

	<!-- novalidate：必填和人數上限由流程核心判斷 -->
	<!-- 改了加隊員的欄位就告訴 Ask，收掉上次被擋的原因；字還沒送出，⌘Z 交給瀏覽器（data-native-undo） -->
	<form class="add" data-native-undo novalidate onsubmit={add} oninput={() => ask.edited()} onchange={() => ask.edited()}>
		<b class="add-title">加隊員</b>
		{#if full}<p class="full">已經 {flow.members.length} 人了（一支流程最多 {MAX_MEMBERS} 人），刪掉隊員才能再加</p>{/if}
		<label class="names">
			名字（一次加多人：一行一個；從試算表貼「名字、性別、全局角色」三欄也可以）
			<textarea rows="3" bind:value={names} placeholder="名字或暱稱" disabled={full}></textarea>
		</label>
		<div class="pair">
			<label>
				性別
				<select bind:value={gender} disabled={full}>
					<option value="">請選</option>
					{#each GENDERS as g (g.key)}<option value={g.key}>{g.label}</option>{/each}
				</select>
			</label>
			<label>
				全局角色
				<select bind:value={globalRole} disabled={full}>
					<option value="">請選</option>
					{#each GLOBAL_ROLES as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
				</select>
			</label>
		</div>
		<button type="submit" class="primary" disabled={full}>加隊員</button>
	</form>

	<!-- 那一列送的被擋下：原因畫在那一列下面（上面），這裡不畫。 -->
	{#if ask.error && !flow.members.some((m) => m.id === askingId)}
		<p class="error" role="alert" {@attach reveal(ask.failures)}>
			{#each ask.error.split('\n') as line, i (i)}<span>{line}</span>{/each}
		</p>
	{/if}
</section>

<style>
	.members {
		display: grid;
		gap: 12px;
		font-size: 13px;
	}
	header {
		display: grid;
		gap: 2px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
	}
	.hint {
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	li {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr) 54px 64px 22px 22px 26px;
		gap: 4px;
		align-items: center;
	}
	/* 手指：↑ ↓ 刪除是 40px 的按鈕，一行放不下：名字自己一行，性別、全局角色和按鈕排第二行。 */
	@media (pointer: coarse) {
		li {
			grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr) 40px 40px 40px;
		}
		li > .name-cell {
			grid-column: 2 / -1;
		}
		li > select:first-of-type {
			grid-column: 2;
		}
	}
	li.dragging {
		opacity: 0.5;
	}
	.asking {
		grid-column: 1 / -1;
	}
	.no {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		border: 1.5px solid #16213a;
		background: #fff;
		cursor: grab;
	}
	.no-input {
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 6px;
		text-align: center;
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* 多字的標記：橫的膠囊，字不用縮小。 */
	.no.long {
		width: auto;
		padding: 0 5px;
		border-radius: 999px;
		font-size: 10px;
	}
	.no.top {
		background: var(--top, #e0664f);
		color: #fff;
	}
	li input,
	li select {
		width: 100%;
	}
	/* 字數只在改名時出現，疊在名字欄右邊。 */
	.name-cell {
		position: relative;
		display: grid;
	}
	.name-cell input:focus {
		padding-right: 44px;
	}
	.name-cell :global(.char-count) {
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}
	.remove,
	.move {
		color: var(--muted, #66718a);
	}
	.remove:hover {
		color: var(--danger, #c8372d);
	}
	.add {
		display: grid;
		gap: 10px;
		padding: 14px;
		border-radius: 12px;
		background: var(--surface-2, #f6f8fb);
		border: 1px solid var(--line-soft, #e8ecf3);
	}
	.add-title {
		font-size: 13px;
	}
	.full {
		margin: 0;
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.add label {
		display: grid;
		gap: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted, #66718a);
	}
	.add textarea,
	.add select {
		width: 100%;
		font-weight: 400;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.add button {
		width: 100%;
		padding: 7px 12px;
	}
	.error {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
