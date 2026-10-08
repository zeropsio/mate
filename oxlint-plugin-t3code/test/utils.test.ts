import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { runOxlintFixtures } from "./utils.ts";

const ruleName = "t3code/no-theme-escape-hatches";
const filename = "apps/web/src/components/zerops/Probe.tsx";
const fixtures = [
  { filename, source: 'export const icon = <path stroke="currentColor" />;' },
  { filename, source: 'export const icon = <path stroke="#abc" />;' },
  {
    filename: "apps/web/src/themePalette.ts",
    source: 'export const foreground = "#fff";',
  },
  {
    filename,
    source: 'export const icon = <svg fill="#fff" stroke="#abc" />;',
  },
];

it.layer(NodeServices.layer)("batched oxlint fixtures", (it) => {
  it.effect("preserves isolated diagnostic identity, messages, counts and locations", () =>
    Effect.gen(function* () {
      const isolated = yield* Effect.forEach(fixtures, (fixture) =>
        runOxlintFixtures(ruleName, [fixture]).pipe(Effect.map((result) => result[0]!)),
      );
      const batched = yield* runOxlintFixtures(ruleName, fixtures);
      const withoutFilename = (results: typeof batched) =>
        results.map((diagnostics) =>
          diagnostics
            .map(({ filename: _filename, ...diagnostic }) => diagnostic)
            .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        );
      assert.deepStrictEqual(
        batched.map((diagnostics) => diagnostics.length),
        [0, 1, 0, 2],
      );
      assert.deepStrictEqual(withoutFilename(batched), withoutFilename(isolated));
    }),
  );

  it.effect("fails visibly when a fixture produces a syntax error", () =>
    runOxlintFixtures(ruleName, [{ filename, source: "export const icon = <" }]).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          assert.equal(error._tag, "OxlintFixtureFailure");
        }),
      ),
    ),
  );
});
