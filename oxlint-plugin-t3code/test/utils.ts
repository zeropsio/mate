import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeModule from "node:module";
import { beforeAll } from "vite-plus/test";

// oxlint is only a transitive dependency (via vite-plus), so its bin placement
// varies by package manager: pnpm hoists it into the virtual store, while
// other layouts expose vite-plus's LSP-only wrapper instead. Resolve the real
// package through vite-plus rather than hardcoding either layout, and do it at
// module scope so a broken install fails once with a resolution error instead
// of as an opaque defect in every test.
const oxlintPackageJsonPath = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("vite-plus/package.json"),
).resolve("oxlint/package.json");

class OxlintFixtureFailure extends Data.TaggedError("OxlintFixtureFailure")<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  static readonly is = (u: unknown): u is OxlintFixtureFailure =>
    Predicate.isTagged(u, "OxlintFixtureFailure");
}

class OxlintFixtureExpectedFailure extends Data.TaggedError("OxlintFixtureExpectedFailure")<{
  readonly ruleName: string;
}> {
  override get message() {
    return `Expected oxlint to report a failure for rule ${this.ruleName}, but it passed.`;
  }
}

const encodeOxlintConfig = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

interface RuleHarness {
  readonly run: (
    source: string,
  ) => Effect.Effect<
    string,
    OxlintFixtureFailure | PlatformError.PlatformError | Schema.SchemaError,
    NodeServices.NodeServices
  >;
  readonly runAndExpectFailure: (
    source: string,
  ) => Effect.Effect<
    string,
    OxlintFixtureExpectedFailure | PlatformError.PlatformError | Schema.SchemaError,
    NodeServices.NodeServices
  >;
  readonly valid: (name: string, source: string) => void;
  readonly invalid: (
    name: string,
    source: string,
    assertion?: (output: string) => void,
    expectedFindingCount?: number,
  ) => void;
}

interface RuleHarnessOptions {
  readonly filename?: string;
}

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const spawnAndCollectOutput = Effect.fnUntraced(function* (command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);

  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout),
      collectStreamAsString(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  );

  return { exitCode, stdout, stderr };
}, Effect.scoped);

interface OxlintFixture {
  readonly source: string;
  readonly filename?: string;
}

const invokeOxlint = Effect.fnUntraced(function* (
  ruleName: string,
  fixtures: ReadonlyArray<OxlintFixture>,
  formatArgs: ReadonlyArray<string> = [],
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixtureDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-oxlint-" });
  const configPath = path.join(fixtureDir, ".oxlintrc.json");
  const repoRoot = path.join(import.meta.dirname, "..", "..");
  const oxlintBin = path.join(path.dirname(oxlintPackageJsonPath), "bin", "oxlint");
  const pluginPath = path.join(repoRoot, "oxlint-plugin-t3code", "index.ts");

  yield* fs.writeFileString(
    configPath,
    yield* encodeOxlintConfig({
      jsPlugins: [{ name: "t3code", specifier: pluginPath }],
      rules: { [ruleName]: "error" },
    }),
  );
  const sourcePaths: Array<string> = [];
  for (const [index, fixture] of fixtures.entries()) {
    const sourcePath = path.join(fixtureDir, String(index), fixture.filename ?? "fixture.ts");
    yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });
    yield* fs.writeFileString(sourcePath, fixture.source);
    sourcePaths.push(sourcePath);
  }

  // Run through the current Node binary: oxlint's bin is an extensionless
  // shebang script, which Windows cannot spawn directly and which would
  // otherwise pick up whatever node is first on PATH.
  const output = yield* spawnAndCollectOutput(
    ChildProcess.make(
      process.execPath,
      [oxlintBin, "--config", configPath, ...formatArgs, ...sourcePaths],
      {
        cwd: repoRoot,
      },
    ),
  );

  return { ...output, sourcePaths, repoRoot };
}, Effect.scoped);

const OxlintDiagnostic = Schema.Struct({
  message: Schema.String,
  code: Schema.optional(Schema.String),
  severity: Schema.String,
  filename: Schema.String,
  labels: Schema.Array(
    Schema.Struct({
      label: Schema.optional(Schema.String),
      span: Schema.Struct({
        offset: Schema.Number,
        length: Schema.Number,
        line: Schema.Number,
        column: Schema.Number,
      }),
    }),
  ),
});
const decodeDiagnostics = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ diagnostics: Schema.Array(OxlintDiagnostic) })),
);

// Keep each configured suffix intact: rules and exception ledgers use it as scope.
export const runOxlintFixtures = Effect.fnUntraced(function* (
  ruleName: string,
  fixtures: ReadonlyArray<OxlintFixture>,
) {
  const path = yield* Path.Path;
  const output = yield* invokeOxlint(ruleName, fixtures, ["--format", "json"]);
  const diagnostics = yield* Effect.sync(() => decodeDiagnostics(output.stdout).diagnostics);
  const perFixture = output.sourcePaths.map(() => [] as Array<typeof OxlintDiagnostic.Type>);
  for (const diagnostic of diagnostics) {
    const index = output.sourcePaths.indexOf(path.resolve(output.repoRoot, diagnostic.filename));
    if (index < 0) throw new Error(`Unexpected oxlint diagnostic filename: ${diagnostic.filename}`);
    perFixture[index]!.push(diagnostic);
  }
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (
    output.stderr.trim() !== "" ||
    output.exitCode !== (hasErrors ? 1 : 0) ||
    diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" && diagnostic.code !== ruleName.replace("/", "(") + ")",
    )
  ) {
    return yield* new OxlintFixtureFailure(output);
  }
  return perFixture;
});

export const createOxlintRuleBatch = (ruleName: string) => {
  const fixtures: Array<OxlintFixture> = [];
  let results: ReadonlyArray<ReadonlyArray<typeof OxlintDiagnostic.Type>>;
  beforeAll(async () => {
    results = await Effect.runPromise(
      runOxlintFixtures(ruleName, fixtures).pipe(Effect.provide(NodeServices.layer)),
    );
  });

  return {
    createHarness(options: RuleHarnessOptions = {}): RuleHarness {
      const harness = createOxlintRuleHarness(ruleName, options);
      const register = (
        name: string,
        source: string,
        invalid: boolean,
        assertion?: (output: string) => void,
        expectedFindingCount?: number,
      ) => {
        const index = fixtures.push({ source, ...options }) - 1;
        it.layer(NodeServices.layer)(name, (it) => {
          it.effect(invalid ? "reports the rule diagnostic" : "passes", () =>
            Effect.sync(() => {
              const diagnostics = results[index]!;
              const findings = diagnostics.filter(
                (diagnostic) => diagnostic.code === ruleName.replace("/", "(") + ")",
              );
              if (invalid) {
                assert.isAbove(findings.length, 0, "Expected the fixture's rule diagnostic");
                if (expectedFindingCount !== undefined) {
                  assert.equal(findings.length, expectedFindingCount);
                }
                assertion?.(
                  findings
                    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
                    .join("\n"),
                );
              } else {
                assert.deepStrictEqual(
                  diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
                  [],
                );
              }
            }),
          );
        });
      };
      return {
        ...harness,
        valid: (name, source) => register(name, source, false),
        invalid: (name, source, assertion, count) => register(name, source, true, assertion, count),
      };
    },
  };
};

export const createOxlintRuleHarness = (
  ruleName: string,
  options: RuleHarnessOptions = {},
): RuleHarness => {
  const [pluginName, shortRuleName] = ruleName.split("/");
  const diagnosticRuleName =
    pluginName && shortRuleName ? `${pluginName}\\(${shortRuleName}\\)` : ruleName;
  const test = it.layer(NodeServices.layer);

  const run: RuleHarness["run"] = Effect.fnUntraced(function* (source: string) {
    const output = yield* invokeOxlint(ruleName, [{ source, ...options }]);
    if (output.exitCode !== 0) {
      return yield* new OxlintFixtureFailure({
        exitCode: output.exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
      });
    }

    return `${output.stdout}${output.stderr}`;
  }, Effect.scoped);

  const runAndExpectFailure: RuleHarness["runAndExpectFailure"] = (source) =>
    run(source).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          OxlintFixtureFailure.is(error)
            ? Effect.succeed(
                `oxlint fixture failed with exit code ${error.exitCode}\n${error.stdout}\n${error.stderr}`,
              )
            : Effect.fail(error),
        onSuccess: () => Effect.fail(new OxlintFixtureExpectedFailure({ ruleName })),
      }),
    );

  return {
    run,
    runAndExpectFailure,
    valid(name, source) {
      test(name, (it) => {
        it.effect("passes", () => run(source));
      });
    },
    invalid(name, source, assertion, expectedFindingCount) {
      test(name, (it) => {
        it.effect("reports the rule diagnostic", () =>
          runAndExpectFailure(source).pipe(
            Effect.tap((output) =>
              Effect.sync(() => {
                assert.match(output, new RegExp(diagnosticRuleName));
                if (expectedFindingCount !== undefined) {
                  assert.equal(
                    output.match(new RegExp(diagnosticRuleName, "g"))?.length ?? 0,
                    expectedFindingCount,
                  );
                }
                assertion?.(output);
              }),
            ),
          ),
        );
      });
    },
  };
};
