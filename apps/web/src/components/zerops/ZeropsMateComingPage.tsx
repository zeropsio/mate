import { removeFailedZeropsProject } from "./removeFailedZeropsProject";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import {
  mateArrival,
  setupFailure as setupFailureProjection,
  setupFailureLogQuery,
  setupFailureReason,
} from "@t3tools/client-runtime/data";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
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
import { useMateOffers } from "~/zerops/useHqOffers";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
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
import { mateArriving } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { stageSpeaks } from "~/zerops/mateOpeningStage";
import { ConversationFooterStandIn } from "./ConversationFooterStandIn";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";

import { useEnvironmentLinks } from "~/routes/-environmentTargets";
import { useThreadDetail, useThreadShells, useThreadStatus } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useAccountEnvironments, useConnectMate } from "~/zerops/accountEnvironments";
import {
  arrivalAwaitsAnswer,
  arrivalHoldsThrough,
  firstBuildState,
  halfMadeFor,
  LISTING_CATCH_UP_MS,
  listingLacksCreation,
  mateArrivalShown,
  mateComing,
  mateComingPage,
  mateOpeningPhrase,
  mateConnectKey,
  type MateComing,
} from "~/zerops/mateComing";
import {
  mateIdentityPose,
  mateStageAwake,
  zeropsMateIdentityOf,
  type ZeropsMateIdentity,
} from "~/zerops/mateIdentities";
import { mateFaceFor } from "~/zerops/agentActivity";
import { takeMateConversation } from "~/zerops/mateOpening";
import {
  arrivalHeaderFace,
  arrivalSteps,
  comingSentence,
  inFirstSeenOrder,
  KEEP_TAB_OPEN_LINE,
  pressNote,
  pressRuns,
  SETUP_FAILURE_WORDS,
  type ArrivalSubstep,
  type ArrivalStep,
} from "~/zerops/mateArrival";
import { MATE_STAND_UP_RETRY_LABEL, mateStandUpPhase } from "~/zerops/mateStandUp";
import { dismissCreation, useCreations } from "~/zerops/creations";
import { useMateHandOver } from "~/zerops/newMate";
import {
  comingPlanned,
  creationSubsteps,
  registrationSubstep,
  madeOf,
  newProjectProgress,
} from "~/zerops/newProjectBirth";
import { mateNoticeVoice } from "~/zerops/mateNoticeVoice";
import { useProjectActivity } from "~/zerops/activity/useProjectActivity";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { useToldActivity } from "~/zerops/useMenuMateReadings";
import { useOpenMate } from "~/zerops/useOpenMate";
import { usePressesElsewhere } from "~/zerops/usePressesElsewhere";
import { useUsualAgent } from "~/zerops/useUsualAgent";
import { useZeropsBirthProgress } from "~/zerops/useZeropsBirthProgress";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useProjectCreations } from "~/zerops/useProjectCreations";
import { useProjectServices } from "~/zerops/ZeropsAccountData";
import {
  closeOffHoldOf,
  finishSetupView,
  forgetPress,
  pressFailure,
  useMatePress,
} from "~/zerops/matePress";
import { useDeleteProject } from "~/zerops/deleteProject";
import { useRestartMate, useReviveFailedMate } from "~/zerops/mateRestart";
import { refreshMateSetup, useMateSetup } from "~/zerops/useMateSetup";
import { useMateActions } from "~/zerops/useMateActions";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import type { MateSetup, MateSetupFailure } from "@t3tools/client-runtime/zerops/mateSetup";
import { useZeropsContainers } from "~/zerops/zeropsContainers";
import { useZeropsData } from "~/zerops/zeropsDataContext";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ConversationStripView } from "../chat/ConversationStrip";
import { MateDetailFailure } from "./MateDetailFailure";
import { useCloseOffHolds, useMateDetailRead } from "~/zerops/accountEnvironments";
import { MateLinkLine, MateOpeningLine } from "./MateLinkLine";
import { zeropsAccountDisplay } from "./landing/ZeropsAccountControl.logic";
import { ZeropsProjectLink } from "./ZeropsProjectLink";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { PanelLayoutControls } from "../chat/PanelLayoutControls";
import { EllipsisIcon } from "lucide-react";
import { useZeropsThreadActivity } from "~/zerops/useZeropsAgentActivity";
import { useComposerDraftStore } from "~/composerDraftStore";
import { handOverMateConversation } from "~/zerops/mateHandOver";
import type { BirthLineProgress } from "./ZeropsBirthProgress.logic";
import { NOT_SET_UP_LINE } from "./ZeropsProjectRow.logic";
import { ZeropsArrivalSteps, type ArrivalYou } from "./ZeropsArrivalSteps";
import { PressSteps } from "./ZeropsEnvironmentCreationDialog";
import {
  MateEmptyStateView,
  useMateEmptyState,
  type MateEmptyComing,
} from "./ZeropsMateEmptyState";
import { usePreferredConnection } from "~/zerops/mateConnectionPreference";

/** The coming page reads no server version: its *Finish setup* is all it takes of the menu. */
const NO_VERSIONS: ReadonlyMap<string, string> = new Map();

/** The slate face a Mate wears where nobody picked one. */
const NO_FACE: ZeropsMateFace = { tint: "slate", shape: "squircle" };

/** The hand-over's own length: the stage's words and slot handing over (`ArrivalSwap`), then the route. */
const HAND_OVER_MS = 280;

const NO_SETUP_FAILURE = Atom.make<ActivityProcess | undefined>(undefined);

const EMPTY_SHELL_STATUS =
  Atom.make<import("@t3tools/client-runtime/state/shell").EnvironmentShellStatus>("empty");

export function ZeropsMateComingPage({ projectId }: { readonly projectId: string }) {
  const navigate = useNavigate();
  const openMate = useOpenMate();
  const { activeOrganization, user } = useZeropsSession();
  const viewer = user?.id;
  // The person's own step wears their picture.
  const you = useMemo(() => personOf(user), [user]);
  // Which agent this project's other Mates use, read while it comes up: its sign-in is ready in it.
  useUsualAgent(projectId);
  const { organizationRef } = useZeropsData();
  const { listing, wholeForPerson, refresh: rereadListing } = useZeropsCandidates();
  const held = useMemo(() => heldCandidates(listing), [listing]);
  const listed = held.rows.find((candidate) => candidate.project.id === projectId);
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
  const { mateLink } = useEnvironmentLinks();
  const rowKey = candidate?.key ?? projectId;
  const link = useMemo(
    () => mateLink({ key: rowKey, project: { id: projectId } }),
    [mateLink, projectId, rowKey],
  );
  // Its link failing since it last connected: an arrival holds its board only through the first.
  const failuresSinceConnect = link.failuresSinceConnect;
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
  const coming =
    failedProcess === undefined
      ? mateComing({
          closeOffHold,
          press:
            press === undefined
              ? undefined
              : {
                  startedAt: press.startedAt,
                  container: press.container,
                  retryable: pressRetry !== null,
                },
          candidate,
          setUpFailed: pressFailure(press),
          nowMs: Date.now(),
          created: creation !== undefined,
          listingLacksIt,
          linkHolds: arrivalHoldsThrough(link.reachability, { failuresSinceConnect }),
          answerAwaited: arrivalAwaitsAnswer(link),
          firstBuild: firstBuilding
            ? firstBuildState(firstBuildProcesses, candidate?.service?.id)
            : undefined,
          pressElsewhere: pressOf(projectId),
        })
      : ({ kind: "failed", line: "Setup stopped.", verb: "try-again" } as const);
  // An absent project is decided by the person's project scope. Unopened projects' container
  // reads cannot keep an ungranted direct link waiting after that scope has answered.
  const page = mateComingPage({
    coming: listedOnly ? undefined : coming,
    candidate: listedOnly ? undefined : candidate,
    complete:
      (held.complete || wholeForPerson) &&
      press === undefined &&
      (creation === undefined || listingLacksIt),
    linked: !listedOnly && link.environmentId !== undefined,
    reachability: listedOnly ? { kind: "refused-role" } : link.reachability,
  });
  // Whether this view has shown it coming up: its hand-over is then the stand-up's, in place.
  const [cameUp, setCameUp] = useState(false);
  if (page?.kind === "coming" && !cameUp) setCameUp(true);
  // Its arrival, once shown, holds the board through every wait on its way to its conversation:
  // one surface from the press to the sign-in (`mateArrivalShown`).
  const arrival = mateArrivalShown({ page, cameUp, failuresSinceConnect });

  // Who it is: its listing's, the moment it is listed — the name and the tint the menu gives it —
  // and until then what its creation or its press knew.
  const tints = useMemo(() => assignCandidateMateTints(held.rows), [held.rows]);
  const mate = useMemo((): ZeropsMateIdentity => {
    if (candidate !== undefined) {
      const listed = zeropsMateIdentityOf(candidate, tints);
      // Listed before HQ places it: no application to cut its name under, but its creation or its
      // press knows it, so its name is its own all along.
      const app = creation?.name ?? press?.placement?.groupName;
      if (readZeropsMembership(candidate.project).groupId !== undefined || app === undefined)
        return listed;
      return { ...listed, name: nameUnderApp(candidate.project.name, app) };
    }
    const face = creation?.face ?? press?.placement?.face ?? NO_FACE;
    return {
      name: creation?.botName ?? press?.placement?.displayName ?? "",
      tint: face.tint,
      shape: face.shape,
      project: creation?.name ?? press?.placement?.groupName,
      projectUrl: zeropsProjectUrl(projectId),
      connected: false,
      // This tab made it: the person looking asked for its stand-up.
      ...(creation !== undefined && viewer !== undefined ? { standUp: { by: viewer } } : {}),
    };
  }, [press, candidate, creation, projectId, tints, viewer]);

  // Up: its main conversation, read live, and its agents' sign-in — what the conversation paints
  // first, painted here first. Its environment is the one its machine opens, or its row's once
  // connected.
  const environmentId: EnvironmentId | null =
    link.environmentId ??
    (candidate?.group === "connected" ? (candidate.environmentId ?? null) : null);
  const threads = useThreadShells();
  const primaryId = useMemo(
    () =>
      environmentId === null
        ? undefined
        : resolvePrimaryConversation(
            threads.filter((thread) => thread.environmentId === environmentId),
          ).primary?.id,
    [environmentId, threads],
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
  const arrivalDecision = mateArrival({
    connected: environmentId !== null && link.reachability?.kind === "ready",
    shell: shellStatus,
    hasConversation: threadRef !== null,
    detail: status,
    detailHeld: useThreadDetail(threadRef) !== null,
    signInKnown: empty.signInKnown,
    cameUp,
  });
  const up = arrivalDecision === "conversation";

  // The hand-over: a new Mate's words turn in place, then the conversation takes the route with
  // that frame; any other Mate's conversation takes it at once. What the door that opened it asked
  // to be told of the conversation is told first (`mateOpening`). Once begun it runs to its end,
  // whatever is read meanwhile.
  const [handing, setHanding] = useState(false);
  if (up && !handing) setHanding(true);
  const handingOver = useMateHandOver((state) => state.handingOver);
  const liveActivity = useZeropsThreadActivity(threadRef);
  // The draft of the conversation it opens on, which the held room lays out at its height.
  const draft = useComposerDraftStore((state) =>
    threadRef === null ? "" : (state.getComposerDraft(threadRef)?.prompt ?? ""),
  );
  // Until its conversation is read here: HQ's last word of it, as its menu row reads it.
  const toldActivity = useToldActivity(projectId);
  useEffect(() => {
    if (!handing || environmentId === null || threadRef === null) return;
    // Kept read from above every view while the route changes under it.
    if (cameUp) handingOver(threadRef);
    const timer = setTimeout(
      () => {
        handOverMateConversation(scopedThreadKey(threadRef), Date.now());
        takeMateConversation(projectId)?.(threadRef);
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
          replace: true,
        });
      },
      cameUp ? HAND_OVER_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [cameUp, environmentId, handing, handingOver, navigate, projectId, threadRef]);

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
  const lineProgress: ArrivalProgress | undefined =
    progress === null
      ? undefined
      : {
          ...(made === undefined || made.adds !== undefined
            ? progress.progress
            : newProjectProgress(made, progress.progress, progress.nowMs)),
          ...(managed === undefined ? {} : { managed }),
          ...(setup === undefined ? {} : { setup }),
          ...(setupFailure === undefined ? {} : { setupFailure }),
          // A registration's receipt stands after any originating press is gone.
          ...(press === undefined && registration.state === "unfinished"
            ? { press: [registrationSubstep(mate.name, registration)] }
            : made === undefined || press === undefined
              ? {}
              : { press: creationSubsteps(made, press.progress ?? null, registration) }),
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
              setTrouble(
                error instanceof Error ? error.message : "Zerops didn't accept the setup retry.",
              ),
            )
            .finally(() => setRetryingSetup(false));
        };
  const failedReason =
    failedProcess === undefined
      ? undefined
      : setupFailureReason(
          mate.name,
          failedProcess.failReason,
          failureLog.lines.map((line) => line.text),
        );

  const deleteProject = useDeleteProject();
  const [removing, setRemoving] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
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
        setTrouble(outcome.error);
        return;
      }
      void navigate({ to: "/zerops", replace: true });
    });
  };

  // On its way to its conversation and not handed over yet — its link being made, its conversation
  // and its sign-in still being read — a new Mate stays coming, its progress whole, until the words
  // can turn into the conversation's own. A half-made Mate names Finish setup only where this
  // viewer has it, and who can where not.
  const shown: MateComing | undefined =
    arrival === undefined
      ? undefined
      : failedReason === undefined
        ? halfMadeFor(arrival, finishSetup !== undefined)
        : { kind: "failed", line: failedReason.text, verb: "try-again" };
  // The hand-over: the words turn into the conversation's own, and the header with them — its way
  // into Zerops and its actions arrive here, in place, so the route changes under an unchanged frame.
  const handingArrival = handing && cameUp;
  const phaseAhead = mateStandUpPhase({
    marker: mate.standUp,
    viewer: user?.id,
    main: true,
    signIn: "unknown",
  });
  // Any other Mate: its name over what its link waits for, or why it cannot be opened — nameless
  // where nothing names it, never a placeholder over its face; only its link's words say "This
  // Mate" then.
  const named = mate;
  // The minute clock its pose reads (`mateArriving`).
  const clockMs = useNowMs();
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
  const linkVoice = mateNoticeVoice({
    reachability: linkReachability,
    conversationShown: false,
    nowMs,
    mateName: named.name,
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
              sentence:
                finish !== undefined && shown.kind === "coming"
                  ? finish.line
                  : comingSentenceOf({
                      coming: shown,
                      trouble: trouble ?? mateActions.trouble,
                      ...(failedReason === undefined ? {} : { failureReason: failedReason.text }),
                      progress: lineProgress,
                      nowMs: progress?.nowMs,
                    }),
              below:
                finish !== undefined && shown.kind === "coming" ? (
                  <PressSteps name={mate.name} steps={finish.steps} />
                ) : (
                  <ComingBelow
                    coming={shown}
                    mate={mate}
                    nowMs={progress?.nowMs}
                    onRemove={remove}
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
                    you={you}
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
                headline:
                  page.reachability === null
                    ? (mateOpeningPhrase(page, { nowMs, mateName: named.name }).text ?? undefined)
                    : linkVoice.surface === "none"
                      ? undefined
                      : (linkVoice.headline ?? linkVoice.text ?? undefined),
                sentence: linkVoice.surface === "none" ? undefined : linkVoice.secondary,
                below: (
                  <MateOpeningLine
                    onTryNow={tryNow}
                    projects={<Link to="/zerops" />}
                    phrase={{
                      ...mateOpeningPhrase(page, { nowMs, mateName: named.name }),
                      text: null,
                    }}
                    projectUrl={mate.projectUrl}
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
                below: (
                  <MateLinkLine
                    mateServiceId={mate.serviceId}
                    onTryNow={tryNow}
                    projectId={projectId}
                    projectUrl={mate.projectUrl}
                    voice={
                      linkVoice.surface === "none" ? SILENT_STAGE : { ...linkVoice, text: null }
                    }
                  />
                ),
              };

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

  if (detailFailure !== null)
    return <MateDetailFailure mate={mate} message={detailFailure.message} again={readAgain} />;
  return (
    <MateComingFrame
      composer={standsInComposer ? <ConversationFooterStandIn draft={draft} /> : null}
      header={
        <MateComingHeader
          arriving={shown !== undefined && !handingArrival}
          face={
            view === null || shown === undefined || handingArrival
              ? undefined
              : arrivalHeaderFace({
                  kind: view.kind,
                  over: view.over === true,
                  connected: environmentId !== null,
                  arriving: mateArriving(mate.arrivingUntil, clockMs),
                })
          }
          mate={{ ...mate, connected: stageAwake }}
          standsIn={standsInComposer || handingArrival ? { subject: standInSubject } : null}
        />
      }
    >
      {view === null ? null : (
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
      )}
    </MateComingFrame>
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
  children,
}: {
  readonly header: ReactNode;
  /** What stands where its conversation's composer will (`ConversationFooterStandIn`). */
  readonly composer?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
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
  face,
}: {
  /** A new Mate coming up: its face and name only. */
  readonly arriving?: boolean;
  /** The pose the stage under it wears (`arrivalHeaderFace`); else its own (`mateFaceFor`). */
  readonly face?: MateMarkState | undefined;
  readonly mate: Pick<
    ZeropsMateIdentity,
    "name" | "tint" | "shape" | "connected" | "arrivingUntil"
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
  const nowMs = useNowMs();
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <ConversationStripView
        chats={null}
        crew={null}
        mate={{
          name: mate.name,
          tint: mate.tint,
          shape: mate.shape,
          face: face ?? mateFaceFor(mate.connected, undefined, mateIdentityPose(mate, nowMs)),
          open: true,
          threadId: null,
          tooltip: standsIn?.subject ?? null,
        }}
        onCloseChat={() => undefined}
        onOpen={() => undefined}
        onRename={null}
        renameField={null}
        renderCrewmateMenu={() => null}
      />
      <span className="flex size-4 shrink-0" />
      <div className="flex shrink-0 items-center justify-end gap-1 pr-18.25 sm:pr-14.25">
        {standsIn === null ? null : (
          <Button
            aria-label="More header actions"
            data-chat-header-ghost
            inert
            size="icon-sm"
            variant="ghost-muted"
          >
            <EllipsisIcon className="size-4" />
          </Button>
        )}
        {arriving || mate.projectUrl === undefined ? null : (
          <ZeropsProjectLink projectUrl={mate.projectUrl} />
        )}
      </div>
      {standsIn === null ? null : (
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

/** The person, as their own step wears them: their picture, else their initials. */
export function personOf(
  user: Parameters<typeof zeropsAccountDisplay>[0] | undefined,
): ArrivalYou | null {
  if (user === undefined || user === null) return null;
  const display = zeropsAccountDisplay(user);
  return { initials: display.initials, avatarUrl: display.avatarUrl };
}

/**
 * The sentence under the headline while it comes up: how long is left, measured from the press;
 * one that did not come, why.
 */
export function comingSentenceOf(input: {
  readonly coming: MateComing | undefined;
  readonly trouble?: string | null;
  readonly failureReason?: string;
  readonly progress: ArrivalProgress | undefined;
  readonly nowMs: number | undefined;
}): string | undefined {
  const { coming, progress, nowMs } = input;
  if (coming === undefined) return undefined;
  if (coming.kind === "failed") {
    if (input.trouble != null) return input.trouble;
    if (input.failureReason !== undefined) return input.failureReason;
    // Zerops may have made it: the sentence says so, with the way to the projects — never a stop.
    if (coming.verb === "go-to-projects") return coming.line;
    // A step this tab ran that stopped it says why in its own place: the sentence, only that it
    // did. A step left to an owner stopped nothing, and anything else says its own reason here.
    const said = progress?.press?.some((step) => step.state === "failed" && step.why !== undefined);
    return said === true ? NOT_SET_UP_LINE : coming.line;
  }
  // While the steps this tab runs are under way, the one thing that stops them.
  if (pressRuns(progress?.press)) return KEEP_TAB_OPEN_LINE;
  const startedAt = progress?.startedAt === undefined ? Number.NaN : Date.parse(progress.startedAt);
  return comingSentence(
    nowMs === undefined || Number.isNaN(startedAt) ? undefined : nowMs - startedAt,
  );
}

/**
 * In the slot while it comes up: the Mate's own steps (`arrivalSteps`), with their times — and
 * under them, for one that did not come, the view's one verb: *Remove*, *Try again* where a press
 * stopped at a step safe to ask again, or *Go to projects* where the platform may have made it
 * anyway.
 */
export function ComingBelow({
  coming,
  progress,
  nowMs,
  mate,
  you,
  removing = false,
  finishing = false,
  onRemove,
  onFinishSetup,
  onTryAgain,
  onSetupAgain,
  ends,
  projects,
  setupFailureDetails,
}: {
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
  readonly you: ArrivalYou | null;
  readonly removing?: boolean;
  /** *Finish setup* runs. */
  readonly finishing?: boolean;
  readonly onRemove?: () => void;
  /** *Finish setup*, for a Mate whose press stopped before its container. */
  readonly onFinishSetup?: () => void;
  readonly onTryAgain?: (() => void) | undefined;
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
  // Each step's services in the order first seen here: a read that orders them otherwise — the
  // birth's recipe order handing over to the listing's own — never makes them trade places.
  const [seen, setSeen] = useState<ReadonlyMap<string, ReadonlyArray<string>>>(() => new Map());
  const remembered = new Map(seen);
  // A creation that stopped says why in the sentence over its steps: the steps only mark where.
  const arrived =
    progress === undefined || nowMs === undefined
      ? null
      : arrivalSteps(progress, mate, nowMs).map((step) => {
          const { why: _said, ...marked } = step;
          const shown = coming?.kind === "failed" ? stoppedStep(marked) : step;
          if (shown.services === undefined) return shown;
          const kept = inFirstSeenOrder(
            seen.get(step.id) ?? [],
            shown.services.map((service) => service.name),
          );
          if (kept.seen !== seen.get(step.id)) remembered.set(step.id, kept.seen);
          const byName = new Map(shown.services.map((service) => [service.name, service]));
          return { ...shown, services: kept.order.flatMap((name) => byName.get(name) ?? []) };
        });
  if ([...remembered].some(([id, names]) => seen.get(id) !== names)) setSeen(remembered);
  const steps = arrived === null ? null : <ZeropsArrivalSteps steps={arrived} you={you} />;
  const verb =
    coming?.kind === "failed" && setupFailureDetails !== undefined ? (
      <>
        {onTryAgain === undefined ? null : (
          <Button disabled={setupFailureDetails.retrying || removing} onClick={onTryAgain}>
            Try again
          </Button>
        )}
        {onRemove === undefined ? null : (
          <Button
            disabled={removing || setupFailureDetails.retrying}
            onClick={onRemove}
            variant="outline"
          >
            Remove
          </Button>
        )}
      </>
    ) : coming?.kind === "failed" ? (
      coming.verb === "remove" && onRemove !== undefined ? (
        <Button disabled={removing} onClick={onRemove}>
          Remove
        </Button>
      ) : coming.verb === "finish-setup" && onFinishSetup !== undefined ? (
        <Button disabled={finishing} onClick={onFinishSetup}>
          {FINISH_MATE_SETUP_VERB}
        </Button>
      ) : coming.verb === "try-again" && onTryAgain !== undefined ? (
        <>
          <Button onClick={onTryAgain}>{MATE_STAND_UP_RETRY_LABEL}</Button>
          {ends?.onStartOver === undefined ? null : (
            <Button onClick={ends.onStartOver} variant="outline">
              Start over
            </Button>
          )}
          {ends === undefined ? null : (
            <Button onClick={ends.onDismiss} variant="ghost">
              Dismiss
            </Button>
          )}
        </>
      ) : coming.verb === "go-to-projects" && projects !== undefined ? (
        <>
          <Button render={projects}>Go to projects</Button>
          {ends === undefined ? null : (
            <Button onClick={ends.onDismiss} variant="ghost">
              Dismiss
            </Button>
          )}
        </>
      ) : null
    ) : null;
  // What the steps leave to read whole, under them and over the way on — each step keeps one line:
  // a stop's reason (one Zerops may have made says it in the sentence), or a registration not
  // finished, with this person's own *Finish setup*, at once.
  const note = pressNote(progress?.press);
  const pressRead =
    note === null ||
    (note.kind === "stopped" && coming?.kind === "failed" && coming.verb === "go-to-projects")
      ? null
      : note;
  const finishVerb =
    coming?.kind === "coming" && onFinishSetup !== undefined ? (
      <Button disabled={finishing} onClick={onFinishSetup}>
        {FINISH_MATE_SETUP_VERB}
      </Button>
    ) : null;
  // Its setup that could not be read, while it comes up: why, and *Try again*, which reads it again.
  const setupFailure = coming?.kind === "coming" ? progress?.setupFailure : undefined;
  const read =
    pressRead ?? (setupFailure === undefined ? null : { text: SETUP_FAILURE_WORDS[setupFailure] });
  const setupVerb =
    pressRead === null && setupFailure !== undefined && onSetupAgain !== undefined ? (
      <Button onClick={onSetupAgain}>Try again</Button>
    ) : null;
  const acts = verb ?? finishVerb ?? setupVerb;
  if (acts === null && read === null) {
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
      {setupFailureDetails === undefined ? null : (
        <div className="arrival-failure-details">
          <details>
            <summary>Details</summary>
            <pre>{setupFailureDetails.details}</pre>
            {setupFailureDetails.status === "loading" ? <p>Reading the setup log…</p> : null}
            {setupFailureDetails.status === "error" ? (
              <p>The setup log couldn't be read. Open the process in Zerops.</p>
            ) : null}
          </details>
          {setupFailureDetails.projectUrl === undefined ? null : (
            <a href={setupFailureDetails.projectUrl} target="_blank" rel="noreferrer">
              Open process in Zerops · {setupFailureDetails.process.id}
            </a>
          )}
        </div>
      )}
      <div className="arrival-acts-block">
        {read === null ? null : (
          <p className="arrival-acts-note" data-press-note="">
            {read.text}
          </p>
        )}
        {acts === null ? null : <div className="arrival-acts">{acts}</div>}
      </div>
    </div>
  );
}

/** A step's word once its creation stopped while it was under way. */
const STOPPED_NOTE = "Stopped";

/**
 * A step of a creation that stopped: one still under way stopped with it, so its clock runs no
 * further and its spinner turns no more — a press that never settled ran it on past two hours
 * (F6b, 2026-10-03). Its time is not known, and it says so rather than guess one.
 */
function stoppedStep(step: ArrivalStep): ArrivalStep {
  if (step.state !== "active") return step;
  const { time: _running, note: _estimate, ...rest } = step;
  return { ...rest, state: "failed", note: STOPPED_NOTE };
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
