// @vitest-environment happy-dom
import { ProjectId, ThreadId, type ProjectCloneSnapshot } from "@t3tools/contracts";
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

const clone = (phase: ProjectCloneSnapshot["phase"]): ProjectCloneSnapshot =>
  ({
    projectId: ProjectId.make("project-1"),
    destinationPath: "/home/zerops/acme-shop",
    repository: null,
    phase,
    stage: "receiving",
    percent: 45,
    detail: null,
    error: phase === "failed" ? "Authentication failed" : null,
  }) as unknown as ProjectCloneSnapshot;

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
      record: { archived: { restoring: false }, crewRetired: retired, clone: clone("running") },
      says: "This conversation is archived. Restore it to carry on here.",
      action: "Restore",
      runs: "restore",
    },
    {
      name: "an archived conversation on its way back",
      record: { archived: { restoring: true }, crewRetired: null, clone: null },
      says: "This conversation is archived. Restore it to carry on here.",
      action: "Restoring...",
      runs: null,
    },
    {
      name: "a crewmate's earlier conversation",
      record: { archived: null, crewRetired: retired, clone: null },
      says: "An earlier conversation with Rhea — it goes on in a newer one.",
      action: "Open it",
      runs: "open",
    },
    {
      name: "a repository cloning",
      record: { archived: null, crewRetired: null, clone: clone("running") },
      says: "Cloning acme-shop · Receiving objects · 45%",
      action: "Cancel",
      runs: "cancel",
    },
    {
      name: "a clone that failed",
      record: { archived: null, crewRetired: null, clone: clone("failed") },
      says: "Failed to clone acme-shop · Authentication failed",
      action: "Retry",
      runs: "retry",
    },
    {
      name: "a clone that was cancelled",
      record: { archived: null, crewRetired: null, clone: clone("cancelled") },
      says: "Cancelled cloning acme-shop · Retry to bring in the repository.",
      action: "Retry",
      runs: "retry",
    },
  ])(
    "$name takes the composer's place and offers its way out",
    async ({ record, says, action, runs }) => {
      const ran: string[] = [];
      const notice = composerPlaceNotice(record, {
        restore: () => ran.push("restore"),
        openCurrent: () => ran.push("open"),
        cancelClone: () => ran.push("cancel"),
        retryClone: () => ran.push("retry"),
      });
      await act(() => root!.render(<ComposerPlaceLine notice={notice!} />));
      expect(document.body.textContent).toBe(`${says}${action}`);
      const buttons = document.querySelectorAll("button");
      expect(buttons).toHaveLength(1);
      await act(() => buttons[0]!.click());
      expect(ran).toEqual(runs === null ? [] : [runs]);
    },
  );

  it.each([
    { name: "nothing stops it", clone: null },
    { name: "the clone is done", clone: clone("done") },
  ])("leaves the composer where it is when $name", ({ clone }) => {
    expect(
      composerPlaceNotice(
        { archived: null, crewRetired: null, clone },
        { restore() {}, openCurrent() {}, cancelClone() {}, retryClone() {} },
      ),
    ).toBeNull();
  });

  it("offers no way out of an earlier conversation whose current one is not known", async () => {
    const notice = composerPlaceNotice(
      { archived: null, crewRetired: { ...retired, currentThreadId: null }, clone: null },
      { restore() {}, openCurrent() {}, cancelClone() {}, retryClone() {} },
    );
    await act(() => root!.render(<ComposerPlaceLine notice={notice!} />));
    expect(document.body.textContent).toBe(retired.text);
    expect(document.querySelector("button")).toBeNull();
  });
});
