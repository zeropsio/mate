/**
 * The `zerops_*` tool result a work-log entry carries, read off the activity
 * payload the server projects.
 *
 * The server attaches this for `zerops_*` tools only, because its slimming pass
 * otherwise replaces every MCP result with its first line capped at 84
 * characters — see `apps/server/src/zerops/zeropsActivityResult.ts` for why,
 * and `../zcp/plans/z3-s6-ui-plan-2026-08-28.md` D-U1 for the decision.
 *
 * The read is defensive on purpose: a server older than this seam sends
 * nothing, and every absent or unrecognised shape has the same meaning to a
 * caller — no text, render the generic tool block.
 */
/** One image content block a `zerops_*` result carried (e.g. a `zerops_browser` screenshot). */
export interface ZeropsActivityResultImage {
  readonly mimeType: string;
  readonly data: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ZeropsActivityResult {
  /** Tool name without the `mcp__<server>__` prefix, e.g. `zerops_deploy`. */
  readonly toolName: string;
  /**
   * The result text verbatim. Absent while the call is still running, and when
   * the server dropped it for exceeding its size limit — see `truncated`.
   */
  readonly resultText?: string;
  /** The server had text but it was too large to send. Never a partial text. */
  readonly truncated?: boolean;
  /** Image content blocks the result carried (e.g. a `zerops_browser` screenshot). */
  readonly images?: ReadonlyArray<ZeropsActivityResultImage>;
  /** At least one image was dropped for exceeding its own cap. */
  readonly imagesDropped?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A malformed entry is dropped rather than failing the whole array — one bad image must not blank every other field this reader carries. */
function readImages(value: unknown): ReadonlyArray<ZeropsActivityResultImage> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const images: ZeropsActivityResultImage[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const { mimeType, data, width, height } = entry;
    if (typeof mimeType !== "string" || mimeType.length === 0) {
      continue;
    }
    if (typeof data !== "string" || data.length === 0) {
      continue;
    }
    images.push({
      mimeType,
      data,
      ...(typeof width === "number" ? { width } : {}),
      ...(typeof height === "number" ? { height } : {}),
    });
  }
  return images.length > 0 ? images : undefined;
}

/**
 * The Zerops result on an activity payload's `data`, or undefined when there is
 * none this client can use.
 *
 * A `toolName` is required: it is what a card registry dispatches on, and a
 * result with no name is one no card could claim anyway.
 */
export function readZeropsActivityResult(data: unknown): ZeropsActivityResult | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const zerops = data.zerops;
  if (!isRecord(zerops)) {
    return undefined;
  }
  const toolName = zerops.toolName;
  if (typeof toolName !== "string" || toolName.length === 0) {
    return undefined;
  }
  const images = readImages(zerops.images);
  return {
    toolName,
    ...(typeof zerops.resultText === "string" ? { resultText: zerops.resultText } : {}),
    ...(zerops.truncated === true ? { truncated: true } : {}),
    ...(images !== undefined ? { images } : {}),
    ...(zerops.imagesDropped === true ? { imagesDropped: true } : {}),
  };
}
