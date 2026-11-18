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

// witness: packages/client-runtime/src/data/projections/restart.ts | (ask.since !== undefined && Date.parse(process.created) >= ask.since)), → (ask.since !== undefined && true)),
it("PJ14: A restart is answered only by its own service's restart that still runs or was created at or after its press, never by an earlier one or another service's, and is said not sent only on the person's ask", () => {
  const history = [
    process("earlier", "stack.restart", "s", "FINISHED", "2026-11-18T09:50:00.000Z"),
    process("after", "stack.restart", "s", "FINISHED", "2026-11-18T10:00:02.000Z"),
    process("running", "stack.restart", "s", "RUNNING", "2026-11-18T09:59:00.000Z"),
    process("other-service", "stack.restart", "other", "FINISHED", "2026-11-18T10:00:02.000Z"),
    process("stop", "stack.stop", "s", "FINISHED", "2026-11-18T10:00:02.000Z"),
  ];
  expect(
    restartEffects(history, { serviceId: "s", action: "stack.restart", since: pressed }),
  ).toEqual(["after", "running"]);
  // A lost answer may still be taken by Zerops: its own reconcile adopts, never says not sent.
  const unseen = { before: [], claimed: new Set<string>() };
  expect(lostAnswerEffect({ ...unseen, shown: ["after"], proving: false })).toBe("after");
  expect(lostAnswerEffect({ ...unseen, shown: [], proving: false })).toBe(null);
  expect(lostAnswerEffect({ ...unseen, shown: [], proving: true })).toBe("none");
});
