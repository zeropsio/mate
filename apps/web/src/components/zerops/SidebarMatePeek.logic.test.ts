import type { PendingApproval, PendingUserInput } from "@t3tools/client-runtime/pending-requests";
import { ApprovalRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matePeekDecision, matePeekKey, matePeekSteps } from "./SidebarMatePeek.logic";

describe("matePeekSteps — the plan as the peek lists it", () => {
  it("lists the thread's own plan once it is read, each step with its state", () => {
    expect(
      matePeekSteps({
        plan: {
          steps: [
            { step: "Read the routes", status: "completed" },
            { step: "Run the build", status: "inProgress" },
            { step: "Deploy to stage", status: "pending" },
          ],
        },
        progress: { step: "Run the build", completedSteps: 1, totalSteps: 3 },
      }),
    ).toEqual([
      { text: "Read the routes", state: "done" },
      { text: "Run the build", state: "running" },
      { text: "Deploy to stage", state: "waiting" },
    ]);
  });

  it("keeps the list's height from the shell's count until the plan is read", () => {
    expect(
      matePeekSteps({
        plan: undefined,
        progress: { step: "Run the build", completedSteps: 2, totalSteps: 4 },
      }),
    ).toEqual([
      { text: undefined, state: "done" },
      { text: undefined, state: "done" },
      { text: "Run the build", state: "running" },
      { text: undefined, state: "waiting" },
    ]);
  });

  it.each([
    { case: "no plan and no count", plan: undefined, progress: undefined },
    { case: "an empty plan and no count", plan: { steps: [] }, progress: null },
    {
      case: "a count of nothing",
      plan: null,
      progress: { step: "x", completedSteps: 0, totalSteps: 0 },
    },
  ])("lists nothing for $case", ({ plan, progress }) => {
    expect(matePeekSteps({ plan, progress })).toBeUndefined();
  });
});

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

describe("matePeekDecision — what a Mate waits on, answered in place", () => {
  it("offers one question's options and words of its own, sending each option's value", () => {
    expect(matePeekDecision({ ...base, kind: "input", userInputs: [QUESTION()] })).toEqual({
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
    const decision = matePeekDecision({
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
        matePeekDecision({ ...base, kind: "input", userInputs: [QUESTION(overrides)] })?.kind,
      ).toBe("questions");
    },
  );

  it("leaves several questions to the conversation's form, saying how many", () => {
    const two: PendingUserInput = {
      ...QUESTION(),
      questions: [...QUESTION().questions, { ...QUESTION().questions[0]!, id: "second" }],
    };
    expect(matePeekDecision({ ...base, kind: "input", userInputs: [two] })).toMatchObject({
      kind: "questions",
      count: 2,
    });
  });

  it("says what it wants to run, word for word, with Approve first", () => {
    expect(
      matePeekDecision({ ...base, name: "Juno", kind: "approval", approvals: [APPROVAL] }),
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
    const decision = matePeekDecision({
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
      expect(matePeekDecision({ ...base, read: false, kind })).toEqual(expected);
    },
  );

  it.each([
    { kind: "planReady", expected: { kind: "plan" } },
    { kind: "failed", expected: { kind: "failure", message: "The deploy timed out." } },
    { kind: "working", expected: undefined },
    { kind: "idle", expected: undefined },
    { kind: "done", expected: undefined },
  ] as const)("reads $kind as $expected", ({ kind, expected }) => {
    expect(matePeekDecision({ ...base, kind, failure: "The deploy timed out." })).toEqual(expected);
  });
});

describe("matePeekKey — what a key does while a peek stands", () => {
  const base = { modified: false, typing: false, choices: 3, canStop: true };
  it.each([
    { case: "1 picks the first choice", key: "1", input: {}, action: { kind: "choose", index: 0 } },
    { case: "3 picks the third", key: "3", input: {}, action: { kind: "choose", index: 2 } },
    { case: "4 of three picks nothing", key: "4", input: {}, action: undefined },
    { case: "a number with nothing to pick", key: "1", input: { choices: 0 }, action: undefined },
    { case: "x stops a working Mate", key: "x", input: {}, action: { kind: "stop" } },
    { case: "X, shifted, stops it too", key: "X", input: {}, action: { kind: "stop" } },
    {
      case: "x on a resting Mate does nothing",
      key: "x",
      input: { canStop: false },
      action: undefined,
    },
    {
      case: "a number typed into a field is text",
      key: "1",
      input: { typing: true },
      action: undefined,
    },
    { case: "⌥1 is not the peek's", key: "1", input: { modified: true }, action: undefined },
    { case: "Escape puts it away", key: "Escape", input: {}, action: { kind: "close" } },
    {
      case: "Escape from a field too",
      key: "Escape",
      input: { typing: true },
      action: { kind: "close" },
    },
    { case: "any other key is not the peek's", key: "a", input: {}, action: undefined },
  ])("$case", ({ key, input, action }) => {
    expect(matePeekKey({ ...base, ...input, key })).toEqual(action);
  });
});
