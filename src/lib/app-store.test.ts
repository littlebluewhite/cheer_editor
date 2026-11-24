// 商店頁的草稿（#399，ios/store/）：範例流程檔打得開、有音樂、只用假名；文字裡沒有 email、裝置的識別碼；
// 截圖是 App Store Connect 收的尺寸（#362 留言）；字數在 App Store Connect 的上限裡。
// 範例流程檔由 store-sample.ts 產生：改了它，跑 STORE_SAMPLE_WRITE=1 npx vitest run src/lib/app-store.test.ts 重寫。
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { FORMAT_VERSION, readFlowFile, writeFlowFile } from "#lib/core";
import { FAKE_NAMES, SAMPLE_FILE, storeSample } from "./store-sample";

const root = new URL("../../", import.meta.url);
const store = new URL("ios/store/", root);
const sampleUrl = new URL(SAMPLE_FILE, root);

if (process.env.STORE_SAMPLE_WRITE) {
  const { flow, audio } = storeSample();
  writeFileSync(sampleUrl, writeFlowFile(flow, audio));
}

/** ios/store/ 底下的檔（含子資料夾），相對路徑。 */
function files(dir = store, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`)
      : [`${prefix}${e.name}`],
  );
}

/** markdown 裡 ```text 區塊（要貼到 App Store Connect 的字），照前面最近的 ### 標題拿。 */
function pasteBlock(file: string, heading: string): string {
  const md = readFileSync(new URL(file, store), "utf8");
  const at = md.indexOf(`### ${heading}`);
  expect(at, heading).toBeGreaterThanOrEqual(0);
  const m = md.slice(at).match(/```text\n([\s\S]*?)\n```/);
  expect(m, heading).not.toBeNull();
  return m![1];
}

describe("範例流程檔", () => {
  const r = readFlowFile(new Uint8Array(readFileSync(sampleUrl)));

  it("打得開、是現在的版本，每個音樂段都有音樂", () => {
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(
      JSON.parse(
        strFromU8(
          unzipSync(new Uint8Array(readFileSync(sampleUrl)))["flow.json"],
        ),
      ).formatVersion,
    ).toBe(FORMAT_VERSION);
    expect(r.missingSegmentIds).toEqual([]);
    const music = r.flow.segments.filter((s) => s.kind === "music");
    expect(music.length).toBeGreaterThan(0);
    for (const s of music)
      expect(
        s.kind === "music" && s.audioId && r.audio[s.audioId].length,
      ).toBeGreaterThan(100_000);
  });

  it("跟 store-sample.ts 產生的一樣（改了要重寫檔）", () => {
    if (r.kind !== "ok") throw new Error("打不開");
    const { flow, audio } = storeSample();
    const again = readFlowFile(writeFlowFile(flow, audio));
    if (again.kind !== "ok") throw new Error("打不開");
    expect(r.flow).toEqual(again.flow);
    expect(r.audio).toEqual(again.audio);
  });

  it("隊員只用假名，有站位、動作", () => {
    if (r.kind !== "ok") throw new Error("打不開");
    expect(r.flow.members.length).toBeGreaterThanOrEqual(8);
    for (const m of r.flow.members) expect(FAKE_NAMES).toContain(m.name);
    expect(r.flow.formations.length).toBeGreaterThanOrEqual(3);
    expect(r.flow.actions.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ios/store/ 的字", () => {
  const texts = files().filter((f) => f.endsWith(".md"));

  it("商店說明、審查備註、隱私標示、問卷都在", () => {
    for (const f of [
      "description.md",
      "review-notes.md",
      "privacy-labels.md",
      "questionnaires.md",
      "README.md",
    ]) {
      expect(existsSync(new URL(f, store)), f).toBe(true);
    }
  });

  it("沒有 email、裝置或模擬器的識別碼（UUID、UDID）", () => {
    for (const f of texts) {
      const text = readFileSync(new URL(f, store), "utf8");
      expect(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g), f).toBeNull();
      expect(
        text.match(
          /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/gi,
        ),
        f,
      ).toBeNull();
      expect(text.match(/\b[0-9a-f]{8}-?[0-9a-f]{16}\b/gi), f).toBeNull();
    }
  });

  it("字數在 App Store Connect 的上限裡", () => {
    expect(
      [...pasteBlock("description.md", "名稱")].length,
    ).toBeLessThanOrEqual(30);
    expect(
      [...pasteBlock("description.md", "副標題")].length,
    ).toBeLessThanOrEqual(30);
    expect(
      [...pasteBlock("description.md", "推廣文字")].length,
    ).toBeLessThanOrEqual(170);
    expect(
      [...pasteBlock("description.md", "描述")].length,
    ).toBeLessThanOrEqual(4000);
    // 關鍵字算的是位元組（UTF-8 的中文一個字 3 個位元組）。
    expect(
      new TextEncoder().encode(pasteBlock("description.md", "關鍵字")).length,
    ).toBeLessThanOrEqual(100);
    expect(
      [...pasteBlock("review-notes.md", "Notes (English)")].length,
    ).toBeLessThanOrEqual(4000);
  });

  it("名稱就是 App 紀錄的名字", () => {
    expect(pasteBlock("description.md", "名稱")).toBe("競技啦啦隊流程編輯器");
  });
});

describe("截圖", () => {
  // #362 留言：App Store Connect 版本 1.0 頁面上寫的尺寸。
  const SIZES = {
    "iphone-6.3": ["1179x2556", "2556x1179", "1206x2622", "2622x1206"],
    "ipad-13": ["2048x2732", "2732x2048", "2064x2752", "2752x2064"],
  };
  const shots = files().filter((f) => f.endsWith(".png"));

  it("每種裝置至少一張，尺寸對", () => {
    for (const [device, sizes] of Object.entries(SIZES)) {
      const mine = shots.filter((f) => f.startsWith(`screenshots/${device}/`));
      expect(mine.length, device).toBeGreaterThan(0);
      for (const f of mine) {
        const b = readFileSync(new URL(f, store));
        expect(b.subarray(1, 4).toString(), f).toBe("PNG");
        expect(sizes, f).toContain(
          `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`,
        );
      }
    }
  });
});
