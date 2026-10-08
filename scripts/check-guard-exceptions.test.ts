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
  readonly code?: string;
}) => ({
  message: formatFindingMessage({
    ruleName: RULE_NAME,
    summary: "Fixture guard finding.",
    kind: "Literal",
    fingerprint: options.fingerprint,
    ledgered: true,
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

const cacheFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "guard-cache-" });
  const directory = `${cwd}/ledgers`;
  const cacheDirectory = `${cwd}/cache`;
  yield* fs.makeDirectory(`${cwd}/apps/web/src`, { recursive: true });
  yield* fs.makeDirectory(directory);
  yield* fs.writeFileString(`${cwd}/package.json`, '{"name":"fixture"}');
  yield* fs.writeFileString(`${cwd}/rules.ts`, 'import "./helper.ts";');
  yield* fs.writeFileString(`${cwd}/helper.ts`, "export const helper = 1;");
  yield* writeFixtureLedger(directory, [
    entry("apps/web/src/one.ts"),
    entry("apps/web/src/dead.ts"),
  ]);
  const state = {
    files: ["apps/web/src/one.ts", "apps/web/src/empty.ts"],
    scans: [] as Array<ReadonlyArray<string>>,
    version: "Version: fixture-1",
    config: '{"jsPlugins":["./rules.ts"]}',
  };
  yield* fs.writeFileString(`${cwd}/${state.files[0]}`, "const forbidden = 1;");
  yield* fs.writeFileString(`${cwd}/${state.files[1]}`, "const allowed = 1;");
  const runLint = (request: GuardLintRequest) =>
    Effect.gen(function* () {
      let stdout: string;
      if (request.args.includes("--version")) stdout = state.version;
      else if (request.args.includes("--print-config")) stdout = state.config;
      else if (request.args.includes("--debug=files")) stdout = state.files.join("\n");
      else {
        const files = request.args.includes("apps/web/src")
          ? state.files
          : request.args.filter((arg) => state.files.includes(arg));
        state.scans.push(files);
        const diagnostics: Array<ReturnType<typeof diagnostic>> = [];
        for (const path of files) {
          const text = yield* fs.readFileString(`${cwd}/${path}`);
          const imported = text.includes('import "./empty.ts"')
            ? yield* fs.readFileString(`${cwd}/apps/web/src/empty.ts`)
            : "";
          if (text.includes("forbidden") || imported.includes("forbidden"))
            diagnostics.push(diagnostic({ path, fingerprint: `source:${path}` }));
        }
        yield* Effect.yieldNow;
        stdout = encodeUnknownJson({ diagnostics });
      }
      return { stdout, stderr: "", exitCode: 0 };
    });
  const options = { cwd, directory, ruleNames: [RULE_NAME], runLint };
  return { fs, state, options, cacheDirectory, cached: { ...options, cacheDirectory } };
});

it.layer(NodeServices.layer)("guard exception driver", (it) => {
  it.effect(
    "Decision: no check weakened or skipped; results must equal the uncached run (add a test comparing cached vs uncached output on a fixture).",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* cacheFixture;
          const uncached = yield* checkGuardExceptions(fixture.options);
          const cold = yield* checkGuardExceptions(fixture.cached);
          const warm = yield* checkGuardExceptions(fixture.cached);
          assert.deepStrictEqual(cold, uncached);
          assert.deepStrictEqual(warm, uncached);
          assert.equal(warm.problemCount, 1);
          assert.equal(warm.exitCode, 1);
          assert.match(warm.reports[0]!, /dead\.ts/u);
          assert.equal(fixture.state.scans.length, 2);
          // Empty files are cached too. Ledger edits still change the warm verdict immediately.
          yield* writeFixtureLedger(fixture.options.directory, [entry("apps/web/src/one.ts")]);
          const reconciled = yield* checkGuardExceptions(fixture.cached);
          assert.equal(reconciled.exitCode, 0);
          assert.equal(reconciled.problemCount, 0);
          assert.equal(fixture.state.scans.length, 2);
        }),
      ),
  );

  it.effect(
    "rescans changed and renamed files while deletion still makes ledger entries dead",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* cacheFixture;
          yield* checkGuardExceptions(fixture.cached);
          yield* fixture.fs.writeFileString(
            `${fixture.options.cwd}/apps/web/src/empty.ts`,
            "const forbidden = 1;",
          );
          const changed = yield* checkGuardExceptions(fixture.cached);
          assert.deepStrictEqual(fixture.state.scans.at(-1), ["apps/web/src/empty.ts"]);
          assert.equal(changed.problemCount, 2);
          assert.deepStrictEqual(changed, yield* checkGuardExceptions(fixture.options));
          yield* fixture.fs.rename(
            `${fixture.options.cwd}/apps/web/src/one.ts`,
            `${fixture.options.cwd}/apps/web/src/renamed.ts`,
          );
          fixture.state.files[0] = "apps/web/src/renamed.ts";
          const renamed = yield* checkGuardExceptions(fixture.cached);
          assert.deepStrictEqual(fixture.state.scans.at(-1), ["apps/web/src/renamed.ts"]);
          assert.deepStrictEqual(renamed, yield* checkGuardExceptions(fixture.options));
          assert.equal(renamed.problemCount, 4);
          yield* fixture.fs.remove(`${fixture.options.cwd}/apps/web/src/empty.ts`);
          fixture.state.files.pop();
          const before = fixture.state.scans.length;
          const deleted = yield* checkGuardExceptions(fixture.cached);
          assert.equal(fixture.state.scans.length, before);
          assert.equal(deleted.problemCount, 3);
          assert.deepStrictEqual(deleted, yield* checkGuardExceptions(fixture.options));
        }),
      ),
  );

  it.effect(
    "refreshes an unchanged consumer when an imported wrapper changes its guard verdict",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* cacheFixture;
          yield* fixture.fs.writeFileString(
            `${fixture.options.cwd}/apps/web/src/one.ts`,
            'import "./empty.ts";',
          );
          yield* fixture.fs.writeFileString(
            `${fixture.options.cwd}/apps/web/src/empty.ts`,
            'import "./one.ts"; const allowed = 1;',
          );
          const before = yield* checkGuardExceptions(fixture.cached);
          assert.equal(before.problemCount, 2);
          yield* fixture.fs.writeFileString(
            `${fixture.options.cwd}/apps/web/src/empty.ts`,
            'import "./one.ts"; const forbidden = 1;',
          );
          const after = yield* checkGuardExceptions(fixture.cached);
          assert.deepStrictEqual(fixture.state.scans.at(-1), fixture.state.files);
          assert.equal(after.problemCount, 2);
          assert.match(after.reports[0]!, /unlisted apps\/web\/src\/empty\.ts/u);
          assert.notMatch(after.reports[0]!, /one\.ts:Literal.*entry no longer matches/u);
          assert.deepStrictEqual(after, yield* checkGuardExceptions(fixture.options));
        }),
      ),
  );

  it.effect(
    "invalidates cached findings when the configuration, imported rule helper or oxlint version changes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* cacheFixture;
          yield* checkGuardExceptions(fixture.cached);
          fixture.state.config = '{"jsPlugins":["./rules.ts"],"ignorePatterns":["**/ignored.ts"]}';
          yield* checkGuardExceptions(fixture.cached);
          yield* fixture.fs.writeFileString(
            `${fixture.options.cwd}/helper.ts`,
            "export const helper = 2;",
          );
          yield* checkGuardExceptions(fixture.cached);
          fixture.state.version = "Version: fixture-2";
          const result = yield* checkGuardExceptions(fixture.cached);
          assert.equal(fixture.state.scans.length, 4);
          assert.deepStrictEqual(result, yield* checkGuardExceptions(fixture.options));
        }),
      ),
  );

  it.effect(
    "invalidates findings when an external rule dependency or an implicit UI input changes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* cacheFixture;
          const cwd = fixture.options.cwd;
          yield* fixture.fs.makeDirectory(`${cwd}/node_modules/external-rule`, { recursive: true });
          yield* fixture.fs.makeDirectory(`${cwd}/node_modules/inner-rule`, { recursive: true });
          yield* fixture.fs.writeFileString(
            `${cwd}/node_modules/external-rule/package.json`,
            '{"name":"external-rule","exports":"./index.js","dependencies":{"inner-rule":"1"}}',
          );
          yield* fixture.fs.writeFileString(
            `${cwd}/node_modules/external-rule/index.js`,
            'import "inner-rule";',
          );
          yield* fixture.fs.writeFileString(
            `${cwd}/node_modules/inner-rule/package.json`,
            '{"name":"inner-rule"}',
          );
          yield* fixture.fs.writeFileString(
            `${cwd}/node_modules/inner-rule/index.js`,
            "export const rule = 1;",
          );
          yield* fixture.fs.writeFileString(`${cwd}/rules.ts`, 'import "external-rule";');
          yield* fixture.fs.makeDirectory(`${cwd}/apps/web/src/components/ui`, { recursive: true });
          yield* fixture.fs.writeFileString(
            `${cwd}/apps/web/src/components/ui/implicit.ts`,
            "export const Button = 1;",
          );
          yield* checkGuardExceptions(fixture.cached);
          yield* checkGuardExceptions(fixture.cached);
          assert.equal(fixture.state.scans.length, 1);
          yield* fixture.fs.writeFileString(
            `${cwd}/node_modules/inner-rule/index.js`,
            "export const rule = 2;",
          );
          yield* checkGuardExceptions(fixture.cached);
          assert.equal(fixture.state.scans.length, 2);
          yield* fixture.fs.writeFileString(
            `${cwd}/apps/web/src/components/ui/implicit.ts`,
            "export const Button = 2;",
          );
          const result = yield* checkGuardExceptions(fixture.cached);
          assert.equal(fixture.state.scans.length, 3);
          assert.deepStrictEqual(result, yield* checkGuardExceptions(fixture.options));
        }),
      ),
  );

  it.effect("refuses to publish findings when a rule dependency changes during the scan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* cacheFixture;
        const runLint = (request: GuardLintRequest) =>
          Effect.gen(function* () {
            const output = yield* fixture.options.runLint(request);
            if (!request.args.some((arg) => arg.startsWith("--"))) {
              yield* fixture.fs.writeFileString(
                `${fixture.options.cwd}/helper.ts`,
                "export const helper = 2;",
              );
            }
            return output;
          });
        const error = yield* checkGuardExceptions({ ...fixture.cached, runLint }).pipe(Effect.flip);
        assert.equal(error._tag, "GuardExceptionDriverError");
        assert.match(error.message, /lint inputs changed during guard scan/u);
        assert.equal(yield* fixture.fs.exists(fixture.cacheDirectory), false);
        const result = yield* checkGuardExceptions(fixture.cached);
        assert.deepStrictEqual(result, yield* checkGuardExceptions(fixture.options));
      }),
    ),
  );

  it.effect("reuses findings across worktrees and invalidates the selected rule set", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* cacheFixture;
        const second = yield* cacheFixture;
        const expected = yield* checkGuardExceptions(first.cached);
        const reused = yield* checkGuardExceptions({
          ...second.cached,
          cacheDirectory: first.cacheDirectory,
        });
        assert.deepStrictEqual(reused, expected);
        assert.equal(second.state.scans.length, 0);
        const rules = [RULE_NAME, "second-rule"];
        const expanded = yield* checkGuardExceptions({
          ...second.cached,
          cacheDirectory: first.cacheDirectory,
          ruleNames: rules,
        });
        assert.equal(second.state.scans.length, 1);
        assert.deepStrictEqual(
          expanded,
          yield* checkGuardExceptions({ ...second.options, ruleNames: rules }),
        );
      }),
    ),
  );

  it.effect("does not cache malformed guard diagnostics as a clean file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* cacheFixture;
        const runLint = (request: GuardLintRequest) =>
          request.args.includes("-D")
            ? Effect.succeed({
                exitCode: 1,
                stdout: encodeUnknownJson({
                  diagnostics: [
                    {
                      ...diagnostic({ path: "apps/web/src/one.ts", fingerprint: "invalid" }),
                      message: "missing marker",
                    },
                  ],
                }),
                stderr: "",
              })
            : fixture.options.runLint(request);
        const cached = yield* checkGuardExceptions({ ...fixture.cached, runLint }).pipe(
          Effect.flip,
        );
        const uncached = yield* checkGuardExceptions({ ...fixture.options, runLint }).pipe(
          Effect.flip,
        );
        assert.equal(cached._tag, "GuardExceptionDriverError");
        assert.equal(cached.message, uncached.message);
        assert.match(cached.message, /missing a valid finding marker/u);
        assert.equal(yield* fixture.fs.exists(fixture.cacheDirectory), false);
      }),
    ),
  );

  it.effect(
    "rescans damaged cache records and concurrent publication preserves the uncached verdict",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* cacheFixture;
          const [first, second] = yield* Effect.all(
            [checkGuardExceptions(fixture.cached), checkGuardExceptions(fixture.cached)],
            { concurrency: "unbounded" },
          );
          assert.deepStrictEqual(first, second);
          const records = yield* fixture.fs.readDirectory(fixture.cacheDirectory);
          assert.equal(records.length, 2);
          assert.ok(records.every((name) => name.endsWith(".json")));
          for (const record of records) {
            const text = yield* fixture.fs.readFileString(`${fixture.cacheDirectory}/${record}`);
            yield* fixture.fs.writeFileString(
              `${fixture.cacheDirectory}/${record}`,
              text.replace("source:apps/web/src/one.ts", "corrupted-fingerprint"),
            );
          }
          const repaired = yield* checkGuardExceptions(fixture.cached);
          assert.deepStrictEqual(repaired, first);
          assert.deepStrictEqual(fixture.state.scans.at(-1), ["apps/web/src/one.ts"]);
          for (const record of records)
            yield* fixture.fs.writeFileString(`${fixture.cacheDirectory}/${record}`, "{broken");
          const result = yield* checkGuardExceptions(fixture.cached);
          assert.equal(fixture.state.scans.length, 4);
          assert.deepStrictEqual(result, yield* checkGuardExceptions(fixture.options));
        }),
      ),
  );

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
              }),
              diagnostic({
                path: entries[1]!.path,
                fingerprint: entries[1]!.fingerprint,
              }),
              diagnostic({
                path: "apps/web/src/new.ts",
                fingerprint: "source:new",
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
                "apps/hq/src",
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

  it.effect("reconciles several rule ledgers from one scan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-batch-" });
        yield* writeFixtureLedger(directory, [entry("apps/web/src/dead.ts")]);
        yield* fs.writeFileString(`${directory}/second-rule.json`, "[]");
        let calls = 0;
        const result = yield* checkGuardExceptions({
          cwd: "/repo",
          directory,
          runLint: fakeLint([], (request) => {
            calls++;
            assert.ok(request.args.includes("t3code/second-rule"));
            assert.ok(request.args.includes(`t3code/${RULE_NAME}`));
          }),
        });
        assert.equal(calls, 1);
        assert.equal(result.exitCode, 1);
        assert.equal(result.reports.length, 2);
        assert.match(result.reports.join("\n"), /dead\.ts/u);
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
