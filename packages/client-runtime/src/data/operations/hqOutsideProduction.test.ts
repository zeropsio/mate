import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { HqError } from "../../zerops/hq/client.ts";
import { operationResult } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { sameOutsideProduction } from "./hqOutsideProduction.ts";

const orgId = "org";
const appId = "tea-shop";
const address = "https://tea-shop.example";
const zerops = {
  mintIntegrationToken: async () => {
    throw new Error("Saying where production is deployed mints no key.");
  },
  deleteIntegrationToken: async () => {
    throw new Error("Saying where production is deployed deletes no key.");
  },
};

/** The account's operations over an HQ whose `setOutsideProduction` is `send`. */
function operationsOver(send: HqWrites["setOutsideProduction"]) {
  const store = makeAccountStore(AtomRegistry.make());
  const api = { setOutsideProduction: send } as unknown as HqWrites;
  const operations = makeOperations({
    store,
    makeId: () => "request",
    executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
  });
  return { store, operations };
}

describe("a production deployed outside Mate, said in HQ", () => {
  // witness: packages/client-runtime/src/data/operations/executors/hq.ts | outside: said === null ? null : { address: said.address }, → outside: null,
  it.effect("The address is sent once, and HQ's answer is how production stands", () =>
    Effect.gen(function* () {
      const sent: unknown[] = [];
      const { store, operations } = operationsOver(async (...args) => {
        sent.push(args);
        return { address, setBy: "u-owner", setAt: "2026-11-12T09:00:00.000Z" };
      });
      yield* operations.submit({
        kind: "set-outside-production",
        orgId,
        appId,
        outside: { address },
      });
      expect(sent).toEqual([[appId, { address }]]);
      expect(operationProgress.derive(readsOfState(store.state()), "request")).toMatchObject({
        stage: "done",
        outcome: "succeeded",
      });
      expect(
        operationResult(store.state().operations.get("request"), "set-outside-production"),
      ).toEqual({ outside: { address } });
    }),
  );

  // witness: packages/client-runtime/src/data/operations/executors/hq.ts | if (hqRouteMissing(cause)) return OUTSIDE_OLDER_HQ; →
  it.effect("An HQ from before it is said to need an update, never as an error", () =>
    Effect.gen(function* () {
      const { store, operations } = operationsOver(async () => {
        throw new HqError({
          kind: "refused",
          code: "not_found",
          status: 404,
          message: "HQ refused this (not_found).",
        });
      });
      yield* operations.submit({ kind: "set-outside-production", orgId, appId, outside: null });
      expect(operationProgress.derive(readsOfState(store.state()), "request")).toMatchObject({
        stage: "refused",
        reason: "HQ needs an update to keep a production deployed outside Mate.",
        code: "outside_production_unsupported",
      });
    }),
  );
});

describe("sameOutsideProduction", () => {
  // witness: packages/client-runtime/src/data/operations/hqOutsideProduction.ts | return a.address === b.address; → return true;
  it("Another address is a change; following main with no address is not the same as not following it", () => {
    expect(sameOutsideProduction({ address }, { address })).toBe(true);
    expect(sameOutsideProduction({ address }, { address: null })).toBe(false);
    expect(sameOutsideProduction(null, { address: null })).toBe(false);
    expect(sameOutsideProduction(null, null)).toBe(true);
  });
});
