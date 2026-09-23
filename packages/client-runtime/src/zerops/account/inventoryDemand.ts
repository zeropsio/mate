/**
 * The account's inventory demand (DESIGN §5 L7): the organization and project inventories the
 * account runtime holds for its epoch, so that no view holds them and no mount waits on them.
 *
 * - An organization is demanded once a round listed it — the first round's account part, before
 *   any of its projects answered, so the push half starts beside the grant — and from then on as
 *   the held evidence names it, through a lapse (L3).
 * - A project is demanded as the evidence names it, verified or unverified, and as a command
 *   established it; never while a denial withholds it until its confirming read (G6), and never
 *   once the data runtime holds it as anything but ACTIVE.
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { grantRoundInFlight, type Evidence, type GrantMachine } from "../data/access/grant.ts";
import { projectRecordToZeropsProject } from "../data/dto.ts";
import { interestKeyOf, type ManagedZeropsDataRuntime } from "../data/runtime.ts";
import {
  projectKeyOf,
  type AccessState,
  type InterestKey,
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

/**
 * The projects admitted evidence names: verified ones, those whose latest
 * read failed, and those a denial withholds until a confirming read (G6).
 * A confirmed denial is the only way a project leaves.
 */
export function evidenceProjectRefs(evidence: Evidence | null): ReadonlyArray<ProjectRef> {
  if (evidence === null) return [];
  const refs = new Map<string, ProjectRef>();
  for (const { access } of evidence.projects.values()) {
    if (access.role !== "NO_ACCESS") refs.set(projectKeyOf(access.project), access.project);
  }
  for (const { project } of evidence.unverified.values()) {
    if (!evidence.projects.has(project.projectId)) refs.set(projectKeyOf(project), project);
  }
  for (const { project, confirmation } of evidence.closedProjects.values()) {
    if (confirmation.status === "due") refs.set(projectKeyOf(project), project);
  }
  return [...refs.values()];
}

/** The projects a denial withholds until its confirming read (G6), by `projectKeyOf`. */
export function pendingDenials(evidence: Evidence | null): ReadonlySet<string> {
  if (evidence === null) return new Set();
  return new Set(
    [...evidence.closedProjects.values()]
      .filter(({ confirmation }) => confirmation.status === "due")
      .map(({ project }) => projectKeyOf(project)),
  );
}

/** Evidence projects plus those a command established since, from the runtime's grant. */
export function inventoryProjectRefs(
  granted: ReadonlyArray<ProjectRef>,
  access: AccessState | undefined,
): ReadonlyArray<ProjectRef> {
  const refs = new Map(granted.map((ref) => [projectKeyOf(ref), ref]));
  const established =
    access?.status === "verified"
      ? access.projects
      : access?.status === "verifying" || access?.status === "failed"
        ? (access.previous?.projects ?? [])
        : [];
  for (const { project: ref, role } of established) {
    if (role !== "NO_ACCESS") refs.set(projectKeyOf(ref), ref);
  }
  return [...refs.values()];
}

export interface InventoryDemandInput {
  readonly grant: GrantMachine;
  readonly access: AccessState;
  /** The project's status as the data runtime holds it; undefined while it is unread. */
  readonly projectStatus: (project: ProjectRef) => string | undefined;
}

/** The inventories the account demands now: its organizations', then its projects'. */
export function inventoryDemand(
  input: InventoryDemandInput,
): ReadonlyArray<RuntimeInterestDescriptor> {
  const evidence = heldEvidence(input.grant);
  const organizations =
    evidence?.account.organizations ?? grantRoundInFlight(input.grant)?.organizations ?? [];
  const denied = pendingDenials(evidence);
  const projects = inventoryProjectRefs(evidenceProjectRefs(evidence), input.access).filter(
    (ref) => {
      if (denied.has(projectKeyOf(ref))) return false;
      const status = input.projectStatus(ref);
      return status === undefined || status === "ACTIVE";
    },
  );
  return [
    ...organizations.map(({ organization }): RuntimeInterestDescriptor => ({
      kind: "organization-inventory",
      organization,
    })),
    ...projects.map((project): RuntimeInterestDescriptor => ({
      kind: "project-inventory",
      project,
    })),
  ];
}

/**
 * Holds the account's inventory demand on its data runtime until the scope closes: a lease for
 * each inventory `inventoryDemand` names, taken as it is named and released as it stops being.
 */
export const holdInventoryDemand = (input: {
  readonly data: ManagedZeropsDataRuntime;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { data, atomRegistry } = input;
    const demand = Atom.make((get) =>
      inventoryDemand({
        grant: get(data.access.view).machine,
        access: get(data.reads.access),
        projectStatus: (ref) => {
          const { value } = get(data.reads.project(ref));
          return value.knowledge === "observed"
            ? projectRecordToZeropsProject(value.record)?.status
            : undefined;
        },
      }),
    );
    const wanted = yield* Queue.sliding<ReadonlyArray<RuntimeInterestDescriptor>>(1);
    /** Each lease held, by its interest's key, in a scope of its own. */
    const held = new Map<InterestKey, Scope.Closeable>();
    yield* Effect.addFinalizer(() =>
      Effect.forEach(held.values(), (lease) => Scope.close(lease, Exit.void), { discard: true }),
    );
    const reconcile = (descriptors: ReadonlyArray<RuntimeInterestDescriptor>) =>
      Effect.gen(function* () {
        const next = new Map(
          descriptors.map((descriptor) => [interestKeyOf(descriptor), descriptor]),
        );
        for (const [key, lease] of held) {
          if (next.has(key)) continue;
          held.delete(key);
          yield* Scope.close(lease, Exit.void);
        }
        for (const [key, descriptor] of next) {
          if (held.has(key)) continue;
          const lease = yield* Scope.make();
          const taken = yield* data.acquire(descriptor).pipe(Scope.provide(lease), Effect.exit);
          // A lease the runtime refuses is asked for again when the demand next changes.
          if (Exit.isSuccess(taken)) held.set(key, lease);
          else yield* Scope.close(lease, Exit.void);
        }
      });
    yield* Queue.take(wanted).pipe(Effect.flatMap(reconcile), Effect.forever, Effect.forkScoped);
    const unsubscribe = atomRegistry.subscribe(demand, (next) => Queue.offerUnsafe(wanted, next), {
      immediate: true,
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  });
