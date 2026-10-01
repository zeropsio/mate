import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  ConnectionAdmissionRef,
  makeConnectionAdmission,
  OTHER_ATTEMPT_MS,
  ROUTE_FIRST_HOLD_MS,
  UNCLAIMED_TICKET_MS,
  type AdmissionTicket,
  type AdmissionTimers,
} from "./admission.ts";

const ROUTE = EnvironmentId.make("env-route");
const OTHER = EnvironmentId.make("env-other");
const THIRD = EnvironmentId.make("env-third");

/** Timers that fire only when the test moves the clock. */
function manualTimers(): AdmissionTimers & { readonly advance: (ms: number) => void } {
  let now = 0;
  const armed = new Map<number, { readonly at: number; readonly fire: () => void }>();
  let next = 0;
  return {
    setTimer: (delayMs, fire) => {
      const id = next++;
      armed.set(id, { at: now + delayMs, fire });
      return () => void armed.delete(id);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of armed) {
        if (timer.at > now) continue;
        armed.delete(id);
        timer.fire();
      }
    },
  };
}

const flush = async () => {
  for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
};

/** Asks for an attempt; `ticket` is set once admitted. */
function ask(
  admission: ReturnType<typeof makeConnectionAdmission>,
  environmentId: EnvironmentId,
  signal?: AbortSignal,
) {
  const asked: { ticket: AdmissionTicket | null; refused: boolean } = {
    ticket: null,
    refused: false,
  };
  admission.admit(environmentId, signal).then(
    (ticket) => {
      asked.ticket = ticket;
    },
    () => {
      asked.refused = true;
    },
  );
  return asked;
}

describe("connection admission", () => {
  it.each([
    { name: "with no route, another environment starts at once", prefer: null, admitted: true },
    { name: "while the route's exchange runs, others wait", prefer: ROUTE, admitted: false },
  ])("$name", async ({ prefer, admitted }) => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.prefer(prefer);
    const other = ask(admission, OTHER);
    await flush();
    expect(other.ticket !== null).toBe(admitted);
  });

  it.each([
    { name: "the route's socket opened", end: "open" },
    { name: "the route's first attempt failed", end: "failed" },
    { name: "the route changed to none", end: "unrouted" },
    { name: `${ROUTE_FIRST_HOLD_MS} ms passed with the route never attempting`, end: "cap" },
  ] as const)("the others start once $name", async ({ end }) => {
    const timers = manualTimers();
    const admission = makeConnectionAdmission(timers);
    admission.prefer(ROUTE);
    const other = ask(admission, OTHER);
    await flush();
    expect(other.ticket).toBeNull();

    if (end === "open" || end === "failed") {
      const route = ask(admission, ROUTE);
      await flush();
      route.ticket!.settle(end === "open");
    } else if (end === "unrouted") {
      admission.prefer(null);
    } else {
      timers.advance(ROUTE_FIRST_HOLD_MS - 1);
      await flush();
      expect(other.ticket).toBeNull();
      timers.advance(1);
    }
    await flush();
    expect(other.ticket).not.toBeNull();
  });

  it("the route reconnecting holds the others again, and they yield the lock to it", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.prefer(ROUTE);
    const first = ask(admission, ROUTE);
    await flush();
    first.ticket!.settle(true);
    const other = ask(admission, OTHER);
    await flush();
    expect(other.ticket).not.toBeNull();

    // The route's socket drops and it tries again while the other is still connecting.
    first.ticket!.close();
    const again = ask(admission, ROUTE);
    await flush();
    expect(again.ticket).not.toBeNull();
    expect(other.ticket!.signal.aborted).toBe(true);

    // Nothing else starts until the route's attempt ends.
    const third = ask(admission, THIRD);
    await flush();
    expect(third.ticket).toBeNull();
    again.ticket!.settle(true);
    await flush();
    expect(third.ticket).not.toBeNull();
  });

  it("with a route named, other environments start one at a time, each yielding after its time", async () => {
    const timers = manualTimers();
    const admission = makeConnectionAdmission(timers);
    admission.prefer(ROUTE);
    const route = ask(admission, ROUTE);
    await flush();
    route.ticket!.claim();
    route.ticket!.settle(true);
    const other = ask(admission, OTHER);
    const third = ask(admission, THIRD);
    await flush();
    expect([other.ticket !== null, third.ticket !== null]).toEqual([true, false]);
    other.ticket!.claim();

    // Held by a Mate whose upgrade the balancer keeps waiting, it gives way.
    timers.advance(OTHER_ATTEMPT_MS - 1);
    await flush();
    expect(other.ticket!.signal.aborted).toBe(false);
    timers.advance(1);
    await flush();
    expect(other.ticket!.signal.aborted).toBe(true);
    expect(third.ticket).not.toBeNull();
    third.ticket!.claim();
    expect(third.ticket!.signal.aborted).toBe(false);
  });

  it.each([
    { name: "a route whose socket is already open holds nobody", reopenAfterClose: false },
    { name: "a route whose socket closed holds the others again", reopenAfterClose: true },
  ])("$name", async ({ reopenAfterClose }) => {
    const admission = makeConnectionAdmission(manualTimers());
    const route = ask(admission, ROUTE);
    await flush();
    route.ticket!.settle(true);
    if (reopenAfterClose) route.ticket!.close();
    admission.prefer(ROUTE);
    const other = ask(admission, OTHER);
    await flush();
    expect(other.ticket === null).toBe(reopenAfterClose);
  });

  it("an environment open twice stays open until both sockets close", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    const active = ask(admission, ROUTE);
    await flush();
    active.ticket!.settle(true);
    const replacement = ask(admission, ROUTE);
    await flush();
    replacement.ticket!.settle(true);
    active.ticket!.close();
    active.ticket!.close();
    admission.prefer(ROUTE);
    const other = ask(admission, OTHER);
    await flush();
    expect(other.ticket).not.toBeNull();
  });

  it("an attempt given up while waiting is refused and never admitted", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.prefer(ROUTE);
    const controller = new AbortController();
    const other = ask(admission, OTHER, controller.signal);
    controller.abort();
    await flush();
    admission.prefer(null);
    await flush();
    expect(other).toEqual({ ticket: null, refused: true });
  });

  describe("the route is judged now, not when it asked", () => {
    const QUEUED = Array.from({ length: 10 }, (_, index) => EnvironmentId.make(`env-q${index}`));

    it.each([
      { name: "named while it waits behind nine others", viaNone: false },
      { name: "named through a switch that passes no route", viaNone: true },
    ])("a queued Mate becoming the route starts at once: $name", async ({ viaNone }) => {
      const timers = manualTimers();
      const admission = makeConnectionAdmission(timers);
      admission.prefer(ROUTE);
      const route = ask(admission, ROUTE);
      await flush();
      route.ticket!.claim();
      const queued = QUEUED.map((environmentId) => ask(admission, environmentId));
      await flush();
      const b = queued[5]!;
      expect(b.ticket).toBeNull();

      if (viaNone) admission.prefer(null);
      await flush();
      const startedBetween = queued.filter((asked, index) => index !== 5 && asked.ticket !== null);
      admission.prefer(QUEUED[5]!);
      await flush();
      expect(b.ticket).not.toBeNull();
      // Whatever started in between is still connecting, and gives way to the new route.
      expect(startedBetween.every((asked) => asked.ticket!.signal.aborted)).toBe(true);
      // The previous route's attempt, still connecting, gives way too.
      expect(route.ticket!.signal.aborted).toBe(true);
    });

    it("the previous route's attempt in flight is an ordinary other: capped", async () => {
      const timers = manualTimers();
      const admission = makeConnectionAdmission(timers);
      admission.prefer(ROUTE);
      const route = ask(admission, ROUTE);
      await flush();
      route.ticket!.claim();
      // The person opens another Mate, whose exchange is still running.
      admission.prefer(OTHER);
      timers.advance(OTHER_ATTEMPT_MS);
      await flush();
      expect(route.ticket!.signal.aborted).toBe(true);
    });

    it("an other becoming the route keeps its socket past the others' time", async () => {
      const timers = manualTimers();
      const admission = makeConnectionAdmission(timers);
      const other = ask(admission, OTHER);
      await flush();
      other.ticket!.claim();
      admission.prefer(OTHER);
      timers.advance(OTHER_ATTEMPT_MS * 2);
      await flush();
      expect(other.ticket!.signal.aborted).toBe(false);
    });
  });

  it("a route ticket whose caller went away before claiming it holds nobody", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.prefer(ROUTE);
    const caller = new AbortController();
    const route = ask(admission, ROUTE, caller.signal);
    await flush();
    expect(route.ticket).not.toBeNull();
    // Interrupted as it started: the ticket is never claimed nor settled.
    caller.abort();
    const other = ask(admission, OTHER);
    await flush();
    expect(other.ticket).not.toBeNull();
  });

  it("with no route named, others still go one at a time, each given its time", async () => {
    const timers = manualTimers();
    const admission = makeConnectionAdmission(timers);
    const other = ask(admission, OTHER);
    const third = ask(admission, THIRD);
    await flush();
    expect([other.ticket !== null, third.ticket !== null]).toEqual([true, false]);
    other.ticket!.claim();
    timers.advance(OTHER_ATTEMPT_MS);
    await flush();
    expect(other.ticket!.signal.aborted).toBe(true);
    expect(third.ticket).not.toBeNull();
  });

  it("naming a route later leaves an attempt in flight its own time", async () => {
    const timers = manualTimers();
    const admission = makeConnectionAdmission(timers);
    const other = ask(admission, OTHER);
    await flush();
    other.ticket!.claim();
    timers.advance(OTHER_ATTEMPT_MS - 2_000);
    admission.prefer(ROUTE);
    timers.advance(2_000);
    await flush();
    // Its 8 s ran from its own start, not from the naming.
    expect(other.ticket!.signal.aborted).toBe(true);
  });

  it("a replacement of the route's open socket makes nobody give way", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.prefer(ROUTE);
    const route = ask(admission, ROUTE);
    await flush();
    route.ticket!.claim();
    route.ticket!.settle(true);
    const other = ask(admission, OTHER);
    await flush();
    other.ticket!.claim();
    const replacement = ask(admission, ROUTE);
    await flush();
    expect(replacement.ticket).not.toBeNull();
    expect(other.ticket!.signal.aborted).toBe(false);
  });

  it("a ticket let go unclaimed can no longer open a socket", async () => {
    const timers = manualTimers();
    const admission = makeConnectionAdmission(timers);
    const other = ask(admission, OTHER);
    await flush();
    timers.advance(UNCLAIMED_TICKET_MS);
    await flush();
    expect(other.ticket!.signal.aborted).toBe(true);
  });

  it("a stale attempt settling does not end the new route's first hold (A, B, A)", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.prefer(ROUTE);
    const stale = ask(admission, ROUTE);
    await flush();
    stale.ticket!.claim();
    // The person opens B, whose attempt makes A's give way, then comes back to A.
    admission.prefer(OTHER);
    const b = ask(admission, OTHER);
    await flush();
    b.ticket!.claim();
    expect(stale.ticket!.signal.aborted).toBe(true);
    admission.prefer(ROUTE);
    // The attempt told to give way ends only now; A's new exchange is still running.
    stale.ticket!.settle(false);
    const third = ask(admission, THIRD);
    await flush();
    expect(third.ticket).toBeNull();
  });

  describe("the others' time runs out only while someone waits", () => {
    it("a lone attempt is never cut off by the others' time", async () => {
      const timers = manualTimers();
      const admission = makeConnectionAdmission(timers);
      const lone = ask(admission, OTHER);
      await flush();
      lone.ticket!.claim();
      timers.advance(12_000);
      await flush();
      expect(lone.ticket!.signal.aborted).toBe(false);
    });

    it("an attempt past its time gives way the moment another waits", async () => {
      const timers = manualTimers();
      const admission = makeConnectionAdmission(timers);
      const lone = ask(admission, OTHER);
      await flush();
      lone.ticket!.claim();
      timers.advance(12_000);
      const next = ask(admission, THIRD);
      await flush();
      expect(lone.ticket!.signal.aborted).toBe(true);
      expect(next.ticket).not.toBeNull();
    });
  });

  describe("an environment the platform says is down", () => {
    it.each([
      { name: "the route", route: true },
      { name: "another environment", route: false },
    ])("$name attempts no socket until it is up again", async ({ route }) => {
      const admission = makeConnectionAdmission(manualTimers());
      const environmentId = route ? ROUTE : OTHER;
      if (route) admission.prefer(ROUTE);
      const up = admission.down(environmentId);
      const asked = ask(admission, environmentId);
      await flush();
      expect(asked.ticket).toBeNull();

      up();
      await flush();
      expect(asked.ticket).not.toBeNull();
    });

    it("an attempt already connecting to it gives way, and others go on", async () => {
      const admission = makeConnectionAdmission(manualTimers());
      const other = ask(admission, OTHER);
      await flush();
      const third = ask(admission, THIRD);
      await flush();
      expect(third.ticket).toBeNull();

      admission.down(OTHER);
      await flush();
      expect(other.ticket!.signal.aborted).toBe(true);
      expect(third.ticket).not.toBeNull();
    });

    it("is up again only once every claim that it is down is released", async () => {
      const admission = makeConnectionAdmission(manualTimers());
      const first = admission.down(OTHER);
      const second = admission.down(OTHER);
      const asked = ask(admission, OTHER);
      first();
      first();
      await flush();
      expect(asked.ticket).toBeNull();
      second();
      await flush();
      expect(asked.ticket).not.toBeNull();
    });
  });

  it("a page's hold and the route's naming are separate claims: the page leaving keeps the route", () => {
    const admission = makeConnectionAdmission(manualTimers());
    const release = admission.hold(ROUTE);
    admission.prefer(ROUTE);
    release();
    expect(admission.preferred()).toBe(ROUTE);
    admission.prefer(null);
    expect(admission.preferred()).toBeNull();
  });
});

describe("without a browser's connection lock", () => {
  it.effect(
    "the default admission, what a client that provides none gets, never makes anyone wait",
    () =>
      Effect.gen(function* () {
        const admission = yield* ConnectionAdmissionRef;
        admission.prefer(ROUTE);
        const tickets = yield* Effect.promise(() =>
          Promise.all([admission.admit(OTHER), admission.admit(THIRD), admission.admit(ROUTE)]),
        );
        expect(tickets.map((ticket) => ticket.signal.aborted)).toEqual([false, false, false]);
      }),
  );
});
