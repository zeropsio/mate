/**
 * The Zerops right-panel surface: the service map for the project this thread
 * runs in.
 *
 * Reads both feeds and renders. Nothing here mutates the project — the agent
 * owns every change, through MCP.
 */
import type { ScopedThreadRef, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { useState } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { zeropsQuickActions } from "@t3tools/client-runtime/zerops/quickActions";
import { buildZeropsServiceMap } from "@t3tools/client-runtime/zerops/serviceMap";
import { useAgentLogin } from "../../zerops/useAgentLogin";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useProjectTopology } from "../../zerops/useProjectTopology";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";
import { ZeropsAgentAuthorizationDialog } from "./ZeropsAgentAuthorizationDialog";
import { ZeropsQuickActions } from "./ZeropsQuickActions";
import { ZeropsServiceMap } from "./ZeropsServiceMap";
import { MicroLabel } from "./primitives";

export function ZeropsPanel({
  threadRef,
  agentAuthCard,
  agentAuthSnapshot,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly agentAuthCard: ZeropsAgentAuthSnapshot | null;
  readonly agentAuthSnapshot?: ZeropsAgentAuthSnapshot | undefined;
}) {
  const topology = useProjectTopology(threadRef?.environmentId ?? null);
  const lifecycle = useZeropsLifecycle(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  const [authorizationAgentId, setAuthorizationAgentId] = useState<
    ZeropsAgentAuthSnapshot["agents"][number]["agentId"] | null
  >(null);
  const startAgentLogin = useAgentLogin(threadRef, { terminalSurface: "embedded" });
  const cancelAgentLogin = useAgentLoginCancel(threadRef);
  const view = buildZeropsServiceMap(topology.view, lifecycle);
  const authorizationSnapshot = agentAuthSnapshot ?? agentAuthCard;
  const authorizationAgent = authorizationSnapshot?.agents.find(
    (agent) => agent.agentId === authorizationAgentId,
  );
  const panelSections =
    view === undefined
      ? {
          body: <ZeropsPanelPlaceholder />,
          quickActions: null,
        }
      : {
          body: (
            <ZeropsServiceMap error={topology.error} liveness={topology.liveness} view={view} />
          ),
          quickActions: <ZeropsQuickActions actions={zeropsQuickActions(topology.view)} />,
        };

  return (
    <>
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-3xl space-y-5 p-4" data-zerops-project-panel>
          {panelSections.body}
          {agentAuthCard === null ? null : (
            <section className="space-y-2" data-zerops-agent-auth-tray>
              <MicroLabel>Coding agents</MicroLabel>
              <ZeropsAgentAuthCard
                onCancel={cancelAgentLogin}
                onSignIn={setAuthorizationAgentId}
                snapshot={agentAuthCard}
              />
            </section>
          )}
          {panelSections.quickActions}
        </div>
      </ScrollArea>
      {authorizationAgent === undefined ? null : (
        <ZeropsAgentAuthorizationDialog
          agent={authorizationAgent}
          onCancel={cancelAgentLogin}
          onOpenChange={(open) => {
            if (!open) setAuthorizationAgentId(null);
          }}
          onStart={startAgentLogin}
          open
          projectName={view?.project?.name ?? null}
          threadRef={threadRef}
        />
      )}
    </>
  );
}

/**
 * The client can no longer tell "still resolving which project this is" apart
 * from "never will" — that distinction was `zcp studio topology`'s
 * `available: false`, a fact only the container's own zcp binary could state.
 * `useProjectTopology` has no equivalent signal (a project ref that never
 * resolves and one still in flight look identical from here), and every mate
 * environment is a Zerops project by construction (`docs/spec-mate.md` §9.3),
 * so one honest, non-committal message covers both.
 */
export function ZeropsPanelPlaceholder() {
  return (
    <p className="text-muted-foreground text-sm" data-zerops-panel-placeholder>
      Reading the project…
    </p>
  );
}
