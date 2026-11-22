// 小樣（#300）用的假流程，比完就丟。
//   node prototypes/app-feel/make-flow.mjs
// 寫出 out/app-feel-test.zip（流程檔）和 out/app-feel-test.cheerflow（同一份，換副檔名，試「檔案」App 點一下能不能開 app）。
// 20 人（假名）、一段 3 分鐘音樂：120 BPM 的滴答聲，每拍一聲（八拍的 1 比較高、比較大聲），好讓錄影對齊。
// 每 2 個八拍一張站位，四種隊形輪流，整首都有人在走。

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const ROOT = join(HERE, '../..');
mkdirSync(OUT, { recursive: true });

// 流程核心：跟伺服器、app 同一包
execFileSync('node', [join(ROOT, 'scripts/core-bundle.mjs'), join(OUT, 'core')]);
const ctx = vm.createContext({});
vm.runInContext(readFileSync(join(OUT, 'core/flow-core.js'), 'utf8') + '\nglobalThis.flowCore = flowCore;', ctx);
const core = ctx.flowCore;

// 滴答聲
const RATE = 22050, BPM = 120, FIRST = 0.5, BEATS = 360;
const total = Math.ceil((FIRST + BEATS * 60 / BPM + 1) * RATE);
const pcm = new Int16Array(total);
for (let b = 0; b < BEATS; b++) {
	const one = b % 8 === 0;
	const start = Math.round((FIRST + b * 60 / BPM) * RATE);
	for (let i = 0; i < 0.03 * RATE; i++) {
		const t = i / RATE;
		pcm[start + i] = Math.round((one ? 0.9 : 0.5) * Math.exp(-t * 150) * Math.sin(2 * Math.PI * (one ? 3000 : 2000) * t) * 32767);
	}
}
const wav = Buffer.alloc(44 + pcm.byteLength);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.byteLength, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(pcm.byteLength, 40); Buffer.from(pcm.buffer).copy(wav, 44);
writeFileSync(join(OUT, 'click.wav'), wav);
// WAV 不用 AAC：AAC 開頭有編碼延遲，各家解碼扣不扣不一定，會干擾對拍的量測
const audio = new Uint8Array(readFileSync(join(OUT, 'click.wav')));

// 隊形：x 左右（-8.2 到 8.2）、y 前後（-6.4 到 6.4），公尺
const N = 20;
const shapes = [
	(i) => [-6 + (i % 5) * 3, -4.5 + Math.floor(i / 5) * 3], // 方陣
	(i) => [-7.6 + i * 0.8, i % 2 ? 1 : -1], // 兩排橫線
	(i) => { const k = i - 9.5; return [k * 0.8, -5 + Math.abs(k) * 1.1]; }, // V
	(i) => [Math.cos((i / N) * 2 * Math.PI) * 5, Math.sin((i / N) * 2 * Math.PI) * 5] // 圓
];
const round = (v) => Math.round(v * 1000) / 1000;
const members = Array.from({ length: N }, (_, i) => ({
	id: `m${i + 1}`,
	name: `測${String(i + 1).padStart(2, '0')}`,
	gender: i % 2 ? 'M' : 'F',
	globalRole: i % 4 === 0 ? 'top' : 'base'
}));
const HALF_BEATS = BEATS * 2;
const formations = [];
for (let at = 0, k = 0; at < HALF_BEATS; at += 32, k++) {
	const shape = shapes[k % shapes.length];
	// 每輪換一次誰站哪，人會交叉走
	const order = members.map((_, i) => (i * (k % 2 ? 7 : 1) + k) % N);
	formations.push({
		id: `f${k + 1}`,
		segmentId: 's1',
		at,
		pos: Object.fromEntries(members.map((m, i) => [m.id, shape(order[i]).map(round)]))
	});
}
const flow = {
	name: '小樣測試（20 人）',
	field: { strips: 9, layout: 'vertical' },
	timeRules: { on: false, minChantSec: 30, maxMusicSec: 150, maxTotalSec: 180 },
	members,
	audio: [{ id: 'a1', file: 'audio/a1.wav', name: '滴答 120.wav' }],
	segments: [{ id: 's1', kind: 'music', audioId: 'a1', bpm: BPM, firstBeatSec: FIRST, halfBeats: HALF_BEATS }],
	formations,
	customRoles: [],
	actions: []
};

const checked = core.checkFlowDocument({ formatVersion: core.FORMAT_VERSION, flow });
if (checked.kind !== 'ok') throw new Error('流程不對：' + JSON.stringify(checked));
const zip = core.writeFlowFile(checked.flow, { a1: audio });
const back = core.readFlowFile(zip);
if (back.kind !== 'ok') throw new Error('讀回來不對：' + JSON.stringify(back));
writeFileSync(join(OUT, 'app-feel-test.zip'), zip);
copyFileSync(join(OUT, 'app-feel-test.zip'), join(OUT, 'app-feel-test.cheerflow'));
console.log(`寫好 out/app-feel-test.zip：${N} 人、${formations.length} 張站位、${(zip.length / 1e6).toFixed(2)} MB，第 ${core.FORMAT_VERSION} 版`);
