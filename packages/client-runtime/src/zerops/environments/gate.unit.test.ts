import { expect, it } from "vite-plus/test";

import { selectRouteGate, type RouteHqWait } from "./gate.ts";

// witness: packages/client-runtime/src/zerops/environments/gate.ts | return { kind: "wait", reachability: null }; → return { kind: "unavailable", reachability: null };
it("EN+7: The route gate never says not in your projects while discovery is pending, no organization is chosen, or only HQ can name the environment", () => {
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
