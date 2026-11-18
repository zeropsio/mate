import type { UsageReport } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { agentUsageId, agentUsageScope } from "../families/agentUsage.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { agentUsage } from "./agentUsage.ts";

const key = { orgId: "org", owner: "query" };
const report = { totals: { records: "1" } } as UsageReport;
const baseline: AccountInput = {
  kind: "baseline-commit",
  scope: agentUsageScope(key.orgId, key.owner),
  generation: 0,
  via: "hq-stream",
  members: [agentUsageId(key.orgId, key.owner)],
  rows: [
    {
      family: "agentUsage",
      id: agentUsageId(key.orgId, key.owner),
      value: report,
      revision: { kind: "hq", incarnation: "hq", revision: 1 },
    },
  ],
};
const usageOf = (inputs: ReadonlyArray<AccountInput>) =>
  agentUsage.derive(
    readsOfState(inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount)),
    key,
  );

// witness: packages/client-runtime/src/data/projections/agentUsage.ts | if (fact.kind === "withheld" || stream.fault !== null) → if (stream.fault !== null)
it("PJ49: An unread usage report never claims zero consumption, and a denied one withholds the consumption it protected", () => {
  expect(usageOf([])).toMatchObject({ kind: "reading" });
  expect(
    usageOf([
      baseline,
      {
        kind: "access",
        family: "agentUsage",
        id: agentUsageId(key.orgId, key.owner),
        access: "denied",
      },
    ]),
  ).toMatchObject({ kind: "unavailable" });
});
