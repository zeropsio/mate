import { expect, it } from "vite-plus/test";

import { emptyAccount } from "../model.ts";
import { reduceAccount } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { flowAnswer } from "./flowAnswer.ts";

const RELEASE = {
  kind: "release",
  orgId: "org",
  appId: "shop",
  tag: "v1.0.1",
  groupHead: "b".repeat(40),
  entries: [],
} as const;
const RELEASED = { appId: "shop", cause: "release", ref: "v1.0.1" } as const;

// witness: packages/client-runtime/src/data/projections/flowAnswer.ts | const tag = result?.tag ?? receipt.operationId; → const tag = result?.tag;
it("PJ48: A release adopted after its answer was lost answers with its tag and its rollout, its deploys unknown", () => {
  const recorded = reduceAccount(emptyAccount, {
    kind: "operation-recorded",
    requestId: "r1",
    intent: RELEASE,
  }).state;
  const adopted = reduceAccount(recorded, {
    kind: "operation-receipt",
    receipt: {
      requestId: "r1",
      operationId: "v1.0.1",
      executor: "hq",
      affected: [],
      handles: ["v1.0.1"],
      acceptance: { kind: "accepted" },
      outcome: { kind: "pending" },
    },
  }).state;
  expect(flowAnswer.derive(readsOfState(adopted), "r1")).toEqual({
    tag: "v1.0.1",
    deploys: undefined,
    rollout: RELEASED,
  });
});
