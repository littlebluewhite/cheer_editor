// 編輯器 module 在 Node（不畫編輯頁）打開雲端流程（#310）：送一步、收別人的改動、復原、一步被退回。
// 伺服器是測試共用的假伺服器（fakeServer），cloudEditor 打開；別人用 joinAs 在別的地方打開、送步。
import { describe, expect, it } from 'vitest';
import { addBookmark, addSegment, remoteChange, runCommands, type Command, type Flow, type RemoteChange } from '#lib/core';
import type { RoomMessage } from '#lib/api-types/RoomMessage.js';
import { cloudEditor, flush } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';

/** 跑一串指令，一定要成功。 */
const ran = (flow: Flow, ...commands: Command[]): Flow => {
	const r = runCommands(flow, commands, 'test');
	if (r.kind !== 'ok') throw new Error(`指令沒成功：${r.kind}`);
	return r.flow;
};

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

	it('一步被退回、連帶拿掉書籤：提示先說退回原因，再說書籤也拿掉了（#316）', async () => {
		const s = await cloudEditor();
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		s.state.holdRoom = true;
		w.step({ name: 'renameFlow', args: ['區賽'] });
		// 改流程名字被退回：後面還沒收的（加段、在新的段存書籤）一起不算
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		const added = s.session.flow!.segments.at(-1)!.id;
		s.session.ask.send({ name: 'addBookmark', args: ['口號開頭', { segmentId: added, at: 0 }, null] });
		expect(s.session.flow!.bookmarks!.map((b) => b.name)).toEqual(['口號開頭']);

		s.releaseRoom();
		await flush();
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
		expect(s.session.flow!.bookmarks ?? []).toEqual([]);
		expect(s.session.notice).toBe('王教練剛改了同一個地方，你的「改流程名字」沒改成；書籤「口號開頭」也拿掉了');
	});

	it('換成伺服器做出來的樣子、連帶拿掉書籤：提示說書籤也拿掉了（#316）', async () => {
		// 音樂 1 後面一個口號段，書籤在口號段上
		const start = flowOf(addBookmark(flowOf(addSegment(libSample(), 'chant')), '口號', { segmentId: 's2', at: 0 }, null));
		const s = await cloudEditor({ flow: start });
		// 假伺服器照同一個流程核心跑，做不出「收了、但跟畫面不一樣、少了書籤」：假的那一則「收了」，
		// 伺服器做出來的是改了名字、口號段也不見了（書籤跟著拿掉）
		const server = ran(start, { name: 'renameFlow', args: ['全國賽'] }, { name: 'deleteSegment', args: ['s2'], options: { confirmed: true } });
		const heard = s.room.onmessage;
		s.room.onmessage = (msg: RoomMessage) =>
			heard(msg.kind === 'accepted' ? { ...msg, change: remoteChange(start, server) as RemoteChange } : msg);

		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		expect(s.session.flow!.segments.map((x) => x.id)).toEqual(['s1']);
		expect(s.session.flow!.bookmarks ?? []).toEqual([]);
		expect(s.session.notice).toBe('書籤「口號」也拿掉了');
	});
});
