import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  formatFindingMessage,
  type ExceptionEntry,
} from "@t3tools/oxlint-plugin-t3code/exceptions";

import {
  checkGuardExceptions,
  type GuardLintOutput,
  type GuardLintRequest,
} from "./check-guard-exceptions.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const RULE_NAME = "fixture-rule";

const entry = (path: string): ExceptionEntry => ({
  path,
  kind: "Literal",
  fingerprint: `source:${path}`,
  owner: "design-systems",
  reason: "Fixture exception",
  expires: "F3",
});

const diagnostic = (options: {
  readonly path: string;
  readonly fingerprint: string;
  readonly ledgered: boolean;
  readonly code?: string;
}) => ({
  message: formatFindingMessage({
    ruleName: RULE_NAME,
    summary: "Fixture guard finding.",
    kind: "Literal",
    fingerprint: options.fingerprint,
    ledgered: options.ledgered,
  }),
  code: options.code ?? `t3code(${RULE_NAME})`,
  severity: "error",
  filename: options.path,
  labels: [],
});

const writeFixtureLedger = Effect.fn("test.writeGuardLedger")(function* (
  directory: string,
  entries: ReadonlyArray<ExceptionEntry>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(
    path.join(directory, `${RULE_NAME}.json`),
    `${encodeUnknownJson(entries)}\n`,
  );
});

const fakeLint =
  (
    diagnostics: ReadonlyArray<ReturnType<typeof diagnostic>>,
    inspect?: (request: GuardLintRequest) => void,
  ) =>
  (request: GuardLintRequest): Effect.Effect<GuardLintOutput> => {
    inspect?.(request);
    return Effect.succeed({
      exitCode: diagnostics.length > 0 ? 1 : 0,
      stdout: encodeUnknownJson({ diagnostics }),
      stderr: "",
    });
  };

it.layer(NodeServices.layer)("guard exception driver", (it) => {
  it.effect("reports one unlisted finding and one dead entry with a non-zero result", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-driver-" });
        const entries = [
          entry("apps/web/src/one.ts"),
          entry("apps/web/src/two.ts"),
          entry("apps/web/src/dead.ts"),
        ];
        yield* writeFixtureLedger(directory, entries);
        let invocationCount = 0;

        const result = yield* checkGuardExceptions({
          cwd: "/repo",
          directory,
          ruleNames: [RULE_NAME],
          runLint: fakeLint(
            [
              diagnostic({
                path: entries[0]!.path,
                fingerprint: entries[0]!.fingerprint,
                ledgered: true,
              }),
              diagnostic({
                path: entries[1]!.path,
                fingerprint: entries[1]!.fingerprint,
                ledgered: true,
              }),
              diagnostic({
                path: "apps/web/src/new.ts",
                fingerprint: "source:new",
                ledgered: false,
              }),
            ],
            (request) => {
              invocationCount += 1;
              assert.equal(request.cwd, "/repo");
              assert.deepStrictEqual(request.args, [
                "lint",
                "-f",
                "json",
                "-A",
                "all",
                "-D",
                `t3code/${RULE_NAME}`,
                "apps/web/src",
                "apps/mobile/src",
                "apps/desktop/src",
                "packages/shared/src",
                "packages/client-runtime/src",
              ]);
              assert.deepStrictEqual(request.env, { T3CODE_GUARD_REPORT_LEDGERED: "1" });
            },
          ),
        });

        assert.equal(invocationCount, 1);
        assert.equal(result.exitCode, 1);
        assert.equal(result.problemCount, 2);
        assert.match(result.reports.join("\n"), /unlisted apps\/web\/src\/new\.ts:Literal/u);
        assert.match(
          result.reports.join("\n"),
          /dead\.ts:Literal.*entry no longer matches anything.*delete it/u,
        );
      }),
    ),
  );

  it.effect("exits zero when every ledger entry has a ledgered hit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-driver-" });
        const entries = [entry("apps/web/src/one.ts"), entry("apps/web/src/two.ts")];
        yield* writeFixtureLedger(directory, entries);

        const result = yield* checkGuardExceptions({
          cwd: "/repo",
          directory,
          ruleNames: [RULE_NAME],
          runLint: fakeLint(
            entries.map((ledgerEntry) =>
              diagnostic({
                path: ledgerEntry.path,
                fingerprint: ledgerEntry.fingerprint,
                ledgered: true,
              }),
            ),
          ),
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.problemCount, 0);
        assert.deepStrictEqual(result.reports, [`${RULE_NAME}: ledger reconciled (2 entries)`]);
      }),
    ),
  );

  it.effect("ignores diagnostics emitted by a foreign rule", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-driver-" });

        const result = yield* checkGuardExceptions({
          cwd: "/repo",
          directory,
          ruleNames: [RULE_NAME],
          runLint: fakeLint([
            diagnostic({
              path: "apps/web/src/foreign.ts",
              fingerprint: "foreign",
              ledgered: false,
              code: "t3code(foreign-rule)",
            }),
          ]),
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.problemCount, 0);
        assert.deepStrictEqual(result.reports, [`${RULE_NAME}: ledger reconciled (0 entries)`]);
      }),
    ),
  );

  it.effect("returns malformed finding markers on the Effect error channel", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-driver-" });

        const error = yield* checkGuardExceptions({
          cwd: "/repo",
          directory,
          ruleNames: [RULE_NAME],
          runLint: () =>
            Effect.succeed({
              exitCode: 1,
              stdout: encodeUnknownJson({
                diagnostics: [
                  {
                    message: "Fixture guard finding without the machine marker.",
                    code: `t3code(${RULE_NAME})`,
                    filename: "apps/web/src/malformed.ts",
                  },
                ],
              }),
              stderr: "",
            }),
        }).pipe(Effect.flip);

        assert.equal(error._tag, "GuardExceptionDriverError");
        assert.match(error.message, /malformed\.ts is missing a valid finding marker/u);
      }),
    ),
  );
});
