/**
 * What this viewer may run or change on an environment's crew (D6), read as
 * `ChatView` reads its own agent: each login resolved as admission resolves
 * it (`resolveSpentLogin`), its signer as the server recorded it
 * (`resolveAgentAuthorizer`) — then decided by `crewAccess`, the answer the
 * server's door reaches.
 *
 * While the agent-auth feed is being read, nothing is closed and `reading`
 * holds the presses; a feed that failed, or a Mate outside Zerops, gates
 * nothing — the server's door stays the authority, as for the composer.
 * Without an environment it reads nothing that moves, so a row that asks
 * nothing (the left menu's) never draws again for it.
 */
import {
  crewAccess,
  crewLoginLock,
  type CrewAccess,
} from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { zeropsAgentAuthView } from "@t3tools/client-runtime/zerops/agentLogin";
import { resolveSpentLogin } from "@t3tools/client-runtime/zerops/logins";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { CrewSnapshot, EnvironmentId, ServerConfig } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { environmentProjects } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { resolveAgentAuthorizer } from "@t3tools/client-runtime/zerops/agentOwnership";
import { useZeropsAgentAuth } from "../useZeropsFeeds";
import { useZeropsSessionOptional } from "../ZeropsSessionProvider";

/** The login a crewmate runs on when its crew home names none, as the engine reads it. */
export const DEFAULT_CREW_LOGIN = "claudeAgent";

const NO_PROJECTS = Atom.make<ReadonlyArray<EnvironmentProject>>([]).pipe(
  Atom.withLabel("crew-access:no-projects"),
);
const NO_CONFIGS = Atom.make<ReadonlyMap<EnvironmentId, ServerConfig>>(new Map()).pipe(
  Atom.withLabel("crew-access:no-configs"),
);

export function useCrewAccess(
  environmentId: EnvironmentId | null,
  snapshot: CrewSnapshot | null,
): CrewAccess {
  const agentAuth = useZeropsAgentAuth(environmentId);
  const configs = useAtomValue(environmentId === null ? NO_CONFIGS : environmentServerConfigsAtom);
  const config = environmentId === null ? undefined : configs.get(environmentId);
  const projects = useAtomValue(
    environmentId === null ? NO_PROJECTS : environmentProjects.projectsAtom,
  );
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  // The Mate's project: the one whose tree the server works in, as the engine finds it.
  const defaultLogin =
    projects.find(
      (project) => project.environmentId === environmentId && project.workspaceRoot === config?.cwd,
    )?.defaultModelSelection?.instanceId ?? DEFAULT_CREW_LOGIN;
  const providers = config?.providers;
  return useMemo(() => {
    const feed = zeropsAgentAuthView(agentAuth).snapshot;
    return crewAccess({
      snapshot,
      defaultLogin,
      reading:
        agentAuth === undefined || agentAuth.state === "unread" || agentAuth.state === "reading",
      lockOf: (login) => {
        const spent = resolveSpentLogin(login, feed, providers ?? []);
        return crewLoginLock(
          login,
          spent === undefined
            ? undefined
            : {
                agent: spent.agent,
                authorizedBy: resolveAgentAuthorizer(spent.agent, viewerSubject),
              },
          viewerSubject,
        );
      },
    });
  }, [agentAuth, defaultLogin, providers, snapshot, viewerSubject]);
}
