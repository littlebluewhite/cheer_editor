// 凍的情境（#396、ADR 0025）：vite.config.ts 讓用到假殼的測試對每一份凍的再跑一次，測試照「檔名＋情境名」找情境。
// 把 current/ 的情境改名（測試跟著改），凍的那句就沒有測試演了：這裡擋。真的不要了，就標 minShellBuild、整份刪掉凍的（docs/deploy.md「App」）。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'bridge-scenarios';

function names(folder: string): string[] {
	return readdirSync(join(ROOT, folder))
		.filter((f) => f.endsWith('.json'))
		.flatMap((file) =>
			(JSON.parse(readFileSync(join(ROOT, folder, file), 'utf8')) as { scenarios: { name: string }[] }).scenarios.map(
				(s) => `${file}「${s.name}」`
			)
		);
}

const frozen = readdirSync(ROOT, { withFileTypes: true })
	.filter((d) => d.isDirectory() && d.name !== 'current')
	.map((d) => d.name);

describe('凍的情境', () => {
	it('至少有 1.0 那份', () => {
		expect(frozen).toContain('1.0');
	});

	it.each(frozen)('%s 的每個情境，current/ 都還有同一個檔名、同一個名字（網頁的測試才找得到、演得到）', (folder) => {
		const current = new Set(names('current'));
		expect(names(folder).filter((n) => !current.has(n))).toEqual([]);
	});
});
