import {
  HqError,
  makeHqApi,
  type HqApi,
  type HqMates,
  type HqStructure,
  type HqStructureEvent,
} from "@t3tools/client-runtime/zerops/hq";
import { MateLiveView, type HqPeople } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HqMatesView, HqPeopleView, HqStructureView } from "../state/zerops";
import { driveHqStructure, requestHqSnapshot, hqOfficialOf, hqOutageLine } from "./hqStructure";

const ACME: HqStructure = { ungrouped: [], apps: [{ id: "app-1", name: "Acme", projects: [] }] };
const BETA = { id: "app-2", name: "Beta", projects: [] };

/** Vera as a reader observes her: online, nothing running. */
const VERA = Schema.decodeUnknownSync(MateLiveView)({
  presence: { online: true, since: "2026-10-03T10:00:00.000Z", overview: "live" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: null,
  threads: { list: [], omitted: 0 },
  logins: { "claude-code": { signedInBy: "u-ada", present: true, token: false } },
  crew: { status: "off" },
});

/** HQ's ping, this long after what came before it. */
type Ping = { readonly pingAfterMs: number; readonly tick: (ms: number) => void };

/** One stream attempt: the events (and pings) it sends, then how it ends. */
type Attempt = {
  readonly events: ReadonlyArray<HqStructureEvent | Ping>;
  /**
   * `cut`: the socket closed on its way, as the browser saw it (`1006`); `cutAfterMs`: so after
   * that long on the timers, as the Zerops L7 does at 120 s.
   */
  readonly end: "close" | "fail" | "cut" | "hang" | { readonly cutAfterMs: number };
};

function streamingApi(attempts: ReadonlyArray<Attempt>) {
  let at = 0;
  const streamStructure: HqApi["streamStructure"] = async (handlers, signal) => {
    const attempt = attempts[Math.min(at, attempts.length - 1)]!;
    at += 1;
    for (const event of attempt.events) {
      if ("pingAfterMs" in event) {
        event.tick(event.pingAfterMs);
        handlers.onAlive();
        continue;
      }
      handlers.onAlive();
      handlers.onEvent(event);
    }
    if (attempt.end === "fail") throw new Error("HQ could not be reached.");
    if (typeof attempt.end === "object") {
      const { cutAfterMs } = attempt.end;
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        setTimeout(resolve, cutAfterMs);
      });
      throw new HqError({
        kind: "unavailable",
        code: "socket_1006",
        message: "HQ's stream broke.",
      });
    }
    if (attempt.end === "cut") {
      throw new HqError({
        kind: "unavailable",
        code: "socket_1006",
        message: "HQ's stream broke.",
      });
    }
    if (attempt.end === "hang") {
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }
  };
  return { streamStructure, attempts: () => at };
}

function harness(remembered?: { readonly structure: HqStructure; readonly readAt: number }) {
  const views: Array<HqStructureView> = [];
  const mates: Array<HqMatesView> = [];
  const people: Array<HqPeopleView> = [];
  const kept: Array<[HqStructure, number]> = [];
  const keptMates: Array<[HqMates, HqPeople | null]> = [];
  const logged: Array<string> = [];
  let now = 10_000;
  return {
    views,
    mates,
    people,
    kept,
    keptMates,
    logged,
    tick: (ms: number) => (now += ms),
    deps: {
      organizationId: "org-1",
      remembered,
      publish: (view: HqStructureView) => views.push(view),
      publishMates: (view: HqMatesView) => mates.push(view),
      publishPeople: (view: HqPeopleView) => people.push(view),
      remember: (structure: HqStructure, readAt: number) => kept.push([structure, readAt]),
      rememberMates: (mates: HqMates, told: HqPeople | null) => keptMates.push([mates, told]),
      now: () => now,
      log: (line: string) => logged.push(line),
      silenceMs: 60_000,
    },
  };
}

describe("HQ menu currency", () => {
  it("marks a restored structure as last known while updating", () => {
    expect(
      hqOutageLine(
        {
          organizationId: "org",
          structure: ACME,
          changes: null,
          appReads: null,
          readAt: 1000,
          current: false,
          unavailableSince: null,
        },
        "locale",
        10000,
      ),
    ).toMatch(/Last known · as of .* · Updating…/);
  });
  it.each(["fail", "close", "cut"] as const)(
    "holds rows after %s until a manual again",
    async (end) => {
      const h = harness({ structure: ACME, readAt: 1 });
      const controller = new AbortController();
      let calls = 0;
      const api: Pick<HqApi, "streamStructure"> = {
        streamStructure: async () => {
          calls++;
          if (calls > 1) controller.abort();
          if (end !== "close") throw new Error("Unavailable");
        },
      };
      const done = driveHqStructure({ ...h.deps, api, signal: controller.signal });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(calls).toBe(1);
      expect(h.views.at(-1)).toMatchObject({
        structure: ACME,
        current: false,
        unavailableSince: 10000,
      });
      requestHqSnapshot("org-1");
      await done;
      expect(calls).toBe(2);
    },
  );
});
describe("driveHqStructure", () => {
  it("draws what is remembered at once, then HQ's snapshot and its changes, each remembered", async () => {
    const api = streamingApi([
      {
        events: [
          {
            kind: "snapshot",
            appReads: null,
            structure: ACME,
            changes: null,
            mates: null,
            people: null,
          },
          { kind: "change", appId: "app-2", app: BETA },
        ],
        end: "hang",
      },
    ]);
    const h = harness({ structure: { ungrouped: [], apps: [] }, readAt: 1_000 });
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    await vi.waitFor(() => expect(h.views).toHaveLength(3));
    stop.abort();
    await driving;

    expect(h.views[0]).toEqual({
      organizationId: "org-1",
      structure: { ungrouped: [], apps: [] },
      changes: null,
      appReads: null,
      readAt: 1_000,
      current: false,
      unavailableSince: null,
    });
    expect(h.views[1]).toMatchObject({ structure: ACME, current: true, readAt: 10_000 });
    expect(h.views[2]).toMatchObject({
      structure: { ungrouped: [], apps: [...ACME.apps, BETA] },
      current: true,
    });
    // Every structure HQ sent is remembered, the last one last.
    expect(new Set(h.kept.map(([structure]) => structure.apps.length))).toEqual(new Set([1, 2]));
    expect(h.kept.at(-1)?.[0].apps).toHaveLength(2);
  });

  it("keeps the Mates and the people to their own views, and republishes no structure for them", async () => {
    const renamed = { "u-ada": { name: "Ada King" } };
    const api = streamingApi([
      {
        events: [
          {
            kind: "snapshot",
            appReads: null,
            structure: ACME,
            changes: null,
            mates: new Map([["p1", VERA]]),
            people: { "u-ada": { name: "Ada Lovelace" } },
          },
          { kind: "mate", projectId: "p1", value: { crew: { status: "off" }, main: null } },
          { kind: "mate", projectId: "p2", value: VERA },
          { kind: "people", people: renamed },
        ],
        end: "hang",
      },
    ]);
    const h = harness();
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    await vi.waitFor(() => expect(h.people.at(-1)?.people).toBe(renamed));
    stop.abort();
    await driving;

    // The structure as remembered, then HQ's snapshot of it: nothing for a Mate's message.
    expect(h.views).toHaveLength(2);
    expect(h.mates.at(-1)).toEqual({
      organizationId: "org-1",
      mates: new Map([
        ["p1", VERA],
        ["p2", VERA],
      ]),
      current: true,
    });
    expect(h.people.at(-1)).toEqual({ organizationId: "org-1", people: renamed });
  });

  it("remembers the Mates at their snapshot, then at most every ten seconds while they move", async () => {
    const h = harness();
    const api = streamingApi([
      {
        events: [
          {
            kind: "snapshot",
            appReads: null,
            structure: ACME,
            changes: null,
            mates: new Map([["p1", VERA]]),
            people: null,
          },
          { kind: "mate", projectId: "p2", value: VERA },
          { pingAfterMs: 5_000, tick: h.tick },
          { kind: "mate", projectId: "p3", value: VERA },
          { pingAfterMs: 6_000, tick: h.tick },
        ],
        end: "hang",
      },
    ]);
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    await vi.waitFor(() => expect(h.keptMates).toHaveLength(2));
    stop.abort();
    await driving;

    expect(h.keptMates.map(([mates]) => [...mates.keys()])).toEqual([["p1"], ["p1", "p2", "p3"]]);
  });

  it("waits for a door HQ answers in 30 s, it and every other reader on its one throwaway", async () => {
    // HQ's door reads the org fresh from Zerops, which took tens of seconds on KRLS (2026-10-03):
    // a door given up early threw HQ's answer away and minted another throwaway for the next.
    vi.useFakeTimers();
    // The platform's call deadlines run on the test's clock.
    const deadlines = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const deadline = new AbortController();
      setTimeout(() => deadline.abort(new DOMException("timed out", "TimeoutError")), ms);
      return deadline.signal;
    });
    try {
      const minted: Array<string> = [];
      const calls: Array<string> = [];
      const fetch = (url: string, init?: RequestInit) => {
        const { pathname } = new URL(url);
        const authorization = new Headers(init?.headers).get("authorization");
        calls.push(`${init?.method ?? "GET"} ${pathname} ${String(authorization)}`);
        if (pathname === "/api/door") {
          return new Promise<Response>((resolve, reject) => {
            const answer = setTimeout(
              () => resolve(Response.json({ session: "session-1", expiresAt: "", userId: "u1" })),
              30_000,
            );
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(answer);
              reject(init.signal?.reason);
            });
          });
        }
        if (pathname === "/api/stream-ticket") {
          return Promise.resolve(Response.json({ ticket: "t-1", expiresIn: 60 }));
        }
        return Promise.resolve(Response.json(ACME));
      };
      const api = makeHqApi({
        address: "https://hq.example",
        fetch,
        throughDoor: async (use) => {
          const token = `door-${String(minted.length + 1)}`;
          minted.push(token);
          return use(token);
        },
        // HQ's socket sends its snapshot, then stays open until it is closed.
        openSocket: (_url, on) => {
          queueMicrotask(() =>
            on.message(JSON.stringify({ type: "snapshot", ungrouped: [], apps: ACME.apps })),
          );
          return { send: () => undefined, close: () => queueMicrotask(() => on.close(1005)) };
        },
      });
      const h = harness();
      const stop = new AbortController();
      const driving = driveHqStructure({
        ...h.deps,
        api,
        signal: stop.signal,
      });
      // The review's own read of what it shows, asked while the stream's door is under way.
      const read = api.structure();

      await vi.advanceTimersByTimeAsync(29_999);
      expect(minted).toEqual(["door-1"]);
      expect(h.views.at(-1)?.current).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(read).resolves.toEqual(ACME);
      expect(h.views.at(-1)).toMatchObject({ structure: ACME, current: true });
      expect(minted).toEqual(["door-1"]);
      expect(calls.filter((call) => call.startsWith("POST /api/door"))).toHaveLength(1);
      expect(calls.filter((call) => !call.startsWith("POST /api/door"))).toEqual([
        "POST /api/stream-ticket Bearer session-1",
        "GET /api/structure Bearer session-1",
      ]);
      stop.abort();
      await driving;
    } finally {
      deadlines.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("hqOutageLine", () => {
  const at = (hour: number, minute: number) => new Date(2026, 9, 2, hour, minute).getTime();
  const view = (over: Partial<HqStructureView>): HqStructureView => ({
    organizationId: "org-1",
    structure: ACME,
    changes: null,
    appReads: null,
    readAt: at(13, 58),
    current: false,
    unavailableSince: at(14, 5),
    ...over,
  });

  it("says since when HQ does not answer, and how old the projects drawn are", () => {
    expect(hqOutageLine(view({}), "24-hour", at(14, 20))).toBe(
      "HQ unavailable since 14:05. Projects as of 13:58.",
    );
  });

  it("says only since when, where nothing was ever read to draw", () => {
    expect(hqOutageLine(view({ structure: null, readAt: null }), "24-hour", at(14, 20))).toBe(
      "HQ unavailable since 14:05.",
    );
  });

  it("says nothing while HQ answers, or before anything is known", () => {
    expect(
      hqOutageLine(view({ current: true, unavailableSince: null }), "24-hour", at(14, 20)),
    ).toBeNull();
    expect(hqOutageLine(null, "24-hour", at(14, 20))).toBeNull();
  });
});

describe("hqOfficialOf: whether the organization has an official HQ, as decided", () => {
  const OFFICIAL = { kind: "official", projectId: "p-hq", address: "hq.example:443" } as const;
  it.each([
    ["the kept verdict or the member list names one", "ready", OFFICIAL, true],
    ["the member list names none", "ready", { kind: "none" }, false],
    ["the member list's names are unclear", "ready", { kind: "unclear", projectIds: [] }, false],
    ["the member list is being read", "loading", { kind: "none" }, null],
    ["nothing has been read", "idle", { kind: "none" }, null],
    ["the member list could not be read", "failed", { kind: "none" }, null],
  ] as const)("%s", (_name, status, hq, expected) => {
    expect(hqOfficialOf({ status, hq })).toBe(expected);
  });
});
