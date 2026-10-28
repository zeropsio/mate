// @effect-diagnostics nodeBuiltinImport:off -- disposable cache input fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { bundleKey, cachedBundle } from "../harness/buildCache.ts";

async function cacheFixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-cache-"));
  NodeChildProcess.execFileSync("git", ["init", "-q", root]);
  await NodeFSP.writeFile(NodePath.join(root, ".gitignore"), "node_modules/\n*.log\n");
  return root;
}

it("Decision: the bundle key keeps Node because its version can change the bundle", async () => {
  const root = await cacheFixture();
  const version = process.version;
  try {
    Object.defineProperty(process, "version", { value: "v24.22.1" });
    const producer = await bundleKey(root, {});
    Object.defineProperty(process, "version", { value: "v24.22.2" });
    expect(await bundleKey(root, {})).not.toBe(producer);
  } finally {
    Object.defineProperty(process, "version", { value: version });
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it.each([
  {
    title: "reuses the bundle after a server-only edit",
    path: "apps/server/src/server.ts",
    rebuild: false,
  },
  {
    title: "reuses the bundle after a docs edit",
    path: "docs/operations/example.md",
    rebuild: false,
  },
  {
    title: "reuses the bundle after an unrelated script edit",
    path: "scripts/example.ts",
    rebuild: false,
  },
  {
    title: "rebuilds the bundle after a web component edit",
    path: "apps/web/src/components/Example.tsx",
    rebuild: true,
  },
  {
    title: "rebuilds the bundle after a Tailwind CSS source edit",
    path: "apps/web/src/index.css",
    rebuild: true,
  },
  {
    title: "rebuilds the bundle after an imported contracts edit",
    path: "packages/contracts/src/index.ts",
    rebuild: true,
  },
  {
    title: "rebuilds the bundle after a client-runtime edit",
    path: "packages/client-runtime/src/state.ts",
    rebuild: true,
  },
  {
    title: "rebuilds the bundle after a shared helper edit",
    path: "packages/shared/src/basePath.ts",
    rebuild: true,
  },
  { title: "rebuilds the bundle after a lockfile edit", path: "pnpm-lock.yaml", rebuild: true },
  {
    title: "rebuilds the bundle after a Vite config edit",
    path: "apps/web/vite.config.ts",
    rebuild: true,
  },
  {
    title: "rebuilds the bundle after a scenario config edit",
    path: "apps/web/test/scenarios/vitest.config.ts",
    rebuild: true,
  },
  {
    title: "rebuilds the bundle after a public-config edit",
    path: "scripts/lib/public-config.ts",
    rebuild: true,
  },
  {
    title: "rebuilds the bundle after a public asset edit",
    path: "apps/web/public/favicon.svg",
    rebuild: true,
  },
])("$title", async ({ path, rebuild }) => {
  const root = await cacheFixture();
  try {
    const input = NodePath.join(root, path);
    await NodeFSP.mkdir(NodePath.dirname(input), { recursive: true });
    await NodeFSP.writeFile(input, "first");
    const before = await bundleKey(root, {});
    await NodeFSP.writeFile(input, "second");
    const after = await bundleKey(root, {});
    if (rebuild) expect(after).not.toBe(before);
    else expect(after).toBe(before);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it.each([
  '@source "../../../../tailwind-content/**/*.html";',
  '@import "tailwindcss" source("../../../../tailwind-content");',
])("includes explicit Tailwind sources outside the web tree: %s", async (directive) => {
  const root = await cacheFixture();
  try {
    const stylesheet = NodePath.join(root, "apps/web/src/styles/index.css");
    const candidate = NodePath.join(root, "tailwind-content/nested/candidate.html");
    await NodeFSP.mkdir(NodePath.dirname(stylesheet), { recursive: true });
    await NodeFSP.mkdir(NodePath.dirname(candidate), { recursive: true });
    await NodeFSP.writeFile(stylesheet, directive);
    const absent = await bundleKey(root, {});
    await NodeFSP.writeFile(candidate, '<div class="p-4">');
    const added = await bundleKey(root, {});
    expect(added).not.toBe(absent);
    await NodeFSP.writeFile(candidate, '<div class="p-8">');
    expect(await bundleKey(root, {})).not.toBe(added);
    await NodeFSP.rm(candidate);
    expect(await bundleKey(root, {})).toBe(absent);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("Decision: a stale bundle is worse than a slow one — when unsure whether a path is an input, it is an input", async () => {
  const root = await cacheFixture();
  try {
    const input = NodePath.join(root, "packages/shared/src/future-import.ts");
    await NodeFSP.mkdir(NodePath.dirname(input), { recursive: true });
    const before = await bundleKey(root, {});
    await NodeFSP.writeFile(input, "export const candidate = true;");
    expect(await bundleKey(root, {})).not.toBe(before);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("removing a tracked stylesheet invalidates the cache without blocking the next build", async () => {
  const root = await cacheFixture();
  try {
    const path = "apps/web/src/obsolete.css";
    await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(root, path), ".obsolete { color: red; }");
    NodeChildProcess.execFileSync("git", ["add", path], { cwd: root });
    let builds = 0;
    const build = async (dist: string) => {
      await NodeFSP.writeFile(NodePath.join(dist, "index.html"), String(++builds));
    };
    const before = await cachedBundle(root, {}, build);
    await NodeFSP.rm(NodePath.join(root, path));
    const next = cachedBundle(root, {}, build);
    await expect(next).resolves.not.toBe(before);
    expect(await NodeFSP.readFile(NodePath.join(await next, "index.html"), "utf8")).toBe("2");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("reuses identical input bytes, invalidates bundle inputs, and isolates worktrees", async () => {
  const root = await cacheFixture();
  const other = await cacheFixture();
  let builds = 0;
  const build = async (dist: string) => {
    builds++;
    await NodeFSP.writeFile(NodePath.join(dist, "index.html"), "built");
  };
  try {
    await NodeFSP.mkdir(NodePath.join(root, "apps/web/src"), { recursive: true });
    const input = NodePath.join(root, "apps/web/src/main.ts");
    await NodeFSP.writeFile(input, "first");
    const [a, b] = await Promise.all([
      cachedBundle(root, {}, build),
      cachedBundle(root, {}, build),
    ]);
    expect(a).toBe(b);
    expect(builds).toBe(1);
    await NodeFSP.writeFile(input, "first");
    expect(await cachedBundle(root, {}, build)).toBe(a);
    await NodeFSP.writeFile(NodePath.join(root, "unrelated.log"), "tests only");
    expect(await cachedBundle(root, {}, build)).toBe(a);
    await NodeFSP.writeFile(input, "second");
    const updated = await cachedBundle(root, {}, build);
    expect(updated).not.toBe(a);
    expect(builds).toBe(2);
    await NodeFSP.writeFile(
      NodePath.join(root, ".gitignore"),
      "node_modules/\n*.log\nsrc/ignored.ts\n",
    );
    expect(await cachedBundle(root, {}, build)).not.toBe(updated);
    expect(builds).toBe(3);
    expect(await bundleKey(root, { VITE_BASE_PATH: "/mate" })).not.toBe(await bundleKey(root, {}));
    expect(await cachedBundle(other, {}, build)).not.toBe(a);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
    await NodeFSP.rm(other, { recursive: true, force: true });
  }
});
it("never publishes a failed or concurrently edited build", async () => {
  const root = await cacheFixture();
  try {
    await expect(
      cachedBundle(root, {}, async () => {
        throw new Error("build failed");
      }),
    ).rejects.toThrow("build failed");
    await expect(
      cachedBundle(root, {}, async (dist) => {
        await NodeFSP.writeFile(NodePath.join(dist, "index.html"), "stale");
        await NodeFSP.writeFile(NodePath.join(root, "package.json"), "{}");
      }),
    ).rejects.toThrow("inputs changed");
    const dist = await cachedBundle(root, {}, async (dist) => {
      await NodeFSP.writeFile(NodePath.join(dist, "index.html"), "fresh");
    });
    expect(await NodeFSP.readFile(NodePath.join(dist, "index.html"), "utf8")).toBe("fresh");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it.each(["design-new.html", "nested/design.html", "new-source.txt"])(
  "invalidates added, edited and removed Tailwind sources: %s",
  async (path) => {
    const root = await cacheFixture();
    try {
      const file = NodePath.join(root, "apps/web", path);
      await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
      const absent = await bundleKey(root, {});
      await NodeFSP.writeFile(file, '<div class="p-4">');
      const added = await bundleKey(root, {});
      expect(added).not.toBe(absent);
      await NodeFSP.writeFile(file, '<div class="p-8">');
      expect(await bundleKey(root, {})).not.toBe(added);
      await NodeFSP.rm(file);
      expect(await bundleKey(root, {})).toBe(absent);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);

it("publishes one finished bundle for two concurrent builder processes", async () => {
  const root = await cacheFixture();
  let attempts = 0;
  let builds = 0;
  const building = new Set<NodeChildProcess.ChildProcess>();
  const finish = () => {
    if (attempts !== 2) return;
    for (const child of building) child.send("finish");
    building.clear();
  };
  const worker = () => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [NodeURL.fileURLToPath(new URL("./buildCacheWorker.ts", import.meta.url)), root],
      { stdio: ["ignore", "ignore", "inherit", "ipc"] },
    );
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    const ready = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Builder exited before ready")));
      child.once("message", (message) =>
        message === "ready" ? resolve() : reject(new Error("Invalid builder readiness")),
      );
    });
    const result = new Promise<{ dist: string; content: string }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Builder exited before publishing")));
      child.on("message", (message) => {
        if (message === "attempting") {
          attempts++;
          finish();
        } else if (message === "building") {
          builds++;
          building.add(child);
          finish();
        } else if (
          typeof message === "object" &&
          message !== null &&
          "dist" in message &&
          typeof message.dist === "string" &&
          "content" in message &&
          typeof message.content === "string"
        ) {
          resolve({ dist: message.dist, content: message.content });
        }
      });
    });
    return { child, exited, ready, result };
  };
  const workers = [worker(), worker()];
  try {
    const [, results] = await Promise.all([
      Promise.all(workers.map((worker) => worker.ready)).then(() => {
        for (const worker of workers) worker.child.send("start");
      }),
      Promise.all(workers.map((worker) => worker.result)),
    ]);
    expect(builds).toBe(1);
    expect(results[0]?.dist).toBe(results[1]?.dist);
    expect(results.map((result) => result.content)).toEqual(["finished bundle", "finished bundle"]);
  } finally {
    for (const worker of workers) worker.child.kill("SIGKILL");
    await Promise.all(workers.map((worker) => worker.exited));
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("a bundle artifact is reused in another checkout only when its input bytes match", async () => {
  const builder = await cacheFixture();
  const consumer = await cacheFixture();
  try {
    const built = await cachedBundle(builder, {}, async (dist) => {
      await NodeFSP.writeFile(NodePath.join(dist, "index.html"), "certified bundle");
    });
    const restored = NodePath.join(consumer, NodePath.relative(builder, built));
    await NodeFSP.cp(built, restored, { recursive: true });
    const noBuild = async () => {
      throw new Error("artifact required");
    };
    expect(await cachedBundle(consumer, {}, noBuild)).toBe(restored);
    expect(await NodeFSP.readFile(NodePath.join(restored, "index.html"), "utf8")).toBe(
      "certified bundle",
    );
    await NodeFSP.mkdir(NodePath.join(consumer, "apps/web/src"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(consumer, "apps/web/src/main.ts"), "changed");
    await expect(cachedBundle(consumer, {}, noBuild)).rejects.toThrow("artifact required");
  } finally {
    await NodeFSP.rm(builder, { recursive: true, force: true });
    await NodeFSP.rm(consumer, { recursive: true, force: true });
  }
});
