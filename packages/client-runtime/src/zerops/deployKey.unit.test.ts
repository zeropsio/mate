import { expect, it } from "vite-plus/test";
import { deployKeyTrouble } from "./hq/refusals.ts";

// witness: packages/client-runtime/src/zerops/hq/refusals.ts | ["dead", "'s deploy token no longer answers; "], → ["dead", "'s deploy token has expired; "],
it("ZV+1: HQ's sentences that an environment has no deploy token, that it no longer answers and that it reaches more than its project are told apart as missing, dead and widened wherever they stand in a reason, and any other reason as none; breaks: a release stopped on production's key shows a failed deploy with no renewal.", () => {
  const rows = [
    ["stage has no deploy token; renew it in Zerops Mate", "missing"],
    ["stage's deploy token no longer answers; renew it in Zerops Mate", "dead"],
    ["stage's deploy token reaches more than its project; renew it in Zerops Mate", "widened"],
  ] as const;
  for (const [reason, kind] of rows) {
    expect(deployKeyTrouble(reason)).toBe(kind);
    expect(deployKeyTrouble(`Deploy stopped: ${reason}; try again later`)).toBe(kind);
  }
  expect(deployKeyTrouble("Build failed")).toBeUndefined();
  expect(
    deployKeyTrouble(
      "stage's deploy token no longer answers; a person with admin access to its project renews it in Zerops Mate",
    ),
  ).toBeUndefined();
});
