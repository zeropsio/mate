/**
 * A person's stop of an automated Mate's task, as the account's operations send it to HQ: done once
 * HQ answers, done too where HQ holds the task as ended, and refused in HQ's words otherwise.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { readsOfState, makeAccountStore, type AccountStore } from "../store.ts";
import { operationProgress } from "../projections/operation.ts";
import { HqError } from "../../zerops/hq/client.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

function account(api: Partial<HqWrites>) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  const executor = makeHqExecutor({
    apiOf: () => api as HqWrites,
    zerops: {
      mintIntegrationToken: () => Promise.reject(new Error("not expected")),
      deleteIntegrationToken: () => Promise.reject(new Error("not expected")),
    },
  });
  const operations = makeOperations({ store, executors: { hq: executor }, makeId: () => "r1" });
  return { store, operations };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

const STOP = { kind: "stop-task", orgId: ORG, appId: "app-1", taskId: "task-1" } as const;

const refusal = (code: string, message: string) => new HqError({ kind: "refused", code, message });

describe("a person stops a task from Mate", () => {
  it.effect.each([
    {
      title: "a stop HQ takes is done",
      answer: () => Promise.resolve(),
      ends: { stage: "done", outcome: "succeeded" },
    },
    {
      title: "a stop of a task HQ holds as ended is done: nothing is left to stop",
      answer: () => Promise.reject(refusal("conflict", "task_ended")),
      ends: { stage: "done", outcome: "succeeded" },
    },
    {
      title: "a stop HQ refuses says HQ's words",
      answer: () =>
        Promise.reject(refusal("forbidden", "Only an Owner or Admin can stop this task.")),
      ends: { stage: "refused", reason: "Only an Owner or Admin can stop this task." },
    },
    {
      title: "an HQ that predates a person's stop is asked to update, and nothing is sent",
      answer: undefined,
      ends: { stage: "refused", reason: "Update HQ to stop a task from Mate." },
    },
  ])("$title", ({ answer, ends }) =>
    Effect.gen(function* () {
      const asked: Array<[string, string]> = [];
      const { store, operations } = account(
        answer === undefined
          ? {}
          : {
              stopTask: (appId, taskId) => {
                asked.push([appId, taskId]);
                return answer();
              },
            },
      );
      yield* operations.submit(STOP);
      expect(asked).toEqual(answer === undefined ? [] : [["app-1", "task-1"]]);
      expect(progress(store)).toMatchObject(ends);
    }),
  );
});
