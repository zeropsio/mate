import { expect, it } from "vite-plus/test";

import { putLiveOf, putLiveSheet, putLiveSheetNow } from "../../zerops/putLive.logic.ts";
import type { HqOperation } from "@t3tools/client-runtime/zerops/hq";
import { endOperationIntent } from "./ZeropsOperationEnd.logic.ts";

const sheet = (stageHeld: boolean | undefined) =>
  putLiveSheet({
    project: "Shop",
    changes: [{ title: "Tea finder" }],
    recipe: "present",
    creates: [],
    shapes: [],
    stageHeld,
  });

// witness: apps/web/src/zerops/putLive.logic.ts | : { unplacedProjectId: standing.unplacedProjectId }), → : {}),
it("MN130: A failed Put it live keeps the project HQ says it could not place, and names none when HQ omits it; breaks: its production row cannot identify the project involved.", () => {
  const operation: HqOperation = {
    id: "op-1",
    kind: "put_live",
    phase: "project_requested",
    acceptedAt: "2026-11-24T10:00:00Z",
    at: "2026-11-24T10:00:00Z",
    failure: {
      step: "place",
      code: "placed_or_production_taken",
      origin: "hq",
      at: "2026-11-24T10:00:00Z",
    },
    unplacedProjectId: "project-1",
  };
  expect(putLiveOf(operation)).toMatchObject({ kind: "failed", unplacedProjectId: "project-1" });
  const { unplacedProjectId: _unplaced, ...withoutProject } = operation;
  expect(putLiveOf(withoutProject)).not.toHaveProperty("unplacedProjectId");
});

// witness: apps/web/src/zerops/putLive.logic.ts | const later = input.stageHeld === false ? PUT_LIVE_LATER : undefined; → const later = input.stageHeld !== true ? PUT_LIVE_LATER : undefined;
it("MN52: Put it live suggests adding a stage only once HQ's environments are read and hold none; breaks: an application with a stage is told to add one, or the suggestion paints and is taken back", () => {
  expect(sheet(false).later).toBeDefined();
  expect(sheet(true).later).toBeUndefined();
  expect(sheet(undefined).later).toBeUndefined();
});

const standing = {
  pressedHere: false,
  going: false,
  placed: false,
  otherSetup: false,
  zeropsProduction: false,
  setUpOffered: true,
  waits: undefined,
  refused: undefined,
};

// witness: apps/web/src/zerops/putLive.logic.ts | if (input.placed) → if (input.placed && input.going)
it("MN53: Once HQ holds the application's production, a sheet not pressed here leads to it and offers neither a start nor a second production, whether or not HQ's operation still runs; breaks: a second device proposes production 2 and HQ refuses it", () => {
  for (const going of [true, false]) {
    const now = putLiveSheetNow(sheet(false), { ...standing, going, placed: true });
    expect(now.placed).toBe(true);
    expect(now.setUpYourself).toBe(false);
    expect(now.hold).toBeUndefined();
  }
  const absent = putLiveSheetNow(sheet(false), { ...standing, zeropsProduction: true });
  expect(absent.placed).toBeUndefined();
  expect(absent.setUpYourself).toBe(true);
});

// witness: apps/web/src/zerops/putLive.logic.ts | ...(standing.endable === true ? { endable: true as const } : {}), → ...({}),
it("MN73: A Put it live waiting on a lost answer can be ended by whoever HQ offers its End, and by nobody else; breaks: the application stays held with no way out", () => {
  const waiting = (offers: ReadonlyArray<string>): HqOperation => ({
    id: "op-1",
    kind: "put_live",
    phase: "project_requested",
    acceptedAt: "2026-11-24T10:00:00Z",
    at: "2026-11-24T10:00:00Z",
    continueBy: "maker",
    failure: {
      step: "zerops",
      code: "zerops_not_answering",
      origin: "hq",
      at: "2026-11-24T10:00:00Z",
    },
    offers,
  });
  expect(endOperationIntent(putLiveOf(waiting(["continue", "end"])), "org-1", "app-1")).toEqual({
    kind: "end-operation",
    orgId: "org-1",
    id: "op-1",
    appId: "app-1",
  });
  expect(endOperationIntent(putLiveOf(waiting(["continue"])), "org-1", "app-1")).toBeUndefined();
});
