/** Navigation demand follows the active organization; detail comes from route/action leases. */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { projectStandingAtom, shownProjectsAtom } from "../../data/reads.ts";
import { grantRoundInFlight, type Evidence, type GrantMachine } from "../data/access/grant.ts";
import type { GrantSignal } from "../data/access/grantDriver.ts";
import {
  evidenceProjectRefs,
  inventoryProjectRefs,
  projectsNeverSeen,
} from "../data/access/grantProjects.ts";
import { interestKeyOf, type ManagedZeropsDataRuntime } from "../data/runtime.ts";
import {
  projectKeyOf,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type InterestKey,
  type InterestLease,
  type ProjectRef,
  type RuntimeInterestDescriptor,
} from "../data/types.ts";

/** The evidence a grant holds: its own while granted, its last while lapsed. */
export const heldEvidence = (grant: GrantMachine): Evidence | null =>
  grant.phase.phase === "granted"
    ? grant.phase.evidence
    : grant.phase.phase === "lapsed"
      ? grant.phase.last
      : null;

export interface InventoryDemandInput {
  readonly activeOrganizationId: string | null;
  readonly grant: GrantMachine;
}

/** The active organization's inventory, while the grant names it: what the account demands. */
export function inventoryDemand(
  input: InventoryDemandInput,
): ReadonlyArray<RuntimeInterestDescriptor> {
  return (
    heldEvidence(input.grant)?.account.organizations ??
    grantRoundInFlight(input.grant)?.organizations ??
    []
  )
    .filter(({ organization }) => organization.organizationId === input.activeOrganizationId)
    .map(({ organization }) => ({ kind: "organization-inventory", organization }));
}

/**
 * Holds the account's inventory demand on its data runtime until the scope closes: a lease for
 * each inventory `inventoryDemand` names, taken as it is named and released as it stops being.
 * The inventories named together are leased together, so the account hears them in one
 * publication.
 */
export const holdInventoryDemand = (input: {
  readonly activeOrganization: Atom.Atom<string | null>;
  readonly data: ManagedZeropsDataRuntime;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { data, atomRegistry } = input;
    const demand = Atom.make((get) =>
      inventoryDemand({
        activeOrganizationId: get(input.activeOrganization),
        grant: get(data.access.view).machine,
      }),
    );
    const wanted = yield* Queue.sliding<ReadonlyArray<RuntimeInterestDescriptor>>(1);
    /** Each lease held, by its interest's key. */
    const held = new Map<InterestKey, InterestLease>();
    // Closed after the reconcile below is interrupted, it releases whatever is still held.
    const leases = yield* Scope.make();
    yield* Effect.addFinalizer((exit) => Scope.close(leases, exit));
    const reconcile = (descriptors: ReadonlyArray<RuntimeInterestDescriptor>) =>
      Effect.gen(function* () {
        const next = new Map(
          descriptors.map((descriptor) => [interestKeyOf(descriptor), descriptor]),
        );
        for (const [key, lease] of held) {
          if (next.has(key)) continue;
          held.delete(key);
          yield* lease.release;
        }
        const missing = [...next].filter(([key]) => !held.has(key));
        if (missing.length === 0) return;
        const taken = yield* data
          .acquireMany(missing.map(([, descriptor]) => descriptor))
          .pipe(Scope.provide(leases));
        // A lease the runtime refuses is asked for again when the demand next changes.
        taken.forEach((result, index) => {
          if (Result.isSuccess(result)) held.set(missing[index]![0], result.success);
        });
      });
    yield* Queue.take(wanted).pipe(Effect.flatMap(reconcile), Effect.forever, Effect.forkScoped);
    const unsubscribe = atomRegistry.subscribe(demand, (next) => Queue.offerUnsafe(wanted, next), {
      immediate: true,
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  });

/**
 * The projects the grant judges are the ones the shown organization's roster lists: Zerops filters
 * that listing by the viewer's token, so a listed project is the viewer's at once, judged on the
 * row the account's store holds, and no screen has to hold it first. A listed project whose row
 * names other grants than before is judged again on it at once (an override, a lowered grant).
 */
export const holdListedAccess = (input: {
  readonly data: ManagedZeropsDataRuntime;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wanted = yield* Queue.unbounded<ReadonlyArray<GrantSignal>>();
    const account = input.data.scope.account;
    type Listed = { readonly ref: ProjectRef; readonly grants: string };
    const listed = Atom.make((get): ReadonlyArray<Listed> => {
      const { orgId, projects } = get(shownProjectsAtom);
      if (orgId === null) return [];
      const organization = {
        kind: "organization" as const,
        account,
        organizationId: ZeropsOrganizationId.make(orgId),
      };
      return projects.map(({ id, userRoles, viewerRoleCode }) => ({
        ref: { kind: "project", organization, projectId: ZeropsProjectId.make(id) },
        grants: JSON.stringify([userRoles ?? null, viewerRoleCode ?? null]),
      }));
    });
    let last = new Map<ReturnType<typeof projectKeyOf>, Listed>();
    const unsubscribe = input.atomRegistry.subscribe(
      listed,
      (entries) => {
        const next = new Map(entries.map((entry) => [projectKeyOf(entry.ref), entry]));
        const regranted = [...next].flatMap(
          ([key, { ref, grants }]): ReadonlyArray<GrantSignal> => {
            const before = last.get(key);
            return before === undefined || before.grants === grants
              ? []
              : [{ type: "PROJECT_GRANTS_CHANGED", project: ref }];
          },
        );
        const same = next.size === last.size && [...next.keys()].every((key) => last.has(key));
        // A project the roster stops listing because its owner refused it, or proved it deleted,
        // is that project's denial: the grant closes it at once.
        const denied = [...last]
          .filter(([key]) => !next.has(key))
          .flatMap(([, { ref }]): ReadonlyArray<GrantSignal> => {
            const standing = input.atomRegistry.get(projectStandingAtom(ref.projectId));
            return standing.kind === "denied" || standing.kind === "deleted"
              ? [
                  {
                    type: "PROJECT_DENIED",
                    project: ref,
                    evidence: standing.kind === "denied" ? "direct-forbidden" : "direct-not-found",
                  },
                ]
              : [];
          });
        last = next;
        const demanded: ReadonlyArray<GrantSignal> = same
          ? []
          : [{ type: "PROJECTS_DEMANDED", projects: entries.map(({ ref }) => ref) }];
        const signals = [...denied, ...demanded, ...regranted];
        if (signals.length > 0) Queue.offerUnsafe(wanted, signals);
      },
      { immediate: true },
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    yield* Queue.take(wanted).pipe(
      Effect.flatMap((signals) =>
        Effect.forEach(signals, (signal) => input.data.access.signal(signal), { discard: true }),
      ),
      Effect.forever,
      Effect.forkScoped,
    );
  });

export { evidenceProjectRefs, inventoryProjectRefs, projectsNeverSeen };
