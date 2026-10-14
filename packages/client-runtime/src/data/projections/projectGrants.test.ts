import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, projectValue } from "../__fixtures__/account.ts";
import { detailScopeOf } from "../demand.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamOutcome } from "../streamMachine.ts";
import { projectsGrants, type ProjectGrantsRead } from "./projectGrants.ts";

const OWN_ROW = detailScopeOf(ORG, { family: "project", listing: "project", ownerId: "p" });
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (streamEvent: object): AccountInput =>
  ({ kind: "stream", key: OWN_ROW, now: 0, event: streamEvent }) as AccountInput;

const held: ReadonlyArray<AccountInput> = [
  event({ kind: "demand", demanded: true }),
  event({ kind: "attempt" }),
  event({ kind: "handshake" }),
];
/** The own row answered, naming these grants. */
const answered = (
  userRoles: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>,
): ReadonlyArray<AccountInput> => [
  { kind: "baseline-begin", scope: OWN_ROW, generation: 1 },
  {
    kind: "baseline-commit",
    scope: OWN_ROW,
    generation: 1,
    via: "zerops-read",
    members: ["p"],
    rows: [
      {
        family: "project",
        id: "p",
        value: projectValue({ id: "p", userRoles, lastUpdate: "2026-10-14T10:00:00Z" }),
        revision: { kind: "zerops", version: null },
      },
    ],
  },
  event({ kind: "baseline-committed" }),
];
const fault = (outcome: StreamOutcome): AccountInput =>
  event({ kind: "fault", jitter: 0, fault: { outcome, message: outcome } });

const ADA = { clientUserId: "cu-ada", roleCode: "READ_ONLY" };
const listed = () => apply(emptyAccount, liveZerops({ running: [], projects: [{ id: "p" }] }));

describe("a project's grants, as its own row names them", () => {
  it.each<{
    readonly name: string;
    readonly state: () => AccountState;
    readonly read: ProjectGrantsRead;
  }>([
    {
      name: "a project only listed names nobody's grants yet: reading",
      state: listed,
      read: { grants: undefined, status: "loading" },
    },
    {
      name: "its own row held and not answered yet: reading",
      state: () => apply(listed(), held),
      read: { grants: undefined, status: "loading" },
    },
    {
      name: "its own row answered: everybody's grants, read",
      state: () => apply(listed(), [...held, ...answered([ADA])]),
      read: { grants: [ADA], status: "ready" },
    },
    {
      name: "its own row answered naming nobody: no grants, read",
      state: () => apply(listed(), [...held, ...answered([])]),
      read: { grants: [], status: "ready" },
    },
    {
      name: "its own row refused: failed",
      state: () => apply(listed(), [...held, fault("definitive-refusal")]),
      read: { grants: undefined, status: "failed" },
    },
    {
      name: "a read again failing keeps the grants it had, failed",
      state: () => apply(listed(), [...held, ...answered([ADA]), fault("transient")]),
      read: { grants: [ADA], status: "failed" },
    },
  ])("$name", ({ state, read }) => {
    expect(
      projectsGrants.derive(readsOfState(state()), { orgId: ORG, projectIds: ["p"] })["p"],
    ).toEqual(read);
  });
});
