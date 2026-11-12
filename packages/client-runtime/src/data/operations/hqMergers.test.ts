import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { HqError } from "../../zerops/hq/client.ts";
import { operationResult } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { sameMergers } from "./hqMergers.ts";

const orgId = "org";
const appId = "tea-shop";
const zerops = {
  mintIntegrationToken: async () => {
    throw new Error("Who merges mints no key.");
  },
  deleteIntegrationToken: async () => {
    throw new Error("Who merges deletes no key.");
  },
};

/** The account's operations over an HQ whose `setMergers` is `send`. */
function operationsOver(send: HqWrites["setMergers"]) {
  const store = makeAccountStore(AtomRegistry.make());
  const api = { setMergers: send } as unknown as HqWrites;
  const operations = makeOperations({
    store,
    makeId: () => "request",
    executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
  });
  return { store, operations };
}

describe("who merges, set in HQ", () => {
  // witness: packages/client-runtime/src/data/operations/executors/hq.ts | ...answered(requestId, intent.appId, { mergers }), → ...answered(requestId, intent.appId),
  it.effect("The people picked are sent once, and HQ's answer is the limit as it stands", () =>
    Effect.gen(function* () {
      const sent: unknown[] = [];
      const answer = { people: ["u-ada"], setBy: "u-owner", setAt: "2026-11-12T09:00:00.000Z" };
      const { store, operations } = operationsOver(async (...args) => {
        sent.push(args);
        return answer;
      });
      yield* operations.submit({ kind: "set-mergers", orgId, appId, people: ["u-ada"] });
      expect(sent).toEqual([[appId, ["u-ada"]]]);
      expect(operationProgress.derive(readsOfState(store.state()), "request")).toMatchObject({
        stage: "done",
        outcome: "succeeded",
      });
      expect(operationResult(store.state().operations.get("request"), "set-mergers")).toEqual({
        mergers: answer,
      });
    }),
  );

  // witness: packages/client-runtime/src/data/operations/executors/hq.ts | if (hqRouteMissing(cause)) return MERGERS_OLDER_HQ; →
  it.effect("An HQ without the setting is said to need an update, never as an error", () =>
    Effect.gen(function* () {
      const { store, operations } = operationsOver(async () => {
        throw new HqError({
          kind: "refused",
          code: "not_found",
          status: 404,
          message: "HQ refused this (not_found).",
        });
      });
      yield* operations.submit({ kind: "set-mergers", orgId, appId, people: null });
      expect(operationProgress.derive(readsOfState(store.state()), "request")).toMatchObject({
        stage: "refused",
        reason: "HQ needs an update to limit who merges.",
        code: "mergers_unsupported",
      });
    }),
  );

  // witness: packages/client-runtime/src/data/operations/executors/hq.ts | return words === undefined ? fault : { ...fault, message: words }; → return fault;
  it.effect(
    "A named person Zerops no longer lists is refused in plain words, and nothing is sent again",
    () =>
      Effect.gen(function* () {
        let sends = 0;
        const { store, operations } = operationsOver(async () => {
          sends += 1;
          throw new HqError({
            kind: "refused",
            code: "conflict",
            reason: "not_active_member",
            status: 409,
            message: "You are not an active member of this organization in Zerops.",
          });
        });
        yield* operations.submit({ kind: "set-mergers", orgId, appId, people: ["u-left"] });
        expect(operationProgress.derive(readsOfState(store.state()), "request")).toMatchObject({
          stage: "refused",
          reason:
            "Someone you picked is no longer an active member of this organization. Uncheck them and save again.",
        });
        yield* operations.retry("request");
        expect(sends).toBe(1);
      }),
  );
});

describe("sameMergers", () => {
  // witness: packages/client-runtime/src/data/operations/hqMergers.ts | if (a === null || b === null) return a === b; →
  it("The same people in another order are no change; no limit is not an empty list", () => {
    expect(sameMergers(["u-ada", "u-sam"], ["u-sam", "u-ada"])).toBe(true);
    expect(sameMergers(["u-ada"], ["u-ada", "u-sam"])).toBe(false);
    expect(sameMergers(null, [])).toBe(false);
    expect(sameMergers(null, null)).toBe(true);
  });
});
