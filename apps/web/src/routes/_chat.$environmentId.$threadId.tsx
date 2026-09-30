import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadRouteRef, resolveThreadRouteRenderState } from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";
import { MATE_VOICE_QUIET_MS } from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId, type ScopedThreadRef } from "@t3tools/contracts";

import { ComposerStandIn } from "~/components/chat/ComposerStandIn";
import { SidebarInset } from "~/components/ui/sidebar";
import { MateLinkStage } from "~/components/zerops/MateLinkStage";
import { rememberedMateIdentity } from "~/zerops/mateIdentityMemory";
import { mateOpeningStage } from "~/zerops/mateOpeningStage";
import { useMateVoice } from "~/zerops/mateVoiceContext";
import { useHeldPast } from "~/zerops/useHeldPast";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { useThreadDetail, useThreadShell, useThreadStatus } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";

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
  const rememberedMate =
    routeMate.kind === "mate"
      ? routeMate.mate
      : threadRef === null || routeMate.kind === "nobody"
        ? undefined
        : rememberedMateIdentity(threadRef.environmentId);
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

  // Its thread not read yet (a reload, before the catalog names it): the Mate's own view, from
  // what this browser remembers of it, until the conversation takes over — never a blank pane.
  const showsConversation =
    renderState === "ready" || (renderState === "loading" && serverThreadShell !== null);
  if (!showsConversation && renderState !== "missing" && rememberedMate !== undefined) {
    return <ThreadOpeningStage threadRef={threadRef} />;
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

/** The Mate's stage while its conversation is on its way: face, name, then "Opening Quinn…". */
function ThreadOpeningStage({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const environmentId = threadRef.environmentId;
  // Typed into while it opens: the conversation's own draft, which its composer reads as it takes over.
  const draft = useComposerDraftStore((state) => state.getComposerDraft(threadRef)?.prompt ?? "");
  const [caret, setCaret] = useState(0);
  const voice = useMateVoice();
  const pastQuiet = useHeldPast(`opening:${environmentId}`, MATE_VOICE_QUIET_MS);
  const at = useZeropsMate(environmentId);
  const name =
    at.kind === "mate"
      ? at.mate.name
      : (rememberedMateIdentity(environmentId)?.name ?? "This Mate");
  return (
    <MateLinkStage
      composer={
        <ComposerStandIn
          typed={{ text: draft, caret: Math.min(caret, draft.length) }}
          onType={(next) => {
            useComposerDraftStore.getState().setPrompt(threadRef, next.text);
            setCaret(next.caret);
          }}
        />
      }
      environmentId={environmentId}
      projectId={null}
      voice={mateOpeningStage({ voice, pastQuiet, mateName: name })}
    />
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ChatThreadRouteView,
});
