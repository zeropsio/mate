import { OrchestrationThreadShell } from "@t3tools/contracts";
import { MATE_LINK_TEXT_MAX } from "@t3tools/shared/mateLink";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { liveStepLine, mateSummaryOf } from "./zeropsHqSummary.ts";

const decodeShell = Schema.decodeUnknownSync(OrchestrationThreadShell);

const shell = (id: string, extra: object = {}) =>
  decodeShell({
    id,
    projectId: "project-1",
    title: id,
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...extra,
  });

const running = {
  session: {
    threadId: "main",
    status: "running",
    providerName: null,
    activeTurnId: "turn-1",
    lastError: null,
    updatedAt: "2026-10-02T10:00:00Z",
  },
  latestTurn: {
    turnId: "turn-1",
    state: "running",
    requestedAt: "2026-10-02T10:00:00Z",
    startedAt: "2026-10-02T10:00:01Z",
    completedAt: null,
    assistantMessageId: null,
  },
};

describe("mateSummaryOf", () => {
  it("summarises the main chat by the client's rule, and counts the chats that run or wait", () => {
    const main = shell("main", {
      ...running,
      latestUserMessageAt: "2026-10-02T10:00:00Z",
      latestUserMessagePreview: {
        role: "user",
        text: "Add a login page",
        createdAt: "2026-10-02T10:00:00Z",
      },
      latestMessagePreview: {
        role: "assistant",
        text: "On it.",
        createdAt: "2026-10-02T10:00:02Z",
      },
      liveStep: {
        kind: "calls",
        since: "2026-10-02T10:00:03Z",
        calls: [
          {
            id: "call-1",
            activityKind: "tool.updated",
            itemType: "command_execution",
            title: "Command run",
            detail: "Bash: pnpm build",
            startedAt: "2026-10-02T10:00:03Z",
          },
        ],
      },
    });
    const asking = shell("asking", {
      latestUserMessageAt: "2026-10-01T09:00:00Z",
      hasPendingUserInput: true,
      pendingQuestion: "Which database?",
    });
    const archived = shell("archived", { ...running, archivedAt: "2026-10-01T12:00:00Z" });
    const summary = mateSummaryOf([asking, main, archived], { "claude-code": "U1" });
    expect(summary).toEqual({
      main: {
        threadId: "main",
        status: "working",
        lastRequest: "Add a login page",
        lastWords: "On it.",
        lastTurnAt: "2026-10-02T10:00:00Z",
        waitingQuestion: null,
        firstError: null,
        liveStep: "Bash: pnpm build",
      },
      running: 1,
      waiting: 1,
      signers: { "claude-code": "U1" },
    });
  });

  it("cuts long words and keeps an error's first line only", () => {
    const summary = mateSummaryOf(
      [
        shell("main", {
          latestUserMessageAt: "2026-10-02T10:00:00Z",
          latestUserMessagePreview: {
            role: "user",
            text: "x".repeat(MATE_LINK_TEXT_MAX + 100),
            createdAt: "2026-10-02T10:00:00Z",
          },
          session: { ...running.session, status: "error", lastError: "boom\nat line 2" },
        }),
      ],
      {},
    );
    expect(summary.main?.lastRequest?.length).toBe(MATE_LINK_TEXT_MAX);
    expect(summary.main?.firstError).toBe("boom");
  });

  it("has no main chat in a Mate with none", () => {
    expect(mateSummaryOf([], {})).toEqual({ main: null, running: 0, waiting: 0, signers: {} });
  });
});

describe("liveStepLine", () => {
  it("names the running call, else thinking or writing", () => {
    expect(liveStepLine({ kind: "thinking", since: "2026-10-02T10:00:00Z" })).toBe("Thinking");
    expect(liveStepLine({ kind: "writing", since: "2026-10-02T10:00:00Z" })).toBe("Writing");
    expect(liveStepLine(null)).toBeNull();
  });
});
