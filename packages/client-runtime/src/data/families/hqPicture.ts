/** Immutable change attachments, read only while their description is drawn. */
import { attachmentPath, type AttachmentLink } from "@t3tools/shared/hqChanges";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { FamilySpec } from "./spec.ts";
import { scopeOf } from "./spec.ts";

export interface HqPictureKey {
  readonly orgId: string;
  readonly link: AttachmentLink;
}

export const pictureOwner = (link: AttachmentLink): string =>
  JSON.stringify([link.appId, link.repo, link.number, link.id]);
export const pictureId = ({ orgId, link }: HqPictureKey): string =>
  JSON.stringify([orgId, link.appId, link.repo, link.number, link.id]);

const decodeOwner = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Tuple([
      Schema.String,
      Schema.String,
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.String,
    ]),
  ),
);

export function pictureLink(owner: string): AttachmentLink | null {
  const value = Option.getOrNull(decodeOwner(owner));
  return value === null
    ? null
    : { appId: value[0], repo: value[1], number: value[2], id: value[3] };
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqPicture: Blob;
  }
}

export const hqPictureFamily: FamilySpec<"hqPicture"> = {
  family: "hqPicture",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-picture", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => {
      const link = pictureLink(ownerId);
      if (link === null) throw new Error("Invalid change attachment identity.");
      return attachmentPath(link.appId, link.repo, link.number, link.id);
    },
    decode: (raw) => (raw instanceof Blob ? raw : null),
    freshMs: null,
  },
};

export const pictureScope = ({ orgId, link }: HqPictureKey) =>
  scopeOf(hqPictureFamily, orgId, pictureOwner(link));
