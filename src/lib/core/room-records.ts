// 這串紀錄收不收（#348，ADR 0011、0015、0018）：雲端流程的房間收到一串「記一次」，照伺服器的規則決定每一筆收不收。
// 假伺服器和 Rust 伺服器（records.rs 的 record，#349 量過時間才改叫 receiveRecordsJson）都叫它。規則的先後照 #349 以前真的伺服器：
// 同一批重複的 id 只算第一筆 → 收過的 id 回存著的那一筆（收過、後來清掉的兩邊都不放）→ 不能記的不收 →
// 照「記一次」的規則檢查（checkRecord；流程核心看不懂就這一批新的都不收）→ 同一次全上、同一個動作、同一組有人先存了不收。
// 同一批裡後面的看得到前面剛收的。
//
// 管：上面這些規則。
// 不管：從哪裡挑出有關的紀錄、存、鎖、告訴房間裡的人、流程被刪了、權限被收回、沒收的中文句子、
// 給每個人看的樣子（誰記的、是不是我的）（都是呼叫的人做）。
// 不用 structuredClone（伺服器的 QuickJS 沒有），也不改傳進來的東西。

import type { Flow } from './flow';
import { checkRecord, type StoredAttempt } from './stored-records';
import type { Said } from './why';

/** 伺服器上跟送來的有關的一次：gone 是清掉了；by 是記的人的名字（沒有記的人，例：從流程檔來的，就不帶）。 */
export interface KnownRecord extends StoredAttempt {
	gone?: boolean;
	by?: string;
}

/**
 * 要決定的。flow：伺服器現在的編排（不帶紀錄）。canRecord：送的人是擁有者、編輯者、記錄者。by：送的人的名字
 * （同一批裡前面剛收的跟後面的同一組時，寫是誰先存的）。sent：送來的一串紀錄（照送來的順序）。
 * records：伺服器上跟它們有關的紀錄：同樣 id 的（連清掉的），和同一次全上、同一個動作、同一組還在的。多給的不算。
 */
export interface RecordsAsk {
	flow: Flow;
	canRecord: boolean;
	by: string;
	sent: StoredAttempt[];
	records: KnownRecord[];
}

/** 不收的原因：不能記、同一次全上的同一組別人先存了（by 是誰；沒帶是不知道是誰）、被「記一次」的規則擋下、看不懂。 */
export type RecordRefusal =
	| { code: 'viewOnly' }
	| { code: 'takenInRun'; by?: string }
	| { code: 'blocked'; reason: Said }
	| { code: 'notUnderstood' };

/**
 * 一筆的結果。again：收過了，回存著的那一筆（給的 records 裡那一筆）。skipped：兩邊都不放（收過、後來清掉了；
 * 同一批裡重複的 id 後面那幾筆；沒有 id 的）。refused：不收。accepted：收，record 是檢查過、要存的樣子。
 */
export type RecordVerdict =
	| { kind: 'again'; id: string; record: KnownRecord }
	| { kind: 'skipped' }
	| { kind: 'refused'; id: string; why: RecordRefusal }
	| { kind: 'accepted'; id: string; record: StoredAttempt };

/** 決定這串紀錄每一筆收不收（見檔頭）：照送來的順序，一筆一個結果。 */
export function receiveRecords(ask: RecordsAsk): RecordVerdict[] {
	const known = new Map<string, KnownRecord>();
	for (const r of ask.records) if (!known.has(r.attempt.id)) known.set(r.attempt.id, r);
	const seen = new Set<string>();
	const out: (RecordVerdict | undefined)[] = [];
	/** 沒收過的（index、id）：之後再看能不能記、檢查。 */
	const fresh: { at: number; id: string; record: StoredAttempt }[] = [];
	ask.sent.forEach((record, at) => {
		const id: unknown = record?.attempt?.id;
		if (typeof id !== 'string' || seen.has(id)) return out.push({ kind: 'skipped' });
		seen.add(id);
		const had = known.get(id);
		if (had) return out.push(had.gone ? { kind: 'skipped' } : { kind: 'again', id, record: had });
		out.push(undefined);
		fresh.push({ at, id, record });
	});
	const refuse = (why: RecordRefusal) => {
		for (const { at, id } of fresh) out[at] = { kind: 'refused', id, why };
	};
	if (!ask.canRecord) refuse({ code: 'viewOnly' });
	else {
		let checked;
		try {
			checked = fresh.map(({ record }) => checkRecord(ask.flow, record));
		} catch {
			// 流程核心看不懂（例：空著的環節不是陣列）：這一批新的都不收（跟伺服器一次檢查整批一樣）
			checked = undefined;
		}
		if (!checked) refuse({ code: 'notUnderstood' });
		else {
			/** 這一批剛收的（同一次全上的同一組，後面的看得到）。 */
			const taken: KnownRecord[] = [];
			fresh.forEach(({ at, id }, i) => {
				const c = checked[i];
				if (c.kind === 'dropped') {
					out[at] = { kind: 'refused', id, why: { code: 'blocked', reason: c.why ? { message: c.message, why: c.why } : { message: c.message } } };
					return;
				}
				const first = firstInRun([...ask.records, ...taken], c.record);
				if (first) {
					out[at] = { kind: 'refused', id, why: first.by === undefined ? { code: 'takenInRun' } : { code: 'takenInRun', by: first.by } };
					return;
				}
				taken.push({ ...c.record, by: ask.by });
				out[at] = { kind: 'accepted', id, record: c.record };
			});
		}
	}
	return out as RecordVerdict[];
}

/** 同一次全上、同一個動作、同一組（騰翻、跳躍是同一個人）已經存了的別的一筆（還在的）。 */
function firstInRun(records: KnownRecord[], r: StoredAttempt): KnownRecord | undefined {
	const run = r.attempt.runThroughId;
	if (run === undefined) return undefined;
	return records.find(
		(o) =>
			!o.gone &&
			o.attempt.id !== r.attempt.id &&
			o.attempt.runThroughId === run &&
			o.actionId === r.actionId &&
			o.attempt.who === r.attempt.who
	);
}
