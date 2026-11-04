/**
 * An environment's deploy token HQ no longer keeps is deleted on Zerops by the person's client:
 * after HQ kept its replacement, or after HQ confirmed the environment's removal. HQ names the
 * token's id in its environment record, never its value; a delete that fails is said once and
 * never undoes what HQ did.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { HqError, type HqStructure } from "../../zerops/hq/client.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import type { MoveProjectIntent } from "./moveProject.ts";

const environment = (
  projectId: string,
  tier: "stage" | "production",
  keyId: string,
  keyInvalid = false,
) => ({
  projectId,
  tier,
  name: tier,
  sources: [],
  order: 1,
  keyHeld: true,
  keyInvalid,
  keyId,
  can: {},
  jobs: [],
  release: null,
  birth: null,
});

function account(environments: ReadonlyArray<ReturnType<typeof environment>>) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  const apps = [
    { id: "app-1", name: "Shop", projects: [], births: [], environments },
  ] as unknown as HqStructure["apps"];
  seedHqNavigation(store, ORG, { structure: { apps: [...apps], ungrouped: [] } });
  return store;
}

function operationsOf(
  store: AccountStore,
  api: Partial<HqWrites>,
  log: string[],
  deleted: (tokenId: string) => Promise<void> = async () => undefined,
) {
  const left: string[] = [];
  const operations = makeOperations({
    store,
    makeId: () => "r1",
    executors: {
      hq: makeHqExecutor({
        apiOf: () => api as HqWrites,
        active: () => true,
        hqProjectIdOf: () => "hq",
        store,
        tokenLeft: (message) => left.push(message),
        zerops: {
          mintIntegrationToken: async () => {
            log.push("mint");
            return { id: "tok-new", token: "secret" };
          },
          deleteIntegrationToken: async ({ tokenId }) => {
            log.push(`delete ${tokenId}`);
            await deleted(tokenId);
          },
        },
      }),
    },
  });
  return { operations, left };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

describe("an environment's replaced deploy token", () => {
  const KEEP = {
    kind: "keep-deploy-key",
    orgId: ORG,
    appId: "app-1",
    projectId: "p-stage",
    environmentName: "stage",
  } as const;

  it.effect("A re-mint deletes on Zerops exactly the old token, once HQ kept the new one", () =>
    Effect.gen(function* () {
      const store = account([environment("p-stage", "stage", "tok-old", true)]);
      const log: string[] = [];
      const { operations } = operationsOf(
        store,
        { keepDeployToken: async (_app, _name, token) => void log.push(`keep ${token}`) },
        log,
      );
      yield* operations.submit(KEEP);
      expect(log).toEqual(["mint", "keep secret", "delete tok-old"]);
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
  );

  it.effect("A re-mint's keep succeeds when the old token's delete fails, said once", () =>
    Effect.gen(function* () {
      const store = account([environment("p-stage", "stage", "tok-old", true)]);
      const log: string[] = [];
      const { operations, left } = operationsOf(
        store,
        { keepDeployToken: async () => void log.push("keep") },
        log,
        () => Promise.reject(new Error("Zerops is down.")),
      );
      yield* operations.submit(KEEP);
      expect(log).toEqual(["mint", "keep", "delete tok-old"]);
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
      expect(left).toHaveLength(1);
      expect(left[0]).toContain("Zerops is down.");
    }),
  );

  it.effect("A keep HQ refused deletes no token HQ still keeps", () =>
    Effect.gen(function* () {
      const store = account([environment("p-stage", "stage", "tok-old", true)]);
      const log: string[] = [];
      const { operations } = operationsOf(
        store,
        {
          keepDeployToken: () =>
            Promise.reject(
              new HqError({ kind: "refused", code: "forbidden", message: "Not yours to keep." }),
            ),
        },
        log,
      );
      yield* operations.submit(KEEP);
      expect(log).toEqual(["mint", "delete tok-new"]);
    }),
  );
});

describe("a removed environment's deploy token", () => {
  const REMOVE = {
    kind: "remove-production",
    orgId: ORG,
    hqProjectId: "hq",
    appId: "app-1",
    projectId: "p-prod",
    deleteProject: false,
  } as const;

  it.effect("Removing production deletes its deploy token once HQ confirmed the removal", () =>
    Effect.gen(function* () {
      const store = account([environment("p-prod", "production", "tok-prod")]);
      const log: string[] = [];
      const { operations } = operationsOf(
        store,
        {
          lifecycleWrite: async (requestId) => {
            log.push("remove");
            return { requestId, intent: REMOVE, productionRemoval: { deleteProject: false } };
          },
        },
        log,
      );
      yield* operations.submit(REMOVE);
      expect(log).toEqual(["remove", "delete tok-prod"]);
      expect(progress(store)).toMatchObject({ stage: "done" });
    }),
  );

  it.effect("A removal whose answer HQ lost deletes no token", () =>
    Effect.gen(function* () {
      const store = account([environment("p-prod", "production", "tok-prod")]);
      const log: string[] = [];
      const { operations } = operationsOf(
        store,
        {
          lifecycleWrite: async () => {
            log.push("remove");
            throw new HqError({ kind: "uncertain", code: "network", message: "Answer lost." });
          },
        },
        log,
      );
      yield* operations.submit(REMOVE);
      expect(log).toEqual(["remove"]);
    }),
  );

  it.effect.each([
    { to: { appId: null, kind: "mate" }, deletes: ["delete tok-stage"] },
    { to: { appId: "app-2", kind: "stage" }, deletes: [] },
  ] as const)(
    "A stage moved out of the environments loses its deploy token; one still an environment keeps it: $to.kind",
    ({ to, deletes }) =>
      Effect.gen(function* () {
        const store = account([environment("p-stage", "stage", "tok-stage")]);
        const move: MoveProjectIntent = {
          kind: "move-project",
          orgId: ORG,
          hqProjectId: "hq",
          projectId: "p-stage",
          from: { appId: "app-1", kind: "stage" },
          to,
          rename: { from: "Shop stage", name: "Shop stage" },
        };
        const log: string[] = [];
        const { operations } = operationsOf(
          store,
          {
            lifecycleWrite: async (requestId) => {
              log.push("move");
              return { requestId, intent: move };
            },
          },
          log,
        );
        yield* operations.submit(move);
        expect(log).toEqual(["move", ...deletes]);
      }),
  );
});
