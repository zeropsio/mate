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
import { ZEROPS_UNANSWERED } from "./refusals.ts";

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
  return {
    fetch,
    seen,
    expire: () => live.clear(),
    revoke: (session: string) => void live.delete(session),
  };
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

  it("ends a dropped read visibly and reads again only on the next explicit call", async () => {
    const { hq, fetch } = dropping(1);
    const api = makeHqApi({
      address: ADDRESS,
      fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(api.structure()).rejects.toMatchObject({ kind: "unavailable", code: "network" });
    expect(hq.seen.filter((entry) => entry.path === "/api/structure")).toHaveLength(0);
    await expect(api.structure()).resolves.toEqual({ ungrouped: [], apps: [] });
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

  // Audit K7: the account keeps HQ's session across loads, as it keeps the Mates'.
  describe("a kept session", () => {
    /** The account's kept session for this HQ: what it holds, and what it was told. */
    const keptStore = (held: string | null) => {
      let token = held;
      const told: Array<string> = [];
      return {
        told,
        /** Another tab keeps its own session meanwhile. */
        replace: (next: string) => {
          token = next;
        },
        port: {
          read: () => token,
          keep: (session: { readonly token: string; readonly expiresAt: string }) => {
            told.push(`keep ${session.token} until ${session.expiresAt}`);
            token = session.token;
          },
          forget: (forgotten: string) => {
            told.push(`forget ${forgotten}`);
            if (token === forgotten) token = null;
          },
        },
      };
    };

    it("is presented before any door, and the door's session is kept", async () => {
      const hq = fakeHq();
      const door = doors();
      const kept = keptStore(null);
      await makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        throughDoor: door.throughDoor,
        openSocket: NO_SOCKET,
        kept: kept.port,
      }).structure();
      expect(kept.told).toEqual(["keep session-1 until 2026-10-02T20:00:00.000Z"]);

      // The next load presents it, through no door.
      const reloaded = doors();
      await makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        throughDoor: reloaded.throughDoor,
        openSocket: NO_SOCKET,
        kept: kept.port,
      }).structure();
      expect(reloaded.minted).toEqual([]);
      expect(hq.seen.at(-1)?.authorization).toBe("Bearer session-1");
    });

    it("HQ no longer takes is forgotten, and renewed through the door within the call", async () => {
      const hq = fakeHq();
      const kept = keptStore("revoked");
      const door = doors();
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        throughDoor: door.throughDoor,
        openSocket: NO_SOCKET,
        kept: kept.port,
      });
      await api.structure();
      expect(door.minted).toEqual(["door-1"]);
      expect(kept.told).toEqual([
        "forget revoked",
        "keep session-1 until 2026-10-02T20:00:00.000Z",
      ]);
    });

    it("another tab kept meanwhile renews one HQ no longer takes, through no door", async () => {
      const hq = fakeHq();
      const door = doors();
      const kept = keptStore(null);
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        throughDoor: door.throughDoor,
        openSocket: NO_SOCKET,
        kept: kept.port,
      });
      await api.structure();
      // Another tab came through the door at the same time, and its session displaced this one,
      // revoked at HQ.
      await makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        throughDoor: doors().throughDoor,
        openSocket: NO_SOCKET,
      }).structure();
      kept.replace("session-2");
      hq.revoke("session-1");

      await api.structure();
      expect(door.minted).toEqual(["door-1"]);
      expect(hq.seen.at(-1)?.authorization).toBe("Bearer session-2");
    });
  });

  // KRLS, 2026-10-03: one door attempt per HQ at a time — calls that come together join it.
  it("comes through one door for calls that ask at once", async () => {
    const hq = fakeHq();
    const door = doors();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: door.throughDoor,
      openSocket: NO_SOCKET,
    });

    await Promise.all([api.structure(), api.structure(), api.createApp("Acme")]);

    expect(door.minted).toEqual(["door-1"]);
    expect(hq.seen.filter((entry) => entry.path === "/api/door")).toHaveLength(1);
  });

  it("sends a write only once `beforeWrite` lets it, and a read at once", async () => {
    const hq = fakeHq();
    let allow: () => void = () => undefined;
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
      beforeWrite: () =>
        new Promise<void>((resolve) => {
          allow = resolve;
        }),
    });
    await api.structure();
    const created = api.createApp("Acme");
    await Promise.resolve();
    expect(hq.seen.some((entry) => entry.path === "/api/apps")).toBe(false);
    allow();
    await created;
    expect(hq.seen.at(-1)).toMatchObject({ method: "POST", path: "/api/apps" });
  });

  it("refuses a write `beforeWrite` refuses, sending nothing", async () => {
    const hq = fakeHq();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
      beforeWrite: async () => {
        throw new HqError({ kind: "refused", code: "hq_not_official", message: "Not official." });
      },
    });
    await expect(api.createApp("Acme")).rejects.toMatchObject({ code: "hq_not_official" });
    expect(hq.seen.some((entry) => entry.path === "/api/apps")).toBe(false);
  });

  // Key by id (audit K3): the id of the key a Mate's container holds, as the Mate named it to HQ.
  it("reads the id of the key a Mate named, and none where it named none", async () => {
    const hq = fakeHq((seen) =>
      seen.path === "/api/mates/P_ADA/key"
        ? json(200, { keyTokenId: "tok-ada" })
        : seen.path === "/api/mates/P_BEA/key"
          ? json(200, { keyTokenId: null })
          : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    expect([await api.mateKey("P_ADA"), await api.mateKey("P_BEA")]).toEqual(["tok-ada", null]);
  });

  it("renews a session HQ ended once, through the door, and the call goes on", async () => {
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

    await expect(api.structure()).resolves.toEqual({ ungrouped: [], apps: [] });
    expect(door.minted).toEqual(["door-1", "door-2"]);
    expect(hq.seen.map((entry) => `${entry.method} ${entry.path} ${entry.authorization}`)).toEqual([
      "POST /api/door null",
      "GET /api/structure Bearer session-1",
      "GET /api/structure Bearer session-1",
      "POST /api/door null",
      "GET /api/structure Bearer session-2",
    ]);
  });

  it("renews through one door for calls that meet the ended session at once", async () => {
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

    await Promise.all([api.structure(), api.structure(), api.createApp("Acme")]);
    expect(door.minted).toEqual(["door-1", "door-2"]);
  });

  it("ends a session whose renewal HQ refuses too, through one door", async () => {
    let kept: string | null = "kept-session";
    const door = doors();
    const stuck = makeHqApi({
      address: ADDRESS,
      fetch: fakeHq((seen) =>
        seen.path === "/api/structure" ? json(401, { code: "session_required" }) : undefined,
      ).fetch,
      throughDoor: door.throughDoor,
      openSocket: NO_SOCKET,
      kept: {
        read: () => kept,
        keep: () => undefined,
        forget: () => {
          kept = null;
        },
      },
    });
    await expect(stuck.structure()).rejects.toMatchObject({ code: "session_required" });
    expect(door.minted).toEqual(["door-1"]);
  });

  it("ends a session the door has just opened at once when HQ refuses it", async () => {
    const door = doors();
    const stuck = makeHqApi({
      address: ADDRESS,
      fetch: fakeHq((seen) =>
        seen.path === "/api/structure" ? json(401, { code: "session_required" }) : undefined,
      ).fetch,
      throughDoor: door.throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(stuck.structure()).rejects.toMatchObject({ code: "session_required" });
    expect(door.minted).toEqual(["door-1"]);
  });

  it("ends a session truthfully when its renewal's door is refused", async () => {
    const hq = fakeHq((seen) =>
      seen.path === "/api/door" &&
      seen.body !== undefined &&
      (seen.body as { token: string }).token === "door-2"
        ? json(401, { code: "zerops_throwaway_required" })
        : undefined,
    );
    const door = doors();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: door.throughDoor,
      openSocket: NO_SOCKET,
    });
    await api.structure();
    hq.expire();
    await expect(api.structure()).rejects.toMatchObject({
      kind: "refused",
      code: "zerops_throwaway_required",
    });
    expect(door.minted).toEqual(["door-1", "door-2"]);
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

      await expect(api.structure()).resolves.toEqual({ ungrouped: [], apps: [] });
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
    // The owner, 2026-10-05: a write HQ refused because Zerops did not answer its roles wrote
    // nothing — it is no write that may have landed, and says to try again.
    [
      "a write whose roles Zerops left unanswered is refused, not uncertain",
      json(503, { code: "zerops_unanswered" }),
      { kind: "unavailable", code: "zerops_unanswered", message: ZEROPS_UNANSWERED },
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
      { kind: "healthy", build: "b1", parts: { db: "up", quarantined: [] } },
    ],
    [
      // Inside HQ's grace (`official.ts`): it leads and serves, Zerops just does not answer its check.
      "the official HQ leading, its check of Zerops unanswered",
      json(200, { state: "active", official: "unknown", db: "up", epoch: 8, build: "b1" }),
      { kind: "unchecked", build: "b1", parts: { db: "up", quarantined: [] } },
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

describe("readHqHealth — how HQ's parts stand", () => {
  const leading = { state: "active", official: "ok", db: "up", epoch: 8, build: "b1" };
  it.each<[string, Record<string, unknown>, unknown]>([
    [
      "its newest backup, its key and its database",
      { backup: { state: "ok", set: "20261004T120000.000Z" }, keys: "ok" },
      {
        db: "up",
        quarantined: [],
        backup: { state: "ok", takenAt: Date.UTC(2026, 9, 4, 12) },
        keys: "ok",
      },
    ],
    [
      "the repositories it withholds, by name",
      {
        quarantined: [
          { repo: "a1/api", reason: "fsck" },
          { repo: "a2/web", reason: "refs" },
        ],
      },
      { db: "up", quarantined: ["a1/api", "a2/web"] },
    ],
    [
      "a set that cost one the retention keeps, with the bucket's usage",
      {
        backup: {
          state: "degraded",
          set: "20261004T120000.000Z",
          usedBytes: 70,
          neededBytes: 9,
          quotaBytes: 80,
        },
      },
      {
        db: "up",
        quarantined: [],
        backup: {
          state: "degraded",
          takenAt: Date.UTC(2026, 9, 4, 12),
          usage: { usedBytes: 70, neededBytes: 9, quotaBytes: 80 },
        },
      },
    ],
    [
      "a set refused for the bucket's room",
      {
        backup: { state: "failed", reason: "quota", usedBytes: 78, neededBytes: 9, quotaBytes: 80 },
      },
      {
        db: "up",
        quarantined: [],
        backup: {
          state: "failed",
          reason: "quota",
          usage: { usedBytes: 78, neededBytes: 9, quotaBytes: 80 },
        },
      },
    ],
    [
      "a set refused for a repository it withholds",
      { backup: { state: "failed", reason: "repo_quarantined", repo: "a1/api" } },
      {
        db: "up",
        quarantined: [],
        backup: { state: "failed", reason: "repo_quarantined", repo: "a1/api" },
      },
    ],
    [
      "a set that failed for HQ's own reason",
      { backup: { state: "failed", reason: "store" } },
      { db: "up", quarantined: [], backup: { state: "failed", reason: "store" } },
    ],
    [
      "what this build cannot read, left out",
      { db: "maybe", backup: { state: "ok", set: "latest" }, keys: "rotated", quarantined: "x" },
      { quarantined: [] },
    ],
  ])("%s", async (_name, body, parts) => {
    const fetch = async () => json(200, { ...leading, ...body });
    await expect(readHqHealth(fetch, ADDRESS)).resolves.toEqual({
      kind: "healthy",
      build: "b1",
      parts,
    });
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
      ...(attached[0]?.kind === "production" ? {} : { mate: { face: "rose:seal" } }),
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
    await expect(stream.done).rejects.toMatchObject({ code: "socket_1001" });

    expect(socket.url).toBe("wss://hq-30db-8080.prg1.zerops.app/api/structure/ws?ticket=t-1");
    expect(stream.events).toEqual([
      {
        kind: "snapshot",
        appReads: null,
        structure: { ungrouped: [], apps: [] },
        changes: null,
        mates: null,
        people: null,
        presses: {},
      },
      { kind: "change", appId: "app-1", app: { id: "app-1", name: "Acme", projects: [] } },
    ]);
    expect(socket.sent).toEqual([JSON.stringify({ type: "pong" })]);
    expect(stream.alive()).toBe(3);
    expect(hq.seen.map((entry) => `${entry.method} ${entry.path} ${entry.authorization}`)).toEqual([
      "POST /api/door null",
      "POST /api/stream-ticket Bearer session-1",
    ]);
  });

  it("continues a planned segment with a fresh ticket and the same session", async () => {
    const hq = ticketing();
    const door = doors();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: door.throughDoor,
      openSocket: sockets.openSocket,
    });
    const stream = streaming(api);
    (await sockets.next()).on.close(4410);
    const next = await Promise.race([
      sockets.next(),
      stream.done.then(() => {
        throw new Error("stream ended");
      }),
    ]);
    expect(next.url).toContain("ticket=t-2");
    expect(door.minted).toEqual(["door-1"]);
    next.on.close(1006);
    await expect(stream.done).rejects.toMatchObject({ kind: "unavailable", code: "socket_1006" });
    expect(hq.seen.filter((call) => call.path === "/api/stream-ticket")).toHaveLength(2);
  });

  it("surfaces a failed next-segment ticket once", async () => {
    let tickets = 0;
    const hq = fakeHq((seen) =>
      seen.path === "/api/stream-ticket"
        ? ++tickets === 1
          ? json(200, { ticket: "t-1" })
          : json(503, { code: "not_active" })
        : undefined,
    );
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: sockets.openSocket,
    });
    const stream = streaming(api);
    (await sockets.next()).on.close(4410);
    await expect(stream.done).rejects.toMatchObject({ kind: "unavailable", code: "not_active" });
    expect(tickets).toBe(2);
  });

  it("sends the pong before the liveness callback can block or fail", async () => {
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: ticketing().fetch,
      throughDoor: doors().throughDoor,
      openSocket: sockets.openSocket,
    });
    let checkPong = () => undefined;
    const done = api.streamStructure(
      { onEvent: () => undefined, onAlive: () => checkPong() },
      new AbortController().signal,
    );
    const socket = await sockets.next();
    checkPong = () => {
      expect(socket.sent).toEqual([JSON.stringify({ type: "pong" })]);
    };
    socket.on.message(JSON.stringify({ type: "ping" }));
    socket.on.close(1001);
    await expect(done).rejects.toMatchObject({ code: "socket_1001" });
  });

  it.each<[string, number, "resolves" | "rejects"]>([
    ["signals another Core leads now, to be read again at once", 1001, "rejects"],
    ["breaks when HQ could not read the view", 1011, "rejects"],
    ["breaks when the connection dropped", 1006, "rejects"],
    ["breaks when HQ heard no pong", 4408, "rejects"],
    ["breaks on an ordinary clean close", 1000, "rejects"],
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

  it("renews the session HQ ended over the socket (4401) and opens the next socket with it", async () => {
    const hq = ticketing();
    const door = doors();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: door.throughDoor,
      openSocket: sockets.openSocket,
    });
    const stream = streaming(api);
    const first = await sockets.next();
    first.on.message(JSON.stringify({ type: "snapshot", ungrouped: [], apps: [] }));
    hq.expire();
    first.on.close(4401);
    const renewed = await sockets.next();
    expect(renewed.url).toContain("ticket=t-2");
    expect(door.minted).toEqual(["door-1", "door-2"]);
    expect(hq.seen.at(-1)).toMatchObject({
      path: "/api/stream-ticket",
      authorization: "Bearer session-2",
    });
    renewed.on.close(1006);
    await expect(stream.done).rejects.toMatchObject({ kind: "unavailable", code: "socket_1006" });
  });

  it("ends the stream refused when the renewed session's socket is ended (4401) before it said anything", async () => {
    const hq = ticketing();
    const door = doors();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: door.throughDoor,
      openSocket: sockets.openSocket,
    });
    const stream = streaming(api);
    (await sockets.next()).on.close(4401);
    (await sockets.next()).on.close(4401);
    await expect(stream.done).rejects.toMatchObject({
      kind: "refused",
      code: "session_required",
      status: 401,
    });
    expect(door.minted).toEqual(["door-1", "door-2"]);
  });

  // Audit K7: the session HQ ended over the socket is not presented again by the next load.
  it("forgets the kept session HQ ended over the socket (4401), and keeps its renewal", async () => {
    let kept: string | null = null;
    const door = doors();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: ticketing().fetch,
      throughDoor: door.throughDoor,
      openSocket: sockets.openSocket,
      kept: {
        read: () => kept,
        keep: (session) => {
          kept = session.token;
        },
        forget: (token) => {
          if (kept === token) kept = null;
        },
      },
    });
    streaming(api);
    (await sockets.next()).on.close(4401);
    await sockets.next();
    expect(door.minted).toEqual(["door-1", "door-2"]);
    expect(kept).toBe("session-2");
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
    await api.updateMate("p1", { face: "rose:seal:named" });
    expect(hq.seen.at(-1)).toMatchObject({
      method: "PATCH",
      path: "/api/mates/p1",
      body: { face: "rose:seal:named" },
    });
  });
});

describe("makeHqApi — a Mate's birth intent", () => {
  it("records where and with which face a Mate is born, before its project, and answers its id", async () => {
    const intent = { id: "b-1", face: "rose:seal" };
    const hq = fakeHq((seen) => (seen.path === "/api/births" ? json(201, intent) : undefined));
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    expect(await api.recordBirth({ appId: "app-1", face: "rose:seal" })).toEqual(intent);
    expect(hq.seen.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/births",
      body: { appId: "app-1", face: "rose:seal" },
    });
  });

  // Audit B3: the ask rides in the intent, so the attach that closes it records the Mate and its
  // ask in one write.
  it("records a stand-up ask with the intent", async () => {
    const hq = fakeHq((seen) =>
      seen.path === "/api/births" ? json(201, { id: "b-1", face: "" }) : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await api.recordBirth({ appId: "app-1", face: "", standUp: true });
    expect(hq.seen.at(-1)).toMatchObject({
      path: "/api/births",
      body: { appId: "app-1", face: "", standUp: true },
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
      (api) => api.createMate({ projectId: "p1", face: "sky:flower:named" }),
      {
        method: "POST",
        path: "/api/mates",
        body: { projectId: "p1", face: "sky:flower:named" },
      },
    ],
    // Audit B3: the ask in the write that records the Mate, never a call of its own.
    [
      "sets a Mate up asking for its stand-up",
      (api) => api.createMate({ projectId: "p1", face: "", standUp: true }),
      {
        method: "POST",
        path: "/api/mates",
        body: { projectId: "p1", face: "", standUp: true },
      },
    ],
    [
      "attaches a Mate asking for its stand-up",
      (api) =>
        api.attachProject("app-1", {
          projectId: "p1",
          kind: "mate",
          mate: { face: "", standUp: true },
        }),
      {
        method: "POST",
        path: "/api/apps/app-1/projects",
        body: { projectId: "p1", kind: "mate", mate: { face: "", standUp: true } },
      },
    ],
    [
      "records that a Mate's project is closed off",
      (api) => api.recordClosedOff("p1"),
      { method: "POST", path: "/api/mates/p1/closed-off" },
    ],
    // ADR 0003's fallout: once Finish setup took a widened key's siblings off, HQ reads it again.
    [
      "asks HQ to read a Mate's widened key again",
      (api) => api.recheckKey("p1"),
      { method: "POST", path: "/api/mates/p1/key-check" },
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

/** What HQ answers of the deploys an event asked for. */
const DEPLOYS = {
  jobs: [
    {
      environment: "stage",
      kind: "deploy",
      service: "api",
      sha: "a".repeat(40),
      job: "7",
      state: "building",
      processId: "process-1",
      behind: null,
      reason: null,
    },
  ],
  note: null,
} as const;

// Main B36/B37, audit D2: "Run again" and "Add <service>" answer where HQ's submission stands.
describe("makeHqApi — a person's deploys", () => {
  it.each<
    [string, (api: HqApi) => Promise<unknown>, { readonly path: string; readonly body: unknown }]
  >([
    [
      "asks an environment's deploy of a service again",
      (hqApi) => hqApi.redeploy("app-1", "stage", { service: "api", sha: "a".repeat(40) }),
      {
        path: "/api/apps/app-1/environments/stage/redeploy",
        body: { service: "api", sha: "a".repeat(40) },
      },
    ],
    [
      "adds a service the environment's tier declares",
      (hqApi) => hqApi.addService("app-1", "stage", "cache"),
      { path: "/api/apps/app-1/environments/stage/services", body: { service: "cache" } },
    ],
  ])("%s, and reads where HQ's submission stands", async (_name, ask, expected) => {
    const hq = fakeHq((seen) =>
      seen.path === expected.path ? json(200, { deploys: DEPLOYS }) : undefined,
    );
    const hqApi = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(ask(hqApi)).resolves.toEqual(DEPLOYS);
    expect(hq.seen.at(-1)).toMatchObject({ method: "POST", ...expected });
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
    ready: true,
    // HQ counts what was said on it, with the change.
    comments: 2,
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

  it("asks HQ for the head and main displayed in the review", async () => {
    const { hq, api: hqApi } = api(() => json(200, DETAIL));
    const snapshot = { expectedHead: "a".repeat(40), expectedMain: "b".repeat(40) };
    await hqApi.change(LINK, undefined, snapshot);
    expect(hq.seen.at(-1)?.search).toBe(
      `?expectedHead=${snapshot.expectedHead}&expectedMain=${snapshot.expectedMain}`,
    );
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
      seen.path === "/api/apps/app-1/changes/app/3/merge"
        ? json(200, { ...MERGED, deploys: DEPLOYS })
        : undefined,
    );
    // Beside it, where the deploys it asked for stand once HQ submitted them.
    await expect(hqApi.mergeChange(LINK, SHA)).resolves.toEqual({ made: MERGED, deploys: DEPLOYS });
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

  // The Mate tier a new Mate starts from, read on demand where HQ's stream does not carry it — a
  // Core from before it did (SPEC §3.2c).
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
    await expect(hqApi.mateRecipe("app-1")).resolves.toEqual(tier);
    expect(hq.seen.at(-1)).toMatchObject({ method: "GET", authorization: "Bearer session-1" });
  });

  it("says a recipe too large to read in words of its own", async () => {
    const { api: hqApi } = api(() => json(413, { code: "too_large", reason: "recipe_too_large" }));
    await expect(hqApi.mateRecipe("app-1")).rejects.toMatchObject({
      kind: "refused",
      code: "too_large",
      message: "This project's recipe is too large to read here.",
    });
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

  it("releases what the offer showed, and rolls back with main's head read with the offer", async () => {
    const { hq, api: hqApi } = api((seen) =>
      seen.method === "POST" && seen.path.startsWith("/api/apps/app-1/releases")
        ? json(201, RELEASE)
        : undefined,
    );
    const request = { tag: "v0.1.1", groupHead: SHA, entries: RELEASE.entries };
    await expect(hqApi.release("app-1", request)).resolves.toEqual({
      made: RELEASE,
      deploys: undefined,
    });
    await expect(hqApi.rollback("app-1", "v0.1.0", { groupHead: SHA })).resolves.toEqual({
      made: RELEASE,
      deploys: undefined,
    });
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

  // A write whose answer was lost (F22): what HQ holds now decides, read back once.
  const ROLLED = { ...RELEASE, tag: "v0.1.2", rollbackOf: "v0.1.0" } as const;
  const HARBOR = { id: "app-1", name: "Harbor", projects: [] };
  it.each<{
    readonly name: string;
    readonly write: { readonly method: string; readonly path: string };
    readonly holds: (seen: Seen) => Response | undefined;
    readonly ask: (hqApi: HqApi) => Promise<unknown>;
    readonly made: unknown;
  }>([
    {
      name: "a merge HQ holds merged",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/merge" },
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3"
          ? json(200, { ...DETAIL, change: { ...CHANGE, state: "merged" } })
          : undefined,
      ask: (hqApi) => hqApi.mergeChange(LINK, SHA),
      // Its deploys are HQ's stream's to bring.
      made: { made: { ...CHANGE, state: "merged" }, deploys: undefined },
    },
    {
      name: "a close HQ holds closed",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/close" },
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3"
          ? json(200, { ...DETAIL, change: { ...CHANGE, state: "closed" } })
          : undefined,
      ask: (hqApi) => hqApi.closeChange(LINK),
      made: { ...CHANGE, state: "closed" },
    },
    {
      name: "a comment HQ holds as the newest said",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/comments" },
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3/comments"
          ? json(200, { comments: [COMMENT] })
          : undefined,
      ask: (hqApi) => hqApi.commentOnChange(LINK, COMMENT.body),
      made: COMMENT,
    },
    {
      name: "a roll back HQ holds as its newest release",
      write: { method: "POST", path: "/api/apps/app-1/releases/v0.1.0/rollback" },
      holds: (seen) =>
        seen.path === "/api/apps/app-1/releases"
          ? json(200, { releases: [ROLLED, RELEASE] })
          : undefined,
      ask: (hqApi) => hqApi.rollback("app-1", "v0.1.0", { groupHead: SHA }),
      made: { made: ROLLED, deploys: undefined },
    },
    {
      name: "a name HQ holds",
      write: { method: "PATCH", path: "/api/apps/app-1" },
      holds: (seen) =>
        seen.path === "/api/structure" ? json(200, { ungrouped: [], apps: [HARBOR] }) : undefined,
      ask: (hqApi) => hqApi.renameApp("app-1", "Harbor"),
      made: undefined,
    },
    {
      name: "an application HQ holds no more",
      write: { method: "DELETE", path: "/api/apps/app-1" },
      holds: (seen) =>
        seen.path === "/api/structure" ? json(200, { ungrouped: [], apps: [] }) : undefined,
      ask: (hqApi) => hqApi.deleteApp("app-1"),
      made: undefined,
    },
    {
      name: "a project HQ holds in the application",
      write: { method: "POST", path: "/api/apps/app-1/projects" },
      holds: (seen) =>
        seen.path === "/api/structure"
          ? json(200, {
              ungrouped: [],
              apps: [
                {
                  ...HARBOR,
                  projects: [{ projectId: "p9", name: "p9", kind: "stage", mate: null }],
                },
              ],
            })
          : undefined,
      ask: (hqApi) => hqApi.attachProject("app-1", { projectId: "p9", kind: "stage" }),
      made: undefined,
    },
    {
      name: "an application HQ holds by its name",
      write: { method: "POST", path: "/api/apps" },
      holds: (seen) =>
        seen.path === "/api/structure" ? json(200, { ungrouped: [], apps: [HARBOR] }) : undefined,
      ask: (hqApi) => hqApi.createApp("Harbor"),
      made: { id: "app-1", name: "Harbor" },
    },
    {
      name: "a Mate HQ holds by its project",
      write: { method: "POST", path: "/api/mates" },
      holds: (seen) =>
        seen.path === "/api/structure"
          ? json(200, {
              ungrouped: [{ projectId: "p7", name: "p7", mate: { face: "sky" } }],
              apps: [],
            })
          : undefined,
      ask: (hqApi) => hqApi.createMate({ projectId: "p7", face: "sky" }),
      made: undefined,
    },
  ])("takes $name for made when its answer was lost", async ({ write, holds, ask, made }) => {
    const { hq, api: hqApi } = api((seen) => {
      if (seen.method === write.method && seen.path === write.path) {
        throw new TypeError("Failed to fetch");
      }
      return holds(seen);
    });
    await expect(ask(hqApi)).resolves.toEqual(made);
    expect(
      hq.seen.filter((entry) => entry.method === write.method && entry.path === write.path),
    ).toHaveLength(1);
  });

  // HQ finishes a write whose client went away (F22): pressed again, it can meet itself as a refusal.
  it.each<{
    readonly name: string;
    readonly write: { readonly method: string; readonly path: string };
    readonly reason: string;
    readonly holds: (seen: Seen) => Response | undefined;
    readonly ask: (hqApi: HqApi) => Promise<unknown>;
    readonly made: unknown;
  }>([
    {
      name: "a release whose tag HQ holds at the same main and commits",
      write: { method: "POST", path: "/api/apps/app-1/releases" },
      reason: "tag_taken",
      holds: (seen) =>
        seen.path === "/api/apps/app-1/releases" ? json(200, { releases: [RELEASE] }) : undefined,
      ask: (hqApi) =>
        hqApi.release("app-1", { tag: RELEASE.tag, groupHead: SHA, entries: RELEASE.entries }),
      made: { made: RELEASE, deploys: undefined },
    },
    {
      name: "a merge of a change HQ holds merged",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/merge" },
      reason: "already_merged",
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3"
          ? json(200, { ...DETAIL, change: { ...CHANGE, state: "merged" } })
          : undefined,
      ask: (hqApi) => hqApi.mergeChange(LINK, SHA),
      made: { made: { ...CHANGE, state: "merged" }, deploys: undefined },
    },
    {
      name: "a merge of a change no longer open, HQ holding it merged",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/merge" },
      reason: "change_not_open",
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3"
          ? json(200, { ...DETAIL, change: { ...CHANGE, state: "merged" } })
          : undefined,
      ask: (hqApi) => hqApi.mergeChange(LINK, SHA),
      made: { made: { ...CHANGE, state: "merged" }, deploys: undefined },
    },
    {
      name: "a close of a change no longer open, HQ holding it closed",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/close" },
      reason: "change_not_open",
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3"
          ? json(200, { ...DETAIL, change: { ...CHANGE, state: "closed" } })
          : undefined,
      ask: (hqApi) => hqApi.closeChange(LINK),
      made: { ...CHANGE, state: "closed" },
    },
    {
      name: "a release whose tag HQ holds at another main",
      write: { method: "POST", path: "/api/apps/app-1/releases" },
      reason: "tag_taken",
      holds: (seen) =>
        seen.path === "/api/apps/app-1/releases"
          ? json(200, { releases: [{ ...RELEASE, sha: "c".repeat(40) }] })
          : undefined,
      ask: (hqApi) =>
        hqApi.release("app-1", { tag: RELEASE.tag, groupHead: SHA, entries: RELEASE.entries }),
      made: "refused",
    },
    {
      name: "a close of a change HQ holds merged",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/close" },
      reason: "change_not_open",
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3"
          ? json(200, { ...DETAIL, change: { ...CHANGE, state: "merged" } })
          : undefined,
      ask: (hqApi) => hqApi.closeChange(LINK),
      made: "refused",
    },
    {
      name: "an application whose name HQ holds",
      write: { method: "POST", path: "/api/apps" },
      reason: "app_name_taken",
      holds: (seen) =>
        seen.path === "/api/structure" ? json(200, { ungrouped: [], apps: [HARBOR] }) : undefined,
      ask: (hqApi) => hqApi.createApp("Harbor"),
      made: "refused",
    },
  ])(
    "refused as $name, takes it for made only where HQ holds it so",
    async ({ write, reason, holds, ask, made }) => {
      const { api: hqApi } = api((seen) =>
        seen.method === write.method && seen.path === write.path
          ? json(409, { code: "conflict", reason })
          : holds(seen),
      );
      if (made === "refused") {
        await expect(ask(hqApi)).rejects.toMatchObject({ kind: "refused", code: "conflict" });
      } else {
        await expect(ask(hqApi)).resolves.toEqual(made);
      }
    },
  );

  it("says to check the project when HQ still holds the change open after its merge was lost", async () => {
    const { api: hqApi } = api((seen) => {
      if (seen.path.endsWith("/merge")) throw new TypeError("Failed to fetch");
      return seen.path === "/api/apps/app-1/changes/app/3" ? json(200, DETAIL) : undefined;
    });
    await expect(hqApi.mergeChange(LINK, SHA)).rejects.toMatchObject({
      kind: "uncertain",
      message: HQ_WRITE_UNCERTAIN,
    });
  });

  it.each(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"])(
    "fetches a private %s picture with the session and its MIME type",
    async (contentType) => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const { hq, api: hqApi } = api((seen) =>
        seen.path === "/api/apps/app-1/changes/app/3/attachments/shot1"
          ? new Response(png, { status: 200, headers: { "content-type": contentType } })
          : undefined,
      );
      const picture = await hqApi.changeAttachment({ ...LINK, id: "shot1" });
      expect(new Uint8Array(await picture.arrayBuffer())).toEqual(png);
      expect(picture.type).toBe(contentType);
      expect(hq.seen.at(-1)).toMatchObject({
        authorization: "Bearer session-1",
        accept: "image/png, image/jpeg, image/gif, image/webp, image/avif",
      });
    },
  );
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
      await expect(made).resolves.toEqual({ made: MADE, deploys: undefined });
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
    await expect(api.release("app-1", ASKED)).resolves.toEqual({ made: MADE, deploys: undefined });
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

  it.each<{
    readonly name: string;
    readonly ask: (api: HqApi) => Promise<void>;
  }>([
    { name: "face", ask: (api) => api.updateMate("p1", { face: "sky" }) },
    { name: "project move", ask: (api) => api.moveProject("p1", { appId: null, kind: "mate" }) },
    { name: "deploy token", ask: (api) => api.keepDeployToken("app-1", "stage", "token") },
    { name: "deletion completion", ask: (api) => api.completeProjectDeletion("p1", "completion") },
  ])("a failed $name write stays uncertain and manual Again writes once", async ({ ask }) => {
    let failed = true;
    const writes: Seen[] = [];
    const hq = fakeHq((seen) => {
      if (seen.path === "/api/door") return undefined;
      writes.push(seen);
      return failed ? json(503, { code: "internal_error" }) : new Response(null, { status: 204 });
    });
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(ask(api)).rejects.toMatchObject({
      kind: "uncertain",
      message: HQ_WRITE_UNCERTAIN,
    });
    expect(writes).toHaveLength(1);
    failed = false;
    await expect(ask(api)).resolves.toBeUndefined();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
  });

  it("confirms a name already held after a 503 without sending the write again", async () => {
    const hq = fakeHq((seen) => {
      if (seen.path === "/api/apps/app-1") return json(503, { code: "internal_error" });
      if (seen.path === "/api/structure")
        return json(200, { apps: [{ id: "app-1", name: "Harbor", projects: [] }] });
      return undefined;
    });
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(api.renameApp("app-1", "Harbor")).resolves.toBeUndefined();
    expect(hq.seen.filter((seen) => seen.path !== "/api/door").map((seen) => seen.method)).toEqual([
      "PATCH",
      "GET",
    ]);
  });

  it("ends a 503 write visibly despite Retry-After, and writes again only when asked", async () => {
    let busy = true;
    const hq = fakeHq((seen) => {
      if (seen.path !== "/api/apps/app-1" || !busy) return undefined;
      busy = false;
      return new Response(JSON.stringify({ code: "zerops_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "0" },
      });
    });
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    await expect(api.renameApp("app-1", "Harbor")).rejects.toMatchObject({
      kind: "uncertain",
      message: HQ_WRITE_UNCERTAIN,
    });
    expect(hq.seen.filter((entry) => entry.method === "PATCH")).toHaveLength(1);
    await api.renameApp("app-1", "Harbor");
    expect(hq.seen.filter((entry) => entry.method === "PATCH")).toHaveLength(2);
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
      await expect(made).resolves.toEqual({ made: MADE, deploys: undefined });
    });
  });
});

describe("makeHqApi — explicit deletion completion", () => {
  it("passes the scoped handle once and shows HQ refusal for a manual Again", async () => {
    let refuse = true;
    const hq = fakeHq((seen) =>
      seen.path.endsWith("/deletion")
        ? json(200, { completion: "scoped-handle" })
        : seen.path.endsWith("/deleted")
          ? refuse
            ? json(409, { code: "conflict", reason: "project_still_exists" })
            : json(200, { projectId: "P_MATE" })
          : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      throughDoor: doors().throughDoor,
      openSocket: NO_SOCKET,
    });
    const completion = await api.prepareProjectDeletion("P_MATE");
    await expect(api.completeProjectDeletion("P_MATE", completion)).rejects.toMatchObject({
      reason: "project_still_exists",
    });
    expect(hq.seen.filter((seen) => seen.path.endsWith("/deleted"))).toEqual([
      expect.objectContaining({ method: "POST", body: { completion: "scoped-handle" } }),
    ]);
    refuse = false;
    await api.completeProjectDeletion("P_MATE", completion);
    expect(hq.seen.filter((seen) => seen.path.endsWith("/deletion"))).toHaveLength(1);
    expect(hq.seen.filter((seen) => seen.path.endsWith("/deleted"))).toHaveLength(2);
  });
});
