import {
  HqError,
  makeHqApi,
  type HqApi,
  type HqHealth,
  type HqParts,
  type HqStructure,
  type HqStructureEvent,
  type OpenHqSocket,
} from "@t3tools/client-runtime/zerops/hq";
import type { AppRead } from "@t3tools/shared/hqAppReads";
import type { HqChange } from "@t3tools/shared/hqChanges";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HqMatesView, HqPeopleView, HqStructureView } from "../state/zerops";
import type { HqStanding } from "./accountHq";
import {
  driveHqStructure,
  requestHqSnapshot,
  hqOfficialOf,
  hqOutageKind,
  hqOutageLine,
} from "./hqStructure";

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

/** HQ's parts as a health read with nothing wrong reports them. */
const QUIET: HqParts = { quarantined: [] };

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

function harness(health: HqHealth = { kind: "unreachable" }) {
  const views: Array<HqStructureView> = [];
  const healthReads: Array<number> = [];
  /** The tab: whether it is shown, and what waits for it to be. */
  const page = { visible: true, waiting: new Set<() => void>() };
  const show = () => {
    page.visible = true;
    for (const run of page.waiting) run();
    page.waiting.clear();
  };
  const mates: Array<HqMatesView> = [];
  const people: Array<HqPeopleView> = [];
  const logged: Array<string> = [];
  let now = 10_000;
  return {
    views,
    mates,
    people,
    logged,
    healthReads,
    page,
    show,
    tick: (ms: number) => (now += ms),
    deps: {
      organizationId: "org-1",
      publish: (view: HqStructureView) => views.push(view),
      publishMates: (view: HqMatesView) => mates.push(view),
      publishPeople: (view: HqPeopleView) => people.push(view),
      now: () => now,
      log: (line: string) => logged.push(line),
      readHealth: async () => {
        healthReads.push(now);
        return health;
      },
      whenShown: (run: () => void) => {
        if (page.visible) {
          run();
          return () => undefined;
        }
        page.waiting.add(run);
        return () => void page.waiting.delete(run);
      },
      silenceMs: 60_000,
    },
  };
}

describe("HQ's standing, from its stream", () => {
  /** A Core whose stream says nothing of its check of Zerops nor of itself: no `official`. */
  const legacy: HqStructureEvent = {
    kind: "snapshot",
    structure: ACME,
    changes: null,
    appReads: null,
    mates: null,
    people: null,
  };
  const snapshot: HqStructureEvent = { ...legacy, official: "ok", build: "b0" };

  it.each<[string, HqHealth, HqStructureView["standing"]]>([
    ["HQ not answering", { kind: "unreachable" }, { kind: "unavailable", since: 10_000 }],
    [
      "HQ answering as a standby",
      { kind: "not-ready", state: "standby", official: "ok" },
      { kind: "unavailable", since: 10_000 },
    ],
    // HQ serves, but its door cannot check Zerops right now: no outage (e840eb444).
    [
      "HQ unable to check Zerops",
      { kind: "unchecked", build: "b1", parts: QUIET },
      { kind: "unchecked", build: "b1", parts: QUIET },
    ],
  ])("after its stream breaks, says %s as HQ's health does", async (_case, health, standing) => {
    vi.useFakeTimers();
    const h = harness(health);
    const api = streamingApi([
      { events: [snapshot], end: "cut" },
      { events: [], end: "hang" },
    ]);
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(h.views.at(-1)?.standing).toEqual(standing);
      expect(h.healthReads).toEqual([10_000]);
      await vi.advanceTimersByTimeAsync(1000);
      // Answering again is HQ's health: its stream says so, no read.
      expect(h.views.at(-1)?.standing).toEqual(standing);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it("says nothing before HQ first answers, healthy once its stream does, and reads no health while it serves", async () => {
    vi.useFakeTimers();
    const h = harness();
    // A stream that serves: its snapshot, then HQ's ping every 20 s.
    const api = {
      streamStructure: async (on: Parameters<HqApi["streamStructure"]>[0], signal: AbortSignal) => {
        on.onAlive();
        on.onEvent(snapshot);
        const pings = setInterval(on.onAlive, 20_000);
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            clearInterval(pings);
            reject(signal.reason);
          }),
        );
      },
    };
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      expect(h.views[0]?.standing ?? { kind: "unknown" }).toEqual({ kind: "unknown" });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(h.views.at(-1)?.standing).toEqual({ kind: "healthy", build: "b0" });
      expect(h.healthReads).toEqual([]);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  // An HQ serving through its grace while Zerops does not answer its check is no outage, and
  // says so while its stream serves (e840eb444), with no read of its own.
  it("says while its stream serves whether HQ could check Zerops, as the stream tells it", async () => {
    vi.useFakeTimers();
    const h = harness();
    const api = streamingApi([
      {
        events: [
          { ...snapshot, official: "unknown" },
          { kind: "official", official: "ok" },
          { kind: "official", official: "unknown" },
        ],
        end: "hang",
      },
    ]);
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(
        h.views.flatMap((view) => (view.standing === undefined ? [] : [view.standing.kind])),
      ).toEqual(["unchecked", "healthy", "unchecked"]);
      expect(h.views.at(-1)).toMatchObject({ current: true, structure: ACME });
      expect(h.healthReads).toEqual([]);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it("reads HQ's health once per failed attempt, never while the tab is hidden, once on its return", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.page.visible = false;
    const api = streamingApi([{ events: [], end: "fail" }]);
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
      expect(api.attempts()).toBe(4);
      expect(h.healthReads).toEqual([]);
      // What the stream itself says stands: HQ did not answer it.
      expect(h.views.at(-1)?.standing).toEqual({ kind: "unavailable", since: 10_000 });
      h.show();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.healthReads).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(8000);
      expect(api.attempts()).toBe(5);
      expect(h.healthReads).toHaveLength(2);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  // A refusal waits for a manual again: no next attempt would ever read HQ's health.
  it("reads HQ's health on the tab's return after a refusal it was hidden for", async () => {
    vi.useFakeTimers();
    const h = harness({ kind: "unchecked", build: "b1", parts: QUIET });
    h.page.visible = false;
    const api = {
      streamStructure: async () => {
        throw new HqError({ kind: "refused", code: "session_required", message: "Sign in." });
      },
    };
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.healthReads).toEqual([]);
      h.show();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.healthReads).toHaveLength(1);
      expect(h.views.at(-1)?.standing).toEqual({ kind: "unchecked", build: "b1", parts: QUIET });
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it("keeps only the newest health answer, whichever comes back first", async () => {
    vi.useFakeTimers();
    const h = harness();
    const answers: Array<(health: HqHealth) => void> = [];
    const api = streamingApi([{ events: [], end: "fail" }]);
    const stop = new AbortController();
    const driving = driveHqStructure({
      ...h.deps,
      readHealth: () => new Promise<HqHealth>((resolve) => answers.push(resolve)),
      api,
      signal: stop.signal,
    });
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(answers).toHaveLength(2);
      answers[1]!({ kind: "unchecked", build: "b1", parts: QUIET });
      await vi.advanceTimersByTimeAsync(0);
      answers[0]!({ kind: "unreachable" });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.views.at(-1)?.standing).toEqual({ kind: "unchecked", build: "b1", parts: QUIET });
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  // What an owner's update offer weighs (`ZeropsHqUpdate.logic.ts`): the Core HQ runs, as its stream
  // names it. A stream that names none names nothing — no read stands in for it; HQ's card reads
  // the running Core from Zerops instead.
  it.each<[string, HqStructureEvent, HqStanding]>([
    [
      "named",
      { ...snapshot, build: "20261004T100000Z.0123456789ab" },
      { kind: "healthy", build: "20261004T100000Z.0123456789ab" },
    ],
    ["named by none", legacy, { kind: "healthy" }],
  ])("names the Core HQ runs from its stream: %s", async (_case, event, standing) => {
    vi.useFakeTimers();
    const h = harness();
    const stop = new AbortController();
    const driving = driveHqStructure({
      ...h.deps,
      api: streamingApi([{ events: [event], end: "hang" }]),
      signal: stop.signal,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(h.views.at(-1)?.standing).toEqual(standing);
      expect(h.healthReads).toEqual([]);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  // HQ's card says how its parts stand off the stream, as each change comes; no health read.
  it("says how HQ's parts stand as its stream tells them", async () => {
    vi.useFakeTimers();
    const h = harness();
    const parts = { db: "up" as const, quarantined: [], backup: { state: "pending" as const } };
    const api = streamingApi([
      {
        events: [
          { ...snapshot, build: "b2", parts },
          { kind: "parts", parts: { ...parts, backup: { state: "ok", takenAt: 5 } } },
        ],
        end: "hang",
      },
    ]);
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(h.views.at(-1)?.standing).toEqual({
        kind: "healthy",
        build: "b2",
        parts: { ...parts, backup: { state: "ok", takenAt: 5 } },
      });
      expect(h.healthReads).toEqual([]);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  // A serving stream is HQ answering as the official one: a Core yet to finish its first check
  // (`null`), or one whose stream says nothing of it, serves — no health read stands in for it.
  it.each<[string, HqStructureEvent]>([
    ["yet to check", { ...snapshot, official: null }],
    ["silent on its check", legacy],
  ])("reads no health for a serving Core %s", async (_case, event) => {
    vi.useFakeTimers();
    const h = harness({ kind: "unchecked", build: "b1", parts: QUIET });
    const stop = new AbortController();
    const driving = driveHqStructure({
      ...h.deps,
      api: streamingApi([{ events: [event, event], end: "hang" }]),
      signal: stop.signal,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(h.healthReads).toEqual([]);
      expect(h.views.at(-1)).toMatchObject({ current: true, standing: { kind: "healthy" } });
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });
});

describe("automatic HQ recovery", () => {
  it("backs off to 30 s, keeps its outage, and keeps trying at the cap", async () => {
    vi.useFakeTimers();
    const h = harness();
    const api = streamingApi([{ events: [], end: "cut" }]);
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      for (const [index, delayMs] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
        expect(api.attempts()).toBe(index + 1);
        expect(h.views.at(-1)).toMatchObject({
          structure: null,
          readAt: null,
          current: false,
          unavailableSince: 10000,
          reconnecting: { delayMs, capped: delayMs === 30000 },
        });
        expect(hqOutageLine(h.views.at(-1)!, "locale", 10000)).toContain(
          delayMs === 30000 ? "Retrying every 30 seconds." : "Reconnecting…",
        );
        if (delayMs < 30000) expect(h.views.at(-1)?.failure).toBeNull();
        h.tick(delayMs);
        await vi.advanceTimersByTimeAsync(delayMs - 1);
        expect(api.attempts()).toBe(index + 1);
        await vi.advanceTimersByTimeAsync(1);
      }
      requestHqSnapshot("org-1");
      await vi.advanceTimersByTimeAsync(0);
      expect(api.attempts()).toBe(9);
      expect(h.views.at(-1)).toMatchObject({
        reconnecting: { delayMs: 1000, capped: false },
        failure: null,
      });
    } finally {
      stop.abort();
      await driving;
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

  it("replaces the cap notice with quiet recovery while a manual reconnect awaits its snapshot", async () => {
    vi.useFakeTimers();
    const h = harness();
    let attempts = 0;
    const api = {
      streamStructure: async (
        _on: Parameters<HqApi["streamStructure"]>[0],
        signal: AbortSignal,
      ) => {
        if (++attempts <= 6) throw new Error("Connection lost.");
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        );
      },
    };
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(31000);
      expect(h.views.at(-1)).toMatchObject({ reconnecting: { capped: true } });
      requestHqSnapshot("org-1");
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(7);
      expect(h.views.at(-1)).toMatchObject({
        failure: null,
        reconnecting: { delayMs: 0, capped: false },
      });
      expect(hqOutageLine(h.views.at(-1)!, "locale", 10000)).toContain("Reconnecting…");
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it.each(["session_required", "forbidden"])(
    "does not reconnect a definitive %s refusal",
    async (code) => {
      vi.useFakeTimers();
      const h = harness();
      const refusal = new HqError({
        kind: "refused",
        code,
        status: code === "forbidden" ? 403 : 401,
        message: "Access ended.",
      });
      const api = {
        streamStructure: vi.fn(async () => {
          throw refusal;
        }),
      };
      const stop = new AbortController();
      const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
      try {
        await vi.advanceTimersByTimeAsync(120000);
        expect(api.streamStructure).toHaveBeenCalledTimes(1);
        expect(h.views.at(-1)).toMatchObject({
          structure: null,
          failure: "Access ended.",
          reconnecting: null,
        });
        requestHqSnapshot("org-1");
        await vi.advanceTimersByTimeAsync(0);
        expect(api.streamStructure).toHaveBeenCalledTimes(2);
      } finally {
        stop.abort();
        await driving;
        vi.useRealTimers();
      }
    },
  );

  it("reconnects a silent stream and resets backoff only when a fresh snapshot arrives", async () => {
    vi.useFakeTimers();
    const h = harness();
    const handlers: Array<Parameters<HqApi["streamStructure"]>[0]> = [];
    const api = {
      streamStructure: async (on: Parameters<HqApi["streamStructure"]>[0], signal: AbortSignal) => {
        handlers.push(on);
        if (handlers.length === 1 || handlers.length === 3)
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          );
        else {
          on.onAlive();
          throw new Error("Connection lost.");
        }
      },
    };
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(60000);
      expect(h.views.at(-1)).toMatchObject({ reconnecting: { delayMs: 1000 } });
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.views.at(-1)).toMatchObject({ reconnecting: { delayMs: 2000 } });
      await vi.advanceTimersByTimeAsync(2000);
      handlers[2]!.onEvent({
        kind: "snapshot",
        structure: ACME,
        changes: null,
        appReads: null,
        mates: null,
        people: null,
      });
      expect(h.views.at(-1)).toMatchObject({
        current: true,
        failure: null,
        unavailableSince: null,
        reconnecting: null,
      });
      await vi.advanceTimersByTimeAsync(60000);
      expect(h.views.at(-1)).toMatchObject({ reconnecting: { delayMs: 1000 } });
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it("ignores late callbacks from a failed attempt during backoff", async () => {
    vi.useFakeTimers();
    const h = harness();
    let callbacks: Parameters<HqApi["streamStructure"]>[0] | undefined;
    const api = {
      streamStructure: async (on: Parameters<HqApi["streamStructure"]>[0]) => {
        callbacks = on;
        throw new Error("Connection lost.");
      },
    };
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      callbacks!.onEvent({
        kind: "snapshot",
        structure: { ungrouped: [], apps: [BETA] },
        changes: null,
        appReads: null,
        mates: null,
        people: null,
      });
      expect(h.views.at(-1)).toMatchObject({
        structure: null,
        current: false,
        reconnecting: { delayMs: 1000 },
      });
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it("immediately reconnects 1001 once, then backs off repeated going-away without a snapshot", async () => {
    vi.useFakeTimers();
    const h = harness();
    const api = {
      streamStructure: vi.fn(async () => {
        throw new HqError({
          kind: "unavailable",
          code: "socket_1001",
          message: "HQ is restarting.",
        });
      }),
    };
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(api.streamStructure).toHaveBeenCalledTimes(2);
      expect(h.views.at(-1)).toMatchObject({ reconnecting: { delayMs: 1000 } });
      await vi.advanceTimersByTimeAsync(1000);
      expect(api.streamStructure).toHaveBeenCalledTimes(3);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });
});

describe("planned HQ segments", () => {
  it.each([1000, 1001, 1006, 1011, 4408])(
    "keeps structure and Mates live through rotation, then marks close %i stale",
    async (code) => {
      const h = harness();
      const stop = new AbortController();
      type Handlers = Parameters<OpenHqSocket>[1];
      const sockets: Array<Handlers> = [];
      let openedNext: (on: Handlers) => void = () => undefined;
      const next = new Promise<Handlers>((resolve) => {
        openedNext = resolve;
      });
      let failed: () => void = () => undefined;
      const unavailable = new Promise<void>((resolve) => {
        failed = resolve;
      });
      let tickets = 0;
      const api = makeHqApi({
        address: "https://hq.example",
        fetch: async (url) =>
          new URL(String(url)).pathname === "/api/door"
            ? Response.json({ session: "session-1", expiresAt: "", userId: "u1" })
            : Response.json({ ticket: `t-${++tickets}` }),
        throughDoor: async (use) => use("throwaway"),
        openSocket: (_url, on) => {
          sockets.push(on);
          if (sockets.length === 1)
            queueMicrotask(() => {
              on.message(
                JSON.stringify({ type: "snapshot", ...ACME, mates: { vera: VERA }, people: {} }),
              );
              on.close(4410);
            });
          else openedNext(on);
          return { send: () => undefined, close: () => queueMicrotask(() => on.close(1005)) };
        },
      });
      const done = driveHqStructure({
        ...h.deps,
        api,
        signal: stop.signal,
        publish: (view) => {
          h.deps.publish(view);
          if (view.unavailableSince !== null) failed();
        },
      });
      try {
        const on = await Promise.race([next, unavailable.then(() => undefined)]);
        expect(on).toBeDefined();
        expect(h.views.slice(1).every((view) => view.current && view.failure === null)).toBe(true);
        expect(h.views.at(-1)?.structure).toEqual(ACME);
        expect(h.mates.at(-1)).toMatchObject({ current: true, mates: new Map([["vera", VERA]]) });
        expect(hqOutageLine(h.views.at(-1)!, "locale", 10000)).toBeNull();
        // A failed next handshake (1006) brings no snapshot; its last live data still stands.
        if (code !== 1006) {
          on!.message(
            JSON.stringify({
              type: "snapshot",
              ungrouped: [],
              apps: [BETA],
              mates: {},
              people: {},
            }),
          );
          expect(h.views.at(-1)?.structure?.apps).toEqual([BETA]);
        }
        on!.close(code);
        await unavailable;
        expect(h.views.at(-1)).toMatchObject({ current: false, unavailableSince: 10000 });
        expect(h.mates.at(-1)?.current).toBe(false);
        expect(sockets).toHaveLength(2);
      } finally {
        stop.abort();
        await done;
      }
    },
  );
});

describe("hqOutageKind: where the menu says HQ's standing", () => {
  const view = (over: Partial<HqStructureView>): HqStructureView => ({
    organizationId: "org",
    structure: ACME,
    changes: null,
    appReads: null,
    readAt: 1000,
    current: false,
    unavailableSince: null,
    ...over,
  });
  it.each<[string, HqStructureView | null, "syncing" | "unavailable" | null]>([
    ["nothing known yet", null, null],
    ["HQ answers", view({ current: true }), null],
    ["the structure read again: a spinner", view({}), "syncing"],
    ["nothing drawn yet, nothing said", view({ readAt: null, structure: null }), null],
    [
      "the stream reconnecting: a spinner",
      view({ reconnecting: { capped: false } } as Partial<HqStructureView>),
      "syncing",
    ],
    ["HQ not answering: said in words", view({ unavailableSince: 5000 }), "unavailable"],
    [
      "retries capped: said in words",
      view({ unavailableSince: 5000, reconnecting: { capped: true } } as Partial<HqStructureView>),
      "unavailable",
    ],
  ])("%s", (_case, v, kind) => {
    expect(hqOutageKind(v)).toBe(kind);
    // Said somewhere exactly when there is a line to say.
    expect(hqOutageLine(v, "locale", 10000) === null).toBe(kind === null);
  });
});

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
    "holds rows during backoff after %s and allows manual reconnect",
    async (end) => {
      const h = harness();
      const controller = new AbortController();
      let calls = 0;
      const api: Pick<HqApi, "streamStructure"> = {
        streamStructure: async (on) => {
          calls++;
          // The rows it holds: HQ's answer before the stream ended.
          if (calls === 1)
            on.onEvent({
              kind: "snapshot",
              structure: ACME,
              changes: null,
              appReads: null,
              mates: null,
              people: null,
            });
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
  // B5: a press another browser holds, measured on this browser's clock from when HQ said it.
  it("keeps each press HQ holds, its hold from when HQ said it, until a message says them again", async () => {
    vi.useFakeTimers();
    const h = harness();
    const api = streamingApi([
      {
        events: [
          {
            kind: "snapshot",
            structure: ACME,
            changes: null,
            appReads: null,
            mates: null,
            people: null,
            presses: { p1: { kind: "mate", heldForMs: 60_000 } },
          },
          { pingAfterMs: 5_000, tick: h.tick },
          {
            kind: "presses",
            presses: { p1: { kind: "mate", heldForMs: 60_000, importProcessId: "imp-1" } },
          },
        ],
        end: "hang",
      },
    ]);
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const pressesSaid = h.views.flatMap((view) => (view.presses == null ? [] : [view.presses]));
      expect(pressesSaid[0]).toEqual(
        new Map([["p1", { kind: "mate", expiresAtMs: 10_000 + 60_000 }]]),
      );
      expect(h.views.at(-1)?.presses).toEqual(
        new Map([["p1", { kind: "mate", expiresAtMs: 15_000 + 60_000, importProcessId: "imp-1" }]]),
      );
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it("automatically reconnects an initial failure with no data to show", async () => {
    vi.useFakeTimers();
    const api = streamingApi([
      { events: [], end: "fail" },
      { events: [], end: "hang" },
    ]);
    const h = harness();
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(api.attempts()).toBe(1);
      expect(hqOutageLine(h.views.at(-1)!, "locale", 10000)).toBe("Reconnecting…");
      await vi.advanceTimersByTimeAsync(1000);
      expect(api.attempts()).toBe(2);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it("reconnects an IPv4 cut at 120 s when pings kept the socket alive", async () => {
    vi.useFakeTimers();
    const h = harness();
    const stop = new AbortController();
    let attempts = 0;
    const api = {
      streamStructure: async (on: Parameters<HqApi["streamStructure"]>[0], signal: AbortSignal) => {
        attempts++;
        on.onEvent({
          kind: "snapshot",
          structure: ACME,
          changes: null,
          appReads: null,
          mates: null,
          people: null,
        });
        await new Promise<void>((_resolve, reject) => {
          const ping = setInterval(() => {
            h.tick(20000);
            on.onAlive();
          }, 20000);
          const cut = setTimeout(() => {
            clearInterval(ping);
            reject(
              new HqError({
                kind: "unavailable",
                code: "socket_1006",
                message: "HQ's stream broke.",
              }),
            );
          }, 120000);
          signal.addEventListener("abort", () => {
            clearInterval(ping);
            clearTimeout(cut);
            reject(signal.reason);
          });
        });
      },
    };
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    try {
      await vi.advanceTimersByTimeAsync(120000);
      expect(attempts).toBe(1);
      expect(h.views.at(-1)).toMatchObject({
        structure: ACME,
        current: false,
        failure: null,
        reconnecting: { delayMs: 1000 },
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(attempts).toBe(2);
      expect(h.views.at(-1)).toMatchObject({ current: true, reconnecting: null });
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

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
      ready: true,
      comments: 0,
    };
    const merged: HqChange = { ...change, state: "merged", mergedAt: "2026-10-02T10:00:00.000Z" };
    const api = streamingApi([
      {
        events: [
          {
            kind: "snapshot",
            appReads: null,
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
          {
            kind: "snapshot",
            appReads: null,
            structure: ACME,
            changes: new Map(),
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
    await vi.waitFor(() => expect(h.views.at(-1)?.unavailableSince).not.toBeNull());
    requestHqSnapshot("org-1");
    await vi.waitFor(() => expect(h.views.at(-1)?.changes).toEqual(new Map()));
    stop.abort();
    await driving;

    expect(h.views.map((view) => view.changes)).toContainEqual(new Map([["app-1", [change]]]));
    expect(h.views.map((view) => view.changes)).toContainEqual(new Map([["app-1", [merged]]]));
  });

  it("a failed manual snapshot retains the latest app value from the previous stream", async () => {
    vi.useFakeTimers();
    const handlers: Array<Parameters<HqApi["streamStructure"]>[0]> = [];
    const api = {
      streamStructure: async (on: Parameters<HqApi["streamStructure"]>[0], signal: AbortSignal) => {
        handlers.push(on);
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      },
    };
    const h = harness();
    const stop = new AbortController();
    const driving = driveHqStructure({
      ...h.deps,
      api,
      signal: stop.signal,
    });
    const value = {
      releases: [],
      repos: [],
      recipes: { stage: { state: "absent" as const }, production: { state: "absent" as const } },
    };
    const fresh = {
      ...value,
      repos: [{ name: "group", mainHead: "b".repeat(40), updatedAt: "2026-10-03T10:00:00.000Z" }],
    };
    const snapshot = (read: AppRead): HqStructureEvent => ({
      kind: "snapshot",
      structure: ACME,
      changes: new Map(),
      appReads: new Map([["app-1", read]]),
      mates: null,
      people: null,
    });
    try {
      handlers[0]!.onEvent(snapshot({ revision: "1", value, failure: null }));
      handlers[0]!.onEvent({
        kind: "release-revision",
        appId: "app-1",
        read: { revision: "2", value: fresh, failure: null },
      });
      expect(h.views.at(-1)?.appReads?.get("app-1")?.value).toEqual(fresh);
      requestHqSnapshot("org-1");
      await vi.advanceTimersByTimeAsync(0);
      expect(handlers).toHaveLength(2);
      handlers[1]!.onEvent(
        snapshot({
          revision: "3",
          value: null,
          failure: { code: "repo_unavailable", reason: null },
        }),
      );
      expect(h.views.at(-1)?.appReads?.get("app-1")?.value).toEqual(fresh);
    } finally {
      stop.abort();
      await driving;
      vi.useRealTimers();
    }
  });

  it("an explicit recipe retry asks for a fresh snapshot and keeps the current view meanwhile", async () => {
    const api = streamingApi([
      {
        events: [
          {
            kind: "snapshot",
            structure: ACME,
            changes: new Map(),
            appReads: new Map(),
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
    await vi.waitFor(() => expect(api.attempts()).toBe(1));
    requestHqSnapshot("org-1");
    await vi.waitFor(() => expect(api.attempts()).toBe(2));
    expect(h.views.at(-1)?.structure).toEqual(ACME);
    stop.abort();
    await driving;
    requestHqSnapshot("org-1");
    expect(api.attempts()).toBe(2);
  });

  it("carries each application's load data from its stream and replaces it on manual again", async () => {
    const read = (revision: string) => ({
      revision,
      value: {
        releases: [],
        repos: [],
        recipes: { stage: { state: "absent" as const }, production: { state: "absent" as const } },
      },
      failure: null,
    });
    const api = streamingApi([
      {
        events: [
          {
            kind: "snapshot",
            appReads: new Map([["app-1", read("41")]]),
            structure: ACME,
            changes: null,
            mates: null,
            people: null,
            official: "ok",
          },
          { kind: "release-revision", appId: "app-1", read: read("57") },
        ],
        end: "close",
      },
      {
        events: [
          {
            kind: "snapshot",
            appReads: new Map(),
            structure: ACME,
            changes: null,
            mates: null,
            people: null,
            official: "ok",
          },
        ],
        end: "hang",
      },
    ]);
    const h = harness();
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    await vi.waitFor(() => expect(h.views.at(-1)?.unavailableSince).not.toBeNull());
    requestHqSnapshot("org-1");
    await vi.waitFor(() => expect(h.views.at(-1)?.appReads).toEqual(new Map()));
    stop.abort();
    await driving;
    expect(h.views.map((view) => view.appReads)).toEqual([
      null,
      new Map([["app-1", read("41")]]),
      new Map([["app-1", read("57")]]),
      new Map([["app-1", read("57")]]),
      // HQ's health, read once its stream failed: where it stands, its data as it was.
      new Map([["app-1", read("57")]]),
      new Map([["app-1", read("57")]]),
      new Map(),
    ]);
  });

  it("draws nothing of HQ until it answers, then its snapshot and its changes", async () => {
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
    const h = harness();
    const stop = new AbortController();
    const driving = driveHqStructure({ ...h.deps, api, signal: stop.signal });
    await vi.waitFor(() => expect(h.views).toHaveLength(3));
    stop.abort();
    await driving;

    expect(h.views[0]).toEqual({
      failure: null,
      organizationId: "org-1",
      structure: null,
      changes: null,
      appReads: null,
      readAt: null,
      current: false,
      unavailableSince: null,
    });
    expect(h.views[1]).toMatchObject({ structure: ACME, current: true, readAt: 10_000 });
    expect(h.views[2]).toMatchObject({
      structure: { ungrouped: [], apps: [...ACME.apps, BETA] },
      current: true,
    });
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
            official: "ok",
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

    // Nothing yet, then HQ's snapshot of it: nothing for a Mate's message.
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
