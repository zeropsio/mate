// @effect-diagnostics nodeBuiltinImport:off -- isolated Git repositories exercise the host guard.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { checkTestSentences, collectTestTitles } from "./check-test-sentences.ts";

function fixture(run: (repo: ReturnType<typeof repository>) => void): void {
  const repo = repository();
  try {
    run(repo);
  } finally {
    NodeFS.rmSync(repo.root, { recursive: true, force: true });
  }
}

function repository() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-sentences-"));
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const write = (path: string, source: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, path), source);
  };
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "--allow-empty", "-qm", message);
  };
  git("init", "-q");
  git("config", "user.name", "Sentence fixture");
  git("config", "user.email", "sentence@example.test");
  write("old.test.ts", 'it("routine memory reclaim shows no notice", () => {});');
  commit("baseline");
  git("branch", "origin/main");
  return { root, git, write, commit };
}

function installCli(root: string): void {
  const scripts = NodePath.join(root, "scripts");
  NodeFS.mkdirSync(scripts);
  for (const name of ["check-test-sentences.ts", "gate-changed.ts", "chat-gate.ts", "gate-log.ts"])
    NodeFS.copyFileSync(NodePath.join(import.meta.dirname, name), NodePath.join(scripts, name));
  NodeFS.symlinkSync(
    NodePath.join(import.meta.dirname, "node_modules"),
    NodePath.join(scripts, "node_modules"),
  );
}

it.each([
  { change: "deleted", expected: ["routine memory reclaim shows no notice"] },
  { change: "renamed", expected: ["routine memory reclaim shows no notice"] },
  { change: "moved", expected: [] },
  { change: "approved", expected: [] },
  { change: "layer", expected: ["routine memory reclaim shows no notice"] },
])("a test sentence cannot disappear without approval ($change)", ({ change, expected }) => {
  fixture(({ root, write, commit, git }) => {
    if (change === "layer") {
      write(
        "old.test.ts",
        'it.layer(services)("routine memory reclaim shows no notice", () => {});',
      );
      commit("layer baseline");
      git("branch", "-f", "origin/main");
    }
    NodeFS.unlinkSync(NodePath.join(root, "old.test.ts"));
    expect(checkTestSentences(root, "origin/main")).toEqual([
      "routine memory reclaim shows no notice",
    ]);
    if (change === "renamed") write("old.test.ts", 'it("reclaim is quiet", () => {});');
    if (change === "moved")
      write(
        "elsewhere/new.scenario.ts",
        'test("routine memory reclaim shows no notice", () => {});',
      );
    commit(
      change === "approved"
        ? "remove approved behaviour\n\nDrops-test: routine memory reclaim shows no notice"
        : change,
    );
    expect(checkTestSentences(root, "origin/main")).toEqual(expected);
  });
});

it("conditional test sentences cannot disappear without approval", () => {
  fixture(({ root, write, commit, git }) => {
    write(
      "old.test.ts",
      [
        'it.skipIf(platformUnsupported)("only treats a missing log file as an empty current size", () => {});',
        'test.runIf(featureEnabled)("enabled features retain their behaviour", () => {});',
        'describe.skipIf(platformUnsupported)("unsupported platforms keep their contract", () => {});',
        'describe.runIf(featureEnabled)("enabled suites retain their contract", () => {});',
        'it.skipIf(platformUnsupported).each([1])("conditional case %s stays protected", () => {});',
      ].join("\n"),
    );
    commit("conditional baseline");
    git("branch", "-f", "origin/main");
    write("old.test.ts", "export {};");
    expect(checkTestSentences(root, "origin/main")).toEqual([
      "conditional case %s stays protected",
      "enabled features retain their behaviour",
      "enabled suites retain their contract",
      "only treats a missing log file as an empty current size",
      "unsupported platforms keep their contract",
    ]);
  });
});

it("conditional setup arguments are not test sentences", () => {
  const source = [
    'it.skipIf("skip reason")("skipped behaviour stays protected", () => {});',
    'test.runIf("run reason")("conditional behaviour stays protected", () => {});',
  ].join("\n");
  expect([...collectTestTitles(source, "conditional.test.ts")]).toEqual([
    "skipped behaviour stays protected",
    "conditional behaviour stays protected",
  ]);
});

it("parameterized and computed test sentences cannot disappear without approval", () => {
  fixture(({ root, write, commit, git }) => {
    write(
      "old.test.ts",
      [
        'it.for([1])("decision", () => {});',
        'test["skip"]("computed decision", () => {});',
        'describe["only"]("computed suite", () => {});',
        'test["each"]([1])("computed table %s", () => {});',
      ].join("\n"),
    );
    commit("parameterized and computed baseline");
    git("branch", "-f", "origin/main");
    write("old.test.ts", "export {};");
    expect(checkTestSentences(root, "origin/main")).toEqual([
      "computed decision",
      "computed suite",
      "computed table %s",
      "decision",
    ]);
  });
});

it("parameterized and computed setup arguments are not test sentences", () => {
  const source = [
    'it.for("table data")("parameterized decision", () => {});',
    'test["runIf"]("run reason")("computed decision", () => {});',
  ].join("\n");
  expect([...collectTestTitles(source, "parameterized.test.ts")]).toEqual([
    "parameterized decision",
    "computed decision",
  ]);
});

it("test sentences retain modifier and each template titles without inventing tests in strings", () => {
  const source = [
    'describe("resource notices", () => {',
    'it.effect("routine reclaim is quiet", () => {});',
    'test.skip("no stale labels", () => {});',
    'it.each([1, 2])("budget %s stays visible", () => {});',
    'it.each`value\n${1}`("budget $value stays visible", () => {});',
    'describe.each([1])("group %s", () => {});',
    "test(`literal title`, () => {});",
    '// it("comment fiction", () => {});',
    'const fixture = `it("string fiction", () => {}); ${"text"}`;',
    'const quote = "test(\\\"quoted fiction\\\", () => {})";',
    "test(dynamicTitle, () => {});",
    'const view = <div>it("JSX fiction");</div>;',
    "});",
  ].join("\n");
  expect([...collectTestTitles(source, "examples.test.tsx")]).toEqual([
    "resource notices",
    "routine reclaim is quiet",
    "no stale labels",
    "budget %s stays visible",
    "budget $value stays visible",
    "group %s",
    "literal title",
  ]);
});

it("committed, staged, dirty, deleted and untracked test files share sentence retention", () => {
  fixture(({ root, write, git, commit }) => {
    write("committed.test.tsx", 'describe("committed", () => {});');
    write("staged.test.ts", 'it("staged", () => {});');
    write("dirty.scenario.ts", 'test("dirty", () => {});');
    commit("more baseline sentences");
    git("branch", "-f", "origin/main");
    write("committed.test.tsx", "export {};");
    commit("remove committed");
    write("staged.test.ts", "export {};");
    git("add", "staged.test.ts");
    write("dirty.scenario.ts", "export {};");
    NodeFS.unlinkSync(NodePath.join(root, "old.test.ts"));
    expect(checkTestSentences(root, "origin/main")).toEqual([
      "committed",
      "dirty",
      "routine memory reclaim shows no notice",
      "staged",
    ]);
    write(
      "untracked.test.ts",
      [
        'it("committed", () => {});',
        'it("dirty", () => {});',
        'it("routine memory reclaim shows no notice", () => {});',
        'it("staged", () => {});',
      ].join("\n"),
    );
    expect(checkTestSentences(root, "origin/main")).toEqual([]);
  });
});

it("only exact Drops-test trailers in the comparison range approve removed sentences", () => {
  fixture(({ root, write, commit, git }) => {
    commit("baseline approval\n\nDrops-test: routine memory reclaim shows no notice");
    git("branch", "-f", "origin/main");
    write("old.test.ts", "export {};");
    commit(
      "a quoted approval is not a trailer\n\nDrops-test: routine memory reclaim shows no notice\n\nUnrelated final paragraph.",
    );
    commit("near match\n\nDrops-test: routine memory reclaim shows no notices");
    expect(checkTestSentences(root, "origin/main")).toEqual([
      "routine memory reclaim shows no notice",
    ]);
    commit("approved\n\nDrops-test: routine memory reclaim shows no notice");
    expect(checkTestSentences(root, "origin/main")).toEqual([]);
  });
});

it("an explicit base controls both sentence comparison and approval history", () => {
  fixture(({ root, write, commit, git }) => {
    write("old.test.ts", 'it("replacement behaviour", () => {});');
    commit("approved replacement\n\nDrops-test: routine memory reclaim shows no notice");
    git("branch", "selected");
    write("old.test.ts", "export {};");
    expect(checkTestSentences(root, "selected")).toEqual(["replacement behaviour"]);
  });
});

it("malformed test source and missing history fail instead of granting approval", () => {
  fixture(({ root, write }) => {
    write("old.test.ts", 'it("broken syntax",');
    expect(() => checkTestSentences(root, "origin/main")).toThrow("old.test.ts:");
    expect(() => checkTestSentences(root, "missing-ref")).toThrow();
  });
});

it("GitHub main pushes check every pushed commit even when origin/main equals HEAD", () => {
  fixture(({ root, write, git, commit }) => {
    const before = git("rev-parse", "HEAD");
    write("old.test.ts", "export {};");
    commit("drop sentence");
    write("unrelated.ts", "export {};");
    commit("another pushed commit");
    git("branch", "-f", "origin/main");
    installCli(root);
    const event = NodePath.join(root, "event.json");
    NodeFS.writeFileSync(event, JSON.stringify({ before }));
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/check-test-sentences.ts"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: event },
      },
    );
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      "Dropped test sentence: routine memory reclaim shows no notice",
    );
  });
});

it("the lane gate lists its chosen comparison and stops on unapproved test removals", () => {
  fixture(({ root, write, commit, git }) => {
    installCli(root);
    for (const directory of ["apps", "packages", "infra"])
      NodeFS.mkdirSync(NodePath.join(root, directory));
    // Other guards are outside this fixture's concern; sentence retention runs through the real runner.
    write("scripts/check-guard-exceptions.ts", "process.exitCode = 0;");
    write("scripts/check-runtime-cycles.ts", "process.exitCode = 0;");
    commit("gate fixture");
    const base = git("rev-parse", "HEAD");
    write("old.test.ts", "export {};");
    const run = (extra: string[]) =>
      NodeChildProcess.spawnSync(
        process.execPath,
        ["scripts/gate-changed.ts", "--base", base, ...extra],
        { cwd: root, encoding: "utf8" },
      );
    const listed = run(["--list"]);
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).toContain(
      `test sentence retention: node scripts/check-test-sentences.ts --base ${base}`,
    );
    const checked = run([]);
    expect(checked.status, checked.stderr).toBe(1);
    expect(checked.stdout).toContain("FAIL test sentence retention");
    expect(checked.stderr).toContain(
      "Dropped test sentence: routine memory reclaim shows no notice",
    );
    expect(checked.stdout).not.toContain("ok check touched files");
  });
});

it("GitHub pull requests compare against their base and missing event history fails closed", () => {
  fixture(({ root, write, commit, git }) => {
    const sha = git("rev-parse", "HEAD");
    write("old.test.ts", "export {};");
    commit("drop sentence");
    git("branch", "-f", "origin/main");
    expect(checkTestSentences(root, "origin/main")).toEqual([]);
    expect(checkTestSentences(root, sha)).toEqual(["routine memory reclaim shows no notice"]);
    installCli(root);
    const event = NodePath.join(root, "event.json");
    const run = () =>
      NodeChildProcess.spawnSync(process.execPath, ["scripts/check-test-sentences.ts"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: event },
      });
    NodeFS.writeFileSync(event, JSON.stringify({ pull_request: { base: { sha } } }));
    const pr = run();
    expect(pr.status, pr.stderr).toBe(1);
    expect(pr.stderr).toContain("Dropped test sentence: routine memory reclaim shows no notice");
    NodeFS.writeFileSync(event, JSON.stringify({ before: "0".repeat(40) }));
    expect(run().stderr).toContain("needs a valid previous main or PR base commit");
    NodeFS.writeFileSync(event, JSON.stringify({ before: "f".repeat(40) }));
    const missing = run();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Not a valid commit name");
    NodeFS.writeFileSync(NodePath.join(root, ".git/shallow"), git("rev-parse", "HEAD") + "\n");
    expect(run().stderr).toContain("needs full Git history");
  });
});

it("extra spaces in a Drops-test title do not approve a different sentence", () => {
  fixture(({ root, write, commit }) => {
    write("old.test.ts", "export {};");
    commit("different title\n\nDrops-test:  routine memory reclaim shows no notice");
    commit("different trailer spelling\n\nDrops-test : routine memory reclaim shows no notice");
    expect(checkTestSentences(root, "origin/main")).toEqual([
      "routine memory reclaim shows no notice",
    ]);
    commit("exact approval\n\nDrops-test: routine memory reclaim shows no notice");
    expect(checkTestSentences(root, "origin/main")).toEqual([]);
  });
});
