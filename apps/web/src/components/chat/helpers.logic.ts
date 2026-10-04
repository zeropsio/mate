/**
 * A helper's own work, read off the thread: its steps — the calls the server
 * forwards tagged with it (`agentId`), or under its launch before its id is
 * known — as a run of its own, the record the Mate's run card draws; what it
 * does now, in the same words a step of the Mate's says; and the map of the
 * Mate's helpers and theirs.
 *
 * A driver that forwards no helper's calls (OpenCode, Antigravity, Grok,
 * Cursor; Claude and Codex before the server forwarded them) leaves a helper
 * with no steps: its card is its task, its progress and its report.
 */
import type { MessageId, OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";
import {
  isActiveSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";

import { deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows, type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { phraseWords, stepOf } from "./workSteps.logic";

export type HelperRecord = Extract<MessagesTimelineRow, { kind: "record" }>;

const STEP_KINDS: ReadonlySet<string> = new Set(["tool.started", "tool.updated", "tool.completed"]);

function payloadOf(activity: OrchestrationThreadActivity): Record<string, unknown> | null {
  return typeof activity.payload === "object" && activity.payload !== null
    ? (activity.payload as Record<string, unknown>)
    : null;
}

/** The turn a helper's own run is drawn as: its own, never one of the Mate's. */
export function helperTurnId(helper: Pick<RuntimeSubagent, "id">): TurnId {
  return `helper:${helper.id}` as TurnId;
}

/**
 * Its calls' rows, as rows of a run of its own: untagged, so the quiet
 * timeline keeps them, and in its own turn. A helper's call starts with all
 * of its input (the server reads it whole off the helper's snapshot), so its
 * start draws the step at once — a Mate's start draws nothing until its
 * input has streamed in.
 */
export function helperStepActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  helper: Pick<RuntimeSubagent, "id" | "toolUseId">,
): OrchestrationThreadActivity[] {
  const turnId = helperTurnId(helper);
  return activities.flatMap((activity) => {
    if (!STEP_KINDS.has(activity.kind)) return [];
    const payload = payloadOf(activity);
    if (payload === null) return [];
    const owner = payload.agentId;
    const mine =
      owner === helper.id ||
      (owner === undefined &&
        helper.toolUseId !== null &&
        payload.parentToolUseId === helper.toolUseId);
    if (!mine) return [];
    const { agentId: _agentId, parentToolUseId: _parent, ...own } = payload;
    return [
      {
        ...activity,
        kind: activity.kind === "tool.started" ? "tool.updated" : activity.kind,
        turnId,
        payload: own,
      } as OrchestrationThreadActivity,
    ];
  });
}

/**
 * Its run as the Mate's run card draws one: each call a step, the one in
 * flight on its now line, its clock from its start to its end. Null while it
 * has no steps — a driver that forwards none, or none yet.
 */
export function helperRecord(input: {
  readonly helper: RuntimeSubagent;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  /** The clock its last words wait against (`LAST_WORDS_GRACE_MS`). */
  readonly nowMs?: number;
}): HelperRecord | null {
  const { helper } = input;
  const steps = helperStepActivities(input.activities, helper);
  if (steps.length === 0) return null;
  const live = isActiveSubagentStatus(helper.status);
  const turnId = helperTurnId(helper);
  const startedAt = helper.startedAt ?? helper.firstSeenAt;
  // Its report is its last word, as the Mate's answer is its run's: a run
  // that ends on a step reads as cut off.
  const report = live ? null : (helper.result ?? helper.error);
  const endedAt = helper.completedAt ?? helper.updatedAt;
  const answer: ChatMessage[] =
    report === null
      ? []
      : [
          {
            id: `helper-report:${helper.id}` as MessageId,
            role: "assistant",
            text: report,
            turnId,
            streaming: false,
            createdAt: endedAt,
            updatedAt: endedAt,
          },
        ];
  const rows = deriveMessagesTimelineRows({
    timelineEntries: deriveTimelineEntries(answer, [], deriveWorkLogEntries(steps)),
    latestTurn: {
      turnId,
      state: live ? "running" : helper.status === "failed" ? "error" : "completed",
      startedAt,
      completedAt: helper.completedAt,
    },
    runningTurnId: live ? turnId : null,
    isWorking: live,
    activeTurnStartedAt: live ? startedAt : null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  const record = rows.find((row): row is HelperRecord => row.kind === "record") ?? null;
  if (record === null || record.status === null) return record;
  // Its clock is its own: from when it started to when it ended.
  return {
    ...record,
    id: `helper-record:${helper.id}`,
    turnKey: `helper:${helper.id}`,
    status: {
      ...record.status,
      startedAt,
      endedAt: live ? null : (helper.completedAt ?? record.status.endedAt),
    },
  };
}

/**
 * What it is doing this moment, as a step of the Mate's says it: its call in
 * flight, else what its driver says it does, else the tool in its hands.
 * Null once it settled.
 */
export function helperNowWords(helper: RuntimeSubagent): string | null {
  if (!isActiveSubagentStatus(helper.status)) return null;
  if (helper.liveCall !== null) {
    const [entry] = deriveWorkLogEntries(helperStepActivities([helper.liveCall], helper));
    if (entry !== undefined) {
      const step = stepOf(entry);
      const words = step.words ?? (step.phrase === null ? null : phraseWords(step.phrase));
      if (words !== null && words.trim().length > 0) return words;
      if (step.code !== null) return step.code;
    }
  }
  return helper.progress ?? helper.lastToolName;
}

/** Its report's first line, for a row that has room for one. */
export function helperReportLine(helper: RuntimeSubagent): string | null {
  const said = (helper.status === "failed" ? (helper.error ?? helper.result) : helper.result)
    ?.trim()
    .split("\n")
    .find((line) => line.trim().length > 0);
  return said === undefined ? null : said.replace(/^#+\s*/, "").trim();
}

export interface HelperMapRow {
  readonly helper: RuntimeSubagent;
  /** How far down the tree: 0 for a helper the Mate started. */
  readonly depth: number;
  /** The helpers it started, all of them, however deep. */
  readonly descendants: number;
}

/**
 * The Mate's helpers as a tree, flattened in reading order: each helper, then
 * the helpers it started under it, in the order they were first seen. A
 * helper whose parent is not among them stands at the top.
 */
export function helperMap(helpers: ReadonlyArray<RuntimeSubagent>): HelperMapRow[] {
  const ids = new Set(helpers.map((helper) => helper.id));
  const children = new Map<string | null, RuntimeSubagent[]>();
  for (const helper of helpers) {
    const parent =
      helper.spawnedBy !== null && ids.has(helper.spawnedBy) && helper.spawnedBy !== helper.id
        ? helper.spawnedBy
        : null;
    children.set(parent, [...(children.get(parent) ?? []), helper]);
  }
  const rows: HelperMapRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): number => {
    let count = 0;
    for (const helper of children.get(parent) ?? []) {
      // A loop in what the driver said is cut where it closes.
      if (seen.has(helper.id)) continue;
      seen.add(helper.id);
      const at = rows.length;
      rows.push({ helper, depth, descendants: 0 });
      const below = walk(helper.id, depth + 1);
      rows[at] = { helper, depth, descendants: below };
      count += 1 + below;
    }
    return count;
  };
  walk(null, 0);
  return rows;
}

/**
 * How many of its calls its record leaves out — a snapshot keeps a helper's
 * latest steps only — by its driver's own count; 0 where all are there, or
 * where it drew none (a driver that forwards none).
 */
export function helperCallsLeftOut(
  helper: RuntimeSubagent,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): number {
  const drawn = new Set(
    helperStepActivities(activities, helper).map((step) => payloadOf(step)?.toolCallId),
  ).size;
  const made = helper.usage?.toolUses ?? 0;
  return drawn === 0 ? 0 : Math.max(0, made - drawn);
}

/**
 * How long it has worked, by its driver's own count where it keeps one
 * (`usage.durationMs`): a row's start can be lost to the snapshot's window,
 * or stamped late, and its clock read seconds for an hour's work. Live, the
 * moment it started; settled, how long it ran.
 */
export function helperSpan(helper: RuntimeSubagent): {
  readonly since: string | null;
  readonly ranMs: number | null;
} {
  const counted = helper.usage?.durationMs;
  const startedAt = helper.startedAt ?? helper.firstSeenAt;
  if (isActiveSubagentStatus(helper.status)) {
    const byCount = counted === undefined ? null : Date.parse(helper.updatedAt) - counted;
    const byRow = Date.parse(startedAt);
    const since = byCount !== null && byCount < byRow ? byCount : byRow;
    return { since: Number.isFinite(since) ? new Date(since).toISOString() : null, ranMs: null };
  }
  const byRows =
    helper.completedAt === null ? null : Date.parse(helper.completedAt) - Date.parse(startedAt);
  const ranMs = Math.max(counted ?? 0, byRows ?? 0);
  return { since: null, ranMs: ranMs > 0 ? ranMs : null };
}
