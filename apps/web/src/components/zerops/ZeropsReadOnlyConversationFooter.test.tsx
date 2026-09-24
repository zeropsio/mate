import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { PendingApproval, PendingUserInput } from "../../session-logic";
import { ZeropsReadOnlyConversationFooter } from "./ZeropsReadOnlyConversationFooter";

const readOnly = {
  notice: "Signed in by another project member — only they can run this agent.",
  waitingLabel: "WAITING FOR THE OWNER",
};

const approval: PendingApproval = {
  requestId: ApprovalRequestId.make("approval-1"),
  requestKind: "command",
  createdAt: "2026-09-24T00:00:00.000Z",
  detail: "rm -rf dist",
};

const question: PendingUserInput = {
  requestId: ApprovalRequestId.make("request-1"),
  createdAt: "2026-09-24T00:00:00.000Z",
  questions: [
    {
      id: "question-1",
      header: "Approach",
      question: "Which approach should the migration take?",
      options: [
        { label: "Incremental", description: "Move one module at a time" },
        { label: "Big bang", description: "Move everything in one release" },
      ],
      multiSelect: false,
    },
  ],
  dismissible: true,
};

function render(input: {
  readonly pendingApprovals?: ReadonlyArray<PendingApproval>;
  readonly pendingUserInputs?: ReadonlyArray<PendingUserInput>;
}) {
  return renderToStaticMarkup(
    <ZeropsReadOnlyConversationFooter
      readOnly={readOnly}
      pendingApprovals={input.pendingApprovals ?? []}
      pendingUserInputs={[...(input.pendingUserInputs ?? [])]}
      onSignIn={() => {}}
    />,
  );
}

function buttons(html: string): string[] {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

describe("ZeropsReadOnlyConversationFooter", () => {
  it.each([
    ["nothing pending", {}, 1],
    ["a pending approval", { pendingApprovals: [approval] }, 1],
    // The question keeps its disclosure toggle: reading is not answering.
    ["a pending question", { pendingUserInputs: [question] }, 2],
  ] as const)("with %s offers no way to act on the agent", (_label, input, buttonCount) => {
    const html = render(input);

    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("WAITING FOR YOU");
    expect(buttons(html)).toHaveLength(buttonCount);
    expect(buttons(html).at(-1)).toContain("Sign in with your own account");
    expect(html).toContain(readOnly.notice);
  });

  it("shows a pending approval and whom it waits on, without its decisions", () => {
    const html = render({ pendingApprovals: [approval] });

    expect(html).toContain("rm -rf dist");
    expect(html).toContain("WAITING FOR THE OWNER");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Decline");
  });

  it("shows a pending question and its options, read-only", () => {
    const html = render({ pendingUserInputs: [question] });

    expect(html).toContain("Which approach should the migration take?");
    expect(html).toContain("Incremental");
    expect(html).toContain("WAITING FOR THE OWNER");
    expect(html).not.toContain("data-pending-user-input-other");
  });
});
