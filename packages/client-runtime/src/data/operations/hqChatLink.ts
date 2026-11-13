/**
 * A person takes a chat account link HQ said to their Slack or Discord account (`POST
 * /api/chat-links`). The link's code is a one-time credential: it goes to the executor beside the
 * intent (`HqExecutor.submitChatLink`), never into the recorded intent. HQ answers at once and keeps
 * no request id for it, so a lost answer stays uncertain: the code is spent or not, and only the
 * chat says which (an unlinked account is answered with a new link).
 *
 * @module data/operations/hqChatLink
 */
import type { HqChatLink } from "@t3tools/shared/hqChatLinks";
import type { OperationReceipt } from "../model.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "take-chat-link": { readonly orgId: string };
  }
  interface OperationResults {
    readonly "take-chat-link": HqChatLink;
  }
}

export const takeChatLink: OperationKind<"take-chat-link"> = {
  kind: "take-chat-link",
  executor: "hq",
  // HQ's answer is the write's end: nothing the account reads shows a link.
  reflected: (_read, _intent, receipt: OperationReceipt) => receipt.outcome.kind === "succeeded",
};
