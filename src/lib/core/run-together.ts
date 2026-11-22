// 一起記全上的表（#352，ADR 0015、0020）：誰在哪次全上的表裡、誰拿著哪幾組、點過沒，怎麼變。
// 規則只有這一份：真的伺服器（server/src/run_together.rs，#353 起）和假伺服器都叫它。
// 拿一組：沒人拿著、拿著的人還沒點過記號（送的人說看到是他拿著）、或拿著的人已經離開（斷線超過 1 分鐘）就給他；
// 點過的拿不走；搶同一組照收到的先後，後到的退回。表裡的人都離開了，那次全上就沒了，不能再加入（自己開的、重報的回得來）。
//
// 管：開、加入、重報；拿一組、放掉、點了；離開；一個連線斷了；請出去（被收回、降成檢視者）；給某一個人看的樣子。
// 不管：表放在哪（伺服器的記憶體，ADR 0015）、誰能送（檢視者不收是呼叫的人擋）、告訴誰、斷線 1 分鐘後再說一次、
// 真正擋住「一組記兩次」（存紀錄，room-records.ts）。現在幾點由叫的人給（毫秒）。
// 不用 structuredClone（伺服器的 QuickJS 沒有），也不改傳進來的東西。

/** 斷線多久就當他離開那張表（毫秒）。伺服器的 run_together.rs GONE_AFTER 是同一個，改一邊要改另一邊。 */
export const GONE_MS = 60_000;

/** 一支流程開著的全上（照開的先後）。只是 JSON，叫的人原樣存著、下次再傳進來。 */
export type RunsTogether = TogetherRun[];

/** 一次全上：表裡的人（照進來的先後）、誰拿著哪一組（照拿的先後）。 */
export interface TogetherRun {
	id: string;
	date: string;
	startedAt: number;
	people: TogetherPerson[];
	keys: TogetherHold[];
}

/** 表裡的一個人：進來時的名字、在這張表上連著的連線、連線都斷了的時間（沒斷是 null）。 */
export interface TogetherPerson {
	userId: number;
	name: string;
	conns: number[];
	awaySince: number | null;
}

export interface TogetherHold {
	key: string;
	userId: number;
	touched: boolean;
}

/** 誰送的：哪個人、哪個連線、叫什麼。 */
export interface RunWho {
	userId: number;
	conn: number;
	name: string;
}

/** 我在這次全上的表裡（開、加入、連上時再報）。joining：加入別人開的（那次已經沒了就不能加入）。 */
export interface RunReport {
	id: string;
	date: string;
	startedAt: number;
	keys: string[];
	touched: string[];
	joining: boolean;
}

/** 拿（from：送的人看到誰拿著，沒人是 null）、放掉、點了一組，或離開表（存好、取消）。 */
export type RunAsk = { kind: 'claim'; key: string; from: number | null } | { kind: 'release'; key: string } | { kind: 'touch'; key: string } | { kind: 'leave' };

/** 發生的事：報、問（拿、放掉、點了、離開）、一個連線斷了、請出去。 */
export type RunEvent =
	| { kind: 'report'; who: RunWho; report: RunReport }
	| { kind: 'ask'; who: RunWho; run: string; ask: RunAsk }
	| { kind: 'disconnect'; conn: number }
	| { kind: 'kick'; userId: number };

/** 要跟送的人說的：好了；這一組別人拿著（名字、點過了沒）；那次全上的人都離開了，不能加入。 */
export type RunAnswer = { kind: 'done' } | { kind: 'refused'; by: string; touched: boolean } | { kind: 'closed' };

/** 做完的：新的表、回答、表變了沒（變了才告訴能記的人）。 */
export interface RunOutcome {
	runs: RunsTogether;
	answer: RunAnswer;
	changed: boolean;
}

/** 給能記的人看的一次全上（跟伺服器的 RunView 一樣）。 */
export interface RunTogetherView {
	id: string;
	date: string;
	startedAt: number;
	/** 還在表裡的人（斷線不到 1 分鐘的也算），照進來的先後。 */
	people: { name: string; me: boolean; away: boolean }[];
	/** 有人拿著的組（離開了的人拿著的也列，別人能接手）。 */
	keys: { key: string; userId: number; name: string; mine: boolean; touched: boolean; away: boolean }[];
}

const gone = (p: TogetherPerson, now: number) => p.awaySince !== null && now - p.awaySince >= GONE_MS;
const personOf = (run: TogetherRun, userId: number) => run.people.find((p) => p.userId === userId);
const nameOf = (run: TogetherRun, userId: number) => personOf(run, userId)?.name ?? '';
/** 沒有人還在表裡（都離開了）。 */
const empty = (run: TogetherRun, now: number) => run.people.every((p) => gone(p, now));

/** 這個人進表裡（或連回來）。 */
function enter(run: TogetherRun, who: RunWho) {
	const p = personOf(run, who.userId);
	if (!p) run.people.push({ userId: who.userId, name: who.name, conns: [who.conn], awaySince: null });
	else {
		if (!p.conns.includes(who.conn)) p.conns.push(who.conn);
		p.awaySince = null;
	}
}

/** 這個人離開表：拿著的組放掉。 */
function dropPerson(run: TogetherRun, userId: number) {
	run.people = run.people.filter((p) => p.userId !== userId);
	run.keys = run.keys.filter((h) => h.userId !== userId);
}

/** 都離開了的全上拿掉。 */
const prune = (runs: RunsTogether, now: number) => runs.filter((r) => !empty(r, now));

function report(runs: RunsTogether, who: RunWho, rep: RunReport, now: number): [RunsTogether, RunAnswer] {
	runs = prune(runs, now);
	let run = runs.find((r) => r.id === rep.id);
	if (!run) {
		if (rep.joining) return [runs, { kind: 'closed' }];
		run = { id: rep.id, date: rep.date, startedAt: rep.startedAt, people: [], keys: [] };
		runs.push(run);
	}
	enter(run, who);
	run.keys = run.keys.filter((h) => h.userId !== who.userId || rep.keys.includes(h.key));
	for (const key of rep.keys) {
		const touched = rep.touched.includes(key);
		const h = run.keys.find((h) => h.key === key);
		if (!h) run.keys.push({ key, userId: who.userId, touched });
		else if (h.userId === who.userId) h.touched ||= touched;
	}
	return [runs, { kind: 'done' }];
}

function ask(runs: RunsTogether, who: RunWho, runId: string, a: RunAsk, now: number): [RunsTogether, RunAnswer] {
	runs = prune(runs, now);
	const run = runs.find((r) => r.id === runId);
	const done: RunAnswer = { kind: 'done' };
	if (!run) return [runs, { kind: 'closed' }];
	if (a.kind === 'leave') {
		dropPerson(run, who.userId);
		return [prune(runs, now), done];
	}
	if (a.kind === 'release') {
		run.keys = run.keys.filter((h) => h.key !== a.key || h.userId !== who.userId);
		return [runs, done];
	}
	const i = run.keys.findIndex((h) => h.key === a.key);
	const h = run.keys[i];
	if (a.kind === 'claim') {
		enter(run, who);
		if (!h) {
			run.keys.push({ key: a.key, userId: who.userId, touched: false });
			return [runs, done];
		}
		if (h.userId === who.userId) return [runs, done];
		const holder = personOf(run, h.userId);
		const left = !holder || gone(holder, now);
		if (!left && (a.from !== h.userId || h.touched)) {
			return [runs, { kind: 'refused', by: nameOf(run, h.userId), touched: h.touched && a.from === h.userId }];
		}
		run.keys[i] = { key: a.key, userId: who.userId, touched: false };
	} else if (!h) run.keys.push({ key: a.key, userId: who.userId, touched: true });
	else if (h.userId === who.userId) h.touched = true;
	else return [runs, { kind: 'refused', by: nameOf(run, h.userId), touched: h.touched }];
	// 離開了的人沒拿著組了：不用再留
	run.people = run.people.filter((p) => !gone(p, now) || run.keys.some((k) => k.userId === p.userId));
	return [runs, done];
}

/** 一個連線斷了：這個人在表上沒有別的連線，就記下斷線的時間。找到這個連線就算變了。 */
function disconnect(runs: RunsTogether, conn: number, now: number): boolean {
	let changed = false;
	for (const p of runs.flatMap((r) => r.people)) {
		if (!p.conns.includes(conn)) continue;
		p.conns = p.conns.filter((c) => c !== conn);
		if (!p.conns.length) p.awaySince = now;
		changed = true;
	}
	return changed;
}

/** 做一件事（見檔頭），回新的表、要跟送的人說的、表變了沒。 */
export function runTogether(runs: RunsTogether, event: RunEvent, now: number): RunOutcome {
	const before = JSON.stringify(runs);
	let next = JSON.parse(before) as RunsTogether;
	let answer: RunAnswer = { kind: 'done' };
	if (event.kind === 'report') [next, answer] = report(next, event.who, event.report, now);
	else if (event.kind === 'ask') [next, answer] = ask(next, event.who, event.run, event.ask, now);
	else if (event.kind === 'disconnect') disconnect(next, event.conn, now);
	else {
		for (const r of next) dropPerson(r, event.userId);
		next = prune(next, now);
	}
	return { runs: next, answer, changed: JSON.stringify(next) !== before };
}

/** 給 viewer（使用者 id）看的每次全上：都離開了的不列，離開了的人不列。 */
export function runViews(runs: RunsTogether, viewer: number, now: number): RunTogetherView[] {
	return runs
		.filter((r) => !empty(r, now))
		.map((r) => {
			const away = (userId: number) => {
				const p = personOf(r, userId);
				return !p || p.awaySince !== null;
			};
			return {
				id: r.id,
				date: r.date,
				startedAt: r.startedAt,
				people: r.people.filter((p) => !gone(p, now)).map((p) => ({ name: p.name, me: p.userId === viewer, away: p.awaySince !== null })),
				keys: r.keys.map((h) => ({
					key: h.key,
					userId: h.userId,
					name: nameOf(r, h.userId),
					mine: h.userId === viewer,
					touched: h.touched,
					away: away(h.userId)
				}))
			};
		});
}
