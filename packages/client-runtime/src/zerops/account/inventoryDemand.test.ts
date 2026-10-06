/**
 * The account's inventory demand (DESIGN §5 L7): which organization and project inventories the
 * account runtime holds, read off its grant and the data runtime's own records.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { liveProjects, projectValue, zeropsVersion } from "../../data/__fixtures__/account.ts";
import { projectsScope, type ProjectValue } from "../../data/families/project.ts";
import { accountReadsAtom, projectStandingAtom } from "../../data/reads.ts";
import { makeAccountStore } from "../../data/store.ts";
import { account, organization, project, scope } from "../data/__fixtures__/index.ts";
import {
  initialGrant,
  transitionGrant,
  type GrantEvent,
  type GrantMachine,
  type Instant,
  type ProjectOutcome,
} from "../data/access/grant.ts";
import { makeRestAccessVerifier, type AccessVerifier } from "../data/access/verifier.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "../data/policy.ts";
import { makeZeropsDataRuntime } from "../data/runtime.ts";
import {
  AccountEpoch,
  ZeropsOrganizationId,
  type AccessState,
  type ProjectEffectiveAccess,
  type ProjectRef,
  type ZeropsDataAdapter,
} from "../data/types.ts";
import {
  heldEvidence,
  holdInventoryDemand,
  holdListedAccess,
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

describe("inventoryDemand", () => {
  it.each([null, "org-1", "org-2", "org-3"])(
    "leases inventory only for the visible org %s",
    (activeOrganizationId) => {
      const refs = ["org-1", "org-2", "org-3"].map((id) => ({
        ...organization,
        organizationId: ZeropsOrganizationId.make(id),
      }));
      const grant = drive([
        { type: "START" },
        {
          type: "ROUND_ACCOUNT",
          round: 1,
          organizations: refs.map((organization) => ({ organization, mutationsAllowed: true })),
          projects: [],
        },
      ]);
      expect(
        inventoryDemand({ activeOrganizationId, grant, openedServices: [] }).map((row) =>
          "organization" in row
            ? row.organization.organizationId
            : row.project.organization.organizationId,
        ),
      ).toEqual(activeOrganizationId === null ? [] : [activeOrganizationId]);
    },
  );
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
        const active = Atom.make<string | null>(organization.organizationId);
        yield* holdInventoryDemand({ data, atomRegistry: registry, activeOrganization: active });
        yield* settle;

        const held = [...(yield* data.state).interests.values()].filter(({ leases }) => leases > 0);
        expect(held).toHaveLength(1);
        expect(published).toBe(1);
        registry.set(active, null);
        yield* settle;
        expect(
          [...(yield* data.state).interests.values()].filter(({ leases }) => leases > 0),
        ).toEqual([]);
      }),
    ),
  );
});

it("does not turn admitted navigation projects into detail or deploy demand", () => {
  expect(
    inventoryDemand({
      activeOrganizationId: organization.organizationId,
      grant: drive(granted),
      openedServices: [],
    }).map(({ kind }) => kind),
  ).toEqual(["organization-inventory"]);
});

it("navigation reads only Mate flags; opened detail reads all variables", () => {
  const grant = drive(granted);
  const descriptors = inventoryDemand({
    activeOrganizationId: organization.organizationId,
    grant,
    openedServices: [
      { project: A, serviceIds: ["app"], detail: false, mateServiceIds: [] },
      { project: B, serviceIds: ["zcp", "app"], detail: false, mateServiceIds: ["zcp"] },
      { project: C, serviceIds: ["zcp"], detail: false, mateServiceIds: ["zcp"] },
      { project: C, serviceIds: ["app"], detail: true, mateServiceIds: [] },
    ],
  });
  expect(descriptors.filter((row) => row.kind !== "organization-inventory")).toEqual([
    { kind: "project-variables", project: B, serviceIds: ["zcp"] },
    { kind: "project-variables", project: C, serviceIds: ["app"] },
  ]);
});

describe("holdListedAccess", () => {
  const settle = Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn++) {
      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
      yield* Effect.yieldNow;
    }
  });
  const silentAdapter: ZeropsDataAdapter = {
    openReceiver: () => Effect.never,
    register: () => Effect.never,
    read: () => Effect.never,
    execute: () => Effect.never,
    closeReceiver: () => Effect.void,
  };

  it.effect(
    "the grant admits each project the shown roster lists, on its row, without reading one",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const orgId = organization.organizationId;
          const registry = AtomRegistry.make();
          const store = makeAccountStore(registry);
          liveProjects(orgId, [{ id: "project-a" }]).forEach(store.dispatch);
          registry.set(accountReadsAtom, {
            data: store.data,
            orgId,
            demandDetail: () => () => {},
            renewHeld: () => {},
          });
          const data = yield* makeZeropsDataRuntime({
            scope: scope(),
            adapter: silentAdapter,
            atomRegistry: registry,
            makeOpaqueId: () => "opaque",
          });
          yield* Effect.addFinalizer(() =>
            data
              .shutdown("application-close")
              .pipe(Effect.andThen(Effect.sync(() => registry.dispose()))),
          );
          yield* holdListedAccess({ data, atomRegistry: registry });
          yield* data.access.start({
            verifier: makeRestAccessVerifier({
              client: {
                fetchUser: async () => ({
                  id: account.accountId,
                  email: "person@example.test",
                  clientUserList: [{ id: "membership", clientId: orgId, roleCode: "OWNER" }],
                }),
              },
              standing: (ref) => registry.get(projectStandingAtom(ref.projectId)),
              account,
              onUser: () => {},
            }),
            hidden: false,
            online: true,
          });
          yield* settle;
          const admitted = () =>
            [...(heldEvidence(registry.get(data.access.view).machine)?.projects.values() ?? [])]
              .map(({ access }) => `${access.project.projectId}:${access.role}`)
              .toSorted();
          expect(admitted()).toEqual(["project-a:OWNER"]);

          // Someone creates a project anywhere: the roster lists it, and the grant admits it.
          const scopeKey = projectsScope(orgId);
          store.dispatch({
            kind: "membership",
            scope: scopeKey,
            generation: 1,
            delta: { add: ["project-b"], remove: [] },
          });
          store.dispatch({
            kind: "rows",
            scope: scopeKey,
            generation: 1,
            method: "push",
            via: "zerops-realtime",
            rows: [
              {
                family: "project",
                id: "project-b",
                value: projectValue({ id: "project-b", clientId: orgId }),
                revision: zeropsVersion(1),
              },
            ],
          });
          yield* settle;
          expect(admitted()).toEqual(["project-a:OWNER", "project-b:OWNER"]);

          // Its owner refuses project-a: the store withholds it, and the grant closes it at once.
          store.dispatch({ kind: "access", family: "project", id: "project-a", access: "denied" });
          yield* settle;
          expect(admitted()).toEqual(["project-b:OWNER"]);
          expect([
            ...(heldEvidence(registry.get(data.access.view).machine)?.closedProjects.keys() ?? []),
          ]).toEqual(["project-a"]);
        }),
      ),
  );

  it.effect(
    "a listed project whose row names other grants is judged again at once, on that row alone",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const orgId = organization.organizationId;
          const registry = AtomRegistry.make();
          const store = makeAccountStore(registry);
          const scopeKey = projectsScope(orgId);
          const push = (value: Partial<ProjectValue>, version: number) =>
            store.dispatch({
              kind: "rows",
              scope: scopeKey,
              generation: 1,
              method: "push",
              via: "zerops-realtime",
              rows: [
                {
                  family: "project",
                  id: "project-a",
                  value: { ...projectValue({ id: "project-a", clientId: orgId }), ...value },
                  revision: zeropsVersion(version),
                },
              ],
            });
          liveProjects(orgId, [{ id: "project-a" }]).forEach(store.dispatch);
          push({ viewerRoleCode: "READ_ONLY" }, 2);
          registry.set(accountReadsAtom, {
            data: store.data,
            orgId,
            demandDetail: () => () => {},
            renewHeld: () => {},
          });
          const data = yield* makeZeropsDataRuntime({
            scope: scope(),
            adapter: silentAdapter,
            atomRegistry: registry,
            makeOpaqueId: () => "opaque",
          });
          yield* Effect.addFinalizer(() =>
            data
              .shutdown("application-close")
              .pipe(Effect.andThen(Effect.sync(() => registry.dispose()))),
          );
          let judged = 0;
          yield* holdListedAccess({ data, atomRegistry: registry });
          yield* data.access.start({
            verifier: makeRestAccessVerifier({
              client: {
                fetchUser: async () => ({
                  id: account.accountId,
                  email: "person@example.test",
                  clientUserList: [{ id: "membership", clientId: orgId, roleCode: "NO_ACCESS" }],
                }),
              },
              standing: (ref) => {
                judged++;
                return registry.get(projectStandingAtom(ref.projectId));
              },
              account,
              onUser: () => {},
            }),
            hidden: false,
            online: true,
          });
          yield* settle;
          const admitted = () =>
            [
              ...(heldEvidence(registry.get(data.access.view).machine)?.projects.values() ?? []),
            ].map(({ access }) => `${access.project.projectId}:${access.role}`);
          expect(admitted()).toEqual(["project-a:READ_ONLY"]);
          const rounds = () => {
            const phase = registry.get(data.access.view).machine.phase;
            return phase.phase === "granted" ? phase.renewal.status : phase.phase;
          };

          // An override is granted the READ_ONLY member: it applies with the push that names it.
          push({ viewerRoleCode: "BASIC_USER" }, 3);
          yield* settle;
          expect(admitted()).toEqual(["project-a:BASIC_USER"]);
          expect(rounds()).toBe("idle");

          // A push that names the same grants judges nothing again.
          const before = judged;
          push({ viewerRoleCode: "BASIC_USER", name: "Renamed" }, 4);
          yield* settle;
          expect(judged).toBe(before);
        }),
      ),
  );
});
