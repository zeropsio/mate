// @effect-diagnostics nodeBuiltinImport:off -- Real dependency-graph fixtures.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { assertCycleBudget, cyclicComponents, scanRuntimeCycles } from "./check-runtime-cycles.ts";

const directories: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "runtime-cycles-"));
  directories.push(root);
  for (const [name, source] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, name)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, name), source);
  }
  return root;
}
afterEach(() => {
  for (const root of directories.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("Runtime cycle ratchet", () => {
  it("Overlapping circular paths count as one cyclic component", () => {
    expect(cyclicComponents({ a: ["b", "c"], b: ["a"], c: ["a"], d: ["d"], e: [] })).toEqual([
      ["a", "b", "c"],
      ["d"],
    ]);
  });
  it("A baseline reduction is accepted and an increase cannot bless another cycle", () => {
    expect(() => assertCycleBudget(1, 1, 2)).not.toThrow();
    expect(() => assertCycleBudget(2, 1, 1)).toThrow("Runtime cyclic components grew: 1 → 2");
    expect(() => assertCycleBudget(2, 2, 1)).toThrow("Runtime cycle baseline grew: 1 → 2");
    expect(() => assertCycleBudget(0, 1, 1)).toThrow("Lower runtime cycle baseline to 0");
  });
  it("Type-only imports in TS and TSX do not create runtime cycles", async () => {
    const root = fixture({
      "src/a.ts": 'import type { B } from "./b"; export const a = 1; export type A = B;',
      "src/b.tsx": 'import type { A } from "./a"; export const b = 1; export type B = A;',
    });
    expect((await scanRuntimeCycles(root, ["src"])).components).toEqual([]);
  });
  it("Workspace exports and the web alias resolve runtime re-exports and literal dynamic imports", async () => {
    const root = fixture({
      "packages/example/package.json": JSON.stringify({
        name: "@t3tools/example",
        exports: { "./entry": { types: "./src/entry.ts", import: "./src/entry.ts" } },
      }),
      "packages/example/src/entry.ts": 'export { a } from "~/a";',
      "apps/web/src/a.ts": 'export const a = () => import("@t3tools/example/entry");',
    });
    expect(
      (await scanRuntimeCycles(root, ["apps/web/src", "packages/example/src"])).components,
    ).toEqual([["apps/web/src/a.ts", "packages/example/src/entry.ts"]]);
  });
  it("An unresolved local target fails instead of reducing the graph", async () => {
    const root = fixture({
      "src/a.ts": 'import { missing } from "./missing"; export const a = missing;',
    });
    await expect(scanRuntimeCycles(root, ["src"])).rejects.toThrow(
      "Unresolved local runtime dependencies",
    );
  });
});

// Decision: one derivation per state; consumers never recompute it; no new domain concepts; mobile stays out (later).
it("Account assembly and adapter facades have no runtime cycles", async () => {
  const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
  const scan = await scanRuntimeCycles(root, [
    "apps/web/src/zerops/ZeropsAccountData.tsx",
    "packages/client-runtime/src/zerops/containerHealth.ts",
    "packages/client-runtime/src/zerops/doorThrowaway.ts",
    "packages/client-runtime/src/zerops/mateSetup.ts",
  ]);
  const owners = new Set([
    "apps/web/src/zerops/ZeropsAccountData.tsx",
    "packages/client-runtime/src/data/projections/operationEnd.ts",
    "packages/client-runtime/src/data/adapters/containerHealth.ts",
    "packages/client-runtime/src/data/adapters/doorThrowaway.ts",
    "packages/client-runtime/src/data/adapters/mateSetupWire.ts",
  ]);
  expect(scan.components.filter((component) => component.some((file) => owners.has(file)))).toEqual(
    [],
  );
});
