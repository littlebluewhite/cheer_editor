// 原因寫成畫面的語言（ADR 0017）：有代號照語言寫，沒代號照中文。
import { describe, expect, it } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import { addMemberLines, createFlow, deleteMember, type CommandResult, type Flow, type Why } from '#lib/core';
import { libSample } from './test-flows';
import { reasonText } from './reason-text';

const noFlow = { message: '沒有開著的流程', why: { code: 'commands_no_flow' } } as const;

describe('原因寫成畫面的語言', () => {
	it('有代號：照語言寫', () => {
		expect(reasonText(noFlow)).toBe('沒有開著的流程');
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText(noFlow)).toBe('No routine is open');
	});

	it('還不認得的代號（伺服器比這個分頁新），包在裡面的也是：照中文', () => {
		localStorage.setItem(localStorageKey, 'en');
		const later = { code: 'later_reason' } as unknown as Why;
		expect(reasonText({ message: '之後才有的原因', why: later })).toBe('之後才有的原因');
		const inside = { code: 'commands_none', reason: later } as unknown as Why;
		expect(reasonText({ message: '沒有指令', why: inside })).toBe('沒有指令');
	});

	it('沒代號（還沒改的）：照中文', () => {
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText({ message: '找不到這一段' })).toBe('找不到這一段');
	});
});

describe('隊員的原因（英文）：一句接一句、一行接一行的也照語言寫', () => {
	const said = (r: CommandResult) => {
		if (r.kind === 'ok') throw new Error('沒擋下');
		return r;
	};
	const empty = (): Flow => {
		const r = createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } });
		if (r.kind !== 'ok') throw new Error(r.message);
		return r.flow;
	};

	it('刪隊員：在幾個動作裡、會沒有誰、號碼遞補', () => {
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText(said(deleteMember(libSample(), 'm1')))).toBe(
			'Delete athlete “小美” (label 1, 上層): in 1 skill; “技巧·Lib” stunt group 1 will have no 上層; the 3 athletes after them will move up one number'
		);
	});

	it('貼上名單：每一行的錯，名字列在一起', () => {
		localStorage.setItem(localStorageKey, 'en');
		const r = addMemberLines(empty(), '小A\n小B\n小C\t男孩\t主底', { gender: null, globalRole: null });
		expect(reasonText(said(r))).toBe(
			'“小A”, “小B”: Choose a gender; Choose a main role\n“小C”: Gender must be “M” or “F”; “主底” is a position (set per skill); main role must be “base” or “top”'
		);
	});
});
