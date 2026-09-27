/**
 * What a Mate's peek says, from what the client holds: the thread's shell
 * (always there, so the peek paints at once) and, once read, the thread's own
 * activities — the plan's steps, and the question or approval it waits on.
 *
 * Nothing here decides whether the Mate needs anybody: that is the one
 * resolver's (`resolveThreadStatus`, R5). This only reads what the thing it
 * waits on says, so the peek can answer it in place.
 */
import type { PendingApproval, PendingUserInput } from "@t3tools/client-runtime/pending-requests";
import type { ProviderApprovalDecision, ProviderRequestKind } from "@t3tools/contracts";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

export type MatePeekStepState = "done" | "running" | "waiting";

/** One step of the plan: its words once the plan is read, until then only the running one's. */
export interface MatePeekStep {
  readonly text: string | undefined;
  readonly state: MatePeekStepState;
}

/**
 * The plan's steps as the peek lists them. The thread's own plan once it is
 * read; until then the shell's count, which knows every step's place and only
 * the running one's words — so the list keeps its height when the rest arrive.
 */
export function matePeekSteps(input: {
  readonly plan:
    | {
        readonly steps: ReadonlyArray<{
          readonly step: string;
          readonly status: "pending" | "inProgress" | "completed";
        }>;
      }
    | null
    | undefined;
  readonly progress:
    | { readonly step: string; readonly completedSteps: number; readonly totalSteps: number }
    | null
    | undefined;
}): ReadonlyArray<MatePeekStep> | undefined {
  if (input.plan !== null && input.plan !== undefined && input.plan.steps.length > 0) {
    return input.plan.steps.map((step) => ({
      text: step.step,
      state:
        step.status === "completed" ? "done" : step.status === "inProgress" ? "running" : "waiting",
    }));
  }
  const progress = input.progress;
  if (progress === null || progress === undefined || progress.totalSteps <= 0) return undefined;
  return Array.from({ length: progress.totalSteps }, (_, index) => {
    const state: MatePeekStepState =
      index < progress.completedSteps
        ? "done"
        : index === progress.completedSteps
          ? "running"
          : "waiting";
    return { text: state === "running" ? progress.step : undefined, state };
  });
}

/** An option the peek offers, and what choosing it sends. */
export interface MatePeekChoice {
  readonly label: string;
  /** The answer's value (a question's), or the decision (an approval's). */
  readonly value: string;
  readonly primary: boolean;
}

export type MatePeekDecision =
  /** One question with its options: answered here, by a button, a number key, or in words. */
  | {
      readonly kind: "question";
      readonly requestId: string;
      readonly questionId: string;
      readonly question: string;
      readonly choices: ReadonlyArray<MatePeekChoice>;
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
      readonly choices: ReadonlyArray<MatePeekChoice>;
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

const DEFAULT_APPROVAL_CHOICES: ReadonlyArray<MatePeekChoice> = [
  { label: "Approve", value: "accept", primary: true },
  { label: "Deny", value: "decline", primary: false },
];

function approvalChoices(approval: PendingApproval): ReadonlyArray<MatePeekChoice> {
  const offered = approval.options ?? [];
  if (offered.length === 0) return DEFAULT_APPROVAL_CHOICES;
  return offered.map((option, index) => ({
    label: option.label,
    value: option.decision satisfies ProviderApprovalDecision,
    primary: index === 0 && option.decision !== "decline" && option.decision !== "cancel",
  }));
}

/**
 * What the Mate waits on, for the peek to answer: the resolver's kind says
 * whether it waits and on what sort of thing; the thread's own requests, once
 * read, say what exactly.
 */
export function matePeekDecision(input: {
  readonly name: string;
  readonly kind: ThreadStatusKind;
  /** The thread's detail is read; until then, requests unknown are not "none". */
  readonly read: boolean;
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly userInputs: ReadonlyArray<PendingUserInput>;
  /** The session's or the turn's own words for a failure. */
  readonly failure: string | undefined;
}): MatePeekDecision | undefined {
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
      return { kind: "failure", message: input.failure };
    default:
      return undefined;
  }
}

/** "You asked", or whose ask it was: the owner is who starts a Mate's work (D6). */
export function askedLabelFor(
  owner: { readonly name: string; readonly isViewer: boolean } | undefined,
): string {
  if (owner === undefined) return "Asked";
  if (owner.isViewer) return "You asked";
  const first = owner.name.trim().split(/\s+/u)[0];
  return first === undefined || first.length === 0 ? "Asked" : `${first} asked`;
}

/** What a key does while a peek stands. */
export type MatePeekKeyAction =
  | { readonly kind: "close" }
  | { readonly kind: "choose"; readonly index: number }
  | { readonly kind: "stop" };

/**
 * A key pressed while a peek stands: a number picks that choice, x stops the
 * run, Escape puts the peek away. Nothing while somebody types into a field
 * or holds a modifier — those keys are theirs, not the peek's.
 */
export function matePeekKey(input: {
  readonly key: string;
  readonly modified: boolean;
  readonly typing: boolean;
  /** How many choices the peek offers here and now: none while it may not answer. */
  readonly choices: number;
  readonly canStop: boolean;
}): MatePeekKeyAction | undefined {
  if (input.key === "Escape") return { kind: "close" };
  if (input.modified || input.typing) return undefined;
  if (/^[1-9]$/u.test(input.key)) {
    const index = Number(input.key) - 1;
    return index < input.choices ? { kind: "choose", index } : undefined;
  }
  if ((input.key === "x" || input.key === "X") && input.canStop) return { kind: "stop" };
  return undefined;
}
