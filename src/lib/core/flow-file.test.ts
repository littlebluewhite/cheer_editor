import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	createFlow,
	insertFormation,
	loadSegmentAudio,
	readFlowFile,
	setPositions,
	updateSegment,
	updateTimeRules,
	writeFlowFile,
	type CommandResult,
	type Flow,
	type FlowDocument
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（a1.mp3）→ 口號 1 → 音樂 2（a2.m4a）；兩個隊員、一個自訂角色、一個動作、兩張站位。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試流程', field: { strips: 5, layout: 'horizontal' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(loadSegmentAudio(flow, 's1', '第一首.mp3'));
	flow = flowOf(updateSegment(flow, 's1', { bpm: 144, firstBeatSec: 0.42, eights: 3, lastBeats: 5 }));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 12.3 }));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(loadSegmentAudio(flow, 's3', 'second.m4a'));
	flow = flowOf(addCustomRole(flow, { name: '飛人', meaning: '從後面跑上來的人' }));
	flow = flowOf(
		addAction(flow, {
			segmentId: 's1',
			category: 'stunt',
			name: 'Lib',
			start: 3,
			length: 16,
			note: '慢慢上',
			members: [
				{ memberId: 'm1', role: '飛人' },
				{ memberId: 'm2', role: null }
			]
		})
	);
	flow = flowOf(insertFormation(flow, 2));
	flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1 / 3, -1.8288] }));
	flow = flowOf(updateTimeRules(flow, { on: false, maxTotalSec: 150 }));
	return flow;
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe('流程檔：存了再開', () => {
	it('內容一樣：隊員、段、動作、站位、自訂角色、時間規則、音樂資料', () => {
		const flow = sample();
		const audio = { a1: bytes(1, 2, 3), a2: bytes(9, 8, 7, 6) };
		const r = readFlowFile(writeFlowFile(flow, audio));
		expect(r).toEqual({ kind: 'ok', flow, audio, missingSegmentIds: [] });
	});

	it('zip 裡是一份 flow.json（formatVersion 1 ＋ flow）和 audio/ 下用到的音樂檔', () => {
		const flow = sample();
		const files = unzipSync(writeFlowFile(flow, { a1: bytes(1, 2, 3), a2: bytes(4) }));
		expect(Object.keys(files).sort()).toEqual(['audio/a1.mp3', 'audio/a2.m4a', 'flow.json']);
		expect(files['audio/a1.mp3']).toEqual(bytes(1, 2, 3));
		const json = JSON.parse(new TextDecoder().decode(files['flow.json']));
		// 只有這兩層：延遲校正之類的本機設定不進檔。
		expect(Object.keys(json)).toEqual(['formatVersion', 'flow']);
		expect(json.formatVersion).toBe(1);
		expect(json.flow).toEqual(flow);
	});
});

/** 手做一個流程檔：flow.json 放 doc，其他照給的檔案。 */
function zipOf(doc: unknown, extra: Record<string, Uint8Array> = {}): Uint8Array {
	return zipSync({ 'flow.json': strToU8(JSON.stringify(doc)), ...extra });
}

describe('流程檔：版本', () => {
	it('比編輯器新的檔不打開，提示重新整理', () => {
		const r = readFlowFile(zipOf({ formatVersion: 2, flow: sample() }));
		expect(r).toEqual({ kind: 'error', message: '這個流程檔是新版編輯器存的，請重新整理，更新編輯器' });
	});

	it.each([
		['不是 zip', bytes(1, 2, 3)],
		['zip 裡沒有 flow.json', zipSync({ 'a.txt': strToU8('hi') })],
		['flow.json 不是 JSON', zipSync({ 'flow.json': strToU8('{') })],
		['沒有 formatVersion', zipOf({ flow: sample() })],
		['沒有 flow', zipOf({ formatVersion: 1 })],
		['flow 只有名字', zipOf({ formatVersion: 1, flow: { name: '壞掉的' } })],
		['flow 的清單不是陣列', zipOf({ formatVersion: 1, flow: { ...sample(), audio: {} } })],
		['清單裡有不是物件的東西', zipOf({ formatVersion: 1, flow: { ...sample(), segments: [null] } })],
		['沒有開頭站位', zipOf({ formatVersion: 1, flow: { ...sample(), formations: [] } })]
	])('%s：不是流程檔', (_, file) => {
		expect(readFlowFile(file)).toEqual({ kind: 'error', message: '這不是流程檔' });
	});

	// 現在只有第 1 版。用假想的舊版證明升級鏈：第 -1 版沒有 customRoles 和 actions，
	// 第 0 版補了 customRoles，第 1 版補了 actions。
	const { customRoles: _r, actions: _a, ...v0Flow } = sample();
	const upgrades = {
		[-1]: (doc: FlowDocument) => ({ formatVersion: 0, flow: { ...(doc.flow as object), customRoles: [] } }),
		0: (doc: FlowDocument) => ({ formatVersion: 1, flow: { ...(doc.flow as object), actions: [] } })
	};

	it('舊版自動一步一步升到現在的版本，音樂照樣讀到', () => {
		const file = zipOf({ formatVersion: -1, flow: v0Flow }, { 'audio/a1.mp3': bytes(5) });
		const r = readFlowFile(file, upgrades);
		expect(r).toEqual({
			kind: 'ok',
			flow: { ...v0Flow, customRoles: [], actions: [] },
			audio: { a1: bytes(5) },
			missingSegmentIds: ['s3']
		});
	});

	it('從中間的舊版開始升也可以', () => {
		const r = readFlowFile(zipOf({ formatVersion: 0, flow: { ...v0Flow, customRoles: [] } }), upgrades);
		expect(r.kind === 'ok' && r.flow).toEqual({ ...v0Flow, customRoles: [], actions: [] });
	});

	it('沒有升級步驟的舊版號：不是流程檔', () => {
		expect(readFlowFile(zipOf({ formatVersion: 0, flow: v0Flow }))).toEqual({
			kind: 'error',
			message: '這不是流程檔'
		});
	});
});

describe('流程檔：缺音樂檔', () => {
	it('照開，標出缺音樂的段；動作和站位都還在', () => {
		const flow = sample();
		const r = readFlowFile(writeFlowFile(flow, { a2: bytes(4) }));
		expect(r).toEqual({ kind: 'ok', flow, audio: { a2: bytes(4) }, missingSegmentIds: ['s1'] });
	});

	it('兩個音樂段用同一個缺的檔，兩段都標出來', () => {
		let flow = sample();
		flow = flowOf(updateSegment(flow, 's3', { audioId: 'a1' }));
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.missingSegmentIds).toEqual(['s1', 's3']);
	});
});

describe('repo 裡的範例流程檔（docs/samples/sample-flow.zip）', () => {
	const file = new Uint8Array(
		readFileSync(new URL('../../../docs/samples/sample-flow.zip', import.meta.url))
	);

	it('現在的編輯器打得開（之後改格式，升級鏈也要能從第 1 版升上來）', () => {
		const r = readFlowFile(file);
		expect(r.kind === 'ok' && { audio: Object.keys(r.audio), missing: r.missingSegmentIds }).toEqual(
			{ audio: ['a1'], missing: [] }
		);
	});

	it('只用假名', () => {
		const r = readFlowFile(file);
		expect(r.kind === 'ok' && r.flow.members.map((m) => m.name)).toEqual(['小A', '小B', '小C']);
	});
});
