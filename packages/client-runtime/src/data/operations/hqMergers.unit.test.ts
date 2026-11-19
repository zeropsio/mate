import { expect, it } from "vite-plus/test";
import { sameMergers } from "./hqMergers.ts";

// witness: packages/client-runtime/src/data/operations/hqMergers.ts | if (a === null || b === null) return a === b; → if (a === null || b === null) return (a?.length ?? 0) === (b?.length ?? 0);
it("OP26: Who may merge is the same people in any order, and no limit is never the same as an empty list", () => {
  expect(sameMergers(["u-ada", "u-sam"], ["u-sam", "u-ada"])).toBe(true);
  expect(sameMergers(["u-ada"], ["u-ada", "u-sam"])).toBe(false);
  expect(sameMergers(null, [])).toBe(false);
  expect(sameMergers(null, null)).toBe(true);
});
