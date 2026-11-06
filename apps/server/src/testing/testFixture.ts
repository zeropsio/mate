// @effect-diagnostics nodeBuiltinImport:off - test fixture storage is a Node filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { onTestFinished } from "vite-plus/test";

import { testTempDir } from "./testTempDir.ts";

/** Lease stable paths until the current test finishes; the file owns their cleanup. */
export const testFixturePool = (prefix: string): ((kind: string) => string) => {
  const root = testTempDir(prefix);
  const free = new Map<string, string[]>();
  return (kind) => {
    const slots = free.get(kind) ?? [];
    free.set(kind, slots);
    const dir = slots.pop() ?? NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(root, kind)));
    onTestFinished(() => {
      slots.push(dir);
    });
    return dir;
  };
};

/** Restore a directory's contents without replacing the directory itself. */
export const restoreFixture = (source: string, target: string): void => {
  const sourceNames = new Set(NodeFS.readdirSync(source));
  const targetNames = new Set(NodeFS.readdirSync(target));
  for (const name of targetNames) {
    if (!sourceNames.has(name))
      NodeFS.rmSync(NodePath.join(target, name), { recursive: true, force: true });
  }
  for (const name of sourceNames) {
    const from = NodePath.join(source, name);
    const to = NodePath.join(target, name);
    const src = NodeFS.lstatSync(from);
    const dst = targetNames.has(name) ? NodeFS.lstatSync(to) : undefined;
    if (src.isDirectory()) {
      if (dst && !dst.isDirectory()) NodeFS.rmSync(to, { recursive: true, force: true });
      if (!dst?.isDirectory()) NodeFS.mkdirSync(to);
      restoreFixture(from, to);
    } else if (src.isSymbolicLink()) {
      const link = NodeFS.readlinkSync(from);
      if (!dst?.isSymbolicLink() || NodeFS.readlinkSync(to) !== link) {
        if (dst) NodeFS.rmSync(to, { recursive: true, force: true });
        NodeFS.symlinkSync(link, to);
      }
    } else {
      if (dst && !dst.isFile()) NodeFS.rmSync(to, { recursive: true, force: true });
      if (
        !dst?.isFile() ||
        src.size !== dst.size ||
        !NodeFS.readFileSync(from).equals(NodeFS.readFileSync(to))
      ) {
        NodeFS.copyFileSync(from, to);
      }
      if ((src.mode & 0o777) !== ((dst?.mode ?? 0) & 0o777)) NodeFS.chmodSync(to, src.mode & 0o777);
    }
  }
};
