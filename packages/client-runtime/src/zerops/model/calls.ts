/**
 * `collectZeropsCalls` — the call ledger. A Zerops call is a SET of activity
 * rows joined by `toolCallId`; every derived fact is a lattice over that set
 * (min for time, richest for information, terminal-wins for status, carried
 * forward for text) so the result cannot depend on which rows a route
 * delivered or in what order. See `mate-session-model-2026-09-05.md` §2.3
 * R1–R3, R10 and `C-client-domain.md` §1.3.
 *
 * Pure and deterministic: same activities in, same calls out. No clock —
 * `runningTurnId` is the caller's own reading of "now".
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { readRecord, readString } from "../cards/decode.ts";
import { compareCallRows } from "./order.ts";
import { normalizedToolName } from "./partition.ts";
import type { ZeropsCall, ZeropsCallStatus } from "./types.ts";

const TOOL_ACTIVITY_KINDS: ReadonlySet<string> = new Set([
  "tool.started",
  "tool.updated",
  "tool.completed",
]);

type RawRowStatus = "inProgress" | "completed" | "failed" | "declined" | "stopped";

const RAW_ROW_STATUSES: ReadonlySet<string> = new Set([
  "inProgress",
  "completed",
  "failed",
  "declined",
  "stopped",
]);

const isNonEmptyObject = (value: unknown): value is Record<string, unknown> => {
  const record = readRecord(value);
  return record !== undefined && Object.keys(record).length > 0;
};

/** Claude's own raw tool result text: a string `content`, or the first text block of an SDK content array. */
function extractRawResultText(result: unknown): string | undefined {
  const record = readRecord(result);
  if (record === undefined) {
    return undefined;
  }
  const content = record.content;
  if (typeof content === "string") {
    return readString(content);
  }
  if (Array.isArray(content)) {
    const block = content.find((entry): entry is { text: string } => {
      const entryRecord = readRecord(entry);
      return (
        entryRecord !== undefined &&
        entryRecord.type === "text" &&
        typeof entryRecord.text === "string"
      );
    });
    return block !== undefined ? readString(block.text) : undefined;
  }
  return undefined;
}

/** Whether `text` parses as a JSON *object* — never coerces an array/string/number. */
function isJsonObjectText(text: string): boolean {
  try {
    return readRecord(JSON.parse(text)) !== undefined;
  } catch {
    return false;
  }
}

interface Row {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly turnId: string | null;
  readonly payload: Record<string, unknown>;
}

interface CallGroup {
  /** `toolCallId`, or the anon group's own key (`anon:<activityId>`). */
  readonly id: string;
  readonly toolCallId: string | undefined;
  readonly rows: Row[];
}

function rowStatus(row: Row): RawRowStatus | undefined {
  const raw = row.payload.status;
  if (typeof raw === "string" && RAW_ROW_STATUSES.has(raw)) {
    return raw as RawRowStatus;
  }
  // A malformed or missing `status` on a completed row is still a completion —
  // never left dangling as `inProgress` forever.
  return row.kind === "tool.completed" ? "completed" : undefined;
}

function readZeropsResultText(payload: Record<string, unknown>): string | undefined {
  const data = readRecord(payload.data);
  const zerops = data !== undefined ? readRecord(data.zerops) : undefined;
  return zerops !== undefined ? readString(zerops.resultText) : undefined;
}

function readZeropsTruncated(payload: Record<string, unknown>): boolean {
  const data = readRecord(payload.data);
  const zerops = data !== undefined ? readRecord(data.zerops) : undefined;
  return zerops?.truncated === true;
}

function firstNonNullTurnId(rows: ReadonlyArray<Row>): string | null {
  for (const row of rows) {
    if (row.turnId !== null) {
      return row.turnId;
    }
  }
  return null;
}

function isZeropsName(name: string | undefined): name is string {
  return name !== undefined && name.startsWith("zerops_");
}

/**
 * Every `zerops_*` call in `activities`, in first-observed order (the caller
 * sorts by `compareAnchors` for presentation). A row without a `toolCallId`
 * is its own call (§2.3 R1) — decided from its own name alone, never joined.
 */
export function collectZeropsCalls(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  runningTurnId: string | null,
): ZeropsCall[] {
  const order: string[] = [];
  const groups = new Map<string, CallGroup>();

  for (const activity of activities) {
    if (!TOOL_ACTIVITY_KINDS.has(activity.kind)) {
      continue;
    }
    const payload = readRecord(activity.payload);
    if (payload === undefined) {
      continue;
    }
    const toolCallId = readString(payload.toolCallId);
    const row: Row = {
      id: activity.id,
      kind: activity.kind,
      createdAt: activity.createdAt,
      turnId: activity.turnId,
      payload,
    };

    if (toolCallId === undefined) {
      if (isZeropsName(normalizedToolName(payload))) {
        const key = `anon:${activity.id}`;
        groups.set(key, { id: key, toolCallId: undefined, rows: [row] });
        order.push(key);
      }
      continue;
    }

    let group = groups.get(toolCallId);
    if (group === undefined) {
      group = { id: toolCallId, toolCallId, rows: [] };
      groups.set(toolCallId, group);
      order.push(toolCallId);
    }
    group.rows.push(row);
  }

  const calls: ZeropsCall[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    const isZerops =
      group.toolCallId === undefined ||
      group.rows.some((row) => isZeropsName(normalizedToolName(row.payload)));
    if (!isZerops) {
      continue;
    }
    calls.push(buildCall(group, runningTurnId));
  }
  return calls;
}

function buildCall(group: CallGroup, runningTurnId: string | null): ZeropsCall {
  const rows = [...group.rows].sort(compareCallRows);
  const first = rows[0]!;

  let toolName = "";
  for (const row of rows) {
    const name = normalizedToolName(row.payload);
    if (name !== undefined) {
      toolName = name;
    }
  }

  let input: Record<string, unknown> = {};
  for (const row of rows) {
    const data = readRecord(row.payload.data);
    const candidate = data?.input;
    if (isNonEmptyObject(candidate)) {
      input = candidate;
    }
  }

  const agentInternal = rows.some((row) => readString(row.payload.agentId) !== undefined);

  const completedRows = rows.filter((row) => row.kind === "tool.completed");
  let baseStatus: ZeropsCallStatus = "inProgress";
  let settledRow: Row | undefined;
  if (completedRows.length > 0) {
    const failedCompleted = completedRows.find((row) => rowStatus(row) === "failed");
    const winner = failedCompleted ?? completedRows[completedRows.length - 1]!;
    baseStatus = rowStatus(winner) ?? "completed";
    settledRow = winner;
  } else {
    const terminalRow = rows.find((row) => {
      const status = rowStatus(row);
      return status === "failed" || status === "declined" || status === "stopped";
    });
    if (terminalRow !== undefined) {
      baseStatus = rowStatus(terminalRow)!;
      settledRow = terminalRow;
    }
  }

  const turnId = firstNonNullTurnId(rows);
  const status: ZeropsCallStatus =
    baseStatus === "inProgress" && (runningTurnId === null || turnId !== runningTurnId)
      ? "interrupted"
      : baseStatus;

  let resultText: string | undefined =
    settledRow !== undefined ? readZeropsResultText(settledRow.payload) : undefined;
  if (resultText === undefined) {
    for (const row of rows) {
      const text = readZeropsResultText(row.payload);
      if (text !== undefined) {
        resultText = text;
      }
    }
  }
  if (resultText === undefined) {
    for (const row of rows) {
      const data = readRecord(row.payload.data);
      const raw = data !== undefined ? extractRawResultText(data.result) : undefined;
      if (raw !== undefined && isJsonObjectText(raw)) {
        resultText = raw;
      }
    }
  }

  const truncated =
    resultText === undefined && rows.some((row) => readZeropsTruncated(row.payload));

  return {
    id: group.toolCallId ?? group.id,
    turnId,
    toolName,
    input,
    status,
    ...(resultText !== undefined ? { resultText } : {}),
    truncated,
    startedAt: first.createdAt,
    anchorActivityId: first.id,
    ...(settledRow !== undefined ? { settledAt: settledRow.createdAt } : {}),
    rowIds: new Set(rows.map((row) => row.id)),
    agentInternal,
  };
}
