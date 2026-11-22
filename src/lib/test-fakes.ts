// 測試共用的假 adapter：存檔、草稿、分頁頻道、解碼、座標換算、連伺服器、網頁跑在哪裡（fakeHost：小設定、網站網址、問殼、離線存放；jsdom 沒有檔案系統、IndexedDB、Web Audio、SVG 座標，前端測試不開真的伺服器），
// 一行建好帶假 adapter 的編輯器 module（testEditor，Node 也能用）、放好流程的編輯頁、開檔這些小工具，
// 和頁面測試常用的範例流程。flowOf 用測試共用那份（#lib/test-flows.js）。只給測試用，頁面不 import。
import { fireEvent, screen, within } from '@testing-library/svelte';
import { onTestFinished } from 'vitest';
import { swapHost, type Host, type SettingsStore, type Shell } from '#lib/host.js';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import {
	addAction,
	charCount,
	addMembers,
	addSegment,
	createFlow,
	loadSegmentAudio,
	addPhase,
	checkFlowDocument,
	checkRecord,
	flowProblem,
	problemKeys,
	putRecords,
	recordAttempt,
	runCommands,
	said,
	takeRecords,
	takeStep,
	setSquad,
	updateSegment,
	type Command,
	type Flow,
	type LoggedStep,
	type Position,
	type RemoteChange,
	type StoredAttempt
} from '#lib/core';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import { m } from '#lib/paraglide/messages.js';
import { Editor, type EditorAdapters } from '#lib/editor.svelte.js';
import { MAX_CLOUD_AUDIO_BYTES } from '#lib/music-library.svelte.js';
import type { DraftStore } from '#lib/file/draft.js';
import type { FileSaver, SaveOutcome } from '#lib/file/save.js';
import { createFakeVideoEncoder } from '#lib/video/fake-encoder.js';
import type { Measure } from '#lib/video/layout.js';
import { domPendingInput, type PendingInput } from '#lib/pending-input.js';
import { animationFrame } from '#lib/playback.svelte.js';
import type { OpenTabChannel, TabMessage } from '#lib/tab-channel.js';
import {
	isEmptyUnsent,
	readCopy,
	readUnsent,
	storedCopy,
	storedUnsent,
	type OfflineStore,
	type SignedInHere,
	type UnsentRecords
} from '#lib/offline-store.js';
import {
	MAX_CLOUD_FLOW_BYTES,
	ServerUnreachable,
	type AdminResult,
	type FlowRoom,
	type RoomDown,
	type LinkInfo,
	type Me,
	type Person,
	type Present,
	type Role,
	type RoomMessage,
	type RoomRequest,
	type RunView,
	type SentBack,
	type ServerAdapter,
	type UserStatus
} from '#lib/server-api.js';

/** 假的存檔：每次存的位元組和檔名照順序記下來，回傳給的結果。 */
export function fakeSaver(outcome: SaveOutcome = 'saved') {
	const saves: Uint8Array[] = [];
	const fileNames: string[] = [];
	const saver: FileSaver = {
		async save(bytes, fileName) {
			saves.push(bytes);
			fileNames.push(fileName);
			return outcome;
		}
	};
	return { saver, saves, fileNames };
}

/**
 * 假的草稿：存在記憶體，key 是流程的草稿 id（all）。一開始可以先放一份，id 是舊版編輯器那一份的「current」。
 * latest()：最後存的那份草稿的位元組，沒有草稿是 null。
 */
export function fakeDraftStore(initial: Uint8Array | null = null, savedAt: Date | null = new Date()) {
	const all = new Map<string, { bytes: Uint8Array; savedAt: Date | null }>();
	if (initial) all.set('current', { bytes: initial, savedAt });
	const store: DraftStore = {
		async list() {
			return [...all].map(([id, d]) => ({ id, savedAt: d.savedAt }));
		},
		async load(id) {
			const d = all.get(id);
			return d ? { id, ...d } : null;
		},
		async save(id, bytes) {
			all.delete(id);
			all.set(id, { bytes, savedAt: new Date() });
		},
		async clear(id) {
			all.delete(id);
		}
	};
	const latest = () => [...all.values()].at(-1)?.bytes ?? null;
	return { store, all, latest };
}

/** 換掉網頁跑在哪裡的其中幾樣（#373），這個測試跑完換回網頁版。 */
export function fakeHost(changes: Partial<Host>): void {
	onTestFinished(swapHost(changes));
}

/** 假的小設定：存在記憶體（saved：key → 存的字），一開始可以先放幾筆。 */
export function fakeSettings(init: Record<string, string> = {}) {
	const saved = new Map(Object.entries(init));
	const settings: SettingsStore = {
		get: (key) => saved.get(key) ?? null,
		set: (key, value) => void saved.set(key, value),
		remove: (key) => void saved.delete(key)
	};
	return { settings, saved };
}

/** 假的「問殼」：在 App 裡，會的是 features 那幾件。 */
export function fakeShell(features: string[] = []): Shell {
	return { inApp: true, can: (feature) => features.includes(feature) };
}

/**
 * 假的離線存放（#260）：存在記憶體（all：流程 id → 存進去的樣子，跟真的一樣帶版號、讀回來時用 readUnsent），
 * 一開始可以先放幾份（unsent）。volatile：這台是 iPhone、iPad 的 Safari（不是從主畫面打開的），提醒加到主畫面；按過「知道了」就不提醒。
 * 離線副本（#261）：copies（流程 id → 存進去的樣子，帶版號）、audio（流程 id → 音樂）、這台登入的是誰（here）。
 */
export function fakeOfflineStore(init: { unsent?: UnsentRecords[]; volatile?: boolean } = {}) {
	const all = new Map<string, unknown>((init.unsent ?? []).map((u) => [u.flowId, storedUnsent(u)]));
	const copies = new Map<string, unknown>();
	const audio = new Map<string, Record<string, Uint8Array>>();
	let here: SignedInHere | null = null;
	let known = false;
	const store: OfflineStore = {
		async unsent() {
			return [...all.values()].flatMap((v) => readUnsent(structuredClone(v)) ?? []);
		},
		async saveUnsent(u) {
			if (isEmptyUnsent(u)) all.delete(u.flowId);
			else all.set(u.flowId, storedUnsent(u));
		},
		async clearUnsent() {
			all.clear();
		},
		needsHomeScreen: () => !!init.volatile && !known,
		homeScreenKnown() {
			known = true;
		},
		async copies() {
			return [...copies.values()].flatMap((v) => readCopy(structuredClone(v)) ?? []);
		},
		async copyAudio(flowId) {
			return structuredClone(audio.get(flowId) ?? {});
		},
		async saveCopy(copy, bytes) {
			copies.set(copy.flowId, storedCopy(copy));
			if (bytes) audio.set(copy.flowId, structuredClone(bytes));
		},
		async dropCopy(flowId) {
			copies.delete(flowId);
			audio.delete(flowId);
		},
		async clearCopies() {
			copies.clear();
			audio.clear();
			here = null;
		},
		async signedInHere() {
			return structuredClone(here);
		},
		async saveSignedInHere(h) {
			here = structuredClone(h);
		}
	};
	/** 這支流程現在存著的（沒有是 null）。 */
	const of = (flowId: string) => readUnsent(all.get(flowId));
	/** 這支流程的離線副本（沒有是 null）。 */
	const copy = (flowId: string) => readCopy(copies.get(flowId));
	/** 離線副本的流程 id，最早打開的在前。 */
	const copyIds = () =>
		[...copies.values()]
			.flatMap((v) => readCopy(v) ?? [])
			.sort((a, b) => a.openedAt - b.openedAt)
			.map((c) => c.flowId);
	/** 這支離線副本的音樂（沒有是 null）。 */
	const audioOf = (flowId: string) => audio.get(flowId) ?? null;
	return { store, all, of, copy, copyIds, audioOf, signedInHere: () => here };
}

/**
 * 假的分頁頻道：同一個 fakeTabs() 開的頻道就像同一個瀏覽器的分頁，互相聽得到（自己送的自己收不到），送了馬上收到。
 * 每個分頁的編輯器 module 放同一個進去。
 */
export function fakeTabs(): OpenTabChannel {
	const open = new Set<Set<(message: TabMessage) => void>>();
	return () => {
		const listeners = new Set<(message: TabMessage) => void>();
		open.add(listeners);
		return {
			post(message) {
				for (const other of open) if (other !== listeners) for (const on of [...other]) on(message);
			},
			listen(on) {
				listeners.add(on);
				return () => void listeners.delete(on);
			},
			close: () => void open.delete(listeners)
		};
	};
}

/** 假的解碼：每個音樂檔都是 30 秒、沒有波形。 */
export const fakeDecode = async () => ({ durationSec: 30, peaks: [] });

/**
 * 假的沒送出的字：測試自己設 pending（欄位裡打了字還沒送出）和 onflush（送出時欄位交給流程的改動）；
 * 送出、當作已送出都是清掉。
 */
export function fakePendingInput(): PendingInput & { pending: boolean; onflush: () => void } {
	return {
		pending: false,
		onflush: () => {},
		flush() {
			if (this.pending) this.onflush();
			this.pending = false;
		},
		settle() {
			this.pending = false;
		}
	};
}

/** 假的伺服器上的一個使用者：設好密碼的才有 password；被停用的 disabled。 */
export interface FakeUser extends Me {
	password?: string;
	disabled?: boolean;
}

/** 假的設密碼連結：誰的、哪一種；邀請還有幾小時過期（沒寫是 24）。 */
export interface FakeLink {
	email: string;
	purpose: LinkInfo['purpose'];
	hoursLeft?: number;
}

/**
 * 假的伺服器上的一支雲端流程：擁有者的 email、編排、最後改的時間（ISO）、現在第幾步（沒寫是 0）、收過的步驟 id（→ 收了之後第幾步）、
 * 分享給誰（email → 權限，照加進來的順序）。
 * 傳上雲端的音樂檔（audio id → 位元組，假的 R2）。分享連結（沒寫、null 是關著）。
 * 成功率紀錄（#257）跟編排分開放（flow 裡的紀錄是空的）：記的人的 email（沒有是從流程檔來的）、清掉了沒、
 * 最後一次用手改、刪、救回時流程是第幾步（沒動過沒寫）。
 */
export interface FakeCloudFlow {
	id: string;
	owner: string;
	flow: Flow;
	updatedAt: string;
	step?: number;
	stepIds?: Record<string, number>;
	people?: Record<string, Exclude<Role, 'owner'>>;
	audio?: Record<string, Uint8Array>;
	records?: (StoredAttempt & { by?: string; gone?: boolean; amendedStep?: number })[];
	link?: string | null;
	/** 記著的讓它留著的毛病和記的時候流程核心的指紋（ADR 0020）；沒記過是 undefined。 */
	held?: { keys: string[]; core: string };
}

/**
 * 假的連伺服器：使用者、設密碼連結（token → 那條連結）放在記憶體，規則跟真的一樣
 * （email 不分大小寫；密碼至少 15 個看得到的字、不在外洩清單 breached 裡；連結用一次就不能用；被停用的登不進去）。
 * signedIn：現在登入的是誰（沒登入是 null）。flows：雲端流程（只有擁有者拿得到）。unreachable 設成 true 就是連不上伺服器。
 * 管理使用者：使用者的 id 是他在 users 裡的位置 + 1；mailQuota 設成 true 就是寄信服務今天的額度用完了。
 * expired 設成 true：沒登入是因為登入超過 30 天了。retryAfter 設成秒數：猜密碼試太多次（鎖住），登入、改密碼都回要等幾秒。
 * forgot：按過忘記密碼的 email（照順序）。otherDevices：改密碼時其他裝置都登出，記成 0。
 * 房間（openRoom）照真的規則收步：指紋不是 fingerprint 就說有新版；被擋、要問沒帶回答退回並帶原因和伺服器的樣子；
 * 步驟 id 收過回原本的結果。送進房間的下一個 microtask 才處理、回答；holdRoom 設成 true 就先留著，releaseRoom() 才處理。
 * 網路（#260）：network() 讓開著的房間斷網、伺服器沒回應、登入過期（斷線帶原因），或又連上（重新打招呼）。
 * 一步收不收（改到同一個東西 #254、復原重做 #256、權限、步驟 id 收過、30 天）交給流程核心的 takeStep，跟真的伺服器同一套規則；
 * 步驟紀錄的時間用 Date.now()（測試可以用假時鐘撥）。
 * 分享（#250）照真的規則：有權限的人才拿得到、連得上房間；記錄者、檢視者送的步退回；只有擁有者看得到別人的 email。
 * changeRole(flowId, email, role)：擁有者（在別的地方）改了這個人的權限（null 是收回），他開著的房間馬上知道。
 * 移交、刪流程（#252）照真的規則：只能移交給名單上沒被停用的人，原擁有者變編輯者；管理員只能移交被停用的人的流程。
 * deleteFlow(flowId)：擁有者（在別的地方）刪了這支，開著的房間都馬上知道。
 * 分享連結（#251）照真的規則：只有擁有者能開、關（關掉再打開是新的一條），有權限的人看得到；用連結打開不用登入、
 * 拿不到紀錄，已經有權限的帶自己的權限。
 * 音樂檔（#249）放在那支流程的 audio：超過 60 MB 不收（'tooBig'）；audioTooBig 設成 true 就是伺服器傳完才查到太大。
 * 傳上雲端（#259）照真的規則：檢查一整支流程、整份流程檢查，過了建一支新的（登入的人是擁有者），紀錄拆出來、沒有記的人。
 * 別人的改動、誰開著（#253）照真的規則：收了一步就把改好的東西送給同一支流程其他開著的房間；有人進來、離開、換模式就說在場名單
 * （自己不列，同一個人只列一次）。joinAs(flowId, email, editing)：別人（在別的地方）打開這支流程，回他的房間，可以送步、換模式。
 * 成功率紀錄（#257）照真的規則：房間送來的「記一次」照記一次的規則檢查、同一個 id 只收一次、檢視者不收；
 * 跑一步時紀錄放回流程再跑、跑完清掉該清的；收了告訴同一支流程開著的別的房間（別人記的帶名字）。
 * recordAs(flowId, email, records)：這個人（在別的地方）記了，開著的房間馬上收到。
 * 一起記全上（#262）照真的規則：誰在表裡、誰拿著哪幾組只告訴能記的人；同一次全上的同一組只收先存的，救回也不算第二筆（斷線 1 分鐘當他離開沒做）。
 * 斷線（#255）照真的規則：disconnect(email) 斷掉這個人開著的房間（還沒處理的、還沒送到的回答都不見，斷線時送的丟掉），
 * reconnect(email) 連回來（房間叫 onconnection(true)，重新打招呼）。打招呼帶上次看到第幾步：先補上之後別的分頁收了的步，
 * 要紀錄的再給現在的紀錄，再說可以送步。
 */
export function fakeServer(
	init: {
		users?: FakeUser[];
		links?: Record<string, FakeLink>;
		signedIn?: string | null;
		breached?: string[];
		flows?: FakeCloudFlow[];
	} = {}
) {
	const state = {
		users: init.users ?? [],
		links: { ...init.links },
		signedIn: init.signedIn ?? null,
		breached: init.breached ?? [],
		flows: [...(init.flows ?? [])],
		unreachable: false,
		mailQuota: false,
		expired: false,
		retryAfter: null as number | null,
		forgot: [] as string[],
		otherDevices: 1,
		fingerprint: CORE_FINGERPRINT,
		holdRoom: false,
		audioTooBig: false,
		/** 房間連得上嗎（#260）：network() 換；直接改它不會通知房間（等房間自己再試，例：按「現在再試」）。 */
		link: 'online' as 'online' | RoomDown
	};
	/** 留著還沒處理的（holdRoom 時）。 */
	let held: { room: FlowRoom; send: () => void }[] = [];
	/** 斷線的房間：送來的不收，還沒送到的回答不見。 */
	const down = new Set<FlowRoom>();
	const deliver = (room: FlowRoom, answer: () => RoomMessage | RoomMessage[] | null) => {
		const send = () => {
			if (down.has(room)) return;
			for (const message of [answer() ?? []].flat()) room.onmessage(message);
		};
		if (state.holdRoom) held.push({ room, send });
		else queueMicrotask(send);
	};
	/** 收過的步（每支流程）：步驟紀錄（流程核心的 LoggedStep），加上那一步改好之後的東西（重送、補步用）。 */
	const stepLog = new Map<string, (LoggedStep & { change: RemoteChange })[]>();
	const sameRecord = (a: StoredAttempt, b: StoredAttempt) =>
		JSON.stringify({ actionId: a.actionId, attempt: a.attempt }) === JSON.stringify({ actionId: b.actionId, attempt: b.attempt });
	/**
	 * 房間收到一步：「這一步收不收」交給流程核心（takeStep，跟真的伺服器同一套規則）。canEdit 照送來那時的權限
	 * （先留著不處理時，之後才改的權限不算到這一步上）。這裡只管存、送：
	 * 收了就存好編排、紀錄、步驟紀錄，把改好的東西送給同一支流程其他開著的房間。有 undo 是復原、重做（#256）。
	 */
	const serveStep = (
		f: FakeCloudFlow,
		sent: { stepId: string; seen: number; commands?: Command[]; undo?: { of: string; redo: boolean; change: RemoteChange; joined?: string[] } },
		from: OpenRoom,
		canEdit: boolean
	): RoomMessage | RoomMessage[] => {
		const { stepId, seen, commands, undo } = sent;
		const step = f.step ?? 0;
		const log = stepLog.get(f.id) ?? [];
		const takenAt = f.stepIds?.[stepId];
		const verdict = takeStep({
			flow: structuredClone(f.flow),
			step,
			records: structuredClone(f.records ?? []).map(({ actionId, attempt, gone, amendedStep }) => ({ actionId, attempt, gone, amendedStep })),
			log: log.map(({ change: _, ...l }) => structuredClone(l)),
			now: Date.now(),
			canEdit,
			tab: from.tab,
			by: find(from.email)?.name ?? '',
			sentBack: from.sentBack,
			taken: takenAt === undefined ? undefined : { step: takenAt, change: structuredClone(log.find((l) => l.id === stepId)?.change ?? null) },
			core: CORE_FINGERPRINT,
			held: structuredClone(f.held),
			sent: undo ? { stepId, seen, undo: structuredClone(undo) } : { stepId, seen, commands: structuredClone(commands ?? []) }
		});
		if (verdict.kind === 'again') {
			// 斷線重送：回原本的結果，帶那一步的改動（跟真的伺服器一樣）
			return { kind: 'accepted', stepId, step: verdict.step, ...(verdict.change ? { change: verdict.change } : {}) };
		}
		if (verdict.kind === 'rejected') {
			from.sentBack = step;
			// 跟真的伺服器一樣送代號（why）；message 是給部署前開著的舊分頁看的中文，畫面不讀，這裡不寫
			const { why, by } = verdict;
			const sentBack: SentBack = why;
			return { kind: 'rejected', stepId, why: sentBack, message: '', ...(by === undefined ? {} : { by }), flow: structuredClone(f.flow), step };
		}
		const { flow, change, changed: kept, deleted, logged } = verdict;
		const changedTo = new Map(kept.map((r) => [r.attempt.id, r]));
		f.records = (f.records ?? []).map((old) => {
			const now = changedTo.get(old.attempt.id);
			if (now) return { ...old, ...now, gone: false };
			return deleted.includes(old.attempt.id) ? { ...old, gone: true } : old;
		});
		const changed = [...changedTo.keys()];
		const by = logged.by;
		for (const other of rooms.filter((o) => o.flowId === f.id && o.here && o !== from)) {
			deliver(other.room, () => ({ kind: 'changed', step: step + 1, by, change: structuredClone(change) }));
		}
		// 紀錄跟著改的接在編排的改動後面（#258）。送的人也收到（ADR 0007）：復原、重做加回來的；一般的步，進房間拿到的紀錄還沒算到這一步。
		// 送的人的那一則跟真的伺服器一樣緊跟在「收了」後面，處理下一個送來的之前。
		tellRecords(f, changed, deleted, from.room);
		const own = changed.length || deleted.length ? [recordsChanged(f, changed, deleted, from.email)] : [];
		stepLog.set(f.id, [...log, { ...logged, change }]);
		f.flow = flow;
		f.held = { keys: verdict.held, core: CORE_FINGERPRINT };
		f.step = logged.step;
		f.stepIds = { ...f.stepIds, [stepId]: f.step };
		f.updatedAt = new Date().toISOString();
		// 送的人也拿到伺服器做出來的改動：可能跟他自己畫面上的不一樣（例：同時加的隊員放的位置）
		return [{ kind: 'accepted', stepId, step: f.step, change: structuredClone(change) }, ...own];
	};
	let nextToken = 1;
	let nextShareLink = 1;
	/** 用分享連結找那支流程（連得上才算）。 */
	const linked = (token: string) => {
		reachable();
		return state.flows.find((f) => f.link && f.link === token);
	};
	const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
	const find = (email: string) => state.users.find((u) => same(u.email, email));
	/** 登入的人（沒登入丟錯，跟真的伺服器回 401 一樣當作出錯）。 */
	const signedInEmail = () => {
		reachable();
		const me = state.signedIn && find(state.signedIn);
		if (!me) throw new ServerUnreachable();
		return me.email;
	};
	/** 這個人對這支流程的權限；沒有是 undefined。 */
	const roleOf = (f: FakeCloudFlow, email: string): Role | undefined =>
		same(f.owner, email) ? 'owner' : Object.entries(f.people ?? {}).find(([e]) => same(e, email))?.[1];
	/** 登入的人拿得到的這支流程（有權限）和他的權限。 */
	const reach = (id: string) => {
		const email = signedInEmail();
		const f = state.flows.find((g) => g.id === id);
		const role = f && roleOf(f, email);
		return f && role ? { f, role, email } : null;
	};
	/** 登入的人擁有的雲端流程。 */
	const mine = () => {
		const email = signedInEmail();
		return state.flows.filter((f) => same(f.owner, email));
	};
	/** 有權限的人：擁有者在前；只有擁有者看得到 email。 */
	const peopleOf = (f: FakeCloudFlow, viewer: string): Person[] => {
		const withEmail = same(f.owner, viewer);
		return [[f.owner, 'owner'] as const, ...Object.entries(f.people ?? {})].map(([email, role]) => {
			const u = find(email)!;
			const p: Person = { userId: state.users.indexOf(u) + 1, name: u.name, role, me: same(email, viewer), disabled: !!u.disabled };
			if (withEmail) p.email = u.email;
			return p;
		});
	};
	/** 開著的房間。 */
	const rooms: OpenRoom[] = [];
	/** 告訴這支流程每個打過招呼的房間現在誰開著（自己不列，同一個人只列一次）。 */
	const tellPresent = (flowId: string) => {
		const here = rooms.filter((r) => r.flowId === flowId && r.here);
		for (const r of here) {
			const people: Present[] = [];
			for (const o of here.filter((o) => !same(o.email, r.email))) {
				const u = find(o.email)!;
				const userId = state.users.indexOf(u) + 1;
				const seen = people.find((p) => p.userId === userId);
				if (seen) seen.editing ||= o.editing;
				else people.push({ userId, name: u.name, editing: o.editing });
			}
			deliver(r.room, () => ({ kind: 'present', people }));
		}
	};
	/** 一起記全上（#262）：每支流程開著的全上（只在記憶體）：表裡的人（email）、誰拿著哪一組、點過沒。 */
	const runs = new Map<string, FakeRun[]>();
	const userIdOf = (email: string) => state.users.findIndex((u) => same(u.email, email)) + 1;
	const nameOf = (email: string) => find(email)?.name ?? '';
	/** 告訴這支流程打過招呼、能記的房間現在的全上（照看的人寫哪些是他的）。 */
	const tellRuns = (f: FakeCloudFlow) => {
		for (const o of rooms.filter((o) => o.flowId === f.id && o.here && roleOf(f, o.email) !== 'viewer')) {
			deliver(o.room, () => ({ kind: 'runThroughs', runs: runViews(f.id, o.email) }));
		}
	};
	const runViews = (flowId: string, viewer: string): RunView[] =>
		(runs.get(flowId) ?? []).map((r) => ({
			id: r.id,
			date: r.date,
			startedAt: r.startedAt,
			people: r.people.map((email) => ({ name: nameOf(email), me: same(email, viewer), away: false })),
			keys: r.keys.map((k) => ({
				key: k.key,
				userId: userIdOf(k.email),
				name: nameOf(k.email),
				mine: same(k.email, viewer),
				touched: k.touched,
				away: false
			}))
		}));
	/**
	 * 一起記全上的事（照真的規則，斷線 1 分鐘當他離開沒做）：開、加入、重報；拿一組（沒人拿著、還沒點過的給他，
	 * 點過的、別人先拿了退回）、放掉、點了、離開。回要跟送的人說的（拿不到、加入不了），別的房間照新的樣子。
	 */
	const runAsk = (f: FakeCloudFlow, email: string, request: RunRequest): RoomMessage | null => {
		const list = runs.get(f.id) ?? [];
		runs.set(f.id, list);
		const runId = request.kind === 'runThrough' ? request.id : request.run;
		let run = list.find((r) => r.id === runId);
		if (!run) {
			if (request.kind !== 'runThrough' || request.joining) return { kind: 'runClosed', run: runId };
			run = { id: request.id, date: request.date, startedAt: request.startedAt, people: [], keys: [] };
			list.push(run);
		}
		if (request.kind !== 'leaveRun' && !run.people.some((e) => same(e, email))) run.people.push(email);
		let answer: RoomMessage | null = null;
		if (request.kind === 'runThrough') {
			run.keys = run.keys.filter((k) => !same(k.email, email) || request.keys.includes(k.key));
			for (const key of request.keys) {
				const held = run.keys.find((k) => k.key === key);
				if (!held) run.keys.push({ key, email, touched: request.touched.includes(key) });
				else if (same(held.email, email)) held.touched ||= request.touched.includes(key);
			}
		} else if (request.kind === 'leaveRun') {
			run.people = run.people.filter((e) => !same(e, email));
			run.keys = run.keys.filter((k) => !same(k.email, email));
			if (!run.people.length) list.splice(list.indexOf(run), 1);
		} else if (request.kind === 'release') {
			run.keys = run.keys.filter((k) => k.key !== request.key || !same(k.email, email));
		} else {
			const held = run.keys.find((k) => k.key === request.key);
			const touch = request.kind === 'touch';
			const from = request.kind === 'claim' ? request.from : null;
			if (!held) run.keys.push({ key: request.key, email, touched: touch });
			else if (same(held.email, email)) held.touched ||= touch;
			else if (touch || from !== userIdOf(held.email) || held.touched) {
				const touched = held.touched && (touch || from === userIdOf(held.email));
				answer = { kind: 'claimRefused', run: run.id, key: request.key, by: nameOf(held.email), touched };
			} else Object.assign(held, { email, touched: false });
		}
		tellRuns(f);
		return answer;
	};
	/** 打招呼帶上次看到第 seen 步：之後別的分頁收了的步照順序補給他；中間的步沒留就給伺服器現在的樣子。 */
	const catchUp = (f: FakeCloudFlow, seen: number, to: OpenRoom) => {
		const step = f.step ?? 0;
		const missed = (stepLog.get(f.id) ?? []).filter((l) => l.step > seen && l.step <= step);
		if (missed.length !== step - seen) {
			const flow = structuredClone(f.flow);
			if (seen < step) deliver(to.room, () => ({ kind: 'current', flow, step }));
			return;
		}
		for (const l of missed.filter((l) => l.tab !== to.tab)) {
			deliver(to.room, () => ({ kind: 'changed', step: l.step, by: l.by, change: structuredClone(l.change) }));
		}
	};
	/** 一個房間斷線（why：為什麼，#260；已經斷著就只換原因）：還沒處理的、還沒送到的回答都不見；別人的在場名單拿掉他。 */
	const cut = (r: OpenRoom, why?: RoomDown) => {
		if (down.has(r.room)) {
			if (why) r.room.onconnection(false, why);
			return;
		}
		down.add(r.room);
		r.here = false;
		r.room.onconnection(false, why);
		tellPresent(r.flowId);
		held = held.filter((h) => !down.has(h.room));
	};
	/** 斷線的房間連回來（房間重新打招呼）。 */
	const bringBack = (r: OpenRoom) => {
		if (!down.delete(r.room)) return;
		r.room.onconnection(true);
	};
	/** 斷掉這個人開著的房間。 */
	const disconnect = (email = state.signedIn ?? '') => {
		for (const r of rooms.filter((r) => same(r.email, email))) cut(r);
	};
	/** 這個人斷掉的房間連回來。 */
	const reconnect = (email = state.signedIn ?? '') => {
		for (const r of rooms.filter((r) => same(r.email, email))) bringBack(r);
	};
	/** 伺服器送給前端的一次：別人記的帶名字。 */
	const cloudRecord = (r: StoredAttempt & { by?: string }, viewer: string) => ({
		actionId: r.actionId,
		attempt: structuredClone(r.attempt),
		by: r.by && !same(r.by, viewer) ? (find(r.by)?.name ?? null) : null,
		mine: !!r.by && same(r.by, viewer)
	});
	/** 紀錄跟著改了（改、刪、救回、別人的一步）：告訴這支流程開著的別的房間（from 是送來的房間）。 */
	const tellRecords = (f: FakeCloudFlow, changed: string[], deleted: string[], from?: FlowRoom) => {
		if (!changed.length && !deleted.length) return;
		for (const other of rooms.filter((o) => o.flowId === f.id && o.room !== from)) {
			const message = recordsChanged(f, changed, deleted, other.email);
			deliver(other.room, () => message);
		}
	};
	/** 紀錄跟著改的那一則（給 viewer 看的）。 */
	const recordsChanged = (f: FakeCloudFlow, changed: string[], deleted: string[], viewer: string): RoomMessage => {
		const records = (f.records ?? []).filter((r) => !r.gone && changed.includes(r.attempt.id));
		return structuredClone({ kind: 'recordsChanged', changed: records.map((r) => cloudRecord(r, viewer)), deleted });
	};
	/** 用流程核心對一次跑改記號、救回（跟真的伺服器一樣）：收了回跑完的那一次，被擋是 undefined。 */
	const runOne = (f: FakeCloudFlow, records: StoredAttempt[], command: Command) => {
		const r = runCommands(putRecords(structuredClone(f.flow), structuredClone(records)), [command], '');
		return r.kind === 'ok' ? takeRecords(r.flow).records[0] : undefined;
	};
	/** 同一次全上的同一個動作、同一組，別的一筆已經存了（沒清掉的）：那一筆（#262）。 */
	const firstInRun = (f: FakeCloudFlow, r: StoredAttempt) =>
		(f.records ?? []).find(
			(o) =>
				!o.gone &&
				o.attempt.id !== r.attempt.id &&
				r.attempt.runThroughId !== undefined &&
				o.attempt.runThroughId === r.attempt.runThroughId &&
				o.actionId === r.actionId &&
				o.attempt.who === r.attempt.who
		);
	/**
	 * 這個人改、刪、救回幾次（#258）：記錄者只能動自己記的，擁有者、編輯者都能；刪掉的改、刪都不算，救回才拿回來。
	 * 回那幾次現在的樣子（還在的），告訴別的房間。
	 */
	const amend = (f: FakeCloudFlow, email: string, request: AmendRequest, from?: FlowRoom): RoomMessage => {
		const role = roleOf(f, email);
		const may = (r: { by?: string }) => role === 'owner' || role === 'editor' || (role === 'recorder' && !!r.by && same(r.by, email));
		const sent = request.kind === 'changeRecords' ? (request.attempts as StoredAttempt[]) : [];
		const asked = request.kind === 'changeRecords' ? sent.map((s) => s.attempt.id) : request.ids;
		const changed: string[] = [];
		const deleted: string[] = [];
		f.records = (f.records ?? []).map((r) => {
			const id = r.attempt.id;
			if (!asked.includes(id) || !may(r)) return r;
			if (request.kind === 'deleteRecords' && !r.gone) {
				deleted.push(id);
				return { ...r, gone: true, amendedStep: f.step ?? 0 };
			}
			const marks = sent.find((s) => s.attempt.id === id)?.attempt.marks ?? {};
			const after =
				request.kind === 'changeRecords' && !r.gone
					? runOne(f, [r], { name: 'changeAttempt', args: [r.actionId, id, marks] })
					: request.kind === 'restoreRecords' && r.gone && !firstInRun(f, r)
						? runOne(f, [], { name: 'restoreAttempt', args: [r.actionId, r.attempt, 0] })
						: undefined;
			if (!after) return r;
			changed.push(id);
			// 再送一次一樣的記號（回答沒收到）不算用手動過（跟真的伺服器一樣）。
			const amendedStep = r.gone || !sameRecord(r, after) ? (f.step ?? 0) : r.amendedStep;
			return { ...r, ...after, gone: false, amendedStep };
		});
		tellRecords(f, changed, deleted, from);
		const saved = f.records.filter((r) => !r.gone && asked.includes(r.attempt.id)).map((r) => cloudRecord(r, email));
		return { kind: 'recordsSaved', saved, dropped: [] };
	};
	/** 這個人記了幾次：照記一次的規則檢查、存起來，告訴這支流程開著的別的房間（from 是送來的房間）。 */
	const store = (f: FakeCloudFlow, email: string, incoming: StoredAttempt[], from?: FlowRoom): RoomMessage => {
		const role = roleOf(f, email);
		if (role === 'viewer') {
			return { kind: 'recordsSaved', saved: [], dropped: incoming.map((r) => ({ id: r.attempt.id, message: '你只能看這支流程' })) };
		}
		const saved: ReturnType<typeof cloudRecord>[] = [];
		const dropped: { id: string; message: string; by?: string; someone?: boolean }[] = [];
		const added: StoredAttempt[] = [];
		for (const r of structuredClone(incoming)) {
			// 同一次全上的同一組只收先存的（#262）
			const first = firstInRun(f, r);
			if (first) {
				const by = first.by ? nameOf(first.by) : '別人';
				dropped.push({ id: r.attempt.id, message: `${by}已經記了這次全上的這一組`, by, ...(first.by ? {} : { someone: true }) });
				continue;
			}
			const had = (f.records ?? []).find((o) => o.attempt.id === r.attempt.id);
			if (had) {
				if (!had.gone) saved.push(cloudRecord(had, email));
				continue;
			}
			const checked = checkRecord(f.flow, r);
			if (checked.kind === 'dropped') {
				dropped.push({ id: r.attempt.id, message: checked.message });
				continue;
			}
			f.records = [...(f.records ?? []), { ...checked.record, by: email }];
			added.push(checked.record);
			saved.push(cloudRecord(checked.record, email));
		}
		for (const other of rooms.filter((o) => o.flowId === f.id && o.room !== from)) {
			const records = added.map((r) => cloudRecord({ ...r, by: email }, other.email));
			if (records.length) deliver(other.room, () => ({ kind: 'newRecords', records }));
		}
		return { kind: 'recordsSaved', saved, dropped };
	};
	/** 這個人（在別的地方）記了：存起來，開著的房間馬上收到。 */
	const recordAs = (flowId: string, email: string, records: StoredAttempt[]) => {
		store(state.flows.find((g) => g.id === flowId)!, email, records);
	};
	/** 改這個人的權限（null 是收回），告訴他開著的房間。 */
	const changeRole = (flowId: string, email: string, role: Exclude<Role, 'owner'> | null) => {
		const f = state.flows.find((g) => g.id === flowId)!;
		const people = { ...f.people };
		const key = Object.keys(people).find((e) => same(e, email)) ?? email;
		if (role) people[key] = role;
		else delete people[key];
		f.people = people;
		for (const r of rooms.filter((r) => r.flowId === flowId && same(r.email, email))) {
			deliver(r.room, () =>
				role ? { kind: 'roleChanged', role, flow: structuredClone(f.flow), step: f.step ?? 0 } : { kind: 'revoked' }
			);
			if (role !== 'editor') r.editing = false;
		}
		tellPresent(flowId);
	};
	/** 把 from 擁有的流程（only：只交這幾支）交給 to，from 變編輯者；告訴兩個人開著的房間。回交出去幾支。 */
	const handOverFlows = (from: string, to: string, only: FakeCloudFlow[] = state.flows) => {
		const moved = only.filter((f) => same(f.owner, from));
		for (const f of moved) {
			const people = Object.fromEntries(Object.entries(f.people ?? {}).filter(([e]) => !same(e, to)));
			f.owner = to;
			f.people = { ...people, [from]: 'editor' };
			for (const [email, role] of [[to, 'owner'], [from, 'editor']] as const) {
				for (const r of rooms.filter((r) => r.flowId === f.id && same(r.email, email))) {
					deliver(r.room, () => ({ kind: 'roleChanged', role, flow: structuredClone(f.flow), step: f.step ?? 0 }));
				}
			}
		}
		return moved.length;
	};
	/** 被刪掉的流程 → 刪的時候有權限的人（之後打開、連房間說被刪了，不說被收回）。 */
	const deletedFor = new Map<string, string[]>();
	/** 刪掉一支，告訴開著的房間。 */
	const deleteFlow = (flowId: string) => {
		const f = state.flows.find((g) => g.id === flowId);
		if (f) deletedFor.set(flowId, [f.owner, ...Object.keys(f.people ?? {})]);
		state.flows = state.flows.filter((f) => f.id !== flowId);
		for (const r of rooms.filter((r) => r.flowId === flowId)) deliver(r.room, () => ({ kind: 'deleted' }));
	};
	/** 叫的人是這支的擁有者（不是擁有者跟真的伺服器回 403、404 一樣當作出錯）。 */
	const owned = (flowId: string) => {
		const r = reach(flowId);
		if (r?.role !== 'owner') throw new ServerUnreachable();
		return r;
	};
	const emailOf = (userId: number) => state.users[userId - 1]?.email ?? '';
	const reachable = () => {
		if (state.unreachable) throw new ServerUnreachable();
	};
	const signedInUser = () => (!state.unreachable && state.signedIn ? find(state.signedIn) : undefined);
	const linksOf = (email: string) => Object.entries(state.links).filter(([, l]) => same(l.email, email));
	/** 換一條新的連結：這個人之前的連結作廢。 */
	const newLink = (email: string, purpose: FakeLink['purpose']) => {
		for (const [token] of linksOf(email)) delete state.links[token];
		state.links[`fake-token-${nextToken++}`] = { email, purpose };
	};
	const status = (u: FakeUser): UserStatus => {
		if (u.disabled) return { kind: 'disabled', flows: state.flows.filter((f) => same(f.owner, u.email)).length };
		if (u.password) return { kind: 'active' };
		const invite = linksOf(u.email).find(([, l]) => l.purpose === 'invite')?.[1];
		return invite ? { kind: 'invited', hoursLeft: invite.hoursLeft ?? 24 } : { kind: 'inviteExpired' };
	};
	/** 管理員叫的、這個 id 的人：先看連得上、是不是管理員、寄信服務今天還能不能寄（mail）。 */
	const adminDoes = (id: number, mail: boolean, act: (u: FakeUser) => AdminResult | void): AdminResult => {
		reachable();
		if (!signedInUser()?.isAdmin) throw new ServerUnreachable();
		const u = state.users[id - 1];
		if (!u) throw new ServerUnreachable();
		if (mail && state.mailQuota) return { kind: 'mailQuota' };
		return act(u) ?? 'ok';
	};
	const server: ServerAdapter = {
		async me() {
			if (state.unreachable) return undefined;
			const u = signedInUser();
			return u && !u.disabled ? { email: u.email, name: u.name, isAdmin: u.isAdmin } : null;
		},
		async loginExpired() {
			return !state.unreachable && !state.signedIn && state.expired;
		},
		async login(email, password) {
			reachable();
			if (state.retryAfter !== null) return { retryAfter: state.retryAfter };
			const u = find(email);
			if (!u?.password || u.password !== password || u.disabled) return 'wrong';
			state.signedIn = u.email;
			return 'ok';
		},
		async logout() {
			reachable();
			state.signedIn = null;
		},
		async passwordLink(token) {
			reachable();
			const link = state.links[token];
			const u = link && find(link.email);
			return u ? { email: u.email, name: u.name, purpose: link.purpose } : null;
		},
		async setPassword(token, password) {
			reachable();
			const link = state.links[token];
			const u = link && find(link.email);
			if (!u) return 'gone';
			const n = charCount(password);
			if (n < 15) return { kind: 'tooShort', missing: 15 - n };
			if (state.breached.includes(password)) return { kind: 'breached' };
			u.password = password;
			delete state.links[token];
			return 'ok';
		},
		async listUsers() {
			reachable();
			const me = signedInUser();
			if (!me?.isAdmin) return null;
			return state.users.map((u, i) => ({ id: i + 1, name: u.name, email: u.email, status: status(u), me: u === me }));
		},
		async addUser(email, name) {
			reachable();
			if (!signedInUser()?.isAdmin) throw new ServerUnreachable();
			if (find(email)) return { kind: 'emailTaken' };
			if (state.mailQuota) return { kind: 'mailQuota' };
			state.users.push({ email: email.trim(), name: name.trim(), isAdmin: false });
			newLink(email.trim(), 'invite');
			return 'ok';
		},
		async resendInvite(id) {
			return adminDoes(id, true, (u) => {
				if (u.password || u.disabled) return { kind: 'notAllowed' };
				newLink(u.email, 'invite');
			});
		},
		async sendReset(id) {
			return adminDoes(id, true, (u) => {
				if (!u.password || u.disabled) return { kind: 'notAllowed' };
				newLink(u.email, 'reset');
			});
		},
		async changeEmail(id, email) {
			const other = find(email);
			if (other && other !== state.users[id - 1]) return { kind: 'emailTaken' };
			return adminDoes(id, true, (u) => {
				for (const [, l] of linksOf(u.email)) l.email = email.trim();
				if (state.signedIn && same(state.signedIn, u.email)) state.signedIn = email.trim();
				u.email = email.trim();
			});
		},
		async disableUser(id) {
			return adminDoes(id, false, (u) => {
				if (u === signedInUser()) return { kind: 'notAllowed' };
				u.disabled = true;
				for (const [token] of linksOf(u.email)) delete state.links[token];
			});
		},
		async enableUser(id) {
			return adminDoes(id, false, (u) => {
				u.disabled = false;
			});
		},
		async adminHandOver(id, email) {
			const r = adminDoes(id, false, (u) => (u.disabled ? undefined : { kind: 'notAllowed' }));
			if (r !== 'ok') return r;
			const from = state.users[id - 1];
			const to = find(email);
			if (!to) return { kind: 'noAccount' };
			if (to === from) return { kind: 'sameUser' };
			if (to.disabled) return { kind: 'disabled', name: to.name };
			return { flows: handOverFlows(from.email, to.email) };
		},
		async myFlows() {
			const email = signedInEmail();
			const recent = (list: FakeCloudFlow[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
			return {
				mine: recent(mine()).map((f) => ({ id: f.id, name: f.flow.name, updatedAt: f.updatedAt })),
				shared: recent(state.flows.filter((f) => roleOf(f, email) && !same(f.owner, email))).map((f) => {
					const owner = find(f.owner)!;
					const role = roleOf(f, email)!;
					return { id: f.id, name: f.flow.name, updatedAt: f.updatedAt, ownerName: owner.name, ownerDisabled: !!owner.disabled, role };
				}),
				deleted: [...deletedFor].filter(([, emails]) => emails.some((e) => same(e, email))).map(([id]) => id)
			};
		},
		async createFlow(input) {
			mine();
			const r = createFlow(input);
			if (r.kind !== 'ok') throw new Error(r.kind === 'blocked' ? r.message : r.kind);
			const made: FakeCloudFlow = { id: `c${state.flows.length + 1}`, owner: state.signedIn!, flow: r.flow, updatedAt: new Date().toISOString() };
			state.flows.push(made);
			return { id: made.id, name: made.flow.name, updatedAt: made.updatedAt };
		},
		async uploadFlow(doc) {
			mine();
			if (new Blob([JSON.stringify(doc)]).size > MAX_CLOUD_FLOW_BYTES) return { message: m.share_flow_too_big() };
			const checked = checkFlowDocument(structuredClone(doc));
			if (checked.kind === 'error') return { message: checked.message, ...(checked.why && { why: checked.why }) };
			const problem = flowProblem(checked.flow);
			if (problem) return said(problem);
			const { flow, records } = takeRecords(checked.flow);
			const held = { keys: problemKeys(checked.flow), core: CORE_FINGERPRINT };
			const made: FakeCloudFlow = { id: `c${state.flows.length + 1}`, owner: state.signedIn!, flow, updatedAt: new Date().toISOString(), records, held };
			state.flows.push(made);
			return { id: made.id, name: made.flow.name, updatedAt: made.updatedAt };
		},
		async cloudFlow(id) {
			const r = reach(id);
			if (!r) return null;
			const records = (r.f.records ?? []).filter((x) => !x.gone).map((x) => cloudRecord(x, r.email));
			return { id, flow: structuredClone(r.f.flow), step: r.f.step ?? 0, updatedAt: r.f.updatedAt, role: r.role, records };
		},
		async people(flowId) {
			const r = reach(flowId);
			return r ? peopleOf(r.f, r.email) : null;
		},
		async share(flowId, email, role) {
			const { f, email: me } = owned(flowId);
			const u = find(email);
			if (!u) return { kind: 'noAccount' };
			if (same(u.email, me)) return { kind: 'yourself' };
			const already = roleOf(f, u.email);
			if (already) return { kind: 'already', name: u.name, role: already };
			if (u.disabled) return { kind: 'disabled', name: u.name };
			if (role === 'owner') throw new ServerUnreachable();
			f.people = { ...f.people, [u.email]: role };
			return peopleOf(f, me);
		},
		async setRole(flowId, userId, role) {
			const { f, email: me } = owned(flowId);
			if (role === 'owner' || !f.people?.[emailOf(userId)]) throw new ServerUnreachable();
			changeRole(flowId, emailOf(userId), role);
			return peopleOf(f, me);
		},
		async revoke(flowId, userId) {
			const { f, email: me } = owned(flowId);
			if (!f.people?.[emailOf(userId)]) throw new ServerUnreachable();
			changeRole(flowId, emailOf(userId), null);
			return peopleOf(f, me);
		},
		async leave(flowId) {
			const r = reach(flowId);
			if (!r || r.role === 'owner') throw new ServerUnreachable();
			changeRole(flowId, r.email, null);
		},
		async handOver(flowId, userId) {
			const { f, email: me } = owned(flowId);
			const u = find(emailOf(userId));
			if (!u || !roleOf(f, u.email) || same(u.email, me)) throw new ServerUnreachable();
			if (u.disabled) return { kind: 'disabled', name: u.name };
			handOverFlows(me, u.email, [f]);
			return peopleOf(f, me);
		},
		async deleteFlow(flowId) {
			owned(flowId);
			deleteFlow(flowId);
		},
		async shareLink(flowId) {
			const r = reach(flowId);
			if (!r) throw new ServerUnreachable();
			return r.f.link ?? null;
		},
		async switchShareLink(flowId, on) {
			const { f } = owned(flowId);
			f.link = on ? (f.link ?? `share-${nextShareLink++}`) : null;
			return f.link;
		},
		async linkedFlow(token) {
			const f = linked(token);
			if (!f) return null;
			const flow = structuredClone(f.flow);
			for (const a of flow.actions) if (a.successRate) a.successRate.records = [];
			const role = state.signedIn ? roleOf(f, state.signedIn) : undefined;
			return { id: f.id, flow, updatedAt: f.updatedAt, ...(role && { role }) };
		},
		async linkAudioBytes(token, audioId) {
			const bytes = linked(token)?.audio?.[audioId];
			return bytes ? bytes.slice() : null;
		},
		openRoom(flowId) {
			let ready = false;
			const email = state.signedIn ?? '';
			const room: FlowRoom = {
				onmessage: () => {},
				onconnection: () => {},
				retry() {
					if (!down.has(room)) return;
					if (state.link === 'online') bringBack(open);
					else room.onconnection(false, state.link);
				},
				send(sent) {
					// 跟真的一樣走 JSON（畫面上的 $state 也送得出去）
					const request = JSON.parse(JSON.stringify(sent)) as RoomRequest;
					const f = state.flows.find((g) => g.id === flowId);
					const role = f && roleOf(f, email);
					if (down.has(room)) return;
					// 連上時流程已經被刪了：刪的時候有權限的說被刪了，不然當作被收回
					if (!f) {
						const deleted = deletedFor.get(flowId)?.some((e) => same(e, email));
						if (request.kind === 'hello') deliver(room, () => ({ kind: deleted ? 'deleted' : 'revoked' }));
						return;
					}
					if (!role) return deliver(room, () => ({ kind: 'revoked' }));
					const editor = role === 'owner' || role === 'editor';
					if (request.kind === 'hello') {
						ready = request.fingerprint === state.fingerprint;
						open.tab = request.tabId;
						open.sentBack = undefined;
						if (ready) catchUp(f, request.seen, open);
						if (ready && request.records) {
							const records = (f.records ?? []).filter((r) => !r.gone).map((r) => cloudRecord(r, email));
							deliver(room, () => ({ kind: 'records', records }));
						}
						deliver(room, () => (ready ? { kind: 'ready', step: f.step ?? 0 } : { kind: 'newVersion' }));
						if (!ready) return;
						open.here = true;
						open.editing = request.editing && editor;
						tellPresent(flowId);
						const views = runViews(flowId, email);
						if (role !== 'viewer' && views.length) deliver(room, () => ({ kind: 'runThroughs', runs: views }));
					} else if (request.kind === 'mode') {
						open.editing = request.editing && editor;
						tellPresent(flowId);
					} else if (request.kind === 'record') {
						const attempts = request.attempts as StoredAttempt[];
						deliver(room, () => (ready ? store(f, email, attempts, room) : null));
					} else if (request.kind === 'changeRecords' || request.kind === 'deleteRecords' || request.kind === 'restoreRecords') {
						deliver(room, () => (ready ? amend(f, email, request, room) : null));
					} else if (
						request.kind === 'runThrough' ||
						request.kind === 'claim' ||
						request.kind === 'release' ||
						request.kind === 'touch' ||
						request.kind === 'leaveRun'
					) {
						if (role !== 'viewer') deliver(room, () => (ready ? runAsk(f, email, request) : null));
					} else if (request.kind === 'undo') {
						const { stepId, seen, of, redo, change, joined } = request;
						const sent = { stepId, seen, undo: { of, redo, change: change as RemoteChange, ...(joined && { joined }) } };
						deliver(room, () => (ready ? serveStep(f, sent, open, editor) : null));
					} else {
						const sent = { ...request, commands: request.commands as Command[] };
						deliver(room, () => (ready ? serveStep(f, sent, open, editor) : null));
					}
				},
				close() {
					const i = rooms.findIndex((r) => r.room === room);
					if (i >= 0) rooms.splice(i, 1);
					tellPresent(flowId);
				}
			};
			const open: OpenRoom = { flowId, email, room, here: false, editing: false, tab: '' };
			rooms.push(open);
			// 斷著時開的房間：馬上連不上，等下一個 microtask 才說（跟真的一樣，說的時候房間已經接好了）
			if (state.link !== 'online') {
				const why = state.link;
				down.add(room);
				queueMicrotask(() => {
					if (down.has(room)) room.onconnection(false, why);
				});
			}
			return room;
		},
		async uploadAudio(flowId, audioId, file) {
			const r = reach(flowId);
			if (!r || (r.role !== 'owner' && r.role !== 'editor')) throw new ServerUnreachable();
			const f = r.f;
			if (state.audioTooBig || file.size > MAX_CLOUD_AUDIO_BYTES) return 'tooBig';
			f.audio = { ...f.audio, [audioId]: new Uint8Array(await file.arrayBuffer()) };
			return 'ok';
		},
		async audioBytes(flowId, audioId) {
			const bytes = reach(flowId)?.f.audio?.[audioId];
			return bytes ? bytes.slice() : null;
		},
		async forgotPassword(email) {
			reachable();
			state.forgot.push(email);
		},
		async changeName(name) {
			reachable();
			const u = state.signedIn ? find(state.signedIn) : undefined;
			if (!u) return null;
			u.name = name.trim();
			return { email: u.email, name: u.name, isAdmin: u.isAdmin };
		},
		async changePassword(current, password) {
			reachable();
			if (state.retryAfter !== null) return { retryAfter: state.retryAfter };
			const u = state.signedIn ? find(state.signedIn) : undefined;
			if (!u || u.password !== current) return 'wrong';
			const n = charCount(password);
			if (n < 15) return { kind: 'tooShort', missing: 15 - n };
			if (state.breached.includes(password)) return { kind: 'breached' };
			u.password = password;
			state.otherDevices = 0;
			return 'ok';
		}
	};
	/**
	 * 網路換了（#260）：斷網（'offline'）、伺服器沒回應（'unreachable'，HTTP 也連不上）、登入超過 30 天（'expired'，登出了），
	 * 開著的房間都斷線（帶原因）；'online' 是又連上了，斷線的房間馬上連回來（跟真的自己重連一樣）。
	 * 直接改 state.link 不會通知房間：等房間自己再試（例：按「現在再試」）。
	 */
	const network = (status: 'online' | RoomDown) => {
		state.link = status;
		state.unreachable = status === 'offline' || status === 'unreachable';
		if (status === 'expired') {
			state.expired = true;
			state.signedIn = null;
		}
		for (const open of [...rooms]) {
			if (status === 'online') bringBack(open);
			else cut(open, status);
		}
	};
	/** 留著的處理掉、回答（holdRoom 不再留；hold：之後送來的照樣留著）。 */
	const releaseRoom = (hold = false) => {
		state.holdRoom = hold;
		const now = held;
		held = [];
		for (const { send } of now) send();
	};
	/** 別人（email）在別的地方打開這支流程：回他的房間（打過招呼了）、送一步、換模式。 */
	const joinAs = (flowId: string, email: string, editing = true) => {
		const signedIn = state.signedIn;
		state.signedIn = email;
		const room = server.openRoom(flowId);
		state.signedIn = signedIn;
		const heard: RoomMessage[] = [];
		room.onmessage = (m) => heard.push(m);
		room.send({ kind: 'hello', fingerprint: state.fingerprint, tabId: `tab-${email}`, seen: 0, editing, records: false });
		let n = 0;
		/** 上次看到第幾步：聽到的最後一步（換成伺服器的樣子也算）。 */
		const seen = () => Math.max(0, ...heard.map((m) => ('step' in m ? m.step : 0)));
		return {
			room,
			heard,
			step: (...commands: { name: string; args: unknown[] }[]) =>
				room.send({ kind: 'step', stepId: `step-${email}-${++n}`, seen: seen(), commands }),
			mode: (on: boolean) => room.send({ kind: 'mode', editing: on })
		};
	};
	return { server, state, releaseRoom, changeRole, deleteFlow, joinAs, recordAs, disconnect, reconnect, network };
}

/** 房間收到的一起記全上的事（#262）。 */
type RunRequest = Extract<RoomRequest, { kind: 'runThrough' | 'claim' | 'release' | 'touch' | 'leaveRun' }>;

/** 假的伺服器上開著的一次全上（#262）：表裡的人（email，照進來的先後）、誰拿著哪一組、點過沒。 */
interface FakeRun {
	id: string;
	date: string;
	startedAt: number;
	people: string[];
	keys: { key: string; email: string; touched: boolean }[];
}

/** 房間收到的改、刪、救回紀錄（#258）。 */
type AmendRequest = Extract<RoomRequest, { kind: 'changeRecords' | 'deleteRecords' | 'restoreRecords' }>;

/**
 * 假的伺服器上開著的一個房間：哪支流程、誰的、打過招呼了沒（在場名單只列打過招呼的）、在編輯嗎、
 * 哪個分頁、上次被退回時伺服器在第幾步（#254）。
 */
interface OpenRoom {
	flowId: string;
	email: string;
	room: FlowRoom;
	here: boolean;
	editing: boolean;
	tab: string;
	sentBack?: number;
}

/** 手動撥的畫面時鐘：排到下一格的先記著，測試 step() 撥一格才跑。 */
export function manualFrames() {
	let queued: (() => void)[] = [];
	return {
		nextFrame: (run: () => void) => void queued.push(run),
		/** 撥一格：跑這一格之前排的（跑的時候排的留到下一格）。 */
		step() {
			const run = queued;
			queued = [];
			for (const f of run) f();
		}
	};
}

/**
 * 一行建好編輯器 module：帶好流程的 session（算存過的，跟剛開檔一樣），adapter 全是假的。Node 和 jsdom 的測試都用它。
 * 要換掉哪個 adapter 就放進 adapters（例：慢的解碼、先放一份草稿的草稿存放），換掉的自己留著它的把手。
 * videoSaves 是預設的假影片存檔存下來的（位元組和檔名）；videoEncoder 是預設的假編碼器（release()、drawn、aborted）。
 * saves 是預設的假存檔存下來的檔（換掉 createSaver 就不會有），預設的假下載（雲端流程「⤓ 下載」）也放這裡。
 * 分頁頻道預設沒有（當作沒有別的分頁）；測兩個分頁時，兩個編輯器 module 放同一個 fakeTabs()。
 * 伺服器預設是沒人登入的假伺服器（fakeServer）。
 */
export function testEditor(flow: Flow | null = null, adapters: Partial<EditorAdapters> = {}) {
	const { saver, saves } = fakeSaver();
	const videoSaves: { bytes: Uint8Array; fileName: string }[] = [];
	const videoEncoder = createFakeVideoEncoder();
	const editor = new Editor(
		{
			createEngine: () => createFakeEngine(),
			createSaver: () => saver,
			download: async (bytes) => {
				saves.push(bytes);
				return 'downloaded';
			},
			pickFlowFile: null,
			decode: fakeDecode,
			draftStore: fakeDraftStore().store,
			openTabChannel: null,
			pendingInput: fakePendingInput(),
			nextFrame: manualFrames().nextFrame,
			server: fakeServer().server,
			offline: fakeOfflineStore().store,
			video: {
				encoder: videoEncoder,
				save: async (bytes, fileName) => {
					videoSaves.push({ bytes, fileName });
					return 'saved';
				}
			},
			...adapters
		},
		flow
	);
	return { editor, session: editor.session, saves, videoSaves, videoEncoder };
}

/**
 * 在 Node（不畫編輯頁）打開一支雲端流程（#310）：假伺服器上林教練登入，打開他的「測試」（c1，預設 libSample），
 * 王教練是編輯者（還沒打開；要他在別的地方打開就 `joinAs('c1', wang.email)`）。
 * 回假伺服器的全部把手（state.flows[0].flow 是伺服器上的樣子）、編輯器 module、session、林教練的房間（room）、兩個人。
 * cloud 換掉那支流程的其他欄位（例：records、people）；adapters 跟 testEditor 一樣（server 用這個假伺服器）。
 */
export async function cloudEditor(cloud: Partial<FakeCloudFlow> = {}, adapters: Partial<EditorAdapters> = {}) {
	const pw = '我們這一隊今年一定會贏 go go';
	const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
	const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };
	const fake = fakeServer({
		users: [lin, wang],
		signedIn: lin.email,
		flows: [
			{
				id: 'c1',
				owner: lin.email,
				flow: libSample(),
				updatedAt: new Date(2026, 10, 7).toISOString(),
				people: { [wang.email]: 'editor' },
				...cloud
			}
		]
	});
	const open = fake.server.openRoom.bind(fake.server);
	let room: FlowRoom | null = null;
	fake.server.openRoom = (id) => (room ??= open(id));
	const t = testEditor(null, { ...adapters, server: fake.server });
	await t.editor.file.openCloud('c1');
	await flush();
	fake.server.openRoom = open;
	return { ...fake, ...t, room: room!, lin, wang };
}

/** 等 async 的存檔、開檔跑完。 */
export const flush = () => new Promise((r) => setTimeout(r, 0));

/** 從「開啟流程檔」（首頁、上方列選單點的選檔欄位）或「開啟」（窄螢幕的上方列）開一個檔：只有測檔案本身才用，其他測試用 editorPage 放流程。 */
export async function openFile(bytes: Uint8Array, label = '開啟流程檔', name = '練習用.zip') {
	const file = new File([bytes as Uint8Array<ArrayBuffer>], name);
	await fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
	await flush();
}

/** 上方列「選單」的小窗（開著才有）。 */
export const menuPop = () => screen.queryByRole('dialog', { name: '選單' });

/** 打開上方列的「選單」（開著就不再按），回傳裡面的那一項（使用說明是連結，其他是按鈕）；沒有這一項回 null。 */
export async function menuItem(name: string): Promise<HTMLElement | null> {
	if (!menuPop()) await fireEvent.click(screen.getByRole('button', { name: '選單' }));
	return within(menuPop()!).queryByRole(name === '使用說明' ? 'link' : 'button', { name });
}

/** 打開上方列的「選單」，點那一項（開啟流程檔、新建、輸出影片、流程設定）。 */
export async function fromMenu(name: string) {
	const item = await menuItem(name);
	if (!item) throw new Error(`選單裡沒有「${name}」`);
	await fireEvent.click(item);
}

/**
 * 編輯頁放一個 testEditor 建的編輯器 module（給了流程就是開著它，沒給在首頁），座標換算、量字也是假的：`render(Page, page.props)`。
 * adapters 跟 testEditor 一樣，只有沒送出的字用真的（jsdom 有焦點和 change，存檔、⌘Z、關分頁要看到欄位裡打的字），
 * 畫面時鐘也用真的（jsdom 的 requestAnimationFrame，測試等下一格畫面）。
 * 測試讀 `page.session.flow`；`page.saves` 是按存檔存下來的檔，只有測檔案本身才讀。
 */
export function editorPage(flow: Flow | null = null, adapters: Partial<EditorAdapters> = {}) {
	const t = testEditor(flow, { pendingInput: domPendingInput, nextFrame: animationFrame, ...adapters });
	return { ...t, props: { editor: t.editor, toMeters: fakeToMeters, cellAt: fakeCellAt, measure: fakeMeasure, scrubAt: fakeScrubAt } };
}

/** 假的量字（流程影片的版面；jsdom 沒有 Canvas，見 ADR 0002）：英數字 0.6 個字高寬，其他（中文、全形符號）1 個字高寬。 */
export const fakeMeasure: Measure = (t, px) => [...t].reduce((w, c) => w + (/[\x00-\x7f]/.test(c) ? 0.6 : 1) * px, 0);

/** 假的座標換算：檢視畫面的進度條，clientX 就是整支流程的百分之幾（見 ADR 0002）。 */
export const fakeScrubAt = (_bar: HTMLElement, clientX: number): number => clientX / 100;

/** 假的座標換算：場地的螢幕換公尺換成 1 px = 1 cm（見 ADR 0002）。 */
export const fakeToMeters = (e: { clientX: number; clientY: number }): Position => [e.clientX / 100, e.clientY / 100];

/**
 * 假的「指標位置 → 拍點格子」（jsdom 不算版面，見 ADR 0002）：
 * clientX 是第幾個格子（照畫面順序），clientY 是第幾條（0 數字格、1 拍子、2 步驟、3 手位）。
 */
export function fakeCellAt(sheet: HTMLElement, x: number, y: number): HTMLElement {
	const kind = ['.cell', '.slot.count', '.slot.step', '.slot.motion'][y];
	return sheet.querySelectorAll<HTMLElement>(kind)[x];
}

// 頁面測試常用的範例流程。都叫「練習用」。

/** 音樂 1（a1.mp3）；小A 在一個動作裡（Lib，技巧）。測存檔、草稿用。 */
export function audioFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'top' }]));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(loadSegmentAudio(flow, 's1', '主歌.mp3'));
	return flowOf(
		addAction(flow, {
			segmentId: 's1',
			category: 'stunt',
			name: 'Lib',
			start: 0,
			length: 16,
			note: '',
			members: [{ memberId: 'm1', role: '上層' }]
		})
	);
}

/**
 * 音樂 1（4 個八拍）；小美、小芳是上層，小A、小B 是底層（m1 到 m4）。
 * x1：Lib（技巧，第 1 個八拍），四個人都在，還沒有環節。
 */
export function teamFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' },
			{ name: '小芳', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' },
		{ memberId: 'm3', role: '上層' },
		{ memberId: 'm4', role: '主底' }
	];
	return flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members }));
}

/** teamFlow 的 Lib 加上環節：p1 上法 1-1 到 1-2、p2 中段 1-3 到 1-6、p3 下法 1-7 到 1-8（全部的人先在第 1 組）。 */
export function phasedFlow(): Flow {
	let flow = teamFlow();
	for (const [kind, at, len] of [['load', 0, 4], ['hold', 4, 8], ['dismount', 12, 4]] as const) {
		flow = flowOf(addPhase(flow, 'x1', { kind, name: '', beats: { at: at, len: len } }));
	}
	return flow;
}

/** phasedFlow 再分組：小美、小A 第 1 組，小芳、小B 第 2 組。 */
function squadFlow(): Flow {
	let flow = phasedFlow();
	for (const [id, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
		flow = flowOf(setSquad(flow, 'x1', [id], squad));
	}
	return flow;
}

/** squadFlow 加上紀錄（11/4 分段練，上法 ✓）：第 1 組記了 2 次，第 2 組記了 1 次。 */
export function recordedFlow(): Flow {
	let flow = squadFlow();
	for (const who of ['g1', 'g1', 'g2']) {
		const attempt = { date: '2026-11-04', who, practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } };
		flow = flowOf(recordAttempt(flow, 'x1', attempt));
	}
	return flow;
}

/**
 * squadFlow 再加：
 * x2：拋投（第 2 個八拍的前 4 拍），還沒有環節；小芳。
 * x3：騰翻（第 3 個八拍），環節翻法「騰翻」整個動作；小美、小A。
 */
export function practiceFlow(): Flow {
	let flow = squadFlow();
	const toss = [{ memberId: 'm3', role: '上層' }];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'toss', name: '', start: 16, length: 8, note: '', members: toss }));
	const tumbling = [
		{ memberId: 'm1', role: '騰翻' },
		{ memberId: 'm2', role: '騰翻' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'tumbling', name: '', start: 32, length: 16, note: '', members: tumbling }));
	return flowOf(addPhase(flow, 'x3', { kind: 'tumble', name: '騰翻', beats: { at: 0, len: 16 } }));
}
