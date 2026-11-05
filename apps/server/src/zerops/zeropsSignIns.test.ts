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
      yield* store.save("claude-code", { by: "u-eva", at: 1 });
      yield* store.clear("claude-code");
      assert.strictEqual((yield* Fiber.join(heard)).length, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("logout keeps the last signer as history, never as authority", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      yield* store.save("claude-code", { by: "u-eva", at: 1 });
      yield* store.clear("claude-code");
      assert.deepStrictEqual(yield* store.load, {});
      assert.deepStrictEqual(yield* store.lastSigners, { "claude-code": "u-eva" });
      yield* store.save("claude-code", { by: "u-jan", at: 2 });
      assert.deepStrictEqual(yield* store.load, { "claude-code": { by: "u-jan", at: 2 } });
    }),
  );

  // HQ's map is what the Mate reported plus HQ's own writes (a hand-over, a person's removal): a
  // sign-in here that HQ had not heard of when it wrote the map is the newer truth.
  it.effect(
    "HQ's signers map names each login's owner, except where a sign-in here is younger than the map",
    () =>
      Effect.gen(function* () {
        const store = yield* memorySignInStore({
          older: { by: "u-eva", at: 100 },
          younger: { by: "u-eva", at: 300 },
          same: { by: "u-eva", at: 100, credentialCleared: true },
        });
        yield* store.heard(
          { fresh: "u-ada", older: "u-ada", younger: "u-ada", same: "u-eva" },
          200,
        );
        assert.deepStrictEqual(yield* store.load, {
          fresh: { by: "u-ada", at: 200 },
          older: { by: "u-ada", at: 200 },
          younger: { by: "u-eva", at: 300 },
        });
        assert.strictEqual((yield* store.lastSigners).same, "u-eva");

        // A map HQ sent without its time is older than every sign-in here: it only fills gaps.
        yield* store.heard({ younger: "u-jan", other: "u-jan" });
        assert.strictEqual((yield* store.load).younger?.by, "u-eva");
        assert.deepStrictEqual((yield* store.load).other, { by: "u-jan", at: 0 });
      }),
  );
});
