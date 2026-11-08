<script lang="ts">
	import {
		currentFormation,
		clashes,
		formationWalks,
		memberMarkers,
		positionText,
		positionsAt,
		readJump,
		raisedAt,
		squadBadge,
		timeRuleWarnings,
		stackedMembers,
		totalSeconds,
		clockText,
		walkSpanAt,
		type Flow,
		type Clash,
		type FormationWalk,
		type Position
	} from '#lib/core';
	import { browserAdapters, Editor, setEditor } from '#lib/editor.svelte.js';
	import { draftTime, type RecentFlow } from '#lib/flow-file.svelte.js';
	import { both, KEYS } from '#lib/shortcuts.js';
	import { flushSync, onMount, type ComponentProps } from 'svelte';
	import { resolve } from '$app/paths';
	import { loadFlowSetting, MAX_LATENCY_MS, saveFlowSetting } from '#lib/local-settings.js';
	import { SPEEDS } from '#lib/playback.svelte.js';
	import { dodgeKeepVisible } from '#lib/toast-dodge.js';
	import { below, popover } from '#lib/popover.svelte.js';
	import { autoInspectorWidth, clampInspectorWidth, INSPECTOR_MIN_PX, isTouchScreen, NARROW_SCREEN, viewOnlyReason } from '#lib/editor-layout.js';
	import { Divider } from '#lib/divider.svelte.js';
	import { setUnsavedCheck } from '#lib/unsaved.js';
	import { localDate } from '#lib/local-date.js';
	import { composing } from '#lib/ime.js';
	import { isTextEntry, ownsKey } from '#lib/key-owner.js';
	import ActionDetail from '#lib/components/ActionDetail.svelte';
	import ActionForm from '#lib/components/ActionForm.svelte';
	import ConfirmList from '#lib/components/ConfirmList.svelte';
	import type CueGrid from '#lib/components/CueGrid.svelte';
	import CueOverlay from '#lib/components/CueOverlay.svelte';
	import RuleSummary from '#lib/components/RuleSummary.svelte';
	import Field, { fullView } from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
	import FormationEditor from '#lib/components/FormationEditor.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Modal, { modalOpen } from '#lib/components/Modal.svelte';
	import MemberPanel from '#lib/components/MemberPanel.svelte';
	import MemberPicker from '#lib/components/MemberPicker.svelte';
	import NewFlowForm from '#lib/components/NewFlowForm.svelte';
	import NoticeToast from '#lib/components/NoticeToast.svelte';
	import NowEightCount from '#lib/components/NowEightCount.svelte';
	import Practice from '#lib/components/Practice.svelte';
	import PrintSheet from '#lib/components/PrintSheet.svelte';
	import SegmentSettings from '#lib/components/SegmentSettings.svelte';
	import SquadBar from '#lib/components/SquadBar.svelte';
	import Timeline from '#lib/components/Timeline.svelte';
	import WalkForm from '#lib/components/WalkForm.svelte';
	import { revealAlert } from '#lib/components/reveal.js';

	interface Props {
		/**
		 * 編輯器 module（編輯頁的狀態和碰瀏覽器的 adapter）；測試放一個帶好流程、adapter 都是假的進來
		 * （#lib/test-fakes.js 的 editorPage），再讀它的 session。沒給就用真的 adapter 自己建。
		 */
		editor?: Editor;
		// 螢幕座標換算（ADR 0002）：預設用瀏覽器算；jsdom 不算版面，測試換成假的。往下傳給場地、拍點格子、段設定的波形。
		/** 場地：指標位置換成場地公尺。 */
		toMeters?: ComponentProps<typeof Field>['toMeters'];
		/** 拍點格子：指標位置對到的格子。 */
		cellAt?: ComponentProps<typeof CueGrid>['cellAt'];
		/** 段設定的波形：滑鼠位置換成音樂檔的秒數。 */
		waveXToSec?: ComponentProps<typeof SegmentSettings>['waveXToSec'];
	}

	let { editor: given, toMeters, cellAt, waveXToSec }: Props = $props();
	// 編輯器 module 一開始給了就不換：放進 context 的就是這一個。
	// svelte-ignore state_referenced_locally
	const editor = given ?? new Editor(browserAdapters());
	setEditor(editor);
	const { session, playback } = editor;
	// ⌘Z 前後送出沒送出的字：用編輯器 module 收著的 adapter。
	const { pendingInput } = editor.adapters;

	/** 使用說明開在新分頁：編輯畫面留著，還沒存的修改不會因為看說明而不見。 */
	const guideHref = `${resolve('/guide')}?from=editor`;

	const flow = $derived(session.flow);
	/** 上方列的「未存」：有沒存的改動，或欄位裡打了字還沒送出（打字時就出現）。 */
	const unsaved = $derived(editor.hasUnsavedWork);
	// 新版 service worker 要自動重新載入前先看這個（src/hooks.client.ts）。
	setUnsavedCheck(() => editor.hasUnsavedWork);
	/**
	 * 有還沒存的修改、欄位裡打了字還沒送出時關分頁、重新整理：讓瀏覽器先問
	 * （草稿要停手 1 秒才存，最後的修改可能還沒進草稿）。
	 */
	function onbeforeunload(e: BeforeUnloadEvent) {
		if (editor.hasUnsavedWork) e.preventDefault();
	}
	// 草稿：頁面打開了才讀、才開分頁頻道，關掉時停。
	onMount(() => editor.file.connect());

	let openSegmentId = $state<string | null>(null);
	let settingsOpen = $state(false);
	/** 點規則警告打開流程設定時，焦點要放的那一格（關掉時收掉）。 */
	let settingsFocus = $state<ComponentProps<typeof FlowSettings>['focus']>();
	/** 八拍表列印畫面開著：印的時候只印它，不印編輯畫面。 */
	let printOpen = $state(false);
	/** 觸控螢幕（iPad）：沒有 Shift、Esc，場地左邊才放「多選」「取消選取」（docs/adr/0005-ipad-touch.md）。 */
	const touchScreen = isTouchScreen();

	// ---------- 窄螢幕（手機、直拿的 iPad）：一律檢視模式，編排換成手機的檢視畫面（docs/adr/0005-ipad-touch.md） ----------
	const narrowQuery = typeof matchMedia === 'function' ? matchMedia(NARROW_SCREEN) : null;
	let narrow = $state(narrowQuery?.matches ?? false);
	onMount(() => {
		if (!narrowQuery?.addEventListener) return;
		const changed = () => (narrow = narrowQuery.matches);
		narrowQuery.addEventListener('change', changed);
		return () => narrowQuery.removeEventListener('change', changed);
	});
	// 變窄就是檢視模式；變寬（iPad 轉成橫的）回到編輯
	$effect(() => {
		session.viewing = narrow;
	});
	/** 「我」：手機檢視畫面標亮的人。這台裝置照流程記住（local-settings），不進流程檔；換流程時讀那支的。 */
	let me = $state(session.flow ? loadFlowSetting('me', session.flow.name) : '');
	/** 「我」還在名單裡才算（教練刪了那個人就沒有）。 */
	const myId = $derived(flow?.members.some((m) => m.id === me) ? me : '');
	function pickMe(id: string) {
		me = id;
		if (flow) saveFlowSetting('me', flow.name, id);
	}
	/** 選到的動作有環節、要分組（騰翻、跳躍以外）：場上出現組號小圓和分組浮動列。 */
	const groupingAction = $derived(session.groupingAction);
	/** 組號小圓：動作的人寫組號、塗組色；沒分組是灰色「?」。 */
	const squadBadges = $derived(
		Object.fromEntries((groupingAction?.members ?? []).map((m) => [m.memberId, squadBadge(groupingAction!, m)]))
	);
	/** 主畫面：編排（場地、右邊欄、時間軸）或練習（記成功率）。練習時編排的東西藏起來（不拆掉，場地、時間軸的縮放還在）。 */
	let view = $state<'edit' | 'practice'>('edit');
	/** 練習記在哪一天：預設今天，可以改（練完補打）；切換編排、練習時留著，不存進流程檔。 */
	let practiceDate = $state(localDate());
	/** 第幾份打開的流程（開檔、新建、救回草稿各算一次）；編排區和練習畫面照這個重開。 */
	let opened = $state(0);
	/** 首頁按了「丟掉」的那支最近的流程：先問。 */
	let discarding = $state.raw<RecentFlow | null>(null);
	/** 丟掉以後的回饋：「已丟掉」，或另一個分頁正在編、沒丟掉。 */
	let discardNote = $state('');
	/**
	 * 最近的流程裡同名的另一支：有的話「丟掉」和它的確認框也寫最後改的時間，分得出是哪一支。
	 * 時間照最後改的時間寫；同名的又在同一分鐘改，就寫到秒。
	 */
	function recentEdited(f: RecentFlow): { text: string; twin: boolean } {
		if (!f.savedAt) return { text: '', twin: false };
		const twins = editor.file.recent.filter((g) => g !== f && g.name === f.name);
		const sameMinute = twins.some((g) => g.savedAt && draftTime(g.savedAt) === draftTime(f.savedAt!));
		return { text: `最後改 ${draftTime(f.savedAt, sameMinute)}`, twin: twins.length > 0 };
	}

	/** 切到編排或練習。練習時不放音樂，先停下來。 */
	function setView(next: 'edit' | 'practice') {
		if (next === 'practice') playback.pause();
		// 全上表改過格子：先問（session.practiceLeave），丟掉才切
		if (next === 'edit' && view === 'practice') session.leavePracticePage(() => (view = next));
		else view = next;
	}

	/** 整個流程的撞位；只跟著流程重算，播放頭動不用重算。場地和泳道共用這一份。 */
	const allClashes = $derived(flow ? clashes(flow) : []);

	/**
	 * 場上的影子、走位線和撞位：播放頭在站位 B 上（不是開頭那張）畫上一張的影子和這段的走位線、撞位；
	 * 在兩張站位中間只畫這段的走位線和撞位；開頭那張、最後一張之後都不畫。
	 */
	const trail = $derived.by(() => {
		const none = { ghosts: {} as Record<string, Position>, walks: [] as FormationWalk[], clashes: [] as Clash[] };
		if (!flow) return none;
		const span = walkSpanAt(flow, playback.sec);
		if (!span) return none;
		return {
			ghosts: span.on ? span.from.pos : none.ghosts,
			walks: formationWalks(flow, span.to.id),
			clashes: allClashes.filter((c) => c.formationId === span.to.id)
		};
	});

	/** 播放頭的位置拆成段名和段內位置，上方列分開排大小字；在結尾只有「結尾」（at 是空的）。 */
	const position = $derived.by(() => {
		const text = flow ? positionText(flow, playback.sec) : '';
		if (!text) return null;
		const cut = text.indexOf(' ', text.indexOf(' ') + 1);
		return cut === -1 ? { segment: text, at: '' } : { segment: text.slice(0, cut), at: text.slice(cut + 1) };
	});

	/**
	 * 延遲校正欄位送出（離開欄位或按 Enter）：清空、不是數字就回到現在的值；超出 ±MAX_LATENCY_MS 就夾到邊上，提示範圍。
	 */
	function applyLatency(input: HTMLInputElement) {
		const ms = input.valueAsNumber;
		const used = Number.isNaN(ms) ? playback.latencyMs : Math.min(Math.max(ms, -MAX_LATENCY_MS), MAX_LATENCY_MS);
		playback.setLatency(used);
		input.value = String(used);
		if (!Number.isNaN(ms) && used !== ms) session.notice = `延遲校正要在 -${MAX_LATENCY_MS} 到 ${MAX_LATENCY_MS} 毫秒之間，改成 ${used}`;
	}

	/** 播放列的「⋯」小窗（延遲校正）：平常收著，不佔播放列的位置。 */
	let moreOpen = $state(false);
	let moreBtn = $state<HTMLButtonElement>();

	/** 點外面、按 Esc 就關；按 Esc 的話焦點回到「⋯」。 */
	function closeMore(by: 'outside' | 'escape') {
		moreOpen = false;
		if (by === 'escape') moreBtn?.focus();
	}

	/** 手機點時間打「3-1」跳過去：jumpText 是 null 時收著；jumpError 是看不懂的原因（#228）。 */
	let jumpText = $state<string | null>(null);
	let jumpError = $state('');

	function closeJump() {
		jumpText = null;
		jumpError = '';
	}

	/** Enter 跳過去、收起來；看不懂就說為什麼，欄位留著改。Esc 收起來不跳。 */
	function jumpKey(e: KeyboardEvent) {
		if (composing(e)) return;
		if (e.key === 'Escape') return closeJump();
		if (e.key !== 'Enter' || !flow) return;
		e.preventDefault();
		const read = readJump(flow, playback.sec, jumpText ?? '');
		if (read.kind !== 'ok') {
			jumpError = read.message;
			return;
		}
		playback.seek(read.value);
		closeJump();
	}

	// ---------- 場地和時間軸的分界：拖它（或 ↑↓）改時間軸多高，存在這台電腦；雙擊回到預設 ----------
	const TIMELINE_MIN_PX = 160;
	/** 場地那一塊（含分界）至少留這麼高：時間軸拖到最高，場地也不會只剩一小條。 */
	const FIELD_MIN_PX = 340;
	let topbar = $state<HTMLElement>();
	/** 時間軸上面至少要留多高：上方列（一行或兩行，跟著視窗寬換）加上場地那一塊。 */
	function fieldKeepPx(): number {
		void windowW; // 視窗寬變了，上方列可能換成一行或兩行：重算
		return (topbar?.offsetHeight ?? 0) + FIELD_MIN_PX;
	}
	let timelineHost = $state<HTMLElement>();
	const timelineDivider = new Divider({
		name: 'timelineHeightPx',
		axis: 'y',
		clamp: (px) => Math.round(Math.min(Math.max(px, TIMELINE_MIN_PX), window.innerHeight - fieldKeepPx())),
		size: currentTimelineH
	});

	/** 時間軸現在多高：拖過就是拖的高度，沒拖過量畫面（量不到用預設的 30vh）。 */
	function currentTimelineH(): number {
		if (timelineDivider.px !== null) return timelineDivider.px;
		return Math.round(timelineHost?.getBoundingClientRect().height || Math.max(200, window.innerHeight * 0.3));
	}

	// ---------- 場地和右邊欄的分界：沒拖過時自動分（場地吃得到的寬度給場地，剩下給右邊欄）；
	// 拖它（或 ←→）自己定寬度，照視窗寬的比例存在這台電腦；雙擊回到自動 ----------
	let windowW = $state(0);
	let windowH = $state(0);
	/** 手機的檢視畫面為什麼不能編（寫在「檢視模式・只能看」後面）。 */
	const whyViewOnly = $derived(viewOnlyReason(windowW, windowH, touchScreen));
	/** 上方列一行放不下、播放區換到第二行（跟樣式的 max-width: 1670px 一樣）。 */
	const transportBelow = $derived(windowW <= 1670);
	let fieldHostH = $state(0);
	const inspectorDivider = new Divider({
		name: 'inspectorWidthRatio',
		axis: 'x',
		clamp: (px) => clampInspectorWidth(px, window.innerWidth),
		size: (): number => inspectorPx,
		relativeTo: () => windowW || window.innerWidth
	});

	const fieldAspect = $derived.by(() => {
		if (!flow) return 1;
		const v = fullView(flow.field);
		return v.width / v.height;
	});
	/** 右邊欄現在多寬。 */
	const inspectorPx = $derived(
		inspectorDivider.px === null
			? autoInspectorWidth(windowW, fieldHostH, fieldAspect)
			: clampInspectorWidth(inspectorDivider.px, windowW)
	);

	/** 量場地那一欄多高（視窗或時間軸變了就重量）。jsdom 沒有 ResizeObserver，測試裡就不量。 */
	function watchFieldHostH(el: HTMLElement) {
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => (fieldHostH = el.clientHeight));
		ro.observe(el);
		return () => ro.disconnect();
	}


	// 換成另一支流程（新建、開檔、救回草稿）：編排區和練習畫面重開（opened 的 {#key}）、對話框都關掉。
	// 換上流程由編輯器 module 的流程檔做；選取、提示、session.view 由 session 清掉，播放停下、回到開頭由播放做（session.open 叫它）。
	editor.file.onswitch = () => {
		opened++;
		me = session.flow ? loadFlowSetting('me', session.flow.name) : '';
		openSegmentId = null;
		settingsOpen = false;
		printOpen = false;
		// 一律回到「編排・編輯」，不沿用上一支的練習分頁、檢視模式（窄螢幕照樣只能看）
		view = 'edit';
		session.viewing = narrow;
	};

	function undo() {
		if (session.undo()) restore(session.flow!);
	}

	function redo() {
		if (session.redo()) restore(session.flow!);
	}

	/** 復原、重做按鈕的提示：下一步會退（做回）什麼、快捷鍵，和方向鍵連按移人只算一步。 */
	function stepTitle(verb: '復原' | '重做', label: string, keys: string) {
		const what = label ? `${verb}：${label}` : verb;
		return `${what}（${keys}）\n方向鍵連按移人合成一步，${verb}一次就整段${verb === '復原' ? '退回' : '做回'}`;
	}

	/** 復原、重做換上的流程：開著的段設定可能指到已經不在的段（選取、提示、播放頭由 session、播放處理）。 */
	function restore(f: Flow) {
		if (openSegmentId && !f.segments.some((s) => s.id === openSegmentId)) {
			playback.stopPreview();
			openSegmentId = null;
		}
	}

	/** 開檔：選檔欄位（Safari、iPad、Firefox）。 */
	function open(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void editor.file.open(file);
	}

	/** 開檔：有還沒存的修改先問，答應了才選檔。Chrome、Edge 不跳選檔欄位，改用選檔視窗。 */
	function pickOpen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const pick = editor.file.canPick;
		// 答應了再按一次選檔欄位：這次照常跳選檔（按「不存了，繼續」還算教練按的，瀏覽器肯開）
		const choose = pick ? () => void editor.file.pick() : () => input.click();
		if (!editor.file.mayChoose(choose)) e.preventDefault();
		else if (pick) {
			e.preventDefault();
			choose();
		}
	}

	/** 段設定、流程設定、八拍表、「還沒存」的問題蓋在上面：底下的編輯畫面點不到、Tab 不到，快捷鍵也不動它。 */
	const overlayOpen = $derived(!!openSegmentId || settingsOpen || printOpen || editor.file.asking || !!editor.file.draftAsk);
	/** 有東西蓋在上面（上面那些，或表單裡打開的名詞對照表這種對話框）：快捷鍵不動底下的編輯畫面。 */
	const covered = () => overlayOpen || modalOpen();

	/** 下一個操作（按下滑鼠、手指、鍵盤）就收掉提示泡泡；按在泡泡上（「復原」、✕）不算。先收，操作自己的提示才放得上去。 */
	function dismissNotice(e: Event) {
		if (session.notice && !(e.target as Element | null)?.closest?.('.toast')) session.notice = '';
	}

	// 焦點所在的東西自己用不用這個鍵（打字的地方、選單、對話框裡的按鈕…）只看 #lib/key-owner.js 一份規則（G 群）。
	// 空白鍵：它不用（按鈕、勾選框、節拍器、重複、檢視、段按鈕…）就一律播放／暫停（Enter 照樣按下）。
	/** 按下的空白鍵拿去播放／暫停了：放開時也攔下來。 */
	let spaceUsed = false;

	/** 復原、重做：焦點在輸入框裡時，先把打了還沒送出的字送出去，再退回流程，欄位照退回的流程重畫。 */
	function undoKey(redoing: boolean) {
		pendingInput.flush();
		flushSync();
		if (redoing) redo();
		else undo();
		flushSync();
		pendingInput.settle();
	}

	function onkeydown(e: KeyboardEvent) {
		// Ctrl+S（Mac ⌘S）在輸入框裡也要能存，所以放在最前面；也擋掉瀏覽器的「另存網頁」。
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			void editor.file.save();
			return;
		}
		if (!flow) return;
		// 練習時只留存檔：空白鍵留給記號按鈕，Delete 不能刪到藏起來的動作、站位；
		// 復原、重做只退編排的修改，在練習畫面看不到退了什麼，還可能弄掉紀錄
		if (view === 'practice') return;
		const target = e.target as Element | null;
		const key = e.key.toLowerCase();
		// 復原、重做：輸入框裡、對話框開著時也是退回流程，不讓瀏覽器自己復原（畫面和資料才不會對不上）。
		// 還沒送出的表單（新動作、加隊員）的輸入框除外：字不在流程裡，交給瀏覽器退字。
		// 「還沒存」的問題開著時不退：問的是現在這支流程，退了再按「先存檔」會存到退回的版本
		if ((e.ctrlKey || e.metaKey) && (key === 'z' || (key === 'y' && e.ctrlKey))) {
			// 還沒送出的表單（標了 data-native-undo）裡打字的地方：⌘Z 交給瀏覽器退字
			if (isTextEntry(target) && target?.closest('[data-native-undo]')) return;
			e.preventDefault();
			if (!editor.file.asking) undoKey(!(key === 'z' && !e.shiftKey));
			return;
		}
		// 空白鍵：焦點在打字的地方、選單、對話框裡時照一般網頁；其他時候（包括按鈕上）播放／暫停
		if (e.key === ' ') {
			// 元件自己用了空白鍵（例：隊員號碼的圓圈）就不播放
			if (e.repeat || e.defaultPrevented) return;
			// 對話框開著時只能暫停（播放自己管，頁面告訴它對話框有沒有開）
			spaceUsed = !ownsKey(target, ' ') && playback.space(covered());
			if (spaceUsed) e.preventDefault();
			return;
		}
		// 對話框、八拍表蓋在上面時，其他快捷鍵不動到底下的編輯畫面
		if (covered()) return;
		// Esc 先收掉開著的問題（確認框），沒有問題才清選取（N18）；焦點在打字的地方也一樣
		if (e.key === 'Escape' && !composing(e) && session.cancelQuestion()) {
			e.preventDefault();
			return;
		}
		// 焦點所在的東西自己要用這個鍵（打字的地方、選單、radio 的方向鍵…）：快捷鍵讓給它
		if (ownsKey(target, e.key)) return;
		// ⌘C／⌘V（Ctrl+C／V）：複製選到的站位卡片、貼到播放頭；沒選站位、沒複製過就照瀏覽器的。
		// 拍點格子自己用了（複製、貼拍點）就不算
		if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (key === 'c' || key === 'v')) {
			if (e.defaultPrevented) return;
			if (key === 'v') playback.pauseOnBeat();
			if (key === 'c' ? session.copyFormation() : session.pasteFormation(playback.sec)) e.preventDefault();
			return;
		}
		// 元件自己用了 Home／End（已經 preventDefault）時不算
		if ((e.key === 'Home' || e.key === 'End') && !e.defaultPrevented) {
			e.preventDefault();
			if (e.key === 'Home') playback.toStart();
			else playback.toEnd();
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			// Mac 的 delete 鍵送的是 Backspace；只刪最後點的那一個
			// 刪掉的是有焦點的站位小圖或色條：焦點給前一張站位的小圖、那一列的名字，不掉回 body
			const lost = document.activeElement;
			const next =
				lost?.closest('.th')?.previousElementSibling?.querySelector<HTMLElement>('.pick') ??
				lost?.closest('[data-lane]')?.querySelector<HTMLElement>('.lab');
			if (session.deleteKey()) {
				e.preventDefault();
				flushSync();
				if (lost && !lost.isConnected) next?.focus();
			}
		} else if (
			(e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
			!e.defaultPrevented &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey
		) {
			// 方向鍵移播放頭：一拍（Shift 一個八拍）。分界、選單、分頁自己用方向鍵時（已經 preventDefault）不算。
			e.preventDefault();
			playback.step(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey);
		} else if (e.key === 'Escape') {
			session.clearSelection();
		} else if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// 分組：選好人按 1–9 放進那組、0 移出組。任務角色選單也用數字鍵（ownsKey 已經讓給它）。
			if (session.squadKey(Number(e.key))) e.preventDefault();
		}
	}

	/** 右邊欄的分頁：←→ 換到另一頁，焦點跟著過去（只有兩頁，往哪邊都是另一頁）。 */
	function tabKey(e: KeyboardEvent) {
		if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.ctrlKey || e.metaKey || e.altKey) return;
		e.preventDefault();
		editor.inspectorTab = editor.inspectorTab === 'action' ? 'members' : 'action';
		flushSync();
		document.getElementById(`tab-${editor.inspectorTab}`)?.focus();
	}

	/** 兩條分界都回到預設（雙擊分界也可以，一次一條）。 */
	function resetLayout() {
		timelineDivider.set(null);
		inspectorDivider.set(null);
	}
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>
<svelte:window
	{onkeydown}
	onkeyup={(e) => {
		// 按鈕、勾選框是放開空白鍵才算按：空白鍵已經拿去播放／暫停，不再按一次
		if (e.key === ' ' && spaceUsed) e.preventDefault();
		if (e.key === ' ') spaceUsed = false;
	}}
	{onbeforeunload}
	onpagehide={() => {
		editor.file.pageHidden();
		editor.file.pageClosed();
	}}
	onpageshow={(e) => e.persisted && editor.file.pageShown()}
	onpointerdowncapture={dismissNotice}
	onkeydowncapture={dismissNotice}
	bind:innerWidth={windowW}
	bind:innerHeight={windowH}
/>
<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && editor.file.pageHidden()} />

{#if flow}
	{@const warnings = timeRuleWarnings(flow)}
	<div
		class="editor"
		inert={overlayOpen}
		class:practicing={view === 'practice'}
		class:viewing={!session.editable && !narrow}
		class:narrow
		class:print-hidden={printOpen}
		style:--timeline-h={timelineDivider.px === null ? undefined : `clamp(${TIMELINE_MIN_PX}px, ${timelineDivider.px}px, calc(100dvh - ${fieldKeepPx()}px))`}
		style:--inspector-w="{inspectorPx}px"
	>
		<!-- 提示（存檔、開檔的結果…）：編排時浮在場地上，練習時浮在練習畫面上 -->
		{#snippet noticeToast()}
			<NoticeToast onundo={undo} />
		{/snippet}
		<!-- 「我」選單：手機的檢視畫面和電腦的檢視模式右邊欄共用（一次只出現一個） -->
		{#snippet mePicker(hint: string)}
			<label for="me-pick">我</label>
			<select id="me-pick" value={myId} onchange={(e) => pickMe(e.currentTarget.value)}>
				<option value="">{hint}</option>
				{#each flow?.members ?? [] as m (m.id)}
					<option value={m.id}>{m.name}</option>
				{/each}
			</select>
		{/snippet}
		{#snippet transport()}
			<div class="transport" hidden={view === 'practice'}>
				<button
					type="button"
					class="play"
					class:on={playback.playing}
					aria-label={playback.playing ? '暫停' : '播放'}
					title={flow.segments.length ? '空白鍵也可以播放／暫停' : '先加一段'}
					disabled={!flow.segments.length && !playback.playing}
					onclick={() => playback.toggle()}><Icon name={playback.playing ? 'pause' : 'play'} size={18} /></button
				>
				{#snippet board()}
					<span class="pos" aria-label="目前位置"
						>{#if position}<span class="pos-seg">{position.segment}</span
							>{#if position.at}{' '}<span class="pos-at">{position.at}</span>{/if}{:else}<span class="pos-seg">還沒有段</span>{/if}</span
					>
					<span class="clock">{clockText(playback.sec)} <i>/ {clockText(totalSeconds(flow))}</i></span>
				{/snippet}
				{#if narrow}
					<!-- 手機跳時間（#228）：回開頭、上一個／下一個八拍；點時間打「3-1」跳過去。只是看，不改流程 -->
					<div class="jump" role="group" aria-label="跳時間">
						<button type="button" aria-label="回開頭" onclick={() => playback.toStart()}>⏮</button>
						<button type="button" aria-label="上一個八拍" onclick={() => playback.step(-1, true)}>‹ 八拍</button>
						<button type="button" aria-label="下一個八拍" onclick={() => playback.step(1, true)}>八拍 ›</button>
					</div>
					{#if jumpText === null}
						<button
							type="button"
							class="board"
							aria-label="跳到哪裡"
							title="點一下，打 3-1 跳到第 3 個八拍"
							disabled={!flow.segments.length}
							onclick={() => (jumpText = '')}>{@render board()}</button
						>
					{:else}
						<div class="jump-to">
							<input
								type="text"
								aria-label="跳到哪裡"
								data-scratch
								placeholder="例：3-1"
								enterkeyhint="go"
								autocomplete="off"
								bind:value={jumpText}
								oninput={() => (jumpError = '')}
								onkeydown={jumpKey}
								onblur={closeJump}
								{@attach (el) => el.focus()}
							/>
							{#if jumpError}<p class="jump-error" {@attach revealAlert(jumpError)}>{jumpError}</p>{/if}
						</div>
					{/if}
				{:else}
					<div class="board">{@render board()}</div>
				{/if}
				<label class="toggle metronome" title="播放時每拍響一聲">
					<input
						type="checkbox"
						checked={playback.metronome}
						onchange={(e) => playback.setMetronome(e.currentTarget.checked)}
					/>
					<Icon name="metronome" />節拍器
				</label>
				<label class="toggle repeat" title="有選動作就重複那個動作；沒選就重複目前的八拍（口號段是目前的 5 秒）">
					<input
						type="checkbox"
						checked={playback.repeat}
						onchange={(e) => playback.setRepeat(e.currentTarget.checked)}
					/>
					<Icon name="repeat" />重複
				</label>
				<select
					class="speed"
					aria-label="播放速度"
					title="慢速播放，音高不變"
					value={String(playback.rate)}
					onchange={(e) => playback.setRate(Number(e.currentTarget.value))}
				>
					{#each SPEEDS as rate (rate)}<option value={String(rate)}>{rate}x</option>{/each}
				</select>
				<button
					type="button"
					class="more"
					aria-label="更多播放選項"
					title="延遲校正"
					aria-expanded={moreOpen}
					bind:this={moreBtn}
					onclick={() => (moreOpen = !moreOpen)}>⋯</button
				>
				<!-- 小窗放在「⋯」下面、右邊對齊；點外面（點「⋯」自己是開關）、按 Esc 就收（popover.svelte.ts） -->
				{#if moreOpen}
					<div
						class="more-pop"
						role="group"
						aria-label="更多播放選項"
						{@attach popover({ place: below(moreBtn!, { gap: 6, align: 'right', flip: true }), close: closeMore, inside: [moreBtn] })}
					>
						<label class="latency">
							<span class="latency-text">延遲校正</span>
							<input
								type="number"
								aria-label="延遲校正（毫秒）"
								step="10"
								min={-MAX_LATENCY_MS}
								max={MAX_LATENCY_MS}
								value={playback.latencyMs}
								onchange={(e) => applyLatency(e.currentTarget)}
								onkeydown={(e) => {
									if (e.key === 'Enter') applyLatency(e.currentTarget);
								}}
							/>
							<span class="unit" aria-hidden="true">毫秒</span>
						</label>
						<p class="more-hint">用藍牙耳機時，畫面比聲音快就調大。存在這台電腦，不進流程檔。</p>
					</div>
				{/if}
			</div>
		{/snippet}
		<!-- 鍵盤用的捷徑：上方列、場地、右邊欄要按很多下 Tab 才到時間軸。平常藏著，Tab 到它才出現。 -->
		{#if view === 'edit' && !narrow}
			<button type="button" class="skip" onclick={() => timelineHost?.focus()}>跳到時間軸</button>
		{/if}
		<!-- 檢視模式時上方列換成紫色：整個畫面一看就知道現在只能看 -->
		<header class="topbar" class:viewing={session.viewing && view === 'edit' && !narrow} bind:this={topbar}>
			<div class="title">
				<b title={flow.name}>{flow.name}</b>
				<!-- 「未存」的位置一直留著：出現時不把「編排｜練習」推走 -->
				<span class="unsaved-slot"
					>{#if unsaved}<span class="unsaved" title={`有還沒存的修改（${both(KEYS.save)} 存檔）`}>未存</span>{/if}</span
				>
				<div class="view" role="group" aria-label="編排｜練習">
					<button type="button" aria-pressed={view === 'edit'} onclick={() => setView('edit')}>編排</button>
					<button type="button" aria-pressed={view === 'practice'} onclick={() => setView('practice')}>練習</button>
				</div>
				<!-- 放在名字這一欄：右邊的按鈕已經滿了，再加會壓到中間的播放區 -->
				<a class="btn ghost guide-link" href={guideHref} target="_blank" rel="noopener" title="使用說明"
					><Icon name="help" /><span class="guide-text">使用說明</span></a
				>
			</div>

			<!-- 播放區：寬的時候在上方列中間；窄螢幕放在手機檢視畫面的場地下面 -->
			{#if !narrow && !transportBelow}{@render transport()}{/if}

			<div class="actions">
				<!-- 練習時沒有復原、重做：復原只退編排的修改，在練習畫面看不到退了什麼，還可能弄掉紀錄 -->
				<!-- 窄螢幕一律是檢視模式，沒有「編輯｜檢視」切換 -->
				{#if view === 'edit' && !narrow}
					<!-- 檢視模式：只能看、只能播放。改流程的指令由 session 擋下，不只是藏按鈕 -->
					<!-- 兩格都看得到，現在的那格是白的：一眼看得出現在是哪個模式、按哪裡換 -->
					<div class="mode" role="group" aria-label="編輯｜檢視">
						<button type="button" aria-pressed={!session.viewing} onclick={() => (session.viewing = false)}
							><Icon name="pencil" />編輯</button
						>
						<button
							type="button"
							aria-pressed={session.viewing}
							title="檢視模式：只能看、只能播放，不會不小心改到"
							onclick={() => (session.viewing = true)}><Icon name="eye" />檢視</button
						>
					</div>
					<!-- 檢視時復原、重做不拿掉，只變灰：換模式時旁邊的按鈕不會跑 -->
					<button
						type="button"
						class="ghost"
						title={stepTitle('復原', session.undoLabel, both(KEYS.undo))}
						disabled={!session.editable || !session.canUndo}
						onclick={undo}
						><Icon name="undo" /><span class="narrow-hide">復原</span></button
					>
					<button
						type="button"
						class="ghost"
						title={stepTitle('重做', session.redoLabel, both(KEYS.redo))}
						disabled={!session.editable || !session.canRedo}
						onclick={redo}><Icon name="redo" /><span class="narrow-hide">重做</span></button
					>
					<span class="sep" aria-hidden="true"></span>
				{/if}
				<!-- 八拍表的字一直留著：使用說明都叫它「八拍表」，只有印表機圖示認不出來 -->
				<button type="button" class="ghost" title="八拍表" onclick={() => (printOpen = true)}
					><Icon name="print" />八拍表</button
				>
				{#if view === 'edit' && !narrow}
					<button type="button" class="ghost" title="流程設定" disabled={!session.editable} onclick={() => (settingsOpen = true)}
						><Icon name="settings" /><span class="narrow-hide">流程</span>設定</button
					>
				{/if}
				<span class="sep" aria-hidden="true"></span>
				<label class="open btn ghost"><Icon name="open" />開啟<input type="file" accept=".zip" onclick={pickOpen} onchange={open} /></label>
				{#if narrow}
					<!-- 窄螢幕不能編，「新建」換成「回首頁」：這支留在草稿，列在最近的流程 -->
					<button type="button" class="ghost" onclick={() => editor.file.leaveToHome()}><Icon name="home" />回首頁</button>
				{:else}
					<button type="button" class="ghost" onclick={() => editor.file.startNew()}><Icon name="new" />新建</button>
				{/if}
				<!-- 窄螢幕不能編，存檔不用搶眼的藍色（練習的紀錄照樣要存） -->
				<button type="button" class={['save', narrow ? 'ghost' : 'primary']} title={both(KEYS.save)} onclick={() => editor.file.save()}><Icon name="save" />存檔</button>
			</div>
			<!-- 播放區換到第二行時放在按鈕後面：Tab 照畫面由上到下 -->
			{#if !narrow && transportBelow}{@render transport()}{/if}
		</header>

		<!-- 編排區和練習畫面：換一份流程就整個重開。時間軸、泳道、右邊欄的捲動，場地的放大，還沒送出的加隊員名單
		     都不帶到別的檔（跟著流程、切頁要留的放在 session.view） -->
		{#key opened}
		{#if narrow}
			{#if view === 'edit'}
				<!-- 手機的檢視畫面：上面場地、中間播放鈕、下面八拍表這一列。只能看、只能播放；場上的人拖不動 -->
				<main class="phone-view">
					<div class="phone-field">
						<Field
							field={flow.field}
							members={flow.members}
							markers={memberMarkers(flow)}
							positions={positionsAt(flow, playback.sec)}
							raised={raisedAt(flow, playback.sec)}
							controls={false}
							marked={myId ? [myId] : []}
							ghosts={trail.ghosts}
							walks={trail.walks}
							clashes={trail.clashes}
						/>
					</div>
					{@render transport()}
					<div class="phone-me">
						{@render mePicker('（選自己：場上標亮我、八拍表只看我的）')}
					</div>
					<NowEightCount {flow} memberId={myId} sec={playback.sec} />
					<!-- 跟電腦的檢視模式同一個叫法；括號裡是為什麼不能編 -->
					<p class="phone-why"><Icon name="eye" />檢視模式・只能看{whyViewOnly ? `（${whyViewOnly}）` : ''}</p>
					<!-- 提示浮在畫面最下面，不疊在場地上：手機的場地沒有空的地方，放哪都會蓋到條號或「正面／裁判」（N52） -->
					<div class="phone-toasts">{@render noticeToast()}</div>
				</main>
			{/if}
		{:else}
			<main class="field-host" class:viewing={session.viewing} hidden={view === 'practice'} {@attach watchFieldHostH}>
				{#if session.viewing}
					<!-- 場地框一圈黃色，右上角寫清楚：像 Notion 鎖住頁面時名字旁邊的「Locked」 -->
					<div class="view-badge"><Icon name="eye" />檢視模式・只能看</div>
				{/if}
				<Field
					field={flow.field}
					members={flow.members}
					markers={memberMarkers(flow)}
					positions={positionsAt(flow, playback.sec)}
					raised={raisedAt(flow, playback.sec)}
					{toMeters}
					rail={session.editable}
					ghosts={trail.ghosts}
					walks={trail.walks}
					clashes={trail.clashes}
					badges={squadBadges}
				>
					{#snippet below()}
						{#if groupingAction && flow}
							<SquadBar action={groupingAction} />
						{/if}
					{/snippet}
					{#snippet railHead()}
						{#if touchScreen || timelineDivider.px !== null || inspectorDivider.px !== null}
							<div class="select-tools">
								{#if touchScreen}
									<label class="toggle-btn" title="打開後，場上點人、框選、點泳道名字都是加選或拿掉（跟按著 Shift 一樣）">
										<input type="checkbox" bind:checked={session.multiSelect} />多選
									</label>
									<button type="button" disabled={!session.anySelected} onclick={() => session.clearSelection()}>取消選取</button>
								{/if}
								{#if timelineDivider.px !== null || inspectorDivider.px !== null}
									<button type="button" class="ghost" onclick={resetLayout}>版面回原狀</button>
								{/if}
							</div>
						{/if}
					{/snippet}
					{#snippet railTop()}
						{#if flow}
							{@const now = currentFormation(flow, playback.sec)}
							<div class="now-formation" aria-label="現在的站位">
								<span class="now-label">現在站位</span>
								<div class="now-row">
									<span class="now-no">{now.number}</span>
									{#if now.formation.name}
										<strong class="now-name" title={now.formation.name}>{now.formation.name}</strong>
									{:else}
										<span class="now-name unnamed">站位 {now.number}</span>
									{/if}
								</div>
							</div>
						{/if}
						{#if warnings.length}
							<!-- 一條一行、有小標題；能改設定時點一條就打開流程設定，焦點在那條規則的數字 -->
							<ul class="warn" aria-label="規則警告">
								{#each warnings as w (w.title)}
									<li>
										{#if view === 'edit' && session.editable}
											<button
												type="button"
												title="規則警告（只提醒，不擋）：按一下到流程設定改這個數字"
												onclick={() => {
													settingsFocus = w.rule;
													settingsOpen = true;
												}}
												><Icon name="warn" /><span><b>{w.title}</b>{w.text}</span></button
											>
										{:else}
											<span class="row"><Icon name="warn" /><span><b>{w.title}</b>{w.text}</span></span>
										{/if}
									</li>
								{/each}
							</ul>
						{:else if flow && !flow.timeRules.on}
							<!-- 關掉的規則警告：看得出是關著的，能改設定時點了到流程設定的開關 -->
							<div class="warn off">
								{#if view === 'edit' && session.editable}
									<button
										type="button"
										onclick={() => {
											settingsFocus = 'on';
											settingsOpen = true;
										}}><Icon name="warn" /><span><b>規則警告關著</b>按一下到流程設定打開</span></button
									>
								{:else}
									<span class="row"><Icon name="warn" /><span><b>規則警告關著</b>到流程設定打開</span></span>
								{/if}
							</div>
						{/if}
						{#if flow}
							<RuleSummary {flow} clashes={allClashes} />
						{/if}
						{#if flow}
							{@const stacked = stackedMembers(flow.members, positionsAt(flow, playback.sec))}
							{#if stacked.length}
								<p class="hint-warn" role="note">
									{stacked.map((g) => g.map((m) => m.name).join('、')).join('；')} 疊在同一點：被蓋住的人看不到也點不到，拖開一點比較好
								</p>
							{/if}
							<CueOverlay {flow} />
						{/if}
					{/snippet}
					{#snippet railBottom()}
						{#if flow?.members.length}
							<FormationEditor />
						{/if}
					{/snippet}
				{#if flow.members.length === 0}
					<div class="field-empty">
						<b>場上還沒有人</b>
						<span>到右邊的「隊員」加人，他們會排進場地中間的空格點（場地站滿了才排到場外），可以直接拖。</span>
					</div>
				{/if}
				<!-- 場上的確認框和提示：找一個不蓋住場上的人、條號、「正面／裁判」、選人工具列的地方
				     （標了 data-keep-visible 的都躲，先試上面那一條，見 dodgeKeepVisible） -->
				<div
					class="field-toasts"
					{@attach dodgeKeepVisible(() => [session.notice, session.ask.question, session.selectedMemberIds, playback.sec, flow])}
				>
					{#if session.ask.question}
						<div class="toast-confirm">
							<ConfirmList ask={session.ask} />
						</div>
					{/if}
					{@render noticeToast()}
				</div>
				</Field>
			</main>

			<aside class="inspector" class:viewing={!session.editable} aria-label="右邊欄" hidden={view === 'practice'}>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (可以聚焦、用 ←→ 調的分界，WAI-ARIA 的 separator 就是這樣用) -->
				<div
					class="col-split"
					role="separator"
					aria-orientation="vertical"
					aria-label="場地和右邊欄的分界"
					aria-valuenow={inspectorPx}
					aria-valuemin={INSPECTOR_MIN_PX}
					tabindex="0"
					title="拖這裡調整右邊欄的寬度（雙擊或按場地左邊的「版面回原狀」回到自動）"
					{@attach inspectorDivider.attach}
				></div>
				<!-- svelte-ignore a11y_interactive_supports_focus (焦點在裡面的分頁上，←→ 從分頁冒上來；分頁列本身不用停) -->
				<div class="tabs" role="tablist" aria-label="右邊欄" hidden={!session.editable} onkeydown={tabKey}>
					<button
						type="button"
						role="tab"
						id="tab-action"
						aria-selected={editor.inspectorTab === 'action'}
						aria-controls="panel-action"
						onclick={() => (editor.inspectorTab = 'action')}><Icon name="bolt" />動作</button
					>
					<button
						type="button"
						role="tab"
						id="tab-members"
						aria-selected={editor.inspectorTab === 'members'}
						aria-controls="panel-members"
						onclick={() => (editor.inspectorTab = 'members')}
						><Icon name="people" />隊員<span class="count">{flow.members.length}</span></button
					>
				</div>
				<div class="panel" id="panel-action" role="tabpanel" aria-labelledby="tab-action" hidden={!session.editable || editor.inspectorTab !== 'action'}>
					<MemberPicker />
					<WalkForm />
					<ActionForm {cellAt} />
				</div>
				<div class="panel" id="panel-members" role="tabpanel" aria-labelledby="tab-members" hidden={!session.editable || editor.inspectorTab !== 'members'}>
					<MemberPanel />
				</div>
				<!-- 檢視模式：右邊欄只放看的東西。編輯的分頁、表單藏起來不拆掉，切回編輯時原樣回來 -->
				{#if !session.editable}
					<div class="panel view-panel">
						<div class="view-me">{@render mePicker('（選自己：八拍表這一列只看我的）')}</div>
						<NowEightCount {flow} memberId={myId} sec={playback.sec} />
						{#if session.selectedAction}
							<ActionDetail {flow} action={session.selectedAction} />
						{:else}
							<p class="view-hint">點時間軸上的動作，這裡看得到人、任務角色、拍點、備註。</p>
						{/if}
					</div>
				{/if}
			</aside>

			<!-- svelte-ignore a11y_no_noninteractive_tabindex (可以聚焦、用 ↑↓ 調的分界，WAI-ARIA 的 separator 就是這樣用) -->
			<div
				class="split"
				hidden={view === 'practice'}
				role="separator"
				aria-orientation="horizontal"
				aria-label="場地和時間軸的分界"
				aria-valuenow={timelineDivider.px ?? currentTimelineH()}
				aria-valuemin={TIMELINE_MIN_PX}
				tabindex="0"
				title="拖這裡改時間軸的高度，場地跟著變（雙擊或按場地左邊的「版面回原狀」回到預設）"
				{@attach timelineDivider.attach}
			></div>

			<section class="timeline-host" aria-label="時間軸" tabindex="-1" hidden={view === 'practice'} bind:this={timelineHost}>
				<Timeline onopensegment={(id) => (openSegmentId = id)} clashes={allClashes} />
			</section>
		{/if}
		{#if view === 'practice'}
			<div class="practice-host">
				<Practice date={practiceDate} ondate={(d) => (practiceDate = d)} {narrow} />
				{@render noticeToast()}
			</div>
		{/if}
		{/key}
	</div>
	<!-- 大的 iPad 拿直的（不算窄）：編輯畫面擋住，但留「回首頁」「看八拍表」「去練習」，不會被困住（docs/adr/0005-ipad-touch.md） -->
	{#snippet coverWays()}
		<div class="cover-ways">
			<button type="button" onclick={() => editor.file.leaveToHome()}>回首頁</button>
			<button type="button" onclick={() => (printOpen = true)}>看八拍表</button>
			<button type="button" class="primary" onclick={() => setView('practice')}>去練習</button>
		</div>
	{/snippet}
	<!-- 八拍表開著時收起來：從提示上的「看八拍表」打開的，關掉再回來。窄螢幕是手機的檢視畫面，不擋 -->
	{#if view === 'edit' && !printOpen && !narrow}
		<!-- iPad 拿直的：場地會被擠到看不見，請教練轉成橫的（只在觸控螢幕顯示） -->
		<section class="cover-hint rotate-hint" aria-labelledby="rotate-hint-title">
			<Icon name="fit" size={28} />
			<b id="rotate-hint-title">請把 iPad 轉成橫的</b>
			<span>編輯畫面要橫著放，場地和時間軸才放得下。練習、記錄、看八拍表直著也可以。</span>
			{@render coverWays()}
		</section>
	{/if}
	{#if openSegmentId}
		<!-- 開著時從時間軸點另一段：重開一個，打開時記的東西（BPM）照新的那段 -->
		{#key openSegmentId}
			<SegmentSettings
				segmentId={openSegmentId}
				{waveXToSec}
				onclose={() => {
					playback.stopPreview();
					openSegmentId = null;
				}}
			/>
		{/key}
	{/if}
	{#if settingsOpen}
		<FlowSettings
			focus={settingsFocus}
			onclose={() => {
				settingsOpen = false;
				settingsFocus = undefined;
			}}
		/>
	{/if}
	{#if printOpen}
		<PrintSheet
			{flow}
			selected={session.selectedMemberIds.length === 1 ? session.selectedMemberIds[0] : myId || null}
			onclose={() => (printOpen = false)}
		/>
	{/if}
	{#if editor.file.asking}
		{@const message = `「${flow.name}」還沒存，${editor.file.askingToOpen ? '要開別的流程檔，' : ''}改的東西會不見。`}
		<!-- 真的對話框：Escape、點背景＝取消，焦點先放在「取消」，關掉後回到按的按鈕 -->
		<Modal label={message} class="discard-box" onclose={() => editor.file.answer('cancel')}>
			{#snippet children()}
				<ConfirmList
					{message}
					items={[]}
					confirmLabel="不存了，繼續"
					onconfirm={() => editor.file.answer('discard')}
					extra={{ label: '先存檔', onclick: () => editor.file.answer('save') }}
					oncancel={() => editor.file.answer('cancel')}
					focusCancel
				/>
			{/snippet}
		</Modal>
	{/if}
{:else}
	<div class="home">
		<a class="btn home-guide" href={guideHref} target="_blank" rel="noopener"><Icon name="help" />使用說明</a>
		<section class="intro">
			<svg class="intro-mat" viewBox="0 0 90 70" aria-hidden="true">
				{#each Array.from({ length: 9 }, (_, i) => i) as i (i)}
					<rect x={i * 10} y="0" width="9.4" height="70" rx="0.6" />
				{/each}
				<circle class="b" cx="25" cy="44" r="3.2" />
				<circle class="t" cx="35" cy="30" r="3.2" />
				<circle class="b" cx="45" cy="44" r="3.2" />
				<circle class="t" cx="55" cy="30" r="3.2" />
				<circle class="b" cx="65" cy="44" r="3.2" />
			</svg>
			<h1>競技啦啦隊<br />流程編輯器</h1>
			<p>
				音樂、八拍、站位和每個人的角色，排在同一條時間軸上。存成一個流程檔，傳給隊員用同一個編輯器打開。
			</p>
		</section>

		<section class="start" class:narrow>
			{#if narrow}
				<!-- 窄螢幕不能編：不放新建，最大的是「開啟流程檔」（docs/adr/0005-ipad-touch.md） -->
				<p class="home-view-only"><Icon name="eye" />檢視模式・只能看：這個畫面太小，不能新建、編輯。請用電腦，或把 iPad 轉成橫的。</p>
			{:else}
				<NewFlowForm oncreate={(f) => editor.file.create(f)} />
			{/if}
			<div class="home-open">
				{#if !narrow}<span>已經有流程檔？</span>{/if}
				<label class="open btn" class:primary={narrow}><Icon name="open" />開啟流程檔<input type="file" accept=".zip" onclick={pickOpen} onchange={open} /></label>
			</div>
			{#if editor.file.openError}<p class="error" {@attach revealAlert(editor.file.openError)}>{editor.file.openError}</p>{/if}
			{#if editor.file.recent.length}
				<div class="recent">
					<h2 id="recent-title">最近的流程</h2>
					<ul aria-labelledby="recent-title">
						{#each editor.file.recent as f (f.id)}
							<!-- 同名的不只一支：「丟掉」也寫最後改的時間，聽得出是哪一支 -->
							{@const { text: edited, twin } = recentEdited(f)}
							<li>
								<button type="button" class="recent-open" onclick={() => editor.file.openRecent(f.id)}>
									<span class="recent-name" title={f.name}>{f.name}</span>
									<span class="recent-meta"
										>{[edited, f.busy ? '另一個分頁正在編' : f.unsaved ? '還沒存' : '']
											.filter(Boolean)
											.join('・')}</span
									>
								</button>
								<button type="button" class="link recent-drop" aria-label={`丟掉「${f.name}」${twin ? `（${edited}）` : ''}`} onclick={() => (discarding = f)}>丟掉</button>
							</li>
						{/each}
					</ul>
					{#if editor.file.unsavedOverLimit}
						<p class="recent-note" role="status">有 {editor.file.unsavedOverLimit} 支還沒存。編輯器不會自動丟掉還沒存的，用不到的按「丟掉」。</p>
					{/if}
					<p class="recent-note">草稿只存在這個瀏覽器裡。只是打開看、不小心改到的，按「丟掉」再開原檔。</p>
				</div>
			{/if}
			<p class="recent-note" role="status">{discardNote}</p>
		</section>
		{#if discarding}
			{@const f = discarding}
			{@const { text: edited, twin } = recentEdited(f)}
			{@const which = `「${f.name}」${twin ? `（${edited}）` : ''}`}
			{@const message = f.unsaved
				? `丟掉${which}的草稿？還沒存的修改會不見，不能復原。`
				: `丟掉${which}的草稿？流程檔不會動，只是不列在最近的流程。`}
			<Modal label={message} class="discard-box" onclose={() => (discarding = null)}>
				{#snippet children()}
					<ConfirmList
						{message}
						items={[]}
						confirmLabel="丟掉"
						onconfirm={() => {
							const { id, name } = f; // 關掉對話框後 f 不能再讀（Svelte derived_inert）
							discarding = null;
							discardNote = '';
							void editor.file.discardRecent(id).then((outcome) => {
								discardNote = {
									dropped: `已丟掉「${name}」的草稿`,
									busy: `另一個分頁正在編「${name}」，沒有丟掉`,
									failed: `「${name}」的草稿刪不掉，沒有丟掉`
								}[outcome];
							});
						}}
						oncancel={() => (discarding = null)}
						focusCancel
					/>
				{/snippet}
			</Modal>
		{/if}
	</div>
{/if}
{#if editor.file.draftAsk}
	{@const ask = editor.file.draftAsk}
	{@const message = `「${ask.name}」有還沒存的修改（草稿${ask.savedAt ? ` ${draftTime(ask.savedAt)}` : ''}）。要救回修改，還是用檔案？用檔案會丟掉這些修改。`}
	<Modal label={message} class="discard-box" onclose={() => editor.file.answerDraft('cancel')}>
		{#snippet children()}
			<ConfirmList
				{message}
				items={[]}
				confirmLabel="用檔案（丟掉修改）"
				onconfirm={() => editor.file.answerDraft('file')}
				extra={{ label: '救回修改', onclick: () => editor.file.answerDraft('draft') }}
				oncancel={() => editor.file.answerDraft('cancel')}
				focusCancel
			/>
		{/snippet}
	</Modal>
{/if}

<style>
	/* ---------- 編輯畫面的大格子 ---------- */
	.editor {
		/* dvh：iPad Safari 的網址列不會擋到下面的時間軸。 */
		height: 100dvh;
		display: grid;
		/* 上方列｜場地＋右邊欄｜分界｜時間軸。時間軸預設 30vh，拖分界改的高度放在 --timeline-h。 */
		grid-template-rows: auto minmax(0, 1fr) auto var(--timeline-h, minmax(200px, 30vh));
		/* 場地｜右邊欄。右邊欄的寬度放在 --inspector-w（沒拖過時照螢幕大小自動分）。 */
		grid-template-columns: minmax(0, 1fr) var(--inspector-w, 360px);
		background: var(--paper);
	}
	/* 檢視模式是看的版面：時間軸預設矮一點（拖過分界就照拖的），場地拿到更多高度 */
	.editor.viewing {
		grid-template-rows: auto minmax(0, 1fr) auto var(--timeline-h, minmax(160px, 22vh));
	}
	/* 檢視模式：只能編輯的控制項（標了 data-edit 的：時間軸的加段、插入八拍、站位 ✕、拉長度的把手、分組列…）
	   一條規則藏起來，不用每個元件自己讀模式。播放頭、選取、練習的「記」照樣能用，所以不整塊 inert */
	.editor.viewing :global([data-edit]) {
		display: none !important;
	}
	/* 練習：主畫面換成練習畫面，編排的東西藏起來（不拆掉：場地、時間軸的縮放還在） */
	.editor.practicing {
		grid-template-rows: auto minmax(0, 1fr);
	}
	/* 窄螢幕：上方列下面整塊是手機的檢視畫面（或練習畫面）。沒有右邊欄，只留一欄：不然右邊欄那欄 360px 把 320 寬的手機撐寬 */
	.editor.narrow {
		grid-template-rows: auto minmax(0, 1fr);
		grid-template-columns: minmax(0, 1fr);
	}
	/* 手機的檢視畫面：上面場地（吃剩下的高度）、中間播放區、「我」、下面八拍表這一列（太長自己捲）。
	   八拍表這一列固定高（畫面夠高時 25dvh，放不下自己捲）：播放時換列、內容變長變短，場地和播放鈕不上下跳（#210） */
	.phone-view {
		position: relative;
		grid-column: 1 / -1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(160px, 1fr) auto auto minmax(0, 25dvh) auto;
	}
	/* 為什麼不能編（請轉成橫的、太窄、太矮）：一行字放最下面，不跟場地搶位置；黃底深字，看得出是提醒 */
	.phone-why {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		padding: 6px 12px;
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: 13px;
	}
	.phone-field {
		position: relative;
		min-height: 0;
		padding: 8px;
	}
	/* 手機的提示：畫面最下面置中，整個寬都能用（一行放得下就一行）；橫拿時在右邊那一欄（.phone-view > * 的 grid-column） */
	.phone-toasts {
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: 14px;
		z-index: 10;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.phone-toasts > :global(*) {
		pointer-events: auto;
	}
	.phone-toasts :global(div.toast) {
		position: static;
		transform: none;
		max-width: 100%;
		animation-name: drop-in;
	}
	.phone-view .transport {
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px 10px;
		padding: 8px 12px;
		background: var(--ink);
	}
	/* 手機跳時間：回開頭、上一個／下一個八拍（手指至少 40px 高）；時間本身是按鈕，點了換成打字的欄位 */
	.jump {
		display: flex;
		gap: 6px;
	}
	.jump button {
		min-height: 40px;
		padding: 0 12px;
		background: transparent;
		border-color: #36425f;
		color: #c9d2e6;
		white-space: nowrap;
	}
	button.board {
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.jump-to {
		display: grid;
		gap: 4px;
		min-width: 168px;
	}
	.jump-to input {
		min-height: 40px;
		font-size: 16px; /* iOS 小於 16px 會自動放大畫面 */
	}
	.jump-error {
		margin: 0;
		font-size: 12px;
		color: #ffb4a3;
	}
	.phone-me {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: var(--surface);
		border-top: 1px solid var(--line);
		font-weight: 600;
	}
	.phone-me select {
		flex: 1;
		min-width: 0;
	}
	.phone-view :global(.now-eight) {
		max-height: 38dvh;
	}
	/* 手機橫拿：場地在左、播放區和八拍表在右，場地才不會被擠扁 */
	@media (orientation: landscape) {
		.phone-view {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-rows: auto auto minmax(0, 1fr) auto;
		}
		.phone-view > :global(*) {
			grid-column: 2;
		}
		.phone-view > .phone-field {
			grid-column: 1;
			grid-row: 1 / -1;
		}
		.phone-view :global(.now-eight) {
			max-height: none;
		}
	}
	.editor > [hidden],
	.topbar > [hidden] {
		display: none;
	}
	.practice-host {
		position: relative;
		grid-column: 1 / -1;
		min-height: 0;
		display: grid;
		/* 表格很寬時（人多）只有表格自己左右捲，不把練習畫面撐開 */
		grid-template-columns: minmax(0, 1fr);
	}
	.split {
		grid-column: 1 / -1;
		position: relative;
		height: 7px;
		cursor: row-resize;
		touch-action: none;
		background: var(--line-soft);
		border-top: 1px solid var(--line);
	}
	/* 中間一小條把手，看得出可以拖。 */
	.split::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 2px;
		width: 36px;
		height: 3px;
		margin-left: -18px;
		border-radius: 2px;
		background: var(--muted);
		opacity: 0.45;
	}
	.split:hover,
	.split:focus-visible {
		background: var(--sel-soft);
		outline: none;
	}
	.split:hover::after,
	.split:focus-visible::after {
		background: var(--sel);
		opacity: 1;
	}
	/* 手指：兩條分界點得到的範圍變大（蓋到旁邊一點），看起來不變。 */
	@media (pointer: coarse) {
		.split {
			z-index: 9;
		}
		.split::before {
			content: '';
			position: absolute;
			inset: -9px 0;
		}
		.col-split {
			left: -12px;
			width: 24px;
		}
		.col-split::after {
			left: 10px;
		}
	}

	/* ---------- 上方列：深藍底，像記分板 ---------- */
	.topbar {
		grid-column: 1 / -1;
		display: grid;
		/* 播放區放中間；右邊的按鈕不夠放時，播放區往左讓，按鈕不疊上去 */
		grid-template-columns: minmax(min-content, 1fr) auto minmax(max-content, 1fr);
		align-items: center;
		gap: 16px;
		padding: 8px 12px 8px 16px;
		background: var(--ink);
		color: #e8ecf5;
	}
	.topbar.viewing {
		background: #3b2a6b;
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}
	.title b {
		font-size: 16px;
		font-weight: 700;
		color: #fff;
		/* 只畫一行，放不下用「…」。不用 nowrap：名字這一欄最窄是 min-content（「編排｜練習」才不會被播放區壓到），
		   nowrap 的長名字會把它撐開、右邊的按鈕擠出畫面；能在任何字斷開，名字就不算進最窄的寬度。 */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		overflow-wrap: anywhere;
		overflow: hidden;
	}
	.unsaved-slot {
		flex: none;
		min-width: 3em;
		font-size: 12px;
	}
	.unsaved {
		font-size: 12px;
		color: #ffd27a;
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.unsaved::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}
	/* 編排｜練習 */
	.view {
		flex: none;
		align-self: center;
		display: inline-flex;
		padding: 3px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.12);
	}
	.view button {
		border: 0;
		border-radius: 6px;
		padding: 3px 12px;
		background: none;
		color: #cbd5e1;
	}
	.view button:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.view button[aria-pressed='true'] {
		background: #fff;
		color: var(--ink);
		font-weight: 700;
	}
	/* 編輯｜檢視：字的粗細兩格一樣，換模式時寬度不變、旁邊的按鈕不跑 */
	.mode {
		display: inline-flex;
		padding: 2px;
		border-radius: 999px;
		background: #0c1426;
		border: 1px solid #36425f;
	}
	.mode button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		border: none;
		border-radius: 999px;
		background: none;
		color: #8b99b8;
		font-size: 13px;
		font-weight: 600;
	}
	.mode button:hover {
		color: #fff;
	}
	.mode button[aria-pressed='true'] {
		background: #fff;
		color: var(--ink);
	}
	/* 手指（橫拿的 iPad）：跟節拍器一樣至少 32px 高 */
	@media (pointer: coarse) {
		.mode button {
			min-height: 32px;
		}
	}

	.transport {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.play {
		width: 40px;
		height: 40px;
		padding: 0;
		border-radius: 50%;
		background: var(--now);
		border-color: var(--now);
		color: #fff;
	}
	.play:hover {
		background: #ff6a45;
		border-color: #ff6a45;
	}
	/* 沒有段：灰的，按不下去 */
	.play:disabled,
	.play:disabled:hover {
		background: var(--muted, #66718a);
		border-color: var(--muted, #66718a);
	}
	.play.on {
		background: #fff;
		border-color: #fff;
		color: var(--ink);
	}
	.board {
		display: grid;
		grid-template-columns: auto;
		min-width: 168px;
		padding: 3px 12px 4px;
		border-radius: var(--radius);
		background: #0c1426;
		box-shadow: inset 0 0 0 1px #2b3754;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}
	.pos {
		display: flex;
		align-items: baseline;
		gap: 8px;
		white-space: nowrap;
	}
	/* 在結尾只寫「結尾」、沒有大字：放一個看不到的大字撐住這一行，上方列高度不變 */
	.pos::after {
		content: '\200b';
		font-size: 20px;
		font-weight: 700;
		margin-left: -8px; /* 不多佔 .pos 的 gap */
	}
	.pos-seg {
		font-size: 12px;
		color: #9fb0d4;
	}
	.pos-at {
		font-size: 20px;
		font-weight: 700;
		color: #fff;
		letter-spacing: 0.02em;
	}
	.clock {
		font-size: 11px;
		color: #8b99b8;
	}
	.clock i {
		font-style: normal;
		color: #8b99b8;
	}
	.toggle,
	.latency {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #c9d2e6;
		white-space: nowrap;
		cursor: pointer;
	}
	.toggle {
		padding: 5px 10px;
		border-radius: 999px;
		border: 1px solid #36425f;
	}
	/* 手指：節拍器至少 32px 高 */
	@media (pointer: coarse) {
		.toggle {
			min-height: 32px;
		}
	}
	/* 節拍器、重複開著：亮的底色、深色的字，跟關著的（透明底）一眼分得出來 */
	.toggle:has(input:checked) {
		background: var(--sel);
		border-color: var(--sel);
		color: var(--ink);
		font-weight: 600;
	}
	.toggle input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.toggle:focus-within {
		outline: 2px solid var(--sel);
		outline-offset: 2px;
	}
	.latency input,
	.speed {
		width: 64px;
		background: #0c1426;
		color: #fff;
		border-color: #36425f;
		padding: 3px 6px;
	}
	.more {
		padding: 2px 10px;
		border-radius: 999px;
		border: 1px solid #36425f;
		background: transparent;
		color: #c9d2e6;
		font-size: 14px;
		font-weight: 700;
		line-height: 1.4;
	}
	.more[aria-expanded='true'] {
		background: #24304c;
		color: #fff;
	}
	/* 手指：「⋯」至少 32px 高 */
	@media (pointer: coarse) {
		.more {
			min-height: 32px;
		}
	}
	.more-pop {
		/* 開在最上層（popover）：蓋掉瀏覽器給 popover 的置中、框線、顏色；跟上方列一樣深底 */
		position: fixed;
		inset: auto;
		margin: 0;
		display: grid;
		gap: 6px;
		width: max-content;
		max-width: min(280px, 80vw);
		padding: 10px 12px;
		border: 1px solid #36425f;
		border-radius: 8px;
		background: var(--ink);
		color: #c9d2e6;
		box-shadow: var(--shadow-pop);
	}
	.more-hint {
		margin: 0;
		font-size: 11px;
		color: #8b99b8;
	}
	.speed {
		width: auto;
		font-size: 12px;
	}

	.actions {
		/* 一定在最右邊那一欄（練習時播放區藏起來，也不會跑到中間） */
		grid-column: -2 / -1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		min-width: 0;
	}
	.actions :global(button.ghost),
	.actions .btn.ghost {
		color: #d6ddec;
	}
	.actions :global(button.ghost:hover),
	.actions .btn.ghost:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.actions .save {
		margin-left: 4px;
	}
	.guide-link {
		flex: none;
		color: #d6ddec;
		text-decoration: none;
	}
	.guide-link:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.sep {
		width: 1px;
		height: 20px;
		background: #36425f;
		margin: 0 4px;
	}
	/* 左欄上面固定的：多選、取消選取、版面回原狀（iPad 沒有 Shift、Esc，也不好雙擊分界）。 */
	.select-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.toggle-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		padding: 4px 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-size: 13px;
		line-height: 20px;
		cursor: pointer;
		user-select: none;
	}
	.toggle-btn:has(input:checked) {
		background: var(--sel);
		border-color: var(--sel);
		color: #fff;
		font-weight: 600;
	}
	.toggle-btn:focus-within {
		outline: 2px solid var(--sel);
		outline-offset: 2px;
	}
	.toggle-btn input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	/* 左欄（場地左邊）的東西：警告、拖人會改。 */
	.warn {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		border-radius: 10px;
		background: var(--warn-bg);
		border: 1px solid #f0d488;
		color: var(--warn-text);
		font-size: 12px;
		font-weight: 500;
	}
	.warn li + li {
		border-top: 1px solid #f0d488;
	}
	.warn button,
	.warn .row {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		width: 100%;
		padding: 4px 12px;
		border: 0;
		border-radius: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
	}
	.warn button {
		cursor: pointer;
	}
	.warn button:hover {
		text-decoration: underline;
	}
	.warn b {
		display: block;
		font-weight: 700;
	}
	/* 關著的規則警告：灰的，看得出是關著、不是沒問題。 */
	.warn.off {
		background: var(--surface-2, #f6f8fb);
		border-color: var(--line, #dfe4ee);
		color: var(--muted, #66718a);
	}
	/* 左欄最上面：播放頭這一刻用的站位。號碼跟站位縮圖列一樣是深色小方塊，左邊一條墊子藍。 */
	.now-formation {
		align-self: stretch;
		display: grid;
		gap: 4px;
		padding: 8px 12px 10px;
		border-radius: 10px;
		background: var(--surface, #fff);
		border: 1px solid var(--line, #d8dee9);
		border-left: 4px solid var(--mat, #2f66b8);
		box-shadow: 0 1px 2px rgba(22, 33, 58, 0.06);
	}
	.now-label {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	.now-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.now-no {
		flex: none;
		min-width: 22px;
		padding: 0 5px;
		border-radius: 5px;
		background: var(--ink, #16213a);
		color: #fff;
		font-size: 12px;
		font-weight: 700;
		line-height: 22px;
		text-align: center;
	}
	.now-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 18px;
		font-weight: 700;
		color: var(--ink, #16213a);
	}
	.now-name.unnamed {
		font-weight: 600;
		color: var(--muted);
	}
	.warn :global(svg) {
		flex: none;
		margin-top: 1px;
	}

	/* 選檔用的 input 藏起來，外面的 label 看起來像按鈕。 */
	.open {
		position: relative;
	}
	.open:focus-within {
		outline: 2px solid var(--sel);
		outline-offset: 2px;
	}
	.open input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	/* ---------- 場地 ---------- */
	.field-host {
		position: relative;
		min-height: 0;
		padding: 12px;
	}
	.field-host.viewing {
		box-shadow: inset 0 0 0 4px #ffc53d;
	}
	.view-badge {
		position: absolute;
		top: 18px;
		right: 22px;
		z-index: 5;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 999px;
		background: #ffc53d;
		color: #2a1d00;
		font-weight: 700;
		font-size: 13px;
		box-shadow: 0 2px 8px rgba(22, 33, 58, 0.15);
		pointer-events: none;
	}
	.field-empty {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: grid;
		gap: 4px;
		max-width: 300px;
		padding: 14px 18px;
		text-align: center;
		background: rgba(255, 255, 255, 0.94);
		border-radius: 10px;
		box-shadow: var(--shadow-pop);
		font-size: 13px;
		color: var(--muted);
		pointer-events: none;
	}
	.field-empty b {
		color: var(--text);
		font-size: 14px;
	}
	/* 場地上的確認框和提示：一則一則往下排；放哪由 dodgeKeepVisible 量了再擺（left、top、width），這裡是量之前攤開的樣子。 */
	.field-toasts {
		position: absolute;
		top: 4px;
		left: 4px;
		right: 4px;
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}
	.field-toasts > :global(*) {
		pointer-events: auto;
	}
	/* 提示（NoticeToast）平常浮在下方；放在場地上時跟確認框一起從上方往下排（div 讓它蓋過元件自己的樣式）。 */
	.field-toasts :global(div.toast) {
		position: static;
		transform: none;
		max-width: min(560px, 100%);
		animation-name: drop-in;
	}
	@keyframes drop-in {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
	.toast-confirm {
		width: min(420px, 100%);
		box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18);
		border-radius: 10px;
	}

	/* ---------- 右邊欄 ---------- */
	.inspector {
		position: relative;
		min-height: 0;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		background: var(--surface);
		border-left: 1px solid var(--line);
	}
	/* 右邊欄左邊緣上一條看不太出來的細條，滑過去才亮，拖它改寬度。 */
	.col-split {
		position: absolute;
		left: -4px;
		top: 0;
		bottom: 0;
		z-index: 5;
		width: 8px;
		cursor: col-resize;
		touch-action: none;
	}
	.col-split::after {
		content: '';
		position: absolute;
		left: 2px;
		top: 50%;
		width: 3px;
		height: 36px;
		margin-top: -18px;
		border-radius: 2px;
		background: var(--muted);
		opacity: 0.45;
	}
	.col-split:hover,
	.col-split:focus-visible {
		background: var(--sel-soft);
		outline: none;
	}
	.col-split:hover::after,
	.col-split:focus-visible::after {
		background: var(--sel);
		opacity: 1;
	}
	.tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		padding: 8px 10px 0;
		border-bottom: 1px solid var(--line);
	}
	.tabs button {
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 6px 6px 0 0;
		padding: 8px 10px 9px;
		font-size: 14px;
		font-weight: 600;
		color: var(--muted);
		background: none;
	}
	.tabs button:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.tabs button[aria-selected='true'] {
		color: var(--mat);
		border-bottom-color: var(--mat);
	}
	.count {
		min-width: 20px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--line-soft);
		color: #4f5a73;
		font-size: 11px;
		line-height: 18px;
	}
	.tabs button[aria-selected='true'] .count {
		background: var(--mat-soft);
		color: var(--mat);
	}
	.panel {
		/* 右邊欄變寬時，裡面的表單看自己有多寬排版（@container） */
		container-type: inline-size;
		min-height: 0;
		overflow-y: auto;
		/* 黏底的那一條（新動作表單的「新增動作」，stickyBottom 量了寫進 --sticky-bottom）蓋住的那一塊：
		   聚焦、捲出錯誤訊息時都停在它上面（WCAG 2.4.11 的 C43） */
		scroll-padding-bottom: calc(var(--sticky-bottom, 0px) + 8px);
		padding: 14px 16px 24px;
		display: grid;
		align-content: start;
		gap: 18px;
	}
	.panel[hidden],
	.tabs[hidden] {
		display: none;
	}
	/* 檢視模式沒有分頁列：看的那塊拿整個高度 */
	.inspector.viewing {
		grid-template-rows: minmax(0, 1fr);
	}
	.view-me {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.view-me select {
		flex: 1;
		min-width: 0;
	}
	/* 整列照內容高（右邊欄自己捲）：min-height 不能是 0，不然動作細節很長時這一列被擠扁、內容疊到動作細節上（N09） */
	.view-panel :global(.now-eight) {
		overflow: visible;
		min-height: auto;
		border: 1px solid var(--line);
		border-radius: 8px;
	}
	.view-hint {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}

	/* 上方列、播放區、分頁、時間軸：從空白處拖過去不會把整頁的字反白（輸入框裡照常能選字）。 */
	.topbar,
	.transport,
	.tabs,
	.timeline-host {
		user-select: none;
		-webkit-user-select: none;
	}
	:is(.topbar, .transport, .timeline-host) :global(input) {
		user-select: text;
		-webkit-user-select: text;
	}

	/* 「跳到時間軸」：不佔版面；Tab 到它才從左上角出現。 */
	.skip {
		position: fixed;
		top: 8px;
		left: 8px;
		z-index: 200;
		translate: 0 calc(-100% - 16px);
	}
	.skip:focus-visible {
		translate: none;
	}
	/* 按「跳到時間軸」聚焦的是整塊時間軸：用跟其他東西一樣的焦點框，框在裡面（外面會被裁掉）。 */
	.timeline-host:focus-visible {
		outline-offset: -2px;
	}

	/* 讓時間軸撐滿這一列、自己捲動。 */
	.timeline-host {
		grid-column: 1 / -1;
		min-height: 0;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
	}

	/* 「還沒存」、首頁「丟掉」的確認：蓋過窄螢幕的提示（回首頁也會問） */
	:global(.backdrop:has(> .discard-box)) {
		align-items: flex-start;
		padding-top: 72px;
		z-index: 110;
	}
	:global(.discard-box) {
		width: min(420px, 100%);
		box-shadow: var(--shadow-pop);
		border-radius: 10px;
	}

	@media print {
		.print-hidden {
			display: none;
		}
		/* 印記一次全上表、總表：只印練習畫面裡的表，不印上方列和提示 */
		.editor.practicing {
			display: block;
			height: auto;
			background: none;
		}
		.editor.practicing > .topbar {
			display: none;
		}
	}

	/* 蓋住編輯畫面的提示：大的 iPad 拿直的請教練轉成橫的。 */
	.cover-hint {
		display: none;
		position: fixed;
		inset: 0;
		z-index: 100;
		place-content: center;
		justify-items: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		background: var(--ink);
		color: #c9d2e6;
		font-size: 15px;
	}
	.cover-hint b {
		color: #fff;
		font-size: 22px;
	}
	.cover-hint > span {
		max-width: 28em;
	}
	.cover-ways {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
		margin-top: 6px;
	}
	/* screen：列印八拍表時（紙是直的）不能印到它。 */
	@media screen and (pointer: coarse) and (orientation: portrait) {
		.rotate-hint {
			display: grid;
		}
	}

	/* 窄一點的視窗：上方列多了「編排｜練習」、播放區多了「重複」和速度，右邊的「編輯｜檢視」兩格比一個開關寬，
	   所以從 1800px 就開始收（再寬一點才收，流程名字會被擠到剩兩三個字）。 */
	@media (max-width: 1800px) {
		/* 復原、重做只留圖示，流程設定只留「設定」，右邊的按鈕才擠得下；讀屏照樣讀得到名字 */
		.narrow-hide {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* 再窄就一行放不下：播放區換到第二行，名字和按鈕留在第一行（一行硬塞的話，流程名字只剩四五個字）。
	   換行時播放區在 HTML 裡也放到按鈕後面（transportBelow），Tab 才照畫面順序。
	   右邊多了「編輯｜檢視」兩格、延遲校正多了「毫秒」、播放區多了「重複」和速度，所以從 1670px 就換。 */
	@media (max-width: 1670px) {
		.topbar {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.topbar .transport {
			grid-row: 2;
			grid-column: 1 / -1;
			justify-content: center;
		}
	}
	@media (max-width: 1280px) {
		/* 使用說明最後才縮成圖示（新手照說明找「使用說明」這幾個字）；讀屏照樣讀得到名字 */
		.guide-text {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* 手機：名字一行、按鈕一行（不收進選單）。一行硬塞的話名字被擠到 0，名字這一欄的按鈕還會畫到右邊按鈕上，點錯。 */
	@media (max-width: 760px) {
		.topbar {
			grid-template-columns: minmax(0, 1fr);
			row-gap: 6px;
			padding: 6px 12px;
		}
		.title b {
			flex: 1 1 0;
			min-width: 2em;
		}
		.actions {
			grid-row: 2;
			flex-wrap: wrap;
		}
	}

	/* ---------- 首頁 ---------- */
	.home {
		position: relative;
		min-height: 100dvh;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 460px);
		gap: 56px;
		/* 貼上方：新建表單出現錯誤、最近的流程變多時，上面的東西不跳 */
		align-items: start;
		max-width: 1040px;
		margin: 0 auto;
		padding: max(48px, 10dvh) 32px 48px;
	}
	.home-guide {
		position: absolute;
		top: 16px;
		right: 16px;
		text-decoration: none;
	}
	.intro {
		display: grid;
		gap: 20px;
		align-content: center;
	}
	.intro-mat {
		width: 180px;
		height: auto;
	}
	.intro-mat rect {
		fill: var(--mat);
	}
	.intro-mat rect:nth-child(odd) {
		fill: #3570c4;
	}
	.intro-mat circle {
		stroke: var(--ink);
		stroke-width: 0.8;
	}
	.intro-mat .b {
		fill: #fff;
	}
	.intro-mat .t {
		fill: var(--top);
	}
	/* 「競技啦啦隊」「流程編輯器」各一行，不在字中間斷開：欄窄（761–900 寬）時字跟著縮 */
	.intro h1 {
		font-size: clamp(30px, 4.4vw, 40px);
		word-break: keep-all;
		line-height: 1.15;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--ink);
	}
	.intro p {
		max-width: 26em;
		font-size: 15px;
		line-height: 1.7;
		color: var(--muted);
	}
	.start {
		display: grid;
		/* 最近的流程名字很長時不撐寬整欄（名字自己截斷） */
		grid-template-columns: minmax(0, 1fr);
		gap: 14px;
	}
	.home-open {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--muted);
		font-size: 13px;
	}
	.home .error {
		text-align: center;
	}
	/* 窄螢幕：沒有新建，「開啟流程檔」是最大的一塊 */
	.home-view-only {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 10px 12px;
		border-radius: 8px;
		border-left: 3px solid #3b2a6b;
		background: #efeaf8;
		color: var(--ink);
		font-size: 14px;
		line-height: 1.6;
	}
	.start.narrow .open {
		flex: 1;
		justify-content: center;
		padding: 18px 16px;
		font-size: 18px;
		font-weight: 700;
	}
	.recent {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 8px;
		margin-top: 10px;
	}
	.recent h2 {
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.recent ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 6px;
	}
	.recent li {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.recent-open {
		flex: 1;
		min-width: 0;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px;
	}
	.recent-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 600;
	}
	.recent-meta {
		color: var(--muted);
		font-size: 12px;
	}
	.recent-drop {
		color: var(--muted);
		font-size: 12px;
	}
	.recent-note {
		color: var(--muted);
		font-size: 12px;
	}
	/* 丟掉的回饋還沒有字：不佔格子的間距（留在畫面上，報讀才唸得到後來的字） */
	.start > .recent-note:empty {
		position: absolute;
	}
	@media (max-width: 760px) {
		.home {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
			padding: 32px 16px;
		}
		.intro h1 {
			font-size: 30px;
		}
	}
</style>
