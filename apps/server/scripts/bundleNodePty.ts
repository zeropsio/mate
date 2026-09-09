// @effect-diagnostics nodeBuiltinImport:off - a synchronous pack-time tarball rewrite, no Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * node-pty publishes prebuilt binaries for darwin and win32 only; on Linux its
 * install script always falls through to `node-gyp rebuild`, which needs g++,
 * make and python on the target. A `zcp@1` container may carry none of them,
 * and `npm install zerops-mate-<v>.tgz` then dies inside `zcp init` on a
 * toolchain nobody asked for.
 *
 * The release tarball therefore carries its own node-pty as a bundled
 * dependency: the package's sources plus, when the release workflow hands one
 * over, a `prebuilds/linux-x64/pty.node` built on an old glibc. node-pty's
 * install script only checks that its platform prebuild directory exists, so on
 * the container it exits 0 and no compiler is consulted; anywhere else the
 * bundled sources still let node-gyp build as before.
 *
 * Done on the packed tarball rather than through the manifest because pnpm
 * refuses `bundleDependencies` under `nodeLinker: isolated`
 * (ERR_PNPM_BUNDLED_DEPENDENCIES_WITHOUT_HOISTED); npm, which installs the
 * result, honours the field in a dependency's manifest and keeps the bundled
 * copy instead of fetching the registry one.
 */

export const NODE_PTY_PACKAGE = "node-pty";

/**
 * What the bundled copy keeps of node-pty's published tree: the runtime JS, the
 * sources node-gyp needs as a fallback, and nothing platform-specific for a
 * platform the container is not. `prebuilds/` and `third_party/` (win32 conpty)
 * are the 60 MB the prune exists to drop.
 */
export const NODE_PTY_BUNDLED_ENTRIES: ReadonlyArray<string> = [
  "package.json",
  "LICENSE",
  "binding.gyp",
  "lib",
  "scripts",
  "src",
  "deps",
  "typings",
];

export const NODE_PTY_LINUX_PREBUILD_DIR = NodePath.join("prebuilds", "linux-x64");

export interface BundleNodePtyInput {
  /** The tarball `vp pm pack` produced; rewritten in place. */
  readonly tarballPath: string;
  /** node-pty's package root as installed in the workspace. */
  readonly nodePtyDir: string;
  /** A directory holding a Linux x64 `pty.node`, or undefined to bundle sources only. */
  readonly linuxPrebuildDir: string | undefined;
}

/** Copy node-pty's kept entries into `destination`, adding the Linux prebuild when given. */
export function stageNodePty(input: Omit<BundleNodePtyInput, "tarballPath">, destination: string) {
  NodeFS.mkdirSync(destination, { recursive: true });
  for (const entry of NODE_PTY_BUNDLED_ENTRIES) {
    const source = NodePath.join(input.nodePtyDir, entry);
    if (!NodeFS.existsSync(source)) {
      throw new Error(
        `node-pty at ${input.nodePtyDir} has no ${entry}; refusing to bundle a partial package.`,
      );
    }
    NodeFS.cpSync(source, NodePath.join(destination, entry), { recursive: true });
  }
  if (input.linuxPrebuildDir !== undefined) {
    const binary = NodePath.join(input.linuxPrebuildDir, "pty.node");
    if (!NodeFS.existsSync(binary)) {
      throw new Error(`No pty.node in ${input.linuxPrebuildDir}.`);
    }
    const prebuildDir = NodePath.join(destination, NODE_PTY_LINUX_PREBUILD_DIR);
    NodeFS.mkdirSync(prebuildDir, { recursive: true });
    NodeFS.cpSync(binary, NodePath.join(prebuildDir, "pty.node"));
  }
}

/** Add `bundleDependencies: ["node-pty"]` to a package manifest, keeping the rest verbatim. */
export function withBundledNodePty(manifestJson: string): string {
  const manifest = JSON.parse(manifestJson) as Record<string, unknown>;
  const dependencies = manifest["dependencies"];
  if (
    typeof dependencies !== "object" ||
    dependencies === null ||
    !(NODE_PTY_PACKAGE in dependencies)
  ) {
    throw new Error(
      `The release manifest does not declare ${NODE_PTY_PACKAGE}; nothing to bundle.`,
    );
  }
  return `${JSON.stringify({ ...manifest, bundleDependencies: [NODE_PTY_PACKAGE] }, null, 2)}\n`;
}

/** Rewrite the packed tarball so it carries node-pty as a bundled dependency. */
export function bundleNodePtyIntoTarball(input: BundleNodePtyInput): void {
  const workDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-bundle-node-pty-"));
  try {
    NodeChildProcess.execFileSync("tar", ["-xzf", input.tarballPath, "-C", workDir]);
    const packageDir = NodePath.join(workDir, "package");
    const manifestPath = NodePath.join(packageDir, "package.json");
    NodeFS.writeFileSync(
      manifestPath,
      withBundledNodePty(NodeFS.readFileSync(manifestPath, "utf8")),
    );
    stageNodePty(input, NodePath.join(packageDir, "node_modules", NODE_PTY_PACKAGE));
    NodeChildProcess.execFileSync("tar", ["-czf", input.tarballPath, "-C", workDir, "package"]);
  } finally {
    NodeFS.rmSync(workDir, { recursive: true, force: true });
  }
}
