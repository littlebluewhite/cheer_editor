// 原因的代號（ADR 0017）：流程核心寫的中文要跟畫面用的 messages/zh-TW.json 一字不差，兩份才不會越寫越不一樣。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCommands } from './commands';
import { blocked, needsConfirm } from './result';
import { ZH_TEXT, zh, type Why } from './why';

const zhJson = JSON.parse(readFileSync(new URL('../../../messages/zh-TW.json', import.meta.url), 'utf8')) as Record<string, string>;

describe('原因的代號', () => {
	it('每個代號的中文都跟 zh-TW.json 同名的句子一樣', () => {
		for (const [code, text] of Object.entries(ZH_TEXT)) expect(zhJson[code], code).toBe(text);
	});

	it('有代號的被擋：中文照樣寫一份，多帶代號', () => {
		const why: Why = { code: 'commands_no_flow' };
		expect(blocked(why)).toEqual({ kind: 'blocked', message: '沒有開著的流程', why });
	});

	it('沒代號的（還沒改的）只有中文', () => {
		expect(blocked('找不到這一段')).toEqual({ kind: 'blocked', message: '找不到這一段' });
	});

	it('句子裡的東西照放，包著的原因也寫成中文', () => {
		const why: Why = {
			code: 'flow_check_in_formation',
			n: 3,
			reason: { code: 'flow_check_off_field', member: '小美', reason: { code: 'formation_off_field' } }
		};
		expect(zh(why)).toBe('站位 3：小美 只能站到場地外 1 公尺以內');
	});

	it('確認框的清單、確定鈕的字也能帶代號：中文照樣寫一份，沒代號的照中文放', () => {
		const item: Why = { code: 'action_label', category: { code: 'category_stunt' }, name: 'Lib' };
		expect(needsConfirm({ code: 'commands_none' }, [item, '刪掉：站位 2'], { code: 'category_dance' })).toEqual({
			kind: 'confirm',
			message: '沒有指令',
			why: { code: 'commands_none' },
			items: ['技巧·Lib', '刪掉：站位 2'],
			whyItems: [item, '刪掉：站位 2'],
			confirmLabel: '舞蹈',
			confirmWhy: { code: 'category_dance' }
		});
		expect(needsConfirm('要刪嗎', ['刪掉：站位 2'], '確定刪除')).toEqual({ kind: 'confirm', message: '要刪嗎', items: ['刪掉：站位 2'], confirmLabel: '確定刪除' });
	});

	it('沒有開著的流程、沒有指令：被擋並帶代號', () => {
		expect(runCommands(null, [{ name: 'renameFlow', args: ['A'] }], 'step00000001')).toMatchObject({
			kind: 'blocked',
			message: '沒有開著的流程',
			why: { code: 'commands_no_flow' }
		});
		expect(runCommands(null, [], 'step00000002')).toMatchObject({
			kind: 'blocked',
			message: '沒有指令',
			why: { code: 'commands_none' }
		});
	});
});
