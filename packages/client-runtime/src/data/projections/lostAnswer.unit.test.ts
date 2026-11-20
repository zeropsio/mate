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

// witness: packages/client-runtime/src/data/projections/lostAnswer.ts | action: "stack.start", → action: "stack.restart",
it("PJ16: A start is answered only by a start of its own service, a stop by a stop and a service's restart by a restart, never by another action on that service; a write that names no such process is never said not sent", () => {
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
  expect(answered({ kind: "start-service", ...service })).toEqual(["start"]);
  expect(answered({ kind: "stop-service", ...service })).toEqual(["stop"]);
  expect(answered({ kind: "service-restart", ...service })).toEqual(["restart"]);
  expect(effectProcessOf({ kind: "start-project", orgId: "o", projectId: "p1" })).toBe(null);
});
