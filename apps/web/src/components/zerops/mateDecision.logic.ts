/**
 * What a Mate waits on the person for, read from what the client holds: the
 * resolver's kind says whether it waits and on what sort of thing; the
 * thread's own requests, once read, say what exactly — so a surface outside
 * the conversation (the jump box) can say what writing to it will do, and
 * answer a question in place.
 *
 * Nothing here decides whether the Mate needs anybody: that is the one
 * resolver's (`resolveThreadStatus`, R5). This only reads what the thing it
 * waits on says.
 */
import type { PendingApproval, PendingUserInput } from "@t3tools/client-runtime/pending-requests";
import { mateFailureWords } from "../../zerops/noticeWords";
import type { ProviderApprovalDecision, ProviderRequestKind } from "@t3tools/contracts";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

/** An option a Mate offers, and what choosing it sends. */
export interface MateChoice {
  readonly label: string;
  /** The answer's value (a question's), or the decision (an approval's). */
  readonly value: string;
  readonly primary: boolean;
}

export type MateDecision =
  /** One question with its options: answered in place, by a button, a number key, or in words. */
  | {
      readonly kind: "question";
      readonly requestId: string;
      readonly questionId: string;
      readonly question: string;
      readonly choices: ReadonlyArray<MateChoice>;
      readonly allowText: boolean;
    }
  /** Several questions, or one taking several answers: the conversation's form answers those. */
  | { readonly kind: "questions"; readonly question: string; readonly count: number }
  | {
      readonly kind: "approval";
      readonly requestId: string;
      readonly title: string;
      /** What it wants to do, word for word — a command is shown in mono. */
      readonly detail: string | undefined;
      readonly choices: ReadonlyArray<MateChoice>;
    }
  /** A plan it proposed and waits to hear about — reviewed in the conversation. */
  | { readonly kind: "plan" }
  | { readonly kind: "failure"; readonly message: string | undefined }
  /** It waits on somebody, and what on is not read yet. */
  | { readonly kind: "reading" };

const REQUEST_TITLE: Record<ProviderRequestKind, string> = {
  command: "wants to run",
  "file-read": "wants to read",
  "file-change": "wants to change files",
  "mcp-elicitation": "asks through a tool",
  permission: "asks for a permission",
};

const DEFAULT_APPROVAL_CHOICES: ReadonlyArray<MateChoice> = [
  { label: "Approve", value: "accept", primary: true },
  { label: "Deny", value: "decline", primary: false },
];

function approvalChoices(approval: PendingApproval): ReadonlyArray<MateChoice> {
  const offered = approval.options ?? [];
  if (offered.length === 0) return DEFAULT_APPROVAL_CHOICES;
  return offered.map((option, index) => ({
    label: option.label,
    value: option.decision satisfies ProviderApprovalDecision,
    primary: index === 0 && option.decision !== "decline" && option.decision !== "cancel",
  }));
}

/** What the Mate waits on, for a surface to say and answer. */
export function mateDecision(input: {
  readonly name: string;
  readonly kind: ThreadStatusKind;
  /** The thread's detail is read; until then, requests unknown are not "none". */
  readonly read: boolean;
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly userInputs: ReadonlyArray<PendingUserInput>;
  /** The session's or the turn's own words for a failure. */
  readonly failure: string | undefined;
  /** The agent driver that said them (the session's `providerName`), where known. */
  readonly failureDriver?: string | null | undefined;
}): MateDecision | undefined {
  switch (input.kind) {
    case "approval": {
      const approval = input.approvals[0];
      if (approval === undefined) return input.read ? undefined : { kind: "reading" };
      return {
        kind: "approval",
        requestId: approval.requestId,
        title: `${input.name} ${REQUEST_TITLE[approval.requestKind]}`,
        detail: approval.detail,
        choices: approvalChoices(approval),
      };
    }
    case "input": {
      const request = input.userInputs[0];
      if (request === undefined) return input.read ? undefined : { kind: "reading" };
      const [only] = request.questions;
      if (only === undefined) return undefined;
      if (request.questions.length > 1 || only.multiSelect) {
        return { kind: "questions", question: only.question, count: request.questions.length };
      }
      return {
        kind: "question",
        requestId: request.requestId,
        questionId: only.id,
        question: only.question,
        choices: only.options.map((option) => ({
          label: option.label,
          value: option.value ?? option.label,
          primary: false,
        })),
        allowText: only.allowCustomAnswer !== false,
      };
    }
    case "planReady":
      return { kind: "plan" };
    case "failed":
      return {
        kind: "failure",
        message:
          input.failure === undefined
            ? undefined
            : mateFailureWords(input.failure, input.failureDriver),
      };
    default:
      return undefined;
  }
}
