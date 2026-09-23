import { useAtomValue } from "@effect/atom-react";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import {
  interestKeyOf,
  organizationKeyOf,
  projectRecordToZeropsProject,
  serviceRecordToZeropsService,
  type AccessState,
  type Evidence,
  type GrantMachine,
  type InterestState,
  type OrganizationRef,
  type ProjectRef,
  type RuntimeInterestDescriptor,
  type ScopeAuthority,
  type ViewObservation,
} from "@t3tools/client-runtime/zerops/data";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { APP_DISPLAY_NAME } from "../branding";
import { PortalGate } from "../components/ui/portal-gate";
import { ZeropsLandingWait } from "../components/zerops/landing/ZeropsLandingShell";
import { dismissContextMenu } from "../contextMenuFallback";
import { invalidateZerops, onZeropsInvalidation } from "./accountInvalidations";
import {
  InventoryContext,
  inventoryProjectRefKey,
  type Inventory,
  type InventoryServiceOutcome,
} from "./inventoryContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import {
  stabilizeZeropsAtom,
  useZeropsAtomSelections,
  useZeropsData,
  useZeropsDataInterest,
  zeropsKnowledgeArraysEqual,
} from "./zeropsDataContext";

export { useZeropsInventory } from "./inventoryContext";

/**
 * The projects admitted evidence names: verified ones, those whose latest
 * read failed, and those a denial withholds until a confirming read (G6).
 * A confirmed denial is the only way a project leaves.
 */
function evidenceProjectRefs(evidence: Evidence | null): ReadonlyArray<ProjectRef> {
  if (evidence === null) return [];
  const refs = new Map<string, ProjectRef>();
  for (const { access } of evidence.projects.values()) {
    if (access.role !== "NO_ACCESS")
      refs.set(inventoryProjectRefKey(access.project), access.project);
  }
  for (const { project } of evidence.unverified.values()) {
    if (!evidence.projects.has(project.projectId))
      refs.set(inventoryProjectRefKey(project), project);
  }
  for (const { project, confirmation } of evidence.closedProjects.values()) {
    if (confirmation.status === "due") refs.set(inventoryProjectRefKey(project), project);
  }
  return [...refs.values()];
}

/** The projects a denial withholds until its confirming read (G6), by `inventoryProjectRefKey`. */
function pendingDenials(evidence: Evidence | null): ReadonlySet<string> {
  if (evidence === null) return new Set();
  return new Set(
    [...evidence.closedProjects.values()]
      .filter(({ confirmation }) => confirmation.status === "due")
      .map(({ project }) => inventoryProjectRefKey(project)),
  );
}

/** Evidence projects plus those a command established since, from the runtime's grant. */
export function inventoryProjectRefs(
  granted: ReadonlyArray<ProjectRef>,
  access: AccessState | undefined,
): ReadonlyArray<ProjectRef> {
  const refs = new Map(granted.map((ref) => [inventoryProjectRefKey(ref), ref]));
  const established =
    access?.status === "verified"
      ? access.projects
      : access?.status === "verifying" || access?.status === "failed"
        ? (access.previous?.projects ?? [])
        : [];
  for (const { project: ref, role } of established) {
    if (role !== "NO_ACCESS") refs.set(inventoryProjectRefKey(ref), ref);
  }
  return [...refs.values()];
}

type OrganizationInventoryDescriptor = Extract<
  RuntimeInterestDescriptor,
  { readonly kind: "organization-inventory" }
>;

const heldEvidence = (grant: GrantMachine): Evidence | null =>
  grant.phase.phase === "granted"
    ? grant.phase.evidence
    : grant.phase.phase === "lapsed"
      ? grant.phase.last
      : null;

/**
 * A project's service list can go transiently unread mid-re-projection (its
 * read entry not yet in `serviceReads`, or briefly unobserved) even though
 * nothing about the project actually changed. Falling straight to "failed"
 * there would blank the row's summary line and bring it back a moment
 * later. Carry the previous resolved outcome forward instead; a freshly
 * resolved outcome still replaces it immediately.
 */
export function carryForwardServiceOutcome(
  previous: ReadonlyMap<string, InventoryServiceOutcome>,
  projectId: string,
  computed: InventoryServiceOutcome,
): InventoryServiceOutcome {
  if (computed.status === "resolved") return computed;
  const prior = previous.get(projectId);
  return prior?.status === "resolved" ? prior : computed;
}

/**
 * Whether the inventory round is incomplete only because the tab is
 * backgrounded: every demanded interest that hasn't reached `observing` is
 * `paused` on purpose (`pauseForBackground`), not stuck or failed. It
 * resolves on its own the moment the tab is visible again, so the wait
 * screen should read as "waiting for the tab", not "still checking".
 */
export function isPausedOnlyRound(demanded: ReadonlyArray<InterestState | undefined>): boolean {
  return (
    demanded.some((interest) => interest?.status === "paused") &&
    demanded.every((interest) => interest?.status === "paused" || interest?.status === "observing")
  );
}

function InterestDemand({ descriptor }: { readonly descriptor: RuntimeInterestDescriptor }) {
  useZeropsDataInterest(descriptor);
  return null;
}

function demandedInterest(
  observation: ViewObservation | undefined,
  descriptor: RuntimeInterestDescriptor,
): InterestState | undefined {
  const key = interestKeyOf(descriptor);
  return observation === undefined
    ? undefined
    : [...observation.required, ...observation.optional].find(
        (interest) => interest.identity.key === key,
      );
}

/**
 * How long past an interest's own published deadline/retry time a render is
 * given before a stall reads as one. The reducer briefly emits `recovering`
 * with a placeholder `nextRetryAtMs: 0` before the runtime's own backoff
 * calculation stamps a real value (registration/malformed failure, membership
 * overflow — `state.ts`); without this margin that placeholder, and the
 * ordinary gap between a backoff timer waking and the re-upsert to
 * `establishing`, would flip the screen to an error mid-recovery. The
 * runtime's own max backoff (`recoveryBackoffMaxMs`) is the right order of
 * magnitude: anything shorter risks the same false positive on a normal
 * retry cycle.
 */
const STALL_GRACE_MS = 30_000;

/**
 * Whether a demanded interest has stopped making progress toward `observing`
 * for long enough that a spinner is no longer honest — the "Try again"
 * affordance belongs here instead (H5).
 *
 * `establishing`/`recovering`/`paused` are ordinary, expected states while a
 * connection comes up or a transport hiccup is retried, so they alone are
 * never "stuck" — only once the interest's own published deadline or retry
 * time has already passed by more than `STALL_GRACE_MS` is a subsequent
 * state change (establishing that never advanced, a scheduled retry that
 * never fired) reasonably read as a stall. A `nextRetryAtMs`/`deadlineMs` of
 * `0` means the runtime has not stamped a real value yet, so it is never
 * treated as already-elapsed. A hidden document is never "stuck" either: the
 * runtime pauses recovery in the background on purpose (`pauseForBackground`),
 * so `recovering`/`establishing` there just means "waiting to come back",
 * not a failure. No timer is started to notice a stall: it is re-evaluated
 * on whatever re-render the runtime's own publications already cause.
 */
export function isInterestBlocked(
  interest: InterestState | undefined,
  nowMs: number,
  documentHidden: boolean,
): boolean {
  if (interest === undefined || documentHidden) return false;
  switch (interest.status) {
    case "failed":
      return true;
    case "establishing":
      return interest.deadlineMs > 0 && nowMs >= interest.deadlineMs + STALL_GRACE_MS;
    case "recovering":
      return interest.nextRetryAtMs > 0 && nowMs >= interest.nextRetryAtMs + STALL_GRACE_MS;
    case "observing":
    case "paused":
      return false;
  }
}

/**
 * What "Try again" asks for (DESIGN §6.2): each organization whose data failed
 * or stalled is read again, and the grant renews now when it is not held — or
 * when nothing else failed, since the check still running is then the grant's.
 */
export function retryInvalidations(input: {
  readonly granted: boolean;
  readonly blockedOrganizations: ReadonlyArray<OrganizationRef>;
}): ReadonlyArray<Invalidation> {
  const reads = input.blockedOrganizations.map((organization): Invalidation => ({
    topic: "inventory",
    organization,
  }));
  return !input.granted || reads.length === 0
    ? [{ topic: "access", change: "renew-now" }, ...reads]
    : reads;
}

function makeInventorySnapshotSelector() {
  let previous: Inventory | null = null;
  let previousKey: string | null = null;
  return (next: Inventory): Inventory => {
    // DTO consumers do not depend on the canonical record's admission clocks.
    const key = JSON.stringify([
      next.projects,
      [...next.services],
      [...next.projectRefs.keys()],
      [...next.authority],
      next.isLoading,
      next.error,
    ]);
    if (previous !== null && key === previousKey) return previous;
    previousKey = key;
    previous = next;
    return next;
  };
}

/**
 * What a lapse of the account's access shows until the next grant: an opaque
 * layer over the product, which stays mounted beneath it and hidden from
 * every reader (DESIGN §4.2 G9, §9 C1; per-region withholding replaces it in
 * Phase 5). Nothing platform-derived shows beside it meanwhile: the portal
 * gate closes every floating layer, the fallback context menu is dismissed,
 * and the document title names only the app.
 */
function AccessLapse({
  cause,
  onRetry,
  onSignOut,
}: {
  readonly cause: string;
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
}) {
  useEffect(() => {
    dismissContextMenu();
    const title = document.title;
    document.title = APP_DISPLAY_NAME;
    return () => {
      // A title set while the lapse lasted is newer than the one it hid.
      if (document.title === APP_DISPLAY_NAME) document.title = title;
    };
  }, []);
  return (
    <div role="alert" className="fixed inset-0 z-[200] bg-background p-8">
      Could not load your Zerops projects. {cause}{" "}
      <button type="button" onClick={onRetry}>
        Try again
      </button>{" "}
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}

/**
 * One account inventory, read from the data runtime: its projects and
 * services, and the access grant the runtime interprets (DESIGN §4.2) — the
 * evidence that names the projects, each project's authority, and the lapse.
 */
export function ZeropsInventoryProvider({ children }: { readonly children: ReactNode }) {
  const { organizations, signOut } = useZeropsSession();
  const { runtime, organizationRef } = useZeropsData();
  const grant = useAtomValue(runtime.access.view);
  /** The first mount happened; the product stays mounted from then on for the epoch. */
  const [admitted, setAdmitted] = useState(false);
  const selectSnapshot = useMemo(makeInventorySnapshotSelector, []);

  const organizationDescriptors = useMemo(
    () =>
      organizations.map((organization): OrganizationInventoryDescriptor => ({
        kind: "organization-inventory",
        organization: organizationRef(organization.id),
      })),
    [organizationRef, organizations],
  );

  // A person's "Try again" on access (DESIGN §6.2); a retry during a round joins it (G7).
  useEffect(
    () =>
      onZeropsInvalidation((invalidation) => {
        if (invalidation.topic === "access" && invalidation.change === "renew-now") {
          void Effect.runPromise(runtime.access.signal({ type: "USER_RETRY" }));
        }
      }),
    [runtime],
  );

  // An inventory intent re-reads that organization on a fresh receiver while
  // the rows already read stay up (`runtime.refresh`). The leases are never
  // re-taken for it: a released lease drops what it read, and the projects
  // page painted "Reading your projects…" over the list it had a moment ago
  // (the owner's run of 2026-09-17).
  useEffect(
    () =>
      onZeropsInvalidation((invalidation) => {
        if (invalidation.topic !== "inventory") return;
        void Effect.runPromise(runtime.refresh(invalidation.organization));
      }),
    [runtime],
  );

  const evidence = heldEvidence(grant.machine);
  /** Each project's authority, as the grant last published it (G12). */
  const authority = useMemo(
    () =>
      new Map<string, ScopeAuthority>(
        [...grant.machine.published.projects.values()].map(({ project, authority: scope }) => [
          inventoryProjectRefKey(project),
          scope,
        ]),
      ),
    [grant.machine.published.projects],
  );
  const accessReadEntries = useMemo(() => [["access", runtime.reads.access] as const], [runtime]);
  const access = useZeropsAtomSelections(accessReadEntries).get("access");
  const knownProjectRefs = useMemo(
    () => inventoryProjectRefs(evidenceProjectRefs(evidence), access),
    [access, evidence],
  );
  const denied = useMemo(() => pendingDenials(evidence), [evidence]);

  const organizationReadEntries = useMemo(
    () =>
      organizationDescriptors.map(
        (descriptor) =>
          [
            interestKeyOf(descriptor),
            stabilizeZeropsAtom(
              runtime.reads.projectsOf(descriptor.organization),
              (left, right) =>
                left.query === right.query &&
                zeropsKnowledgeArraysEqual(left.value, right.value) &&
                left.observation.access === right.observation.access &&
                demandedInterest(left.observation, descriptor) ===
                  demandedInterest(right.observation, descriptor),
            ),
          ] as const,
      ),
    [organizationDescriptors, runtime],
  );
  const projectReadEntries = useMemo(
    () =>
      knownProjectRefs.map(
        (ref) =>
          [
            inventoryProjectRefKey(ref),
            stabilizeZeropsAtom(runtime.reads.project(ref), (left, right) =>
              zeropsKnowledgeArraysEqual([left.value], [right.value]),
            ),
          ] as const,
      ),
    [knownProjectRefs, runtime],
  );
  const organizationReads = useZeropsAtomSelections(organizationReadEntries);
  const projectReads = useZeropsAtomSelections(projectReadEntries);
  const projectDescriptors = useMemo(
    () =>
      knownProjectRefs.flatMap((ref) => {
        const key = inventoryProjectRefKey(ref);
        const knowledge = projectReads.get(key)?.value;
        const observed =
          knowledge?.knowledge === "observed"
            ? projectRecordToZeropsProject(knowledge.record)
            : null;
        const status = observed?.status;
        // A project withheld until its denial is confirmed is not demanded (G6).
        return !denied.has(key) && (status === undefined || status === "ACTIVE")
          ? [{ kind: "project-inventory" as const, project: ref }]
          : [];
      }),
    [denied, knownProjectRefs, projectReads],
  );
  const serviceReadEntries = useMemo(
    () =>
      projectDescriptors.map(
        (descriptor) =>
          [
            inventoryProjectRefKey(descriptor.project),
            stabilizeZeropsAtom(
              runtime.reads.servicesOf(descriptor.project),
              (left, right) =>
                left.query === right.query &&
                zeropsKnowledgeArraysEqual(left.value, right.value) &&
                left.observation.access === right.observation.access &&
                demandedInterest(left.observation, descriptor) ===
                  demandedInterest(right.observation, descriptor),
            ),
          ] as const,
      ),
    [projectDescriptors, runtime],
  );
  const serviceReads = useZeropsAtomSelections(serviceReadEntries);
  const prevServiceOutcomesRef = useRef<ReadonlyMap<string, InventoryServiceOutcome>>(new Map());

  const projected = useMemo(() => {
    const projects: ZeropsProject[] = [];
    const services = new Map<string, InventoryServiceOutcome>();
    // A project that has not (yet, or ever) become ACTIVE gets an empty-services
    // placeholder below, written straight into `services` for this render only.
    // It must never enter the carry-forward cache: `resolvedOrCarried` treats any
    // cached "resolved" entry as trustworthy, and once the project turns ACTIVE
    // this placeholder would otherwise be handed back as its outcome before that
    // project's own services have ever actually been read — reading as "no Zerops
    // Mate container in this project" instead of "still reading".
    const carryableOutcomes = new Map<string, InventoryServiceOutcome>();
    const projectRefs = new Map<string, ProjectRef>();
    const previousOutcomes = prevServiceOutcomesRef.current;
    const resolvedOrCarried = (projectId: string, computed: InventoryServiceOutcome) =>
      carryForwardServiceOutcome(previousOutcomes, projectId, computed);
    // Whether every project and its services are read; how live the push is
    // is the first mount's concern alone.
    let complete = evidence !== null;
    for (const ref of knownProjectRefs) {
      const key = inventoryProjectRefKey(ref);
      projectRefs.set(key, ref);
      // A project withheld until its denial is confirmed holds nothing open (G6).
      const incomplete = () => {
        if (!denied.has(key)) complete = false;
      };
      const project = projectReads.get(key)?.value;
      if (project === undefined) {
        incomplete();
        continue;
      }
      if (project.knowledge !== "observed") {
        incomplete();
        continue;
      }
      const dto = projectRecordToZeropsProject(project.record);
      if (dto === null) {
        incomplete();
        continue;
      }
      projects.push(dto);
      if (dto.status !== "ACTIVE") {
        services.set(dto.id, { status: "resolved", services: [] });
        continue;
      }
      const serviceRead = serviceReads.get(key);
      if (serviceRead === undefined) {
        incomplete();
        const outcome = resolvedOrCarried(dto.id, { status: "failed" });
        services.set(dto.id, outcome);
        carryableOutcomes.set(dto.id, outcome);
        continue;
      }
      if (serviceRead.query.status !== "observed") {
        incomplete();
        const outcome = resolvedOrCarried(dto.id, { status: "failed" });
        services.set(dto.id, outcome);
        carryableOutcomes.set(dto.id, outcome);
        continue;
      }
      const decoded: ZeropsService[] = [];
      let serviceComplete = true;
      for (const knowledge of serviceRead.value) {
        if (knowledge.knowledge !== "observed") {
          incomplete();
          serviceComplete = false;
          continue;
        }
        const service = serviceRecordToZeropsService(knowledge.record);
        if (service === null) {
          incomplete();
          serviceComplete = false;
        } else decoded.push(service);
      }
      const outcome = resolvedOrCarried(
        dto.id,
        serviceComplete ? { status: "resolved", services: decoded } : { status: "failed" },
      );
      services.set(dto.id, outcome);
      carryableOutcomes.set(dto.id, outcome);
    }
    prevServiceOutcomesRef.current = carryableOutcomes;
    const demanded = [
      ...organizationDescriptors.map((descriptor) => ({
        organization: descriptor.organization,
        interest: demandedInterest(
          organizationReads.get(interestKeyOf(descriptor))?.observation,
          descriptor,
        ),
      })),
      ...projectDescriptors.map((descriptor) => ({
        organization: descriptor.project.organization,
        interest: demandedInterest(
          serviceReads.get(inventoryProjectRefKey(descriptor.project))?.observation,
          descriptor,
        ),
      })),
    ];
    const documentHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    /** The organizations whose data failed or stalled, once each. */
    const blocked = new Map<string, OrganizationRef>();
    for (const { organization, interest } of demanded) {
      if (isInterestBlocked(interest, Date.now(), documentHidden)) {
        blocked.set(organizationKeyOf(organization), organization);
      }
    }
    const observing = demanded.every(({ interest }) => interest?.status === "observing");
    const pausedOnly = isPausedOnlyRound(demanded.map(({ interest }) => interest));
    return {
      projects,
      services,
      projectRefs,
      read: complete,
      established: complete && observing,
      blockedOrganizations: [...blocked.values()],
      pausedOnly,
    };
  }, [
    denied,
    organizationDescriptors,
    organizationReads,
    projectDescriptors,
    projectReads,
    serviceReads,
    evidence,
    knownProjectRefs,
  ]);

  const phase = grant.machine.phase;
  const error =
    phase.phase === "unverified-failed"
      ? (grant.failure ?? "Zerops didn't answer.")
      : projected.blockedOrganizations.length > 0
        ? "Some project access or services could not be verified."
        : null;

  // The first mount waits for its data as well as its grant (G10), and the
  // runtime holds the grant before the gate opens: `ready` is what mounts the
  // children, and the first thing some of them do is lease a resource — which
  // the broker refuses until the runtime holds a grant. Opening the gate first
  // made `/zerops/new` fail its locations read on every cold load (measured
  // 2026-09-20).
  const firstRound =
    phase.phase === "granted" && access?.status === "verified" && projected.established
      ? phase.evidence.account.round
      : null;
  const ready = admitted || firstRound !== null;
  useEffect(() => {
    if (firstRound === null) return;
    setAdmitted(true);
    void Effect.runPromise(runtime.access.mounted);
  }, [firstRound, runtime]);

  /** The round whose grant the mounted product runs on, as it reaches the gate. */
  const grantedRound = ready && phase.phase === "granted" ? phase.evidence.account.round : null;
  useEffect(() => {
    if (grantedRound !== null)
      mateDiagnostics.record({ kind: "access-grant", round: grantedRound });
  }, [grantedRound]);

  /** What the overlay names while the grant is lapsed, and nothing otherwise. */
  const lapseCause =
    ready && phase.phase === "lapsed" ? (error ?? "Project access verification expired.") : null;
  const visibleError = lapseCause ?? error;
  const retry = () => {
    const intents = retryInvalidations({
      granted: phase.phase === "granted",
      blockedOrganizations: projected.blockedOrganizations,
    });
    for (const intent of intents) invalidateZerops(intent);
  };

  const snapshot = selectSnapshot({
    projects: projected.projects,
    services: projected.services,
    projectRefs: projected.projectRefs,
    authority,
    isLoading: !projected.read && error === null,
    error: visibleError,
  });

  return (
    <>
      {organizationDescriptors.map((descriptor) => (
        <InterestDemand key={interestKeyOf(descriptor)} descriptor={descriptor} />
      ))}
      {projectDescriptors.map((descriptor) => (
        <InterestDemand key={interestKeyOf(descriptor)} descriptor={descriptor} />
      ))}
      {!ready ? (
        visibleError !== null ? (
          <div role="alert" className="p-8">
            Could not load your Zerops projects. {visibleError}{" "}
            <button type="button" onClick={retry}>
              Try again
            </button>{" "}
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : projected.pausedOnly ? (
          <ZeropsLandingWait label="Paused while this tab is in the background…" />
        ) : grant.overdue ? (
          <div role="alert" className="p-8">
            Still checking your Zerops projects.{" "}
            <button type="button" onClick={retry}>
              Try again
            </button>{" "}
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : (
          <ZeropsLandingWait label="Checking your Zerops projects…" />
        )
      ) : (
        <InventoryContext value={snapshot}>
          {error !== null && lapseCause === null ? (
            <div role="alert" className="fixed inset-x-0 top-0 z-50 bg-background p-4">
              Project access could not be verified.{" "}
              <button type="button" onClick={retry}>
                Try again
              </button>{" "}
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          ) : null}
          <PortalGate closed={lapseCause !== null}>
            <div
              inert={visibleError !== null}
              aria-hidden={lapseCause !== null || undefined}
              className="contents"
            >
              {children}
            </div>
          </PortalGate>
          {lapseCause === null ? null : (
            <AccessLapse cause={lapseCause} onRetry={retry} onSignOut={() => void signOut()} />
          )}
        </InventoryContext>
      )}
    </>
  );
}
