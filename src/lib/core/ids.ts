// 流程裡各種東西的 id：一個字母加編號（s3、f2、x1…）。

/** 下一個沒用過的編號 id，例：s3、f2。 */
export function nextId(prefix: string, ids: string[]): string {
	let n = 0;
	for (const id of ids) {
		const m = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : Number.NaN;
		if (Number.isInteger(m) && m > n) n = m;
	}
	return `${prefix}${n + 1}`;
}
