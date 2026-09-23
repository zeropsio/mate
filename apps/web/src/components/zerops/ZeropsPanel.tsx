import { serviceForPreview } from "../../zerops/serviceBrowserPolicy";
import { ServiceBrowserLinkContext } from "../ServiceBrowserLink";
import { ZeropsDataLinkContext } from "./dataLink";
import { useRightPanelStore } from "../../rightPanelStore";
/**
 * The Zerops right-panel surface: the service map for the project this thread
 * runs in.
 *
 * Reads both feeds and renders. Nothing here mutates the project — the agent
 * owns every change, through MCP.
 *
 * The coding agents' card is the control plane's: it is handed to the map,
 * which grows it out of the control plane's card, beside the Mate who lives
 * there. Only while the map cannot identify this environment's service — the
 * project unread, or read and found without one — does the card stand on its
 * own under a heading. While the agent-auth feed has no snapshot, the card's
 * place says so instead of showing no agents.
 */
import type { ScopedThreadRef, ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { ScrollArea } from "~/components/ui/scroll-area";
import { buildZeropsServiceMap } from "@t3tools/client-runtime/zerops/serviceMap";
import { useEnvironment } from "~/state/environments";
import { useAgentLogin } from "../../zerops/useAgentLogin";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useAgentSignOut } from "../../zerops/useAgentSignOut";
import { useProjectTopology } from "../../zerops/useProjectTopology";
import { useZeropsAgentActivity } from "../../zerops/useZeropsAgentActivity";
import { useZeropsAgentSignerRecordState } from "../../zerops/useZeropsAgentSigner";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { useZeropsMates } from "../../zerops/useZeropsMates";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";
import { ZeropsAgentAuthorizationDialog } from "./ZeropsAgentAuthorizationDialog";
import { ZeropsServiceMap } from "./ZeropsServiceMap";
import { MicroLabel } from "./primitives";

export function ZeropsPanel({
  threadRef,
  agentAuthCard,
  agentAuthUnknown = null,
  agentAuthSnapshot,
  runningToolLabel,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly agentAuthCard: ZeropsAgentAuthSnapshot | null;
  /** While the agent-auth feed has no snapshot: that it is checking, or why the read failed. */
  readonly agentAuthUnknown?: KnownMessage | null;
  readonly agentAuthSnapshot?: ZeropsAgentAuthSnapshot | null | undefined;
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
  const agentSignOut = useAgentSignOut(threadRef?.environmentId ?? null);
  // Absent on an older Mate: missing means unsupported, as for every capability.
  const signOutSupported =
    useEnvironment(threadRef?.environmentId ?? null)?.serverConfig?.environment?.capabilities
      .agentSignOut === true;
  // Whose login each agent is, so a row can say so (D6). Silent for your own.
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  // D6: recorded by the conversation view, whichever door the sign-in used.
  const signerRecord = useZeropsAgentSignerRecordState(threadRef?.environmentId);
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
  const signOutPending = new Set<ZeropsAgentId>(
    (agentAuthCard?.agents ?? [])
      .filter((agent) => agentSignOut.statusFor(agent.agentId).pending)
      .map((agent) => agent.agentId),
  );
  const signOutError = new Map<ZeropsAgentId, string>(
    (agentAuthCard?.agents ?? []).flatMap((agent) => {
      const error = agentSignOut.statusFor(agent.agentId).error;
      return error === undefined ? [] : [[agent.agentId, error] as const];
    }),
  );
  const agents =
    agentAuthCard === null ? (
      agentAuthUnknown === null ? null : (
        <ZeropsAgentAuthUnknown message={agentAuthUnknown} />
      )
    ) : (
      <ZeropsAgentAuthCard
        onCancel={cancelAgentLogin}
        onRetryRecord={signerRecord.retry}
        onSignIn={setAuthorizationAgentId}
        onSignOut={agentSignOut.signOut}
        recordFailed={signerRecord.recordFailed}
        signOutError={signOutError}
        signOutPending={signOutPending}
        signOutSupported={signOutSupported}
        snapshot={agentAuthCard}
        viewerSubject={viewerSubject}
      />
    );
  const currentServiceId = mateIdentity?.serviceId;
  const hasCurrentControlPlane =
    view?.groups.some((group) =>
      group.rows.some((row) => row.isControlPlane && row.service.serviceId === currentServiceId),
    ) ?? false;
  const body =
    view === undefined ? (
      <ZeropsPanelPlaceholder />
    ) : (
      <ServiceBrowserLinkContext
        value={
          threadRef
            ? (url) => {
                const service = serviceForPreview(url, topology.view?.services);
                if (!service) return null;
                return () => useRightPanelStore.getState().openService(threadRef, service, url);
              }
            : null
        }
      >
        <ZeropsDataLinkContext
          value={
            threadRef
              ? (hostname) => useRightPanelStore.getState().openData(threadRef, hostname)
              : null
          }
        >
          <ZeropsServiceMap
            currentServiceId={currentServiceId}
            agents={hasCurrentControlPlane ? agents : undefined}
            error={topology.error}
            liveness={topology.liveness}
            mate={mate}
            view={view}
          />
        </ZeropsDataLinkContext>
      </ServiceBrowserLinkContext>
    );

  return (
    <>
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-3xl space-y-5 p-4" data-zerops-project-panel>
          {body}
          {agents === null || hasCurrentControlPlane ? null : (
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

/** The card's place while the agent-auth feed has no snapshot: checking, or why not. */
function ZeropsAgentAuthUnknown({ message }: { readonly message: KnownMessage }) {
  return (
    <p
      className={cn(
        "text-muted-foreground text-sm",
        // A placeholder waits a beat before it says anything, so a quick
        // answer never flickers "Checking…".
        message.afterMs > 0 && "animate-zerops-appear",
      )}
      data-zerops-agent-auth-unknown
      style={message.afterMs > 0 ? { animationDelay: `${message.afterMs}ms` } : undefined}
    >
      {message.text}
    </p>
  );
}
