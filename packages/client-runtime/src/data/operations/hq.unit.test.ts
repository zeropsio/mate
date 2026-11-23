import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
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

function operationsOf(store: AccountStore, api: Partial<HqWrites>) {
  return makeOperations({
    store,
    makeId: () => "r1",
    executors: {
      hq: makeHqExecutor({
        store,
        apiOf: () => api as HqWrites,
        active: () => true,
        hqProjectIdOf: () => "hq",
      }),
    },
  });
}

const progress = (store: AccountStore, id: string) =>
  operationProgress.derive(readsOfState(store.state()), id);

type App = NonNullable<SeededHq["structure"]>["apps"][number];
const shop: App = { id: "app-1", name: "Shop", projects: [], births: [], environments: [] };
const lost = new HqError({ kind: "uncertain", code: "network", message: "HQ's answer was lost." });

function hqSays(store: AccountStore, apps: readonly App[]) {
  seedHqNavigation(store, ORG, { structure: { apps, ungrouped: [] } });
}

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | appOf(read, id)?.name === intent.name → appOf(read, id)?.name !== intent.name
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
    }),
);

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | effectHandles: appsNamed, → effectHandles: (read, intent) => appsNamed(read, intent) ?? [],
it.effect(
  "OP30: A lost HQ answer never adopts a record that existed before, from a baseline that was never read",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      liveZerops({ running: [] }).forEach(store.dispatch);
      const writes: string[] = [];
      const api: Partial<HqWrites> = {
        createApp: async (name) => {
          writes.push(name);
          hqSays(store, [{ ...shop, id: "preexisting", name: "Garden" }]);
          throw lost;
        },
      };
      const operations = makeOperations({
        store,
        makeId: () => "r1",
        executors: {
          hq: makeHqExecutor({
            apiOf: () => api as HqWrites,
          }),
        },
      });
      yield* operations.submit({ kind: "create-app", orgId: ORG, name: "Garden" });
      expect(progress(store, "r1")).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      expect(writes).toEqual(["Garden"]);
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

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | try: () => api.startAppDeletion(intent.appId, { id: intent.id, stages: intent.stages }), → try: () => api.startAppDeletion(intent.appId, { id: intent.id, stages: intent.stages.slice(1) }),
it.effect(
  "OP34: Deleting an application with its code sends HQ one start naming exactly its reviewed stages, and the web deletes no stage project itself",
  () =>
    Effect.gen(function* () {
      const sent: unknown[] = [];
      const operations = operationsOf(account(), {
        startAppDeletion: async (...args) => {
          sent.push(["start-app-deletion", ...args]);
        },
        deleteApp: async (...args) => {
          sent.push(["delete-app", ...args]);
        },
      });
      yield* operations.submit({
        kind: "start-app-deletion",
        orgId: ORG,
        appId: "app-1",
        id: "op-1",
        stages: ["p-stage-a", "p-stage-b"],
      });
      expect(sent).toEqual([
        ["start-app-deletion", "app-1", { id: "op-1", stages: ["p-stage-a", "p-stage-b"] }],
      ]);
    }),
);

// witness: packages/client-runtime/src/data/operations/hqWrites.ts | (read, { appId, start }) => appOf(read, appId)?.operation?.id === start.id, → (read, { appId }) => appOf(read, appId)?.operation !== undefined,
it.effect(
  "OP+1: After a lost answer an environment start is adopted only when HQ's navigation shows the application's operation under the id its press fixed, never another operation running there",
  () =>
    Effect.gen(function* () {
      const going = (id: string): App => ({
        ...shop,
        operation: {
          id,
          kind: "environment",
          phase: "accepted",
          at: "2026-11-23T10:00:00.000Z",
          acceptedAt: "2026-11-23T10:00:00.000Z",
        },
      });
      for (const [shownId, adopted] of [
        ["op-1", true],
        ["op-other", false],
      ] as const) {
        const store = account({ structure: { apps: [shop], ungrouped: [] } });
        yield* operationsOf(store, {
          startEnvironment: async () => {
            hqSays(store, [going(shownId)]);
            throw lost;
          },
        }).submit({
          kind: "start-environment",
          orgId: ORG,
          appId: "app-1",
          start: { id: "op-1", tier: "stage", projectId: "p-stage" },
        });
        expect(progress(store, "r1").stage === "done", shownId).toBe(adopted);
      }
    }),
);
