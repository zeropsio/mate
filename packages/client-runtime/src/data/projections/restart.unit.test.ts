import { expect, it } from "vite-plus/test";

import type { ProcessValue } from "../families/process.ts";
import { lostAnswerEffect } from "./lostAnswer.ts";
import { restartEffects } from "./restart.ts";

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

// witness: packages/client-runtime/src/data/projections/restart.ts | if (created < since - PRESS_CLOCK_ALLOWANCE_MS) return false; → if (created < 0) return false;
it("PJ14: A restart is answered only by its own service's restart that still runs or was created at or after its press, never by an earlier one or another service's; it is said not sent only on the person's ask, and never while an unseen restart ended within the clocks' allowance before the press or the history read does not reach back that far", () => {
  const history = [
    process("earlier", "stack.restart", "s", "FINISHED", "2026-11-18T09:50:00.000Z"),
    process("after", "stack.restart", "s", "FINISHED", "2026-11-18T10:00:02.000Z"),
    process("running", "stack.restart", "s", "RUNNING", "2026-11-18T09:59:00.000Z"),
    process("other-service", "stack.restart", "other", "FINISHED", "2026-11-18T10:00:02.000Z"),
    process("stop", "stack.stop", "s", "FINISHED", "2026-11-18T10:00:02.000Z"),
  ];
  const ask = { serviceId: "s", action: "stack.restart", since: pressed };
  expect(restartEffects(history, { ...ask, seen: [] }, history)).toEqual(["after", "running"]);
  // Ended 30 s before the press by Zerops' clock: this press's across a skewed clock, or earlier.
  const skewed = [
    ...history,
    process("just-before", "stack.restart", "s", "FINISHED", "2026-11-18T09:59:30.000Z"),
  ];
  expect(restartEffects(skewed, { ...ask, seen: undefined }, skewed)).toEqual([
    "after",
    "running",
    "just-before",
  ]);
  expect(restartEffects(skewed, { ...ask, seen: [] }, skewed)).toBe(null);
  expect(restartEffects(skewed, { ...ask, seen: ["just-before"] }, skewed)).toEqual([
    "after",
    "running",
  ]);
  // Resumed without a press time: only a running restart answers; an ended one cannot tell.
  const resumed = { ...ask, since: undefined, seen: [] };
  expect(restartEffects(history, resumed, history)).toEqual(["running"]);
  expect(restartEffects(history.slice(0, 2), resumed, history.slice(0, 2))).toBe(null);
  // A full page whose oldest is newer than the press less the allowance may have cut its restart off.
  const busy = Array.from({ length: 100 }, (_, n) =>
    process(`deploy-${n}`, "stack.deploy", "s", "FINISHED", "2026-11-18T10:00:05.000Z"),
  );
  expect(restartEffects(busy, { ...ask, seen: [] }, busy)).toBe(null);
  const reaching = [
    ...busy.slice(1),
    process("old", "stack.deploy", "s", "FINISHED", "2026-11-18T09:57:00.000Z"),
  ];
  expect(restartEffects(reaching, { ...ask, seen: [] }, reaching)).toEqual([]);
  // A lost answer may still be taken by Zerops: its own reconcile adopts, never says not sent.
  const unseen = { before: [], claimed: new Set<string>() };
  expect(lostAnswerEffect({ ...unseen, shown: ["after"], proving: false })).toBe("after");
  expect(lostAnswerEffect({ ...unseen, shown: [], proving: false })).toBe(null);
  expect(lostAnswerEffect({ ...unseen, shown: [], proving: true })).toBe("none");
});
