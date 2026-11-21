// 讀寫流程檔：zip 位元組 ↔ 流程 ＋ 音樂資料。格式見 docs/flow-file-format.md。
// zip 裡是 flow.json（{ formatVersion, flow }）和 flow.audio 列出的音樂檔（audio/a1.mp3 …）。

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { ACTION_CATEGORIES, actionWhy, type Action } from './action-types';
import { bookmarkSeconds } from './bookmarks';
import { CUE_KINDS, cueProblem } from './cues';
import { newId } from './ids';
import type { Flow } from './flow';
import { GENDERS, GLOBAL_ROLES } from './members';
import { settle } from './settle';
import { said, type Said, type Why } from './why';
import { PHASE_KINDS, V10_PHASE_KINDS } from './phase-types';
import { fileLengthProblem } from './segment';
import { phasesOverlap } from './beat-range';
import { fitPhaseKinds, perPerson, PRACTICE_KINDS, squadsOf, successRateProblem, v10RateProblem, v6RateProblem } from './success-rate';

/** 這個編輯器寫出的流程檔版本。改了流程檔格式就加 1，並在 UPGRADES 補一步。 */
export const FORMAT_VERSION = 16;

/** 流程檔裡那份 JSON 的檔名。 */
const JSON_FILE = 'flow.json';

/** flow.json 的內容。舊版的 flow 長什麼樣只有升級那一步知道，所以是 unknown。 */
export interface FlowDocument {
	formatVersion: number;
	flow: unknown;
}

/** 把第 n 版的 flow.json 升成第 n + 1 版。 */
export type Upgrade = (doc: FlowDocument) => FlowDocument;

/**
 * 升級鏈：key 是「從第幾版升上來」。開舊版檔時一步一步升到 FORMAT_VERSION。
 * 第 2 版：站位多了可有可無的 walks（出發和到達），沒有就是全部用預設，所以資料不用動。
 * 第 3 版：動作多了可有可無的 cues（拍點），沒有就是沒有拍點，所以資料不用動。
 * 第 4 版：動作多了可有可無的 color（辨識色），沒有就是用大類的顏色；站位多了可有可無的 name（站位名稱），
 *   沒有就是只顯示號碼。所以資料不用動。
 * 第 5 版：流程多了可有可無的 markers（標記用號碼還是開頭字），沒有就是號碼，所以資料不用動。
 * 第 6 版：動作多了可有可無的 successRate（記成功率的設定），沒有就是沒打開；動作裡的人多了可有可無的 squad（第幾組），
 *   沒有就是沒分組；流程多了可有可無的 lastIds（不重用的 id 發到第幾號）。所以資料不用動。
 * 第 7 版：記成功率的動作至少有一個環節、音樂段的環節一定有拍、組號從 1 連續。升級時整理環節和組（見 tidySuccessRate）。
 * 第 8 版：人身上的組從第幾組（數字）換成組 id（g1、g2…，字串），分組動作的紀錄的「誰」也換成組 id；組號照 id 發出的先後算，
 *   不存。升級時每個動作的組照號碼順序發組 id（見 squadIds）。
 * 第 9 版：還沒有環節的動作（騰翻、跳躍除外）也可以有組（從別的動作複製人帶來的，加第一個環節時照用）。資料不用動；
 *   第 8 版以前沒有環節的動作有組就是壞掉的檔，升級時交給 isFlow 擋下來（見 squadsWithoutPhases）。
 * 第 10 版：一次多了可有可無的 blanks（整個做、中途 ✗ 時，那時就有、✗ 後面空著的環節），沒有就是沒有空著的，所以資料不用動。
 * 第 11 版：環節的種類拿掉整體，多了拋法、翻法、跳法，每個大類只能用自己的種類（見 phaseKindsFor）。升級時照大類換種類
 *   （見 fitPhaseKinds）：拋投都換成拋法、騰翻都換成翻法、跳躍都換成跳法，技巧、金字塔的整體換成中段；名字、id、紀錄照留。
 *   舞蹈、其他的環節和紀錄拿掉，不記成功率，組也拿掉。
 * 第 12 版：多了固定的任務角色「三層」（舊版編輯器不認得）。升級時拿掉叫「三層」的自訂任務角色（見 fixedThird）；
 *   動作裡的人、拍點存的是名稱，照留，變成固定的三層。
 * 第 13 版：多了固定的任務角色「肩底」（舊版編輯器不認得）。升級時拿掉叫「肩底」的自訂任務角色（見 fixedShoulderBase）；
 *   動作裡的人、拍點存的是名稱，照留，變成固定的肩底。
 * 第 14 版：金字塔的環節可以佔同樣的拍（舊版編輯器會說成資料壞掉）。舊檔沒有佔同樣拍的環節，所以資料不用動；
 *   有就是壞掉的檔，升級時交給 isFlow 擋下來（見 phasesShareBeatsBefore14）。
 * 第 15 版：新的 id 是種類字母加 12 個字的亂數（ADR 0014），不再記 lastIds（升級時拿掉）；舊的 id 不用改。
 *   全上的一次多了可有可無的 runThroughStartedAt（開的時間），動作多了可有可無的 squadOrder（新寫法的組 id 發出的先後）。
 * 第 16 版：流程多了可有可無的 bookmarks（書籤），沒有就是沒有書籤，所以資料不用動。
 */
const UPGRADES: Record<number, Upgrade> = {
	1: (doc) => ({ formatVersion: 2, flow: doc.flow }),
	2: (doc) => ({ formatVersion: 3, flow: doc.flow }),
	3: (doc) => ({ formatVersion: 4, flow: doc.flow }),
	4: (doc) => ({ formatVersion: 5, flow: doc.flow }),
	5: (doc) => ({ formatVersion: 6, flow: doc.flow }),
	6: (doc) => ({ formatVersion: 7, flow: tidySuccessRate(doc.flow) }),
	7: (doc) => ({ formatVersion: 8, flow: squadIds(doc.flow) }),
	8: (doc) => ({ formatVersion: 9, flow: squadsWithoutPhases(doc.flow) ? null : doc.flow }),
	9: (doc) => ({ formatVersion: 10, flow: doc.flow }),
	10: (doc) => ({ formatVersion: 11, flow: fitKinds(doc.flow) }),
	11: (doc) => ({ formatVersion: 12, flow: fixedThird(doc.flow) }),
	12: (doc) => ({ formatVersion: 13, flow: fixedShoulderBase(doc.flow) }),
	13: (doc) => ({ formatVersion: 14, flow: phasesShareBeatsBefore14(doc.flow) ? null : doc.flow }),
	14: (doc) => ({ formatVersion: 15, flow: withoutLastIds(doc.flow) }),
	15: (doc) => ({ formatVersion: 16, flow: doc.flow })
};

/** 第 14 → 15 版：拿掉「已經發到第幾號」（lastIds）。新的 id 是亂數，不會撞到舊的 x1 這種 id。 */
function withoutLastIds(v: unknown): unknown {
	if (!isObject(v) || !('lastIds' in v)) return v;
	const { lastIds: _, ...flow } = v;
	return flow;
}

/** 有沒有動作的環節佔同樣的拍（第 13 版以前哪個大類都不行，第 14 版起金字塔才可以）。 */
function phasesShareBeatsBefore14(v: unknown): boolean {
	return flowShape(v) && (v as Flow).actions.some((a) => a.successRate && phasesOverlap(a.successRate.phases));
}

/** 第 12 → 13 版：拿掉叫「肩底」的自訂任務角色，換成固定的肩底。 */
function fixedShoulderBase(v: unknown): unknown {
	if (!flowShape(v)) return v;
	const flow = v as Flow;
	return { ...flow, customRoles: flow.customRoles.filter((r) => r.name !== '肩底') };
}

/** 第 11 → 12 版：拿掉叫「三層」的自訂任務角色，換成固定的三層。 */
function fixedThird(v: unknown): unknown {
	if (!flowShape(v)) return v;
	const flow = v as Flow;
	return { ...flow, customRoles: flow.customRoles.filter((r) => r.name !== '三層') };
}

/**
 * 第 10 → 11 版：每個動作的環節種類換成大類能用的（見 fitPhaseKinds）。本來就不守第 10 版規則的動作不換（交給 isFlow 擋下來），
 * 免得舞蹈、其他壞掉的環節和紀錄被拿掉，看起來像好的檔。
 */
function fitKinds(v: unknown): unknown {
	if (!flowShape(v)) return v;
	const flow = v as Flow;
	const actions = flow.actions.map((a) => {
		const segment = flow.segments.find((s) => s.id === a.segmentId);
		return segment && v10RateProblem(segment, a) === null ? fitPhaseKinds(a) : a;
	});
	return { ...flow, actions };
}

/** 有沒有動作沒打開記成功率卻有組（第 8 版以前不行）。 */
function squadsWithoutPhases(v: unknown): boolean {
	return flowShape(v) && (v as Flow).actions.some((a) => !a.successRate && a.members.some((m) => m.squad !== undefined));
}

/**
 * 第 6 → 7 版：每個記成功率的動作走收尾（改之前、改之後都是它自己）：音樂段沒標拍的環節拿掉，連它們的記號
 * （記號清光的那一次整筆拿掉）；一個環節都不剩的動作不記成功率，人身上的組也拿掉；跳號的組補成 1、2、3，紀錄跟著換號。
 * 口號段的環節不動。本來就不守第 6 版規則的檔不整理（交給 isFlow 擋下來），免得把壞掉的地方補成看起來對的。
 */
function tidySuccessRate(v: unknown): unknown {
	if (!flowShape(v)) return v;
	const flow = v as Flow;
	const actions = flow.actions.map((a) => {
		const segment = flow.segments.find((s) => s.id === a.segmentId);
		// 收尾認的是組 id：先照號碼排出暫時的組 id，收完再照組號換回數字。號碼不是正整數的不整理。
		const numbers = squadNumbers(a);
		if (!a.successRate || !segment || !numbers) return a;
		const ids = renameSquads(a, (n) => `g${numbers.indexOf(n as number) + 1}`);
		if (v6RateProblem(segment, ids) !== null) return a;
		const settled = settle(flow, ids, ids, { records: 'keep' });
		if (settled.kind !== 'ok') return a;
		const squads = squadsOf(settled.action);
		return renameSquads(settled.action, (id) => squads.indexOf(id as string) + 1);
	});
	return { ...flow, actions };
}

/**
 * 第 7 → 8 版：每個動作的組照號碼順序發組 id（g1、g2…，照動作的順序一直往下發），分組動作的紀錄的「誰」跟著換成那一組的 id；
 * 組號不是 1、2、3 連續的動作不換（數字留著，交給 isFlow 擋下來）。（第 14 版以前還在流程的 lastIds 記上 g，第 15 版不記了。）
 */
function squadIds(v: unknown): unknown {
	if (!flowShape(v)) return v;
	const flow = v as Flow;
	let last = 0;
	const actions = flow.actions.map((a) => {
		const numbers = squadNumbers(a);
		if (!numbers?.length || numbers.some((n, i) => n !== i + 1)) return a;
		const base = last;
		last += numbers.length;
		return renameSquads(a, (n) => `g${base + (n as number)}`);
	});
	return { ...flow, actions };
}

/** 舊版檔（第 7 版以前）動作裡的組號，由小到大不重複；有不是正整數的組號是 null。 */
function squadNumbers(action: Action): number[] | null {
	const numbers = action.members.flatMap((m) => (m.squad === undefined ? [] : [m.squad as unknown]));
	if (numbers.some((n) => !Number.isInteger(n) || (n as number) < 1)) return null;
	return [...new Set(numbers as number[])].sort((a, b) => a - b);
}

/** 換掉動作裡的組：人身上的組，和分組動作的紀錄的「誰」（騰翻、跳躍的「誰」是隊員，不動）。舊版的組是數字，所以兩種都收。 */
function renameSquads(action: Action, rename: (squad: string | number) => string | number): Action {
	const to = (squad: string) => rename(squad) as string;
	const members = action.members.map((m) => (m.squad === undefined ? m : { ...m, squad: to(m.squad) }));
	const rate = action.successRate;
	if (!rate || perPerson(action.category)) return { ...action, members };
	const records = rate.records.map((r) => ({ ...r, who: to(r.who) }));
	return { ...action, members, successRate: { ...rate, records } };
}

/** 音樂檔的位元組，用 flow.audio 的 id 對應。 */
export type AudioBytes = Record<string, Uint8Array>;

export type ReadFlowFileResult =
	/**
	 * missingSegmentIds：音樂檔不在 zip 裡的音樂段（照開，畫面標紅）。
	 * droppedBookmarks：放不下、開檔時拿掉的書籤名字（手改過的檔才會有，畫面說出來）。
	 */
	| { kind: 'ok'; flow: Flow; audio: AudioBytes; missingSegmentIds: string[]; droppedBookmarks: string[] }
	/** 打不開：message 是給教練看的原因，多帶 why（見 why.ts）。 */
	| ({ kind: 'error' } & Said);

// 打不開的原因（頁面前面加上檔名）。
const NOT_A_ZIP = said({ code: 'flow_file_not_a_zip' });
// 不提 flow.json：教練不知道那是什麼。
const NO_JSON = said({ code: 'flow_file_no_json' });
const BROKEN = said({ code: 'flow_file_broken' });
const IMAGE = said({ code: 'flow_file_image' });

/** 檔頭是常見的圖片（PNG、JPEG、GIF、WebP、iPhone 的 HEIC）：選錯成照片時直說。 */
function isImage(bytes: Uint8Array): boolean {
	const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
	return (
		(bytes[0] === 0x89 && text(1, 4) === 'PNG') ||
		(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
		text(0, 4) === 'GIF8' ||
		(text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') ||
		(text(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'avif'].includes(text(8, 12)))
	);
}

/** 流程 ＋ 音樂資料 → 流程檔（zip 位元組）。沒給位元組的音樂檔就不放（開的時候算缺音樂）。 */
export function writeFlowFile(flow: Flow, audio: AudioBytes): Uint8Array {
	const doc: FlowDocument = { formatVersion: FORMAT_VERSION, flow };
	const files: Zippable = { [JSON_FILE]: strToU8(JSON.stringify(doc)) };
	for (const ref of flow.audio) {
		// mp3、m4a 本來就壓縮過，不再壓。
		if (audio[ref.id]) files[ref.file] = [audio[ref.id], { level: 0 }];
	}
	return zipSync(files);
}

/**
 * 流程檔（zip 位元組）→ 流程 ＋ 音樂資料。舊版自動升級，比編輯器新的不打開（見 checkFlowDocument）。
 * flow.json 不在最上層、而在唯一一層資料夾裡（電腦重新壓縮過）也打得開，音樂檔照那個資料夾找。
 * upgrades 只有測試會換。
 */
export function readFlowFile(
	bytes: Uint8Array,
	upgrades: Record<number, Upgrade> = UPGRADES
): ReadFlowFileResult {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch {
		return { kind: 'error', ...(isImage(bytes) ? IMAGE : NOT_A_ZIP) };
	}
	const folder = folderOf(files);
	if (folder === null) return { kind: 'error', ...NO_JSON };
	let doc: unknown;
	try {
		doc = JSON.parse(strFromU8(files[folder + JSON_FILE]));
	} catch {
		return { kind: 'error', ...BROKEN };
	}
	const checked = checkDocument(doc, upgrades, true);
	if (checked.kind === 'error') return checked;
	const { flow, dropped } = checked;
	const audio: AudioBytes = {};
	for (const ref of flow.audio) if (files[folder + ref.file]) audio[ref.id] = files[folder + ref.file];
	return { kind: 'ok', flow, audio, missingSegmentIds: segmentsMissingAudio(flow, Object.keys(audio)), droppedBookmarks: dropped };
}

export type CheckFlowDocumentResult = { kind: 'ok'; flow: Flow } | ({ kind: 'error' } & Said);

/**
 * 檢查一整支流程：flow.json 的內容（JSON.parse 過的）→ 現在這一版的流程。讀流程檔和傳上雲端（伺服器）共用。
 * 舊版一步一步升級；比編輯器新的不收；型別、參照、拍點、成功率設定不對算壞掉；段太長寫出上限（見 segmentLengthProblem）。
 * upgrades 只有測試會換。
 */
export function checkFlowDocument(
	doc: unknown,
	upgrades: Record<number, Upgrade> = UPGRADES
): CheckFlowDocumentResult {
	const checked = checkDocument(doc, upgrades, false);
	return checked.kind === 'ok' ? { kind: 'ok', flow: checked.flow } : checked;
}

/**
 * checkFlowDocument；fix：開檔（readFlowFile）時先修手改過的書籤（見 fixBookmarks），dropped 是拿掉的書籤名字。
 * 傳上雲端不修，照樣擋：雲端的流程都是編輯器開過、改過的，不會有這種書籤。
 */
function checkDocument(
	doc: unknown,
	upgrades: Record<number, Upgrade>,
	fix: boolean
): { kind: 'ok'; flow: Flow; dropped: string[] } | ({ kind: 'error' } & Said) {
	if (!isDocument(doc)) return { kind: 'error', ...BROKEN };
	if (doc.formatVersion > FORMAT_VERSION) {
		return { kind: 'error', ...said({ code: 'flow_file_newer' }) };
	}
	let current = doc;
	while (current.formatVersion < FORMAT_VERSION) {
		const upgrade = upgrades[current.formatVersion];
		if (!upgrade) return { kind: 'error', ...BROKEN };
		current = upgrade(current);
	}
	const { flow, dropped } = fix && flowShape(current.flow) ? fixBookmarks(current.flow as Flow) : { flow: current.flow, dropped: [] };
	if (!isFlow(flow)) return { kind: 'error', ...BROKEN };
	const tooLong = segmentLengthProblem(flow);
	if (tooLong) return { kind: 'error', ...said(tooLong) };
	return { kind: 'ok', flow, dropped };
}

/**
 * 手改過的檔才會有的書籤（改段的指令跑完都會拿掉放不下的書籤，正常存不出來）：
 * 放不下的（段不在、在段外、B 不在 A 後面）拿掉，回它們的名字；id 重複的，後面那個換一個新的。
 * 不修的話整支流程打不開，或書籤看不到、下一個指令就被悄悄拿掉。
 */
function fixBookmarks(flow: Flow): { flow: Flow; dropped: string[] } {
	if (!flow.bookmarks) return { flow, dropped: [] };
	const fits = flow.bookmarks.filter((b) => bookmarkSeconds(flow, b));
	const used = new Set<string>();
	const bookmarks = fits.map((b) => {
		const id = used.has(b.id) ? newId('k', [...fits.map((x) => x.id), ...used]) : b.id;
		used.add(id);
		return id === b.id ? b : { ...b, id };
	});
	const dropped = flow.bookmarks.filter((b) => !fits.includes(b)).map((b) => b.name);
	return { flow: { ...flow, bookmarks }, dropped };
}

/**
 * 段的長度超出編輯器能設的範圍（跟改段一樣的上限，不是正的也算）：
 * 照樣打開會把分頁卡住，所以擋下來，寫出上限。沒問題是 null。
 */
export function segmentLengthProblem(flow: Flow): Why | null {
	for (const s of flow.segments) {
		const problem = fileLengthProblem(s);
		if (problem) return problem;
	}
	return null;
}

/**
 * flow.json 在哪個資料夾：最上層是 ''；不在最上層時，找唯一一層資料夾裡的（Mac 壓縮時多放的 __MACOSX 不算）。
 * 都沒有是 null。
 */
function folderOf(files: Record<string, Uint8Array>): string | null {
	if (files[JSON_FILE]) return '';
	const found = Object.keys(files)
		.filter((k) => !k.startsWith('__MACOSX/'))
		.map((k) => k.split('/'))
		.filter((parts) => parts.length === 2 && parts[0] !== '' && parts[1] === JSON_FILE)
		.map(([folder]) => `${folder}/`);
	return found.length === 1 ? found[0] : null;
}

function isDocument(doc: unknown): doc is FlowDocument {
	return isObject(doc) && Number.isInteger(doc.formatVersion) && isObject(doc.flow);
}

/** 檢查一個值長得對不對。 */
type Check = (v: unknown) => boolean;
const str: Check = (v) => typeof v === 'string';
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const int: Check = (v) => Number.isInteger(v);
const bool: Check = (v) => typeof v === 'boolean';
const oneOf = (keys: readonly unknown[]): Check => (v) => keys.includes(v);
const nullOr = (c: Check): Check => (v) => v === null || c(v);
const listOf = (c: Check): Check => (v) => Array.isArray(v) && v.every(c);
const shape = (fields: Record<string, Check>): Check => (v) =>
	isObject(v) && Object.entries(fields).every(([k, c]) => c(v[k]));
const position: Check = (v) => Array.isArray(v) && v.length === 2 && v.every(num);
const timePosition = shape({ segmentId: str, at: (v) => int(v) && (v as number) >= 0 });
// 書籤的格子在段外（負的也算）不算資料壞掉：開檔時拿掉那一個（fixBookmarks），傳上雲端照樣擋（structureProblem）
const bookmarkPosition = shape({ segmentId: str, at: int });
const walks: Check = (v) =>
	v === undefined ||
	(isObject(v) && Object.values(v).every(shape({ depart: timePosition, arrive: timePosition })));

const who: Check = (v) => v === null || shape({ role: str })(v) || shape({ member: str })(v);
const cues: Check = (v) =>
	v === undefined ||
	listOf(shape({ kind: oneOf(CUE_KINDS), at: int, len: int, word: str, who }))(v);

const color: Check = (v) => v === undefined || (str(v) && /^#[0-9a-f]{6}$/i.test(v as string));

const phase = shape({
	id: str,
	// 舊版的整體也收（升級時換掉）；種類對不對得上大類由 successRateProblem 看。
	kind: oneOf([...PHASE_KINDS.map((k) => k.key), ...V10_PHASE_KINDS]),
	name: str,
	color,
	beats: (v) => v === undefined || shape({ at: int, len: int })(v)
});
const attempt = shape({
	id: str,
	date: str,
	who: (v) => int(v) || str(v),
	practice: oneOf(PRACTICE_KINDS),
	runThroughId: (v) => v === undefined || str(v),
	runThroughStartedAt: (v) => v === undefined || int(v),
	whole: bool,
	marks: isObject,
	blanks: (v) => v === undefined || listOf(str)(v)
});
const successRate: Check = (v) =>
	v === undefined || shape({ phases: listOf(phase), records: listOf(attempt) })(v);

const flowShape = shape({
	name: str,
	field: shape({ strips: int, layout: oneOf(['vertical', 'horizontal']) }),
	timeRules: shape({ on: bool, minChantSec: num, maxMusicSec: num, maxTotalSec: num }),
	members: listOf(
		shape({
			id: str,
			name: str,
			gender: oneOf(GENDERS.map((g) => g.key)),
			globalRole: oneOf(GLOBAL_ROLES.map((r) => r.key))
		})
	),
	audio: listOf(shape({ id: str, file: str, name: str })),
	segments: listOf(
		(v) =>
			shape({ id: str, kind: oneOf(['music']), audioId: nullOr(str), bpm: num, firstBeatSec: num, halfBeats: int })(v) ||
			shape({ id: str, kind: oneOf(['chant']), tenths: int })(v)
	),
	formations: listOf(
		shape({
			id: str,
			segmentId: nullOr(str),
			at: int,
			pos: (v) => isObject(v) && Object.values(v).every(position),
			walks,
			name: (v) => v === undefined || str(v)
		})
	),
	customRoles: listOf(shape({ id: str, name: str, meaning: str })),
	markers: (v) => v === undefined || oneOf(['number', 'initial'])(v),
	bookmarks: (v) => v === undefined || listOf(shape({ id: str, name: str, a: bookmarkPosition, b: nullOr(bookmarkPosition) }))(v),
	actions: listOf(
		shape({
			id: str,
			segmentId: str,
			category: oneOf(ACTION_CATEGORIES.map((c) => c.key)),
			name: str,
			start: int,
			length: int,
			note: str,
			// 組：第 8 版是組 id（字串，見 successRateProblem）；舊版是第幾組（數字），升級時換掉。
			members: listOf(shape({ memberId: str, role: nullOr(str), squad: (v) => v === undefined || int(v) || str(v) })),
			color,
			cues,
			successRate,
			squadOrder: (v) => v === undefined || listOf(str)(v)
		})
	)
});

/** 每個欄位的型別都對、指到的段／音樂檔／隊員都在、拍點和成功率設定守規則（成功率規則見 successRateProblem），而且有開頭那張站位（它沒有走位）。 */
function isFlow(v: unknown): v is Flow {
	return structureProblem(v) === null;
}

/**
 * isFlow 哪裡不對（給教練看的原因）；沒問題是 null。讀流程檔一律說壞掉了，整份流程檢查（flow-check）用這裡的原因。
 * 資料本身壞掉（格式、指到不存在的東西）是 flow_file_ 的代號；拍點、成功率規則擋的包成代號（動作「X」：原因）。
 */
export function structureProblem(v: unknown): Why | null {
	if (!flowShape(v)) return { code: 'flow_file_shape' };
	const flow = v as Flow;
	const segmentIds = new Set(flow.segments.map((s) => s.id));
	const audioIds = new Set(flow.audio.map((a) => a.id));
	const memberIds = new Set(flow.members.map((m) => m.id));
	if (flow.formations.length === 0) return { code: 'flow_file_no_first_formation' };
	if (flow.segments.some((s) => s.kind === 'music' && s.audioId !== null && !audioIds.has(s.audioId))) {
		return { code: 'flow_file_segment_audio' };
	}
	if (flow.formations.some((f) => f.segmentId !== null && !segmentIds.has(f.segmentId))) return { code: 'flow_file_formation_segment' };
	if (flow.formations[0].walks !== undefined) return { code: 'flow_file_first_walks' };
	const badWalk = flow.formations.some((f) =>
		Object.entries(f.walks ?? {}).some(
			([id, w]) => !memberIds.has(id) || !segmentIds.has(w.depart.segmentId) || !segmentIds.has(w.arrive.segmentId)
		)
	);
	if (badWalk) return { code: 'flow_file_walk_refs' };
	if (flow.actions.some((a) => !segmentIds.has(a.segmentId))) return { code: 'flow_file_action_segment' };
	if (flow.bookmarks?.some((b) => !segmentIds.has(b.a.segmentId) || (b.b && !segmentIds.has(b.b.segmentId)))) {
		return { code: 'flow_file_bookmark_segment' };
	}
	const bookmarkIds = (flow.bookmarks ?? []).map((b) => b.id);
	if (new Set(bookmarkIds).size !== bookmarkIds.length) return { code: 'flow_file_bookmark_ids' };
	const lost = flow.bookmarks?.find((b) => !bookmarkSeconds(flow, b));
	if (lost) return { code: 'flow_file_bookmark_lost', name: lost.name };
	if (flow.actions.some((a) => a.members.some((m) => !memberIds.has(m.memberId)))) return { code: 'flow_file_action_member' };
	for (const a of flow.actions) {
		const segment = flow.segments.find((s) => s.id === a.segmentId)!;
		const problem =
			(a.cues ?? []).map((c) => cueProblem(segment, a, c)).find((p) => p !== null) ?? successRateProblem(segment, a);
		if (problem) return { code: 'flow_check_in_action', action: actionWhy(a), reason: problem };
	}
	return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 有指到音樂檔、但那個檔的位元組不在手上的音樂段（畫面標紅「找不到音樂」）。 */
export function segmentsMissingAudio(flow: Flow, loadedAudioIds: string[]): string[] {
	const loaded = new Set(loadedAudioIds);
	return flow.segments
		.filter((s) => s.kind === 'music' && s.audioId !== null && !loaded.has(s.audioId))
		.map((s) => s.id);
}

/** 這些段（通常是 segmentsMissingAudio 給的）用到的音樂檔名，照音樂檔的順序，同一個檔只寫一次。 */
export function missingAudioNames(flow: Flow, segmentIds: string[]): string[] {
	const ids = new Set(flow.segments.flatMap((s) => (s.kind === 'music' && segmentIds.includes(s.id) ? [s.audioId] : [])));
	return flow.audio.filter((a) => ids.has(a.id)).map((a) => a.name);
}
