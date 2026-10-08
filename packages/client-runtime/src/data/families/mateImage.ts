import { AssetResource, EnvironmentId, type ImageOccurrence } from "@t3tools/contracts";

import * as Schema from "effect/Schema";
import type { FamilySpec } from "./spec.ts";
import { scopeOf } from "./spec.ts";

export interface MateImageReference {
  readonly environmentId: EnvironmentId;
  readonly resource: AssetResource;
}
export interface MateImageKey extends MateImageReference {
  readonly rendition: "original" | { readonly width: number; readonly height: number };
}
export interface MateImageValue {
  readonly blob: Blob | null;
  readonly digest?: string;
  readonly reference?: string;
  readonly dimensions?: { readonly width: number; readonly height: number };
  readonly failure?: string;
  readonly occurrence?: ImageOccurrence;
}
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateImage: MateImageValue;
  }
}
export const mateImageFamily: FamilySpec<"mateImage"> = {
  family: "mateImage",
  authority: "mate",
  scope: { source: "mate", suffix: "image", leaving: "removed", demand: "detail" },
  indexes: [
    { name: "mateImageReference", keyOf: (value) => value.reference ?? null },
    { name: "mateImageDigest", keyOf: (value) => value.digest ?? null },
  ],
};
export const mateImageId = (key: MateImageKey) =>
  `${key.resource._tag === "project-favicon" || (key.resource._tag === "workspace-file" && !key.resource.path.startsWith("mate-asset:")) ? "image-current" : "image"}/${encodeURIComponent(JSON.stringify(key))}`;
export const mateImageScope = (key: MateImageKey) => scopeOf(mateImageFamily, mateImageId(key));
export const mateImageReferenceId = (reference: MateImageReference) =>
  JSON.stringify({ environmentId: reference.environmentId, resource: reference.resource });
export const mateImageSource = (reference: MateImageReference) =>
  `mate-image:${encodeURIComponent(JSON.stringify(reference))}`;

/** This is a conversation identity, never an HTTP byte URL or credential. */
const decodeReference = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: EnvironmentId, resource: AssetResource }),
);
export function parseMateImageSource(source: string | undefined): MateImageReference | null {
  if (!source?.startsWith("mate-image:")) return null;
  try {
    return decodeReference(JSON.parse(decodeURIComponent(source.slice("mate-image:".length))));
  } catch {
    return null;
  }
}

/** Contained pixels at the actual slot/DPR, clamped to the observed original. */
export function demandedImageSize(
  source: { readonly width: number; readonly height: number },
  slot: { readonly width: number; readonly height?: number },
  dpr: number,
) {
  const scale = Math.min(
    Math.min(
      slot.width / source.width,
      (slot.height ?? (source.height * slot.width) / source.width) / source.height,
      1,
    ) * dpr,
    1,
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}
