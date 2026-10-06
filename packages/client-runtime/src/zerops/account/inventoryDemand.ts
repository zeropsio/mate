/** Navigation demand follows the active organization; detail comes from route/action leases. */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { isZcpService } from "../containerAddress.ts";
import { serviceRecordToZeropsService } from "../data/dto.ts";

import { grantRoundInFlight, type Evidence, type GrantMachine } from "../data/access/grant.ts";
import {
  evidenceProjectRefs,
  inventoryProjectRefs,
  pendingDenials,
  projectsNeverSeen,
} from "../data/access/grantProjects.ts";
import { interestKeyOf, type ManagedZeropsDataRuntime } from "../data/runtime.ts";
import {
  projectKeyOf,
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
  readonly openedServices: ReadonlyArray<{
    readonly project: ProjectRef;
    readonly serviceIds: ReadonlyArray<string>;
    readonly detail: boolean;
    readonly mateServiceIds: ReadonlyArray<string>;
  }>;
}
export function inventoryDemand(
  input: InventoryDemandInput,
): ReadonlyArray<RuntimeInterestDescriptor> {
  const organizations = (
    heldEvidence(input.grant)?.account.organizations ??
    grantRoundInFlight(input.grant)?.organizations ??
    []
  ).filter(({ organization }) => organization.organizationId === input.activeOrganizationId);
  const opened = new Map<string, InventoryDemandInput["openedServices"][number]>();
  for (const entry of input.openedServices) {
    const key = projectKeyOf(entry.project);
    if (entry.detail || !opened.has(key)) opened.set(key, entry);
  }
  return [
    ...organizations.map(({ organization }): RuntimeInterestDescriptor => ({
      kind: "organization-inventory",
      organization,
    })),
    ...[...opened.values()]
      .filter(
        ({ project, serviceIds }) =>
          project.organization.organizationId === input.activeOrganizationId &&
          serviceIds.length > 0,
      )
      .flatMap(
        ({
          project,
          serviceIds,
          detail,
          mateServiceIds,
        }): ReadonlyArray<RuntimeInterestDescriptor> =>
          detail
            ? [{ kind: "project-variables", project, serviceIds }]
            : mateServiceIds.length === 0
              ? []
              : [{ kind: "project-variables", project, serviceIds: mateServiceIds }],
      ),
  ];
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
        openedServices: [...get(data.stateAtom).interests.values()]
          .filter(
            ({ descriptor, leases }) =>
              leases > 0 &&
              (descriptor.kind === "project-inventory" || descriptor.kind === "project-topology"),
          )
          .flatMap(({ descriptor }) => {
            if (!("project" in descriptor)) return [];
            const services = get(data.reads.servicesOf(descriptor.project));
            return [
              {
                project: descriptor.project,
                detail: descriptor.kind === "project-topology",
                mateServiceIds: services.value.flatMap((value) => {
                  if (value.knowledge !== "observed") return [];
                  const service = serviceRecordToZeropsService(value.record);
                  return service !== null && isZcpService(service)
                    ? [value.record.ref.serviceId]
                    : [];
                }),
                serviceIds: services.value.flatMap((value) =>
                  value.knowledge === "observed" ? [value.record.ref.serviceId] : [],
                ),
              },
            ];
          }),
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

/** Admission demand comes from project-scoped leases, not from navigation rows. */
export const holdAccessDemand = (input: {
  readonly data: ManagedZeropsDataRuntime;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wanted = yield* Queue.sliding<ReadonlyArray<ProjectRef>>(1);
    const demand = Atom.make((get) => {
      const projects = new Map<string, ProjectRef>();
      for (const { descriptor, leases } of get(input.data.stateAtom).interests.values()) {
        if (leases > 0 && "project" in descriptor)
          projects.set(projectKeyOf(descriptor.project), descriptor.project);
      }
      return [...projects.values()];
    });
    let last = "";
    const unsubscribe = input.atomRegistry.subscribe(
      demand,
      (projects) => {
        const key = projects.map(projectKeyOf).sort().join(",");
        if (key === last) return;
        last = key;
        Queue.offerUnsafe(wanted, projects);
      },
      { immediate: true },
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    yield* Queue.take(wanted).pipe(
      Effect.flatMap((projects) =>
        input.data.access.signal({ type: "PROJECTS_DEMANDED", projects }),
      ),
      Effect.forever,
      Effect.forkScoped,
    );
  });

export { evidenceProjectRefs, inventoryProjectRefs, pendingDenials, projectsNeverSeen };
