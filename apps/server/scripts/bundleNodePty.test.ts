// @effect-diagnostics nodeBuiltinImport:off - fixture trees and tarballs on the real filesystem.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";

import {
  NODE_PTY_BUNDLED_ENTRIES,
  bundleNodePtyIntoTarball,
  stageNodePty,
  withBundledNodePty,
} from "./bundleNodePty.ts";

let root: string;

function fakeNodePty(dir: string, extraDirs: ReadonlyArray<string> = []) {
  for (const entry of NODE_PTY_BUNDLED_ENTRIES) {
    if (entry.includes(".")) {
      NodeFS.mkdirSync(dir, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(dir, entry),
        entry === "package.json" ? '{"name":"node-pty"}\n' : entry,
      );
    } else {
      NodeFS.mkdirSync(NodePath.join(dir, entry), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(dir, entry, "index.js"), "");
    }
  }
  for (const extra of extraDirs) {
    NodeFS.mkdirSync(NodePath.join(dir, extra), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, extra, "blob"), "x".repeat(1024));
  }
}

beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "bundle-node-pty-test-"));
});
afterEach(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("withBundledNodePty", () => {
  it("adds the bundle field and keeps everything else", () => {
    const out = JSON.parse(
      withBundledNodePty(
        JSON.stringify({ name: "zerops-mate", dependencies: { "node-pty": "1.1.0" } }),
      ),
    );
    assert.deepStrictEqual(out, {
      name: "zerops-mate",
      dependencies: { "node-pty": "1.1.0" },
      bundleDependencies: ["node-pty"],
    });
  });

  it("refuses a manifest that does not declare node-pty", () => {
    assert.throws(
      () => withBundledNodePty(JSON.stringify({ dependencies: {} })),
      /does not declare node-pty/,
    );
  });
});

describe("stageNodePty", () => {
  const cases = [
    { name: "sources only", withPrebuild: false },
    { name: "sources plus the Linux prebuild", withPrebuild: true },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const nodePtyDir = NodePath.join(root, "node-pty");
      fakeNodePty(nodePtyDir, [
        "prebuilds/win32-x64",
        "prebuilds/darwin-arm64",
        "third_party/conpty",
      ]);
      let linuxPrebuildDir: string | undefined;
      if (c.withPrebuild) {
        linuxPrebuildDir = NodePath.join(root, "linux-x64");
        NodeFS.mkdirSync(linuxPrebuildDir);
        NodeFS.writeFileSync(NodePath.join(linuxPrebuildDir, "pty.node"), "ELF");
      }
      const dest = NodePath.join(root, "staged");
      stageNodePty({ nodePtyDir, linuxPrebuildDir }, dest);

      for (const entry of NODE_PTY_BUNDLED_ENTRIES)
        assert.isTrue(NodeFS.existsSync(NodePath.join(dest, entry)), entry);
      assert.isFalse(NodeFS.existsSync(NodePath.join(dest, "prebuilds", "win32-x64")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(dest, "third_party")));
      assert.strictEqual(
        NodeFS.existsSync(NodePath.join(dest, "prebuilds", "linux-x64", "pty.node")),
        c.withPrebuild,
      );
    });
  }

  it("refuses a node-pty missing a kept entry", () => {
    const nodePtyDir = NodePath.join(root, "node-pty");
    fakeNodePty(nodePtyDir);
    NodeFS.rmSync(NodePath.join(nodePtyDir, "src"), { recursive: true });
    assert.throws(
      () => stageNodePty({ nodePtyDir, linuxPrebuildDir: undefined }, NodePath.join(root, "out")),
      /no src/,
    );
  });
});

describe("bundleNodePtyIntoTarball", () => {
  it("rewrites the tarball with the manifest field and node_modules/node-pty", () => {
    const packageDir = NodePath.join(root, "package");
    NodeFS.mkdirSync(NodePath.join(packageDir, "dist"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(packageDir, "dist", "bin.mjs"), "");
    NodeFS.writeFileSync(
      NodePath.join(packageDir, "package.json"),
      JSON.stringify({ name: "zerops-mate", dependencies: { "node-pty": "1.1.0" } }),
    );
    const tarballPath = NodePath.join(root, "zerops-mate-0.0.0.tgz");
    NodeChildProcess.execFileSync("tar", ["-czf", tarballPath, "-C", root, "package"]);
    const nodePtyDir = NodePath.join(root, "node-pty");
    fakeNodePty(nodePtyDir);
    const linuxPrebuildDir = NodePath.join(root, "linux-x64");
    NodeFS.mkdirSync(linuxPrebuildDir);
    NodeFS.writeFileSync(NodePath.join(linuxPrebuildDir, "pty.node"), "ELF");

    bundleNodePtyIntoTarball({ tarballPath, nodePtyDir, linuxPrebuildDir });

    const listing = NodeChildProcess.execFileSync("tar", ["-tzf", tarballPath], {
      encoding: "utf8",
    }).split("\n");
    assert.include(listing, "package/dist/bin.mjs");
    assert.include(listing, "package/node_modules/node-pty/package.json");
    assert.include(listing, "package/node_modules/node-pty/prebuilds/linux-x64/pty.node");
    const extracted = NodePath.join(root, "check");
    NodeFS.mkdirSync(extracted);
    NodeChildProcess.execFileSync("tar", ["-xzf", tarballPath, "-C", extracted]);
    const manifest = JSON.parse(
      NodeFS.readFileSync(NodePath.join(extracted, "package", "package.json"), "utf8"),
    );
    assert.deepStrictEqual(manifest.bundleDependencies, ["node-pty"]);
  });
});
