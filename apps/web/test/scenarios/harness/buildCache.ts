// @effect-diagnostics nodeBuiltinImport:off -- content-addressed production bundles.
import { HostProcessPlatform, HostProcessArchitecture } from "@t3tools/shared/hostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { acquireProcessLock } from "../../../../../scripts/test-process-lock.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

// Tailwind's Vite plugin scans from the Vite root (apps/web), not the checkout root.
// Keep that entire tree, including non-module candidates, and the web's workspace dependencies.
// Uncertainty within an input tree invalidates the bundle; unrelated apps/docs/scripts do not.
const bundleInputPaths = [
  "apps/web",
  "packages/client-runtime",
  "packages/contracts",
  "packages/shared",
  "patches",
  "scripts/lib/public-config.ts", // imported by apps/web/vite.config.ts
  "vite.config.ts",
  "tsconfig.base.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".mate-hq-ref",
  ".npmrc",
  ".gitignore", // Tailwind's automatic discovery respects ignore rules.
];

async function bundleInputs(root: string) {
  const { stdout } = await execFile(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...bundleInputPaths],
    { cwd: root },
  );
  const inputs = new Set(stdout.split("\0").filter(Boolean));
  // Explicit Tailwind sources can leave the default tree. Resolve globs relative to the
  // declaring stylesheet; include even `not` sources conservatively. Inline sources live in CSS.
  for (const path of [...inputs].filter((path) => path.endsWith(".css"))) {
    let css: string;
    try {
      css = await NodeFSP.readFile(NodePath.join(root, path), "utf8");
    } catch (error) {
      // Git still lists tracked files after deletion; the hash visitor also omits them.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const base = NodePath.dirname(NodePath.join(root, path));
    for (const match of css.matchAll(
      /@source\s+(?:not\s+)?(["'])([^"']+)\1|@import\s+[^;]*?\bsource\(\s*(["'])([^"']+)\3\s*\)/gu,
    )) {
      const pattern = match[2] ?? match[4]!;
      for await (const input of NodeFSP.glob(pattern, { cwd: base }))
        inputs.add(NodePath.relative(root, NodePath.resolve(base, input)));
    }
  }
  // Vite and loadRepoEnv intentionally read ignored local environment files.
  for (const directory of ["", "apps/web/"])
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"])
      inputs.add(`${directory}${name}`);
  return [...inputs].sort();
}

async function bundleKeys(root: string, env: NodeJS.ProcessEnv) {
  const hash = NodeCrypto.createHash("sha256");
  const generated = NodeCrypto.createHash("sha256");
  hash.update(
    JSON.stringify([
      process.version,
      HostProcessPlatform.defaultValue(),
      HostProcessArchitecture.defaultValue(),
      Object.entries(env)
        .filter(([key]) =>
          /^(?:VITE_|VERCEL_|APP_VERSION$|BABEL_ENV$|NODE_ENV$|T3CODE_|EXPO_PUBLIC_)/u.test(key),
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    ]),
  );
  const visit = async (path: string): Promise<void> => {
    if (/\.tsbuildinfo$|(?:^|\/)(?:\.DS_Store|__screenshots__|\.tanstack)$/u.test(path)) return;
    const absolute = NodePath.join(root, path);
    let stat;
    try {
      stat = await NodeFSP.stat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isDirectory()) {
      for (const name of (await NodeFSP.readdir(absolute)).sort()) await visit(`${path}/${name}`);
    } else {
      const bytes = await NodeFSP.readFile(absolute);
      const target = path === "apps/web/src/routeTree.gen.ts" ? generated : hash;
      target.update(JSON.stringify([path, bytes.length]));
      target.update(bytes);
    }
  };
  for (const input of await bundleInputs(root)) await visit(input);
  const source = hash.digest("hex");
  return {
    source,
    key: NodeCrypto.createHash("sha256")
      .update(JSON.stringify([source, generated.digest("hex")]))
      .digest("hex"),
  };
}

export async function bundleKey(root: string, env: NodeJS.ProcessEnv) {
  return (await bundleKeys(root, env)).key;
}

const integrityFile = ".mate-scenario-integrity.json";

async function bundleIntegrity(dist: string, key: string): Promise<string> {
  const files: Array<[string, string]> = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of (await NodeFSP.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (path === integrityFile) continue;
      const absolute = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, path);
      else if (entry.isFile()) {
        const content = await NodeFSP.readFile(absolute);
        files.push([path, NodeCrypto.createHash("sha256").update(content).digest("hex")]);
      } else throw new Error(`Invalid scenario bundle entry: ${path}`);
    }
  };
  await visit(dist, "");
  if (!files.some(([path]) => path === "index.html"))
    throw new Error("Scenario bundle has no index.html");
  return JSON.stringify({ version: 1, key, files });
}

export async function cachedBundle(
  root: string,
  env: NodeJS.ProcessEnv,
  build: (dist: string) => Promise<void>,
): Promise<string> {
  // Actions transfers this exact path as an artifact; local worktrees share the host cache.
  const cache =
    env.GITHUB_ACTIONS === "true" || env.MATE_SCENARIO_REQUIRE_BUNDLE === "1"
      ? NodePath.join(root, "node_modules/.cache/mate-scenario-web")
      : NodePath.join(
          env.XDG_CACHE_HOME || NodePath.join(NodeOS.homedir(), ".cache"),
          "mate-scenario-web",
        );
  let retriedGeneratedRoute = false;
  for (;;) {
    const before = await bundleKeys(root, env);
    const { key } = before;
    const dist = NodePath.join(cache, key);
    const ready = async () => {
      try {
        const recorded = await NodeFSP.readFile(NodePath.join(dist, integrityFile), "utf8");
        return recorded === (await bundleIntegrity(dist, key));
      } catch {
        return false;
      }
    };
    if (await ready()) return dist;
    await NodeFSP.mkdir(cache, { recursive: true });
    // Keep the inode: unlinking a lock lets later builders bypass existing waiters.
    const release = await acquireProcessLock(NodePath.join(cache, `${key}.lock`));
    let staging: string | undefined;
    try {
      // Another worktree may publish this key while this checkout changes in the queue.
      if (key !== (await bundleKey(root, env))) continue;
      if (await ready()) return dist;
      await NodeFSP.rm(dist, { recursive: true, force: true });
      staging = await NodeFSP.mkdtemp(NodePath.join(cache, ".building-"));
      await build(staging);
      const after = await bundleKeys(root, env);
      if (key !== after.key) {
        // Vite may regenerate the tracked route tree while building. Rebuild against the final
        // bytes once; changes to any other input are concurrent edits and must not be published.
        if (before.source === after.source && !retriedGeneratedRoute) {
          retriedGeneratedRoute = true;
          continue;
        }
        throw new Error("Scenario bundle inputs changed during build; rerun the gate");
      }
      await NodeFSP.writeFile(
        NodePath.join(staging, integrityFile),
        await bundleIntegrity(staging, key),
      );
      await NodeFSP.rename(staging, dist);
      return dist;
    } finally {
      if (staging) await NodeFSP.rm(staging, { recursive: true, force: true });
      await release();
    }
  }
}
