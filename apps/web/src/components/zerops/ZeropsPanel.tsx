import { useAtomCommand } from "~/state/use-atom-command";
import { zeropsCommands } from "~/state/zeropsCommands";
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
 *
 * The card lists every login of the project (crew mode's *Runs on*): the
 * crew feed says which crewmates run on each, and where the server keeps
 * logins, *Add another login* adds one and signs an account in through the
 * same dialog an agent's own login uses. The crew itself is not here: its
 * setup, its section and its board are the Crew tab's (`CrewPanel`).
 */
import type { ScopedThreadRef, ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import { mateLoginRows } from "@t3tools/client-runtime/zerops/logins";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { buildZeropsServiceMap } from "@t3tools/client-runtime/zerops/serviceMap";
import { crewPortOwners } from "@t3tools/client-runtime/zerops/projections/crew";
import { useEnvironment } from "~/state/environments";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useAgentSignOut } from "../../zerops/useAgentSignOut";
import { useCrew } from "../../zerops/crew/useCrew";
import { useMateLogins } from "../../zerops/useMateLogins";
import { useProjectTopology } from "../../zerops/useProjectTopology";
import { activityOfNow, mateFaceFor } from "../../zerops/agentActivity";
import { useMatesActivity } from "../../zerops/useZeropsAgentActivity";
import { useZeropsEnvironmentProject } from "../../zerops/useZeropsEnvironmentProject";
import { useHqPersonNames } from "../../zerops/useZeropsMateOwners";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { mateIdentityPose, zeropsMateAt } from "../../zerops/mateIdentities";
import { useNowMs } from "../../zerops/useNowMs";
import { useZeropsMateDirectory } from "../../zerops/useZeropsMates";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";
import { ZeropsAgentSignInDialog } from "./ZeropsAgentSignIn";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { ZeropsServiceMap } from "./ZeropsServiceMap";
import { MicroLabel } from "./primitives";

export function ZeropsPanel({
  threadRef,
  visible = true,
  agentAuthCard,
  agentAuthUnknown = null,
  agentAuthSnapshot,
  agentSignInDemanded = false,
  runningToolLabel,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly visible?: boolean;
  readonly agentAuthCard: ZeropsAgentAuthSnapshot | null;
  /** While the agent-auth feed has no snapshot: that it is checking, or why the read failed. */
  readonly agentAuthUnknown?: KnownMessage | null;
  readonly agentAuthSnapshot?: ZeropsAgentAuthSnapshot | null | undefined;
  /** Whether the conversation's own agent needs a sign-in (`agentAdmission(...).attention`). */
  readonly agentSignInDemanded?: boolean | undefined;
  /** The caller's own reading of `ZeropsThreadModel.running` (`ChatView`) — the map never derives this itself. */
  readonly runningToolLabel?: string | undefined;
}) {
  const topology = useProjectTopology(threadRef?.environmentId ?? null, { metrics: visible });
  const lifecycle = useZeropsLifecycle(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  const [authorizationAgentId, setAuthorizationAgentId] = useState<
    ZeropsAgentAuthSnapshot["agents"][number]["agentId"] | null
  >(null);
  const cancelAgentLogin = useAgentLoginCancel(threadRef);
  const checkAuth = useAtomCommand(zeropsCommands.agentAuthCheck, "zerops agent auth check");
  const agentSignOut = useAgentSignOut(threadRef?.environmentId ?? null);
  // Absent on an older Mate: missing means unsupported, as for every capability.
  const signOutSupported =
    useEnvironment(threadRef?.environmentId ?? null)?.serverConfig?.environment?.capabilities
      .agentSignOut === true;
  // Whose login each agent is, so a row can say so (D6). Silent for your own.
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  const crew = useCrew(threadRef?.environmentId ?? null);
  // A dev service's crew ports name their routes by whose app answers there.
  const view = buildZeropsServiceMap(
    topology.view,
    lifecycle,
    runningToolLabel,
    crew.snapshot === null ? undefined : crewPortOwners(crew.snapshot),
  );
  const authorizationSnapshot = agentAuthSnapshot ?? agentAuthCard;
  const authorizationAgent = authorizationSnapshot?.agents.find(
    (agent) => agent.agentId === authorizationAgentId,
  );
  // The logins beyond each agent's own, and the one being signed in.
  const logins = mateLoginRows(authorizationSnapshot, crew.snapshot);
  const mateLogins = useMateLogins(threadRef?.environmentId ?? null);
  const loginsSupported =
    useEnvironment(threadRef?.environmentId ?? null)?.serverConfig?.environment?.capabilities
      .mateLogins === true;
  // Another member's login says whose it is — read from the Mate's own org,
  // and only when some login names somebody else.
  const mateProject = useZeropsEnvironmentProject(threadRef?.environmentId ?? null);
  const loginSignerName = useHqPersonNames(mateProject?.orgId);
  const [authorizationLoginId, setAuthorizationLoginId] = useState<string | null>(null);
  const authorizationLogin = logins.find(
    (login) => !login.default && login.id === authorizationLoginId,
  );
  const mates = useZeropsMateDirectory();
  const activity = useMatesActivity();
  const nowMs = useNowMs();
  const environmentId = threadRef?.environmentId;
  // An environment the Mate list has not reached shows the panel without a
  // Mate, and no service is marked as its container until one is known.
  const whoLivesHere = environmentId === undefined ? null : zeropsMateAt(mates, environmentId);
  const mateIdentity = whoLivesHere?.kind === "mate" ? whoLivesHere.mate : undefined;
  // What it does now, where its attention is a word of now.
  const live =
    environmentId === undefined ? undefined : activityOfNow(activity.ofEnvironment(environmentId));
  const mate =
    mateIdentity === undefined || environmentId === undefined
      ? undefined
      : {
          name: mateIdentity.name,
          tint: mateIdentity.tint,
          shape: mateIdentity.shape,
          // Asleep until its socket is up or HQ's live word says what it does, as the
          // lists draw it: a Mate is known from its project's tags and its container's
          // origin before there is anything to resolve — see `ChatHeader`.
          face: mateFaceFor(
            mateIdentity.connected || live !== undefined,
            live,
            mateIdentityPose(mateIdentity, nowMs),
          ),
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
        signInDemanded={agentSignInDemanded}
        onRecheck={(agentId, loginId) => {
          if (threadRef === null) return;
          void checkAuth({
            environmentId: threadRef.environmentId,
            input: { agentId, ...(loginId === undefined ? {} : { loginId }) },
          });
        }}
        onCancel={cancelAgentLogin}
        onSignIn={setAuthorizationAgentId}
        onSignOut={agentSignOut.signOut}
        signOutError={signOutError}
        signOutPending={signOutPending}
        signOutSupported={signOutSupported}
        snapshot={agentAuthCard}
        viewerSubject={viewerSubject}
        logins={logins}
        nameOf={loginSignerName}
        onAddLogin={
          loginsSupported
            ? (input) => {
                void mateLogins.add(input).then((id) => {
                  // An account is signed in right after it is added.
                  if (id !== undefined && input.kind === "subscription") {
                    setAuthorizationLoginId(id);
                  }
                });
              }
            : undefined
        }
        addLoginError={mateLogins.addError}
        onSignInLogin={(login) => {
          setAuthorizationLoginId(login.id);
        }}
        onCancelLogin={(login) => {
          cancelAgentLogin(login.agent, login.id);
        }}
        onSignOutLogin={mateLogins.signOut}
        onRemoveLogin={mateLogins.remove}
        loginStatus={mateLogins.statusFor}
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
            mateUpdate={
              // The Mate's version and its one verb live with its body: the
              // same control the project page's menus read, so an update
              // started here is the update started there.
              mate === undefined || environmentId === undefined ? undefined : (
                <ZeropsMateUpdateControl environmentId={environmentId} mateName={mate.name}>
                  {({ line }) => line}
                </ZeropsMateUpdateControl>
              )
            }
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
          {topology.error === undefined ? null : (
            <div>
              <Button variant="outline" size="sm" onClick={topology.again}>
                Try again
              </Button>
            </div>
          )}
          {agents === null || hasCurrentControlPlane ? null : (
            <section className="space-y-2" data-zerops-agent-auth-tray>
              <MicroLabel>Coding agents</MicroLabel>
              {agents}
            </section>
          )}
        </div>
      </ScrollArea>
      {authorizationAgent === undefined ? null : (
        <ZeropsAgentSignInDialog
          agentId={authorizationAgent.agentId}
          environmentId={threadRef?.environmentId ?? null}
          mateName={mateIdentity?.name ?? null}
          onClose={() => setAuthorizationAgentId(null)}
          threadRef={threadRef}
        />
      )}
      {authorizationLogin === undefined ? null : (
        <ZeropsAgentSignInDialog
          agentId={authorizationLogin.agent}
          environmentId={threadRef?.environmentId ?? null}
          login={{
            id: authorizationLogin.id,
            agentId: authorizationLogin.agent,
            title: authorizationLogin.title,
            login: authorizationLogin.login,
          }}
          mateName={mateIdentity?.name ?? null}
          onClose={() => setAuthorizationLoginId(null)}
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
