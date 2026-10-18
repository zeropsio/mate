import { assert, describe, it } from "@effect/vitest";
import type { MateTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { automatedPool } from "../test/harness/automated.ts";
import { sessionFor, type SocketMessage } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { STOPPED_IN_MATE } from "./taskStops.ts";

describe("a person stops a task from Mate", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a person who keeps the application's intake stops its task at work: its Mate is told to stop, and a task that ended is not stopped again",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          yield* core.issue(1);
          const told = yield* core.robot.link.takeWhere(
            "the task of issue 1",
            (frame: SocketMessage) => frame.type === "task",
          );
          const task = told["task"] as MateTask;
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "working", conversationId: "conversation-1" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "working");
          const path = `/api/apps/${core.appId}/tasks/${task.id}/stop`;
          const developer = yield* sessionFor(core.call, "door-dev");
          assert.strictEqual((yield* core.call("POST", path, { session: developer })).status, 403);
          const unknown = `/api/apps/${core.appId}/tasks/00000000-0000-4000-8000-000000000000/stop`;
          assert.strictEqual(
            (yield* core.call("POST", unknown, { session: core.owner })).status,
            404,
          );
          assert.strictEqual((yield* core.call("POST", path, { session: core.owner })).status, 204);
          assert.deepStrictEqual(yield* core.robot.link.take("task-stop"), {
            taskId: task.id,
            reason: STOPPED_IN_MATE,
          });
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "stopped" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "stopped");
          assert.strictEqual((yield* core.call("POST", path, { session: core.owner })).status, 409);
        }),
    );
  });
});
