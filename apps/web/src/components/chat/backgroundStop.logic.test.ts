import { describe, expect, it } from "vite-plus/test";

import { backgroundStopShows } from "./backgroundStop.logic";

// Milo, 2026-10-09: a Stop pressed on one turn's wait for its helpers read "Stopping…" again under
// a later turn's wait, with no Stop pressed.
describe("the background work's Stop", () => {
  it.each([
    { name: "nothing pressed reads Stop", press: null, turnId: "r/68", stopping: false },
    {
      name: "a Stop reads Stopping… while the turn it was pressed under still waits",
      press: { turnId: "r/65" },
      turnId: "r/65",
      stopping: true,
    },
    {
      name: "a later turn's wait reads Stop, not the earlier Stop's Stopping…",
      press: { turnId: "r/65" },
      turnId: "r/68",
      stopping: false,
    },
    {
      name: "a Stop pressed before any turn reads Stopping… until one starts",
      press: { turnId: null },
      turnId: null,
      stopping: true,
    },
  ])("$name", ({ press, turnId, stopping }) => {
    expect(backgroundStopShows(press, turnId)).toBe(stopping);
  });
});
