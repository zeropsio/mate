/**
 * What has been said on one change, as its review shows it: the comments HQ keeps for it, once
 * read; that it is still being read; or why it could not be — there is no last-good conversation
 * to fall back on before the first read. What was read stays through an outage and across reopening
 * the review: HQ never says a conversation is gone.
 *
 * @module data/projections/changeDiscussion
 */
import type { ChangeLink, HqChangeComment } from "@t3tools/shared/hqChanges";

import { hqRefusalWords, ZEROPS_UNANSWERED } from "../../zerops/hq/refusals.ts";
import { discussionId, hqDiscussionScope } from "../families/hqDiscussion.ts";
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";

export type ChangeDiscussionRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly comments: ReadonlyArray<HqChangeComment> }
  | { readonly kind: "failed"; readonly reason: string };

/** Phases in which a stream says why it does not read, rather than that it is reading. */
const FAILING: ReadonlySet<string> = new Set(["recovering", "refused", "unsupported"]);

const NOT_ANSWERING = "HQ is not answering right now.";

/**
 * A scope's failure in the words HQ's own answers say it with (`hqRefusalWords`). HQ's scope error
 * carries its code and, where it named one, its reason — which the fault's message then is. A
 * refusal without one is the HQ client's, already in words; anything else the link or its
 * supervisor said (a deadline, a socket ending) is HQ not answering.
 */
function words(fault: StreamFault): string {
  const { code } = fault;
  if (fault.outcome !== "definitive-refusal")
    return code === "zerops_unanswered" ? ZEROPS_UNANSWERED : NOT_ANSWERING;
  if (code === undefined) return fault.message;
  const named = fault.message !== `HQ could not read this (${code}).`;
  return hqRefusalWords({ code, reason: named ? fault.message : undefined });
}

/** Why the conversation's scope, or HQ's link it hangs on, does not read now; `null` while it does. */
function failure(read: ProjectionReads, orgId: string, link: ChangeLink): string | null {
  for (const key of [hqDiscussionScope(orgId, link), linkKeys.hq(orgId)]) {
    const stream = read.stream(key);
    if (FAILING.has(stream.phase) && stream.fault !== null) return words(stream.fault);
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

export type DiscussionGate =
  | { readonly kind: "reading" }
  | { readonly kind: "read" }
  | { readonly kind: "failed"; readonly reason: string };

/** Phases in which HQ's link observes nothing until something outside it changes. */
const LET_GO: ReadonlySet<string> = new Set(["idle", "paused", "closed"]);

/**
 * Whether a comment may be sent now: once the conversation is read, so what it already holds is
 * known. Not while it is still read; and never while HQ's link is let go — no HQ named, another
 * organization shown — when no read will come.
 */
export const discussionGate: Projection<
  { readonly orgId: string; readonly link: ChangeLink },
  DiscussionGate
> = {
  name: "discussionGate",
  keyOf: ({ orgId, link }) => `${orgId}:${discussionId(link)}`,
  equals: sameValue,
  derive: (read, key) => {
    const discussion = changeDiscussion.derive(read, key);
    if (discussion.kind !== "reading")
      return discussion.kind === "read" ? { kind: "read" } : discussion;
    return LET_GO.has(read.stream(linkKeys.hq(key.orgId)).phase)
      ? { kind: "failed", reason: NOT_ANSWERING }
      : discussion;
  },
};
