import {
  zeropsClientsFromUser,
  type ZeropsProject,
  type ZeropsService,
} from "@t3tools/client-runtime/zerops";
import {
  interestKeyOf,
  projectRecordToZeropsProject,
  serviceRecordToZeropsService,
  type AccessState,
  type AccountEpoch,
  type InterestState,
  type ProjectRef,
  type RuntimeInterestDescriptor,
  type ViewObservation,
} from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ZeropsLandingWait } from "../components/zerops/landing/ZeropsLandingShell";
import { setAccountActionsAllowed } from "./accountLifetime";
import { refreshZeropsCandidates, useZeropsCandidatesVersion } from "./candidatesRefresh";
import {
  InventoryContext,
  inventoryProjectRefKey,
  type Inventory,
  type InventoryServiceOutcome,
} from "./inventoryContext";
import { verifyOperableProjects, type OperableProjectAccess } from "./projectAccess";
import { useZeropsSession } from "./ZeropsSessionProvider";
import {
  stabilizeZeropsAtom,
  useZeropsAtomSelections,
  useZeropsData,
  useZeropsDataInterest,
  zeropsKnowledgeArraysEqual,
} from "./zeropsDataContext";

export { useZeropsInventory } from "./inventoryContext";

const ACCESS_WINDOW_MS = 15 * 60_000;
const ACCESS_RENEWAL_LEAD_MS = 60_000;

interface VerifiedProject extends OperableProjectAccess {
  readonly ref: ProjectRef;
}

export function inventoryProjectRefs(
  verified: ReadonlyArray<{ readonly ref: ProjectRef }>,
  access: AccessState | undefined,
): ReadonlyArray<ProjectRef> {
  const refs = new Map(verified.map(({ ref }) => [inventoryProjectRefKey(ref), ref]));
  const granted =
    access?.status === "verified"
      ? access.projects
      : access?.status === "verifying" || access?.status === "failed"
        ? (access.previous?.projects ?? [])
        : [];
  for (const { project: ref, role } of granted) {
    if (role !== "NO_ACCESS") refs.set(inventoryProjectRefKey(ref), ref);
  }
  return [...refs.values()];
}

type OrganizationInventoryDescriptor = Extract<
  RuntimeInterestDescriptor,
  { readonly kind: "organization-inventory" }
>;

type AccessVerification =
  | { readonly status: "loading"; readonly revision: number }
  | { readonly status: "failed"; readonly revision: number; readonly error: string }
  | {
      readonly status: "verified";
      readonly revision: number;
      readonly projects: ReadonlyArray<VerifiedProject>;
    };

/**
 * Which access grant, if any, may add command-established projects to
 * `knownProjectRefs` on top of the last completed verification round.
 *
 * While verification has not finished a round yet, whatever access is
 * currently known is used as-is (there is no verified round to defer to).
 * Once verification has completed a round, a currently verified access grant
 * for the SAME account epoch is used regardless of which verification
 * revision produced it: a grant does not go stale just because a newer
 * verification round started elsewhere (a `refreshZeropsCandidates` bump
 * mid-flight from an unrelated candidates refresh). Cross-account-epoch
 * access is never usable — that grant belongs to a different sign-in.
 */
export function supplementalAccessFor(input: {
  readonly verificationStatus: AccessVerification["status"];
  readonly access: AccessState | undefined;
  readonly epoch: AccountEpoch;
}): AccessState | undefined {
  if (input.verificationStatus !== "verified") return input.access;
  return input.access?.status === "verified" && input.access.accountEpoch === input.epoch
    ? input.access
    : undefined;
}

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

function InterestDemand({
  descriptor,
  refreshKey,
}: {
  readonly descriptor: RuntimeInterestDescriptor;
  readonly refreshKey: number;
}) {
  useZeropsDataInterest(descriptor, refreshKey);
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

/** One account inventory consumes central state while access verification remains independent. */
export function ZeropsInventoryProvider({ children }: { readonly children: ReactNode }) {
  const { client, organizations, updateVerifiedMemberships, signOut } = useZeropsSession();
  const { runtime, organizationRef, projectRef } = useZeropsData();
  const refreshKey = useZeropsCandidatesVersion();
  const revision = useRef(0);
  const [verification, setVerification] = useState<AccessVerification>({
    status: "loading",
    revision: 0,
  });
  const [admission, setAdmission] = useState<{
    readonly revision: number;
    readonly verifiedAtMs: number;
  } | null>(null);
  const ready = admission !== null;
  const [readWindowExpired, setReadWindowExpired] = useState(false);
  const lastVerifiedProjects = useRef<ReadonlyArray<VerifiedProject>>([]);
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
    let cancelled = false;
    const currentRevision = ++revision.current;
    setVerification({ status: "loading", revision: currentRevision });
    setAccountActionsAllowed(false);
    client.setWritesAllowed(false);
    void Effect.runPromise(
      runtime.observeAccess({
        kind: "access-verification-started",
        accountEpoch: runtime.scope.epoch,
      }),
    );
    void (async () => {
      const state = await Effect.runPromise(runtime.state);
      const previousProjects = inventoryProjectRefs(lastVerifiedProjects.current, state.access).map(
        (ref) => ({ id: ref.projectId, clientId: ref.organization.organizationId }),
      );
      const verified = await client.fetchUser();
      if (cancelled) return;
      updateVerifiedMemberships(verified);
      const currentOrganizations = zeropsClientsFromUser(verified);
      const perOrganization = await Promise.all(
        currentOrganizations.map(async (organization) => ({
          organization,
          projects: await verifyOperableProjects(client, organization, previousProjects),
        })),
      );
      if (cancelled) return;
      const projects = perOrganization.flatMap(({ organization, projects }) =>
        projects.map((project) => ({
          ...project,
          ref: projectRef(organization.id, project.project.id),
        })),
      );
      lastVerifiedProjects.current = projects;
      setVerification({
        status: "verified",
        revision: currentRevision,
        projects,
      });
    })().catch((cause: unknown) => {
      if (cancelled) return;
      const error = zeropsErrorMessage(cause);
      setVerification({ status: "failed", revision: currentRevision, error });
      void Effect.runPromise(
        runtime.observeAccess({
          kind: "access-verification-failed",
          accountEpoch: runtime.scope.epoch,
          failedAtMs: Date.now(),
          retryable: true,
          reason: error,
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [client, projectRef, refreshKey, runtime, updateVerifiedMemberships]);

  const verifiedProjects =
    verification.status === "verified" ? verification.projects : lastVerifiedProjects.current;
  const accessReadEntries = useMemo(() => [["access", runtime.reads.access] as const], [runtime]);
  const access = useZeropsAtomSelections(accessReadEntries).get("access");
  const supplementalAccess = supplementalAccessFor({
    verificationStatus: verification.status,
    access,
    epoch: runtime.scope.epoch,
  });
  const knownProjectRefs = useMemo(
    () => inventoryProjectRefs(verifiedProjects, supplementalAccess),
    [supplementalAccess, verifiedProjects],
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
  const verifiedProjectByKey = useMemo(
    () =>
      new Map(verifiedProjects.map((entry) => [inventoryProjectRefKey(entry.ref), entry.project])),
    [verifiedProjects],
  );
  const projectDescriptors = useMemo(
    () =>
      knownProjectRefs.flatMap((ref) => {
        const key = inventoryProjectRefKey(ref);
        const knowledge = projectReads.get(key)?.value;
        const observed =
          knowledge?.knowledge === "observed"
            ? projectRecordToZeropsProject(knowledge.record)
            : null;
        const status = observed?.status ?? verifiedProjectByKey.get(key)?.status;
        return status === undefined || status === "ACTIVE"
          ? [{ kind: "project-inventory" as const, project: ref }]
          : [];
      }),
    [knownProjectRefs, projectReads, verifiedProjectByKey],
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
    const projectRefs = new Map<string, ProjectRef>();
    const previousOutcomes = prevServiceOutcomesRef.current;
    const resolvedOrCarried = (projectId: string, computed: InventoryServiceOutcome) =>
      carryForwardServiceOutcome(previousOutcomes, projectId, computed);
    let complete = verification.status === "verified";
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
        services.set(dto.id, resolvedOrCarried(dto.id, { status: "failed" }));
        continue;
      }
      if (serviceRead.query.status !== "observed") {
        complete = false;
        services.set(dto.id, resolvedOrCarried(dto.id, { status: "failed" }));
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
      services.set(
        dto.id,
        resolvedOrCarried(
          dto.id,
          serviceComplete ? { status: "resolved", services: decoded } : { status: "failed" },
        ),
      );
    }
    prevServiceOutcomesRef.current = services;
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
    return { projects, services, projectRefs, complete: complete && observing, failedInterest };
  }, [
    organizationDescriptors,
    organizationReads,
    projectDescriptors,
    projectReads,
    serviceReads,
    verification.status,
    knownProjectRefs,
  ]);

  const error =
    verification.status === "failed"
      ? verification.error
      : projected.failedInterest
        ? "Some project access or services could not be verified. Try again."
        : null;

  useEffect(() => {
    if (verification.status !== "verified") {
      setAccountActionsAllowed(false);
      client.setWritesAllowed(false);
      return;
    }
    if (!projected.complete) {
      if (admission?.revision !== verification.revision) {
        setAccountActionsAllowed(false);
        client.setWritesAllowed(false);
      }
      return;
    }
    if (admission?.revision === verification.revision) return;
    const verifiedAtMs = Date.now();
    const deadlineMs = verifiedAtMs + ACCESS_WINDOW_MS;
    setReadWindowExpired(false);
    setAdmission({ revision: verification.revision, verifiedAtMs });
    setAccountActionsAllowed(true, deadlineMs);
    client.setWritesAllowed(true, deadlineMs);
    void Effect.runPromise(
      runtime.observeAccess({
        kind: "access-verified",
        grant: {
          account: runtime.scope.account,
          accountEpoch: runtime.scope.epoch,
          verifiedAtMs,
          deadlineMs,
          mutationsAllowed: true,
          organizations: organizations.map((organization) => ({
            organization: organizationRef(organization.id),
            mutationsAllowed: organization.canCreateProjects === true,
          })),
          projects: verification.projects.map(({ ref, role }) => ({
            project: ref,
            role,
            mutationsAllowed: true,
          })),
        },
      }),
    );
  }, [
    admission,
    client,
    organizationRef,
    organizations,
    projected.complete,
    runtime,
    verification,
  ]);

  useEffect(() => {
    if (admission === null) return;
    const remaining = Math.max(0, admission.verifiedAtMs + ACCESS_WINDOW_MS - Date.now());
    const timeout = window.setTimeout(() => {
      setAccountActionsAllowed(false);
      client.setWritesAllowed(false);
      setReadWindowExpired(true);
      void Effect.runPromise(
        runtime.observeAccess({
          kind: "access-expired",
          accountEpoch: runtime.scope.epoch,
          expiredAtMs: Date.now(),
        }),
      );
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [admission, client, runtime]);

  useEffect(() => {
    if (admission === null) return;
    const remaining = Math.max(
      0,
      admission.verifiedAtMs + ACCESS_WINDOW_MS - ACCESS_RENEWAL_LEAD_MS - Date.now(),
    );
    const timeout = window.setTimeout(refreshZeropsCandidates, remaining);
    return () => window.clearTimeout(timeout);
  }, [admission]);

  const visibleError =
    error ?? (readWindowExpired ? "Project access verification expired. Try again." : null);

  const snapshot = selectSnapshot({
    projects: projected.projects,
    services: projected.services,
    projectRefs: projected.projectRefs,
    isLoading: !projected.complete && error === null,
    error: visibleError,
  });

  return (
    <>
      {organizationDescriptors.map((descriptor) => (
        <InterestDemand
          key={interestKeyOf(descriptor)}
          descriptor={descriptor}
          refreshKey={refreshKey}
        />
      ))}
      {projectDescriptors.map((descriptor) => (
        <InterestDemand
          key={interestKeyOf(descriptor)}
          descriptor={descriptor}
          refreshKey={refreshKey}
        />
      ))}
      {!ready || readWindowExpired ? (
        visibleError !== null ? (
          <div role="alert" className="p-8">
            Could not load your Zerops projects. {visibleError}{" "}
            <button type="button" onClick={refreshZeropsCandidates}>
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
              <button type="button" onClick={refreshZeropsCandidates}>
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
