// 頁面：在有環節的動作幫人分組，存檔再打開還在。流程在核心裡做好再開檔（同 flow-file.svelte.test.ts）。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	markPhaseBeats,
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

/** sampleFlow 的 Lib 加上環節：上法 1-1 到 1-2、中段 1-3 到 1-6、下法 1-7 到 1-8（全部的人先在第 1 組）。 */
function phasedFlow(): Flow {
	let flow = sampleFlow();
	for (const [kind, at, len] of [['load', 0, 4], ['hold', 4, 8], ['dismount', 12, 4]] as const) {
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind, name: '' }, at, len));
	}
	return flow;
}

async function openFile(bytes: Uint8Array, label = '開啟流程檔') {
	const file = new File([bytes as Uint8Array<ArrayBuffer>], '練習用.zip', { type: 'application/zip' });
	await fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
	await settle();
}

/** 點泳道上 Lib 的色條，選到它。 */
const selectLib = () => fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
const squadOf = (who: string) => screen.getByRole('combobox', { name: `${who} 的組` }) as HTMLSelectElement;

describe('有環節的動作分組', () => {
	it('有上法、中段、下法的動作，幫人分組；存檔再打開還在', async () => {
		const saves = setup();
		await openFile(writeFlowFile(phasedFlow(), {}));
		await selectLib();
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
		expect(['小美', '小A', '小芳', '小B'].map((who) => squadOf(who).value)).toEqual(['1', '1', '2', '2']);
	});

	it('用組選單讓第 1 組空掉：後面的組往前補號；存檔再打開還在', async () => {
		const saves = setup();
		await openFile(writeFlowFile(phasedFlow(), {}));
		await selectLib();
		for (const [who, squad] of [['小芳', '2'], ['小B', '3']]) {
			await fireEvent.change(squadOf(who), { target: { value: squad } });
		}
		for (const who of ['小美', '小A']) await fireEvent.change(squadOf(who), { target: { value: '' } });
		expect(['小美', '小A', '小芳', '小B'].map((who) => squadOf(who).value)).toEqual(['', '', '1', '2']);
		expect([...squadOf('小美').options].map((o) => o.text)).toEqual(['沒有', '第 1 組', '第 2 組', '第 3 組']);

		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await settle();
		await openFile(saves[0], '開啟');
		await selectLib();
		expect(['小美', '小A', '小芳', '小B'].map((who) => squadOf(who).value)).toEqual(['', '', '1', '2']);
	});
});
