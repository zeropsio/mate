import { useAtomValue } from "@effect/atom-react";
import { shownHqMenuNavigationAtom } from "@t3tools/client-runtime/data";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import ChatViewBoundary from "../components/ChatViewBoundary";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  resolveThreadRouteRef,
  resolveThreadRouteRenderState,
  resolveThreadRouteStage,
  THREAD_READ_PATIENCE_MS,
} from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { SidebarInset } from "~/components/ui/sidebar";
import { MateOpeningView } from "~/components/zerops/MateLinkStage";
import { SurfaceLoading } from "~/components/SurfaceLoading";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { useThreadDetail, useThreadShell, useThreadStatus } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import { useEnvironmentThread } from "../state/threads";

function ChatThreadRoutePending() {
  const threadRef = Route.useParams({ select: (params) => resolveThreadRouteRef(params) });
  const mate = useZeropsMate(threadRef?.environmentId ?? NO_ENVIRONMENT);
  return threadRef === null || mate.kind === "nobody" ? (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh">
      <SurfaceLoading />
    </SidebarInset>
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
  const [conversationShown, setConversationShown] = useState(false);
  // Its messages' read failed, or the list has named the thread for a while without them.
  const readFailed = Option.isSome(
    useEnvironmentThread(threadRef?.environmentId ?? null, threadRef?.threadId ?? null).error,
  );
  // HQ's answer names the header and adds rows of its own: an arrival waits for it too.
  const directoryAnswered = useAtomValue(
    shownHqMenuNavigationAtom,
    (navigation) =>
      navigation.read === "read" ||
      navigation.refusal !== null ||
      navigation.capped ||
      navigation.updateRequired,
  );
  const patienceSpent = usePatienceSpent(
    threadRef !== null &&
      !conversationShown &&
      (serverThreadShell !== null || serverThreadDetail !== null) &&
      (serverThreadDetail === null || !directoryAnswered)
      ? `${threadRef.environmentId}/${threadRef.threadId}`
      : null,
    THREAD_READ_PATIENCE_MS,
  );
  const stage = resolveThreadRouteStage({
    renderState,
    serverThreadShellExists: serverThreadShell !== null,
    conversationShown,
    nobodyLivesHere: routeMate.kind === "nobody",
    readGivenUp: readFailed || patienceSpent,
    directoryAnswered,
    promotedDraft: draftThreadExists,
  });
  // Once shown, the pane keeps its conversation through a switch to one still being read.
  if (stage === "conversation" && !conversationShown) setConversationShown(true);
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

  // Its conversation not read yet (a reload, before the catalog names its thread or its messages
  // arrive): the Mate's own view, its header's place held until the directory names who lives
  // here, until the whole conversation takes over — never a blank pane, never a guessed face.
  if (stage === "opening") {
    return <MateOpeningView threadRef={threadRef} />;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {stage === "conversation" ? (
        <ChatViewBoundary
          waiting={<ChatThreadRoutePending />}
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
          threadSyncPhase={threadSyncPhase}
        />
      ) : stage === "missing" ? (
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

/** Whether `ms` has passed since `key` began to be waited on; a new key (or none) starts over. */
function usePatienceSpent(key: string | null, ms: number): boolean {
  const [spent, setSpent] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const timer = window.setTimeout(() => setSpent(key), ms);
    return () => window.clearTimeout(timer);
  }, [key, ms]);
  return key !== null && spent === key;
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ChatThreadRouteView,
  pendingComponent: ChatThreadRoutePending,
  // This small wrapper stays ready during draft promotion. ChatViewBoundary owns the lazy
  // chat code inside the inset, so the router never hides the draft to load another wrapper.
  codeSplitGroupings: [],
});
