// @effect-diagnostics nodeBuiltinImport:off -- Exercise the host CLI without a cross-project import.
import { assert, describe, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";

const check = (assertion: string) => {
  const script = new URL("../../scripts/check-guard-exceptions.ts", import.meta.url).href;
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { strict as assert } from "node:assert";
    import { checkGuardExceptions, ratchetAdditions, RATCHET_RULES, loadRatchetBaseline, ADMISSION_POLICY_BOOTSTRAP } from ${JSON.stringify(script)};
    import * as Effect from "effect/Effect";
    import * as fs from "node:fs";
    import { execFileSync } from "node:child_process";
    import * as os from "node:os";
    import * as path from "node:path";
    const entry = { path: "apps/web/src/one.ts", kind: "CallExpression", fingerprint: "fetch", owner: "owner", reason: "debt", expires: "F3", class: "review" };
    ${assertion}
  `,
    ],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      // Synthetic repositories own their baseline; CI cases set their event explicitly.
      env: { ...process.env, CI: "false", GITHUB_ACTIONS: "false", GITHUB_EVENT_PATH: "" },
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
};

describe("identity multiset ratchet", () => {
  it.each([
    "no-infinite-motion",
    "no-legacy-vocabulary",
    "require-static-classes",
    "no-unknown-classes",
    "no-restyle",
    "no-arbitrary-values",
    "no-theme-escape-hatches",
  ])("%s exceptions may only shrink and its empty ledger remains required", (rule) =>
    check(`
    const rule = ${JSON.stringify(rule)};
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "design-ratchet-"));
    const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git("init", "-b", "main");
      git("config", "user.name", "Guard fixture"); git("config", "user.email", "fixture@example.invalid");
      const ledgers = path.join(directory, "oxlint-plugin-t3code", "exceptions"); fs.mkdirSync(ledgers, { recursive: true });
      for (const name of new Set([...RATCHET_RULES, rule])) fs.writeFileSync(path.join(ledgers, name + ".json"), "[]");
      const ledger = path.join(ledgers, rule + ".json");
      const other = { ...entry, fingerprint: "request" };
      fs.writeFileSync(ledger, JSON.stringify([entry, other]));
      git("add", "."); git("commit", "-m", "design baseline");
      const baseline = loadRatchetBaseline(directory, "HEAD");
      for (const [label, entries, expectedAdditions] of [
        ["unchanged", [entry, other], 0],
        ["removal", [entry], 0],
        ["new identity", [entry, other, { ...entry, fingerprint: "added" }], 1],
        ["same-count swap", [entry, { ...other, fingerprint: "replacement" }], 1],
        ["duplicate growth", [entry, entry], 1],
        ["empty", [], 0],
      ]) {
        fs.writeFileSync(ledger, JSON.stringify(entries));
        const result = await Effect.runPromise(checkGuardExceptions({
          cwd: directory, directory: ledgers, baseline,
          runLint: () => Effect.succeed({ exitCode: entries.length ? 1 : 0, stderr: "", stdout: JSON.stringify({ diagnostics: entries.map(item => ({
            filename: item.path, code: "t3code(" + rule + ")",
            message: "T3CODE_GUARD_FINDING:" + JSON.stringify({ ruleName: rule, kind: item.kind, fingerprint: item.fingerprint, ledgered: true, summary: "fixture" })
          })) }) })
        }));
        assert.equal(result.exitCode, expectedAdditions ? 1 : 0, rule + ": " + label);
        assert.equal(result.problemCount, expectedAdditions, rule + ": " + label);
        assert.equal(result.reports.filter(report => report.includes("new exception identity/occurrence")).length, expectedAdditions, rule + ": " + label);
      }
      fs.unlinkSync(ledger);
      const error = await Effect.runPromise(checkGuardExceptions({
        cwd: directory, directory: ledgers, baseline,
        runLint: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: '{"diagnostics":[]}' })
      }).pipe(Effect.flip));
      assert.equal(error.ruleName, rule);
      assert.equal(error.detail, "required ledger file is missing");
    } finally { fs.rmSync(directory, { recursive: true }); }
  `),
  );
  it("rejects swapping an identity at the same total count", () =>
    check(
      `assert.equal(ratchetAdditions([{ ...entry, path: "apps/web/src/two.ts" }], [entry]).length, 1);`,
    ));
  it("rejects another occurrence even when another exception was removed", () =>
    check(
      `assert.equal(ratchetAdditions([entry, entry], [entry, { ...entry, fingerprint: "request" }]).length, 1);`,
    ));
  it("metadata edits cannot buy an occurrence", () =>
    check(
      `assert.equal(ratchetAdditions([entry, { ...entry, reason: "new", owner: "other", expires: "never" }], [entry]).length, 1);`,
    ));
  it("normalizes fingerprint whitespace and permits removals", () =>
    check(
      `assert.deepEqual(ratchetAdditions([{ ...entry, fingerprint: "  fetch \\n" }], [entry, entry]), []);`,
    ));
  // Effect 4.0.1 moved effect/unstable/<area> to effect/<area>: a branch whose baseline predates
  // the move keeps the same exceptions, under their new import path.
  it("a baseline import path from before Effect 4.0.1 is the same identity under its new path", () =>
    check(`
    const before = { ...entry, kind: "ImportDeclaration", fingerprint: ["effect", "unstable", "httpapi", "HttpApi"].join("/") };
    assert.deepEqual(ratchetAdditions([{ ...before, fingerprint: "effect/http-api/HttpApi" }], [before]), []);
    assert.equal(ratchetAdditions([{ ...before, fingerprint: "effect/http-api/HttpApi" }, { ...before, fingerprint: "effect/http-api/HttpApi" }], [before]).length, 1);
  `));
  it("includes rule, path, kind and fingerprint in the comparison", () =>
    check(`
    for (const patch of [{ path: "apps/web/src/two.ts" }, { kind: "Identifier" }, { fingerprint: "request" }]) {
      assert.equal(ratchetAdditions([{ ...entry, ...patch }], [entry]).length, 1);
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guard-ratchet-"));
    try {
      for (const rule of RATCHET_RULES) fs.writeFileSync(path.join(directory, rule + ".json"), "[]");
      const rule = RATCHET_RULES[0];
      fs.writeFileSync(path.join(directory, rule + ".json"), JSON.stringify([entry]));
      const result = await Effect.runPromise(checkGuardExceptions({
        cwd: directory, directory,
        baseline: new Map(RATCHET_RULES.map(name => [name, name === RATCHET_RULES[1] ? [entry] : []])),
        runLint: () => Effect.succeed({ exitCode: 1, stderr: "", stdout: JSON.stringify({ diagnostics: [{
          filename: entry.path, code: "t3code(" + rule + ")",
          message: "T3CODE_GUARD_FINDING:" + JSON.stringify({ ruleName: rule, kind: entry.kind, fingerprint: entry.fingerprint, ledgered: true, summary: "fixture" })
        }] }) })
      }));
      assert.equal(result.exitCode, 1);
      assert.ok(result.reports.join("\\n").includes("new exception identity/occurrence"));
    } finally { fs.rmSync(directory, { recursive: true }); }
  `));
  it("both replaced admission policies must leave the frozen baseline", () =>
    check(`
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guard-admission-"));
    const rule = "no-legacy-notice-policy";
    try {
      for (const name of RATCHET_RULES) fs.writeFileSync(path.join(directory, name + ".json"), "[]");
      for (const entries of [ADMISSION_POLICY_BOOTSTRAP, ADMISSION_POLICY_BOOTSTRAP.slice(0, 1), []]) {
        fs.writeFileSync(path.join(directory, rule + ".json"), JSON.stringify(entries));
        const result = await Effect.runPromise(checkGuardExceptions({
          cwd: directory, directory,
          baseline: new Map(RATCHET_RULES.map(name => [name, name === rule ? ADMISSION_POLICY_BOOTSTRAP : []])),
          runLint: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: JSON.stringify({ diagnostics: entries.map(entry => ({
            filename: entry.path, code: "t3code(" + rule + ")",
            message: "T3CODE_GUARD_FINDING:" + JSON.stringify({ ruleName: rule, kind: entry.kind, fingerprint: entry.fingerprint, ledgered: true, summary: "fixture" })
          })) }) })
        }));
        assert.equal(result.exitCode, entries.length === 0 ? 0 : 1);
        assert.equal(result.reports.some(report => report.includes("strictly decrease")), entries.length !== 0);
      }
    } finally { fs.rmSync(directory, { recursive: true }); }
  `));
  it("keeps all empty files in the default scan and rejects removing one", () =>
    check(`
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guard-empty-"));
    try {
      for (const rule of RATCHET_RULES) fs.writeFileSync(path.join(directory, rule + ".json"), "[]");
      const baseline = new Map(RATCHET_RULES.map(rule => [rule, []]));
      const runLint = request => {
        for (const rule of RATCHET_RULES) assert.ok(request.args.includes("t3code/" + rule));
        return Effect.succeed({ exitCode: 0, stdout: '{"diagnostics":[]}', stderr: "" });
      };
      const result = await Effect.runPromise(checkGuardExceptions({ cwd: directory, directory, baseline, runLint }));
      assert.equal(result.exitCode, 0);
      assert.equal(result.reports.length, RATCHET_RULES.length);
      fs.unlinkSync(path.join(directory, RATCHET_RULES[0] + ".json"));
      const error = await Effect.runPromise(checkGuardExceptions({ cwd: directory, directory, baseline, runLint }).pipe(Effect.flip));
      assert.equal(error.detail, "required ledger file is missing");
    } finally { fs.rmSync(directory, { recursive: true }); }
  `));
  it("compares the merge-base rather than the moving remote tip and fails on missing history", () =>
    check(`
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guard-git-"));
    const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git("init", "-b", "main");
      git("config", "user.name", "Guard fixture"); git("config", "user.email", "fixture@example.invalid");
      const ledgers = path.join(directory, "oxlint-plugin-t3code", "exceptions"); fs.mkdirSync(ledgers, { recursive: true });
      for (const rule of RATCHET_RULES) fs.writeFileSync(path.join(ledgers, rule + ".json"), JSON.stringify([entry, entry]));
      git("add", "."); git("commit", "-m", "baseline"); const ancestor = git("rev-parse", "HEAD");
      git("update-ref", "refs/remotes/origin/main", ancestor); git("checkout", "-b", "lane");
      fs.writeFileSync(path.join(ledgers, RATCHET_RULES[0] + ".json"), JSON.stringify([entry]));
      git("add", "."); git("commit", "-m", "lane removal");
      git("checkout", "main"); fs.writeFileSync(path.join(ledgers, RATCHET_RULES[0] + ".json"), "[]");
      git("add", "."); git("commit", "-m", "independent main removal"); git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      git("checkout", "lane");
      assert.equal(loadRatchetBaseline(directory, "origin/main").get(RATCHET_RULES[0]).length, 2);
      assert.throws(() => loadRatchetBaseline(directory, "missing-base"), /failed|ambiguous|valid/i);
    } finally { fs.rmSync(directory, { recursive: true }); }
  `));
  it("loads the push baseline from a shallow CI checkout, including a multi-commit push", () =>
    check(`
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guard-shallow-"));
    const source = path.join(directory, "source"); fs.mkdirSync(source);
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git(source, "init", "-b", "main"); git(source, "config", "user.name", "Guard fixture"); git(source, "config", "user.email", "fixture@example.invalid");
      const ledgers = path.join(source, "oxlint-plugin-t3code", "exceptions"); fs.mkdirSync(ledgers, { recursive: true });
      for (const rule of RATCHET_RULES) fs.writeFileSync(path.join(ledgers, rule + ".json"), JSON.stringify([entry, entry]));
      git(source, "add", "."); git(source, "commit", "-m", "before push"); const before = git(source, "rev-parse", "HEAD");
      fs.writeFileSync(path.join(ledgers, RATCHET_RULES[0] + ".json"), JSON.stringify([entry]));
      git(source, "add", "."); git(source, "commit", "-m", "first pushed commit");
      git(source, "commit", "--allow-empty", "-m", "last pushed commit");
      const checkout = path.join(directory, "checkout"); git(directory, "clone", "--depth=1", "file://" + source, checkout);
      assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "true");
      const eventPath = path.join(directory, "event.json"); fs.writeFileSync(eventPath, JSON.stringify({ before }));
      process.env.GITHUB_ACTIONS = "true"; process.env.GITHUB_EVENT_PATH = eventPath; process.env.CI = "true";
      assert.equal(loadRatchetBaseline(checkout, "origin/main").get(RATCHET_RULES[0]).length, 2);
      assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "false");
      fs.writeFileSync(eventPath, JSON.stringify({ before: "0".repeat(40), pull_request: { base: { sha: before } } }));
      assert.equal(loadRatchetBaseline(checkout, "origin/main").get(RATCHET_RULES[0]).length, 2);
      fs.writeFileSync(eventPath, JSON.stringify({ before: "0".repeat(40) }));
      assert.throws(() => loadRatchetBaseline(checkout, "origin/main"), /valid previous main/);
    } finally { fs.rmSync(directory, { recursive: true }); }
  `));
  it("admits only the enrollment commit and never replays admission after removal", () =>
    check(`
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "failure-admission-"));
    const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git("init", "-b", "main"); git("config", "user.name", "Guard fixture"); git("config", "user.email", "fixture@example.invalid");
      const ledgers = path.join(directory, "oxlint-plugin-t3code", "exceptions"); fs.mkdirSync(ledgers, { recursive: true });
      const ruleFile = path.join(directory, "oxlint-plugin-t3code", "rules", "no-failure-to-empty.ts"); fs.mkdirSync(path.dirname(ruleFile));
      fs.writeFileSync(ruleFile, 'const roots = ["apps/web/src/zerops/"];');
      for (const rule of RATCHET_RULES) fs.writeFileSync(path.join(ledgers, rule + ".json"), "[]");
      git("add", "."); git("commit", "-m", "before enrollment"); const before = git("rev-parse", "HEAD");
      const snapshot = path.join(directory, "oxlint-plugin-t3code", "failure-to-empty-enrollment.json");
      const ledger = path.join(ledgers, "no-failure-to-empty.json");
      const admitted = { ...entry, class: "review" };
      fs.writeFileSync(ruleFile, 'const roots = ["apps/web/src/", "packages/client-runtime/src/data/"];');
      fs.writeFileSync(snapshot, JSON.stringify([admitted])); fs.writeFileSync(ledger, JSON.stringify([admitted]));
      assert.deepEqual(ratchetAdditions([admitted], loadRatchetBaseline(directory, before).get("no-failure-to-empty")), []);
      git("add", "."); git("commit", "-m", "enroll roots and baseline"); const enrollment = git("rev-parse", "HEAD");
      fs.writeFileSync(snapshot, JSON.stringify([admitted, admitted])); fs.writeFileSync(ledger, JSON.stringify([admitted, admitted]));
      git("add", "."); git("commit", "-m", "attempt to extend snapshot");
      assert.equal(ratchetAdditions([admitted, admitted], loadRatchetBaseline(directory, before).get("no-failure-to-empty")).length, 1);
      assert.equal(ratchetAdditions([admitted, admitted], loadRatchetBaseline(directory, enrollment).get("no-failure-to-empty")).length, 1);
      fs.writeFileSync(ledger, "[]"); git("add", "."); git("commit", "-m", "remove all debt"); const cleared = git("rev-parse", "HEAD");
      fs.writeFileSync(ledger, JSON.stringify([admitted]));
      assert.equal(ratchetAdditions([admitted], loadRatchetBaseline(directory, cleared).get("no-failure-to-empty")).length, 1);
      git("checkout", "-f", before);
      fs.writeFileSync(snapshot, JSON.stringify([admitted])); fs.writeFileSync(ledger, JSON.stringify([admitted]));
      assert.throws(() => loadRatchetBaseline(directory, before), /accompany/);
      fs.writeFileSync(ruleFile, 'const roots = ["apps/web/src/", "packages/client-runtime/src/data/"];');
      fs.writeFileSync(snapshot, JSON.stringify([{ ...admitted, path: "apps/mobile/src/one.ts" }]));
      assert.throws(() => loadRatchetBaseline(directory, before), /newly guarded/);
      fs.writeFileSync(snapshot, JSON.stringify([admitted, admitted]));
      assert.throws(() => loadRatchetBaseline(directory, before), /match the ledger/);
    } finally { fs.rmSync(directory, { recursive: true }); }
  `));
});
