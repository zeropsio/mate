import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeModule from "node:module";

import {
  formatFindingMessage,
  type ExceptionEntry,
} from "@t3tools/oxlint-plugin-t3code/exceptions";

import {
  checkGuardExceptions,
  GUARD_SCOPE_PATHS,
  loadRatchetBaseline,
  ratchetAdditions,
  RATCHET_RULES,
  type GuardLintOutput,
  type GuardLintRequest,
} from "./check-guard-exceptions.ts";

import { githubRatchetRevision } from "./lib/github-ratchet.ts";

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
  it.effect.each([
    {
      title: "reports restyling through the TypeScript wrapper when a JSX sibling is also present",
      specifier: "./wrapper",
      imports: {},
    },
    {
      title: "reports restyling through a wrapper resolved by package imports",
      specifier: "#wrapper",
      imports: { "#wrapper": "./src/wrapper.ts" },
    },
    {
      title: "reports restyling through a wrapper resolved by conditional wildcard package imports",
      specifier: "#fixture/wrapper",
      imports: {
        "#fixture/*": { import: "./src/*.ts", default: "./src/wrapper.jsx" },
      },
    },
    {
      title: "reports restyling through a wrapper resolved by package self-imports",
      specifier: "web/wrapper",
      imports: {},
      exports: { "./wrapper": "./src/wrapper.ts" },
    },
  ])(
    "$title",
    (scenario) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "guard-restyle-cache-" });
          const directory = path.join(cwd, "ledgers");
          const cacheDirectory = path.join(cwd, "cache");
          for (const root of [...GUARD_SCOPE_PATHS, "apps/web/src/components/ui", "ledgers"])
            yield* fs.makeDirectory(path.join(cwd, root), { recursive: true });
          yield* fs.writeFileString(path.join(cwd, "package.json"), '{"name":"fixture"}');
          yield* fs.writeFileString(
            path.join(cwd, "apps/web/package.json"),
            encodeUnknownJson({
              name: "web",
              imports: scenario.imports,
              exports: scenario.exports,
            }),
          );
          yield* fs.writeFileString(path.join(directory, "no-restyle.json"), "[]");
          const config = path.join(cwd, ".oxlintrc.json");
          yield* fs.writeFileString(
            config,
            encodeUnknownJson({
              jsPlugins: [path.join(import.meta.dirname, "../oxlint-plugin-t3code/index.ts")],
              rules: { "t3code/no-restyle": "error" },
            }),
          );
          yield* fs.writeFileString(
            path.join(cwd, "apps/web/src/components/ui/button.tsx"),
            "export const Button = () => <button />;",
          );
          const wrapper = path.join(cwd, "apps/web/src/wrapper.ts");
          const plainWrapper = "export const Alias = () => null;";
          yield* fs.writeFileString(wrapper, plainWrapper);
          yield* fs.writeFileString(path.join(cwd, "apps/web/src/wrapper.jsx"), plainWrapper);
          yield* fs.writeFileString(
            path.join(cwd, "apps/web/src/consumer.tsx"),
            `import { Alias } from "${scenario.specifier}"; export const view = <Alias className="bg-red-500" />;`,
          );
          const oxlintPackage = NodeModule.createRequire(
            NodeModule.createRequire(import.meta.url).resolve("vite-plus/package.json"),
          ).resolve("oxlint/package.json");
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const runLint = (request: GuardLintRequest) =>
            Effect.scoped(
              Effect.gen(function* () {
                const child = yield* spawner.spawn(
                  ChildProcess.make(
                    process.execPath,
                    [
                      path.join(path.dirname(oxlintPackage), "bin/oxlint"),
                      "--config",
                      config,
                      ...request.args.slice(1),
                    ],
                    {
                      cwd: request.cwd,
                      env: { ...request.env, T3CODE_NO_RESTYLE_LEDGER_DIRECTORY: directory },
                      extendEnv: true,
                    },
                  ),
                );
                const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
                  stream.pipe(
                    Stream.decodeText(),
                    Stream.runCollect,
                    Effect.map((parts) => parts.join("")),
                  );
                const [stdout, stderr, exitCode] = yield* Effect.all(
                  [
                    collect(child.stdout),
                    collect(child.stderr),
                    child.exitCode.pipe(Effect.map(Number)),
                  ],
                  { concurrency: "unbounded" },
                );
                return { stdout, stderr, exitCode };
              }),
            );
          const options = { cwd, directory, ruleNames: ["no-restyle"], runLint };
          const cached = { ...options, cacheDirectory };
          const initial = yield* checkGuardExceptions(cached);
          assert.equal(initial.problemCount, 0);
          assert.equal(initial.exitCode, 0);
          assert.deepStrictEqual(yield* checkGuardExceptions(cached), initial);
          yield* fs.writeFileString(
            wrapper,
            'export { Button as Alias } from "./components/ui/button";',
          );
          const uncached = yield* checkGuardExceptions(options);
          assert.equal(uncached.problemCount, 1);
          assert.equal(uncached.exitCode, 1);
          assert.match(uncached.reports[0]!, /consumer\.tsx/u);
          const warm = yield* checkGuardExceptions(cached);
          assert.equal(warm.problemCount, 1);
          assert.equal(warm.exitCode, 1);
          assert.deepStrictEqual(warm, uncached);
        }),
      ),
    { timeout: 60_000 },
  );

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

it.layer(NodeServices.layer)("environment identity ratchet", (it) => {
  it.effect("The environment identity guard starts with no exceptions and cannot gain one.", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "environment-guard-baseline-" });
        const directory = `${cwd}/oxlint-plugin-t3code/exceptions`;
        const rule = "no-environment-as-project";
        const git = (...args: string[]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
              const child = yield* spawner.spawn(ChildProcess.make("git", args, { cwd }));
              const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
                stream.pipe(
                  Stream.decodeText(),
                  Stream.runCollect,
                  Effect.map((parts) => parts.join("")),
                );
              const [stdout, stderr, exitCode] = yield* Effect.all(
                [collect(child.stdout), collect(child.stderr), child.exitCode],
                { concurrency: "unbounded" },
              );
              assert.equal(Number(exitCode), 0, stderr);
              return stdout.trim();
            }),
          );
        yield* fs.makeDirectory(directory, { recursive: true });
        // Model the last consumer's main commit, before this rule or ledger exists.
        for (const name of RATCHET_RULES.filter((name) => name !== rule))
          yield* fs.writeFileString(`${directory}/${name}.json`, "[]");
        yield* git("init", "-q");
        yield* git("add", ".");
        yield* git(
          "-c",
          "user.name=Guard Test",
          "-c",
          "user.email=guard@example.invalid",
          "commit",
          "-qm",
          "pre-guard main",
        );
        const main = yield* git("rev-parse", "HEAD");
        yield* fs.writeFileString(`${directory}/${rule}.json`, "[]");
        const baseline = loadRatchetBaseline(cwd, main);
        assert.deepStrictEqual(baseline.get(rule), []);
        const hit = {
          ...entry("apps/web/src/deploys.ts"),
          kind: "sql-project-identity-read",
          fingerprint: "SELECT project_id FROM hq_deploy_job",
          expires: "never",
        };
        assert.deepStrictEqual(ratchetAdditions([], baseline.get(rule)!), []);
        assert.equal(ratchetAdditions([hit], baseline.get(rule)!).length, 1);
        assert.equal(ratchetAdditions([hit, hit], [hit]).length, 1);
        assert.equal(
          ratchetAdditions(
            [{ ...hit, fingerprint: "SELECT j.project_id FROM hq_deploy_job j" }],
            [hit],
          ).length,
          1,
        );
        for (const scenario of [
          { entries: [], previous: [], additions: 0 },
          { entries: [hit], previous: [], additions: 1 },
          { entries: [hit, hit], previous: [hit], additions: 1 },
          {
            entries: [{ ...hit, fingerprint: "SELECT j.project_id FROM hq_deploy_job j" }],
            previous: [hit],
            additions: 1,
          },
        ]) {
          yield* fs.writeFileString(
            `${directory}/${rule}.json`,
            encodeUnknownJson(scenario.entries),
          );
          const result = yield* checkGuardExceptions({
            cwd,
            directory,
            ruleNames: [rule],
            baseline: new Map([[rule, scenario.previous]]),
            runLint: () =>
              Effect.succeed({
                exitCode: scenario.entries.length === 0 ? 0 : 1,
                stderr: "",
                stdout: encodeUnknownJson({
                  diagnostics: scenario.entries.map((finding) => ({
                    ...diagnostic({ path: finding.path, fingerprint: finding.fingerprint }),
                    code: `t3code(${rule})`,
                    message: formatFindingMessage({
                      ruleName: rule,
                      kind: finding.kind,
                      fingerprint: finding.fingerprint,
                      ledgered: true,
                      summary: "Environment identity fixture.",
                    }),
                  })),
                }),
              }),
          });
          assert.equal(result.problemCount, scenario.additions);
          assert.equal(result.exitCode, scenario.additions === 0 ? 0 : 1);
        }
        assert.throws(() => loadRatchetBaseline(cwd, "missing-revision"));
        // Other missing ledgers and unreadable objects remain errors, not empty baselines.
        yield* git("rm", "-q", `${directory}/no-retired-mechanism.json`);
        yield* git(
          "-c",
          "user.name=Guard Test",
          "-c",
          "user.email=guard@example.invalid",
          "commit",
          "-qm",
          "missing existing ledger",
        );
        assert.throws(() => loadRatchetBaseline(cwd, "HEAD"), /no-retired-mechanism/);
      }),
    ),
  );
});

describe("githubRatchetRevision", () => {
  it.each([
    {
      run: "a main push",
      event: { before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ref: "refs/heads/main" },
      compares: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      run: "a pull request",
      event: {
        before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        pull_request: { base: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
      },
      compares: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    ...["kh-next", "kh-bisect"].map((branch) => ({
      run: `a new ${branch} verification branch`,
      event: {
        before: "0".repeat(40),
        ref: `refs/heads/${branch}${branch === "kh-next" ? "" : "/candidate"}`,
      },
      compares: "origin/main",
    })),
    {
      run: "a new branch",
      event: { before: "0".repeat(40), ref: "refs/heads/new" },
      compares: "origin/main",
    },
    { run: "a dispatch", event: {}, compares: "origin/main" },
    {
      run: "a workflow call without a previous SHA",
      event: { ref: "refs/tags/v0.15.74" },
      compares: "origin/main",
    },
    {
      run: "a release tag",
      event: { before: "0000000000000000000000000000000000000000", ref: "refs/tags/v0.15.71" },
      compares: "origin/main",
    },
  ])("a GitHub run's ratchet compares with what came before it: $run", ({ event, compares }) => {
    assert.strictEqual(githubRatchetRevision(event, "origin/main"), compares);
  });

  it.effect("refuses a branch push with no previous commit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "ratchet-no-main-" });
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        for (const args of [
          ["init", "-q"],
          [
            "-c",
            "user.name=Ratchet fixture",
            "-c",
            "user.email=ratchet@example.test",
            "commit",
            "--allow-empty",
            "-qm",
            "initial candidate",
          ],
        ]) {
          const child = yield* spawner.spawn(ChildProcess.make("git", args, { cwd }));
          assert.equal(Number(yield* child.exitCode), 0);
        }
        // Falling back to main cannot bless a candidate whose previous main history is unavailable.
        assert.throws(() => loadRatchetBaseline(cwd, "origin/main"), /origin/u);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
