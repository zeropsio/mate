import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { makeMateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";

/** No policy kept from an earlier run, and nothing kept from this one. */
const nothingKept = { heard: Option.none(), keep: () => Effect.void };

describe("automatic updates require a current HQ policy", () => {
  it.effect("an older rotating link cannot reopen a hold or clear its successor's policy", () =>
    Effect.gen(function* () {
      const policy = yield* makeMateAutoUpdatePolicy(nothingKept);
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
      assert.deepStrictEqual(yield* policy.current, Option.some(hold));
    }),
  );

  it.effect("an older policy answer cannot reopen an organization hold", () =>
    Effect.gen(function* () {
      const policy = yield* makeMateAutoUpdatePolicy(nothingKept);
      const hold = { orgId: "ORG", enabled: false, revision: 2 };
      const link = yield* policy.open(
        Effect.succeedSome({ orgId: "ORG", enabled: true, revision: 1 }),
      );
      yield* link.receive(Option.some(hold));
      assert.deepStrictEqual(yield* policy.verify, Option.some(hold));
      assert.deepStrictEqual(yield* policy.current, Option.some(hold));
    }),
  );
});
