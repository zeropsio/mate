// @effect-diagnostics nodeBuiltinImport:off -- exercise the host gate's file discovery.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { buildGateGraph, selectGateSteps, stageInputSets } from "./gate-changed.ts";

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
