// 頁面：左邊規則警告卡片的撞位、走太快、很喘總表；點一行跳到那一拍、選好那幾個人（#226）。
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import {
  addAction,
  addMembers,
  addSegment,
  createFlow,
  insertFormation,
  setPositions,
  setWalks,
} from "#lib/core";
import { flowOf } from "#lib/test-flows.js";
import { editorPage } from "#lib/test-fakes.js";
import Page from "./+page.svelte";

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

/**
 * 150 BPM 的音樂段，站位 2 在 4.8 秒（2-5）。
 * 小A、小B 換位置，小A 1.6–4.8 秒在騰翻裡：3.2 秒（2-1）撞位。
 * 小C 2-4 到 2-5（0.4 秒）走 2 公尺：每秒 5 公尺，走太快。
 * 小D 同一段時間走 1.2 公尺：每秒 3 公尺，很喘。
 */
function troubled() {
  let flow = flowOf(
    createFlow({ name: "全國賽", field: { strips: 9, layout: "vertical" } }),
  );
  flow = flowOf(
    addMembers(
      flow,
      ["小A", "小B", "小C", "小D"].map((name) => ({
        name,
        gender: "F",
        globalRole: "base",
      })),
    ),
  );
  flow = flowOf(addSegment(flow, "music"));
  flow = flowOf(
    setPositions(flow, "f1", {
      m1: [0, 0],
      m2: [2, 0],
      m3: [0, 3],
      m4: [0, -3],
    }),
  );
  flow = flowOf(insertFormation(flow, 4.8));
  const f2 = flow.formations[1].id;
  flow = flowOf(
    setPositions(flow, f2, {
      m1: [2, 0],
      m2: [0, 0],
      m3: [2, 3],
      m4: [1.2, -3],
    }),
  );
  const quick = {
    depart: { segmentId: "s1", at: 22 },
    arrive: { segmentId: "s1", at: 24 },
  };
  flow = flowOf(setWalks(flow, f2, { m3: quick, m4: quick }));
  return flowOf(
    addAction(flow, {
      segmentId: "s1",
      category: "tumbling",
      name: "",
      start: 8,
      length: 16,
      note: "",
      members: [{ memberId: "m1", role: null }],
    }),
  );
}

const summary = () =>
  screen.getByRole("button", { name: /^撞位 \d+・走太快 \d+・很喘 \d+$/ });
const list = () => screen.getByRole("list", { name: "撞位、走太快、很喘" });

describe("規則警告卡片的撞位、走太快、很喘總表", () => {
  it("卡片寫撞位、走太快、很喘各幾個；點開是清單，每行寫哪一拍、誰和誰", async () => {
    render(Page, editorPage(troubled()).props);
    expect(summary().textContent).toBe("撞位 1・走太快 1・很喘 1");
    expect(summary().getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("list", { name: "撞位、走太快、很喘" }),
    ).toBeNull();

    await fireEvent.click(summary());
    expect(summary().getAttribute("aria-expanded")).toBe("true");
    expect(
      within(list())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "音樂 1 2-1 撞位 小A、小B",
      "音樂 1 2-5 走太快 小C",
      "音樂 1 2-5 很喘 小D",
    ]);

    await fireEvent.click(summary());
    expect(
      screen.queryByRole("list", { name: "撞位、走太快、很喘" }),
    ).toBeNull();
  });

  it("沒有撞位、走太快、很喘：沒有這張卡", () => {
    const flow = flowOf(
      createFlow({ name: "全國賽", field: { strips: 9, layout: "vertical" } }),
    );
    render(Page, editorPage(flow).props);
    expect(screen.queryByRole("button", { name: /^撞位 / })).toBeNull();
  });

  it("點清單一行：播放頭跳到那一拍，選好那幾個人", async () => {
    const { session, props } = editorPage(troubled());
    render(Page, props);
    await fireEvent.click(summary());
    const rows = () => within(list()).getAllByRole("button");

    await fireEvent.click(rows()[0]);
    expect(screen.getByLabelText("目前位置").textContent).toBe("音樂 1 2-1");
    expect(session.selectedMemberIds).toEqual(["m1", "m2"]);

    await fireEvent.click(rows()[1]);
    expect(screen.getByLabelText("目前位置").textContent).toBe("音樂 1 2-5");
    expect(session.selectedMemberIds).toEqual(["m3"]);

    await fireEvent.click(rows()[2]);
    expect(session.selectedMemberIds).toEqual(["m4"]);
  });
});
