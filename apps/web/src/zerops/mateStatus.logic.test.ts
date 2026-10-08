import { agentAdmission, projectMateLimit } from "@t3tools/client-runtime/data";
import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import type { ZeropsAgentActivity } from "./agentActivity";
import { mateStatus } from "./mateStatus.logic";

const admission = agentAdmission({
  environmentId: "rig",
  instanceId: "claudeAgent",
  viewerSubject: "owner",
  read: {
    state: "known",
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
    value: {
      available: true,
      agents: [
        {
          agentId: "claude-code",
          credPresent: false,
          flagOAuth: false,
          flagToken: false,
          providerAuth: "unknown",
          state: "not-authorized",
        },
      ],
    },
  },
  providers: [],
  mateName: "Rosa",
}).attention;
const activity = (patch: Partial<ZeropsAgentActivity>): ZeropsAgentActivity => ({
  threadId: ThreadId.make("thread"),
  threadKey: "thread",
  task: undefined,
  kind: "idle",
  status: null,
  face: "idle",
  subject: undefined,
  at: "2026-10-07T12:00:00Z",
  snippet: undefined,
  unread: false,
  pausedUntil: undefined,
  ...patch,
  limit: projectMateLimit(
    {
      latestTurn: null,
      session: {
        lastError: patch.errorLine ?? (patch.usageLimited ? "Claude usage limit reached" : null),
        usageLimitResetAt: patch.pausedUntil,
      },
    },
    Date.now(),
  ),
});
describe("Mate status across menu and conversation", () => {
  it.each([
    [{ kind: "failed", usageLimited: true }, "limit", "attention"],
    [{ kind: "failed", errorLine: "Claude usage limit reached" }, "limit", "attention"],
    [{ kind: "input" }, "answer", "attention"],
    [{ kind: "approval" }, "answer", "attention"],
    [{ kind: "failed", errorLine: "The work failed." }, "broken", "danger"],
  ] as const)("%j is visible as %s", (patch, kind, severity) => {
    expect(mateStatus(activity(patch))).toMatchObject({ kind, severity });
  });
  it("an expired provider reset is no longer a current menu limit", () => {
    expect(mateStatus(activity({ pausedUntil: "2020-01-01T16:00:00Z" }))).toBeNull();
  });
  it("unknown and working states do not invent a stop", () => {
    expect(mateStatus(undefined)).toBeNull();
    expect(mateStatus(activity({ kind: "working" }))).toBeNull();
    expect(mateStatus(activity({ kind: "working" }), admission)).toBeNull();
  });
  it("a source sign-in requirement needs attention without a failed turn", () => {
    expect(mateStatus(undefined, admission)).toMatchObject({
      kind: "sign-in",
      severity: "attention",
    });
  });
});

it("typed restart evidence requests Continue without treating the Mate as broken", () => {
  const interruption = {
    turnId: TurnId.make("turn"),
    restart: { cause: "replaced" as const, at: "2026-10-08T08:24:39.700Z" },
    continuation: "manual" as const,
  };
  expect(mateStatus(activity({ kind: "failed", interruption }))).toMatchObject({
    kind: "interrupted",
    severity: "attention",
    interruption,
  });
  expect(mateStatus(activity({ kind: "idle", interruption: null }))).toBeNull();
});

it("an answerable question remains the recovery action after a restart", () => {
  const interruption = {
    turnId: TurnId.make("turn"),
    restart: { cause: "replaced" as const, at: "2026-10-08T08:24:39.700Z" },
    continuation: "manual" as const,
  };
  expect(mateStatus(activity({ kind: "input", interruption }))).toMatchObject({
    kind: "answer",
    severity: "attention",
  });
});
