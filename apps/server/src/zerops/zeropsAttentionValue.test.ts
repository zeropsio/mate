import {
  EnvironmentId,
  MATE_ATTENTION_IDS_MAX,
  MateAttention,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { linkFrameBytes, MATE_LINK_FRAME_MAX } from "@t3tools/shared/mateLink";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { mateAttentionOf } from "./zeropsAttentionValue.ts";

const decodeShell = Schema.decodeUnknownSync(OrchestrationThreadShell);
/** Every value here must be one the link and the client stream can send. */
const decodeAttention = Schema.decodeUnknownSync(MateAttention);

const SOURCE = { environmentId: EnvironmentId.make("env-1"), incarnation: "boot-1" };

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

const turn = (turnId: string, state: string, completedAt: string | null = null) => ({
  turnId,
  state,
  requestedAt: "2026-10-01T00:00:00Z",
  startedAt: "2026-10-01T00:00:00Z",
  completedAt,
  assistantMessageId: null,
});

const CREWMATE = { crew: "crew-1", crewmate: "lead", stint: 1 };

const attentionOf = (threads: ReadonlyArray<OrchestrationThreadShell>) =>
  decodeAttention(mateAttentionOf(threads, undefined, SOURCE));

describe("mateAttentionOf", () => {
  it.each([
    { name: "no chats", threads: [], working: 0, waiting: 0 },
    {
      name: "a running turn works, a pending approval and a question wait",
      threads: [
        shell("a", { latestTurn: turn("t-a", "running") }),
        shell("b", { hasPendingApprovals: true }),
        shell("c", { hasPendingUserInput: true }),
        shell("d"),
      ],
      working: 1,
      waiting: 2,
    },
    {
      name: "a failed turn waits, a monitoring chat works",
      threads: [
        shell("a", { latestTurn: turn("t-a", "error", "2026-10-01T00:01:00Z") }),
        shell("b", { backgroundLiveness: "monitoring" }),
      ],
      working: 1,
      waiting: 1,
    },
    {
      name: "archived and crewmates' chats are not the person's",
      threads: [
        shell("a", { latestTurn: turn("t-a", "running"), archivedAt: "2026-10-01T00:01:00Z" }),
        shell("b", { hasPendingApprovals: true, crew: CREWMATE }),
      ],
      working: 0,
      waiting: 0,
    },
  ])("counts: $name", ({ threads, working, waiting }) => {
    const attention = attentionOf(threads);
    expect({ working: attention.working, waiting: attention.waiting }).toEqual({
      working,
      waiting,
    });
  });

  it("lists what waits on the person and the finished turns of resting chats, the newest first", () => {
    const attention = attentionOf([
      shell("older-done", {
        latestTurn: turn("t-1", "completed", "2026-10-01T00:01:00Z"),
        updatedAt: "2026-10-01T00:01:00Z",
      }),
      shell("newer-done", {
        latestTurn: turn("t-2", "completed", "2026-10-01T00:02:00Z"),
        updatedAt: "2026-10-01T00:02:00Z",
      }),
      shell("asks", {
        hasPendingUserInput: true,
        latestTurn: turn("t-3", "running"),
        updatedAt: "2026-10-01T00:03:00Z",
      }),
      shell("approves", { hasPendingApprovals: true, updatedAt: "2026-10-01T00:04:00Z" }),
      shell("failed", {
        latestTurn: turn("t-5", "error", "2026-10-01T00:05:00Z"),
        updatedAt: "2026-10-01T00:05:00Z",
      }),
      shell("works", { latestTurn: turn("t-6", "running"), updatedAt: "2026-10-01T00:06:00Z" }),
      shell("never-ran"),
    ]);
    expect({ results: attention.results, questions: attention.questions }).toEqual({
      results: [
        { threadId: "newer-done", turnId: "t-2", completedAt: "2026-10-01T00:02:00Z" },
        { threadId: "older-done", turnId: "t-1", completedAt: "2026-10-01T00:01:00Z" },
      ],
      questions: [
        { threadId: "failed", kind: "failed", turnId: "t-5" },
        { threadId: "approves", kind: "approval", turnId: null },
        { threadId: "asks", kind: "input", turnId: "t-3" },
      ],
    });
  });

  it.each([
    { name: "no chats", threads: [], main: null, last: null },
    {
      name: "the spoken-to chat is main, the last of the person's in the Mate's order is last",
      threads: [
        shell("spoken", { latestUserMessageAt: "2026-10-01T00:05:00Z" }),
        shell("newest", { createdAt: "2026-10-02T00:00:00Z" }),
        shell("crewmate", { createdAt: "2026-10-03T00:00:00Z", crew: CREWMATE }),
      ],
      main: "spoken",
      last: "newest",
    },
  ])("main and last chat: $name", ({ threads, main, last }) => {
    const attention = attentionOf(threads);
    expect({ main: attention.mainThreadId, last: attention.lastThreadId }).toEqual({ main, last });
  });

  it.each([
    { name: "within the bound", done: MATE_ATTENTION_IDS_MAX, asking: 0, truncated: false },
    { name: "results past it", done: MATE_ATTENTION_IDS_MAX + 1, asking: 0, truncated: true },
    { name: "questions past it", done: 0, asking: MATE_ATTENTION_IDS_MAX + 2, truncated: true },
  ])("cuts each list at the bound and marks it: $name", ({ done, asking, truncated }) => {
    const minute = (index: number) => `2026-10-01T00:${String(index).padStart(2, "0")}:00Z`;
    const attention = attentionOf([
      ...Array.from({ length: done }, (_, index) =>
        shell(`done-${index}`, { latestTurn: turn(`t-${index}`, "completed", minute(index)) }),
      ),
      ...Array.from({ length: asking }, (_, index) =>
        shell(`asks-${index}`, { hasPendingUserInput: true, updatedAt: minute(index) }),
      ),
    ]);
    expect({
      results: attention.results.length,
      newestResult: attention.results[0]?.threadId,
      questions: attention.questions.length,
      waiting: attention.waiting,
      truncated: attention.truncated,
    }).toEqual({
      results: Math.min(done, MATE_ATTENTION_IDS_MAX),
      newestResult: done === 0 ? undefined : `done-${done - 1}`,
      questions: Math.min(asking, MATE_ATTENTION_IDS_MAX),
      waiting: asking,
      truncated,
    });
  });

  const before = [shell("a", { latestTurn: turn("t-a", "running") })];
  it.each([
    { name: "nothing changed", after: before, revision: 4 },
    {
      name: "only what attention does not carry changed",
      after: [shell("a", { latestTurn: turn("t-a", "running"), title: "renamed" })],
      revision: 4,
    },
    {
      name: "a new chat, the counts as they were",
      after: [...before, shell("b", { createdAt: "2026-10-02T00:00:00Z" })],
      revision: 5,
    },
    {
      name: "a turn finished",
      after: [shell("a", { latestTurn: turn("t-a", "completed", "2026-10-01T00:01:00Z") })],
      revision: 5,
    },
  ])("keeps its revision unless the value changed: $name", ({ after, revision }) => {
    const first = mateAttentionOf(before, undefined, SOURCE);
    const previous = { ...first, source: { ...first.source, revision: 4 } };
    expect(mateAttentionOf(after, previous, SOURCE).source).toEqual({ ...SOURCE, revision });
  });

  it("starts an incarnation at revision 0", () => {
    expect(attentionOf([]).source).toEqual({ ...SOURCE, revision: 0 });
  });

  it("raises its revision for a chat new to it, whatever time its creation is stamped with", () => {
    const later = shell("a", { createdAt: "2026-10-05T00:00:00Z" });
    const previous = mateAttentionOf([later], undefined, SOURCE);
    const next = mateAttentionOf(
      [later, shell("b", { createdAt: "2026-10-01T00:00:00Z" })],
      previous,
      SOURCE,
    );
    expect({ last: next.lastThreadId, revision: next.source.revision }).toEqual({
      last: "b",
      revision: 1,
    });
  });

  it("drops the oldest entries, marked cut, until the value fits one frame of the link", () => {
    const long = (prefix: string, n: number) => `${prefix}-${n}-${"x".repeat(1_500)}`;
    const minute = (n: number) => `2026-10-01T00:${String(n).padStart(2, "0")}:00Z`;
    const attention = attentionOf([
      ...Array.from({ length: 30 }, (_, n) =>
        shell(long("done", n), {
          latestTurn: turn(long("turn", n), "completed", minute(n)),
          updatedAt: minute(n),
        }),
      ),
      ...Array.from({ length: 30 }, (_, n) =>
        shell(long("asks", n), { hasPendingUserInput: true, updatedAt: minute(n) }),
      ),
    ]);
    const frame = JSON.stringify({ type: "attention", attention });
    expect({
      fits: linkFrameBytes(frame) <= MATE_LINK_FRAME_MAX,
      truncated: attention.truncated,
      newestResult: attention.results[0]?.threadId,
      newestQuestion: attention.questions[0]?.threadId,
      waiting: attention.waiting,
    }).toEqual({
      fits: true,
      truncated: true,
      newestResult: long("done", 29),
      newestQuestion: long("asks", 29),
      waiting: 30,
    });
  });
});
