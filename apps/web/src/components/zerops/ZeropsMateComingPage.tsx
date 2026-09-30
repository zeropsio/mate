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
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  assignCandidateMateTints,
  resolvePrimaryConversation,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { applyProjectCreationVerdict } from "@t3tools/client-runtime/zerops/candidates";
import {
  MATE_VOICE_QUIET_MS,
  mateVoice,
  type MateVoice,
} from "@t3tools/client-runtime/zerops/environments";
import {
  birthCopyServices,
  birthRuntimesFacts,
  type BirthCopyService,
} from "@t3tools/client-runtime/zerops/birthProgress";
import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";

import { useEnvironmentLinks } from "~/routes/-environmentTargets";
import { useProjects, useThreadShells, useThreadStatus } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useConnectMate, type MateConnectTarget } from "~/zerops/accountEnvironments";
import {
  mateComing,
  mateComingPage,
  mateOpeningPhrase,
  type MateComing,
} from "~/zerops/mateComing";
import { zeropsMateIdentityOf, type ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { takeMateConversation } from "~/zerops/mateOpening";
import { arrivalSteps, comingSentence, inFirstSeenOrder } from "~/zerops/mateArrival";
import { MATE_STAND_UP_RETRY_LABEL, mateStandUpPhase } from "~/zerops/mateStandUp";
import { useNewMate } from "~/zerops/newMate";
import {
  newProjectBirthOf,
  newProjectProgress,
  useNewProjectBirths,
} from "~/zerops/newProjectBirth";
import { useHeldPast } from "~/zerops/useHeldPast";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useUsualAgent } from "~/zerops/useUsualAgent";
import { useZeropsBirthProgress } from "~/zerops/useZeropsBirthProgress";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsCreationVerdicts } from "~/zerops/useZeropsCreationVerdicts";
import { useZeropsInventory, type InventoryServiceOutcome } from "~/zerops/inventoryContext";
import { forgetBirth, retryBirth, useZeropsBirths } from "~/zerops/zeropsBirths";
import { useZeropsContainers } from "~/zerops/zeropsContainers";
import { runZeropsCommand, useZeropsData } from "~/zerops/zeropsDataContext";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ConversationStripView } from "../chat/ConversationStrip";
import { MateLinkLine, MateOpeningLine } from "./MateLinkLine";
import { zeropsAccountDisplay } from "./landing/ZeropsAccountControl.logic";
import { ZeropsProjectLink } from "../chat/ChatHeader";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ComposerStandIn, type StandInTyped } from "../chat/ComposerStandIn";
import { PanelLayoutControls } from "../chat/PanelLayoutControls";
import { EllipsisIcon } from "lucide-react";
import { rememberedActivity } from "~/zerops/menuMemory";
import { useZeropsThreadActivity } from "~/zerops/useZeropsAgentActivity";
import { useComposerDraftStore } from "~/composerDraftStore";
import { draftWithTyped, handOverMateConversation } from "~/zerops/mateHandOver";
import type { BirthLineProgress } from "./ZeropsBirthProgress.logic";
import { ZeropsArrivalSteps, type ArrivalYou } from "./ZeropsArrivalSteps";
import { ALMOST_THERE_LINE } from "./ZeropsProjectRow.logic";
import {
  MateEmptyStateView,
  useMateEmptyState,
  type MateEmptyComing,
} from "./ZeropsMateEmptyState";
import { removeFailedZeropsProject } from "./ZeropsProjectsPage";

/** Up, its conversation being opened: the last of its coming words. */
const UP_AND_OPENING: MateComing = { kind: "coming", line: ALMOST_THERE_LINE, verb: undefined };

/** The slate face a Mate wears where nobody picked one. */
const NO_FACE: ZeropsMateFace = { tint: "slate", shape: "squircle" };

/** The hand-over's own length: the stage's words and slot handing over (`ArrivalSwap`), then the route. */
const HAND_OVER_MS = 280;

const NOTHING_TYPED: StandInTyped = { text: "", caret: 0 };

/** How long a connected Mate's conversation may take to be read live before it hands over anyway. */
const LIVE_GRACE_MS = 3_000;

export function ZeropsMateComingPage({ projectId }: { readonly projectId: string }) {
  const navigate = useNavigate();
  const openMate = useOpenMate();
  const { activeOrganization, user } = useZeropsSession();
  const viewer = user?.id;
  // The person's own step wears their picture.
  const you = useMemo(() => personOf(user), [user]);
  // Which agent this project's other Mates use, read while it comes up: its sign-in is ready in it.
  useUsualAgent(projectId);
  const { organizationRef, runtime } = useZeropsData();
  const { listing } = useZeropsCandidates();
  const held = useMemo(() => heldCandidates(listing), [listing]);
  const listed = held.rows.find((candidate) => candidate.project.id === projectId);
  const { births, waits } = useZeropsBirths();
  const inventory = useZeropsInventory();
  const birth = useMemo(
    () => births.find((entry) => entry.projectId === projectId),
    [births, projectId],
  );
  const wait = waits.get(projectId);
  const creation = useNewMate((state) => state.creations[projectId]);
  // The New project this tab made whose first Mate this is, while the tab holds it.
  const made = useNewProjectBirths((state) => newProjectBirthOf(state.births, projectId));
  const forgetCreation = useNewMate((state) => state.forget);
  // The platform's verdict on its creation, read while it may still be refused (H20).
  const verdicts = useZeropsCreationVerdicts(
    listed === undefined ? [] : [listed],
    birth !== undefined && birth.step !== "health" ? projectId : null,
  );
  const candidate = useMemo(
    () =>
      listed === undefined
        ? undefined
        : applyProjectCreationVerdict(listed, verdicts.get(projectId)),
    [listed, projectId, verdicts],
  );
  const { health } = useZeropsContainers();
  const containerHealth = candidate === undefined ? undefined : health.get(candidate.key);
  const coming = mateComing({ birth, candidate, setUpFailed: creation?.failed });
  // What opens it is its machine (`mateLink`): found by its project while its row stands for the
  // project, and before the listing names it at all.
  const { mateLink } = useEnvironmentLinks();
  const rowKey = candidate?.key ?? projectId;
  const link = useMemo(
    () => mateLink({ key: rowKey, project: { id: projectId } }),
    [mateLink, projectId, rowKey],
  );
  const page = mateComingPage({
    coming,
    candidate,
    complete: held.complete && birth === undefined && creation === undefined,
    linked: link.environmentId !== undefined,
    reachability: link.reachability,
  });
  // Whether this view has shown it coming up: its hand-over is then the stand-up's, in place.
  const [cameUp, setCameUp] = useState(false);
  if (page?.kind === "coming" && !cameUp) setCameUp(true);

  // Who it is: its listing's, the moment it is listed — the name and the tint the menu gives it —
  // and until then what its creation or its birth knew.
  const tints = useMemo(() => assignCandidateMateTints(held.rows), [held.rows]);
  const mate = useMemo((): ZeropsMateIdentity => {
    if (candidate !== undefined) return zeropsMateIdentityOf(candidate, tints);
    const face = creation?.face ?? birth?.placement?.face ?? NO_FACE;
    return {
      name: creation?.botName ?? birth?.placement?.botName ?? birth?.placement?.displayName ?? "",
      tint: face.tint,
      shape: face.shape,
      project: creation?.groupName ?? birth?.placement?.groupName,
      projectUrl: zeropsProjectUrl(projectId),
      connected: false,
      // This tab made it: the person looking asked for its stand-up.
      ...(creation !== undefined && viewer !== undefined ? { standUp: { by: viewer } } : {}),
    };
  }, [birth, candidate, creation, projectId, tints, viewer]);

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
  // Its conversation read live and its agents' sign-in are what the conversation paints first; a
  // few seconds without them and the view hands over anyway.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (environmentId === null) return;
    const timer = setTimeout(() => setGraceOver(true), LIVE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [environmentId]);
  // A new Mate hands over once its conversation is read live and its sign-in known, or a few
  // seconds on; any other Mate the moment its conversation can be opened.
  const up =
    environmentId !== null &&
    threadRef !== null &&
    (!cameUp || (empty.signInKnown && status === "live") || graceOver);

  // The hand-over: a new Mate's words turn in place, then the conversation takes the route with
  // that frame; any other Mate's conversation takes it at once. What the door that opened it asked
  // to be told of the conversation is told first (`mateOpening`). Once begun it runs to its end,
  // whatever is read meanwhile.
  const [handing, setHanding] = useState(false);
  if (up && !handing) setHanding(true);
  const handingOver = useNewMate((state) => state.handingOver);
  // What the person types into the composer standing in while it connects: the conversation's
  // draft, the caret where they left it (`mateHandOver`). The conversation its menu row stands
  // for is known before it connects — its draft is typed into as its own composer would; else
  // what is typed joins the conversation's draft as it opens.
  const liveActivity = useZeropsThreadActivity(threadRef);
  const remembered = rememberedActivity(projectId);
  const standInKey = liveActivity?.threadKey ?? remembered?.threadKey ?? null;
  const standInRef = useMemo(
    () => (standInKey === null ? null : parseScopedThreadKey(standInKey)),
    [standInKey],
  );
  const heldDraft = useComposerDraftStore((state) =>
    standInKey === null ? "" : (state.draftsByThreadKey[standInKey]?.prompt ?? ""),
  );
  const [typing, setTyping] = useState<{ readonly typed: StandInTyped; readonly touched: boolean }>(
    { typed: NOTHING_TYPED, touched: false },
  );
  const typed: StandInTyped =
    standInRef === null ? typing.typed : { text: heldDraft, caret: typing.typed.caret };
  const type = (next: StandInTyped) => {
    if (standInRef !== null) useComposerDraftStore.getState().setPrompt(standInRef, next.text);
    setTyping({ typed: next, touched: true });
  };
  const typedRef = useRef({ typed, touched: typing.touched, key: standInKey });
  useEffect(() => {
    typedRef.current = { typed, touched: typing.touched, key: standInKey };
  });
  useEffect(() => {
    if (!handing || environmentId === null || threadRef === null) return;
    // Kept read from above every view while the route changes under it.
    if (cameUp) handingOver(threadRef);
    const timer = setTimeout(
      () => {
        const written = typedRef.current;
        const conversation = scopedThreadKey(threadRef);
        let caret: number | null = written.touched ? written.typed.caret : null;
        if (written.key !== conversation && written.typed.text.length > 0) {
          // Typed where no conversation was known, or into another than the one that opened.
          const drafts = useComposerDraftStore.getState();
          const draft = draftWithTyped(
            drafts.getComposerDraft(threadRef)?.prompt ?? "",
            written.typed,
          );
          drafts.setPrompt(threadRef, draft.prompt);
          const typedInto = written.key === null ? null : parseScopedThreadKey(written.key);
          if (typedInto !== null) drafts.setPrompt(typedInto, "");
          caret = draft.caret;
        }
        handOverMateConversation(conversation, { nowMs: Date.now(), caret });
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
  const projects = useProjects();
  const environmentRead =
    environmentId !== null && projects.some((entry) => entry.environmentId === environmentId);
  const noConversation = environmentRead && primaryId === undefined && graceOver;
  const opened = useRef(false);
  useEffect(() => {
    if (!noConversation || candidate === undefined || opened.current) return;
    opened.current = true;
    openMate(candidate, takeMateConversation(projectId));
  }, [candidate, noConversation, openMate, projectId]);

  // Its link, made as the projects screen's Connect would, where the person's session allows: a
  // Mate on its way, by its target — auto-connect may be full, or have passed it by; a birth this
  // view drives, once its container answers and no socket to it is open yet.
  const connect = useConnectMate("user");
  const asked = useRef<string | null>(null);
  const answering =
    page?.kind === "coming" &&
    candidate?.group === "ready" &&
    candidate.containerOrigin !== undefined &&
    containerHealth === "ready" &&
    (birth === undefined || birth.step === "health");
  // Once a machine names it: a Connect asked before the stage holds its target would end unheard.
  const reachingKey =
    page?.kind === "reaching" && link.reachability !== null ? link.key : undefined;
  const birthOrigin = answering ? candidate.containerOrigin : undefined;
  useEffect(() => {
    const target: MateConnectTarget | null =
      reachingKey !== undefined
        ? { key: reachingKey }
        : birthOrigin === undefined
          ? null
          : birth?.serviceId != null
            ? { key: `${projectId}:${birth.serviceId}` }
            : {
                origin: birthOrigin,
                organization:
                  activeOrganization === null ? null : organizationRef(activeOrganization.id),
              };
    if (target === null) return;
    const id = "key" in target ? target.key : `${projectId}@${target.origin}`;
    if (asked.current === id) return;
    asked.current = id;
    void connect(target);
  }, [
    activeOrganization,
    birth?.serviceId,
    birthOrigin,
    connect,
    organizationRef,
    projectId,
    reachingKey,
  ]);
  // Try now: the person's own retry of what its machine backs off from.
  const linkKey = link.key;
  const tryNow = linkKey === undefined ? undefined : () => void connect({ key: linkKey });

  // How far it has got, as the projects page's card draws it.
  const progress = useZeropsBirthProgress(
    candidate === undefined && birth === undefined
      ? null
      : {
          candidate: candidate ?? {
            key: projectId,
            project: {
              id: projectId,
              name: mate.name,
              status: "NEW",
              ...(birth === undefined ? {} : { created: new Date(birth.startedAt).toISOString() }),
            },
            group: "provisioning",
          },
          health: containerHealth,
          provisioningPhase: wait?.phase ?? null,
          hardenError: wait?.phase === "hardening" ? (wait.detail ?? undefined) : undefined,
          connecting: candidate?.connection?.phase === "connecting",
          runtimes: birthRuntimesFacts({
            birth,
            services: resolvedServices(inventory.services.get(projectId)),
          }),
        },
  );
  // What its copy's first step waits on: the managed services its birth planned, else its
  // project's own.
  const managed = useMemo(
    () =>
      birthCopyServices({
        planned: birth?.managed,
        services: resolvedServices(inventory.services.get(projectId)),
      }),
    [birth?.managed, inventory.services, projectId],
  );
  // A New project's first Mate: the project's own steps stay before the Mate's, done, as its view
  // drew them before the platform took the Mate's project — one line, one clock, from the press.
  const lineProgress: ArrivalProgress | undefined =
    progress === null
      ? undefined
      : {
          ...(made === undefined
            ? progress.progress
            : newProjectProgress(made, progress.progress, progress.nowMs)),
          ...(managed === undefined ? {} : { managed }),
        };

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
      deleteProject: (id) =>
        runZeropsCommand(runtime.commands.deleteProject({ organization, projectId: id })),
      forgetCreation: (id) => {
        forgetBirth(id);
        forgetCreation(id);
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

  // Up and not handed over yet — its conversation and its sign-in still being read — a new Mate
  // stays coming, its progress whole, until the words can turn into the conversation's own.
  const shown: MateComing | undefined =
    page?.kind === "coming"
      ? page.coming
      : page?.kind === "up" && cameUp
        ? UP_AND_OPENING
        : undefined;
  const phaseAhead = mateStandUpPhase({
    marker: mate.standUp,
    viewer: user?.id,
    main: true,
    signIn: "unknown",
    attempt: "none",
  });
  // Any other Mate: its name — "This Mate" where nothing names it, as on its conversation's route —
  // and under it what its link waits for, or why it cannot be opened.
  const named = mate.name.length > 0 ? mate : { ...mate, name: "This Mate" };
  const nowMs = useSecondsNowMs(
    page?.kind === "reaching" && page.reachability?.kind === "retrying",
  );
  // What its link says under its name (`mateVoice`): nothing for a blip, "Opening Wren…" and the
  // platform's processes for a first connect that is slow, a restart in its name.
  const linkReachability =
    page?.kind === "reaching"
      ? page.reachability
      : page?.kind === "up"
        ? (link.reachability ?? null)
        : null;
  const linkPast = useHeldPast(
    `${page?.kind ?? "none"}:${linkReachability?.kind ?? "none"}`,
    MATE_VOICE_QUIET_MS,
  );
  const linkVoice = mateVoice({
    reachability: linkReachability,
    conversationShown: false,
    heldMs: linkPast ? MATE_VOICE_QUIET_MS : 0,
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
              sentence: comingSentenceOf({
                coming: shown,
                trouble,
                progress: lineProgress,
                nowMs: progress?.nowMs,
              }),
              below: (
                <ComingBelow
                  coming={shown}
                  mate={mate}
                  nowMs={progress?.nowMs}
                  onKeepWaiting={() => {
                    retryBirth(projectId);
                  }}
                  onRemove={remove}
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
                below: (
                  <MateOpeningLine
                    onTryNow={tryNow}
                    projects={<Link to="/zerops" />}
                    phrase={mateOpeningPhrase(page, { nowMs, mateName: named.name })}
                    projectUrl={mate.projectUrl}
                  />
                ),
              }
            : {
                kind: "reaching",
                below: (
                  <MateLinkLine
                    mateServiceId={mate.serviceId}
                    onTryNow={tryNow}
                    projectId={projectId}
                    projectUrl={mate.projectUrl}
                    voice={linkVoice.surface === "none" ? SILENT_STAGE : linkVoice}
                  />
                ),
              };

  // An existing Mate's composer stands in its place while its link is made, as its conversation
  // will draw it: a switch here from a conversation keeps it on screen. A new Mate holds it back
  // for its stand-up; one that cannot be opened has nothing to write to.
  const standsInComposer = shown === undefined && page?.kind !== "unreachable";
  // What the Mate is on, as its menu row says it: its conversation's own once its conversations
  // are read, else what the menu remembers drawing.
  const standInSubject = liveActivity?.subject ?? remembered?.subject ?? null;

  return (
    <MateComingFrame
      composer={standsInComposer ? <ComposerStandIn onType={type} typed={typed} /> : null}
      header={
        <MateComingHeader
          mate={{ ...mate, connected: environmentId !== null }}
          standsIn={standsInComposer ? { subject: standInSubject } : null}
        />
      }
    >
      {view === null ? null : (
        <MateEmptyStateView
          coming={view}
          mate={{ ...(shown === undefined ? named : mate), connected: environmentId !== null }}
          onRetry={empty.onRetry}
          phase={handing && cameUp ? empty.phase : phaseAhead}
          signIn={handing && cameUp ? empty.signIn : null}
          runtimes={empty.runtimes}
          signInRequired={empty.signInRequired}
          unknown={handing && cameUp ? empty.unknown : null}
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
  /** The composer standing where its conversation's will (`ComposerStandIn`). */
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
 * The header's line as its conversation will draw it: the Mate's face and its name, and its
 * project in Zerops — once the platform has made one.
 */
export function MateComingHeader({
  mate,
  standsIn = null,
}: {
  readonly mate: Pick<ZeropsMateIdentity, "name" | "tint" | "shape" | "connected"> & {
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
      <ConversationStripView
        chats={null}
        crew={null}
        mate={{
          name: mate.name,
          tint: mate.tint,
          shape: mate.shape,
          face: mate.connected ? "idle" : "sleep",
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
        {mate.projectUrl === undefined ? null : <ZeropsProjectLink projectUrl={mate.projectUrl} />}
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
 * past a step's cap, that it is taking longer; one that did not come, why.
 */
export function comingSentenceOf(input: {
  readonly coming: MateComing | undefined;
  readonly trouble?: string | null;
  readonly progress: BirthLineProgress | undefined;
  readonly nowMs: number | undefined;
}): string | undefined {
  const { coming, progress, nowMs } = input;
  if (coming === undefined) return undefined;
  if (coming.kind === "failed") return input.trouble ?? coming.line;
  if (coming.verb === "keep-waiting") return coming.line;
  const startedAt = progress?.startedAt === undefined ? Number.NaN : Date.parse(progress.startedAt);
  return comingSentence(
    nowMs === undefined || Number.isNaN(startedAt) ? undefined : nowMs - startedAt,
  );
}

/**
 * In the slot while it comes up: the Mate's own steps (`arrivalSteps`), with their times — and
 * over them, where it waits on the person, the view's one verb: *Keep waiting* past a step's cap;
 * for one that did not come, *Remove*, *Try again* where a New project's step stopped before
 * anything was made, or *Go to projects* where the platform may have made it anyway.
 */
export function ComingBelow({
  coming,
  progress,
  nowMs,
  mate,
  you,
  removing = false,
  onKeepWaiting,
  onRemove,
  onTryAgain,
  projects,
}: {
  readonly coming: MateComing | undefined;
  readonly progress: ArrivalProgress | undefined;
  readonly nowMs: number | undefined;
  readonly mate: Pick<ZeropsMateIdentity, "name" | "project">;
  readonly you: ArrivalYou | null;
  readonly removing?: boolean;
  readonly onKeepWaiting?: () => void;
  readonly onRemove?: () => void;
  readonly onTryAgain?: () => void;
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
          const shown = coming?.kind === "failed" ? marked : step;
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
    coming?.kind === "failed" ? (
      coming.verb === "remove" && onRemove !== undefined ? (
        <Button disabled={removing} onClick={onRemove}>
          Remove
        </Button>
      ) : coming.verb === "try-again" && onTryAgain !== undefined ? (
        <Button onClick={onTryAgain}>{MATE_STAND_UP_RETRY_LABEL}</Button>
      ) : coming.verb === "go-to-projects" && projects !== undefined ? (
        <Button render={projects}>Go to projects</Button>
      ) : null
    ) : coming?.verb === "keep-waiting" && onKeepWaiting !== undefined ? (
      <Button onClick={onKeepWaiting} variant="outline">
        Keep waiting
      </Button>
    ) : null;
  if (verb === null) {
    return steps === null ? null : <div data-zerops-surface="mate-coming-progress">{steps}</div>;
  }
  return (
    <div
      className="flex flex-col gap-5.5"
      data-zerops-surface={coming?.kind === "failed" ? "mate-coming-failed" : "mate-coming-slow"}
    >
      <div className="arrival-acts">{verb}</div>
      {steps}
    </div>
  );
}

/** What the arrival's steps read: the birth's line, with its copy's managed services. */
export type ArrivalProgress = BirthLineProgress & {
  readonly managed?: ReadonlyArray<BirthCopyService> | undefined;
};

/** A project's services once the inventory has read them; nothing while it hasn't, or failed. */
function resolvedServices(
  outcome: InventoryServiceOutcome | undefined,
): ReadonlyArray<ZeropsService> | undefined {
  return outcome?.status === "resolved" ? outcome.services : undefined;
}
