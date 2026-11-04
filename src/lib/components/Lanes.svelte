<script lang="ts">
	// 泳道：一人一條，照名單順序。動作是色條（顏色照大類，每條都寫動作名稱和那個人的任務角色），
	// 沒在動作裡的時間是灰條紋；播放頭那一拍閒著的人名字變灰、標「閒」。
	// 拖色條移動、拉右邊改長度：放開時交給流程核心，被擋就還原。點名字選人，Shift＋點（或開著 multi 時點）多選。
	// 拉短會切到拍點時先不改，交給 onconfirm 問教練；按確定才改，按取消色條就留在原來的長度。
	// 走位條：每走位一次一條細條，貼在泳道下緣，從出發畫到到達。拖左端改出發、拖右端改到達、拖中間一起挪；
	// 被拖的人在選取裡時，選到、同一個間隔有走位的人一起挪一樣多。放開才用 setWalks 改，被擋（有人出界）整組還原。
	// 走太快的走位條標紅、很喘的標橘（見 formationWalks）。
	// 手指（docs/adr/0005-ipad-touch.md）：沒選中的色條、沒選到的人的走位條，一滑是捲畫面；點一下選中了才拖得動。
	// 拍點：色條下半畫給這個人的拍點（cueForMember），一種一條，佔幾拍畫多長；名稱和任務角色移到上半。
	// 有拍點的人泳道變高，放得下他用到的每一種，最下面留給走位條。拍點不吃滑鼠，拖色條照舊。
	// 環節：標了拍的環節在色條最上緣畫一條細條（環節的顏色），那幾拍鋪同色淡底；不吃滑鼠，名稱、拍點畫在上面。
	// 有拍點又有環節的人，名稱和拍點往下讓開細條，泳道多高那麼一點。
	import {
		actionLabel,
		actionSeconds,
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
		toSeconds,
		totalSeconds,
		type CommandResult,
		type ConfirmOption,
		type Cue,
		type CueKind,
		type Flow,
		type FormationWalk,
		type Walk
	} from '#lib/core';
	import { actionColor, CATEGORY_COLORS } from './category-colors';
	import type { PendingConfirm } from './form';
	import { isLongMarker } from './marker';
	import { followPointer, touchOnUnpicked } from './pointer';

	interface Props {
		flow: Flow;
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		/** 時間軸 1 秒幾 px。 */
		pxPerSec: number;
		selectedActionId: string | null;
		onselectaction: (actionId: string) => void;
		/** 拖色條改好的流程。 */
		onchange?: (flow: Flow) => void;
		/** 拖色條被流程核心擋下（已還原），給教練看的原因。 */
		onblocked?: (message: string) => void;
		/** 拉色條會切短或拿掉拍點：給教練看的訊息、清單，按確定就呼叫 confirm。 */
		onconfirm?: (ask: PendingConfirm) => void;
		/** 選到的人。 */
		selectedMemberIds?: string[];
		onselectmembers?: (memberIds: string[]) => void;
		/** 多選開著：點名字跟按著 Shift 一樣（iPad 沒有 Shift）。 */
		multi?: boolean;
	}

	let {
		flow,
		playheadSec,
		pxPerSec,
		selectedActionId,
		onselectaction,
		onchange = () => {},
		onblocked = () => {},
		onconfirm = () => {},
		selectedMemberIds = [],
		onselectmembers = () => {},
		multi = false
	}: Props = $props();

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

	/** 每個人的走位（位置有變的才算）：走到哪一張、出發和到達的秒數、是不是太快、是不是很喘。 */
	const walks = $derived.by(() => {
		const byMember: Record<
			string,
			({ formationId: string } & Pick<FormationWalk, 'departSec' | 'arriveSec' | 'tooFast' | 'tiring'>)[]
		> = {};
		for (const b of flow.formations) {
			for (const { memberId, departSec, arriveSec, tooFast, tiring } of formationWalks(flow, b.id)) {
				(byMember[memberId] ??= []).push({ formationId: b.id, departSec, arriveSec, tooFast, tiring });
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
		const r = run();
		if (r.kind !== 'confirm') return settle(r);
		const { message, items } = r;
		onconfirm({ message, items, confirm: () => settle(run({ confirmed: true })) });
	}

	function settle(r: CommandResult) {
		if (r.kind === 'ok') onchange(r.flow);
		else onblocked(r.message);
	}

	/** 上一次按下走位條的是不是手指：手指點沒選到的人的走位條＝選他。 */
	let walkTouch = false;

	function startWalkDrag(e: PointerEvent, formationId: string, memberId: string) {
		walkTouch = e.pointerType === 'touch';
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
				if (walkDrag && Math.abs(walkDrag.dx) >= DRAG_PX) dropWalk(walkDrag);
				walkDrag = null;
			},
			() => (walkDrag = null)
		);
	}

	function tapWalk(memberId: string) {
		if (walkTouch && !selected.has(memberId)) pick(memberId, false);
	}

	/** 拖的那個人吸到最近一格後挪了幾秒，其他人挪一樣多；一起交給 setWalks，被擋就整組還原。 */
	function dropWalk(d: NonNullable<typeof walkDrag>) {
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
		const r = setWalks(flow, d.formationId, next);
		if (r.kind === 'ok') onchange(r.flow);
		else onblocked(r.message);
	}

	function pick(id: string, shift: boolean) {
		if (!shift && !multi) return onselectmembers([id]);
		onselectmembers(
			selected.has(id) ? selectedMemberIds.filter((x) => x !== id) : [...selectedMemberIds, id]
		);
	}
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
			onclick={(e) => pick(m.id, e.shiftKey)}
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
						onclick={() => onselectaction(p.action.id)}
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
					data-walk={w.formationId}
					style:left={`${w.departSec * pxPerSec + dl}px`}
					style:width={`${Math.max((w.arriveSec - w.departSec) * pxPerSec + dr - dl, 2)}px`}
					title="走位：拖左端改出發、拖右端改到達、拖中間一起挪"
					onpointerdown={(e) => startWalkDrag(e, w.formationId, m.id)}
					onclick={() => tapWalk(m.id)}
				>
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
	.bar > b,
	.role {
		position: relative;
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
	/* 手指：拉長短的把手、走位條和兩端點得到的範圍變大，看起來不變。 */
	@media (pointer: coarse) {
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
	/* 走位條：細條貼在泳道下緣，蓋在色條上面；兩端是把手。 */
	.walk {
		position: absolute;
		bottom: 0;
		height: 5px;
		z-index: 3;
		padding: 0;
		border: none;
		border-radius: 3px;
		background: var(--ink, #16213a);
		opacity: 0.8;
		cursor: grab;
		user-select: none;
	}
	.walk.picked {
		touch-action: none;
	}
	.walk:hover,
	.walk.dragging {
		opacity: 1;
	}
	/* 走太快：紅色；很喘：橘色。跟場地上的線一樣。 */
	.walk.fast {
		background: var(--walk-fast, #e5202e);
		opacity: 0.9;
	}
	.walk.tiring {
		background: var(--walk-tiring, #ff9500);
		opacity: 0.9;
	}
	.walk.dragging {
		cursor: grabbing;
	}
	.end {
		position: absolute;
		top: -2px;
		bottom: -2px;
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
