import { expect, it } from "vite-plus/test";
import { presentOutcomes } from "./outcomes.ts";

const old = { requestId: "old", origin: "recovery:p", slot: "recovery:p/restart" };
const newer = { ...old, requestId: "new" };

it("newer recovery feedback supersedes older results in submission order", () => {
  const items = presentOutcomes(
    [old, newer],
    ({ requestId }) => ({
      terminal: true,
      text: requestId === "old" ? "late old success" : "new refusal",
    }),
    new Map(),
    new Set(),
  );
  expect(items.map(({ outcome }) => outcome.text)).toEqual(["new refusal"]);
});

it("an older unresolved request remains reachable beside the newer feedback", () => {
  const items = presentOutcomes(
    [old, newer],
    ({ requestId }) => ({ terminal: requestId === "new" }),
    new Map(),
    new Set(["old"]),
  );
  expect(items.map(({ invocation }) => invocation.requestId)).toEqual(["old", "new"]);
});

it("terminal feedback retains sixteen slots without evicting an unresolved request", () => {
  const invocations = [
    old,
    ...Array.from({ length: 18 }, (_, i) => ({
      requestId: `r${i}`,
      origin: `p${i}`,
      slot: `p${i}/start`,
    })),
  ];
  const items = presentOutcomes(
    invocations,
    ({ requestId }) => ({ terminal: requestId !== "old" }),
    new Map(),
    new Set(),
  );
  expect(items.map(({ invocation }) => invocation.requestId)).toEqual([
    "old",
    ...Array.from({ length: 16 }, (_, i) => `r${i + 2}`),
  ]);
});

it("closing an origin transfers its unresolved reference to the shell without changing the outcome", () => {
  const outcome = { terminal: false, text: "unconfirmed" };
  const shown = presentOutcomes([old], () => outcome, new Map([[old.origin, 1]]), new Set());
  const closed = presentOutcomes([old], () => outcome, new Map(), new Set());
  expect(shown[0]?.primary).toBe(old.origin);
  expect(closed[0]?.primary).toBe("shell");
  expect(closed[0]?.outcome).toBe(outcome);
});
