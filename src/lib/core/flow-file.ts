// 讀寫流程檔：zip 位元組 ↔ 流程 ＋ 音樂資料。格式見 docs/flow-file-format.md。
// zip 裡是 flow.json（{ formatVersion, flow }）和 flow.audio 列出的音樂檔（audio/a1.mp3 …）。

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { ACTION_CATEGORIES } from './actions';
import { CUE_KINDS, cueProblem } from './cues';
import type { Flow } from './flow';
import { GENDERS, GLOBAL_ROLES } from './members';

/** 這個編輯器寫出的流程檔版本。改了流程檔格式就加 1，並在 UPGRADES 補一步。 */
export const FORMAT_VERSION = 4;

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
 * 第 4 版：動作多了可有可無的 color（辨識色），沒有就是用大類的顏色，所以資料不用動。
 */
const UPGRADES: Record<number, Upgrade> = {
	1: (doc) => ({ formatVersion: 2, flow: doc.flow }),
	2: (doc) => ({ formatVersion: 3, flow: doc.flow }),
	3: (doc) => ({ formatVersion: 4, flow: doc.flow })
};

/** 音樂檔的位元組，用 flow.audio 的 id 對應。 */
export type AudioBytes = Record<string, Uint8Array>;

export type ReadFlowFileResult =
	/** missingSegmentIds：音樂檔不在 zip 裡的音樂段（照開，畫面標紅）。 */
	| { kind: 'ok'; flow: Flow; audio: AudioBytes; missingSegmentIds: string[] }
	/** 打不開：message 是給教練看的原因。 */
	| { kind: 'error'; message: string };

const NOT_A_FLOW_FILE = '這不是流程檔';

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
 * 流程檔（zip 位元組）→ 流程 ＋ 音樂資料。舊版自動升級，比編輯器新的不打開。
 * upgrades 只有測試會換。
 */
export function readFlowFile(
	bytes: Uint8Array,
	upgrades: Record<number, Upgrade> = UPGRADES
): ReadFlowFileResult {
	let files: Record<string, Uint8Array>;
	let doc: FlowDocument;
	try {
		files = unzipSync(bytes);
		doc = JSON.parse(strFromU8(files[JSON_FILE]));
	} catch {
		return { kind: 'error', message: NOT_A_FLOW_FILE };
	}
	if (!isDocument(doc)) return { kind: 'error', message: NOT_A_FLOW_FILE };
	if (doc.formatVersion > FORMAT_VERSION) {
		return { kind: 'error', message: '這個流程檔是新版編輯器存的，請重新整理，更新編輯器' };
	}
	while (doc.formatVersion < FORMAT_VERSION) {
		const upgrade = upgrades[doc.formatVersion];
		if (!upgrade) return { kind: 'error', message: NOT_A_FLOW_FILE };
		doc = upgrade(doc);
	}
	if (!isFlow(doc.flow)) return { kind: 'error', message: NOT_A_FLOW_FILE };
	const flow = doc.flow;
	const audio: AudioBytes = {};
	for (const ref of flow.audio) if (files[ref.file]) audio[ref.id] = files[ref.file];
	return { kind: 'ok', flow, audio, missingSegmentIds: segmentsMissingAudio(flow, Object.keys(audio)) };
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
const walks: Check = (v) =>
	v === undefined ||
	(isObject(v) && Object.values(v).every(shape({ depart: timePosition, arrive: timePosition })));

const who: Check = (v) => v === null || shape({ role: str })(v) || shape({ member: str })(v);
const cues: Check = (v) =>
	v === undefined ||
	listOf(shape({ kind: oneOf(CUE_KINDS), at: int, len: int, word: str, who }))(v);

const color: Check = (v) => v === undefined || (str(v) && /^#[0-9a-f]{6}$/i.test(v as string));

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
			walks
		})
	),
	customRoles: listOf(shape({ id: str, name: str, meaning: str })),
	actions: listOf(
		shape({
			id: str,
			segmentId: str,
			category: oneOf(ACTION_CATEGORIES.map((c) => c.key)),
			name: str,
			start: int,
			length: int,
			note: str,
			members: listOf(shape({ memberId: str, role: nullOr(str) })),
			color,
			cues
		})
	)
});

/** 每個欄位的型別都對、指到的段／音樂檔／隊員都在、拍點守規則，而且有開頭那張站位（它沒有走位）。 */
function isFlow(v: unknown): v is Flow {
	if (!flowShape(v)) return false;
	const flow = v as Flow;
	const segmentIds = new Set(flow.segments.map((s) => s.id));
	const audioIds = new Set(flow.audio.map((a) => a.id));
	const memberIds = new Set(flow.members.map((m) => m.id));
	return (
		flow.formations.length > 0 &&
		flow.segments.every((s) => s.kind !== 'music' || s.audioId === null || audioIds.has(s.audioId)) &&
		flow.formations.every((f) => f.segmentId === null || segmentIds.has(f.segmentId)) &&
		flow.formations[0].walks === undefined &&
		flow.formations.every((f) =>
			Object.entries(f.walks ?? {}).every(
				([id, w]) =>
					memberIds.has(id) && segmentIds.has(w.depart.segmentId) && segmentIds.has(w.arrive.segmentId)
			)
		) &&
		flow.actions.every(
			(a) => segmentIds.has(a.segmentId) && a.members.every((m) => memberIds.has(m.memberId))
		) &&
		flow.actions.every((a) => {
			const segment = flow.segments.find((s) => s.id === a.segmentId)!;
			return (a.cues ?? []).every((c) => cueProblem(segment, a, c) === null);
		})
	);
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
