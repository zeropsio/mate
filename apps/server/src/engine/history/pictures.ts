// @effect-diagnostics nodeBuiltinImport:off - a looked-at path resolves as V1's capture resolves it.
/**
 * A V1 call's inline pictures (a `zerops_browser` screenshot, a preview), brought over as the
 * same reference a live call's picture is (`CallResultPicture`, `engine/calls`' `callPictures.ts`):
 * store's references: each picture's bytes kept once by their content, each call's picture one
 * occurrence keyed as V1's own capture keys it (thread, activity, bytes), so V1's backfill and the
 * import share it and a batch read again keeps the same one. The reference has the shape a live
 * tool result's picture has: `{mimeType, asset: ImageOccurrence, width?, height?}`.
 *
 * @module engine/history/pictures
 */
import * as NodePath from "node:path";

import * as Schema from "effect/Schema";
import {
  ImageOccurrence,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
} from "@t3tools/contracts";

import type { ContentAssets } from "../../assets/ContentAssets.ts";
import {
  isInlineImage,
  keepInlineImage,
  keepLookedPicture,
} from "../../assets/ConversationMedia.ts";
import { projectActivityPayload } from "../../orchestration/ActivityPayloadProjection.ts";
import type { V1Bodies } from "./v1.ts";

/** The largest picture the import keeps: the store's limit for a picture a person sends. */
export const HISTORY_PICTURE_BYTES = PROVIDER_SEND_TURN_MAX_IMAGE_BYTES;

const decodeOccurrence = Schema.decodeUnknownSync(ImageOccurrence);

/**
 * Left out: over the limit, no store to keep it in, or the store could not keep it. Its result
 * then says `imagesDropped`. A picture V1 already kept by reference stays as it is.
 */
const LEFT = Symbol("left out");

/**
 * The bodies with every inline picture kept in the store and referenced; a picture over `limit`,
 * or with no store, is left out and its result says so.
 */
export const keepPictures = async (
  store: ContentAssets | null,
  threadId: ThreadId,
  bodies: V1Bodies,
  limit: number = HISTORY_PICTURE_BYTES,
  /** Where the thread's relative paths resolve; an absolute path needs none. */
  workspaceRoot: string | null = null,
): Promise<V1Bodies> => {
  const keep = async (activityId: string, value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) {
      const kept = await Promise.all(value.map((entry) => keep(activityId, entry)));
      return kept.filter((entry) => entry !== LEFT);
    }
    if (typeof value !== "object" || value === null) return value;
    if (isInlineImage(value)) {
      if (store === null || Buffer.byteLength(value.data, "base64") > limit) return LEFT;
      const kept = await keepInlineImage(store, threadId, activityId, value).catch(() => null);
      // A picture the store could not keep is left out, as a live call's is.
      if (kept === null || kept.asset.original.status !== "ready") return LEFT;
      // As the store reads it back: the same reference whether it was kept now or before.
      return { ...kept, asset: decodeOccurrence(kept.asset) };
    }
    const out: Record<string, unknown> = {};
    let left = false;
    for (const [key, entry] of Object.entries(value)) {
      const kept = await keep(activityId, entry);
      if (Array.isArray(entry) && Array.isArray(kept) && kept.length < entry.length) left = true;
      out[key] = kept;
    }
    return left ? { ...out, imagesDropped: true } : out;
  };
  const activities = new Map(bodies.activities);
  for (const [id, activity] of bodies.activities) {
    const payload = await keep(id, activity.payload);
    activities.set(id, { ...activity, payload: await keepLooked(id, payload) });
  }
  return { messages: bodies.messages, activities };

  /**
   * The picture the call looked at, as V1 keeps it (`keepLookedPicture`): V1 kept it as a snapshot
   * of the thread was read, never in the payload, so the payload's path is all the import holds —
   * a /tmp file long gone by then (Rhea, 2026-10-10: six "Image unavailable" tiles).
   */
  async function keepLooked(activityId: string, payload: unknown): Promise<unknown> {
    const record = asRecord(payload);
    const data = asRecord(record?.data);
    if (store === null || record === null || data === null) return payload;
    const looked = asRecord(
      asRecord(projectActivityPayload({ payload } as never).payload)?.data,
    )?.imagePath;
    if (typeof looked !== "string" || looked.startsWith("mate-asset:")) return payload;
    if (workspaceRoot === null && !NodePath.isAbsolute(looked)) return payload;
    const kept = await keepLookedPicture(store, threadId, activityId, looked, workspaceRoot ?? "/");
    return { ...record, data: { ...data, ...kept } };
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
