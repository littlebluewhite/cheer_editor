// 改某一次（session.drill.edit）：從編輯 session 點記號，看流程裡那一次變成什麼、提示寫什麼。
// 按得了的跟存下來的一樣，規則的表格在 core/attempt-edit.test.ts；這裡測接到 session 上的事。
import { describe, expect, it } from "vitest";
import { addPhase, deletePhase, recordAttempt, type Flow } from "#lib/core";
import { flowOf, libSample, pyramidSample } from "#lib/test-flows.js";
import { EditorSession } from "./editor-session.svelte.js";
import { m } from "#lib/paraglide/messages.js";

const DATE = "2026-11-01";
const drill = (who: string, marks: Record<string, "✓" | "△" | "✗">) =>
  ({ date: DATE, who, practice: "drill", whole: true, marks }) as const;

/** session 和改 attemptId 那一次的一份（動作照 session 現在的流程算）。 */
function setup(flow: Flow, attemptId = "t1", index = 0) {
  const s = new EditorSession(flow);
  const action = () => s.flow!.actions[index];
  const edit = s.drill.edit(action, attemptId, s.recordAsk());
  const records = () =>
    action().successRate!.records.map((r) => [
      r.id,
      r.whole,
      r.marks,
      r.blanks,
    ]);
  return { s, edit, records };
}

describe("改某一次", () => {
  it("一開始亮著原本的記號；點了按「存」才改，寫「已改」，不算復原的一步", () => {
    const { s, edit, records } = setup(
      flowOf(recordAttempt(libSample(), "x1", drill("g1", { p1: "✗" }))),
    );
    expect(edit.marks).toEqual({ p1: "✗" });
    expect(edit.shut).toEqual(["p2", "p3"]);
    edit.tap("p1", "✓");
    edit.tap("p2", "△");
    expect(records()).toEqual([["t1", true, { p1: "✗" }, ["p2", "p3"]]]);
    let done = false;
    edit.save(() => (done = true));
    expect(done).toBe(true);
    expect(records()).toEqual([["t1", false, { p1: "✓", p2: "△" }, undefined]]);
    expect(s.notice).toBe(m.practice_changed());
    expect(s.canUndo).toBe(false);
  });

  it("再點一次點著的那顆就變空的；點了 ✗，按不了的環節點過的記號不留", () => {
    const { edit } = setup(
      flowOf(
        recordAttempt(
          libSample(),
          "x1",
          drill("g1", { p1: "✓", p2: "✓", p3: "✓" }),
        ),
      ),
    );
    edit.tap("p3", "✓");
    expect(edit.marks).toEqual({ p1: "✓", p2: "✓" });
    edit.tap("p3", "△");
    edit.tap("p1", "✗");
    expect(edit.marks).toEqual({ p1: "✗" });
    expect(edit.shut).toEqual(["p2", "p3"]);
  });

  it("✗ 的環節後來被刪了：原本空著的按不了，存下來照樣空著", () => {
    let flow = flowOf(
      recordAttempt(libSample(), "x1", drill("g1", { p1: "✓", p2: "✗" })),
    );
    flow = flowOf(deletePhase(flow, "x1", "p2", { confirmed: true }));
    const { edit, records } = setup(flow);
    expect(edit.shut).toEqual(["p3"]);
    edit.tap("p1", "△");
    edit.save(() => {});
    expect(records()).toEqual([["t1", true, { p1: "△" }, ["p3"]]]);
  });

  it("金字塔：跟 ✗ 佔同樣拍的按得了，之後才開始的按不了；✗ 改成 ✓ 又按得了", () => {
    const { edit, records } = setup(
      flowOf(
        recordAttempt(pyramidSample(), "x2", drill("g3", { p4: "✓", p6: "✗" })),
      ),
      "t1",
      1,
    );
    expect(edit.shut).toEqual(["p7", "p8"]);
    edit.tap("p5", "△");
    edit.save(() => {});
    expect(records()).toEqual([
      ["t1", true, { p4: "✓", p5: "△", p6: "✗" }, ["p7", "p8"]],
    ]);
    edit.tap("p6", "✓");
    expect(edit.shut).toEqual([]);
  });

  it("記的時候還沒有的環節按不了：點了 ✗ 也不留、不清掉之後的記號，存下來還是整個做", () => {
    // 上法 ✓、下法 ✓ 記好，才在中間加中段
    let flow = flowOf(
      deletePhase(libSample(), "x1", "p2", { confirmed: true }),
    );
    flow = flowOf(recordAttempt(flow, "x1", drill("g1", { p1: "✓", p3: "✓" })));
    flow = flowOf(
      addPhase(flow, "x1", {
        kind: "hold",
        name: "",
        beats: { at: 4, len: 8 },
      }),
    );
    const later = flow.actions[0].successRate!.phases.find(
      (p) => p.kind === "hold",
    )!.id;
    const { edit, records } = setup(flow);
    expect(edit.shut).toEqual([later]);
    edit.tap(later, "✗");
    expect(edit.marks).toEqual({ p1: "✓", p3: "✓" });
    edit.save(() => {});
    expect(records()).toEqual([["t1", true, { p1: "✓", p3: "✓" }, undefined]]);
  });

  it("改到一半流程變了（例如又記了一次、加了環節）：改到一半的記號還在，照現在的動作算", () => {
    const { s, edit, records } = setup(
      flowOf(
        recordAttempt(
          libSample(),
          "x1",
          drill("g1", { p1: "✓", p2: "✓", p3: "✓" }),
        ),
      ),
    );
    edit.tap("p2", "△");
    s.recordAsk().send({
      name: "recordAttempt",
      args: ["x1", drill("g1", { p1: "✓" })],
    });
    s.changeAsk().send([
      {
        name: "addPhase",
        args: [
          "x1",
          { kind: "hold", name: "", beats: { at: 14, len: 2 } },
          { confirmed: true },
        ],
      },
    ]);
    const p4 = s.flow!.actions[0].successRate!.phases[3].id;
    expect(edit.marks).toEqual({ p1: "✓", p2: "△", p3: "✓" });
    expect(edit.shut).toEqual([p4]);
    edit.save(() => {});
    expect(records()[0]).toEqual([
      "t1",
      true,
      { p1: "✓", p2: "△", p3: "✓" },
      undefined,
    ]);
  });

  it("那一次被別的地方拿掉了：attempt 是 undefined（卡片收起來）", () => {
    const { s, edit } = setup(
      flowOf(recordAttempt(libSample(), "x1", drill("g1", { p1: "✓" }))),
    );
    expect(edit.attempt?.id).toBe("t1");
    s.recordAsk().send({ name: "deleteAttempt", args: ["x1", "t1"] });
    expect(edit.attempt).toBeUndefined();
  });

  it("改到一半就丟掉（換頁、換動作卡片收起來）：什麼都不存，卡上也不算還沒存", () => {
    const { s, edit } = setup(
      flowOf(recordAttempt(libSample(), "x1", drill("g1", { p1: "✓" }))),
    );
    const before = s.flow;
    edit.tap("p1", "✗");
    expect(s.flow).toBe(before);
    expect(s.drill.hasUnsaved(s.flow!.actions[0], "g1", DATE)).toBe(false);
  });
});
