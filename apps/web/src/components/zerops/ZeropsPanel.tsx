/**
 * The Zerops right-panel surface: the service map for the project this thread
 * runs in.
 *
 * Reads both feeds and renders. Nothing here mutates the project — the agent
 * owns every change, through MCP.
 *
 * The coding agents' card is the control plane's: it is handed to the map,
 * which grows it out of the control plane's card, beside the Mate who lives
 * there. Only while the map has no control plane to hang it from — the
 * project unread, or read and found without one — does the card stand on its
 * own under a heading.
 */
import type { ScopedThreadRef, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { useState } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { buildZeropsServiceMap } from "@t3tools/client-runtime/zerops/serviceMap";
import { useAgentLogin } from "../../zerops/useAgentLogin";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useProjectTopology } from "../../zerops/useProjectTopology";
import { useZeropsAgentActivity } from "../../zerops/useZeropsAgentActivity";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { useZeropsMates } from "../../zerops/useZeropsMates";
import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";
import { ZeropsAgentAuthorizationDialog } from "./ZeropsAgentAuthorizationDialog";
import { ZeropsServiceMap } from "./ZeropsServiceMap";
import { MicroLabel } from "./primitives";

export function ZeropsPanel({
  threadRef,
  agentAuthCard,
  agentAuthSnapshot,
  runningToolLabel,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly agentAuthCard: ZeropsAgentAuthSnapshot | null;
  readonly agentAuthSnapshot?: ZeropsAgentAuthSnapshot | undefined;
  /** The caller's own reading of `ZeropsThreadModel.running` (`ChatView`) — the map never derives this itself. */
  readonly runningToolLabel?: string | undefined;
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
  const view = buildZeropsServiceMap(topology.view, lifecycle, runningToolLabel);
  const authorizationSnapshot = agentAuthSnapshot ?? agentAuthCard;
  const authorizationAgent = authorizationSnapshot?.agents.find(
    (agent) => agent.agentId === authorizationAgentId,
  );
  const mates = useZeropsMates();
  const activity = useZeropsAgentActivity();
  const environmentId = threadRef?.environmentId;
  const mateIdentity = environmentId === undefined ? undefined : mates.get(environmentId);
  const mate =
    mateIdentity === undefined || environmentId === undefined
      ? undefined
      : {
          name: mateIdentity.name,
          tint: mateIdentity.tint,
          // Asleep until the socket is up, as the lists draw it: a Mate is
          // known from its project's tags and its container's origin before
          // there is anything to resolve — see `ChatHeader`.
          face: mateIdentity.connected
            ? (activity.get(environmentId)?.face ?? "idle")
            : ("sleep" as const),
        };
  const agents =
    agentAuthCard === null ? null : (
      <ZeropsAgentAuthCard
        onCancel={cancelAgentLogin}
        onSignIn={setAuthorizationAgentId}
        snapshot={agentAuthCard}
      />
    );
  const hasControlPlane =
    view !== undefined && view.groups.some((group) => group.group === "infrastructure");
  const body =
    view === undefined ? (
      <ZeropsPanelPlaceholder />
    ) : (
      <ZeropsServiceMap
        agents={hasControlPlane ? agents : undefined}
        error={topology.error}
        liveness={topology.liveness}
        mate={mate}
        view={view}
      />
    );

  return (
    <>
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-3xl space-y-5 p-4" data-zerops-project-panel>
          {body}
          {agents === null || hasControlPlane ? null : (
            <section className="space-y-2" data-zerops-agent-auth-tray>
              <MicroLabel>Coding agents</MicroLabel>
              {agents}
            </section>
          )}
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
