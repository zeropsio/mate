import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { operationProgress } from "../projections/operation.ts";
import type { OperationReceipt } from "../model.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import type { HqStructure } from "../../zerops/hq/client.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import type { MoveProjectIntent } from "./moveProject.ts";

const MOVE: MoveProjectIntent = {
  kind: "move-project",
  orgId: ORG,
  hqProjectId: "hq-1",
  projectId: "p1",
  from: { appId: "source", kind: "mate" },
  to: { appId: "target", kind: "mate" },
  rename: { from: "Source · Ada", name: "Target · Ada" },
};

function placement(store: AccountStore, appId: string, kind = "mate") {
  const project = { projectId: "p1", name: "Ada", kind, mate: { face: "" } };
  const structure = {
    apps: [{ id: appId, name: appId, projects: [project] }],
    ungrouped: [],
  } as HqStructure;
  seedHqNavigation(store, ORG, { structure });
}

function account() {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [], projects: [{ id: "p1", name: MOVE.rename.from }] }).forEach(
    store.dispatch,
  );
  placement(store, "source");
  return store;
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "original");

// witness: packages/client-runtime/src/data/operations/moveProject.ts | !changesMateClass(intent) && moveShown(read, intent) → moveShown(read, intent)
it.effect(
  "OP45: A class-changing Move is done only on its owner's credential and job completion receipt",
  () =>
    Effect.gen(function* () {
      const store = account();
      const intent: MoveProjectIntent = { ...MOVE, to: { appId: "target", kind: "production" } };
      const accepted: OperationReceipt = {
        requestId: "original",
        operationId: "move-1",
        executor: "hq",
        affected: [{ family: "placement", id: "p1" }],
        handles: ["move-1"],
        acceptance: { kind: "accepted" },
        outcome: { kind: "pending" },
      };
      const operations = makeOperations({
        store,
        makeId: () => "original",
        executors: {
          hq: {
            submit: (requestId, sent) =>
              Effect.sync(() => {
                expect(requestId).toBe("original");
                expect(sent).toEqual(intent);
                return accepted;
              }),
          },
        },
      });
      yield* operations.submit(intent);
      placement(store, "target", "production");
      expect(progress(store).stage).toBe("reflected");
      store.dispatch({
        kind: "operation-receipt",
        receipt: {
          ...accepted,
          outcome: {
            kind: "succeeded",
            evidence: "HQ retained Mate history and replaced project-bound credentials and jobs",
          },
        },
      });
      expect(progress(store).stage).toBe("done");
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | ports.active === undefined || → ports.active === undefined &&
it.effect(
  "OP46: An authority that ended or was replaced cannot receive a Move, and nothing is sent",
  () =>
    Effect.gen(function* () {
      for (const authority of ["ended", "replaced"] as const) {
        const store = account();
        const writes: string[] = [];
        const api: Pick<HqWrites, "lifecycleWrite"> = {
          lifecycleWrite: async (_requestId, intent) => {
            writes.push(intent.projectId);
            throw new Error("must not send");
          },
        };
        const operations = makeOperations({
          store,
          makeId: () => "original",
          executors: {
            hq: makeHqExecutor({
              apiOf: () => api as HqWrites,
              active: () => authority !== "ended",
              hqProjectIdOf: () => (authority === "replaced" ? "hq-2" : "hq-1"),
              zerops: {
                mintIntegrationToken: async () => {
                  throw new Error("no key mint on placement move");
                },
                deleteIntegrationToken: async () => {
                  throw new Error("no key retirement on placement move");
                },
              },
            }),
          },
        });
        yield* operations.submit(MOVE);
        expect(writes).toEqual([]);
        expect(progress(store).stage).toBe("refused");
      }
    }),
);
