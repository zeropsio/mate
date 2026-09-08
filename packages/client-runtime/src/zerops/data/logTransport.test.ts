import { describe, expect, it, vi } from "vite-plus/test";

import { project, scope } from "./__fixtures__/index.ts";
import {
  BuildLogTransportError,
  makeBuildLogTransport,
  type BuildLogFollowCallbacks,
  type BuildLogSocket,
} from "./logTransport.ts";
import { ZeropsAccountId } from "./types.ts";

const QUERY = { buildServiceStackId: "build-1", appVersionId: "version-1" };

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class FakeSocket implements BuildLogSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  closed = false;
  #message: ((event: { readonly data: unknown }) => void) | undefined;
  #error: (() => void) | undefined;
  #close: (() => void) | undefined;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: () => void): void;
  addEventListener(
    type: "message" | "error" | "close",
    listener: ((event: { readonly data: unknown }) => void) | (() => void),
  ): void {
    if (type === "message") this.#message = listener as (event: { readonly data: unknown }) => void;
    if (type === "error") this.#error = listener as () => void;
    if (type === "close") this.#close = listener as () => void;
  }

  emit(data: unknown): void {
    this.#message?.({ data });
  }

  fail(): void {
    this.#error?.();
  }

  serverClose(): void {
    this.#close?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.#close?.();
  }
}

function callbacks(): BuildLogFollowCallbacks & {
  readonly lines: ReturnType<typeof vi.fn>;
  readonly malformed: ReturnType<typeof vi.fn>;
  readonly errors: ReturnType<typeof vi.fn>;
  readonly closes: ReturnType<typeof vi.fn>;
} {
  const lines = vi.fn();
  const malformed = vi.fn();
  const errors = vi.fn();
  const closes = vi.fn();
  return {
    lines,
    malformed,
    errors,
    closes,
    onLines: lines,
    onMalformedFrame: malformed,
    onError: errors,
    onClose: closes,
  };
}

describe("build log transport", () => {
  it("acquires a fresh private grant for each page/socket and carries explicit cursors", async () => {
    FakeSocket.instances = [];
    const grants = ["page-one-secret", "older-secret", "follow-secret"];
    const grantCalls: string[] = [];
    const fetchUrls: string[] = [];
    const bodies = [
      {
        items: [{ id: "l2", timestamp: "2026-09-08T00:00:02.000Z", content: "two", severity: 6 }],
      },
      {
        items: [
          { id: "l1", timestamp: "2026-09-08T00:00:01.000Z", content: "one", severity: 6 },
          { id: "l2", timestamp: "2026-09-08T00:00:02.000Z", content: "two", severity: 6 },
        ],
      },
    ];
    const transport = makeBuildLogTransport({
      scope: scope(),
      acquireGrant: async (ref) => {
        grantCalls.push(ref.projectId);
        return { url: `https://logs.example.test/api/rest/log?signature=${grants.shift()}` };
      },
      fetchImpl: async (url) => {
        fetchUrls.push(url);
        return { ok: true, json: async () => bodies.shift() };
      },
      WebSocketCtor: FakeSocket,
    });

    const initial = await transport.loadPage({ project: project(), query: QUERY, limit: 20 });
    const older = await transport.loadPage({
      project: project(),
      query: QUERY,
      limit: 20,
      beforeLineId: "l2",
    });
    const events = callbacks();
    const follow = await transport.openFollow({
      project: project(),
      query: QUERY,
      fromLineId: "l2",
      callbacks: events,
    });

    expect(grantCalls).toEqual(["project-1", "project-1", "project-1"]);
    expect(fetchUrls[0]).toContain("signature=page-one-secret");
    expect(new URL(fetchUrls[1]!).searchParams.get("till")).toBe("l2");
    expect(new URL(FakeSocket.instances[0]!.url).searchParams.get("from")).toBe("l2");
    expect(FakeSocket.instances[0]!.url).toContain("signature=follow-secret");
    expect(initial.lines.map(({ id }) => id)).toEqual(["l2"]);
    expect(older.lines.map(({ id }) => id)).toEqual(["l1", "l2"]);
    expect(JSON.stringify({ initial, older })).not.toContain("secret");

    follow.close();
    expect(FakeSocket.instances[0]?.closed).toBe(true);
  });

  it("decodes frames, reports malformed/rejected input, and ignores callbacks after close", async () => {
    FakeSocket.instances = [];
    const events = callbacks();
    const transport = makeBuildLogTransport({
      scope: scope(),
      acquireGrant: async () => ({ url: "https://logs.example.test/log?signature=secret" }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
      WebSocketCtor: FakeSocket,
    });
    const handle = await transport.openFollow({
      project: project(),
      query: QUERY,
      callbacks: events,
    });
    const socket = FakeSocket.instances[0]!;

    socket.emit(
      JSON.stringify({
        items: [
          { id: "l1", timestamp: "2026-09-08T00:00:01.000Z", message: "one" },
          { timestamp: "missing-id" },
        ],
      }),
    );
    socket.emit("not-json");

    expect(events.lines).toHaveBeenCalledWith(
      [{ id: "l1", at: "2026-09-08T00:00:01.000Z", text: "one", severity: 6 }],
      1,
    );
    expect(events.malformed).toHaveBeenCalledOnce();

    handle.close();
    socket.emit(JSON.stringify({ items: [] }));
    socket.fail();
    socket.serverClose();
    expect(events.errors).not.toHaveBeenCalled();
    expect(events.closes).not.toHaveBeenCalled();
  });

  it("fences a late grant after shutdown before constructing a socket", async () => {
    FakeSocket.instances = [];
    const grant = deferred<{ readonly url: string }>();
    let grantSignal: AbortSignal | undefined;
    const transport = makeBuildLogTransport({
      scope: scope(),
      acquireGrant: (_project, signal) => {
        grantSignal = signal;
        return grant.promise;
      },
      fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
      WebSocketCtor: FakeSocket,
    });
    const opening = transport.openFollow({
      project: project(),
      query: QUERY,
      callbacks: callbacks(),
    });

    transport.shutdown();
    expect(grantSignal?.aborted).toBe(true);
    grant.resolve({ url: "https://logs.example.test/log?signature=late-secret" });
    const error = await opening.catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(BuildLogTransportError);
    expect((error as BuildLogTransportError).kind).toBe("closed");
    expect(String(error)).not.toContain("late-secret");
    expect(FakeSocket.instances).toHaveLength(0);
    expect(transport.diagnostics()).toEqual({ activeFollowers: 0, closed: true });
  });

  it("fences a late follow grant when its lease signal aborts", async () => {
    FakeSocket.instances = [];
    const grant = deferred<{ readonly url: string }>();
    let grantSignal: AbortSignal | undefined;
    const transport = makeBuildLogTransport({
      scope: scope(),
      acquireGrant: (_project, signal) => {
        grantSignal = signal;
        return grant.promise;
      },
      fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
      WebSocketCtor: FakeSocket,
    });
    const lease = new AbortController();
    const opening = transport.openFollow({
      project: project(),
      query: QUERY,
      callbacks: callbacks(),
      signal: lease.signal,
    });

    lease.abort();
    expect(grantSignal?.aborted).toBe(true);
    grant.resolve({ url: "https://logs.example.test/log?signature=late-lease-secret" });
    const error = await opening.catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(BuildLogTransportError);
    expect((error as BuildLogTransportError).kind).toBe("closed");
    expect(String(error)).not.toContain("late-lease-secret");
    expect(FakeSocket.instances).toHaveLength(0);
    transport.shutdown();
  });

  it("sanitizes rejected grants and foreign-account requests", async () => {
    const secret = "signed-url-must-not-escape";
    const transport = makeBuildLogTransport({
      scope: scope(),
      acquireGrant: async () => {
        throw new Error(secret);
      },
      fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
      WebSocketCtor: FakeSocket,
    });
    const grantError = await transport
      .loadPage({ project: project(), query: QUERY, limit: 20 })
      .catch((cause: unknown) => cause);
    const foreign = project();
    const foreignProject = {
      ...foreign,
      organization: {
        ...foreign.organization,
        account: {
          ...foreign.organization.account,
          accountId: ZeropsAccountId.make("other-account"),
        },
      },
    };
    const accountError = await transport
      .loadPage({ project: foreignProject, query: QUERY, limit: 20 })
      .catch((cause: unknown) => cause);

    expect((grantError as BuildLogTransportError).kind).toBe("grant");
    expect(String(grantError)).not.toContain(secret);
    expect((accountError as BuildLogTransportError).kind).toBe("account-fence");
  });

  it("sanitizes a socket-constructor error that embeds the signed URL", async () => {
    function ThrowingSocket(url: string): never {
      throw new TypeError(`Cannot open ${url}`);
    }
    const transport = makeBuildLogTransport({
      scope: scope(),
      acquireGrant: async () => ({
        url: "https://logs.example.test/log?signature=constructor-secret",
      }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
      WebSocketCtor: ThrowingSocket as never,
    });

    const error = await transport
      .openFollow({ project: project(), query: QUERY, callbacks: callbacks() })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BuildLogTransportError);
    expect((error as BuildLogTransportError).kind).toBe("socket");
    expect(String(error)).not.toContain("constructor-secret");
  });

  it("closes active sockets and fences late socket callbacks on account shutdown", async () => {
    FakeSocket.instances = [];
    const events = callbacks();
    const transport = makeBuildLogTransport({
      scope: scope(),
      acquireGrant: async () => ({ url: "https://logs.example.test/log?signature=secret" }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
      WebSocketCtor: FakeSocket,
    });
    await transport.openFollow({ project: project(), query: QUERY, callbacks: events });
    const socket = FakeSocket.instances[0]!;

    transport.shutdown();
    transport.shutdown();
    socket.emit(JSON.stringify({ items: [{ id: "late", timestamp: "t", content: "late" }] }));
    socket.fail();
    socket.serverClose();

    expect(socket.closed).toBe(true);
    expect(events.lines).not.toHaveBeenCalled();
    expect(events.errors).not.toHaveBeenCalled();
    expect(events.closes).not.toHaveBeenCalled();
  });
});
