// 流程裡各種東西的 id：一個字母加編號（s3、f2、x1…）。

/** 下一個沒用過的編號 id，例：s3、f2。 */
export function nextId(prefix: string, ids: string[]): string {
	return `${prefix}${maxNumber(prefix, ids) + 1}`;
}

/**
 * 刪了也不重用的 id（環節）：比流程記的「已經發到第幾號」（lastIds[prefix]）和現有的 ids 都大，一次發 count 個。
 * 回傳新的 id 和要存回流程的 lastIds。
 */
export function freshIds(
	prefix: string,
	count: number,
	lastIds: Record<string, number> = {},
	ids: string[]
): { ids: string[]; lastIds: Record<string, number> } {
	const last = Math.max(lastIds[prefix] ?? 0, maxNumber(prefix, ids));
	const fresh = Array.from({ length: count }, (_, i) => `${prefix}${last + i + 1}`);
	return { ids: fresh, lastIds: { ...lastIds, [prefix]: last + count } };
}

/** ids 裡這個字母開頭的最大編號；沒有是 0。 */
function maxNumber(prefix: string, ids: string[]): number {
	let n = 0;
	for (const id of ids) {
		const m = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : Number.NaN;
		if (Number.isInteger(m) && m > n) n = m;
	}
	return n;
}
