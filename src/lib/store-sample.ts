// 商店截圖、審查帳號那支雲端流程用的範例流程（#399）。只用假名；音樂是程式合成的節拍聲（沒有別人的歌，沒有版權問題）。
// 畫面不用，只有 app-store.test.ts 用：它檢查 ios/store/ 裡的檔跟這裡產生的一樣，也能重寫那個檔（見那個檔開頭）。
import {
  addAction,
  addMembers,
  addSegment,
  createFlow,
  CELL_M,
  insertFormation,
  loadSegmentAudio,
  renameFormation,
  setPositions,
  toSeconds,
  updateSegment,
  type AudioBytes,
  type CommandResult,
  type Flow,
  type Position,
} from "#lib/core";

export const SAMPLE_FILE = "ios/store/review-sample.cheer";

/** 隊員的名字：一看就是假的。 */
export const FAKE_NAMES = [
  "小A",
  "小B",
  "小C",
  "小D",
  "小E",
  "小F",
  "小G",
  "小H",
  "小I",
  "小J",
  "小K",
  "小L",
];

const BPM = 144;
const EIGHTS = 8;
const RATE = 16000;

function must(r: CommandResult): Flow {
  if (r.kind !== "ok")
    throw new Error(`範例流程做不出來：${JSON.stringify(r)}`);
  return r.flow;
}

/**
 * 合成的節拍聲（WAV，16 kHz、單聲道、16 位元）：每拍一聲低的「咚」，每個八拍的第 1 拍是高的「嗒」，
 * 前面空 0.5 秒（第一拍在 0.5 秒），後面多 1 秒。
 */
export function beatTrack(): Uint8Array {
  const firstBeat = 0.5;
  const beats = EIGHTS * 8;
  const seconds = firstBeat + (beats * 60) / BPM + 1;
  const n = Math.round(seconds * RATE);
  const pcm = new Int16Array(n);
  for (let b = 0; b < beats; b++) {
    const start = Math.round((firstBeat + (b * 60) / BPM) * RATE);
    const freq = b % 8 === 0 ? 1320 : b % 2 === 0 ? 660 : 440;
    const len = Math.round(0.09 * RATE);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / RATE;
      pcm[start + i] = Math.round(
        Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 40) * 0.6 * 32767,
      );
    }
  }
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 單聲道
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, pcm[i], true);
  return out;
}

/** 格子座標（第幾格，0 是正中間）→ 公尺。 */
const at = (x: number, y: number): Position => [x * CELL_M, y * CELL_M];

/** 範例流程：12 個隊員、一段音樂（8 個八拍）、一段口號；4 張站位、5 個動作。 */
export function storeSample(): { flow: Flow; audio: AudioBytes } {
  let flow: Flow = must(
    createFlow({ name: "示範流程", field: { strips: 9, layout: "vertical" } }),
  );
  flow = must(
    addMembers(
      flow,
      FAKE_NAMES.map((name, i) => ({
        name,
        gender: i % 3 === 0 ? "M" : "F",
        globalRole: i % 4 === 0 ? ("top" as const) : ("base" as const),
      })),
    ),
  );
  flow = must(addSegment(flow, "music"));
  const loaded = loadSegmentAudio(flow, "s1", "節拍.wav");
  if (loaded.kind !== "ok")
    throw new Error(`範例流程做不出來：${JSON.stringify(loaded)}`);
  const audioId = loaded.audioId;
  flow = must(
    updateSegment(loaded.flow, "s1", {
      bpm: BPM,
      firstBeatSec: 0.5,
      eights: EIGHTS,
      lastBeats: 8,
    }),
  );
  flow = must(addSegment(flow, "chant", "s1", 300));
  const ids = flow.members.map((m) => m.id);

  // 開場：三排
  const opening = ids.map((_, i) =>
    at((i % 4) * 2 - 3, Math.floor(i / 4) * 1.5 - 1.5),
  );
  flow = must(
    setPositions(
      flow,
      flow.formations[0].id,
      Object.fromEntries(ids.map((id, i) => [id, opening[i]])),
    ),
  );
  flow = must(renameFormation(flow, flow.formations[0].id, "開場"));

  // 每張：第幾個八拍（從 0 算）的第 1 拍、名字、每個人在哪
  const plan: [number, string, Position[]][] = [
    [
      2,
      "三組技巧",
      ids.map((_, i) =>
        at(
          Math.floor(i / 4) * 3 - 3 + ((i % 4) - 1.5) * 0.5,
          (i % 4 === 0 ? 0 : 0.6) + 0.5,
        ),
      ),
    ],
    [4, "騰翻斜線", ids.map((_, i) => at(i * 0.6 - 3.3, i * 0.4 - 2.2))],
    [
      6,
      "金字塔",
      ids.map((_, i) => at((i - 5.5) * 0.55, i % 4 === 0 ? -0.5 : 0.5)),
    ],
  ];
  for (const [eight, name, pos] of plan) {
    const sec = toSeconds(flow, { segmentId: "s1", at: eight * 16 });
    const before = new Set(flow.formations.map((x) => x.id));
    flow = must(insertFormation(flow, sec));
    const f = flow.formations.find((x) => !before.has(x.id))!;
    flow = must(
      setPositions(
        flow,
        f.id,
        Object.fromEntries(ids.map((id, i) => [id, pos[i]])),
      ),
    );
    flow = must(renameFormation(flow, f.id, name));
  }

  const everyone = ids.map((memberId) => ({
    memberId,
    role: null as string | null,
  }));
  const stuntGroups = [0, 1, 2].flatMap((g) => [
    { memberId: ids[g * 4], role: "上層" },
    { memberId: ids[g * 4 + 1], role: "主底" },
    { memberId: ids[g * 4 + 2], role: "側底" },
    { memberId: ids[g * 4 + 3], role: "後保" },
  ]);
  const actions = [
    {
      segmentId: "s1",
      category: "dance" as const,
      name: "開場舞",
      start: 0,
      length: 32,
      members: everyone,
    },
    {
      segmentId: "s1",
      category: "stunt" as const,
      name: "Lib",
      start: 32,
      length: 32,
      members: stuntGroups,
    },
    {
      segmentId: "s1",
      category: "tumbling" as const,
      name: "後手翻",
      start: 64,
      length: 32,
      members: everyone.map((m) => ({ ...m, role: "騰翻" })),
    },
    {
      segmentId: "s1",
      category: "pyramid" as const,
      name: "金字塔",
      start: 96,
      length: 32,
      members: stuntGroups,
    },
    {
      segmentId: "s2",
      category: "other" as const,
      name: "喊口號",
      start: 0,
      length: 300,
      members: everyone,
    },
  ];
  for (const a of actions) flow = must(addAction(flow, { ...a, note: "" }));

  return { flow, audio: { [audioId]: beatTrack() } };
}
