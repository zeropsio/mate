import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { makeMateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";

describe("automatic updates require a current HQ policy", () => {
  for (const enabled of [true, false]) {
    it.effect(
      `honors HQ's ${enabled ? "enabled" : "held"} organization policy only while linked`,
      () =>
        Effect.gen(function* () {
          const policy = yield* makeMateAutoUpdatePolicy;
          assert.isTrue(Option.isNone(yield* policy.current));
          const link = yield* policy.open();
          const value = { orgId: "ORG", enabled, revision: 1 };
          yield* link.receive(Option.some(value));
          assert.deepStrictEqual(yield* policy.current, Option.some(value));
          yield* link.close;
          assert.isTrue(Option.isNone(yield* policy.current));
        }),
    );
  }

  it.effect("an older rotating link cannot reopen a hold or clear its successor's policy", () =>
    Effect.gen(function* () {
      const policy = yield* makeMateAutoUpdatePolicy;
      const old = yield* policy.open();
      const next = yield* policy.open();
      yield* old.receive(Option.some({ orgId: "ORG", enabled: true, revision: 1 }));
      const hold = { orgId: "ORG", enabled: false, revision: 2 };
      yield* next.receive(Option.some(hold));
      yield* old.receive(Option.some({ orgId: "ORG", enabled: true, revision: 1 }));
      yield* old.close;
      assert.deepStrictEqual(yield* policy.current, Option.some(hold));
      yield* next.close;
      yield* old.receive(Option.some({ orgId: "ORG", enabled: true, revision: 1 }));
      assert.isTrue(Option.isNone(yield* policy.current));
    }),
  );

  it.effect("a successor with an older HQ supplies no automatic-update permission", () =>
    Effect.gen(function* () {
      const policy = yield* makeMateAutoUpdatePolicy;
      const old = yield* policy.open();
      yield* old.receive(Option.some({ orgId: "ORG", enabled: true, revision: 0 }));
      const next = yield* policy.open();
      yield* next.receive(Option.none());
      assert.isTrue(Option.isNone(yield* policy.current));
    }),
  );
  it.effect("an older policy answer cannot reopen an organization hold", () =>
    Effect.gen(function* () {
      const policy = yield* makeMateAutoUpdatePolicy;
      const link = yield* policy.open(
        Effect.succeedSome({ orgId: "ORG", enabled: true, revision: 1 }),
      );
      yield* link.receive(Option.some({ orgId: "ORG", enabled: false, revision: 2 }));
      assert.isTrue(Option.isNone(yield* policy.verify));
      assert.isTrue(Option.isNone(yield* policy.current));
    }),
  );
});
