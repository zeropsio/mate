import { ZeropsUserId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { memorySignInStore } from "./zeropsSignIns.ts";

describe("zeropsSignIns", () => {
  it.effect("a fresh in-memory store records a local signer immediately", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      assert.deepStrictEqual(yield* store.load, {});
      yield* store.save("claude-code", { by: ZeropsUserId.make("u-eva") });
      assert.deepStrictEqual(yield* store.load, {
        "claude-code": { by: ZeropsUserId.make("u-eva") },
      });
      assert.deepStrictEqual(yield* store.lastSigners, {
        "claude-code": ZeropsUserId.make("u-eva"),
      });
    }),
  );

  // Offboarding and the stand-up act on a recorded sign-in at once, not at a later look.
  it.effect("tells its listeners of each sign-in it keeps and each it clears", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const heard = yield* Stream.runCollect(Stream.take(store.changes, 2)).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* store.save("claude-code", { by: ZeropsUserId.make("u-eva") });
      yield* store.clear("claude-code");
      assert.strictEqual((yield* Fiber.join(heard)).length, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("logout keeps the last signer as history, never as authority", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      yield* store.save("claude-code", { by: ZeropsUserId.make("u-eva") });
      yield* store.clear("claude-code");
      assert.deepStrictEqual(yield* store.load, {});
      assert.deepStrictEqual(yield* store.lastSigners, {
        "claude-code": ZeropsUserId.make("u-eva"),
      });
      yield* store.save("claude-code", { by: ZeropsUserId.make("u-jan") });
      assert.deepStrictEqual(yield* store.load, {
        "claude-code": { by: ZeropsUserId.make("u-jan") },
      });
    }),
  );

  it.effect(
    "HQ's signers frame fills logins the Mate has no signer for and keeps existing signers",
    () =>
      Effect.gen(function* () {
        const store = yield* memorySignInStore();
        yield* store.heard({ received: ZeropsUserId.make("u-eva") });
        yield* store.save("here", { by: ZeropsUserId.make("u-eva") });
        yield* store.save("history", { by: ZeropsUserId.make("u-eva") });
        yield* store.clear("history");
        yield* store.heard({
          fresh: ZeropsUserId.make("u-ada"),
          received: ZeropsUserId.make("u-jan"),
          here: ZeropsUserId.make("u-jan"),
          history: ZeropsUserId.make("u-jan"),
        });
        assert.deepStrictEqual(yield* store.lastSigners, {
          received: ZeropsUserId.make("u-eva"),
          here: ZeropsUserId.make("u-eva"),
          history: ZeropsUserId.make("u-eva"),
          fresh: ZeropsUserId.make("u-ada"),
        });
        assert.deepStrictEqual(
          Object.fromEntries(
            Object.entries(yield* store.load).map(([key, record]) => [key, record.by]),
          ),
          {
            received: ZeropsUserId.make("u-eva"),
            here: ZeropsUserId.make("u-eva"),
            fresh: ZeropsUserId.make("u-ada"),
          },
        );
      }),
  );
});
