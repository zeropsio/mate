/**
 * Real threads replayed as they arrived, an activity at a time, through the
 * chain the conversation page runs on every update — the Zerops model, the
 * work log, the plans, the timeline's entries, its rows — each step keeping
 * what the last one built. At every step the result must be what the chain
 * builds from scratch, from copies nothing was kept for; and a row that holds
 * what it held a step before must be the same object.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";
import { ZEROPS_SHOWCASE_THREADS } from "@t3tools/client-runtime/zerops/operations/fixtures";
import { describe, expect, it } from "vite-plus/test";

import { sameValue } from "../../lib/sameValue";
import {
  deriveTimelineEntriesWithState,
  deriveTurnPlans,
  deriveWorkLogEntries,
  type TimelineEntriesProjection,
} from "../../session-logic";
import type { ChatMessage } from "../../types";
import {
  createMessagesTimelineRowsCache,
  deriveMessagesTimelineRows,
  type MessagesTimelineRowsCache,
} from "./MessagesTimeline.logic";

interface Frame {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly runningTurnId: string | null;
}

/** The thread as it stood after each activity, its words streaming in between. */
function replay(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  messages: ReadonlyArray<ChatMessage>,
): Frame[] {
  const frames: Frame[] = [];
  for (let count = 1; count <= activities.length; count += 1) {
    const shown = activities.slice(0, count);
    const now = shown.at(-1)!.createdAt;
    const said = messages.filter((message) => message.createdAt <= now);
    const runningTurnId = count === activities.length ? null : (shown.at(-1)!.turnId ?? null);
    const last = said.at(-1);
    if (last !== undefined && last.role === "assistant" && runningTurnId !== null) {
      // Its words still coming: half of them, streaming, then all.
      const half = { ...last, text: last.text.slice(0, last.text.length / 2), streaming: true };
      frames.push({ activities: shown, messages: [...said.slice(0, -1), half], runningTurnId });
    }
    frames.push({ activities: shown, messages: said, runningTurnId });
  }
  return frames;
}

interface Derived {
  readonly projection: TimelineEntriesProjection;
  readonly work: ReturnType<typeof deriveWorkLogEntries>;
  readonly rows: ReturnType<typeof deriveMessagesTimelineRows>;
}

function derive(
  frame: Frame,
  previous: TimelineEntriesProjection | null,
  cache?: MessagesTimelineRowsCache,
): Derived {
  const model = deriveZeropsThreadModel({
    activities: frame.activities,
    runningTurnId: frame.runningTurnId,
  });
  const work = deriveWorkLogEntries(frame.activities, { exclude: model.zeropsActivityIds });
  const projection = deriveTimelineEntriesWithState(
    frame.messages,
    [],
    work,
    previous,
    deriveTurnPlans(frame.activities),
    model.entries,
    [],
  );
  const running = frame.runningTurnId;
  const rows = deriveMessagesTimelineRows({
    timelineEntries: projection.entries,
    latestTurn:
      running === null
        ? null
        : {
            turnId: running as never,
            state: "running",
            startedAt: frame.activities[0]!.createdAt,
            completedAt: null,
          },
    runningTurnId: running as never,
    isWorking: running !== null,
    activeTurnStartedAt: running === null ? null : frame.activities[0]!.createdAt,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    provider: "claudeAgent",
    nowMs: Date.parse(frame.activities.at(-1)!.createdAt) + 60_000,
    ...(cache === undefined ? {} : { cache }),
  });
  return { projection, work, rows };
}

/** The call, task or activity a new activity reports on: what a row built from it may be. */
function reportsOn(activity: OrchestrationThreadActivity): ReadonlySet<string> {
  const payload = (activity.payload ?? {}) as Record<string, unknown>;
  return new Set(
    [activity.id, payload.toolCallId, payload.taskId, payload.toolUseId].filter(
      (value): value is string => typeof value === "string",
    ),
  );
}

/** What a row is built from, by the ids `reportsOn` names. */
function builtFrom(item: object): ReadonlyArray<unknown> {
  const work = "kind" in item && "entry" in item ? (item.entry as object) : item;
  const operation = "operation" in item ? (item.operation as Record<string, unknown>) : null;
  const fields = work as Record<string, unknown>;
  return [
    fields.id,
    fields.toolCallId,
    fields.taskId,
    ...((operation?.callIds as ReadonlyArray<string> | undefined) ?? []),
    ...(((fields.agentSpawn as { agentTaskIds?: ReadonlyArray<string> } | undefined)
      ?.agentTaskIds ?? []) as ReadonlyArray<string>),
  ];
}

/**
 * Each of `next` that holds what the one of its id in `previous` held, and
 * that the newest activity does not report on, is that one.
 */
function keptAlike<T extends { readonly id: string }>(
  previous: ReadonlyArray<T>,
  next: ReadonlyArray<T>,
  newest: OrchestrationThreadActivity,
): void {
  const touched = reportsOn(newest);
  const before = new Map(previous.map((item) => [item.id, item] as const));
  for (const item of next) {
    const earlier = before.get(item.id);
    if (earlier === undefined || !sameValue(earlier, item)) continue;
    if (builtFrom(item).some((id) => typeof id === "string" && touched.has(id))) continue;
    expect(item).toBe(earlier);
  }
}

describe("a real thread replayed an activity at a time", () => {
  it.each(ZEROPS_SHOWCASE_THREADS.map((thread) => ({ name: thread.name, thread })))(
    "builds what a first derive builds, and keeps what did not change: $name",
    ({ thread }) => {
      const frames = replay(thread.activities, thread.messages as ReadonlyArray<ChatMessage>);
      const cache = createMessagesTimelineRowsCache();
      let previous: Derived | null = null;
      for (const frame of frames) {
        const next = derive(frame, previous?.projection ?? null, cache);
        const scratch = derive(structuredClone(frame), null);
        expect(next.projection.entries).toStrictEqual(scratch.projection.entries);
        expect(next.rows).toStrictEqual(scratch.rows);
        if (previous !== null) {
          const newest = frame.activities.at(-1)!;
          keptAlike(previous.work, next.work, newest);
          keptAlike(previous.projection.entries, next.projection.entries, newest);
        }
        previous = next;
      }
    },
  );

  it("hands on the same entries when nothing the conversation shows changed", () => {
    const thread = ZEROPS_SHOWCASE_THREADS[0]!;
    const frame = replay(thread.activities, thread.messages as ReadonlyArray<ChatMessage>).at(-1)!;
    const first = derive(frame, null);
    // A fresh Zerops model and a new activity the work log does not draw.
    const contextWindow: OrchestrationThreadActivity = {
      ...frame.activities.at(-1)!,
      id: "context-window-update" as never,
      kind: "context-window.updated",
      summary: "Context window updated",
      payload: { usedTokens: 1000 },
    };
    const again = derive(
      { ...frame, activities: [...frame.activities, contextWindow] },
      first.projection,
    );
    expect(again.projection.entries).toBe(first.projection.entries);
  });
});
