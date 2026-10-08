import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("t3code/no-test-in-loop", { filename: "fixture.test.ts" });
const sourceRule = createOxlintRuleHarness("t3code/no-test-in-loop", { filename: "fixture.ts" });

describe("t3code/no-test-in-loop", () => {
  rule.valid(
    "allows a table through each",
    `
      import { it } from "@effect/vitest";

      it.each([{ title: "one" }, { title: "two" }])("$title", () => {});
    `,
  );

  rule.valid(
    "allows a loop inside a test body",
    `
      import { it } from "@effect/vitest";

      it("checks every case", () => {
        for (const value of [1, 2]) {
          if (value < 0) throw new Error("negative");
        }
      });
    `,
  );

  rule.valid(
    "ignores files written against node:test",
    `
      import { it } from "node:test";

      for (const value of [1, 2]) {
        it(String(value), () => {});
      }
    `,
  );

  sourceRule.valid(
    "ignores files that are not tests",
    `
      declare const it: (name: string, run: () => void) => void;

      for (const value of [1, 2]) {
        it(String(value), () => {});
      }
    `,
  );

  rule.invalid(
    "reports a test declared in a for loop",
    `
      import { it } from "@effect/vitest";

      for (const value of [1, 2]) {
        it(String(value), () => {});
      }
    `,
    (output) => {
      assert.match(output, /it\.each\(cases\)/);
    },
  );

  rule.invalid(
    "reports an Effect test declared in a for loop",
    `
      import { it } from "@effect/vitest";
      import * as Effect from "effect/Effect";

      for (let index = 0; index < 2; index += 1) {
        it.effect(String(index), () => Effect.void);
      }
    `,
  );

  rule.invalid(
    "reports the describe around a loop's tests, not each test",
    `
      import { describe, it } from "@effect/vitest";

      for (const value of [1, 2]) {
        describe(String(value), () => {
          it("runs", () => {});
        });
      }
    `,
    undefined,
    1,
  );
});
