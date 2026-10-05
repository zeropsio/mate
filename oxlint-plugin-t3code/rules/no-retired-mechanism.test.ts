import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry } from "../exceptions.ts";
import { RETIRED_MECHANISMS } from "../retiredMechanisms.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE = "t3code/no-retired-mechanism";
const LEDGER_DIRECTORY_ENV = "T3CODE_RETIRED_MECHANISM_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const webFile = createOxlintRuleHarness(RULE, {
  filename: "apps/web/src/zerops/useFixtureMenu.ts",
});
const hqFile = createOxlintRuleHarness(RULE, { filename: "apps/hq/src/fixtureStream.ts" });

const KEEP = `export const keep = rememberMenuCandidates;`;
const KEEP_ENTRY: ExceptionEntry = {
  path: "apps/web/src/zerops/useFixtureMenu.ts",
  kind: "retired-token",
  fingerprint: "rememberMenuCandidates",
  owner: "data-layer rewrite: projects",
  reason: "fixture exception",
  expires: "never",
};

const withFixtureLedger = <A, E, R>(
  entries: ReadonlyArray<ExceptionEntry>,
  effect: Effect.Effect<A, E, R>,
  reportLedgered = false,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "retired-mechanism-ledger-" });
      yield* fs.writeFileString(
        path.join(directory, "no-retired-mechanism.json"),
        `${encodeUnknownJson(entries)}\n`,
      );
      const environment = process.env;
      const keys = [LEDGER_DIRECTORY_ENV, "T3CODE_GUARD_REPORT_LEDGERED"] as const;
      const previous = keys.map((key) => environment[key]);
      environment[LEDGER_DIRECTORY_ENV] = directory;
      if (reportLedgered) environment.T3CODE_GUARD_REPORT_LEDGERED = "1";
      return yield* effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            keys.forEach((key, index) => {
              const value = previous[index];
              if (value === undefined) delete environment[key];
              else environment[key] = value;
            });
          }),
        ),
      );
    }),
  );

describe("retired mechanisms", () => {
  it("lists each token once, so one site is one finding", () => {
    const tokens = RETIRED_MECHANISMS.map((mechanism) => mechanism.token);
    assert.deepStrictEqual(
      tokens.filter((token, index) => tokens.indexOf(token) !== index),
      [],
    );
  });
});

const DISTINCTIVE = RETIRED_MECHANISMS.filter((mechanism) => mechanism.paths === undefined);
/** File-bound tokens, less any that holds a distinctive token, which is retired everywhere. */
const BOUND = RETIRED_MECHANISMS.filter(
  (mechanism) =>
    mechanism.paths !== undefined &&
    !DISTINCTIVE.some((distinctive) => mechanism.token.includes(distinctive.token)),
);
const freshFile = createOxlintRuleHarness(RULE, {
  filename: "apps/web/src/components/zerops/FreshUnrelatedPanel.tsx",
});

it.layer(NodeServices.layer)("no-retired-mechanism ledger", (it) => {
  it.effect("reports a common name in a file its mechanism lives in", () =>
    withFixtureLedger(
      [],
      createOxlintRuleHarness(RULE, {
        filename: "apps/web/src/zerops/ZeropsProjectFlowProvider.tsx",
      }).runAndExpectFailure(`const [awaiting, setAwaiting] = useState(false);`),
    ),
  );

  it.effect("an exact ledger entry suppresses the finding", () =>
    withFixtureLedger([KEEP_ENTRY], webFile.run(KEEP)),
  );

  it.effect("the reconciliation driver still sees a ledgered finding", () =>
    withFixtureLedger([KEEP_ENTRY], webFile.runAndExpectFailure(KEEP), true).pipe(
      Effect.tap((output) => Effect.sync(() => assert.match(output, /"ledgered":true/u))),
    ),
  );
});

describe("t3code/no-retired-mechanism", () => {
  webFile.invalid(
    "reports a retired name",
    `import { rememberMenuCandidates } from "./menuSkeleton";\nexport const keep = rememberMenuCandidates;`,
    undefined,
    2,
  );
  webFile.invalid(
    "reports a retired storage key and call pattern, naming the replacement",
    [
      `const KEY = "mate:zerops:menu-memory";`,
      `export const useCompares = (compareAsks) => useZeropsCompares(compareAsks);`,
    ].join("\n"),
    (output) => assert.match(output, /the store holds them in memory/u),
    2,
  );
  webFile.invalid(
    "reports a pattern a formatter wrapped over two lines",
    `export const useInventory = (drawnMateProjects) =>\n  useMatesInventory(\n    useMemo(() =>\n      drawnMateProjects, []));`,
  );
  webFile.invalid(
    "reports a pattern written with its own spacing",
    `export const useCompares = (compareAsks) => useZeropsCompares( compareAsks );`,
  );
  hqFile.invalid(
    "reports a retired HQ mechanism",
    `export const segment = STRUCTURE_SEGMENT_LIFETIME;`,
  );
  freshFile.valid(
    "leaves ordinary new code that happens to use a common name alone",
    `export function Panel() {\n  const [awaiting, setAwaiting] = useState(false);\n  return [awaiting, setAwaiting];\n}`,
  );
  freshFile.valid(
    "leaves every file-bound token alone in a file outside its mechanism",
    `export const names = [${BOUND.map((mechanism) => `String.raw\`${mechanism.token}\``).join(", ")}];`,
  );
  webFile.valid(
    "leaves a retired name in a comment alone",
    `// rememberMenuCandidates used to keep the tree; see menuSkeleton.\nexport const x = 1;`,
  );
  webFile.valid(
    "leaves a longer name that only begins with a retired one alone",
    `export const useZeropsMenuPreviewWidth = 1;`,
  );
  for (const filename of [
    "apps/web/src/zerops/useFixtureMenu.test.ts",
    "apps/web/src/zerops/__fixtures__/menu.ts",
    "packages/client-runtime/src/zerops/testing/menu.ts",
    "apps/server/src/zerops/menu.ts",
  ]) {
    createOxlintRuleHarness(RULE, { filename }).valid(`does not guard ${filename}`, KEEP);
  }
});
