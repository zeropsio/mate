import { expect, it } from "vite-plus/test";

import type { ProcessValue } from "../../zerops/projectProcesses.ts";
import type { OperationIntent } from "../model.ts";
import { effectProcessOf, processEffects } from "./lostAnswer.ts";

const pressed = Date.parse("2026-11-18T10:00:00.000Z");
const process = (id: string, actionName: string): ProcessValue => ({
  id,
  projectId: "p1",
  serviceStackIds: ["s"],
  status: "FINISHED",
  actionName,
  created: "2026-11-18T10:00:02.000Z",
});
const service = { orgId: "o", projectId: "p1", serviceId: "s" };

// witness: packages/client-runtime/src/data/projections/lostAnswer.ts | process.actionName !== ask.action || !process.serviceStackIds.includes(ask.serviceId) → !process.serviceStackIds.includes(ask.serviceId)
it("PJ16: A service's restart is answered only by a restart of that service; a write that names no such process is never said not sent", () => {
  const history = [
    process("start", "stack.start"),
    process("stop", "stack.stop"),
    process("restart", "stack.restart"),
  ];
  const answered = (intent: OperationIntent) => {
    const effect = effectProcessOf(intent);
    if (effect === null) return null;
    const ask = { serviceId: effect.serviceId, action: effect.action, since: pressed, seen: [] };
    return processEffects(history, ask, history);
  };
  expect(answered({ kind: "service-restart", ...service })).toEqual(["restart"]);
  expect(effectProcessOf({ kind: "start-project", orgId: "o", projectId: "p1" })).toBe(null);
});
