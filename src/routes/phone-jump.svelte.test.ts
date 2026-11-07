// 手機跳時間（#228）：手機的播放列有「回開頭」「上一個八拍」「下一個八拍」；點時間可以打「3-1」跳過去。
// 只是看的功能，不改流程（docs/adr/0005-ipad-touch.md）。
import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFlowFile } from "#lib/core";
import { NARROW_SCREEN } from "#lib/editor-layout.js";
import { editorPage, flush, openFile } from "#lib/test-fakes.js";
import { libSample } from "#lib/test-flows.js";
import Page from "./+page.svelte";

Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === NARROW_SCREEN,
  }));
});
afterEach(() => vi.unstubAllGlobals());

/** 手機開範例流程：音樂 1，4 個八拍，120 BPM（一個八拍 4 秒）。 */
async function openOnPhone() {
  const page = editorPage(null);
  render(Page, page.props);
  await flush();
  await openFile(writeFlowFile(libSample(), {}));
  return page;
}

const where = () => screen.getByLabelText("目前位置").textContent;
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("手機跳時間", () => {
  it("「下一個八拍」「上一個八拍」一次移一個八拍，「回開頭」回到 1-1", async () => {
    await openOnPhone();
    expect(where()).toBe("音樂 1 1-1");
    await click("下一個八拍");
    expect(where()).toBe("音樂 1 2-1");
    await click("下一個八拍");
    expect(where()).toBe("音樂 1 3-1");
    await click("上一個八拍");
    expect(where()).toBe("音樂 1 2-1");
    await click("下一個八拍");
    await click("回開頭");
    expect(where()).toBe("音樂 1 1-1");
  });

  it("點時間打「3-1」按 Enter：跳到第 3 個八拍，不算改流程", async () => {
    const { session } = await openOnPhone();
    await click("跳到哪裡");
    const box = screen.getByRole("textbox", { name: "跳到哪裡" });
    await fireEvent.input(box, { target: { value: "3-1" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    expect(where()).toBe("音樂 1 3-1");
    expect(screen.queryByRole("textbox", { name: "跳到哪裡" })).toBeNull();
    expect(session.unsaved).toBe(false);
  });

  it("全形「３－５」也看得懂", async () => {
    await openOnPhone();
    await click("跳到哪裡");
    const box = screen.getByRole("textbox", { name: "跳到哪裡" });
    await fireEvent.input(box, { target: { value: "３－５" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    expect(where()).toBe("音樂 1 3-5");
  });

  it("打看不懂的字：說怎麼打，播放頭不動，欄位留著可以改", async () => {
    await openOnPhone();
    await click("下一個八拍");
    await click("跳到哪裡");
    const box = screen.getByRole("textbox", { name: "跳到哪裡" });
    await fireEvent.input(box, { target: { value: "第三個" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe(
      "時間看不懂，例：2-5（別的段前面加段名，例：口號 1 12.3）",
    );
    expect(screen.getByRole("textbox", { name: "跳到哪裡" })).toBeTruthy();
    await fireEvent.keyDown(box, { key: "Escape" });
    expect(where()).toBe("音樂 1 2-1");
  });

  it("打超出這一段的八拍（9-1）：說這一段只有幾個八拍，播放頭不動", async () => {
    await openOnPhone();
    await click("跳到哪裡");
    const box = screen.getByRole("textbox", { name: "跳到哪裡" });
    await fireEvent.input(box, { target: { value: "9-1" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("音樂 1 只有 4 個八拍");
    await fireEvent.keyDown(box, { key: "Escape" });
    expect(where()).toBe("音樂 1 1-1");
  });

  it("按 Esc 收起來，不跳", async () => {
    await openOnPhone();
    await click("跳到哪裡");
    const box = screen.getByRole("textbox", { name: "跳到哪裡" });
    await fireEvent.input(box, { target: { value: "3-1" } });
    await fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "跳到哪裡" })).toBeNull();
    expect(where()).toBe("音樂 1 1-1");
  });

  it("電腦（寬螢幕）的播放列沒有這些按鈕", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    await openOnPhone();
    expect(screen.queryByRole("button", { name: "下一個八拍" })).toBeNull();
    expect(screen.queryByRole("button", { name: "跳到哪裡" })).toBeNull();
  });
});
