// 流程核心給畫面的字（確認框的清單、確定鈕、復原的提示、打不開流程檔的原因、名詞對照表、性別和全局角色）照語言寫（ADR 0017）。
import { describe, expect, it } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import {
	GENDERS,
	GLOBAL_ROLES,
	addAction,
	addMemberLines,
	addMembers,
	addSegment,
	changeLabel,
	createFlow,
	deleteMember,
	deleteSegment,
	insertFormation,
	readFlowFile,
	roleGlossary,
	updateSegment,
	type CommandResult,
	type Flow
} from '#lib/core';
import { flowOf } from './test-flows';
import { reasonText, whyText } from './reason-text';

const HAN = /\p{Script=Han}/u;

/** 名字都是英文的流程：Lib（1-1 到 1-8，Ann 上層、Bob 主底）、T（3-1 起，只有 Ann），站位 2 在 2-3。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: 'Test', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: 'Ann', gender: 'F', globalRole: 'top' },
			{ name: 'Bob', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members }));
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'jump', name: 'T', start: 32, length: 4, note: '', members: [{ memberId: 'm1', role: null }] }));
	return flowOf(insertFormation(flow, 4));
}

/** 確認框（或選擇）照畫面寫出來的字：問題、清單、確定鈕。 */
function shown(r: CommandResult): string[] {
	if (r.kind !== 'confirm' && r.kind !== 'choose') throw new Error(`不是要問：${r.kind}`);
	const label = r.kind === 'confirm' && (r.confirmWhy ?? r.confirmLabel);
	return [reasonText(r), ...(r.whyItems?.map(whyText) ?? r.items), ...(label ? [whyText(label)] : [])];
}

describe('流程核心給畫面的字（英文）', () => {
	it('段縮短：裁短、刪掉的清單和確定鈕', () => {
		localStorage.setItem(localStorageKey, 'en');
		const texts = shown(updateSegment(sample(), 's1', { eights: 1, lastBeats: 6 }));
		expect(texts.slice(1)).toEqual([
			'Trim skill “Stunt·Lib” (from 1-1) 8 beats → 6 beats',
			'Delete skill “Jump·T” (from 3-1)',
			'Delete formation 2 (2-3)',
			'Delete'
		]);
		for (const text of texts) expect(text).not.toMatch(HAN);
	});

	it('刪段、刪隊員：清單照語言寫', () => {
		localStorage.setItem(localStorageKey, 'en');
		expect(shown(deleteSegment(sample(), 's1')).slice(1)).toEqual(['Skill “Stunt·Lib” (from 1-1)', 'Skill “Jump·T” (from 3-1)', 'Formation 2 (2-3)']);
		const member = shown(deleteMember(sample(), 'm1'));
		expect(member.slice(1)).toEqual([
			'Skill “Stunt·Lib” (Music 1, from 1-1): their position is Top person',
			'Skill “Jump·T” (Music 1, from 3-1): they\'re the only one in it, so the whole skill will be deleted'
		]);
		for (const text of member) expect(text).not.toMatch(HAN);
	});

	it('復原的提示：這一步改了什麼', () => {
		localStorage.setItem(localStorageKey, 'en');
		const flow = sample();
		expect(whyText(changeLabel(flow, flowOf(insertFormation(flow, 8))))).toBe('Insert formation 3');
		expect(whyText(changeLabel(flow, flowOf(deleteMember(flow, 'm2', { confirmed: true }))))).toBe('Delete athlete Bob');
		expect(whyText(changeLabel(flow, flowOf(addSegment(flow, 'chant'))))).toBe('Add segment 2');
	});

	it('打不開流程檔的原因', () => {
		localStorage.setItem(localStorageKey, 'en');
		const r = readFlowFile(new Uint8Array([1, 2, 3]));
		expect(r.kind === 'error' && reasonText(r)).toBe("The file is damaged, or it isn't a routine file saved by this editor");
	});

	it('名詞對照表、性別、全局角色', () => {
		localStorage.setItem(localStorageKey, 'en');
		const rows = roleGlossary(sample());
		for (const r of rows) {
			expect(whyText(r.meaning)).not.toMatch(HAN);
			expect(whyText(r.ruleName)).not.toMatch(HAN);
		}
		expect(whyText(rows[4].ruleName)).toBe('Top person');
		expect([...GENDERS, ...GLOBAL_ROLES].map((g) => whyText(g.label))).toEqual(['Female', 'Male', 'Base', 'Top person']);
	});

	it('貼上名單：英文畫面教的寫法（M、F、base、top，和選單上的字）都看得懂，標題列跳過', () => {
		const empty = flowOf(createFlow({ name: 'Test', field: { strips: 9, layout: 'vertical' } }));
		const lines = 'name, gender, main role\nAnn, F, top\nBob\tM\tbase\nCat, Female, Top person\nDan, male, Base';
		const r = addMemberLines(empty, lines, { gender: null, globalRole: null });
		expect(flowOf(r).members.map((m) => [m.name, m.gender, m.globalRole])).toEqual([
			['Ann', 'F', 'top'],
			['Bob', 'M', 'base'],
			['Cat', 'F', 'top'],
			['Dan', 'M', 'base']
		]);
	});

	it('貼上名單用空白分欄、全局角色寫選單上的「Top person」：不會整行變成名字', () => {
		const empty = flowOf(createFlow({ name: 'Test', field: { strips: 9, layout: 'vertical' } }));
		const r = addMemberLines(empty, 'Eve Female Top person\nFay Lee F top person', { gender: 'M', globalRole: 'base' });
		expect(flowOf(r).members.map((m) => [m.name, m.gender, m.globalRole])).toEqual([
			['Eve', 'F', 'top'],
			['Fay Lee', 'F', 'top']
		]);
	});

	it('貼上名單用空白分欄：英文標題列跳過；名字裡有中間名縮寫 M（Ana M de Souza）照樣整行是名字；叫 Name 開頭的人不當標題列', () => {
		const empty = flowOf(createFlow({ name: 'Test', field: { strips: 9, layout: 'vertical' } }));
		const r = addMemberLines(empty, 'Name Gender Main role\nAna M de Souza\nName Lee F top\nAmy F top', { gender: 'M', globalRole: 'base' });
		expect(flowOf(r).members.map((m) => [m.name, m.gender, m.globalRole])).toEqual([
			['Ana M de Souza', 'M', 'base'],
			['Name Lee', 'F', 'top'],
			['Amy', 'F', 'top']
		]);
	});

	it('貼上名單：日文名單上寫的短的「トップ」也看得懂', () => {
		const empty = flowOf(createFlow({ name: 'Test', field: { strips: 9, layout: 'vertical' } }));
		const r = addMemberLines(empty, '葵,女,トップ', { gender: null, globalRole: null });
		expect(flowOf(r).members.map((m) => [m.name, m.gender, m.globalRole])).toEqual([['葵', 'F', 'top']]);
	});
});
