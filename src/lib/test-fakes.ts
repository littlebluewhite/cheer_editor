// 測試共用的假 adapter：存檔、草稿、分頁頻道、解碼、座標換算、連伺服器（jsdom 沒有檔案系統、IndexedDB、Web Audio、SVG 座標，前端測試不開真的伺服器），
// 一行建好帶假 adapter 的編輯器 module（testEditor，Node 也能用）、放好流程的編輯頁、開檔這些小工具，
// 和頁面測試常用的範例流程。flowOf 用測試共用那份（#lib/test-flows.js）。只給測試用，頁面不 import。
import { fireEvent, screen } from '@testing-library/svelte';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import {
	addAction,
	charCount,
	addMembers,
	addSegment,
	createFlow,
	loadSegmentAudio,
	addPhase,
	recordAttempt,
	setSquad,
	updateSegment,
	type Flow,
	type Position
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { Editor, type EditorAdapters } from '#lib/editor.svelte.js';
import type { DraftStore } from '#lib/file/draft.js';
import type { FileSaver, SaveOutcome } from '#lib/file/save.js';
import { domPendingInput, type PendingInput } from '#lib/pending-input.js';
import { animationFrame } from '#lib/playback.svelte.js';
import type { OpenTabChannel, TabMessage } from '#lib/tab-channel.js';
import { ServerUnreachable, type AdminResult, type LinkInfo, type Me, type ServerAdapter, type UserStatus } from '#lib/server-api.js';

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

/** 假的伺服器上的一支雲端流程：擁有者的 email、編排、最後改的時間（ISO）。 */
export interface FakeCloudFlow {
	id: string;
	owner: string;
	flow: Flow;
	updatedAt: string;
}

/**
 * 假的連伺服器：使用者、設密碼連結（token → 那條連結）放在記憶體，規則跟真的一樣
 * （email 不分大小寫；密碼至少 15 個看得到的字、不在外洩清單 breached 裡；連結用一次就不能用；被停用的登不進去）。
 * signedIn：現在登入的是誰（沒登入是 null）。flows：雲端流程（只有擁有者拿得到）。unreachable 設成 true 就是連不上伺服器。
 * 管理使用者：使用者的 id 是他在 users 裡的位置 + 1；mailQuota 設成 true 就是寄信服務今天的額度用完了。
 * expired 設成 true：沒登入是因為登入超過 30 天了。retryAfter 設成秒數：猜密碼試太多次（鎖住），登入、改密碼都回要等幾秒。
 * forgot：按過忘記密碼的 email（照順序）。otherDevices：改密碼時其他裝置都登出，記成 0。
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
		otherDevices: 1
	};
	let nextToken = 1;
	const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
	const find = (email: string) => state.users.find((u) => same(u.email, email));
	/** 登入的人擁有的雲端流程（沒登入丟錯，跟真的伺服器回 401 一樣當作出錯）。 */
	const mine = () => {
		reachable();
		const me = state.signedIn && find(state.signedIn);
		if (!me) throw new ServerUnreachable();
		return state.flows.filter((f) => f.owner === me.email);
	};
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
		if (u.disabled) return { kind: 'disabled' };
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
		async myFlows() {
			return [...mine()]
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
				.map((f) => ({ id: f.id, name: f.flow.name, updatedAt: f.updatedAt }));
		},
		async createFlow(input) {
			mine();
			const r = createFlow(input);
			if (r.kind !== 'ok') throw new Error(r.kind === 'blocked' ? r.message : r.kind);
			const made = { id: `c${state.flows.length + 1}`, owner: state.signedIn!, flow: r.flow, updatedAt: new Date().toISOString() };
			state.flows.push(made);
			return { id: made.id, name: made.flow.name, updatedAt: made.updatedAt };
		},
		async cloudFlow(id) {
			const f = mine().find((g) => g.id === id);
			return f ? { id: f.id, flow: structuredClone(f.flow), step: 0, updatedAt: f.updatedAt } : null;
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
	return { server, state };
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
 * saves 是預設的假存檔存下來的檔（換掉 createSaver 就不會有）。
 * 分頁頻道預設沒有（當作沒有別的分頁）；測兩個分頁時，兩個編輯器 module 放同一個 fakeTabs()。
 * 伺服器預設是沒人登入的假伺服器（fakeServer）。
 */
export function testEditor(flow: Flow | null = null, adapters: Partial<EditorAdapters> = {}) {
	const { saver, saves } = fakeSaver();
	const editor = new Editor(
		{
			createEngine: () => createFakeEngine(),
			createSaver: () => saver,
			pickFlowFile: null,
			decode: fakeDecode,
			draftStore: fakeDraftStore().store,
			openTabChannel: null,
			pendingInput: fakePendingInput(),
			nextFrame: manualFrames().nextFrame,
			server: fakeServer().server,
			...adapters
		},
		flow
	);
	return { editor, session: editor.session, saves };
}

/** 等 async 的存檔、開檔跑完。 */
export const flush = () => new Promise((r) => setTimeout(r, 0));

/** 從「開啟流程檔」（首頁）或「開啟」（上方列）開一個檔：只有測檔案本身才用，其他測試用 editorPage 放流程。 */
export async function openFile(bytes: Uint8Array, label = '開啟流程檔', name = '練習用.zip') {
	const file = new File([bytes as Uint8Array<ArrayBuffer>], name);
	await fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
	await flush();
}

/**
 * 編輯頁放一個 testEditor 建的編輯器 module（給了流程就是開著它，沒給在首頁），座標換算也是假的：`render(Page, page.props)`。
 * adapters 跟 testEditor 一樣，只有沒送出的字用真的（jsdom 有焦點和 change，存檔、⌘Z、關分頁要看到欄位裡打的字），
 * 畫面時鐘也用真的（jsdom 的 requestAnimationFrame，測試等下一格畫面）。
 * 測試讀 `page.session.flow`；`page.saves` 是按存檔存下來的檔，只有測檔案本身才讀。
 */
export function editorPage(flow: Flow | null = null, adapters: Partial<EditorAdapters> = {}) {
	const t = testEditor(flow, { pendingInput: domPendingInput, nextFrame: animationFrame, ...adapters });
	return { ...t, props: { editor: t.editor, toMeters: fakeToMeters, cellAt: fakeCellAt } };
}

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
 * x3：騰翻（第 3 個八拍），環節整體「騰翻」整個動作；小美、小A。
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
	return flowOf(addPhase(flow, 'x3', { kind: 'whole', name: '騰翻', beats: { at: 0, len: 16 } }));
}
