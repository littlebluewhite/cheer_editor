// 頁面：在動作表單打開記成功率、幫人分組，存檔再打開還在。流程在核心裡做好再開檔（同 flow-file.svelte.test.ts）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	readFlowFile,
	writeFlowFile,
	type CommandResult,
	type Flow
} from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { FileSaver } from '#lib/file/save.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

function setup() {
	const saves: Uint8Array[] = [];
	const saver: FileSaver = {
		async save(bytes) {
			saves.push(bytes);
			return 'saved';
		}
	};
	render(Page, {
		createEngine: () => createFakeEngine(),
		createSaver: () => saver,
		decode: async () => ({ durationSec: 30, peaks: [] })
	});
	return saves;
}

/** 等 async 的存檔／開檔跑完。 */
const settle = () => new Promise((r) => setTimeout(r, 0));

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

/** 音樂 1；小美、小芳是上層，小A、小B 是底層，四個人做 Lib（技巧）。 */
function sampleFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' },
			{ name: '小芳', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' },
		{ memberId: 'm3', role: '上層' },
		{ memberId: 'm4', role: '主底' }
	];
	return flowOf(
		addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members })
	);
}

async function openFile(bytes: Uint8Array, label = '開啟流程檔') {
	const file = new File([bytes as Uint8Array<ArrayBuffer>], '練習用.zip', { type: 'application/zip' });
	await fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
	await settle();
}

/** 點泳道上 Lib 的色條，選到它。 */
const selectLib = () => fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
const toggle = () => screen.getByRole('checkbox', { name: '記成功率' }) as HTMLInputElement;
const phases = () =>
	within(screen.getByRole('list', { name: '環節' }))
		.getAllByRole('listitem')
		.map((li) => li.textContent?.trim());
const squadOf = (who: string) => screen.getByRole('combobox', { name: `${who} 的組` }) as HTMLSelectElement;

describe('記成功率的開關和組', () => {
	it('打開記成功率看到上法、中段、下法，幫人分組；存檔再打開還在', async () => {
		const saves = setup();
		await openFile(writeFlowFile(sampleFlow(), {}));
		await selectLib();
		expect(toggle().checked).toBe(false);

		await fireEvent.click(toggle());
		expect(phases()).toEqual(['上法', '中段', '下法']);
		for (const [who, squad] of [['小美', '1'], ['小A', '1'], ['小芳', '2'], ['小B', '2']]) {
			await fireEvent.change(squadOf(who), { target: { value: squad } });
		}

		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await settle();
		const r = readFlowFile(saves[0]);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.actions[0].successRate?.phases.map((p) => p.kind)).toEqual(['load', 'hold', 'dismount']);
		expect(r.flow.actions[0].members.map((m) => m.squad)).toEqual([1, 1, 2, 2]);

		await openFile(saves[0], '開啟');
		await selectLib();
		expect(toggle().checked).toBe(true);
		expect(phases()).toEqual(['上法', '中段', '下法']);
		expect(['小美', '小A', '小芳', '小B'].map((who) => squadOf(who).value)).toEqual(['1', '1', '2', '2']);
	});

	it('打開記成功率可以復原', async () => {
		setup();
		await openFile(writeFlowFile(sampleFlow(), {}));
		await selectLib();
		await fireEvent.click(toggle());
		expect(toggle().checked).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(toggle().checked).toBe(false);
		expect(screen.queryByRole('list', { name: '環節' })).toBeNull();
	});
});
