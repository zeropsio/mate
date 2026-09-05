import { describe, expect, it } from "vite-plus/test";

import {
  resolvePrimaryConversation,
  type ZeropsConversationCandidate,
} from "./primaryConversation.ts";

function thread(
  id: string,
  overrides: Partial<ZeropsConversationCandidate> = {},
): ZeropsConversationCandidate {
  return {
    id,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolvePrimaryConversation", () => {
  it("has no conversation for an environment with no threads", () => {
    expect(resolvePrimaryConversation([])).toEqual({
      primary: undefined,
      hidden: [],
      reason: "none",
    });
  });

  it("opens the only thread there is", () => {
    const result = resolvePrimaryConversation([thread("a")]);
    expect(result.primary?.id).toBe("a");
    expect(result.hidden).toEqual([]);
  });

  it("does NOT let a freshly created empty draft displace the ongoing conversation", () => {
    // The index route creates a draft on landing. If that won, the user would
    // lose their conversation by opening the app.
    const ongoing = thread("ongoing", {
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-04T10:00:00Z",
      latestUserMessageAt: "2026-09-04T10:00:00Z",
    });
    const freshDraft = thread("draft", {
      createdAt: "2026-09-05T09:00:00Z",
      updatedAt: "2026-09-05T09:00:00Z",
    });

    const result = resolvePrimaryConversation([freshDraft, ongoing]);

    expect(result.primary?.id).toBe("ongoing");
    expect(result.reason).toBe("spoken");
    expect(result.hidden.map((entry) => entry.id)).toEqual(["draft"]);
  });

  it("does not let a background update displace the conversation either", () => {
    // updatedAt moves for provider events and checkpoints, not just for the
    // user — so it never outranks having actually been spoken in.
    const spoken = thread("spoken", {
      updatedAt: "2026-09-01T00:00:00Z",
      latestUserMessageAt: "2026-09-01T00:00:00Z",
    });
    const churned = thread("churned", { updatedAt: "2026-09-05T23:00:00Z" });

    expect(resolvePrimaryConversation([churned, spoken]).primary?.id).toBe("spoken");
  });

  it("prefers the most recently spoken-in thread when several have been used", () => {
    const older = thread("older", { latestUserMessageAt: "2026-09-02T00:00:00Z" });
    const newer = thread("newer", { latestUserMessageAt: "2026-09-04T00:00:00Z" });

    const result = resolvePrimaryConversation([older, newer]);
    expect(result.primary?.id).toBe("newer");
    expect(result.hidden.map((entry) => entry.id)).toEqual(["older"]);
  });

  it("lets the user overrule the heuristic by pinning", () => {
    const pinned = thread("pinned", { pinned: true });
    const chatty = thread("chatty", { latestUserMessageAt: "2026-09-05T00:00:00Z" });

    const result = resolvePrimaryConversation([chatty, pinned]);
    expect(result.primary?.id).toBe("pinned");
    expect(result.reason).toBe("pinned");
  });

  it("never resurrects an archived thread", () => {
    const archived = thread("archived", {
      archivedAt: "2026-09-04T00:00:00Z",
      latestUserMessageAt: "2026-09-04T00:00:00Z",
    });
    const live = thread("live");

    const result = resolvePrimaryConversation([archived, live]);
    expect(result.primary?.id).toBe("live");
    expect(result.hidden).toEqual([]);
  });

  it("has no conversation when every thread is archived", () => {
    const result = resolvePrimaryConversation([
      thread("a", { archivedAt: "2026-09-04T00:00:00Z" }),
    ]);
    expect(result.primary).toBeUndefined();
    expect(result.reason).toBe("none");
  });

  it("falls back to the newest when nothing has been spoken in", () => {
    const old = thread("old", {
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    });
    const recent = thread("recent", {
      createdAt: "2026-09-05T00:00:00Z",
      updatedAt: "2026-09-05T00:00:00Z",
    });

    const result = resolvePrimaryConversation([old, recent]);
    expect(result.primary?.id).toBe("recent");
    expect(result.reason).toBe("newest");
  });

  it("gives the same answer whatever order the threads arrive in", () => {
    // Two clients on the same environment must open the same conversation.
    const threads = [
      thread("a", { latestUserMessageAt: "2026-09-04T00:00:00Z" }),
      thread("b", { latestUserMessageAt: "2026-09-04T00:00:00Z" }),
      thread("c"),
    ];

    const forward = resolvePrimaryConversation(threads);
    const backward = resolvePrimaryConversation(threads.toReversed());

    expect(forward.primary?.id).toBe(backward.primary?.id);
    expect(forward.hidden.map((entry) => entry.id)).toEqual(
      backward.hidden.map((entry) => entry.id),
    );
  });

  it("tolerates an unparseable timestamp instead of throwing", () => {
    const broken = thread("broken", { latestUserMessageAt: "not-a-date" });
    const fine = thread("fine", { latestUserMessageAt: "2026-09-04T00:00:00Z" });

    expect(resolvePrimaryConversation([broken, fine]).primary?.id).toBe("fine");
  });

  it("counts the hidden ones, which is the affordance for surfacing them later", () => {
    const result = resolvePrimaryConversation([
      thread("a", { latestUserMessageAt: "2026-09-04T00:00:00Z" }),
      thread("b"),
      thread("c"),
    ]);
    expect(result.hidden).toHaveLength(2);
  });
});
