import { describe, expect, it } from "@effect/vitest";

import {
  attachToApp,
  HqError,
  makeHqApi,
  readHqHealth,
  type HqApi,
  type OpenHqSocket,
} from "./client.ts";

/** No socket is opened by a call that is no structure stream. */
const NO_SOCKET: OpenHqSocket = () => {
  throw new Error("no socket in this test");
};

const ADDRESS = "https://hq-30db-8080.prg1.zerops.app";

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** An HQ that admits every throwaway `door-<n>` and answers each session's calls. */
function fakeHq(answer: (seen: Seen) => Response | undefined = () => undefined) {
  const seen: Seen[] = [];
  let sessions = 0;
  const live = new Set<string>();
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    const request: Seen = {
      method: init?.method ?? "GET",
      path: url.pathname,
      authorization: headers.get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    seen.push(request);
    const custom = answer(request);
    if (custom !== undefined) return custom;
    if (request.path === "/api/door") {
      const session = `session-${++sessions}`;
      live.add(session);
      return json(200, { session, expiresAt: "2026-10-02T20:00:00.000Z", userId: "u1" });
    }
    if (!live.has(request.authorization?.replace("Bearer ", "") ?? "")) {
      return json(401, { code: "session_required" });
    }
    if (request.path === "/api/structure") return json(200, { apps: [] });
    if (request.path === "/api/apps") return json(201, { id: "app-1", name: "Acme" });
    return json(201, {});
  };
  return { fetch, seen, expire: () => live.clear() };
}

function doors() {
  const minted: string[] = [];
  return {
    minted,
    throughDoor: async <T>(use: (token: string) => Promise<T>) => {
      const token = `door-${minted.length + 1}`;
      minted.push(token);
      return use(token);
    },
  };
}

describe("makeHqApi — a connection that drops", () => {
  /** HQ behind a connection that drops `drops` times first, then answers each session's calls. */
  const dropping = (drops: number) => {
    const hq = fakeHq();
    let left = drops;
    const fetch = async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname === "/api/structure" && left > 0) {
        left -= 1;
        throw new TypeError("Failed to fetch");
      }
      return hq.fetch(input, init);
    };
    return { hq, fetch };
  };

  it("tries a call once more when the connection dropped under it", async () => {
    const { hq, fetch } = dropping(1);
    const api = makeHqApi({
      address: ADDRESS,
      fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(api.structure()).resolves.toEqual({ apps: [] });
    expect(hq.seen.filter((entry) => entry.path === "/api/structure")).toHaveLength(1);
  });

  it("says HQ could not be reached when it drops twice in a row", async () => {
    const { fetch } = dropping(2);
    const api = makeHqApi({
      address: ADDRESS,
      fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(api.structure()).rejects.toMatchObject({ kind: "unavailable", code: "network" });
  });

  it("never tries again what HQ answered, nor what its caller stopped", async () => {
    let calls = 0;
    const answering = async () => {
      calls += 1;
      return json(503, { code: "not_leader" });
    };
    const api = makeHqApi({
      address: ADDRESS,
      fetch: async (input, init) =>
        new URL(input).pathname === "/api/door" ? fakeHq().fetch(input, init) : answering(),
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(api.structure()).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toBe(1);

    const stopped = new AbortController();
    stopped.abort();
    let tried = 0;
    const aborting = makeHqApi({
      address: ADDRESS,
      fetch: async (input, init) => {
        if (new URL(input).pathname === "/api/door") return fakeHq().fetch(input, init);
        tried += 1;
        throw new DOMException("aborted", "AbortError");
      },
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(aborting.structure(stopped.signal)).rejects.toBeInstanceOf(HqError);
    expect(tried).toBe(1);
  });
});

describe("makeHqApi", () => {
  it("comes through the door once and carries its session on every call", async () => {
    const hq = fakeHq();
    const door = doors();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: door.throughDoor,
      openSocket: NO_SOCKET,
    });

    await api.structure();
    await api.createApp("Acme");

    expect(door.minted).toEqual(["door-1"]);
    expect(hq.seen.map((entry) => [entry.method, entry.path, entry.authorization])).toEqual([
      ["POST", "/api/door", null],
      ["GET", "/api/structure", "Bearer session-1"],
      ["POST", "/api/apps", "Bearer session-1"],
    ]);
    expect(hq.seen[0]?.body).toEqual({ token: "door-1" });
  });

  it("comes through the door again once HQ no longer takes the session, and only once", async () => {
    const hq = fakeHq();
    const door = doors();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: door.throughDoor,
      openSocket: NO_SOCKET,
    });
    await api.structure();
    hq.expire();

    await expect(api.structure()).resolves.toEqual({ apps: [] });
    expect(door.minted).toEqual(["door-1", "door-2"]);

    const stuck = makeHqApi({
      address: ADDRESS,
      fetch: fakeHq((seen) =>
        seen.path === "/api/structure" ? json(401, { code: "session_required" }) : undefined,
      ).fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(stuck.structure()).rejects.toMatchObject({ code: "session_required" });
  });

  it.each<[string, Response | "throw", Partial<HqError>]>([
    [
      "a refusal carries HQ's code, and its reason in words",
      json(403, { code: "forbidden", reason: "not_structure_writer" }),
      {
        kind: "refused",
        code: "forbidden",
        message: "Only an owner or admin of the organization can do this.",
      },
    ],
    [
      "a standby is unavailable",
      json(503, { code: "not_active" }),
      { kind: "unavailable", code: "not_active" },
    ],
    ["no answer is unavailable", "throw", { kind: "unavailable", code: "network" }],
  ])("%s", async (_name, answer, expected) => {
    const hq = fakeHq((seen) => {
      if (seen.path !== "/api/apps") return undefined;
      if (answer === "throw") throw new TypeError("Failed to fetch");
      return answer;
    });
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    const failure = await api.createApp("Acme").catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HqError);
    expect(failure).toMatchObject(expected);
  });
});

describe("readHqHealth", () => {
  it.each<[string, Response | "throw", Awaited<ReturnType<typeof readHqHealth>>]>([
    [
      "the official HQ leading",
      json(200, { state: "active", official: "ok", db: "up", epoch: 8, build: "b1" }),
      { kind: "healthy", build: "b1" },
    ],
    [
      "a standby that is not the official HQ yet",
      json(200, { state: "standby", official: "anchor_missing", db: "up", epoch: 0, build: "b1" }),
      { kind: "not-ready", state: "standby", official: "anchor_missing" },
    ],
    [
      "a Core that cannot serve",
      json(503, { state: "starting", official: "unknown", db: "down", epoch: 0, build: "b1" }),
      { kind: "not-ready", state: "starting", official: "unknown" },
    ],
    ["nothing answering", "throw", { kind: "unreachable" }],
    ["something else answering", new Response("<html>", { status: 502 }), { kind: "unreachable" }],
  ])("%s", async (_name, answer, expected) => {
    const fetch = async (input: string) => {
      expect(input).toBe(`${ADDRESS}/health`);
      if (answer === "throw") throw new TypeError("Failed to fetch");
      return answer;
    };
    await expect(readHqHealth(fetch, `${ADDRESS}/`)).resolves.toEqual(expected);
  });
});

describe("attachToApp", () => {
  const conflict = new HqError({
    kind: "refused",
    code: "conflict",
    status: 409,
    message: "The project is in an application already, or the application has its production.",
  });
  const api = (attached: ReadonlyArray<{ readonly projectId: string; readonly kind: string }>) => {
    const made: HqApi = {
      structure: async () => ({
        ungrouped: [],
        apps: [
          {
            id: "app-1",
            name: "Acme",
            projects: attached.map((entry) => ({ ...entry, name: "", mate: null })),
          },
        ],
      }),
      streamStructure: async () => undefined,
      createApp: async () => ({ id: "app-1", name: "Acme" }),
      attachProject: async () => {
        throw conflict;
      },
      updateMate: async () => undefined,
      renameApp: async () => undefined,
      moveProject: async () => undefined,
      createMate: async () => undefined,
    };
    return made;
  };

  it.each<[string, ReadonlyArray<{ readonly projectId: string; readonly kind: string }>, boolean]>([
    [
      "a project already attached as asked: the same write run twice",
      [{ projectId: "p1", kind: "mate" }],
      true,
    ],
    [
      "a project attached as something else stays refused",
      [{ projectId: "p1", kind: "stage" }],
      false,
    ],
    ["a second production stays refused", [{ projectId: "p0", kind: "production" }], false],
  ])("%s", async (_name, attached, attachedAsAsked) => {
    const attaching = attachToApp(api(attached), "app-1", {
      projectId: "p1",
      kind: attached[0]?.kind === "production" ? "production" : "mate",
      ...(attached[0]?.kind === "production" ? {} : { mate: { name: "Vera", face: "rose:seal" } }),
    });
    if (attachedAsAsked) await expect(attaching).resolves.toBeUndefined();
    else await expect(attaching).rejects.toBe(conflict);
  });
});

describe("makeHqApi — the structure socket", () => {
  interface FakeSocket {
    readonly url: string;
    readonly sent: Array<string>;
    readonly on: Parameters<OpenHqSocket>[1];
    closed: boolean;
  }

  /** Sockets as HQ would open them, handed to the test in the order they open. */
  function fakeSockets() {
    const opened: Array<FakeSocket> = [];
    const arrivals: Array<(socket: FakeSocket) => void> = [];
    let asked = 0;
    const openSocket: OpenHqSocket = (url, on) => {
      const socket: FakeSocket = { url, sent: [], on, closed: false };
      opened.push(socket);
      arrivals[opened.length - 1]?.(socket);
      return {
        send: (data) => socket.sent.push(data),
        close: () => {
          socket.closed = true;
          queueMicrotask(() => on.close(1005));
        },
      };
    };
    /** The socket opened after the ones taken so far. */
    const next = () => {
      const index = asked++;
      const ready = opened[index];
      return ready !== undefined
        ? Promise.resolve(ready)
        : new Promise<FakeSocket>((resolve) => {
            arrivals[index] = resolve;
          });
    };
    return { openSocket, next };
  }

  /** HQ minting `t-<n>` for every ticket asked for. */
  const ticketing = () => {
    let tickets = 0;
    return fakeHq((seen) =>
      seen.path === "/api/stream-ticket"
        ? json(200, { ticket: `t-${++tickets}`, expiresIn: 60 })
        : undefined,
    );
  };

  const streaming = (api: HqApi, signal = new AbortController().signal) => {
    const events: Array<unknown> = [];
    let alive = 0;
    const done = api.streamStructure(
      { onEvent: (event) => events.push(event), onAlive: () => (alive += 1) },
      signal,
    );
    return { done, events, alive: () => alive };
  };

  it("opens the socket with a ticket minted through the door, reads the snapshot and each change, and answers every ping", async () => {
    const hq = ticketing();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: sockets.openSocket,
    });
    const stream = streaming(api);
    const socket = await sockets.next();
    socket.on.message(JSON.stringify({ type: "snapshot", ungrouped: [], apps: [] }));
    socket.on.message(JSON.stringify({ type: "ping" }));
    socket.on.message(
      JSON.stringify({
        type: "change",
        key: "app-1",
        value: { id: "app-1", name: "Acme", projects: [] },
      }),
    );
    socket.on.close(1001);
    await stream.done;

    expect(socket.url).toBe("wss://hq-30db-8080.prg1.zerops.app/api/structure/ws?ticket=t-1");
    expect(stream.events).toEqual([
      { kind: "snapshot", structure: { ungrouped: [], apps: [] } },
      { kind: "change", appId: "app-1", app: { id: "app-1", name: "Acme", projects: [] } },
    ]);
    expect(socket.sent).toEqual([JSON.stringify({ type: "pong" })]);
    expect(stream.alive()).toBe(3);
    expect(hq.seen.map((entry) => `${entry.method} ${entry.path} ${entry.authorization}`)).toEqual([
      "POST /api/door null",
      "POST /api/stream-ticket Bearer session-1",
    ]);
  });

  it.each<[string, number, "resolves" | "rejects"]>([
    ["ends when another Core leads now, to be read again at once", 1001, "resolves"],
    ["breaks when HQ could not read the view", 1011, "rejects"],
    ["breaks when the connection dropped", 1006, "rejects"],
  ])("%s (%i)", async (_name, code, ends) => {
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: ticketing().fetch,
      throughDoor: doors().throughDoor,
      openSocket: sockets.openSocket,
    });
    const stream = streaming(api);
    (await sockets.next()).on.close(code);
    if (ends === "resolves") await expect(stream.done).resolves.toBeUndefined();
    else await expect(stream.done).rejects.toBeInstanceOf(HqError);
  });

  it("comes through the door again for the next socket once HQ ended the session (4401)", async () => {
    const hq = ticketing();
    const door = doors();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: door.throughDoor,
      openSocket: sockets.openSocket,
    });
    const first = streaming(api);
    (await sockets.next()).on.close(4401);
    await expect(first.done).resolves.toBeUndefined();
    streaming(api);
    await sockets.next();
    expect(door.minted).toEqual(["door-1", "door-2"]);
    expect(hq.seen.at(-1)).toMatchObject({
      path: "/api/stream-ticket",
      authorization: "Bearer session-2",
    });
  });

  it("closes its socket when the reader stops", async () => {
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: ticketing().fetch,
      throughDoor: doors().throughDoor,
      openSocket: sockets.openSocket,
    });
    const stop = new AbortController();
    const stream = streaming(api, stop.signal);
    const socket = await sockets.next();
    stop.abort();
    await stream.done.catch(() => undefined);
    expect(socket.closed).toBe(true);
  });

  it("writes a Mate's name and face to HQ", async () => {
    const hq = fakeHq();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await api.updateMate("p1", { name: "Vera", face: "rose:seal:named" });
    expect(hq.seen.at(-1)).toMatchObject({
      method: "PATCH",
      path: "/api/mates/p1",
      body: { name: "Vera", face: "rose:seal:named" },
    });
  });
});

describe("makeHqApi — application name and a project's application", () => {
  it.each<[string, (api: HqApi) => Promise<void>, Partial<Seen>]>([
    [
      "renames an application",
      (api) => api.renameApp("app-1", "Acme CRM"),
      { method: "PATCH", path: "/api/apps/app-1", body: { name: "Acme CRM" } },
    ],
    [
      "moves a project into another application",
      (api) => api.moveProject("p1", { appId: "app-2", kind: "mate" }),
      { method: "PUT", path: "/api/projects/p1/app", body: { appId: "app-2", kind: "mate" } },
    ],
    [
      "takes a Mate out of every application",
      (api) => api.moveProject("p1", { appId: null, kind: "mate" }),
      { method: "PUT", path: "/api/projects/p1/app", body: { appId: null, kind: "mate" } },
    ],
    [
      "sets a Mate up in no application, by its record",
      (api) => api.createMate({ projectId: "p1", name: "Ada", face: "sky:flower:named" }),
      {
        method: "POST",
        path: "/api/mates",
        body: { projectId: "p1", name: "Ada", face: "sky:flower:named" },
      },
    ],
  ])("%s", async (_name, act, expected) => {
    const hq = fakeHq();
    await act(
      makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        throughDoor: doors().throughDoor,
        openSocket: NO_SOCKET,
      }),
    );
    expect(hq.seen.at(-1)).toMatchObject(expected);
  });
});
