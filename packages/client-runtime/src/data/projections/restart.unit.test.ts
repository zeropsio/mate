import { expect, it } from "vite-plus/test";

import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { projectRestarts } from "./restartEvidence.ts";
import { readRestart } from "../../zerops/restart.ts";
import type { ProcessValue } from "../families/process.ts";
import { lostAnswerEffect, processEffects } from "./lostAnswer.ts";

const pressed = Date.parse("2026-11-18T10:00:00.000Z");
const process = (
  id: string,
  actionName: string,
  serviceId: string,
  status: string,
  created: string,
): ProcessValue => ({
  id,
  projectId: "p1",
  serviceStackIds: [serviceId],
  status,
  actionName,
  created,
});

// witness: packages/client-runtime/src/data/projections/lostAnswer.ts | if (created < since - PRESS_CLOCK_ALLOWANCE_MS) return false; → if (created < 0) return false;
it("PJ14: A restart is answered only by its own service's restart that still runs or was created at or after its press, never by an earlier one or another service's; it is said not sent only on the person's ask, and never while an unseen restart ended within the clocks' allowance before the press or the history read does not reach back that far", () => {
  const history = [
    process("earlier", "stack.restart", "s", "FINISHED", "2026-11-18T09:50:00.000Z"),
    process("after", "stack.restart", "s", "FINISHED", "2026-11-18T10:00:02.000Z"),
    process("running", "stack.restart", "s", "RUNNING", "2026-11-18T09:59:00.000Z"),
    process("other-service", "stack.restart", "other", "FINISHED", "2026-11-18T10:00:02.000Z"),
    process("stop", "stack.stop", "s", "FINISHED", "2026-11-18T10:00:02.000Z"),
  ];
  const ask = { serviceId: "s", action: "stack.restart", since: pressed };
  expect(processEffects(history, { ...ask, seen: [] }, history)).toEqual(["after", "running"]);
  // Ended 30 s before the press by Zerops' clock: this press's across a skewed clock, or earlier.
  const skewed = [
    ...history,
    process("just-before", "stack.restart", "s", "FINISHED", "2026-11-18T09:59:30.000Z"),
  ];
  expect(processEffects(skewed, { ...ask, seen: undefined }, skewed)).toEqual([
    "after",
    "running",
    "just-before",
  ]);
  expect(processEffects(skewed, { ...ask, seen: [] }, skewed)).toBe(null);
  expect(processEffects(skewed, { ...ask, seen: ["just-before"] }, skewed)).toEqual([
    "after",
    "running",
  ]);
  // Resumed without a press time: only a running restart answers; an ended one cannot tell.
  const resumed = { ...ask, since: undefined, seen: [] };
  expect(processEffects(history, resumed, history)).toEqual(["running"]);
  expect(processEffects(history.slice(0, 2), resumed, history.slice(0, 2))).toBe(null);
  // A full page whose oldest is newer than the press less the allowance may have cut its restart off.
  const busy = Array.from({ length: 100 }, (_, n) =>
    process(`deploy-${n}`, "stack.deploy", "s", "FINISHED", "2026-11-18T10:00:05.000Z"),
  );
  expect(processEffects(busy, { ...ask, seen: [] }, busy)).toBe(null);
  const reaching = [
    ...busy.slice(1),
    process("old", "stack.deploy", "s", "FINISHED", "2026-11-18T09:57:00.000Z"),
  ];
  expect(processEffects(reaching, { ...ask, seen: [] }, reaching)).toEqual([]);
  // A lost answer may still be taken by Zerops: its own reconcile adopts, never says not sent.
  const unseen = { before: [], claimed: new Set<string>() };
  expect(lostAnswerEffect({ ...unseen, shown: ["after"], proving: false })).toBe("after");
  expect(lostAnswerEffect({ ...unseen, shown: [], proving: false })).toBe(null);
  expect(lostAnswerEffect({ ...unseen, shown: [], proving: true })).toBe("none");
});

const key = { orgId: ORG, projectId: "p" };
const source = {
  id: "original",
  actionName: "stack.restart",
  status: "RUNNING",
  created: "2026-10-08T10:00:00Z",
  projectId: "p",
  serviceStackIds: ["s"],
};
const intent = {
  kind: "mate-restart",
  ...key,
  serviceId: "s",
  way: "restart",
  sourceProcessId: source.id,
} as const;
const setup = () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [source] }).forEach(store.dispatch);
  const read = () => readRestart(projectRestarts.derive(readsOfState(store.state()), key), source);
  return { store, registry, read };
};
// witness: packages/client-runtime/src/zerops/restart.ts | attempt?.processId ?? sourceProcessId → sourceProcessId
it("PJ62: An accepted retry whose process is missing keeps its own identity and never falls back to the original failed process", () => {
  const { store, read } = setup();
  store.dispatch({ kind: "operation-recorded", requestId: "retry", intent });
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId: "retry",
      operationId: "retry",
      executor: "zerops",
      affected: [],
      handles: ["new-process"],
      acceptance: { kind: "accepted" },
      outcome: { kind: "pending" },
    },
  });
  expect(read()).toMatchObject({
    requestId: "retry",
    phase: "uncertain",
    process: { id: "new-process" },
    progress: { stage: "accepted" },
  });
});
