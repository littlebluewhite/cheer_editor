<script lang="ts">
	// 泳道：一人一條，照名單順序。動作是色條（顏色照大類，每條都寫動作名稱和那個人的任務角色），
	// 沒在動作裡的時間是灰條紋；播放頭那一拍閒著的人名字變灰、標「閒」。
	// 流程和選取從 session 拿。拖色條移動、拉右邊改長度：放開時送到 session 的 ask（場上那一個問題），被擋就還原。
	// 點名字選人，Shift＋點（或開著多選時點）多選。
	// 拉短會切到拍點時先不改，ask 問教練；按確定才改，按取消色條就留在原來的長度。
	// 走位條：每走位一次一條細條，貼在泳道下緣，從出發畫到到達。拖左端改出發、拖右端改到達、拖中間一起挪；
	// 被拖的人在選取裡時，選到、同一個間隔有走位的人一起挪一樣多。放開才用 setWalks 改，被擋（有人出界）整組還原。
	// 拖的時候走位條上面即時寫新的拍數，拖出範圍（放開會被擋）當下變色。點一下（滑鼠、手指）選這個人，Shift＋點加進來。
	// 走位條看起來是細條，能點的範圍比較高（WALK_HIT_H）。
	// 走太快的走位條標紅、很喘的標橘（見 formationWalks）；撞位那段疊一段紫色（見 clashes），拖的時候先藏起來。
	// 手指（docs/adr/0005-ipad-touch.md）：沒選中的色條、沒選到的人的走位條，一滑是捲畫面；點一下選中了才拖得動。
	// 拍點：色條下半畫給這個人的拍點（cueForMember），一種一條，佔幾拍畫多長；名稱和任務角色移到上半。
	// 有拍點的人泳道變高，放得下他用到的每一種，最下面留給走位條。拍點不吃滑鼠，拖色條照舊。
	// 環節：標了拍的環節在色條最上緣畫一條細條（環節的顏色），那幾拍鋪同色淡底；不吃滑鼠，名稱、拍點畫在上面。
	// 有拍點又有環節的人，名稱和拍點往下讓開細條，泳道多高那麼一點。
	import {
		actionLabel,
		actionSeconds,
		clashes,
		CUE_KINDS,
		cueForMember,
		formationWalks,
		idleAt,
		memberMarkers,
		memberWalk,
		moveAction,
		nearestPosition,
		phaseColor,
		phaseLabel,
		resizeAction,
		setWalks,
		timeText,
		toSeconds,
		totalSeconds,
		type ConfirmOption,
		type Cue,
		type CueKind,
		type Flow,
		type FormationWalk,
		type Walk
	} from '#lib/core';
	import { actionColor, CATEGORY_COLORS } from './category-colors';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { getEditor } from '#lib/editor.svelte.js';
	import { isLongMarker } from './marker';
	import { followPointer, touchOnUnpicked } from './pointer';

	interface Props {
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		/** 時間軸 1 秒幾 px。 */
		pxPerSec: number;
	}

	let { playheadSec, pxPerSec }: Props = $props();

	const session = getEditorSession();
	const editor = getEditor();
	// 時間軸只在有流程時畫。
	const flow = $derived(session.flow!);
	const selectedActionId = $derived(session.selectedActionId);
	const selectedMemberIds = $derived(session.selectedMemberIds);

	/** 移動不到這麼多 px 算點一下，不改動作。 */
	const DRAG_PX = 3;

	/** 正在拖的色條：move = 整條移動，resize = 拉右邊；dx 是滑鼠移了幾 px。 */
	let drag = $state<{ id: string; mode: 'move' | 'resize'; x0: number; dx: number } | null>(null);

	const width = $derived(totalSeconds(flow) * pxPerSec);
	const idle = $derived(new Set(idleAt(flow, playheadSec)));
	const markers = $derived(memberMarkers(flow));
	/** 每個動作的位置（px），一個動作算一次，泳道共用。 */
	const placed = $derived(
		flow.actions.map((action) => {
			const { startSec, endSec } = actionSeconds(flow, action);
			return {
				action,
				label: actionLabel(action),
				/** 色條上的字：顏色已經是大類，只寫名稱；沒取名才寫大類。 */
				name: action.name || actionLabel(action),
				left: startSec * pxPerSec,
				width: (endSec - startSec) * pxPerSec,
				/** 一個半拍幾 px（拍點用；只有音樂段有拍點）。 */
				halfPx: ((endSec - startSec) * pxPerSec) / action.length
			};
		})
	);
	const selected = $derived(new Set(selectedMemberIds));

	/** 色條離泳道上緣、名稱那一行、一條拍點的高度、泳道下緣留給走位條（px）。 */
	const BAR_TOP = 3;
	const NAME_H = 12;
	const TRACK_H = 10;
	const WALK_H = 5;
	/** 走位條能點的高度（px）：比看到的細條高，往下多出 WALK_HIT_DROP 伸進泳道之間的空隙。 */
	const WALK_HIT_H = 12;
	const WALK_HIT_DROP = 3;
	/** 撞位那段最少畫這麼寬（px）：只撞到一個取樣點時也看得到。 */
	const CLASH_MIN_W = 4;
	/** 環節細條的高度（px）。 */
	const PHASE_H = 3;

	/** 每個動作標了拍的環節：名字、顏色、從動作開始第幾個半拍、幾個半拍長。 */
	const phaseBars = $derived(
		Object.fromEntries(
			flow.actions.map((a) => [
				a.id,
				(a.successRate?.phases ?? []).flatMap((p) =>
					p.beats ? [{ id: p.id, label: phaseLabel(p), color: phaseColor(p), ...p.beats }] : []
				)
			])
		)
	);

	/** 有拍點、也在有環節細條的動作裡的人：名稱和拍點往下讓開細條（px）。 */
	const lift = $derived(
		Object.fromEntries(
			flow.members.map((m) => [
				m.id,
				cues[m.id].kinds.length &&
				flow.actions.some((a) => phaseBars[a.id].length && a.members.some((x) => x.memberId === m.id))
					? PHASE_H
					: 0
			])
		)
	);

	/** 每個人：每個動作裡給他的拍點，和他用到哪幾種（照拍子、步驟、手位排，一種一條）。 */
	const cues = $derived.by(() => {
		const byMember: Record<string, { mine: Record<string, Cue[]>; kinds: CueKind[] }> = {};
		for (const m of flow.members) {
			const mine: Record<string, Cue[]> = {};
			for (const a of flow.actions) {
				const given = (a.cues ?? []).filter((c) => cueForMember(c, a, m.id));
				if (given.length) mine[a.id] = given;
			}
			const used = new Set(Object.values(mine).flatMap((cs) => cs.map((c) => c.kind)));
			byMember[m.id] = { mine, kinds: CUE_KINDS.filter((k) => used.has(k)) };
		}
		return byMember;
	});

	/** 走位條拖哪裡：depart = 左端、arrive = 右端、move = 中間。 */
	type WalkEnd = 'depart' | 'arrive' | 'move';
	/** 正在拖的走位條：formationId 是走到的那一張（B），ids 是一起挪的人。 */
	let walkDrag = $state<{
		formationId: string;
		memberId: string;
		ids: string[];
		mode: WalkEnd;
		x0: number;
		dx: number;
	} | null>(null);

	/** 每個人的走位（位置有變的才算）：走到哪一張、出發和到達的秒數、是不是太快、是不是很喘、撞位的那幾段。 */
	const walks = $derived.by(() => {
		const byMember: Record<
			string,
			({ formationId: string; clashes: { startSec: number; endSec: number }[] } & Pick<
				FormationWalk,
				'departSec' | 'arriveSec' | 'tooFast' | 'tiring'
			>)[]
		> = {};
		for (const b of flow.formations) {
			for (const { memberId, departSec, arriveSec, tooFast, tiring } of formationWalks(flow, b.id)) {
				(byMember[memberId] ??= []).push({ formationId: b.id, departSec, arriveSec, tooFast, tiring, clashes: [] });
			}
		}
		for (const c of clashes(flow)) {
			for (const id of c.memberIds) {
				byMember[id]?.find((w) => w.formationId === c.formationId)?.clashes.push(c);
			}
		}
		return byMember;
	});

	function startDrag(e: PointerEvent, id: string) {
		if (e.button !== 0 || touchOnUnpicked(e, id === selectedActionId)) return;
		const mode = (e.target as Element).closest('[data-resize]') ? 'resize' : 'move';
		drag = { id, mode, x0: e.clientX, dx: 0 };
		followPointer(
			e,
			(ev) => {
				if (drag) drag.dx = ev.clientX - drag.x0;
			},
			() => {
				if (drag) drop(drag.id, drag.mode, drag.dx);
				drag = null;
			},
			() => (drag = null)
		);
	}

	function drop(id: string, mode: 'move' | 'resize', dx: number) {
		const action = flow.actions.find((a) => a.id === id);
		if (!action || Math.abs(dx) < DRAG_PX) return;
		const { startSec, endSec } = actionSeconds(flow, action);
		const dSec = dx / pxPerSec;
		const run = (options?: ConfirmOption) =>
			mode === 'move'
				? moveAction(flow, id, startSec + dSec, options)
				: resizeAction(flow, id, endSec + dSec, options);
		// 放開時色條已經彈回原位，還原不用再做什麼。
		session.ask.send(run, { revert: () => {} });
	}

	/** 上一次按下走位條後真的拖了：放開後瀏覽器接著送的 click 不算點一下。 */
	let walkMoved = false;

	function startWalkDrag(e: PointerEvent, formationId: string, memberId: string) {
		walkMoved = false;
		if (e.button !== 0 || touchOnUnpicked(e, selected.has(memberId))) return;
		const end = (e.target as Element).closest<HTMLElement>('[data-end]')?.dataset.end;
		const mode: WalkEnd = end === 'depart' || end === 'arrive' ? end : 'move';
		const ids = selected.has(memberId)
			? selectedMemberIds.filter((id) => walks[id]?.some((w) => w.formationId === formationId))
			: [memberId];
		walkDrag = { formationId, memberId, ids, mode, x0: e.clientX, dx: 0 };
		followPointer(
			e,
			(ev) => {
				if (walkDrag) walkDrag.dx = ev.clientX - walkDrag.x0;
			},
			() => {
				if (walkDrag && Math.abs(walkDrag.dx) >= DRAG_PX) {
					walkMoved = true;
					dropWalk(walkDrag);
				}
				walkDrag = null;
			},
			() => (walkDrag = null)
		);
	}

	/** 點一下走位條：選這個人（已經選到就不動，選到的一組才拖得動）；Shift＋點加進來或拿掉。 */
	function tapWalk(e: MouseEvent, memberId: string) {
		if (walkMoved) return;
		if (e.shiftKey || !selected.has(memberId)) session.pickMember(memberId, e.shiftKey);
	}

	/** 拖的那個人吸到最近一格後挪了幾秒，其他人挪一樣多：每個人新的出發和到達。 */
	function draggedWalks(d: NonNullable<typeof walkDrag>): Record<string, Walk> {
		const seconds = (id: string) => {
			const w = memberWalk(flow, d.formationId, id)!;
			return { depart: toSeconds(flow, w.depart), arrive: toSeconds(flow, w.arrive) };
		};
		const own = seconds(d.memberId);
		const from = d.mode === 'arrive' ? own.arrive : own.depart;
		const shift = toSeconds(flow, nearestPosition(flow, from + d.dx / pxPerSec)) - from;
		const next: Record<string, Walk> = {};
		for (const id of d.ids) {
			const { depart, arrive } = seconds(id);
			next[id] = {
				depart: nearestPosition(flow, d.mode === 'arrive' ? depart : depart + shift),
				arrive: nearestPosition(flow, d.mode === 'depart' ? arrive : arrive + shift)
			};
		}
		return next;
	}

	/** 放開：一起交給 setWalks，被擋就整組還原。 */
	function dropWalk(d: NonNullable<typeof walkDrag>) {
		const next = draggedWalks(d);
		session.ask.send(() => setWalks(flow, d.formationId, next), { revert: () => {} });
	}

	/** 拖的時候被拖的那個人新的拍數（這張站位那一段只寫段內時間），out = 放開會被擋。 */
	const walkReadout = $derived.by(() => {
		const d = walkDrag;
		if (!d || d.dx === 0) return null;
		const next = draggedWalks(d);
		const own = next[d.memberId];
		const home = flow.formations.find((f) => f.id === d.formationId)!.segmentId!;
		const t = (p: Walk['depart']) => timeText(flow, home, p);
		const text =
			d.mode === 'depart'
				? `出發 ${t(own.depart)}`
				: d.mode === 'arrive'
					? `到達 ${t(own.arrive)}`
					: `${t(own.depart)} 到 ${t(own.arrive)}`;
		return { text, out: setWalks(flow, d.formationId, next).kind !== 'ok' };
	});
</script>

{#each flow.members as m, i (m.id)}
	{@const kinds = cues[m.id].kinds}
	<div
		class="row"
		data-lane={m.id}
		style:height={kinds.length
			? `${BAR_TOP + lift[m.id] + NAME_H + kinds.length * TRACK_H + WALK_H}px`
			: undefined}
	>
		<button
			type="button"
			class="lab"
			class:idle={idle.has(m.id)}
			class:selected={selected.has(m.id)}
			aria-pressed={selected.has(m.id)}
			title="點一下選這個人；多選開著或 Shift＋點，可以選好幾個"
			onclick={(e) => session.pickMember(m.id, e.shiftKey)}
		>
			<b
				class="no gr {m.globalRole}"
				class:long={isLongMarker(markers[m.id])}
				title={m.globalRole === 'top' ? '上層' : '底層'}>{markers[m.id]}</b
			>
			<span class="name">{m.name}</span>
			{#if idle.has(m.id)}<span class="idle-tag">閒</span>{/if}
		</button>
		<div class="trk" style:width={`${width}px`}>
			{#each placed as p (p.action.id)}
				{@const member = p.action.members.find((x) => x.memberId === m.id)}
				{#if member}
					{@const d = drag?.id === p.action.id ? drag : null}
					{@const mine = cues[m.id].mine[p.action.id] ?? []}
					<button
						type="button"
						class="bar"
						class:selected={p.action.id === selectedActionId}
						data-action-id={p.action.id}
						class:dragging={d !== null}
						class:has-cues={mine.length > 0}
						class:has-phases={phaseBars[p.action.id].length > 0}
						class:tinted={!!p.action.color}
						style:left={`${p.left + (d?.mode === 'move' ? d.dx : 0)}px`}
						style:width={`${Math.max(p.width + (d?.mode === 'resize' ? d.dx : 0), 2)}px`}
						style:background={actionColor(p.action)}
						style:box-shadow={p.action.color ? `inset 4px 0 0 ${CATEGORY_COLORS[p.action.category]}` : undefined}
						title="{p.label}{member.role ? `（${member.role}）` : ''}"
						onclick={() => editor.pickAction(p.action.id)}
						onpointerdown={(e) => startDrag(e, p.action.id)}
					>
						{#each phaseBars[p.action.id] as ph (ph.id)}
							<span
								class="phase-tint"
								data-phase-tint
								aria-hidden="true"
								style:left={`${ph.at * p.halfPx}px`}
								style:width={`${ph.len * p.halfPx}px`}
								style:background={ph.color}
							></span>
							<span
								class="phase"
								data-phase={ph.label}
								aria-hidden="true"
								style:left={`${ph.at * p.halfPx}px`}
								style:width={`${ph.len * p.halfPx}px`}
								style:top="0px"
								style:height={`${PHASE_H}px`}
								style:background={ph.color}
							></span>
						{/each}
						<b>{p.name}</b>
						{#if member.role}<span class="role">{member.role}</span>{/if}
						{#each mine as c, j (j)}
							<!-- 最後一拍的手位右邊對齊那一拍的結尾、往左撐開，字才不會被色條右邊切掉；跟色條多寬無關，拉右邊時也不會跑 -->
							{@const atEnd = c.kind === 'motion' && c.at + c.len >= p.action.length}
							<span
								class="cue {c.kind} {c.kind === 'count' ? c.word : ''}"
								data-cue={c.kind}
								aria-hidden="true"
								style:left={`${(atEnd ? c.at + c.len : c.at) * p.halfPx}px`}
								style:transform={atEnd ? 'translateX(-100%)' : undefined}
								style:width={c.kind === 'motion' ? undefined : `${c.len * p.halfPx}px`}
								style:min-width={c.kind === 'motion' ? `${c.len * p.halfPx}px` : undefined}
								style:top={`${lift[m.id] + NAME_H + kinds.indexOf(c.kind) * TRACK_H}px`}
								style:height={`${TRACK_H - 1}px`}>{c.word}</span
							>
						{/each}
						<span class="rz" data-resize title="拉這裡改長度"></span>
					</button>
				{/if}
			{/each}
			{#each walks[m.id] ?? [] as w (w.formationId)}
				{@const d =
					walkDrag?.formationId === w.formationId && walkDrag.ids.includes(m.id) ? walkDrag : null}
				{@const dl = d && d.mode !== 'arrive' ? d.dx : 0}
				{@const dr = d && d.mode !== 'depart' ? d.dx : 0}
				<button
					type="button"
					class="walk"
					class:picked={selected.has(m.id)}
					class:dragging={d !== null}
					class:fast={w.tooFast}
					class:tiring={w.tiring}
					class:out={d?.memberId === m.id && walkReadout?.out}
					data-walk={w.formationId}
					style:left={`${w.departSec * pxPerSec + dl}px`}
					style:width={`${Math.max((w.arriveSec - w.departSec) * pxPerSec + dr - dl, 2)}px`}
					style:height={`${WALK_HIT_H}px`}
					style:bottom={`${-WALK_HIT_DROP}px`}
					title="走位：點一下選這個人；拖左端改出發、拖右端改到達、拖中間一起挪"
					onpointerdown={(e) => startWalkDrag(e, w.formationId, m.id)}
					onclick={(e) => tapWalk(e, m.id)}
				>
					<span
						class="strip"
						data-walk-strip
						style:height={`${WALK_H}px`}
						style:bottom={`${WALK_HIT_DROP}px`}
					></span>
					{#if !d}
						{#each w.clashes as c, i (i)}
							<span
								class="clash"
								data-walk-clash
								title="撞位"
								style:left={`${(c.startSec - w.departSec) * pxPerSec}px`}
								style:width={`${Math.max((c.endSec - c.startSec) * pxPerSec, CLASH_MIN_W)}px`}
								style:height={`${WALK_H}px`}
								style:bottom={`${WALK_HIT_DROP}px`}
							></span>
						{/each}
					{/if}
					{#if d?.memberId === m.id && walkReadout}
						<span class="readout" class:out={walkReadout.out} data-walk-readout>{walkReadout.text}</span>
					{/if}
					<span class="end l" data-end="depart"></span>
					<span class="end r" data-end="arrive"></span>
				</button>
			{/each}
		</div>
	</div>
{/each}

<style>
	.row {
		display: flex;
		height: 26px;
		border-bottom: 1px solid var(--line-soft, #e8ecf3);
	}
	.row:hover .trk {
		background-color: rgba(47, 102, 184, 0.03);
	}
	/* 名字欄疊在播放頭（z 5）上面，橫向捲動時播放頭從名字底下過去。 */
	.lab {
		position: sticky;
		left: 0;
		z-index: 6;
		width: var(--lab-w, 120px);
		flex: none;
		justify-content: flex-start;
		gap: 8px;
		background: var(--surface-2, #f6f8fb);
		border: none;
		border-right: 1px solid var(--line, #d8dee9);
		border-radius: 0;
		padding: 0 8px 0 10px;
		font-size: 12px;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
	}
	.lab:hover {
		background: #eef2f8;
	}
	.lab.selected {
		background: var(--sel-soft, #dcf4fa);
		box-shadow: inset 3px 0 0 var(--sel, #19b4d8);
	}
	/* 標記圓圈：顏色照全局角色，跟場上的點一樣。 */
	.no.long {
		font-size: 7px;
		letter-spacing: -0.3px;
	}
	.no {
		flex: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		display: inline-grid;
		place-items: center;
		font-size: 10px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		border: 1.5px solid #16213a;
	}
	.gr.base {
		background: #fff;
		color: #16213a;
	}
	.gr.top {
		background: var(--top, #e0664f);
		color: #fff;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}
	.lab.idle .name {
		color: #9aa3b5;
	}
	.idle-tag {
		margin-left: auto;
		flex: none;
		padding: 0 5px;
		border-radius: 4px;
		background: var(--line-soft, #e8ecf3);
		color: var(--muted, #66718a);
		font-size: 11px;
	}
	/* 灰條紋 = 沒在動作裡（站著或走位）；色條蓋在上面。 */
	.trk {
		position: relative;
		flex: none;
		height: 100%;
		background-image: repeating-linear-gradient(
			135deg,
			transparent 0 5px,
			rgba(102, 113, 138, 0.07) 5px 6px
		);
	}
	.bar {
		position: absolute;
		top: 3px;
		bottom: 3px;
		justify-content: flex-start;
		gap: 6px;
		border: none;
		border-radius: 5px;
		color: #fff;
		font-size: 11px;
		line-height: 1;
		padding: 0 6px;
		text-align: left;
		overflow: hidden;
		white-space: nowrap;
		cursor: grab;
		user-select: none;
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14);
	}
	/* 選中的才不讓手指捲畫面（手指拖得動）；沒選中的手指一滑是捲動。 */
	.bar.selected {
		touch-action: none;
	}
	.bar:hover {
		filter: brightness(1.06);
	}
	/* 有辨識色：左邊 4px 是大類的顏色，字往右讓一點。 */
	.bar.tinted {
		padding-left: 9px;
	}
	.role {
		opacity: 0.9;
	}
	/* 有拍點：名稱和任務角色擠到上半那一行，拍點畫在下面。 */
	.bar.has-cues {
		align-items: flex-start;
		padding-top: 1px;
		font-size: 10px;
	}
	/* 環節：最上緣的細條和那幾拍的淡底，不吃滑鼠，按下去還是按在色條上。名稱、任務角色疊在淡底上面。 */
	.phase,
	.phase-tint {
		position: absolute;
		pointer-events: none;
	}
	.phase-tint {
		top: 0;
		bottom: 0;
		opacity: 0.28;
	}
	.phase {
		box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.8);
	}
	/* 字放不下用「…」（完整的字在 title）：先縮任務角色，再縮名稱。 */
	.bar > b,
	.role {
		position: relative;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar > b {
		flex: none;
		max-width: 100%;
	}
	.role {
		flex: 0 100 auto;
	}
	.bar.has-cues.has-phases {
		padding-top: 4px;
	}
	/* 拍點：不吃滑鼠，按下去還是按在色條上。down 藍、up 綠實心；步驟淡橘、左邊粗線；手位粉紅小字（跟拍點表單同色）。 */
	.cue {
		position: absolute;
		display: flex;
		align-items: center;
		box-sizing: border-box;
		padding: 0 2px;
		border-radius: 2px;
		font-size: 9px;
		font-weight: 700;
		line-height: 1;
		overflow: hidden;
		white-space: nowrap;
		pointer-events: none;
	}
	.cue.down,
	.cue.up {
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7);
		color: #fff;
	}
	.cue.down {
		background: var(--cue-down);
	}
	.cue.up {
		background: var(--cue-up);
	}
	.cue.step {
		background: var(--cue-step-bg);
		border-left: 3px solid var(--cue-step-line);
		color: var(--cue-step-ink);
	}
	/* 手位只佔一拍，字常比一拍長：寬度跟著字撐開；最後一拍的往左撐。 */
	.cue.motion {
		background: var(--cue-motion-bg);
		color: var(--cue-motion-ink);
		font-weight: 600;
	}
	.bar.dragging {
		cursor: grabbing;
		z-index: 2;
		box-shadow: 0 4px 10px rgba(22, 33, 58, 0.3);
	}
	/* 色條右邊的把手：拉它改長度。 */
	.rz {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 6px;
		cursor: ew-resize;
	}
	.bar:hover .rz {
		background: rgba(255, 255, 255, 0.35);
	}
	/* 手指：泳道（名字）至少 32px 高；拉長短的把手、走位條和兩端點得到的範圍變大，看起來不變。 */
	@media (pointer: coarse) {
		.row {
			min-height: 32px;
		}
		.rz {
			width: min(16px, 40%);
		}
		.walk::before {
			content: '';
			position: absolute;
			inset: -5px 0 -4px;
		}
		.end {
			top: -5px;
			bottom: -4px;
			width: min(16px, 40%);
		}
	}
	/* 走位條：按鈕本身透明、比較高（好點），裡面的細條（.strip）貼在泳道下緣，蓋在色條上面；兩端是把手。 */
	.walk {
		position: absolute;
		z-index: 3;
		padding: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		cursor: grab;
		user-select: none;
		--walk-color: var(--ink, #16213a);
	}
	.walk:hover {
		background: transparent;
	}
	.strip {
		position: absolute;
		left: 0;
		right: 0;
		border-radius: 3px;
		background: var(--walk-color);
		opacity: 0.8;
		pointer-events: none;
	}
	/* 拖的時候的拍數：浮在走位條上面。拖出範圍（放開會被擋）變紅底。 */
	.readout {
		position: absolute;
		bottom: calc(100% + 2px);
		left: 50%;
		transform: translateX(-50%);
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--ink, #16213a);
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		line-height: 14px;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
	.readout.out {
		background: var(--danger, #c8372d);
	}
	.walk.picked {
		touch-action: none;
	}
	.walk:hover .strip,
	.walk.dragging .strip {
		opacity: 1;
	}
	/* 走太快：紅色；很喘：橘色。跟場地上的線一樣。 */
	.walk.fast {
		--walk-color: var(--walk-fast, #e5202e);
	}
	.walk.tiring {
		--walk-color: var(--walk-tiring, #ff9500);
	}
	.walk.fast .strip,
	.walk.tiring .strip {
		opacity: 0.9;
	}
	/* 撞位：走位條上撞到的那段疊紫色，跟紅、橘分得開。 */
	.clash {
		position: absolute;
		border-radius: 3px;
		background: var(--walk-clash, #a855f7);
		pointer-events: none;
	}
	/* 拖出範圍：細條變成虛線的危險色，放開會還原。 */
	.walk.out .strip {
		background: repeating-linear-gradient(90deg, var(--danger, #c8372d) 0 4px, transparent 4px 6px);
		opacity: 1;
	}
	.walk.dragging {
		cursor: grabbing;
	}
	.end {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: ew-resize;
	}
	.end.l {
		left: 0;
	}
	.end.r {
		right: 0;
	}
	.bar.selected {
		outline: 2px solid var(--ink, #16213a);
		outline-offset: 1px;
		z-index: 1;
	}
</style>
