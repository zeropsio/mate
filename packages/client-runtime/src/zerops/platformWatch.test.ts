// @effect-diagnostics globalTimers:off -- the fake `setTimeout`/`clearTimeout` pair below is the plain
// timer implementation `openPlatformWatch`'s real (apps/web) caller injects; `vi.useFakeTimers()` fakes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";

import {
  openPlatformWatch,
  type OpenPlatformWatchOptions,
  type PlatformWatchClient,
  type PlatformWatchEvent,
  type PlatformWatchSocket,
} from "./platformWatch.ts";

/** `setTimeout`/`clearTimeout` still run through vitest's faked clock. */
const testTimers: OpenPlatformWatchOptions["timers"] = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let receiverIdCounter = 0;

/** Test default: a fresh, deterministic receiver id per call, unless the test overrides it. */
function watchHelper(
  options: Omit<OpenPlatformWatchOptions, "timers" | "makeReceiverId"> &
    Partial<Pick<OpenPlatformWatchOptions, "timers" | "makeReceiverId">>,
) {
  return openPlatformWatch({
    timers: testTimers,
    makeReceiverId: () => {
      receiverIdCounter += 1;
      return `receiver-${receiverIdCounter}`;
    },
    ...options,
  });
}

class FakeSocket implements PlatformWatchSocket {
  readonly url: string;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    // The SUT nulls its handlers before calling `close()` (mirroring a real
    // `WebSocket`, whose own close never re-enters a handler it just cleared),
    // so this deliberately does not fire `onclose`.
  }

  open(): void {
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** The platform closing the connection on us — distinct from our own `close()`. */
  simulateServerClose(): void {
    this.onclose?.();
  }
}

interface FakeSearchCall {
  readonly entity: "service-stack" | "process";
  readonly options: {
    readonly orgId: string;
    readonly projectId: string;
    readonly receiverId: string;
    readonly mode: "list" | "update";
  };
}

function fakeClient(): PlatformWatchClient & {
  readonly logins: number;
  readonly searches: ReadonlyArray<FakeSearchCall>;
} {
  let logins = 0;
  const searches: FakeSearchCall[] = [];
  return {
    get logins() {
      return logins;
    },
    get searches() {
      return searches;
    },
    async exchangeWebSocketToken() {
      logins += 1;
      return { webSocketToken: `ws-token-${logins}` };
    },
    async subscribeProjectSearch(entity, options) {
      searches.push({ entity, options });
      return { items: [] };
    },
  };
}

/**
 * Drives one socket through open → greeting. Awaits a microtask flush
 * between the two: `openPlatformWatch`'s internal `connect()` only attaches
 * the greeting listener once its "wait for open" promise resolves, one tick
 * after `open()` returns.
 */
async function connectSocket(sockets: ReadonlyArray<FakeSocket>, index: number): Promise<void> {
  sockets[index]!.open();
  await vi.advanceTimersByTimeAsync(0);
  sockets[index]!.receive({ type: "SocketSuccess" });
}

describe("openPlatformWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs in, connects, subscribes list and update for ServiceStack and Process in order", async () => {
    const client = fakeClient();
    const sockets: FakeSocket[] = [];
    const watch = watchHelper({
      client,
      orgId: "org-1",
      projectId: "proj-1",
      makeSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      makeReceiverId: () => "receiver-1",
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    await connectSocket(sockets, 0);

    await vi.advanceTimersByTimeAsync(0);
    expect(client.searches).toHaveLength(4);

    expect(client.searches.map((call) => `${call.entity}:${call.options.mode}`)).toEqual([
      "service-stack:list",
      "process:list",
      "service-stack:update",
      "process:update",
    ]);
    expect(
      client.searches.every(
        (call) =>
          call.options.orgId === "org-1" &&
          call.options.projectId === "proj-1" &&
          call.options.receiverId === "receiver-1",
      ),
    ).toBe(true);

    watch.close();
  });

  it("emits changed for every search push and never exposes the payload", async () => {
    const client = fakeClient();
    const sockets: FakeSocket[] = [];
    const events: PlatformWatchEvent[] = [];
    const watch = watchHelper({
      client,
      orgId: "org-1",
      projectId: "proj-1",
      makeSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    watch.events.subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    await connectSocket(sockets, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ type: "connected" });

    sockets[0]!.receive({
      type: "search",
      subscriptionName: "Process__list-subscription",
      data: { add: ["proc-1"], delete: [] },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(events.some((event) => event.type === "changed")).toBe(true);
    const changed = events.find((event) => event.type === "changed");

    expect(changed).toEqual({ type: "changed", subscriptionName: "Process__list-subscription" });
    expect(Object.keys(changed!)).toEqual(["type", "subscriptionName"]);

    watch.close();
  });

  it("ignores a push with no subscriptionName rather than emitting a bare changed", async () => {
    const client = fakeClient();
    const sockets: FakeSocket[] = [];
    const events: PlatformWatchEvent[] = [];
    const watch = watchHelper({
      client,
      orgId: "org-1",
      projectId: "proj-1",
      makeSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    watch.events.subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    await connectSocket(sockets, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ type: "connected" });

    sockets[0]!.receive({ type: "pong" });
    await vi.advanceTimersByTimeAsync(0);

    expect(events.some((event) => event.type === "changed")).toBe(false);

    watch.close();
  });

  it("pings immediately on connect and every 15s after, as long as pongs answer", async () => {
    const client = fakeClient();
    const sockets: FakeSocket[] = [];
    const events: PlatformWatchEvent[] = [];
    const watch = watchHelper({
      client,
      orgId: "org-1",
      projectId: "proj-1",
      makeSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    watch.events.subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    await connectSocket(sockets, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ type: "connected" });
    // The first ping goes out immediately on connect, before the 15s timer.
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: "ping" })]);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      sockets[0]!.receive({ type: "pong" });
      await vi.advanceTimersByTimeAsync(15_000);
    }

    expect(sockets[0]!.sent).toHaveLength(4);
    expect(events).not.toContainEqual({ type: "disconnected" });
    expect(sockets).toHaveLength(1);

    watch.close();
  });

  it("reconnects immediately, with no backoff, the first time a ping's pong never arrives", async () => {
    const client = fakeClient();
    const sockets: FakeSocket[] = [];
    const events: PlatformWatchEvent[] = [];
    const watch = watchHelper({
      client,
      orgId: "org-1",
      projectId: "proj-1",
      makeSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    watch.events.subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(0);
    await connectSocket(sockets, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ type: "connected" });

    // The first ping's pong never comes: dead 8s later, not the brief's 2×15s+5s.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(events).toContainEqual({ type: "disconnected" });

    // No backoff on this first reconnect attempt — the new socket appears at +0ms.
    // (A further 1ms, not another 0ms: a timer scheduled for exactly "now" only
    // fires once fake time actually moves past that instant.)
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    watch.close();
  });

  it("re-issues the Process list subscription every 160s on the same receiverId, without a changed signal", async () => {
    const client = fakeClient();
    const sockets: FakeSocket[] = [];
    const events: PlatformWatchEvent[] = [];
    const watch = watchHelper({
      client,
      orgId: "org-1",
      projectId: "proj-1",
      makeSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      makeReceiverId: () => "receiver-1",
    });
    watch.events.subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(0);
    await connectSocket(sockets, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.searches).toHaveLength(4);

    // Keep the socket alive across the wait so only the resubscribe timer is under test.
    for (let cycle = 0; cycle < 10; cycle += 1) {
      sockets[0]!.receive({ type: "pong" });
      await vi.advanceTimersByTimeAsync(15_000);
    }
    // 150s of ping/pong elapsed; the 160s resubscribe has not fired yet.
    expect(client.searches).toHaveLength(4);

    sockets[0]!.receive({ type: "pong" });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(client.searches).toHaveLength(5);
    expect(client.searches[4]).toEqual({
      entity: "process",
      options: { orgId: "org-1", projectId: "proj-1", receiverId: "receiver-1", mode: "list" },
    });
    expect(events.some((event) => event.type === "changed")).toBe(false);
    expect(sockets).toHaveLength(1);

    watch.close();
  });

  it("re-authenticates and re-subscribes with a fresh receiverId after a disconnect", async () => {
    const client = fakeClient();
    const sockets: FakeSocket[] = [];
    let receiverCounter = 0;
    const watch = watchHelper({
      client,
      orgId: "org-1",
      projectId: "proj-1",
      makeSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      makeReceiverId: () => {
        receiverCounter += 1;
        return `receiver-${receiverCounter}`;
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    await connectSocket(sockets, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.searches).toHaveLength(4);
    expect(client.logins).toBe(1);

    sockets[0]!.simulateServerClose();
    // Immediate reconnect, no backoff — see the note in the pong-timeout test above.
    await vi.advanceTimersByTimeAsync(1);

    expect(sockets).toHaveLength(2);
    await connectSocket(sockets, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.searches).toHaveLength(8);

    expect(client.logins).toBe(2);
    const firstBatchReceiverId = client.searches[0]!.options.receiverId;
    const secondBatchReceiverId = client.searches[4]!.options.receiverId;
    expect(secondBatchReceiverId).not.toBe(firstBatchReceiverId);
    expect(client.searches.slice(4).every((call) => call.options.receiverId === "receiver-2")).toBe(
      true,
    );

    watch.close();
  });

  it("stops emitting after close and never reconnects again", async () => {
    const client = fakeClient();
    const sockets: FakeSocket[] = [];
    const events: PlatformWatchEvent[] = [];
    const watch = watchHelper({
      client,
      orgId: "org-1",
      projectId: "proj-1",
      makeSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    watch.events.subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    await connectSocket(sockets, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ type: "connected" });

    watch.close();
    events.length = 0;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(events).toEqual([]);
    expect(sockets).toHaveLength(1);
  });
});
