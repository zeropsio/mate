import { describe, expect, it } from "@effect/vitest";

import { type ProposalAsk, type StoredDecision, decisionVerdict } from "./proposals.ts";

const approved: StoredDecision = {
  projectId: "P",
  decision: "approved",
  outcome: null,
  words: null,
};

describe("a proposal's decision is written once, its outcome once after an approval", () => {
  const cases: ReadonlyArray<
    readonly [string, StoredDecision | null, ProposalAsk, ReturnType<typeof decisionVerdict>]
  > = [
    ["an approval is recorded", null, { projectId: "P", decision: "approved" }, { kind: "insert" }],
    ["a decline is recorded", null, { projectId: "P", decision: "declined" }, { kind: "insert" }],
    [
      "an approval carried out before HQ heard of it is recorded with its outcome",
      null,
      { projectId: "P", decision: "approved", outcome: "failed", words: "quota" },
      { kind: "insert" },
    ],
    [
      "a decline has no outcome",
      null,
      { projectId: "P", decision: "declined", outcome: "done" },
      { kind: "refuse", reason: "outcome_without_approval" },
    ],
    [
      "the same decision again changes nothing",
      approved,
      { projectId: "P", decision: "approved" },
      { kind: "same" },
    ],
    [
      "a decision is never turned",
      approved,
      { projectId: "P", decision: "declined" },
      { kind: "refuse", reason: "decided" },
    ],
    [
      "a decision is never moved to another project",
      approved,
      { projectId: "Q", decision: "approved" },
      { kind: "refuse", reason: "other_project" },
    ],
    [
      "an approval's outcome is recorded",
      approved,
      { projectId: "P", decision: "approved", outcome: "failed", words: "quota" },
      { kind: "outcome" },
    ],
    [
      "the same outcome again changes nothing",
      { ...approved, outcome: "done", words: null },
      { projectId: "P", decision: "approved", outcome: "done" },
      { kind: "same" },
    ],
    [
      "an outcome is never turned",
      { ...approved, outcome: "done", words: null },
      { projectId: "P", decision: "approved", outcome: "failed" },
      { kind: "refuse", reason: "outcome_recorded" },
    ],
    [
      "an outcome's words are never changed",
      { ...approved, outcome: "failed", words: "quota" },
      { projectId: "P", decision: "approved", outcome: "failed", words: "other" },
      { kind: "refuse", reason: "outcome_recorded" },
    ],
    [
      "a declined proposal takes no outcome",
      { ...approved, decision: "declined" },
      { projectId: "P", decision: "declined", outcome: "done" },
      { kind: "refuse", reason: "outcome_without_approval" },
    ],
    [
      "words alone after the decision are no outcome",
      approved,
      { projectId: "P", decision: "approved", words: "late" },
      { kind: "refuse", reason: "words_without_outcome" },
    ],
  ];

  it.each(cases)("%s", (_, stored, ask, verdict) => {
    expect(decisionVerdict(stored, ask)).toEqual(verdict);
  });
});
