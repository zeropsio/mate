import { describe, expect, it } from "vite-plus/test";

import { addressProblem, inviteStepAfterCheck, nameProblem } from "./projectInvite.logic";

describe("inviting someone to a project, step by step", () => {
  it.each([
    { value: "eva@example.com", problem: null },
    { value: "  Eva@Example.com ", problem: null },
    { value: "", problem: "Enter their e-mail address." },
    { value: "eva", problem: "That isn't an e-mail address." },
    { value: "eva@example", problem: "That isn't an e-mail address." },
  ])("An address is checked before Zerops is asked: $value", ({ value, problem }) => {
    expect(addressProblem(value)).toBe(problem);
  });

  it.each([
    {
      sentence: "An address with a Zerops account goes straight to how much they may do",
      answer: { kind: "existing", userId: "u-eva" } as const,
      step: {
        step: "access",
        email: "eva@example.com",
        invitee: { kind: "existing", userId: "u-eva" },
      },
    },
    {
      sentence: "A new address asks their name first, which Zerops needs to make their account",
      answer: { kind: "new" } as const,
      step: { step: "name", email: "eva@example.com" },
    },
  ])("$sentence", ({ answer, step }) => {
    expect(inviteStepAfterCheck("eva@example.com", answer)).toEqual(step);
  });

  it.each([
    { first: "Eva", last: "Dvořáková", problem: null },
    { first: " ", last: "Dvořáková", problem: "Enter their first and last name." },
    { first: "Eva", last: "", problem: "Enter their first and last name." },
  ])("A new person needs both names: '$first' '$last'", ({ first, last, problem }) => {
    expect(nameProblem(first, last)).toBe(problem);
  });
});
