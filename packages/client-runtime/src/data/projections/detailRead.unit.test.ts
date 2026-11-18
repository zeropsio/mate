import { expect, it } from "vite-plus/test";

import { detailReadAnswer } from "./detailRead.ts";

// witness: packages/client-runtime/src/data/projections/detailRead.ts | if (detail === "live") return owed ? null : true; → if (detail === "live") return true;
it("PJ13: A detail asked to be read afresh answers a read only once that read has ended, never while it is still live from before", () => {
  expect(detailReadAnswer("live", "live", false)).toBe(true);
  expect(detailReadAnswer("live", "live", true)).toBe(null);
  expect(detailReadAnswer("connecting", "live", true)).toBe(null);
  expect(detailReadAnswer("recovering", "live", true)).toBe(false);
});
