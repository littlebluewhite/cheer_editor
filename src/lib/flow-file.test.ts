// 流程檔（編輯器 module 的 file）：開檔、存檔、新建、回首頁、草稿、「沒存先問」。在 Node 測，存檔、選檔、解碼、草稿存放、分頁頻道、計時器都是假的。
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addSegment,
	createFlow,
	deleteSegment,
	readFlowFile,
	recordAttempt,
	renameFlow,
	writeFlowFile,
	type AudioBytes,
	type Flow
} from '#lib/core';
import type { SaveOutcome } from '#lib/file/save.js';
import type { OpenTabChannel } from '#lib/tab-channel.js';
import { flowOf } from '#lib/test-flows.js';
import { audioFlow, fakeDraftStore, fakePendingInput, fakeSaver, fakeTabs, recordedFlow, testEditor } from '#lib/test-fakes.js';

/** 新建流程表單建好的流程：還沒有隊員和段。 */
const newFlow = (name: string) => flowOf(createFlow({ name, field: { strips: 9, layout: 'vertical' } }));

/** 選檔欄位選到的流程檔「練習用.zip」。 */
const zip = (flow: Flow, audio: AudioBytes = {}, name = '練習用.zip') =>
	new File([writeFlowFile(flow, audio) as Uint8Array<ArrayBuffer>], name, { type: 'application/zip' });

/** 存下來的流程檔讀回來。 */
function read(bytes: Uint8Array) {
	const r = readFlowFile(bytes);
	if (r.kind !== 'ok') throw new Error(r.message);
	return r;
}

/** 草稿裡的流程。 */
const draftFlow = (bytes: Uint8Array | null) => read(bytes ?? new Uint8Array()).flow;

/** 在最後加一段口號。 */
const addChant = (flow: Flow) => flowOf(addSegment(flow, 'chant'));

/** 頁面打開了，讀過草稿（用假的計時器）。這台電腦上的草稿是 draft（沒給就沒有），drafts 是假的草稿存放。 */
async function connected(draft: Uint8Array | null = null, savedAt?: Date) {
	const drafts = fakeDraftStore(draft, savedAt);
	const t = testEditor(null, { draftStore: drafts.store });
	t.editor.file.connect();
	await vi.advanceTimersByTimeAsync(0);
	return { ...t, drafts };
}

/** 每次建存檔薄層（一支流程一個）都是新的假存檔，照順序記在 all。 */
function savers(outcome: SaveOutcome = 'saved') {
	const all: ReturnType<typeof fakeSaver>[] = [];
	const create = () => {
		const made = fakeSaver(outcome);
		all.push(made);
		return made.saver;
	};
	return { all, create };
}

describe('流程檔：開檔', () => {
	it('首頁從選檔欄位開檔：換上檔案的流程，算存過', async () => {
		const { editor, session } = testEditor();
		await editor.file.open(zip(audioFlow(), { a1: new Uint8Array([1]) }));
		expect(session.flow!.name).toBe('練習用');
		expect(session.flow!.actions.map((a) => a.name)).toEqual(['Lib']);
		expect(session.unsaved).toBe(false);
	});

	it('瀏覽器能選檔又能存回（Chrome、Edge）：用選檔的 adapter 開，第一次存檔就存回那個檔', async () => {
		const made = savers();
		const opened = fakeSaver();
		const pickFlowFile = async () => ({ file: zip(audioFlow(), {}, '縣賽.zip'), saver: opened.saver });
		const { editor, session } = testEditor(null, { createSaver: made.create, pickFlowFile });
		expect(editor.file.canPick).toBe(true);
		await editor.file.pick();
		expect(session.flow!.name).toBe('練習用');
		expect(session.unsaved).toBe(false);
		await editor.file.save();
		expect(opened.saves).toHaveLength(1);
		expect(made.all).toEqual([]);
	});

	it('瀏覽器不能選檔（Safari、iPad、Firefox）：照舊用選檔欄位', () => {
		const { editor } = testEditor(null, { pickFlowFile: null });
		expect(editor.file.canPick).toBe(false);
	});

	it.each([
		['在選檔視窗按取消', async () => null],
		['選檔出錯', () => Promise.reject(new Error('不行'))]
	])('%s：什麼都不變', async (_, pickFlowFile) => {
		const { editor, session } = testEditor(null, { pickFlowFile });
		await editor.file.pick();
		expect(session.flow).toBeNull();
		expect(editor.file.openError).toBe('');
	});

	it('首頁開檔失敗：原因寫在首頁（檔名和核心給的原因），留在首頁；開別的檔成功就收掉', async () => {
		const { editor, session } = testEditor();
		const tooNew = zipSync({ 'flow.json': strToU8(JSON.stringify({ formatVersion: 99, flow: {} })) });
		await editor.file.open(new File([tooNew], '練習用.zip'));
		expect(session.flow).toBeNull();
		expect(editor.file.openError).toBe('打不開「練習用.zip」：是新版編輯器存的，請重新整理，更新編輯器');
		expect(session.notice).toBe('');
		await editor.file.open(new File([new TextEncoder().encode('不是 zip')], '亂丟.zip'));
		expect(editor.file.openError).toBe('打不開「亂丟.zip」：不是 zip 檔');
		await editor.file.open(zip(audioFlow()));
		expect(session.flow!.name).toBe('練習用');
		expect(editor.file.openError).toBe('');
	});

	it('編輯中開檔失敗：原因放在提示，原本的流程留著', async () => {
		const flow = audioFlow();
		const { editor, session } = testEditor(flow);
		await editor.file.open(new File([new TextEncoder().encode('不是 zip')], '練習用.zip'));
		expect(session.flow).toBe(flow);
		expect(session.notice).toBe('打不開「練習用.zip」：不是 zip 檔');
		expect(editor.file.openError).toBe('');
	});

	it('換一支流程就換一個存檔薄層：存的是新開的那個檔，不會蓋掉上一個', async () => {
		const made = savers();
		const { editor, session } = testEditor(null, { createSaver: made.create });
		await editor.file.open(zip(audioFlow()));
		await editor.file.save();
		await editor.file.open(zip(flowOf(renameFlow(audioFlow(), '另一支')), {}, '另一支.zip'));
		expect(session.flow!.name).toBe('另一支');
		await editor.file.save();
		expect(made.all.map((m) => m.fileNames)).toEqual([['練習用.zip'], ['另一支.zip']]);
	});
});

describe('流程檔：存檔', () => {
	it('開檔後改一下算沒存；存檔存成「流程名.zip」（存的就是現在的流程），存了算存過；再存一次存回同一個檔', async () => {
		const made = savers();
		const { editor, session } = testEditor(null, { createSaver: made.create });
		await editor.file.open(zip(audioFlow()));
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		expect(session.unsaved).toBe(true);
		await editor.file.save();
		expect(session.unsaved).toBe(false);
		expect(made.all).toHaveLength(1);
		expect(made.all[0].fileNames).toEqual(['全國賽.zip']);
		expect(read(made.all[0].saves[0]).flow.name).toBe('全國賽');
		session.change(flowOf(renameFlow(session.flow!, '縣賽')));
		await editor.file.save();
		expect(made.all).toHaveLength(1);
		expect(made.all[0].fileNames).toEqual(['全國賽.zip', '縣賽.zip']);
	});

	it('欄位裡打了字還沒送出：先送出那個欄位，存的檔有剛打的字', async () => {
		const pendingInput = fakePendingInput();
		const { editor, session, saves } = testEditor(audioFlow(), { pendingInput });
		pendingInput.pending = true;
		pendingInput.onflush = () => session.change(flowOf(renameFlow(session.flow!, '縣賽')));
		await editor.file.save();
		expect(read(saves[0]).flow.name).toBe('縣賽');
		expect(pendingInput.pending).toBe(false);
		expect(session.unsaved).toBe(false);
	});

	it('在存檔對話框按取消：還是沒存，不寫提示', async () => {
		const { editor, session } = testEditor(audioFlow(), { createSaver: savers('cancelled').create });
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		await editor.file.save();
		expect(session.unsaved).toBe(true);
		expect(session.notice).toBe('');
	});

	it('Safari、Firefox 下載新檔：算存好了，寫一行說明；檔名不能用的字照瀏覽器的規則換成「_」，提示的檔名跟存下來的一樣', async () => {
		const made = savers('downloaded');
		const { editor, session } = testEditor(newFlow('練習用'), { createSaver: made.create });
		session.change(flowOf(renameFlow(session.flow!, '縣賽: A/B?')));
		await editor.file.save();
		expect(session.unsaved).toBe(false);
		expect(made.all[0].fileNames).toEqual(['縣賽_ A_B_.zip']);
		expect(session.notice).toBe(
			'這個瀏覽器不能存回原檔，所以下載了一個新的「縣賽_ A_B_.zip」；用 Chrome 或 Edge 才能直接存回原檔。'
		);
	});

	it('iPad 交給分享選單：算存好了，不寫說明', async () => {
		const { editor, session } = testEditor(newFlow('練習用'), { createSaver: savers('shared').create });
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		await editor.file.save();
		expect(session.unsaved).toBe(false);
		expect(session.notice).toBe('');
	});

	it('存失敗：還是沒存，提示再試一次；再按一次存檔照樣存', async () => {
		let fail = true;
		const { saver, saves } = fakeSaver();
		const flaky = {
			save: (bytes: Uint8Array, name: string) => (fail ? Promise.reject(new Error('壞了')) : saver.save(bytes, name))
		};
		const { editor, session } = testEditor(audioFlow(), { createSaver: () => flaky });
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		await editor.file.save();
		expect(session.unsaved).toBe(true);
		expect(session.notice).toBe('存檔失敗，請再試一次');
		fail = false;
		await editor.file.save();
		expect(saves).toHaveLength(1);
		expect(session.unsaved).toBe(false);
	});
});

describe('流程檔：新建', () => {
	it('新建流程表單建好：換上它，不算沒存（沒改過就回到新建流程不用問）；還沒有隊員，右邊欄先開名單', () => {
		const { editor, session } = testEditor();
		const fresh = newFlow('全國賽');
		editor.file.create(fresh);
		expect(session.flow).toBe(fresh);
		expect(session.unsaved).toBe(false);
		expect(editor.inspectorTab).toBe('members');
		editor.file.startNew();
		expect(editor.file.asking).toBe(false);
		expect(session.flow).toBeNull();
	});

	it('開了有隊員的流程：右邊欄開動作', async () => {
		const { editor } = testEditor();
		editor.inspectorTab = 'members';
		await editor.file.open(zip(audioFlow()));
		expect(editor.inspectorTab).toBe('action');
	});
});

describe('流程檔：沒存先問', () => {
	it('沒有沒存的改動：編輯中開別的檔、回到新建流程都不問；開了別的檔，選到的動作清掉（另一支的 x1 是別的動作）', async () => {
		const { editor, session } = testEditor(audioFlow());
		session.selectAction('x1');
		await editor.file.open(zip(newFlow('另一支'), {}, '另一支.zip'));
		expect(editor.file.asking).toBe(false);
		expect(session.flow!.name).toBe('另一支');
		expect(session.selectedActionId).toBeNull();
		editor.file.startNew();
		expect(editor.file.asking).toBe(false);
		expect(session.flow).toBeNull();
	});

	it('有沒存的改動時開檔：先問；「取消」就留在原本的流程，「丟掉」才打開（復原紀錄清空）', async () => {
		const { editor, session } = testEditor(audioFlow());
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		const edited = session.flow;
		await editor.file.open(zip(newFlow('另一支')));
		expect(editor.file.asking).toBe(true);
		expect(session.flow).toBe(edited);
		await editor.file.answer('cancel');
		expect(editor.file.asking).toBe(false);
		expect(session.flow).toBe(edited);

		await editor.file.open(zip(newFlow('另一支')));
		await editor.file.answer('discard');
		expect(editor.file.asking).toBe(false);
		expect(session.flow!.name).toBe('另一支');
		expect(session.unsaved).toBe(false);
		expect(session.canUndo).toBe(false);
	});

	it('有沒存的改動時回到新建流程：先問；「丟掉」才回去', async () => {
		const { editor, session } = testEditor(audioFlow());
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		editor.file.startNew();
		expect(editor.file.asking).toBe(true);
		expect(session.flow!.name).toBe('全國賽');
		await editor.file.answer('discard');
		expect(session.flow).toBeNull();
	});

	it('按「開啟」：有沒存的改動先問「要開別的流程檔」，丟掉了才選檔，選到的檔不再問；又改了流程就要再問', async () => {
		const { editor, session } = testEditor(audioFlow());
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		let chose = 0;
		const choose = () => chose++;
		expect(editor.file.mayChoose(choose)).toBe(false);
		expect(editor.file.askingToOpen).toBe(true);
		await editor.file.answer('discard');
		expect(chose).toBe(1);
		// 選檔欄位再按一次：這次照常選
		expect(editor.file.mayChoose(choose)).toBe(true);
		session.change(flowOf(renameFlow(session.flow!, '縣賽')));
		expect(editor.file.mayChoose(choose)).toBe(false);
		await editor.file.answer('discard');
		await editor.file.open(zip(newFlow('另一支')));
		expect(editor.file.asking).toBe(false);
		expect(session.flow!.name).toBe('另一支');
	});

	it('「先存檔」：存好了才接著開檔', async () => {
		const { editor, session, saves } = testEditor(audioFlow());
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		await editor.file.open(zip(newFlow('另一支')));
		await editor.file.answer('save');
		expect(read(saves[0]).flow.name).toBe('全國賽');
		expect(editor.file.asking).toBe(false);
		expect(session.flow!.name).toBe('另一支');
	});

	it.each([
		['在存檔視窗按取消', async () => 'cancelled' as const],
		['存失敗', () => Promise.reject(new Error('壞了'))]
	])('「先存檔」但%s：停在原地，還在問', async (_, save) => {
		const { editor, session } = testEditor(audioFlow(), { createSaver: () => ({ save }) });
		session.change(flowOf(renameFlow(session.flow!, '全國賽')));
		editor.file.startNew();
		await editor.file.answer('save');
		expect(editor.file.asking).toBe(true);
		expect(session.flow!.name).toBe('全國賽');
		expect(session.unsaved).toBe(true);
	});
});

describe('流程檔：缺音樂、壞音樂', () => {
	const mp3 = () => new File([new Uint8Array([1, 2])], '主歌.mp3', { type: 'audio/mpeg' });

	it('開檔時有段找不到音樂：照開，提示寫出少了哪個檔；那段補好音樂，提示自己收掉', async () => {
		const { editor, session } = testEditor();
		await editor.file.open(zip(audioFlow()));
		expect(session.flow!.name).toBe('練習用');
		expect(session.notice).toBe('「練習用.zip」裡少了音樂檔「主歌.mp3」：點紅色的段重新選檔');
		await editor.music.pick('s1', mp3(), session.changeAsk());
		expect(session.notice).toBe('');
	});

	it('存檔時有段找不到音樂：照樣存，提示存出來的檔裡沒有那些音樂（跟下載的說明接在一起）；那段補好音樂，提示自己收掉', async () => {
		const made = savers('downloaded');
		const { editor, session } = testEditor(audioFlow(), { createSaver: made.create });
		await editor.file.save();
		expect(made.all[0].saves).toHaveLength(1);
		expect(session.notice).toBe(
			'這個瀏覽器不能存回原檔，所以下載了一個新的「練習用.zip」；用 Chrome 或 Edge 才能直接存回原檔。；' +
				'存好了，但有 1 段找不到音樂，存出來的檔裡沒有這些音樂：點紅色的段重新選檔，再存一次'
		);
		await editor.music.pick('s1', mp3(), session.changeAsk());
		expect(session.notice).toBe('');
	});

	it('缺音樂的段刪掉了（缺的都沒了）：提示也自己收掉', async () => {
		const { editor, session } = testEditor();
		await editor.file.open(zip(audioFlow()));
		session.change(flowOf(deleteSegment(session.flow!, 's1', { confirmed: true })));
		expect(session.notice).toBe('');
	});

	it('提示已經換成別的了：補好音樂也不動它', async () => {
		const { editor, session } = testEditor();
		await editor.file.open(zip(audioFlow()));
		session.notice = '已刪掉站位 2';
		await editor.music.pick('s1', mp3(), session.changeAsk());
		expect(session.notice).toBe('已刪掉站位 2');
	});

	it('音樂都在：存檔不提示，音樂照樣存進去', async () => {
		const { editor, session, saves } = testEditor();
		await editor.file.open(zip(audioFlow(), { a1: new Uint8Array([7, 7, 7]) }));
		expect(session.notice).toBe('');
		await editor.file.save();
		expect(session.notice).toBe('');
		expect(read(saves[0]).audio).toEqual({ a1: new Uint8Array([7, 7, 7]) });
	});

	it('開檔時有音樂檔這個瀏覽器解不開：照開，提示播放時會沒有聲音', async () => {
		const decode = () => Promise.reject(new Error('壞檔'));
		const { editor, session } = testEditor(null, { decode });
		await editor.file.open(zip(audioFlow(), { a1: new Uint8Array([1]) }));
		expect(session.flow!.name).toBe('練習用');
		expect(session.notice).toBe('有音樂檔這個瀏覽器讀不出來，播放時會沒有聲音');
	});
});

describe('流程檔：自動存草稿', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('改了停 1 秒就存；不到 1 秒又改就重算，只存最後的樣子', async () => {
		const { editor, session, drafts } = await connected();
		editor.file.create(newFlow('全國賽'));
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(500);
		expect(draftFlow(drafts.state.bytes).segments).toEqual([]);
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(500);
		expect(draftFlow(drafts.state.bytes).segments).toEqual([]);
		await vi.advanceTimersByTimeAsync(500);
		const flow = draftFlow(drafts.state.bytes);
		expect(flow.name).toBe('全國賽');
		expect(flow.segments.map((s) => s.kind)).toEqual(['chant', 'chant']);
	});

	it('剛建好的流程當下就存草稿（不等 1 秒，手機上被擋住也不會丟），不算沒存', async () => {
		const { editor, session, drafts } = await connected();
		editor.file.create(newFlow('全國賽'));
		await vi.advanceTimersByTimeAsync(0);
		expect(draftFlow(drafts.state.bytes).name).toBe('全國賽');
		expect(session.unsaved).toBe(false);
	});

	it('存成流程檔後草稿就丟掉；再改又存', async () => {
		const { editor, session, drafts } = await connected();
		editor.file.create(newFlow('全國賽'));
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).not.toBeNull();
		await editor.file.save();
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).toBeNull();
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(1000);
		expect(draftFlow(drafts.state.bytes).segments).toHaveLength(2);
	});

	it('開了流程檔（在檔案裡、沒改過）：草稿清掉，也不存；改了才存', async () => {
		const { editor, session, drafts } = await connected();
		editor.file.create(newFlow('全國賽'));
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).not.toBeNull();
		await editor.file.open(zip(audioFlow()));
		await vi.advanceTimersByTimeAsync(1000);
		expect(session.flow!.name).toBe('練習用');
		expect(drafts.state.bytes).toBeNull();
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(1000);
		expect(draftFlow(drafts.state.bytes).name).toBe('練習用');
	});

	it('記成功率（不算復原的一步）也存草稿', async () => {
		const { editor, session, drafts } = await connected();
		await editor.file.open(zip(recordedFlow()));
		const attempt = { date: '2026-11-05', who: 'g2', practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } };
		session.record(flowOf(recordAttempt(session.flow!, 'x1', attempt)));
		await vi.advanceTimersByTimeAsync(1000);
		expect(draftFlow(drafts.state.bytes).actions[0].successRate!.records).toHaveLength(4);
	});

	it('有改動時按新建、選「不存了，繼續」：草稿清掉', async () => {
		const { editor, session, drafts } = await connected();
		editor.file.create(newFlow('全國賽'));
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).not.toBeNull();
		editor.file.startNew();
		await editor.file.answer('discard');
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).toBeNull();
	});
});

describe('流程檔：打開時讀草稿', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('有草稿就問：寫出流程名和草稿是什麼時候存的', async () => {
		const { editor } = await connected(writeFlowFile(audioFlow(), {}), new Date(2026, 10, 5, 14, 3));
		expect(editor.file.draftOffer).toEqual({ text: '上次編的「練習用」還沒存，要救回嗎？（11/5 14:03 存的草稿）', error: '' });
	});

	it('舊版編輯器存的草稿沒有記時間：不寫時間', async () => {
		const bytes = writeFlowFile(audioFlow(), {});
		const draftStore = { ...fakeDraftStore().store, load: async () => ({ bytes, savedAt: null }) };
		const { editor } = testEditor(null, { draftStore });
		editor.file.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(editor.file.draftOffer?.text).toBe('上次編的「練習用」還沒存，要救回嗎？');
	});

	it('沒有草稿、讀不到草稿（私密視窗）、草稿打不開：都不問', async () => {
		expect((await connected()).editor.file.draftOffer).toBeNull();
		expect((await connected(new TextEncoder().encode('不是 zip'))).editor.file.draftOffer).toBeNull();
		const draftStore = { ...fakeDraftStore().store, load: () => Promise.reject(new Error('私密視窗')) };
		const { editor } = testEditor(null, { draftStore });
		editor.file.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(editor.file.draftOffer).toBeNull();
	});

	it('讀草稿比較慢、教練已經開始編了：不問；讀完了才開始自動存（在這之前不蓋掉草稿）', async () => {
		const drafts = fakeDraftStore(writeFlowFile(audioFlow(), {}));
		let loaded = () => {};
		const load = () => new Promise<void>((r) => (loaded = r)).then(() => drafts.store.load());
		const { editor, session } = testEditor(null, { draftStore: { ...drafts.store, load } });
		editor.file.connect();
		editor.file.create(newFlow('全國賽'));
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(1000);
		expect(read(drafts.state.bytes!).flow.name).toBe('練習用');
		loaded();
		await vi.advanceTimersByTimeAsync(0);
		expect(editor.file.draftOffer).toBeNull();
		await vi.advanceTimersByTimeAsync(1000);
		expect(read(drafts.state.bytes!).flow.name).toBe('全國賽');
	});

	it('按「救回」：換上草稿的流程（含音樂），還算沒存，不再問；少了音樂時提示寫「草稿」', async () => {
		const { editor, session } = await connected(writeFlowFile(audioFlow(), { a1: new Uint8Array([1]) }));
		await editor.file.restoreDraft();
		expect(editor.file.draftOffer).toBeNull();
		expect(session.flow!.name).toBe('練習用');
		expect(session.unsaved).toBe(true);
		expect(editor.music.missingSegmentIds).toEqual([]);
		const missing = await connected(writeFlowFile(audioFlow(), {}));
		await missing.editor.file.restoreDraft();
		expect(missing.session.notice).toBe('「草稿」裡少了音樂檔「主歌.mp3」：點紅色的段重新選檔');
	});

	it('救回草稿時清空復原紀錄；復原後草稿照常存（存的是復原後的流程，音樂還在）', async () => {
		const { editor, session, drafts } = await connected(writeFlowFile(audioFlow(), { a1: new Uint8Array([7, 7]) }));
		await editor.file.restoreDraft();
		expect(session.canUndo).toBe(false);
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(1000);
		expect(draftFlow(drafts.state.bytes).segments).toHaveLength(2);
		session.undo();
		await vi.advanceTimersByTimeAsync(1000);
		const r = read(drafts.state.bytes!);
		expect(r.flow.segments.map((s) => s.kind)).toEqual(['music']);
		expect(r.audio).toEqual({ a1: new Uint8Array([7, 7]) });
	});

	it('按「丟掉」（沒有別的分頁）：草稿刪掉，不再問', async () => {
		const { editor, drafts } = await connected(writeFlowFile(audioFlow(), {}));
		await editor.file.discardDraft();
		expect(editor.file.draftOffer).toBeNull();
		expect(drafts.state.bytes).toBeNull();
	});
});

describe('流程檔：兩個分頁（草稿只有一份）', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	/** 同一台電腦再開一個分頁：草稿、分頁頻道跟別的分頁共用。頁面打開了，讀過草稿。 */
	async function openTab(drafts: ReturnType<typeof fakeDraftStore>, openTabChannel: OpenTabChannel) {
		const t = testEditor(null, { draftStore: drafts.store, openTabChannel });
		const close = t.editor.file.connect();
		await vi.advanceTimersByTimeAsync(0);
		return { ...t, close };
	}

	it('另一個分頁正在編這份草稿：「丟掉」不刪，提示說它正在被編', async () => {
		const drafts = fakeDraftStore();
		const tabs = fakeTabs();
		const first = await openTab(drafts, tabs);
		first.editor.file.create(newFlow('全國賽'));
		const second = await openTab(drafts, tabs);
		const saved = drafts.state.bytes;
		expect(second.editor.file.draftOffer?.text).toContain('全國賽');
		await second.editor.file.discardDraft();
		expect(second.editor.file.draftOffer?.error).toBe('另一個分頁正在編輯這份草稿，所以沒有丟掉。');
		expect(drafts.state.bytes).toBe(saved);
	});

	it('另一個分頁開著存好的流程檔（草稿不是它的）：不回答；等 300 毫秒沒人回答，就丟掉', async () => {
		const drafts = fakeDraftStore();
		const tabs = fakeTabs();
		const first = await openTab(drafts, tabs);
		first.editor.file.create(newFlow('全國賽'));
		await first.editor.file.save();
		await vi.advanceTimersByTimeAsync(1000);
		// 第三個分頁留下的草稿
		drafts.state.bytes = writeFlowFile(audioFlow(), {});
		const second = await openTab(drafts, tabs);
		const discarding = second.editor.file.discardDraft();
		await vi.advanceTimersByTimeAsync(299);
		expect(drafts.state.bytes).not.toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		await discarding;
		expect(second.editor.file.draftOffer).toBeNull();
		expect(drafts.state.bytes).toBeNull();
	});

	it('正在編的分頁關掉了：不回答，草稿丟得掉', async () => {
		const drafts = fakeDraftStore();
		const tabs = fakeTabs();
		const first = await openTab(drafts, tabs);
		first.editor.file.create(newFlow('全國賽'));
		first.close();
		const second = await openTab(drafts, tabs);
		const discarding = second.editor.file.discardDraft();
		await vi.advanceTimersByTimeAsync(300);
		await discarding;
		expect(drafts.state.bytes).toBeNull();
	});
});

describe('流程檔：「視窗太窄」提示上的「回首頁」', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('有改動：跟「新建」一樣先問；「取消」留著，「丟掉」才回首頁，草稿跟著丟掉、首頁不問要不要救回', async () => {
		const { editor, session, drafts } = await connected();
		await editor.file.open(zip(audioFlow(), { a1: new Uint8Array([7, 7]) }));
		session.change(addChant(session.flow!));
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).not.toBeNull();
		await editor.file.leaveToHome();
		expect(editor.file.asking).toBe(true);
		expect(editor.file.askingToOpen).toBe(false);
		await editor.file.answer('cancel');
		expect(session.flow!.segments.map((s) => s.kind)).toEqual(['music', 'chant']);

		await editor.file.leaveToHome();
		await editor.file.answer('discard');
		expect(session.flow).toBeNull();
		expect(editor.file.draftOffer).toBeNull();
		expect(drafts.state.bytes).toBeNull();
	});

	it('剛建好、沒改過的流程：不問，回到首頁，留在草稿裡問要不要救回（寫現在的時間）', async () => {
		const { editor, session } = await connected();
		editor.file.create(newFlow('全國賽'));
		vi.setSystemTime(new Date(2026, 10, 5, 14, 3));
		await editor.file.leaveToHome();
		expect(editor.file.asking).toBe(false);
		expect(session.flow).toBeNull();
		expect(editor.file.draftOffer?.text).toBe('上次編的「全國賽」還沒存，要救回嗎？（11/5 14:03 存的草稿）');
		await editor.file.restoreDraft();
		expect(session.flow!.name).toBe('全國賽');
	});

	it('剛開、沒改過的流程檔：直接回首頁，不問、不留草稿', async () => {
		const { editor, session, drafts } = await connected();
		await editor.file.open(zip(audioFlow()));
		await editor.file.leaveToHome();
		await vi.advanceTimersByTimeAsync(1000);
		expect(session.flow).toBeNull();
		expect(editor.file.draftOffer).toBeNull();
		expect(drafts.state.bytes).toBeNull();
	});
});
