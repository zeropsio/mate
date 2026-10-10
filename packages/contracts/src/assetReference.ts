import * as Schema from "effect/Schema";

import { PositiveInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AssetDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const ImageOccurrence = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  projectId: Schema.optionalKey(ProjectId),
  ownerId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  provenance: Schema.Literals(["capture", "upload", "legacy"]),
  original: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("ready"),
      digest: AssetDigest,
      mimeType: Schema.String.check(Schema.isPattern(/^image\//)),
      sizeBytes: PositiveInt,
      width: Schema.optionalKey(PositiveInt),
      height: Schema.optionalKey(PositiveInt),
    }),
    Schema.Struct({
      status: Schema.Literal("failed"),
      code: Schema.Literals([
        "source-missing",
        "source-changed",
        "storage-full",
        "unsupported",
        "persistence-failed",
      ]),
    }),
  ]),
});
export type ImageOccurrence = typeof ImageOccurrence.Type;

/**
 * A page an agent published, as the asset store keeps it: apart from its pictures, in an index of
 * its own, so a Mate that reads only pictures never meets one.
 */
export const PageOccurrence = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  projectId: Schema.optionalKey(ProjectId),
  ownerId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  provenance: Schema.Literal("capture"),
  original: Schema.Struct({
    status: Schema.Literal("ready"),
    digest: AssetDigest,
    mimeType: Schema.Literal("text/html"),
    sizeBytes: PositiveInt,
  }),
});
export type PageOccurrence = typeof PageOccurrence.Type;

export const AssetRepresentation = Schema.Struct({
  digest: AssetDigest,
  mimeType: Schema.String,
  sizeBytes: PositiveInt,
  width: Schema.optionalKey(PositiveInt),
  height: Schema.optionalKey(PositiveInt),
  relativeUrl: Schema.String,
});
export type AssetRepresentation = typeof AssetRepresentation.Type;
