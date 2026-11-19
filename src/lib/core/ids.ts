// 流程裡各種東西的 id：種類字母加 12 個字的亂數（小寫字母、數字），例：x7k2m9qa4b1z（ADR 0014）。
// 舊檔的 id 是字母加編號（s3、f2、x1…），不用改，跟新的並存。
// 一步裡新東西的 id 由步驟 id 算出來：同一個步驟 id 跑同一步，算出一樣的 id（伺服器才能跑出一樣的結果）。
// 核心裡不用現在時間或亂數；步驟 id 由外面給（inStep）。

/** 亂數那段有幾個字。 */
const RANDOM_CHARS = 12;

/** 現在這一步發 id 的方法；不在一步裡是 null。 */
let issuing: ((prefix: string) => string) | null = null;

/**
 * 在一步裡跑：裡面發的新 id 由步驟 id 和這一步裡第幾個 id 算出來，所以同一個步驟 id 跑同一步，算出一樣的一串。
 * 一步裡又叫 inStep，裡面用新的步驟 id，跑完換回外面的。
 */
export function inStep<R>(stepId: string, run: () => R): R {
	const outer = issuing;
	let n = 0;
	issuing = (prefix) => `${prefix}${randomPart(`${stepId}\n${n++}`)}`;
	try {
		return run();
	} finally {
		issuing = outer;
	}
}

/**
 * 一個新的 id，不跟 taken 裡的撞。在一步裡（inStep）是種類字母加 12 個字的亂數；
 * 不在一步裡（直接叫指令，例：測試、畫面先試跑看會不會被擋）是字母加下一個沒用過的編號，例：s3。
 */
export function newId(prefix: string, taken: string[]): string {
	return newIds(prefix, 1, taken)[0];
}

/** 一次發 count 個新的 id（見 newId），彼此也不撞。 */
export function newIds(prefix: string, count: number, taken: string[]): string[] {
	const used = new Set(taken);
	const ids: string[] = [];
	let n = maxNumber(prefix, taken);
	while (ids.length < count) {
		const id = issuing ? issuing(prefix) : `${prefix}${++n}`;
		if (used.has(id)) continue;
		used.add(id);
		ids.push(id);
	}
	return ids;
}

/** 是不是新的寫法（字母加 12 個字的亂數）；舊的字母加編號不是。 */
export function isRandomId(id: string): boolean {
	return new RegExp(`^[a-z][a-z0-9]{${RANDOM_CHARS}}$`).test(id);
}

/** 由 seed 算出 12 個字（小寫字母、數字）：兩段各 6 個字，各用一個 53 位元的雜湊。 */
function randomPart(seed: string): string {
	const six = (salt: number) => (hash53(seed, salt) % 36 ** 6).toString(36).padStart(6, '0');
	return six(1) + six(2);
}

/** cyrb53：字串 → 53 位元的雜湊。只用 Math.imul 和位元運算，所以各家 JS 引擎（含 QuickJS）算出一樣的值。 */
function hash53(s: string, salt: number): number {
	let h1 = 0xdeadbeef ^ salt;
	let h2 = 0x41c6ce57 ^ salt;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** taken 裡這個字母開頭的最大編號（舊的寫法）；沒有是 0。 */
function maxNumber(prefix: string, ids: string[]): number {
	let n = 0;
	for (const id of ids) {
		const m = id.startsWith(prefix) && !isRandomId(id) ? Number(id.slice(prefix.length)) : Number.NaN;
		if (Number.isInteger(m) && m > n) n = m;
	}
	return n;
}
