/**
 * Reads a pending `zerops_deploy` call's target hostname and server-stamped
 * start time off a work-log entry — `../../../../zcp/plans/mate-live-activity-2026-09-02.md`
 * §3 ("the pending tool call's arguments reach the client").
 *
 * `targetService` is read defensively across more than one shape because the
 * raw MCP item a `WorkLogEntry` carries as `toolData` is driver-specific:
 * `session-logic.ts` only populates it from a Codex-shaped `data.item`, so on
 * Claude — this build's primary provider — `toolData` is undefined for an
 * in-flight MCP call today (`data.input` is projected but never copied onto
 * the entry). Reading `.input`, `.arguments` and a flat field covers every
 * shape this reducer can plausibly see without requiring a `session-logic.ts`
 * change, which is outside this slice's write-set; see the implementation
 * report for the concrete gap this leaves on Claude until that file is
 * touched.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export interface PendingDeployCall {
  readonly targetService: string;
  /** Server-stamped start time (the item.started activity's own `createdAt`), epoch ms. */
  readonly toolStartedAtMs: number;
}

function readTargetService(toolData: unknown): string | undefined {
  if (!isRecord(toolData)) {
    return undefined;
  }
  const direct = readString(toolData.targetService);
  if (direct !== undefined) {
    return direct;
  }
  const input = isRecord(toolData.input) ? toolData.input : undefined;
  const fromInput = readString(input?.targetService);
  if (fromInput !== undefined) {
    return fromInput;
  }
  const args = isRecord(toolData.arguments) ? toolData.arguments : undefined;
  return readString(args?.targetService);
}

/**
 * `createdAt` must be the entry's own server-stamped timestamp (`WorkLogEntry.createdAt`,
 * itself `item.started`'s `stamp.createdAt` — never the browser clock, per §3.3).
 */
export function readPendingDeployCall(entry: {
  readonly toolData?: unknown;
  readonly createdAt: string;
}): PendingDeployCall | undefined {
  const toolStartedAtMs = Date.parse(entry.createdAt);
  if (Number.isNaN(toolStartedAtMs)) {
    return undefined;
  }
  const targetService = readTargetService(entry.toolData);
  return targetService === undefined ? undefined : { targetService, toolStartedAtMs };
}
