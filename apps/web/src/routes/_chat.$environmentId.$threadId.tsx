import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadRouteRef, resolveThreadRouteRenderState } from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";
import { EnvironmentId } from "@t3tools/contracts";

import { SidebarInset } from "~/components/ui/sidebar";
import { MateOpeningView } from "~/components/zerops/MateLinkStage";
import { SurfaceLoading } from "~/components/SurfaceLoading";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { useThreadDetail, useThreadShell, useThreadStatus } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";

function ChatThreadRoutePending() {
  const threadRef = Route.useParams({ select: (params) => resolveThreadRouteRef(params) });
  const mate = useZeropsMate(threadRef?.environmentId ?? NO_ENVIRONMENT);
  return threadRef === null || mate.kind === "nobody" ? (
    <SurfaceLoading />
  ) : (
    <MateOpeningView threadRef={threadRef} />
  );
}

function ChatThreadRouteView() {
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const shell = useEnvironmentQuery(
    threadRef === null ? null : environmentShell.stateAtom(threadRef.environmentId),
  );
  const serverThreadShell = useThreadShell(threadRef);
  const serverThreadDetail = useThreadDetail(threadRef);
  const serverThreadStatus = useThreadStatus(threadRef);
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const renderState = resolveThreadRouteRenderState({
    shell: shell.data?.status ?? "empty",
    serverThreadShellExists: serverThreadShell !== null,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = threadHasStarted(serverThreadDetail);
  const routeMate = useZeropsMate(threadRef?.environmentId ?? NO_ENVIRONMENT);
  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread, serverThreadStarted, threadRef]);
  // Once per arrival at a thread: a resync that briefly takes the content away
  // records nothing again, so `t` after a reload is the reload's latency.
  const contentReady = renderState === "ready";
  const environmentId = threadRef?.environmentId;
  const threadId = threadRef?.threadId;
  const arrivalRef = useRef<{ thread: string; marked: boolean } | null>(null);
  useEffect(() => {
    if (environmentId === undefined || threadId === undefined) return;
    const thread = `${environmentId}/${threadId}`;
    if (arrivalRef.current?.thread !== thread) arrivalRef.current = { thread, marked: false };
    if (!contentReady || arrivalRef.current.marked) return;
    arrivalRef.current.marked = true;
    mateDiagnostics.record({ kind: "thread-content", environmentId, threadId });
  }, [contentReady, environmentId, threadId]);

  if (!threadRef) {
    return null;
  }

  // Its thread not read yet (a reload, before the catalog names it): the Mate's own view, its
  // header's place held until the directory names who lives here, until the conversation takes
  // over — never a blank pane, never a guessed face.
  const showsConversation =
    renderState === "ready" || (renderState === "loading" && serverThreadShell !== null);
  if (!showsConversation && renderState !== "missing" && routeMate.kind !== "nobody") {
    return <MateOpeningView threadRef={threadRef} />;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {renderState === "ready" || (renderState === "loading" && serverThreadShell !== null) ? (
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
          threadSyncPhase={threadSyncPhase}
        />
      ) : renderState === "missing" ? (
        <div
          role="status"
          className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground"
        >
          This conversation is no longer available. <Link to="/zerops">Open your projects</Link>
        </div>
      ) : null}
    </SidebarInset>
  );
}

const NO_ENVIRONMENT = EnvironmentId.make("none");

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ChatThreadRouteView,
  pendingComponent: ChatThreadRoutePending,
  // Its pending stage is already on screen while the conversation's code loads.
  codeSplitGroupings: [["component"]],
});
