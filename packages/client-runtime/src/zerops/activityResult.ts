/**
 * The `zerops_*` tool result a work-log entry carries, read off the activity
 * payload the server projects.
 *
 * The server attaches this for `zerops_*` tools only, because its slimming pass
 * otherwise replaces every MCP result with its first line capped at 84
 * characters — see `apps/server/src/activity/zeropsActivityResult.ts` for why.
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
