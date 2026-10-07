import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import type { ZeropsAgentActivity } from "./agentActivity";
import { mateStatus } from "./mateStatus.logic";

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
});
describe("Mate status across menu and conversation", () => {
  it.each([
    [{ kind: "failed", usageLimited: true }, "limit", "attention"],
    [{ kind: "failed", errorLine: "Claude usage limit reached" }, "limit", "attention"],
    [
      {
        kind: "failed",
        errorLine: "Claude could not authenticate. For subscription login, run claude auth login.",
      },
      "sign-in",
      "attention",
    ],
    [{ kind: "input" }, "answer", "attention"],
    [{ kind: "approval" }, "answer", "attention"],
    [{ kind: "failed", errorLine: "The work failed." }, "broken", "danger"],
  ] as const)("%j is visible as %s", (patch, kind, severity) => {
    expect(mateStatus(activity(patch))).toMatchObject({ kind, severity });
  });
  it("keeps the source reset even after it has passed", () => {
    expect(mateStatus(activity({ pausedUntil: "2020-01-01T16:00:00Z" }))).toEqual({
      kind: "limit",
      severity: "attention",
      until: "2020-01-01T16:00:00Z",
      provider: undefined,
    });
  });
  it("unknown and working states do not invent a stop", () => {
    expect(mateStatus(undefined)).toBeNull();
    expect(mateStatus(activity({ kind: "working" }))).toBeNull();
    expect(mateStatus(activity({ kind: "working" }), true)).toBeNull();
  });
  it("a source sign-in requirement needs attention without a failed turn", () => {
    expect(mateStatus(undefined, true)).toMatchObject({ kind: "sign-in", severity: "attention" });
  });
});
