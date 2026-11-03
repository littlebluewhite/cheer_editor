import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	clearCues,
	cueForMember,
	cuesAt,
	deleteAction,
	deleteMember,
	moveAction,
	MOTION_WORDS,
	placeCue,
	resizeAction,
	STEP_WORDS,
	updateAction,
	updateSegment,
	usedWords,
	type CommandResult,
	type Cue,
	type Flow
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（2 個八拍）→ 口號 1。x1：音樂 1 的 1-3 開始、4 拍（半拍 4–12）；x2：口號 1 裡。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 5, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 2, lastBeats: 8 }));
	flow = flowOf(addSegment(flow, 'chant'));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '底層' }
	];
	const base = { category: 'stunt' as const, name: 'Lib', note: '', members };
	flow = flowOf(addAction(flow, { ...base, segmentId: 's1', start: 4, length: 8 }));
	return flowOf(addAction(flow, { ...base, segmentId: 's2', start: 0, length: 30 }));
}

const cuesOf = (flow: Flow, id = 'x1') => flow.actions.find((a) => a.id === id)!.cues ?? [];
const count = (at: number, len: number, word: string): Cue => ({ kind: 'count', at, len, word, who: null });

describe('放拍點', () => {
	it('down 2 拍、up 1 拍：拍子放滿選到的拍', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 2, word: 'up' }));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 2, 'up')]);
	});

	it('字去掉頭尾空白；同一種被新的蓋到時，舊的切短', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 4, word: ' up ' }));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 4, 'up')]);
	});

	it('從中間切開：兩邊露出來的都留著', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 2, len: 2, word: 'up' }));
		expect(cuesOf(flow)).toEqual([count(0, 2, 'down'), count(2, 2, 'up'), count(4, 4, 'down')]);
	});

	it('整個被蓋到的舊拍點拿掉', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 2, len: 2, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 6, word: 'up' }));
		expect(cuesOf(flow)).toEqual([count(0, 6, 'up')]);
	});

	it.each([
		['超出動作', { at: 6, len: 4, word: 'down' }, '拍點要在動作裡面'],
		['在動作之前', { at: -2, len: 2, word: 'down' }, '拍點要在動作裡面'],
		['不到一拍', { at: 0, len: 1, word: 'down' }, '拍點要佔整數拍，至少 1 拍'],
		['不是整數拍', { at: 0, len: 3, word: 'down' }, '拍點要佔整數拍，至少 1 拍'],
		['拍子用別的字', { at: 0, len: 2, word: 'ready' }, '拍子只能是 down 或 up'],
		['不在整拍上', { at: 1, len: 2, word: 'down' }, '拍點要放在整拍上']
	])('不合規則被擋（%s）', (_, input, message) => {
		expect(placeCue(sample(), 'x1', { kind: 'count', ...input })).toEqual({ kind: 'blocked', message });
	});

	it('口號段的動作不能放', () => {
		expect(placeCue(sample(), 'x2', { kind: 'count', at: 0, len: 2, word: 'down' })).toEqual({
			kind: 'blocked',
			message: '口號段不數拍，不能放拍點'
		});
	});
});

describe('步驟和手位', () => {
	const step = (at: number, len: number, word: string): Cue => ({ kind: 'step', at, len, word, who: null });
	const motion = (at: number, word: string): Cue => ({ kind: 'motion', at, len: 2, word, who: null });

	it('步驟放滿選到的拍；手位放一拍；跟拍子各放各的', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 0, len: 8, word: '下手' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 4, len: 2, word: ' high V ' }));
		expect(cuesOf(flow)).toEqual([count(0, 8, 'down'), step(0, 8, '下手'), motion(4, 'high V')]);
	});

	it.each([
		['步驟是空白', { kind: 'step' as const, at: 0, len: 2, word: '  ' }, '請寫拍點的字'],
		['手位是空的', { kind: 'motion' as const, at: 0, len: 2, word: '' }, '請寫拍點的字'],
		['手位佔兩拍', { kind: 'motion' as const, at: 0, len: 4, word: 'T' }, '手位只佔一拍']
	])('不合規則被擋（%s）', (_, input, message) => {
		expect(placeCue(sample(), 'x1', input)).toEqual({ kind: 'blocked', message });
	});

	it('清掉步驟不動拍子和手位', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 0, len: 4, word: '落地' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'T' }));
		flow = flowOf(clearCues(flow, 'x1', 'step', 0, 8));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), motion(0, 'T')]);
	});
});

describe('這支流程用過的字', () => {
	it('內建的步驟和手位', () => {
		expect(STEP_WORDS).toEqual(['下手', '落地', '放']);
		expect(MOTION_WORDS).toEqual(['high V', 'low V', 'T', 'touchdown', 'K', 'L', 'diagonal']);
	});

	it('步驟、手位各一份，扣掉內建的字，不重複', () => {
		const member = [{ memberId: 'm1', role: null }];
		let flow = flowOf(
			addAction(sample(), { category: 'stunt', name: 'B', note: '', segmentId: 's1', start: 16, length: 8, members: member })
		);
		const placed: [string, 'step' | 'motion', number, string][] = [
			['x1', 'step', 0, '下手'],
			['x1', 'step', 2, '抬腳'],
			['x1', 'motion', 0, 'high V'],
			['x1', 'motion', 2, '拳頭'],
			['x3', 'step', 0, '抬腳'],
			['x3', 'step', 2, '轉身'],
			['x3', 'motion', 0, '拳頭']
		];
		for (const [id, kind, at, word] of placed) flow = flowOf(placeCue(flow, id, { kind, at, len: 2, word }));
		expect(usedWords(flow)).toEqual({ step: ['抬腳', '轉身'], motion: ['拳頭'] });
	});

	it('沒有拍點就都是空的', () => {
		expect(usedWords(sample())).toEqual({ step: [], motion: [] });
	});
});

describe('清拍點', () => {
	it('只清那一段裡的拍子，露在外面的留著', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 4, word: 'up' }));
		flow = flowOf(clearCues(flow, 'x1', 'count', 2, 6));
		expect(cuesOf(flow)).toEqual([count(0, 2, 'down'), count(6, 2, 'up')]);
	});
});

describe('拍點跟著動作', () => {
	const withDownUp = () => {
		const flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		return flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 2, word: 'up' }));
	};

	it('拖動作（含拖半拍）：拍點從動作開始算，所以跟著走', () => {
		// 150 BPM：一個半拍 0.2 秒；拖到段內第 5 個半拍（1-3&）。
		const flow = flowOf(moveAction(withDownUp(), 'x1', 1));
		expect(flow.actions[0].start).toBe(5);
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 2, 'up')]);
	});

	it('改動作的其他欄位，拍點還在', () => {
		const flow = flowOf(updateAction(withDownUp(), 'x1', { name: 'Cradle' }));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 2, 'up')]);
	});

	it('改 BPM：拍點還在同一拍', () => {
		const flow = flowOf(updateSegment(withDownUp(), 's1', { bpm: 120 }));
		expect(flow.actions[0].start).toBe(4);
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 2, 'up')]);
	});

	/** x1 從 1-3 開始 4 拍：down 1-3 到 1-4、up 1-5、down 1-6。 */
	const withThree = () => flowOf(placeCue(withDownUp(), 'x1', { kind: 'count', at: 6, len: 2, word: 'down' }));

	it('動作變短、會切到拍點：先問，列出會拿掉和切短的拍點，流程不變', () => {
		expect(updateAction(withThree(), 'x1', { length: 2 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會拿掉 2 個、切短 1 個拍點',
			items: ['切短：拍子 down 1-3 到 1-4 → 1-3', '拿掉：拍子 up 1-5', '拿掉：拍子 down 1-6']
		});
	});

	it('按確定：跨出去的切短、整個在外面的拿掉', () => {
		const flow = flowOf(updateAction(withThree(), 'x1', { length: 2 }, { confirmed: true }));
		expect(flow.actions[0].length).toBe(2);
		expect(cuesOf(flow)).toEqual([count(0, 2, 'down')]);
	});

	it('切完不到一拍的拿掉', () => {
		const r = updateAction(withThree(), 'x1', { length: 3 });
		expect(r).toMatchObject({ message: '動作「技巧·Lib」變短，會拿掉 2 個、切短 1 個拍點' });
		const flow = flowOf(updateAction(withThree(), 'x1', { length: 3 }, { confirmed: true }));
		expect(cuesOf(flow)).toEqual([count(0, 2, 'down')]);
	});

	it('只切短沒拿掉時，訊息只寫切短', () => {
		expect(updateAction(withDownUp(), 'x1', { length: 2 })).toMatchObject({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會拿掉 1 個、切短 1 個拍點'
		});
		const flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		expect(updateAction(flow, 'x1', { length: 4 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會切短 1 個拍點',
			items: ['切短：拍子 down 1-3 到 1-6 → 1-3 到 1-4']
		});
	});

	it('動作變短但沒切到拍點：不問，直接改', () => {
		const flow = flowOf(updateAction(withDownUp(), 'x1', { length: 6 }));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 2, 'up')]);
	});

	it('拉色條變短也一樣先問；按確定才切', () => {
		// 150 BPM：一個半拍 0.2 秒；拉到段內第 6 個半拍（動作長 2 個半拍）。
		expect(resizeAction(withDownUp(), 'x1', 1.2)).toMatchObject({ kind: 'confirm' });
		const flow = flowOf(resizeAction(withDownUp(), 'x1', 1.2, { confirmed: true }));
		expect(cuesOf(flow)).toEqual([count(0, 2, 'down')]);
	});

	it('拖半拍後再變短：清單的時間寫在 & 上', () => {
		const moved = flowOf(moveAction(withDownUp(), 'x1', 1));
		expect(updateAction(moved, 'x1', { length: 4 })).toMatchObject({
			items: ['拿掉：拍子 up 1-5&']
		});
	});

	it('變短又被別的規則擋：照樣擋，不先問', () => {
		expect(updateAction(withDownUp(), 'x1', { length: 2, members: [] })).toEqual({
			kind: 'blocked',
			message: '一個動作至少要有 1 個人'
		});
	});

	it('有拍點的動作換到口號段：先問會拿掉幾個，按確定才換，拍點全部拿掉', () => {
		expect(updateAction(withDownUp(), 'x1', { segmentId: 's2', start: 40 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」換到口號段，會拿掉 2 個拍點',
			items: ['拿掉：拍子 down 1-3 到 1-4', '拿掉：拍子 up 1-5']
		});
		const flow = flowOf(
			updateAction(withDownUp(), 'x1', { segmentId: 's2', start: 40 }, { confirmed: true })
		);
		expect(flow.actions[0].segmentId).toBe('s2');
		expect(cuesOf(flow)).toEqual([]);
	});

	it('刪動作：拍點跟著刪', () => {
		const flow = flowOf(deleteAction(withDownUp(), 'x1'));
		expect(flow.actions.some((a) => a.cues?.length)).toBe(false);
	});

	it('段縮短連帶刪動作：拍點跟著動作一起刪', () => {
		const flow = flowOf(updateSegment(withDownUp(), 's1', { eights: 1, lastBeats: 4 }, { confirmed: true }));
		expect(flow.actions.map((a) => a.id)).toEqual(['x2']);
	});
});

describe('給誰', () => {
	const top = { role: '上層' };
	const who = (kind: 'count' | 'motion', at: number, len: number, word: string, w: Cue['who']): Cue => ({
		kind,
		at,
		len,
		word,
		who: w
	});

	it('給不同人的拍點可以疊在同一拍：全部 down、上層 high V、小B 一個 down', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 2, len: 2, word: 'up', who: top }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 2, len: 4, word: 'down', who: { member: 'm2' } }));
		expect(cuesOf(flow)).toEqual([
			who('count', 0, 8, 'down', null),
			who('count', 2, 2, 'up', top),
			who('count', 2, 4, 'down', { member: 'm2' })
		]);
	});

	it('只切同一個給誰被蓋到的拍點', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 8, word: 'down', who: top }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 4, word: 'up', who: top }));
		expect(cuesOf(flow)).toEqual([
			who('count', 0, 8, 'down', null),
			who('count', 0, 4, 'down', top),
			who('count', 4, 4, 'up', top)
		]);
	});

	it('清拍點不管給誰，全部清', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'motion', at: 0, len: 2, word: 'T' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'high V', who: top }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'K', who: { member: 'm1' } }));
		expect(cuesOf(flowOf(clearCues(flow, 'x1', 'motion', 0, 2)))).toEqual([]);
	});

	it.each([
		['動作裡沒人是這個角色', { role: '保護' }, '動作裡沒有人是「保護」'],
		['隊員不在動作裡', { member: 'm9' }, '這個隊員不在動作裡']
	])('給不對的人被擋（%s）', (_, w, message) => {
		expect(placeCue(sample(), 'x1', { kind: 'motion', at: 0, len: 2, word: 'T', who: w })).toEqual({
			kind: 'blocked',
			message
		});
	});

	it('拍點給不給這個人：全部每個人都算；角色算動作裡是這個角色的人；隊員只算那個人', () => {
		const action = sample().actions[0];
		const of = (w: Cue['who']) =>
			['m1', 'm2', 'm3'].filter((m) => cueForMember(who('motion', 0, 2, 'T', w), action, m));
		expect(of(null)).toEqual(['m1', 'm2']);
		expect(of(top)).toEqual(['m1']);
		expect(of({ member: 'm2' })).toEqual(['m2']);
	});

	const m2Only = [{ memberId: 'm2', role: '底層' }];

	it('從動作拿掉隊員、有拍點給他：先問並列出那些拍點，按確定才拿掉', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'K', who: { member: 'm1' } }));
		expect(updateAction(flow, 'x1', { members: m2Only })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」換了人或任務角色，會拿掉 1 個拍點',
			items: ['拿掉：手位 K 1-3・給小A']
		});
		const after = flowOf(updateAction(flow, 'x1', { members: m2Only }, { confirmed: true }));
		expect(after.actions[0].members).toEqual(m2Only);
		expect(cuesOf(after)).toEqual([count(0, 4, 'down')]);
	});

	it('改任務角色、動作裡沒人是那個角色了：先問，按確定拿掉給那個角色的拍點', () => {
		const flow = flowOf(placeCue(sample(), 'x1', { kind: 'motion', at: 6, len: 2, word: 'high V', who: top }));
		const members = [
			{ memberId: 'm1', role: '底層' },
			{ memberId: 'm2', role: '底層' }
		];
		expect(updateAction(flow, 'x1', { members })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」換了人或任務角色，會拿掉 1 個拍點',
			items: ['拿掉：手位 high V 1-6・給上層']
		});
		expect(cuesOf(flowOf(updateAction(flow, 'x1', { members }, { confirmed: true })))).toEqual([]);
	});

	it('同時變短又拿掉人：合成一次確認，清單都列出來', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'high V', who: top }));
		expect(updateAction(flow, 'x1', { length: 4, members: m2Only })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短、換了人或任務角色，會拿掉 1 個、切短 1 個拍點',
			items: ['切短：拍子 down 1-3 到 1-6 → 1-3 到 1-4', '拿掉：手位 high V 1-3・給上層']
		});
		const after = flowOf(updateAction(flow, 'x1', { length: 4, members: m2Only }, { confirmed: true }));
		expect(cuesOf(after)).toEqual([count(0, 4, 'down')]);
	});

	it('拿掉人但沒有拍點給他：不問，直接改', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'T', who: { role: '底層' } }));
		const after = flowOf(updateAction(flow, 'x1', { members: m2Only }));
		expect(cuesOf(after)).toEqual(cuesOf(flow));
	});

	it('刪隊員：確認訊息寫會一起拿掉幾個給他的拍點；沒有就不寫', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		expect(deleteMember(flow, 'm1')).toMatchObject({ message: '小A 在 2 個動作裡，其中 0 個會被整個刪掉' });
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'high V', who: top }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 2, len: 2, word: 'K', who: { member: 'm1' } }));
		expect(deleteMember(flow, 'm1')).toMatchObject({
			kind: 'confirm',
			message: '小A 在 2 個動作裡，其中 0 個會被整個刪掉，會一起拿掉 2 個給他的拍點'
		});
	});

	it('刪隊員：給他的拍點、給動作裡已經沒人做的角色的拍點一起拿掉，流程還是對的', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'high V', who: top }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'K', who: { member: 'm1' } }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'T', who: { role: '底層' } }));
		flow = flowOf(deleteMember(flow, 'm1', { confirmed: true }));
		expect(cuesOf(flow)).toEqual([who('count', 0, 4, 'down', null), who('motion', 0, 2, 'T', { role: '底層' })]);
		expect(updateAction(flow, 'x1', { name: 'Cradle' }).kind).toBe('ok');
	});
});

describe('這一刻的拍點', () => {
	const top = { role: '上層' };
	const cue = (kind: Cue['kind'], at: number, len: number, word: string, w: Cue['who'] = null): Cue => ({
		kind,
		at,
		len,
		word,
		who: w
	});

	/** BPM 120（半拍 0.25 秒），x1 從 2-3 開始（5 秒）、4 拍到 7 秒。下手 4 拍；down 2 拍、up 1 拍；上層 2-6 high V。 */
	function cued(): Flow {
		let flow = flowOf(updateSegment(sample(), 's1', { bpm: 120 }));
		flow = flowOf(moveAction(flow, 'x1', 5));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 0, len: 8, word: '下手' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 2, word: 'up' }));
		return flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 6, len: 2, word: 'high V', who: top }));
	}
	const summary = (flow: Flow, sec: number) =>
		cuesAt(flow, sec).map((c) => ({
			action: c.action.id,
			now: c.now.map((n) => `${n.cue.word} ${n.beat}/${n.beats}`),
			next: c.next && { at: c.next.at, words: c.next.cues.map((n) => n.word) }
		}));

	it('現在亮的拍點依步驟、拍子、手位排，寫走到第幾拍，和下一個在哪一拍', () => {
		expect(summary(cued(), 5.6)).toEqual([
			{ action: 'x1', now: ['下手 2/4', 'down 2/2'], next: { at: '2-5', words: ['up'] } }
		]);
		expect(summary(cued(), 6.6)).toEqual([{ action: 'x1', now: ['下手 4/4', 'high V 1/1'], next: null }]);
	});

	it('回傳的是拍點本身，給誰也在裡面', () => {
		const [live] = cuesAt(cued(), 6.6);
		expect(live.now.map((n) => n.cue)).toEqual([cue('step', 0, 8, '下手'), cue('motion', 6, 2, 'high V', top)]);
	});

	it('動作開始前一個八拍就預告第一個拍點；再早就沒有', () => {
		expect(summary(cued(), 1)).toEqual([{ action: 'x1', now: [], next: { at: '2-3', words: ['下手', 'down'] } }]);
		expect(summary(cued(), 0.9)).toEqual([]);
	});

	it('動作結束後不再出現', () => {
		expect(summary(cued(), 6.99)).toHaveLength(1);
		expect(summary(cued(), 7)).toEqual([]);
	});

	it('沒有拍點的動作、口號段的動作都沒有', () => {
		expect(summary(sample(), 1.5)).toEqual([]);
		expect(summary(cued(), 32 * 0.25 + 1)).toEqual([]);
	});
});
