// 往後帶「只改這張」、Alt＋拖（#225）：往後帶了就跳提示，按「只改這張」後面那幾張改回去，整件事只算一步復原。
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { insertFormation, type Flow } from "#lib/core";
import { editorPage } from "#lib/test-fakes.js";
import { flowOf, libSample } from "#lib/test-flows.js";
import Page from "./+page.svelte";

// jsdom 沒有 scrollIntoView（點場上的人，泳道會捲過去）。
Element.prototype.scrollIntoView = () => {};

const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
const status = () => screen.getByRole("status");
const onlyThisButton = () => screen.getByRole("button", { name: "只改這張" });

/** 開頭那張之後還有 3 張（4、8、12 秒），大家都站一樣的位置：在開頭拖人會往後帶 3 張。 */
function fourFormations(): Flow {
  let flow = libSample();
  for (const sec of [4, 8, 12]) flow = flowOf(insertFormation(flow, sec));
  return flow;
}

async function drag(id: string, altKey = false) {
  await fireEvent.pointerDown(dot(id), {
    clientX: 0,
    clientY: 0,
    button: 0,
    altKey,
  });
  await fireEvent.pointerMove(dot(id), {
    clientX: -200,
    clientY: -300,
    altKey,
  });
  await fireEvent.pointerUp(dot(id), { clientX: -200, clientY: -300, altKey });
}

describe("往後帶：只改這張", () => {
  it("拖人往後帶 3 張 → 按「只改這張」→ 後面 3 張回原位，復原一次回到拖之前", async () => {
    const page = editorPage(fourFormations());
    render(Page, page.props);
    const before = page.session.flow!;
    const old = before.formations[0].pos.m3;

    await drag("m3");
    const moved = page.session.flow!.formations.map((f) => f.pos.m3);
    expect(moved[0]).not.toEqual(old);
    expect(moved.slice(1)).toEqual([moved[0], moved[0], moved[0]]);
    expect(status().textContent).toMatch(/^往後帶了 3 張/);

    await fireEvent.click(onlyThisButton());
    const after = page.session.flow!;
    expect(after.formations[0].pos.m3).toEqual(moved[0]);
    expect(after.formations.slice(1).map((f) => f.pos.m3)).toEqual([
      old,
      old,
      old,
    ]);

    await fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    expect(page.session.flow).toEqual(before);
    expect(page.session.canUndo).toBe(false);
  });

  it("在沒有站位的那一拍拖人：插的那張留著，只有後面那幾張改回去", async () => {
    const page = editorPage(flowOf(insertFormation(libSample(), 8)));
    render(Page, page.props);
    const before = page.session.flow!;
    page.editor.playback.seek(4);

    await drag("m3");
    expect(status().textContent).toBe(
      "插了一張站位，大家的位置自動帶入；往後帶了 1 張",
    );
    const moved = page.session.flow!.formations[1].pos.m3;
    await fireEvent.click(onlyThisButton());
    const after = page.session.flow!;
    expect(after.formations).toHaveLength(3);
    expect(after.formations[1].pos.m3).toEqual(moved);
    expect(after.formations[2].pos.m3).toEqual(before.formations[1].pos.m3);

    await fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    expect(page.session.flow).toEqual(before);
  });

  it("選人工具列的鏡像引起往後帶：一樣有「只改這張」", async () => {
    const page = editorPage(fourFormations());
    render(Page, page.props);
    const before = page.session.flow!;
    await fireEvent.pointerDown(dot("m3"), {
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    await fireEvent.pointerUp(dot("m3"), { clientX: 0, clientY: 0 });

    await fireEvent.click(
      within(screen.getByRole("toolbar", { name: "選人工具列" })).getByRole(
        "button",
        { name: "鏡像" },
      ),
    );
    expect(status().textContent).toMatch(/^往後帶了 3 張/);
    await fireEvent.click(onlyThisButton());
    expect(page.session.flow!.formations.slice(1).map((f) => f.pos.m3)).toEqual(
      before.formations.slice(1).map((f) => f.pos.m3),
    );
  });

  it("Alt＋拖不往後帶：只改這一張，沒有往後帶的提示", async () => {
    const page = editorPage(fourFormations());
    render(Page, page.props);
    const before = page.session.flow!;

    await drag("m3", true);
    const after = page.session.flow!;
    expect(after.formations[0].pos.m3).not.toEqual(before.formations[0].pos.m3);
    expect(after.formations.slice(1)).toEqual(before.formations.slice(1));
    expect(screen.queryByRole("status")?.textContent ?? "").not.toMatch(
      /往後帶/,
    );
  });
});
