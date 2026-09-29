/**
 * A new Mate's own view while it comes up (`/mate/$projectId`): where Add lands, and where its row
 * in the menu opens until it is up. It is the Mate's empty conversation before the conversation
 * exists — the same header line, the same face a third of the way down, the headline in the box
 * the stand-up's phases share (`MateEmptyStateView`) — saying it is coming up, with the projects
 * page's own progress under it (`ZeropsBirthLine`: the birth's steps, the step's words, how long).
 * A Mate that did not come says so, with the page's *Remove*; a step past its cap, with its
 * *Keep waiting*.
 *
 * Once it is up — connected, its main conversation and the agents' sign-in read — the words hand
 * over in place: the face wakes, the headline turns into the stand-up's ("Quinn will stand up
 * development on Acme Docs after you authorize your agent.") and its Authorize buttons fade in
 * where the progress stood. Then the conversation takes the route, painting that same frame
 * (`mateHandOver.ts`), so the person never sees a page change.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  assignCandidateMateTints,
  resolvePrimaryConversation,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { applyProjectCreationVerdict } from "@t3tools/client-runtime/zerops/candidates";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useThreadShells, useThreadStatus } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useConnectMate } from "~/zerops/accountEnvironments";
import { markMateHandedOver } from "~/zerops/mateHandOver";
import { mateComing, mateComingPage, type MateComing } from "~/zerops/mateComing";
import { zeropsMateIdentityOf, type ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { mateStandUpPhase } from "~/zerops/mateStandUp";
import { useNewMate } from "~/zerops/newMate";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useZeropsBirthProgress } from "~/zerops/useZeropsBirthProgress";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsCreationVerdicts } from "~/zerops/useZeropsCreationVerdicts";
import { forgetBirth, retryBirth, useZeropsBirths } from "~/zerops/zeropsBirths";
import { useZeropsContainers } from "~/zerops/zeropsContainers";
import { runZeropsCommand, useZeropsData } from "~/zerops/zeropsDataContext";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ConversationStripView } from "../chat/ConversationStrip";
import { ZeropsProjectLink } from "../chat/ChatHeader";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ZeropsBirthLine } from "./ZeropsBirthProgress";
import { ALMOST_THERE_LINE } from "./ZeropsProjectRow.logic";
import { MateEmptyStateView, useMateEmptyState } from "./ZeropsMateEmptyState";
import { removeFailedZeropsProject } from "./ZeropsProjectsPage";

/** Up, its conversation being opened: the last of its coming words. */
const UP_AND_OPENING: MateComing = { kind: "coming", line: ALMOST_THERE_LINE, verb: undefined };

/** The slate face a Mate wears where nobody picked one. */
const NO_FACE: ZeropsMateFace = { tint: "slate", shape: "squircle" };

/** The hand-over's own length: the headline's cross-fade (`[data-standup-phrase]`), then the route. */
const HAND_OVER_MS = 220;

/** How long a connected Mate's conversation may take to be read live before it hands over anyway. */
const LIVE_GRACE_MS = 3_000;

export function ZeropsMateComingPage({ projectId }: { readonly projectId: string }) {
  const navigate = useNavigate();
  const openMate = useOpenMate();
  const { activeOrganization, user } = useZeropsSession();
  const viewer = user?.id;
  const { organizationRef, runtime } = useZeropsData();
  const { listing } = useZeropsCandidates();
  const held = useMemo(() => heldCandidates(listing), [listing]);
  const listed = held.rows.find((candidate) => candidate.project.id === projectId);
  const { births, waits } = useZeropsBirths();
  const birth = births.find((entry) => entry.projectId === projectId);
  const wait = waits.get(projectId);
  const creation = useNewMate((state) => state.creations[projectId]);
  const forgetCreation = useNewMate((state) => state.forget);
  // The platform's verdict on its creation, read while it may still be refused (H20).
  const verdicts = useZeropsCreationVerdicts(
    listed === undefined ? [] : [listed],
    birth !== undefined && birth.step !== "health" ? projectId : null,
  );
  const candidate =
    listed === undefined ? undefined : applyProjectCreationVerdict(listed, verdicts.get(projectId));
  const { health } = useZeropsContainers();
  const containerHealth = candidate === undefined ? undefined : health.get(candidate.key);
  const coming = mateComing({ birth, candidate, setUpFailed: creation?.failed });
  const page = mateComingPage({
    coming,
    candidate,
    health: containerHealth,
    complete: held.complete && birth === undefined && creation === undefined,
  });

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
  // first, painted here first.
  const environmentId: EnvironmentId | null =
    candidate?.group === "connected" ? (candidate.environmentId ?? null) : null;
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
  const empty = useMateEmptyState({ environmentId, mate, threadRef });
  // Its conversation read live and its agents' sign-in are what the conversation paints first; a
  // few seconds without them and the view hands over anyway.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (environmentId === null) return;
    const timer = setTimeout(() => setGraceOver(true), LIVE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [environmentId]);
  const up =
    environmentId !== null &&
    threadRef !== null &&
    ((empty.signInKnown && status === "live") || graceOver);

  // The hand-over: the words turn in place, then the conversation takes the route with that frame.
  // Once begun it runs to its end, whatever is read meanwhile.
  const [handing, setHanding] = useState(false);
  if (up && !handing) setHanding(true);
  const handingOver = useNewMate((state) => state.handingOver);
  useEffect(() => {
    if (!handing || environmentId === null || threadRef === null) return;
    // Kept read from above every view while the route changes under it.
    handingOver(threadRef);
    const timer = setTimeout(() => {
      markMateHandedOver(environmentId);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        replace: true,
      });
    }, HAND_OVER_MS);
    return () => clearTimeout(timer);
  }, [environmentId, handing, handingOver, navigate, threadRef]);

  // Connected with no conversation of its own to hand over to (an older server): opening it
  // starts one, as its row would — once.
  const noConversation = environmentId !== null && primaryId === undefined && graceOver;
  const opened = useRef(false);
  useEffect(() => {
    if (!noConversation || candidate === undefined || opened.current) return;
    opened.current = true;
    openMate(candidate);
  }, [candidate, noConversation, openMate]);

  // Nothing to wait for here: the projects screen owns its verbs.
  useEffect(() => {
    if (page?.kind !== "elsewhere") return;
    void navigate({ to: "/zerops", replace: true });
  }, [navigate, page?.kind]);

  // Its container answering and no socket to it yet: this view asks for it, as the projects
  // page does for a birth it drives — auto-connect may be full, and nobody waits on it then.
  const connect = useConnectMate("user");
  const asked = useRef<string | null>(null);
  const answering =
    candidate?.group === "ready" &&
    candidate.containerOrigin !== undefined &&
    containerHealth === "ready" &&
    (birth === undefined || birth.step === "health");
  useEffect(() => {
    if (!answering || candidate?.containerOrigin === undefined) return;
    const key = `${candidate.key}@${candidate.containerOrigin}`;
    if (asked.current === key) return;
    asked.current = key;
    void connect(
      birth?.serviceId != null
        ? { key: `${projectId}:${birth.serviceId}` }
        : {
            origin: candidate.containerOrigin,
            organization:
              activeOrganization === null ? null : organizationRef(activeOrganization.id),
          },
    );
  }, [
    activeOrganization,
    answering,
    birth?.serviceId,
    candidate,
    connect,
    organizationRef,
    projectId,
  ]);

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
        },
  );

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

  // Up and not handed over yet — its conversation and its sign-in still being read — it stays
  // coming, its progress whole, until the words can turn into the conversation's own.
  const shown: MateComing | undefined =
    page?.kind === "coming" ? page.coming : page?.kind === "up" ? UP_AND_OPENING : undefined;
  const phaseAhead = mateStandUpPhase({
    marker: mate.standUp,
    viewer: user?.id,
    main: true,
    signIn: "unknown",
    attempt: "none",
  });

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
        data-zerops-surface="mate-coming-page"
      >
        <WorkspacePageHeader className="relative bg-background" data-chat-header>
          <MateComingHeader mate={{ ...mate, connected: environmentId !== null }} />
        </WorkspacePageHeader>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {mate.name.length === 0 || shown === undefined ? null : (
            <MateEmptyStateView
              coming={{
                kind: shown.kind,
                over: handing,
                below: (
                  <ComingBelow
                    coming={shown}
                    nowMs={progress?.nowMs}
                    onKeepWaiting={() => {
                      retryBirth(projectId);
                    }}
                    onRemove={remove}
                    progress={progress?.progress}
                    removing={removing}
                    trouble={trouble}
                  />
                ),
              }}
              mate={{ ...mate, connected: environmentId !== null }}
              onRetry={empty.onRetry}
              phase={handing ? empty.phase : phaseAhead}
              signIn={handing ? empty.signIn : null}
              signInRequired={empty.signInRequired}
              unknown={handing ? empty.unknown : null}
            />
          )}
          {empty.dialog}
        </div>
      </div>
    </SidebarInset>
  );
}

/** The header's line as its conversation will draw it: the Mate's face and its name. */
function MateComingHeader({ mate }: { readonly mate: ZeropsMateIdentity }) {
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
          tooltip: null,
        }}
        onCloseChat={() => undefined}
        onOpen={() => undefined}
        onRename={null}
        renameField={null}
        renderCrewmateMenu={() => null}
      />
      <span className="flex size-4 shrink-0" />
      <div className="flex shrink-0 items-center justify-end gap-1 pr-18.25 sm:pr-14.25">
        <ZeropsProjectLink projectUrl={mate.projectUrl} />
      </div>
    </div>
  );
}

/**
 * Under the headline while it comes up: the projects page's own line for a birth — its steps,
 * the step's words and how long — or, past a step's cap, "Taking longer than usual." with *Keep
 * waiting*; one that did not come says why, with *Remove*.
 */
function ComingBelow({
  coming,
  progress,
  nowMs,
  removing,
  trouble,
  onKeepWaiting,
  onRemove,
}: {
  readonly coming: MateComing | undefined;
  readonly progress: Parameters<typeof ZeropsBirthLine>[0]["progress"] | undefined;
  readonly nowMs: number | undefined;
  readonly removing: boolean;
  readonly trouble: string | null;
  readonly onKeepWaiting: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  if (coming?.kind === "failed") {
    return (
      <div
        className="flex w-full max-w-sm flex-col items-center gap-3"
        data-zerops-surface="mate-coming-failed"
      >
        <p className="text-center text-sm text-status-failed-text">{trouble ?? coming.line}</p>
        <Button disabled={removing} onClick={onRemove} size="compact" variant="pill">
          Remove
        </Button>
      </div>
    );
  }
  if (coming?.verb === "keep-waiting") {
    return (
      <div
        className="flex w-full max-w-sm flex-col items-center gap-3"
        data-zerops-surface="mate-coming-slow"
      >
        <p className="text-center text-sm text-muted-foreground">{coming.line}</p>
        <Button onClick={onKeepWaiting} size="compact" variant="pill">
          Keep waiting
        </Button>
      </div>
    );
  }
  if (progress === undefined || nowMs === undefined) return null;
  return (
    <div className="flex w-full max-w-xs" data-zerops-surface="mate-coming-progress">
      <ZeropsBirthLine nowMs={nowMs} progress={progress} />
    </div>
  );
}
