/**
 * The Zerops right-panel surface: the service map for the project this thread
 * runs in.
 *
 * Reads both feeds and renders. Nothing here mutates the project — the agent
 * owns every change, through MCP.
 */
import type { ScopedThreadRef, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";

import { ScrollArea } from "~/components/ui/scroll-area";
import { zeropsQuickActions } from "@t3tools/client-runtime/zerops/quickActions";
import { buildZeropsServiceMap } from "@t3tools/client-runtime/zerops/serviceMap";
import { useAgentLogin } from "../../zerops/useAgentLogin";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useZeropsLifecycle, useZeropsTopology } from "../../zerops/useZeropsFeeds";
import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";
import { ZeropsQuickActions } from "./ZeropsQuickActions";
import { ZeropsServiceMap } from "./ZeropsServiceMap";
import { MicroLabel } from "./primitives";

export function ZeropsPanel({
  threadRef,
  agentAuthCard,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly agentAuthCard: ZeropsAgentAuthSnapshot | null;
}) {
  const topology = useZeropsTopology(threadRef?.environmentId ?? null);
  const lifecycle = useZeropsLifecycle(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  const signInToAgent = useAgentLogin(threadRef);
  const cancelAgentLogin = useAgentLoginCancel(threadRef);
  const view = buildZeropsServiceMap(topology, lifecycle);
  const panelSections =
    view === undefined
      ? {
          body: <ZeropsPanelPlaceholder waiting={topology === undefined} />,
          quickActions: null,
        }
      : {
          body: <ZeropsServiceMap view={view} />,
          quickActions: <ZeropsQuickActions actions={zeropsQuickActions(topology)} />,
        };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-4" data-zerops-project-panel>
        {panelSections.body}
        {agentAuthCard === null ? null : (
          <section className="space-y-2" data-zerops-agent-auth-tray>
            <MicroLabel>Coding agents</MicroLabel>
            <ZeropsAgentAuthCard
              onCancel={cancelAgentLogin}
              onSignIn={signInToAgent}
              snapshot={agentAuthCard}
            />
          </section>
        )}
        {panelSections.quickActions}
      </div>
    </ScrollArea>
  );
}

/**
 * Two different reasons the map is absent, and they must not share a sentence.
 *
 * The panel's tab is persisted per thread, so a reload can render this surface
 * before the first snapshot has arrived. Saying "not a Zerops project" then
 * would be a confident lie about the very project the user is looking at, told
 * for the second or so before the feed answers.
 */
export function ZeropsPanelPlaceholder({ waiting }: { readonly waiting: boolean }) {
  return (
    <p className="text-muted-foreground text-sm" data-zerops-panel-placeholder>
      {waiting ? "Reading the project…" : "This environment is not a Zerops project."}
    </p>
  );
}
