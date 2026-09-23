/**
 * The account's inventory demand (DESIGN §5 L7): which organization and project inventories the
 * account runtime holds, read off its grant and the data runtime's own records.
 */
import { describe, expect, it } from "@effect/vitest";

import { account, organization, project } from "../data/__fixtures__/index.ts";
import {
  initialGrant,
  transitionGrant,
  type GrantEvent,
  type GrantMachine,
  type Instant,
  type ProjectOutcome,
} from "../data/access/grant.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "../data/policy.ts";
import {
  AccountEpoch,
  type AccessState,
  type ProjectEffectiveAccess,
  type ProjectRef,
  type RuntimeInterestDescriptor,
} from "../data/types.ts";
import { inventoryDemand, inventoryProjectRefs } from "./inventoryDemand.ts";

const MINUTE = 60_000;
const T0: Instant = { wall: Date.UTC(2026, 8, 23, 10, 0, 0), mono: 10 * MINUTE };
const A = project("project-a");
const B = project("project-b");
const C = project("project-c");
const organizations = [{ organization, mutationsAllowed: true }];

const owner = (ref: ProjectRef, role: ProjectEffectiveAccess["role"] = "OWNER") =>
  ({ kind: "verified", access: { project: ref, role, mutationsAllowed: true } }) as const;

/** The first round: its account part lists A and B, then each project answers as given. */
const firstRound = (
  outcomes: { readonly a?: ProjectOutcome; readonly b?: ProjectOutcome } = {},
): ReadonlyArray<GrantEvent> => [
  { type: "START" },
  { type: "ROUND_ACCOUNT", round: 1, organizations, projects: [A, B] },
  ...(outcomes.a === undefined
    ? []
    : [{ type: "ROUND_PROJECT", round: 1, project: A, outcome: outcomes.a } as const]),
  ...(outcomes.b === undefined
    ? []
    : [{ type: "ROUND_PROJECT", round: 1, project: B, outcome: outcomes.b } as const]),
];
const granted = firstRound({ a: owner(A), b: owner(B) });

/** The grant after `events`, each at `T0` unless it names its own moment. */
const drive = (
  events: ReadonlyArray<GrantEvent | { readonly at: Instant; readonly event: GrantEvent }>,
): GrantMachine =>
  events.reduce(
    (machine, step) => {
      const { at, event } = "event" in step ? step : { at: T0, event: step };
      return transitionGrant(machine, event, { now: at, policy: DEFAULT_ZEROPS_GRANT_POLICY })
        .state;
    },
    initialGrant({ hidden: false, online: true }, T0),
  );

const verifiedWith = (projects: ReadonlyArray<ProjectEffectiveAccess>): AccessState => ({
  status: "verified",
  account,
  accountEpoch: AccountEpoch.make(1),
  verifiedAtMs: T0.wall,
  deadlineMs: T0.wall + 15 * MINUTE,
  mutationsAllowed: true,
  organizations,
  projects,
});
const ownerOf = (ref: ProjectRef): ProjectEffectiveAccess => ({
  project: ref,
  role: "OWNER",
  mutationsAllowed: true,
});

/** A demand as a person reads it: `organization` or the project's id. */
const named = (descriptor: RuntimeInterestDescriptor) =>
  descriptor.kind === "organization-inventory"
    ? "organization"
    : descriptor.kind === "project-inventory"
      ? descriptor.project.projectId
      : descriptor.kind;

interface DemandRow {
  readonly name: string;
  readonly grant: GrantMachine;
  readonly access?: AccessState;
  /** Each project's status as the data runtime holds it, by id; unread when absent. */
  readonly status?: Readonly<Record<string, string>>;
  readonly expected: ReadonlyArray<string>;
}

describe("inventoryDemand", () => {
  it.each<DemandRow>([
    {
      name: "nothing before a round lists the account's organizations",
      grant: drive([{ type: "START" }]),
      expected: [],
    },
    {
      name: "the organizations the first round listed, before any project answered",
      grant: drive(firstRound()),
      expected: ["organization"],
    },
    {
      name: "every project the grant names: verified, and unverified after a failed read",
      grant: drive(
        firstRound({
          a: owner(A),
          b: { kind: "failed", failure: { kind: "server", status: 503 } },
        }),
      ),
      expected: ["organization", "project-a", "project-b"],
    },
    {
      name: "not a project a denial withholds until its confirming read (G6)",
      grant: drive(
        firstRound({ a: owner(A), b: { kind: "denied", evidence: "direct-forbidden" } }),
      ),
      expected: ["organization", "project-a"],
    },
    {
      name: "not a project the grant admits with no access",
      grant: drive(firstRound({ a: owner(A), b: owner(B, "NO_ACCESS") })),
      expected: ["organization", "project-a"],
    },
    {
      name: "not a project the data runtime holds as anything but ACTIVE",
      grant: drive(granted),
      status: { "project-b": "STOPPED" },
      expected: ["organization", "project-a"],
    },
    {
      name: "a project a command established that no evidence names yet",
      grant: drive(granted),
      access: verifiedWith([A, B, C].map(ownerOf)),
      expected: ["organization", "project-a", "project-b", "project-c"],
    },
    {
      name: "the last evidence while the grant is lapsed (L3)",
      grant: drive([
        ...granted,
        {
          at: { wall: T0.wall + 16 * MINUTE, mono: T0.mono + 16 * MINUTE },
          event: { type: "TICK" },
        },
      ]),
      expected: ["organization", "project-a", "project-b"],
    },
    {
      name: "nothing once the epoch closed",
      grant: drive([...granted, { type: "EPOCH_CLOSED" }]),
      expected: [],
    },
  ])("demands $name", ({ grant, access, status, expected }) => {
    const demand = inventoryDemand({
      grant,
      access: access ?? { status: "unverified" },
      projectStatus: (ref) => status?.[ref.projectId],
    });
    expect(demand.map(named)).toEqual(expected);
  });
});

describe("inventoryProjectRefs", () => {
  it("includes command-established project access before external membership refresh", () => {
    const access = verifiedWith([
      { project: A, role: "ADMIN", mutationsAllowed: true },
      ownerOf(C),
      { project: project("denied"), role: "NO_ACCESS", mutationsAllowed: false },
    ]);

    expect(inventoryProjectRefs([A], access)).toEqual([A, C]);
  });
});
