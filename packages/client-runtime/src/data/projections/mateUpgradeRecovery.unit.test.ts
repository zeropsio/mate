import { expect, it } from "vite-plus/test";
import { upgradeRecoveryFromEvidence } from "./mateUpgradeRecovery.ts";
const accepted = { stage: "accepted", operationId: "restart" } as const;
const current = "0.16.0";
// witness: packages/client-runtime/src/data/projections/mateUpgradeRecovery.ts | returned && verdict.level === "ready" → verdict.level === "ready"
it("PJ61: An old ready descriptor cannot complete a restart whose return is not proved", () => {
  expect(
    upgradeRecoveryFromEvidence({
      progress: accepted,
      verdict: { level: "ready" },
      serverVersion: current,
      returned: false,
    }),
  ).toEqual({ state: "waiting" });
});
