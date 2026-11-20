import { expect, it } from "vite-plus/test";
import { readRecoveryOutcome } from "../zerops/restart.ts";
import { presentOutcomes } from "./notices/outcomes.ts";

function restartRequest(requestId: string, projectId = "p") {
  return {
    requestId,
    origin: `recovery:org/${projectId}`,
    slot: `recovery:org/${projectId}/restart/s`,
    orgId: "org",
    projectId,
    serviceId: "s",
    name: "app",
    action: "restart" as const,
  };
}

const old = restartRequest("old");
const newer = restartRequest("new");
const refused = (requestId: string) =>
  readRecoveryOutcome(requestId, "restart", { stage: "refused", reason: "refused" });
const pending = (requestId: string) =>
  readRecoveryOutcome(requestId, "restart", { stage: "uncertain", next: "ask-owner-again" });

// witness: packages/client-runtime/src/data/notices/outcomes.ts | !== invocation.requestId || dismissed.has(invocation.requestId) → !== invocation.requestId && dismissed.has(invocation.requestId)
it("ST47: Newer recovery feedback supersedes older results in submission order", () => {
  const completed = readRecoveryOutcome("old", "restart", {
    stage: "done",
    operationId: "op",
    outcome: "succeeded",
  });
  const items = presentOutcomes(
    [old, newer],
    ({ requestId }) => (requestId === "old" ? completed : refused(requestId)),
    new Map(),
    new Set(),
  );
  expect(items.map(({ invocation }) => invocation.requestId)).toEqual(["new"]);
});

// witness: packages/client-runtime/src/data/notices/outcomes.ts | outcome.terminal && → (outcome.terminal || dismissed.has(invocation.requestId)) &&
it("ST48: An older unresolved recovery request stays reachable beside newer feedback", () => {
  const items = presentOutcomes(
    [old, newer],
    ({ requestId }) => (requestId === "new" ? refused(requestId) : pending(requestId)),
    new Map(),
    new Set(["old"]),
  );
  expect(items.map(({ invocation }) => invocation.requestId)).toEqual(["old", "new"]);
});

// witness: packages/client-runtime/src/data/notices/outcomes.ts | .slice(-16) → .slice(0, 16)
it("ST49: Finished recovery feedback keeps sixteen slots without evicting an unresolved request", () => {
  const finished = Array.from({ length: 18 }, (_, i) => restartRequest(`r${i}`, `p${i}`));
  const items = presentOutcomes(
    [old, ...finished],
    ({ requestId }) => (requestId === "old" ? pending(requestId) : refused(requestId)),
    new Map(),
    new Set(),
  );
  expect(items.map(({ invocation }) => invocation.requestId)).toEqual([
    "old",
    ...Array.from({ length: 16 }, (_, i) => `r${i + 2}`),
  ]);
});

// witness: packages/client-runtime/src/data/notices/outcomes.ts | (origins.get(invocation.origin) ?? 0) > 0 → (origins.get(invocation.origin) ?? 1) > 0
it("ST50: Closing the place a recovery was asked from hands its unresolved request to the shell without changing its outcome", () => {
  const outcome = pending("old");
  const shown = presentOutcomes([old], () => outcome, new Map([[old.origin, 1]]), new Set());
  const closed = presentOutcomes([old], () => outcome, new Map(), new Set());
  expect(shown[0]?.primary).toBe(old.origin);
  expect(closed[0]?.primary).toBe("shell");
  expect(closed[0]?.outcome).toBe(outcome);
});
