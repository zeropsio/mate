import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeConnectionAdmission, ROUTE_HOLD_MS, type AdmissionTimers } from "./admission.ts";

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

/** Which of these environments have been let through so far. */
function admitted(
  admission: ReturnType<typeof makeConnectionAdmission>,
  environments: ReadonlyArray<EnvironmentId>,
  signal?: AbortSignal,
) {
  const through = new Set<EnvironmentId>();
  const refused = new Set<EnvironmentId>();
  for (const environment of environments) {
    admission.admit(environment, signal).then(
      () => through.add(environment),
      () => refused.add(environment),
    );
  }
  return { through, refused };
}

describe("connection admission", () => {
  it.each([
    {
      name: "with no route, every environment opens at once",
      prefer: null,
      asking: [OTHER, THIRD],
      through: [OTHER, THIRD],
    },
    {
      name: "the route's environment opens at once and the others wait for it",
      prefer: ROUTE,
      asking: [OTHER, ROUTE, THIRD],
      through: [ROUTE],
    },
  ])("$name", async ({ prefer, asking, through }) => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.prefer(prefer);
    const seen = admitted(admission, asking);
    await flush();
    expect([...seen.through].toSorted()).toEqual(through.toSorted());
  });

  it.each([
    { name: "the route's socket opened", end: "open" },
    { name: "the route's attempt failed", end: "failed" },
    { name: "the route changed to none", end: "unrouted" },
    { name: "the route moved to an environment already open", end: "moved-open" },
    { name: `${ROUTE_HOLD_MS} ms passed without the route answering`, end: "cap" },
  ] as const)("the others go once $name", async ({ end }) => {
    const timers = manualTimers();
    const admission = makeConnectionAdmission(timers);
    admission.settle(THIRD, true);
    admission.prefer(ROUTE);
    const seen = admitted(admission, [OTHER]);
    await flush();
    expect(seen.through.size).toBe(0);

    switch (end) {
      case "open":
        admission.settle(ROUTE, true);
        break;
      case "failed":
        admission.settle(ROUTE, false);
        break;
      case "unrouted":
        admission.prefer(null);
        break;
      case "moved-open":
        admission.prefer(THIRD);
        break;
      case "cap":
        timers.advance(ROUTE_HOLD_MS - 1);
        await flush();
        expect(seen.through.size).toBe(0);
        timers.advance(1);
        break;
    }
    await flush();
    expect([...seen.through]).toEqual([OTHER]);
  });

  it("a route whose socket is already open holds nobody", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.settle(ROUTE, true);
    admission.prefer(ROUTE);
    const seen = admitted(admission, [OTHER]);
    await flush();
    expect([...seen.through]).toEqual([OTHER]);
  });

  it("a route whose socket closed holds the others again when it becomes the route", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.settle(ROUTE, true);
    admission.close(ROUTE);
    admission.prefer(ROUTE);
    const seen = admitted(admission, [OTHER]);
    await flush();
    expect(seen.through.size).toBe(0);
  });

  it("an environment open twice stays open until both sockets close", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    // A replacement connection opens beside the active one, then the active one ends.
    admission.settle(ROUTE, true);
    admission.settle(ROUTE, true);
    admission.close(ROUTE);
    admission.prefer(ROUTE);
    const seen = admitted(admission, [OTHER]);
    await flush();
    expect([...seen.through]).toEqual([OTHER]);
  });

  it("an attempt ended while waiting is refused and never let through", async () => {
    const admission = makeConnectionAdmission(manualTimers());
    admission.prefer(ROUTE);
    const controller = new AbortController();
    const seen = admitted(admission, [OTHER], controller.signal);
    controller.abort();
    await flush();
    admission.settle(ROUTE, true);
    await flush();
    expect({ through: [...seen.through], refused: [...seen.refused] }).toEqual({
      through: [],
      refused: [OTHER],
    });
  });

  it("a new route holds the others for its own socket, with its own time", async () => {
    const timers = manualTimers();
    const admission = makeConnectionAdmission(timers);
    admission.prefer(ROUTE);
    timers.advance(ROUTE_HOLD_MS - 1_000);
    admission.prefer(THIRD);
    const seen = admitted(admission, [OTHER]);
    timers.advance(1_000);
    await flush();
    expect(seen.through.size).toBe(0);
    admission.settle(ROUTE, true);
    await flush();
    expect(seen.through.size).toBe(0);
    admission.settle(THIRD, true);
    await flush();
    expect([...seen.through]).toEqual([OTHER]);
  });
});
