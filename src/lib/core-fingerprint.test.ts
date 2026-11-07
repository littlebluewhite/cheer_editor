// 流程核心那包的指紋：前端帶的跟伺服器打包出來的是同一個；核心改一行，指紋就變（ADR 0010）。
import { describe, expect, it } from 'vitest';
import { bundleCore } from '../../scripts/core-bundle.mjs';
import { CORE_FINGERPRINT } from './core-fingerprint';

describe('流程核心的指紋', () => {
	it('前端帶的指紋，跟打包流程核心（伺服器 build.rs 用的同一支）算出來的一樣', async () => {
		const { fingerprint } = await bundleCore();
		expect(CORE_FINGERPRINT).toBe(fingerprint);
		expect(CORE_FINGERPRINT).toMatch(/^[0-9a-f]{64}$/);
	});

	it('流程核心改一行，指紋就變', async () => {
		const before = await bundleCore();
		const after = await bundleCore({
			edit: (path, code) =>
				path.endsWith('src/lib/core/text-length.ts') ? code.replace("flowName: '流程名字'", "flowName: '流程的名字'") : code
		});
		expect(after.code).not.toBe(before.code);
		expect(after.fingerprint).not.toBe(before.fingerprint);
	});

	it('同樣的程式打包兩次，指紋一樣（不用人改版本號）', async () => {
		const [a, b] = await Promise.all([bundleCore(), bundleCore()]);
		expect(a.fingerprint).toBe(b.fingerprint);
	});
});
