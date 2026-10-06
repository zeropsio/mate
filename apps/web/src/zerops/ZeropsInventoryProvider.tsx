import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  listedProjectAtom,
  NOT_READ_PROJECTS,
  shownProjectsAtom,
} from "@t3tools/client-runtime/data";
import {
  projectGrantsOf,
  withProjectGrants,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import {
  evidenceProjectRefs,
  heldEvidence,
  inventoryProjectRefs,
  organizationProjectsRead,
  projectRead,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  DEFAULT_ZEROPS_DATA_POLICY,
  interestKeyOf,
  organizationKeyOf,
  projectRecordToZeropsProject,
  type GrantFailure,
  type InterestState,
  type OrganizationRef,
  type ProjectRef,
  ZeropsProjectId,
  type RuntimeInterestDescriptor,
  type ScopeAuthority,
  type ViewObservation,
} from "@t3tools/client-runtime/zerops/data";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { placeProjects } from "@t3tools/client-runtime/zerops/hq";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ZeropsFrameWait } from "../components/zerops/landing/ZeropsLandingShell";
import { useAppsEnvironments, useEveryAppId } from "./projectFlows";
import {
  hqPlacementsAtom,
  zeropsDataRuntimeAtom,
  zeropsInventoryAtom,
  zeropsSessionAtom,
} from "../state/zerops";
import { invalidateZerops } from "./accountInvalidations";
import {
  HeldInventoryContext,
  InventoryContext,
  AccountTroubleContext,
  type AccountTrouble,
  inventoryProjectRefKey,
  type Inventory,
} from "./inventoryContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import {
  INVENTORY_TROUBLE_HOLD_MS,
  inventoryTroubleVoice,
  troubleLatch,
  type TroubleEntry,
  organizationKnowledge,
  troubleSubject,
} from "./inventoryTrouble.logic";
import { useHeldFor } from "./useHeldFor";
import {
  stabilizeZeropsAtom,
  useZeropsAtomSelections,
  useZeropsData,
  zeropsKnowledgeArraysEqual,
} from "./zeropsDataContext";

export { useZeropsInventory } from "./inventoryContext";

type OrganizationInventoryDescriptor = Extract<
  RuntimeInterestDescriptor,
  { readonly kind: "organization-inventory" }
>;

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
 * How long past an interest's own published deadline or retry time a render is given before a
 * stall reads as one: the runtime's own max backoff, so the ordinary gap between a backoff timer
 * waking and the re-establishment it starts never flips the screen to an error mid-recovery.
 */
const STALL_GRACE_MS = 30_000;

/**
 * Whether a demanded interest has stopped making progress for long enough that a spinner is no
 * longer honest — the Try again belongs here instead (H5). A failure the runtime retries on its
 * own is recovering, not stuck: only one past its attempt limit, or whose own published retry time
 * passed by `STALL_GRACE_MS` with nothing since, reads as a stall. One the reducer published
 * before the runtime stamped its retry (`retryAtMs: null`, retryable) is never already elapsed; one
 * no retry follows (not retryable) is stuck at once. A hidden document is never stuck: the runtime
 * pauses recovery in the background on purpose. No timer is started to notice a stall: it is
 * re-evaluated on whatever re-render the runtime's own publications already cause.
 */
export function isInterestBlocked(
  interest: InterestState | undefined,
  nowMs: number,
  documentHidden: boolean,
): boolean {
  if (interest === undefined || documentHidden) return false;
  switch (interest.status) {
    case "failed":
      if (interest.retryAtMs === null) return !interest.retryable;
      return (
        interest.attempts > DEFAULT_ZEROPS_DATA_POLICY.recoveryAttemptLimit ||
        nowMs >= interest.retryAtMs + STALL_GRACE_MS
      );
    case "establishing":
      return interest.deadlineMs > 0 && nowMs >= interest.deadlineMs + STALL_GRACE_MS;
    case "observing":
    case "paused":
      return false;
  }
}

/**
 * What the demanded reads say (H5): which organizations are still loading — an establishing read
 * alone, never a failed one — and which are in trouble, with whether every failing read retries
 * on its own. A failure stays one trouble through its retries (`troubleLatch`), so the account's
 * line never flickers at an attempt's edge; a read stuck past its deadline is trouble too.
 */
export function demandedReads(
  demanded: ReadonlyArray<{
    readonly organization: OrganizationRef;
    readonly projectId: string | null;
    readonly interest: InterestState | undefined;
  }>,
  latch: ReadonlyMap<string, TroubleEntry>,
  nowMs: number,
  documentHidden: boolean,
): {
  readonly pending: ReadonlySet<string>;
  readonly blockedOrganizations: ReadonlyArray<OrganizationRef>;
  readonly blockedReads: ReadonlyArray<{ organizationId: string; projectId: string | null }>;
  readonly retrying: boolean;
  readonly latch: ReadonlyMap<string, TroubleEntry>;
} {
  /** The organizations whose data failed or stalled, once each. */
  const blocked = new Map<string, OrganizationRef>();
  /** Each failed or stalled read: its organization, and its project when it is one's. */
  const blockedReads: Array<{ organizationId: string; projectId: string | null }> = [];
  /** Only an establishing interest owns a read still in flight. */
  const pending = new Set<string>();
  let retrying = true;
  for (const { organization, projectId, interest } of demanded) {
    if (interest === undefined) continue;
    if (interest.status === "establishing") pending.add(organization.organizationId);
    if (isInterestBlocked(interest, nowMs, documentHidden)) {
      blocked.set(organizationKeyOf(organization), organization);
      blockedReads.push({ organizationId: organization.organizationId, projectId });
    }
  }
  const troubled = documentHidden
    ? latch
    : troubleLatch(
        latch,
        demanded.map(({ organization, projectId, interest }) => ({
          organizationId: organization.organizationId,
          projectId,
          interest,
        })),
      );
  if (!documentHidden)
    for (const { organization } of demanded) {
      const entry = troubled.get(organization.organizationId);
      if (entry === undefined) continue;
      if (!blocked.has(organizationKeyOf(organization))) blockedReads.push(...entry.reads);
      blocked.set(organizationKeyOf(organization), organization);
      if (!entry.retrying) retrying = false;
    }
  return {
    pending,
    blockedOrganizations: [...blocked.values()],
    blockedReads,
    retrying,
    latch: troubled,
  };
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
    why: "user-retry",
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
      [...next.projectRefs.keys()],
      [...next.authority],
      next.account,
      [...next.lost],
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
 * What a lapse says (DESIGN §3.4, R-K3): one sentence that names its cause
 * only, beside "Try now" once a renewal failed. The grant keeps that failure
 * until the next grant, so the rounds a wake or "Try now" starts keep the
 * failure's words, and no countdown changes them.
 */
export function accessLapseCopy(failure: GrantFailure | null): {
  readonly sentence: string;
  readonly retry: boolean;
} {
  return failure === null
    ? { sentence: "Checking your Zerops access…", retry: false }
    : { sentence: "Zerops isn't answering.", retry: true };
}

const AUTHORIZED: ScopeAuthority = { kind: "authorized" };

/**
 * One account inventory: its projects, as the account's store lists them
 * (`projectBridge`), and the access grant the runtime interprets (DESIGN §4.2) — the
 * evidence that names the projects, each project's authority, and the lapse.
 *
 * It holds no demand of its own: the account runtime holds the inventories it
 * reads (DESIGN §5 L7). Its gate mounts the product on the epoch's first grant
 * (D2), while those inventories may still be unread.
 *
 * It publishes the runtime, the session and, once the product mounts, the
 * inventory into the account's atom registry (`state/zerops.ts`): the one base
 * the derived candidate listing, names, Mates and topology read, which starts
 * over when the account closes. Withholding is applied at that one read, per
 * project and for the whole account while it lapses (§3.1, G12); a lapse is
 * the app's one banner, never a cover over the product.
 */
export function ZeropsInventoryProvider({
  children,
  pending,
}: {
  readonly children: ReactNode;
  readonly pending?: ReactNode;
}) {
  const { activeOrganization, organizationStatus, organizations, signOut, status } =
    useZeropsSession();
  const { runtime, organizationRef, projectRef } = useZeropsData();
  const registry = useContext(RegistryContext);
  useEffect(() => {
    registry.set(zeropsDataRuntimeAtom, runtime);
  }, [registry, runtime]);
  useEffect(() => {
    registry.set(zeropsSessionAtom, {
      status,
      organizationStatus,
      activeOrganization:
        activeOrganization === null ? null : organizationRef(activeOrganization.id),
    });
  }, [activeOrganization, organizationRef, organizationStatus, registry, status]);
  const grant = useAtomValue(runtime.access.view);
  /** The first mount happened; the product stays mounted from then on for the epoch. */
  const [admitted, setAdmitted] = useState(false);
  const selectSnapshot = useMemo(makeInventorySnapshotSelector, []);

  const organizationDescriptors = useMemo(
    () =>
      (activeOrganization === null ? [] : [activeOrganization]).map(
        (organization): OrganizationInventoryDescriptor => ({
          kind: "organization-inventory",
          organization: organizationRef(organization.id),
        }),
      ),
    [organizationRef, activeOrganization],
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
  /** The account's authority, as the grant last published it (G12). */
  const account = grant.machine.published.account ?? AUTHORIZED;
  /** The projects the platform refused or proved gone (G6). */
  const lost = useMemo(() => new Set<string>(evidence?.closedProjects.keys() ?? []), [evidence]);

  const organizationReadEntries = useMemo(
    () =>
      organizationDescriptors.map(
        (descriptor) =>
          [
            interestKeyOf(descriptor),
            stabilizeZeropsAtom(
              // In transit (`projectBridge`): the organization's projects are the account store's.
              Atom.make((get) => {
                const { orgId, ...roster } = get(shownProjectsAtom);
                return organizationProjectsRead(
                  descriptor.organization,
                  orgId === descriptor.organization.organizationId ? roster : NOT_READ_PROJECTS,
                );
              }),
              (left, right) =>
                left.query === right.query &&
                zeropsKnowledgeArraysEqual(left.value, right.value) &&
                left.observation.access === right.observation.access &&
                demandedInterest(left.observation, descriptor) ===
                  demandedInterest(right.observation, descriptor),
            ),
          ] as const,
      ),
    [organizationDescriptors],
  );
  const organizationReads = useZeropsAtomSelections(organizationReadEntries);
  const hqEnvironments = useAppsEnvironments(useEveryAppId());
  const knownProjectRefs = useMemo(() => {
    const refs = new Map(
      inventoryProjectRefs(evidenceProjectRefs(evidence), access)
        .filter((ref) => ref.organization.organizationId === activeOrganization?.id)
        .map((ref) => [inventoryProjectRefKey(ref), ref]),
    );
    // An organization's projects are this account's only while its grant names the organization.
    const granted = new Set(
      (evidence?.account.organizations ?? []).map(
        ({ organization }) => organization.organizationId as string,
      ),
    );
    for (const [key, read] of organizationReads) {
      const descriptor = organizationDescriptors.find(
        (candidate) => interestKeyOf(candidate) === key,
      );
      if (descriptor === undefined || !granted.has(descriptor.organization.organizationId))
        continue;
      for (const entry of read.value) {
        const ref = entry.knowledge === "observed" ? entry.record.ref : entry.ref;
        if (!lost.has(ref.projectId)) refs.set(inventoryProjectRefKey(ref), ref);
      }
    }
    // HQ supplies relations by project id, including projects absent from the search listing.
    // Naming their refs does not read them: a visible stop's deployment demand owns the read.
    if (activeOrganization !== null) {
      for (const { environments } of Object.values(hqEnvironments)) {
        for (const { projectId } of environments ?? []) {
          if (lost.has(ZeropsProjectId.make(projectId))) continue;
          const ref = projectRef(activeOrganization.id, projectId);
          refs.set(inventoryProjectRefKey(ref), ref);
        }
      }
    }
    return [...refs.values()];
  }, [
    access,
    evidence,
    organizationDescriptors,
    organizationReads,
    activeOrganization,
    lost,
    hqEnvironments,
    projectRef,
  ]);
  const projectReadEntries = useMemo(
    () =>
      knownProjectRefs.map(
        (ref) =>
          [
            inventoryProjectRefKey(ref),
            stabilizeZeropsAtom(
              // In transit (`projectBridge`): each project is the account store's.
              Atom.make((get) => projectRead(ref, get(listedProjectAtom(ref.projectId)))),
              (left, right) => zeropsKnowledgeArraysEqual([left.value], [right.value]),
            ),
          ] as const,
      ),
    [knownProjectRefs],
  );
  const projectReads = useZeropsAtomSelections(projectReadEntries);
  /** Each organization whose data failed and has not observed since (`troubleLatch`). */
  const troubleRef = useRef<ReadonlyMap<string, TroubleEntry>>(new Map());
  // The latch holds still while the tab is hidden; a tab shown again reads its demand afresh.
  const [documentHidden, setDocumentHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const projected = useMemo(() => {
    const projects: ZeropsProject[] = [];
    const projectRefs = new Map<string, ProjectRef>();
    /** The organizations some of whose projects are not read yet. */
    const unread = new Set<string>();
    for (const ref of knownProjectRefs) {
      const key = inventoryProjectRefKey(ref);
      projectRefs.set(key, ref);
      const project = projectReads.get(key)?.value;
      const dto =
        project?.knowledge === "observed" ? projectRecordToZeropsProject(project.record) : null;
      if (dto === null) {
        unread.add(ref.organization.organizationId);
        continue;
      }
      projects.push(dto);
    }
    const demanded = organizationDescriptors.map((descriptor) => ({
      organization: descriptor.organization,
      projectId: null,
      interest: demandedInterest(
        organizationReads.get(interestKeyOf(descriptor))?.observation,
        descriptor,
      ),
    }));
    const read = demandedReads(demanded, troubleRef.current, Date.now(), documentHidden);
    troubleRef.current = read.latch;
    return {
      projects,
      projectRefs,
      unreadOrganizations: [...unread],
      blockedOrganizations: read.blockedOrganizations,
      blockedReads: read.blockedReads,
      pendingOrganizations: read.pending,
      retrying: read.retrying,
    };
  }, [documentHidden, organizationDescriptors, organizationReads, projectReads, knownProjectRefs]);

  const phase = grant.machine.phase;
  /** What the first mount's gate says when its wait failed. */
  const error =
    phase.phase === "unverified-failed"
      ? (grant.failure ?? "Zerops didn't answer.")
      : projected.blockedOrganizations.length > 0
        ? "Some project access or services could not be verified."
        : null;

  // The account gate: the first mount waits for the epoch's first grant and
  // for nothing else (D2, §9 C10) — services render per region as they arrive.
  // The runtime holds the grant before the gate opens: `ready` is what mounts
  // the children, and the first thing some of them do is lease a resource —
  // which the broker refuses until the runtime holds a grant. Opening the gate
  // first made `/zerops/new` fail its locations read on every cold load
  // (measured 2026-09-20).
  const firstRound =
    phase.phase === "granted" && access?.status === "verified"
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

  /** What the app's banner says while the mounted product's grant is lapsed, until the next grant. */
  const lapse = ready && phase.phase === "lapsed" ? accessLapseCopy(phase.failure) : null;
  // The mounted product's own trouble: a round failing, or the data of the organization in view
  // failed or stalled — another organization's is not what anyone is looking at, unless none is
  // chosen yet. It never covers or freezes the product; it speaks only once it has lasted
  // (`inventoryTroubleVoice`).
  const known = organizationKnowledge({
    grantFailed: phase.phase === "unverified-failed",
    blocked: projected.blockedOrganizations.map(({ organizationId }) => organizationId),
    // No evidence yet reads nothing at all.
    unread: evidence === null ? organizations.map(({ id }) => id) : projected.unreadOrganizations,
    active: activeOrganization?.id ?? null,
  });
  const trouble = known.trouble;
  const troubleHeld = useHeldFor(ready && trouble !== null, INVENTORY_TROUBLE_HOLD_MS);
  const voice = inventoryTroubleVoice({
    mounted: ready,
    lapsed: lapse !== null,
    sessionEnded: status !== "signed-in",
    trouble,
    troubledForMs: troubleHeld ? INVENTORY_TROUBLE_HOLD_MS : 0,
    retrying: trouble === "grant" || projected.retrying,
  });
  const shownError = voice?.sentence ?? null;
  const retry = () => {
    const intents = retryInvalidations({
      granted: phase.phase === "granted",
      blockedOrganizations: projected.blockedOrganizations,
    });
    for (const intent of intents) invalidateZerops(intent);
  };
  // "Try now" and "Sign out" from the account's line at the menu's foot: one function each for
  // the product's life, always asking for what this render's trouble names.
  const retryRef = useRef(retry);
  const signOutRef = useRef(signOut);
  useEffect(() => {
    retryRef.current = retry;
    signOutRef.current = signOut;
  });
  const retryNow = useCallback(() => retryRef.current(), []);
  const signOutNow = useCallback(() => void signOutRef.current(), []);
  // The account speaks from one place, the menu's foot: its lapse, which withholds every region
  // meanwhile, or its inventory's lasting trouble — never over the product. This publishes the
  // facts and the actions; the line (`useAccountVoice`) owns what Try now says while it runs.
  // Answered is the grant held and every read of the organization in view observing again.
  const unanswered =
    lapse !== null ||
    voice !== null ||
    trouble !== null ||
    [...projected.pendingOrganizations].some(
      (organizationId) => activeOrganization === null || organizationId === activeOrganization.id,
    );
  // What isn't answering, named under the line's sentence (`troubleSubject`).
  const inView = activeOrganization ?? null;
  const subject =
    lapse !== null || trouble === "grant"
      ? "Your Zerops access"
      : trouble === "organization"
        ? troubleSubject({
            organization:
              inView?.name ??
              organizations.find(({ id }) => id === projected.blockedReads[0]?.organizationId)
                ?.name ??
              "Zerops",
            organizationList: projected.blockedReads.some(
              ({ organizationId, projectId }) =>
                projectId === null && (inView === null || organizationId === inView.id),
            ),
            projects: [
              ...new Set(
                projected.blockedReads.flatMap(({ organizationId, projectId }) =>
                  projectId === null || (inView !== null && organizationId !== inView.id)
                    ? []
                    : [projected.projects.find(({ id }) => id === projectId)?.name ?? projectId],
                ),
              ),
            ],
          })
        : null;
  const lapseSentence = lapse?.sentence ?? null;
  const lapseRetry = lapse?.retry ?? false;
  const accountTrouble = useMemo(
    (): AccountTrouble => ({
      lapse: lapseSentence === null ? null : { sentence: lapseSentence, retry: lapseRetry },
      trouble: voice,
      unanswered,
      subject,
      retry: retryNow,
      signOut: signOutNow,
    }),
    [lapseRetry, lapseSentence, retryNow, signOutNow, subject, unanswered, voice],
  );

  // Each project where the organization's HQ places it (ADR 0002), as last known, with its own
  // grants as the access grant's last round read them: the records carry none, and HQ's rule
  // weighs a member's grant above their org role (F12).
  const placements = useAtomValue(hqPlacementsAtom);
  const grants = useMemo(() => projectGrantsOf(evidence), [evidence]);
  const placed = useMemo(
    () =>
      (placements === null
        ? projected.projects
        : placeProjects(projected.projects, placements)
      ).map((project) => withProjectGrants(project, grants)),
    [grants, placements, projected.projects],
  );

  // Withholding is applied here, at the inventory's one read (DESIGN law 5, §3.1): a withheld
  // project's content leaves `projects` and comes back with its next authority.
  const shown = useMemo(() => {
    const withheld = new Set<string>(
      [...projected.projectRefs].flatMap(([key, ref]) =>
        account.kind === "withheld" || authority.get(key)?.kind === "withheld"
          ? [ref.projectId]
          : [],
      ),
    );
    return placed.filter(({ id }) => !withheld.has(id));
  }, [account, authority, placed, projected]);
  const held = useMemo(() => ({ projects: placed }), [placed]);
  const snapshot = selectSnapshot({
    projects: shown,
    projectRefs: projected.projectRefs,
    authority,
    account,
    lost,
    // Only the active organization's held reads affect its loading and failure notices.
    isLoading: projected.pendingOrganizations.has(activeOrganization?.id ?? ""),
    error: shownError,
  });
  useEffect(() => {
    if (!ready) return;
    const {
      projects,
      projectRefs,
      authority: projectAuthority,
      account: accountAuthority,
    } = snapshot;
    registry.set(zeropsInventoryAtom, {
      projects,
      projectRefs,
      authority: projectAuthority,
      account: accountAuthority,
    });
  }, [ready, registry, snapshot]);

  return (
    <>
      {!ready ? pending : null}
      {!ready ? (
        error !== null ? (
          <ZeropsFrameWait label="Could not load your Zerops projects." signedIn>
            <div role="alert" className="p-8 text-sm">
              Could not load your Zerops projects. {error}{" "}
              <button type="button" onClick={retry}>
                Try again
              </button>{" "}
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </ZeropsFrameWait>
        ) : grant.overdue ? (
          <ZeropsFrameWait label="Still checking your Zerops projects." signedIn>
            <div role="alert" className="p-8 text-sm">
              Still checking your Zerops projects.{" "}
              <button type="button" onClick={retry}>
                Try again
              </button>{" "}
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </ZeropsFrameWait>
        ) : (
          <ZeropsFrameWait label="Checking your Zerops projects…" signedIn />
        )
      ) : (
        <InventoryContext value={snapshot}>
          <HeldInventoryContext value={held}>
            <AccountTroubleContext value={accountTrouble}>{children}</AccountTroubleContext>
          </HeldInventoryContext>
        </InventoryContext>
      )}
    </>
  );
}
