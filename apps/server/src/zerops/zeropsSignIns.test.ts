import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { memorySignInStore } from "./zeropsSignIns.ts";

describe("zeropsSignIns", () => {
  // Offboarding and the stand-up act on a recorded sign-in at once, not at a later look.
  it.effect("tells its listeners of each sign-in it keeps and each it clears", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const heard = yield* Stream.runCollect(Stream.take(store.changes, 2)).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* store.save("claude-code", { by: "u-eva" });
      yield* store.clear("claude-code");
      assert.strictEqual((yield* Fiber.join(heard)).length, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("logout keeps the last signer as history, never as authority", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      yield* store.save("claude-code", { by: "u-eva" });
      yield* store.clear("claude-code");
      assert.deepStrictEqual(yield* store.load, {});
      assert.deepStrictEqual(yield* store.lastSigners, { "claude-code": "u-eva" });
      yield* store.save("claude-code", { by: "u-jan" });
      assert.deepStrictEqual(yield* store.load, { "claude-code": { by: "u-jan" } });
    }),
  );

  it.effect(
    "HQ's signers frame fills logins the Mate has no signer for and keeps existing signers",
    () =>
      Effect.gen(function* () {
        const store = yield* memorySignInStore();
        yield* store.heard({ received: "u-eva" });
        yield* store.save("here", { by: "u-eva" });
        yield* store.save("history", { by: "u-eva" });
        yield* store.clear("history");
        yield* store.heard({
          fresh: "u-ada",
          received: "u-jan",
          here: "u-jan",
          history: "u-jan",
        });
        assert.deepStrictEqual(yield* store.lastSigners, {
          received: "u-eva",
          here: "u-eva",
          history: "u-eva",
          fresh: "u-ada",
        });
        assert.deepStrictEqual(
          Object.fromEntries(
            Object.entries(yield* store.load).map(([key, record]) => [key, record.by]),
          ),
          { received: "u-eva", here: "u-eva", fresh: "u-ada" },
        );
      }),
  );
});
