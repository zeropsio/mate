import {
  mateImageId,
  mateImageScope,
  mateImageReferenceId,
  type MateImageReference,
  type MateImageKey,
  type MateImageValue,
} from "../families/mateImage.ts";
import type { Projection } from "../store.ts";

export type MateImageRead =
  | { readonly kind: "unknown" }
  | { readonly kind: "reading" }
  | {
      readonly kind: "ready";
      readonly blob: Blob;
      readonly dimensions?: MateImageValue["dimensions"];
      readonly occurrence?: MateImageValue["occurrence"];
    }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly originalAvailable: boolean;
      readonly retryable: boolean;
    };
export const mateImage: Projection<MateImageKey, MateImageRead> = {
  name: "mateImage",
  keyOf: mateImageId,
  derive: (read, key) => {
    const fact = read.fact("mateImage", mateImageId(key));
    const stream = read.stream(mateImageScope(key));
    if (
      stream.fault?.outcome === "access-unverified" ||
      stream.fault?.outcome === "authoritative-denial"
    )
      return {
        kind: "failed",
        reason: stream.fault.message,
        originalAvailable: false,
        retryable: false,
      };
    if (fact.kind === "withheld")
      return {
        kind: "failed",
        reason: stream.fault?.message ?? "Access could not be verified.",
        originalAvailable: false,
        retryable: false,
      };
    if (fact.kind === "known")
      return fact.value.blob !== null
        ? {
            kind: "ready",
            blob: fact.value.blob,
            ...(fact.value.dimensions ? { dimensions: fact.value.dimensions } : {}),
            ...(fact.value.occurrence === undefined ? {} : { occurrence: fact.value.occurrence }),
          }
        : {
            kind: "failed",
            reason: fact.value.failure ?? "Preview unavailable",
            originalAvailable: fact.value.occurrence?.original.status === "ready",
            retryable: false,
          };
    if (stream.fault)
      return {
        kind: "failed",
        reason: stream.fault.message,
        originalAvailable: false,
        retryable: stream.fault.outcome === "transient",
      };
    if (["connecting", "baselining", "recovering", "reauthenticating"].includes(stream.phase))
      return { kind: "reading" };
    return { kind: "unknown" };
  },
  equals: (a, b) =>
    a.kind === b.kind &&
    (a.kind === "ready" && b.kind === "ready"
      ? a.blob === b.blob &&
        a.dimensions?.width === b.dimensions?.width &&
        a.dimensions?.height === b.dimensions?.height
      : a.kind === "failed" && b.kind === "failed"
        ? a.reason === b.reason &&
          a.originalAvailable === b.originalAvailable &&
          a.retryable === b.retryable
        : true),
};

/** A retained, authorized preview remains visible while the selected original loads. */
export const mateImagePreview: Projection<MateImageReference, MateImageRead> = {
  name: "mateImagePreview",
  keyOf: mateImageReferenceId,
  derive: (read, reference) => {
    for (const id of read.index("mateImageReference", mateImageReferenceId(reference))) {
      const fact = read.fact("mateImage", id);
      if (
        fact.kind === "known" &&
        read.stream(fact.scope).fault?.outcome !== "access-unverified" &&
        read.stream(fact.scope).fault?.outcome !== "authoritative-denial" &&
        fact.value.blob !== null &&
        !decodeURIComponent(id).includes('"rendition":"original"')
      )
        return {
          kind: "ready",
          blob: fact.value.blob,
          ...(fact.value.dimensions ? { dimensions: fact.value.dimensions } : {}),
        };
    }
    return { kind: "unknown" };
  },
  equals: mateImage.equals,
};

/** Dimensions already observed by the representation adapter; this read creates no byte demand. */
export const mateImageDimensions: Projection<
  ReadonlyArray<MateImageReference>,
  ReadonlyMap<string, { readonly width: number; readonly height: number }>
> = {
  name: "mateImageDimensions",
  keyOf: (references) => JSON.stringify(references),
  derive: (read, references) => {
    const result = new Map<string, { readonly width: number; readonly height: number }>();
    for (const reference of references) {
      if (reference.resource._tag !== "attachment") continue;
      for (const id of read.index("mateImageReference", mateImageReferenceId(reference))) {
        const fact = read.fact("mateImage", id);
        if (
          fact.kind !== "known" ||
          ["access-unverified", "authoritative-denial"].includes(
            read.stream(fact.scope).fault?.outcome ?? "",
          )
        )
          continue;
        const original = fact.value.occurrence?.original;
        const dimensions =
          fact.value.dimensions ??
          (original?.status === "ready" && original.width && original.height
            ? { width: original.width, height: original.height }
            : null);
        if (dimensions) {
          result.set(reference.resource.attachmentId, dimensions);
          break;
        }
      }
    }
    return result;
  },
  equals: (a, b) =>
    a.size === b.size &&
    [...a].every(
      ([id, size]) => b.get(id)?.width === size.width && b.get(id)?.height === size.height,
    ),
};
