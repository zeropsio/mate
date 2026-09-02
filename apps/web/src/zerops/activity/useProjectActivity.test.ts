import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { pollerFor } from "./useProjectActivity.ts";

function fakeClient(): { readonly client: ZeropsApiClient; readonly calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    client: {
      fetchProjectProcesses: async () => {
        calls.push(calls.length);
        return { list: [] };
      },
    } as unknown as ZeropsApiClient,
  };
}

describe("pollerFor — one poller per (project, client) pair", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the same poller for the same project and client", () => {
    const a = fakeClient();
    expect(pollerFor("proj-shared", a.client)).toBe(pollerFor("proj-shared", a.client));
  });

  /**
   * A re-login (or a `ZeropsSessionProvider` remount) hands out a NEW
   * `ZeropsApiClient` for the same project id. Keying only on `projectId`
   * would keep polling with the OLD client's (possibly now-signed-out)
   * session forever.
   */
  it("builds a fresh poller when the client for a project changes", () => {
    const a = fakeClient();
    const b = fakeClient();
    const first = pollerFor("proj-relogin", a.client);
    const second = pollerFor("proj-relogin", b.client);
    expect(second).not.toBe(first);
  });

  it("disposes the stale poller — it stops polling once its client is swapped out", async () => {
    const a = fakeClient();
    const b = fakeClient();

    const stale = pollerFor("proj-dispose", a.client);
    const unsubscribe = stale.subscribe(() => undefined);
    await vi.waitFor(() => expect(a.calls).toHaveLength(1));

    // Swapping the client for this project disposes `stale` — its timer
    // stops even though nothing ever called `unsubscribe`.
    pollerFor("proj-dispose", b.client);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(a.calls).toHaveLength(1);

    unsubscribe();
  });
});
