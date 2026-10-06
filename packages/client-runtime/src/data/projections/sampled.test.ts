import { describe, expect, it } from "vite-plus/test";

import { ORG } from "../__fixtures__/account.ts";
import { locationsScope } from "../families/organizationLocations.ts";
import { membersScope } from "../families/organizationMembers.ts";
import { agentsScope } from "../families/serviceAgents.ts";
import { emptyAccount, type AccountState, type Family, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamOutcome } from "../streamMachine.ts";
import {
  organizationLocations,
  organizationMembers,
  servicesAgents,
  type MembersRead,
} from "./sampled.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

/** A sampled scope demanded and its read begun: what a screen sees before the answer. */
const begun = (scope: ScopeKey): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
];
/** The read answered: the owner's value committed whole, and the scope live. */
const answered = (scope: ScopeKey, family: Family, value: unknown): ReadonlyArray<AccountInput> => {
  const ownerId = scope.split(":").slice(3).join(":");
  const generation = 1;
  const row = { family, id: ownerId, value, revision: { kind: "zerops", version: null } } as Row;
  return [
    { kind: "baseline-begin", scope, generation },
    {
      kind: "baseline-commit",
      scope,
      generation,
      via: "zerops-read",
      members: [ownerId],
      rows: [row],
    },
    event(scope, { kind: "baseline-committed" }),
  ];
};
const failed = (scope: ScopeKey, outcome: StreamOutcome): AccountInput =>
  event(scope, { kind: "fault", jitter: 0, fault: { outcome, message: outcome } });
const revalidating = (scope: ScopeKey) => event(scope, { kind: "revalidate" });

const MEMBERS = membersScope(ORG);
const ANNA = { id: "cu1", user: { id: "u1", fullName: "Anna" } };

describe("a sampled read, as a screen reads it", () => {
  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<AccountInput>;
    readonly expected: MembersRead;
  }>([
    {
      name: "nothing demanded: loading, no value",
      inputs: [],
      expected: { members: [], status: "loading", settled: false, refused: false },
    },
    {
      name: "being read the first time: loading",
      inputs: begun(MEMBERS),
      expected: { members: [], status: "loading", settled: false, refused: false },
    },
    {
      name: "answered: ready and settled",
      inputs: [...begun(MEMBERS), ...answered(MEMBERS, "organizationMembers", [ANNA])],
      expected: { members: [ANNA], status: "ready", settled: true, refused: false },
    },
    {
      name: "read again on its cadence: its value shown, not settled",
      inputs: [
        ...begun(MEMBERS),
        ...answered(MEMBERS, "organizationMembers", [ANNA]),
        revalidating(MEMBERS),
      ],
      expected: { members: [ANNA], status: "ready", settled: false, refused: false },
    },
    {
      name: "its read lost on the way, nothing read: failed, retried",
      inputs: [...begun(MEMBERS), failed(MEMBERS, "transient")],
      expected: { members: [], status: "failed", settled: false, refused: false },
    },
    {
      name: "a revalidation lost on the way: the value stays, not settled",
      inputs: [
        ...begun(MEMBERS),
        ...answered(MEMBERS, "organizationMembers", [ANNA]),
        revalidating(MEMBERS),
        failed(MEMBERS, "transient"),
      ],
      expected: { members: [ANNA], status: "ready", settled: false, refused: false },
    },
    {
      name: "refused by its owner: failed for good",
      inputs: [...begun(MEMBERS), failed(MEMBERS, "authoritative-denial")],
      expected: { members: [], status: "failed", settled: false, refused: true },
    },
  ])("$name", ({ inputs, expected }) => {
    const reads = readsOfState(apply(emptyAccount, inputs));
    expect(organizationMembers.derive(reads, { orgId: ORG, clientId: ORG })).toEqual(expected);
  });

  it("reads an organization's locations the same way, under their own scope", () => {
    const place = { id: "l1", name: "Prague", pingUrl: "https://ping" };
    const scope = locationsScope(ORG);
    const reads = readsOfState(
      apply(emptyAccount, [...begun(scope), ...answered(scope, "organizationLocations", [place])]),
    );
    expect(organizationLocations.derive(reads, ORG)).toEqual({
      locations: [place],
      status: "ready",
    });
    expect(organizationMembers.derive(reads, { orgId: ORG, clientId: ORG }).status).toBe("loading");
  });

  it("answers each service's agents apart: read, failed, and not read yet", () => {
    const reads = readsOfState(
      apply(emptyAccount, [
        ...begun(agentsScope(ORG, "s1")),
        ...answered(agentsScope(ORG, "s1"), "serviceAgents", ["codex"]),
        ...begun(agentsScope(ORG, "s2")),
        failed(agentsScope(ORG, "s2"), "transient"),
      ]),
    );
    const agents = servicesAgents.derive(reads, { orgId: ORG, serviceIds: ["s1", "s2", "s3"] });
    expect(agents.s1).toMatchObject({ value: ["codex"], status: "ready" });
    expect(agents.s2).toMatchObject({ value: undefined, status: "failed" });
    expect(agents.s3).toMatchObject({ value: undefined, status: "loading" });
  });
});
