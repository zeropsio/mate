// @effect-diagnostics nodeBuiltinImport:off -- disposable cache input fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { bundleKey, cachedBundle } from "../harness/buildCache.ts";

it("reuses identical input bytes, invalidates bundle inputs, and isolates worktrees", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-cache-"));
  const other = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-cache-"));
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
    await NodeFSP.writeFile(NodePath.join(root, "unrelated.test.ts"), "tests only");
    expect(await cachedBundle(root, {}, build)).toBe(a);
    await NodeFSP.writeFile(input, "second");
    expect(await cachedBundle(root, {}, build)).not.toBe(a);
    expect(builds).toBe(2);
    expect(await bundleKey(root, { VITE_BASE_PATH: "/mate" })).not.toBe(await bundleKey(root, {}));
    expect(await cachedBundle(other, {}, build)).not.toBe(a);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
    await NodeFSP.rm(other, { recursive: true, force: true });
  }
});
it("never publishes a failed or concurrently edited build", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-cache-"));
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
