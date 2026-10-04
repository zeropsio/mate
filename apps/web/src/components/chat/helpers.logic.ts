/**
 * A helper's own work, read off the thread: its steps — the calls the server
 * forwards tagged with it (`agentId`: its task, or its launch before its task
 * is known) — as a run of its own, the record the Mate's run card draws; what it
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
    // Tagged with it: by its task, or by its launch while the server did not
    // know its task yet. An untagged row is the Mate's, drawn there.
    const owner = payload.agentId;
    const mine = owner !== undefined && (owner === helper.id || owner === helper.toolUseId);
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
  // A parent is named by its task, or by its launch where the server did not
  // know its task yet.
  const byName = new Map<string, string>();
  for (const helper of helpers) {
    if (helper.toolUseId !== null) byName.set(helper.toolUseId, helper.id);
  }
  for (const helper of helpers) byName.set(helper.id, helper.id);
  const children = new Map<string | null, RuntimeSubagent[]>();
  for (const helper of helpers) {
    const named = helper.spawnedBy === null ? undefined : byName.get(helper.spawnedBy);
    const parent = named !== undefined && named !== helper.id ? named : null;
    children.set(parent, [...(children.get(parent) ?? []), helper]);
  }
  const rows: HelperMapRow[] = [];
  const seen = new Set<string>();
  const walk = (helper: RuntimeSubagent, depth: number): number => {
    seen.add(helper.id);
    const at = rows.length;
    rows.push({ helper, depth, descendants: 0 });
    let below = 0;
    for (const child of children.get(helper.id) ?? []) {
      // A loop in what the driver said is cut where it closes.
      if (!seen.has(child.id)) below += 1 + walk(child, depth + 1);
    }
    rows[at] = { helper, depth, descendants: below };
    return below;
  };
  for (const root of children.get(null) ?? []) walk(root, 0);
  // Helpers in a loop have no root: each loop stands at the top from its
  // first-seen helper, never left out.
  for (const helper of helpers) if (!seen.has(helper.id)) walk(helper, 0);
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

const EFFORT_WORDS: Readonly<Record<string, string>> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/**
 * What it ran on, as the composer names a model: "Opus 5.5 · Max", never the
 * slug ("claude-opus-5-5"). A name it does not know stays as the driver said.
 */
export function helperModelWords(model: string | null, effort: string | null): string | null {
  if (model === null) return null;
  const slug = model
    .trim()
    .replace(/\[[^\]]*\]$/u, "")
    .replace(/-\d{8}$/u, "")
    .replace(/-latest$/u, "");
  const claude = /^(?:claude-)?(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?$/u.exec(slug);
  const gpt = /^gpt-(.+)$/u.exec(slug);
  const name =
    claude !== null
      ? `${claude[1]!.charAt(0).toUpperCase()}${claude[1]!.slice(1)} ${claude[2]}${claude[3] === undefined ? "" : `.${claude[3]}`}`
      : gpt !== null
        ? `GPT-${gpt[1]!.replace(/-codex$/u, " Codex")}`
        : model.trim();
  const level =
    effort === null ? null : (EFFORT_WORDS[effort.trim().toLowerCase()] ?? effort.trim());
  return level === null || level.length === 0 ? name : `${name} · ${level}`;
}
