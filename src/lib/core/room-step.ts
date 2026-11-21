// 這一步收不收（#315，ADR 0010、0011、0014、0007）：雲端流程的房間收到一步（或復原、重做），照伺服器的規則決定收了還是退回。
// 假伺服器和 Rust 伺服器（flow_room.rs 的 take_step 用 QuickJS 叫 takeStepJson，ADR 0018）都叫它，規則只有這一份：
// 收過的步驟 id 回原本的結果；不能改的退回；前一步被退回還沒換上就送的退回；上次看到之後的步沒留了退回；
// 復原那一步沒留或超過 30 天退回；那一步之後別的分頁改過那些東西退回；放回去整份檢查不合退回；
// 被規則擋下、要問而沒問退回（寫上次看到之後最後改過的人）；這一步改到的東西上次看到之後被別的分頁改過退回（寫最後改到的人）。
// 收了回改好的編排、要送給別人的改動、紀錄要改的和要清的、要記的步驟紀錄。
//
// 管：上面這些規則，和收了之後紀錄怎麼跟著變（清掉、改掉、復原加回來；同一次全上的同一組撞在一起只算先存的）。
// 不管：從哪裡挑出步驟紀錄、存、鎖、送給房間裡的人、流程被刪了、權限被收回、退回的中文句子、現在幾點（都是呼叫的人給或做）。
// 不用 structuredClone（伺服器的 QuickJS 沒有），也不改傳進來的東西。

import type { Command } from './commands';
import { runCommands } from './commands';
import { runUndo } from './cloud-undo';
import type { Flow } from './flow';
import { remoteChange, type RemoteChange } from './remote-change';
import { stepKeys } from './step-keys';
import { putRecords, takeRecords, type StoredAttempt } from './stored-records';
import type { Said } from './why';

/** 步驟紀錄留幾天：比這久的步不能復原、重做。 */
export const KEPT_DAYS = 30;
const KEPT_MS = KEPT_DAYS * 24 * 60 * 60 * 1000;

/** 一步清掉、改掉的一次（ADR 0007）：改之前的樣子（復原加回來的是 null）、這一步之後的樣子（整筆清掉是 null）。 */
export interface ClearedRecord {
	was: StoredAttempt | null;
	now: StoredAttempt | null;
}

/** 步驟紀錄的一筆：第幾步、步驟 id、哪個分頁送的、送的人的名字、什麼時候收的（毫秒）、改到的東西、清掉改掉的紀錄。 */
export interface LoggedStep {
	step: number;
	id: string;
	tab: string;
	by: string;
	at: number;
	keys: string[];
	cleared: ClearedRecord[];
}

/** 伺服器上的一次：連清掉的（gone）也要；amendedStep 是最後一次用手改、刪、救回時流程是第幾步。 */
export interface RoomRecord extends StoredAttempt {
	gone?: boolean;
	amendedStep?: number;
}

/** 送來的一步：跑一串指令，或復原、重做 of 那一步（change 是要放回去的樣子）。 */
export type SentStep =
	| { stepId: string; seen: number; commands: Command[] }
	| { stepId: string; seen: number; undo: { of: string; redo: boolean; change: RemoteChange } };

/**
 * 決定一步要的東西。
 * flow、step：伺服器現在的編排（不帶紀錄）、第幾步。records：這支流程的紀錄（照存的先後，連清掉的）。
 * log：還留著的步驟紀錄，至少要有上次看到（seen）之後的每一步；復原、重做時還要有 of 那一步和它之後的每一步。
 * 不用先挑分頁、改到的東西（這裡挑）。now：現在（毫秒）。canEdit：送的人是擁有者、編輯者。
 * tab、by：送的分頁、送的人的名字。sentBack：這個連線上次被退回時伺服器在第幾步。
 * taken：這個步驟 id 已經收過了：那時第幾步、那一步的改動（舊的步沒記是 null）。
 */
export interface StepAsk {
	flow: Flow;
	step: number;
	records: RoomRecord[];
	log: LoggedStep[];
	now: number;
	canEdit: boolean;
	tab: string;
	by: string;
	sentBack?: number;
	taken?: { step: number; change: RemoteChange | null };
	sent: SentStep;
}

/** 退回的原因（跟伺服器送的 SentBack 一樣的樣子，畫面照使用者的語言寫成句子，ADR 0017）。 */
export type StepRefusal =
	| { code: 'viewOnly' }
	| { code: 'afterSentBack' }
	| { code: 'tooOld' }
	| { code: 'undoTooOld'; redo: boolean }
	| { code: 'notUnderstood' }
	| { code: 'undoChangedLater'; by: string; redo: boolean }
	| { code: 'undoBlocked'; redo: boolean; reason: Said }
	| { code: 'blocked'; reason: Said; ask: boolean }
	| { code: 'sameThing' };

/**
 * 結果。again：步驟 id 收過了，回原本的。rejected：退回（by 是最後改到的人，或被擋下時上次看到之後最後改過的人）。
 * accepted：改好的編排、要送給別人的改動（RemoteChange）、紀錄改好的（存成這樣、沒清掉）、要清掉的 id、要記的步驟紀錄（第 step + 1 步）。
 */
export type StepVerdict =
	| { kind: 'again'; step: number; change: RemoteChange | null }
	| { kind: 'rejected'; why: StepRefusal; by?: string }
	| {
			kind: 'accepted';
			flow: Flow;
			change: RemoteChange;
			changed: StoredAttempt[];
			deleted: string[];
			logged: LoggedStep;
	  };

/** 跑完的結果：成功帶不帶紀錄的編排、跑完還在的紀錄、記下的鍵、要查的鍵；沒成功帶原因（ask：是要問而沒問）。 */
type Ran =
	| { kind: 'ok'; flow: Flow; records: StoredAttempt[]; keys: string[]; watch: string[] }
	| { kind: 'no'; reason: Said; ask: boolean };

/** 決定這一步收不收（見檔頭）。 */
export function takeStep(ask: StepAsk): StepVerdict {
	const { flow, step, log, now, tab, sent } = ask;
	const { stepId, seen } = sent;
	if (ask.taken) return { kind: 'again', step: ask.taken.step, change: ask.taken.change };
	const rejected = (why: StepRefusal, by?: string): StepVerdict =>
		by === undefined ? { kind: 'rejected', why } : { kind: 'rejected', why, by };
	if (!ask.canEdit) return rejected({ code: 'viewOnly' });
	if (ask.sentBack !== undefined && seen < ask.sentBack) return rejected({ code: 'afterSentBack' });
	if (seen < step && !log.some((l) => l.step === seen + 1)) return rejected({ code: 'tooOld' });

	/** after 之後別的分頁送的最後一步是誰送的；給了 watch 只看改到其中一個的。 */
	const lastOther = (after: number, watch?: string[]) =>
		log.findLast((l) => l.step > after && l.tab !== tab && (!watch || l.keys.some((k) => watch.includes(k))))?.by;
	const live = ask.records.filter((r) => !r.gone).map(stored);
	let ran: Ran;
	let revived: string[] = [];
	try {
		if ('undo' in sent) {
			const { of: id, redo, change } = sent.undo;
			const of = log.find((l) => l.id === id && l.at > now - KEPT_MS);
			if (!of) return rejected({ code: 'undoTooOld', redo });
			const back = broughtBack(ask.records, of, live);
			revived = back.revived;
			const u = runUndo(flow, back.records, change);
			ran = u.kind === 'ok' ? u : { kind: 'no', reason: reasonOf(u), ask: false };
			const touched = [...of.keys, ...(ran.kind === 'ok' ? ran.watch : [])];
			const by = lastOther(of.step, touched);
			if (by !== undefined) return rejected({ code: 'undoChangedLater', by, redo });
			if (ran.kind !== 'ok') return rejected({ code: 'undoBlocked', redo, reason: ran.reason });
		} else {
			const r = runCommands(putRecords(flow, live), sent.commands, stepId);
			if (r.kind === 'ok') {
				const taken = takeRecords(r.flow);
				ran = { kind: 'ok', ...taken, ...stepKeys(flow, taken.flow) };
			} else ran = { kind: 'no', reason: reasonOf(r), ask: r.kind !== 'blocked' };
		}
	} catch {
		// 流程核心看不懂（例：沒有這個指令、參數不對）
		return rejected({ code: 'notUnderstood' });
	}
	if (ran.kind !== 'ok') return rejected({ code: 'blocked', reason: ran.reason, ask: ran.ask }, lastOther(seen));
	const by = lastOther(seen, ran.watch);
	if (by !== undefined) return rejected({ code: 'sameThing' }, by);
	const records = recordsAfter(ask.records, live, ran.records, revived);
	return {
		kind: 'accepted',
		flow: ran.flow,
		change: remoteChange(flow, ran.flow),
		changed: records.changed,
		deleted: records.deleted,
		logged: { step: step + 1, id: stepId, tab, by: ask.by, at: now, keys: ran.keys, cleared: records.cleared }
	};
}

/** 被擋的原因：有代號才帶 why。 */
function reasonOf({ message, why }: Said): Said {
	return why ? { message, why } : { message };
}

/** 只留動作和那一次（伺服器上的一次多帶的拿掉）。 */
function stored({ actionId, attempt }: StoredAttempt): StoredAttempt {
	return { actionId, attempt };
}

/** 兩個 JSON 值一樣（物件不管鍵的先後，跟伺服器比 JSON 一樣）。 */
function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => sameJson(x, (b as unknown[])[i]));
	const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
	const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
	return ka.length === kb.length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const same = (a: StoredAttempt, b: StoredAttempt) => a.actionId === b.actionId && sameJson(a.attempt, b.attempt);

/**
 * 復原 of 那一步時給流程核心的紀錄（ADR 0007）：現在的紀錄，加上那一步清掉、到現在還清掉著的，
 * 那一步改掉、到現在沒再動過的換回改之前的樣子，那一步加回來（復原）、到現在沒再動過的再清掉（重做）。
 * 那一步之後才用手改、刪、救回過的照現在的（內容一樣也算，例：刪掉再救回）。回紀錄和加回來的（現在清掉著的）id。
 */
function broughtBack(all: RoomRecord[], of: LoggedStep, live: StoredAttempt[]) {
	const byId = firstById(all);
	/** 還在的要換成（改之前的樣子）或拿掉（null）的。 */
	const swap = new Map<string, StoredAttempt | null>();
	const added: StoredAttempt[] = [];
	const revived: string[] = [];
	for (const { was, now } of of.cleared) {
		const id = (was ?? now)?.attempt.id;
		const current = id === undefined ? undefined : byId.get(id);
		if (!current || (current.amendedStep !== undefined && current.amendedStep >= of.step)) continue;
		if (was && !now && current.gone) {
			revived.push(current.attempt.id);
			added.push(was);
		} else if (now && !current.gone && same(current, now)) {
			swap.set(current.attempt.id, was);
		}
	}
	const records = live.flatMap((r) => {
		const to = swap.get(r.attempt.id);
		return to === undefined ? [r] : to ? [to] : [];
	});
	return { records: [...records, ...added], revived };
}

/** 照 id 找第一筆（跟 find 一樣：同一個 id 有兩筆時拿前面的）。 */
function firstById<T extends StoredAttempt>(list: T[]): Map<string, T> {
	const byId = new Map<string, T>();
	for (const r of list) if (!byId.has(r.attempt.id)) byId.set(r.attempt.id, r);
	return byId;
}

/**
 * 跑完之後紀錄怎麼變：before（跑之前還在的）不在 after 的清掉；改了的存成改好的，可是換了動作、組之後跟同一次全上
 * 別的一筆（還在的）撞在一起就只算先存的、這一筆清掉；revived（復原加回來的）還在 after、沒撞到的拿回來。
 * 照順序一筆一筆做（後面的看得到前面改好的）。回改好的、清掉的 id，和要記在這一步的（復原時加回來）。
 */
function recordsAfter(all: RoomRecord[], before: StoredAttempt[], after: StoredAttempt[], revived: string[]) {
	const next = new Map(after.map((r) => [r.attempt.id, r]));
	// 現在的樣子（一筆一筆改）：查撞在一起用
	const now = new Map<string, StoredAttempt & { gone: boolean }>();
	for (const r of all) if (!now.has(r.attempt.id)) now.set(r.attempt.id, { ...stored(r), gone: !!r.gone });
	// 同一次全上、同一個動作、同一組的還在的 id（查撞在一起用，跟著 now 改）。
	// 第一次要查時才從 now 建：沒改到全上紀錄的步驟（例：改流程名字）不用建
	const group = (r: StoredAttempt) => JSON.stringify([r.attempt.runThroughId, r.actionId, r.attempt.who]);
	let groups: Map<string, Set<string>> | undefined;
	const join = (r: StoredAttempt & { gone: boolean }, on: boolean) => {
		if (!groups || r.gone || r.attempt.runThroughId === undefined) return;
		const k = group(r);
		const ids = groups.get(k) ?? new Set<string>();
		if (on) ids.add(r.attempt.id);
		else ids.delete(r.attempt.id);
		groups.set(k, ids);
	};
	const set = (id: string, to: StoredAttempt | null) => {
		const old = now.get(id);
		if (!old) return;
		const r = to ? { ...to, gone: false } : { ...old, gone: true };
		join(old, false);
		join(r, true);
		now.set(id, r);
	};
	const collides = (r: StoredAttempt) => {
		if (r.attempt.runThroughId === undefined) return false;
		if (!groups) {
			groups = new Map();
			for (const x of now.values()) join(x, true);
		}
		const ids = groups.get(group(r));
		return !!ids && ids.size > (ids.has(r.attempt.id) ? 1 : 0);
	};
	const deleted: string[] = [];
	const changedIds = new Set<string>();
	const was = new Map<string, StoredAttempt>();
	for (const old of before) {
		const id = old.attempt.id;
		const r = next.get(id);
		if (!r) {
			set(id, null);
			deleted.push(id);
			was.set(id, old);
		} else if (!same(r, old)) {
			was.set(id, old);
			if (collides(r)) {
				set(id, null);
				deleted.push(id);
				continue;
			}
			set(id, r);
			changedIds.add(id);
		}
	}
	for (const id of revived) {
		const r = next.get(id);
		if (!r || collides(r)) continue;
		set(id, r);
		changedIds.add(id);
	}
	const kept = (id: string) => (changedIds.has(id) ? stored(next.get(id)!) : null);
	const cleared: ClearedRecord[] = [
		...before.flatMap((old) => {
			const w = was.get(old.attempt.id);
			return w ? [{ was: w, now: kept(old.attempt.id) }] : [];
		}),
		...revived.flatMap((id) => {
			const k = kept(id);
			return k ? [{ was: null, now: k }] : [];
		})
	];
	// 改好的照存的先後（跟伺服器重讀的一樣）
	const changed = all.filter((r) => changedIds.has(r.attempt.id)).map((r) => stored(next.get(r.attempt.id)!));
	return { changed, deleted, cleared };
}
