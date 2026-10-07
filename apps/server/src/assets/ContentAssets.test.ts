// @effect-diagnostics nodeBuiltinImport:off - temporary fixtures exercise immutable publication.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId } from "@t3tools/contracts";
import sharp from "sharp";
import { afterEach, expect, it } from "vite-plus/test";

import { ContentAssets } from "./ContentAssets.ts";

const roots: string[] = [];
async function fixture(write?: (file: string, bytes: Uint8Array) => Promise<void>) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-assets-"));
  roots.push(root);
  return { root, store: new ContentAssets(NodePath.join(root, "home"), write) };
}
const owner = {
  threadId: ThreadId.make("thread"),
  ownerId: "message",
  name: "shot.png",
  provenance: "capture" as const,
};
const image = () =>
  sharp({ create: { width: 320, height: 200, channels: 4, background: "red" } })
    .png()
    .toBuffer();
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

it("retains exact originals before a temporary source disappears without a viewer", async () => {
  const { root, store } = await fixture();
  const bytes = await image();
  const source = NodePath.join(root, "shot.png");
  await NodeFSP.writeFile(source, bytes);
  const occurrence = await store.ingestFile(source, owner);
  await NodeFSP.unlink(source);
  expect(occurrence.original.status).toBe("ready");
  if (occurrence.original.status !== "ready") throw new Error("not retained");
  expect(occurrence.original.digest).toBe(
    NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
  );
  expect(await NodeFSP.readFile((await store.object(occurrence.original.digest)).path)).toEqual(
    bytes,
  );
  expect(await new ContentAssets(NodePath.join(root, "home")).occurrence(occurrence.id)).toEqual(
    occurrence,
  );
});
it("reusing a pathname creates a new occurrence and preserves both originals", async () => {
  const { root, store } = await fixture();
  const source = NodePath.join(root, "shot.png");
  await NodeFSP.writeFile(source, await image());
  const first = await store.ingestFile(source, owner);
  await NodeFSP.writeFile(
    source,
    await sharp({ create: { width: 32, height: 20, channels: 4, background: "blue" } })
      .png()
      .toBuffer(),
  );
  const second = await store.ingestFile(source, owner);
  expect(first.id).not.toBe(second.id);
  expect(first.original).not.toEqual(second.original);
});
it("shares a demanded lossless preview, records its dimensions, and never upscales", async () => {
  const { store } = await fixture();
  const occurrence = await store.ingestBytes(await image(), owner);
  const [a, b] = await Promise.all([
    store.preview(occurrence.id, 80, 50),
    store.preview(occurrence.id, 80, 50),
  ]);
  expect(a).toEqual(b);
  expect([a.width, a.height]).toEqual([80, 50]);
  const large = await store.preview(occurrence.id, 640, 400);
  expect([large.width, large.height]).toEqual([320, 200]);
});
it("reclaims previews on actual ENOSPC and refuses a still-failing original write without evicting referenced originals", async () => {
  let full = false;
  const { store } = await fixture(async (file, bytes) => {
    if (full) throw Object.assign(new Error("full"), { code: "ENOSPC" });
    await NodeFSP.writeFile(file, bytes, { flag: "wx" });
  });
  const kept = await store.ingestBytes(await image(), owner);
  const preview = await store.preview(kept.id, 80, 50);
  full = true;
  const refused = await store.ingestBytes(
    await sharp({ create: { width: 12, height: 12, channels: 4, background: "blue" } })
      .png()
      .toBuffer(),
    owner,
  );
  expect(refused.original).toEqual({ status: "failed", code: "storage-full" });
  if (kept.original.status !== "ready") throw new Error("not retained");
  expect((await store.object(kept.original.digest)).sizeBytes).toBe(kept.original.sizeBytes);
  await expect(store.object(preview.digest)).rejects.toMatchObject({ code: "object-missing" });
});

it("an actual full write reclaims disposable previews, retries once, and cleans partial files", async () => {
  let fail = false;
  let attempts = 0;
  const { store } = await fixture(async (file, bytes) => {
    if (fail && file.includes("/originals/") && !file.includes(".json")) {
      attempts++;
      await NodeFSP.writeFile(file, bytes.subarray(0, 3), { flag: "wx" });
      if (attempts === 1) throw Object.assign(new Error("full"), { code: "ENOSPC" });
      await NodeFSP.writeFile(file, bytes);
    } else await NodeFSP.writeFile(file, bytes, { flag: "wx" });
  });
  const kept = await store.ingestBytes(await image(), owner);
  const preview = await store.preview(kept.id, 80, 50);
  fail = true;
  const admitted = await store.ingestBytes(
    await sharp({ create: { width: 12, height: 12, channels: 4, background: "blue" } })
      .png()
      .toBuffer(),
    owner,
  );
  expect(admitted.original.status).toBe("ready");
  expect(attempts).toBe(2);
  expect(
    (await NodeFSP.readdir(NodePath.join(store.directory, "originals"))).some((name) =>
      name.includes(".pending-"),
    ),
  ).toBe(false);
  await expect(store.object(preview.digest, true)).rejects.toMatchObject({
    code: "object-missing",
  });
  if (kept.original.status !== "ready") throw new Error("not retained");
  expect((await store.object(kept.original.digest)).sizeBytes).toBe(kept.original.sizeBytes);
});
it("reclaims a proven unreferenced object and preserves every remaining occurrence root", async () => {
  const { store } = await fixture();
  const orphan = await store.ingestBytes(await image(), owner);
  const kept = await store.ingestBytes(
    await sharp({ create: { width: 12, height: 12, channels: 4, background: "blue" } })
      .png()
      .toBuffer(),
    owner,
  );
  await NodeFSP.unlink(NodePath.join(store.directory, "occurrences", `${orphan.id}.json`));
  await store.reclaim();
  if (orphan.original.status !== "ready" || kept.original.status !== "ready")
    throw new Error("not retained");
  await expect(store.object(orphan.original.digest)).rejects.toMatchObject({
    code: "object-missing",
  });
  expect((await store.object(kept.original.digest)).sizeBytes).toBe(kept.original.sizeBytes);
});

it("updates the derived owner indexes after a later original and preview publication", async () => {
  const { store } = await fixture();
  const first = await store.ingestBytes(await image(), owner);
  const firstPreview = await store.preview(first.id, 80, 50);
  expect((await store.owners(firstPreview.digest, true)).map((value) => value.id)).toContain(
    first.id,
  );
  const second = await store.ingestBytes(
    await sharp({ create: { width: 12, height: 12, channels: 4, background: "blue" } })
      .png()
      .toBuffer(),
    owner,
  );
  const secondPreview = await store.preview(second.id, 6, 6);
  expect((await store.owners(secondPreview.digest, true)).map((value) => value.id)).toContain(
    second.id,
  );
});

it("a pressure retry of the preview recipe never publishes a reference to reclaimed bytes", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-preview-pressure-"));
  let full = true;
  const store = new ContentAssets(directory, async (file, bytes) => {
    if (file.includes("previews/recipes/") && full) {
      full = false;
      throw Object.assign(new Error("full"), { code: "ENOSPC" });
    }
    await NodeFSP.writeFile(file, bytes, { flag: "wx" });
  });
  try {
    const occurrence = await store.ingestBytes(await image(), owner);
    const preview = await store.preview(occurrence.id, 30, 20);
    expect((await NodeFSP.readFile((await store.object(preview.digest, true)).path)).length).toBe(
      preview.sizeBytes,
    );
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
