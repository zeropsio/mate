// @vitest-environment happy-dom
import { ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ComposerPlaceLine, composerPlaceNotice } from "./ComposerPlace";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const retired = {
  text: "An earlier conversation with Rhea — it goes on in a newer one.",
  currentThreadId: ThreadId.make("thread-rhea-2"),
};

// The owner's pick, S6 on the "Composer Strips" board (2026-10-12): what stops you writing takes
// the composer's own place, says it once and offers its one way out.
describe("what stops you writing", () => {
  it.each([
    {
      name: "an archived conversation",
      record: { archived: { restoring: false }, crewRetired: retired },
      says: "This conversation is archived. Restore it to carry on here.",
      action: "Restore",
      runs: "restore",
    },
    {
      name: "an archived conversation on its way back",
      record: { archived: { restoring: true }, crewRetired: null },
      says: "This conversation is archived. Restore it to carry on here.",
      action: "Restoring...",
      runs: null,
    },
    {
      name: "a crewmate's earlier conversation",
      record: { archived: null, crewRetired: retired },
      says: "An earlier conversation with Rhea — it goes on in a newer one.",
      action: "Open it",
      runs: "open",
    },
  ])(
    "$name takes the composer's place and offers its way out",
    async ({ record, says, action, runs }) => {
      const ran: string[] = [];
      const notice = composerPlaceNotice(record, {
        restore: () => ran.push("restore"),
        openCurrent: () => ran.push("open"),
      });
      await act(() => root!.render(<ComposerPlaceLine notice={notice!} />));
      expect(document.body.textContent).toBe(`${says}${action}`);
      const buttons = document.querySelectorAll("button");
      expect(buttons).toHaveLength(1);
      await act(() => buttons[0]!.click());
      expect(ran).toEqual(runs === null ? [] : [runs]);
    },
  );

  // A repository cloning stops only Send: the composer stays (`ComposerCloneAsk`).
  it("leaves the composer where it is when nothing stops the writing", () => {
    expect(
      composerPlaceNotice(
        { archived: null, crewRetired: null },
        { restore() {}, openCurrent() {} },
      ),
    ).toBeNull();
  });

  it("offers no way out of an earlier conversation whose current one is not known", async () => {
    const notice = composerPlaceNotice(
      { archived: null, crewRetired: { ...retired, currentThreadId: null } },
      { restore() {}, openCurrent() {} },
    );
    await act(() => root!.render(<ComposerPlaceLine notice={notice!} />));
    expect(document.body.textContent).toBe(retired.text);
    expect(document.querySelector("button")).toBeNull();
  });
});

it("an archived conversation reads as archived and offers Restore", async () => {
  let restored = false;
  const notice = composerPlaceNotice(
    { archived: { restoring: false }, crewRetired: null },
    {
      restore: () => {
        restored = true;
      },
      openCurrent() {},
    },
  );
  await act(() => root!.render(<ComposerPlaceLine notice={notice!} />));
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "This conversation is archived. Restore it to carry on here.Restore",
  );
  const restore = document.querySelector("button")!;
  expect(restore.textContent).toBe("Restore");
  expect(restore.disabled).toBe(false);
  expect(document.querySelector('[role="textbox"]')).toBeNull();
  await act(() => restore.click());
  expect(restored).toBe(true);
  // The owner's reflected record, rather than the click, clears the archived notice.
  const live = composerPlaceNotice(
    { archived: null, crewRetired: null },
    { restore() {}, openCurrent() {} },
  );
  expect(live).toBeNull();
  await act(() => root!.render(live === null ? null : <ComposerPlaceLine notice={live} />));
  expect(document.body.textContent).toBe("");
});
