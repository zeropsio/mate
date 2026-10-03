import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  projectGrantsOf,
  withProjectGrants,
  type ZeropsProject,
  type ZeropsService,
} from "@t3tools/client-runtime/zerops";
import {
  evidenceProjectRefs,
  heldEvidence,
  inventoryProjectRefs,
  pendingDenials,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  interestKeyOf,
  organizationKeyOf,
  projectRecordToZeropsProject,
  serviceRecordToZeropsService,
  type GrantFailure,
  type InterestState,
  type OrganizationRef,
  type ProjectRef,
  type RuntimeInterestDescriptor,
  type ScopeAuthority,
  type ViewObservation,
} from "@t3tools/client-runtime/zerops/data";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { placeProjects } from "@t3tools/client-runtime/zerops/hq";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import * as Effect from "effect/Effect";
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
  type InventoryServiceOutcome,
} from "./inventoryContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import {
  INVENTORY_TROUBLE_HOLD_MS,
  inventoryTroubleVoice,
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
      [...next.services],
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
 * One account inventory, read from the data runtime: its projects and
 * services, and the access grant the runtime interprets (DESIGN §4.2) — the
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
export function ZeropsInventoryProvider({ children }: { readonly children: ReactNode }) {
  const { activeOrganization, organizationStatus, organizations, signOut, status } =
    useZeropsSession();
  const { runtime, organizationRef } = useZeropsData();
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
      organizations.map((organization): OrganizationInventoryDescriptor => ({
        kind: "organization-inventory",
        organization: organizationRef(organization.id),
      })),
    [organizationRef, organizations],
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
  /** The account's authority, as the grant last published it (G12). */
  const account = grant.machine.published.account ?? AUTHORIZED;
  /** The projects a confirming read proved lost (G6). */
  const lost = useMemo(
    () =>
      new Set(
        [...(evidence?.closedProjects.values() ?? [])]
          .filter(({ confirmation }) => confirmation.status === "confirmed")
          .map(({ project }) => project.projectId),
      ),
    [evidence],
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
    /** The organizations some of whose projects or services are not read yet. */
    const unread = new Set<string>();
    for (const ref of knownProjectRefs) {
      const key = inventoryProjectRefKey(ref);
      projectRefs.set(key, ref);
      // A project withheld until its denial is confirmed holds nothing open (G6).
      const incomplete = () => {
        if (denied.has(key)) return;
        unread.add(ref.organization.organizationId);
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
        projectId: null,
        interest: demandedInterest(
          organizationReads.get(interestKeyOf(descriptor))?.observation,
          descriptor,
        ),
      })),
      ...projectDescriptors.map((descriptor) => ({
        organization: descriptor.project.organization,
        projectId: descriptor.project.projectId as string | null,
        interest: demandedInterest(
          serviceReads.get(inventoryProjectRefKey(descriptor.project))?.observation,
          descriptor,
        ),
      })),
    ];
    const documentHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    /** The organizations whose data failed or stalled, once each. */
    const blocked = new Map<string, OrganizationRef>();
    /** Each failed or stalled read: its organization, and its project when it is one's. */
    const blockedReads: Array<{ organizationId: string; projectId: string | null }> = [];
    /** The organizations some of whose demanded reads are not observing yet: not answered. */
    const pending = new Set<string>();
    for (const { organization, projectId, interest } of demanded) {
      if (interest?.status !== "observing" && interest?.status !== "paused")
        pending.add(organization.organizationId);
      if (isInterestBlocked(interest, Date.now(), documentHidden)) {
        blocked.set(organizationKeyOf(organization), organization);
        blockedReads.push({ organizationId: organization.organizationId, projectId });
      }
    }
    return {
      projects,
      services,
      projectRefs,
      unreadOrganizations: [...unread],
      blockedOrganizations: [...blocked.values()],
      blockedReads,
      pendingOrganizations: pending,
    };
  }, [
    denied,
    organizationDescriptors,
    organizationReads,
    projectDescriptors,
    projectReads,
    serviceReads,
    knownProjectRefs,
  ]);

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
  // project's content leaves `projects` and `services` and comes back with its next authority.
  const shown = useMemo(() => {
    const withheld = new Set<string>(
      [...projected.projectRefs].flatMap(([key, ref]) =>
        account.kind === "withheld" || authority.get(key)?.kind === "withheld"
          ? [ref.projectId]
          : [],
      ),
    );
    return {
      projects: placed.filter(({ id }) => !withheld.has(id)),
      services: new Map([...projected.services].filter(([id]) => !withheld.has(id))),
    };
  }, [account, authority, placed, projected]);
  const held = useMemo(
    () => ({ projects: placed, services: projected.services }),
    [placed, projected.services],
  );
  const snapshot = selectSnapshot({
    projects: shown.projects,
    services: shown.services,
    projectRefs: projected.projectRefs,
    authority,
    account,
    lost,
    // A read failing or stalled is not known, spoken of yet or not: the 20 s silence decides only
    // when the account's line speaks, never what the data says (a Mate link settled "not found",
    // "no projects" painted and taken back). Scoped to the organization in view
    // (`organizationKnowledge`): another organization's trouble changes nothing its consumers see.
    isLoading: known.loading,
    error: shownError,
  });
  useEffect(() => {
    if (!ready) return;
    const {
      projects,
      services,
      projectRefs,
      authority: projectAuthority,
      account: accountAuthority,
    } = snapshot;
    registry.set(zeropsInventoryAtom, {
      projects,
      services,
      projectRefs,
      authority: projectAuthority,
      account: accountAuthority,
    });
  }, [ready, registry, snapshot]);

  return (
    <>
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
