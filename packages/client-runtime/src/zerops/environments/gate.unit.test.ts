import { expect, it } from "vite-plus/test";

import {
  openingMayEnd,
  routeDeadlineRuns,
  routeTargetPastDeadline,
  selectRouteGate,
  type RouteGate,
  type RouteHqWait,
  type RouteTarget,
} from "./gate.ts";
import type { Reachability } from "./reachability.ts";

// witness: packages/client-runtime/src/zerops/environments/gate.ts | return { kind: "wait", reachability: null }; → return { kind: "unavailable", reachability: null };
it("EN16: The route gate never says not in your projects while discovery is pending, no organization is chosen, or only HQ can name the environment", () => {
  expect(selectRouteGate({ kind: "unresolved", discovery: "pending" })).toEqual({
    kind: "wait",
    reachability: null,
  });
  expect(selectRouteGate({ kind: "unresolved", discovery: "no-organization" })).toEqual({
    kind: "choose-organization",
  });
  const hq: RouteHqWait = { kind: "outage", line: "Reconnecting…", again: false, overdue: true };
  expect(selectRouteGate({ kind: "unresolved", discovery: "hq", hq })).toEqual({
    kind: "wait",
    reachability: null,
    hq,
  });
});

// witness: packages/client-runtime/src/zerops/environments/gate.ts | !mateStopped && → true &&
it("EN21: A route's Mate the owner's reads say is stopped is never said not to answer however long its route waits, and a running one that stays quiet is once the deadline passes; breaks: its Owner is never offered Start and a Read only viewer is offered Try again", () => {
  const reachability = { kind: "connecting", waitingOn: "exchange" } as const;
  const target: RouteTarget = { kind: "resolved", reachability, content: "empty" };
  const waits: RouteGate = { kind: "wait", reachability };
  const ends: RouteGate = { kind: "ended", end: "not-answering" };
  // The Mate's state × elapsed: whether the deadline runs, the gate before it and past it.
  const table: ReadonlyArray<readonly [stopped: boolean, runs: boolean, past: RouteGate]> = [
    [false, true, ends],
    [true, false, waits],
  ];
  for (const [stopped, runs, past] of table) {
    expect({ stopped, before: selectRouteGate(target) }).toEqual({ stopped, before: waits });
    expect({ stopped, runs: routeDeadlineRuns(target, stopped) }).toEqual({ stopped, runs });
    expect({
      stopped,
      past: selectRouteGate(routeTargetPastDeadline(target, stopped)),
    }).toEqual({ stopped, past });
  }
});

// witness: packages/client-runtime/src/zerops/environments/gate.ts | reachability.kind === "ready" || opensQuietly(reachability) → reachability.kind !== "gone"
it("EN22: An opening over a verdict with words of its own, a Mate not answering or a container booting, never ends however long it waits, and one with none, or a ready one, does; breaks: a Mate not answering trades its name, its time and Open in Zerops for This Mate isn't answering after 20 s", () => {
  // The verdict × the Mate stopped: whether a wait over it may end the opening.
  const table: ReadonlyArray<readonly [Reachability | null, stopped: boolean, mayEnd: boolean]> = [
    [{ kind: "not-answering", overdue: false }, false, false],
    [{ kind: "container", container: { level: "booting", overdue: false } }, false, false],
    [{ kind: "connecting", waitingOn: "mate-link" }, false, false],
    [{ kind: "connecting", waitingOn: "exchange" }, false, true],
    [{ kind: "ready", notice: null }, false, true],
    [null, false, true],
    [null, true, false],
  ];
  for (const [reachability, stopped, mayEnd] of table) {
    expect({ reachability, stopped, mayEnd: openingMayEnd(reachability, stopped) }).toEqual({
      reachability,
      stopped,
      mayEnd,
    });
  }
});
