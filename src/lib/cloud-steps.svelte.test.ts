// 一步被退回的提示。伺服器送原因的代號（why，ADR 0017）；還沒更新的伺服器（部署、退版時）不送，照它寫的中文。
import { describe, expect, it } from 'vitest';
import { sentBack, type Rejected } from '#lib/cloud-steps.svelte.js';
import { localStorageKey } from '#lib/paraglide/runtime.js';

const rejected = (message: string, by?: string): Rejected => ({
	kind: 'rejected',
	stepId: 's1',
	message,
	...(by === undefined ? {} : { by }),
	flow: null,
	step: 3
});

describe('沒有代號的退回（還沒更新的伺服器）', () => {
	it('沒寫誰改的：照伺服器寫的', () => {
		expect(sentBack(rejected('沒存進去：找不到這個隊員'), '改名')).toBe('沒存進去：找不到這個隊員');
	});

	it('別人改了流程、被規則擋下：前面加上誰改的', () => {
		expect(sentBack(rejected('這一拍已經有站位', '王教練'), '加站位')).toBe('王教練剛改了流程，你的「加站位」沒改成：這一拍已經有站位');
	});

	it('別人改了同一個地方（原因是空的）', () => {
		expect(sentBack(rejected('', '王教練'), '改名')).toBe('王教練剛改了同一個地方，你的「改名」沒改成');
	});
});

describe('流程核心的原因有代號（ADR 0017）', () => {
	it('英文畫面：退回的句子和裡面的原因都是英文', () => {
		localStorage.setItem(localStorageKey, 'en');
		const reason = { message: '沒有指令', why: { code: 'commands_none' } } as const;
		const blocked: Rejected = { ...rejected('沒存進去：沒有指令'), why: { code: 'blocked', reason, ask: false } };
		expect(sentBack(blocked, '改名')).toBe('Not saved: No commands');
		const undo: Rejected = { ...rejected('這步不能復原：沒有指令'), why: { code: 'undoBlocked', reason, redo: false } };
		expect(sentBack(undo, '改名')).toBe("Can't undo this: No commands");
	});

	it('原因還沒改成代號：裡面照中文', () => {
		localStorage.setItem(localStorageKey, 'en');
		const blocked: Rejected = { ...rejected('沒存進去：找不到這個隊員'), why: { code: 'blocked', reason: { message: '找不到這個隊員' }, ask: false } };
		expect(sentBack(blocked, '改名')).toBe('Not saved: 找不到這個隊員');
	});
});
