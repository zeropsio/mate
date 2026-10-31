import type {
  HqRemoteRefusalReason,
  HqGitEnvironmentRefusalReason,
} from "@t3tools/shared/hqGitTargets";
import { describe, expect, it, vi } from "@effect/vitest";

import {
  HQ_WRITE_UNCERTAIN,
  HqError,
  makeHqApi,
  readHqParts,
  type HqApi,
  type OpenHqSocket,
} from "./client.ts";
import { ZEROPS_UNANSWERED } from "./refusals.ts";

/** No socket is opened by a call that is no structure stream. */
const NO_SOCKET: OpenHqSocket = () => {
  throw new Error("no socket in this test");
};

import * as DateTime from "effect/DateTime";

const isoAt = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const ORG = "org-1";
const FAR = Date.parse("2099-01-01T00:00:00.000Z");
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

/** An HQ that admits every access token `access-<n>` and answers each session's calls. */
function fakeHq(
  answer: (seen: Seen) => Response | undefined = () => undefined,
  endsAt: () => string = () => "2099-01-01T00:00:00.000Z",
) {
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
      // A renewal presents a live session and keeps its id.
      const presented = request.authorization?.replace("Bearer ", "") ?? "";
      const session = live.has(presented) ? presented : `session-${++sessions}`;
      live.add(session);
      return json(200, { session, expiresAt: endsAt(), userId: "u1" });
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
    accessToken: async () => {
      const token = `access-${minted.length + 1}`;
      minted.push(token);
      return token;
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(api.structure()).rejects.toMatchObject({ kind: "unavailable", code: "network" });
  });

  it("never tries again what HQ answered, nor what its caller stopped", async () => {
    let calls = 0;
    const answering = async () => {
      calls += 1;
      return json(503, { code: "unavailable" });
    };
    const api = makeHqApi({
      address: ADDRESS,
      fetch: async (input, init) =>
        new URL(input).pathname === "/api/door" ? fakeHq().fetch(input, init) : answering(),
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });

    await api.structure();
    await api.createApp("Acme");

    expect(door.minted).toEqual(["access-1"]);
    expect(hq.seen.map((entry) => [entry.method, entry.path, entry.authorization])).toEqual([
      ["POST", "/api/door", null],
      ["GET", "/api/structure", "Bearer session-1"],
      ["POST", "/api/apps", "Bearer session-1"],
    ]);
    expect(hq.seen[0]?.body).toEqual({ accessToken: "access-1", orgId: "org-1" });
  });

  describe("renewal", () => {
    const renewing = (endsAt: () => string) => fakeHq(() => undefined, endsAt);

    it("renews a session near its end with a current access token and the session as bearer, keeping its id", async () => {
      let clock = Date.parse("2026-10-24T08:00:00.000Z");
      const hq = renewing(() => isoAt(clock + 12 * 3_600_000));
      const door = doors();
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: door.accessToken,
        orgId: ORG,
        now: () => clock,
        openSocket: NO_SOCKET,
      });
      await api.structure();
      clock += 11 * 3_600_000 + 50 * 60_000;
      await api.structure();
      expect(
        hq.seen.map((entry) => [entry.path, entry.authorization, (entry.body as any)?.accessToken]),
      ).toEqual([
        ["/api/door", null, "access-1"],
        ["/api/structure", "Bearer session-1", undefined],
        ["/api/door", "Bearer session-1", "access-2"],
        ["/api/structure", "Bearer session-1", undefined],
      ]);
    });

    it("does not renew a session with time left", async () => {
      const clock = Date.parse("2026-10-24T08:00:00.000Z");
      const hq = renewing(() => isoAt(clock + 12 * 3_600_000));
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: doors().accessToken,
        orgId: ORG,
        now: () => clock + 3_600_000,
        openSocket: NO_SOCKET,
      });
      await api.structure();
      await api.structure();
      expect(hq.seen.filter((entry) => entry.path === "/api/door")).toHaveLength(1);
    });
  });

  it("starts an organisation HQ has not started with the key an Owner mints", async () => {
    let started = false;
    const hq = fakeHq((seen) => {
      if (seen.path !== "/api/door") return undefined;
      const body = seen.body as { orgKey?: string };
      if (body.orgKey === undefined && !started) return json(409, { code: "org_not_started" });
      started = true;
      return undefined;
    });
    const deleted: string[] = [];
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
      startOrganisation: {
        mayStart: async () => true,
        withLock: (_name, run) => run(),
        mintKey: async () => ({ id: "key-1", token: "org-key-token" }),
        deleteKey: async (id) => void deleted.push(id),
      },
    });
    await api.structure();
    expect(hq.seen.filter((e) => e.path === "/api/door").map((e) => e.body)).toMatchObject([
      { orgId: ORG },
      { orgId: ORG },
      { orgId: ORG, orgKey: "org-key-token" },
    ]);
    expect(deleted).toEqual([]);
  });

  it.each([
    { status: 403, code: "org_key_refused", mayStart: true, mints: 1 },
    { status: 403, code: "org_key_refused", mayStart: false, mints: 0 },
    { status: 503, code: "zerops_unavailable", mayStart: true, mints: 0 },
  ])(
    "An Owner replaces a refused organisation key, but a Zerops outage mints nothing: $code / $mayStart",
    async ({ status, code, mayStart, mints }) => {
      const minted: string[] = [];
      const locks: string[] = [];
      const hq = fakeHq((seen) => {
        if (seen.path !== "/api/door") return undefined;
        return (seen.body as { orgKey?: string }).orgKey === "new-org-key"
          ? undefined
          : json(status, { code });
      });
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: doors().accessToken,
        orgId: ORG,
        openSocket: NO_SOCKET,
        startOrganisation: {
          mayStart: async () => mayStart,
          withLock: (name, run) => {
            locks.push(name);
            return run();
          },
          mintKey: async () => {
            minted.push("new-org-key");
            return { id: "key-2", token: "new-org-key" };
          },
          deleteKey: async () => undefined,
        },
      });
      const result = await api.structure().catch((cause: unknown) => cause);
      expect(minted).toHaveLength(mints);
      if (mints === 1) {
        expect(result).toEqual({ ungrouped: [], apps: [] });
        expect(locks).toEqual(["mate.org-key.org-1"]);
        expect(
          hq.seen.filter((entry) => entry.path === "/api/door").map((entry) => entry.body),
        ).toEqual([
          { accessToken: "access-1", orgId: ORG },
          { accessToken: "access-2", orgId: ORG },
          { accessToken: "access-3", orgId: ORG, orgKey: "new-org-key" },
        ]);
      } else {
        expect(result).toMatchObject({ code });
        expect(locks).toEqual([]);
      }
    },
  );

  it.each([
    { status: 403, code: "org_key_refused", minted: ["new-org-key"] },
    { status: 503, code: "zerops_unavailable", minted: [] },
  ])(
    "An Owner renewing HQ replaces a refused key and keeps the session, but never mints on $code unavailability",
    async ({ status, code, minted }) => {
      const now = Date.parse("2026-10-24T12:00:00Z");
      const keys: string[] = [];
      const kept: string[] = [];
      const requests: Array<{ authorization: string | null; body: unknown }> = [];
      const api = makeHqApi({
        address: ADDRESS,
        orgId: ORG,
        now: () => now,
        accessToken: async () => "access",
        openSocket: NO_SOCKET,
        kept: {
          read: () => ({ token: "kept-session", expiresAtMs: now + 10 * 60_000 }),
          keep: ({ token }) => {
            kept.push(token);
          },
          forget: () => undefined,
        },
        startOrganisation: {
          mayStart: async () => true,
          withLock: (_name, run) => run(),
          mintKey: async () => {
            keys.push("new-org-key");
            return { id: "key-2", token: "new-org-key" };
          },
          deleteKey: async () => undefined,
        },
        fetch: async (url, init) => {
          if (!url.endsWith("/api/door")) return json(200, { apps: [] });
          const body = JSON.parse(String(init?.body)) as { orgKey?: string };
          requests.push({ authorization: new Headers(init?.headers).get("authorization"), body });
          return body.orgKey === "new-org-key"
            ? json(200, {
                session: "kept-session",
                expiresAt: isoAt(now + 24 * 3_600_000),
                userId: "u1",
              })
            : json(status, { code });
        },
      });
      await api.structure();
      expect(keys).toEqual(minted);
      expect(requests.map((request) => request.authorization)).toEqual(
        minted.length === 1
          ? ["Bearer kept-session", "Bearer kept-session", "Bearer kept-session"]
          : ["Bearer kept-session"],
      );
      expect(kept).toEqual(minted.length === 1 ? ["kept-session"] : []);
    },
  );

  it("asks Zerops for a new access token once when HQ refuses the one it sent as not a person's", async () => {
    const asked: Array<string | undefined> = [];
    let first = true;
    const hq = fakeHq((seen) => {
      if (seen.path !== "/api/door" || !first) return undefined;
      first = false;
      return json(401, { code: "zerops_person_required" });
    });
    await makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: async (refused) => {
        asked.push(refused);
        return refused === undefined ? "stale" : "fresh";
      },
      orgId: ORG,
      openSocket: NO_SOCKET,
    }).structure();
    expect(asked).toEqual([undefined, "stale"]);
    expect(hq.seen.filter((e) => e.path === "/api/door").map((e) => e.body)).toEqual([
      { accessToken: "stale", orgId: ORG },
      { accessToken: "fresh", orgId: ORG },
    ]);
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
          read: () => (token === null ? null : { token, expiresAtMs: FAR }),
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
        accessToken: door.accessToken,
        orgId: ORG,
        openSocket: NO_SOCKET,
        kept: kept.port,
      }).structure();
      expect(kept.told).toEqual(["keep session-1 until 2099-01-01T00:00:00.000Z"]);

      // The next load presents it, through no door.
      const reloaded = doors();
      await makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: reloaded.accessToken,
        orgId: ORG,
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
        accessToken: door.accessToken,
        orgId: ORG,
        openSocket: NO_SOCKET,
        kept: kept.port,
      });
      await api.structure();
      expect(door.minted).toEqual(["access-1"]);
      expect(kept.told).toEqual([
        "forget revoked",
        "keep session-1 until 2099-01-01T00:00:00.000Z",
      ]);
    });

    it("another tab kept meanwhile renews one HQ no longer takes, through no door", async () => {
      const hq = fakeHq();
      const door = doors();
      const kept = keptStore(null);
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: door.accessToken,
        orgId: ORG,
        openSocket: NO_SOCKET,
        kept: kept.port,
      });
      await api.structure();
      // Another tab came through the door at the same time, and its session displaced this one,
      // revoked at HQ.
      await makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: doors().accessToken,
        orgId: ORG,
        openSocket: NO_SOCKET,
      }).structure();
      kept.replace("session-2");
      hq.revoke("session-1");

      await api.structure();
      expect(door.minted).toEqual(["access-1"]);
      expect(hq.seen.at(-1)?.authorization).toBe("Bearer session-2");
    });
  });

  // Example Org, 2026-10-03: one door attempt per HQ at a time — calls that come together join it.
  it("comes through one door for calls that ask at once", async () => {
    const hq = fakeHq();
    const door = doors();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });

    await Promise.all([api.structure(), api.structure(), api.createApp("Acme")]);

    expect(door.minted).toEqual(["access-1"]);
    expect(hq.seen.filter((entry) => entry.path === "/api/door")).toHaveLength(1);
  });

  it("renews a session HQ ended once, through the door, and the call goes on", async () => {
    const hq = fakeHq();
    const door = doors();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await api.structure();
    hq.expire();

    await expect(api.structure()).resolves.toEqual({ ungrouped: [], apps: [] });
    expect(door.minted).toEqual(["access-1", "access-2"]);
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
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await api.structure();
    hq.expire();

    await Promise.all([api.structure(), api.structure(), api.createApp("Acme")]);
    expect(door.minted).toEqual(["access-1", "access-2"]);
  });

  it("ends a session whose renewal HQ refuses too, through one door", async () => {
    let kept: string | null = "kept-session";
    const door = doors();
    const stuck = makeHqApi({
      address: ADDRESS,
      fetch: fakeHq((seen) =>
        seen.path === "/api/structure" ? json(401, { code: "session_required" }) : undefined,
      ).fetch,
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
      kept: {
        read: () => (kept === null ? null : { token: kept, expiresAtMs: FAR }),
        keep: () => undefined,
        forget: () => {
          kept = null;
        },
      },
    });
    await expect(stuck.structure()).rejects.toMatchObject({ code: "session_required" });
    expect(door.minted).toEqual(["access-1"]);
  });

  it("ends a session the door has just opened at once when HQ refuses it", async () => {
    const door = doors();
    const stuck = makeHqApi({
      address: ADDRESS,
      fetch: fakeHq((seen) =>
        seen.path === "/api/structure" ? json(401, { code: "session_required" }) : undefined,
      ).fetch,
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(stuck.structure()).rejects.toMatchObject({ code: "session_required" });
    expect(door.minted).toEqual(["access-1"]);
  });

  it("ends a session truthfully when its renewal's door is refused", async () => {
    const hq = fakeHq((seen) =>
      seen.path === "/api/door" &&
      seen.body !== undefined &&
      (seen.body as { accessToken: string }).accessToken === "access-2"
        ? json(401, { code: "zerops_throwaway_required" })
        : undefined,
    );
    const door = doors();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await api.structure();
    hq.expire();
    await expect(api.structure()).rejects.toMatchObject({
      kind: "refused",
      code: "zerops_throwaway_required",
    });
    expect(door.minted).toEqual(["access-1", "access-2"]);
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
        accessToken: door.accessToken,
        orgId: ORG,
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
      expect(door.minted).toEqual(["access-1", "access-2"]);
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
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    const failure = await api.createApp("Acme").catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HqError);
    expect(failure).toMatchObject(expected);
  });
});

describe("Git token refusals", () => {
  const intent = {
    kind: "connect-git-remote" as const,
    orgId: "org",
    appId: "app",
    hqProjectId: "hq",
    repo: "recipe",
    url: "https://github.com/example/repository.git",
  };

  const refusal = (body: unknown, status = 409) => {
    const hq = fakeHq((seen) =>
      seen.path === "/api/git-targets/token-test" ? json(status, body) : undefined,
    );
    return makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    }).gitTargetWrite("token-test", intent, "candidate");
  };

  const remoteCases = {
    remote_taken:
      "This repository is already connected to another project. Disconnect it under Repositories on that project's page, or use another repository.",
    no_key:
      "HQ cannot save this token yet. Ask your HQ administrator to configure its encryption key, then try again.",
    no_remote: "This repository has no connection. Connect it before continuing.",
    not_repo:
      "This repository is no longer in the application. Choose a repository from its current list.",
    not_structure_writer:
      "Your role cannot change repository connections. Ask an organization owner or admin to do this.",
    membership_unknown:
      "Mate could not verify your organization membership. Try again when Zerops is available.",
    custodian_removed:
      "The person who supplied this token has left the organization. Replace the token.",
    credential_invalid:
      "The saved token was refused. Replace it with a token that can write to this repository.",
    disconnect_required:
      "Another repository is connected here. Remove its Git environments and disconnect it before connecting this one.",
    address_review:
      "The repository address changed. Review and confirm its new address before continuing.",
    repository_changed:
      "This address now points to a different repository. Check the address or disconnect the old repository before connecting another.",
    changed:
      "The connection changed while Mate checked it. Review the current connection and try again.",
    in_use: "Git environments still use this connection. Remove them before disconnecting it.",
    bad_address:
      "This repository address is not supported. Enter its HTTPS address without credentials or query parameters.",
    bad_repo: "This repository name is not valid. Choose a code repository with a valid name.",
    bad_branch: "This branch name is not valid. Enter a valid Git branch name.",
    key_unavailable: "HQ cannot open the saved token. Replace it with a new token.",
    app_not_installed:
      "The organization's GitHub app isn't installed on this repository. Add the repository to the app on GitHub, then try again.",
    app_unavailable:
      "GitHub didn't let the organization's GitHub app act on this repository just now. Check the app's installation on GitHub, then try again.",
    object_too_large:
      "A file in this repository's history is larger than 100 MiB. HQ takes files up to 100 MiB, as GitHub does.",
  } satisfies Record<HqRemoteRefusalReason, string>;
  it.each(Object.entries(remoteCases))(
    "Every repository connection refusal explains %s and the next step",
    async (reason, message) => {
      await expect(refusal({ code: "remote_refused", reason })).rejects.toMatchObject({ message });
    },
  );

  const environmentCases = {
    forbidden:
      "Your role cannot change Git environments. Ask an organization owner or admin to do this.",
    app_not_found:
      "This application is no longer available. Return to the application list and choose another.",
    environment_not_found:
      "This environment is no longer available. Refresh the application and choose another.",
    production_taken:
      "This application already has a production environment. Remove it before adding another.",
    branch_taken:
      "This branch already has a Git environment. Choose another branch or open its existing environment.",
    environment_name_taken: "An environment already uses this name. Choose another name.",
    environment_name_missing: "The environment needs a name. Enter one to continue.",
    environment_name_long: "The environment name is too long. Use at most 63 characters.",
    environment_name_invalid:
      "The environment name is invalid. Start with a letter and use lowercase letters, digits and dashes.",
    review_stale:
      "The repositories changed since your review. Review them again before continuing.",
    no_repositories:
      "This application has no connected repositories. Connect a repository before adding a Git environment.",
    history_loss_confirmation_required:
      "This adoption would replace repository history. Review the changes and confirm the replacement to continue.",
  } satisfies Record<HqGitEnvironmentRefusalReason, string>;
  it.each(Object.entries(environmentCases))(
    "Every Git environment refusal explains %s and the next step",
    async (reason, message) => {
      await expect(
        refusal({ code: reason === "forbidden" ? "forbidden" : "conflict", reason }),
      ).rejects.toMatchObject({ message });
    },
  );
  it("Changed requests explain how to restart Git setup", async () => {
    await expect(refusal({ code: "conflict", reason: "request_changed" })).rejects.toMatchObject({
      message:
        "This request was already used for different settings. Close Git setup and start it again.",
    });
  });
  it.each(["remote_refused", "conflict", "invalid"])(
    "Unknown Git setup refusals from %s never show raw codes",
    async (code) => {
      await expect(refusal({ code, reason: "newer_reason" })).rejects.toMatchObject({
        message:
          code === "remote_refused"
            ? "Mate could not change this repository connection. Review its settings and try again."
            : "Mate could not complete Git setup. Review the settings and try again.",
      });
    },
  );

  it("An occupied repository names only the application HQ allows the person to see", async () => {
    await expect(
      refusal({
        code: "remote_refused",
        reason: "remote_taken",
        repository: "krls2020/tst123",
        applicationName: "mate-rig-e2e-c",
      }),
    ).rejects.toMatchObject({
      message:
        "krls2020/tst123 is already connected to mate-rig-e2e-c. Disconnect it under Repositories on mate-rig-e2e-c's page, or use another repository.",
    });
  });

  it.each([
    ["token_invalid", "GitHub rejected this token; replace it in GitHub's token settings."],
    ["rate_limited", "GitHub asked Mate to wait; try the token test again later."],
    ["sso", "Authorize this token for your organization in GitHub's token settings."],
    ["archived", "Unarchive this repository in GitHub's repository settings before pushing."],
    [
      "push_not_granted",
      "Select this repository and Contents: Read and write in the token settings.",
    ],
    [
      "not_visible",
      "Check the repository address and this token's repository selection in GitHub.",
    ],
    [
      "could_not_verify",
      "Mate could not verify this token; check its repository access in GitHub.",
    ],
    [
      "classic_scope",
      "Add the missing scope in GitHub's token settings, or create a fine-grained token.",
    ],
    ["pull_requests_only", "This branch requires pull requests; choose Open a pull request."],
    ["unreachable", "The repository host could not be reached; try the token test again."],
    ["newer_reason", "The repository host requires another permission; check its token settings."],
  ])(
    "the token test shows HQ's action for %s without exposing the reason code",
    async (reason, message) => {
      await expect(
        refusal(
          { code: "git_probe_refused", reason, message },
          reason === "rate_limited" ? 429 : 409,
        ),
      ).rejects.toMatchObject({ code: "git_probe_refused", message });
    },
  );

  it.each([undefined, null, 42, "", "   "])(
    "a token refusal with message %s gives a readable next step",
    async (message) => {
      await expect(
        refusal({ code: "git_probe_refused", reason: "could_not_verify", message }),
      ).rejects.toMatchObject({
        code: "git_probe_refused",
        message:
          "Mate could not verify repository access; check the repository address and token settings, then try again.",
      });
    },
  );

  it("other refusals keep the client's own words when HQ supplies a message", async () => {
    await expect(
      refusal({ code: "forbidden", reason: "not_structure_writer", message: "Host text." }),
    ).rejects.toMatchObject({ message: "Only an owner or admin of the organization can do this." });
  });
});

describe("readHqParts — how HQ's parts stand", () => {
  const leading = { db: "up" };
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
  ])("%s", (_name, body, parts) => {
    expect(readHqParts({ ...leading, ...body })).toEqual(parts);
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

  const opening = (api: HqApi, signal = new AbortController().signal) => {
    const messages: Array<string> = [];
    const closes: Array<number> = [];
    const socket = api.openScopeSocket(
      {
        open: () => {},
        message: (data) => messages.push(data),
        close: (code) => closes.push(code),
      },
      signal,
    );
    return { socket, messages, closes };
  };

  it("opens the socket with a ticket minted through the door, and tells of each message and the close", async () => {
    const hq = ticketing();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: sockets.openSocket,
    });
    const opened = opening(api);
    const socket = await sockets.next();
    expect(socket.url).toBe(`${ADDRESS.replace(/^http/u, "ws")}/api/structure/ws?ticket=t-1`);
    expect(hq.seen.at(-1)).toMatchObject({
      path: "/api/stream-ticket",
      authorization: "Bearer session-1",
    });
    socket.on.message('{"type":"ping"}');
    socket.on.close(4410);
    expect(opened.messages).toEqual(['{"type":"ping"}']);
    expect(opened.closes).toEqual([4410]);
  });

  it("renews the session HQ ended over the socket (4401) and opens the next socket with it", async () => {
    const hq = ticketing();
    const door = doors();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: sockets.openSocket,
    });
    opening(api);
    (await sockets.next()).on.close(4401);
    opening(api);
    await sockets.next();
    expect(door.minted).toEqual(["access-1", "access-2"]);
    expect(hq.seen.at(-1)).toMatchObject({
      path: "/api/stream-ticket",
      authorization: "Bearer session-2",
    });
  });

  // Audit K7: the session HQ ended over the socket is not presented again by the next load.
  it("forgets the kept session HQ ended over the socket (4401), and keeps its renewal", async () => {
    let kept: string | null = null;
    const door = doors();
    const sockets = fakeSockets();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: ticketing().fetch,
      accessToken: door.accessToken,
      orgId: ORG,
      openSocket: sockets.openSocket,
      kept: {
        read: () => (kept === null ? null : { token: kept, expiresAtMs: FAR }),
        keep: (session) => {
          kept = session.token;
        },
        forget: (token) => {
          if (kept === token) kept = null;
        },
      },
    });
    opening(api);
    (await sockets.next()).on.close(4401);
    expect(kept).toBeNull();

    opening(api);
    await sockets.next();
    expect(door.minted).toEqual(["access-1", "access-2"]);
    expect(kept).toBe("session-2");
  });

  it("writes a Mate's name and face to HQ", async () => {
    const hq = fakeHq();
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
      (api) => api.keepDeployToken("app-1", "stage", "tok-1", "9007199254740993"),
      {
        method: "PUT",
        path: "/api/apps/app-1/environments/stage/deploy-token",
        body: { token: "tok-1", expectedDeclaration: "9007199254740993" },
      },
    ],
  ])("%s", async (_name, act, expected) => {
    const hq = fakeHq();
    await act(
      makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: doors().accessToken,
        orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
  const MAIN_HEAD = "b".repeat(40);
  const COMMITS = [
    { sha: SHA, subject: "Add the page", authorName: "Vera", at: "2026-10-02T09:01:00Z" },
  ];
  /** What HQ recorded of the change when it last moved. */
  const REVIEW = {
    mergeBase: "b".repeat(40),
    files: [{ path: "server/status.ts", added: 12, deleted: 1, binary: false }],
    filesTruncated: false,
    conflictPaths: [],
    commits: null,
    commitsTruncated: false,
  };
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
        accessToken: doors().accessToken,
        orgId: ORG,
        openSocket: NO_SOCKET,
      }),
    };
  };

  it("Linked change metadata does not request commit or diff contents.", async () => {
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3/metadata"
        ? json(200, { change: CHANGE, review: REVIEW })
        : undefined,
    );
    await expect(hqApi.changeMetadata(LINK)).resolves.toEqual({ change: CHANGE, review: REVIEW });
    expect(hq.seen.filter((request) => request.path.includes("/changes/"))).toEqual([
      expect.objectContaining({ path: "/api/apps/app-1/changes/app/3/metadata", method: "GET" }),
    ]);
  });

  it("Explicit change history reads commits for the displayed head and main without requesting patches.", async () => {
    const commits = {
      change: CHANGE,
      mainHead: MAIN_HEAD,
      commits: COMMITS,
      commitsTruncated: false,
    };
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3/commits" ? json(200, commits) : undefined,
    );
    const snapshot = { expectedHead: SHA, expectedMain: MAIN_HEAD };
    await expect(hqApi.changeCommits(LINK, undefined, snapshot)).resolves.toEqual(commits);
    expect(hq.seen.filter((request) => request.path.includes("/changes/"))).toEqual([
      expect.objectContaining({
        path: "/api/apps/app-1/changes/app/3/commits",
        method: "GET",
        search: `?expectedHead=${SHA}&expectedMain=${MAIN_HEAD}`,
      }),
    ]);
  });

  it("HQ's judgement of a change is read at the displayed head and main, without its files or commits", async () => {
    const judged = {
      change: CHANGE,
      mainHead: MAIN_HEAD,
      mergeBase: MAIN_HEAD,
      mergeability: { kind: "clean" },
    };
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3" ? json(200, judged) : undefined,
    );
    const snapshot = { expectedHead: SHA, expectedMain: MAIN_HEAD };
    await expect(hqApi.changeVerdict(LINK, undefined, snapshot)).resolves.toEqual(judged);
    expect(hq.seen.filter((request) => request.path.includes("/changes/"))).toEqual([
      expect.objectContaining({
        path: "/api/apps/app-1/changes/app/3",
        method: "GET",
        search: `?expectedHead=${SHA}&expectedMain=${MAIN_HEAD}`,
      }),
    ]);
  });

  it("reads a change with what its review reads, as the person", async () => {
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3/metadata"
        ? json(200, { change: CHANGE, review: REVIEW })
        : undefined,
    );
    await expect(hqApi.changeMetadata(LINK)).resolves.toEqual({ change: CHANGE, review: REVIEW });
    expect(hq.seen.at(-1)).toMatchObject({ method: "GET", authorization: "Bearer session-1" });
  });

  it("refuses an answer this version of Mate cannot read, rather than drawing half of it", async () => {
    const { api: hqApi } = api(() =>
      json(200, { change: { ...CHANGE, mergeability: "maybe" }, review: REVIEW }),
    );
    await expect(hqApi.changeMetadata(LINK)).rejects.toMatchObject({
      kind: "refused",
      code: "unreadable",
    });
  });

  it("says a change HQ has no record of in words of its own", async () => {
    const { api: hqApi } = api(() =>
      json(404, { code: "change_not_found", reason: "change_not_found" }),
    );
    await expect(hqApi.changeMetadata(LINK)).rejects.toMatchObject({
      kind: "refused",
      code: "change_not_found",
      message: "HQ has no such change.",
    });
  });

  it("says something in a change's conversation as the person", async () => {
    const { hq, api: hqApi } = api((seen) =>
      seen.path === "/api/apps/app-1/changes/app/3/comments"
        ? seen.method === "POST"
          ? json(201, { ...COMMENT, body: "Ship it" })
          : json(200, { comments: [COMMENT] })
        : undefined,
    );
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
    await expect(hqApi.closeChange(LINK, "a".repeat(40))).resolves.toEqual(CLOSED);
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
      name: "a merge HQ holds merged, read back from its metadata",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/merge" },
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3/metadata"
          ? json(200, { change: { ...CHANGE, state: "merged" }, review: REVIEW })
          : undefined,
      ask: (hqApi) => hqApi.mergeChange(LINK, SHA),
      // Its deploys are HQ's stream's to bring.
      made: { made: { ...CHANGE, state: "merged" }, deploys: undefined },
    },
    {
      name: "a close HQ holds closed, read back from its metadata",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/close" },
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3/metadata"
          ? json(200, { change: { ...CHANGE, state: "closed" }, review: REVIEW })
          : undefined,
      ask: (hqApi) => hqApi.closeChange(LINK, "a".repeat(40)),
      made: { ...CHANGE, state: "closed" },
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

  // A comment has no name of its own: whose it is, the account's operation decides from HQ's
  // conversation, by its author — the client never takes anybody's newest words for it.
  it("leaves a comment whose answer was lost uncertain, reading nothing back", async () => {
    const { hq, api: hqApi } = api((seen) => {
      if (seen.path !== "/api/apps/app-1/changes/app/3/comments") return undefined;
      if (seen.method === "POST") throw new TypeError("Failed to fetch");
      return json(200, { comments: [COMMENT] });
    });
    await expect(hqApi.commentOnChange(LINK, COMMENT.body)).rejects.toMatchObject({
      kind: "uncertain",
    });
    expect(
      hq.seen.filter((entry) => entry.path === "/api/apps/app-1/changes/app/3/comments"),
    ).toMatchObject([{ method: "POST" }]);
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
        seen.path === "/api/apps/app-1/changes/app/3/metadata"
          ? json(200, { change: { ...CHANGE, state: "merged" }, review: REVIEW })
          : undefined,
      ask: (hqApi) => hqApi.mergeChange(LINK, SHA),
      made: { made: { ...CHANGE, state: "merged" }, deploys: undefined },
    },
    {
      name: "a merge of a change no longer open, HQ holding it merged",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/merge" },
      reason: "change_not_open",
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3/metadata"
          ? json(200, { change: { ...CHANGE, state: "merged" }, review: REVIEW })
          : undefined,
      ask: (hqApi) => hqApi.mergeChange(LINK, SHA),
      made: { made: { ...CHANGE, state: "merged" }, deploys: undefined },
    },
    {
      name: "a close of a change no longer open, HQ holding it closed",
      write: { method: "POST", path: "/api/apps/app-1/changes/app/3/close" },
      reason: "change_not_open",
      holds: (seen) =>
        seen.path === "/api/apps/app-1/changes/app/3/metadata"
          ? json(200, { change: { ...CHANGE, state: "closed" }, review: REVIEW })
          : undefined,
      ask: (hqApi) => hqApi.closeChange(LINK, "a".repeat(40)),
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
        seen.path === "/api/apps/app-1/changes/app/3/metadata"
          ? json(200, { change: { ...CHANGE, state: "merged" }, review: REVIEW })
          : undefined,
      ask: (hqApi) => hqApi.closeChange(LINK, "a".repeat(40)),
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
      return seen.path === "/api/apps/app-1/changes/app/3/metadata"
        ? json(200, { change: CHANGE, review: REVIEW })
        : undefined;
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
        accessToken: doors().accessToken,
        orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
    { name: "deploy token", ask: (api) => api.keepDeployToken("app-1", "stage", "token", "1") },
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
      accessToken: doors().accessToken,
      orgId: ORG,
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
        accessToken: doors().accessToken,
        orgId: ORG,
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

describe("makeHqApi — original lifecycle receipts", () => {
  const intent = {
    kind: "prepare-mate-deletion" as const,
    orgId: "org",
    hqProjectId: "hq",
    projectId: "P_MATE",
  };
  it("reads the retained result after a lost write without sending another preparation", async () => {
    const record = {
      requestId: "original",
      intent,
      result: { completion: "scoped-handle", keyTokenId: "exact-key" },
    };
    const hq = fakeHq((seen) =>
      seen.path === "/api/lifecycle/original"
        ? seen.method === "POST"
          ? json(503, { code: "internal_error" })
          : json(200, { record })
        : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(api.lifecycleWrite("original", intent)).rejects.toMatchObject({
      kind: "uncertain",
    });
    expect(await api.lifecycleReceipt("original")).toEqual(record);
    expect(
      hq.seen.filter((seen) => seen.path === "/api/lifecycle/original" && seen.method === "POST"),
    ).toHaveLength(1);
  });
  it("sends the original preparation id and completion seal, wording the source refusal", async () => {
    const complete = {
      ...intent,
      kind: "complete-mate-deletion" as const,
      preparedRequestId: "original",
      completion: "scoped-handle",
    };
    const hq = fakeHq((seen) =>
      seen.path === "/api/lifecycle/original%3Acomplete"
        ? json(409, { code: "conflict", reason: "project_still_exists" })
        : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(api.lifecycleWrite("original:complete", complete)).rejects.toMatchObject({
      reason: "project_still_exists",
    });
    expect(hq.seen.at(-1)?.body).toEqual(complete);
  });
});

describe("HQ's final account fence", () => {
  it.each(["door", "repair"] as const)(
    "sends no protected write after account closure during %s",
    async (phase) => {
      let active = true;
      let kept: string | null = "expired";
      const hq = fakeHq((seen) =>
        seen.path === "/api/apps" && phase === "repair"
          ? json(401, { code: "session_required" })
          : undefined,
      );
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        openSocket: NO_SOCKET,
        ...(phase === "repair"
          ? {
              kept: {
                read: () => (kept === null ? null : { token: kept, expiresAtMs: FAR }),
                keep: () => {},
                forget: () => {
                  kept = null;
                },
              },
            }
          : {}),
        orgId: ORG,
        accessToken: async () => {
          active = false;
          return "access";
        },
        isCurrent: () => active,
      });
      await expect(api.createApp("Acme")).rejects.toMatchObject({ code: "account_changed" });
      expect(hq.seen.filter((seen) => seen.path === "/api/apps")).toHaveLength(
        phase === "repair" ? 1 : 0,
      );
    },
  );
});

describe("HQ automatic-update policy transport", () => {
  it("reads and changes a schema-checked policy through the authorized door", async () => {
    const hq = fakeHq((seen) =>
      seen.path === "/api/auto-update"
        ? json(200, {
            orgId: "ORG",
            enabled: seen.method === "GET",
            revision: seen.method === "GET" ? 0 : 1,
          })
        : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    expect(await api.autoUpdatePolicy()).toEqual({ orgId: "ORG", enabled: true, revision: 0 });
    expect(await api.setAutoUpdatePolicy(false)).toEqual({
      orgId: "ORG",
      enabled: false,
      revision: 1,
    });
    expect(hq.seen.filter((seen) => seen.path === "/api/auto-update")).toMatchObject([
      { method: "GET", authorization: "Bearer session-1" },
      { method: "PUT", authorization: "Bearer session-1", body: { enabled: false } },
    ]);
  });
  it.each(["lost", "malformed"])(
    "keeps a %s PUT answer uncertain and sends it only once",
    async (failure) => {
      const hq = fakeHq((seen) => {
        if (seen.path !== "/api/auto-update") return undefined;
        if (failure === "lost") throw new Error("connection reset");
        return json(200, { enabled: false });
      });
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: doors().accessToken,
        orgId: ORG,
        openSocket: NO_SOCKET,
      });
      await expect(api.setAutoUpdatePolicy(false)).rejects.toMatchObject({ kind: "uncertain" });
      expect(hq.seen.filter((seen) => seen.path === "/api/auto-update")).toHaveLength(1);
    },
  );
});

it("Git transport keeps candidate plaintext in one incoming write body and recovers the original decoded receipt", async () => {
  const marker = "TRANSIENT_GIT_CANDIDATE";
  const intent = {
    kind: "probe-git-remote" as const,
    orgId: "org",
    appId: "app",
    hqProjectId: "hq",
    repo: "web",
    branch: "selected",
    url: "https://github.com/krls2020/tst123",
  };
  const receipt = {
    requestId: "original",
    operationId: "original",
    executor: "hq",
    affected: [{ family: "hqAppDetail", id: "app" }],
    handles: [],
    acceptance: {
      kind: "accepted",
      result: {
        ok: true,
        remote: { url: intent.url, repositoryId: "123", expiresAt: null, invalidSince: null },
      },
    },
    outcome: { kind: "succeeded", evidence: "original" },
  };
  let lost = true;
  const hq = fakeHq((seen) => {
    if (seen.path === "/api/git-targets/original") {
      if (lost) {
        lost = false;
        throw new TypeError("lost accepting answer");
      }
      return json(200, { ...receipt, token: marker });
    }
    if (seen.path === "/api/git-targets/original/receipt")
      return json(200, { receipt: { ...receipt, sealed: marker } });
    return undefined;
  });
  const door = doors();
  const api = makeHqApi({
    address: ADDRESS,
    fetch: hq.fetch,
    accessToken: door.accessToken,
    orgId: ORG,
    openSocket: NO_SOCKET,
  });
  await expect(api.gitTargetWrite("original", intent, marker)).rejects.toMatchObject({
    kind: "uncertain",
  });
  expect(await api.gitTargetReceipt("original", intent)).toEqual(receipt);
  const sent = hq.seen.filter((seen) => seen.path.startsWith("/api/git-targets"));
  expect(sent.map(({ method, path, search }) => ({ method, path, search }))).toEqual([
    { method: "POST", path: "/api/git-targets/original", search: "" },
    { method: "POST", path: "/api/git-targets/original/receipt", search: "" },
  ]);
  expect(sent[0]!.body).toEqual({ intent, candidate: marker });
  expect(sent[1]!.body).toEqual({ intent });
  expect(JSON.stringify(sent.map(({ body: _incoming, ...safe }) => safe))).not.toContain(marker);
  expect(JSON.stringify(intent)).not.toContain(marker);
});

describe("makeHqApi — where automated Mates take tasks from besides GitHub", () => {
  const hook = {
    id: "w1",
    name: "Sentry",
    url: "https://hq.example/api/intake/webhook/9f2c41",
    createdAt: "2026-10-17T09:00:00.000Z",
  };
  const schedule = {
    id: "s1",
    name: "Weekly upkeep",
    brief: "Update the dependencies.",
    rule: { every: "week", day: 1, at: "09:00", timeZone: "Europe/Prague" },
    nextAt: "2026-10-19T07:00:00.000Z",
  } as const;
  const channel = { appId: "app-1", channelId: "C042", channel: "support" };

  // HQ's own answers (`mate-hq apps/hq/src/automationApi.ts`, `slackRoutes.ts`, `discordRoutes.ts`).
  it.each([
    {
      case: "an application's webhooks, which HQ answers wrapped",
      call: (api: HqApi) => api.webhooks!("app-1"),
      method: "GET",
      path: "/api/apps/app-1/webhooks",
      status: 200,
      answer: { webhooks: [hook] },
      read: [hook],
    },
    {
      case: "a webhook made, with its secret this once",
      call: (api: HqApi) => api.makeWebhook!("app-1", { name: "Sentry" }),
      method: "POST",
      path: "/api/apps/app-1/webhooks",
      sent: { name: "Sentry" },
      status: 201,
      answer: { ...hook, secret: "s" },
      read: { ...hook, secret: "s" },
    },
    {
      case: "an application's schedules, which HQ answers wrapped",
      call: (api: HqApi) => api.schedules!("app-1"),
      method: "GET",
      path: "/api/apps/app-1/schedules",
      status: 200,
      answer: { schedules: [schedule] },
      read: [schedule],
    },
    {
      case: "a schedule made",
      call: (api: HqApi) =>
        api.makeSchedule!("app-1", {
          name: schedule.name,
          brief: schedule.brief,
          rule: schedule.rule,
        }),
      method: "POST",
      path: "/api/apps/app-1/schedules",
      sent: { name: schedule.name, brief: schedule.brief, rule: schedule.rule },
      status: 201,
      answer: schedule,
      read: schedule,
    },
    {
      case: "an application with no Slack channel",
      call: (api: HqApi) => api.appChannel!("app-1", "slack"),
      method: "GET",
      path: "/api/apps/app-1/slack",
      status: 200,
      answer: null,
      read: null,
    },
    {
      case: "an application's Discord channel set",
      call: (api: HqApi) => api.setAppChannel!("app-1", "discord", { channelId: "123456789" }),
      method: "PUT",
      path: "/api/apps/app-1/discord",
      sent: { channelId: "123456789" },
      status: 200,
      answer: channel,
      read: channel,
    },
    {
      case: "the limits on each task kept",
      call: (api: HqApi) => api.setTaskLimits!({ minutes: 30, costUsd: 5 }),
      method: "PUT",
      path: "/api/org/task-limits",
      sent: { minutes: 30, costUsd: 5 },
      status: 200,
      answer: { minutes: 30, costUsd: 5 },
      read: { minutes: 30, costUsd: 5 },
    },
  ])("reads $case as HQ answers it", async ({ call, method, path, sent, status, answer, read }) => {
    const hq = fakeHq((seen) =>
      seen.path === path && seen.method === method ? json(status, answer) : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(call(api)).resolves.toEqual(read);
    const asked = hq.seen.find((entry) => entry.path === path && entry.method === method);
    expect(asked?.body).toEqual(sent);
  });

  it("a person's stop of a task is sent to that task of its application", async () => {
    const path = "/api/apps/app-1/tasks/task-1/stop";
    const hq = fakeHq((seen) =>
      seen.path === path && seen.method === "POST"
        ? new Response(null, { status: 204 })
        : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(api.stopAppTask!("app-1", "task-1")).resolves.toBeUndefined();
    expect(hq.seen.some((entry) => entry.path === path && entry.method === "POST")).toBe(true);
  });
});

describe("makeHqApi — a Mate's ticket", () => {
  const ticketApi = (answer: Response) => {
    const hq = fakeHq((seen) =>
      seen.path === "/api/mates/P1/ticket" ? answer.clone() : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: () => {
        throw new Error("unused");
      },
    });
    return { hq, api };
  };

  it("A Mate's ticket is asked of HQ under the session and answers where to open the socket", async () => {
    const { hq, api } = ticketApi(
      json(200, { ticket: "T-1", expiresIn: 30, origin: "https://mate.example" }),
    );

    await expect(api.mateTicket("P1")).resolves.toEqual({
      ticket: "T-1",
      expiresIn: 30,
      origin: "https://mate.example",
    });
    expect(hq.seen.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/mates/P1/ticket",
      authorization: "Bearer session-1",
    });
  });

  it.each([
    [403, { code: "forbidden", reason: "not_mate_opener" }, "refused", "forbidden"],
    [404, { code: "mate_not_found" }, "refused", "mate_not_found"],
    [409, { code: "mate_not_connected" }, "refused", "mate_not_connected"],
  ])("HQ's %i refusal of a ticket is told as its own kind", async (status, body, kind, code) => {
    const { api } = ticketApi(json(status, body));

    await expect(api.mateTicket("P1")).rejects.toMatchObject({ kind, code });
  });
});

describe("makeHqApi — kept Git answers", () => {
  it.each(["keep", "delete"] as const)(
    "%s answers the removed project's Git question through HQ",
    async (answer) => {
      const hq = fakeHq((seen) =>
        seen.path.endsWith("/kept-git") ? new Response(null, { status: 204 }) : undefined,
      );
      const api = makeHqApi({
        address: ADDRESS,
        fetch: hq.fetch,
        accessToken: doors().accessToken,
        orgId: ORG,
        openSocket: NO_SOCKET,
      });
      await expect(api.answerKeptGit("app/1", answer)).resolves.toBeUndefined();
      expect(hq.seen.at(-1)).toMatchObject({
        method: "POST",
        path: "/api/apps/app%2F1/kept-git",
        body: { answer },
      });
    },
  );

  it("a kept Git question already closed preserves HQ's refusal", async () => {
    const hq = fakeHq((seen) =>
      seen.path.endsWith("/kept-git")
        ? json(409, { code: "conflict", reason: "not_asked" })
        : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(api.answerKeptGit("app-1", "keep")).rejects.toMatchObject({
      kind: "refused",
      code: "conflict",
      reason: "not_asked",
    });
  });

  it("a lost kept Git answer stays uncertain without sending or reading again", async () => {
    const hq = fakeHq((seen) => {
      if (seen.path.endsWith("/kept-git")) throw new TypeError("Answer lost.");
      return undefined;
    });
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(api.answerKeptGit("app-1", "delete")).rejects.toMatchObject({ kind: "uncertain" });
    expect(hq.seen.map((seen) => seen.path)).toEqual(["/api/door", "/api/apps/app-1/kept-git"]);
  });
});

describe("HQ structured refusal findings", () => {
  it.each([
    undefined,
    [
      {
        code: "schema_invalid",
        what: "Invalid service setting",
        where: { appId: "app", service: "api", file: "production.yaml" },
        rule: { source: "zerops-schema", schemaPath: "/properties/services" },
        next: { actor: "mate", action: "Correct the named setting and propose a recipe change." },
      },
    ],
  ])("retains optional HQ findings beside the existing reason fallback: %j", async (problems) => {
    const hq = fakeHq((request) =>
      request.path.endsWith("/review")
        ? json(409, {
            code: "conflict",
            reason: "invalid_recipe",
            ...(problems === undefined ? {} : { problems }),
          })
        : undefined,
    );
    const api = makeHqApi({
      address: ADDRESS,
      fetch: hq.fetch,
      accessToken: doors().accessToken,
      orgId: ORG,
      openSocket: NO_SOCKET,
    });
    await expect(
      api.reviewRelease("app", { tag: "v1", groupHead: "a".repeat(40), entries: [] }),
    ).rejects.toMatchObject({
      kind: "refused",
      code: "conflict",
      reason: "invalid_recipe",
      problems,
    });
  });
});
