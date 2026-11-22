// 整份流程檢查（ADR 0014）：每一條規則不合時回對的原因；「讓它留著」的規則只擋這一步新出現的毛病。
import { describe, expect, it } from 'vitest';
import {
	addMembers,
	checkFlowDocument,
	FORMAT_VERSION,
	flowProblem,
	MAX_EIGHTS,
	MAX_MEMBERS,
	readFlowFile,
	said,
	writeFlowFile,
	type Flow,
	type Why,
	type WhyCode
} from './index';
import { uploadFlowJson } from './bundle-entry';
import { flowOf, ratedSample } from '../test-flows';

/** 再加人加到 n 個人（用指令加，所以合規則）。 */
function withMembers(flow: Flow, n: number): Flow {
	const more = Array.from({ length: n - flow.members.length }, (_, i) => ({
		name: `隊員${i + 1}`,
		gender: 'F' as const,
		globalRole: 'base' as const
	}));
	return flowOf(addMembers(flow, more));
}

/** 不經過指令直接加 n 個人（舊檔、或兩個分頁的改動合起來才會有的樣子）。 */
function forceMembers(flow: Flow, n: number): Flow {
	const start = flow.members.length;
	const members = [
		...flow.members,
		...Array.from({ length: n }, (_, i) => ({ id: `m${start + i + 1}`, name: `多${i + 1}`, gender: 'F' as const, globalRole: 'base' as const }))
	];
	const pos = { ...flow.formations[0].pos };
	for (const m of members) pos[m.id] ??= [0, 0];
	return { ...flow, members, formations: flow.formations.map((f) => ({ ...f, pos: { ...pos, ...f.pos } })) };
}

describe('整份流程檢查：人數上限（讓它留著）', () => {
	it('合規則的流程是 null', () => {
		expect(flowProblem(ratedSample())).toBeNull();
	});

	it('復原後超過上限：你刪 5 個、別人加 5 個（40 人），復原變 45 人，擋下', () => {
		const full = withMembers(ratedSample(), MAX_MEMBERS);
		expect(flowProblem(forceMembers(full, 5), full)).toEqual({ code: 'flow_check_max_members', max: MAX_MEMBERS });
	});

	it('之前就超過上限的舊流程，傳上雲端（沒有之前）、或復原不相干的東西，照收', () => {
		const old = forceMembers(withMembers(ratedSample(), MAX_MEMBERS), 5);
		expect(flowProblem(old)).toBeNull();
		expect(flowProblem({ ...old, name: '改名' }, old)).toBeNull();
	});
});

describe('檢查一整支流程（checkFlowDocument）：讀流程檔和傳上雲端共用', () => {
	it('舊版的流程升到現在的版本', () => {
		const flow = ratedSample();
		expect(checkFlowDocument({ formatVersion: 8, flow })).toEqual({ kind: 'ok', flow });
	});

	it('新版編輯器存的不收', () => {
		expect(checkFlowDocument({ formatVersion: FORMAT_VERSION + 1, flow: ratedSample() })).toEqual({
			kind: 'error',
			message: '是新版編輯器存的，請重新整理，更新編輯器',
			why: { code: 'flow_file_newer' }
		});
	});

	it.each([
		['不是物件', 'flow'],
		['沒有版本', { flow: ratedSample() }],
		['型別不對', { formatVersion: FORMAT_VERSION, flow: { ...ratedSample(), members: {} } }],
		['指到不存在的段', { formatVersion: FORMAT_VERSION, flow: { ...ratedSample(), segments: [] } }]
	])('%s：壞掉了', (_, doc) => {
		expect(checkFlowDocument(doc)).toEqual({ kind: 'error', message: '流程檔裡的資料壞掉了', why: { code: 'flow_file_broken' } });
	});

	it('段太長：寫出上限', () => {
		const flow = ratedSample();
		const segments = flow.segments.map((s) => ({ ...s, halfBeats: (MAX_EIGHTS + 1) * 16 }));
		expect(checkFlowDocument({ formatVersion: FORMAT_VERSION, flow: { ...flow, segments } })).toEqual({
			kind: 'error',
			message: `音樂段要在 1 到 ${MAX_EIGHTS} 個八拍之間`,
			why: { code: 'segment_file_music_range', max: MAX_EIGHTS }
		});
	});
});

describe('整份流程檢查：開檔就擋的規則（跟讀流程檔一樣，之前就有也擋）', () => {
	const flow = ratedSample();
	const x1 = flow.actions[0];
	const broken: [string, Flow, string | Why][] = [
		['型別不對', { ...flow, name: 3 as unknown as string }, { code: 'flow_file_shape' }],
		['沒有開頭站位', { ...flow, formations: [] }, { code: 'flow_file_no_first_formation' }],
		[
			'開頭那張有走位',
			{ ...flow, formations: [{ ...flow.formations[0], walks: {} }] },
			{ code: 'flow_file_first_walks' }
		],
		['段指到不存在的音樂檔', { ...flow, audio: [], segments: flow.segments.map((s) => ({ ...s, audioId: 'a9' })) }, { code: 'flow_file_segment_audio' }],
		['動作指到不存在的段', { ...flow, actions: [{ ...x1, segmentId: 's9' }] }, { code: 'flow_file_action_segment' }],
		[
			'動作指到不存在的隊員',
			{ ...flow, actions: [{ ...x1, members: [{ memberId: 'm9', role: null }] }] },
			{ code: 'flow_file_action_member' }
		],
		[
			'拍點不守規則',
			{ ...flow, actions: [{ ...x1, cues: [{ kind: 'count', at: 99, len: 2, word: 'down', who: null }] }] },
			{ code: 'flow_check_in_action', action: { code: 'action_label', category: { code: 'category_stunt' }, name: 'Lib' }, reason: { code: 'beat_range_cue_inside' } }
		],
		[
			'成功率設定不守規則',
			{ ...flow, actions: [{ ...x1, successRate: { phases: [], records: [] } }] },
			{ code: 'flow_check_in_action', action: { code: 'action_label', category: { code: 'category_stunt' }, name: 'Lib' }, reason: { code: 'success_rate_no_phases' } }
		],
		[
			'段太長',
			{ ...flow, segments: flow.segments.map((s) => ({ ...s, halfBeats: (MAX_EIGHTS + 1) * 16 })) },
			{ code: 'segment_file_music_range', max: MAX_EIGHTS }
		]
	];
	it.each(broken)('%s', (_, bad, message) => {
		expect(flowProblem(bad)).toEqual(message);
		expect(flowProblem(bad, bad)).toEqual(message);
	});
});

/** x1 換成 change 過的樣子。 */
function withX1(flow: Flow, change: Partial<Flow['actions'][number]>): Flow {
	return { ...flow, actions: flow.actions.map((a) => (a.id === 'x1' ? { ...a, ...change } : a)) };
}

/**
 * 讓它留著的規則：[規則, 把合規則的流程改成不合, 原因, 原因的代號（還沒改成代號的沒有）]。
 * 每一條都看三件事：這一步新出現就擋、寫對原因；傳上雲端（沒有之前）不擋；之前就有的（舊檔）不擋。
 */
const kept: [string, (flow: Flow) => Flow, string, WhyCode?][] = [
	['流程名字太長', (f) => ({ ...f, name: '流'.repeat(41) }), '流程名字最多 40 個字', 'text_length_too_long'],
	['流程沒有名字', (f) => ({ ...f, name: ' ' }), '請幫流程取名字', 'flow_no_name'],
	[
		'隊員名字太長',
		(f) => ({ ...f, members: f.members.map((m) => (m.id === 'm1' ? { ...m, name: '美'.repeat(21) } : m)) }),
		'隊員名字最多 20 個字',
		'text_length_too_long'
	],
	['隊員沒有名字', (f) => ({ ...f, members: f.members.map((m) => (m.id === 'm1' ? { ...m, name: '' } : m)) }), '請填隊員名字', 'members_no_name'],
	['動作名稱太長', (f) => withX1(f, { name: 'L'.repeat(21) }), `動作「技巧·${'L'.repeat(21)}」：動作名稱最多 20 個字`, 'flow_check_in_action'],
	['備註太長', (f) => withX1(f, { note: '慢'.repeat(201) }), '動作「技巧·Lib」：備註最多 200 個字', 'flow_check_in_action'],
	[
		'站位名稱太長',
		(f) => ({ ...f, formations: f.formations.map((x, i) => (i === 0 ? { ...x, name: '開'.repeat(21) } : x)) }),
		'站位 1：站位名稱最多 20 個字',
		'flow_check_in_formation'
	],
	['任務角色名稱太長', (f) => ({ ...f, customRoles: [{ id: 'r1', name: '飛'.repeat(9), meaning: '' }] }), '任務角色名稱最多 8 個字', 'text_length_too_long'],
	['任務角色沒有名稱', (f) => ({ ...f, customRoles: [{ id: 'r1', name: '', meaning: '' }] }), '請填任務角色名稱', 'roles_no_name'],
	['任務角色重複', (f) => ({ ...f, customRoles: [{ id: 'r1', name: '上層', meaning: '' }] }), '已經有「上層」這個任務角色了', 'roles_name_taken'],
	['場地條數', (f) => ({ ...f, field: { ...f.field, strips: 13 } }), '條數要是 1–12 的整數', 'flow_strips'],
	['時間規則的秒數', (f) => ({ ...f, timeRules: { ...f.timeRules, minChantSec: 0 } }), '秒數要大於 0', 'time_rules_positive'],
	[
		'口號段最少不比整支最多少',
		(f) => ({ ...f, timeRules: { ...f.timeRules, minChantSec: 200 } }),
		'「口號段加起來最少」要比「整支流程最多」少',
		'time_rules_chant'
	],
	[
		'音樂段最多超過整支最多',
		(f) => ({ ...f, timeRules: { ...f.timeRules, maxMusicSec: 200 } }),
		'「音樂段加起來最多」不能超過「整支流程最多」',
		'time_rules_music'
	],
	['BPM', (f) => ({ ...f, segments: f.segments.map((s) => ({ ...s, bpm: 200 })) }), '音樂 1：BPM 要在 60 到 170 之間', 'flow_check_in_segment'],
	['第一拍', (f) => ({ ...f, segments: f.segments.map((s) => ({ ...s, firstBeatSec: -1 })) }), '音樂 1：第一拍要是 0 秒以上', 'flow_check_in_segment'],
	[
		'站到場地外太遠',
		(f) => ({ ...f, formations: f.formations.map((x) => ({ ...x, pos: { ...x.pos, m1: [100, 100] } })) }),
		'站位 1：小美 只能站到場地外 1 公尺以內',
		'flow_check_in_formation'
	],
	[
		'站位不在段裡',
		(f) => ({ ...f, formations: [...f.formations, { id: 'f9', segmentId: 's1', at: 999, pos: f.formations[0].pos }] }),
		'站位 2：要在段的時間裡',
		'flow_check_in_formation'
	],
	[
		'兩張站位同一拍',
		(f) => ({ ...f, formations: [...f.formations, { id: 'f9', segmentId: 's1', at: 0, pos: f.formations[0].pos }] }),
		'站位 2 和站位 1 在同一拍',
		'flow_check_formation_same_beat'
	],
	[
		'站位沒照時間排',
		(f) => ({
			...f,
			formations: [...f.formations, ...[16, 8].map((at) => ({ id: `f${at}`, segmentId: 's1', at, pos: f.formations[0].pos }))]
		}),
		'站位 3 要在站位 2 之後',
		'flow_check_formation_order'
	],
	[
		'動作的時間',
		(f) => ({ ...f, actions: f.actions.map((a) => (a.id === 'x2' ? { ...a, start: 56 } : a)) }),
		'動作「騰翻」：超過這段的結尾，最多 4 拍',
		'flow_check_in_action'
	],
	[
		'動作沒有人',
		(f) => ({ ...f, actions: f.actions.map((a) => (a.id === 'x2' ? { ...a, members: [] } : a)) }),
		'動作「騰翻」：一個動作至少要有 1 個人',
		'flow_check_in_action'
	],
	[
		'同一個人放兩次',
		(f) => ({ ...f, actions: f.actions.map((a) => (a.id === 'x2' ? { ...a, members: [a.members[0], a.members[0]] } : a)) }),
		'動作「騰翻」：同一個人只能放一次',
		'flow_check_in_action'
	],
	[
		'沒有這個任務角色',
		(f) => ({
			...f,
			actions: f.actions.map((a) => (a.id === 'x2' ? { ...a, members: [{ memberId: 'm1', role: '飛人' }] } : a))
		}),
		'動作「騰翻」：沒有「飛人」這個任務角色',
		'flow_check_in_action'
	],
	[
		'同一個人兩個動作撞在一起',
		(f) => ({ ...f, actions: f.actions.map((a) => (a.id === 'x2' ? { ...a, start: 0 } : a)) }),
		'小美 同一時間在「技巧·Lib」和「騰翻」裡',
		'flow_check_clash'
	]
];

describe('整份流程檢查：讓它留著的規則', () => {
	it.each(kept)('%s', (_, spoil, message, code) => {
		const good = ratedSample();
		const bad = spoil(good);
		const problem = flowProblem(bad, good);
		expect(problem && said(problem).message).toBe(message);
		expect(problem && said(problem).why?.code).toBe(code);
		expect(flowProblem(bad)).toBeNull();
		expect(flowProblem({ ...bad, markers: 'initial' }, bad)).toBeNull();
	});
});

describe('整份流程檢查：站位的鍵不看清單的位置（ADR 0020）', () => {
	/** ratedSample 再直接加幾張站位（拍：s1 的 at）。 */
	const withFormations = (...ats: number[]): Flow => {
		const f = ratedSample();
		const pos = f.formations[0].pos;
		return { ...f, formations: [f.formations[0], ...ats.map((at, i) => ({ id: `k${i + 1}`, segmentId: 's1', at, pos }))] };
	};
	const order = (flow: Flow, ids: string[]): Flow => ({
		...flow,
		formations: [flow.formations[0], ...ids.map((id) => flow.formations.find((f) => f.id === id)!)]
	});

	it('沒照時間排的排好（0、16、8、16 → 0、8、16、16）：同一拍的兩張還是同一個毛病，排序本身不算新的毛病', () => {
		const unsorted = withFormations(16, 8, 16);
		expect(flowProblem(order(unsorted, ['k2', 'k1', 'k3']), unsorted)).toBeNull();
	});

	it('同一拍三張是一個毛病；第三張加進原本兩張的那一拍：擋下（新的一組）', () => {
		const two = withFormations(16, 16);
		const three = withFormations(16, 16, 16);
		expect(flowProblem(order(three, ['k3', 'k1', 'k2']), three)).toBeNull();
		expect(flowProblem(three, two)).toEqual({ code: 'flow_check_formation_same_beat', n: 3, other: 2 });
	});

	it('排好的流程換成沒照時間排：擋下', () => {
		const sorted = withFormations(8, 16);
		expect(flowProblem(order(sorted, ['k2', 'k1']), sorted)).toEqual({ code: 'flow_check_formation_order', n: 3, before: 2 });
	});
});

describe('整份流程檢查：開得了的流程檔都過得了（傳上雲端）', () => {
	it('舊檔帶著每一種讓它留著的毛病：開得了，也過得了', () => {
		const old = kept.reduce((flow, [, spoil]) => spoil(flow), forceMembers(withMembers(ratedSample(), MAX_MEMBERS), 5));
		const opened = readFlowFile(writeFlowFile(old, {}));
		expect(opened.kind).toBe('ok');
		if (opened.kind === 'ok') expect(flowProblem(opened.flow)).toBeNull();
	});
});

describe('整份流程檢查的原因帶代號（ADR 0017）', () => {
	it('包著的原因一層一層放：站位幾、誰、站太遠', () => {
		const good = ratedSample();
		const bad = { ...good, formations: good.formations.map((x) => ({ ...x, pos: { ...x.pos, m1: [100, 100] as [number, number] } })) };
		expect(flowProblem(bad, good)).toEqual({
			code: 'flow_check_in_formation',
			n: 1,
			reason: { code: 'flow_check_off_field', member: '小美', reason: { code: 'formation_off_field' } }
		});
	});

	it('撞在一起：誰、兩個動作的名字', () => {
		const good = ratedSample();
		const bad = { ...good, actions: good.actions.map((a) => (a.id === 'x2' ? { ...a, start: 0 } : a)) };
		expect(flowProblem(bad, good)).toEqual({ code: 'flow_check_clash', member: '小美', first: { code: 'action_label', category: { code: 'category_stunt' }, name: 'Lib' }, second: { code: 'category_tumbling' } });
	});

	it('傳上雲端不收：伺服器拿到中文和代號', () => {
		const good = ratedSample();
		const flow = { ...good, segments: good.segments.map((s) => ({ ...s, halfBeats: (MAX_EIGHTS + 1) * 16 })) };
		expect(JSON.parse(uploadFlowJson(JSON.stringify({ formatVersion: FORMAT_VERSION, flow })))).toEqual({
			kind: 'error',
			message: `音樂段要在 1 到 ${MAX_EIGHTS} 個八拍之間`,
			why: { code: 'segment_file_music_range', max: MAX_EIGHTS }
		});
	});
});
