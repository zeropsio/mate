// @effect-diagnostics nodeBuiltinImport:off - a looked-at file resolves in its session's directory, as V1's capture does.
/**
 * A call's pictures, stored before its record holds them (rule 8: pictures travel as references,
 * never bytes): a Zerops result's images and a workspace picture the call looked at go to the
 * Mate's asset store, as V1's capture puts them (`assets/ConversationMedia.ts`), and the record
 * names each by its asset. Storing is idempotent per call and picture, so a batch told again
 * stores nothing twice.
 *
 * @module engine/pump/callPictures
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeFS from "node:fs";

import {
  PAGE_MAX_BYTES,
  type CallResult,
  type CallResultPicture,
  type ImageOccurrence,
  type PageOccurrence,
  type SpiToolCallImage,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { contentAssetsAt } from "../../assets/ContentAssets.ts";

/** A workspace picture a call looked at, as its record names it. */
export interface LookedPicture {
  /** `mate-asset:<id>`, with `:<code>` when the file could not be stored. */
  readonly imagePath: string;
  readonly imageName?: string;
  readonly imageDimensions?: { readonly width: number; readonly height: number };
}

export interface CallPictures {
  /** A result's pictures as references; one that could not be stored is left out. */
  readonly results: (
    thread: ThreadId,
    key: string,
    images: ReadonlyArray<SpiToolCallImage>,
  ) => Effect.Effect<{
    readonly images: ReadonlyArray<CallResultPicture>;
    readonly dropped: boolean;
  }>;
  /** A workspace picture a call looked at, by the path its call named. */
  readonly looked: (
    thread: ThreadId,
    key: string,
    path: string,
  ) => Effect.Effect<LookedPicture | null>;
  /** A page a call published, by the file zcp kept it in; one it cannot take is none. */
  readonly page: (
    thread: ThreadId,
    key: string,
    file: string,
  ) => Effect.Effect<{ readonly asset: PageOccurrence; readonly bytes: number } | null>;
}

/** The tool a Mate's agent publishes a page with (zcp's `zerops_publish_page`). */
export const PUBLISH_PAGE_TOOL = "zerops_publish_page";

/**
 * Where zcp keeps a page it published, as its result names it: a file named by its content in
 * the session's own `.zcp/state/pages` (`docs/spec-mate.md` §5.9 in zcp). Nothing else is read.
 */
const PAGE_NAME = /^page-[0-9a-f]{16}\.html$/;

/** The page a call's result says it published: its file, title and measured height, else none. */
export function publishedPage(
  result: Pick<CallResult, "toolName" | "resultText">,
): { readonly file: string; readonly title: string; readonly height?: number } | null {
  if (result.toolName !== PUBLISH_PAGE_TOOL || result.resultText === undefined) return null;
  try {
    const page = (JSON.parse(result.resultText) as { readonly page?: unknown }).page;
    if (typeof page !== "object" || page === null) return null;
    const { file, title, height } = page as {
      readonly file?: unknown;
      readonly title?: unknown;
      readonly height?: unknown;
    };
    if (typeof file !== "string" || typeof title !== "string" || title.length === 0) return null;
    return typeof height === "number" && Number.isFinite(height) && height > 0
      ? { file, title, height: Math.ceil(height) }
      : { file, title };
  } catch {
    return null;
  }
}

/**
 * A page file's bytes, read as a picture the call looked at is (`ContentAssets.ingestFile`): only
 * a regular file named like zcp's pages, directly in the session's own `.zcp/state/pages`, opened
 * without following a link and without waiting on a FIFO, checked on the open handle, at most the
 * cap. Anything else is none.
 */
async function readPage(cwd: string, file: string): Promise<Uint8Array | null> {
  if (!NodePath.isAbsolute(file) || !PAGE_NAME.test(NodePath.basename(file))) return null;
  const pages = await NodeFSP.realpath(NodePath.join(cwd, ".zcp", "state", "pages"));
  if ((await NodeFSP.realpath(NodePath.dirname(file))) !== pages) return null;
  const handle = await NodeFSP.open(
    NodePath.join(pages, NodePath.basename(file)),
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > PAGE_MAX_BYTES) return null;
    const buffer = Buffer.alloc(PAGE_MAX_BYTES + 1);
    let read = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
      if (read > PAGE_MAX_BYTES) return null;
    }
    return buffer.subarray(0, read);
  } finally {
    await handle.close();
  }
}

/**
 * The pictures of the Mate whose state lives in `stateDir`; a looked-at path resolves in the
 * directory `cwdOf` names for the thread's session.
 */
export const makeCallPictures = (
  stateDir: string,
  cwdOf: (thread: ThreadId) => Effect.Effect<string | undefined>,
): CallPictures => {
  // Opened on first use: a host that never meets a picture never touches the store.
  let opened: ReturnType<typeof contentAssetsAt> | undefined;
  const assets = () => (opened ??= contentAssetsAt(stateDir));
  const owner = (thread: ThreadId, key: string) => ({
    threadId: thread,
    ownerId: key,
    provenance: "capture" as const,
  });
  return {
    results: (thread, key, images) =>
      Effect.forEach(images, (image) =>
        Effect.tryPromise(() => {
          const store = assets();
          return store.legacy([thread, key, image.data], () =>
            store.ingestBytes(Buffer.from(image.data, "base64"), {
              ...owner(thread, key),
              name: "tool-image",
              mimeType: image.mimeType,
            }),
          ) as Promise<ImageOccurrence>;
        }).pipe(
          Effect.map((asset): CallResultPicture | null =>
            asset.original.status === "ready"
              ? {
                  mimeType: image.mimeType,
                  asset,
                  ...(asset.original.width === undefined ? {} : { width: asset.original.width }),
                  ...(asset.original.height === undefined ? {} : { height: asset.original.height }),
                }
              : null,
          ),
          Effect.orElseSucceed(() => null),
        ),
      ).pipe(
        Effect.map((stored) => {
          const kept = stored.filter((picture) => picture !== null);
          return { images: kept, dropped: kept.length < images.length };
        }),
      ),
    looked: (thread, key, path) =>
      Effect.gen(function* () {
        const cwd = yield* cwdOf(thread);
        if (cwd === undefined) return null;
        const asset = (yield* Effect.tryPromise(() => {
          const store = assets();
          return store.legacy([thread, key, path], () =>
            store.ingestFile(NodePath.resolve(cwd, path), {
              ...owner(thread, key),
              name: NodePath.basename(path),
            }),
          );
        })) as ImageOccurrence;
        const original = asset.original;
        return {
          imagePath: `mate-asset:${asset.id}${original.status === "failed" ? `:${original.code}` : ""}`,
          ...(asset.name === undefined ? {} : { imageName: asset.name }),
          ...(original.status === "ready" &&
          original.width !== undefined &&
          original.height !== undefined
            ? { imageDimensions: { width: original.width, height: original.height } }
            : {}),
        };
      }).pipe(Effect.orElseSucceed(() => null)),
    page: (thread, key, file) =>
      Effect.gen(function* () {
        const cwd = yield* cwdOf(thread);
        if (cwd === undefined) return null;
        return yield* Effect.tryPromise(async () => {
          const bytes = await readPage(cwd, file);
          if (bytes === null || bytes.byteLength === 0) return null;
          const asset = await assets().ingestPage(["page", thread, key, file], bytes, {
            threadId: thread,
            ownerId: key,
            name: NodePath.basename(file),
          });
          return { asset, bytes: bytes.byteLength };
        });
      }).pipe(Effect.orElseSucceed(() => null)),
  };
};
