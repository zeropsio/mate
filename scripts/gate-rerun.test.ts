// @effect-diagnostics nodeBuiltinImport:off -- real gate CLI with disposable command fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { hashPackageTrees } from "./lib/guard-cache.ts";
import { stateOnlySmoke } from "./state-smoke-cases.ts";

const gateRunnerFiles = [
  "gate-changed.ts",
  "ci-blame.ts",
  "state-smoke-cases.ts",
  "gate-file-inputs.ts",
  "gate-input-scopes.ts",
  "gate-installed-dependencies.ts",
  "chat-gate.ts",
  "gate-log.ts",
  "gate-slots.ts",
  "test-process-lock.ts",
  "test-process-lock-holder.ts",
];

interface Check {
  readonly command: string;
  readonly cwd: string;
  readonly args: string[];
}

function fixture(assertion: (gate: ReturnType<typeof createFixture>) => void) {
  const gate = createFixture();
  try {
    assertion(gate);
  } finally {
    NodeFS.rmSync(gate.root, { recursive: true, force: true });
  }
}

function createFixture(cacheHome?: string) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-rerun-"));
  const write = (path: string, text: string) => {
    const absolute = NodePath.join(root, path);
    NodeFS.mkdirSync(NodePath.dirname(absolute), { recursive: true });
    NodeFS.writeFileSync(absolute, text);
  };
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  for (const directory of ["scripts", "apps", "packages", "infra", "node_modules/.bin"])
    NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
  for (const file of gateRunnerFiles)
    NodeFS.copyFileSync(
      NodePath.join(import.meta.dirname, file),
      NodePath.join(root, "scripts", file),
    );
  if (cacheHome) {
    for (const name of ["@t3tools", "oxc-parser", "lightningcss", "parse5"]) {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, "scripts/node_modules", name)), {
        recursive: true,
      });
      NodeFS.symlinkSync(
        NodePath.join(import.meta.dirname, "node_modules", name),
        NodePath.join(root, "scripts/node_modules", name),
      );
    }
    for (const name of ["vite-plus", "madge", "effect", "@effect/platform-node"]) {
      write(`scripts/node_modules/${name}/package.json`, JSON.stringify({ name }));
    }
    NodeFS.mkdirSync(NodePath.join(root, "scripts/lib"), { recursive: true });
    NodeFS.symlinkSync(
      NodePath.join(import.meta.dirname, "node_modules"),
      NodePath.join(root, "scripts/lib/node_modules"),
    );
  } else {
    NodeFS.symlinkSync(
      NodePath.join(import.meta.dirname, "node_modules"),
      NodePath.join(root, "scripts/node_modules"),
    );
  }
  const stub = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
if (command === "vp" && args[0] === "--version") {
  console.log("fixture-vp-v1");
  process.exit(0);
}
if (command === "vp" && args[0] === "lint") {
  if (args[1] === "--version") console.log("Version: fixture-v1");
  if (args[1] === "--print-config") console.log(JSON.stringify({ jsPlugins: [] }));
  if (args[1] === "--debug=files") {
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\\.tsx?$/.test(file)) console.log(file);
      }
    };
    args.slice(2).forEach(walk);
  }
  process.exit(0);
}
const cwd = path.relative(process.env.GATE_FIXTURE_ROOT, process.cwd()) || ".";
fs.appendFileSync(path.join(process.env.GATE_FIXTURE_ROOT, "checks.log"), JSON.stringify({ command, cwd, args }) + "\\n");
const fail = process.env.GATE_FIXTURE_FAIL;
if (command === "vp" && (fail === "check" && args[0] === "check" || fail === "smoke" && args.includes("--testNamePattern") || fail === "typecheck:" + cwd && args[0] === "exec")) process.exit(9);
`;
  for (const command of ["node", "vp"]) {
    write(`node_modules/.bin/${command}`, stub);
    NodeFS.chmodSync(NodePath.join(root, "node_modules/.bin", command), 0o755);
  }
  if (cacheHome) {
    NodeFS.rmSync(NodePath.join(root, "node_modules/.bin/node"));
    NodeFS.mkdirSync(NodePath.join(root, "scripts/lib"), { recursive: true });
    NodeFS.copyFileSync(
      NodePath.join(import.meta.dirname, "lib/guard-cache.ts"),
      NodePath.join(root, "scripts/lib/guard-cache.ts"),
    );
    const script = `const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(path.join(process.env.GATE_FIXTURE_ROOT, "checks.log"), JSON.stringify({ command: "node", cwd: ".", args: [path.relative(process.cwd(), process.argv[1]), ...process.argv.slice(2)] }) + "\\n");
`;
    for (const name of [
      "check-guard-exceptions",
      "check-runtime-cycles",
      "check-test-sentences",
      "check-test-clock",
    ])
      write(`scripts/${name}.ts`, script);
  }
  write(
    ".gitignore",
    "node_modules/\nchecks.log\n.gate-receipt.json*\napps/web/src/components.json\n",
  );
  write("README.md", "before\n");
  for (const path of Object.keys(stateOnlySmoke)) write(path, "export {};\n");
  const baseline = () => {
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    git("add", ".");
    git("commit", "-qm", "base");
    git("branch", "base");
  };
  const run = (args: string[] = [], fail = "") => {
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "base", ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: [NodePath.dirname(process.execPath), process.env.PATH ?? ""].join(
            NodePath.delimiter,
          ),
          HOME: cacheHome ?? process.env.HOME,
          // The repository vp wrapper sets NODE_PATH; these fake installs have their own modules.
          NODE_PATH: cacheHome ? "" : process.env.NODE_PATH,
          XDG_CACHE_HOME: cacheHome
            ? NodePath.join(cacheHome, ".cache")
            : process.env.XDG_CACHE_HOME,
          CI: "",
          GITHUB_ACTIONS: "",
          GATE_FIXTURE_ROOT: root,
          GATE_FIXTURE_FAIL: fail,
          NODE_COMPILE_CACHE: NodePath.join(root, "node_modules/.cache/node"),
        },
      },
    );
    return result;
  };
  const checks = (): Check[] =>
    NodeFS.existsSync(NodePath.join(root, "checks.log"))
      ? NodeFS.readFileSync(NodePath.join(root, "checks.log"), "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Check)
      : [];
  const clearChecks = () => NodeFS.rmSync(NodePath.join(root, "checks.log"), { force: true });
  const clearReceipt = () =>
    NodeFS.rmSync(NodePath.join(root, ".gate-receipt.json"), { force: true });
  return { root, write, git, baseline, run, checks, clearChecks, clearReceipt };
}

describe("revision-bound witness receipts", () => {
  let gate: ReturnType<typeof createFixture>;
  const dependency = "apps/web/src/witness.ts";
  const directory = "apps/web/test/scenarios/areas/b-menu";
  const edited = `${directory}/edited.scenario.ts`;
  const unrelated = `${directory}/unrelated.scenario.ts`;
  const related = Array.from(
    { length: 10 },
    (_, index) => `${directory}/related-${index}.scenario.ts`,
  );
  const receipt = () =>
    JSON.parse(NodeFS.readFileSync(NodePath.join(gate.root, ".gate-receipt.json"), "utf8")) as {
      headSha: string;
      baseSha: string;
      selectionMs: number;
      completed: boolean;
      selectedStages: { name: string; args: string[] }[];
      omittedWitnesses: { file: string; kind: string; reason: string; cases?: string[] }[];
    };

  beforeAll(() => {
    gate = createFixture();
    gate.write(dependency, "export const witness = 0;\n");
    gate.write(edited, "export {};\n");
    gate.write(unrelated, "export {};\n");
    for (const file of related) gate.write(file, 'import "../../../../src/witness.ts";\n');
    gate.baseline();
  });
  afterAll(() => NodeFS.rmSync(gate.root, { recursive: true, force: true }));

  it("a changed scenario runs without opting in, even when only its comment changes", () => {
    gate.write(edited, "export {}; // updated comment\n");
    const result = gate.run();
    expect(result.status, result.stderr).toBe(0);
    expect(receipt()).toMatchObject({
      version: 1,
      context: "gate",
      headSha: gate.git("rev-parse", "HEAD"),
      baseSha: gate.git("rev-parse", "base"),
      paths: [edited],
    });
    expect(Number.isFinite(receipt().selectionMs)).toBe(true);
    expect(receipt().selectedStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "edited scenario files",
          args: expect.arrayContaining(["test/scenarios/areas/b-menu/edited.scenario.ts"]),
        }),
      ]),
    );
    expect(
      gate.checks().some((check) => check.args.includes(NodePath.join(gate.root, edited))),
    ).toBe(true);
  });

  it("an unknown selection manifest version cannot reuse a gate receipt or its stages", () => {
    gate.write(edited, "export {}; // unknown version\n");
    expect(gate.run(["--force"]).status).toBe(0);
    const receiptPath = NodePath.join(gate.root, ".gate-receipt.json");
    NodeFS.writeFileSync(receiptPath, JSON.stringify({ ...receipt(), version: 2 }));
    gate.clearChecks();
    const result = gate.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("reused receipt");
    expect(result.stdout).not.toContain("reused stage:");
    expect(gate.checks().length).toBeGreaterThan(0);
  });

  it("a different HEAD creates a new verdict while unchanged stages are reused", () => {
    gate.write(edited, "export {};\n");
    gate.write("README.md", "after\n");
    const first = gate.run();
    expect(first.status, first.stderr).toBe(0);
    const oldHead = gate.git("rev-parse", "HEAD");
    expect(receipt().headSha).toBe(oldHead);
    gate.git("commit", "--allow-empty", "-qm", "new revision");
    const head = gate.git("rev-parse", "HEAD");
    gate.clearChecks();
    const newHead = gate.run();
    expect(newHead.status, newHead.stderr).toBe(0);
    expect(newHead.stdout).not.toContain("reused receipt");
    expect(newHead.stdout).toContain("reused stage:");
    expect(gate.checks()).toEqual([]);
    expect(receipt().headSha).toBe(head);
    expect(receipt().baseSha).toBe(gate.git("rev-parse", "base"));
    expect(head).not.toBe(oldHead);
  });

  it("a different diff base creates a new verdict while unchanged stages are reused", () => {
    gate.write(edited, "export {};\n");
    gate.write("README.md", "after\n");
    gate.git("commit", "--allow-empty", "-qm", "same tree for a new base");
    const head = gate.git("rev-parse", "HEAD");
    const first = gate.run();
    expect(first.status, first.stderr).toBe(0);
    gate.clearChecks();
    const newBase = gate.run(["--base", "HEAD"]);
    expect(newBase.status, newBase.stderr).toBe(0);
    expect(newBase.stdout).not.toContain("reused receipt");
    expect(newBase.stdout).toContain("reused stage:");
    expect(gate.checks()).toEqual([]);
    expect(receipt().baseSha).toBe(head);
  });

  it("the receipt and final line disclose opted-out affected witnesses", () => {
    gate.write(edited, "export {};\n");
    gate.write(dependency, "export const witness = 1;\n");
    const defaultRun = gate.run();
    expect(defaultRun.status, defaultRun.stderr).toBe(0);
    expect(receipt().omittedWitnesses).toEqual(
      expect.arrayContaining([
        { file: related[0], kind: "scenario", reason: "opt-out" },
        { file: unrelated, kind: "scenario", reason: "unrelated" },
        {
          file: Object.keys(stateOnlySmoke)[0],
          kind: "smoke",
          reason: "opt-out",
          cases: Object.values(stateOnlySmoke)[0],
        },
      ]),
    );
    const omitted = receipt().omittedWitnesses;
    expect(
      omitted
        .filter((entry) => entry.kind === "scenario" && entry.reason === "opt-out")
        .map((entry) => entry.file)
        .sort(),
    ).toEqual(related);
    expect(
      omitted
        .filter((entry) => entry.kind === "smoke" && entry.reason === "opt-out")
        .map((entry) => entry.file)
        .sort(),
    ).toEqual(Object.keys(stateOnlySmoke).sort());
    expect(omitted).toContainEqual({ file: unrelated, kind: "scenario", reason: "unrelated" });
    expect(defaultRun.stdout.trim().split("\n").at(-1)).toBe("13 affected witnesses omitted");
    const reused = gate.run();
    expect(reused.stdout.trim().split("\n").at(-1)).toBe("13 affected witnesses omitted");
    const failed = gate.run(["--force"], "check");
    expect(failed.status).toBe(9);
    expect(failed.stdout.trim().split("\n").at(-1)).toBe("13 affected witnesses omitted");
    expect(receipt().completed).toBe(false);
  });

  it("the receipt and final line disclose capped affected witnesses", () => {
    gate.write(edited, "export {};\n");
    gate.write(dependency, "export const witness = 1;\n");
    const capped = gate.run(["--with-scenarios"]);
    expect(capped.status, capped.stderr).toBe(0);
    expect(receipt().omittedWitnesses).toEqual(
      expect.arrayContaining([
        { file: related[8], kind: "scenario", reason: "cap" },
        { file: related[9], kind: "scenario", reason: "cap" },
      ]),
    );
    expect(
      receipt()
        .omittedWitnesses.filter((entry) => entry.kind === "scenario" && entry.reason === "cap")
        .map((entry) => entry.file)
        .sort(),
    ).toEqual(related.slice(8));
    expect(
      receipt()
        .selectedStages.find((stage) => stage.name === "edited scenario files")
        ?.args.slice(-8),
    ).toEqual(related.slice(0, 8).map((file) => file.replace(/^apps\/web\//u, "")));
    expect(capped.stdout.trim().split("\n").at(-1)).toBe("2 affected witnesses omitted");
  });
});

describe("shared guard and cycle receipts", () => {
  let home: string;
  let first: ReturnType<typeof createFixture>;
  let second: ReturnType<typeof createFixture>;

  beforeAll(() => {
    home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-shared-"));
    first = createFixture(home);
    second = createFixture(home);
    for (const gate of [first, second]) {
      gate.write("oxlint-plugin-t3code/failure-to-empty-enrollment.json", "[]\n");
      gate.write("apps/web/src/example.ts", "export const value = 0;\n");
      gate.baseline();
      gate.write("README.md", "after\n");
    }
  });
  afterAll(() => {
    for (const path of [first.root, second.root, home])
      NodeFS.rmSync(path, { recursive: true, force: true });
  });

  it("shares results across worktrees and reruns both checks after one source byte changes", () => {
    for (const gate of [first, second]) {
      gate.write("apps/web/src/example.ts", "export const value = 1;\n");
      gate.clearReceipt();
      gate.clearChecks();
    }
    expect(first.run().status).toBe(0);
    const reused = second.run();
    expect(reused.status, reused.stderr).toBe(0);
    expect(reused.stdout).toContain("reused stage: guard ledgers");
    expect(reused.stdout).toContain("reused stage: runtime cycle ratchet");
    second.clearChecks();
    second.write("apps/web/src/example.ts", "export const value = 2;\n");
    const changed = second.run();
    expect(changed.status, changed.stderr).toBe(0);
    expect(changed.stdout).not.toContain("reused stage: guard ledgers");
    expect(changed.stdout).not.toContain("reused stage: runtime cycle ratchet");
    expect(
      second.checks().filter((check) => check.args[0] === "scripts/check-guard-exceptions.ts"),
    ).toHaveLength(1);
    expect(
      second.checks().filter((check) => check.args[0] === "scripts/check-runtime-cycles.ts"),
    ).toHaveLength(1);
  });

  it("invalidates a shared guard result after an ignored components config changes", () => {
    for (const gate of [first, second]) {
      gate.write("apps/web/src/example.ts", "export const value = 3;\n");
      gate.write("apps/web/src/components.json", "{}\n");
      gate.clearReceipt();
      gate.clearChecks();
    }
    expect(first.run().status).toBe(0);
    expect(second.run().stdout).toContain("reused stage: guard ledgers");
    second.clearChecks();
    second.write("apps/web/src/components.json", "{} \n");
    const changed = second.run();
    expect(changed.status, changed.stderr).toBe(0);
    expect(
      second.checks().filter((check) => check.args[0] === "scripts/check-guard-exceptions.ts"),
    ).toHaveLength(1);
  });

  it("fingerprints installed dependency bytes as well as their package names", () => {
    const pkg = "node_modules/stage-cache-fixture";
    first.write(`${pkg}/package.json`, '{"name":"fixture"}');
    first.write(`${pkg}/index.js`, "1");
    const manifest = NodePath.join(first.root, pkg, "package.json");
    const before = hashPackageTrees([manifest], true);
    first.write(`${pkg}/index.js`, "2");
    expect(hashPackageTrees([manifest], true)).not.toBe(before);
  });
});

it("Decision: a gate re-run never repeats stages that passed on unchanged files.", () => {
  fixture((gate) => {
    gate.baseline();
    gate.write("README.md", "after\n");
    const failed = gate.run([], "check");
    expect(failed.status, failed.stderr).toBe(9);
    expect(gate.checks().map((check) => check.command)).toEqual(["node", "node", "node", "vp"]);
    gate.clearChecks();
    const retried = gate.run();
    expect(retried.status, retried.stderr).toBe(0);
    expect(gate.checks().map((check) => check.command)).toEqual(["vp"]);
    expect(gate.checks()[0]?.args).toEqual([
      "check",
      "--no-error-on-unmatched-pattern",
      "README.md",
    ]);
    gate.clearChecks();
    expect(gate.run().status).toBe(0);
    expect(gate.checks()).toEqual([]);
  });
});

it("editing a nested changed dependency reruns its consumer and package readers while an unrelated package stays passed", () => {
  fixture((gate) => {
    for (const name of ["a", "b"])
      gate.write(
        `packages/${name}/package.json`,
        JSON.stringify({
          name: `@fixture/${name}`,
          type: "module",
          exports: { ".": "./src/index.ts" },
          scripts: { typecheck: "tsc --noEmit" },
        }),
      );
    gate.write(
      "apps/reader/package.json",
      JSON.stringify({
        name: "@fixture/reader",
        type: "module",
        scripts: { typecheck: "tsc --noEmit" },
        dependencies: { "@fixture/a": "workspace:*" },
      }),
    );
    gate.write("packages/a/src/index.ts", 'export { value } from "./leaf.ts";\n');
    gate.write("packages/a/src/leaf.ts", "export const value = 0;\n");
    gate.write(
      "packages/a/src/index.test.ts",
      'import { value } from "./index.ts";\nvoid value;\n',
    );
    gate.write("packages/b/src/index.ts", "export const value = 0;\n");
    gate.write("apps/reader/src/read.ts", 'import { value } from "@fixture/a";\nvoid value;\n');
    gate.baseline();
    gate.write(
      "packages/a/src/index.ts",
      'export { value } from "./leaf.ts";\nexport const second = 1;\n',
    );
    gate.write("packages/a/src/leaf.ts", "export const value = 1;\n");
    gate.write("packages/b/src/index.ts", "export const value = 1;\n");
    const first = gate.run();
    expect(first.status, first.stderr).toBe(0);
    gate.clearChecks();
    gate.write("packages/a/src/leaf.ts", "export const value = 2;\n");
    const edited = gate.run();
    expect(edited.status, edited.stderr).toBe(0);
    const typechecks = gate.checks().filter((check) => check.args[0] === "exec");
    expect(typechecks.map((check) => check.cwd).sort()).toEqual(["apps/reader", "packages/a"]);
    expect(gate.checks().some((check) => check.args.includes("packages/a/src/index.test.ts"))).toBe(
      true,
    );
  });
});

it("--full reruns every selected stage even after an unchanged passing run", () => {
  fixture((gate) => {
    gate.baseline();
    gate.write("README.md", "after\n");
    expect(gate.run().status).toBe(0);
    const first = gate.checks();
    gate.clearChecks();
    const full = gate.run(["--full"]);
    expect(full.status, full.stderr).toBe(0);
    expect(gate.checks()).toEqual(first);
  });
});

it("a failed earlier stage preserves the passing receipts of unchanged later stages", () => {
  fixture((gate) => {
    for (const name of ["a", "b"]) {
      gate.write(
        `packages/${name}/package.json`,
        JSON.stringify({
          name: `@fixture/${name}`,
          scripts: { typecheck: "tsc --noEmit" },
        }),
      );
      gate.write(`packages/${name}/src/value.ts`, "export const value = 0;\n");
    }
    gate.baseline();
    for (const name of ["a", "b"])
      gate.write(`packages/${name}/src/value.ts`, "export const value = 1;\n");
    const first = gate.run();
    expect(first.status, first.stderr).toBe(0);
    gate.write("packages/a/src/value.ts", "export const value = 2;\n");
    const failed = gate.run([], "typecheck:packages/a");
    expect(failed.status, failed.stderr).toBe(9);
    gate.clearChecks();
    const retried = gate.run();
    expect(retried.status, retried.stderr).toBe(0);
    expect(
      gate
        .checks()
        .filter((check) => check.args[0] === "exec")
        .map((check) => check.cwd),
    ).toEqual(["packages/a"]);
    expect(gate.checks()).toHaveLength(1);
  });
});

it("a browser retry acquires a new slot and reruns only its failed smoke stage", () => {
  fixture((gate) => {
    gate.write("packages/a/src/value.ts", "export const value = 0;\n");
    gate.baseline();
    gate.write("packages/a/src/value.ts", "export const value = 1;\n");
    const failed = gate.run(["--with-scenarios"], "smoke");
    expect(failed.status, failed.stderr).toBe(9);
    expect(failed.stdout).toContain("acquired browser/scenario slot");
    gate.clearChecks();
    const retried = gate.run(["--with-scenarios"]);
    expect(retried.status, retried.stderr).toBe(0);
    expect(retried.stdout).toContain("acquired browser/scenario slot");
    expect(gate.checks()).toHaveLength(1);
    expect(gate.checks()[0]?.args).toContain("--testNamePattern");
  });
});

it("remapping a named barrel export reruns its consumer even when the leaf stays unchanged", () => {
  fixture((gate) => {
    gate.write(
      "packages/a/package.json",
      JSON.stringify({ name: "@fixture/a", exports: { ".": "./src/index.ts" } }),
    );
    gate.write("packages/a/src/index.ts", 'export { foo as value } from "./leaf.ts";\n');
    gate.write("packages/a/src/leaf.ts", "export const foo = 1; export const bar = 2;\n");
    gate.write("scripts/barrel.test.ts", 'import { value } from "@fixture/a";\nvoid value;\n');
    gate.baseline();
    gate.write(
      "scripts/barrel.test.ts",
      'import { value } from "@fixture/a";\nvoid value;\nexport const changed = true;\n',
    );
    expect(gate.run().status).toBe(0);
    gate.clearChecks();
    gate.write("packages/a/src/index.ts", 'export { bar as value } from "./leaf.ts";\n');
    const rerun = gate.run();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(
      gate
        .checks()
        .some((check) => check.args.includes("scripts/barrel.test.ts") && check.args[0] === "test"),
    ).toBe(true);
  });
});

it.each(["setup", "config import"])(
  "changing a unit %s dependency reruns the selected unit consumer",
  (dependency) => {
    fixture((gate) => {
      gate.write(
        "vite.config.ts",
        'import * as NodeURL from "node:url";\nimport { setting } from "./scripts/config-helper.ts";\nexport default { test: { setupFiles: [NodeURL.fileURLToPath(new URL("./packages/shared/src/testing/longTempDir.ts", import.meta.url))], setting } };\n',
      );
      gate.write("scripts/config-helper.ts", "export const setting = 1;\n");
      gate.write("packages/shared/src/testing/longTempDir.ts", "export const setup = 1;\n");
      gate.write("scripts/value.ts", "export const value = 1;\n");
      gate.write("scripts/value.test.ts", 'import { value } from "./value.ts";\nvoid value;\n');
      gate.baseline();
      gate.write("scripts/value.ts", "export const value = 2;\n");
      expect(gate.run().status).toBe(0);
      gate.clearChecks();
      gate.write(
        dependency === "setup"
          ? "packages/shared/src/testing/longTempDir.ts"
          : "scripts/config-helper.ts",
        "export const setting = 2;\n",
      );
      const rerun = gate.run();
      expect(rerun.status, rerun.stderr).toBe(0);
      expect(
        gate
          .checks()
          .some(
            (check) => check.args.includes("scripts/value.test.ts") && check.args[0] === "test",
          ),
      ).toBe(true);
    });
  },
);

it("changing a scenario title reruns sentence retention after a previous success", () => {
  fixture((gate) => {
    const scenario = "apps/web/test/scenarios/areas/example.scenario.ts";
    gate.write(scenario, 'it("the original sentence", () => {});\n');
    gate.baseline();
    gate.write(scenario, 'it("the original sentence", () => {});\nexport const changed = true;\n');
    const initial = gate.run();
    expect(initial.status, initial.stderr).toBe(0);
    gate.clearChecks();
    gate.write(scenario, 'it("a replacement sentence", () => {});\nexport const changed = true;\n');
    const rerun = gate.run();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(
      gate
        .checks()
        .some(
          (check) =>
            check.command === "node" && check.args.includes("scripts/check-test-sentences.ts"),
        ),
    ).toBe(true);
  });
});
