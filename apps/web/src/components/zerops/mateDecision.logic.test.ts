import type { PendingApproval, PendingUserInput } from "@t3tools/client-runtime/pending-requests";
import { ApprovalRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mateDecision } from "./mateDecision.logic";

const request = (id: string) => ApprovalRequestId.make(id);
const APPROVAL: PendingApproval = {
  requestId: request("req-1"),
  requestKind: "command",
  createdAt: "2026-09-27T10:00:00.000Z",
  detail: "psql \"$DATABASE_URL\" -c 'DROP TABLE scores_legacy;'",
};
const QUESTION = (
  overrides: Partial<PendingUserInput["questions"][number]> = {},
): PendingUserInput => ({
  requestId: request("req-2"),
  createdAt: "2026-09-27T10:00:00.000Z",
  dismissible: false,
  questions: [
    {
      id: "discount",
      header: "Discount",
      question: "Should the 10% come off the shipping too?",
      options: [
        { label: "Only the items", description: "" },
        { label: "Items and shipping", description: "", value: "all" },
      ],
      multiSelect: false,
      ...overrides,
    },
  ],
});
const base = {
  name: "Kai",
  read: true,
  approvals: [] as ReadonlyArray<PendingApproval>,
  userInputs: [] as ReadonlyArray<PendingUserInput>,
  failure: undefined,
};

describe("mateDecision — what a Mate waits on, as a surface answers it", () => {
  it("offers one question's options and words of its own, sending each option's value", () => {
    expect(mateDecision({ ...base, kind: "input", userInputs: [QUESTION()] })).toEqual({
      kind: "question",
      requestId: "req-2",
      questionId: "discount",
      question: "Should the 10% come off the shipping too?",
      choices: [
        { label: "Only the items", value: "Only the items", primary: false },
        { label: "Items and shipping", value: "all", primary: false },
      ],
      allowText: true,
    });
  });

  it("offers no words of its own where the question takes none", () => {
    const decision = mateDecision({
      ...base,
      kind: "input",
      userInputs: [QUESTION({ allowCustomAnswer: false })],
    });
    expect(decision?.kind === "question" && decision.allowText).toBe(false);
  });

  it.each([{ case: "several answers to one question", overrides: { multiSelect: true } }])(
    "leaves $case to the conversation's form",
    ({ overrides }) => {
      expect(
        mateDecision({ ...base, kind: "input", userInputs: [QUESTION(overrides)] })?.kind,
      ).toBe("questions");
    },
  );

  it("leaves several questions to the conversation's form, saying how many", () => {
    const two: PendingUserInput = {
      ...QUESTION(),
      questions: [...QUESTION().questions, { ...QUESTION().questions[0]!, id: "second" }],
    };
    expect(mateDecision({ ...base, kind: "input", userInputs: [two] })).toMatchObject({
      kind: "questions",
      count: 2,
    });
  });

  it("says what it wants to run, word for word, with Approve first", () => {
    expect(
      mateDecision({ ...base, name: "Juno", kind: "approval", approvals: [APPROVAL] }),
    ).toEqual({
      kind: "approval",
      requestId: "req-1",
      title: "Juno wants to run",
      detail: APPROVAL.detail,
      choices: [
        { label: "Approve", value: "accept", primary: true },
        { label: "Deny", value: "decline", primary: false },
      ],
    });
  });

  it("offers the provider's own choices where it names them", () => {
    const decision = mateDecision({
      ...base,
      kind: "approval",
      approvals: [
        {
          ...APPROVAL,
          options: [
            { decision: "accept", label: "Yes" },
            { decision: "acceptForSession", label: "Yes, for this session" },
            { decision: "decline", label: "No" },
          ],
        },
      ],
    });
    expect(decision?.kind === "approval" && decision.choices).toEqual([
      { label: "Yes", value: "accept", primary: true },
      { label: "Yes, for this session", value: "acceptForSession", primary: false },
      { label: "No", value: "decline", primary: false },
    ]);
  });

  it.each([
    { kind: "approval", expected: { kind: "reading" } },
    { kind: "input", expected: { kind: "reading" } },
  ] as const)(
    "says it is reading what a $kind waits on until the thread is read",
    ({ kind, expected }) => {
      expect(mateDecision({ ...base, read: false, kind })).toEqual(expected);
    },
  );

  it.each([
    { kind: "planReady", expected: { kind: "plan" } },
    { kind: "failed", expected: { kind: "failure", message: "The deploy timed out." } },
    { kind: "working", expected: undefined },
    { kind: "idle", expected: undefined },
    { kind: "done", expected: undefined },
  ] as const)("reads $kind as $expected", ({ kind, expected }) => {
    expect(mateDecision({ ...base, kind, failure: "The deploy timed out." })).toEqual(expected);
  });

  // F7: a sign-in failure says the Mate is signed out, and what the person signs in to.
  it("says a signed-out Mate's failure with the Mate as its subject", () => {
    expect(
      mateDecision({
        ...base,
        kind: "failed",
        failure:
          "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
      }),
    ).toEqual({
      kind: "failure",
      message: "Kai needs a Claude sign-in to continue.",
    });
  });

  it("an expected limit keeps the same calm words outside the conversation", () => {
    expect(
      mateDecision({
        ...base,
        kind: "failed",
        failure: "Claude usage limit reached. Send the message again.",
      }),
    ).toEqual({ kind: "failure", message: "Kai hit the Claude limit." });
  });
  it("leaves another failure that says it could not authenticate as it came", () => {
    const failure = "mirror_error: Git could not authenticate with the remote.";
    expect(
      mateDecision({ ...base, kind: "failed", failure, failureDriver: "claudeAgent" }),
    ).toEqual({ kind: "failure", message: failure });
  });
});
