import { expect, it } from "vite-plus/test";

import {
  routeDeadlineRuns,
  routeTargetPastDeadline,
  selectRouteGate,
  type RouteGate,
  type RouteHqWait,
  type RouteMate,
  type RouteTarget,
} from "./gate.ts";

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

// witness: packages/client-runtime/src/zerops/environments/gate.ts | mate.stopped || mate.operates === false; → mate.operates === false;
it("EN+1: A route's Mate that is stopped, or that the viewer may not operate, is never said not to answer however long its route waits; breaks: its Owner never gets Start and a Read only viewer is offered Try again", () => {
  const reachability = { kind: "connecting", waitingOn: "exchange" } as const;
  const target: RouteTarget = { kind: "resolved", reachability, content: "empty" };
  const waits: RouteGate = { kind: "wait", reachability };
  const ends: RouteGate = { kind: "ended", end: "not-answering" };
  // state × the viewer's operate verdict → whether the deadline runs, and the gate past it.
  const table: ReadonlyArray<readonly [RouteMate, boolean, RouteGate]> = [
    [{ stopped: false, operates: true }, true, ends],
    [{ stopped: false, operates: undefined }, true, ends],
    [{ stopped: false, operates: false }, false, waits],
    [{ stopped: true, operates: true }, false, waits],
    [{ stopped: true, operates: undefined }, false, waits],
    [{ stopped: true, operates: false }, false, waits],
  ];
  for (const [mate, runs, past] of table) {
    expect({ mate, before: selectRouteGate(target) }).toEqual({ mate, before: waits });
    expect({ mate, runs: routeDeadlineRuns(target, mate) }).toEqual({ mate, runs });
    expect({ mate, past: selectRouteGate(routeTargetPastDeadline(target, mate)) }).toEqual({
      mate,
      past,
    });
  }
});
