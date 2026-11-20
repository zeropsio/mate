import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | api.recordReveal(intent.reveal) → api.recordReveal({ projectId: intent.reveal.projectId, key: intent.reveal.key })
it.effect("OP27: Recording where a secret lives sends HQ its place and name, never its value", () =>
  Effect.gen(function* () {
    const sent: unknown[] = [];
    const store = makeAccountStore(AtomRegistry.make());
    liveZerops({ running: [] }).forEach(store.dispatch);
    const api: Partial<HqWrites> = {
      recordReveal: async (reveal) => {
        sent.push(reveal);
      },
    };
    const hq = makeHqExecutor({
      apiOf: () => api as HqWrites,
      zerops: {
        mintIntegrationToken: () => Promise.reject(new Error("Unexpected mint.")),
        deleteIntegrationToken: () => Promise.reject(new Error("Unexpected token retirement.")),
      },
    });
    const operations = makeOperations({ store, executors: { hq }, makeId: () => "r1" });
    yield* operations.submit({
      kind: "record-reveal",
      orgId: ORG,
      reveal: { projectId: "p-prod", service: "db", key: "DATABASE_PASSWORD" },
    });
    expect(sent).toEqual([{ projectId: "p-prod", service: "db", key: "DATABASE_PASSWORD" }]);
    expect(operationProgress.derive(readsOfState(store.state()), "r1")).toMatchObject({
      stage: "done",
      outcome: "succeeded",
    });
  }),
);
