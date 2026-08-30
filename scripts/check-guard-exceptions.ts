#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- This host CLI discovers ledgers before Effect runs.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  formatReconcileReport,
  loadCompletedPhases,
  loadExceptionLedger,
  parseFindingMessage,
  reconcileExceptions,
  type ExceptionFinding,
} from "@t3tools/oxlint-plugin-t3code/exceptions";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

/** The reviewed client source roots scanned by every oxlint-side design-system guard. */
export const GUARD_SCOPE_PATHS = [
  "apps/web/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/shared/src",
  "packages/client-runtime/src",
] as const;

const DEFAULT_REPO_ROOT = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);

const OxlintOutputSchema = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      message: Schema.String,
      code: Schema.optional(Schema.String),
      filename: Schema.String,
    }),
  ),
});
const decodeOxlintOutput = Schema.decodeUnknownSync(Schema.fromJsonString(OxlintOutputSchema));

/** Everything the injectable lint runner needs to execute one isolated rule scan. */
export interface GuardLintRequest {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

/** Captured process output returned by real and fixture lint runners. */
export interface GuardLintOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The reports and process status produced after all requested ledgers are reconciled. */
export interface GuardExceptionCheckResult {
  readonly reports: ReadonlyArray<string>;
  readonly problemCount: number;
  readonly exitCode: 0 | 1;
}

interface GuardExceptionCheckOptions<E, R> {
  readonly cwd: string;
  readonly directory: string;
  readonly ruleNames?: ReadonlyArray<string>;
  readonly runLint: (request: GuardLintRequest) => Effect.Effect<GuardLintOutput, E, R>;
}

class GuardExceptionDriverError extends Data.TaggedClass("GuardExceptionDriverError")<{
  readonly ruleName: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  readonly name = "GuardExceptionDriverError";

  get message(): string {
    return `${this.ruleName}: ${this.detail}`;
  }
}

const tryDriverOperation = <A>(
  ruleName: string,
  detail: string,
  operation: () => A,
): Effect.Effect<A, GuardExceptionDriverError> =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof GuardExceptionDriverError
        ? cause
        : new GuardExceptionDriverError({ ruleName, detail, cause }),
  });

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const spawnGuardLint = Effect.fn("spawnGuardLint")(function* (request: GuardLintRequest) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make("vp", request.args, {
      cwd: request.cwd,
      env: request.env,
      extendEnv: true,
    }),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout),
      collectStreamAsString(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  );
  return { stdout, stderr, exitCode };
}, Effect.scoped);

const discoverRuleNames = (directory: string): ReadonlyArray<string> => {
  if (!NodeFS.existsSync(directory)) return [];
  return NodeFS.readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "phases.json",
    )
    .map((entry) => entry.name.slice(0, -".json".length))
    .toSorted();
};

const makeLintRequest = (cwd: string, ruleName: string): GuardLintRequest => ({
  cwd,
  args: ["lint", "-f", "json", "-A", "all", "-D", `t3code/${ruleName}`, ...GUARD_SCOPE_PATHS],
  env: { T3CODE_GUARD_REPORT_LEDGERED: "1" },
});

const toRepoPath = (cwd: string, filename: string): string =>
  (NodePath.isAbsolute(filename) ? NodePath.relative(cwd, filename) : filename).replaceAll(
    "\\",
    "/",
  );

const parseFindings = (
  ruleName: string,
  cwd: string,
  output: GuardLintOutput,
): ReadonlyArray<ExceptionFinding> => {
  let diagnostics: (typeof OxlintOutputSchema.Type)["diagnostics"];
  try {
    diagnostics = decodeOxlintOutput(output.stdout).diagnostics;
  } catch (cause) {
    const stderr = output.stderr.trim();
    throw new GuardExceptionDriverError({
      ruleName,
      detail: `oxlint exited ${output.exitCode} with invalid JSON${stderr.length > 0 ? `: ${stderr}` : ""}`,
      cause,
    });
  }

  return diagnostics
    .filter((diagnostic) => diagnostic.code === `t3code(${ruleName})`)
    .map((diagnostic) => {
      const parsed = parseFindingMessage(diagnostic.message);
      if (parsed === undefined || parsed.ruleName !== ruleName) {
        throw new GuardExceptionDriverError({
          ruleName,
          detail: `diagnostic for ${diagnostic.filename} is missing a valid finding marker`,
        });
      }
      return {
        path: toRepoPath(cwd, diagnostic.filename),
        kind: parsed.kind,
        fingerprint: parsed.fingerprint,
      };
    });
};

/** Runs isolated oxlint scans and reconciles their AST findings against the selected ledgers. */
export const checkGuardExceptions = <E, R>(options: GuardExceptionCheckOptions<E, R>) =>
  Effect.gen(function* () {
    const ruleNames = [
      ...new Set(options.ruleNames ?? discoverRuleNames(options.directory)),
    ].toSorted();
    if (ruleNames.length === 0) {
      return {
        reports: ["guard exceptions: nothing to reconcile"],
        problemCount: 0,
        exitCode: 0,
      } satisfies GuardExceptionCheckResult;
    }

    const completedPhases = yield* tryDriverOperation(
      "guard exceptions",
      "failed to load completed phases",
      () => loadCompletedPhases(options.directory),
    );
    const reports: Array<string> = [];
    let problemCount = 0;

    for (const ruleName of ruleNames) {
      const ledger = yield* tryDriverOperation(ruleName, "failed to load exception ledger", () =>
        loadExceptionLedger(ruleName, options.directory),
      );
      const output = yield* options.runLint(makeLintRequest(options.cwd, ruleName));
      const findings = yield* tryDriverOperation(ruleName, "failed to parse oxlint findings", () =>
        parseFindings(ruleName, options.cwd, output),
      );
      const result = reconcileExceptions({
        entries: ledger.entries,
        findings,
        completedPhases,
        scope: "ast",
      });
      problemCount +=
        result.unlisted.length + result.dead.length + result.changed.length + result.expired.length;
      reports.push(formatReconcileReport({ ruleName, result }));
    }

    return {
      reports,
      problemCount,
      exitCode: problemCount > 0 ? 1 : 0,
    } satisfies GuardExceptionCheckResult;
  });

export const checkGuardExceptionsCommand = Command.make(
  "check-guard-exceptions",
  {
    rule: Flag.string("rule").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "Rule ledger to reconcile. Repeat for multiple rules; defaults to every rule ledger.",
      ),
    ),
  },
  ({ rule }) =>
    Effect.gen(function* () {
      const directory = NodePath.join(DEFAULT_REPO_ROOT, "oxlint-plugin-t3code", "exceptions");
      const result = yield* checkGuardExceptions({
        cwd: DEFAULT_REPO_ROOT,
        directory,
        ...(rule.length > 0 ? { ruleNames: rule } : {}),
        runLint: spawnGuardLint,
      });
      for (const report of result.reports) {
        yield* Console.log(report);
      }
      if (result.exitCode !== 0) {
        yield* Effect.sync(() => {
          process.exitCode = result.exitCode;
        });
      }
    }),
).pipe(
  Command.withDescription(
    "Reconcile design-system guard diagnostics with their fingerprint exception ledgers.",
  ),
);

if (import.meta.main) {
  Command.run(checkGuardExceptionsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
