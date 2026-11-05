// 音樂檔庫（編輯器 module 的 music）：在 Node 測，解碼換成假的。
import { describe, expect, it } from 'vitest';
import { addSegment, createFlow, loadSegmentAudio, renameFlow, updateSegment, writeFlowFile, type Flow, type MusicSegment } from '#lib/core';
import type { EditorSession } from '#lib/editor-session.svelte.js';
import { flowOf } from '#lib/test-flows.js';
import { testEditor } from '#lib/test-fakes.js';

/** 一個音樂段（音樂 1：150 BPM、8 個八拍 = 25.6 秒），還沒有音樂。 */
function musicFlow(): Flow {
	const flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	return flowOf(addSegment(flow, 'music'));
}

const mp3 = (name = '主歌.mp3', bytes = [1, 2, 3]) => new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' });

/** 段設定的問教練：session 的「改」（成功就算一步）。 */
const changeAsk = (session: EditorSession) => session.changeAsk();

const segment = (session: EditorSession, i = 0) => session.flow!.segments[i] as MusicSegment;

describe('音樂檔庫：給一段選音樂檔', () => {
	it('解碼好：段指到新的音樂檔（算一步），長度、波形拿得到', async () => {
		const decoded = { durationSec: 95.2, peaks: [0.1, 0.4] };
		const { editor, session } = testEditor(musicFlow(), { decode: async () => decoded });
		await editor.music.pick('s1', mp3(), changeAsk(session));
		expect(session.flow!.audio).toEqual([{ id: 'a1', file: 'audio/a1.mp3', name: '主歌.mp3' }]);
		expect(segment(session).audioId).toBe('a1');
		expect(session.canUndo).toBe(true);
		// 這一段第一次有音樂：長度照音樂長度算（95.2 × 150 ÷ 60 = 238 拍 = 30 個八拍，最後一個 6 拍）
		expect(segment(session).halfBeats).toBe(238 * 2);
		expect(editor.music.get('a1')).toEqual({ bytes: expect.any(ArrayBuffer), ...decoded });
		expect(new Uint8Array(editor.music.get('a1')!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('格式不對、讀不出來：原因交給段設定，流程不變', async () => {
		const decode = async () => {
			throw new Error('壞檔');
		};
		const { editor, session } = testEditor(musicFlow(), { decode });
		const ask = changeAsk(session);
		await editor.music.pick('s1', mp3('歌.ogg'), ask);
		expect(ask.error).toBe('只能載入 mp3、m4a、wav');
		await editor.music.pick('s1', mp3(), ask);
		expect(ask.error).toBe('這個音樂檔讀不出來');
		expect(session.canUndo).toBe(false);
		expect(editor.music.get('a1')).toBeUndefined();
	});

	it('還在解碼時段設定關了、又加了一段：解碼完不放進流程，也不會弄丟新段', async () => {
		const slow = slowDecode();
		const { editor, session } = testEditor(musicFlow(), { decode: slow.decode });
		const picking = editor.music.pick('s1', mp3(), changeAsk(session));
		await slow.started;
		editor.music.cancelPicks();
		session.change(flowOf(addSegment(session.flow!, 'music')));
		slow.finish();
		await picking;
		expect(session.flow!.segments.map((s) => s.kind === 'music' && s.audioId)).toEqual([null, null]);
		expect(session.flow!.audio).toEqual([]);
		expect(editor.music.get('a1')).toBeUndefined();
	});

	it('還在解碼時開了別的流程檔：解碼完不放進新流程，新流程的音樂檔庫是新的', async () => {
		const slow = slowDecode();
		const { editor, session } = testEditor(musicFlow(), { decode: slow.decode });
		const picking = editor.music.pick('s1', mp3('別首.mp3'), changeAsk(session));
		await slow.started;
		// 開檔：檔案裡的音樂解碼好、換上流程和它的音樂檔庫
		await editor.file.open(new File([writeFlowFile(flowOf(renameFlow(musicFlow(), '別支')), {}) as Uint8Array<ArrayBuffer>], '別支.zip'));
		slow.finish();
		await picking;
		expect(session.flow!.name).toBe('別支');
		expect(session.unsaved).toBe(false);
		expect(editor.music.get('a1')).toBeUndefined();
	});
});

describe('音樂檔庫：存檔、缺音樂', () => {
	it('存檔要寫的位元組：流程用到的每一個音樂都有；換掉不用的不寫；缺音樂的段查得到', async () => {
		let flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '主歌.mp3'));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(updateSegment(flow, 's3', { audioId: 'a1' }));
		const { editor, session } = testEditor(flow);
		editor.switchMusic(await editor.readMusic({ a1: new Uint8Array([7, 7]) }));
		const ask = changeAsk(session);
		await editor.music.pick('s2', mp3('副歌.mp3', [8]), ask);
		expect(editor.music.bytes(session.flow!)).toEqual({ a1: new Uint8Array([7, 7]), a2: new Uint8Array([8]) });
		await editor.music.pick('s2', mp3('別首.mp3', [9]), ask);
		expect(editor.music.bytes(session.flow!)).toEqual({ a1: new Uint8Array([7, 7]), a3: new Uint8Array([9]) });
		expect(editor.music.missingSegmentIds).toEqual([]);
		session.open(flow);
		editor.switchMusic();
		expect(editor.music.missingSegmentIds).toEqual(['s1', 's3']);
		expect(editor.music.bytes(flow)).toEqual({});
	});

	it('第二個音樂段選了同一個檔：第一拍接上前一段的結尾', async () => {
		const flow = flowOf(addSegment(musicFlow(), 'music'));
		const { editor, session } = testEditor(flow, { decode: async () => ({ durationSec: 60, peaks: [] }) });
		const ask = changeAsk(session);
		await editor.music.pick('s1', mp3(), ask);
		// 第一次載入時長度照音樂長度算成整首 60 秒：切段先把音樂 1 縮短成 8 個八拍
		ask.send((o) => updateSegment(session.flow!, 's1', { eights: 8 }, o));
		ask.send((o) => updateSegment(session.flow!, 's2', { audioId: 'a1' }, o, editor.music.lengths));
		// 音樂 1：第一拍 0 秒、150 BPM、8 個八拍 = 25.6 秒
		expect(segment(session, 1)).toMatchObject({ audioId: 'a1', firstBeatSec: 25.6 });
		expect(editor.music.lengths).toEqual({ a1: 60 });
	});
});

describe('音樂檔庫：復原', () => {
	it('選了音樂檔（缺的那段補好）、復原、重做：解碼過的音樂還在，照樣能播', async () => {
		const buffer = {} as AudioBuffer;
		const flow = flowOf(loadSegmentAudio(musicFlow(), 's1', '主歌.mp3'));
		const { editor, session } = testEditor(flow, { decode: async () => ({ durationSec: 30, peaks: [], buffer }) });
		expect(editor.music.missingSegmentIds).toEqual(['s1']);
		await editor.music.pick('s1', mp3(), changeAsk(session));
		const picked = segment(session).audioId!;
		expect(editor.music.missingSegmentIds).toEqual([]);
		session.undo();
		expect(editor.music.missingSegmentIds).toEqual(['s1']);
		session.redo();
		expect(segment(session).audioId).toBe(picked);
		expect(editor.music.missingSegmentIds).toEqual([]);
		expect(editor.music.buffer(picked)).toBe(buffer);
	});

	it('流程已經不用、但復原還會用到的音樂檔：id 不給新選的檔', async () => {
		const { editor, session } = testEditor(musicFlow());
		const ask = changeAsk(session);
		await editor.music.pick('s1', mp3('舊.mp3'), ask);
		session.undo();
		await editor.music.pick('s1', mp3('新.mp3'), ask);
		expect(session.flow!.audio.map((a) => a.id)).toEqual(['a2']);
		session.undo();
		session.redo();
		expect(editor.music.get('a1')).toBeDefined();
		expect(editor.music.get('a2')).toBeDefined();
	});
});

describe('音樂檔庫：開檔', () => {
	/** 音樂 1 用主歌.mp3（a1）。 */
	const withAudio = () => flowOf(loadSegmentAudio(musicFlow(), 's1', '主歌.mp3'));

	it('檔案裡的音樂解碼好：長度、波形拿得到', async () => {
		const decoded = { durationSec: 60, peaks: [0.5] };
		const { editor } = testEditor(withAudio(), { decode: async () => decoded });
		editor.switchMusic(await editor.readMusic({ a1: new Uint8Array([7, 7]) }));
		expect(editor.music.get('a1')).toEqual({ bytes: expect.any(ArrayBuffer), ...decoded });
		expect(editor.music.hasBroken).toBe(false);
	});

	it('缺音樂檔照開：那段查得到找不到音樂；給它選了檔就補好', async () => {
		const flow = withAudio();
		const { editor, session } = testEditor(flow);
		editor.switchMusic(await editor.readMusic({}));
		expect(session.flow).toBe(flow);
		expect(editor.music.missingSegmentIds).toEqual(['s1']);
		await editor.music.pick('s1', mp3(), changeAsk(session));
		expect(editor.music.missingSegmentIds).toEqual([]);
	});

	it('壞檔（這個瀏覽器解不開）：那一段的音樂標成壞的，流程照開；位元組留著照樣存回去', async () => {
		const decode = async () => {
			throw new Error('壞檔');
		};
		const flow = withAudio();
		const { editor, session } = testEditor(flow, { decode });
		editor.switchMusic(await editor.readMusic({ a1: new Uint8Array([7, 7]) }));
		expect(session.flow).toBe(flow);
		expect(editor.music.get(segment(session).audioId)).toMatchObject({ broken: true });
		expect(editor.music.hasBroken).toBe(true);
		expect(editor.music.lengths).toEqual({ a1: null });
		expect(editor.music.missingSegmentIds).toEqual([]);
		expect(editor.music.bytes(flow)).toEqual({ a1: new Uint8Array([7, 7]) });
	});
});

/** 慢的解碼：started 等它開始解碼，finish() 才解完（30 秒的音樂）。 */
function slowDecode() {
	let finish = () => {};
	let started = () => {};
	const startedPromise = new Promise<void>((r) => (started = r));
	const decode = () =>
		new Promise<{ durationSec: number; peaks: number[] }>((r) => {
			finish = () => r({ durationSec: 30, peaks: [] });
			started();
		});
	return { decode, started: startedPromise, finish: () => finish() };
}
