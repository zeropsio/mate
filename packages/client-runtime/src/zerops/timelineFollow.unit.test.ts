import { expect, it } from "vite-plus/test";

import { jumpedAway } from "./timelineFollow.ts";

// witness: packages/client-runtime/src/zerops/timelineFollow.ts | const viewportGrew = current.clientHeight - previous.clientHeight; → const viewportGrew = 0;
it("ZV154: A list at its end that the browser clamps up because its viewport grew taller is no jump away; breaks: a person who maximises the window stops following the conversation until the next turn.", () => {
  expect(
    jumpedAway({
      previous: { scrollTop: 5834, contentHeight: 6594, clientHeight: 760 },
      current: { scrollTop: 5594, contentHeight: 6594, clientHeight: 1000 },
    }),
  ).toBe(false);
  // Find in page or a fragment link moving the list as far with the viewport unchanged still leaves the end.
  expect(
    jumpedAway({
      previous: { scrollTop: 5834, contentHeight: 6594, clientHeight: 1000 },
      current: { scrollTop: 5594, contentHeight: 6594, clientHeight: 1000 },
    }),
  ).toBe(true);
});
