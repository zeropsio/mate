import { ZeropsApiError } from "@t3tools/client-runtime/zerops";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ProjectActivityPoller, type ProjectActivityApiClient } from "./projectActivityPoller.ts";

function fakeClient(
  impl: (call: number) => Promise<unknown>,
): ProjectActivityApiClient & { readonly calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    fetchProjectProcesses: async () => {
      calls.push(calls.length);
      return impl(calls.length - 1);
    },
  };
}

const OK_DOCUMENT = { list: [] };

describe("ProjectActivityPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls immediately on the first subscriber, then every 2.5s", async () => {
    const client = fakeClient(async () => OK_DOCUMENT);
    const poller = new ProjectActivityPoller({ client, projectId: "proj-1" });

    const unsubscribe = poller.subscribe(() => undefined);
    await vi.waitFor(() => expect(client.calls).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(2_500);
    expect(client.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(client.calls).toHaveLength(3);

    unsubscribe();
  });

  it("stops polling once the last subscriber leaves", async () => {
    const client = fakeClient(async () => OK_DOCUMENT);
    const poller = new ProjectActivityPoller({ client, projectId: "proj-1" });

    const unsubscribe = poller.subscribe(() => undefined);
    await vi.waitFor(() => expect(client.calls).toHaveLength(1));
    unsubscribe();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.calls).toHaveLength(1);
  });

  it("shares one request per tick across every subscriber", async () => {
    const client = fakeClient(async () => OK_DOCUMENT);
    const poller = new ProjectActivityPoller({ client, projectId: "proj-1" });

    const a = poller.subscribe(() => undefined);
    const b = poller.subscribe(() => undefined);
    await vi.waitFor(() => expect(client.calls).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(2_500);
    expect(client.calls).toHaveLength(2);

    a();
    b();
  });

  it("publishes the decoded processes and notifies subscribers", async () => {
    const client = fakeClient(async () => ({
      list: [
        {
          id: "p1",
          projectId: "proj-1",
          serviceStackId: "svc-1",
          status: "RUNNING",
          actionName: "stack.deploy",
          created: "2026-09-02T10:00:00.000Z",
        },
      ],
    }));
    const poller = new ProjectActivityPoller({ client, projectId: "proj-1", now: () => 12_345 });
    const listener = vi.fn();

    const unsubscribe = poller.subscribe(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    const snapshot = poller.getSnapshot();
    expect(snapshot.atMs).toBe(12_345);
    expect(snapshot.processes).toHaveLength(1);
    expect(snapshot.processes?.[0]?.id).toBe("p1");

    unsubscribe();
  });

  it("backs off exponentially on a network error, capped at 15s", async () => {
    const client = fakeClient(async () => {
      throw new Error("network down");
    });
    const poller = new ProjectActivityPoller({ client, projectId: "proj-1" });

    const unsubscribe = poller.subscribe(() => undefined);
    await vi.waitFor(() => expect(client.calls).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(2_500);
    expect(client.calls).toHaveLength(2); // 2.5s
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.calls).toHaveLength(3); // 5s
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.calls).toHaveLength(4); // 10s
    await vi.advanceTimersByTimeAsync(15_000);
    expect(client.calls).toHaveLength(5); // 15s ceiling

    unsubscribe();
  });

  it("resets the backoff to the base interval after a successful read", async () => {
    let fail = true;
    const client = fakeClient(async () => {
      if (fail) {
        fail = false;
        throw new Error("network down");
      }
      return OK_DOCUMENT;
    });
    const poller = new ProjectActivityPoller({ client, projectId: "proj-1" });

    const unsubscribe = poller.subscribe(() => undefined);
    await vi.waitFor(() => expect(client.calls).toHaveLength(1)); // fails

    await vi.advanceTimersByTimeAsync(2_500);
    await vi.waitFor(() => expect(client.calls).toHaveLength(2)); // succeeds, backoff resets

    await vi.advanceTimersByTimeAsync(2_500);
    expect(client.calls).toHaveLength(3); // back to base interval, not 5s

    unsubscribe();
  });

  it("marks the project unavailable on 401 and stops polling (no re-login trigger)", async () => {
    const client = fakeClient(async () => {
      throw new ZeropsApiError("expired", "expired-session", 401);
    });
    const poller = new ProjectActivityPoller({ client, projectId: "proj-1" });

    const unsubscribe = poller.subscribe(() => undefined);
    await vi.waitFor(() => expect(poller.getSnapshot().unavailableReason).toBe("expired-session"));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.calls).toHaveLength(1);

    unsubscribe();
  });

  it("marks the project unavailable on 403 and on 404", async () => {
    const forbidden = fakeClient(async () => {
      throw new ZeropsApiError("forbidden", "forbidden", 403);
    });
    const forbiddenPoller = new ProjectActivityPoller({ client: forbidden, projectId: "proj-1" });
    const stopForbidden = forbiddenPoller.subscribe(() => undefined);
    await vi.waitFor(() =>
      expect(forbiddenPoller.getSnapshot().unavailableReason).toBe("forbidden"),
    );
    stopForbidden();

    const notFound = fakeClient(async () => {
      throw new ZeropsApiError("gone", "not-found", 404);
    });
    const notFoundPoller = new ProjectActivityPoller({ client: notFound, projectId: "proj-2" });
    const stopNotFound = notFoundPoller.subscribe(() => undefined);
    await vi.waitFor(() =>
      expect(notFoundPoller.getSnapshot().unavailableReason).toBe("not-found"),
    );
    stopNotFound();
  });

  it("pauses polling while the tab is hidden, and resumes once visible", async () => {
    let hidden = false;
    const client = fakeClient(async () => OK_DOCUMENT);
    const poller = new ProjectActivityPoller({
      client,
      projectId: "proj-1",
      isHidden: () => hidden,
    });

    const unsubscribe = poller.subscribe(() => undefined);
    await vi.waitFor(() => expect(client.calls).toHaveLength(1));

    hidden = true;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(client.calls).toHaveLength(1); // skipped while hidden

    hidden = false;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(client.calls).toHaveLength(2); // resumes

    unsubscribe();
  });
});
