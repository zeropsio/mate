/**
 * What has been said on one change, as HQ keeps it (SPEC §3.2a): the `discussion` scope HQ keeps
 * per change, demanded only while a review of it is drawn. Its one record, `<repo>:<number>`,
 * holds the change's comments, oldest first. HQ never says a conversation is gone: one read once
 * keeps what was last said.
 *
 * @module data/families/hqDiscussion
 */
import { CommentListResponse, type ChangeLink } from "@t3tools/shared/hqChanges";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { DetailDemand } from "../demand.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type HqDiscussionValue = CommentListResponse;

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqDiscussion: HqDiscussionValue;
  }
}

const decodeDiscussion = Schema.decodeUnknownOption(CommentListResponse);
const decodeOwner = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.Int])),
);

/** The id a change's conversation is held under: its application, repository and number. */
export const discussionId = (link: ChangeLink): string =>
  JSON.stringify([link.appId, link.repo, link.number]);

/** The change a conversation's id names; `null` for one that names none. */
export function discussionLink(id: string): ChangeLink | null {
  const owner = Option.getOrNull(decodeOwner(id));
  return owner === null ? null : { appId: owner[0], repo: owner[1], number: owner[2] };
}

const recordKey = (link: ChangeLink) => `${link.repo}:${String(link.number)}`;

export const hqDiscussionFamily: FamilySpec<"hqDiscussion"> = {
  family: "hqDiscussion",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-discussions", leaving: "removed", demand: "detail" },
  hq: {
    scope: "discussion",
    idOf: (key, owner) => {
      const link = owner.ownerId === null ? null : discussionLink(owner.ownerId);
      return link !== null && key === recordKey(link) ? owner.ownerId : null;
    },
    keyOf: (id) => {
      const link = discussionLink(id);
      return link === null ? id : recordKey(link);
    },
    decode: (raw) => Option.getOrNull(decodeDiscussion(raw)),
    wireScope: (ownerId) => {
      const link = discussionLink(ownerId);
      if (link === null) throw new Error(`No change is named by ${ownerId}.`);
      return { kind: "discussion", ...link };
    },
  },
};

/** The demand that holds one change's conversation while it is drawn. */
export const discussionDemand = (link: ChangeLink): DetailDemand => ({
  family: hqDiscussionFamily.family,
  ownerId: discussionId(link),
});

/** One change's conversation scope under the organization's HQ link. */
export const hqDiscussionScope = (orgId: string, link: ChangeLink): ScopeKey =>
  scopeOf(hqDiscussionFamily, orgId, discussionId(link));
