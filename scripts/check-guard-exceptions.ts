#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- This host CLI discovers ledgers before Effect runs.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  formatReconcileReport,
  loadCompletedPhases,
  loadExceptionLedger,
  parseFindingMessage,
  normalizeFingerprint,
  type ExceptionEntry,
  reconcileExceptions,
  type ExceptionFinding,
} from "@t3tools/oxlint-plugin-t3code/exceptions";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

import { rewriteImportPaths } from "./effect-401-codemod.ts";

/**
 * The reviewed source roots scanned by every oxlint-side guard: the client sources, and HQ for the
 * guards that reach it (each rule still decides from a file's path whether it applies).
 */
export const GUARD_SCOPE_PATHS = [
  "apps/web/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/shared/src",
  "packages/client-runtime/src",
  "apps/hq/src",
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

const decodeGitHubEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      before: Schema.optional(Schema.String),
      pull_request: Schema.optional(Schema.Struct({ base: Schema.Struct({ sha: Schema.String }) })),
    }),
  ),
);

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
  readonly baseline?: ReadonlyMap<string, ReadonlyArray<ExceptionEntry>>;
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

/** These ledgers remain files even at zero; rule discovery must never lose a guard. */
export const RATCHET_RULES = [
  "no-remote-io-outside-data-layer",
  "no-retired-mechanism",
  "no-failure-to-empty",
  "no-remote-data-in-browser-storage",
] as const;

const encodeIdentity = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const identityOf = (entry: ExceptionEntry): string =>
  encodeIdentity([
    entry.path.replaceAll("\\", "/"),
    entry.kind,
    normalizeFingerprint(entry.fingerprint),
  ]);

/** Metadata edits cannot buy another identity or another occurrence of the same identity. */
export const ratchetAdditions = (
  entries: ReadonlyArray<ExceptionEntry>,
  baseline: ReadonlyArray<ExceptionEntry>,
): ReadonlyArray<string> => {
  const counts = new Map<string, number>();
  for (const entry of baseline) {
    // A baseline from before Effect 4.0.1 names the same import by its effect/unstable/* path.
    const identity = identityOf({ ...entry, fingerprint: rewriteImportPaths(entry.fingerprint) });
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const additions: Array<string> = [];
  for (const entry of entries) {
    const identity = identityOf(entry);
    const remaining = counts.get(identity) ?? 0;
    if (remaining === 0)
      additions.push(`${entry.path}:${entry.kind} ${normalizeFingerprint(entry.fingerprint)}`);
    else counts.set(identity, remaining - 1);
  }
  return additions;
};

/** Compare with the shared ancestor, including uncommitted edits. Main CI compares its last commit. */
export const loadRatchetBaseline = (
  cwd: string,
  base: string,
): ReadonlyMap<string, ReadonlyArray<ExceptionEntry>> => {
  const git = (args: ReadonlyArray<string>): string => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
    return result.stdout.trim();
  };
  const head = git(["rev-parse", "HEAD"]);
  let comparison = base;
  if (process.env.GITHUB_ACTIONS === "true" && base === "origin/main") {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath === undefined)
      throw new Error("GitHub ratchet needs its push or PR event baseline.");
    const event = decodeGitHubEvent(NodeFS.readFileSync(eventPath, "utf8"));
    const revision = event.pull_request?.base.sha ?? event.before;
    if (revision === undefined || !/^[a-f0-9]{40}$/u.test(revision) || /^0+$/u.test(revision)) {
      throw new Error("GitHub ratchet needs a valid previous main or PR base commit.");
    }
    comparison = revision;
    // Checkouts may contain only HEAD. Load both ancestry chains before computing their merge-base.
    if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
      git(["fetch", "--no-tags", "--unshallow", "origin", head, comparison]);
    } else if (
      NodeChildProcess.spawnSync("git", ["cat-file", "-e", `${comparison}^{commit}`], { cwd })
        .status !== 0
    ) {
      git(["fetch", "--no-tags", "origin", comparison]);
    }
  }
  const ancestor = git(["merge-base", comparison, "HEAD"]);
  const revision =
    process.env.CI === "true" && process.env.GITHUB_ACTIONS !== "true" && ancestor === head
      ? git(["rev-parse", "HEAD^"])
      : ancestor;
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "guard-baseline-"));
  try {
    return new Map(
      RATCHET_RULES.map((ruleName) => {
        // Missing history or a missing baseline ledger is an error, never a fresh allowance.
        NodeFS.writeFileSync(
          NodePath.join(directory, `${ruleName}.json`),
          git(["show", `${revision}:oxlint-plugin-t3code/exceptions/${ruleName}.json`]),
        );
        const entries = loadExceptionLedger(ruleName, directory).entries;
        return [
          ruleName,
          ruleName === "no-failure-to-empty"
            ? enrollmentBaseline(cwd, revision, entries, git)
            : entries,
        ];
      }),
    );
  } finally {
    NodeFS.rmSync(directory, { recursive: true });
  }
};

/** A frozen admission snapshot makes this enrollment reviewable once, including multi-commit pushes.
 * Once present in the ancestor, even an empty ledger cannot reopen admission. Later lane commits
 * compare with the first snapshot, not with an editable working copy. Reconciliation still runs.
 */
const ENROLLMENT_SNAPSHOT = "oxlint-plugin-t3code/failure-to-empty-enrollment.json";
const FAILURE_RULE = "oxlint-plugin-t3code/rules/no-failure-to-empty.ts";
const ENROLLED_ROOTS = ['"apps/web/src/"', '"packages/client-runtime/src/data/"'];
const enrollmentBaseline = (
  cwd: string,
  revision: string,
  baseline: ReadonlyArray<ExceptionEntry>,
  git: (args: ReadonlyArray<string>) => string,
): ReadonlyArray<ExceptionEntry> => {
  const existsAt = (ref: string, path: string) =>
    NodeChildProcess.spawnSync("git", ["cat-file", "-e", `${ref}:${path}`], {
      cwd,
      stdio: "ignore",
    }).status === 0;
  if (existsAt(revision, ENROLLMENT_SNAPSHOT)) return baseline;
  const file = NodePath.join(cwd, ENROLLMENT_SNAPSHOT);
  if (!NodeFS.existsSync(file)) return baseline;
  if (baseline.length !== 0)
    throw new Error("Enrollment requires the original empty failure ledger.");
  const introduction = git([
    "log",
    "--reverse",
    "--format=%H",
    "--diff-filter=A",
    `${revision}..HEAD`,
    "--",
    ENROLLMENT_SNAPSHOT,
  ]).split("\n")[0];
  const before = git(["show", `${revision}:${FAILURE_RULE}`]);
  const after = introduction
    ? git(["show", `${introduction}:${FAILURE_RULE}`])
    : NodeFS.readFileSync(NodePath.join(cwd, FAILURE_RULE), "utf8");
  if (ENROLLED_ROOTS.some((root) => before.includes(root) || !after.includes(root))) {
    throw new Error("Failure enrollment snapshot must accompany the new web and data roots.");
  }
  if (introduction) {
    const parent = git(["rev-parse", `${introduction}^`]);
    if (ENROLLED_ROOTS.some((root) => git(["show", `${parent}:${FAILURE_RULE}`]).includes(root))) {
      throw new Error("Failure enrollment snapshot must be committed with root enrollment.");
    }
  }
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "failure-enrollment-"));
  try {
    NodeFS.writeFileSync(
      NodePath.join(directory, "no-failure-to-empty.json"),
      introduction
        ? git(["show", `${introduction}:${ENROLLMENT_SNAPSHOT}`])
        : NodeFS.readFileSync(file, "utf8"),
    );
    const entries = loadExceptionLedger("no-failure-to-empty", directory).entries;
    if (
      entries.some(
        (entry) =>
          !(
            entry.path.startsWith("packages/client-runtime/src/data/") ||
            (entry.path.startsWith("apps/web/src/") &&
              !entry.path.startsWith("apps/web/src/zerops/") &&
              !entry.path.startsWith("apps/web/src/components/zerops/"))
          ),
      )
    ) {
      throw new Error("Enrollment admits only findings in newly guarded roots.");
    }
    NodeFS.writeFileSync(
      NodePath.join(directory, "no-failure-to-empty.json"),
      introduction
        ? git(["show", `${introduction}:oxlint-plugin-t3code/exceptions/no-failure-to-empty.json`])
        : NodeFS.readFileSync(
            NodePath.join(cwd, "oxlint-plugin-t3code/exceptions/no-failure-to-empty.json"),
            "utf8",
          ),
    );
    const admitted = loadExceptionLedger("no-failure-to-empty", directory).entries;
    if (ratchetAdditions(entries, admitted).length || ratchetAdditions(admitted, entries).length) {
      throw new Error("Enrollment snapshot must match the ledger in the enrollment commit.");
    }
    return entries;
  } finally {
    NodeFS.rmSync(directory, { recursive: true });
  }
};

const discoverRuleNames = (directory: string): ReadonlyArray<string> => {
  if (!NodeFS.existsSync(directory)) return [];
  return NodeFS.readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "phases.json",
    )
    .map((entry) => entry.name.slice(0, -".json".length))
    .toSorted();
};

const makeLintRequest = (cwd: string, ruleNames: ReadonlyArray<string>): GuardLintRequest => ({
  cwd,
  args: [
    "lint",
    "-f",
    "json",
    "-A",
    "all",
    ...ruleNames.flatMap((ruleName) => ["-D", `t3code/${ruleName}`]),
    ...GUARD_SCOPE_PATHS,
  ],
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

/** One AST scan for the selected rules, then reconcile each ledger independently. */
export const checkGuardExceptions = <E, R>(options: GuardExceptionCheckOptions<E, R>) =>
  Effect.gen(function* () {
    if (options.baseline !== undefined) {
      for (const ruleName of RATCHET_RULES) {
        yield* tryDriverOperation(ruleName, "required ledger file is missing", () => {
          if (!NodeFS.existsSync(NodePath.join(options.directory, `${ruleName}.json`))) {
            throw new Error("Keep the ledger file as [] at zero.");
          }
        });
      }
    }
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

    const output = yield* options.runLint(makeLintRequest(options.cwd, ruleNames));
    for (const ruleName of ruleNames) {
      const ledger = yield* tryDriverOperation(ruleName, "failed to load exception ledger", () =>
        loadExceptionLedger(ruleName, options.directory),
      );
      const baseline = options.baseline?.get(ruleName);
      if (baseline !== undefined) {
        const additions = ratchetAdditions(ledger.entries, baseline);
        problemCount += additions.length;
        for (const addition of additions)
          reports.push(`${ruleName}: new exception identity/occurrence ${addition}`);
      }
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
    base: Flag.String("base").pipe(Flag.withDefault("origin/main")),
    rule: Flag.String("rule").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "Rule ledger to reconcile. Repeat for multiple rules; defaults to every rule ledger.",
      ),
    ),
  },
  ({ rule, base }) =>
    Effect.gen(function* () {
      const directory = NodePath.join(DEFAULT_REPO_ROOT, "oxlint-plugin-t3code", "exceptions");
      const baseline = yield* tryDriverOperation(
        "guard exceptions",
        "failed to load Git ratchet baseline",
        () => loadRatchetBaseline(DEFAULT_REPO_ROOT, base),
      );
      const result = yield* checkGuardExceptions({
        cwd: DEFAULT_REPO_ROOT,
        directory,
        baseline,
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
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Console.error(error.message);
          yield* Effect.sync(() => {
            process.exitCode = 1;
          });
        }),
      ),
    ),
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
