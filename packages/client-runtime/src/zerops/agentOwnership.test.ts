import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_OWNERSHIP_RECOVERY_LABEL,
  AGENT_OWNERSHIP_RETRY_RECORD_LABEL,
  agentOwnershipAllowsTurns,
  agentOwnershipComposerNotice,
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

  it("a sign-in whose record failed says so and can be retried (H13)", () => {
    // The viewer's own just-tried write failing outranks whatever the
    // recorded tag currently says — even a stale someone-else read.
    expect(
      resolveAgentOwnership({
        credPresent: true,
        authorizedBy: { subject: "user-b", at: AT },
        viewerSubject: "user-a",
        recordFailed: true,
      }),
    ).toBe("record-failed");
    expect(
      resolveAgentOwnership({
        credPresent: true,
        viewerSubject: "user-a",
        recordFailed: true,
      }),
    ).toBe("record-failed");
  });

  it("no credential still means nobody, even mid-retry", () => {
    expect(
      resolveAgentOwnership({ credPresent: false, viewerSubject: "user-a", recordFailed: true }),
    ).toBe("none");
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

  // D6: the notice states the gate rather than warning about a spend that is
  // no longer possible — the server refuses the turn outright.
  it("says only the signer runs somebody else's agent", () => {
    expect(agentOwnershipNotice("someone-else")).toBe(
      "Signed in by another project member — only they can run this agent.",
    );
  });

  it("states the fact rather than accusing when nothing was recorded", () => {
    expect(agentOwnershipNotice("unrecorded")).toBe(
      "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it.",
    );
  });

  it("says the record failed, not that the agent belongs to someone else", () => {
    expect(agentOwnershipNotice("record-failed")).toBe("Your sign-in could not be recorded.");
  });
});

describe("the composer notice and the gate (D6)", () => {
  it.each([
    ["mine", true],
    ["none", true],
    ["someone-else", false],
    ["unrecorded", false],
    ["record-failed", false],
  ] as const)("%s may start a turn: %s", (ownership, allowed) => {
    expect(agentOwnershipAllowsTurns(ownership)).toBe(allowed);
  });

  it("names the signer in place of the composer when a name is known", () => {
    expect(agentOwnershipComposerNotice("someone-else", "Jan")).toBe(
      "Signed in by Jan — only they can run this agent.",
    );
  });

  // A wrong name would be worse than none.
  it.each([undefined, "", "  "])("says the same thing without a name (%s)", (name) => {
    expect(agentOwnershipComposerNotice("someone-else", name)).toBe(
      "Signed in by another project member — only they can run this agent.",
    );
  });

  it("says nothing at all about the viewer's own agent", () => {
    expect(agentOwnershipComposerNotice("mine", "Jan")).toBeUndefined();
    expect(agentOwnershipComposerNotice("none")).toBeUndefined();
  });

  it("offers one recovery, and it is the person's own sign-in", () => {
    expect(AGENT_OWNERSHIP_RECOVERY_LABEL).toBe("Sign in with your own account");
  });

  it("record-failed replaces the composer with its own line and a retry, never Sign in again", () => {
    expect(agentOwnershipComposerNotice("record-failed")).toBe(
      "Your sign-in could not be recorded.",
    );
    expect(agentOwnershipAllowsTurns("record-failed")).toBe(false);
    expect(AGENT_OWNERSHIP_RETRY_RECORD_LABEL).toBe("Try again");
  });
});

describe("agentOwnershipNeedsAttention", () => {
  it.each([
    { ownership: "someone-else", expected: true },
    { ownership: "unrecorded", expected: false },
    { ownership: "mine", expected: false },
    { ownership: "none", expected: false },
    { ownership: "record-failed", expected: true },
  ] satisfies ReadonlyArray<{ ownership: ZeropsAgentOwnership; expected: boolean }>)(
    "$ownership → $expected",
    ({ ownership, expected }) => {
      expect(agentOwnershipNeedsAttention(ownership)).toBe(expected);
    },
  );
});
