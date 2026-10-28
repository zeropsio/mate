import { useClientSettings } from "~/hooks/useSettings";
import { useMateRecovery } from "~/zerops/useMateRecovery";
import { useHqMateRefusal } from "~/zerops/useHqMateRefusal";
import { recoveryNotice } from "@t3tools/client-runtime/data";
import { MateStateDetails } from "./MateStateDetails";
import { ConversationOpeningStage } from "../chat/ConversationOpeningStage";
import { removeFailedZeropsProject } from "./removeFailedZeropsProject";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  listedProjectAtom,
  hqMateAnsweredAtom,
  shownHqMateIdentitiesAtom,
  shownHqMenuNavigationAtom,
  mateArrival,
  setupFailure as setupFailureProjection,
  setupFailureLogQuery,
  setupFailureReason,
} from "@t3tools/client-runtime/data";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { birthFaceOf } from "@t3tools/client-runtime/zerops/hq";
import { useAccountDataOptional, useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
import { useBuildLog } from "~/zerops/activity/useBuildLog";
import { environmentShell } from "~/state/shell";
/**
 * A Mate's own view (`/mate/$projectId`): where Add lands, and where every door opens a Mate whose
 * conversation cannot be opened yet (`useOpenMate`).
 *
 * A New project's first Mate lands a moment before, on the same view by the creation's own id
 * (`ZeropsNewProjectComingPage`), which hands over to this one once the platform takes the Mate's
 * project; its progress keeps the project's own steps before the Mate's while this tab holds the
 * creation (`newProjectBirth.ts`).
 *
 * A new Mate comes up here. It is the Mate's empty conversation before the conversation exists —
 * the same header line, the same face a third of the way down, the same stage
 * (`MateEmptyStateView`, the "Arrival" board's Direction A) — saying it is coming up, how long is
 * left, and the Mate's own steps in the slot with their times (`arrivalSteps`). A Mate that did
 * not come says so, with the page's *Remove*; a step past its cap, with its *Keep waiting*. Once
 * it is up — connected, its main conversation and the agents' sign-in read — the words hand over
 * in place: the face wakes, "Sign Quinn in to start." takes the headline's place and the sign-in
 * takes the steps' (`ZeropsAgentSignIn`). Then the conversation takes the route, painting that
 * same frame at once, so the person never sees a page change.
 *
 * Any other Mate waits here for its link: its name under its face, and under it what its machine
 * waits for, in the route gate's words — "Reconnecting…", "This Mate isn't answering. Trying again
 * in 5 s." with *Try now*, "This Mate isn't running." — while the view connects it as the projects
 * screen's Connect would, where the person's Zerops session allows. Its conversation takes the
 * route the moment it can be opened. A Mate that cannot be opened — gone, replaced, refused, not
 * on the account — says why here, with the way to the projects: nothing here hands the person to
 * another screen on its own (the owner, 2026-09-30: "it just throws me at /zerops page").
 */
import { useMateRegistration } from "~/zerops/registration";
import { chiefRegistrationOffered } from "./chief/chiefRegistration.logic";
import { useProjectCapabilities, useRoleOffers } from "~/zerops/usePlatformCapabilities";
import { useOrgOffers } from "~/zerops/useHqOffers";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "~/zerops/accountOperations";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useOwnChief } from "~/zerops/ownChief";
import { ChiefOverviewButton } from "./chief/ChiefOverviewButton";
import { MateFaceAsMark } from "./primitives";
import { useMateOffers } from "~/zerops/useHqOffers";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  assignCandidateMateTints,
  FINISH_MATE_SETUP_VERB,
  nameUnderApp,
  readZeropsMembership,
  resolvePrimaryConversation,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { applyProjectCreationVerdict } from "@t3tools/client-runtime/zerops/candidates";
import {
  reachabilityCountsDown,
  type MateVoice,
} from "@t3tools/client-runtime/zerops/environments";
import {
  birthCopyServices,
  birthRuntimesFacts,
  type BirthCopyService,
} from "@t3tools/client-runtime/zerops/birthProgress";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { stageSpeaks } from "~/zerops/mateOpeningStage";
import { ConversationFooterStandIn } from "./ConversationFooterStandIn";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";

import { useEnvironmentLinks } from "~/routes/-environmentTargets";
import { useThreadDetail, useThreadShells, useThreadStatus } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useAccountEnvironments, useConnectMate } from "~/zerops/accountEnvironments";
import {
  firstBuildState,
  halfMadeFor,
  LISTING_CATCH_UP_MS,
  listingLacksCreation,
  mateConnectKey,
  mateConversationEnvironment,
  type MateComing,
} from "@t3tools/client-runtime/data";
import { mateOpeningPhrase } from "~/zerops/mateComing";
import {
  mateStageAwake,
  zeropsMateAt,
  zeropsMateIdentityOf,
  type ZeropsMateIdentity,
} from "~/zerops/mateIdentities";
import { useZeropsMateDirectory } from "~/zerops/useZeropsMates";
import { takeMateConversation } from "~/zerops/mateOpening";
import {
  ARRIVAL_PACE_MS,
  arrivalRow,
  arrivalSteps,
  onSetupClock,
  pressNote,
  SETUP_FAILURE_WORDS,
  type ArrivalSubstep,
} from "~/zerops/mateArrival";
import { MATE_STAND_UP_RETRY_LABEL, mateStandUpPhase } from "~/zerops/mateStandUp";
import { dismissCreation, useCreations } from "~/zerops/creations";
import { useMateHandOver } from "~/zerops/newMate";
import {
  comingPlanned,
  madePressSteps,
  registrationSubstep,
  setupClockSince,
  madeOf,
  newProjectProgress,
} from "~/zerops/newProjectBirth";
import {
  mateNoticeVoice,
  mateArrivalNotice,
  type MateOperationRefusal,
} from "~/zerops/mateNoticeVoice";
import { useProjectActivity } from "~/zerops/activity/useProjectActivity";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import {
  useHqMainChats,
  useToldActivity,
  useLastKnownMateWords,
} from "~/zerops/useMenuMateReadings";
import { useOpenMate } from "~/zerops/useOpenMate";
import { usePressesElsewhere } from "~/zerops/usePressesElsewhere";
import { useUsualAgent } from "~/zerops/useUsualAgent";
import { useZeropsBirthProgress } from "~/zerops/useZeropsBirthProgress";
import { useZeropsDetailCandidates } from "~/zerops/useZeropsCandidates";
import { useProjectCreations } from "~/zerops/useProjectCreations";
import { useProjectServices } from "~/zerops/ZeropsAccountData";
import {
  closeOffHoldOf,
  finishSetupView,
  forgetPress,
  pressFailure,
  pressComing,
  useMatePress,
} from "~/zerops/matePress";
import { useDeleteProject } from "~/zerops/deleteProject";
import { MateRestartError } from "~/zerops/mateRestartRefusal";
import { useRestartMate, useReviveFailedMate } from "~/zerops/mateRestart";
import { refreshMateSetup, useMateSetup } from "~/zerops/useMateSetup";
import { useMateActions } from "~/zerops/useMateActions";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import type { MateSetup, MateSetupFailure } from "@t3tools/client-runtime/zerops/mateSetup";
import { useZeropsContainers } from "~/zerops/zeropsContainers";
import { useZeropsData } from "~/zerops/zeropsDataContext";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { MateDetailFailure } from "./MateDetailFailure";
import { useCloseOffHolds, useMateDetailRead } from "~/zerops/accountEnvironments";
import { MateLinkLine, MateOpeningLine } from "./MateLinkLine";
import { ZeropsProjectLink } from "./ZeropsProjectLink";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { PanelLayoutControls } from "../chat/PanelLayoutControls";
import { EllipsisIcon } from "lucide-react";
import { useZeropsThreadActivity } from "~/zerops/useZeropsAgentActivity";
import { useComposerDraftStore } from "~/composerDraftStore";
import type { BirthLineProgress } from "./ZeropsBirthProgress.logic";
import { Progress } from "../ui/progress";
import { PressSteps } from "./ZeropsEnvironmentCreationDialog";
import {
  MateEmptyStateView,
  useMateEmptyState,
  type MateEmptyComing,
} from "./ZeropsMateEmptyState";
import { usePreferredConnection } from "~/zerops/mateConnectionPreference";

/** How long a Mate that is up waits here for the directory to name it before its conversation opens anyway. */
export const HAND_OVER_NAME_WAIT_MS = 15_000;

/** The coming page reads no server version: its *Finish setup* is all it takes of the menu. */
const NO_VERSIONS: ReadonlyMap<string, string> = new Map();

/** The slate face a Mate wears where nobody picked one. */
const NO_FACE: ZeropsMateFace = { tint: "slate", shape: "squircle" };

const NO_SETUP_FAILURE = Atom.make<ActivityProcess | undefined>(undefined);

const EMPTY_SHELL_STATUS =
  Atom.make<import("@t3tools/client-runtime/state/shell").EnvironmentShellStatus>("empty");

export function ZeropsMateComingPage({ projectId }: { readonly projectId: string }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const navigate = useNavigate();
  const router = useRouter();
  const openMate = useOpenMate();
  const { activeOrganization, user } = useZeropsSession();
  const viewer = user?.id;
  // Which agent this project's other Mates use, read while it comes up: its sign-in is ready in it.
  useUsualAgent(projectId);
  const { organizationRef } = useZeropsData();
  const { listing, wholeForPerson, refresh: rereadListing } = useZeropsDetailCandidates();
  const held = useMemo(() => heldCandidates(listing), [listing]);
  const listed = held.rows.find((candidate) => candidate.project.id === projectId);
  const account = useAccountDataOptional();
  const project = useAtomValue(listedProjectAtom(projectId));
  const ownershipAnswered = useAtomValue(hqMateAnsweredAtom(projectId));
  const operations = useAccountOperationsOptional();
  const maySetUpChief = useRoleOffers().setUpChief;
  const projectCapabilities = useProjectCapabilities(projectId);
  const createOffer = useOrgOffers()("create_app");
  const [registeringChief, setRegisteringChief] = useState(false);
  const [chiefError, setChiefError] = useState<string | null>(null);
  // What this tab pressed for it, while it holds it.
  const press = useMatePress(projectId);
  const registration = useMateRegistration(projectId);
  const offers = useMateOffers()(projectId);
  const listedOnly = offers?.held === true && offers.observe.kind === "refused";
  const { services } = useProjectServices(projectId);
  // The New project or the Add this tab made whose Mate this is, while the tab holds it.
  const creations = useCreations();
  const made = useMemo(() => madeOf(creations, projectId), [creations, projectId]);
  // The platform's verdict on its creation, read while it may still be refused (H20).
  const verdicts = useProjectCreations(listed === undefined ? [] : [listed]);
  const candidate = useMemo(
    () =>
      listed === undefined
        ? undefined
        : applyProjectCreationVerdict(listed, verdicts.get(projectId)),
    [listed, projectId, verdicts],
  );
  // Made here, and not connected since: its press is over and its container on its way.
  const creation = candidate?.group === "connected" ? undefined : made;
  const { health } = useZeropsContainers();
  const containerHealth = candidate === undefined ? undefined : health.get(candidate.key);
  const pressRetry = press?.state.kind === "failed" ? press.state.retry : null;
  // Made here and still not listed a minute on: its organization's projects are read once more —
  // a deletion the socket pushed leaves the listing's time at its last full read.
  const unlisted = creation !== undefined && listed === undefined;
  // From its press, while this tab holds it; else from the press of Create or Add.
  const madeAt = creation === undefined ? undefined : (press?.startedAt ?? creation.startedAt);
  const reread = useRef(false);
  useEffect(() => {
    if (!unlisted || madeAt === undefined || reread.current) return;
    const timer = setTimeout(
      () => {
        reread.current = true;
        rereadListing();
      },
      Math.max(0, madeAt + LISTING_CATCH_UP_MS + 1_000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [madeAt, rereadListing, unlisted]);
  // Made here, and gone before it ever connected: a whole listing read well after lacks it.
  const listingLacksIt =
    creation !== undefined &&
    listingLacksCreation({
      listed: listed !== undefined,
      complete: held.complete,
      listedAtMs: listing.state === "known" ? listing.asOf.atMs : undefined,
      madeAtMs: press?.startedAt ?? creation.startedAt,
    });
  // What opens it is its machine (`mateLink`): found by its project while its row stands for the
  // project, and before the listing names it at all.
  const recovery = useMateRecovery(projectId, candidate?.service?.id);
  const admissionRefusal = useHqMateRefusal(projectId);
  const { mateLink } = useEnvironmentLinks();
  const rowKey = candidate?.key ?? projectId;
  const link = useMemo(
    () => mateLink({ key: rowKey, project: { id: projectId } }),
    [mateLink, projectId, rowKey],
  );
  // Its first build's processes, read only while its container waits for that build.
  const firstBuilding = candidate?.service?.status === "READY_TO_DEPLOY";
  const { processes: firstBuildProcesses } = useProjectActivity(firstBuilding ? projectId : null);
  // Held by the close-off gate: its view says why — and, where its project is known not closed
  // off, offers Finish setup.
  const closeOffHolds = useCloseOffHolds();
  const closeOffHold = closeOffHoldOf(closeOffHolds, projectId, press);
  // A press of it in another browser, as HQ holds it: no container yet is that press at work.
  const pressOf = usePressesElsewhere(held.rows);
  const orgId = useAccountOrgId();
  const failedProcess = useProjection(
    setupFailureProjection,
    orgId === null ||
      (press === undefined &&
        creation === undefined &&
        closeOffHold === undefined &&
        !firstBuilding)
      ? null
      : { orgId, projectId, serviceId: candidate?.service?.id },
    NO_SETUP_FAILURE,
  );
  const failureQuery = setupFailureLogQuery(failedProcess, candidate?.service?.id);
  const failureLog = useBuildLog({
    projectId: failureQuery === null ? null : projectId,
    query: failureQuery,
    live: false,
  });
  const [cameUp, setCameUp] = useState(false);
  // The person's own Chief, by HQ's word or before HQ names it.
  const ownChief = useOwnChief();

  // HQ names it as the menu does. Before registration, its creation or press names it.
  const identity = useAtomValue(shownHqMateIdentitiesAtom)[projectId];
  const hqStructure = useAtomValue(shownHqMenuNavigationAtom).structure;
  const tints = useMemo(() => assignCandidateMateTints(held.rows), [held.rows]);
  const mate = useMemo((): ZeropsMateIdentity => {
    if (identity !== undefined)
      return {
        ...(candidate === undefined ? {} : zeropsMateIdentityOf(candidate, tints)),
        ...identity,
        projectId,
        connected: candidate?.group === "connected",
      };
    if (candidate !== undefined) {
      // Listed before HQ records it: the face picked at its Add — its creation's or its press's,
      // else its open birth's at HQ — never its name's slate in between.
      const picked =
        creation?.face ?? press?.placement?.face ?? birthFaceOf(hqStructure, projectId);
      const listed = {
        ...zeropsMateIdentityOf(candidate, tints),
        ...(picked === undefined ? {} : { tint: picked.tint, shape: picked.shape }),
      };
      // Listed before HQ places it: no application to cut its name under, but its creation or its
      // press knows it, so its name is its own all along.
      const app = creation?.name ?? press?.placement?.groupName;
      if (readZeropsMembership(candidate.project).groupId !== undefined || app === undefined)
        return listed;
      return { ...listed, name: nameUnderApp(candidate.project.name, app) };
    }
    // A retained project label is not a Mate identity; only explicit Mate naming survives here.
    const face = creation?.face ?? press?.placement?.face ?? NO_FACE;
    return {
      name: creation?.botName ?? press?.placement?.displayName ?? "",
      projectId,
      tint: face.tint,
      shape: face.shape,
      project: creation?.name ?? press?.placement?.groupName,
      projectUrl: zeropsProjectUrl(projectId),
      connected: false,
      // This tab made it: the person looking asked for its stand-up.
      ...(creation !== undefined && viewer !== undefined ? { standUp: { by: viewer } } : {}),
    };
  }, [identity, press, candidate, creation, projectId, tints, viewer, hqStructure]);
  const isChief = mate.chief === true || ownChief === projectId;

  // Up: its main conversation, read live, and its agents' sign-in — what the conversation paints
  // first, painted here first. Its environment is the one its machine opens, or its row's once
  // connected. This page keeps a Mate's conversations current only while it is open: one started
  // elsewhere is the main chat HQ names for this project — only ever in the environment its own
  // link opens, so its address never lands on another Mate's conversation.
  const environmentId = mateConversationEnvironment(link, candidate);
  const threads = useThreadShells();
  const hqMain = useHqMainChats()(projectId);
  const primaryId = useMemo(
    () =>
      environmentId === null
        ? undefined
        : (resolvePrimaryConversation(
            threads.filter((thread) => thread.environmentId === environmentId),
          ).primary?.id ?? (hqMain?.environmentId === environmentId ? hqMain.threadId : undefined)),
    [environmentId, hqMain, threads],
  );
  const threadRef = useMemo(
    () =>
      environmentId === null || primaryId === undefined
        ? null
        : scopeThreadRef(environmentId, primaryId),
    [environmentId, primaryId],
  );
  const status = useThreadStatus(threadRef);
  const empty = useMateEmptyState({ environmentId, mate, threadRef, projectId });
  // The Mate on screen: its socket goes first, though this path names no environment.
  usePreferredConnection(environmentId);
  const shellStatus = useAtomValue(
    environmentId === null
      ? EMPTY_SHELL_STATUS
      : Atom.map(environmentShell.stateValueAtom(environmentId), (state) => state.status),
  );
  const {
    coming,
    page,
    arrival,
    handover: arrivalDecision,
    projectUnavailable,
  } = mateArrival({
    closeOffHold,
    press: pressComing(press),
    candidate,
    setUpFailed: pressFailure(press),
    nowMs: Date.now(),
    created: made !== undefined,
    madeAt: made?.startedAt,
    listingLacksIt,
    link,
    setupFailure: failedProcess,
    firstBuild: firstBuilding
      ? firstBuildState(firstBuildProcesses, candidate?.service?.id)
      : undefined,
    pressElsewhere: pressOf(projectId),
    listing: { complete: held.complete, wholeForPerson, lacksCreation: listingLacksIt },
    listedOnly,
    recovery,
    admissionRefusal,
    cameUp,
    conversation: {
      shell: shellStatus,
      hasConversation: threadRef !== null,
      detail: status,
      detailHeld: useThreadDetail(threadRef) !== null,
      signInKnown: empty.signInKnown,
    },
  });
  if (page?.kind === "coming" && !cameUp) setCameUp(true);
  const up = arrivalDecision === "conversation";

  // Preload the destination immediately. The shared opening stage keeps its face across the route;
  // only the destination's placement readiness starts the wake and hand-off.
  const [handing, setHanding] = useState(false);
  if (up && !handing) setHanding(true);
  // A Mate that came up here lands on a conversation that draws it only once the account's
  // directory names it there (`zeropsMates`): until then its sign-in stands here, where it is drawn
  // already — a stranger's empty conversation otherwise (run 2, 2026-10-16) — for a short wait at
  // most. Any other Mate opens as soon as its conversation can.
  const directory = useZeropsMateDirectory();
  const namedThere =
    environmentId !== null && zeropsMateAt(directory, environmentId).kind === "mate";
  const [nameWaitOver, setNameWaitOver] = useState(false);
  useEffect(() => {
    if (!handing || !cameUp || namedThere) return;
    const timer = setTimeout(() => setNameWaitOver(true), HAND_OVER_NAME_WAIT_MS);
    return () => clearTimeout(timer);
  }, [cameUp, handing, namedThere]);
  const lands = !cameUp || namedThere || nameWaitOver;
  const handingOver = useMateHandOver((state) => state.handingOver);
  const liveActivity = useZeropsThreadActivity(threadRef);
  // The draft of the conversation it opens on, which the held room lays out at its height.
  const draft = useComposerDraftStore((state) =>
    threadRef === null ? "" : (state.getComposerDraft(threadRef)?.prompt ?? ""),
  );
  // Until its conversation is read here: HQ's last word of it, as its menu row reads it.
  const toldActivity = useToldActivity(projectId);
  useEffect(() => {
    if (!handing || !lands || environmentId === null || threadRef === null) return;
    // Kept read from above every view while the route changes under it.
    const handOverId = cameUp ? handingOver(threadRef) : undefined;
    let current = true;
    let navigating = false;
    const handOver = async () => {
      const destination = {
        to: "/$environmentId/$threadId" as const,
        params: buildThreadRouteParams(threadRef),
        replace: true,
      };
      // Keep this stage on screen until the destination can render it; a route's loading
      // fallback would otherwise hide it before the conversation's stage takes its place.
      await router.preloadRoute(destination);
      if (!current) return;
      takeMateConversation(projectId)?.(threadRef);
      navigating = true;
      await navigate({
        ...destination,
        ...(handOverId === undefined ? {} : { state: { mateHandOver: handOverId } }),
      });
      if (handOverId !== undefined && router.state.location.state.mateHandOver !== handOverId)
        useMateHandOver.getState().cancel(handOverId);
    };
    void handOver().catch(() => {
      if (handOverId !== undefined) useMateHandOver.getState().cancel(handOverId);
    });
    return () => {
      current = false;
      if (!navigating && handOverId !== undefined) useMateHandOver.getState().cancel(handOverId);
    };
  }, [cameUp, environmentId, handing, handingOver, lands, navigate, projectId, router, threadRef]);

  // Its environment's conversations read, none of its own to hand over to (an older server):
  // opening it starts one, as its row would — once, telling what its door asked.
  const noConversation = arrivalDecision === "create-conversation";
  const opened = useRef(false);
  useEffect(() => {
    if (!noConversation || candidate === undefined || opened.current) return;
    opened.current = true;
    openMate(candidate, takeMateConversation(projectId));
  }, [candidate, noConversation, openMate, projectId]);

  // Its link, made as the projects screen's Connect would, where the person's session allows: a
  // Mate on its way, by its target; a new one, once its container answers and no socket to it is
  // open yet.
  const connect = useConnectMate("user");
  const asked = useRef<string | null>(null);
  const answering =
    page?.kind === "coming" &&
    candidate?.group === "ready" &&
    candidate.containerOrigin !== undefined &&
    containerHealth === "ready";
  // Once a machine names it: a Connect asked before the stage holds its target would end unheard.
  // A new Mate whose container is up is connected the same way while its board still stands: its
  // machine tries again on its own ladder, whatever its health reads.
  const reachingKey =
    (page?.kind === "reaching" || (page?.kind === "coming" && candidate?.group === "ready")) &&
    link.reachability !== null
      ? link.key
      : undefined;
  const connectKey = mateConnectKey({
    reachingKey,
    answering,
    candidateKey: candidate?.key,
  });
  useEffect(() => {
    // Once per target: from there its machine holds it, and tries again on its own ladder.
    if (connectKey === null || asked.current === connectKey) return;
    asked.current = connectKey;
    void connect({ key: connectKey });
  }, [connect, connectKey]);
  // On screen, it holds the screen's lease while the view stands (A9).
  const { failure: detailFailure, again: readAgain } = useMateDetailRead(projectId);
  const environments = useAccountEnvironments();
  useEffect(() => {
    if (environments === null) return;
    environments.setOnScreen(projectId);
    return () => environments.setOnScreen(null);
  }, [environments, projectId]);
  // Try now: the person's own retry of what its machine backs off from — and for a container
  // that failed, its stop and its start, which the platform asks for instead of a restart.
  const reviveFailed = useReviveFailedMate();
  const linkKey = link.key;
  const failedServiceId = candidate?.service?.id;
  const tryNow =
    linkKey === undefined
      ? undefined
      : () => {
          if (!reviveFailed(failedServiceId)) void connect({ key: linkKey });
        };

  const offerChiefRegistration = chiefRegistrationOffered({
    project: project ?? undefined,
    own: ownChief,
    maySetUp:
      maySetUpChief && createOffer.kind === "allowed" && operations !== null && orgId !== null,
    mayObserve: projectCapabilities.operate,
    anotherPersonsChief: admissionRefusal?.chiefOwnerName !== undefined,
    ownershipAnswered,
  });
  const registerChief = async () => {
    if (!offerChiefRegistration || registeringChief || operations === null || orgId === null)
      return;
    const current = captureAccountLifetime();
    setRegisteringChief(true);
    setChiefError(null);
    try {
      await operations.run(
        { kind: "set-chief", orgId, projectId },
        { orgId, unobserved: HQ_UNFOLLOWED },
      );
      if (!current()) return;
      account?.retryDetail({ family: "hqMate", ownerId: projectId });
      readAgain();
      const key = link.key ?? candidate?.key;
      if (key !== undefined) void connect({ key });
    } catch (cause) {
      if (current())
        setChiefError(cause instanceof Error ? cause.message : "Chief could not be registered.");
    } finally {
      if (current()) setRegisteringChief(false);
    }
  };

  // What its container says of its own setup, in any browser (`/mate/setup.json`): read only
  // while its card is on screen and its setup is under way, and why where it can't be read.
  // A read that could not be its setup is read again by the person's Try again, or once what it
  // depends on changed: a redeploy (another environment), or its server seen restarting (its
  // health moving).
  const setupOrigin = arrival !== undefined ? candidate?.containerOrigin : undefined;
  const { setup, failure: setupFailure } = useMateSetup(
    setupOrigin,
    `${link.environmentId ?? ""}|${containerHealth ?? ""}`,
  );
  // What it brings, named before its project lists them: its press's, then its creation's — a
  // press over never takes a line back before the project's own read or its setup answers.
  const planned = useMemo(() => comingPlanned(press, made), [press, made]);
  const madeSince = press?.startedAt ?? made?.startedAt;
  // How far it has got, as the projects page's card draws it.
  const progress = useZeropsBirthProgress(
    candidate === undefined && press === undefined && made === undefined
      ? null
      : {
          candidate: candidate ?? {
            key: projectId,
            project: {
              id: projectId,
              name: mate.name,
              status: "NEW",
              ...(madeSince === undefined ? {} : { created: new Date(madeSince).toISOString() }),
            },
            group: "provisioning",
          },
          health: containerHealth,
          connecting: candidate?.connection?.phase === "connecting",
          runtimes: birthRuntimesFacts({
            planned: planned.runtimes,
            setup: setup?.runtimes,
            services,
          }),
        },
    coming?.kind === "failed",
  );
  // What its copy's first step waits on: the managed services its press planned, else its
  // project's own.
  const managed = useMemo(
    () =>
      birthCopyServices({
        planned: planned.managed,
        services,
      }),
    [planned.managed, services],
  );
  // A New project's first Mate: the project's own steps stay before the Mate's, done, as its view
  // drew them before the platform took the Mate's project — one line, one clock, from the press.
  // Made here, the steps this tab runs stay under the project's row until the hand-over.
  // Its running step and its sentence count on its row's clock: from the first press — the
  // creation's, which this tab holds from Create or Add until it connects, so the clock reads the
  // same across the hand-over and once the press's own record is gone (run 2, 2026-10-16: 0:05,
  // then 0:00 at the hand-over; 0:34, 0:39, then 0:35 as the press ended).
  const setupSince = setupClockSince(made, press);
  // The steps this tab runs, as the creation's view drew them until its press is seen here, and
  // never again once it went: through, its record goes, and the tab is free for good.
  const [pressSeen, setPressSeen] = useState(false);
  if (press !== undefined && !pressSeen) setPressSeen(true);
  const pressSteps = madePressSteps({ made, press, pressSeen, registration });
  const lineProgress: ArrivalProgress | undefined =
    progress === null
      ? undefined
      : {
          ...onSetupClock(
            made === undefined || made.adds !== undefined
              ? progress.progress
              : newProjectProgress(made, progress.progress, progress.nowMs),
            setupSince,
          ),
          ...(managed === undefined ? {} : { managed }),
          ...(setup === undefined ? {} : { setup }),
          ...(setupFailure === undefined ? {} : { setupFailure }),
          // A registration's receipt stands after any originating press is gone.
          ...(press === undefined && registration.state === "unfinished"
            ? { press: [registrationSubstep(mate.name, registration)] }
            : pressSteps === undefined
              ? {}
              : { press: pressSteps }),
          ...(empty.agentReady ? { agentReady: true } : {}),
        };

  // *Finish setup*, where its press stopped before its container: the same verb as its menu's,
  // offered to an owner or an admin in any browser — and at once, where this tab's press saw its
  // registration refused.
  const unregistered = pressNote(lineProgress?.press)?.kind === "unfinished";
  const halfMade =
    (coming?.kind === "failed" && coming.verb === "finish-setup") ||
    closeOffHold === "open" ||
    unregistered;
  const registryState = useZeropsRegistry();
  const mateActions = useMateActions({ registry: registryState, serverVersions: NO_VERSIONS });
  const finishEntry =
    !halfMade || candidate === undefined
      ? undefined
      : mateActions
          .actionsFor(candidate, readZeropsMembership(candidate.project))
          .find((entry) => entry.id === "finish-setup");
  const finishSetup =
    finishEntry === undefined || "separator" in finishEntry ? undefined : finishEntry.onSelect;

  const redeployEntry =
    coming?.kind !== "failed" || coming.verb !== "redeploy" || candidate === undefined
      ? undefined
      : mateActions
          .actionsFor(candidate, readZeropsMembership(candidate.project))
          .find((entry) => entry.id === "redeploy");
  const redeploy =
    redeployEntry === undefined || "separator" in redeployEntry
      ? undefined
      : redeployEntry.onSelect;

  // *Finish setup* running, or through: its steps as the Add dialog draws them, and their end — on
  // a Mate this tab made, its own step under the project's row follows that press instead
  // (`creationSubsteps`), and nothing above it moves.
  const finish = made === undefined ? finishSetupView(press, registration) : undefined;

  const restartSetup = useRestartMate();
  const [retryingSetup, setRetryingSetup] = useState(false);
  const setupService = candidate?.service;
  const trySetupAgain =
    failedProcess === undefined || candidate === undefined || setupService === undefined
      ? undefined
      : () => {
          setRetryingSetup(true);
          setTrouble(null);
          void restartSetup({
            key: candidate.key,
            projectId,
            serviceId: setupService.id,
            status: setupService.status,
          })
            .then(() => forgetPress(projectId))
            .catch((error: unknown) =>
              setTrouble({
                kind: "retry",
                attemptId: failedProcess.id,
                receipt: error instanceof MateRestartError ? error.receipt : undefined,
                details: error instanceof Error ? error.message : String(error),
              }),
            )
            .finally(() => setRetryingSetup(false));
        };
  const failedReason =
    arrival?.kind !== "failed" || failedProcess === undefined
      ? undefined
      : setupFailureReason(
          mate.name,
          failedProcess.failReason,
          failureLog.lines.map((line) => line.text),
        );

  const deleteProject = useDeleteProject();
  const [removing, setRemoving] = useState(false);
  const [trouble, setTrouble] = useState<MateOperationRefusal | null>(null);
  const remove = () => {
    if (activeOrganization === null) return;
    const organization = organizationRef(activeOrganization.id);
    setRemoving(true);
    setTrouble(null);
    void removeFailedZeropsProject({
      projectId,
      organization,
      deleteProject,
      forgetCreation: (id) => {
        forgetPress(id);
        if (made !== undefined) dismissCreation(made.birthId);
      },
    }).then((outcome) => {
      setRemoving(false);
      if (!outcome.ok) {
        setTrouble({ kind: "remove", details: outcome.error });
        return;
      }
      void navigate({ to: "/zerops", replace: true });
    });
  };

  const operationTrouble =
    trouble ??
    (mateActions.trouble === null
      ? null
      : {
          kind: "finish" as const,
          details: mateActions.trouble,
        });

  // On its way to its conversation and not handed over yet — its link being made, its conversation
  // and its sign-in still being read — a new Mate stays coming, its progress whole, until the words
  // can turn into the conversation's own. A half-made Mate names Finish setup only where this
  // viewer has it, and who can where not.
  const shown: MateComing | undefined =
    arrival === undefined ? undefined : halfMadeFor(arrival, finishSetup !== undefined);
  // The hand-over: the words turn into the conversation's own, and the header with them — its way
  // into Zerops and its actions arrive here, in place, so the route changes under an unchanged frame.
  const handingArrival = handing && cameUp;
  const phaseAhead = mateStandUpPhase({
    marker: mate.standUp,
    viewer: user?.id,
    awaited: true,
    signIn: "unknown",
  });
  // Any other Mate: its name over what its link waits for, or why it cannot be opened — nameless
  // where nothing names it, never a placeholder over its face; only its link's words say "This
  // Mate" then.
  const named = mate;
  // The minute clock its pose reads (`mateArriving`).
  const nowMs = useSecondsNowMs(
    page?.kind === "reaching" && reachabilityCountsDown(page.reachability),
  );
  // The same source-driven link voice as an existing conversation.
  const linkReachability =
    page?.kind === "reaching" || page?.kind === "unreachable"
      ? page.reachability
      : page?.kind === "up"
        ? (link.reachability ?? null)
        : null;
  const lastKnown = useLastKnownMateWords(projectId, named.name);
  const linkVoice = mateNoticeVoice({
    reachability: linkReachability,
    recovery,
    conversationShown: false,
    nowMs,
    mateName: named.name,
    lastKnown,
  });
  const arrivalWords = mateArrivalNotice({
    coming: shown,
    progress: lineProgress,
    failureReason: failedReason?.text,
    details: failedReason?.details,
    attemptId: failedProcess?.id,
    refusal: operationTrouble,
    finish: finish?.line,
  });
  const view: MateEmptyComing | null =
    page === undefined
      ? null
      : shown !== undefined
        ? mate.name.length === 0
          ? null
          : {
              kind: shown.kind,
              over: handing,
              pressed: made !== undefined,
              sentence: arrivalWords.secondary,
              below:
                finish !== undefined &&
                shown.kind === "coming" &&
                arrivalWords.details === undefined ? (
                  <PressSteps name={mate.name} steps={finish.steps} />
                ) : (
                  <ComingBelow
                    operationTrouble={operationTrouble}
                    attemptId={failedProcess?.id}
                    coming={shown}
                    mate={mate}
                    nowMs={progress?.nowMs}
                    onRemove={remove}
                    onRedeploy={redeploy}
                    {...(finishSetup === undefined ? {} : { onFinishSetup: finishSetup })}
                    finishing={mateActions.busyKey === candidate?.key}
                    {...(pressRetry === null
                      ? {}
                      : { onTryAgain: trySetupAgain ?? (() => void pressRetry()) })}
                    {...(setupOrigin === undefined
                      ? {}
                      : { onSetupAgain: () => refreshMateSetup(setupOrigin) })}
                    {...(failedReason === undefined
                      ? {}
                      : {
                          setupFailureDetails: {
                            details: failedReason.details,
                            status: failureLog.status,
                            process: failedProcess!,
                            projectUrl: mate.projectUrl,
                            retrying: retryingSetup,
                          },
                          onTryAgain: trySetupAgain,
                        })}
                    progress={lineProgress}
                    removing={removing}
                  />
                ),
            }
        : page.kind === "coming"
          ? null
          : page.kind === "unreachable"
            ? {
                kind: "unreachable",
                severity: linkVoice.surface === "none" ? undefined : linkVoice.severity,
                face: "sleep",
                headline: projectUnavailable
                  ? recoveryNotice(recovery, named.name)?.headline
                  : page.reachability === null
                    ? (mateOpeningPhrase(page, { nowMs, mateName: named.name }).text ?? undefined)
                    : linkVoice.surface === "none"
                      ? undefined
                      : (linkVoice.headline ?? linkVoice.text ?? undefined),
                sentence: projectUnavailable
                  ? recoveryNotice(recovery, named.name)?.secondary
                  : linkVoice.surface === "none"
                    ? undefined
                    : linkVoice.secondary,
                below: (
                  <MateOpeningLine
                    onTryNow={tryNow}
                    projects={<Link to="/zerops" />}
                    phrase={{
                      ...(projectUnavailable
                        ? recoveryNotice(recovery, named.name)!
                        : mateOpeningPhrase(page, { nowMs, mateName: named.name })),
                      text: null,
                    }}
                    projectUrl={projectUnavailable ? undefined : mate.projectUrl}
                    details={
                      projectUnavailable || linkVoice.surface === "none"
                        ? undefined
                        : linkVoice.details
                    }
                  />
                ),
              }
            : {
                kind: "reaching",
                severity: linkVoice.surface === "none" ? undefined : linkVoice.severity,
                face: linkVoice.surface === "none" ? "idle" : linkVoice.face,
                headline:
                  linkVoice.surface === "none"
                    ? undefined
                    : (linkVoice.headline ?? linkVoice.text ?? undefined),
                sentence: linkVoice.surface === "none" ? undefined : linkVoice.secondary,
                restarting: linkVoice.surface !== "none" && linkVoice.restarting === true,
                restartLines: linkVoice.surface === "none" ? undefined : linkVoice.restartLines,
                below: (
                  <MateLinkLine
                    mateServiceId={mate.serviceId}
                    onTryNow={tryNow}
                    projectId={projectId}
                    projectUrl={projectUnavailable ? undefined : mate.projectUrl}
                    voice={
                      linkVoice.surface === "none" ? SILENT_STAGE : { ...linkVoice, text: null }
                    }
                  />
                ),
              };

  const opening =
    shown === undefined &&
    view?.kind === "reaching" &&
    phaseAhead === null &&
    empty.standUpFailure === undefined &&
    !empty.signInRequired &&
    (linkVoice.surface === "none" || linkVoice.opening === true);

  // Its face: awake while it is linked, or while the page only waits on a container that runs —
  // not asleep for this page's own wait (`mateStageAwake`).
  const stageAwake = mateStageAwake({
    linked: environmentId !== null,
    arriving: shown !== undefined,
    speaks:
      page?.kind === "unreachable" || (linkVoice.surface !== "none" && stageSpeaks(linkVoice)),
    mate,
  });

  // An existing Mate's composer stands in its place while its link is made, as its conversation
  // will draw it: a switch here from a conversation keeps it on screen. A new Mate holds it back
  // for its stand-up; one that cannot be opened has nothing to write to.
  const standsInComposer = shown === undefined && page?.kind !== "unreachable";
  // What the Mate is on, as its menu row says it: its conversation's own once its conversations
  // are read, else HQ's last word of it.
  const standInSubject = liveActivity?.subject ?? toldActivity?.subject ?? null;

  const chiefRefused =
    page?.kind === "unreachable" &&
    page.reachability?.kind === "refused-role" &&
    page.reachability.chiefOwnerName !== undefined;
  const chiefRegistration =
    offerChiefRegistration || registeringChief ? (
      <MateEmptyStateView
        mate={{ ...mate, name: project?.name ?? mate.name }}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
        coming={{
          kind: "unreachable",
          face: "sleep",
          headline: "Make this my Chief",
          sentence: chiefError ?? "Register this project as your Chief to open its conversation.",
          below: (
            <Button
              disabled={registeringChief}
              onClick={() => void registerChief()}
              size="md"
              variant="primary"
            >
              {registeringChief ? "Registering Chief…" : "Make this my Chief"}
            </Button>
          ),
        }}
      />
    ) : null;
  if (chiefRegistration === null && detailFailure !== null && !projectUnavailable && !chiefRefused)
    return <MateDetailFailure mate={mate} message={detailFailure.message} again={readAgain} />;
  return (
    // The person's Chief wears the product's mark here as in its conversation (`chief.ts`).
    <MateFaceAsMark.Provider value={isChief}>
      <MateComingFrame
        composer={
          chiefRegistration === null && standsInComposer ? (
            <ConversationFooterStandIn draft={draft} />
          ) : null
        }
        header={
          <MateComingHeader
            arriving={shown !== undefined && !handingArrival}
            mate={{
              ...mate,
              name: chiefRegistration === null ? mate.name : (project?.name ?? mate.name),
              projectUrl: projectUnavailable ? undefined : mate.projectUrl,
              connected: stageAwake,
              chief: isChief,
            }}
            standsIn={standsInComposer || handingArrival ? { subject: standInSubject } : null}
          />
        }
      >
        {chiefRegistration ??
          (opening ? (
            <ConversationOpeningStage
              ready={false}
              name={named.name}
              mate={named}
              activity={liveActivity ?? toldActivity}
              timestampFormat={timestampFormat}
            />
          ) : view === null ? null : (
            <ConversationOpeningStage ready={false} name={named.name} mate={named}>
              <MateEmptyStateView
                coming={view}
                // Handed over to from the creation's view, whose headline held the focus.
                focusOnArrival={made !== undefined}
                mate={{ ...(shown === undefined ? named : mate), connected: stageAwake }}
                phase={handingArrival ? empty.phase : phaseAhead}
                standUpFailure={empty.standUpFailure}
                signIn={handingArrival ? empty.signIn : null}
                runtimes={empty.runtimes}
                signInRequired={empty.signInRequired}
                agentReady={empty.agentReady}
                unknown={handingArrival ? empty.unknown : null}
              />
            </ConversationOpeningStage>
          ))}
      </MateComingFrame>
      {mateActions.dialogs}
    </MateFaceAsMark.Provider>
  );
}

/**
 * A Mate's own view around what it says: its header line over the place its empty conversation
 * will take — a New project's first Mate's before its project exists too, so the two paint one
 * frame across the hand-over between them.
 */
export function MateComingFrame({
  header,
  composer = null,
  panel = null,
  children,
}: {
  readonly header: ReactNode;
  /** What stands where its conversation's composer will (`ConversationFooterStandIn`). */
  readonly composer?: ReactNode;
  /**
   * Its conversation's right panel standing in beside it (`useConversationPanelStandIn`): the page
   * splits as the conversation will, from its first frame.
   */
  readonly panel?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
          data-zerops-surface="mate-coming-page"
        >
          <WorkspacePageHeader className="relative bg-background" data-chat-header>
            {header}
          </WorkspacePageHeader>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {children}
            {composer}
          </div>
        </div>
        {panel}
      </div>
    </SidebarInset>
  );
}

/**
 * The header's line: the Mate's face and its name, and its project in Zerops — except while a new
 * Mate comes up, when the page waits on the Mate and the way into Zerops arrives with its
 * conversation's header.
 */
export function MateComingHeader({
  mate,
  standsIn = null,
  arriving = false,
  besidePanel = false,
}: {
  /** Its conversation's panel stands beside it, holding the layout controls (`MateComingFrame`). */
  readonly besidePanel?: boolean;
  /** A new Mate coming up: no way to its project yet. */
  readonly arriving?: boolean;
  readonly mate: Pick<
    ZeropsMateIdentity,
    "name" | "tint" | "shape" | "connected" | "arrivingUntil" | "chief"
  > & {
    readonly projectUrl: string | undefined;
  };
  /**
   * An existing Mate's conversation header, standing in until it connects: what the Mate is on
   * (its menu row's subject), the header's menu and the panel toggles, each in its place and
   * inert, so the header stays as it is when the conversation takes over.
   */
  readonly standsIn?: { readonly subject: string | null } | null;
}) {
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      {/* The stage under it names the Mate, its face large: the header holds its place unnamed
          (the owner: the name up here while it is huge below is the same fact twice). */}
      <span className="min-w-0 flex-1" />
      <span className="flex size-4 shrink-0" />
      <div
        className={
          besidePanel
            ? "flex shrink-0 items-center justify-end gap-1 pr-0"
            : "flex shrink-0 items-center justify-end gap-1 pr-18.25 sm:pr-14.25"
        }
      >
        {standsIn === null ? null : (
          <Button
            aria-label="More header actions"
            data-chat-header-ghost
            inert
            size="icon-sm"
            variant="ghost"
          >
            <EllipsisIcon className="size-4" />
          </Button>
        )}
        {mate.chief === true ? (
          // A Chief's way out is its organization, as its conversation's header offers it.
          <ChiefOverviewButton threadRef={null} />
        ) : arriving || mate.projectUrl === undefined ? null : (
          // It waits with the chat header's for the opening conversation (`index.css`).
          <span className="contents" data-opening-waits="">
            <ZeropsProjectLink projectUrl={mate.projectUrl} />
          </span>
        )}
      </div>
      {standsIn === null || besidePanel ? null : (
        <div
          className="absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]"
          data-workspace-titlebar-controls
          inert
        >
          <PanelLayoutControls
            liveAgentCount={0}
            onToggleRightPanel={nothing}
            onToggleTerminal={nothing}
            rightPanelAvailable
            rightPanelOpen={false}
            rightPanelShortcutLabel={null}
            terminalAvailable
            terminalOpen={false}
            terminalShortcutLabel={null}
          />
        </div>
      )}
    </div>
  );
}

const nothing = () => undefined;

/** The stage with nothing said on it: a link that is up, handing over to its conversation. */
const SILENT_STAGE: Exclude<MateVoice, { readonly surface: "none" }> = {
  surface: "stage",
  text: null,
  actions: [],
  processes: false,
};

/**
 * The sentence under the headline while it comes up: how long is left, measured from the press;
 * one that did not come, why.
 */
/**
 * In the slot while it comes up: the Mate's own steps (`arrivalSteps`) as one progress row whose
 * words replace themselves in place (`arrivalRow`) — and under it, for one that did not come, the view's one verb: *Remove*, *Try again* where a press
 * stopped at a step safe to ask again, or *Go to projects* where the platform may have made it
 * anyway.
 */
export function ComingBelow({
  coming,
  progress,
  nowMs,
  mate,
  removing = false,
  finishing = false,
  onRemove,
  onFinishSetup,
  onRedeploy,
  onTryAgain,
  onSetupAgain,
  ends,
  projects,
  setupFailureDetails,
  operationTrouble,
  attemptId,
  addCredit,
}: {
  readonly attemptId?: string | undefined;
  /** Where its organization's credit is added (`hqCreditUrl`), for a project refused for want of it. */
  readonly addCredit?: string | undefined;
  readonly operationTrouble?: MateOperationRefusal | null;
  readonly setupFailureDetails?: {
    readonly details: string;
    readonly status: string;
    readonly process: ActivityProcess;
    readonly projectUrl: string | undefined;
    readonly retrying: boolean;
  };
  readonly coming: MateComing | undefined;
  readonly progress: ArrivalProgress | undefined;
  readonly nowMs: number | undefined;
  readonly mate: Pick<ZeropsMateIdentity, "name" | "project">;
  readonly removing?: boolean;
  /** *Finish setup* runs. */
  readonly finishing?: boolean;
  readonly onRemove?: () => void;
  /** *Finish setup*, for a Mate whose press stopped before its container. */
  readonly onFinishSetup?: () => void;
  readonly onTryAgain?: (() => void) | undefined;
  readonly onRedeploy?: (() => void) | undefined;
  /** Reads its setup again, where the last read could not be it (`refreshMateSetup`). */
  readonly onSetupAgain?: () => void;
  /**
   * A creation that stopped before Zerops took it as far as this tab knows (`creationEnds`):
   * *Dismiss*, which takes it out of the menu — and, for an Add refused for certain, *Start over*
   * with its name to change.
   */
  readonly ends?:
    | { readonly onStartOver?: (() => void) | undefined; readonly onDismiss: () => void }
    | undefined;
  /** What *Go to projects* is: the router's link to the projects screen. */
  readonly projects?: ReactElement;
}): ReactNode {
  // Each step owns its result. An overall setup notice cannot fail an unfinished workspace.
  const row =
    progress === undefined || nowMs === undefined
      ? null
      : arrivalRow(arrivalSteps(progress, mate, nowMs), progress.steps, progress.startedAt);
  const steps =
    row === null ? null : (
      // The slot centres its words; the row's own read from its start edge.
      <div className="w-full text-start">
        <Progress
          at={row.at}
          endedAtMs={row.endedAtMs}
          identity={attemptId ?? ""}
          label={`${mate.name} coming up`}
          nowMs={nowMs}
          // Its steps say little of how far it has got — its workspace is most of the wait — so
          // time paces the bar; the sentence over it says the estimate.
          paceMs={ARRIVAL_PACE_MS}
          startedAtMs={row.startedAtMs}
          steps={row.steps}
          view={
            row.state === "failed"
              ? { state: "failed", cause: `${row.steps[row.at] ?? mate.name} didn't finish.` }
              : row.state === "done"
                ? { state: "done", result: row.steps[row.at] ?? "" }
                : undefined
          }
        />
      </div>
    );
  const verb =
    coming?.kind === "failed" && coming.verb !== "redeploy" && setupFailureDetails !== undefined ? (
      <>
        {onTryAgain === undefined ? null : (
          <Button
            variant="primary"
            size="md"
            disabled={setupFailureDetails.retrying || removing}
            onClick={onTryAgain}
          >
            Try again
          </Button>
        )}
        {onRemove === undefined ? null : (
          <Button
            size="sm"
            disabled={removing || setupFailureDetails.retrying}
            onClick={onRemove}
            variant="secondary"
          >
            Remove
          </Button>
        )}
      </>
    ) : coming?.kind === "failed" ? (
      coming.verb === "redeploy" && onRedeploy !== undefined ? (
        <Button variant="primary" size="md" onClick={onRedeploy}>
          Redeploy
        </Button>
      ) : coming.verb === "remove" && onRemove !== undefined ? (
        <Button variant="primary" size="md" disabled={removing} onClick={onRemove}>
          Remove
        </Button>
      ) : coming.verb === "finish-setup" && onFinishSetup !== undefined ? (
        <Button variant="primary" size="md" disabled={finishing} onClick={onFinishSetup}>
          {FINISH_MATE_SETUP_VERB}
        </Button>
      ) : coming.verb === "try-again" && onTryAgain !== undefined ? (
        <>
          <Button variant="primary" size="md" onClick={onTryAgain}>
            {MATE_STAND_UP_RETRY_LABEL}
          </Button>
          {ends?.onStartOver === undefined ? null : (
            <Button size="sm" onClick={ends.onStartOver} variant="secondary">
              Start over
            </Button>
          )}
          {ends === undefined ? null : (
            <Button size="sm" onClick={ends.onDismiss} variant="ghost">
              Dismiss
            </Button>
          )}
        </>
      ) : coming.verb === "add-credit" && addCredit !== undefined ? (
        <>
          <Button
            variant="primary"
            size="md"
            render={<a href={addCredit} rel="noreferrer" target="_blank" />}
          >
            Add credit in HQ
          </Button>
          {/* Credit may come from another tab, another device or before a reload: *Try again*
              stands beside the way to HQ for as long as the refusal does. */}
          {onTryAgain === undefined ? null : (
            <Button variant="secondary" size="sm" onClick={onTryAgain}>
              {MATE_STAND_UP_RETRY_LABEL}
            </Button>
          )}
          {ends?.onStartOver === undefined ? null : (
            <Button size="sm" onClick={ends.onStartOver} variant="secondary">
              Start over
            </Button>
          )}
          {ends === undefined ? null : (
            <Button size="sm" onClick={ends.onDismiss} variant="ghost">
              Dismiss
            </Button>
          )}
        </>
      ) : coming.verb === "go-to-projects" && projects !== undefined ? (
        <>
          <Button variant="primary" size="md" render={projects}>
            Go to projects
          </Button>
          {ends === undefined ? null : (
            <Button size="sm" onClick={ends.onDismiss} variant="ghost">
              Dismiss
            </Button>
          )}
        </>
      ) : null
    ) : null;
  // What the steps leave to read whole, under them and over the way on — each step keeps one line:
  // a stop's reason (one Zerops may have made says it in the sentence), or a registration not
  // finished, with this person's own *Finish setup*, at once.
  const copy = mateArrivalNotice({
    coming,
    progress,
    refusal: operationTrouble,
    attemptId,
    details: setupFailureDetails?.details,
  });
  const pressRead = copy.note === null ? null : { text: copy.note };
  const finishVerb =
    coming?.kind === "coming" && onFinishSetup !== undefined ? (
      <Button variant="primary" size="md" disabled={finishing} onClick={onFinishSetup}>
        {FINISH_MATE_SETUP_VERB}
      </Button>
    ) : null;
  // Its setup that could not be read, while it comes up: why, and *Try again*, which reads it again.
  const setupFailure = coming?.kind === "coming" ? progress?.setupFailure : undefined;
  const read =
    pressRead ?? (setupFailure === undefined ? null : { text: SETUP_FAILURE_WORDS[setupFailure] });
  const setupVerb =
    pressRead === null && setupFailure !== undefined && onSetupAgain !== undefined ? (
      <Button variant="primary" size="md" onClick={onSetupAgain}>
        Try again
      </Button>
    ) : null;
  const acts = verb ?? finishVerb ?? setupVerb;
  if (
    acts === null &&
    read === null &&
    copy.details === undefined &&
    setupFailureDetails === undefined
  ) {
    return steps === null ? null : <div data-zerops-surface="mate-coming-progress">{steps}</div>;
  }
  // Under the steps, where nothing is read yet: a stop, and *Try again* taking it back, never move
  // the rows they stand under.
  return (
    <div
      className="flex flex-col gap-5.5"
      data-zerops-surface={
        coming?.kind === "failed" ? "mate-coming-failed" : "mate-coming-progress"
      }
    >
      {steps}
      {setupFailureDetails === undefined && copy.details === undefined ? null : (
        <MateStateDetails>
          <pre>{copy.details}</pre>
          {setupFailureDetails?.status === "loading" ? <p>Reading the setup log…</p> : null}
          {setupFailureDetails?.status === "error" ? (
            <p>The setup log couldn't be read. Open the process in Zerops.</p>
          ) : null}
        </MateStateDetails>
      )}
      <div className="arrival-acts-block">
        {read === null ? null : (
          <p className="arrival-acts-note" data-press-note="">
            {read.text}
          </p>
        )}
        {acts === null && setupFailureDetails?.projectUrl === undefined ? null : (
          <div className="arrival-acts">
            {acts}
            {setupFailureDetails?.projectUrl === undefined ? null : (
              <Button
                render={
                  <a href={setupFailureDetails.projectUrl} target="_blank" rel="noreferrer" />
                }
                size="md"
                variant="primary"
              >
                Open the process in Zerops
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What the arrival's steps read: the birth's line, with its copy's managed services and what the
 * Mate's own setup says.
 */
export type ArrivalProgress = BirthLineProgress & {
  readonly managed?: ReadonlyArray<BirthCopyService> | undefined;
  readonly setup?: MateSetup | undefined;
  /** Why its setup can't be read (`useMateSetup`). */
  readonly setupFailure?: MateSetupFailure | undefined;
  /** The steps this tab runs for it, while it holds them (`creationSubsteps`). */
  readonly press?: ReadonlyArray<ArrivalSubstep> | undefined;
  /** It runs on an agent that needs no sign-in, ready (`MateEmptyState.agentReady`). */
  readonly agentReady?: boolean | undefined;
};
