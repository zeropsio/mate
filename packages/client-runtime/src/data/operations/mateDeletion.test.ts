import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { type OperationReceipt } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { HqError } from "../../zerops/hq/client.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { retireMateKeyExecutor } from "./executors/mateDeletion.ts";
import { mateKeyRetirementAllowed } from "./mateDeletion.ts";

const PREPARE = {
  kind: "prepare-mate-deletion",
  orgId: ORG,
  hqProjectId: "hq",
  projectId: "p1",
} as const;
const COMPLETE = {
  ...PREPARE,
  kind: "complete-mate-deletion",
  preparedRequestId: "prepare",
  completion: "exact-completion",
} as const;
const RETIRE = {
  kind: "retire-mate-key",
  orgId: ORG,
  projectId: "p1",
  tokenId: "key-1",
  preparedRequestId: "prepare",
  completionRequestId: "complete",
} as const;

function account() {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    mates: { p1: { presence: { online: false, since: "2026-10-07", overview: "stored" } } },
  });
  return store;
}
const progress = (store: ReturnType<typeof account>, id: string) =>
  operationProgress.derive(readsOfState(store.state()), id);

describe("Mate deletion cleanup receipts", () => {
  it.effect.each(["deleted", "denied", "omitted"] as const)(
    "lost HQ completion needs its exact original receipt, not placement $0",
    (evidence) =>
      Effect.gen(function* () {
        const store = account();
        let calls = 0;
        const operations = makeOperations({
          store,
          makeId: () => "unused",
          executors: {
            hq: makeHqExecutor({
              apiOf: () =>
                ({
                  lifecycleWrite: async (_requestId: string, intent: typeof COMPLETE) => {
                    expect([intent.projectId, intent.completion]).toEqual([
                      "p1",
                      "exact-completion",
                    ]);
                    calls++;
                    throw new HqError({
                      kind: "uncertain",
                      code: "network",
                      message: "Answer lost.",
                    });
                  },
                }) as unknown as HqWrites,
              active: () => true,
              hqProjectIdOf: () => "hq",
              zerops: {
                mintIntegrationToken: () => Promise.reject(new Error("no mint")),
                deleteIntegrationToken: () => Promise.reject(new Error("no retirement yet")),
              },
            }),
          },
        });
        yield* operations.submit(COMPLETE, "complete");
        if (evidence === "omitted")
          seedHqNavigation(store, ORG, { structure: { apps: [], ungrouped: [] } });
        else if (evidence === "deleted")
          store.dispatch({
            kind: "proven-deletion",
            family: "placement",
            id: "p1",
            evidence: "HQ released this project",
          });
        else store.dispatch({ kind: "access", family: "placement", id: "p1", access: "denied" });
        yield* operations.retry("complete");
        expect(progress(store, "complete").stage).toBe("uncertain");
        expect(calls).toBe(1);
      }),
  );

  it("key retirement is tied to the original prepared key and completed project", () => {
    const store = account();
    const receipt = (requestId: string): OperationReceipt => ({
      requestId,
      operationId: "p1",
      executor: "hq",
      affected: [],
      handles: ["p1"],
      acceptance: { kind: "accepted" },
      outcome: { kind: "succeeded", evidence: "HQ answered" },
    });
    store.dispatch({ kind: "operation-recorded", requestId: "prepare", intent: PREPARE });
    store.dispatch({
      kind: "operation-receipt",
      receipt: {
        ...receipt("prepare"),
        acceptance: {
          kind: "accepted",
          result: { keyTokenId: "key-1", completion: "exact-completion" },
        },
      },
    });
    store.dispatch({ kind: "operation-recorded", requestId: "complete", intent: COMPLETE });
    store.dispatch({ kind: "operation-receipt", receipt: receipt("complete") });
    const read = readsOfState(store.state());
    expect(mateKeyRetirementAllowed(read, RETIRE)).toBe(true);
    for (const patch of [
      { tokenId: "other-key" },
      { projectId: "p2" },
      { orgId: "other-account" },
      { completionRequestId: "unproved" },
    ])
      expect(mateKeyRetirementAllowed(read, { ...RETIRE, ...patch })).toBe(false);
  });

  it.effect.each([
    "present",
    "gone",
    "lost-gone",
    "lost-present",
    "read-refused",
    "read-unavailable",
    "wrong-key",
  ] as const)("retires the exact key, recovering only source-proven absence: $0", (caseName) =>
    Effect.gen(function* () {
      const calls: string[] = [];
      let gone = caseName === "gone";
      const submit = retireMateKeyExecutor({
        readIntegrationToken: async (orgId, tokenId) => {
          calls.push("read");
          expect([orgId, tokenId]).toEqual([ORG, "key-1"]);
          if (caseName === "read-refused") throw new ZeropsApiError("No access.", "forbidden", 403);
          if (caseName === "read-unavailable")
            throw new ZeropsApiError("Read unavailable.", "network");
          return gone ? undefined : { id: caseName === "wrong-key" ? "unrelated-key" : "key-1" };
        },
        deleteIntegrationToken: async ({ tokenId }) => {
          calls.push(tokenId);
          if (caseName === "lost-gone") gone = true;
          if (caseName.startsWith("lost")) throw new ZeropsApiError("Answer lost.", "network");
        },
      });
      const store = account();
      const operations = makeOperations({
        store,
        executors: { zerops: { submit: (id) => submit(id, RETIRE) } },
        makeId: () => "retire",
      });
      yield* operations.submit(RETIRE);
      expect(progress(store, "retire").stage).toBe(
        caseName === "lost-present"
          ? "uncertain"
          : caseName === "read-refused"
            ? "refused"
            : caseName === "read-unavailable" || caseName === "wrong-key"
              ? "unsent"
              : "done",
      );
      expect(calls).toEqual(
        caseName === "gone" || caseName.startsWith("read-") || caseName === "wrong-key"
          ? ["read"]
          : caseName.startsWith("lost")
            ? ["read", "key-1", "read"]
            : ["read", "key-1"],
      );
    }),
  );
});
