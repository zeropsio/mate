import {
  makeHqApi,
  type HqApi,
  type HqStructure,
  type HqStructureEvent,
} from "@t3tools/client-runtime/zerops/hq";
import type { HqChange } from "@t3tools/shared/hqChanges";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HqMatesView, HqPeopleView, HqStructureView } from "../state/zerops";
import { driveHqStructure, hqOutageLine } from "./hqStructure";

const ACME: HqStructure = { ungrouped: [], apps: [{ id: "app-1", name: "Acme", projects: [] }] };
const BETA = { id: "app-2", name: "Beta", projects: [] };

/** Vera as a reader observes her: online, nothing running. */
const VERA = Schema.decodeUnknownSync(MateLiveView)({
  presence: { online: true, since: "2026-10-03T10:00:00.000Z", overview: "live" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: null,
  threads: { list: [], omitted: 0 },
  logins: { "claude-code": { signedInBy: "u-ada", present: true, token: false } },
  crew: null,
});

/** HQ's ping, this long after what came before it. */
type Ping = { readonly pingAfterMs: number; readonly tick: (ms: number) => void };

/** One stream attempt: the events (and pings) it sends, then how it ends. */
type Attempt = {
  readonly events: ReadonlyArray<HqStructureEvent | Ping>;
  readonly end: "close" | "fail" | "hang";
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
  let now = 10_000;
  return {
    views,
    mates,
    people,
    kept,
    tick: (ms: number) => (now += ms),
    deps: {
      organizationId: "org-1",
      remembered,
      publish: (view: HqStructureView) => views.push(view),
      publishMates: (view: HqMatesView) => mates.push(view),
      publishPeople: (view: HqPeopleView) => people.push(view),
      remember: (structure: HqStructure, readAt: number) => kept.push([structure, readAt]),
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      silenceMs: 60_000,
    },
  };
}

describe("driveHqStructure", () => {
  it("carries each application's changes from its stream, and starts them over with each snapshot", async () => {
    const change: HqChange = {
      appId: "app-1",
      repo: "app",
      number: 3,
      mateProjectId: "p1",
      title: "Add a /status page",
      body: "",
      state: "open",
      head: "a".repeat(40),
      mergedSha: null,
      landedHead: null,
      openedAt: "2026-10-02T09:00:00.000Z",
      mergedAt: null,
      closedAt: null,
      updatedAt: "2026-10-02T09:00:00.000Z",
      mergeability: "clean",
      behind: false,
    };
    const merged: HqChange = { ...change, state: "merged", mergedAt: "2026-10-02T10:00:00.000Z" };
    const api = streamingApi([
      {
        events: [
          {
            kind: "snapshot",
            structure: ACME,
            changes: new Map([["app-1", [change]]]),
            mates: null,
            people: null,
          },
          { kind: "changes", appId: "app-1", changes: [merged] },
        ],
        end: "close",
      },
      {
        events: [
          { kind: "snapshot", structure: ACME, changes: new Map(), mates: null, people: null },
        ],
        end: "hang",
      },
    ]);
    const h = harness();
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    await vi.waitFor(() => expect(h.views.at(-1)?.changes).toEqual(new Map()));
    stop.abort();
    await driving;

    expect(h.views.map((view) => view.changes)).toContainEqual(new Map([["app-1", [change]]]));
    expect(h.views.map((view) => view.changes)).toContainEqual(new Map([["app-1", [merged]]]));
  });

  it("draws what is remembered at once, then HQ's snapshot and its changes, each remembered", async () => {
    const api = streamingApi([
      {
        events: [
          { kind: "snapshot", structure: ACME, changes: null, mates: null, people: null },
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
            structure: ACME,
            changes: null,
            mates: new Map([["p1", VERA]]),
            people: { "u-ada": { name: "Ada Lovelace" } },
          },
          { kind: "mate", projectId: "p1", value: { crew: null, main: null } },
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

  it("says since when HQ is unavailable, keeps the last structure, and starts over from a fresh snapshot", async () => {
    const api = streamingApi([
      {
        events: [{ kind: "snapshot", structure: ACME, changes: null, mates: null, people: null }],
        end: "fail",
      },
      { events: [], end: "fail" },
      {
        events: [
          {
            kind: "snapshot",
            structure: { ungrouped: [], apps: [BETA] },
            changes: null,
            mates: null,
            people: null,
          },
        ],
        end: "hang",
      },
    ]);
    const h = harness();
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    await vi.waitFor(() => expect(api.attempts()).toBe(3));
    await vi.waitFor(() => expect(h.views.at(-1)?.current).toBe(true));
    stop.abort();
    await driving;

    const outage = h.views.filter((view) => view.unavailableSince !== null);
    expect(outage.length).toBeGreaterThan(0);
    // The outage began when the first stream broke, and kept that time through the next failure.
    expect(new Set(outage.map((view) => view.unavailableSince)).size).toBe(1);
    expect(outage.every((view) => view.structure === ACME && !view.current)).toBe(true);
    expect(h.views.at(-1)).toMatchObject({
      structure: { ungrouped: [], apps: [BETA] },
      unavailableSince: null,
    });
  });

  it("dates the structure by the last time HQ answered, its pings included", async () => {
    const h = harness();
    const api = streamingApi([
      {
        events: [
          { kind: "snapshot", structure: ACME, changes: null, mates: null, people: null },
          { pingAfterMs: 20_000, tick: h.tick },
        ],
        end: "fail",
      },
      { events: [], end: "hang" },
    ]);
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    await vi.waitFor(() => expect(api.attempts()).toBe(2));
    stop.abort();
    await driving;

    // Read at 10 000, pinged at 30 000, and then the stream broke.
    expect(h.views.find((view) => view.unavailableSince !== null)).toMatchObject({
      structure: ACME,
      readAt: 30_000,
    });
    expect(h.kept.at(-1)).toEqual([ACME, 30_000]);
  });

  it("gives a stream up that stays silent past the heartbeats, and reads again", async () => {
    vi.useFakeTimers();
    try {
      const api = streamingApi([
        {
          events: [{ kind: "snapshot", structure: ACME, changes: null, mates: null, people: null }],
          end: "hang",
        },
        {
          events: [{ kind: "snapshot", structure: ACME, changes: null, mates: null, people: null }],
          end: "hang",
        },
      ]);
      const h = harness();
      const stop = new AbortController();
      const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(api.attempts()).toBe(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(api.attempts()).toBe(2);
      stop.abort();
      await driving;
    } finally {
      vi.useRealTimers();
    }
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
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
    expect(hqOutageLine(view({ unavailableSince: null }), "24-hour", at(14, 20))).toBeNull();
    expect(hqOutageLine(null, "24-hour", at(14, 20))).toBeNull();
  });
});
