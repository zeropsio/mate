/**
 * Reads a pending `zerops_deploy` call's target hostname and server-stamped
 * start time off a work-log entry — `../../../../zcp/plans/mate-live-activity-2026-09-02.md`
 * §3 ("the pending tool call's arguments reach the client").
 *
 * `targetService` is read from the two verified shapes a `WorkLogEntry`
 * actually carries a call's arguments in: Codex's `toolData.input` (copied
 * from the driver's `data.item.input`) and Claude's `toolInput` (copied from
 * the driver's flat `data.input` — `session-logic.ts`'s `toDerivedWorkLogEntry`,
 * proven against `ActivityPayloadProjection.test.ts`'s Claude fixtures). No
 * other shape is read: nothing in the codebase produces a flat `targetService`
 * or an `arguments` field on either carrier.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export interface PendingDeployCall {
  readonly targetService: string;
  /** The call's first-observed server-stamped time (`WorkLogEntry.startedAt`, falling back to `createdAt`), epoch ms. */
  readonly toolStartedAtMs: number;
}

function readTargetService(toolData: unknown, toolInput: unknown): string | undefined {
  const fromCodexItem = isRecord(toolData) && isRecord(toolData.input) ? toolData.input : undefined;
  const fromCodex = readString(fromCodexItem?.targetService);
  if (fromCodex !== undefined) {
    return fromCodex;
  }
  return isRecord(toolInput) ? readString(toolInput.targetService) : undefined;
}

/**
 * `startedAt`/`createdAt` must be the entry's own server-stamped timestamps
 * (`WorkLogEntry.startedAt`/`createdAt`) — never the browser clock, per §3.3.
 */
export function readPendingDeployCall(entry: {
  readonly toolData?: unknown;
  readonly toolInput?: unknown;
  readonly createdAt: string;
  readonly startedAt?: string | undefined;
}): PendingDeployCall | undefined {
  const toolStartedAtMs = Date.parse(entry.startedAt ?? entry.createdAt);
  if (Number.isNaN(toolStartedAtMs)) {
    return undefined;
  }
  const targetService = readTargetService(entry.toolData, entry.toolInput);
  return targetService === undefined ? undefined : { targetService, toolStartedAtMs };
}
