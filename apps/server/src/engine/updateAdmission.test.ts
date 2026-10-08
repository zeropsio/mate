import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";

import { makeUpdateAdmission } from "./updateAdmission.ts";

describe("update admission", () => {
  it.effect.each([
    "Send",
    "Steer",
    "SwitchModel",
    "ImportHistory",
    "AssignAgent",
    "Archive",
    "Unarchive",
    "ArmWake",
    "WakeFired",
  ] as const)("an update refuses new %s before accepting it", (command) =>
    Effect.gen(function* () {
      const admission = yield* makeUpdateAdmission;
      yield* admission.begin;
      let accepted = false;
      const result = yield* admission.run(
        command,
        Effect.sync(() => {
          accepted = true;
          return true;
        }),
      );
      expect(result).toBeUndefined();
      expect(accepted).toBe(false);
      yield* admission.cancel;
      expect(yield* admission.run(command, Effect.succeed(true))).toBe(true);
    }),
  );

  it.effect.each([
    "Stop",
    "Answer",
    "Dismiss",
    "HistoryBatch",
    "CloseSession",
    "CancelWake",
    "EffectSettled",
    "ProviderSignals",
    "Recovered",
  ] as const)("an update allows %s to finish accepted work", (command) =>
    Effect.gen(function* () {
      const admission = yield* makeUpdateAdmission;
      yield* admission.begin;
      expect(yield* admission.run(command, Effect.succeed(true))).toBe(true);
    }),
  );

  it.effect("a send accepted before the fence completes before drain begins", () =>
    Effect.gen(function* () {
      const admission = yield* makeUpdateAdmission;
      const accepted = yield* Latch.make(false);
      const finish = yield* Latch.make(false);
      const send = yield* admission
        .run("Send", accepted.open.pipe(Effect.andThen(finish.await), Effect.as("accepted")))
        .pipe(Effect.forkScoped);
      yield* accepted.await;
      const drain = yield* admission.begin.pipe(Effect.forkScoped);
      expect(yield* admission.closed).toBe(false);
      yield* finish.open;
      expect(yield* Fiber.join(send)).toBe("accepted");
      yield* Fiber.join(drain);
      expect(yield* admission.run("Send", Effect.succeed("new"))).toBeUndefined();
    }),
  );
});
