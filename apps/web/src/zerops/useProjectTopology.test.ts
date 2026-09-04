import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "@effect/vitest";

import { watcherFor } from "./useProjectTopology.ts";

function fakeClient(): ZeropsApiClient & { readonly listProjectServicesCalls: number } {
  let calls = 0;
  return {
    get listProjectServicesCalls() {
      return calls;
    },
    fetchProject: async (projectId: string) => ({
      id: projectId,
      name: projectId,
      status: "ACTIVE",
    }),
    listProjectServices: async () => {
      calls += 1;
      return [];
    },
    fetchProjectProcesses: async () => ({ list: [] }),
    exchangeWebSocketToken: async () => ({ webSocketToken: "ws-token" }),
    subscribeProjectSearch: async () => ({ items: [] }),
    fetchOrganizations: async () => [],
    listAccessibleClientProjects: async () => [],
  } as unknown as ZeropsApiClient & { readonly listProjectServicesCalls: number };
}

const ENV_A = "env-watcher-a" as EnvironmentId;
const ENV_B = "env-watcher-b" as EnvironmentId;

describe("watcherFor — one watcher per (environment, client) pair", () => {
  it("two subscribers share one watcher and one reader", () => {
    const client = fakeClient();
    const first = watcherFor(ENV_A, client, null);
    const second = watcherFor(ENV_A, client, null);

    expect(second).toBe(first);
  });

  it("keeps watchers for different environments independent", () => {
    const client = fakeClient();
    const a = watcherFor(ENV_B, client, null);
    const b = watcherFor("env-watcher-c" as EnvironmentId, client, null);

    expect(a).not.toBe(b);
  });

  /**
   * A re-login (or a `ZeropsSessionProvider` remount) hands out a NEW
   * `ZeropsApiClient` for the same environment id. Keying only on
   * `environmentId` would keep reading with the OLD (possibly now-signed-out)
   * client's session forever — mirrors `activity/useProjectActivity.ts`'s
   * `pollerFor`.
   */
  it("builds a fresh watcher when the client for an environment changes", () => {
    const a = fakeClient();
    const b = fakeClient();
    const first = watcherFor("env-watcher-relogin" as EnvironmentId, a, null);
    const second = watcherFor("env-watcher-relogin" as EnvironmentId, b, null);

    expect(second).not.toBe(first);
  });

  it("disposing the stale watcher when its client is swapped out does not throw", async () => {
    vi.useFakeTimers();
    try {
      const a = fakeClient();
      const b = fakeClient();
      const environmentId = "env-watcher-dispose" as EnvironmentId;

      const stale = watcherFor(environmentId, a, null);
      const unsubscribe = stale.subscribe(() => undefined);
      await vi.advanceTimersByTimeAsync(0);

      // Swapping the client for this environment disposes `stale`; a caller
      // that has not yet unsubscribed from it must not crash on the next tick.
      expect(() => watcherFor(environmentId, b, null)).not.toThrow();
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
