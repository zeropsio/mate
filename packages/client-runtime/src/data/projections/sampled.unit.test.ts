import { expect, it } from "vite-plus/test";

import { ORG } from "../__fixtures__/account.ts";
import { membersScope } from "../families/organizationMembers.ts";
import { emptyAccount, type AccountState, type ScopeKey, type StreamKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { organizationMembers } from "./sampled.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: StreamKey, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;
const begun = (scope: ScopeKey): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
];
const answered = (scope: ScopeKey, value: unknown): ReadonlyArray<AccountInput> => {
  const ownerId = scope.split(":").slice(3).join(":");
  const row = {
    family: "organizationMembers",
    id: ownerId,
    value,
    revision: { kind: "zerops", version: null },
  } as Row;
  return [
    { kind: "baseline-begin", scope, generation: 1 },
    {
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-read",
      members: [ownerId],
      rows: [row],
    },
    event(scope, { kind: "baseline-committed" }),
  ];
};

const MEMBERS = membersScope(ORG);
const ANNA = { id: "cu1", user: { id: "u1", fullName: "Anna" } };
const members = (inputs: ReadonlyArray<AccountInput>) =>
  organizationMembers.derive(readsOfState(apply(emptyAccount, inputs)), {
    orgId: ORG,
    clientId: ORG,
  });

// witness: packages/client-runtime/src/data/projections/sampled.ts | fact.kind === "withheld" || → false ||
it("PJ17: A sampled read answered empty, one its owner withheld and one not read yet are three different answers", () => {
  expect(members([...begun(MEMBERS), ...answered(MEMBERS, [])])).toMatchObject({
    fact: { kind: "known" },
    status: "ready",
    members: [],
  });
  expect(
    members([
      ...begun(MEMBERS),
      ...answered(MEMBERS, [ANNA]),
      { kind: "access", family: "organizationMembers", id: ORG, access: "denied" } as const,
    ]),
  ).toMatchObject({ fact: { kind: "withheld" }, status: "failed", members: [] });
  expect(members([])).toMatchObject({
    members: [],
    status: "loading",
    settled: false,
    refused: false,
    fact: { kind: "unknown" },
  });
});
