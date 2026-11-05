// 動作表單的草稿（編輯器 module 的 actionDraft）：在 Node 測，跟著 session 的選取、流程和播放頭。
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	createFlow,
	deleteCustomRole,
	updateAction,
	updateCustomRole,
	updateSegment,
	type Flow
} from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import { flowOf } from '#lib/test-flows.js';
import { manualFrames, testEditor } from '#lib/test-fakes.js';
import type { ActionDraft } from './action-draft.svelte.js';

/** 音樂 1（150 BPM、4 個八拍，一個半拍 0.2 秒）；隊員小A（上層）、小B（底層）。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	return flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
}

/** sample 加 x1：金字塔「Lib」，1-2 開始 4 拍，小A 當上層，藍色，備註「慢」。 */
function withLib(): Flow {
	const members = [{ memberId: 'm1', role: '上層' }];
	const lib = { segmentId: 's1', category: 'pyramid' as const, name: 'Lib', start: 2, length: 8, note: '慢', members, color: '#1565c0' };
	return flowOf(addAction(sample(), lib));
}

/** 編輯器 module 開著 flow；回傳草稿、session、播放。 */
function setup(flow: Flow = sample()) {
	const { editor, session } = testEditor(flow);
	return { draft: editor.actionDraft, session, playback: editor.playback };
}

/** 表單上看得到的草稿。 */
const form = (d: ActionDraft) => ({
	category: d.category,
	name: d.name,
	startText: d.startText,
	lengthText: d.lengthText,
	note: d.note,
	members: d.members,
	color: d.color
});

describe('動作表單的草稿：建', () => {
	it('沒選動作、沒選人：空白的，開始和長度是播放頭那一格（一個八拍）', () => {
		const { draft, playback } = setup();
		playback.seek(1);
		expect(form(draft)).toEqual({
			category: 'stunt',
			name: '',
			startText: '1-3&',
			lengthText: '8',
			note: '',
			members: [],
			color: undefined
		});
		expect(draft.action).toBeNull();
	});

	it('從選的人建：人就是選到的人，任務角色照大類和全局角色先填', () => {
		const { draft, session } = setup();
		session.selectMembers(['m2', 'm1']);
		expect(draft.members).toEqual([
			{ memberId: 'm2', role: '底層' },
			{ memberId: 'm1', role: '上層' }
		]);
	});

	it('從一個動作建：選了動作，草稿就是那個動作；回到新增又是空白的', () => {
		const { draft, session, playback } = setup(withLib());
		playback.seek(1);
		session.selectAction('x1');
		expect(draft.action).toBe(session.flow!.actions[0]);
		expect(form(draft)).toEqual({
			category: 'pyramid',
			name: 'Lib',
			startText: '1-2',
			lengthText: '4',
			note: '慢',
			members: [{ memberId: 'm1', role: '上層' }],
			color: '#1565c0'
		});
		session.selectAction(null);
		expect(draft.action).toBeNull();
		expect(form(draft)).toMatchObject({ category: 'stunt', name: '', startText: '1-3&', lengthText: '8', note: '', color: undefined });
	});

	it('回首頁再開一支流程：從空白開始，打到一半的不留', () => {
		const { draft, session } = setup();
		draft.name = '收尾';
		draft.note = '慢';
		session.open(null);
		session.open(sample(), true);
		expect(form(draft)).toEqual({
			category: 'stunt',
			name: '',
			startText: '1-1',
			lengthText: '8',
			note: '',
			members: [],
			color: undefined
		});
	});
});

describe('動作表單的草稿：新增時跟著選取和播放頭', () => {
	it('選的人換了，人跟著換；已經在表單裡的人任務角色不動（清掉的不會被填回去）', () => {
		const { draft, session } = setup();
		session.selectMembers(['m1']);
		draft.setRole(0, null);
		session.selectMembers(['m1', 'm2']);
		expect(draft.members).toEqual([
			{ memberId: 'm1', role: null },
			{ memberId: 'm2', role: '底層' }
		]);
		session.selectMembers(['m2']);
		expect(draft.members).toEqual([{ memberId: 'm2', role: '底層' }]);
	});

	it('播放頭動了，開始和長度跟著播放頭那一格', () => {
		const { draft, playback } = setup();
		playback.seek(1);
		playback.step(1, false);
		expect([draft.startText, draft.lengthText]).toEqual(['1-4', '8']);
		// 最後一個八拍的 4-7：到段尾只剩 2 拍
		playback.seek(12);
		expect([draft.startText, draft.lengthText]).toEqual(['4-7', '2']);
	});

	it('打過字的開始、長度不再跟著播放頭；新增之後的新草稿又跟著走', () => {
		const { draft, playback, session } = setup();
		draft.startText = '3-1';
		playback.seek(5);
		expect([draft.startText, draft.lengthText]).toEqual(['3-1', '8']);
		draft.lengthText = '2';
		playback.seek(12);
		expect([draft.startText, draft.lengthText]).toEqual(['3-1', '2']);
		session.selectMembers(['m1']);
		draft.add();
		session.selectAction(null);
		playback.seek(1);
		expect([draft.startText, draft.lengthText]).toEqual(['1-3&', '8']);
	});

	it('開始欄有焦點時不跟著播放頭，離開了沒打字就跟上', () => {
		const { draft, playback } = setup();
		draft.focusSlotField('startText');
		playback.seek(1);
		expect([draft.startText, draft.lengthText]).toEqual(['1-1', '8']);
		draft.focusSlotField(null);
		expect(draft.startText).toBe('1-3&');
	});

	it('播放中播到下一個八拍：開始跟著走', () => {
		const engine = createFakeEngine();
		const frames = manualFrames();
		const { editor } = testEditor(sample(), { createEngine: () => engine, nextFrame: frames.nextFrame });
		editor.playback.play();
		engine.audible = engine.clicks[0].when + 3.3;
		frames.step();
		expect(editor.actionDraft.startText).toBe('2-1');
	});

	it('加人、移出、從別的動作複製人：也改選取（人就是選到的人）', () => {
		const { draft, session } = setup(withLib());
		session.selectMembers(['m2']);
		draft.addMember('m1');
		expect(session.selectedMemberIds).toEqual(['m2', 'm1']);
		expect(draft.members).toEqual([
			{ memberId: 'm2', role: '底層' },
			{ memberId: 'm1', role: '上層' }
		]);
		draft.removeMember(0);
		expect(session.selectedMemberIds).toEqual(['m1']);
		draft.setRole(0, null);
		draft.copyMembers(session.flow!.actions[0]);
		expect(session.selectedMemberIds).toEqual(['m1']);
		expect(draft.members).toEqual([{ memberId: 'm1', role: '上層' }]);
	});
});

describe('動作表單的草稿：改選到的動作', () => {
	it('選到的動作被別的地方改了（拖色條、復原）：草稿照改過的動作', () => {
		const { draft, session } = setup(withLib());
		session.selectAction('x1');
		draft.name = '打到一半';
		session.change(flowOf(updateAction(session.flow!, 'x1', { start: 8 })));
		expect([draft.name, draft.startText]).toEqual(['Lib', '1-5']);
		session.undo();
		expect(draft.startText).toBe('1-2');
	});

	it('「＋加人…」照動作的大類先填（跳躍不填）；不改選取', () => {
		const { draft, session } = setup(withLib());
		session.selectAction('x1');
		draft.addMember('m2');
		expect(draft.members[1]).toEqual({ memberId: 'm2', role: '底層' });
		expect(session.selectedMemberIds).toEqual([]);
		draft.setCategory('jump');
		draft.removeMember(1);
		draft.addMember('m2');
		expect(draft.members[1]).toEqual({ memberId: 'm2', role: null });
	});

	it('在名詞對照表改了自訂角色的名字：草稿照核心改好的動作', () => {
		let flow = flowOf(addCustomRole(sample(), { name: '丟人的', meaning: '' }));
		const members = [{ memberId: 'm1', role: '丟人的' }];
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: '', start: 0, length: 8, note: '', members }));
		const { draft, session } = setup(flow);
		session.selectAction('x1');
		session.change(flowOf(updateCustomRole(session.flow!, 'r1', { name: '拋人的', meaning: '' })));
		expect(draft.members).toEqual([{ memberId: 'm1', role: '拋人的' }]);
	});
});

describe('動作表單的草稿：自訂任務角色、大類', () => {
	/** sample 加兩個自訂任務角色：r1「丟人的」、r2「抬腳的」。 */
	const withCustom = () =>
		flowOf(addCustomRole(flowOf(addCustomRole(sample(), { name: '丟人的', meaning: '' })), { name: '抬腳的', meaning: '' }));

	it('新增到一半在名詞對照表改名、刪掉自訂角色：草稿裡的人跟著換名字、變成沒有任務', () => {
		const { draft, session } = setup(withCustom());
		session.selectMembers(['m1', 'm2']);
		draft.setRole(0, '丟人的');
		draft.setRole(1, '抬腳的');
		session.change(flowOf(updateCustomRole(session.flow!, 'r1', { name: '拋人的', meaning: '' })));
		session.change(flowOf(deleteCustomRole(session.flow!, 'r2')));
		expect(draft.members).toEqual([
			{ memberId: 'm1', role: '拋人的' },
			{ memberId: 'm2', role: null }
		]);
	});

	it('新增時換大類：還是舊大類預設值的人照全局角色重填，改過的不動', () => {
		const { draft, session } = setup();
		session.selectMembers(['m1', 'm2']);
		expect(draft.members.map((m) => m.role)).toEqual(['上層', '底層']);
		draft.setRole(1, '主底');
		draft.setCategory('tumbling');
		expect(draft.members.map((m) => m.role)).toEqual(['騰翻', '主底']);
		draft.setCategory('dance');
		expect(draft.members.map((m) => m.role)).toEqual([null, '主底']);
		draft.setCategory('pyramid');
		expect(draft.category).toBe('pyramid');
		expect(draft.members.map((m) => m.role)).toEqual(['上層', '主底']);
	});

	it('改動作時換大類：任務角色不動（照動作的）', () => {
		const { draft, session } = setup(withLib());
		session.selectAction('x1');
		draft.setCategory('tumbling');
		expect(draft.category).toBe('tumbling');
		expect(draft.members).toEqual([{ memberId: 'm1', role: '上層' }]);
	});
});

describe('動作表單的草稿：送出（開始、長度由核心讀）', () => {
	it('新增：照打的字加一個動作（算一步），選到它，草稿就是它', () => {
		const { draft, session, playback } = setup();
		playback.seek(1);
		session.selectMembers(['m2']);
		draft.name = '收尾';
		draft.lengthText = '4.5';
		draft.add();
		expect(session.flow!.actions).toEqual([
			{ id: 'x1', segmentId: 's1', category: 'stunt', name: '收尾', start: 5, length: 9, note: '', members: [{ memberId: 'm2', role: '底層' }] }
		]);
		expect(session.canUndo).toBe(true);
		expect(session.selectedActionId).toBe('x1');
		expect(draft.action).toBe(session.flow!.actions[0]);
	});

	it.each([
		['開始', '9-9x', '開始看不懂，例：3-5&'],
		['長度', '四拍', '長度看不懂'],
		['長度', '-2', '動作長度要在 0.5 到 32 拍之間']
	] as const)('新增時%s打「%s」：被擋，原因是「%s」', (field, text, message) => {
		const { draft, session } = setup();
		session.selectMembers(['m1']);
		if (field === '開始') draft.startText = text;
		else draft.lengthText = text;
		const before = session.flow;
		draft.add();
		expect(draft.ask.error).toBe(message);
		expect(session.flow).toBe(before);
	});

	it('改動作：打的字馬上生效，草稿照改好的動作；看不懂就被擋、說「已還原」，草稿回到動作的', () => {
		const { draft, session } = setup(withLib());
		session.selectAction('x1');
		draft.lengthText = '２';
		draft.update();
		expect(session.flow!.actions[0].length).toBe(4);
		expect(draft.action).toBe(session.flow!.actions[0]);

		draft.startText = '3-';
		draft.update();
		expect(draft.ask.error).toBe('開始看不懂，例：3-5&，已還原');
		expect(draft.startText).toBe('1-2');
		expect(session.flow!.actions[0].start).toBe(2);
	});

	it('新增時 update 什麼都不做（等按「新增動作」）', () => {
		const { draft, session } = setup();
		session.selectMembers(['m1']);
		const before = session.flow;
		draft.update();
		expect(session.flow).toBe(before);
	});
});

describe('動作表單的草稿：紅字', () => {
	/** 新增被擋下（開始打錯）：紅字在。 */
	function blocked(flow = sample()) {
		const t = setup(flow);
		t.session.selectMembers(['m1']);
		t.draft.startText = '9-9x';
		t.draft.add();
		expect(t.draft.ask.error).toBe('開始看不懂，例：3-5&');
		return t;
	}

	it.each([
		['改開始', ({ draft }) => (draft.startText = '1-1')],
		['改長度', ({ draft }) => (draft.lengthText = '2')],
		['改名稱', ({ draft }) => (draft.name = 'Lib')],
		['改備註', ({ draft }) => (draft.note = '慢')],
		['換大類', ({ draft }) => draft.setCategory('pyramid')],
		['挑辨識色', ({ draft }) => draft.setColor('#1565c0')],
		['改任務角色', ({ draft }) => draft.setRole(0, null)],
		['場上多選一個人', ({ session }) => session.selectMembers(['m1', 'm2'])]
	] as [string, (t: ReturnType<typeof setup>) => void][])('新增被擋下後，草稿一改（%s）紅字就收掉', (_, edit) => {
		const t = blocked();
		edit(t);
		expect(t.draft.ask.error).toBe('');
	});

	it('新增被擋下後，在名詞對照表改了自訂角色的名字：紅字也收掉', () => {
		const t = blocked(flowOf(addCustomRole(sample(), { name: '丟人的', meaning: '' })));
		t.session.change(flowOf(updateCustomRole(t.session.flow!, 'r1', { name: '拋人的', meaning: '' })));
		expect(t.draft.ask.error).toBe('');
	});

	it('播放頭在同一格裡動：草稿沒改，紅字留著', () => {
		const t = blocked();
		t.playback.seek(0.1);
		expect(t.draft.ask.error).toBe('開始看不懂，例：3-5&');
	});

	it('改動作被擋下（已還原）：再打字也不收，說明是那一下被擋', () => {
		const { draft, session } = setup(withLib());
		session.selectAction('x1');
		draft.startText = '3-';
		draft.update();
		draft.name = 'Ext';
		draft.setRole(0, null);
		expect(draft.ask.error).toBe('開始看不懂，例：3-5&，已還原');
	});

	it('換選到的動作、回到新增：紅字收掉', () => {
		const t = blocked(withLib());
		t.session.selectAction('x1');
		expect(t.draft.ask.error).toBe('');
		t.draft.startText = '3-';
		t.draft.update();
		t.session.selectAction(null);
		expect(t.draft.ask.error).toBe('');
	});
});
