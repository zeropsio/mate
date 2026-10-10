// @effect-diagnostics nodeBuiltinImport:off - temporary fixtures exercise immutable publication.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId } from "@t3tools/contracts";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vite-plus/test";

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
it.each(["cleanup", "pressure"] as const)(
  "never reclaims any original, including an unreferenced object: %s",
  async (mode) => {
    let full = false;
    const { store } = await fixture(async (file, bytes) => {
      if (full) {
        full = false;
        throw Object.assign(new Error("full"), { code: "ENOSPC" });
      }
      await NodeFSP.writeFile(file, bytes, { flag: "wx" });
    });
    const orphanBytes = await image();
    const keptBytes = await sharp({
      create: { width: 12, height: 12, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    const orphan = await store.ingestBytes(orphanBytes, owner);
    const kept = await store.ingestBytes(keptBytes, owner);
    const preview = await store.preview(orphan.id, 80, 50);
    await NodeFSP.unlink(NodePath.join(store.directory, "occurrences", `${orphan.id}.json`));
    if (mode === "cleanup") await store.reclaim();
    else {
      full = true;
      const incoming = await store.ingestBytes(keptBytes, owner);
      expect(incoming.original.status).toBe("ready");
    }
    for (const [occurrence, bytes] of [
      [orphan, orphanBytes],
      [kept, keptBytes],
    ] as const) {
      if (occurrence.original.status !== "ready") throw new Error("not retained");
      expect(await NodeFSP.readFile((await store.object(occurrence.original.digest)).path)).toEqual(
        bytes,
      );
    }
    await expect(store.object(preview.digest, true)).rejects.toMatchObject({
      code: "object-missing",
    });
  },
);
it.each(["ingest", "claim"] as const)(
  "a pressure retry preserves the exact original while recording its occurrence: %s",
  async (operation) => {
    let full = false;
    const { store } = await fixture(async (file, bytes) => {
      if (full && file.includes("/occurrences/")) {
        full = false;
        throw Object.assign(new Error("full"), { code: "ENOSPC" });
      }
      await NodeFSP.writeFile(file, bytes, { flag: "wx" });
    });
    const bytes = await image();
    const pending = await store.ingestBytes(bytes, owner);
    await NodeFSP.unlink(NodePath.join(store.directory, "occurrences", `${pending.id}.json`));
    full = true;
    const committed =
      operation === "claim"
        ? await store.claim(pending, owner)
        : await store.ingestBytes(bytes, owner);
    if (committed.original.status !== "ready") throw new Error("not retained");
    await store.reclaim();
    expect(await NodeFSP.readFile((await store.object(committed.original.digest)).path)).toEqual(
      bytes,
    );
    expect((await store.occurrence(committed.id)).original).toEqual(committed.original);
  },
);

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

describe("a page an agent published, in the asset store", () => {
  const pageOwner = { threadId: ThreadId.make("thread"), ownerId: "call", name: "page-1.html" };

  it("is kept apart from the pictures, so a build that reads only pictures never meets it", async () => {
    const { root, store } = await fixture();
    const picture = await store.ingestBytes(await image(), owner);
    const page = await store.ingestPage(["call"], Buffer.from("<h1>Plan</h1>"), pageOwner);
    const pictures = await NodeFSP.readdir(NodePath.join(root, "home", "occurrences"));
    expect(pictures).toEqual([`${picture.id}.json`]);
    expect(await store.pageOccurrence(page.id)).toEqual(page);
    expect(await store.pageOwners(page.original.digest)).toEqual([page]);
    expect(await store.owners(page.original.digest)).toEqual([]);
  });

  it("is kept once for the same call, however often it is told", async () => {
    const { store } = await fixture();
    const first = await store.ingestPage(["call"], Buffer.from("<h1>Plan</h1>"), pageOwner);
    const again = await store.ingestPage(["call"], Buffer.from("<h1>Plan</h1>"), pageOwner);
    expect(again.id).toBe(first.id);
  });

  it("is never the same object as the same bytes kept as a picture", async () => {
    const { store } = await fixture();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
    const picture = await store.ingestBytes(svg, { ...owner, name: "dot.svg" });
    const page = await store.ingestPage(["call"], svg, pageOwner);
    if (picture.original.status !== "ready") throw new Error("picture refused");
    expect(page.original.digest).not.toBe(picture.original.digest);
    expect((await store.object(picture.original.digest)).mimeType).toBe("image/svg+xml");
    expect((await store.object(page.original.digest)).mimeType).toBe("text/html");
  });
});

it("an occurrence this build cannot read never hides every other picture's readers", async () => {
  const { root, store } = await fixture();
  const picture = await store.ingestBytes(await image(), owner);
  if (picture.original.status !== "ready") throw new Error("picture refused");
  await NodeFSP.writeFile(
    NodePath.join(root, "home", "occurrences", "00000000-0000-4000-8000-000000000000.json"),
    JSON.stringify({
      ...picture,
      id: "x",
      original: { ...picture.original, mimeType: "text/x-newer" },
    }),
  );
  expect(
    (await new ContentAssets(NodePath.join(root, "home")).owners(picture.original.digest)).map(
      (each) => each.id,
    ),
  ).toEqual([picture.id]);
});
