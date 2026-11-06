// @effect-diagnostics nodeBuiltinImport:off -- Exercise the host CLI without a cross-project import.
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeAssert from "node:assert";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vite-plus/test";

import { type ExceptionEntry } from "../exceptions.ts";

interface GuardDriver {
  readonly RATCHET_RULES: readonly [string, string, ...Array<string>];
  readonly ADMISSION_POLICY_BOOTSTRAP: ReadonlyArray<ExceptionEntry>;
  readonly ratchetAdditions: (
    entries: ReadonlyArray<ExceptionEntry>,
    baseline: ReadonlyArray<ExceptionEntry>,
  ) => ReadonlyArray<string>;
  readonly loadRatchetBaseline: (
    cwd: string,
    base: string,
  ) => ReadonlyMap<string, ReadonlyArray<ExceptionEntry>>;
  readonly checkGuardExceptions: (options: {
    readonly cwd: string;
    readonly directory: string;
    readonly baseline: ReadonlyMap<string, ReadonlyArray<ExceptionEntry>>;
    readonly runLint: (request: { readonly args: ReadonlyArray<string> }) => Effect.Effect<{
      readonly exitCode: number;
      readonly stderr: string;
      readonly stdout: string;
    }>;
  }) => Effect.Effect<
    {
      readonly exitCode: number;
      readonly problemCount: number;
      readonly reports: ReadonlyArray<string>;
    },
    { readonly ruleName: string; readonly detail: string }
  >;
}

const driverUrl = new URL("../../scripts/check-guard-exceptions.ts", import.meta.url).href;
const {
  checkGuardExceptions,
  ratchetAdditions,
  RATCHET_RULES,
  loadRatchetBaseline,
  ADMISSION_POLICY_BOOTSTRAP,
} = (await import(/* @vite-ignore */ driverUrl)) as GuardDriver;

const entry = {
  path: "apps/web/src/one.ts",
  kind: "CallExpression",
  fingerprint: "fetch",
  owner: "owner",
  reason: "review – důvod",
  expires: "F3",
  class: "review",
} satisfies ExceptionEntry;

const useFixtureGitIdentity = () => {
  vi.stubEnv("GIT_AUTHOR_NAME", "Guard fixture");
  vi.stubEnv("GIT_AUTHOR_EMAIL", "fixture@example.invalid");
  vi.stubEnv("GIT_COMMITTER_NAME", "Guard fixture");
  vi.stubEnv("GIT_COMMITTER_EMAIL", "fixture@example.invalid");
};

beforeEach(() => {
  vi.stubEnv("CI", "false");
  vi.stubEnv("GITHUB_ACTIONS", "false");
  vi.stubEnv("GITHUB_EVENT_PATH", "");
  useFixtureGitIdentity();
});
afterEach(() => vi.unstubAllEnvs());

const designRules = [
  "no-infinite-motion",
  "no-legacy-vocabulary",
  "require-static-classes",
  "no-unknown-classes",
  "no-restyle",
  "no-arbitrary-values",
  "no-theme-escape-hatches",
] as const;
const other = { ...entry, fingerprint: "request" };
let fixtureRoot: string;
let designDirectory: string;
let designLedgers: string;
let designBaseline: ReturnType<typeof loadRatchetBaseline>;

beforeAll(() => {
  vi.stubEnv("CI", "false");
  vi.stubEnv("GITHUB_ACTIONS", "false");
  useFixtureGitIdentity();
  try {
    fixtureRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "guard-ratchet-"));
    for (const name of [
      "design",
      "identity",
      "admission",
      "empty",
      "history",
      "shallow/source",
      "enrollment",
    ]) {
      NodeFS.mkdirSync(NodePath.join(fixtureRoot, name), { recursive: true });
    }
    for (const name of ["design", "history", "shallow/source", "enrollment"]) {
      const cwd = NodePath.join(fixtureRoot, name);
      NodeChildProcess.execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
    }
    designDirectory = NodePath.join(fixtureRoot, "design");
    const git = (...args: Array<string>) =>
      NodeChildProcess.execFileSync("git", args, {
        cwd: designDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    designLedgers = NodePath.join(designDirectory, "oxlint-plugin-t3code", "exceptions");
    NodeFS.mkdirSync(designLedgers, { recursive: true });
    for (const name of RATCHET_RULES) {
      const entries = designRules.some((rule) => rule === name) ? [entry, other] : [];
      NodeFS.writeFileSync(NodePath.join(designLedgers, name + ".json"), JSON.stringify(entries));
    }
    git("add", ".");
    git("commit", "-m", "design baseline");
    designBaseline = loadRatchetBaseline(designDirectory, "HEAD");
    for (const name of designRules)
      NodeFS.writeFileSync(NodePath.join(designLedgers, name + ".json"), "[]");
  } finally {
    vi.unstubAllEnvs();
  }
});
afterAll(() => NodeFS.rmSync(fixtureRoot, { recursive: true }));

describe("identity multiset ratchet", () => {
  it.effect.each(designRules)(
    "%s exceptions may only shrink and its empty ledger remains required",
    (rule) =>
      Effect.gen(function* () {
        const directory = designDirectory;
        const ledgers = designLedgers;
        const ledger = NodePath.join(ledgers, rule + ".json");
        const baseline = new Map(
          RATCHET_RULES.map((name) => [name, name === rule ? designBaseline.get(name)! : []]),
        );
        try {
          for (const [label, entries, expectedAdditions] of [
            ["unchanged", [entry, other], 0],
            ["removal", [entry], 0],
            ["new identity", [entry, other, { ...entry, fingerprint: "added" }], 1],
            ["same-count swap", [entry, { ...other, fingerprint: "replacement" }], 1],
            ["duplicate growth", [entry, entry], 1],
            ["empty", [], 0],
          ] as const) {
            NodeFS.writeFileSync(ledger, JSON.stringify(entries));
            const result = yield* checkGuardExceptions({
              cwd: directory,
              directory: ledgers,
              baseline,
              runLint: () =>
                Effect.succeed({
                  exitCode: entries.length ? 1 : 0,
                  stderr: "",
                  stdout: JSON.stringify({
                    diagnostics: entries.map((item) => ({
                      filename: item.path,
                      code: "t3code(" + rule + ")",
                      message:
                        "T3CODE_GUARD_FINDING:" +
                        JSON.stringify({
                          ruleName: rule,
                          kind: item.kind,
                          fingerprint: item.fingerprint,
                          ledgered: true,
                          summary: "fixture",
                        }),
                    })),
                  }),
                }),
            });
            NodeAssert.strict.equal(
              result.exitCode,
              expectedAdditions ? 1 : 0,
              rule + ": " + label,
            );
            NodeAssert.strict.equal(result.problemCount, expectedAdditions, rule + ": " + label);
            NodeAssert.strict.equal(
              result.reports.filter((report) =>
                report.includes("new exception identity/occurrence"),
              ).length,
              expectedAdditions,
              rule + ": " + label,
            );
          }
          NodeFS.unlinkSync(ledger);
          const error = yield* checkGuardExceptions({
            cwd: directory,
            directory: ledgers,
            baseline,
            runLint: () =>
              Effect.succeed({ exitCode: 0, stderr: "", stdout: '{"diagnostics":[]}' }),
          }).pipe(Effect.flip);
          NodeAssert.strict.equal(error.ruleName, rule);
          NodeAssert.strict.equal(error.detail, "required ledger file is missing");
        } finally {
          NodeFS.writeFileSync(ledger, "[]");
        }
      }),
  );
  it("rejects swapping an identity at the same total count", async () => {
    NodeAssert.strict.equal(
      ratchetAdditions([{ ...entry, path: "apps/web/src/two.ts" }], [entry]).length,
      1,
    );
  });
  it("rejects another occurrence even when another exception was removed", async () => {
    NodeAssert.strict.equal(
      ratchetAdditions([entry, entry], [entry, { ...entry, fingerprint: "request" }]).length,
      1,
    );
  });
  it("metadata edits cannot buy an occurrence", async () => {
    NodeAssert.strict.equal(
      ratchetAdditions(
        [entry, { ...entry, reason: "new", owner: "other", expires: "never" }],
        [entry],
      ).length,
      1,
    );
  });
  it("normalizes fingerprint whitespace and permits removals", async () => {
    NodeAssert.strict.deepEqual(
      ratchetAdditions([{ ...entry, fingerprint: "  fetch \n" }], [entry, entry]),
      [],
    );
  });
  // Effect 4.0.1 moved effect/unstable/<area> to effect/<area>: a branch whose baseline predates
  // the move keeps the same exceptions, under their new import path.
  it("a baseline import path from before Effect 4.0.1 is the same identity under its new path", async () => {
    const before = {
      ...entry,
      kind: "ImportDeclaration",
      fingerprint: ["effect", "unstable", "httpapi", "HttpApi"].join("/"),
    };
    NodeAssert.strict.deepEqual(
      ratchetAdditions([{ ...before, fingerprint: "effect/http-api/HttpApi" }], [before]),
      [],
    );
    NodeAssert.strict.equal(
      ratchetAdditions(
        [
          { ...before, fingerprint: "effect/http-api/HttpApi" },
          { ...before, fingerprint: "effect/http-api/HttpApi" },
        ],
        [before],
      ).length,
      1,
    );
  });
  it.effect("includes rule, path, kind and fingerprint in the comparison", () =>
    Effect.gen(function* () {
      for (const patch of [
        { path: "apps/web/src/two.ts" },
        { kind: "Identifier" },
        { fingerprint: "request" },
      ]) {
        NodeAssert.strict.equal(ratchetAdditions([{ ...entry, ...patch }], [entry]).length, 1);
      }
      const directory = NodePath.join(fixtureRoot, "identity");
      for (const rule of RATCHET_RULES)
        NodeFS.writeFileSync(NodePath.join(directory, rule + ".json"), "[]");
      const rule = RATCHET_RULES[0];
      NodeFS.writeFileSync(NodePath.join(directory, rule + ".json"), JSON.stringify([entry]));
      const result = yield* checkGuardExceptions({
        cwd: directory,
        directory,
        baseline: new Map(
          RATCHET_RULES.map((name) => [name, name === RATCHET_RULES[1] ? [entry] : []]),
        ),
        runLint: () =>
          Effect.succeed({
            exitCode: 1,
            stderr: "",
            stdout: JSON.stringify({
              diagnostics: [
                {
                  filename: entry.path,
                  code: "t3code(" + rule + ")",
                  message:
                    "T3CODE_GUARD_FINDING:" +
                    JSON.stringify({
                      ruleName: rule,
                      kind: entry.kind,
                      fingerprint: entry.fingerprint,
                      ledgered: true,
                      summary: "fixture",
                    }),
                },
              ],
            }),
          }),
      });
      NodeAssert.strict.equal(result.exitCode, 1);
      NodeAssert.strict.ok(result.reports.join("\n").includes("new exception identity/occurrence"));
    }),
  );
  it.effect("both replaced admission policies must leave the frozen baseline", () =>
    Effect.gen(function* () {
      const directory = NodePath.join(fixtureRoot, "admission");
      const rule = "no-legacy-notice-policy";
      for (const name of RATCHET_RULES)
        NodeFS.writeFileSync(NodePath.join(directory, name + ".json"), "[]");
      for (const entries of [
        ADMISSION_POLICY_BOOTSTRAP,
        ADMISSION_POLICY_BOOTSTRAP.slice(0, 1),
        [],
      ]) {
        NodeFS.writeFileSync(NodePath.join(directory, rule + ".json"), JSON.stringify(entries));
        const result = yield* checkGuardExceptions({
          cwd: directory,
          directory,
          baseline: new Map(
            RATCHET_RULES.map((name) => [name, name === rule ? ADMISSION_POLICY_BOOTSTRAP : []]),
          ),
          runLint: () =>
            Effect.succeed({
              exitCode: 0,
              stderr: "",
              stdout: JSON.stringify({
                diagnostics: entries.map((entry) => ({
                  filename: entry.path,
                  code: "t3code(" + rule + ")",
                  message:
                    "T3CODE_GUARD_FINDING:" +
                    JSON.stringify({
                      ruleName: rule,
                      kind: entry.kind,
                      fingerprint: entry.fingerprint,
                      ledgered: true,
                      summary: "fixture",
                    }),
                })),
              }),
            }),
        });
        NodeAssert.strict.equal(result.exitCode, entries.length === 0 ? 0 : 1);
        NodeAssert.strict.equal(
          result.reports.some((report) => report.includes("strictly decrease")),
          entries.length !== 0,
        );
      }
    }),
  );
  it.effect("keeps all empty files in the default scan and rejects removing one", () =>
    Effect.gen(function* () {
      const directory = NodePath.join(fixtureRoot, "empty");
      for (const rule of RATCHET_RULES)
        NodeFS.writeFileSync(NodePath.join(directory, rule + ".json"), "[]");
      const baseline = new Map(RATCHET_RULES.map((rule) => [rule, []]));
      const runLint = (request: { readonly args: ReadonlyArray<string> }) => {
        for (const rule of RATCHET_RULES)
          NodeAssert.strict.ok(request.args.includes("t3code/" + rule));
        return Effect.succeed({ exitCode: 0, stdout: '{"diagnostics":[]}', stderr: "" });
      };
      const result = yield* checkGuardExceptions({ cwd: directory, directory, baseline, runLint });
      NodeAssert.strict.equal(result.exitCode, 0);
      NodeAssert.strict.equal(result.reports.length, RATCHET_RULES.length);
      NodeFS.unlinkSync(NodePath.join(directory, RATCHET_RULES[0] + ".json"));
      const error = yield* checkGuardExceptions({
        cwd: directory,
        directory,
        baseline,
        runLint,
      }).pipe(Effect.flip);
      NodeAssert.strict.equal(error.detail, "required ledger file is missing");
    }),
  );
  it("compares the merge-base rather than the moving remote tip and fails on missing history", async () => {
    const directory = NodePath.join(fixtureRoot, "history");
    const git = (...args: Array<string>) =>
      NodeChildProcess.execFileSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const ledgers = NodePath.join(directory, "oxlint-plugin-t3code", "exceptions");
    NodeFS.mkdirSync(ledgers, { recursive: true });
    for (const rule of RATCHET_RULES)
      NodeFS.writeFileSync(NodePath.join(ledgers, rule + ".json"), JSON.stringify([entry, entry]));
    git("add", ".");
    git("commit", "-m", "baseline");
    const ancestor = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", ancestor);
    git("checkout", "-b", "lane");
    NodeFS.writeFileSync(
      NodePath.join(ledgers, RATCHET_RULES[0] + ".json"),
      JSON.stringify([entry]),
    );
    git("add", ".");
    git("commit", "-m", "lane removal");
    git("checkout", "main");
    NodeFS.writeFileSync(NodePath.join(ledgers, RATCHET_RULES[0] + ".json"), "[]");
    git("add", ".");
    git("commit", "-m", "independent main removal");
    git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
    git("checkout", "lane");
    NodeAssert.strict.equal(
      loadRatchetBaseline(directory, "origin/main").get(RATCHET_RULES[0])!.length,
      2,
    );
    NodeAssert.strict.throws(
      () => loadRatchetBaseline(directory, "missing-base"),
      /failed|ambiguous|valid/i,
    );
  });
  it("loads the push baseline from a shallow CI checkout, including a multi-commit push", async () => {
    const directory = NodePath.join(fixtureRoot, "shallow");
    const source = NodePath.join(directory, "source");
    const git = (cwd: string, ...args: Array<string>) =>
      NodeChildProcess.execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const ledgers = NodePath.join(source, "oxlint-plugin-t3code", "exceptions");
    NodeFS.mkdirSync(ledgers, { recursive: true });
    for (const rule of RATCHET_RULES)
      NodeFS.writeFileSync(NodePath.join(ledgers, rule + ".json"), JSON.stringify([entry, entry]));
    git(source, "add", ".");
    git(source, "commit", "-m", "before push");
    const before = git(source, "rev-parse", "HEAD");
    NodeFS.writeFileSync(
      NodePath.join(ledgers, RATCHET_RULES[0] + ".json"),
      JSON.stringify([entry]),
    );
    git(source, "add", ".");
    git(source, "commit", "-m", "first pushed commit");
    git(source, "commit", "--allow-empty", "-m", "last pushed commit");
    const checkout = NodePath.join(directory, "checkout");
    git(directory, "clone", "--depth=1", "file://" + source, checkout);
    NodeAssert.strict.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "true");
    const eventPath = NodePath.join(directory, "event.json");
    NodeFS.writeFileSync(eventPath, JSON.stringify({ before }));
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.CI = "true";
    NodeAssert.strict.equal(
      loadRatchetBaseline(checkout, "origin/main").get(RATCHET_RULES[0])!.length,
      2,
    );
    NodeAssert.strict.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "false");
    NodeFS.writeFileSync(
      eventPath,
      JSON.stringify({ before: "0".repeat(40), pull_request: { base: { sha: before } } }),
    );
    NodeAssert.strict.equal(
      loadRatchetBaseline(checkout, "origin/main").get(RATCHET_RULES[0])!.length,
      2,
    );
    NodeFS.writeFileSync(eventPath, JSON.stringify({ before: "0".repeat(40) }));
    NodeAssert.strict.equal(
      loadRatchetBaseline(checkout, "origin/main").get(RATCHET_RULES[0])!.length,
      1,
    );
  });
  it("admits only the enrollment commit and never replays admission after removal", async () => {
    const directory = NodePath.join(fixtureRoot, "enrollment");
    const git = (...args: Array<string>) =>
      NodeChildProcess.execFileSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const ledgers = NodePath.join(directory, "oxlint-plugin-t3code", "exceptions");
    NodeFS.mkdirSync(ledgers, { recursive: true });
    const ruleFile = NodePath.join(
      directory,
      "oxlint-plugin-t3code",
      "rules",
      "no-failure-to-empty.ts",
    );
    NodeFS.mkdirSync(NodePath.dirname(ruleFile));
    NodeFS.writeFileSync(ruleFile, 'const roots = ["apps/web/src/zerops/"];');
    for (const rule of RATCHET_RULES)
      NodeFS.writeFileSync(NodePath.join(ledgers, rule + ".json"), "[]");
    git("add", ".");
    git("commit", "-m", "before enrollment");
    const before = git("rev-parse", "HEAD");
    const snapshot = NodePath.join(
      directory,
      "oxlint-plugin-t3code",
      "failure-to-empty-enrollment.json",
    );
    const ledger = NodePath.join(ledgers, "no-failure-to-empty.json");
    const admitted = { ...entry, class: "review" } satisfies ExceptionEntry;
    NodeFS.writeFileSync(
      ruleFile,
      'const roots = ["apps/web/src/", "packages/client-runtime/src/data/"];',
    );
    NodeFS.writeFileSync(snapshot, JSON.stringify([admitted]));
    NodeFS.writeFileSync(ledger, JSON.stringify([admitted]));
    NodeAssert.strict.deepEqual(
      ratchetAdditions(
        [admitted],
        loadRatchetBaseline(directory, before).get("no-failure-to-empty")!,
      ),
      [],
    );
    git("add", ".");
    git("commit", "-m", "enroll roots and baseline");
    const enrollment = git("rev-parse", "HEAD");
    NodeFS.writeFileSync(snapshot, JSON.stringify([admitted, admitted]));
    NodeFS.writeFileSync(ledger, JSON.stringify([admitted, admitted]));
    git("add", ".");
    git("commit", "-m", "attempt to extend snapshot");
    NodeAssert.strict.equal(
      ratchetAdditions(
        [admitted, admitted],
        loadRatchetBaseline(directory, before).get("no-failure-to-empty")!,
      ).length,
      1,
    );
    NodeAssert.strict.equal(
      ratchetAdditions(
        [admitted, admitted],
        loadRatchetBaseline(directory, enrollment).get("no-failure-to-empty")!,
      ).length,
      1,
    );
    NodeFS.writeFileSync(ledger, "[]");
    git("add", ".");
    git("commit", "-m", "remove all debt");
    const cleared = git("rev-parse", "HEAD");
    NodeFS.writeFileSync(ledger, JSON.stringify([admitted]));
    NodeAssert.strict.equal(
      ratchetAdditions(
        [admitted],
        loadRatchetBaseline(directory, cleared).get("no-failure-to-empty")!,
      ).length,
      1,
    );
    git("checkout", "-f", before);
    NodeFS.writeFileSync(snapshot, JSON.stringify([admitted]));
    NodeFS.writeFileSync(ledger, JSON.stringify([admitted]));
    NodeAssert.strict.throws(() => loadRatchetBaseline(directory, before), /accompany/);
    NodeFS.writeFileSync(
      ruleFile,
      'const roots = ["apps/web/src/", "packages/client-runtime/src/data/"];',
    );
    NodeFS.writeFileSync(
      snapshot,
      JSON.stringify([{ ...admitted, path: "apps/mobile/src/one.ts" }]),
    );
    NodeAssert.strict.throws(() => loadRatchetBaseline(directory, before), /newly guarded/);
    NodeFS.writeFileSync(snapshot, JSON.stringify([admitted, admitted]));
    NodeAssert.strict.throws(() => loadRatchetBaseline(directory, before), /match the ledger/);
  });
});
