import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { startServiceExecutor } from "./executors/serviceWrites.ts";

const START = { kind: "start-service", orgId: ORG, projectId: "p1", serviceId: "s1" } as const;

const account = () =>
  accountOf(liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }));

const processRow = (
  store: AccountStore,
  id: string,
  status: string,
  version: number,
  serviceId = "s1",
) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id,
        value: processValue({
          id,
          projectId: "p1",
          status,
          actionName: "stack.start",
          serviceStackIds: [serviceId],
        }),
        revision: zeropsVersion(version),
      },
    ],
  });

// witness: packages/client-runtime/src/data/operations/executors/serviceWrites.ts | verb(() => platform.startService(intent.serviceId)) → verb(() => platform.startService(intent.serviceId).catch(() => platform.startService(intent.serviceId)))
it.effect(
  "OP7: After a lost answer a service start adopts only a start running for its own service and is never sent again",
  () =>
    Effect.gen(function* () {
      const store = account();
      const calls: string[] = [];
      const operations = zeropsOperations(
        store,
        startServiceExecutor({
          startService: async (id) => {
            calls.push(id);
            throw new ZeropsApiError("No answer.", "network");
          },
        }),
      );
      yield* operations.submit(START);
      processRow(store, "proc-other", "RUNNING", 1, "s2");
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      processRow(store, "proc-start", "RUNNING", 1);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-start" });
      expect(calls).toEqual(["s1"]);
    }),
);
