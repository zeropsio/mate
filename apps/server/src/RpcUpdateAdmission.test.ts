import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { makeRpcUpdateAdmission } from "./RpcUpdateAdmission.ts";

describe("client work during an update", () => {
  it.effect("accepted work finishes while new work is explicitly refused", () =>
    Effect.gen(function* () {
      const admission = yield* makeRpcUpdateAdmission;
      const accepted = yield* Deferred.make<void>();
      const completed = yield* Deferred.make<void>();
      const work = yield* admission
        .run(
          Deferred.succeed(accepted, undefined).pipe(Effect.andThen(Deferred.await(completed))),
          "updating",
          false,
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(accepted);
      yield* admission.begin;
      expect((yield* admission.facts).idle).toBe(false);
      const result = yield* admission
        .run(Effect.die("must not accept new work"), "updating", false)
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      yield* Deferred.succeed(completed, undefined);
      yield* Fiber.join(work);
      expect((yield* admission.facts).idle).toBe(true);
    }),
  );
  it.effect.each([true, false])("answers and stops cross a closed fence: %s", (continuation) =>
    Effect.gen(function* () {
      const admission = yield* makeRpcUpdateAdmission;
      yield* admission.begin;
      const result = yield* admission
        .run(Effect.succeed("settled"), "updating", continuation)
        .pipe(Effect.result);
      expect(result._tag).toBe(continuation ? "Success" : "Failure");
      yield* admission.cancel;
      expect(yield* admission.run(Effect.succeed("resumed"), "updating", false)).toBe("resumed");
    }),
  );
});
