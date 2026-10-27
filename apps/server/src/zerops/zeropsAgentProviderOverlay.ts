/**
 * What the model picker is told about Claude Code and Codex on a Zerops
 * project: the project's own answer, not the agent driver's.
 *
 * Every client builds its picker from the provider statuses this server sends
 * (`server.getConfig`, `subscribeServerConfig`, `server.refreshProviders`). A
 * driver's status comes from its own probe, which re-runs every few minutes —
 * so an agent signed in on the project stayed "not authenticated" in the
 * picker for minutes while every other Zerops surface already showed it
 * signed in. On Zerops the platform flag decides instead
 * (`@t3tools/shared/zeropsAgentAuth`): once it is set the agent's instance is
 * `ready` at once, and an agent that cannot be picked says why and where to
 * fix it. Everything else — models, version, usage — stays the driver's.
 *
 * Codex lists its models only once signed in, so its list follows the
 * driver's re-probe (`spi/providerInstances.ts`, a few seconds); Claude's
 * catalog is there from the start.
 */
import type { ServerProvider, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import {
  classifyZeropsAgentAuth,
  zeropsAgentUnavailableReason,
} from "@t3tools/shared/zeropsAgentAuth";

import { agentDefaultInstanceId } from "../spi/providerInstances.ts";

export function overlayZeropsAgentAuth(
  providers: ReadonlyArray<ServerProvider>,
  snapshot: ZeropsAgentAuthSnapshot,
): ReadonlyArray<ServerProvider> {
  if (!snapshot.available) return providers;
  const agentByInstance = new Map(
    snapshot.agents.map((agent) => [agentDefaultInstanceId(agent.agentId), agent] as const),
  );
  return providers.map((provider) => {
    const agent = agentByInstance.get(provider.instanceId);
    // Disabled or not installed is the driver's to say; there is no login to
    // speak of.
    if (agent === undefined || !provider.enabled || !provider.installed) return provider;
    const { message: driverMessage, ...rest } = provider;
    const classified = classifyZeropsAgentAuth(agent);
    if (classified.kind === "authorized") {
      return {
        ...rest,
        status: "ready",
        auth:
          provider.auth.status === "authenticated"
            ? provider.auth
            : classified.token
              ? { status: "authenticated", label: "Token" }
              : { status: "authenticated" },
        // A driver's note about a working agent (a version advisory) stays;
        // its "not authenticated" does not.
        ...(provider.status === "ready" && driverMessage !== undefined
          ? { message: driverMessage }
          : {}),
      } satisfies ServerProvider;
    }
    return {
      ...rest,
      status: classified.kind === "registering" ? "warning" : "error",
      auth: { status: classified.kind === "registering" ? "unknown" : "unauthenticated" },
      message: zeropsAgentUnavailableReason(agent.agentId, classified.kind),
    } satisfies ServerProvider;
  });
}
