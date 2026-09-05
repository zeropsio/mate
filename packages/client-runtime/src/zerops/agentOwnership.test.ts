import { describe, expect, it } from "vite-plus/test";

import {
  agentOwnershipNeedsAttention,
  agentOwnershipNotice,
  resolveAgentOwnership,
  type ZeropsAgentOwnership,
} from "./agentOwnership.ts";

const AT = "2026-09-05T10:00:00Z";

describe("resolveAgentOwnership", () => {
  it.each([
    {
      name: "no credential is nobody's",
      credPresent: false,
      authorizedBy: { subject: "user-a", at: AT },
      viewerSubject: "user-a",
      expected: "none",
    },
    {
      name: "mine when the viewer authorized it",
      credPresent: true,
      authorizedBy: { subject: "user-a", at: AT },
      viewerSubject: "user-a",
      expected: "mine",
    },
    {
      name: "someone else's when a different member authorized it",
      credPresent: true,
      authorizedBy: { subject: "user-b", at: AT },
      viewerSubject: "user-a",
      expected: "someone-else",
    },
    {
      name: "unrecorded when nothing was recorded",
      credPresent: true,
      authorizedBy: undefined,
      viewerSubject: "user-a",
      expected: "unrecorded",
    },
    {
      name: "unrecorded rather than an accusation when the subject is blank",
      credPresent: true,
      authorizedBy: { subject: "", at: AT },
      viewerSubject: "user-a",
      expected: "unrecorded",
    },
    {
      name: "unrecorded when we cannot identify the viewer",
      credPresent: true,
      authorizedBy: { subject: "user-b", at: AT },
      viewerSubject: undefined,
      expected: "unrecorded",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    credPresent: boolean;
    authorizedBy: { subject: string; at: string } | undefined;
    viewerSubject: string | undefined;
    expected: ZeropsAgentOwnership;
  }>)("$name", ({ name: _name, expected, ...input }) => {
    expect(resolveAgentOwnership(input)).toBe(expected);
  });

  it("never reports someone-else without both a record and an identified viewer", () => {
    // The failure this guards against is accusing a colleague on missing data.
    const withoutRecord = resolveAgentOwnership({
      credPresent: true,
      viewerSubject: "user-a",
    });
    const withoutViewer = resolveAgentOwnership({
      credPresent: true,
      authorizedBy: { subject: "user-b", at: AT },
      viewerSubject: undefined,
    });

    expect(withoutRecord).not.toBe("someone-else");
    expect(withoutViewer).not.toBe("someone-else");
  });
});

describe("agentOwnershipNotice", () => {
  it("says nothing about an agent that is the viewer's own", () => {
    expect(agentOwnershipNotice("mine")).toBeUndefined();
  });

  it("says nothing when there is no credential", () => {
    expect(agentOwnershipNotice("none")).toBeUndefined();
  });

  it("warns that a turn spends the other member's subscription", () => {
    expect(agentOwnershipNotice("someone-else")).toContain("subscription");
  });

  it("hedges rather than accuses when nothing was recorded", () => {
    const notice = agentOwnershipNotice("unrecorded");
    expect(notice).toContain("may not be yours");
  });
});

describe("agentOwnershipNeedsAttention", () => {
  it.each([
    { ownership: "someone-else", expected: true },
    { ownership: "unrecorded", expected: false },
    { ownership: "mine", expected: false },
    { ownership: "none", expected: false },
  ] satisfies ReadonlyArray<{ ownership: ZeropsAgentOwnership; expected: boolean }>)(
    "$ownership → $expected",
    ({ ownership, expected }) => {
      expect(agentOwnershipNeedsAttention(ownership)).toBe(expected);
    },
  );
});
