import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import ChatViewBoundary from "../components/ChatViewBoundary";
import {
  resolveDraftPromotionNavigationTarget,
  threadHasStarted,
} from "../components/ChatView.logic";
import {
  DraftId,
  markPromotedDraftThreadByRef,
  useBackgroundDraftSubmissionPending,
  useComposerDraftStore,
} from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { waitForDraftHeroTransition } from "../components/chat/draftHeroTransition";
import { buildThreadRouteParams } from "../threadRoutes";
import { useThread, useThreadRefs } from "../state/entities";
import { useMateStandUpHandOver } from "../zerops/useMateStandUp";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const threadRefs = useThreadRefs();
  const inferredThreadRef = draftSession
    ? (threadRefs.find(
        (ref) =>
          ref.environmentId === draftSession.environmentId &&
          ref.threadId === draftSession.threadId,
      ) ?? null)
    : null;
  const serverThreadRef = draftSession?.promotedTo ?? inferredThreadRef;
  const serverThread = useThread(serverThreadRef);
  const serverThreadStarted = threadHasStarted(serverThread);
  const backgroundSubmissionPending = useBackgroundDraftSubmissionPending(serverThreadRef);
  // A new Mate's opening draft waits on its person's stand-up, which its server sends into a
  // conversation of its own: the draft hands over to it once it is there.
  const typed = useComposerDraftStore(
    (store) => (store.getComposerDraft(draftId)?.prompt ?? "").trim().length > 0,
  );
  const standUpThreadRef = useMateStandUpHandOver(
    draftSession ? { key: draftId, environmentId: draftSession.environmentId, typed } : null,
  );
  const canonicalThreadRef =
    resolveDraftPromotionNavigationTarget({
      serverThreadRef,
      serverThreadStarted,
      backgroundSubmissionPending,
    }) ?? standUpThreadRef;

  useEffect(() => {
    if (!inferredThreadRef || draftSession?.promotedTo) {
      return;
    }
    markPromotedDraftThreadByRef(inferredThreadRef);
  }, [draftSession?.promotedTo, inferredThreadRef]);

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }

    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      if (cancelled) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(canonicalThreadRef),
        replace: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (!draftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChatViewBoundary
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
        forceExpandedMobileComposer
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
