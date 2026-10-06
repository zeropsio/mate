/**
 * Saying something on a change, at HQ (SPEC §3.2a: HQ keeps a change's comments, and
 * `comment_change` decides who may write one). HQ's answer is the comment, whose id is the
 * operation's handle; HQ's conversation holding that id ends it — the person's words are then on
 * the change for everyone on it. The conversation is held until then, so the end is read even
 * when HQ's answer came before its scope moved. No clock decides the end.
 *
 * @module data/operations/changeComment
 */
import type { ChangeLink } from "@t3tools/shared/hqChanges";

import { discussionDemand, discussionId } from "../families/hqDiscussion.ts";
import type { OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "change-comment": {
      /** The organization whose HQ keeps the change. */
      readonly orgId: string;
      readonly link: ChangeLink;
      readonly body: string;
      /** The person saying it: after a lost answer, only their own words can be this comment. */
      readonly authorUserId: string | null;
    };
  }
}

const commentOf = (receipt: OperationReceipt) => receipt.handles[0] ?? "";

const commentsOn = (read: ProjectionReads, link: ChangeLink) => {
  const fact = read.fact("hqDiscussion", discussionId(link));
  return fact.kind === "known" ? fact.value.comments : [];
};

const holds = (read: ProjectionReads, link: ChangeLink, receipt: OperationReceipt) =>
  commentsOn(read, link).some((said) => said.id === commentOf(receipt));

export const changeComment: OperationKind<"change-comment"> = {
  kind: "change-comment",
  executor: "hq",
  reflected: (read, intent, receipt) => holds(read, intent.link, receipt),
  settledBy: (read, intent, receipt) =>
    holds(read, intent.link, receipt) ? { kind: "succeeded" } : null,
  observedIn: (intent) => discussionDemand(intent.link),
  // After a lost answer: the person's own comment in these very words; without the person's id,
  // none can be told from anybody else's.
  effectHandles: (read, intent) =>
    intent.authorUserId === null
      ? []
      : commentsOn(read, intent.link)
          .filter((said) => said.authorUserId === intent.authorUserId && said.body === intent.body)
          .map((said) => said.id),
};
