import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addCustomRole,
	addMembers,
	addPhase,
	addSegment,
	createFlow,
	insertFormation,
	loadSegmentAudio,
	memberMarkers,
	placeCue,
	readFlowFile,
	recordAttempt,
	setMarkers,
	setPositions,
	setSquad,
	updatePhase,
	updateSegment,
	updateTimeRules,
	writeFlowFile,
	type Flow,
	type FlowDocument,
	type NewAttempt
} from './index';
import { flowOf, squadNumbers } from './test-flows';
import {
	attemptWhos,
	perPerson,
	rateTable,
	squadName,
	squadNumber,
	squadsOf,
	type Action
} from './index';

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

/** sample() 再幫小A 在第二張站位設出發和到達（出發在音樂 1，到達在口號 1）。 */
function withWalks(): Flow {
	const flow = sample();
	const walks = { m1: { depart: { segmentId: 's1', at: 1 }, arrive: { segmentId: 's1', at: 4 } } };
	return { ...flow, formations: flow.formations.with(1, { ...flow.formations[1], walks }) };
}

/** sample() 再幫 Lib 放 down 2 拍、up 1 拍。 */
function withCues(): Flow {
	let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 1, len: 4, word: 'down' }));
	return flowOf(placeCue(flow, 'x1', { kind: 'count', at: 5, len: 2, word: 'up' }));
}

/**
 * sample() 再幫 Lib 加環節：上法 1-3 到 1-4（動作從 1-2& 開始，標的拍從整拍開始）、挑紅色，中段 1-5 到 1-6，
 * 下法「搖籃」1-7 到 1-8；小A 第 1 組、小B 第 2 組。
 */
function withSuccessRate(): Flow {
	let flow = flowOf(addPhase(sample(), 'x1', { kind: 'load', name: '', beats: { at: 1, len: 4 } }));
	flow = flowOf(addPhase(flow, 'x1', { kind: 'hold', name: '', beats: { at: 5, len: 4 } }));
	flow = flowOf(addPhase(flow, 'x1', { kind: 'dismount', name: '搖籃', beats: { at: 9, len: 4 } }));
	flow = flowOf(updatePhase(flow, 'x1', 'p1', { color: '#c62828' }));
	return flowOf(setSquad(flow, 'x1', ['m2'], 2));
}

/** withSuccessRate() 再記三次：第 1 組分段練整個做 ✓✓△、第 2 組只練上法 ✗、第 1 組全上 ✓✓✓。 */
function withRecords(): Flow {
	let flow = withSuccessRate();
	const date = '2026-11-04';
	const attempts: Omit<NewAttempt, 'date'>[] = [
		{ who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '△' } },
		{ who: 'g2', practice: 'drill', whole: false, marks: { p1: '✗' } },
		{ who: 'g1', practice: 'runThrough', runThroughId: 'u1', whole: true, marks: { p1: '✓', p2: '✓', p3: '✓' } }
	];
	for (const input of attempts) {
		flow = flowOf(recordAttempt(flow, 'x1', { date, ...input }));
	}
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

	it('出發和到達設定存了再開也一樣', () => {
		const flow = withWalks();
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
	});

	it('拍點存了再開也一樣', () => {
		const flow = withCues();
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
		expect(r.kind === 'ok' && r.flow.actions[0].cues?.map((c) => c.word)).toEqual(['down', 'up']);
	});

	it('辨識色存了再開也一樣', () => {
		const flow = sample();
		flow.actions[0].color = '#1565c0';
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.flow.actions[0].color).toBe('#1565c0');
	});

	it('站位名稱存了再開也一樣', () => {
		const flow = sample();
		flow.formations[0].name = '開場';
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.flow.formations[0].name).toBe('開場');
	});

	it('記成功率的設定（環節）和組存了再開也一樣', () => {
		const flow = withSuccessRate();
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
		expect(r.kind === 'ok' && squadNumbers(r.flow.actions[0])).toEqual([1, 2]);
		expect(r.kind === 'ok' && r.flow.actions[0].successRate?.phases.map((p) => p.kind)).toEqual([
			'load',
			'hold',
			'dismount'
		]);
		expect(r.kind === 'ok' && r.flow.lastIds).toEqual({ p: 3, g: 2 });
	});

	it('紀錄存了再開也一樣', () => {
		const flow = withRecords();
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
		expect(r.kind === 'ok' && r.flow.actions[0].successRate?.records.map((a) => a.marks)).toEqual([
			{ p1: '✓', p2: '✓', p3: '△' },
			{ p1: '✗' },
			{ p1: '✓', p2: '✓', p3: '✓' }
		]);
	});

	it('標記用開頭字，存了再開也一樣', () => {
		const flow = flowOf(setMarkers(sample(), 'initial'));
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind === 'ok' && r.flow.markers).toBe('initial');
	});

	it('zip 裡是一份 flow.json（formatVersion 8 ＋ flow）和 audio/ 下用到的音樂檔', () => {
		const flow = sample();
		const files = unzipSync(writeFlowFile(flow, { a1: bytes(1, 2, 3), a2: bytes(4) }));
		expect(Object.keys(files).sort()).toEqual(['audio/a1.mp3', 'audio/a2.m4a', 'flow.json']);
		expect(files['audio/a1.mp3']).toEqual(bytes(1, 2, 3));
		const json = JSON.parse(new TextDecoder().decode(files['flow.json']));
		// 只有這兩層：延遲校正之類的本機設定不進檔。
		expect(Object.keys(json)).toEqual(['formatVersion', 'flow']);
		expect(json.formatVersion).toBe(8);
		expect(json.flow).toEqual(flow);
	});
});

/** 第 7 版以前的寫法（存成 JSON 的樣子）：組 id 換成第幾組，分組動作的紀錄的「誰」也是；id 發號不記 g。 */
function numbered(flow: Flow): any {
	const old = JSON.parse(JSON.stringify(flow));
	for (const a of old.actions as Action[]) {
		const squads = squadsOf(a);
		const n = (id: string) => squads.indexOf(id) + 1;
		for (const m of a.members as any[]) if (m.squad !== undefined) m.squad = n(m.squad);
		if (!perPerson(a.category)) for (const r of (a.successRate?.records ?? []) as any[]) r.who = n(r.who);
	}
	if (old.lastIds) delete old.lastIds.g;
	return old;
}

/** 手做一個流程檔：flow.json 放 doc，其他照給的檔案。 */
function zipOf(doc: unknown, extra: Record<string, Uint8Array> = {}): Uint8Array {
	return zipSync({ 'flow.json': strToU8(JSON.stringify(doc)), ...extra });
}

describe('流程檔：版本', () => {
	it('比編輯器新的檔不打開，提示重新整理', () => {
		const r = readFlowFile(zipOf({ formatVersion: 9, flow: sample() }));
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

	/** 一筆走位設定，段和時間可以換成壞的。 */
	const walk = (segmentId = 's1', at = 1) => ({
		depart: { segmentId, at },
		arrive: { segmentId: 's1', at: 4 }
	});

	/** 一個拍點，欄位可以換成壞的。 */
	const cue = (changes: object = {}) => ({ kind: 'count', at: 0, len: 2, word: 'down', who: null, ...changes });

	/** sample() 存成 JSON 再手動改壞一個地方（模擬有人手改 flow.json）。 */
	function broken(edit: (flow: any) => void, from: () => Flow = sample): Uint8Array {
		const flow = JSON.parse(JSON.stringify(from()));
		edit(flow);
		return zipOf({ formatVersion: 1, flow });
	}

	/** withSuccessRate() 改壞一個地方；sr 是 Lib 的成功率設定。 */
	const brokenRate = (edit: (flow: any, sr: any) => void) =>
		broken((f) => edit(f, f.actions[0].successRate), withSuccessRate);

	/** withRecords() 改壞一個地方；r 是 Lib 的第一次（第 1 組 ✓✓△），records 是全部的紀錄。 */
	const brokenRecord = (edit: (r: any, records: any[]) => void) =>
		broken((f) => edit(f.actions[0].successRate.records[0], f.actions[0].successRate.records), withRecords);

	it.each([
		['站位的 pos 是 null', broken((f) => (f.formations[0].pos = null))],
		['位置不是兩個數字', broken((f) => (f.formations[1].pos.m1 = [1]))],
		['站位的時間不是整數', broken((f) => (f.formations[1].at = 1.5))],
		['站位指到沒有的段', broken((f) => (f.formations[1].segmentId = 'zz'))],
		['隊員的名字不是字', broken((f) => (f.members[0].name = 1))],
		['隊員的性別不對', broken((f) => (f.members[0].gender = 'X'))],
		['段的種類不對', broken((f) => (f.segments[0].kind = 'dance'))],
		['音樂段的 BPM 不是數字', broken((f) => (f.segments[0].bpm = '144'))],
		['口號段沒有長度', broken((f) => delete f.segments[1].tenths)],
		['音樂段指到沒有的音樂檔', broken((f) => (f.segments[0].audioId = 'zz'))],
		['音樂檔沒有路徑', broken((f) => (f.audio[0].file = null))],
		['場地的放法不對', broken((f) => (f.field.layout = 'diagonal'))],
		['時間規則的開關不是是非', broken((f) => (f.timeRules.on = 'yes'))],
		['自訂角色沒有名字', broken((f) => (f.customRoles[0].name = null))],
		['動作的分類不對', broken((f) => (f.actions[0].category = 'x'))],
		['動作的隊員不是陣列', broken((f) => (f.actions[0].members = null))],
		['動作指到沒有的段', broken((f) => (f.actions[0].segmentId = 'zz'))],
		['動作指到沒有的隊員', broken((f) => (f.actions[0].members[0].memberId = 'zz'))],
		['走位不是物件', broken((f) => (f.formations[1].walks = []))],
		['走位指到沒有的隊員', broken((f) => (f.formations[1].walks = { zz: walk() }))],
		['走位指到沒有的段', broken((f) => (f.formations[1].walks = { m1: walk('zz') }))],
		['走位的時間不是整數', broken((f) => (f.formations[1].walks = { m1: walk('s1', 1.5) }))],
		['走位的時間是負的', broken((f) => (f.formations[1].walks = { m1: walk('s1', -1) }))],
		['走位沒有到達', broken((f) => (f.formations[1].walks = { m1: { depart: walk().depart } }))],
		['開頭那張有走位', broken((f) => (f.formations[0].walks = { m1: walk() }))],
		['站位名稱不是字串', broken((f) => (f.formations[0].name = 3))],
		['標記不是號碼也不是開頭字', broken((f) => (f.markers = 'name'))],
		['辨識色不是 #rrggbb', broken((f) => (f.actions[0].color = 'blue'))],
		['拍點不是陣列', broken((f) => (f.actions[0].cues = {}))],
		['拍點的種類不對', broken((f) => (f.actions[0].cues = [cue({ kind: 'move' })]))],
		['拍點的 at 不是整數', broken((f) => (f.actions[0].cues = [cue({ at: 1.5 })]))],
		['拍點的 len 不是整數', broken((f) => (f.actions[0].cues = [cue({ len: 'x' })]))],
		['拍點不到一拍', broken((f) => (f.actions[0].cues = [cue({ len: 1 })]))],
		['手位佔兩拍', broken((f) => (f.actions[0].cues = [cue({ kind: 'motion', word: 'T', len: 4 })]))],
		['拍點超出動作', broken((f) => (f.actions[0].cues = [cue({ at: 14, len: 4 })]))],
		['拍點在動作之前', broken((f) => (f.actions[0].cues = [cue({ at: -2 })]))],
		['拍子用了別的字', broken((f) => (f.actions[0].cues = [cue({ word: 'ready' })]))],
		['步驟是空的', broken((f) => (f.actions[0].cues = [cue({ kind: 'step', word: '  ' })]))],
		['手位是空的', broken((f) => (f.actions[0].cues = [cue({ kind: 'motion', word: '' })]))],
		['拍點沒有給誰', broken((f) => (f.actions[0].cues = [cue({ who: undefined })]))],
		['給動作裡沒有的角色', broken((f) => (f.actions[0].cues = [cue({ who: { role: '上層' } })]))],
		['給不在動作裡的隊員', broken((f) => (f.actions[0].cues = [cue({ who: { member: 'zz' } })]))],
		['口號段的動作有拍點', broken((f) => {
			f.actions[0].segmentId = 's2';
			f.actions[0].cues = [cue()];
		})],
		['成功率設定不是物件', brokenRate((f) => (f.actions[0].successRate = []))],
		['沒有環節清單', brokenRate((_, sr) => delete sr.phases)],
		['紀錄不是陣列', brokenRate((_, sr) => (sr.records = {}))],
		['一次不是物件', brokenRate((_, sr) => (sr.records = [1]))],
		['一次沒有 id', brokenRecord((r) => delete r.id)],
		['一次的 id 重複', brokenRecord((r, records) => (r.id = records[1].id))],
		['日期不是字', brokenRecord((r) => (r.date = 20261104))],
		['日期寫錯', brokenRecord((r) => (r.date = '2026-13-04'))],
		['誰不是組也不是隊員', brokenRecord((r) => (r.who = true))],
		['沒有人的組', brokenRecord((r) => (r.who = 3))],
		['分組的動作給了隊員', brokenRecord((r) => (r.who = 'm1'))],
		['練法不對', brokenRecord((r) => (r.practice = 'game'))],
		['全上沒帶全上的 id', brokenRecord((r) => (r.practice = 'runThrough'))],
		['全上的 id 不是字', brokenRecord((_, records) => (records[2].runThroughId = 1))],
		['整個做不是是非', brokenRecord((r) => (r.whole = 'yes'))],
		['全上只練幾個環節', brokenRecord((_, records) => (records[2].whole = false))],
		['記號不是物件', brokenRecord((r) => (r.marks = ['✓']))],
		['記號指到不在的環節', brokenRecord((r) => (r.marks.p9 = '✓'))],
		['記號不是 ✓ △ ✗', brokenRecord((r) => (r.marks.p1 = 'O'))],
		['一個記號都沒有', brokenRecord((r) => (r.marks = {}))],
		['環節種類不在五種裡', brokenRate((_, sr) => (sr.phases[1].kind = 'other'))],
		['環節沒有 id', brokenRate((_, sr) => delete sr.phases[1].id)],
		['環節的 id 重複', brokenRate((_, sr) => (sr.phases[1].id = sr.phases[0].id))],
		['環節的名字不是字', brokenRate((_, sr) => (sr.phases[1].name = null))],
		['環節的名字頭尾有空白', brokenRate((_, sr) => (sr.phases[2].name = ' 搖籃'))],
		['環節的顏色不是 #rrggbb', brokenRate((_, sr) => (sr.phases[1].color = 'red'))],
		['環節的顏色不在辨識色和石板灰裡', brokenRate((_, sr) => (sr.phases[1].color = '#123456'))],
		['環節標的拍不是整數', brokenRate((_, sr) => (sr.phases[1].beats = { at: 4.5, len: 2 }))],
		['環節標的拍不是整拍', brokenRate((_, sr) => (sr.phases[1].beats = { at: 4, len: 3 }))],
		['環節標的拍不在整拍上', brokenRate((_, sr) => (sr.phases[0].beats = { at: 0, len: 4 }))],
		['環節標的拍不到一拍', brokenRate((_, sr) => (sr.phases[1].beats = { at: 4, len: 0 }))],
		['環節標的拍超出動作', brokenRate((_, sr) => (sr.phases[1].beats = { at: 14, len: 4 }))],
		['環節標的拍在動作之前', brokenRate((_, sr) => (sr.phases[1].beats = { at: -2, len: 2 }))],
		['環節標的拍互相重疊', brokenRate((_, sr) => (sr.phases[1].beats = { at: 2, len: 2 }))],
		['口號段的動作有標的拍', brokenRate((f) => (f.actions[0].segmentId = 's2'))],
		['組不是整數', brokenRate((f) => (f.actions[0].members[0].squad = 1.5))],
		['組不是正的', brokenRate((f) => (f.actions[0].members[0].squad = 0))],
		['組是字', brokenRate((f) => (f.actions[0].members[0].squad = '1'))],
		['騰翻的動作有組', brokenRate((f) => (f.actions[0].category = 'tumbling'))],
		['跳躍的動作有組', brokenRate((f) => (f.actions[0].category = 'jump'))],
		['沒打開記成功率卻有組', brokenRate((f) => delete f.actions[0].successRate)],
		['發到第幾號不是數字', brokenRate((f) => (f.lastIds = { p: 'x' }))]
	])('欄位壞掉（%s）：不是流程檔', (_, file) => {
		expect(readFlowFile(file)).toEqual({ kind: 'error', message: '這不是流程檔' });
	});

	it('第 1 版的檔：資料不用動，每張站位的位置都一樣', () => {
		const flow = sample();
		const r = readFlowFile(zipOf({ formatVersion: 1, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
	});

	it('第 2 版的檔：資料不用動，動作沒有拍點', () => {
		const flow = withWalks();
		const r = readFlowFile(zipOf({ formatVersion: 2, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
		expect(r.kind === 'ok' && r.flow.actions[0].cues).toBeUndefined();
	});

	it('第 3 版的檔：資料不用動，動作沒有辨識色，站位沒有名稱', () => {
		const flow = withCues();
		const r = readFlowFile(zipOf({ formatVersion: 3, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
		expect(r.kind === 'ok' && r.flow.actions[0].color).toBeUndefined();
		expect(r.kind === 'ok' && r.flow.formations.every((f) => f.name === undefined)).toBe(true);
	});

	it('第 4 版的檔：資料不用動，標記用號碼', () => {
		const flow = sample();
		const r = readFlowFile(zipOf({ formatVersion: 4, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
		expect(r.kind === 'ok' && memberMarkers(r.flow)).toEqual({ m1: '1', m2: '2' });
	});

	it('第 5 版的檔：資料不用動，動作沒打開記成功率，人都沒分組', () => {
		const flow = flowOf(setMarkers(sample(), 'initial'));
		const r = readFlowFile(zipOf({ formatVersion: 5, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
		expect(r.kind === 'ok' && r.flow.actions[0].successRate).toBeUndefined();
		expect(r.kind === 'ok' && r.flow.actions[0].members.every((m) => m.squad === undefined)).toBe(true);
	});

	/** 第 6 版的檔：withRecords() 換成第 7 版以前的組號（見 numbered）再照第 6 版還允許的樣子改（第 6 版音樂段的環節可以沒標拍、組可以跳號）。 */
	function v6(edit: (flow: any, sr: any) => void, from: () => Flow = withRecords): Uint8Array {
		const flow = numbered(from());
		edit(flow, flow.actions[0].successRate);
		return zipOf({ formatVersion: 6, flow });
	}

	it('第 6 版的檔：音樂段沒標拍的環節和它們的記號拿掉，記號清光的那一次整筆拿掉', () => {
		const file = v6((_, sr) => {
			delete sr.phases[1].beats;
			sr.records.push({ id: 't4', date: '2026-11-05', who: 2, practice: 'drill', whole: false, marks: { p2: '✓' } });
		});
		const r = readFlowFile(file);
		const sr = r.kind === 'ok' ? r.flow.actions[0].successRate : null;
		expect(sr?.phases.map((p) => p.id)).toEqual(['p1', 'p3']);
		expect(sr?.records.map((a) => [a.id, a.marks])).toEqual([
			['t1', { p1: '✓', p3: '△' }],
			['t2', { p1: '✗' }],
			['t3', { p1: '✓', p3: '✓' }]
		]);
	});

	it('第 6 版的檔：音樂段的環節都沒標拍，動作不記成功率，人也沒有組', () => {
		const file = v6((_, sr) => sr.phases.forEach((p: any) => delete p.beats));
		const r = readFlowFile(file);
		expect(r.kind === 'ok' && r.flow.actions[0].successRate).toBeUndefined();
		expect(r.kind === 'ok' && r.flow.actions[0].members).toEqual([
			{ memberId: 'm1', role: '飛人' },
			{ memberId: 'm2', role: null }
		]);
	});

	it('第 6 版的檔：記成功率但一個環節都沒有（舊的開關打開沒預填），動作不記成功率，人也沒有組', () => {
		const file = v6((f) => (f.actions[0].successRate = { phases: [], records: [] }), withSuccessRate);
		const r = readFlowFile(file);
		expect(r.kind === 'ok' && r.flow.actions[0].successRate).toBeUndefined();
		expect(r.kind === 'ok' && r.flow.actions[0].members.every((m) => m.squad === undefined)).toBe(true);
	});

	it('第 6 版的檔：跳號的組補成 1、2、3，紀錄跟著換號', () => {
		const file = v6((f, sr) => {
			f.actions[0].members[0].squad = 2;
			f.actions[0].members[1].squad = 5;
			for (const r of sr.records) r.who = r.who === 1 ? 2 : 5;
		});
		const r = readFlowFile(file);
		const action = r.kind === 'ok' ? r.flow.actions[0] : null;
		expect(action && squadNumbers(action)).toEqual([1, 2]);
		expect(action?.successRate?.records.map((a) => squadNumber(action, a.who))).toEqual([1, 2, 1]);
	});

	it('第 6 版的檔：口號段的環節不動（本來就沒標拍）', () => {
		let flow = flowOf(addAction(sample(), { segmentId: 's2', category: 'pyramid', name: '金字塔', start: 0, length: 40, note: '', members: [{ memberId: 'm1', role: null }] }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'load', name: '' }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'dismount', name: '' }));
		const r = readFlowFile(zipOf({ formatVersion: 6, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
	});

	it('第 6 版的檔本來就壞掉（組是 0）：升級不幫它補號，照樣打不開', () => {
		const file = v6((f, sr) => {
			f.actions[0].members[0].squad = 0;
			for (const r of sr.records) if (r.who === 1) r.who = 0;
		});
		expect(readFlowFile(file)).toEqual({ kind: 'error', message: '這不是流程檔' });
	});

	/** 第 7 版的檔（組是第幾組，見 numbered）改壞一個地方；sr 是 Lib 的成功率設定。 */
	function v7(edit: (flow: any, sr: any) => void): Uint8Array {
		const flow = numbered(withRecords());
		edit(flow, flow.actions[0].successRate);
		return zipOf({ formatVersion: 7, flow });
	}

	it.each([
		['記成功率卻一個環節都沒有', v7((f) => (f.actions[0].successRate = { phases: [], records: [] }))],
		['音樂段的環節沒標拍', v7((_, sr) => delete sr.phases[1].beats)],
		['音樂段的環節沒照拍的先後排', v7((_, sr) => sr.phases.reverse())],
		['口號段的環節有拍', v7((f) => (f.actions[0].segmentId = 's2'))],
		['組號跳號', v7((f, sr) => {
			f.actions[0].members[1].squad = 3;
			for (const r of sr.records) if (r.who === 2) r.who = 3;
		})],
		['組號不從 1 開始', v7((f, sr) => {
			f.actions[0].members.forEach((m: any) => (m.squad += 1));
			for (const r of sr.records) r.who += 1;
		})]
	])('第 7 版的檔不守規則（%s）：不是流程檔', (_, file) => {
		expect(readFlowFile(file)).toEqual({ kind: 'error', message: '這不是流程檔' });
	});

	it('第 7 版的檔：口號段的環節沒標拍，打得開', () => {
		let flow = flowOf(addAction(sample(), { segmentId: 's2', category: 'pyramid', name: '金字塔', start: 0, length: 40, note: '', members: [{ memberId: 'm1', role: null }] }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'load', name: '' }));
		const r = readFlowFile(zipOf({ formatVersion: 7, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
	});

	it('第 7 版的檔：組號、組的名字、紀錄、總表數字都跟原本一樣；組發了組 id，id 發號記上 g', () => {
		const flow = withRecords();
		const r = readFlowFile(zipOf({ formatVersion: 7, flow: numbered(flow) }));
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		const [before, after] = [flow.actions[0], r.flow.actions[0]];
		expect(squadNumbers(after)).toEqual([1, 2]);
		expect(after.members.map((m) => m.squad)).toEqual(['g1', 'g2']);
		expect(r.flow.lastIds).toEqual(flow.lastIds);
		expect(r.flow.lastIds?.g).toBe(2);
		expect(attemptWhos(r.flow, after)).toEqual(attemptWhos(flow, before));
		expect(after.successRate?.records.map((a) => squadName(r.flow, after, a.who))).toEqual(['第 1 組', '第 2 組', '第 1 組']);
		expect(after.successRate?.records).toEqual(before.successRate?.records);
		expect(rateTable(r.flow, after)).toEqual(rateTable(flow, before));
		expect(readFlowFile(writeFlowFile(r.flow, {}))).toMatchObject({ kind: 'ok', flow: r.flow });
	});

	it('第 7 版的檔：組照號碼順序發組 id，好幾個動作照動作的順序往下發；騰翻的「誰」不動', () => {
		let flow = withRecords();
		flow = flowOf(addAction(flow, { segmentId: 's3', category: 'tumbling', name: '', start: 0, length: 8, note: '', members: [{ memberId: 'm1', role: null }] }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'whole', name: '', beats: { at: 0, len: 8 } }));
		flow = flowOf(recordAttempt(flow, 'x2', { date: '2026-11-04', who: 'm1', practice: 'drill', whole: true, marks: { p4: '✓' } }));
		flow = flowOf(addAction(flow, { segmentId: 's3', category: 'stunt', name: '', start: 8, length: 8, note: '', members: [{ memberId: 'm1', role: null }, { memberId: 'm2', role: null }] }));
		flow = flowOf(addPhase(flow, 'x3', { kind: 'whole', name: '', beats: { at: 0, len: 8 } }));
		flow = flowOf(setSquad(flow, 'x3', ['m1'], 2));
		const old = numbered(flow);
		// 第 2 組的人排在前面：發號照號碼，不照人的順序。
		old.actions[2].members.reverse();
		const r = readFlowFile(zipOf({ formatVersion: 7, flow: old }));
		const actions = r.kind === 'ok' ? r.flow.actions : [];
		expect(actions.map((a) => a.members.map((m) => m.squad))).toEqual([['g1', 'g2'], [undefined], ['g3', 'g4']]);
		expect(actions[1].successRate?.records.map((a) => a.who)).toEqual(['m1']);
		expect(r.kind === 'ok' && r.flow.lastIds?.g).toBe(4);
	});

	it('第 7 版的檔沒有組：資料不用動，不記 g', () => {
		const flow = sample();
		const r = readFlowFile(zipOf({ formatVersion: 7, flow }));
		expect(r.kind === 'ok' && r.flow).toEqual(flow);
	});

	/** 第 8 版的檔改壞一個地方；sr 是 Lib 的成功率設定。 */
	function v8(edit: (flow: any, sr: any) => void): Uint8Array {
		const flow = JSON.parse(JSON.stringify(withRecords()));
		edit(flow, flow.actions[0].successRate);
		return zipOf({ formatVersion: 8, flow });
	}

	it.each([
		['組是數字（第 7 版的寫法）', v8((f) => (f.actions[0].members[0].squad = 1))],
		['組 id 不是 g 加編號', v8((f) => (f.actions[0].members[0].squad = 'squad1'))],
		['組 id 是空的', v8((f) => (f.actions[0].members[0].squad = ''))],
		['紀錄的誰是數字', v8((_, sr) => (sr.records[0].who = 1))],
		['紀錄的誰指到沒有人的組 id', v8((_, sr) => (sr.records[0].who = 'g9'))]
	])('第 8 版的檔組 id 壞掉（%s）：不是流程檔', (_, file) => {
		expect(readFlowFile(file)).toEqual({ kind: 'error', message: '這不是流程檔' });
	});

	// 用假想的更舊版證明升級鏈：第 -1 版沒有 customRoles 和 actions，
	// 第 0 版補了 customRoles，第 1 版補了 actions，第 2、3、4、5、6、7、8 版資料不用動。
	const { customRoles: _r, actions: _a, ...v0Flow } = sample();
	const upgrades = {
		[-1]: (doc: FlowDocument) => ({ formatVersion: 0, flow: { ...(doc.flow as object), customRoles: [] } }),
		0: (doc: FlowDocument) => ({ formatVersion: 1, flow: { ...(doc.flow as object), actions: [] } }),
		1: (doc: FlowDocument) => ({ formatVersion: 2, flow: doc.flow }),
		2: (doc: FlowDocument) => ({ formatVersion: 3, flow: doc.flow }),
		3: (doc: FlowDocument) => ({ formatVersion: 4, flow: doc.flow }),
		4: (doc: FlowDocument) => ({ formatVersion: 5, flow: doc.flow }),
		5: (doc: FlowDocument) => ({ formatVersion: 6, flow: doc.flow }),
		6: (doc: FlowDocument) => ({ formatVersion: 7, flow: doc.flow }),
		7: (doc: FlowDocument) => ({ formatVersion: 8, flow: doc.flow })
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
