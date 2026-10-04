/**
 * The fields a thread snapshot's budgets key on, written beside an activity's
 * payload when it is stored, so a snapshot reads them off an index instead of
 * parsing payloads (a call's completion carries its whole result).
 *
 * - `agentId`: a helper's step — a tool row its agent made.
 * - `callId`: the call a tool row belongs to; a completion supersedes its
 *   in-flight updates.
 * - `taskId`: the task a task row belongs to; its later progress supersedes
 *   the earlier.
 * - `usedTokens`: a context reading the meter can resolve; a later one
 *   supersedes it.
 */
export interface ActivityBudgetColumns {
  readonly agentId: string | null;
  readonly callId: string | null;
  readonly taskId: string | null;
  readonly usedTokens: number | null;
}

const TOOL_KINDS = new Set(["tool.started", "tool.updated", "tool.completed"]);
const TASK_KINDS = new Set(["task.started", "task.progress", "task.updated", "task.completed"]);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export function activityBudgetColumns(kind: string, payload: unknown): ActivityBudgetColumns {
  const record = asRecord(payload);
  const isTool = TOOL_KINDS.has(kind);
  const usedTokens = kind === "context-window.updated" ? record?.usedTokens : undefined;
  return {
    agentId: isTool ? asId(record?.agentId) : null,
    callId: isTool ? (asId(record?.toolCallId) ?? asId(asRecord(record?.data)?.toolCallId)) : null,
    taskId: TASK_KINDS.has(kind) ? asId(record?.taskId) : null,
    usedTokens:
      typeof usedTokens === "number" && Number.isFinite(usedTokens) && usedTokens >= 0
        ? usedTokens
        : null,
  };
}
