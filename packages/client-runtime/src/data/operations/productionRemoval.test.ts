import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { CanonicalHqNavigationEnvironment } from "@t3tools/shared/hqStream";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { lifecycleReceipt } from "../families/hqLifecycle.ts";
import { operationResult } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { HqError } from "../../zerops/hq/client.ts";
import { canonicalEnvironmentsOf } from "../../zerops/hq/environments.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

const decodeEnvironment = Schema.decodeUnknownSync(CanonicalHqNavigationEnvironment);

const REMOVE = {
  kind: "remove-production",
  orgId: ORG,
  hqProjectId: "hq",
  projectId: "p1",
  appId: "app",
  deleteProject: false,
} as const;

function account() {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {});
  return store;
}

const progress = (store: ReturnType<typeof account>) =>
  operationProgress.derive(readsOfState(store.state()), "remove");

function operationsOf(store: ReturnType<typeof account>, api: Partial<HqWrites>) {
  return makeOperations({
    store,
    makeId: () => "remove",
    executors: {
      hq: makeHqExecutor({
        apiOf: () => api as HqWrites,
        active: () => true,
        hqProjectIdOf: () => "hq",
        zerops: {
          mintIntegrationToken: () => Promise.reject(new Error("no mint")),
          deleteIntegrationToken: () => Promise.reject(new Error("no key retirement")),
        },
      }),
    },
  });
}

describe("production removal receipts", () => {
  it.each([false, true])(
    "The original HQ receipt determines whether removal deletes its project: %s",
    (deleteProject) => {
      const record = {
        requestId: "remove",
        intent: { ...REMOVE, deleteProject },
        productionRemoval: { deleteProject },
      };
      expect(lifecycleReceipt(record).acceptance).toEqual({
        kind: "accepted",
        result: { deleteProject },
      });
    },
  );

  it.effect.each([false, true])(
    "Removing production follows its retained fate without replaying a lost answer: %s",
    (deleteProject) =>
      Effect.gen(function* () {
        const store = account();
        const intent = { ...REMOVE, deleteProject };
        let sent = 0;
        let retained = false;
        const operations = operationsOf(store, {
          lifecycleWrite: async () => {
            sent++;
            throw new HqError({ kind: "uncertain", code: "network", message: "Answer lost." });
          },
          lifecycleReceipt: async () => {
            if (retained)
              return { requestId: "remove", intent, productionRemoval: { deleteProject } };
            throw new HqError({
              kind: "unavailable",
              code: "network",
              message: "HQ cannot read its receipt yet.",
            });
          },
        });
        yield* operations.submit(intent, "remove");
        expect(progress(store).stage).toBe("uncertain");
        retained = true;
        yield* operations.retry("remove");
        expect(progress(store).stage).toBe("done");
        expect(
          operationResult(store.state().operations.get("remove"), "remove-production"),
        ).toEqual({ deleteProject });
        expect(sent).toBe(1);
      }),
  );

  it.effect.each(["app", "project", "fate"] as const)(
    "A retained removal for another $0 cannot authorize deleting production",
    (mismatch) =>
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
            productionRemoval: { deleteProject: mismatch === "fate" },
          }),
        });
        yield* operations.resume("remove", REMOVE, [], []);
        expect(progress(store).stage).not.toBe("done");
        expect(
          operationResult(store.state().operations.get("remove"), "remove-production"),
        ).toBeUndefined();
      }),
  );

  it("Production removal preserves HQ's project fate through the environment reader", () => {
    const source = {
      projectId: "p1",
      tier: "production",
      name: "Production",
      sources: ["release"],
      order: 1,
      keyHeld: true,
      keyInvalid: false,
      jobs: [],
      can: {},
      release: null,
      birth: null,
      deleteProjectOnRemoval: true,
    };
    const navigation = decodeEnvironment(source);
    expect(canonicalEnvironmentsOf([navigation])?.[0]?.deleteProjectOnRemoval).toBe(true);
    expect(
      canonicalEnvironmentsOf([{ ...source, deleteProjectOnRemoval: false }])?.[0]
        ?.deleteProjectOnRemoval,
    ).toBe(false);
    const { deleteProjectOnRemoval: _fate, ...older } = source;
    expect(canonicalEnvironmentsOf([older])?.[0]?.deleteProjectOnRemoval).toBeUndefined();
  });
});
