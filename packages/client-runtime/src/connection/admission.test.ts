import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  makeConnectionAdmission,
  OTHER_ATTEMPT_MS,
  ROUTE_FIRST_HOLD_MS,
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

  it("other environments start one at a time, each yielding after its time", async () => {
    const timers = manualTimers();
    const admission = makeConnectionAdmission(timers);
    const other = ask(admission, OTHER);
    const third = ask(admission, THIRD);
    await flush();
    expect([other.ticket !== null, third.ticket !== null]).toEqual([true, false]);

    // Held by a Mate whose upgrade the balancer keeps waiting, it gives way.
    timers.advance(OTHER_ATTEMPT_MS - 1);
    await flush();
    expect(other.ticket!.signal.aborted).toBe(false);
    timers.advance(1);
    await flush();
    expect(other.ticket!.signal.aborted).toBe(true);
    expect(third.ticket).not.toBeNull();
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
});
