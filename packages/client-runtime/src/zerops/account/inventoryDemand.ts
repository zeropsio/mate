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
 * - A project an organization's live list names and the held evidence does not — one someone else
 *   created since the round — is handed to the grant as it is listed (`holdListedProjects`), so it
 *   is verified and demanded at once rather than at the next renewal.
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { grantRoundInFlight, type Evidence, type GrantMachine } from "../data/access/grant.ts";
import {
  evidenceProjectRefs,
  inventoryProjectRefs,
  pendingDenials,
  projectsNeverSeen,
} from "../data/access/grantProjects.ts";
import { projectRecordToZeropsProject } from "../data/dto.ts";
import { MATE_TAG_NAMESPACE } from "../groups.ts";
import { interestKeyOf, type ManagedZeropsDataRuntime } from "../data/runtime.ts";
import {
  projectKeyOf,
  type AccessState,
  type CollectionRead,
  type InterestKey,
  type InterestLease,
  type ProjectRecord,
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
  readonly grant: GrantMachine;
  readonly access: AccessState;
  /** The project's status as the data runtime holds it; undefined while it is unread. */
  readonly projectStatus: (project: ProjectRef) => string | undefined;
  /** Whether the organization's project list has answered. */
  readonly organizationListed: (organization: ProjectRef["organization"]) => boolean;
  /** Whether the organization's list names a project of this product (a Mate, or its group). */
  readonly organizationHasMates: (organization: ProjectRef["organization"]) => boolean;
  /**
   * Whether the project's own record is a Mate's: this tab's new Mate, recorded from the press's
   * answer before its organization's list names it.
   */
  readonly projectIsMate: (project: ProjectRef) => boolean;
}

/** Whether a project's tags make it a Mate, or a Mate group's (`mate`, `mate:…`). */
const isMateRecord = (record: ProjectRecord): boolean =>
  (projectRecordToZeropsProject(record)?.tagList ?? []).some(
    (tag) => tag === MATE_TAG_NAMESPACE || tag.startsWith(`${MATE_TAG_NAMESPACE}:`),
  );

/** Whether an organization's project list names a Mate it has read. */
export const listsMates = (list: CollectionRead<ProjectRecord>): boolean =>
  list.value.some(
    (knowledge) => knowledge.knowledge === "observed" && isMateRecord(knowledge.record),
  );

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
    ...organizations.flatMap(({ organization }): ReadonlyArray<RuntimeInterestDescriptor> => [
      { kind: "organization-inventory", organization },
      // What its services run and their Mate flags, streamed for the session — only for an
      // organization with Mates, the only one anything reads them for. A read of either only
      // waits on the store, and never registers anything of its own.
      ...(input.organizationHasMates(organization) ||
      projects.some(
        (project) =>
          project.organization.organizationId === organization.organizationId &&
          input.projectIsMate(project),
      )
        ? ([
            { kind: "organization-versions", organization },
            { kind: "organization-variables", organization },
          ] as const)
        : []),
    ]),
    ...projects.map((project): RuntimeInterestDescriptor => ({
      kind: "project-inventory",
      project,
    })),
    // Every project's record is its organization's list's: one the answered list lacks — this
    // tab's own new project, which the platform answers for before its lists do — is read alone.
    ...projects
      .filter(
        (project) =>
          input.projectStatus(project) === undefined &&
          input.organizationListed(project.organization),
      )
      .map((project): RuntimeInterestDescriptor => ({ kind: "project-record", project })),
  ];
}

/**
 * Holds the account's inventory demand on its data runtime until the scope closes: a lease for
 * each inventory `inventoryDemand` names, taken as it is named and released as it stops being.
 * The inventories named together are leased together, so the account hears them in one
 * publication.
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
        organizationListed: (organization) =>
          get(data.reads.projectsOf(organization)).query.status === "observed",
        organizationHasMates: (organization) =>
          listsMates(get(data.reads.projectsOf(organization))),
        projectIsMate: (ref) => {
          const { value } = get(data.reads.project(ref));
          return value.knowledge === "observed" && isMateRecord(value.record);
        },
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
 * The projects the organizations' live lists name that the held evidence names nowhere — verified,
 * unverified or closed — in an organization it holds: a project someone else created since the
 * round. A list's entry the platform refused or found gone names nothing.
 */
export function unheldListedProjects(
  evidence: Evidence | null,
  lists: ReadonlyArray<CollectionRead<ProjectRecord>>,
  access?: AccessState,
): ReadonlyArray<ProjectRef> {
  if (evidence === null) return [];
  // A project this tab's own command established is the grant's already (`runtimeGrant`): put on
  // the path for someone else's, it would leave the runtime's grant and the inventory until its
  // own read answers — which a project the platform is still creating does not do.
  const established = new Set(inventoryProjectRefs([], access).map((ref) => projectKeyOf(ref)));
  const organizations = new Set(
    evidence.account.organizations.map(({ organization }) => organization.organizationId),
  );
  const unheld = new Map<string, ProjectRef>();
  for (const list of lists) {
    for (const entry of list.value) {
      if (entry.knowledge === "unavailable") continue;
      const ref = entry.knowledge === "observed" ? entry.record.ref : entry.ref;
      if (
        organizations.has(ref.organization.organizationId) &&
        !established.has(projectKeyOf(ref)) &&
        !evidence.projects.has(ref.projectId) &&
        !evidence.unverified.has(ref.projectId) &&
        !evidence.closedProjects.has(ref.projectId)
      ) {
        unheld.set(projectKeyOf(ref), ref);
      }
    }
  }
  return [...unheld.values()];
}

/**
 * Hands the grant each project an organization's live list names before its evidence does
 * (`unheldListedProjects`), until the scope closes: the grant reads it on its own at once, and the
 * inventory demand follows its evidence.
 */
export const holdListedProjects = (input: {
  readonly data: ManagedZeropsDataRuntime;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { data, atomRegistry } = input;
    const unheld = Atom.make((get) => {
      const evidence = heldEvidence(get(data.access.view).machine);
      return {
        evidence,
        projects: unheldListedProjects(
          evidence,
          (evidence?.account.organizations ?? []).map(({ organization }) =>
            get(data.reads.projectsOf(organization)),
          ),
          get(data.reads.access),
        ),
      };
    });
    const listed = yield* Queue.sliding<ReadonlyArray<ProjectRef>>(1);
    yield* Queue.take(listed).pipe(
      Effect.flatMap((projects) => data.access.signal({ type: "PROJECTS_LISTED", projects })),
      Effect.forever,
      Effect.forkScoped,
    );
    // One offer per set of projects and evidence: a grant that took it names them, and one that
    // let it go (lapsed, or its evidence run out) keeps its evidence as it was, so it is offered
    // them again only once its evidence moves — never again and again as its view republishes.
    let offered: { readonly evidence: Evidence | null; readonly key: string } | null = null;
    const unsubscribe = atomRegistry.subscribe(
      unheld,
      ({ evidence, projects }) => {
        const key = projects.map(projectKeyOf).join(",");
        if (offered?.evidence === evidence && offered.key === key) return;
        offered = { evidence, key };
        if (projects.length > 0) Queue.offerUnsafe(listed, projects);
      },
      { immediate: true },
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  });

export { evidenceProjectRefs, inventoryProjectRefs, pendingDenials, projectsNeverSeen };
