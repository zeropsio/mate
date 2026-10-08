import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { doorThrowawayName } from "../../authorization/zeropsThrowaway.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { makeThrowawayDebt, THROWAWAY_SWEEP_AGE_MS } from "../../zerops/doorThrowaway.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { throwawaySweepExecutor, type ThrowawaySweepPlatform } from "./executors/throwawaySweep.ts";

const ORG = "org-1";
const NOW = 10 * THROWAWAY_SWEEP_AGE_MS;
const MATURE = NOW - THROWAWAY_SWEEP_AGE_MS - 10;

function platformOf(tokens: ReadonlyArray<{ readonly id: string; readonly name?: string }>) {
  const calls: string[] = [];
  const platform: ThrowawaySweepPlatform = {
    listIntegrationTokens: async () => {
      calls.push("list");
      return tokens;
    },
    deleteIntegrationToken: async ({ tokenId }) => {
      calls.push(`delete ${tokenId}`);
    },
  };
  return { platform, calls };
}

describe("throwaway-sweep", () => {
  it.effect("deletes owed throwaways by the id their mint answered, without listing", () =>
    Effect.gen(function* () {
      const debt = makeThrowawayDebt();
      const name = doorThrowawayName("p1", "n1");
      debt.owe(ORG, MATURE, name);
      debt.minted(ORG, name, "t1");
      const { platform, calls } = platformOf([]);
      const execute = throwawaySweepExecutor({ platform, debtOf: () => debt, nowMs: () => NOW });

      const receipt = yield* execute("r1", {
        kind: "throwaway-sweep",
        clientId: ORG,
        userId: "u1",
        explicit: false,
      });

      expect(calls).toEqual(["delete t1"]);
      expect(receipt.outcome.kind).toBe("succeeded");
      expect(debt.failedAt(ORG)).toBeNull();
    }),
  );

  it.effect("finds a throwaway whose mint answer was lost by its name, and no other", () =>
    Effect.gen(function* () {
      const debt = makeThrowawayDebt();
      const name = doorThrowawayName("p1", "lost");
      debt.owe(ORG, MATURE, name);
      const { platform, calls } = platformOf([
        { id: "t1", name },
        { id: "t2", name: doorThrowawayName("p1", "another-tab") },
      ]);
      const execute = throwawaySweepExecutor({ platform, debtOf: () => debt, nowMs: () => NOW });

      const receipt = yield* execute("r1", {
        kind: "throwaway-sweep",
        clientId: ORG,
        userId: "u1",
        explicit: false,
      });

      expect(calls).toEqual(["list", "delete t1"]);
      expect(receipt.outcome.kind).toBe("succeeded");
      expect(debt.failedAt(ORG)).toBeNull();
    }),
  );

  it.effect("a list that fails keeps the debt and answers failed, asking the person again", () =>
    Effect.gen(function* () {
      const debt = makeThrowawayDebt();
      debt.owe(ORG, MATURE, doorThrowawayName("p1", "lost"));
      const platform: ThrowawaySweepPlatform = {
        listIntegrationTokens: () => Promise.reject(new Error("Zerops is unreachable.")),
        deleteIntegrationToken: () => Promise.resolve(),
      };
      const execute = throwawaySweepExecutor({ platform, debtOf: () => debt, nowMs: () => NOW });

      const receipt = yield* execute("r1", {
        kind: "throwaway-sweep",
        clientId: ORG,
        userId: "u1",
        explicit: false,
      });

      expect(receipt.outcome).toEqual({ kind: "failed", evidence: "Zerops is unreachable." });
      expect(debt.sweepFailed(ORG)).toBe(true);
      expect(debt.failedAt(ORG)).not.toBeNull();
    }),
  );

  it.effect(
    "asked again, it deletes the recorded failures by id and stops at the first that does not go through",
    () =>
      Effect.gen(function* () {
        const debt = makeThrowawayDebt();
        const refused = doorThrowawayName("p1", "refused");
        const lost = doorThrowawayName("p1", "lost");
        for (const [name, tokenId] of [
          [refused, "t1"],
          [lost, "t2"],
        ] as const) {
          debt.owe(ORG, MATURE, name);
          debt.minted(ORG, name, tokenId);
          debt.failCleanup(ORG, MATURE, { attempt: name, tokenId, state: "failed", reason: "x" });
        }
        const platform: ThrowawaySweepPlatform = {
          listIntegrationTokens: () => Promise.resolve([]),
          deleteIntegrationToken: ({ tokenId }) =>
            tokenId === "t1"
              ? Promise.reject(new ZeropsApiError("No answer.", "network"))
              : Promise.resolve(),
        };
        const execute = throwawaySweepExecutor({ platform, debtOf: () => debt, nowMs: () => NOW });

        const receipt = yield* execute("r1", {
          kind: "throwaway-sweep",
          clientId: ORG,
          userId: "u1",
          explicit: true,
        });

        expect(receipt.outcome).toEqual({ kind: "failed", evidence: "No answer." });
        expect(debt.cleanupFailures(ORG).map(({ tokenId, state }) => ({ tokenId, state }))).toEqual(
          [
            // Lost on the way: it may have applied.
            { tokenId: "t1", state: "unknown" },
            // Never tried: still as it was.
            { tokenId: "t2", state: "failed" },
          ],
        );
      }),
  );

  it.effect("goes from submitted to done through the account's operations", () =>
    Effect.gen(function* () {
      const debt = makeThrowawayDebt();
      const { platform } = platformOf([]);
      const execute = throwawaySweepExecutor({ platform, debtOf: () => debt, nowMs: () => NOW });
      const store = makeAccountStore(AtomRegistry.make());
      const operations = makeOperations({
        store,
        executors: {
          zerops: {
            submit: (requestId, intent) =>
              intent.kind === "throwaway-sweep"
                ? execute(requestId, intent)
                : Effect.die("not a Zerops kind"),
            lookup: () => Effect.succeed(null),
          },
        },
        makeId: () => "r1",
      });

      const requestId = yield* operations.submit({
        kind: "throwaway-sweep",
        clientId: ORG,
        userId: "u1",
        explicit: true,
      });

      expect(operationProgress.derive(readsOfState(store.state()), requestId)).toEqual({
        stage: "done",
        operationId: "r1",
        outcome: "succeeded",
      });
    }),
  );

  it.effect("an automatic sweep stops, settling nothing, once a cleanup failed meanwhile", () =>
    Effect.gen(function* () {
      const debt = makeThrowawayDebt();
      const name = doorThrowawayName("p1", "lost");
      debt.owe(ORG, MATURE, name);
      const platform: ThrowawaySweepPlatform = {
        listIntegrationTokens: async () => {
          debt.failCleanup(ORG, NOW, {
            attempt: doorThrowawayName("p1", "door"),
            tokenId: "t9",
            state: "failed",
            reason: "refused",
          });
          return [{ id: "t1", name }];
        },
        deleteIntegrationToken: () => Promise.reject(new Error("must not delete")),
      };
      const execute = throwawaySweepExecutor({ platform, debtOf: () => debt, nowMs: () => NOW });

      const receipt = yield* execute("r1", {
        kind: "throwaway-sweep",
        clientId: ORG,
        userId: "u1",
        explicit: false,
      });

      expect(receipt.outcome).toEqual({ kind: "failed", evidence: "refused" });
      expect(debt.owed(ORG, NOW).map((entry) => entry.attempt)).toContain(name);
    }),
  );

  it.effect("waits out a throttled token list's Retry-After, then sweeps", () =>
    Effect.gen(function* () {
      const debt = makeThrowawayDebt();
      const name = doorThrowawayName("p1", "lost");
      debt.owe(ORG, MATURE, name);
      let lists = 0;
      const deletes: string[] = [];
      const platform: ThrowawaySweepPlatform = {
        listIntegrationTokens: async () => {
          lists += 1;
          if (lists === 1)
            throw new ZeropsApiError("Too many requests.", "server", 429, null, null, 30_000);
          return [{ id: "t1", name }];
        },
        deleteIntegrationToken: async ({ tokenId }) => {
          deletes.push(tokenId);
        },
      };
      const execute = throwawaySweepExecutor({ platform, debtOf: () => debt, nowMs: () => NOW });
      const fiber = yield* Effect.forkChild(
        execute("r1", { kind: "throwaway-sweep", clientId: ORG, userId: "u1", explicit: false }),
      );
      yield* TestClock.adjust("29 seconds");
      expect([lists, deletes]).toEqual([1, []]);
      yield* TestClock.adjust("1 second");
      const receipt = yield* Fiber.join(fiber);
      expect([lists, deletes]).toEqual([2, ["t1"]]);
      expect(receipt.outcome.kind).toBe("succeeded");
    }),
  );
});
