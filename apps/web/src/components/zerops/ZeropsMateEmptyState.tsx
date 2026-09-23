/**
 * An empty conversation with a Mate: the Mate's mark in its colour, the
 * question — "What should Fen do on Acme Docs?" — and, when no coding agent
 * is signed in so nothing typed here could be acted on, the sign-in itself,
 * right where the first message would go. Asking there is the empty state
 * doing its one job; a line above the timeline asking the same was a second
 * voice.
 *
 * Who the Mate is comes from `useZeropsMates` (the caller resolves it, so a
 * conversation nobody lives in keeps upstream's empty line); whether a
 * sign-in is required is `zeropsAgentSignInRequired` over the environment's
 * agent-auth feed once it is known, and until then the place says it is
 * checking, or why it could not; the sign-in itself is
 * `useZeropsAgentSignInDialog`, the one dialog every sign-in surface shares.
 */
import {
  zeropsAgentAuthView,
  zeropsAgentSignInRequired,
} from "@t3tools/client-runtime/zerops/agentLogin";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

import { MateMark } from "../MateMark";
import { mateQuestion, type ZeropsMateIdentity } from "../../zerops/mateIdentities";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useZeropsAgentAuth } from "../../zerops/useZeropsFeeds";
import { useZeropsAgentSignInDialog } from "../../zerops/useZeropsAgentSignInDialog";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { FlatCard } from "./primitives";
import { ZeropsAgentAuthRows } from "./ZeropsAgentAuthCard";

export function ZeropsMateEmptyState({
  environmentId,
  mate,
  threadRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly mate: ZeropsMateIdentity;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { snapshot: agentAuth, unknown: agentAuthUnknown } = zeropsAgentAuthView(
    useZeropsAgentAuth(environmentId),
  );
  // Only a known snapshot can ask for a sign-in; one still being read says so.
  const signInRequired = agentAuth !== null && zeropsAgentSignInRequired(agentAuth);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  // D6: the conversation view (`ChatView`) is the one place that records the
  // signer of a successful sign-in, whichever door it went through; this
  // hook only reads how that went and owns the dialog itself.
  const {
    openFor: openAuthorizationDialog,
    dialog: authorizationDialog,
    recordFailed,
    retryRecord,
  } = useZeropsAgentSignInDialog(environmentId, threadRef, { projectName: mate.project ?? null });
  const cancelAgentLogin = useAgentLoginCancel(threadRef);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-6 px-5 sm:px-6"
      data-zerops-surface="mate-empty-state"
    >
      <MateMark playful className="h-16 w-auto sm:h-[72px]" tint={mate.tint} />
      <h1 className="text-center text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
        {mateQuestion(mate)}
      </h1>
      {signInRequired && agentAuth !== null ? (
        <section className="flex w-full max-w-md flex-col gap-3" data-zerops-surface="mate-sign-in">
          <p className="text-center text-sm text-muted-foreground">
            {mate.name} works through a coding agent. Sign one in to start.
          </p>
          <FlatCard className="overflow-hidden">
            <ZeropsAgentAuthRows
              onCancel={cancelAgentLogin}
              onRetryRecord={retryRecord}
              onSignIn={openAuthorizationDialog}
              recordFailed={recordFailed}
              snapshot={agentAuth}
              viewerSubject={viewerSubject}
            />
          </FlatCard>
        </section>
      ) : agentAuthUnknown !== null ? (
        <p
          className={cn(
            "text-center text-sm text-muted-foreground",
            // A placeholder waits a beat before it says anything, so a quick
            // answer never flickers "Checking…".
            agentAuthUnknown.afterMs > 0 && "animate-zerops-appear",
          )}
          data-zerops-surface="mate-agent-auth-unknown"
          style={
            agentAuthUnknown.afterMs > 0
              ? { animationDelay: `${agentAuthUnknown.afterMs}ms` }
              : undefined
          }
        >
          {agentAuthUnknown.text}
        </p>
      ) : null}
      {authorizationDialog}
    </div>
  );
}
