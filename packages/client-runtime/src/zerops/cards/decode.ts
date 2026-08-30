/**
 * Reading a `zerops_*` tool result into something a card can render.
 *
 * Every zcp tool result is one of two shapes:
 *
 * - a **JSON document** — `zerops_deploy`, `zerops_verify`, `zerops_import`,
 *   `zerops_mount`, `zerops_subdomain`, `zerops_discover`, the bootstrap
 *   actions, and every error (`internal/tools/errwire.go`);
 * - **prose** — `zerops_workflow` status / develop-start / close, which render
 *   markdown and carry their state in a trailing fenced block.
 *
 * A card only ever renders the first kind. The prose results carry the
 * StateEnvelope, and the envelope already reaches the client through the
 * lifecycle feed, so re-parsing the prose here would be a second, worse copy of
 * something the strip already has.
 *
 * Decoding is expected to fail. A tool this build has no card for, a zcp newer
 * than this build, a result too large for the server to carry — all of them end
 * as `undefined`, and the caller renders the generic tool block. That path is
 * ordinary, not exceptional.
 */
import type { ZeropsActivityResult } from "../activityResult.ts";

export interface ZeropsCardSource {
  /** Tool name without the `mcp__<server>__` prefix, e.g. `zerops_deploy`. */
  readonly toolName: string;
  /** The result parsed as a JSON object. */
  readonly document: Record<string, unknown>;
  /** Whether the provider marked this call failed. */
  readonly failed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The JSON document behind a tool result, or undefined when there is not one.
 *
 * A result that is not a JSON *object* is never coerced: an array, a bare
 * string or a number is not a zcp response shape, and treating one as a card
 * payload would render whatever happened to be in it.
 */
export function readZeropsCardSource(
  result: ZeropsActivityResult | undefined,
  options?: { readonly failed?: boolean },
): ZeropsCardSource | undefined {
  if (result?.resultText === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.resultText);
  } catch {
    return undefined;
  }
  return isRecord(parsed)
    ? { toolName: result.toolName, document: parsed, failed: options?.failed ?? false }
    : undefined;
}

// --- readers, deliberately narrow -------------------------------------------
// Each returns undefined rather than coercing, so a field zcp changes the type
// of degrades that one line instead of corrupting the card around it.

export const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

export const readArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : [];

export const readStringArray = (value: unknown): ReadonlyArray<string> =>
  readArray(value).filter((entry): entry is string => typeof entry === "string");

export const readRecordArray = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  readArray(value).filter(isRecord);
