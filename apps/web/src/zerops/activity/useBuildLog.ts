/**
 * The build log tail for a live deploy card — `../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md`
 * §5. Resolves log access once per project (cached in module scope, keyed by
 * project id AND client instance — a re-login hands out a new
 * `ZeropsApiClient`, mirroring `useProjectActivity.ts`'s `pollerFor`), then
 * backfills over HTTP before appending live lines over a WebSocket while
 * `live` is on.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { BuildLogLine, BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";

import { BuildLogSession, type BuildLogSnapshot, type BuildLogStatus } from "./buildLogSession.ts";

interface LogAccessCacheEntry {
  readonly client: ZeropsApiClient;
  readonly promise: Promise<{ readonly url: string }>;
}

const logAccessByProject = new Map<string, LogAccessCacheEntry>();

function resolveLogAccess(
  projectId: string,
  client: ZeropsApiClient,
): Promise<{ readonly url: string }> {
  const cached = logAccessByProject.get(projectId);
  if (cached !== undefined && cached.client === client) {
    return cached.promise;
  }
  const promise = client.fetchProjectLogAccess(projectId);
  logAccessByProject.set(projectId, { client, promise });
  return promise;
}

export interface UseBuildLogInput {
  readonly client: ZeropsApiClient | null;
  readonly projectId: string | null;
  readonly query: BuildLogQuery | null;
  readonly live: boolean;
}

export interface UseBuildLogResult {
  readonly lines: ReadonlyArray<BuildLogLine>;
  readonly status: BuildLogStatus;
}

const IDLE_SNAPSHOT: BuildLogSnapshot = { lines: [], status: "idle" };

function keyFor(projectId: string, query: BuildLogQuery): string {
  return `${projectId}|${query.buildServiceStackId}|${query.appVersionId}|${query.fromIso ?? ""}`;
}

export function useBuildLog(input: UseBuildLogInput): UseBuildLogResult {
  const active =
    input.client !== null && input.projectId !== null && input.query !== null
      ? { client: input.client, projectId: input.projectId, query: input.query }
      : null;
  const key = active === null ? null : keyFor(active.projectId, active.query);

  // The session's lifecycle lives entirely in this effect, keyed on `key` —
  // creating it in the render body (as this used to) makes it a side effect
  // of rendering, which React.StrictMode's dev-mode double-render then runs
  // twice, and which its double-invoke of effects (setup → cleanup → setup)
  // tears down with nothing in a cleanup-only effect to recreate. Routing
  // creation through `setSession` means the *second* setup call — the one
  // StrictMode's simulated remount actually leaves standing — is what
  // `useSyncExternalStore` below ends up subscribed to.
  const [session, setSession] = useState<BuildLogSession | null>(null);

  useEffect(() => {
    if (active === null) {
      setSession(null);
      return;
    }
    const { client, projectId, query } = active;
    const created = new BuildLogSession({
      resolveAccess: () => resolveLogAccess(projectId, client),
      query,
    });
    created.start(input.live);
    setSession(created);
    return () => {
      created.dispose();
    };
    // `input.live` deliberately excluded — the effect below applies live
    // changes to whichever session is current without recreating it.
  }, [key, active?.client, active?.projectId]);

  useEffect(() => {
    session?.setLive(input.live);
  }, [session, input.live]);

  return useSyncExternalStore(
    (listener) => (session === null ? () => undefined : session.subscribe(listener)),
    () => session?.getSnapshot() ?? IDLE_SNAPSHOT,
    () => IDLE_SNAPSHOT,
  );
}
