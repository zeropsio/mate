import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadPageState } from "./threadState.ts";
import { mergeFirstPageSnapshot } from "./threadSnapshotMerge.ts";

// Turns an hour apart: turn-1 at 01:00, turn-2 at 02:00, … Each has a user
// message (turnless, at the hour), a reply and a step.
const at = (hour: number, minute = 0) =>
  `2026-04-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

const userMessage = (turn: number): OrchestrationMessage => ({
  id: `ask-${turn}` as OrchestrationMessage["id"],
  role: "user",
  text: "ask",
  turnId: null,
  streaming: false,
  createdAt: at(turn),
  updatedAt: at(turn),
});
const reply = (turn: number): OrchestrationMessage => ({
  id: `reply-${turn}` as OrchestrationMessage["id"],
  role: "assistant",
  text: "reply",
  turnId: TurnId.make(`turn-${turn}`),
  streaming: false,
  createdAt: at(turn, 30),
  updatedAt: at(turn, 30),
});
let sequence = 0;
const step = (turn: number, id = `step-${turn}`): OrchestrationThreadActivity => ({
  id: id as OrchestrationThreadActivity["id"],
  tone: "tool",
  kind: "tool.completed",
  summary: "ran",
  payload: {},
  turnId: TurnId.make(`turn-${turn}`),
  sequence: turn * 10 + (sequence++ % 5),
  createdAt: at(turn, 10),
});
const checkpoint = (turn: number): OrchestrationThread["checkpoints"][number] => ({
  turnId: TurnId.make(`turn-${turn}`),
  checkpointTurnCount: turn,
  checkpointRef: `ref-${turn}` as OrchestrationThread["checkpoints"][number]["checkpointRef"],
  status: "ready",
  files: [],
  assistantMessageId: null,
  completedAt: at(turn, 50),
});

const thread = (turns: ReadonlyArray<number>, checkpoints: ReadonlyArray<number> = []) =>
  ({
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Long thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: at(1),
    updatedAt: at(1),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: turns.flatMap((turn) => [userMessage(turn), reply(turn)]),
    proposedPlans: [],
    activities: turns.map((turn) => step(turn)),
    checkpoints: checkpoints.map(checkpoint),
    session: null,
  }) satisfies OrchestrationThread;

// The turn's reply still streaming: the turn was running when the client
// last heard of it.
const running = (value: OrchestrationThread, turn: number): OrchestrationThread => ({
  ...value,
  messages: value.messages.map((entry) =>
    entry.id === `reply-${turn}` ? { ...entry, streaming: true } : entry,
  ),
});

const page = (beforeCursor: string | null): EnvironmentThreadPageState => ({
  beforeCursor,
  hasMore: beforeCursor !== null,
  loadingOlder: false,
});

const snapshotOf = (
  value: OrchestrationThread,
  cursor: string | null | undefined,
): OrchestrationThreadDetailSnapshot => ({
  snapshotSequence: 100,
  thread: value,
  ...(cursor === undefined
    ? {}
    : { page: { beforeCursor: cursor, hasMore: cursor !== null, snapshotSequence: 100 } }),
});

const turnsOf = (value: OrchestrationThread) =>
  value.messages.filter((entry) => entry.role === "user").map((entry) => entry.id);

describe("mergeFirstPageSnapshot", () => {
  it.each([
    {
      name: "keeps the older turns it holds below a fresh first page",
      held: thread([1, 2, 3, 4, 5, 6]),
      heldPage: page("before-1"),
      snapshot: snapshotOf(thread([4, 5, 6, 7]), "before-4"),
      turns: ["ask-1", "ask-2", "ask-3", "ask-4", "ask-5", "ask-6", "ask-7"],
      cursor: "before-1",
    },
    {
      name: "takes the page whole when it holds nothing older",
      held: thread([5, 6]),
      heldPage: page("before-5"),
      snapshot: snapshotOf(thread([4, 5, 6, 7]), "before-4"),
      turns: ["ask-4", "ask-5", "ask-6", "ask-7"],
      cursor: "before-4",
    },
    {
      name: "takes the page whole when it reaches the start",
      held: thread([1, 2, 3, 4]),
      heldPage: page(null),
      snapshot: snapshotOf(thread([1, 2, 3, 4, 5]), null),
      turns: ["ask-1", "ask-2", "ask-3", "ask-4", "ask-5"],
      cursor: null,
    },
    {
      name: "takes a read that doesn't page whole",
      held: thread([1, 2, 3, 4]),
      heldPage: page("before-1"),
      snapshot: snapshotOf(thread([3, 4, 5]), undefined),
      turns: ["ask-3", "ask-4", "ask-5"],
      cursor: undefined,
    },
    {
      name: "drops what it holds when a turn it held was reverted",
      held: thread([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]),
      heldPage: page("before-1"),
      snapshot: snapshotOf(thread([3], [1, 2, 3]), "before-3"),
      turns: ["ask-3"],
      cursor: "before-3",
    },
    {
      name: "keeps what it holds when the checkpoints still stand",
      held: thread([1, 2, 3, 4], [1, 2, 3, 4]),
      heldPage: page("before-1"),
      snapshot: snapshotOf(thread([3, 4, 5], [1, 2, 3, 4, 5]), "before-3"),
      turns: ["ask-1", "ask-2", "ask-3", "ask-4", "ask-5"],
      cursor: "before-1",
    },
    {
      name: "drops what it holds when it doesn't reach the page",
      held: running(thread([1, 2, 3, 4]), 4),
      heldPage: page("before-1"),
      snapshot: snapshotOf(thread([6]), "before-6"),
      turns: ["ask-6"],
      cursor: "before-6",
    },
    {
      name: "keeps a turn that was running when the page has it, settled",
      held: running(thread([1, 2, 3, 4]), 4),
      heldPage: page("before-1"),
      snapshot: snapshotOf(thread([4, 5]), "before-4"),
      turns: ["ask-1", "ask-2", "ask-3", "ask-4", "ask-5"],
      cursor: "before-1",
    },
    {
      name: "drops what it holds when a turn below the page was still running",
      held: running(thread([1, 2, 3, 4]), 3),
      heldPage: page("before-1"),
      snapshot: snapshotOf(thread([4, 5]), "before-4"),
      turns: ["ask-4", "ask-5"],
      cursor: "before-4",
    },
    {
      name: "drops what it holds when its latest turn below the page was running",
      held: {
        ...thread([1, 2, 3, 4]),
        latestTurn: {
          turnId: TurnId.make("turn-3"),
          state: "running" as const,
          requestedAt: at(3),
          startedAt: at(3),
          completedAt: null,
          assistantMessageId: null,
        },
      },
      heldPage: page("before-1"),
      snapshot: snapshotOf(thread([4, 5]), "before-4"),
      turns: ["ask-4", "ask-5"],
      cursor: "before-4",
    },
  ])("$name", ({ held, heldPage, snapshot, turns, cursor }) => {
    const merged = mergeFirstPageSnapshot({ held, heldPage, snapshot });
    expect(turnsOf(merged.thread)).toEqual(turns);
    expect(merged.page === null ? undefined : merged.page.beforeCursor).toBe(cursor);
  });

  it("holds an older turn's rows once, the page's as the page has them", () => {
    const held = thread([1, 2, 3]);
    // The page's turn-3 lost a superseded row the client held.
    const heldWithExtra = {
      ...held,
      activities: [...held.activities, step(3, "superseded-3")],
    };
    const fresh = thread([3, 4]);
    const merged = mergeFirstPageSnapshot({
      held: heldWithExtra,
      heldPage: page("before-1"),
      snapshot: snapshotOf(fresh, "before-3"),
    });
    expect(merged.thread.activities.map((entry) => entry.id)).toEqual([
      "step-1",
      "step-2",
      "step-3",
      "step-4",
    ]);
    expect(merged.thread.messages.map((entry) => entry.id)).toEqual([
      "ask-1",
      "reply-1",
      "ask-2",
      "reply-2",
      "ask-3",
      "reply-3",
      "ask-4",
      "reply-4",
    ]);
    // Everything else is the snapshot's.
    expect({ ...merged.thread, messages: [], activities: [] }).toEqual({
      ...fresh,
      messages: [],
      activities: [],
    });
  });

  it("keeps a whole older turn whose helper start the page pins", () => {
    const held = thread([1, 2, 3, 4, 5]);
    const helperStart = { ...step(2, "helper-start-2"), kind: "task.started" as const };
    const heldWithHelper = { ...held, activities: [...held.activities, helperStart] };
    const fresh = thread([5, 6]);
    const merged = mergeFirstPageSnapshot({
      held: heldWithHelper,
      heldPage: page("before-1"),
      snapshot: snapshotOf(
        { ...fresh, activities: [helperStart, ...fresh.activities] },
        "before-5",
      ),
    });
    expect(merged.thread.messages.map((entry) => entry.id)).toEqual(
      [1, 2, 3, 4, 5, 6].flatMap((turn) => [`ask-${turn}`, `reply-${turn}`]),
    );
    expect(merged.thread.activities.map((entry) => entry.id).toSorted()).toEqual(
      ["helper-start-2", "step-1", "step-2", "step-3", "step-4", "step-5", "step-6"].toSorted(),
    );
  });

  it("keeps a held older row the page pins only once, in the record's order", () => {
    const held = thread([1, 2, 3]);
    const pinned = held.activities[0]!;
    const fresh = thread([3]);
    const merged = mergeFirstPageSnapshot({
      held,
      heldPage: page("before-1"),
      snapshot: snapshotOf({ ...fresh, activities: [pinned, ...fresh.activities] }, "before-3"),
    });
    expect(merged.thread.activities.map((entry) => entry.id)).toEqual([
      "step-1",
      "step-2",
      "step-3",
    ]);
    expect(merged.thread.messages.map((entry) => entry.id)).toEqual(
      [1, 2, 3].flatMap((turn) => [`ask-${turn}`, `reply-${turn}`]),
    );
  });
});
