// @effect-diagnostics nodeBuiltinImport:off -- disposable cache input fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { bundleKey, cachedBundle } from "../harness/buildCache.ts";

async function cacheFixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-cache-"));
  NodeChildProcess.execFileSync("git", ["init", "-q", root]);
  await NodeFSP.writeFile(NodePath.join(root, ".gitignore"), "node_modules/\n*.log\n");
  return root;
}

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
