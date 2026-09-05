/**
 * Which activity rows belong to a `zerops_*` call — the ONE tool-name gate and
 * normalisation. Gate on the NAME, never `itemType` (MF-3): `itemType` names
 * how a provider transports a call, not what the call is.
 *
 * A row is grouped by `payload.toolCallId` for membership purposes only (a
 * `tool.updated` row often carries no name at all, `data: {}`, once its
 * sibling `tool.started` / `tool.completed` already named the call) — the
 * full lattice fold over those rows is `calls.ts`'s job.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

const TOOL_ACTIVITY_KINDS: ReadonlySet<string> = new Set([
  "tool.started",
  "tool.updated",
  "tool.completed",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** `mcp__zerops__zerops_deploy` → `zerops_deploy`; a non-MCP name is unchanged. */
function stripMcpPrefix(toolName: string): string {
  return toolName.replace(/^mcp__[^_]+__/, "");
}

/**
 * The one normalisation: `data.zerops.toolName` ?? strip `mcp__<server>__`
 * off `data.toolName` ?? `data.item.tool` (the ACP driver shape). Undefined
 * when the row carries no name at all.
 */
export function normalizedToolName(payload: Record<string, unknown>): string | undefined {
  const data = readRecord(payload.data);
  if (data === undefined) {
    return undefined;
  }
  const zerops = readRecord(data.zerops);
  const zeropsName = zerops !== undefined ? readString(zerops.toolName) : undefined;
  if (zeropsName !== undefined) {
    return zeropsName;
  }
  const plainName = readString(data.toolName);
  if (plainName !== undefined) {
    return stripMcpPrefix(plainName);
  }
  const item = readRecord(data.item);
  return item !== undefined ? readString(item.tool) : undefined;
}

export interface ZeropsPartition {
  /** Every activity id that belongs to a Zerops call — the transcript never sees these rows. */
  readonly zeropsActivityIds: ReadonlySet<string>;
}

/**
 * A `tool.*` row without a `toolCallId` is its own call (§2.3 R1) — its
 * membership is decided from its own name alone, never joined to a group.
 */
export function partitionZeropsActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ZeropsPartition {
  const rowIdsByToolCallId = new Map<string, string[]>();
  const zeropsToolCallIds = new Set<string>();
  const zeropsActivityIds = new Set<string>();

  for (const activity of activities) {
    if (!TOOL_ACTIVITY_KINDS.has(activity.kind)) {
      continue;
    }
    const payload = readRecord(activity.payload);
    if (payload === undefined) {
      continue;
    }
    const toolCallId = readString(payload.toolCallId);
    const name = normalizedToolName(payload);
    const isZeropsName = name !== undefined && name.startsWith("zerops_");

    if (toolCallId === undefined) {
      if (isZeropsName) {
        zeropsActivityIds.add(activity.id);
      }
      continue;
    }

    const rowIds = rowIdsByToolCallId.get(toolCallId) ?? [];
    rowIds.push(activity.id);
    rowIdsByToolCallId.set(toolCallId, rowIds);
    if (isZeropsName) {
      zeropsToolCallIds.add(toolCallId);
    }
  }

  for (const toolCallId of zeropsToolCallIds) {
    for (const id of rowIdsByToolCallId.get(toolCallId) ?? []) {
      zeropsActivityIds.add(id);
    }
  }

  return { zeropsActivityIds };
}
