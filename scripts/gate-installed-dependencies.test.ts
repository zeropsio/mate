// @effect-diagnostics nodeBuiltinImport:off -- fixture trees on a scratch directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { staleDependencies } from "./gate-installed-dependencies.ts";

const lock = (patchHash: string, version = "1.0.0") =>
  `lockfileVersion: '9.0'\n\npatchedDependencies:\n  '@effect/vitest@4.0.1': ${patchHash}\n\npackages:\n  a@${version}: {}\n`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

function tree(wanted: string, installed: string | undefined) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-deps-"));
  roots.push(root);
  NodeFS.writeFileSync(NodePath.join(root, "pnpm-lock.yaml"), wanted);
  if (installed !== undefined) {
    NodeFS.mkdirSync(NodePath.join(root, "node_modules/.pnpm"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, "node_modules/.pnpm/lock.yaml"), installed);
  }
  return root;
}

it.each([
  {
    name: "the install matches the lockfile",
    wanted: lock("aaa"),
    installed: lock("aaa"),
    refusal: undefined,
  },
  {
    name: "the lockfile changed after the install",
    wanted: lock("aaa", "2.0.0"),
    installed: lock("aaa"),
    refusal: "do not match pnpm-lock.yaml",
  },
  {
    name: "a patch hash changed after the install",
    wanted: lock("bbb"),
    installed: lock("aaa"),
    refusal: "do not match pnpm-lock.yaml",
  },
  {
    name: "nothing is installed",
    wanted: lock("aaa"),
    installed: undefined,
    refusal: "not installed",
  },
])("the gate refuses to start when $name", ({ wanted, installed, refusal }) => {
  const result = staleDependencies(tree(wanted, installed));
  if (refusal === undefined) expect(result).toBeUndefined();
  else {
    expect(result).toContain(refusal);
    expect(result).toContain("vp i");
  }
});
