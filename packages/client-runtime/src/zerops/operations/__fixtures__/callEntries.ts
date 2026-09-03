/**
 * Test-only adapter: turns a showcase thread's raw activities into
 * `ZeropsCallEntry[]` the way the web will, after its own transcript's
 * lifecycle collapse. Exported from the `./zerops/operations/fixtures`
 * subpath so the web's own tests can reuse the same fixtures and the same
 * collapse rules instead of hand-rolling their own.
 *
 * `tool.started` rows are not collapse inputs: they carry no information a
 * later `tool.updated` / `tool.completed` row doesn't repeat once the tool's
 * arguments have actually streamed in (`tool.started` fires before that, so
 * its own `data.input` is `{}`) — see the `zerops_verify` / `zerops_deploy`
 * calls in `verify-and-refused-deploy`, whose arguments only appear on the
 * first `tool.updated`.
 *
 * `resultText` prefers `data.zerops.resultText` (the brief's rule — the
 * server's own un-slimmed carry for a `zerops_*` result), falling back to
 * Claude's own raw `data.result.content` when no row for a call ever carries
 * a `zerops` enrichment at all. Three calls in `verify-and-refused-deploy`
 * (an early `zerops_verify` pair, and the first of its two failed
 * `zerops_deploy` attempts) predate the enrichment appearing in that
 * captured session and never carry `data.zerops` on any row, but Claude's own
 * result is intact and decodes the same JSON document — without this
 * fallback those calls would be undecodable operations for no reason a
 * client should care about.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import type { ZeropsCallEntry, ZeropsCallStatus } from "../types.ts";
import type { ZeropsShowcaseThread } from "./index.ts";

export * from "./index.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const isNonEmptyObject = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && Object.keys(value).length > 0;

const isCallStatus = (value: unknown): value is ZeropsCallStatus =>
  value === "inProgress" ||
  value === "completed" ||
  value === "failed" ||
  value === "declined" ||
  value === "stopped";

/** `mcp__zerops__zerops_deploy` → `zerops_deploy`; a non-MCP name is unchanged. */
function stripMcpPrefix(toolName: string): string {
  return toolName.replace(/^mcp__[^_]+__/, "");
}

/** Claude's own raw tool result text, when `content` is a string or an SDK content-block array. */
function extractRawResultText(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  const content = result.content;
  if (typeof content === "string") {
    return readString(content);
  }
  if (Array.isArray(content)) {
    const block = content.find(
      (entry): entry is { type: "text"; text: string } =>
        isRecord(entry) && entry.type === "text" && typeof entry.text === "string",
    );
    return block !== undefined ? readString(block.text) : undefined;
  }
  return undefined;
}

interface CallAccumulator {
  id: string;
  createdAt: string;
  turnId: string | null;
  toolCallId: string;
  toolName?: string;
  input?: Record<string, unknown>;
  status: ZeropsCallStatus;
  settledAt?: string;
  zeropsResultText?: string;
  rawResultText?: string;
  truncated?: boolean;
}

function foldRow(acc: CallAccumulator, activity: OrchestrationThreadActivity): void {
  const payload = isRecord(activity.payload) ? activity.payload : {};
  const data = isRecord(payload.data) ? payload.data : {};
  const zerops = isRecord(data.zerops) ? data.zerops : undefined;

  const zeropsToolName = readString(zerops?.toolName);
  const plainToolName = readString(data.toolName);
  const toolName =
    zeropsToolName ?? (plainToolName !== undefined ? stripMcpPrefix(plainToolName) : undefined);
  if (toolName !== undefined) {
    acc.toolName = toolName;
  }
  if (isNonEmptyObject(data.input)) {
    acc.input = data.input;
  }
  const zeropsResultText = readString(zerops?.resultText);
  if (zeropsResultText !== undefined) {
    acc.zeropsResultText = zeropsResultText;
  }
  const rawResultText = extractRawResultText(data.result);
  if (rawResultText !== undefined) {
    acc.rawResultText = rawResultText;
  }
  if (zerops?.truncated === true) {
    acc.truncated = true;
  }

  const rawStatus = payload.status;
  const status: ZeropsCallStatus | undefined = isCallStatus(rawStatus)
    ? rawStatus
    : activity.kind === "tool.completed"
      ? "completed"
      : undefined;
  // A status can never regress from a terminal value back to "inProgress" —
  // real transcripts carry a stray post-completion `tool.updated` tick with
  // no data of its own (see the module doc); it must not undo settlement.
  if (status !== undefined && !(acc.status !== "inProgress" && status === "inProgress")) {
    acc.status = status;
    if (status !== "inProgress") {
      acc.settledAt = activity.createdAt;
    }
  }
}

/**
 * `activities` collapsed to one `ZeropsCallEntry` per `toolCallId`, in the
 * order each call was first observed.
 */
export function callEntriesFromActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ZeropsCallEntry[] {
  const order: string[] = [];
  const byToolCallId = new Map<string, CallAccumulator>();

  for (const activity of activities) {
    if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
      continue;
    }
    const payload = isRecord(activity.payload) ? activity.payload : {};
    const toolCallId = readString(payload.toolCallId);
    if (toolCallId === undefined) {
      continue;
    }
    let acc = byToolCallId.get(toolCallId);
    if (acc === undefined) {
      acc = {
        id: activity.id,
        createdAt: activity.createdAt,
        turnId: activity.turnId,
        toolCallId,
        status: "inProgress",
      };
      byToolCallId.set(toolCallId, acc);
      order.push(toolCallId);
    }
    foldRow(acc, activity);
  }

  return order.map((toolCallId) => {
    const acc = byToolCallId.get(toolCallId)!;
    const resultText = acc.zeropsResultText ?? acc.rawResultText;
    return {
      id: acc.id,
      createdAt: acc.createdAt,
      turnId: acc.turnId,
      toolCallId: acc.toolCallId,
      toolName: acc.toolName ?? "",
      ...(acc.input !== undefined ? { input: acc.input } : {}),
      status: acc.status,
      ...(acc.settledAt !== undefined ? { settledAt: acc.settledAt } : {}),
      ...(resultText !== undefined ? { resultText } : {}),
      ...(acc.truncated === true ? { truncated: true } : {}),
    };
  });
}

/** `callEntriesFromActivities` over one showcase thread's activities. */
export function callEntriesFromThread(thread: ZeropsShowcaseThread): ZeropsCallEntry[] {
  return callEntriesFromActivities(thread.activities);
}
