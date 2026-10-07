// @effect-diagnostics nodeBuiltinImport:off - immutable object publication uses identity-checked file descriptors.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { AssetRepresentation, ImageOccurrence } from "@t3tools/contracts";
import {
  ImageOccurrence as OccurrenceSchema,
  AssetRepresentation as RepresentationSchema,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import sharp, { type Metadata } from "sharp";

const decodeOccurrence = Schema.decodeUnknownSync(OccurrenceSchema);
const decodeRepresentation = Schema.decodeUnknownSync(RepresentationSchema);
const digestOf = (bytes: Uint8Array) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const hasCode = (error: unknown, code: string) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;
export class ContentAssetError extends Error {
  readonly code:
    | "source-missing"
    | "source-changed"
    | "storage-full"
    | "object-missing"
    | "unsupported"
    | "persistence-failed"
    | "preview-unavailable";
  constructor(
    code:
      | "source-missing"
      | "source-changed"
      | "storage-full"
      | "object-missing"
      | "unsupported"
      | "persistence-failed"
      | "preview-unavailable",
  ) {
    super(code === "storage-full" ? "Storage full" : code);
    this.code = code;
  }
}
/** Only a concrete storage failure starts reclamation; no capacity timer or reserve policy. */
export function isStorageFull(error: unknown): boolean {
  let value = error;
  for (let depth = 0; depth < 8 && typeof value === "object" && value !== null; depth++) {
    if (
      ("code" in value && ["ENOSPC", "SQLITE_FULL"].includes(String(value.code))) ||
      ("errcode" in value && value.errcode === 13) ||
      ("name" in value && value.name === "SQLiteError" && "errno" in value && value.errno === 13)
    )
      return true;
    value = "cause" in value ? value.cause : undefined;
  }
  return false;
}
type Owner = Omit<ImageOccurrence, "id" | "original"> & { readonly mimeType?: string };
type StoredObject = AssetRepresentation & { readonly path: string };
const stores = new Map<string, ContentAssets>();
export const contentAssetsAt = (stateDir: string) => {
  const directory = NodePath.join(stateDir, "assets");
  let store = stores.get(directory);
  if (!store) {
    store = new ContentAssets(directory);
    stores.set(directory, store);
  }
  return store;
};

/** Originals remain rooted by retained occurrence receipts, including hidden/restore history. */
export class ContentAssets {
  private ownership: Promise<Map<string, ImageOccurrence[]>> | undefined;
  private previewOwnership: Promise<Map<string, Set<string>>> | undefined;
  private readonly producing = new Map<string, number>();
  private readonly backfilling = new Map<string, Promise<ImageOccurrence>>();
  private readonly encoding = new Map<string, Promise<AssetRepresentation>>();
  private readonly generating = new Map<string, number>();
  readonly directory: string;
  private readonly write: (file: string, bytes: Uint8Array) => Promise<void>;
  constructor(
    directory: string,
    write = (file: string, bytes: Uint8Array) => NodeFSP.writeFile(file, bytes, { flag: "wx" }),
  ) {
    this.directory = directory;
    this.write = write;
  }

  private async atomic(file: string, bytes: Uint8Array): Promise<void> {
    const staging = `${file}.pending-${NodeCrypto.randomUUID()}`;
    const attempt = async () => {
      await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
      await this.write(staging, bytes);
      await NodeFSP.rename(staging, file);
    };
    try {
      try {
        await attempt();
      } catch (error) {
        if (!hasCode(error, "ENOSPC")) throw error;
        await NodeFSP.rm(staging, { force: true });
        await this.reclaim();
        await attempt();
      }
    } catch (error) {
      throw new ContentAssetError(hasCode(error, "ENOSPC") ? "storage-full" : "persistence-failed");
    } finally {
      await NodeFSP.rm(staging, { force: true });
    }
  }

  /** Occurrences precede durable conversation references, and hidden/restore history keeps its roots. */
  async reclaim() {
    const previews = NodePath.join(this.directory, "previews");
    await NodeFSP.rm(NodePath.join(previews, "recipes"), { force: true, recursive: true });
    for (const name of await NodeFSP.readdir(NodePath.join(previews, "objects")).catch(() => [])) {
      if (!this.generating.has(name.slice(0, 64)))
        await NodeFSP.rm(NodePath.join(previews, "objects", name), { force: true });
    }
    this.previewOwnership = undefined;
    const referenced = new Set<string>();
    try {
      for (const name of await NodeFSP.readdir(NodePath.join(this.directory, "occurrences"))) {
        if (!name.endsWith(".json")) continue;
        const occurrence = await this.occurrence(name.slice(0, -5));
        if (occurrence.original.status === "ready") referenced.add(occurrence.original.digest);
      }
    } catch {
      return;
    }
    const objects = await NodeFSP.readdir(NodePath.join(this.directory, "originals")).catch(
      () => [],
    );
    for (const digest of objects) {
      if (!/^[a-f0-9]{64}$/.test(digest) || referenced.has(digest) || this.producing.has(digest))
        continue;
      // A manifest identifies an object we own; incomplete/unknown publication stays conservative.
      try {
        await this.object(digest);
      } catch {
        continue;
      }
      await NodeFSP.rm(NodePath.join(this.directory, "originals", digest), { force: true });
      await NodeFSP.rm(NodePath.join(this.directory, "originals", `${digest}.json`), {
        force: true,
      });
    }
  }

  private async publish(
    bytes: Uint8Array,
    preview = false,
    mimeHint?: string,
  ): Promise<AssetRepresentation> {
    let info: Partial<Metadata> = {};
    try {
      info = await sharp(bytes).metadata();
    } catch {
      if (preview || !mimeHint?.startsWith("image/")) throw new ContentAssetError("unsupported");
    }
    const mimeType =
      info.format === "jpeg"
        ? "image/jpeg"
        : info.format === "svg"
          ? "image/svg+xml"
          : info.format
            ? `image/${info.format}`
            : mimeHint!;
    const digest = digestOf(bytes);
    const prefix = preview ? "previews/objects" : "originals";
    const file = NodePath.join(this.directory, prefix, digest);
    const representation: AssetRepresentation = {
      digest,
      mimeType,
      sizeBytes: bytes.byteLength,
      ...(info.width === undefined ? {} : { width: info.width }),
      ...(info.height === undefined ? {} : { height: info.height }),
      relativeUrl: `/api/assets/objects/${digest}/${preview ? "preview" : "original"}`,
    };
    try {
      const { path: _path, ...retained } = await this.object(digest, preview);
      return retained;
    } catch {
      await this.atomic(file, bytes);
      await NodeFSP.chmod(file, 0o444);
    }
    await this.atomic(`${file}.json`, Buffer.from(JSON.stringify(representation)));
    return representation;
  }

  async ingestBytes(bytes: Uint8Array, owner: Owner): Promise<ImageOccurrence> {
    const id = NodeCrypto.randomUUID();
    let occurrence: ImageOccurrence;
    const digest = digestOf(bytes);
    this.producing.set(digest, (this.producing.get(digest) ?? 0) + 1);
    try {
      const { relativeUrl: _, ...original } = await this.publish(
        bytes,
        false,
        owner.mimeType ?? mediaMimeTypeFromExtension(NodePath.extname(owner.name)) ?? undefined,
      );
      occurrence = { ...owner, id, original: { status: "ready", ...original } };
    } catch (error) {
      occurrence = {
        ...owner,
        id,
        original: {
          status: "failed",
          code:
            error instanceof ContentAssetError &&
            error.code !== "preview-unavailable" &&
            error.code !== "object-missing"
              ? error.code
              : "persistence-failed",
        },
      };
    }
    try {
      await this.atomic(
        NodePath.join(this.directory, "occurrences", `${id}.json`),
        Buffer.from(JSON.stringify(occurrence)),
      );
    } catch (error) {
      // The caller gets the refusal, but must not claim it was durably recorded.
      this.producing.set(digest, this.producing.get(digest)! - 1);
      if (this.producing.get(digest) === 0) this.producing.delete(digest);
      return {
        ...owner,
        id,
        original: {
          status: "failed",
          code:
            error instanceof ContentAssetError && error.code === "storage-full"
              ? "storage-full"
              : "persistence-failed",
        },
      };
    }
    this.producing.set(digest, this.producing.get(digest)! - 1);
    if (this.producing.get(digest) === 0) this.producing.delete(digest);
    await this.remember(occurrence);
    return occurrence;
  }

  async failure(
    owner: Owner,
    code: Extract<ImageOccurrence["original"], { status: "failed" }>["code"],
  ): Promise<ImageOccurrence> {
    const occurrence: ImageOccurrence = {
      ...owner,
      id: NodeCrypto.randomUUID(),
      original: { status: "failed", code },
    };
    try {
      await this.atomic(
        NodePath.join(this.directory, "occurrences", `${occurrence.id}.json`),
        Buffer.from(JSON.stringify(occurrence)),
      );
    } catch (error) {
      return {
        ...occurrence,
        original: {
          status: "failed",
          code:
            error instanceof ContentAssetError && error.code === "storage-full"
              ? "storage-full"
              : "persistence-failed",
        },
      };
    }
    return occurrence;
  }

  async ingestFile(source: string, owner: Owner): Promise<ImageOccurrence> {
    try {
      const canonical = await NodeFSP.realpath(source);
      const handle = await NodeFSP.open(
        canonical,
        NodeFS.constants.O_RDONLY | NodeFS.constants.O_NONBLOCK | NodeFS.constants.O_NOFOLLOW,
      );
      try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile()) throw new ContentAssetError("unsupported");
        const bytes = await handle.readFile();
        const after = await handle.stat({ bigint: true });
        const current = await NodeFSP.stat(canonical, { bigint: true });
        if (
          before.ino !== current.ino ||
          before.dev !== current.dev ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs ||
          BigInt(bytes.byteLength) !== before.size
        )
          throw new ContentAssetError("source-changed");
        return await this.ingestBytes(bytes, owner);
      } finally {
        await handle.close();
      }
    } catch (error) {
      const occurrence: ImageOccurrence = {
        ...owner,
        id: NodeCrypto.randomUUID(),
        original: {
          status: "failed",
          code: hasCode(error, "ENOENT")
            ? "source-missing"
            : error instanceof ContentAssetError &&
                (error.code === "source-changed" || error.code === "unsupported")
              ? error.code
              : "persistence-failed",
        },
      };
      try {
        await this.atomic(
          NodePath.join(this.directory, "occurrences", `${occurrence.id}.json`),
          Buffer.from(JSON.stringify(occurrence)),
        );
      } catch (failure) {
        return {
          ...occurrence,
          original: {
            status: "failed",
            code:
              failure instanceof ContentAssetError && failure.code === "storage-full"
                ? "storage-full"
                : "persistence-failed",
          },
        };
      }
      return occurrence;
    }
  }

  async legacy(
    key: string | ReadonlyArray<unknown>,
    ingest: () => Promise<ImageOccurrence>,
  ): Promise<ImageOccurrence> {
    const identity = digestOf(Buffer.from(typeof key === "string" ? key : JSON.stringify(key)));
    const existing = this.backfilling.get(identity);
    if (existing) return existing;
    const binding = NodePath.join(this.directory, "backfills", `${identity}.json`);
    const work: Promise<ImageOccurrence> = (async (): Promise<ImageOccurrence> => {
      try {
        const value = JSON.parse(await NodeFSP.readFile(binding, "utf8")) as { id: string };
        return await this.occurrence(value.id);
      } catch {
        /* Backfill available legacy bytes once, never by pathname alone. */
      }
      const occurrence = await ingest();
      try {
        await this.atomic(binding, Buffer.from(JSON.stringify({ id: occurrence.id })));
      } catch (error) {
        return {
          ...occurrence,
          original: {
            status: "failed",
            code:
              error instanceof ContentAssetError && error.code === "storage-full"
                ? "storage-full"
                : "persistence-failed",
          },
        };
      }
      return occurrence;
    })();
    this.backfilling.set(identity, work);
    try {
      return await work;
    } finally {
      this.backfilling.delete(identity);
    }
  }

  async claim(occurrence: ImageOccurrence, owner: Owner): Promise<ImageOccurrence> {
    const claimed: ImageOccurrence = {
      ...owner,
      id: NodeCrypto.randomUUID(),
      original: occurrence.original,
    };
    await this.atomic(
      NodePath.join(this.directory, "occurrences", `${claimed.id}.json`),
      Buffer.from(JSON.stringify(claimed)),
    );
    await this.remember(claimed);
    return claimed;
  }

  /** Explicit cancellation releases the pending upload root; committed occurrence roots remain. */
  async releaseUpload(attachmentId: string): Promise<void> {
    const key = digestOf(Buffer.from(JSON.stringify(["upload", attachmentId])));
    const binding = NodePath.join(this.directory, "backfills", `${key}.json`);
    try {
      const value = JSON.parse(await NodeFSP.readFile(binding, "utf8")) as { id: string };
      const occurrence = await this.occurrence(value.id);
      if (occurrence.threadId !== "pending" || occurrence.ownerId !== attachmentId) return;
      await NodeFSP.rm(binding, { force: true });
      await NodeFSP.rm(NodePath.join(this.directory, "occurrences", `${occurrence.id}.json`), {
        force: true,
      });
    } catch {
      /* An absent pending root needs no release. */
    }
  }

  async upload(attachmentId: string, file: string, owner: Owner): Promise<ImageOccurrence> {
    return this.legacy(JSON.stringify(["upload", attachmentId]), () =>
      this.ingestFile(file, owner),
    );
  }

  async occurrence(id: string): Promise<ImageOccurrence> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ContentAssetError("object-missing");
    try {
      return decodeOccurrence(
        JSON.parse(
          await NodeFSP.readFile(
            NodePath.join(this.directory, "occurrences", `${id}.json`),
            "utf8",
          ),
        ),
      );
    } catch {
      throw new ContentAssetError("object-missing");
    }
  }

  async object(digest: string, preview = false): Promise<StoredObject> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new ContentAssetError("object-missing");
    const file = NodePath.join(this.directory, preview ? "previews/objects" : "originals", digest);
    try {
      const value = decodeRepresentation(
        JSON.parse(await NodeFSP.readFile(`${file}.json`, "utf8")),
      );
      const stat = await NodeFSP.stat(file);
      if (!stat.isFile() || stat.size !== value.sizeBytes || value.digest !== digest)
        throw new ContentAssetError("object-missing");
      return { ...value, path: file };
    } catch {
      throw new ContentAssetError("object-missing");
    }
  }

  private async remember(occurrence: ImageOccurrence): Promise<void> {
    if (!this.ownership || occurrence.original.status !== "ready") return;
    const owners = await this.ownership.catch(() => null);
    if (owners === null) return;
    const values = owners.get(occurrence.original.digest) ?? [];
    if (!values.some((value) => value.id === occurrence.id)) values.push(occurrence);
    owners.set(occurrence.original.digest, values);
  }

  async owners(digest: string, preview = false): Promise<ReadonlyArray<ImageOccurrence>> {
    // Derived indexes are built once after restart and updated at publication, never one scan per image GET.
    this.ownership ??= (async () => {
      const owners = new Map<string, ImageOccurrence[]>();
      const files = await NodeFSP.readdir(NodePath.join(this.directory, "occurrences"));
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        const occurrence = await this.occurrence(file.slice(0, -5));
        if (occurrence.original.status !== "ready") continue;
        const values = owners.get(occurrence.original.digest) ?? [];
        values.push(occurrence);
        owners.set(occurrence.original.digest, values);
      }
      return owners;
    })().catch((error) => {
      this.ownership = undefined;
      throw error;
    });
    const owners = await this.ownership;
    if (!preview) return owners.get(digest) ?? [];
    this.previewOwnership ??= (async () => {
      const index = new Map<string, Set<string>>();
      const files = await NodeFSP.readdir(NodePath.join(this.directory, "previews/recipes")).catch(
        () => [],
      );
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        const value = JSON.parse(
          await NodeFSP.readFile(NodePath.join(this.directory, "previews/recipes", file), "utf8"),
        ) as { original: string; representation: AssetRepresentation };
        const originals = index.get(value.representation.digest) ?? new Set<string>();
        originals.add(value.original);
        index.set(value.representation.digest, originals);
      }
      return index;
    })().catch((error) => {
      this.previewOwnership = undefined;
      throw error;
    });
    const index = await this.previewOwnership;
    return [...(index.get(digest) ?? [])].flatMap((original) => owners.get(original) ?? []);
  }

  async preview(id: string, width: number, height: number): Promise<AssetRepresentation> {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192
    )
      throw new ContentAssetError("unsupported");
    const occurrence = await this.occurrence(id);
    if (occurrence.original.status !== "ready")
      throw new ContentAssetError(occurrence.original.code);
    const original = await this.object(occurrence.original.digest);
    if (!original.width || !original.height) throw new ContentAssetError("preview-unavailable");
    const scale = Math.min(width / original.width, height / original.height, 1);
    const w = Math.max(1, Math.round(original.width * scale));
    const h = Math.max(1, Math.round(original.height * scale));
    const key = `${original.digest}-${w}-${h}-lossless-v1`;
    const existing = this.encoding.get(key);
    if (existing) return existing;
    const run = (async () => {
      const recipe = NodePath.join(this.directory, "previews/recipes", `${key}.json`);
      // Reuse a nearby larger lossless representation rather than encoding resize noise.
      const recipes = await NodeFSP.readdir(NodePath.dirname(recipe)).catch(() => []);
      for (const name of recipes.filter(
        (name) => name.startsWith(`${original.digest}-`) && name.endsWith(".json"),
      )) {
        try {
          const candidate = JSON.parse(
            await NodeFSP.readFile(NodePath.join(NodePath.dirname(recipe), name), "utf8"),
          ) as { representation: AssetRepresentation };
          const value = decodeRepresentation(candidate.representation);
          if (
            value.width &&
            value.height &&
            value.width >= w &&
            value.height >= h &&
            value.width <= Math.ceil(w * 1.1) &&
            value.height <= Math.ceil(h * 1.1)
          ) {
            await this.object(value.digest, true);
            return value;
          }
        } catch {
          /* Reclaimed or interrupted previews are regenerable. */
        }
      }
      try {
        const cached = JSON.parse(await NodeFSP.readFile(recipe, "utf8")) as {
          representation: AssetRepresentation;
        };
        await this.object(cached.representation.digest, true);
        return decodeRepresentation(cached.representation);
      } catch {
        /* A disposable representation can be regenerated. */
      }
      try {
        const resized = sharp(original.path).resize(w, h, {
          fit: "inside",
          withoutEnlargement: true,
        });
        const png = await resized.clone().png().toBuffer();
        const webp = await resized
          .clone()
          .webp({ lossless: true })
          .toBuffer()
          .catch(() => null);
        const bytes = webp !== null && webp.byteLength < png.byteLength ? webp : png;
        const digest = digestOf(bytes);
        this.generating.set(digest, (this.generating.get(digest) ?? 0) + 1);
        try {
          const representation = await this.publish(bytes, true);
          await this.atomic(
            recipe,
            Buffer.from(JSON.stringify({ original: original.digest, representation })),
          );
          if (this.previewOwnership) {
            const index = await this.previewOwnership.catch(() => null);
            if (index) {
              const originals = index.get(representation.digest) ?? new Set<string>();
              originals.add(original.digest);
              index.set(representation.digest, originals);
            }
          }
          return representation;
        } finally {
          const remaining = this.generating.get(digest)! - 1;
          if (remaining === 0) this.generating.delete(digest);
          else this.generating.set(digest, remaining);
        }
      } catch (error) {
        throw error instanceof ContentAssetError
          ? error
          : new ContentAssetError("preview-unavailable");
      }
    })();
    this.encoding.set(key, run);
    try {
      return await run;
    } finally {
      this.encoding.delete(key);
    }
  }
}
