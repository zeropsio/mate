/**
 * A Mate's ZCP authorized to observe, as the account's operation sends it to HQ: the verified
 * person is recorded for the Mate's existing context, and the status read begun before HQ's answer
 * is read again.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { readsOfState, makeAccountStore, type AccountStore } from "../store.ts";
import { operationProgress } from "../projections/operation.ts";
import { HqError } from "../../zerops/hq/client.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

function account(api: Partial<HqWrites>) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  const executor = makeHqExecutor({
    apiOf: () => api as HqWrites,
    zerops: {
      mintIntegrationToken: () => Promise.reject(new Error("not expected")),
      deleteIntegrationToken: () => Promise.reject(new Error("not expected")),
    },
    store,
  });
  const operations = makeOperations({ store, executors: { hq: executor }, makeId: () => "r1" });
  return { store, operations };
}

const INTENT = { kind: "authorize-observe", orgId: ORG, projectId: "p-mate" } as const;
const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");
const acknowledged = (store: AccountStore) =>
  readsOfState(store.state()).fact("hqObserveCredentialRequest", JSON.stringify([ORG, "p-mate"]))
    .kind === "known";

describe("authorizing a Mate's observation", () => {
  it.effect(
    "records the person at HQ for the Mate's existing context and reads its status again",
    () =>
      Effect.gen(function* () {
        const asked: unknown[] = [];
        const { store, operations } = account({
          establishZcpAuthorization: async (projectId, context) => {
            asked.push([projectId, context]);
            return { authorized: false, userId: null, expiresAt: null };
          },
        });
        yield* operations.submit(INTENT);
        expect(asked).toEqual([["p-mate", {}]]);
        expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
        expect(acknowledged(store)).toBe(true);
      }),
  );

  it.effect("keeps HQ's words where it refuses, and reads nothing again", () =>
    Effect.gen(function* () {
      const { store, operations } = account({
        establishZcpAuthorization: async () => {
          throw new HqError({
            kind: "refused",
            code: "forbidden",
            message: "Another person already authorized this Mate.",
          });
        },
      });
      yield* operations.submit(INTENT);
      expect(progress(store)).toMatchObject({
        stage: "refused",
        reason: "Another person already authorized this Mate.",
      });
      expect(acknowledged(store)).toBe(false);
    }),
  );
});
