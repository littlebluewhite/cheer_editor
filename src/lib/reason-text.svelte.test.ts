// 原因寫成畫面的語言（ADR 0017）：有代號照語言寫，沒代號照中文。
import { describe, expect, it } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import { reasonText } from './reason-text';

const noFlow = { message: '沒有開著的流程', why: { code: 'commands_no_flow' } } as const;

describe('原因寫成畫面的語言', () => {
	it('有代號：照語言寫', () => {
		expect(reasonText(noFlow)).toBe('沒有開著的流程');
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText(noFlow)).toBe('No routine is open');
	});

	it('沒代號（還沒改的）：照中文', () => {
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText({ message: '找不到這一段' })).toBe('找不到這一段');
	});
});
