import { expect, it } from "vite-plus/test";

import { putLiveSheet } from "../../zerops/putLive.logic.ts";

const sheet = (stageHeld: boolean | undefined) =>
  putLiveSheet({
    project: "Shop",
    changes: [{ title: "Tea finder" }],
    recipe: "present",
    creates: [],
    shapes: [],
    stageHeld,
  });

// witness: apps/web/src/zerops/putLive.logic.ts | const later = input.stageHeld === false ? PUT_LIVE_LATER : undefined; → const later = input.stageHeld !== true ? PUT_LIVE_LATER : undefined;
it("MN+11: Put it live suggests adding a stage only once HQ's environments are read and hold none; breaks: an application with a stage is told to add one, or the suggestion paints and is taken back", () => {
  expect(sheet(false).later).toBeDefined();
  expect(sheet(true).later).toBeUndefined();
  expect(sheet(undefined).later).toBeUndefined();
});
