import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BuildLogSession } from "./buildLogSession.ts";

const QUERY = { buildServiceStackId: "build-svc-1", appVersionId: "av-1" };

function fakeFetch(handler: () => { ok: boolean; json: () => Promise<unknown> }) {
  const calls: string[] = [];
  return {
    calls,
    fetchImpl: async (url: string) => {
      calls.push(url);
      return handler();
    },
  };
}

function okResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  #onMessage: ((event: { data: unknown }) => void) | undefined;
  #onClose: (() => void) | undefined;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: () => void): void;
  addEventListener(
    type: "message" | "error" | "close",
    listener: ((event: { data: unknown }) => void) | (() => void),
  ): void {
    if (type === "message") {
      this.#onMessage = listener as (event: { data: unknown }) => void;
    } else if (type === "close") {
      this.#onClose = listener as () => void;
    }
  }

  emit(items: ReadonlyArray<unknown>): void {
    this.#onMessage?.({ data: JSON.stringify({ items }) });
  }

  close(): void {
    this.closed = true;
    this.#onClose?.();
  }
}

describe("BuildLogSession — the engine behind useBuildLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle, then loading, then backfills over HTTP", async () => {
    const fetchStub = fakeFetch(() =>
      okResponse({
        items: [{ id: "l1", timestamp: "2026-09-02T10:00:00.000Z", content: "hi", severity: 6 }],
      }),
    );
    const session = new BuildLogSession({
      resolveAccess: async () => ({ url: "https://log.example.com/api/rest/log?sig=1" }),
      query: QUERY,
      fetchImpl: fetchStub.fetchImpl,
    });

    expect(session.getSnapshot()).toEqual({ lines: [], status: "idle" });
    session.start(false);
    expect(session.getSnapshot().status).toBe("loading");

    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("ended"));
    expect(session.getSnapshot().lines).toEqual([
      { id: "l1", at: "2026-09-02T10:00:00.000Z", text: "hi", severity: 6 },
    ]);
  });

  it("opens a WebSocket and goes live when started with live: true", async () => {
    const fetchStub = fakeFetch(() => okResponse({ items: [] }));
    const session = new BuildLogSession({
      resolveAccess: async () => ({ url: "https://log.example.com/api/rest/log?sig=1" }),
      query: QUERY,
      fetchImpl: fetchStub.fetchImpl,
      WebSocketCtor: FakeWebSocket,
    });

    session.start(true);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("live"));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toContain("/stream");
  });

  it("buffers incoming lines and publishes at most every 100ms", async () => {
    const fetchStub = fakeFetch(() => okResponse({ items: [] }));
    const session = new BuildLogSession({
      resolveAccess: async () => ({ url: "https://log.example.com/api/rest/log?sig=1" }),
      query: QUERY,
      fetchImpl: fetchStub.fetchImpl,
      WebSocketCtor: FakeWebSocket,
    });

    session.start(true);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("live"));
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();

    socket?.emit([{ id: "l1", timestamp: "2026-09-02T10:00:00.000Z", content: "a", severity: 6 }]);
    // Not published synchronously — buffered until the flush timer fires.
    expect(session.getSnapshot().lines).toEqual([]);

    socket?.emit([{ id: "l2", timestamp: "2026-09-02T10:00:01.000Z", content: "b", severity: 6 }]);
    await vi.advanceTimersByTimeAsync(100);

    expect(session.getSnapshot().lines.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("closes the socket when live turns false", async () => {
    const fetchStub = fakeFetch(() => okResponse({ items: [] }));
    const session = new BuildLogSession({
      resolveAccess: async () => ({ url: "https://log.example.com/api/rest/log?sig=1" }),
      query: QUERY,
      fetchImpl: fetchStub.fetchImpl,
      WebSocketCtor: FakeWebSocket,
    });

    session.start(true);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("live"));
    const socket = FakeWebSocket.instances[0];

    session.setLive(false);
    expect(socket?.closed).toBe(true);
    expect(session.getSnapshot().status).toBe("ended");
  });

  it("closes the socket on dispose", async () => {
    const fetchStub = fakeFetch(() => okResponse({ items: [] }));
    const session = new BuildLogSession({
      resolveAccess: async () => ({ url: "https://log.example.com/api/rest/log?sig=1" }),
      query: QUERY,
      fetchImpl: fetchStub.fetchImpl,
      WebSocketCtor: FakeWebSocket,
    });

    session.start(true);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("live"));
    const socket = FakeWebSocket.instances[0];

    session.dispose();
    expect(socket?.closed).toBe(true);
  });

  it("goes to error status when the backfill fetch rejects", async () => {
    const session = new BuildLogSession({
      resolveAccess: async () => ({ url: "https://log.example.com/api/rest/log?sig=1" }),
      query: QUERY,
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    session.start(false);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("error"));
  });

  it("goes to error status on a non-ok backfill response", async () => {
    const session = new BuildLogSession({
      resolveAccess: async () => ({ url: "https://log.example.com/api/rest/log?sig=1" }),
      query: QUERY,
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });

    session.start(false);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("error"));
  });
});
