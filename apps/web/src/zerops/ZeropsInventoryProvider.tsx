import {
  zeropsClientsFromUser,
  type ZeropsApiClient,
  type ZeropsOrganization,
  type ZeropsProject,
  type ZeropsService,
} from "@t3tools/client-runtime/zerops";
import {
  DEFAULT_ZEROPS_GRANT_POLICY,
  grantRoundInFlight,
  initialGrant,
  interestKeyOf,
  projectRecordToZeropsProject,
  serviceRecordToZeropsService,
  transitionGrant,
  type AccessState,
  type Evidence,
  type GrantEffect,
  type GrantEvent,
  type GrantMachine,
  type Instant,
  type InterestState,
  type ProjectRef,
  type RuntimeInterestDescriptor,
  type VerifiedAccessGrant,
  type ViewObservation,
} from "@t3tools/client-runtime/zerops/data";
import { diagnosticFailure, mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ZeropsLandingWait } from "../components/zerops/landing/ZeropsLandingShell";
import { grantFailure, readProjectAccess, runAccessRound } from "./accessRounds";
import { setAccountActionsAllowed } from "./accountLifetime";
import { refreshZeropsCandidates, useZeropsCandidatesVersion } from "./candidatesRefresh";
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
 * How long the checking screen waits before it offers a way off itself.
 *
 * A verification round that rejects puts its reason on screen with a way to
 * retry; a request that simply never settles would leave a wordless spinner
 * until the round's own deadline. Nothing here cancels the round — it may
 * still land, and it wins if it does.
 */
const WAIT_PATIENCE_MS = 20_000;
/** A visible wake after the tab was hidden at least this long (DESIGN §6.4). */
const WAKE_AFTER_HIDDEN_MS = 30_000;
/** Wakes are coalesced to at most one per this long (DESIGN §6.4). */
const WAKE_COALESCE_MS = 10_000;

const now = (): Instant => ({ wall: Date.now(), mono: performance.now() });

/** The evidence's deadline on whichever clock reaches it first, as wall time. */
function deadlineWallMs(stamp: Instant): number {
  const windowMs = DEFAULT_ZEROPS_GRANT_POLICY.windowMs;
  const at = now();
  return at.wall + Math.min(stamp.wall + windowMs - at.wall, stamp.mono + windowMs - at.mono);
}

/** Writes and account actions stay open until the evidence's deadline on either clock (G4, G5). */
function openWrites(client: Pick<ZeropsApiClient, "setWritesAllowed">, evidence: Evidence): void {
  const stamp = evidence.account.startedAt;
  const windowMs = DEFAULT_ZEROPS_GRANT_POLICY.windowMs;
  setAccountActionsAllowed({ wallMs: stamp.wall + windowMs, monoMs: stamp.mono + windowMs });
  client.setWritesAllowed(true, deadlineWallMs(stamp));
}

/** The data runtime's grant for admitted evidence; hidden projects stay out of it. */
function runtimeGrant(
  runtime: ReturnType<typeof useZeropsData>["runtime"],
  evidence: Evidence,
): VerifiedAccessGrant {
  return {
    account: runtime.scope.account,
    accountEpoch: runtime.scope.epoch,
    verifiedAtMs: evidence.account.startedAt.wall,
    deadlineMs: deadlineWallMs(evidence.account.startedAt),
    mutationsAllowed: true,
    organizations: evidence.account.organizations,
    projects: [...evidence.projects.values()]
      .map(({ access }) => access)
      .filter(({ role }) => role !== "NO_ACCESS"),
  };
}

/** The projects admitted evidence names: verified ones, then those whose latest read failed. */
function evidenceProjectRefs(evidence: Evidence | null): ReadonlyArray<ProjectRef> {
  if (evidence === null) return [];
  const refs = new Map<string, ProjectRef>();
  for (const { access } of evidence.projects.values()) {
    if (access.role !== "NO_ACCESS")
      refs.set(inventoryProjectRefKey(access.project), access.project);
  }
  for (const { project } of evidence.unverified.values()) {
    const key = inventoryProjectRefKey(project);
    if (!evidence.projects.has(project.projectId)) refs.set(key, project);
  }
  return [...refs.values()];
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

function makeInventorySnapshotSelector() {
  let previous: Inventory | null = null;
  let previousKey: string | null = null;
  return (next: Inventory): Inventory => {
    // DTO consumers do not depend on the canonical record's admission clocks.
    const key = JSON.stringify([
      next.projects,
      [...next.services],
      [...next.projectRefs.keys()],
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
 * One account inventory consumes central state while the access grant renews
 * on its own: the grant reducer (DESIGN §4.2) holds the evidence, this
 * component runs its reads, timers and signals and hands its grants to the
 * data runtime.
 */
export function ZeropsInventoryProvider({ children }: { readonly children: ReactNode }) {
  const { client, organizations, updateVerifiedMemberships, signOut } = useZeropsSession();
  const { runtime, organizationRef, projectRef } = useZeropsData();
  const refreshKey = useZeropsCandidatesVersion();
  const [grant, setGrant] = useState<GrantMachine>(() =>
    initialGrant({ hidden: false, online: true }, now()),
  );
  /** Admitted evidence waiting for the first mount's data (the first-mount rule, G10). */
  const [firstEvidence, setFirstEvidence] = useState<Evidence | null>(null);
  const [admission, setAdmission] = useState<{ readonly round: number } | null>(null);
  const ready = admission !== null;
  const admitted = useRef(false);
  const [readWindowExpired, setReadWindowExpired] = useState(false);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  /** Why the last round failed, in the platform's words. */
  const [roundFailure, setRoundFailure] = useState<string | null>(null);
  const dispatch = useRef<(event: GrantEvent) => void>(() => undefined);
  /** Each project's status as its last read gave it, until the runtime has read it. */
  const [readStatuses, setReadStatuses] = useState<ReadonlyMap<string, string>>(new Map());
  const selectSnapshot = useMemo(makeInventorySnapshotSelector, []);

  const organizationDescriptors = useMemo(
    () =>
      organizations.map((organization): OrganizationInventoryDescriptor => ({
        kind: "organization-inventory",
        organization: organizationRef(organization.id),
      })),
    [organizationRef, organizations],
  );

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const policy = DEFAULT_ZEROPS_GRANT_POLICY;
    const hidden = () => document.visibilityState === "hidden";
    /** The memberships the last round read, to judge a project read between rounds. */
    let memberships: ReadonlyArray<ZeropsOrganization> = [];
    const readStatus = (project: ZeropsProject) =>
      setReadStatuses((statuses) =>
        statuses.get(project.id) === project.status
          ? statuses
          : new Map(statuses).set(project.id, project.status),
      );
    let machine = initialGrant(
      {
        hidden: hidden(),
        online: typeof navigator === "undefined" || navigator.onLine !== false,
      },
      now(),
    );

    const runRound = (round: number, carried: ReadonlyArray<ProjectRef>, first: boolean) => {
      const span = mateDiagnostics.span("access-round", { round });
      let reads = 1;
      setRoundFailure(null);
      if (first) {
        void Effect.runPromise(
          runtime.observeAccess({
            kind: "access-verification-started",
            accountEpoch: runtime.scope.epoch,
          }),
        );
      } else {
        mateDiagnostics.record({ kind: "access-timer", timer: "renewal" });
        // The consumers of the candidates refresh still ride on the renewal (DESIGN G8).
        refreshZeropsCandidates();
      }
      void (async () => {
        // Projects a command established since are the grant's too: read them.
        const state = await Effect.runPromise(runtime.state);
        const established = inventoryProjectRefs([], state.access);
        const outcome = await runAccessRound({
          client,
          round,
          carried: [...carried, ...established],
          concurrency: policy.roundProjectConcurrency,
          organizationRef,
          projectRef,
          onUser: (user) => {
            if (!alive) return;
            memberships = zeropsClientsFromUser(user);
            updateVerifiedMemberships(user);
          },
          onProject: (project) => {
            if (alive) readStatus(project);
          },
          dispatch: (event) => dispatch.current(event),
        });
        reads = outcome.reads;
        span.end({ outcome: "verified", reads });
      })().catch((cause: unknown) => {
        if (!alive) return;
        const error = zeropsErrorMessage(cause);
        span.end({ outcome: "failed", reads, ...diagnosticFailure(cause) });
        setRoundFailure(error);
        dispatch.current({ type: "ROUND_FAILED", round, failure: grantFailure(cause) });
        if (first) {
          void Effect.runPromise(
            runtime.observeAccess({
              kind: "access-verification-failed",
              accountEpoch: runtime.scope.epoch,
              failedAtMs: Date.now(),
              retryable: true,
              reason: error,
            }),
          );
        }
      });
    };

    const readProject = (attempt: number, project: ProjectRef) => {
      const membership = memberships.find(({ id }) => id === project.organization.organizationId);
      if (membership === undefined) return;
      void readProjectAccess(client, project, membership, (read) => {
        if (alive) readStatus(read);
      }).then((outcome) => {
        dispatch.current({ type: "PROJECT_RESULT", attempt, project, outcome });
      });
    };

    const interpret = (effect: GrantEffect) => {
      switch (effect.kind) {
        case "run":
          if (effect.op.kind === "verify-round") {
            runRound(effect.attempt, effect.op.carried, machine.phase.phase === "verifying");
          } else {
            readProject(effect.attempt, effect.op.project);
          }
          return;
        case "schedule": {
          window.clearTimeout(timer);
          const at = now();
          const delay = Math.min(effect.at.wall - at.wall, effect.at.mono - at.mono);
          timer = window.setTimeout(() => dispatch.current({ type: "TICK" }), Math.max(0, delay));
          return;
        }
        case "cancel":
          window.clearTimeout(timer);
          timer = undefined;
          return;
        case "observe":
          switch (effect.observation.kind) {
            case "access-verified": {
              const evidence = effect.observation.evidence;
              if (!admitted.current) {
                setFirstEvidence(evidence);
                return;
              }
              // A renewal: REST evidence alone, never the push half (G1).
              void Effect.runPromise(
                runtime.observeAccess({
                  kind: "access-verified",
                  grant: runtimeGrant(runtime, evidence),
                }),
              ).then(() => {
                if (!alive) return;
                mateDiagnostics.record({ kind: "access-grant", round: evidence.account.round });
                openWrites(client, evidence);
                setReadWindowExpired(false);
              });
              return;
            }
            case "access-expired":
              mateDiagnostics.record({ kind: "access-timer", timer: "expiry" });
              setAccountActionsAllowed(null);
              client.setWritesAllowed(false);
              setFirstEvidence(null);
              if (admitted.current) setReadWindowExpired(true);
              void Effect.runPromise(
                runtime.observeAccess({
                  kind: "access-expired",
                  accountEpoch: runtime.scope.epoch,
                  expiredAtMs: effect.observation.expiredAtMs,
                }),
              );
              return;
            case "project-gone":
              // The project leaves the runtime's grant with the next admitted round.
              return;
          }
          return;
        case "withhold":
        case "restore-authority":
          // No surface reads per-scope authority yet.
          return;
        case "invalidate":
          // No store subscribes to access invalidations yet (DESIGN §6.2).
          return;
        case "log":
          return;
      }
    };

    dispatch.current = (event) => {
      if (!alive) return;
      const { state, effects } = transitionGrant(machine, event, { now: now(), policy });
      machine = state;
      setGrant(state);
      for (const effect of effects) interpret(effect);
    };

    let hiddenAt: number | null = hidden() ? performance.now() : null;
    let lastWake = Number.NEGATIVE_INFINITY;
    const wake = () => {
      const at = performance.now();
      if (at - lastWake < WAKE_COALESCE_MS) return;
      lastWake = at;
      dispatch.current({ type: "WAKE", visible: !hidden() });
    };
    const onVisibility = () => {
      dispatch.current({ type: "VISIBILITY", hidden: hidden() });
      if (hidden()) {
        hiddenAt ??= performance.now();
        return;
      }
      const away = hiddenAt === null ? 0 : performance.now() - hiddenAt;
      hiddenAt = null;
      if (away >= WAKE_AFTER_HIDDEN_MS) wake();
    };
    const onPageShow = (event: Event) => {
      if ((event as PageTransitionEvent).persisted) wake();
    };
    const onOnline = () => dispatch.current({ type: "ONLINE" });
    const onOffline = () => dispatch.current({ type: "OFFLINE" });
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("resume", wake);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    dispatch.current({ type: "START" });
    return () => {
      dispatch.current({ type: "EPOCH_CLOSED" });
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("resume", wake);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [client, organizationRef, projectRef, runtime, updateVerifiedMemberships]);

  // A refresh re-reads every organization's inventory on a fresh receiver
  // while the rows already read stay up (`runtime.refresh`). The leases are
  // never re-taken for it: a released lease drops what it read, and the
  // projects page painted "Reading your projects…" over the list it had a
  // moment ago — every twenty seconds while a creation was on its way (the
  // owner's run of 2026-09-17). The key at mount is not a refresh: the
  // leases read their baseline by themselves.
  const refreshedKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshedKey.current === refreshKey) return;
    refreshedKey.current = refreshKey;
    for (const descriptor of organizationDescriptors) {
      void Effect.runPromise(runtime.refresh(descriptor.organization));
    }
  }, [organizationDescriptors, refreshKey, runtime]);

  const evidence = heldEvidence(grant);
  const accessReadEntries = useMemo(() => [["access", runtime.reads.access] as const], [runtime]);
  const access = useZeropsAtomSelections(accessReadEntries).get("access");
  const knownProjectRefs = useMemo(
    () => inventoryProjectRefs(evidenceProjectRefs(evidence), access),
    [access, evidence],
  );

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
        const status = observed?.status ?? readStatuses.get(ref.projectId);
        return status === undefined || status === "ACTIVE"
          ? [{ kind: "project-inventory" as const, project: ref }]
          : [];
      }),
    [knownProjectRefs, projectReads, readStatuses],
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
      const project = projectReads.get(key)?.value;
      if (project === undefined) {
        complete = false;
        continue;
      }
      if (project.knowledge !== "observed") {
        complete = false;
        continue;
      }
      const dto = projectRecordToZeropsProject(project.record);
      if (dto === null) {
        complete = false;
        continue;
      }
      projects.push(dto);
      if (dto.status !== "ACTIVE") {
        services.set(dto.id, { status: "resolved", services: [] });
        continue;
      }
      const serviceRead = serviceReads.get(key);
      if (serviceRead === undefined) {
        complete = false;
        const outcome = resolvedOrCarried(dto.id, { status: "failed" });
        services.set(dto.id, outcome);
        carryableOutcomes.set(dto.id, outcome);
        continue;
      }
      if (serviceRead.query.status !== "observed") {
        complete = false;
        const outcome = resolvedOrCarried(dto.id, { status: "failed" });
        services.set(dto.id, outcome);
        carryableOutcomes.set(dto.id, outcome);
        continue;
      }
      const decoded: ZeropsService[] = [];
      let serviceComplete = true;
      for (const knowledge of serviceRead.value) {
        if (knowledge.knowledge !== "observed") {
          complete = false;
          serviceComplete = false;
          continue;
        }
        const service = serviceRecordToZeropsService(knowledge.record);
        if (service === null) {
          complete = false;
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
      ...organizationDescriptors.map((descriptor) =>
        demandedInterest(organizationReads.get(interestKeyOf(descriptor))?.observation, descriptor),
      ),
      ...projectDescriptors.map((descriptor) =>
        demandedInterest(
          serviceReads.get(inventoryProjectRefKey(descriptor.project))?.observation,
          descriptor,
        ),
      ),
    ];
    const documentHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const failedInterest = demanded.some((interest) =>
      isInterestBlocked(interest, Date.now(), documentHidden),
    );
    const observing = demanded.every((interest) => interest?.status === "observing");
    const pausedOnly = isPausedOnlyRound(demanded);
    return {
      projects,
      services,
      projectRefs,
      read: complete,
      established: complete && observing,
      failedInterest,
      pausedOnly,
    };
  }, [
    organizationDescriptors,
    organizationReads,
    projectDescriptors,
    projectReads,
    serviceReads,
    evidence,
    knownProjectRefs,
  ]);

  const error =
    grant.phase.phase === "unverified-failed"
      ? (roundFailure ?? "Zerops didn't answer.")
      : projected.failedInterest
        ? "Some project access or services could not be verified."
        : null;

  // The first mount waits for its data as well as its grant (G10); the grant
  // reaches the runtime *before* the gate opens. `ready` is what mounts the
  // children, and the first thing some of them do is lease a resource — which
  // the broker refuses, once and for good, until this grant has landed.
  // Opening the gate first made `/zerops/new` fail its locations read on every
  // cold load (measured 2026-09-20).
  const granting = useRef<Evidence | null>(null);
  useEffect(() => {
    if (firstEvidence === null || !projected.established) return;
    if (granting.current === firstEvidence) return;
    granting.current = firstEvidence;
    const evidence = firstEvidence;
    void Effect.runPromise(
      runtime.observeAccess({ kind: "access-verified", grant: runtimeGrant(runtime, evidence) }),
    )
      .then(() => {
        mateDiagnostics.record({ kind: "access-grant", round: evidence.account.round });
        openWrites(client, evidence);
        admitted.current = true;
        setFirstEvidence(null);
        setAdmission({ round: evidence.account.round });
      })
      .catch(() => {
        // The gate stays shut and the screen keeps saying it is checking.
        // The next admitted round tries again, rather than mounting children
        // onto a runtime that never took the grant.
        granting.current = null;
      });
  }, [client, firstEvidence, projected.established, runtime]);

  const round = grantRoundInFlight(grant)?.id ?? null;
  // Every round starts the patience over, so a retry that is itself slow gets
  // the same wait rather than the leftovers of the last one.
  useEffect(() => {
    setWaitedTooLong(false);
    if (ready && !readWindowExpired) return;
    const timeout = window.setTimeout(() => setWaitedTooLong(true), WAIT_PATIENCE_MS);
    return () => window.clearTimeout(timeout);
  }, [readWindowExpired, ready, round]);

  const visibleError = error ?? (readWindowExpired ? "Project access verification expired." : null);
  // "Try again" retries the grant (joining a round in flight) and the data.
  const retry = () => {
    dispatch.current({ type: "USER_RETRY" });
    refreshZeropsCandidates();
  };

  const snapshot = selectSnapshot({
    projects: projected.projects,
    services: projected.services,
    projectRefs: projected.projectRefs,
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
      {!ready || readWindowExpired ? (
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
        ) : waitedTooLong ? (
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
          {visibleError !== null ? (
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
          <div inert={visibleError !== null} className="contents">
            {children}
          </div>
        </InventoryContext>
      )}
    </>
  );
}
