// @effect-diagnostics nodeBuiltinImport:off -- exercise the host gate's file discovery.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { buildGateGraph, selectGateSteps, stageInputSets } from "./gate-changed.ts";
import { canReuseStage, stageInputHash } from "./gate/stage-reuse.ts";
import { failureSummary } from "./gate-log.ts";

// witness: scripts/gate-changed.ts | gateChanged || paths.some((path) => files.has(path)) → paths.some((path) => files.has(path))
it("GA3: a diff that changes a stage's definition selects that stage", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gate-stages-"));
  try {
    for (const directory of ["scripts", "apps/app", "packages", "infra", ".github/workflows"])
      NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "scripts/package.json"),
      JSON.stringify({ name: "scripts", scripts: { typecheck: "tsc" } }),
    );
    NodeFS.writeFileSync(
      NodePath.join(root, "apps/app/package.json"),
      JSON.stringify({ name: "app", scripts: { typecheck: "tsc" } }),
    );
    NodeFS.writeFileSync(
      NodePath.join(root, "scripts/check-runtime-cycles.ts"),
      'import "./gate-input-scopes.ts";',
    );
    NodeFS.writeFileSync(NodePath.join(root, "scripts/gate-input-scopes.ts"), "export {};");
    const graph = buildGateGraph(root);
    const select = (paths: string[], build = true) => {
      const inputs = stageInputSets(root, paths, graph);
      return selectGateSteps(graph, {
        comparison: "base",
        existing: paths,
        paths,
        tests: false,
        inputs,
        build,
      });
    };

    const gate = select(["scripts/gate-changed.ts"]);
    const names = gate.steps.map((stage) => stage.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "PR assets",
        "package shells",
        "workflow schema",
        "release smoke",
        "lockfile policy",
        "runtime cycle ratchet",
        "resource monitor formatting",
        "build web client",
        "pack server",
        "typecheck scripts",
        "typecheck app",
      ]),
    );
    expect(names).not.toContain("resource monitor tests");
    const noBuild = select(["scripts/gate-changed.ts"], false);
    expect(noBuild.buildsSkipped).toEqual(["build web client", "pack server"]);
    expect(noBuild.steps.map((stage) => stage.name)).not.toContain("pack server");

    const release = select(["scripts/release-smoke.ts"]).steps.map((stage) => stage.name);
    expect(release).toContain("release smoke");
    expect(release).not.toContain("PR assets");
    const runtime = select(["scripts/gate-input-scopes.ts"]).steps.map((stage) => stage.name);
    expect(runtime).toContain("runtime cycle ratchet");
    expect(runtime).not.toContain("PR assets");
    const ordinary = select(["scripts/unrelated.ts"]).steps.map((stage) => stage.name);
    expect(ordinary).not.toContain("PR assets");
    expect(ordinary).not.toContain("typecheck app");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

// witness: scripts/gate-changed.ts | const deployedBuildSwitches = ["VITE_APP_SHELL_WORKER", "VITE_DESIGN_HARNESS"] as const; → const deployedBuildSwitches = ["VITE_APP_SHELL_WORKER"] as const;
it("GA6: a diff touching a design harness page builds the web client with the harness beside it, as prod does", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gate-harness-"));
  try {
    for (const directory of ["apps/web", "packages", "infra", "docs"])
      NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "apps/web/package.json"),
      JSON.stringify({ name: "@t3tools/web", scripts: { build: "vp build" } }),
    );
    NodeFS.writeFileSync(NodePath.join(root, "apps/web/design-board.html"), "<html></html>");
    NodeFS.writeFileSync(NodePath.join(root, "docs/notes.md"), "# Notes\n");
    NodeFS.writeFileSync(
      NodePath.join(root, "zerops.yml"),
      [
        "zerops:",
        "  - setup: prod",
        "    build:",
        "      envVariables:",
        "        VITE_APP_SHELL_WORKER: app-shell",
        "        VITE_DESIGN_HARNESS: beside",
        "        VITE_HQ_URL: https://hq.example",
        "",
      ].join("\n"),
    );
    const graph = buildGateGraph(root);
    const existing = [
      "apps/web/package.json",
      "apps/web/design-board.html",
      "docs/notes.md",
      "zerops.yml",
    ];
    const select = (paths: string[]) =>
      selectGateSteps(graph, {
        comparison: "base",
        existing,
        paths,
        tests: false,
        inputs: stageInputSets(root, [...existing, ...paths], graph),
        build: true,
      }).steps;

    const web = select(["apps/web/design-board.html"]).find(
      (stage) => stage.name === "build web client",
    );
    expect(web?.env).toEqual({ VITE_APP_SHELL_WORKER: "app-shell", VITE_DESIGN_HARNESS: "beside" });
    expect(select(["docs/notes.md"]).map((stage) => stage.name)).not.toContain("build web client");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

// witness: scripts/gate/stage-reuse.ts | hash.update(bytes); → hash.update(Buffer.alloc(0));
it("GA4: a passing guard stage is reused only while its identified inputs match", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gate-guard-"));
  try {
    NodeFS.writeFileSync(NodePath.join(root, "guarded.ts"), "one");
    NodeFS.writeFileSync(NodePath.join(root, "guard.ts"), "guard code");
    const fingerprint = () => stageInputHash(root, ["guarded.ts", "guard.ts"], "baseline");
    const previous = {
      selectionHash: "old selection",
      stageHashes: { "guard ledgers": fingerprint() },
      selectedStages: [{ name: "guard ledgers" }],
      results: [{ name: "guard ledgers", status: 0, durationMs: 1 }],
    };
    const reuse = (identified = true) =>
      canReuseStage("guard ledgers", fingerprint(), "new selection", previous, identified);
    expect(reuse()).toBe(true);
    expect(reuse(false)).toBe(false);
    NodeFS.writeFileSync(NodePath.join(root, "guarded.ts"), "two");
    expect(reuse()).toBe(false);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

// witness: scripts/gate-log.ts | (?!ledger reconciled\b) → (?=ledger reconciled\b)
it("GA5: a failed stage reports its first actionable error", () => {
  const output = [
    "guard cache: 5 hits, 0 misses",
    "no-raw-controls: ledger reconciled (2 entries)",
    "no-hand-popup: unlisted apps/web/src/popup.tsx:popup — add to the ledger",
    "TypeError: a later failure",
  ].join("\n");
  expect(failureSummary(output, "/tmp/stage.log").split("\n")[0]).toBe(
    "First error: no-hand-popup: unlisted apps/web/src/popup.tsx:popup — add to the ledger",
  );
  expect(failureSummary("ledger could not be loaded\n", "/tmp/stage.log").split("\n")[0]).toBe(
    "First error: ledger could not be loaded",
  );
  expect(
    failureSummary("T1 1384 cases 60.1 s (budget 60 s)\nT1 over budget\n", "/tmp/stage.log").split(
      "\n",
    )[0],
  ).toBe("First error: T1 over budget");
  expect(
    failureSummary(
      "no-frame-per-tick: ledger reconciled (0 entries)\napps/web/src/theme.css: unsupported motion\nno-infinite-motion: unlisted theme.css:motion\n",
      "/tmp/stage.log",
    ).split("\n")[0],
  ).toBe("First error: apps/web/src/theme.css: unsupported motion");
});
