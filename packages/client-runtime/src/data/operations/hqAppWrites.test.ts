import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { HqError } from "../../zerops/hq/client.ts";
import { hqKeptGitScope } from "../families/hqKeptGit.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

const orgId = "org";
const appId = "app";
const zerops = {
  mintIntegrationToken: async () => {
    throw new Error("Application verbs do not mint keys.");
  },
  deleteIntegrationToken: async () => {
    throw new Error("Application verbs do not delete keys.");
  },
};
describe("HQ application verbs", () => {
  it.effect.each([{ kind: "rename-app", name: "Shop" }, { kind: "delete-app" }] as const)(
    "$kind records before sending and ends on HQ's answer",
    (write) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const calls: string[] = [];
        const send = async (id: string) => {
          expect(store.state().operations.get("request")?.intent.kind).toBe(write.kind);
          calls.push(id);
        };
        const api = { renameApp: send, deleteApp: send } as unknown as HqWrites;
        const operations = makeOperations({
          store,
          makeId: () => "request",
          executors: {
            hq: makeHqExecutor({ apiOf: () => api, zerops }),
          },
        });
        yield* operations.submit({ ...write, orgId, appId });
        expect(calls).toEqual([appId]);
        expect(operationProgress.derive(readsOfState(store.state()), "request")).toMatchObject({
          stage: "done",
          outcome: "succeeded",
        });
      }),
  );

  it.effect("delete-app with its code asks HQ to delete the code too", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const calls: unknown[] = [];
      const api = {
        deleteApp: async (...args: unknown[]) => {
          calls.push(args);
        },
      } as unknown as HqWrites;
      let made = 0;
      const operations = makeOperations({
        store,
        makeId: () => `request-${String((made += 1))}`,
        executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
      });
      yield* operations.submit({ kind: "delete-app", orgId, appId, withCode: true });
      yield* operations.submit({ kind: "delete-app", orgId, appId: "empty" });
      expect(calls).toEqual([
        [appId, { withCode: true }],
        ["empty", { withCode: false }],
      ]);
    }),
  );

  it.effect.each([
    {
      name: "refusal",
      cause: new HqError({
        kind: "refused",
        code: "app_not_empty",
        message: "App is not empty.",
        status: 409,
      }),
      stage: "refused",
    },
    {
      name: "outage before acceptance",
      cause: new HqError({ kind: "unavailable", code: "network", message: "HQ unreachable." }),
      stage: "unsent",
    },
    {
      name: "lost answer",
      cause: new HqError({ kind: "uncertain", code: "network", message: "Answer lost." }),
      stage: "uncertain",
    },
  ] as const)("$name is never resent automatically", ({ cause, stage }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      store.dispatch({
        kind: "baseline-commit",
        scope: hqAppsScope(orgId),
        generation: 0,
        via: "hq-stream",
        members: [appId],
        rows: [
          {
            family: "hqApp",
            id: appId,
            value: { id: appId, name: "Before" } as never,
            revision: { kind: "hq", incarnation: "fixture", revision: 1 },
          },
        ],
      });
      let sends = 0;
      const api = {
        deleteApp: async () => {
          sends += 1;
          throw cause;
        },
      } as unknown as HqWrites;
      const operations = makeOperations({
        store,
        makeId: () => "request",
        executors: {
          hq: makeHqExecutor({ apiOf: () => api, zerops }),
        },
      });
      yield* operations.submit({ kind: "delete-app", orgId, appId });
      expect(operationProgress.derive(readsOfState(store.state()), "request").stage).toBe(stage);
      if (stage !== "unsent") yield* operations.retry("request");
      expect(sends).toBe(1);
      if (stage === "uncertain") {
        // Partial coverage and transport loss are no proof of deletion.
        store.dispatch({
          kind: "baseline-commit",
          scope: hqAppsScope(orgId),
          generation: 0,
          via: "hq-stream",
          partial: true,
          members: [],
          rows: [],
        });
        store.dispatch({
          kind: "stream",
          key: hqAppsScope(orgId),
          now: 0,
          event: { kind: "parent-lost" },
        });
        yield* operations.retry("request");
        expect(operationProgress.derive(readsOfState(store.state()), "request").stage).toBe(
          "uncertain",
        );
        store.dispatch({
          kind: "delivery",
          via: "hq-stream",
          scopes: [{ scope: hqAppsScope(orgId), generation: 0 }],
          reset: false,
          rows: [],
          removals: [{ family: "hqApp", id: appId, reason: "deleted" }],
        });
        yield* operations.retry("request");
        expect(operationProgress.derive(readsOfState(store.state()), "request")).toMatchObject({
          stage: "done",
          outcome: "succeeded",
        });
      }
    }),
  );
});

describe("HQ kept Git answers", () => {
  it.effect.each(["keep", "delete"] as const)(
    "%s records the answer before sending and ends on HQ's receipt",
    (answer) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const calls: unknown[] = [];
        const api = {
          answerKeptGit: async (...args: unknown[]) => {
            expect(store.state().operations.get("kept-git")?.intent).toEqual({
              kind: "answer-kept-git",
              orgId,
              appId,
              answer,
            });
            calls.push(args);
          },
        } as unknown as HqWrites;
        const operations = makeOperations({
          store,
          makeId: () => "kept-git",
          executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
        });
        yield* operations.submit({ kind: "answer-kept-git", orgId, appId, answer });
        expect(calls).toEqual([[appId, answer]]);
        expect(operationProgress.derive(readsOfState(store.state()), "kept-git")).toMatchObject({
          stage: "done",
          outcome: "succeeded",
        });
      }),
  );

  it.effect("a refused kept Git answer retains HQ's reason without repeating the write", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let sends = 0;
      const api = {
        answerKeptGit: async () => {
          sends += 1;
          throw new HqError({
            kind: "refused",
            code: "conflict",
            reason: "not_asked",
            message: "This question is already closed.",
          });
        },
      } as unknown as HqWrites;
      const operations = makeOperations({
        store,
        makeId: () => "kept-git",
        executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
      });
      yield* operations.submit({ kind: "answer-kept-git", orgId, appId, answer: "keep" });
      expect(operationProgress.derive(readsOfState(store.state()), "kept-git")).toMatchObject({
        stage: "refused",
        reason: "This question is already closed.",
      });
      yield* operations.retry("kept-git");
      expect(sends).toBe(1);
    }),
  );
});

it.effect.each(["keep", "delete"] as const)(
  "a lost %s answer remains uncertain after HQ removes the question and is never resent",
  (answer) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const scope = hqKeptGitScope(orgId);
      store.dispatch({
        kind: "baseline-commit",
        scope,
        generation: 0,
        via: "hq-stream",
        members: [appId],
        rows: [
          {
            family: "hqKeptGit",
            id: appId,
            value: {
              appId,
              appName: "Shop",
              projectId: "gone",
              projectName: null,
              askedAt: "2026-10-25T09:00:00Z",
            },
            revision: { kind: "hq", incarnation: "fixture", revision: 1 },
          },
        ],
      });
      let sends = 0;
      const api = {
        answerKeptGit: async () => {
          sends += 1;
          throw new HqError({ kind: "uncertain", code: "network", message: "Answer lost." });
        },
      } as unknown as HqWrites;
      const operations = makeOperations({
        store,
        makeId: () => "kept-git",
        executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
      });
      const intent = { kind: "answer-kept-git", orgId, appId, answer } as const;
      yield* operations.submit(intent, "kept-git");
      expect(operationProgress.derive(readsOfState(store.state()), "kept-git").stage).toBe(
        "uncertain",
      );
      store.dispatch({
        kind: "delivery",
        via: "hq-stream",
        scopes: [{ scope, generation: 0 }],
        reset: false,
        rows: [],
        removals: [{ family: "hqKeptGit", id: appId, reason: "no-access" }],
      });
      yield* operations.retry("kept-git");
      yield* operations.submit(intent, "kept-git");
      expect(readsOfState(store.state()).fact("hqKeptGit", appId)).toMatchObject({
        kind: "withheld",
        reason: "denied",
      });
      expect(operationProgress.derive(readsOfState(store.state()), "kept-git").stage).toBe(
        "uncertain",
      );
      expect(sends).toBe(1);
    }),
);
