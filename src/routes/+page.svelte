<script lang="ts">
	import {
		clashes,
		eightCountRows,
		formationWalks,
		memberMarkers,
		memberNowWhy,
		positionWhy,
		positionsAt,
		formationNowWhy,
		readJump,
		layersAt,
		squadBadge,
		timeRuleWarnings,
		stackedAt,
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
	import { flushSync, onMount, tick, untrack, type ComponentProps } from 'svelte';
	import { resolve } from '$app/paths';
	import { loadFlowSetting, MAX_LATENCY_MS, saveFlowSetting } from '#lib/local-settings.js';
	import { SPEEDS } from '#lib/playback.svelte.js';
	import { dodgeKeepVisible } from '#lib/toast-dodge.js';
	import { below, popover } from '#lib/popover.svelte.js';
	import {
		autoInspectorWidth,
		clampInspectorWidth,
		INSPECTOR_MIN_PX,
		isTouchScreen,
		NARROW_SCREEN,
		viewOnlyReason
	} from '#lib/editor-layout.js';
	import { Divider } from '#lib/divider.svelte.js';
	import { setUnsavedCheck } from '#lib/unsaved.js';
	import { canEdit, ROLE_NAMES } from '#lib/role-names.js';
	import { shareTokenIn } from '#lib/share-link.js';
	import { localDate } from '#lib/local-date.js';
	import { NEW_SITE_URL, OLD_SITE } from '#lib/old-site.js';
	import AccountMenu from '#lib/components/AccountMenu.svelte';
	import { composing } from '#lib/ime.js';
	import { joinText, reasonText, whyText } from '#lib/reason-text.js';
	import { droppedTexts } from '#lib/cloud-steps.svelte.js';
	import { m } from '#lib/paraglide/messages.js';
	import { isTextEntry, ownsKey } from '#lib/key-owner.js';
	import ActionDetail from '#lib/components/ActionDetail.svelte';
	import Bookmarks from '#lib/components/Bookmarks.svelte';
	import ActionForm from '#lib/components/ActionForm.svelte';
	import ConfirmList from '#lib/components/ConfirmList.svelte';
	import type CueGrid from '#lib/components/CueGrid.svelte';
	import CueOverlay from '#lib/components/CueOverlay.svelte';
	import RuleSummary from '#lib/components/RuleSummary.svelte';
	import Field, { fullView } from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
	import FormationEditor from '#lib/components/FormationEditor.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LanguagePicker from '#lib/components/LanguagePicker.svelte';
	import Modal, { modalOpen } from '#lib/components/Modal.svelte';
	import MemberPanel from '#lib/components/MemberPanel.svelte';
	import MemberPicker from '#lib/components/MemberPicker.svelte';
	import NewFlowForm from '#lib/components/NewFlowForm.svelte';
	import NoticeToast from '#lib/components/NoticeToast.svelte';
	import NowEightCount from '#lib/components/NowEightCount.svelte';
	import Practice from '#lib/components/Practice.svelte';
	import UnsentLogout from '#lib/components/UnsentLogout.svelte';
	import type { OfflineCopy } from '#lib/offline-store.js';
	import PrintSheet from '#lib/components/PrintSheet.svelte';
	import SegmentSettings from '#lib/components/SegmentSettings.svelte';
	import ShareDialog from '#lib/components/ShareDialog.svelte';
	import SquadBar from '#lib/components/SquadBar.svelte';
	import Timeline from '#lib/components/Timeline.svelte';
	import VideoExport from '#lib/components/VideoExport.svelte';
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
		/** 流程影片的量字：預設用 Canvas 量；jsdom 沒有 Canvas，測試換成假的。 */
		measure?: ComponentProps<typeof VideoExport>['measure'];
	}

	let { editor: given, toMeters, cellAt, waveXToSec, measure }: Props = $props();
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

	/** 首頁和帳號：登入的是誰、我的流程、還沒傳的紀錄、離線副本、登出（編輯器 module 握著）。 */
	const home = editor.home;
	onMount(() => void home.load(isOnline()));
	// 在首頁時（打開、回到首頁、網路換了）拿首頁要列的；離開首頁之後才回來的不算。
	$effect(() => {
		if (!home.account || flow) return;
		return home.refresh(online);
	});

	/** 有沒有網路（瀏覽器說的）：沒網路時新建不能存在雲端。 */
	const isOnline = () => typeof navigator === 'undefined' || navigator.onLine;
	let online = $state(isOnline());
	/** 新建表單「存在」選哪個（登入時才有這格）：預設雲端；沒網路時自動選這台。 */
	let saveTo = $state<'cloud' | 'here'>(isOnline() ? 'cloud' : 'here');
	onMount(() => {
		const changed = () => {
			online = isOnline();
			if (!online) saveTo = 'here';
		};
		window.addEventListener('online', changed);
		window.addEventListener('offline', changed);
		return () => {
			window.removeEventListener('online', changed);
			window.removeEventListener('offline', changed);
		};
	});
	/** 新建表單建好了：登入、選存在雲端就請伺服器建一支打開它，不然跟以前一樣是本機流程。 */
	function created(f: Flow) {
		if (home.account && online && saveTo === 'cloud') void editor.file.createCloud(f);
		else editor.file.create(f);
	}

	let openSegmentId = $state<string | null>(null);
	let settingsOpen = $state(false);
	/** 雲端流程的分享對話框開著。 */
	let shareOpen = $state(false);
	/** 點規則警告打開流程設定時，焦點要放的那一格（關掉時收掉）。 */
	let settingsFocus = $state<ComponentProps<typeof FlowSettings>['focus']>();
	/** 八拍表列印畫面開著：印的時候只印它，不印編輯畫面。 */
	let printOpen = $state(false);
	/** 輸出影片的對話框開著：輸出時不能改流程、不能播放。 */
	let videoOpen = $state(false);
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
	/** 開著的雲端流程：每一步送伺服器存（名字旁「存中…」「✓ 已存」）；本機流程是 null。 */
	const cloud = $derived(editor.file.cloud);
	/** 用分享連結看的（沒有權限，#251）：只能看、沒有練習頁、分享。 */
	const linkOnly = $derived(editor.file.linkOnly);
	/** 只能看：雲端流程有新版、斷線了、我是記錄者或檢視者、用分享連結看的。 */
	const viewOnly = $derived(!!cloud?.viewOnly || linkOnly);
	/** 被鎖成檢視模式之前在檢視模式嗎：解開（變寬、連回來）時回到原本的模式。 */
	let viewingBeforeLock = false;
	/** 前後八拍裡點了動作名字，捲到下面誰做這個動作（只在點的時候捲，換畫面時不捲走前後八拍）。手機、電腦同時只有一個在畫面上。 */
	let pickedDetail = $state<HTMLElement>();
	async function pickAction(id: string | null) {
		session.selectAction(id);
		await tick();
		if (id) pickedDetail?.scrollIntoView?.({ block: 'nearest' });
	}
	let locked = false;
	// 變窄就是檢視模式；變寬（iPad 轉成橫的）回到原本的模式。只能看的時候不能改
	$effect(() => {
		const lock = narrow || viewOnly;
		untrack(() => {
			if (lock && !locked) viewingBeforeLock = session.viewing;
			session.viewing = lock || viewingBeforeLock;
		});
		locked = lock;
	});
	/** 雲端流程還有沒送到的步時按「首頁」：先問（還有幾步）；沒有是 0。 */
	let leavingUnsent = $state(0);
	/** 上方列的「首頁」：雲端流程還有沒送到的步先問，沒有就直接回去。 */
	function goHome() {
		if (cloud?.unsent) leavingUnsent = cloud.unsent;
		else void editor.file.leaveToHome();
	}
	/** 這次是從分享連結（網址 #share=…）打開的：回首頁時把網址上的連結拿掉，重新整理才不會又打開。 */
	let fromLink = $state(false);
	/** 分享連結的流程還在跟伺服器拿（流程、音樂）：先顯示「正在打開」，不先跳首頁。 */
	let openingLink = $state(false);
	onMount(() => {
		// app.html 在程式跑起來之前先把畫面藏起來（免得閃一下首頁），這裡接手
		delete document.documentElement.dataset.openingLink;
		const token = shareTokenIn(location.hash);
		if (!token) return;
		openingLink = true;
		void editor.file
			.openLink(token)
			.then(() => (fromLink = true))
			.finally(() => (openingLink = false));
	});
	$effect(() => {
		if (!fromLink || flow) return;
		history.replaceState(history.state, '', location.pathname + location.search);
		fromLink = false;
	});
	/** 誰開著的頭像顏色：照使用者 id 一人一個（同一個人換分頁、重新整理還是同一個顏色）。 */
	const FACE_COLORS = ['#1d4ed8', '#be185d', '#047857', '#b45309', '#6d28d9', '#0e7490', '#b91c1c', '#4d7c0f'];
	const faceColor = (userId: number) => FACE_COLORS[userId % FACE_COLORS.length];
	// 換編輯、檢視模式：告訴伺服器（別人的在場名單寫「編輯中」「檢視中」，#253）
	$effect(() => {
		cloud?.setEditing(!session.viewing);
	});
	/** 「我」：手機檢視畫面標亮的人。這台裝置照流程記住（local-settings），不進流程檔；換流程時讀那支的。 */
	let me = $state(session.flow ? loadFlowSetting('me', session.flow.name) : '');
	/** 「我」還在名單裡才算（教練刪了那個人就沒有）。 */
	const myId = $derived(flow?.members.some((m) => m.id === me) ? me : '');
	function pickMe(id: string) {
		me = id;
		if (flow) saveFlowSetting('me', flow.name, id);	}
	/** 手機的檢視畫面場地外圍框外的號碼條留多寬（公尺）：比電腦的窄，場地畫得比較大；站在外圍邊上的人會蓋到條號、格號。 */
	const PHONE_NUMBER_BAND = 0.7;
	/** 手機的檢視畫面點到的人：場地左下角寫他的名字和這個八拍做什麼。點空白處、切到練習、換流程就收掉。 */
	let tappedId = $state<string | null>(null);
	/** 點到的人的八拍表：只跟著流程和點到誰重算，播放頭動不用重算。 */
	const tappedRows = $derived(flow && tappedId ? eightCountRows(flow, tappedId, false) : []);
	const tappedWho = $derived(
		flow && tappedId && flow.members.some((m) => m.id === tappedId) ? whyText(memberNowWhy(flow, tappedId, playback.sec, tappedRows)) : ''
	);
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
		return { text: m.home_last_edited({ time: draftTime(f.savedAt, sameMinute) }), twin: twins.length > 0 };
	}

	/** 切到編排或練習。練習時不放音樂，先停下來。 */
	function setView(next: 'edit' | 'practice') {
		if (next === 'practice') playback.pause();
		tappedId = null;
		// 全上表改過格子：先問（session.practiceLeave），丟掉才切
		if (next === 'edit' && view === 'practice') session.leavePracticePage(() => (view = next));
		else view = next;
	}

	/** 整個流程的撞位；只跟著流程重算，播放頭動不用重算。場地和泳道共用這一份。 */
	const allClashes = $derived(flow ? clashes(flow) : []);

	/**
	 * 場上的影子、走位線和撞位：播放頭在站位 B 上（不是開頭那張）畫上一張的影子和這段的走位線、撞位；
	 * 在兩張站位中間只畫這段的撞位（走位線只在站位那一拍畫）；開頭那張、最後一張之後都不畫。
	 */
	const trail = $derived.by(() => {
		const none = { ghosts: {} as Record<string, Position>, walks: [] as FormationWalk[], clashes: [] as Clash[] };
		if (!flow) return none;
		const span = walkSpanAt(flow, playback.sec);
		if (!span) return none;
		return {
			ghosts: span.on ? span.from.pos : none.ghosts,
			walks: span.on ? formationWalks(flow, span.to.id) : none.walks,
			clashes: allClashes.filter((c) => c.formationId === span.to.id)
		};
	});

	/** 播放頭的位置拆成段名和段內位置，上方列分開排大小字；在結尾只有「結尾」（at 是空的）。 */
	const position = $derived.by(() => {
		const why = flow ? positionWhy(flow, playback.sec) : '';
		if (!why) return null;
		return typeof why === 'object' && why.code === 'time_in_segment'
			? { segment: whyText(why.segment), at: whyText(why.at) }
			: { segment: whyText(why), at: '' };
	});

	/**
	 * 延遲校正欄位送出（離開欄位或按 Enter）：清空、不是數字就回到現在的值；超出 ±MAX_LATENCY_MS 就夾到邊上，提示範圍。
	 */
	function applyLatency(input: HTMLInputElement) {
		const ms = input.valueAsNumber;
		const used = Number.isNaN(ms) ? playback.latencyMs : Math.min(Math.max(ms, -MAX_LATENCY_MS), MAX_LATENCY_MS);
		playback.setLatency(used);
		input.value = String(used);
		if (!Number.isNaN(ms) && used !== ms) session.notice = m.editor_latency_clamped({ max: MAX_LATENCY_MS, used });
	}

	/** 「重複」滑鼠移上去的說明：照現在按下去會怎樣寫。 */
	function repeatTitle(): string {
		if (playback.range?.b != null) return m.editor_repeat_range();
		if (playback.canRepeat) return m.editor_repeat_action();
		return m.editor_repeat_hint();
	}

	/** 播放列的「⋯」小窗（延遲校正；手機還有回開頭、節拍器、重複）：平常收著，不佔播放列的位置。 */
	let moreOpen = $state(false);
	let moreBtn = $state<HTMLButtonElement>();
	/** 播放列上的書籤（電腦）：按 / 打開找書籤。 */
	let bookmarkBar = $state<ReturnType<typeof Bookmarks>>();

	/** 點外面、按 Esc 就關；按 Esc 的話焦點回到「⋯」。 */
	function closeMore(by: 'outside' | 'escape') {
		moreOpen = false;
		if (by === 'escape') moreBtn?.focus();
	}

	/**
	 * 上方列最左邊的「選單」：不常按的五樣（開啟流程檔、新建、輸出影片、流程設定、使用說明）收在這個小窗裡。
	 * 窄螢幕（手機）的上方列只有一排：開啟流程檔、回首頁、存檔、分享、誰開著、八拍表、使用說明都收在這裡。
	 */
	let menuOpen = $state(false);
	let menuBtn = $state<HTMLButtonElement>();
	/** 選單的「開啟流程檔」點的選檔欄位：放在小窗外面，小窗關了它還在，選好的檔才收得到。 */
	let menuFileInput = $state<HTMLInputElement>();

	/** 點外面、按 Esc 就關；按 Esc 的話焦點回到「選單」。 */
	function closeMenu(by: 'outside' | 'escape') {
		menuOpen = false;
		if (by === 'escape') menuBtn?.focus();
	}

	/** 點選單裡的一項：先關小窗、焦點放回「選單」（那一項馬上不見，對話框關掉後焦點回到這裡），再做那件事。 */
	function fromMenu(run: () => void) {
		menuOpen = false;
		menuBtn?.focus();
		run();
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
			jumpError = reasonText(read);
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
		tappedId = null;
		openSegmentId = null;
		settingsOpen = false;
		printOpen = false;
		shareOpen = false;
		// 一律回到「編排・編輯」，不沿用上一支的練習分頁、檢視模式（窄螢幕、只能看的照樣只能看）
		view = 'edit';
		viewingBeforeLock = false;
		session.viewing = narrow || viewOnly;
	};

	function undo() {
		if (session.undo()) restore(session.flow!);
	}

	function redo() {
		if (session.redo()) restore(session.flow!);
	}

	// 別人的改動（雲端流程，#253）：開著的表單不關；開著的段設定指到被刪掉的段才關掉並說原因
	session.onremote = (f, by) => {
		if (openSegmentId && !f.segments.some((s) => s.id === openSegmentId)) {
			restore(f);
			return m.editor_remote_deleted_segment({ by });
		}
	};
	/** 復原、重做按鈕的提示：下一步會退（做回）什麼、快捷鍵，和方向鍵連按移人只算一步。 */
	function stepTitle(which: 'undo' | 'redo', label: string, keys: string) {
		if (which === 'undo') return label ? m.editor_undo_step({ what: label, keys }) : m.editor_undo_step_bare({ keys });
		return label ? m.editor_redo_step({ what: label, keys }) : m.editor_redo_step_bare({ keys });
	}

	/** 疊在同一點的人：一組裡的名字、組和組之間照畫面的語言接起來（中文是「、」「；」）。 */
	function stackedNames(groups: { name: string }[][]): string {
		return joinText(
			groups.map((g) => joinText(g.map((p) => p.name))),
			m.members_problems
		);
	}

	/** 最近的流程那一列的小字（最後改的時間、另一個分頁正在編／還沒存）：照畫面的語言接起來（中文是「・」）。 */
	function recentMeta(parts: string[]): string {
		const shown = parts.filter(Boolean);
		return shown.length ? joinText(shown, m.home_meta) : '';
	}

	/** 首頁雲端流程列的「N 筆沒傳」。 */
	const unsentText = (n: number) => (n === 1 ? m.home_unsent_one : m.home_unsent)({ n });

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

	/** 段設定、流程設定、八拍表、輸出影片、「還沒存」的問題蓋在上面：底下的編輯畫面點不到、Tab 不到，快捷鍵也不動它。 */
	const overlayOpen = $derived(
		!!openSegmentId || settingsOpen || printOpen || videoOpen || editor.file.asking || !!editor.file.draftAsk
	);
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
		// 「還沒存」的問題開著時不退：問的是現在這支流程，退了再按「先存檔」會存到退回的版本。
		// 輸出影片時也不退：輸出時不能改流程
		if ((e.ctrlKey || e.metaKey) && (key === 'z' || (key === 'y' && e.ctrlKey))) {
			// 還沒送出的表單（標了 data-native-undo）裡打字的地方：⌘Z 交給瀏覽器退字
			if (isTextEntry(target) && target?.closest('[data-native-undo]')) return;
			e.preventDefault();
			if (!editor.file.asking && !videoOpen) undoKey(!(key === 'z' && !e.shiftKey));
			return;
		}
		// 空白鍵：焦點在打字的地方、選單、對話框裡時照一般網頁；其他時候（包括按鈕上）播放／暫停
		if (e.key === ' ') {
			// 元件自己用了空白鍵（例：隊員號碼的圓圈）就不播放
			if (e.repeat || e.defaultPrevented) return;
			// 對話框開著時只能暫停（播放自己管，頁面告訴它對話框有沒有開）
			// Shift＋空白鍵：停的時候做跟「停下來回到起播點」相反的事
			spaceUsed = !ownsKey(target, ' ') && playback.space(covered(), e.shiftKey);
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
		} else if (e.key === KEYS.bookmarkSearch.mac && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// 找書籤：只有電腦的播放列上有（手機沒有鍵盤）
			if (bookmarkBar?.openSearch()) e.preventDefault();
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
	<title>{flow ? m.page_title({ page: flow.name }) : m.editor_title()}</title>
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
			<label for="me-pick">{m.editor_me()}</label>
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
					aria-label={playback.playing ? m.editor_pause() : m.editor_play()}
					title={flow.segments.length ? m.editor_play_title() : m.editor_add_segment_first()}
					disabled={!flow.segments.length && !playback.playing}
					onclick={() => playback.toggle()}><Icon name={playback.playing ? 'pause' : 'play'} size={18} /></button
				>
				{#snippet board()}
					<span class="pos" aria-label={m.editor_position()}
						>{#if position}<span class="pos-seg">{position.segment}</span
							>{#if position.at}{' '}<span class="pos-at">{position.at}</span>{/if}{:else}<span class="pos-seg">{m.editor_no_segments()}</span>{/if}</span
					>
					<span class="clock">{clockText(playback.sec)} <i>/ {clockText(totalSeconds(flow))}</i></span>
				{/snippet}
				<!-- 節拍器、重複：電腦放在播放列上；手機的播放列只有一排，收在「⋯」裡 -->
				{#snippet toggles()}
					<label class="toggle metronome" title={m.editor_metronome_title()}>
						<input
							type="checkbox"
							checked={playback.metronome}
							onchange={(e) => playback.setMetronome(e.currentTarget.checked)}
						/>
						<Icon name="metronome" /><span class="short-hide">{m.editor_metronome()}</span>
					</label>
					<span class="repeat-group">
						<label class="toggle repeat" title={repeatTitle()}>
							<input
								type="checkbox"
								checked={playback.repeat}
								disabled={!playback.canRepeat}
								onchange={(e) => playback.setRepeat(e.currentTarget.checked)}
							/>
							<Icon name="repeat" /><span class="short-hide">{m.editor_repeat()}</span>
						</label>
						<!-- 重複範圍：A、B 放在播放頭（播放中也能按），✕ 拿掉 -->
						<button
							type="button"
							class="ab set-end"
							aria-label={m.editor_set_a()}
							title={!flow.segments.length || playback.canSetA ? m.editor_set_a() : m.editor_set_a_at_end()}
							disabled={!playback.canSetA}
							onclick={() => playback.setA()}>A</button
						>
						<button
							type="button"
							class="ab set-end"
							aria-label={m.editor_set_b()}
							title={playback.range ? (playback.canSetB ? m.editor_set_b() : m.editor_set_b_before_a()) : m.editor_set_a_first()}
							disabled={!playback.canSetB}
							onclick={() => playback.setB()}>B</button
						>
						<button type="button" class="ab" aria-label={m.editor_clear_range()} title={m.editor_clear_range()} disabled={!playback.range} onclick={() => playback.clearRange()}>✕</button>
					</span>
				{/snippet}
				{#if narrow}
					<!-- 手機跳時間（#228）：上一個／下一個八拍夾著時間；點時間打「3-1」跳過去。只是看，不改流程。「回開頭」在「⋯」裡 -->
					<button type="button" class="step" aria-label={m.editor_prev_eight()} onclick={() => playback.step(-1, true)}>‹</button>
					{#if jumpText === null}
						<button
							type="button"
							class="board"
							aria-label={m.editor_jump()}
							title={m.editor_jump_title()}
							disabled={!flow.segments.length}
							onclick={() => (jumpText = '')}>{@render board()}</button
						>
					{:else}
						<div class="jump-to">
							<input
								type="text"
								aria-label={m.editor_jump()}
								data-scratch
								placeholder={m.editor_jump_placeholder()}
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
					<button type="button" class="step" aria-label={m.editor_next_eight()} onclick={() => playback.step(1, true)}>›</button>
				{:else}
					<div class="board">{@render board()}</div>
					{@render toggles()}
					<!-- 換一支流程就重開：打到一半的書籤名字不帶過去 -->
					{#key opened}<Bookmarks place="bar" bind:this={bookmarkBar} />{/key}
				{/if}
				<select
					class="speed"
					aria-label={m.editor_speed()}
					title={m.editor_speed_title()}
					value={String(playback.rate)}
					onchange={(e) => playback.setRate(Number(e.currentTarget.value))}
				>
					{#each SPEEDS as rate (rate)}<option value={String(rate)}>{rate}x</option>{/each}
				</select>
				<button
					type="button"
					class="more"
					aria-label={m.editor_more_playback()}
					title={m.editor_latency()}
					aria-expanded={moreOpen}
					bind:this={moreBtn}
					onclick={() => (moreOpen = !moreOpen)}>⋯</button
				>
				<!-- 小窗放在「⋯」下面、右邊對齊；點外面（點「⋯」自己是開關）、按 Esc 就收（popover.svelte.ts） -->
				{#if moreOpen}
					<div
						class="more-pop"
						role="group"
						aria-label={m.editor_more_playback()}
						{@attach popover({ place: below(moreBtn!, { gap: 6, align: 'right', flip: true }), close: closeMore, inside: [moreBtn] })}
					>
						{#if narrow}
							<div class="more-play">
								<button
									type="button"
									aria-label={m.editor_to_start()}
									onclick={() => {
										moreOpen = false;
										playback.toStart();
									}}>⏮ {m.editor_to_start()}</button
								>
								{@render toggles()}
							</div>
							<hr />
						{/if}
						<label class="latency">
							<span class="latency-text">{m.editor_latency()}</span>
							<input
								type="number"
								aria-label={m.editor_latency_ms()}
								step="10"
								min={-MAX_LATENCY_MS}
								max={MAX_LATENCY_MS}
								value={playback.latencyMs}
								onchange={(e) => applyLatency(e.currentTarget)}
								onkeydown={(e) => {
									if (e.key === 'Enter') applyLatency(e.currentTarget);
								}}
							/>
							<span class="unit" aria-hidden="true">{m.editor_ms()}</span>
						</label>
						<p class="more-hint">{m.editor_latency_hint()}</p>
						<label class="return-on-stop">
							<input
								type="checkbox"
								checked={playback.returnOnStop}
								onchange={(e) => playback.setReturnOnStop(e.currentTarget.checked)}
								onkeydown={(e) => {
									// 小窗裡的勾選框：空白鍵照一般網頁勾、取消勾，不給頁面拿去播放
									if (e.key === ' ') e.stopPropagation();
								}}
							/>
							<span>{m.editor_return_on_stop()}</span>
						</label>
						<p class="more-hint">{m.editor_return_on_stop_hint()}</p>
					</div>
				{/if}
			</div>
		{/snippet}
		<!-- 鍵盤用的捷徑：上方列、場地、右邊欄要按很多下 Tab 才到時間軸。平常藏著，Tab 到它才出現。 -->
		{#if view === 'edit' && !narrow}
			<button type="button" class="skip" onclick={() => timelineHost?.focus()}>{m.editor_skip_timeline()}</button>
		{/if}
		<!-- 檢視模式時上方列換成紫色：整個畫面一看就知道現在只能看 -->
		<header class="topbar" class:viewing={session.viewing && view === 'edit' && !narrow} bind:this={topbar}>
			<div class="title">
				<!-- 窄螢幕的「選單」只畫圖示：上方列只有一排，字留給流程名字 -->
				<button
					type="button"
					class="menu"
					title={m.editor_menu()}
					aria-haspopup="dialog"
					aria-expanded={menuOpen}
					bind:this={menuBtn}
					onclick={() => (menuOpen = !menuOpen)}><Icon name="menu" /><span class={narrow ? 'sr-only' : 'tight-hide'}>{m.editor_menu()}</span></button
				>
				<!-- 小窗放在「選單」下面、左邊對齊；跟「⋯」小窗一樣：點外面（點「選單」自己是開關）、按 Esc 就收（popover.svelte.ts）。
				     是 dialog（跟 aria-haspopup 一樣）：Tab 到裡面的項目按空白鍵是按下它，不拿去播放（key-owner.ts） -->
				{#if menuOpen}
					<div
						class="menu-pop"
						role="dialog"
						aria-label={m.editor_menu()}
						{@attach popover({ place: below(menuBtn!, { gap: 6, align: 'left', flip: true }), close: closeMenu, inside: [menuBtn] })}
					>
						{#if narrow}
							<!-- 窄螢幕（手機的檢視畫面、練習）上方列只有一排：開啟、回首頁、存檔、分享、八拍表都收在這裡。不能編，沒有新建、流程設定 -->
							{#if cloud || linkOnly}
								<!-- 雲端流程每一步都存了：沒有開啟、存檔 -->
								<button type="button" onclick={() => fromMenu(goHome)}><Icon name="home" />{m.back_home()}</button>
								{#if cloud}
									<button type="button" onclick={() => fromMenu(() => (shareOpen = true))}><Icon name="people" />{m.editor_share()}</button>
								{/if}
								<!-- 誰開著（#253）：上方列放不下頭像，一人一行寫名字和在編輯還是檢視；自己不列 -->
								{#if cloud?.present.length}
									<ul class="present-rows" aria-label={m.editor_present()}>
										{#each cloud.present as p (p.userId)}
											<li>
												<span class="present-face" style:--face={faceColor(p.userId)} aria-hidden="true">{p.name.slice(0, 1)}</span>
												{p.editing ? m.editor_present_editing({ name: p.name }) : m.editor_present_viewing({ name: p.name })}
											</li>
										{/each}
									</ul>
								{/if}
							{:else}
								<!-- 同一下點擊裡點選檔欄位：瀏覽器要使用者剛點過才肯跳選檔 -->
								<button type="button" onclick={() => fromMenu(() => menuFileInput?.click())}><Icon name="open" />{m.editor_open_file()}</button>
								<!-- 窄螢幕不能編，「新建」換成「回首頁」：這支留在草稿，列在最近的流程 -->
								<button type="button" onclick={() => fromMenu(() => editor.file.leaveToHome())}><Icon name="home" />{m.back_home()}</button>
								<!-- 練習的紀錄照樣要存 -->
								<button type="button" onclick={() => fromMenu(() => editor.file.save())}><Icon name="save" />{m.editor_save()}</button>
							{/if}
							<hr />
							<button type="button" onclick={() => fromMenu(() => (printOpen = true))}><Icon name="print" />{m.editor_eight_sheet()}</button>
						{:else}
							{#if cloud || linkOnly}
								<!-- 雲端流程每一步都存了：沒有開啟、新建，換成下載（擁有者、編輯者） -->
								{#if cloud && canEdit(cloud.role)}
									<button type="button" onclick={() => fromMenu(() => editor.file.download())}><Icon name="download" />{m.editor_download()}</button>
								{/if}
							{:else}
								<!-- 同一下點擊裡點選檔欄位：瀏覽器要使用者剛點過才肯跳選檔 -->
								<button type="button" onclick={() => fromMenu(() => menuFileInput?.click())}><Icon name="open" />{m.editor_open_file()}</button>
								<button type="button" onclick={() => fromMenu(() => editor.file.startNew())}><Icon name="new" />{m.editor_new()}</button>
							{/if}
							{#if view === 'edit'}
								<hr />
								<!-- 輸出影片只在電腦：觸控螢幕（iPad）不出現。檢視模式也能輸出（不改流程） -->
								{#if !touchScreen}
									<button
										type="button"
										title={flow.segments.length ? m.editor_export_video() : m.editor_add_segment_first()}
										disabled={!flow.segments.length}
										onclick={() =>
											fromMenu(() => {
												// 輸出時不能播放：在播的先停
												playback.pause();
												videoOpen = true;
											})}><Icon name="video" />{m.editor_export_video()}</button
									>
								{/if}
								<button type="button" disabled={!session.editable} onclick={() => fromMenu(() => (settingsOpen = true))}
									><Icon name="settings" />{m.editor_flow_settings()}</button
								>
							{/if}
						{/if}
						<hr />
						<a href={guideHref} target="_blank" rel="noopener" onclick={() => fromMenu(() => {})}><Icon name="help" />{m.editor_guide()}</a>
					</div>
				{/if}
				{#if !cloud && !linkOnly}
					<input
						bind:this={menuFileInput}
						class="menu-file"
						type="file"
						accept=".zip"
						aria-label={m.editor_open_file()}
						aria-hidden="true"
						tabindex="-1"
						onclick={pickOpen}
						onchange={open}
					/>
				{/if}
				<b title={flow.name}>{flow.name}</b>
				<!-- 登入時本機流程寫「這台」：分得出這支只在這台電腦、還沒傳上雲端 -->
				{#if home.account && !cloud && !linkOnly}<span class="here-tag" title={m.home_here_hint()}>{m.home_here()}</span>{/if}
				<!-- 「未存」的位置一直留著：出現時不把「編排｜練習」推走 -->
				<span class="unsaved-slot"
					>{#if cloud}{#if cloud.offline}<span class="cloud-offline">{editor.file.offlineAt !== null ? `⚠ ${m.editor_offline()}` : `⚠ ${m.editor_disconnected()}`}</span>{:else if !cloud.newVersion}<span class="cloud-saved"
								>{cloud.saving ? m.editor_saving() : `✓ ${m.editor_saved()}`}</span
							>{/if}{:else if unsaved}<span class="unsaved" title={m.editor_unsaved_title({ keys: both(KEYS.save) })}>{m.editor_unsaved()}</span>{/if}</span
				>
				<!-- 用分享連結看的沒有練習頁（看不到成功率） -->
				{#if !linkOnly}
					<div class="view" role="group" aria-label={m.editor_view_group()}>
						<button type="button" aria-pressed={view === 'edit'} onclick={() => setView('edit')}>{m.editor_arrange()}</button>
						<button type="button" aria-pressed={view === 'practice'} onclick={() => setView('practice')}>{m.editor_practice()}</button>
					</div>
				{/if}
			</div>

			<!-- 窄螢幕的上方列只有一排：播放區放在手機檢視畫面的場地下面，右邊的按鈕都收在選單裡 -->
			{#if !narrow}
			<!-- 播放區：在上方列中間 -->
			{@render transport()}

			<div class="actions">
				<!-- 練習時沒有復原、重做：復原只退編排的修改，在練習畫面看不到退了什麼，還可能弄掉紀錄 -->
				{#if view === 'edit'}
					<!-- 檢視模式：只能看、只能播放。改流程的指令由 session 擋下，不只是藏按鈕 -->
					<!-- 兩格都看得到，現在的那格是白的：一眼看得出現在是哪個模式、按哪裡換 -->
					<div class="mode" role="group" aria-label={m.editor_mode_group()}>
						<button type="button" aria-pressed={!session.viewing} title={m.editor_edit()} disabled={viewOnly} onclick={() => (session.viewing = false)}
							><Icon name="pencil" /><span class="tight-hide">{m.editor_edit()}</span></button
						>
						<button
							type="button"
							aria-pressed={session.viewing}
							title={m.editor_view_mode_title()}
							onclick={() => (session.viewing = true)}><Icon name="eye" /><span class="tight-hide">{m.editor_view()}</span></button
						>
					</div>
					<!-- 檢視時復原、重做不拿掉，只變灰：換模式時旁邊的按鈕不會跑 -->
					<button
						type="button"
						class="ghost"
						title={stepTitle('undo', session.undoLabel, both(KEYS.undo))}
						disabled={!session.editable || !session.canUndo}
						onclick={undo}
						><Icon name="undo" /><span class="sr-only">{m.editor_undo()}</span></button
					>
					<button
						type="button"
						class="ghost"
						title={stepTitle('redo', session.redoLabel, both(KEYS.redo))}
						disabled={!session.editable || !session.canRedo}
						onclick={redo}><Icon name="redo" /><span class="sr-only">{m.editor_redo()}</span></button
					>
					<span class="sep" aria-hidden="true"></span>
				{/if}
				<!-- 八拍表的字一直留著：使用說明都叫它「八拍表」，只有印表機圖示認不出來 -->
				<button type="button" class="ghost" title={m.editor_eight_sheet()} onclick={() => (printOpen = true)}
					><Icon name="print" /><span class="tightest-hide">{m.editor_eight_sheet()}</span></button
				>
				{#if cloud || linkOnly}
					<span class="sep" aria-hidden="true"></span>
					<!-- 雲端流程每一步都存了：沒有存檔，換成回首頁（下載在選單裡） -->
					<button type="button" class="ghost" onclick={goHome}><Icon name="home" />{m.editor_home()}</button>
					<!-- 誰開著（#253）：別人的頭像放在「分享」左邊，一人一個顏色，右下小圖示是在編輯（筆）還是檢視（眼睛）；自己不列 -->
					{#if cloud?.present.length}
						<ul class="present" aria-label={m.editor_present()}>
							{#each cloud.present as p (p.userId)}
								{@const doing = p.editing ? m.editor_present_editing({ name: p.name }) : m.editor_present_viewing({ name: p.name })}
								<li class="present-face" style:--face={faceColor(p.userId)} title={doing} aria-label={doing}>
									<span aria-hidden="true">{p.name.slice(0, 1)}</span>
									<span class="present-mode" aria-hidden="true"><Icon name={p.editing ? 'pencil' : 'eye'} size={10} /></span>
								</li>
							{/each}
						</ul>
					{/if}
					<!-- 放在原本存檔的地方；每個人都叫「分享」，不是擁有者打開是只能看的名單。用分享連結看的沒有 -->
					{#if cloud}
						<button type="button" class="primary" onclick={() => (shareOpen = true)}><Icon name="people" />{m.editor_share()}</button>
					{/if}
				{:else}
					<!-- 登入時存檔左邊：按了直接傳，不先問（傳上去不會弄丟東西） -->
					{#if home.account}
						<button type="button" class="ghost" title={m.editor_upload()} onclick={() => editor.file.upload()}
							><Icon name="cloud" /><span class="upload-text">{m.editor_upload()}</span></button
						>
					{/if}
					<button type="button" class="save primary" title={both(KEYS.save)} onclick={() => editor.file.save()}><Icon name="save" />{m.editor_save()}</button>
				{/if}
			</div>
			{/if}
			<!-- 斷網打開的離線副本（#261）：上方列下面一整條灰的，編排、練習、手機都看得到 -->
			{#if editor.file.offlineAt !== null}
				<p class="copy-bar" role="status" aria-label={m.editor_offline()}>
					{m.editor_offline_copy({ time: draftTime(new Date(editor.file.offlineAt)) })}
				</p>
			{/if}
		</header>

		<!-- 編排區和練習畫面：換一份流程就整個重開。時間軸、泳道、右邊欄的捲動，場地的放大，還沒送出的加隊員名單
		     都不帶到別的檔（跟著流程、切頁要留的放在 session.view） -->
		{#key opened}
		{#if narrow}
			{#if view === 'edit'}
				<!-- 手機的檢視畫面：上面場地、中間播放鈕、下面前後八拍（這個和下一個）。只能看、只能播放；場上的人拖不動 -->
				<main class="phone-view">
					<div class="phone-field">
						<!-- 點了場上的人：這裡換成寫他的名字和這個八拍做什麼；點空白的地方換回站位名稱 -->
						<div class="formation-now">{tappedWho || whyText(formationNowWhy(flow, playback.sec))}</div>
						<Field
							field={flow.field}
							members={flow.members}
							markers={memberMarkers(flow)}
							positions={positionsAt(flow, playback.sec)}
							levels={layersAt(flow, playback.sec)}
							controls={false}
							numberBand={PHONE_NUMBER_BAND}
							{toMeters}
							marked={myId ? [myId] : []}
							tapped={tappedWho ? tappedId : null}
							ontap={(id) => (tappedId = id)}
							ghosts={trail.ghosts}
							walks={trail.walks}
							clashes={trail.clashes}
						/>
					</div>
					{@render transport()}
					<!-- 書籤那排一定佔一格（沒有書籤就是 0 高），「我」、前後八拍才不會被擠到別格 -->
					<div class="phone-marks"><Bookmarks place="phone" /></div>
					<div class="phone-me">
						{@render mePicker(m.editor_me_hint_sheet())}
					</div>
					<!-- 手機放不下五列：只放這個八拍和下一個；點動作名字，誰做這個動作接在下面 -->
					<div class="phone-eights">
						<NowEightCount
							{flow}
							memberId={myId}
							sec={playback.sec}
							before={0}
							after={1}
							onjump={(s) => playback.seek(s)}
							picked={session.selectedActionId}
							onpick={pickAction}
						/>
						{#if session.selectedAction}
							<div bind:this={pickedDetail}>
								<ActionDetail {flow} action={session.selectedAction} />
							</div>
						{/if}
					</div>
					<!-- 跟電腦的檢視模式同一個叫法；括號裡是為什麼不能編（雲端流程有新版、斷線時寫那個） -->
					<p class="phone-why">
						<Icon name="eye" />{cloud?.newVersion ? m.cloud_new_version() : cloud?.offline ? m.cloud_offline() : whyViewOnly ? m.editor_view_only_why({ why: whyViewOnly }) : m.editor_view_only()}
					</p>
					<!-- 提示浮在畫面最下面，不疊在場地上：手機的場地沒有空的地方，放哪都會蓋到條號或「正面／裁判」（N52） -->
					<div class="phone-toasts">{@render noticeToast()}</div>
				</main>
			{/if}
		{:else}
			<main class="field-host" class:viewing={session.viewing} hidden={view === 'practice'} {@attach watchFieldHostH}>
				{#if session.viewing}
					<!-- 左上角一直寫播放頭這一刻的站位（有人往下一張走了寫要去的那張） -->
					<div class="formation-now">{whyText(formationNowWhy(flow, playback.sec))}</div>
					<!-- 場地框一圈黃色，右上角寫清楚：像 Notion 鎖住頁面時名字旁邊的「Locked」 -->
					<div class="view-badge">
						<Icon name="eye" />{cloud?.newVersion ? m.cloud_new_version() : cloud?.offline ? m.editor_disconnected_view() : m.editor_view_only()}
					</div>
				{/if}
				<Field
					field={flow.field}
					members={flow.members}
					markers={memberMarkers(flow)}
					positions={positionsAt(flow, playback.sec)}
					levels={layersAt(flow, playback.sec)}
					{toMeters}
					rail={session.editable}
					marked={!session.editable && myId ? [myId] : []}
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
									<label class="toggle-btn" title={m.editor_multi_select_title()}>
										<input type="checkbox" bind:checked={session.multiSelect} />{m.editor_multi_select()}
									</label>
									<button type="button" disabled={!session.anySelected} onclick={() => session.clearSelection()}>{m.editor_clear_selection()}</button>
								{/if}
								{#if timelineDivider.px !== null || inspectorDivider.px !== null}
									<button type="button" class="ghost" onclick={resetLayout}>{m.editor_reset_layout()}</button>
								{/if}
							</div>
						{/if}
					{/snippet}
					{#snippet railTop()}
						{#if flow}
							<FormationEditor />
						{/if}
						{#if warnings.length}
							<!-- 一條一行、有小標題；能改設定時點一條就打開流程設定，焦點在那條規則的數字 -->
							<ul class="warn" aria-label={m.editor_rule_warnings()}>
								{#each warnings as w (w.rule)}
									<li>
										{#if view === 'edit' && session.editable}
											<button
												type="button"
												title={m.editor_rule_warning_title()}
												onclick={() => {
													settingsFocus = w.rule;
													settingsOpen = true;
												}}
												><Icon name="warn" /><span><b>{whyText(w.title)}</b>{whyText(w.text)}</span></button
											>
										{:else}
											<span class="row"><Icon name="warn" /><span><b>{whyText(w.title)}</b>{whyText(w.text)}</span></span>
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
										}}><Icon name="warn" /><span><b>{m.editor_rules_off()}</b>{m.editor_rules_off_click()}</span></button
									>
								{:else}
									<span class="row"><Icon name="warn" /><span><b>{m.editor_rules_off()}</b>{m.editor_rules_off_hint()}</span></span>
								{/if}
							</div>
						{/if}
						{#if flow}
							<RuleSummary {flow} clashes={allClashes} />
						{/if}
						{#if flow}
							{@const stacked = stackedAt(flow, playback.sec)}
							{#if stacked.length}
								<p class="hint-warn" role="note">
									{m.editor_stacked({ names: stackedNames(stacked) })}
								</p>
							{/if}
							<CueOverlay {flow} />
						{/if}
					{/snippet}
				{#if flow.members.length === 0}
					<div class="field-empty">
						<b>{m.editor_field_empty()}</b>
						<span>{m.editor_field_empty_hint()}</span>
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

			<aside class="inspector" class:viewing={!session.editable} aria-label={m.editor_sidebar()} hidden={view === 'practice'}>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (可以聚焦、用 ←→ 調的分界，WAI-ARIA 的 separator 就是這樣用) -->
				<div
					class="col-split"
					role="separator"
					aria-orientation="vertical"
					aria-label={m.editor_sidebar_divider()}
					aria-valuenow={inspectorPx}
					aria-valuemin={INSPECTOR_MIN_PX}
					tabindex="0"
					title={m.editor_sidebar_divider_title()}
					{@attach inspectorDivider.attach}
				></div>
				<!-- svelte-ignore a11y_interactive_supports_focus (焦點在裡面的分頁上，←→ 從分頁冒上來；分頁列本身不用停) -->
				<div class="tabs" role="tablist" aria-label={m.editor_sidebar()} hidden={!session.editable} onkeydown={tabKey}>
					<button
						type="button"
						role="tab"
						id="tab-action"
						aria-selected={editor.inspectorTab === 'action'}
						aria-controls="panel-action"
						onclick={() => (editor.inspectorTab = 'action')}><Icon name="bolt" />{m.editor_skill()}</button
					>
					<button
						type="button"
						role="tab"
						id="tab-members"
						aria-selected={editor.inspectorTab === 'members'}
						aria-controls="panel-members"
						onclick={() => (editor.inspectorTab = 'members')}
						><Icon name="people" />{m.editor_athletes()}<span class="count">{flow.members.length}</span></button
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
						<div class="view-me">{@render mePicker(m.editor_me_hint_nearby())}</div>
						<NowEightCount
							{flow}
							memberId={myId}
							sec={playback.sec}
							before={1}
							after={3}
							onjump={(s) => playback.seek(s)}
							picked={session.selectedActionId}
							onpick={pickAction}
						/>
						{#if session.selectedAction}
							<div bind:this={pickedDetail}><ActionDetail {flow} action={session.selectedAction} /></div>
						{:else}
							<p class="view-hint">{m.editor_view_hint()}</p>
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
				aria-label={m.editor_timeline_divider()}
				aria-valuenow={timelineDivider.px ?? currentTimelineH()}
				aria-valuemin={TIMELINE_MIN_PX}
				tabindex="0"
				title={m.editor_timeline_divider_title()}
				{@attach timelineDivider.attach}
			></div>

			<section class="timeline-host" aria-label={m.editor_timeline()} tabindex="-1" hidden={view === 'practice'} bind:this={timelineHost}>
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
			<button type="button" onclick={goHome}>{m.back_home()}</button>
			<button type="button" onclick={() => (printOpen = true)}>{m.editor_see_eight_sheet()}</button>
			{#if !linkOnly}<button type="button" class="primary" onclick={() => setView('practice')}>{m.editor_go_practice()}</button>{/if}
		</div>
	{/snippet}
	<!-- 八拍表開著時收起來：從提示上的「看八拍表」打開的，關掉再回來。窄螢幕是手機的檢視畫面，不擋 -->
	{#if view === 'edit' && !printOpen && !narrow}
		<!-- iPad 拿直的：場地會被擠到看不見，請教練轉成橫的（只在觸控螢幕顯示） -->
		<section class="cover-hint rotate-hint" aria-labelledby="rotate-hint-title">
			<Icon name="fit" size={28} />
			<b id="rotate-hint-title">{m.editor_rotate_title()}</b>
			<span>{m.editor_rotate_hint()}</span>
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
	{#if videoOpen}
		<VideoExport {flow} {measure} onclose={() => (videoOpen = false)} />
	{/if}
	{#if shareOpen && editor.file.cloudId}
		<ShareDialog flowId={editor.file.cloudId} flowName={flow.name} onclose={() => (shareOpen = false)} />
	{/if}
	{#if printOpen}
		<PrintSheet
			{flow}
			selected={session.selectedMemberIds.length === 1 ? session.selectedMemberIds[0] : myId || null}
			onclose={() => (printOpen = false)}
		/>
	{/if}
	{#if editor.file.asking}
		{@const message = editor.file.askingToOpen ? m.editor_unsaved_open({ name: flow.name }) : m.editor_unsaved_leave({ name: flow.name })}
		<!-- 真的對話框：Escape、點背景＝取消，焦點先放在「取消」，關掉後回到按的按鈕 -->
		<Modal label={message} class="discard-box" onclose={() => editor.file.answer('cancel')}>
			{#snippet children()}
				<ConfirmList
					{message}
					items={[]}
					confirmLabel={m.editor_discard_continue()}
					onconfirm={() => editor.file.answer('discard')}
					extra={{ label: m.editor_save_first(), onclick: () => editor.file.answer('save') }}
					oncancel={() => editor.file.answer('cancel')}
					focusCancel
				/>
			{/snippet}
		</Modal>
	{/if}
	{#if editor.file.tooBig}
		{@const big = editor.file.tooBig}
		<Modal label={m.editor_too_big_title()} class="discard-box too-big" onclose={() => editor.file.dismissTooBig()}>
			{#snippet children()}
				<h2>{m.editor_too_big_title()}</h2>
				<p>{m.editor_too_big({ segment: big.segment, mb: big.mb })}</p>
				<div class="too-big-actions">
					<button type="button" class="primary" data-autofocus onclick={() => editor.file.dismissTooBig()}>{m.editor_got_it()}</button>
				</div>
			{/snippet}
		</Modal>
	{/if}
{:else}
	{#snippet startForm()}
		{#if narrow}
			<!-- 窄螢幕不能編：不放新建，最大的是「開啟流程檔」（docs/adr/0005-ipad-touch.md） -->
			<p class="home-view-only"><Icon name="eye" />{m.home_view_only()}</p>
		{:else}
			<NewFlowForm oncreate={created} extra={home.account ? whereField : undefined} />
		{/if}
		<div class="home-open">
			{#if !narrow}<span>{m.home_have_file()}</span>{/if}
			<label class="open btn" class:primary={narrow}><Icon name="open" />{m.editor_open_file()}<input type="file" accept=".zip" onclick={pickOpen} onchange={open} /></label>
		</div>
		{#if editor.file.openError}<p class="error" {@attach revealAlert(editor.file.openError)}>{editor.file.openError}</p>{/if}
	{/snippet}
	{#snippet whereField()}
		<fieldset class="where">
			<legend>{m.home_save_to()}</legend>
			<label
				><input type="radio" name="save-to" value="cloud" bind:group={saveTo} disabled={!online} /><b>{m.home_cloud()}</b>
				<small>{online ? m.home_cloud_hint() : m.home_cloud_offline()}</small></label
			>
			<label
				><input type="radio" name="save-to" value="here" bind:group={saveTo} /><b>{m.home_here()}</b>
				<small>{m.home_here_hint()}</small></label
			>
		</fieldset>
	{/snippet}
	{#snippet recentList()}
		<ul aria-labelledby="recent-title">
			{#each editor.file.recent as f (f.id)}
				<!-- 同名的不只一支：「丟掉」也寫最後改的時間，聽得出是哪一支 -->
				{@const { text: edited, twin } = recentEdited(f)}
				<li>
					<button type="button" class="recent-open" onclick={() => editor.file.openRecent(f.id)}>
						<span class="recent-name" title={f.name}>{f.name}</span>
						<span class="recent-meta"
							>{recentMeta([edited, f.busy ? m.home_busy() : f.unsaved ? m.home_unsaved() : ''])}</span
						>
					</button>
					<button type="button" class="link recent-drop" aria-label={m.home_discard_named({ which: twin ? m.home_quoted_when({ name: f.name, when: edited }) : m.home_quoted({ name: f.name }) })}
						onclick={() => (discarding = f)}>{m.home_discard()}</button
					>
				</li>
			{:else}
				<li class="empty">{m.home_none_yet()}</li>
			{/each}
		</ul>
		{#if editor.file.unsavedOverLimit}
			<p class="recent-note" role="status">
				{(editor.file.unsavedOverLimit === 1 ? m.home_unsaved_over_limit_one : m.home_unsaved_over_limit)({ n: editor.file.unsavedOverLimit })}
			</p>
		{/if}
		<p class="recent-note">{m.home_draft_note()}</p>
	{/snippet}
	{#if openingLink}
		<p class="opening-link" role="status">{m.home_opening_link()}</p>
	{:else if home.account}
		<!-- 登入後：兩欄，左邊清單（雲端、這台電腦），右邊新建、開啟流程檔；手機一欄，清單在上 -->
		<div class="home signed-in">
			{#if editor.file.revoked}
				<!-- 被收回回首頁：最上面一條黃的，右邊 × -->
				<p class="revoked" {@attach revealAlert()}>
					<span>{editor.file.revoked}</span>
					<button type="button" class="ghost icon" aria-label={m.home_dismiss()} onclick={() => editor.file.dismissRevoked()}><Icon name="close" /></button>
				</p>
			{/if}
			<header class="home-bar">
				<span class="brand">{m.app_name()}</span>
				<LanguagePicker />
				<a class="btn ghost" href={guideHref} target="_blank" rel="noopener"><Icon name="help" />{m.editor_guide()}</a>
				<AccountMenu me={home.account} onlogout={() => home.logout()} />
			</header>
			<div class="home-lists">
				<section class="area" aria-labelledby="cloud-title">
					<h2 id="cloud-title">{m.home_cloud()}</h2>
					{#if !online}
						<!-- 斷網（#261）：只列這台留著的離線副本，時間換成這台的是什麼時候的樣子 -->
						{@const mineCopies = home.copies.filter((c) => c.role === 'owner')}
						{@const sharedCopies = home.copies.filter((c) => c.role !== 'owner')}
						{@const hidden = home.knownCloudIds.filter((id) => !home.copyIds.has(id)).length}
						<p class="offline-bar">{m.home_offline_bar()}</p>
						{#snippet copyRow(c: OfflineCopy)}
							<li>
								<button type="button" class="recent-open" onclick={() => editor.file.openCloud(c.flowId)}>
									<span class="recent-name">{c.name}</span>
									<span class="recent-meta">{m.home_copy_time({ time: draftTime(new Date(c.savedAt)) })}</span>
									{#if home.unsentByFlow[c.flowId]}<span class="unsent-count">{unsentText(home.unsentByFlow[c.flowId])}</span>{/if}
									<span class="copy-tag">{m.home_offline_ok()}</span>
								</button>
							</li>
						{/snippet}
						{#if mineCopies.length}
							<h3 id="mine-title">{m.home_mine()}</h3>
							<ul class="cloud-list" aria-labelledby="mine-title">
								{#each mineCopies as c (c.flowId)}{@render copyRow(c)}{/each}
							</ul>
						{/if}
						{#if sharedCopies.length}
							<h3 id="shared-title">{m.home_shared()}</h3>
							<ul class="cloud-list" aria-labelledby="shared-title">
								{#each sharedCopies as c (c.flowId)}{@render copyRow(c)}{/each}
							</ul>
						{/if}
						{#if hidden}<p class="offline-more">{(hidden === 1 ? m.home_offline_more_one : m.home_offline_more)({ n: hidden })}</p>{/if}
					{:else}
						<h3 id="mine-title">{m.home_mine()}</h3>
						<ul class="cloud-list" aria-labelledby="mine-title">
							{#if home.cloudError}
								<li class="empty">{m.home_cloud_error()}</li>
							{:else if home.myFlows}
								{#each home.myFlows.mine as c (c.id)}
									<li>
										<button type="button" class="recent-open" onclick={() => editor.file.openCloud(c.id)}>
											<span class="recent-name">{c.name}</span>
											<span class="recent-meta">{m.home_edited_at({ time: draftTime(new Date(c.updatedAt)) })}</span>
											{#if home.unsentByFlow[c.id]}<span class="unsent-count">{unsentText(home.unsentByFlow[c.id])}</span>{/if}
											{#if home.copyIds.has(c.id)}<span class="copy-tag">{m.home_offline_ok()}</span>{/if}
										</button>
									</li>
								{:else}
									<li class="empty">{m.home_mine_empty()}</li>
								{/each}
							{/if}
						</ul>
						{#if home.myFlows}
							<h3 id="shared-title">{m.home_shared()}</h3>
							<ul class="cloud-list" aria-labelledby="shared-title">
								{#each home.myFlows.shared as c (c.id)}
									<li>
										<button type="button" class="recent-open" onclick={() => editor.file.openCloud(c.id)}>
											<span class="recent-name">{c.name}</span>
											<span class="recent-meta"
												>{c.ownerDisabled
													? m.home_shared_meta_disabled({ owner: c.ownerName, time: draftTime(new Date(c.updatedAt)) })
													: m.home_shared_meta({ owner: c.ownerName, role: ROLE_NAMES[c.role], time: draftTime(new Date(c.updatedAt)) })}</span
											>
											{#if home.unsentByFlow[c.id]}<span class="unsent-count">{unsentText(home.unsentByFlow[c.id])}</span>{/if}
											{#if home.copyIds.has(c.id)}<span class="copy-tag">{m.home_offline_ok()}</span>{/if}
										</button>
									</li>
								{:else}
									<li class="empty">{m.home_shared_empty()}</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</section>
				<section class="area recent" aria-labelledby="here-title">
					<h2 id="here-title">{m.home_this_computer()}</h2>
					<h3 id="recent-title">{m.home_recent()}</h3>
					{@render recentList()}
					<p class="recent-note" role="status">{discardNote}</p>
				</section>
			</div>
			<section class="start" class:narrow>{@render startForm()}</section>
		</div>
	{:else}
		{#if OLD_SITE}
			<!-- 舊網址版（#267）：最上面一整條黃的，右邊「到新網址」。不能登入，所以只會在沒登入的首頁 -->
			<p class="moved" role="note">
				<span
					>{m.home_moved({ host: new URL(NEW_SITE_URL).host })}</span
				>
				<a class="btn" href={NEW_SITE_URL}>{m.home_to_new_site()}</a>
			</p>
		{/if}
		<div class="home">
			<div class="home-top">
				<LanguagePicker />
				<a class="btn home-guide" href={guideHref} target="_blank" rel="noopener"><Icon name="help" />{m.editor_guide()}</a>
				{#if home.account === null && !OLD_SITE}
					<a class="btn" href={resolve('/login')}>{m.home_login()}</a>
				{/if}
			</div>
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
				<h1>{m.home_heading_top()}<br />{m.editor_title()}</h1>
				<p>
					{m.home_intro()}
				</p>
			</section>

			<section class="start" class:narrow>
				{@render startForm()}
				{#if editor.file.recent.length}
					<div class="recent">
						<h2 id="recent-title">{m.home_recent()}</h2>
						{@render recentList()}
					</div>
				{/if}
				<p class="recent-note" role="status">{discardNote}</p>
			</section>
		</div>
	{/if}
	{#if discarding}
		{@const f = discarding}
		{@const { text: edited, twin } = recentEdited(f)}
		{@const which = twin ? m.home_quoted_when({ name: f.name, when: edited }) : m.home_quoted({ name: f.name })}
		{@const message = f.unsaved ? m.home_discard_unsaved({ which }) : m.home_discard_saved({ which })}
		<Modal label={message} class="discard-box" onclose={() => (discarding = null)}>
			{#snippet children()}
				<ConfirmList
					{message}
					items={[]}
					confirmLabel={m.home_discard()}
					onconfirm={() => {
						const { id, name } = f; // 關掉對話框後 f 不能再讀（Svelte derived_inert）
						discarding = null;
						discardNote = '';
						void editor.file.discardRecent(id).then((outcome) => {
							discardNote = {
								dropped: m.home_dropped({ name }),
								busy: m.home_drop_busy({ name }),
								failed: m.home_drop_failed({ name })
							}[outcome];
						});
					}}
					oncancel={() => (discarding = null)}
					focusCancel
				/>
			{/snippet}
		</Modal>
	{/if}
{/if}
{#if editor.file.lost}
	{@const { rows, deleted } = editor.file.lost}
	{@const message =
		deleted === undefined
			? (rows.length === 1 ? m.editor_lost_revoked_one : m.editor_lost_revoked)({ n: rows.length })
			: (rows.length === 1 ? m.editor_lost_deleted_one : m.editor_lost_deleted)({ name: deleted, n: rows.length })}
	<!-- 被收回時還有沒傳的（#260）：擋住畫面，按「知道了」才丟掉、回首頁。首頁連上網路才發現被收回的（#261）也是這個框 -->
	<Modal label={message} class="dialog lost-box" onclose={() => {}}>
		{#snippet children()}
			<div class="lost">
				<h2>{message}</h2>
				<p>
					{deleted === undefined ? m.editor_lost_revoked_hint() : m.editor_lost_deleted_hint()}
				</p>
				<table>
					<thead><tr><th>{m.editor_date()}</th><th>{m.editor_skill()}</th><th>{m.editor_stunt_group()}</th><th>{m.editor_marks()}</th></tr></thead>
					<tbody>
						{#each rows as d (d.id)}
							{@const text = droppedTexts(d)}
							<tr>
								<td>{d.date}</td>
								<td>{text.action}</td>
								<td>{text.who}</td>
								<td>{d.marks}{#if d.runThrough}<small class="run">{m.editor_full_out()}</small>{/if}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<div class="buttons"><button type="button" class="primary" data-autofocus onclick={() => editor.file.lostKnown()}>{m.editor_got_it()}</button></div>
			</div>
		{/snippet}
	</Modal>
{/if}
{#if home.unsentAtLogout}
	<UnsentLogout flows={home.unsentAtLogout} onstay={() => home.stay()} ondiscard={() => home.signOut(true)} />
{/if}
{#if leavingUnsent}
	{@const n = leavingUnsent}
	{@const message = (n === 1 ? m.editor_leave_unsent_one : m.editor_leave_unsent)({ n })}
	<Modal label={message} class="discard-box" onclose={() => (leavingUnsent = 0)}>
		{#snippet children()}
			<ConfirmList
				{message}
				items={[]}
				confirmLabel={(n === 1 ? m.editor_leave_discard_one : m.editor_leave_discard)({ n })}
				cancelLabel={m.editor_stay()}
				cancelFirst
				onconfirm={() => {
					leavingUnsent = 0;
					void editor.file.leaveToHome();
				}}
				oncancel={() => (leavingUnsent = 0)}
				focusCancel
			/>
		{/snippet}
	</Modal>
{/if}
{#if editor.file.draftAsk}
	{@const ask = editor.file.draftAsk}
	{@const message = ask.savedAt
		? m.editor_draft_ask({ name: ask.name, time: draftTime(ask.savedAt) })
		: m.editor_draft_ask_no_time({ name: ask.name })}
	<Modal label={message} class="discard-box" onclose={() => editor.file.answerDraft('cancel')}>
		{#snippet children()}
			<ConfirmList
				{message}
				items={[]}
				confirmLabel={m.editor_use_file()}
				onconfirm={() => editor.file.answerDraft('file')}
				extra={{ label: m.editor_recover(), onclick: () => editor.file.answerDraft('draft') }}
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
	/* 手機的檢視畫面：上面場地（吃剩下的高度）、中間播放區、書籤（沒有就 0 高）、「我」、下面前後八拍（太長自己捲）。
	   前後八拍固定高（畫面夠高時 34dvh，夠放這個和下一個八拍的格子，放不下自己捲）：播放時換列、內容變長變短，場地和播放鈕不上下跳（#210） */
	.phone-view {
		position: relative;
		grid-column: 1 / -1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(160px, 1fr) auto auto auto minmax(0, 34dvh) auto;
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
	/* 手機的播放列：一排（播放、‹、時間、›、速度、⋯），場地才有地方畫大；時間那一格吃剩下的寬。
	   比 350px 還窄的手機放不下一排，才換行 */
	.phone-view .transport {
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		padding: 6px 8px;
		background: var(--ink);
	}
	/* 手機跳時間：上一個／下一個八拍（手指 40px）；時間本身是按鈕，點了換成打字的欄位 */
	.step {
		flex: none;
		width: 40px;
		height: 40px;
		padding: 0;
		background: transparent;
		border-color: #36425f;
		color: #c9d2e6;
		font-size: 20px;
	}
	button.board {
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.phone-view .board,
	.jump-to {
		flex: 1 1 96px;
		min-width: 0;
	}
	.phone-view .board {
		padding-inline: 8px;
		overflow: hidden;
	}
	.phone-view .speed {
		flex: none;
		padding-inline: 3px;
	}
	.phone-view .more {
		flex: none;
		min-width: 40px;
		min-height: 40px;
	}
	.jump-to {
		display: grid;
		gap: 4px;
	}
	/* 手機「⋯」裡的回開頭、節拍器、重複：手指 40px 高，放不下就換行 */
	.more-play {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.more-play > button {
		min-height: 40px;
		background: transparent;
		border-color: #36425f;
		color: #c9d2e6;
		white-space: nowrap;
	}
	.more-play :is(.toggle, .ab) {
		min-height: 40px;
	}
	.more-play .ab {
		min-width: 40px;
	}
	.more-pop hr {
		width: 100%;
		margin: 2px 0;
		border: 0;
		border-top: 1px solid #36425f;
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
	.phone-marks {
		min-width: 0;
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
	/* 前後八拍和點到的動作一起捲 */
	.phone-eights {
		min-height: 0;
		max-height: 38dvh;
		overflow-y: auto;
		background: var(--surface);
	}
	.phone-eights :global(.now-eight) {
		overflow: visible;
	}
	/* 手機上的小字至少 13px（T19）：這一列的站位、走位小標 */
	.phone-eights :global(.now-eight .tag) {
		font-size: 13px;
	}
	.phone-eights :global(.action-detail) {
		padding: 8px 12px 12px;
		border-top: 1px solid var(--line);
	}
	/* 手機橫拿：場地在左、播放區和八拍表在右，場地才不會被擠扁 */
	@media (orientation: landscape) {
		.phone-view {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-rows: auto auto auto minmax(0, 1fr) auto;
		}
		.phone-view > :global(*) {
			grid-column: 2;
		}
		.phone-view > .phone-field {
			grid-column: 1;
			grid-row: 1 / -1;
		}
		.phone-eights {
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
	/* 斷網打開的離線副本：上方列下面一整條灰的（上方列的最後一行，貼齊左右、下緣） */
	.copy-bar {
		grid-column: 1 / -1;
		grid-row: 2;
		margin: 0 -12px -8px -16px;
		padding: 4px 16px;
		background: #e2e8f0;
		color: #334155;
		font-size: 13px;
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
	.cloud-saved {
		color: #b8c4dc;
		white-space: nowrap;
	}
	.cloud-offline {
		color: #fcd34d;
		white-space: nowrap;
	}
	/* 登入時本機流程的小標「這台」 */
	.here-tag {
		flex: none;
		font-size: 11px;
		color: #b8c4dc;
		border: 1px solid #4a5878;
		border-radius: 4px;
		padding: 0 5px;
		white-space: nowrap;
	}
	.present {
		display: flex;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.present-face {
		position: relative;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--face);
		color: #fff;
		font-size: 13px;
		font-weight: 700;
	}
	.present-mode {
		position: absolute;
		right: -3px;
		bottom: -3px;
		display: grid;
		place-items: center;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: #fff;
		color: var(--face);
		box-shadow: 0 0 0 1px var(--face);
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
	/* 重複按不下去（沒有重複範圍、沒選動作）：虛線框、淡字 */
	.toggle:has(input:disabled) {
		border-style: dashed;
		color: #6b7896;
		cursor: not-allowed;
	}
	.repeat-group {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.ab {
		min-width: 26px;
		height: 26px;
		padding: 0 6px;
		border-radius: 999px;
		border: 1px solid #36425f;
		background: transparent;
		color: #c9d2e6;
		font-size: 12px;
		font-weight: 700;
	}
	.ab:disabled {
		color: #5d6985;
		border-color: #2c3651;
	}
	@media (pointer: coarse) {
		.ab {
			min-width: 32px;
			height: 32px;
		}
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
	.more-pop,
	.menu-pop {
		/* 開在最上層（popover）：蓋掉瀏覽器給 popover 的置中、框線、顏色；跟上方列一樣深底 */
		position: fixed;
		inset: auto;
		margin: 0;
		display: grid;
		width: max-content;
		border: 1px solid #36425f;
		border-radius: 8px;
		background: var(--ink);
		box-shadow: var(--shadow-pop);
	}
	.more-pop {
		gap: 6px;
		max-width: min(280px, 80vw);
		padding: 10px 12px;
		color: #c9d2e6;
	}
	/* 上方列最左邊的「選單」：跟旁邊的按鈕一樣透明底，開著時看得出是按下的 */
	.menu {
		flex: none;
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 0;
		background: none;
		color: #d6ddec;
	}
	.menu:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.menu[aria-expanded='true'] {
		background: #24304c;
		color: #fff;
	}
	/* 選單的小窗：跟「⋯」小窗同一個樣子；一項一行（圖示＋字），組和組中間一條線 */
	.menu-pop {
		gap: 2px;
		min-width: 168px;
		/* 橫拿的手機很矮，誰開著的人一多會超出畫面：捲得到下面的項目 */
		max-height: calc(100dvh - 64px);
		overflow-y: auto;
		padding: 6px;
		color: #d6ddec;
	}
	.menu-pop button,
	.menu-pop a {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 8px;
		padding: 6px 10px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 14px;
		text-align: left;
		text-decoration: none;
	}
	.menu-pop button:hover:not(:disabled),
	.menu-pop a:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.menu-pop button:disabled {
		color: #8b99b8;
	}
	.menu-pop hr {
		width: 100%;
		margin: 4px 0;
		border: 0;
		border-top: 1px solid #36425f;
	}
	/* 手指：選單裡的連結也跟按鈕一樣至少 40px 高（app.css 只管按鈕） */
	@media (pointer: coarse) {
		.menu-pop a {
			min-height: 40px;
		}
	}
	/* 選單「開啟流程檔」點的選檔欄位：看不到、Tab 不到，由那一項去點它 */
	.menu-file {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.more-hint {
		margin: 0;
		font-size: 11px;
		color: #8b99b8;
	}
	.return-on-stop {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
		padding-top: 8px;
		border-top: 1px solid #36425f;
		font-size: 12px;
		cursor: pointer;
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
	.actions :global(button.ghost) {
		color: #d6ddec;
	}
	.actions :global(button.ghost:hover) {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.actions .save {
		margin-left: 4px;
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
	/* 左欄（場地左邊）的東西：警告。 */
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
		/* 英文比較長，放不下就換行（按鈕預設不換行） */
		white-space: normal;
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
	/* 檢視模式的站位名稱：場地左上角，白底深字 */
	.formation-now {
		position: absolute;
		top: 18px;
		left: 22px;
		z-index: 5;
		max-width: calc(100% - 44px);
		padding: 6px 12px;
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-weight: 700;
		font-size: 14px;
		box-shadow: 0 2px 8px rgba(22, 33, 58, 0.15);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		pointer-events: none;
	}
	/* 手機：上面是條號，放左下角（「正面／裁判」在中間） */
	.phone-field .formation-now {
		top: auto;
		bottom: 8px;
		left: 8px;
		max-width: calc(100% - 24px);
		padding: 4px 10px;
		font-size: 13px;
		/* 名字很長、手機很窄：換行，動作和角色才不會被「…」藏起來 */
		white-space: normal;
		overflow-wrap: anywhere;
		border-radius: 12px;
	}
	/* 放大了，右下角有「整個場地」：字只寫到它左邊 */
	.phone-field:has(:global(.fit)) .formation-now {
		max-width: calc(100% - 140px);
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
	/* 傳上雲端時音樂檔太大的框 */
	.too-big-actions {
		display: flex;
		justify-content: flex-end;
	}
	:global(.too-big) h2 {
		margin: 0;
		font-size: 15px;
	}
	:global(.too-big) p {
		margin: 0;
		font-size: 13px;
	}
	:global(.too-big) {
		display: grid;
		gap: 10px;
		padding: 14px 16px;
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

	/* ---------- 上方列永遠一行（#280）：電腦、橫拿的 iPad ----------
	   視窗窄的時候不換行，字照這個順序收成圖示（只看寬度，不看高矮）：
	   1600px 以下節拍器、重複；1300px 以下選單、編輯、檢視；1100px 以下八拍表（觸控也一樣：橫拿的 iPad 1180 寬放得下）。
	   一直有字的：編排｜練習、存檔、流程名字。收掉字的按鈕都有 title，報讀軟體照樣讀得到字。
	   窄螢幕（手機檢視畫面）不走這裡，照下面「窄螢幕」那幾段。 */

	/* 只給報讀軟體讀的字：復原、重做一律只有圖示（滑鼠移上去寫會復原什麼和快捷鍵） */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (max-width: 1600px) {
		:where(.editor:not(.narrow)) .short-hide {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
	@media (max-width: 1300px) {
		:where(.editor:not(.narrow)) .tight-hide {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
	@media (max-width: 1100px) {
		:where(.editor:not(.narrow)) .tightest-hide {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
	/* 一行放得下：間距、時間那一格、重複旁邊的 A、B、✕ 收小一點（流程名字才至少露出 3 個字） */
	@media (max-width: 1760px) {
		:where(.editor:not(.narrow)) .topbar {
			gap: 8px;
		}
		:where(.editor:not(.narrow)) .transport {
			gap: 4px;
		}
		:where(.editor:not(.narrow)) .toggle {
			padding-inline: 8px;
		}
		:where(.editor:not(.narrow)) .board {
			min-width: 132px;
			padding-inline: 8px;
		}
		:where(.editor:not(.narrow)) .repeat-group {
			gap: 2px;
		}
	}
	/* 滑鼠才收窄，手指照樣至少 32px */
	@media (max-width: 1760px) and (pointer: fine) {
		:where(.editor:not(.narrow)) .ab {
			min-width: 22px;
			padding-inline: 4px;
		}
	}
	/* 1180 寬以下（橫拿的 iPad 1180×820）：分隔線不留空、只有圖示的按鈕左右收小（還是至少 32px，手指點得到） */
	@media (max-width: 1180px) {
		:where(.editor:not(.narrow)) .sep {
			margin: 0;
		}
		:where(.editor:not(.narrow)) .actions :global(button.ghost) {
			padding-inline: 7px;
		}
	}
	/* 1280 寬以下（滑鼠）：只有圖示的按鈕左右再收小 */
	@media (max-width: 1280px) and (pointer: fine) {
		:where(.editor:not(.narrow)) .actions :global(button.ghost) {
			padding-inline: 5px;
		}
	}
	/* 1024 寬（滑鼠、手指）和觸控的 1180 寬：「編排｜練習」、速度、「⋯」、名字那一欄左右收小 */
	@media (max-width: 1100px), (max-width: 1180px) and (pointer: coarse) {
		:where(.editor:not(.narrow)) .view button {
			padding-inline: 8px;
		}
		:where(.editor:not(.narrow)) .speed {
			padding-inline: 3px;
		}
		:where(.editor:not(.narrow)) .more {
			padding-inline: 7px;
		}
		:where(.editor:not(.narrow)) .title {
			gap: 6px;
		}
	}
	/* 1024 寬（滑鼠）：右邊的按鈕、名字那一欄靠緊一點，A、B、✕ 再窄一點，流程名字才至少露出 3 個字（N55） */
	@media (max-width: 1100px) and (pointer: fine) {
		:where(.editor:not(.narrow)) .actions {
			gap: 2px;
		}
		:where(.editor:not(.narrow)) .title {
			gap: 4px;
		}
		:where(.editor:not(.narrow)) .ab {
			min-width: 20px;
			padding-inline: 3px;
		}
	}
	/* 1024 寬（手指）：A、B 各要 32px，右邊的按鈕會擠出畫面、流程名字被擠掉。
	   藏起 A、B（用手指在八拍尺上面那一條拖出範圍）；✕ 留著，才拿得掉範圍。右邊的按鈕、名字那一欄靠緊，
	   只有圖示的按鈕從 40px 寬收成 34px（手指照樣至少 32px）。 */
	@media (max-width: 1100px) and (pointer: coarse) {
		:where(.editor:not(.narrow)) .set-end {
			display: none;
		}
		:where(.editor:not(.narrow)) .actions {
			gap: 2px;
		}
		:where(.editor:not(.narrow)) .title {
			gap: 4px;
		}
		:where(.editor:not(.narrow)) .topbar .actions :global(button.ghost),
		:where(.editor:not(.narrow)) .topbar .more,
		:where(.editor:not(.narrow)) .topbar .ab {
			min-width: 34px;
			padding-inline: 5px;
		}
	}

	/* ---------- 窄螢幕（手機檢視畫面、練習）：上方列只有一排 ----------
	   選單（只畫圖示）、流程名字、「編排｜練習」；其他按鈕都收在選單裡，場地才有地方畫大。
	   播放區不在上方列裡（在場地下面）。 */
	.editor.narrow .topbar {
		grid-template-columns: minmax(0, 1fr);
		gap: 8px;
		padding: 6px 12px;
	}
	.editor.narrow .title {
		align-items: center;
		gap: 8px;
	}
	/* 名字吃剩下的寬，放不下用「…」；「編排｜練習」不被擠掉 */
	.editor.narrow .title b {
		flex: 1 1 0;
		min-width: 2em;
	}
	.editor.narrow .menu {
		justify-content: center;
		width: 40px;
		height: 40px;
		padding: 0;
	}
	.editor.narrow .view button {
		padding-inline: 8px;
	}
	.editor.narrow .copy-bar {
		margin: 0 -12px -6px;
		padding: 4px 12px;
	}
	/* 選單裡的「誰開著」：一人一行，頭像旁邊寫名字和在編輯還是檢視 */
	.present-rows {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 6px 10px;
		list-style: none;
		font-size: 14px;
	}
	.present-rows li {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	@media (max-width: 1280px) {
		/* 登入時本機流程多的「傳上雲端」只留圖示（滑過去看得到字），流程名字才不會被擠掉 */
		.upload-text {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* ---------- 首頁 ---------- */
	.opening-link {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--muted);
	}
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
	.home-top {
		position: absolute;
		top: 16px;
		right: 16px;
		display: flex;
		gap: 8px;
	}
	.home-top > a {
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
	.recent ul,
	.cloud-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 6px;
	}
	.recent li,
	.cloud-list li {
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
	/* 這台還沒傳的成功率紀錄（#260） */
	.unsent-count {
		flex: none;
		padding: 0 6px;
		border-radius: 4px;
		background: #fef3c7;
		color: #92400e;
		font-size: 12px;
		font-weight: 700;
	}
	/* 這台有離線副本（#261） */
	.copy-tag {
		flex: none;
		padding: 0 6px;
		border-radius: 4px;
		background: #e2e8f0;
		color: #334155;
		font-size: 12px;
	}
	/* 斷網時雲端那塊上面一條灰的、最下面看不到幾支 */
	.offline-bar {
		margin: 0 0 8px;
		padding: 6px 10px;
		border-radius: 6px;
		background: #e2e8f0;
		color: #334155;
		font-size: 13px;
	}
	.offline-more {
		margin: 8px 0 0;
		color: #64748b;
		font-size: 13px;
	}
	/* 被收回時沒傳的（#260）：擋住畫面的框 */
	:global(.lost-box) {
		width: min(480px, 100%);
		border-radius: 10px;
		box-shadow: var(--shadow-pop);
	}
	.lost {
		display: grid;
		gap: 10px;
		padding: 18px;
	}
	.lost h2 {
		margin: 0;
		font-size: 17px;
		color: #991b1b;
	}
	.lost p {
		margin: 0;
	}
	.lost table {
		border-collapse: collapse;
		font-size: 13px;
	}
	.lost th,
	.lost td {
		padding: 2px 12px 2px 0;
		text-align: left;
	}
	.lost .run {
		margin-left: 4px;
		color: var(--muted);
	}
	.lost .buttons {
		display: flex;
		justify-content: flex-end;
	}
	.recent-drop {
		color: var(--muted);
		font-size: 12px;
	}
	.recent-note {
		color: var(--muted);
		font-size: 12px;
	}
	.empty {
		color: var(--muted);
		font-size: 13px;
	}

	/* ---------- 登入後的首頁：兩欄（左邊清單、右邊新建），最上面一條 ---------- */
	.home.signed-in {
		grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
		grid-template-rows: auto 1fr;
		gap: 24px 40px;
		max-width: 1100px;
		padding: 0 24px 48px;
	}
	.home-bar {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.home-bar > a {
		text-decoration: none;
	}
	.brand {
		flex: 1;
		min-width: 0;
		font-weight: 800;
		color: var(--ink);
	}
	.revoked {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 12px 0 0;
		padding: 8px 8px 8px 14px;
		background: var(--warn-bg);
		color: var(--warn-text);
		border-radius: var(--radius);
		font-size: 14px;
	}
	.revoked span {
		flex: 1;
	}
	.moved {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 16px;
		margin: 0;
		padding: 10px 16px;
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: 14px;
	}
	.moved span {
		flex: 1 1 280px;
	}
	.moved .btn {
		text-decoration: none;
	}
	.home-lists {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 24px;
	}
	.area {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 8px;
		margin: 0;
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 14px;
	}
	.area h2 {
		font-size: 18px;
		font-weight: 700;
		color: var(--ink);
	}
	.area h3 {
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.where {
		border: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.where legend {
		padding: 0;
		margin-bottom: 6px;
		font-size: 13px;
		font-weight: 600;
	}
	.where label {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px;
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		font-size: 14px;
	}
	.where label:has(input:checked) {
		border-color: var(--mat);
		background: var(--mat-soft);
	}
	.where label:has(input:disabled) {
		opacity: 0.6;
	}
	.where small {
		color: var(--muted);
		font-size: 12px;
	}

	/* 丟掉的回饋還沒有字：不佔格子的間距（留在畫面上，報讀才唸得到後來的字） */
	.start > .recent-note:empty,
	.area > .recent-note:empty {
		position: absolute;
	}
	@media (max-width: 760px) {
		.home {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
			/* 上面留給右上角那排（語言、使用說明、登入），不蓋到圖 */
			padding: 72px 16px 32px;
		}
		/* 手機：一欄，清單在上、新建在下 */
		.home.signed-in {
			grid-template-columns: minmax(0, 1fr);
			gap: 20px;
			padding: 0 16px 32px;
		}
		.intro h1 {
			font-size: 30px;
		}
	}
</style>
