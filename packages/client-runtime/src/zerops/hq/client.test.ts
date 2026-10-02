import { describe, expect, it } from "@effect/vitest";

import { attachToApp, HqError, makeHqApi, readHqHealth, type HqApi } from "./client.ts";

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

describe("makeHqApi", () => {
  it("comes through the door once and carries its session on every call", async () => {
    const hq = fakeHq();
    const door = doors();
    const api = makeHqApi({ address: ADDRESS, fetch: hq.fetch, throughDoor: door.throughDoor });

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
    const api = makeHqApi({ address: ADDRESS, fetch: hq.fetch, throughDoor: door.throughDoor });
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
    });
    await expect(stuck.structure()).rejects.toMatchObject({ code: "session_required" });
  });

  it.each<[string, Response | "throw", Partial<HqError>]>([
    [
      "a refusal carries HQ's code and words",
      json(403, {
        code: "forbidden",
        message: "Only an org owner or admin changes the structure.",
      }),
      {
        kind: "refused",
        code: "forbidden",
        message: "Only an org owner or admin changes the structure.",
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
    const api = makeHqApi({ address: ADDRESS, fetch: hq.fetch, throughDoor: doors().throughDoor });
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
        apps: [
          {
            id: "app-1",
            name: "Acme",
            projects: attached.map((entry) => ({ ...entry, name: "", mate: null })),
          },
        ],
      }),
      createApp: async () => ({ id: "app-1", name: "Acme" }),
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
