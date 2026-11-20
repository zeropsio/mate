import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  MATE_ATTENTION_IDS_MAX,
  MateAttention,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { linkFrameBytes, MATE_LINK_FRAME_MAX } from "@t3tools/shared/mateLink";
import * as Schema from "effect/Schema";

import { mateAttentionOf } from "../zeropsAttentionValue.ts";

const decodeShell = Schema.decodeUnknownSync(OrchestrationThreadShell);
/** Every value here must be one the link and the client stream can send. */
const decodeAttention = Schema.decodeUnknownSync(MateAttention);

const SOURCE = { environmentId: EnvironmentId.make("env-1"), epoch: 1, incarnation: "boot-1" };

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

const minute = (index: number) => `2026-10-01T00:${String(index).padStart(2, "0")}:00Z`;

// witness: apps/server/src/zerops/zeropsAttentionValue.ts | thread.archivedAt === null && thread.crew === undefined; → thread.archivedAt === null;
it("HO29: The attention counts as working each of the person's chats whose turn runs or that monitors its work, and as waiting each that asks for an approval or an answer or whose turn failed; a turn refused under a usage pause waits and a turn admitted after it works; archived and crewmates' chats count for nothing", () => {
  const usagePause = {
    resetsAt: "2026-10-02T00:00:00Z",
    pausedAt: "2026-10-01T00:00:00Z",
    held: 0,
    window: "7-day",
    autoResume: false,
  };
  const rows: ReadonlyArray<readonly [ReadonlyArray<OrchestrationThreadShell>, number, number]> = [
    [[], 0, 0],
    [[shell("a", { latestTurn: turn("refused", "running"), usagePause })], 0, 1],
    [
      [
        shell("a", {
          latestTurn: { ...turn("admitted", "running"), startedAt: "2026-10-01T01:00:00Z" },
          usagePause,
        }),
      ],
      1,
      0,
    ],
    [
      [
        shell("a", { latestTurn: turn("t-a", "running") }),
        shell("b", { hasPendingApprovals: true }),
        shell("c", { hasPendingUserInput: true }),
        shell("d"),
      ],
      1,
      2,
    ],
    [
      [
        shell("a", { latestTurn: turn("t-a", "error", "2026-10-01T00:01:00Z") }),
        shell("b", { backgroundLiveness: "monitoring" }),
      ],
      1,
      1,
    ],
    [
      [
        shell("a", { latestTurn: turn("t-a", "running"), archivedAt: "2026-10-01T00:01:00Z" }),
        shell("b", { hasPendingApprovals: true, crew: CREWMATE }),
      ],
      0,
      0,
    ],
  ];
  for (const [threads, working, waiting] of rows) {
    const attention = attentionOf(threads);
    assert.deepStrictEqual([attention.working, attention.waiting], [working, waiting]);
  }
});

// witness: apps/server/src/zerops/zeropsAttentionValue.ts | .toSorted((left, right) => right.at - left.at) → .toSorted((left, right) => left.at - right.at)
it("HO30: The attention lists what waits on the person and the finished turns of resting chats, each newest first", () => {
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
  assert.deepStrictEqual(
    { results: attention.results, questions: attention.questions },
    {
      results: [
        { threadId: "newer-done", turnId: "t-2", completedAt: "2026-10-01T00:02:00Z" },
        { threadId: "older-done", turnId: "t-1", completedAt: "2026-10-01T00:01:00Z" },
      ],
      questions: [
        { threadId: "failed", kind: "failed", turnId: "t-5" },
        { threadId: "approves", kind: "approval", turnId: null },
        { threadId: "asks", kind: "input", turnId: "t-3" },
      ],
    },
  );
});

// witness: apps/server/src/zerops/zeropsAttentionValue.ts | lastThreadId: chats.at(-1)?.id ?? null, → lastThreadId: chats.at(0)?.id ?? null,
it("HO31: The attention's main chat is the one the person spoke to, and its last chat the last of the person's in the order the Mate learned of them, whatever time its creation is stamped with", () => {
  const none = attentionOf([]);
  assert.deepStrictEqual([none.mainThreadId, none.lastThreadId], [null, null]);

  const spoken = attentionOf([
    shell("spoken", { latestUserMessageAt: "2026-10-01T00:05:00Z" }),
    shell("newest", { createdAt: "2026-10-02T00:00:00Z" }),
    shell("crewmate", { createdAt: "2026-10-03T00:00:00Z", crew: CREWMATE }),
  ]);
  assert.deepStrictEqual([spoken.mainThreadId, spoken.lastThreadId], ["spoken", "newest"]);

  const stamped = attentionOf([
    shell("a", { createdAt: "2026-10-05T00:00:00Z" }),
    shell("b", { createdAt: "2026-10-01T00:00:00Z" }),
  ]);
  assert.strictEqual(stamped.lastThreadId, "b");
});

// witness: apps/server/src/zerops/zeropsAttentionValue.ts | truncated: results.length > MATE_ATTENTION_IDS_MAX || questions.length > MATE_ATTENTION_IDS_MAX, → truncated: results.length > MATE_ATTENTION_IDS_MAX,
it("HO32: Each attention list holds at most its bound of entries and the value is marked cut when either list is longer, while the waiting count counts every one", () => {
  const rows: ReadonlyArray<readonly [number, number, boolean]> = [
    [MATE_ATTENTION_IDS_MAX, 0, false],
    [MATE_ATTENTION_IDS_MAX + 1, 0, true],
    [0, MATE_ATTENTION_IDS_MAX + 2, true],
  ];
  for (const [done, asking, truncated] of rows) {
    const attention = attentionOf([
      ...Array.from({ length: done }, (_, index) =>
        shell(`done-${index}`, { latestTurn: turn(`t-${index}`, "completed", minute(index)) }),
      ),
      ...Array.from({ length: asking }, (_, index) =>
        shell(`asks-${index}`, { hasPendingUserInput: true, updatedAt: minute(index) }),
      ),
    ]);
    assert.deepStrictEqual(
      {
        results: attention.results.length,
        newestResult: attention.results[0]?.threadId,
        questions: attention.questions.length,
        waiting: attention.waiting,
        truncated: attention.truncated,
      },
      {
        results: Math.min(done, MATE_ATTENTION_IDS_MAX),
        newestResult: done === 0 ? undefined : `done-${done - 1}`,
        questions: Math.min(asking, MATE_ATTENTION_IDS_MAX),
        waiting: asking,
        truncated,
      },
    );
  }
});

// witness: apps/server/src/zerops/zeropsAttentionValue.ts | if (JSON.stringify(heldBody) === JSON.stringify(body)) return previous; → if (JSON.stringify(heldBody) !== JSON.stringify(body)) return previous;
it("HO33: An incarnation's attention starts at revision 0, keeps its revision while nothing the attention carries changed, and raises it by one when anything did", () => {
  assert.deepStrictEqual(attentionOf([]).source, { ...SOURCE, revision: 0 });

  const before = [shell("a", { latestTurn: turn("t-a", "running") })];
  const first = mateAttentionOf(before, undefined, SOURCE);
  const previous = { ...first, source: { ...first.source, revision: 4 } };
  const rows: ReadonlyArray<readonly [ReadonlyArray<OrchestrationThreadShell>, number]> = [
    [before, 4],
    [[shell("a", { latestTurn: turn("t-a", "running"), title: "renamed" })], 4],
    [[...before, shell("b", { createdAt: "2026-10-02T00:00:00Z" })], 5],
    [[shell("a", { latestTurn: turn("t-a", "completed", "2026-10-01T00:01:00Z") })], 5],
  ];
  for (const [after, revision] of rows) {
    assert.deepStrictEqual(mateAttentionOf(after, previous, SOURCE).source, {
      ...SOURCE,
      revision,
    });
  }
});

// witness: apps/server/src/zerops/zeropsAttentionValue.ts | ? { ...candidate, results: candidate.results.slice(0, -1), truncated: true } → ? { ...candidate, results: candidate.results.slice(1), truncated: true }
it("HO34: An attention over one frame of the link drops the oldest entries of its longer list, marked cut, until it fits", () => {
  const long = (prefix: string, n: number) => `${prefix}-${n}-${"x".repeat(1_500)}`;
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
  assert.deepStrictEqual(
    {
      fits: linkFrameBytes(frame) <= MATE_LINK_FRAME_MAX,
      truncated: attention.truncated,
      newestResult: attention.results[0]?.threadId,
      newestQuestion: attention.questions[0]?.threadId,
      waiting: attention.waiting,
    },
    {
      fits: true,
      truncated: true,
      newestResult: long("done", 29),
      newestQuestion: long("asks", 29),
      waiting: 30,
    },
  );
});

// witness: apps/server/src/zerops/zeropsAttentionValue.ts | ...(thread.session?.interruption?.continuation === "manual" → ...(thread.session?.interruption?.continuation === "requested"
it("HO35: A chat a restart cut that waits on the person to continue it waits as failed with the interruption on its cut turn, an answer it asks keeps the interruption, a changed interruption raises the revision, and continuing clears it", () => {
  const interruption = {
    turnId: "cut-turn",
    restart: { cause: "replaced", at: "2026-10-08T08:24:39.700Z" },
    continuation: "manual",
  };
  const session = {
    threadId: "eddy",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: "2026-10-08T08:25:00Z",
  };
  const stopped = shell("eddy", {
    latestTurn: turn("cut-turn", "interrupted", session.updatedAt),
    session: { ...session, status: "interrupted", interruption },
  });
  const attention = attentionOf([stopped]);
  assert.strictEqual(attention.waiting, 1);
  assert.deepStrictEqual<unknown>(attention.questions, [
    { threadId: stopped.id, turnId: "cut-turn", kind: "failed", interruption },
  ]);
  const ready = attentionOf([
    shell("eddy", { ...stopped, session: { ...stopped.session, status: "ready" } }),
  ]);
  assert.deepStrictEqual(ready.questions, attention.questions);
  const needsAnswer = attentionOf([shell("eddy", { ...stopped, hasPendingUserInput: true })]);
  assert.deepStrictEqual(
    [needsAnswer.questions[0]?.kind, needsAnswer.questions[0]?.interruption],
    ["input", interruption],
  );

  const changed = mateAttentionOf(
    [
      shell("eddy", {
        ...stopped,
        session: {
          ...stopped.session,
          interruption: {
            ...interruption,
            restart: { ...interruption.restart, cause: "restarted" },
          },
        },
      }),
    ],
    attention,
    SOURCE,
  );
  assert.strictEqual(changed.source.revision, attention.source.revision + 1);
  const continued = mateAttentionOf(
    [shell("eddy", { ...stopped, session: { ...session, status: "ready", interruption: null } })],
    changed,
    SOURCE,
  );
  assert.deepStrictEqual(
    [continued.waiting, continued.questions, continued.source.revision],
    [0, [], changed.source.revision + 1],
  );
  assert.strictEqual(
    attentionOf([shell("idle", { session: { ...session, status: "ready" } })]).waiting,
    0,
  );
});
