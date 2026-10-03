import { describe, expect, it, vi } from "@effect/vitest";

import {
  attachToApp,
  HQ_WRITE_UNCERTAIN,
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
  readonly search: string;
  readonly authorization: string | null;
  readonly accept: string | null;
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
      search: url.search,
      authorization: headers.get("authorization"),
      accept: headers.get("accept"),
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

  it("waits 45 s for a door that does not answer, then gives it up, and the next call enters again", async () => {
    vi.useFakeTimers();
    // The call deadlines run on the test's clock.
    const deadlines = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const deadline = new AbortController();
      // @effect-diagnostics-next-line globalTimers:off -- the deadline the client asks for, on fake timers.
      setTimeout(() => deadline.abort(new DOMException("timed out", "TimeoutError")), ms);
      return deadline.signal;
    });
    try {
      let silent = true;
      const hq = fakeHq();
      const door = doors();
      const api = makeHqApi({
        address: ADDRESS,
        // The first door hangs until its caller gives it up; HQ answers the next one.
        fetch: async (input, init) => {
          if (!silent || new URL(input).pathname !== "/api/door") return hq.fetch(input, init);
          silent = false;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          });
        },
        throughDoor: door.throughDoor,
        openSocket: NO_SOCKET,
      });
      const first = api.structure();
      const settled = vi.fn();
      first.then(settled, settled);

      await vi.advanceTimersByTimeAsync(44_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(first).rejects.toMatchObject({ kind: "unavailable", code: "network" });

      await expect(api.structure()).resolves.toEqual({ apps: [] });
      expect(door.minted).toEqual(["door-1", "door-2"]);
    } finally {
      deadlines.mockRestore();
      vi.useRealTimers();
    }
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
    // A read with no answer is HQ not answering (`a connection that drops`); a write may have landed.
    [
      "a write with no answer is uncertain",
      "throw",
      { kind: "uncertain", code: "uncertain", message: HQ_WRITE_UNCERTAIN },
    ],
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
      // Inside HQ's grace (`official.ts`): it leads and serves, Zerops just does not answer its check.
      "the official HQ leading, its check of Zerops unanswered",
      json(200, { state: "active", official: "unknown", db: "up", epoch: 8, build: "b1" }),
      { kind: "unchecked", build: "b1" },
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
    const made: Pick<HqApi, "attachProject" | "structure"> = {
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
      attachProject: async () => {
        throw conflict;
      },
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
      { kind: "snapshot", structure: { ungrouped: [], apps: [] }, changes: null },
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
    // E2E 2026-10-03 (F5): an application a stopped New project left, holding nothing.
    [
      "deletes an application",
      (api) => api.deleteApp("app-1"),
      { method: "DELETE", path: "/api/apps/app-1" },
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
    [
      "records who asks for a Mate's stand-up: the caller",
      (api) => api.recordStandUp("p1"),
      { method: "POST", path: "/api/mates/p1/standup" },
    ],
    [
      "records that a Mate's project is closed off",
      (api) => api.recordClosedOff("p1"),
      { method: "POST", path: "/api/mates/p1/closed-off" },
    ],
    // SPEC §3.2b: a stage or a production attached as an environment of the application, named.
    [
      "attaches a stage under the environment's name",
      (api) =>
        api.attachProject("app-1", {
          projectId: "p2",
          kind: "stage",
          environment: { name: "stage" },
        }),
      {
        method: "POST",
        path: "/api/apps/app-1/projects",
        body: { projectId: "p2", kind: "stage", environment: { name: "stage" } },
      },
    ],
    // Main B36/B37: "Run again" of an environment's newest failed deploy of a service.
    [
      "asks an environment's failed deploy of a service again",
      (api) => api.redeploy("app-1", "stage", { service: "api", sha: "a".repeat(40) }),
      {
        method: "POST",
        path: "/api/apps/app-1/environments/stage/redeploy",
        body: { service: "api", sha: "a".repeat(40) },
      },
    ],
    // Minted by the person's own client; HQ keeps it, and says of it only that it holds one.
    [
      "hands HQ an environment's deploy token",
      (api) => api.keepDeployToken("app-1", "stage", "tok-1"),
      {
        method: "PUT",
        path: "/api/apps/app-1/environments/stage/deploy-token",
        body: { token: "tok-1" },
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

describe("makeHqApi — a Mate's changes, as the person reads them", () => {
  const SHA = "a".repeat(40);
  const CHANGE = {
    appId: "app-1",
    repo: "app",
    number: 3,
    mateProjectId: "p1",
    title: "Add a /status page",
    body: "![The page](https://hq.example/api/apps/app-1/changes/app/3/attachments/shot1)",
    state: "open",
    head: SHA,
    mergedSha: null,
    landedHead: null,
    openedAt: "2026-10-02T09:00:00.000Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-10-02T09:00:00.000Z",
    mergeability: "clean",
    behind: false,
  } as const;
  const DETAIL = {
    change: CHANGE,
    mainHead: "b".repeat(40),
    mergeBase: "b".repeat(40),
    mergeability: { kind: "clean" },
    files: [
      {
        path: "server/status.ts",
        added: 12,
        deleted: 1,
        hunks: "@@ -1 +1,12 @@",
        binary: false,
        truncated: false,
      },
    ],
    filesTruncated: false,
    commits: [
      { sha: SHA, subject: "Add the page", authorName: "Vera", at: "2026-10-02T09:01:00Z" },
    ],
    commitsTruncated: false,
  } as const;
  const COMMENT = {
    id: "c1",
    authorUserId: "u1",
    authorMateProjectId: null,
    body: "Looks good",
    createdAt: "2026-10-02T09:05:00.000Z",
  } as const;
  const LINK = { appId: "app-1", repo: "app", number: 3 } as const;
  const api = (answer: (seen: Seen) => Response | undefined) => {
    const hq = fakeHq((seen) =>
      seen.path === "/api/door" || seen.authorization === null ? undefined : answer(seen),
    );
    return {
      hq,
      api: makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        throughDoor: doors().throughDoor,
        openSocket: NO_SOCKET,
      }),
    };
  };

  it("reads a change with what its review reads, as the person", async () => {
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3" ? json(200, DETAIL) : undefined,
    );
    await expect(hqApi.change(LINK)).resolves.toEqual(DETAIL);
    expect(hq.seen.at(-1)).toMatchObject({ method: "GET", authorization: "Bearer session-1" });
  });

  it("refuses an answer this version of Mate cannot read, rather than drawing half of it", async () => {
    const { api: hqApi } = api(() => json(200, { ...DETAIL, mergeability: { kind: "maybe" } }));
    await expect(hqApi.change(LINK)).rejects.toMatchObject({
      kind: "refused",
      code: "unreadable",
    });
  });

  it("says a change HQ has no record of in words of its own", async () => {
    const { api: hqApi } = api(() =>
      json(404, { code: "change_not_found", reason: "change_not_found" }),
    );
    await expect(hqApi.change(LINK)).rejects.toMatchObject({
      kind: "refused",
      code: "change_not_found",
      message: "HQ has no such change.",
    });
  });

  it("reads a change's conversation, and says something in it as the person", async () => {
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3/comments"
        ? seen.method === "POST"
          ? json(201, { ...COMMENT, body: "Ship it" })
          : json(200, { comments: [COMMENT] })
        : undefined,
    );
    await expect(hqApi.changeComments(LINK)).resolves.toEqual([COMMENT]);
    await expect(hqApi.commentOnChange(LINK, "Ship it")).resolves.toEqual({
      ...COMMENT,
      body: "Ship it",
    });
    expect(hq.seen.at(-1)).toMatchObject({ method: "POST", body: { body: "Ship it" } });
  });

  // A merge takes only the head the person was shown; HQ answers the change as it now stands.
  it("merges a change as the person, with the head they were shown", async () => {
    const MERGED = {
      ...CHANGE,
      state: "merged",
      mergedSha: "c".repeat(40),
      landedHead: SHA,
      mergedAt: "2026-10-02T09:10:00.000Z",
      mergeability: "already_merged",
    } as const;
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3/merge" ? json(200, MERGED) : undefined,
    );
    await expect(hqApi.mergeChange(LINK, SHA)).resolves.toEqual(MERGED);
    expect(hq.seen.at(-1)).toMatchObject({
      method: "POST",
      authorization: "Bearer session-1",
      body: { expectedHead: SHA },
    });
  });

  it("closes a change without merging it, as the person", async () => {
    const CLOSED = { ...CHANGE, state: "closed", closedAt: "2026-10-02T09:10:00.000Z" } as const;
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3/close" ? json(200, CLOSED) : undefined,
    );
    await expect(hqApi.closeChange(LINK)).resolves.toEqual(CLOSED);
    expect(hq.seen.at(-1)).toMatchObject({ method: "POST", authorization: "Bearer session-1" });
  });

  it("says why HQ did not merge in words of its own", async () => {
    const { api: hqApi } = api(() => json(409, { code: "conflict", reason: "head_moved" }));
    await expect(hqApi.mergeChange(LINK, SHA)).rejects.toMatchObject({
      kind: "refused",
      code: "conflict",
      status: 409,
      message: "Its Mate pushed to it since you opened it. Review it again.",
    });
  });

  // The recipe a new environment starts from, on its recipe repository's `main` (SPEC §3.2c).
  it.each([
    [
      "a tier main holds",
      { state: "present", importYaml: "services:\n  - hostname: db\n", mainHead: SHA },
    ],
    ["a tier main does not", { state: "absent" }],
  ] as const)("reads %s, as the person", async (_case, tier) => {
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/recipe/mate" ? json(200, tier) : undefined,
    );
    await expect(hqApi.recipeTier("app-1", "mate")).resolves.toEqual(tier);
    expect(hq.seen.at(-1)).toMatchObject({ method: "GET", authorization: "Bearer session-1" });
  });

  it("says a recipe too large to read in words of its own", async () => {
    const { api: hqApi } = api(() => json(413, { code: "too_large", reason: "recipe_too_large" }));
    await expect(hqApi.recipeTier("app-1", "stage")).rejects.toMatchObject({
      kind: "refused",
      code: "too_large",
      message: "This project's recipe is too large to read here.",
    });
  });

  // The Git page's repositories: an application's, each with its main as HQ holds it.
  it("lists an application's repositories, as the person", async () => {
    // `updatedAt` is when its main last moved, or when it was made where nothing has landed yet.
    const REPOS = [
      { name: "appdev", mainHead: SHA, updatedAt: "2026-10-02T09:00:00.000Z" },
      { name: "group", mainHead: null, updatedAt: "2026-10-02T08:00:00.000Z" },
    ];
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/repos" ? json(200, { repos: REPOS }) : undefined,
    );
    await expect(hqApi.appRepos("app-1")).resolves.toEqual(REPOS);
    expect(hq.seen.at(-1)).toMatchObject({ method: "GET", authorization: "Bearer session-1" });
  });

  // The shape is HQ's contract (`RepoListResponse`): a main that is no commit is no answer.
  it("reads no repository list whose main is no commit", async () => {
    const { api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/repos"
        ? json(200, {
            repos: [{ name: "appdev", mainHead: "main", updatedAt: "2026-10-02T09:00:00.000Z" }],
          })
        : undefined,
    );
    await expect(hqApi.appRepos("app-1")).rejects.toMatchObject({ code: "unreadable" });
  });

  // An application's releases (`@t3tools/shared/hqRelease`): read, made and rolled back as the person.
  const RELEASE = {
    tag: "v0.1.1",
    sha: SHA,
    entries: [{ service: "app", sha: "b".repeat(40) }],
    by: "u1",
    at: "2026-10-02T10:00:00.000Z",
    state: "approved",
    reason: null,
    rollbackOf: null,
  } as const;

  it("lists an application's releases, as the person", async () => {
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/releases" && seen.method === "GET"
        ? json(200, { releases: [RELEASE] })
        : undefined,
    );
    await expect(hqApi.releases("app-1")).resolves.toEqual([RELEASE]);
    expect(hq.seen.at(-1)).toMatchObject({ method: "GET", authorization: "Bearer session-1" });
  });

  it("releases what the offer showed, and rolls back with main's head read with the offer", async () => {
    const { hq, api: hqApi } = api((seen) =>
      seen.method === "POST" && seen.path.startsWith("/api/apps/app-1/releases")
        ? json(201, RELEASE)
        : undefined,
    );
    const request = { tag: "v0.1.1", groupHead: SHA, entries: RELEASE.entries };
    await expect(hqApi.release("app-1", request)).resolves.toEqual(RELEASE);
    await expect(hqApi.rollback("app-1", "v0.1.0", { groupHead: SHA })).resolves.toEqual(RELEASE);
    expect(hq.seen.slice(-2)).toMatchObject([
      { method: "POST", path: "/api/apps/app-1/releases", body: request },
      {
        method: "POST",
        path: "/api/apps/app-1/releases/v0.1.0/rollback",
        body: { groupHead: SHA },
      },
    ]);
  });

  // What lies between two of a repository's commits (`CompareResponse`): what a release puts live.
  it("compares two commits of a repository by its name, as the person", async () => {
    const COMPARED = {
      base: SHA,
      head: "b".repeat(40),
      commits: [
        {
          sha: "b".repeat(40),
          subject: "Quicker gallery",
          authorName: "Ada",
          at: "2026-10-02T10:00:00.000Z",
          change: { number: 7, title: "Quicker gallery", mateProjectId: "p1" },
        },
      ],
      truncated: false,
      total: 1,
    };
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/repos/appdev/compare" ? json(200, COMPARED) : undefined,
    );
    await expect(
      hqApi.compare("app-1", "appdev", { base: SHA, head: "b".repeat(40) }),
    ).resolves.toEqual(COMPARED);
    await hqApi.compare("app-1", "appdev", { head: "b".repeat(40) });
    expect(hq.seen.slice(-2)).toMatchObject([
      { method: "GET", search: `?base=${SHA}&head=${"b".repeat(40)}` },
      { method: "GET", search: `?head=${"b".repeat(40)}` },
    ]);
  });

  it("fetches a change's picture with the session, as the picture it is", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3/attachments/shot1"
        ? new Response(png, { status: 200, headers: { "content-type": "image/png" } })
        : undefined,
    );
    const picture = await hqApi.changeAttachment({ ...LINK, id: "shot1" });
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(png);
    expect(picture.type).toBe("image/png");
    expect(hq.seen.at(-1)).toMatchObject({
      authorization: "Bearer session-1",
      accept: "image/png",
    });
  });
});

describe("makeHqApi — a write HQ may have made", () => {
  const SHA = "a".repeat(40);
  const MADE = {
    tag: "v0.1.1",
    sha: SHA,
    entries: [{ service: "app", sha: "b".repeat(40) }],
    by: "u1",
    at: "2026-10-03T10:00:00.000Z",
    state: "approved",
    reason: null,
    rollbackOf: null,
  } as const;
  const ASKED = { tag: MADE.tag, groupHead: SHA, entries: MADE.entries };

  /** Runs `body` on fake timers, the calls' deadlines on the same clock. */
  async function onTheClock(body: () => Promise<void>) {
    vi.useFakeTimers();
    const deadlines = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const deadline = new AbortController();
      // @effect-diagnostics-next-line globalTimers:off -- the deadline the client asks for, on fake timers.
      setTimeout(() => deadline.abort(new DOMException("timed out", "TimeoutError")), ms);
      return deadline.signal;
    });
    try {
      await body();
    } finally {
      deadlines.mockRestore();
      vi.useRealTimers();
    }
  }

  // F22 (2026-10-03): HQ waited on a slow Zerops read inside the release, the client gave the call
  // up at 20 s, and the person read "HQ could not be reached." of a release under way.
  it("waits for a release HQ answers in 30 s", async () => {
    await onTheClock(async () => {
      const hq = fakeHq();
      const api = makeHqApi({
        address: ADDRESS,
        fetch: async (input, init) => {
          if (new URL(input).pathname !== "/api/apps/app-1/releases") return hq.fetch(input, init);
          return new Promise<Response>((resolve, reject) => {
            // @effect-diagnostics-next-line globalTimers:off -- HQ's answer, on fake timers.
            const answer = setTimeout(() => resolve(json(201, MADE)), 30_000);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(answer);
              reject(init.signal?.reason);
            });
          });
        },
        throughDoor: doors().throughDoor,
        openSocket: NO_SOCKET,
      });
      const made = api.release("app-1", ASKED);
      const settled = vi.fn();
      made.then(settled, settled);
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(made).resolves.toEqual(MADE);
    });
  });

  /**
   * HQ whose connection drops under each release asked, after HQ made it (`made`) or not; it lists
   * the releases it holds.
   */
  function dropping(made: boolean) {
    const releases: Array<typeof MADE> = [];
    const hq = fakeHq((seen) => {
      if (seen.path !== "/api/apps/app-1/releases") return undefined;
      return seen.method === "GET" ? json(200, { releases }) : undefined;
    });
    const fetch = async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname === "/api/apps/app-1/releases" && init?.method === "POST") {
        await hq.fetch(input, init);
        if (made) releases.push(MADE);
        throw new TypeError("Failed to fetch");
      }
      return hq.fetch(input, init);
    };
    const api = makeHqApi({
      address: ADDRESS,
      fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    const asked = () =>
      hq.seen
        .filter((entry) => entry.path === "/api/apps/app-1/releases")
        .map((entry) => entry.method);
    return { api, asked };
  }

  it("asks HQ what it holds when the connection drops under a release, never asking twice", async () => {
    const { api, asked } = dropping(true);
    await expect(api.release("app-1", ASKED)).resolves.toEqual(MADE);
    expect(asked()).toEqual(["POST", "GET"]);
  });

  it("says to check the project when HQ holds no release after its connection dropped", async () => {
    const { api, asked } = dropping(false);
    await expect(api.release("app-1", ASKED)).rejects.toMatchObject({
      kind: "uncertain",
      message: HQ_WRITE_UNCERTAIN,
    });
    expect(asked()).toEqual(["POST", "GET"]);
  });

  it("stays uncertain when HQ cannot say what it holds either", async () => {
    const hq = fakeHq((seen) => {
      if (seen.path !== "/api/apps/app-1/releases") return undefined;
      if (seen.method === "POST") throw new TypeError("Failed to fetch");
      return json(503, { code: "zerops_unavailable" });
    });
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(api.release("app-1", ASKED)).rejects.toMatchObject({
      kind: "uncertain",
      message: HQ_WRITE_UNCERTAIN,
    });
  });

  // HQ answers a write it could not finish for want of Zerops `503` with `Retry-After` (F22).
  it("asks a write that sets a value again once HQ's Retry-After has passed", async () => {
    await onTheClock(async () => {
      let busy = true;
      const hq = fakeHq((seen) => {
        if (seen.path !== "/api/apps/app-1" || !busy) return undefined;
        busy = false;
        return new Response(JSON.stringify({ code: "zerops_unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json", "retry-after": "2" },
        });
      });
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        throughDoor: doors().throughDoor,
        openSocket: NO_SOCKET,
      });
      const renamed = api.renameApp("app-1", "Harbor");
      const settled = vi.fn();
      renamed.then(settled, settled);
      const patches = () => hq.seen.filter((entry) => entry.method === "PATCH").length;
      await vi.advanceTimersByTimeAsync(1_999);
      expect(patches()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(renamed).resolves.toBeUndefined();
      expect(patches()).toBe(2);
    });
  });

  it("reads a release HQ asked to wait for back, never asking for it twice", async () => {
    const hq = fakeHq((seen) => {
      if (seen.path !== "/api/apps/app-1/releases") return undefined;
      if (seen.method === "GET") return json(200, { releases: [] });
      return new Response(JSON.stringify({ code: "zerops_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "2" },
      });
    });
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(api.release("app-1", ASKED)).rejects.toMatchObject({
      kind: "uncertain",
      message: HQ_WRITE_UNCERTAIN,
    });
    expect(
      hq.seen
        .filter((entry) => entry.path === "/api/apps/app-1/releases")
        .map((entry) => entry.method),
    ).toEqual(["POST", "GET"]);
  });

  it("asks HQ what it holds when a release goes unanswered for 45 s", async () => {
    await onTheClock(async () => {
      const hq = fakeHq((seen) =>
        seen.path === "/api/apps/app-1/releases" && seen.method === "GET"
          ? json(200, { releases: [MADE] })
          : undefined,
      );
      const api = makeHqApi({
        address: ADDRESS,
        fetch: async (input, init) => {
          if (new URL(input).pathname !== "/api/apps/app-1/releases" || init?.method !== "POST") {
            return hq.fetch(input, init);
          }
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          });
        },
        throughDoor: doors().throughDoor,
        openSocket: NO_SOCKET,
      });
      const made = api.release("app-1", ASKED);
      const settled = vi.fn();
      made.then(settled, settled);
      await vi.advanceTimersByTimeAsync(44_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(made).resolves.toEqual(MADE);
    });
  });
});
