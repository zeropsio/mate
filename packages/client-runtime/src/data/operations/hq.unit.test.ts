import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { HqError } from "../../zerops/hq/client.ts";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation, type SeededHq } from "../__fixtures__/hqNavigation.ts";
import { operationResult } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { personaTemplatesScope } from "../families/hqPersonaTemplates.ts";
import { personaTemplateWrite } from "../projections/hqPersonaTemplates.ts";

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

type App = NonNullable<SeededHq["structure"]>["apps"][number];
const shop: App = { id: "app-1", name: "Shop", projects: [], births: [], environments: [] };
const lost = new HqError({ kind: "uncertain", code: "network", message: "HQ's answer was lost." });

function hqSays(store: AccountStore, apps: readonly App[]) {
  seedHqNavigation(store, ORG, { structure: { apps, ungrouped: [] } });
}

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | .map((birth) => birth.id); → .map((birth) => birth.face);
it.effect(
  "OP29: After a lost answer an HQ write adopts only the one effect HQ's navigation shows that was absent before",
  () =>
    Effect.gen(function* () {
      const knownShop = () => account({ structure: { apps: [shop], ungrouped: [] } });
      const created = knownShop();
      yield* operationsOf(created, {
        createApp: async () => {
          hqSays(created, [shop, { ...shop, id: "app-9", name: "Garden" }]);
          throw lost;
        },
      }).submit({ kind: "create-app", orgId: ORG, name: "Garden" });
      expect(progress(created, "r1")).toMatchObject({ stage: "done", outcome: "succeeded" });
      expect(operationResult(created.state().operations.get("r1"), "create-app")).toEqual({
        appId: "app-9",
      });

      const born = knownShop();
      yield* operationsOf(born, {
        recordBirth: async () => {
          hqSays(born, [{ ...shop, births: [{ id: "birth-1", face: "tint:shape" }] }]);
          throw lost;
        },
      }).submit({
        kind: "record-birth",
        orgId: ORG,
        appId: "app-1",
        id: "birth-1",
        face: "tint:shape",
      });
      expect(progress(born, "r1")).toMatchObject({ stage: "done", outcome: "succeeded" });
      expect(operationResult(born.state().operations.get("r1"), "record-birth")).toEqual({
        birthId: "birth-1",
      });

      const attached = knownShop();
      yield* operationsOf(attached, {
        attachProject: async () => {
          hqSays(attached, [
            { ...shop, projects: [{ projectId: "p1", name: "p1", kind: "stage", mate: null }] },
          ]);
          throw new HqError({ kind: "refused", code: "conflict", message: "Attached already." });
        },
      }).submit({
        kind: "attach-project",
        orgId: ORG,
        appId: "app-1",
        attach: { projectId: "p1", kind: "stage", created: true },
      });
      expect(progress(attached, "r1")).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
);

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | effectHandles: candidates, → effectHandles: (read, intent) => candidates(read, intent) ?? [],
it.effect(
  "OP30: A lost HQ answer never adopts a record that existed before, from a baseline that was never read",
  () =>
    Effect.gen(function* () {
      for (const kind of ["app", "birth"] as const) {
        const store = makeAccountStore(AtomRegistry.make());
        liveZerops({ running: [] }).forEach(store.dispatch);
        const writes: (string | undefined)[] = [];
        const api: Partial<HqWrites> = {
          createApp: async (name) => {
            writes.push(name);
            hqSays(store, [{ ...shop, id: "preexisting", name: "Garden" }]);
            throw lost;
          },
          recordBirth: async ({ id }) => {
            writes.push(id);
            hqSays(store, [
              { ...shop, births: [{ id: "preexisting", face: "face", projectId: null }] },
            ]);
            throw lost;
          },
        };
        const operations = makeOperations({
          store,
          makeId: () => "r1",
          executors: {
            hq: makeHqExecutor({
              apiOf: () => api as HqWrites,
              zerops: {
                mintIntegrationToken: () => Promise.reject(new Error("Unexpected mint.")),
                deleteIntegrationToken: () =>
                  Promise.reject(new Error("Unexpected token retirement.")),
              },
            }),
          },
        });
        yield* operations.submit(
          kind === "app"
            ? { kind: "create-app", orgId: ORG, name: "Garden" }
            : { kind: "record-birth", orgId: ORG, appId: "app-1", id: "birth-1", face: "face" },
        );
        expect(progress(store, "r1")).toEqual({ stage: "uncertain", next: "ask-owner-again" });
        expect(writes).toEqual(kind === "app" ? ["Garden"] : ["birth-1"]);
      }
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | cause.kind === "refused" && cause.code !== "conflict" → cause.kind === "refused" && cause.code === "conflict"
it.effect("OP31: An environment token HQ refused is taken back, saying HQ's refusal", () =>
  Effect.gen(function* () {
    const store = account();
    const writes: string[] = [];
    const operations = operationsOf(
      store,
      {
        keepDeployToken: async () => {
          throw new HqError({ kind: "refused", code: "forbidden", message: "Not yours to keep." });
        },
      },
      {
        mintIntegrationToken: async ({ name }) => {
          writes.push(`mint ${name}`);
          return { id: "tok-1", token: "secret" };
        },
        deleteIntegrationToken: async ({ tokenId }) => {
          writes.push(`delete ${tokenId}`);
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
    expect(writes).toEqual(["mint mate-hq-deploy:stage:p-stage", "delete tok-1"]);
    expect(progress(store, "r1")).toEqual({ stage: "refused", reason: "Not yours to keep." });
  }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | await api.setAutoUpdatePolicy(intent.enabled); → await api.setAutoUpdatePolicy(intent.enabled).catch(() => api.setAutoUpdatePolicy(intent.enabled));
it.effect(
  "OP32: A lost policy answer is never sent again, nor adopted from another admin's matching choice",
  () =>
    Effect.gen(function* () {
      const store = account();
      const writes: boolean[] = [];
      const operations = operationsOf(store, {
        setAutoUpdatePolicy: async (enabled) => {
          writes.push(enabled);
          throw lost;
        },
      });
      yield* operations.submit({ kind: "set-auto-update-policy", orgId: ORG, enabled: false });
      const policy = { orgId: ORG, enabled: false, revision: 4 };
      const scope = `hq:${policy.orgId}:auto-update-policy` as const;
      store.dispatch({
        kind: "rows",
        scope,
        generation: readsOfState(store.state()).stream(scope).generation,
        method: "read",
        via: "hq-stream",
        rows: [
          {
            family: "hqAutoUpdatePolicy",
            id: policy.orgId,
            value: policy,
            revision: { kind: "hq", incarnation: "core", revision: policy.revision },
          },
        ],
      });

      yield* operations.retry("r1");
      expect(progress(store, "r1")).toMatchObject({ stage: "uncertain" });
      expect(writes).toEqual([false]);
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | yield* Effect.tryPromise({ try: call, catch: (cause) => faultOf(cause, true) }); → yield* Effect.tryPromise({ try: call, catch: (cause) => faultOf(cause) });
it.effect(
  "OP33: A save over a revision HQ no longer holds offers HQ's version and is never sent again",
  () =>
    Effect.gen(function* () {
      const SAVE = {
        kind: "save-persona-template",
        orgId: ORG,
        templateId: "t-1",
        revision: 2,
        name: "Reviewer",
        description: "Reads every change twice.",
        instructions: "Review before you merge.",
      } as const;

      const store = account();
      const observe = (revision: number, instructions: string) => {
        const scope = personaTemplatesScope(ORG);
        store.dispatch({
          kind: "rows",
          scope,
          generation: readsOfState(store.state()).stream(scope).generation,
          method: "read",
          via: "hq-stream",
          rows: [
            {
              family: "hqPersonaTemplates",
              id: ORG,
              value: {
                templates: [
                  {
                    id: SAVE.templateId,
                    name: SAVE.name,
                    description: SAVE.description,
                    instructions,
                    revision,
                  },
                ],
                unreadable: [],
              },
              revision: { kind: "hq", incarnation: "core", revision },
            },
          ],
        });
      };
      observe(2, SAVE.instructions);
      const revisions: number[] = [];
      const operations = operationsOf(store, {
        savePersonaTemplate: async (_id, input) => {
          revisions.push(input.revision);
          observe(3, "Ship fast.");
          throw new HqError({
            kind: "refused",
            code: "conflict",
            reason: "revision_conflict",
            status: 409,
            message: "Someone else changed this template meanwhile.",
          });
        },
      });
      yield* operations.submit(SAVE);
      yield* operations.retry("r1");
      expect(personaTemplateWrite.derive(readsOfState(store.state()), "r1")).toEqual({
        stage: "conflict",
        current: {
          id: "t-1",
          name: "Reviewer",
          description: "Reads every change twice.",
          instructions: "Ship fast.",
          revision: 3,
        },
      });
      expect(revisions).toEqual([2]);
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | withCode: intent.withCode === true → withCode: intent.withCode !== false
it.effect("OP34: Deleting an app asks HQ to delete its code only when the person chose to", () =>
  Effect.gen(function* () {
    const writes: unknown[] = [];
    const operations = operationsOf(account(), {
      deleteApp: async (...args) => {
        writes.push(args);
      },
    });
    yield* operations.submit(
      { kind: "delete-app", orgId: "org", appId: "app", withCode: true },
      "request-1",
    );
    yield* operations.submit({ kind: "delete-app", orgId: "org", appId: "empty" }, "request-2");
    expect(writes).toEqual([
      ["app", { withCode: true }],
      ["empty", { withCode: false }],
    ]);
  }),
);
