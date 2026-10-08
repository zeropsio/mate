import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { HqError } from "../../zerops/hq/client.ts";
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
