import { expect, it } from "vite-plus/test";

import { putLiveSheet, putLiveSheetNow } from "../../zerops/putLive.logic.ts";

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
