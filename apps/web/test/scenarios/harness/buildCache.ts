// @effect-diagnostics nodeBuiltinImport:off -- content-addressed, worktree-local production bundles.
import { HostProcessPlatform, HostProcessArchitecture } from "@t3tools/shared/hostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

// Hash a conservative superset of the build's sources, including Tailwind's implicit
// candidates and new files. A directory allowlist misses inputs outside the module graph.
// Vendored reference repositories are forbidden imports; generated routes come from src/routes.
async function bundleInputs(root: string) {
  const { stdout } = await execFile(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
      ":(exclude).repos",
      ":(exclude)apps/web/src/routeTree.gen.ts",
    ],
    { cwd: root },
  );
  return [
    ...new Set([
      ...stdout.split("\0").filter(Boolean),
      // Vite and loadRepoEnv intentionally read ignored local environment files.
      ...["", "apps/web/"].flatMap((directory) =>
        [".env", ".env.local", ".env.production", ".env.production.local"].map(
          (name) => `${directory}${name}`,
        ),
      ),
    ]),
  ].sort();
}

export async function bundleKey(root: string, env: NodeJS.ProcessEnv) {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(
    JSON.stringify([
      process.version,
      HostProcessPlatform.defaultValue(),
      HostProcessArchitecture.defaultValue(),
      Object.entries(env)
        .filter(([key]) =>
          /^(?:VITE_|VERCEL_|APP_VERSION$|NODE_ENV$|T3CODE_|EXPO_PUBLIC_)/u.test(key),
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    ]),
  );
  const visit = async (path: string): Promise<void> => {
    if (
      /\.tsbuildinfo$|(?:^|\/)(?:routeTree\.gen\.ts|\.DS_Store|__screenshots__|\.tanstack)$/u.test(
        path,
      )
    )
      return;
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
      hash.update(path);
      hash.update("\0");
      hash.update(await NodeFSP.readFile(absolute));
      hash.update("\0");
    }
  };
  for (const input of await bundleInputs(root)) await visit(input);
  return hash.digest("hex");
}

// A Unix socket is an OS-owned lock: wait for the builder's connection to close, rather than
// poll or guess how long builds take. A crashed builder leaves a refused socket, safe to unlink.
async function acquireBuild(root: string, key: string): Promise<() => Promise<void>> {
  const identity = NodeCrypto.createHash("sha256").update(root).update(key).digest("hex");
  const socketPath = NodePath.join(NodeOS.tmpdir(), `mate-web-${identity.slice(0, 24)}.sock`);
  for (;;) {
    const clients = new Set<NodeNet.Socket>();
    const server = NodeNet.createServer((socket) => {
      clients.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => clients.delete(socket));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
      return async () => {
        for (const client of clients) client.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      await new Promise<void>((resolve, reject) => {
        const socket = NodeNet.connect(socketPath);
        socket.once("close", resolve);
        socket.once("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") resolve();
          else if (error.code === "ECONNREFUSED")
            void NodeFSP.rm(socketPath, { force: true }).then(resolve, reject);
          else reject(error);
        });
      });
    }
  }
}

export async function cachedBundle(
  root: string,
  env: NodeJS.ProcessEnv,
  build: (dist: string) => Promise<void>,
): Promise<string> {
  const key = await bundleKey(root, env);
  const cache = NodePath.join(root, "node_modules/.cache/mate-scenario-web");
  const dist = NodePath.join(cache, key);
  const ready = async () => {
    try {
      await NodeFSP.access(NodePath.join(dist, "index.html"));
      return true;
    } catch {
      return false;
    }
  };
  if (await ready()) return dist;
  await NodeFSP.mkdir(cache, { recursive: true });
  const release = await acquireBuild(root, key);
  let staging: string | undefined;
  try {
    if (await ready()) return dist;
    staging = await NodeFSP.mkdtemp(NodePath.join(cache, ".building-"));
    await build(staging);
    if (key !== (await bundleKey(root, env)))
      throw new Error("Scenario bundle inputs changed during build; rerun the gate");
    await NodeFSP.rename(staging, dist);
    return dist;
  } finally {
    if (staging) await NodeFSP.rm(staging, { recursive: true, force: true });
    await release();
  }
}
