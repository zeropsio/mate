import {
  EnvironmentId,
  MATE_TASKS_CONVERSATION_ID,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  resolvePrimaryConversation,
  type ZeropsConversationCandidate,
} from "./primaryConversation.ts";

const decodeThreadShell = Schema.decodeUnknownSync(OrchestrationThreadShell);

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
    const pinned = thread("pinned", { pinnedAt: "2026-09-01T00:00:00Z" });
    const chatty = thread("chatty", { latestUserMessageAt: "2026-09-05T00:00:00Z" });

    const result = resolvePrimaryConversation([chatty, pinned]);
    expect(result.primary?.id).toBe("pinned");
    expect(result.reason).toBe("pinned");
  });

  it("keeps the pinned main chat main after a newer chat is spoken in", () => {
    // A thread shell carries its pin as `pinnedAt`; a cleared pin is null.
    const main = thread("main", {
      pinnedAt: "2026-09-05T09:00:00Z",
      latestUserMessageAt: "2026-09-05T09:00:00Z",
    });
    const logs = thread("logs", {
      pinnedAt: null,
      createdAt: "2026-09-05T10:00:00Z",
      latestUserMessageAt: "2026-09-05T11:00:00Z",
    });

    const result = resolvePrimaryConversation([logs, main]);
    expect(result.primary?.id).toBe("main");
    expect(result.reason).toBe("pinned");
    expect(result.hidden.map((entry) => entry.id)).toEqual(["logs"]);
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

  it("opening an automated Mate opens its one conversation", () => {
    // Its tasks before the one conversation, each in its own: one pinned, one spoken in later.
    const result = resolvePrimaryConversation([
      thread("task-task-9", { pinnedAt: "2026-09-02T00:00:00Z" }),
      thread("task-task-12", { latestUserMessageAt: "2026-09-04T00:00:00Z" }),
      thread(MATE_TASKS_CONVERSATION_ID, {
        createdAt: "2026-09-05T00:00:00Z",
        latestUserMessageAt: "2026-09-05T00:00:00Z",
      }),
    ]);
    expect(result.primary?.id).toBe(MATE_TASKS_CONVERSATION_ID);
    expect(result.reason).toBe("tasks");
    // Its old per-task conversations stay, as its history.
    expect(result.hidden.map((entry) => entry.id).toSorted()).toEqual([
      "task-task-12",
      "task-task-9",
    ]);
  });

  it("opens an older automated Mate's newest task, never an old one while a newer one exists", () => {
    const result = resolvePrimaryConversation([
      thread("task-task-9", {
        createdAt: "2026-09-01T00:00:00Z",
        pinnedAt: "2026-09-02T00:00:00Z",
        latestUserMessageAt: "2026-09-06T00:00:00Z",
      }),
      thread("task-task-12", {
        createdAt: "2026-09-03T00:00:00Z",
        latestUserMessageAt: "2026-09-03T00:00:00Z",
      }),
      thread("draft", { createdAt: "2026-09-04T00:00:00Z" }),
    ]);
    expect(result.primary?.id).toBe("task-task-12");
    expect(result.reason).toBe("tasks");
  });

  it("never opens a crewmate's thread, nor counts it among the hidden ones", () => {
    // Shells as the wire delivers them, so a crew field the candidate names
    // differently from the shell fails here instead of passing silently.
    const shell = (id: string, extra: object) => ({
      environmentId: EnvironmentId.make("environment-1"),
      ...decodeThreadShell({
        id,
        projectId: "project-1",
        title: id,
        modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        session: null,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        ...extra,
      }),
    });
    // The server writes a task card to a stint as a user message, so a stint
    // looks spoken, and more recently than the person's own conversation.
    const stint = shell("stint", {
      latestUserMessageAt: "2026-09-05T00:00:00Z",
      updatedAt: "2026-09-05T00:00:00Z",
      crew: { crew: "shop", crewmate: "backend", stint: 1 },
    });
    const person = shell("person", { latestUserMessageAt: "2026-09-02T00:00:00Z" });

    expect(resolvePrimaryConversation([stint, person])).toEqual({
      primary: person,
      hidden: [],
      reason: "spoken",
    });
    expect(resolvePrimaryConversation([stint])).toEqual({
      primary: undefined,
      hidden: [],
      reason: "none",
    });
  });
});
