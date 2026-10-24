// @effect-diagnostics nodeBuiltinImport:off - fixture trees and tarballs on the real filesystem.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import serverPackageJson from "../package.json" with { type: "json" };
import { buildReleaseManifest } from "./releaseManifest.ts";

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
  it.each(Array.from(cases, (c) => ({ title: c.name, c })))("$title", ({ c }) => {
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
  it("an npm-installed release supplies the headers bundled node-pty needs to compile", async () => {
    const packageDir = NodePath.join(root, "package");
    NodeFS.mkdirSync(packageDir);
    const manifest = buildReleaseManifest({
      serverPackageJson,
      catalog: {},
      version: "0.0.0-test",
    });
    // Exercise this native dependency's installation, without unrelated native downloads.
    const dependencies = Object.fromEntries(
      Object.entries(manifest.dependencies).filter(
        ([name]) => name === "node-pty" || name === "node-addon-api",
      ),
    );
    NodeFS.writeFileSync(
      NodePath.join(packageDir, "package.json"),
      JSON.stringify({ name: manifest.name, version: manifest.version, dependencies }),
    );
    const tarballPath = NodePath.join(root, "zerops-mate-0.0.0-test.tgz");
    NodeChildProcess.execFileSync("tar", ["-czf", tarballPath, "-C", root, "package"]);
    const require = NodeModule.createRequire(import.meta.url);
    const nodePtyDir = NodePath.dirname(require.resolve("node-pty/package.json"));
    // Published tarballs carry linux-x64. npm's supported build-from-source setting still
    // selects compilation (as does installing on a platform without that prebuild).
    const linuxPrebuildDir = NodePath.join(root, "linux-x64");
    NodeFS.mkdirSync(linuxPrebuildDir);
    NodeFS.writeFileSync(NodePath.join(linuxPrebuildDir, "pty.node"), "unused prebuild");
    bundleNodePtyIntoTarball({ tarballPath, nodePtyDir, linuxPrebuildDir });
    const installed = NodePath.join(root, "installed");
    NodeFS.mkdirSync(installed);
    const result = await new Promise<{ status: number | null; stderr: string }>(
      (resolve, reject) => {
        const child = NodeChildProcess.spawn(
          "npm",
          [
            "install",
            "--prefix",
            installed,
            "--no-audit",
            "--no-fund",
            "--package-lock=false",
            tarballPath,
          ],
          {
            stdio: ["ignore", "ignore", "pipe"],
            env: { ...process.env, npm_config_build_from_source: "true" },
          },
        );
        let stderr = "";
        child.stderr!.setEncoding("utf8");
        child.stderr!.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (status) => resolve({ status, stderr }));
      },
    );
    assert.strictEqual(
      result.status,
      0,
      `ASSERTION: npm installs the release with bundled node-pty's build dependencies\n${result.stderr.slice(-6000)}`,
    );
    const installedPty = NodeModule.createRequire(
      NodePath.join(installed, "node_modules/zerops-mate/node_modules/node-pty/package.json"),
    );
    assert.isTrue(NodeFS.existsSync(installedPty.resolve("node-addon-api/napi.h")));
    assert.isTrue(
      NodeFS.existsSync(installedPty.resolve("./build/Release/pty.node")),
      "ASSERTION: npm compiled node-pty from the release sources",
    );
  }, 100_000);

  it("ships the kernel health helper as an executable after unpacking", () => {
    const packageDir = NodePath.join(root, "package");
    NodeFS.mkdirSync(NodePath.join(packageDir, "dist"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(packageDir, "dist", "health-events"),
      "#!/bin/sh\necho health-events\n",
      { mode: 0o644 },
    );
    NodeFS.writeFileSync(
      NodePath.join(packageDir, "package.json"),
      JSON.stringify({ name: "zerops-mate", dependencies: { "node-pty": "1.1.0" } }),
    );
    const tarballPath = NodePath.join(root, "zerops-mate-0.0.0.tgz");
    NodeChildProcess.execFileSync("tar", ["-czf", tarballPath, "-C", root, "package"]);
    const nodePtyDir = NodePath.join(root, "node-pty");
    fakeNodePty(nodePtyDir);
    bundleNodePtyIntoTarball({ tarballPath, nodePtyDir, linuxPrebuildDir: undefined });
    const extracted = NodePath.join(root, "installed");
    NodeFS.mkdirSync(extracted);
    NodeChildProcess.execFileSync("tar", ["-xzf", tarballPath, "-C", extracted]);
    assert.strictEqual(
      NodeChildProcess.execFileSync(NodePath.join(extracted, "package", "dist", "health-events"), {
        encoding: "utf8",
      }),
      "health-events\n",
    );
  });
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
