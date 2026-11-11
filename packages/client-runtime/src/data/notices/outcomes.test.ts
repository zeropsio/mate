import { expect, it } from "vite-plus/test";
import { readRecoveryOutcome } from "../projections/restart.ts";
import { presentOutcomes } from "./outcomes.ts";

// The recovery command creates the complete invocation, and its projection creates the outcome.
const old = {
  requestId: "old",
  origin: "recovery:org/p",
  slot: "recovery:org/p/restart/s",
  orgId: "org",
  projectId: "p",
  serviceId: "s",
  name: "app",
  action: "restart" as const,
};
const newer = { ...old, requestId: "new" };
const refused = (requestId: string) =>
  readRecoveryOutcome(requestId, "restart", { stage: "refused", reason: "refused" });
const pending = (requestId: string) =>
  readRecoveryOutcome(requestId, "restart", { stage: "uncertain", next: "ask-owner-again" });

it("newer recovery feedback supersedes older results in submission order", () => {
  const items = presentOutcomes(
    [old, newer],
    ({ requestId }) =>
      requestId === "old"
        ? readRecoveryOutcome(requestId, "restart", {
            stage: "done",
            operationId: "op",
            outcome: "succeeded",
          })
        : refused(requestId),
    new Map(),
    new Set(),
  );
  expect(items.map(({ outcome }) => outcome.text)).toEqual(["Restart refused."]);
});

it("an older unresolved request remains reachable beside the newer feedback", () => {
  const items = presentOutcomes(
    [old, newer],
    ({ requestId }) => (requestId === "new" ? refused(requestId) : pending(requestId)),
    new Map(),
    new Set(["old"]),
  );
  expect(items.map(({ invocation }) => invocation.requestId)).toEqual(["old", "new"]);
});

it("terminal feedback retains sixteen slots without evicting an unresolved request", () => {
  const invocations = [
    old,
    ...Array.from({ length: 18 }, (_, i) => ({
      ...old,
      requestId: `r${i}`,
      origin: `recovery:org/p${i}`,
      projectId: `p${i}`,
      slot: `recovery:org/p${i}/restart/s`,
    })),
  ];
  const items = presentOutcomes(
    invocations,
    ({ requestId }) => (requestId === "old" ? pending(requestId) : refused(requestId)),
    new Map(),
    new Set(),
  );
  expect(items.map(({ invocation }) => invocation.requestId)).toEqual([
    "old",
    ...Array.from({ length: 16 }, (_, i) => `r${i + 2}`),
  ]);
});

it("closing an origin transfers its unresolved reference to the shell without changing the outcome", () => {
  const outcome = pending("old");
  const shown = presentOutcomes([old], () => outcome, new Map([[old.origin, 1]]), new Set());
  const closed = presentOutcomes([old], () => outcome, new Map(), new Set());
  expect(shown[0]?.primary).toBe(old.origin);
  expect(closed[0]?.primary).toBe("shell");
  expect(closed[0]?.outcome).toBe(outcome);
});
