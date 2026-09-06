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
 * agent-auth feed; the sign-in itself is the same dialog and login hooks the
 * service map's card uses.
 */
import { zeropsAgentSignInRequired } from "@t3tools/client-runtime/zerops/agentLogin";
import type { EnvironmentId, ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import { useState } from "react";

import { MateMark } from "../MateMark";
import { mateQuestion, type ZeropsMateIdentity } from "../../zerops/mateIdentities";
import { useAgentLogin } from "../../zerops/useAgentLogin";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useZeropsAgentAuth } from "../../zerops/useZeropsFeeds";
import { FlatCard } from "./primitives";
import { ZeropsAgentAuthRows } from "./ZeropsAgentAuthCard";
import { ZeropsAgentAuthorizationDialog } from "./ZeropsAgentAuthorizationDialog";

export function ZeropsMateEmptyState({
  environmentId,
  mate,
  threadRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly mate: ZeropsMateIdentity;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const agentAuth = useZeropsAgentAuth(environmentId);
  const signInRequired = agentAuth !== undefined && zeropsAgentSignInRequired(agentAuth);
  const startAgentLogin = useAgentLogin(threadRef, { terminalSurface: "embedded" });
  const cancelAgentLogin = useAgentLoginCancel(threadRef);
  const [authorizationAgentId, setAuthorizationAgentId] = useState<ZeropsAgentId | null>(null);
  const authorizationAgent = agentAuth?.agents.find(
    (agent) => agent.agentId === authorizationAgentId,
  );

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-6 px-5 sm:px-6"
      data-zerops-surface="mate-empty-state"
    >
      <MateMark playful className="h-16 w-auto sm:h-[72px]" tint={mate.tint} />
      <h1 className="text-center text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
        {mateQuestion(mate)}
      </h1>
      {signInRequired && agentAuth !== undefined ? (
        <section className="flex w-full max-w-md flex-col gap-3" data-zerops-surface="mate-sign-in">
          <p className="text-center text-sm text-muted-foreground">
            {mate.name} works through a coding agent. Sign one in to start.
          </p>
          <FlatCard className="overflow-hidden">
            <ZeropsAgentAuthRows
              onCancel={cancelAgentLogin}
              onSignIn={setAuthorizationAgentId}
              snapshot={agentAuth}
            />
          </FlatCard>
        </section>
      ) : null}
      {authorizationAgent === undefined ? null : (
        <ZeropsAgentAuthorizationDialog
          agent={authorizationAgent}
          onCancel={cancelAgentLogin}
          onOpenChange={(open) => {
            if (!open) setAuthorizationAgentId(null);
          }}
          onStart={startAgentLogin}
          open
          projectName={mate.project ?? null}
          threadRef={threadRef}
        />
      )}
    </div>
  );
}
