import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { agentActivityAt, agentActivitySubject, deriveZeropsAgentActivity } from "./agentActivity";

const FEN = EnvironmentId.make("env-fen");
const OTTO = EnvironmentId.make("env-otto");

function shell(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: FEN,
    projectId: ProjectId.make("project-1"),
    title: "Add the login page",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-09-05T10:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const RUNNING = shell({
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: "2026-09-05T10:01:00.000Z",
    startedAt: "2026-09-05T10:01:00.000Z",
    completedAt: null,
    assistantMessageId: null,
  },
});

describe("deriveZeropsAgentActivity", () => {
  it("answers per environment from its one conversation, through the one resolver", () => {
    const activity = deriveZeropsAgentActivity(
      [RUNNING, shell({ id: ThreadId.make("thread-2"), environmentId: OTTO })],
      {},
    );
    expect(activity.get(FEN)).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      kind: "working",
      status: { kind: "working", label: "Working", pulse: true },
      face: "working",
      subject: "Add the login page",
    });
    // Idle has no phrase of its own — the face says it — but the subject stays:
    // the line under the name keeps saying what this Mate is about.
    expect(activity.get(OTTO)).toMatchObject({
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Add the login page",
    });
  });

  it("knows nothing about an environment with no conversation", () => {
    expect(deriveZeropsAgentActivity([], {}).size).toBe(0);
  });

  it("prefers the running plan step as the subject when the server reports one", () => {
    const stepping = shell({
      ...RUNNING,
      planProgress: { step: "Wire the session cookie", completedSteps: 2, totalSteps: 5 },
    });
    expect(deriveZeropsAgentActivity([stepping], {}).get(FEN)?.subject).toBe(
      "Wire the session cookie",
    );
  });

  it("wears the needs-you face and says so when a conversation waits on an approval", () => {
    const waiting = shell({ hasPendingApprovals: true });
    expect(deriveZeropsAgentActivity([waiting], {}).get(FEN)).toMatchObject({
      kind: "approval",
      status: { kind: "approval", label: "Approval" },
      face: "needs",
      subject: "Add the login page",
    });
  });

  it("reads the client's visit marker so an unseen completion is done and a seen one idle", () => {
    const completed = shell({
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-09-05T10:01:00.000Z",
        startedAt: "2026-09-05T10:01:00.000Z",
        completedAt: "2026-09-05T10:05:00.000Z",
        assistantMessageId: null,
      },
    });
    const key = `${FEN}:thread-1`;
    const unseen = deriveZeropsAgentActivity([completed], { [key]: "2026-09-05T10:04:00.000Z" });
    expect(unseen.get(FEN)).toMatchObject({ kind: "done", status: { kind: "done" }, face: "done" });
    const seen = deriveZeropsAgentActivity([completed], { [key]: "2026-09-05T10:06:00.000Z" });
    expect(seen.get(FEN)).toMatchObject({
      kind: "idle",
      status: null,
      subject: "Add the login page",
    });
  });
});

describe("agentActivitySubject", () => {
  it.each([
    ["idle", "Add the login page"],
    ["working", "Add the login page"],
    ["approval", "Add the login page"],
    ["done", "Add the login page"],
  ] as const)("for %s is %s", (kind, expected) => {
    expect(agentActivitySubject(shell(), kind)).toBe(expected);
  });

  it("has nothing to say for a conversation nobody has spoken into — its title is a placeholder", () => {
    expect(
      agentActivitySubject(shell({ title: "New thread", latestUserMessageAt: null }), "idle"),
    ).toBeUndefined();
  });

  it("has nothing to say for a blank step and a blank title", () => {
    expect(
      agentActivitySubject(
        shell({ title: " ", planProgress: { step: " ", completedSteps: 0, totalSteps: 1 } }),
        "working",
      ),
    ).toBeUndefined();
  });
});

describe("agentActivityAt", () => {
  const turn = {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-09-05T10:01:00.000Z",
    startedAt: "2026-09-05T10:01:05.000Z",
    completedAt: "2026-09-05T10:05:00.000Z",
    assistantMessageId: null,
  };

  it.each([
    ["the last turn's end when it has one", shell({ latestTurn: turn }), turn.completedAt],
    [
      "the turn's start while it still runs",
      shell({ latestTurn: { ...turn, state: "running", completedAt: null } }),
      turn.startedAt,
    ],
    [
      "the last message when no turn has run",
      shell({ latestTurn: null, latestUserMessageAt: "2026-09-05T09:00:00.000Z" }),
      "2026-09-05T09:00:00.000Z",
    ],
    [
      "the conversation's last change when nobody has spoken",
      shell({ latestTurn: null, latestUserMessageAt: null, updatedAt: "2026-09-04T08:00:00.000Z" }),
      "2026-09-04T08:00:00.000Z",
    ],
  ] as const)("is %s", (_, thread, expected) => {
    expect(agentActivityAt(thread)).toBe(expected);
  });
});
