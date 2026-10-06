/**
 * What has been said on one change, as its review shows it: the comments HQ keeps for it, once
 * read; that it is still being read; or why it could not be — there is no last-good conversation
 * to fall back on before the first read. What was read stays through an outage and across reopening
 * the review: HQ never says a conversation is gone.
 *
 * @module data/projections/changeDiscussion
 */
import type { ChangeLink, HqChangeComment } from "@t3tools/shared/hqChanges";

import { discussionId, hqDiscussionScope } from "../families/hqDiscussion.ts";
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

export type ChangeDiscussionRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly comments: ReadonlyArray<HqChangeComment> }
  | { readonly kind: "failed"; readonly reason: string };

/** Phases in which a stream says why it does not read, rather than that it is reading. */
const FAILING: ReadonlySet<string> = new Set(["recovering", "refused", "unsupported"]);

/** Why the conversation's scope, or HQ's link it hangs on, does not read now; `null` while it does. */
function failure(read: ProjectionReads, orgId: string, link: ChangeLink): string | null {
  for (const key of [hqDiscussionScope(orgId, link), linkKeys.hq(orgId)]) {
    const stream = read.stream(key);
    if (FAILING.has(stream.phase) && stream.fault !== null) return stream.fault.message;
  }
  return null;
}

export const changeDiscussion: Projection<
  { readonly orgId: string; readonly link: ChangeLink },
  ChangeDiscussionRead
> = {
  name: "changeDiscussion",
  keyOf: ({ orgId, link }) => `${orgId}:${discussionId(link)}`,
  equals: sameValue,
  derive: (read, { orgId, link }) => {
    const fact = read.fact("hqDiscussion", discussionId(link));
    if (fact.kind === "known") return { kind: "read", comments: fact.value.comments };
    const reason = failure(read, orgId, link);
    return reason === null ? { kind: "reading" } : { kind: "failed", reason };
  },
};
