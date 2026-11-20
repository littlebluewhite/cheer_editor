// 一步被退回的提示。伺服器送原因的代號（why，ADR 0017）；還沒更新的伺服器（部署、退版時）不送，照它寫的中文。
import { describe, expect, it } from 'vitest';
import { sentBack, type Rejected } from '#lib/cloud-steps.svelte.js';

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
