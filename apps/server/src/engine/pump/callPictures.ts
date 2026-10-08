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
import * as NodePath from "node:path";

import type { CallResultPicture, SpiToolCallImage, ThreadId } from "@t3tools/contracts";
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
}

/** The asset store's description of a stored picture. */
interface Stored {
  readonly id: string;
  readonly name?: string;
  readonly original:
    | { readonly status: "ready"; readonly width?: number; readonly height?: number }
    | { readonly status: "failed"; readonly code: string };
}

/**
 * The pictures of the Mate whose state lives in `stateDir`; a looked-at path resolves in the
 * directory `cwdOf` names for the thread's session.
 */
export const makeCallPictures = (
  stateDir: string,
  cwdOf: (thread: ThreadId) => Effect.Effect<string | undefined>,
): CallPictures => {
  const store = contentAssetsAt(stateDir);
  const owner = (thread: ThreadId, key: string) => ({
    threadId: thread,
    ownerId: key,
    provenance: "capture" as const,
  });
  return {
    results: (thread, key, images) =>
      Effect.forEach(images, (image) =>
        Effect.tryPromise(
          () =>
            store.legacy([thread, key, image.data], () =>
              store.ingestBytes(Buffer.from(image.data, "base64"), {
                ...owner(thread, key),
                name: "tool-image",
                mimeType: image.mimeType,
              }),
            ) as Promise<Stored>,
        ).pipe(
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
        const asset = (yield* Effect.tryPromise(() =>
          store.legacy([thread, key, path], () =>
            store.ingestFile(NodePath.resolve(cwd, path), {
              ...owner(thread, key),
              name: NodePath.basename(path),
            }),
          ),
        )) as Stored;
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
  };
};
