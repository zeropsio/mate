import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation, type SeededHq } from "../__fixtures__/hqNavigation.ts";
import { operationResult } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

function account(navigation: SeededHq = {}) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, navigation);
  return store;
}

function operationsOf(
  store: AccountStore,
  api: Partial<HqWrites>,
  zerops: Parameters<typeof makeHqExecutor>[0]["zerops"] = {
    mintIntegrationToken: () => Promise.reject(new Error("Unexpected mint.")),
    deleteIntegrationToken: () => Promise.reject(new Error("Unexpected token retirement.")),
  },
) {
  return makeOperations({
    store,
    makeId: () => "r1",
    executors: {
      hq: makeHqExecutor({
        store,
        apiOf: () => api as HqWrites,
        active: () => true,
        hqProjectIdOf: () => "hq",
        zerops,
      }),
    },
  });
}

const progress = (store: AccountStore, id: string) =>
  operationProgress.derive(readsOfState(store.state()), id);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | yield* retireToken(intent.orgId, previous); → yield* retireToken(intent.orgId, minted);
it.effect(
  "OP25: A re-mint deletes on Zerops exactly the old deploy token, and only once HQ kept the new one",
  () =>
    Effect.gen(function* () {
      const store = account({
        structure: {
          apps: [
            {
              id: "app-1",
              name: "Shop",
              projects: [],
              births: [],
              environments: [
                {
                  id: HqEnvironmentId.make("p-stage"),
                  target: { kind: "zerops", projectId: ProjectId.make("p-stage") },
                  tier: "stage",
                  name: "stage",
                  sources: [],
                  order: 1,
                  keyHeld: true,
                  keyInvalid: true,
                  keyId: "tok-old",
                  jobs: [],
                  release: null,
                  birth: null,
                },
              ],
            },
          ],
          ungrouped: [],
        },
      });
      const log: string[] = [];
      const operations = operationsOf(
        store,
        {
          keepDeployToken: async (_app, _name, token) => {
            log.push(`keep ${token}`);
          },
        },
        {
          mintIntegrationToken: async () => {
            log.push("mint");
            return { id: "tok-new", token: "secret" };
          },
          deleteIntegrationToken: async ({ tokenId }) => {
            log.push(`delete ${tokenId}`);
          },
        },
      );
      yield* operations.submit({
        kind: "keep-deploy-key",
        orgId: ORG,
        appId: "app-1",
        projectId: "p-stage",
        environmentName: "stage",
      });
      expect(log).toEqual(["mint", "keep secret", "delete tok-old"]);
      expect(progress(store, "r1")).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | record.intent.appId === intent.appId && →
it.effect(
  "OP28: A retained removal for another app, project or fate cannot authorize deleting production",
  () =>
    Effect.gen(function* () {
      const REMOVE = {
        kind: "remove-production",
        orgId: ORG,
        hqProjectId: "hq",
        projectId: "p1",
        appId: "app",
        deleteProject: false,
      } as const;
      const recover = (mismatch: "app" | "project" | "fate") =>
        Effect.gen(function* () {
          const store = account();
          const operations = operationsOf(store, {
            lifecycleReceipt: async () => ({
              requestId: "remove",
              intent: {
                ...REMOVE,
                ...(mismatch === "app"
                  ? { appId: "other" }
                  : mismatch === "project"
                    ? { projectId: "other" }
                    : { deleteProject: true }),
              },
              at: "2026-11-05T14:02:00.000Z",
              productionRemoval: { deleteProject: mismatch === "fate" },
            }),
          });
          yield* operations.resume("remove", REMOVE, [], []);
          expect(progress(store, "remove").stage).not.toBe("done");
          expect(
            operationResult(store.state().operations.get("remove"), "remove-production"),
          ).toBeUndefined();
        });
      yield* recover("app");
      yield* recover("project");
      yield* recover("fate");
    }),
);
