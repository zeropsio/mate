/**
 * The account's inventory demand (DESIGN §5 L7): which organization and project inventories the
 * account runtime holds, read off its grant and the data runtime's own records.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { account, organization, project, scope } from "../data/__fixtures__/index.ts";
import {
  initialGrant,
  transitionGrant,
  type GrantEvent,
  type GrantMachine,
  type Instant,
  type ProjectOutcome,
} from "../data/access/grant.ts";
import type { AccessVerifier } from "../data/access/verifier.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "../data/policy.ts";
import { makeZeropsDataRuntime } from "../data/runtime.ts";
import {
  AccountEpoch,
  type AccessState,
  type ProjectEffectiveAccess,
  type ProjectRef,
  type RuntimeInterestDescriptor,
  type ZeropsDataAdapter,
} from "../data/types.ts";
import {
  heldEvidence,
  holdInventoryDemand,
  inventoryDemand,
  inventoryProjectRefs,
} from "./inventoryDemand.ts";

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

describe("holdInventoryDemand", () => {
  /** Lets every task already scheduled run, the scheduled publication among them. */
  const settle = Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn++) {
      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
      yield* Effect.yieldNow;
    }
  });

  /** Every socket login waits forever, so no establishment publishes anything of its own. */
  const silentAdapter: ZeropsDataAdapter = {
    openReceiver: () => Effect.never,
    register: () => Effect.never,
    read: () => Effect.never,
    execute: () => Effect.never,
    closeReceiver: () => Effect.void,
  };

  /** Each round lists the organization and `projects`, and verifies every one as owned. */
  const verifying = (projects: ReadonlyArray<ProjectRef>): AccessVerifier => ({
    verifyRound: ({ round, report }) =>
      Effect.gen(function* () {
        yield* report({ type: "ROUND_ACCOUNT", round, organizations, projects });
        for (const ref of projects)
          yield* report({ type: "ROUND_PROJECT", round, project: ref, outcome: owner(ref) });
      }),
    verifyProject: () => Effect.never,
  });

  it.effect("38 leases taken in one reconcile publish the root once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const projects = Array.from({ length: 38 }, (_, index) => project(`project-${index}`));
        const registry = AtomRegistry.make();
        let opaque = 0;
        const data = yield* makeZeropsDataRuntime({
          scope: scope(),
          adapter: silentAdapter,
          atomRegistry: registry,
          makeOpaqueId: () => `opaque-${++opaque}`,
        });
        yield* Effect.addFinalizer(() =>
          data
            .shutdown("application-close")
            .pipe(Effect.andThen(Effect.sync(() => registry.dispose()))),
        );
        yield* data.access.start({ verifier: verifying(projects), hidden: false, online: true });
        yield* settle;
        expect(heldEvidence(registry.get(data.access.view).machine)?.projects.size).toBe(38);

        let published = 0;
        const unsubscribe = registry.subscribe(data.stateAtom, () => {
          published += 1;
        });
        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
        yield* holdInventoryDemand({ data, atomRegistry: registry });
        yield* settle;

        const held = [...(yield* data.state).interests.values()].filter(({ leases }) => leases > 0);
        expect(held).toHaveLength(39);
        expect(published).toBe(1);
      }),
    ),
  );
});
