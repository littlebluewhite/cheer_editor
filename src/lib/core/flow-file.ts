// 讀寫流程檔：zip 位元組 ↔ 流程 ＋ 音樂資料。格式見 docs/flow-file-format.md。
// zip 裡是 flow.json（{ formatVersion, flow }）和 flow.audio 列出的音樂檔（audio/a1.mp3 …）。

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Flow } from './flow';

/** 這個編輯器寫出的流程檔版本。改了流程檔格式就加 1，並在 UPGRADES 補一步。 */
export const FORMAT_VERSION = 1;

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
 * 現在只有第 1 版，所以是空的；格式改成第 2 版時加 `1: (doc) => ({ formatVersion: 2, flow: … })`。
 */
const UPGRADES: Record<number, Upgrade> = {};

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
 * upgrades 只有測試會換（現在沒有舊版可以升）。
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

/** 流程的外層長得對：名字、場地、時間規則，和每份清單都是物件陣列，而且有開頭那張站位。裡面的欄位不逐一檢查。 */
function isFlow(flow: unknown): flow is Flow {
	if (!isObject(flow)) return false;
	const lists = ['members', 'audio', 'segments', 'formations', 'customRoles', 'actions'];
	return (
		typeof flow.name === 'string' &&
		isObject(flow.field) &&
		isObject(flow.timeRules) &&
		lists.every((k) => Array.isArray(flow[k]) && flow[k].every(isObject)) &&
		(flow.formations as unknown[]).length > 0
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
