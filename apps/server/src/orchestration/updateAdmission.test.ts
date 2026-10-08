import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeV1UpdateAdmission } from "./updateAdmission.ts";

describe("legacy update admission", () => {
  it.effect.each([
    "thread.turn.start",
    "thread.create",
    "thread.crew.create",
    "thread.runtime-mode.set",
    "thread.conversation.revert",
    "thread.checkpoint.revert",
    "project.create",
  ] as const)("%s is refused before new work is accepted", (tag) =>
    Effect.gen(function* () {
      const admission = yield* makeV1UpdateAdmission;
      yield* admission.begin;
      expect(yield* admission.run(tag, Effect.succeed("accepted"))).toBeUndefined();
      yield* admission.cancel;
      expect(yield* admission.run(tag, Effect.succeed("accepted"))).toBe("accepted");
    }),
  );

  it.effect.each([
    "thread.turn.interrupt",
    "thread.approval.respond",
    "thread.user-input.respond",
    "thread.user-input.dismiss",
    "thread.session.stop",
    "thread.session.set",
    "thread.message.assistant.complete",
    "thread.turn.diff.complete",
  ] as const)("%s can finish accepted work during an update", (tag) =>
    Effect.gen(function* () {
      const admission = yield* makeV1UpdateAdmission;
      yield* admission.begin;
      expect(yield* admission.run(tag, Effect.succeed("finished"))).toBe("finished");
    }),
  );
});
