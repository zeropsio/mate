import { expect, it } from "vite-plus/test";

import { usageOwnerOf, usageScope, type ContainerUsage } from "../families/usage.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectUsage } from "./usage.ts";

const ORG = "org";
const OWNER = usageOwnerOf(ORG, "p1");
const USAGE = usageScope(ORG, OWNER);

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;
const answered = (
  scope: ScopeKey,
  rows: ReadonlyArray<{ readonly id: string; readonly value: ContainerUsage }>,
): ReadonlyArray<AccountInput> => [
  event(linkKeys.zerops(ORG), { kind: "demand", demanded: true }),
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
  { kind: "baseline-begin", scope, generation: 1 },
  {
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-realtime",
    members: rows.map((row) => row.id),
    rows: rows.map(
      (row) =>
        ({
          family: "usage",
          id: row.id,
          value: row.value,
          revision: { kind: "zerops", version: null },
        }) as never,
    ),
    partial: false,
  },
  event(scope, { kind: "baseline-committed" }),
];

const pair = (used: number, limit: number) => ({ used, limit });
const SHARED = { cores: pair(0.25, 1), memoryGb: pair(0.5, 1), diskGb: pair(1, 5) };
const container = (
  containerId: string,
  serviceId: string,
  figures: Partial<ContainerUsage> = {},
): { readonly id: string; readonly value: ContainerUsage } => ({
  id: containerId,
  value: {
    serviceId,
    containerId,
    cpu: pair(0, 0),
    vCpu: pair(0.25, 1),
    ramGBytes: pair(0.5, 1),
    diskGBytes: pair(1, 5),
    ...figures,
  },
});

// witness: packages/client-runtime/src/data/projections/usage.ts | memoryGb: add(sum.memoryGb, container.ramGBytes), → memoryGb: add(sum.memoryGb, container.ramGBytes ?? NONE),
it("PJ20: A service whose container leaves a usage figure unsaid has unknown use, never zero", () => {
  const reads = readsOfState(
    apply(
      emptyAccount,
      answered(USAGE, [container("c1", "s1", { ramGBytes: null }), container("c2", "s2")]),
    ),
  );
  expect(projectUsage.derive(reads, { orgId: ORG, owner: OWNER }).byService).toEqual({
    s2: { containers: 1, ...SHARED },
  });
});
