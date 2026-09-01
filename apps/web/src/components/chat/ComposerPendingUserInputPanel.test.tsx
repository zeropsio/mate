import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ComposerPendingUserInputPanel,
  pendingUserInputKeyAction,
} from "./ComposerPendingUserInputPanel";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import type { PendingUserInput } from "../../session-logic";

const prompt: PendingUserInput = {
  requestId: ApprovalRequestId.make("request-1"),
  createdAt: "2026-08-15T00:00:00.000Z",
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
};

function renderPanel() {
  return renderToStaticMarkup(
    <ComposerPendingUserInputPanel
      pendingUserInputs={[prompt]}
      respondingRequestIds={[]}
      answers={{}}
      questionIndex={0}
      onToggleOption={() => {}}
      onAdvance={() => {}}
    />,
  );
}

describe("ComposerPendingUserInputPanel", () => {
  it("renders visible waiting state and human kind for question and approval", () => {
    const questionMarkup = renderPanel();
    const approvalMarkup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-1"),
          requestKind: "command",
          createdAt: "2026-09-01T00:00:00.000Z",
          detail: "vp test run question.test.tsx",
        }}
        pendingCount={2}
      />,
    );

    for (const markup of [questionMarkup, approvalMarkup]) {
      expect(markup).toContain('data-zerops-primitive="status-dot"');
      expect(markup).toContain('data-zerops-status-tone="attention"');
      expect(markup).toContain("WAITING FOR YOU");
    }
    expect(questionMarkup).toContain('data-pending-request-kind="question"');
    expect(questionMarkup).toContain(">Question<");
    expect(approvalMarkup).toContain('data-pending-request-kind="command-approval"');
    expect(approvalMarkup).toContain(">Command approval<");
  });

  it("renders the header as a disclosure control for the question body", () => {
    const markup = renderPanel();

    const toggle = markup.match(/<button[^>]*data-pending-user-input-toggle="[^"]*"[^>]*>/)?.[0];
    expect(toggle).toBeDefined();
    expect(toggle).toContain('data-pending-user-input-toggle="expanded"');
    expect(toggle).toContain('aria-expanded="true"');
    expect(toggle).toContain('type="button"');

    const controlledId = toggle?.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controlledId).toBeDefined();
    expect(markup).toMatch(new RegExp(`<div[^>]*\\sid="${controlledId}"`));
  });

  it("starts expanded so the question and its options are visible", () => {
    const markup = renderPanel();

    expect(markup).toContain("Approach");
    expect(markup).toContain("Which approach should the migration take?");
    expect(markup).toContain("Incremental");
    expect(markup).toContain("Big bang");
  });
});

/**
 * The card-quality items the Zerops brief asks for (§8.1). They are provider-
 * agnostic on purpose: this card renders T3's normalised `user-input` events,
 * so every agent that can ask a question gets them, not just zcp.
 */
describe("ComposerPendingUserInputPanel — answering affordances", () => {
  const render = (
    answers: Record<string, { selectedOptionLabels: string[]; customAnswer: string }>,
  ) =>
    renderToStaticMarkup(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[prompt]}
        respondingRequestIds={[]}
        answers={answers}
        questionIndex={0}
        onToggleOption={() => {}}
        onAdvance={() => {}}
      />,
    );

  /** The agent is blocked until this is answered; the card says so, and so
   * does the lifecycle strip, using the same words. */
  it("says it is waiting for the user", () => {
    const html = render({});

    expect(html).toContain("data-pending-user-input-waiting");
    expect(html).toContain("WAITING FOR YOU");
  });

  /**
   * Free text always worked — typing in the composer answers the question and
   * overrides any selected option — but nothing on screen said so.
   */
  it("offers Other as a visible way to answer in the user's own words", () => {
    const html = render({});

    expect(html).toContain('data-pending-user-input-other="empty"');
    expect(html).toContain("Other");
    expect(html).toContain("Type your own answer in the composer below.");
  });

  it("reads the typed answer back once there is one", () => {
    const html = render({
      "question-1": { selectedOptionLabels: [], customAnswer: "Neither — start over" },
    });

    expect(html).toContain('data-pending-user-input-other="answered"');
    expect(html).toContain("Neither — start over");
  });

  /** A typed answer wins over a selected option, so the option must not also
   * read as chosen. */
  it("does not show an option as selected while a typed answer stands", () => {
    const html = render({
      "question-1": { selectedOptionLabels: ["Incremental"], customAnswer: "Neither" },
    });

    expect(html).toContain('data-pending-user-input-other="answered"');
    expect(html).not.toContain('aria-current="true"');
  });

  /** Nothing is highlighted until the user presses an arrow key: a default
   * highlight would read as a choice already made. */
  it("highlights nothing before the user moves the cursor", () => {
    expect(render({})).not.toContain('aria-current="true"');
  });

  it("keeps complete detail, progress, Other, multi-select and keyboard behavior", () => {
    const completeQuestion = `Choose every service that should deploy. ${"detail ".repeat(80)}`;
    const multiQuestionPrompt: PendingUserInput = {
      ...prompt,
      questions: [
        {
          id: "question-multi",
          header: "Services",
          question: completeQuestion,
          options: [
            { label: "API", description: "Deploy the API service" },
            { label: "Worker", description: "Deploy the worker service" },
          ],
          multiSelect: true,
        },
        {
          id: "question-follow-up",
          header: "Timing",
          question: "When should the deploy begin?",
          options: [{ label: "Now", description: "Deploy immediately" }],
          multiSelect: false,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[multiQuestionPrompt]}
        respondingRequestIds={[]}
        answers={{
          "question-multi": { selectedOptionLabels: ["API"], customAnswer: "" },
        }}
        questionIndex={0}
        onToggleOption={() => {}}
        onAdvance={() => {}}
      />,
    );

    expect(markup).toContain(completeQuestion);
    expect(markup).toContain('data-pending-request-progress="1/2"');
    expect(markup).toContain("Select one or more options.");
    expect(markup).toContain('data-pending-user-input-other="empty"');
    expect(markup).toContain("Other");
    expect(markup).toContain('data-pending-user-input-toggle="expanded"');
    expect(pendingUserInputKeyAction("1", 2, -1)).toEqual({ type: "select", index: 0 });
    expect(pendingUserInputKeyAction("ArrowDown", 2, -1)).toEqual({ type: "move", index: 0 });
    expect(pendingUserInputKeyAction("ArrowUp", 2, 0)).toEqual({ type: "move", index: 1 });
    expect(pendingUserInputKeyAction("Enter", 2, 1)).toEqual({ type: "select", index: 1 });
  });
});

describe("pendingUserInputKeyAction", () => {
  it("selects an option by its digit", () => {
    expect(pendingUserInputKeyAction("1", 3, -1)).toEqual({ type: "select", index: 0 });
    expect(pendingUserInputKeyAction("3", 3, -1)).toEqual({ type: "select", index: 2 });
  });

  it("ignores a digit past the end of the list", () => {
    expect(pendingUserInputKeyAction("4", 3, -1)).toBeUndefined();
    expect(pendingUserInputKeyAction("0", 3, -1)).toBeUndefined();
  });

  it("moves the cursor to the first option from nothing", () => {
    expect(pendingUserInputKeyAction("ArrowDown", 3, -1)).toEqual({ type: "move", index: 0 });
    expect(pendingUserInputKeyAction("ArrowUp", 3, -1)).toEqual({ type: "move", index: 0 });
  });

  it("wraps the cursor at both ends", () => {
    expect(pendingUserInputKeyAction("ArrowDown", 3, 2)).toEqual({ type: "move", index: 0 });
    expect(pendingUserInputKeyAction("ArrowUp", 3, 0)).toEqual({ type: "move", index: 2 });
  });

  /**
   * Enter is the composer's key — it is how a free-text answer is sent. The
   * card claims it only once the user has moved the cursor onto an option.
   */
  it("takes Enter only when an option is highlighted", () => {
    expect(pendingUserInputKeyAction("Enter", 3, -1)).toBeUndefined();
    expect(pendingUserInputKeyAction("Enter", 3, 1)).toEqual({ type: "select", index: 1 });
  });

  it("claims nothing when the question has no options", () => {
    expect(pendingUserInputKeyAction("ArrowDown", 0, -1)).toBeUndefined();
    expect(pendingUserInputKeyAction("1", 0, -1)).toBeUndefined();
    expect(pendingUserInputKeyAction("Enter", 0, 0)).toBeUndefined();
  });

  it("ignores every other key", () => {
    expect(pendingUserInputKeyAction("a", 3, 0)).toBeUndefined();
    expect(pendingUserInputKeyAction("Escape", 3, 0)).toBeUndefined();
    expect(pendingUserInputKeyAction(" ", 3, 0)).toBeUndefined();
  });
});
