// 編輯器 module 在 Node（不畫編輯頁）打開雲端流程（#310）：送一步、收別人的改動、復原、一步被退回。
// 伺服器是測試共用的假伺服器（fakeServer），cloudEditor 打開；別人用 joinAs 在別的地方打開、送步。
import { describe, expect, it } from 'vitest';
import { cloudEditor, flush } from '#lib/test-fakes.js';

describe('編輯器 module：雲端流程（Node）', () => {
	it('打開雲端流程、送一步：伺服器收了', async () => {
		const s = await cloudEditor();
		expect(s.editor.file.cloudId).toBe('c1');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);

		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		expect(s.state.flows[0].flow.name).toBe('全國賽');
		expect(s.state.flows[0].step).toBe(1);
	});

	it('別人加入、送一步進來：這邊的流程跟著變', async () => {
		const s = await cloudEditor();
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		w.step({ name: 'addSegment', args: ['chant'] });
		await flush();
		expect(s.session.flow!.segments).toHaveLength(2);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('按復原：伺服器上的流程退回去，別人改的別的東西留著', async () => {
		const s = await cloudEditor();
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		w.step({ name: 'addSegment', args: ['chant'] });
		await flush();

		expect(s.session.undo()).toBe(true);
		await flush();
		expect(s.state.flows[0].flow.name).toBe('測試');
		expect(s.state.flows[0].flow.segments).toHaveLength(2);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('一步被退回（別人先改了同一個東西）：流程換回伺服器的樣子，提示是誰', async () => {
		const s = await cloudEditor();
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		s.state.holdRoom = true;
		w.step({ name: 'renameFlow', args: ['區賽'] });
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		expect(s.session.flow!.name).toBe('全國賽');

		s.releaseRoom();
		await flush();
		expect(s.session.flow!.name).toBe('區賽');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
		expect(s.session.notice).toBe('王教練剛改了同一個地方，你的「改流程名字」沒改成');
	});
});
