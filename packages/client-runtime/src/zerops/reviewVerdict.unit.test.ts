import { expect, it } from "vite-plus/test";

import { mergeCheckWait } from "./reviewVerdict.ts";

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | const sameWait = held !== undefined && held.of === of; → const sameWait = held !== undefined && true;
it("ZV+1: A merge check's wait starts when the review first sees that change unjudged at that head: asked again for the same one it keeps its start, and another change or a new head starts it again", () => {
  const started = 1_000_000;
  const later = started + 61_000;
  const held = { of: "app-1/webdev#32@4a786a65", since: started };

  expect(mergeCheckWait(held, "app-1/webdev#32@4a786a65", later)).toEqual({
    of: "app-1/webdev#32@4a786a65",
    since: started,
  });
  expect(mergeCheckWait(held, "app-1/webdev#32@db2c1673", later)).toEqual({
    of: "app-1/webdev#32@db2c1673",
    since: later,
  });
  expect(mergeCheckWait(held, "app-1/webdev#33@4a786a65", later)).toEqual({
    of: "app-1/webdev#33@4a786a65",
    since: later,
  });
  expect(mergeCheckWait(held, undefined, later)).toBeUndefined();
});
