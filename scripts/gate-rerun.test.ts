// @effect-diagnostics nodeBuiltinImport:off -- real gate CLI with disposable command fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { stateOnlySmoke } from "./state-smoke-cases.ts";

const gateRunnerFiles = [
  "gate-changed.ts",
  "state-smoke-cases.ts",
  "gate-file-inputs.ts",
  "gate-input-scopes.ts",
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

function createFixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-rerun-"));
  const write = (path: string, text: string) => {
    const absolute = NodePath.join(root, path);
    NodeFS.mkdirSync(NodePath.dirname(absolute), { recursive: true });
    NodeFS.writeFileSync(absolute, text);
  };
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  for (const directory of ["scripts", "apps", "packages", "infra", "node_modules/.bin"])
    NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
  for (const file of gateRunnerFiles)
    NodeFS.copyFileSync(
      NodePath.join(import.meta.dirname, file),
      NodePath.join(root, "scripts", file),
    );
  NodeFS.symlinkSync(
    NodePath.join(import.meta.dirname, "node_modules"),
    NodePath.join(root, "scripts/node_modules"),
  );
  const stub = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const cwd = path.relative(process.env.GATE_FIXTURE_ROOT, process.cwd()) || ".";
fs.appendFileSync(path.join(process.env.GATE_FIXTURE_ROOT, "checks.log"), JSON.stringify({ command, cwd, args }) + "\\n");
const fail = process.env.GATE_FIXTURE_FAIL;
if (command === "vp" && (fail === "check" && args[0] === "check" || fail === "smoke" && args.includes("--testNamePattern") || fail === "typecheck:" + cwd && args[0] === "exec")) process.exit(9);
`;
  for (const command of ["node", "vp"]) {
    write(`node_modules/.bin/${command}`, stub);
    NodeFS.chmodSync(NodePath.join(root, "node_modules/.bin", command), 0o755);
  }
  write(".gitignore", "node_modules/\nchecks.log\n.gate-receipt.json*\n");
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
  const run = (args: string[] = [], fail = "") =>
    NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "base", ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GATE_FIXTURE_ROOT: root,
          GATE_FIXTURE_FAIL: fail,
          NODE_COMPILE_CACHE: NodePath.join(root, "node_modules/.cache/node"),
        },
      },
    );
  const checks = (): Check[] =>
    NodeFS.existsSync(NodePath.join(root, "checks.log"))
      ? NodeFS.readFileSync(NodePath.join(root, "checks.log"), "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Check)
      : [];
  const clearChecks = () => NodeFS.rmSync(NodePath.join(root, "checks.log"), { force: true });
  return { root, write, baseline, run, checks, clearChecks };
}

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
      "apps/hq/package.json",
      JSON.stringify({
        name: "@fixture/hq",
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
    gate.write("apps/hq/src/read.ts", 'import { value } from "@fixture/a";\nvoid value;\n');
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
    expect(typechecks.map((check) => check.cwd).sort()).toEqual(["apps/hq", "packages/a"]);
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
    expect(gate.run().status).toBe(0);
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
