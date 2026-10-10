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
      // A picture, or the one other kind the store keeps: a page an agent published (`text/html`).
      mimeType: Schema.String.check(Schema.isPattern(/^(?:image\/|text\/html$)/)),
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

export const AssetRepresentation = Schema.Struct({
  digest: AssetDigest,
  mimeType: Schema.String,
  sizeBytes: PositiveInt,
  width: Schema.optionalKey(PositiveInt),
  height: Schema.optionalKey(PositiveInt),
  relativeUrl: Schema.String,
});
export type AssetRepresentation = typeof AssetRepresentation.Type;
