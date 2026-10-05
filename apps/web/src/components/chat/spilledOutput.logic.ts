/**
 * The files Claude Code spills a call's output to, which the agent then reads
 * back: a read of one is said by what the file holds, never by its name (run
 * 11: the working line read "Reading br89ocvyk.txt").
 *
 * - `…/tasks/<id>.output`: what a background job prints.
 * - `…/tool-results/<id>.txt`: a call's output too long to hand back whole;
 *   the call's own output names the file. An MCP tool's is
 *   `mcp-<server>-<tool>-<n>.txt`, its tool in its name.
 *
 * Pure.
 *
 * @module spilledOutput.logic
 */

/** What a spilled file holds, by the path a read names. */
export type SpilledOutput =
  | { readonly kind: "job"; readonly id: string }
  | { readonly kind: "result"; readonly id: string; readonly tool: string | null };

const JOB_OUTPUT = /[\\/]tasks[\\/]([\w-]+)\.output$/u;
const TOOL_RESULT = /[\\/]tool-results[\\/]([\w.-]+)\.txt$/u;
/** `mcp-<server>-<tool>-<n>`: the server may hold a hyphen, the tool's own name does not. */
const MCP_RESULT = /^mcp-.+-([^-]+)-\d+$/u;

/** The file a call's own output says it spilled to, by the id a read of it names; none else. */
export function spilledResultIdIn(output: string): string | undefined {
  return /[\\/]tool-results[\\/]([\w.-]+)\.txt\b/u.exec(output)?.[1];
}

/** What the file at `path` holds, where it is one Claude Code spills output to; null else. */
export function spilledOutputOf(path: string): SpilledOutput | null {
  const job = JOB_OUTPUT.exec(path)?.[1];
  if (job !== undefined) return { kind: "job", id: job };
  const result = TOOL_RESULT.exec(path)?.[1];
  if (result === undefined) return null;
  const tool = MCP_RESULT.exec(result)?.[1];
  return {
    kind: "result",
    id: result,
    tool: tool === undefined ? null : tool.replace(/_+/gu, " ").trim() || null,
  };
}

/**
 * A read of spilled output, in words: the output of what made it, by the
 * words it goes by — a job's, a command's, a tool's — else what kind of
 * output it is.
 */
export function spilledOutputPhrase(
  spilled: SpilledOutput,
  /** What made it, by its id, where the log names it. */
  madeBy: string | undefined,
  running: boolean,
): { readonly verb: string; readonly target: string | null } {
  const verb = running ? "Reading" : "Read";
  const by = madeBy ?? (spilled.kind === "result" ? (spilled.tool ?? undefined) : undefined);
  if (by !== undefined) return { verb: `${verb} the output of`, target: by };
  return {
    verb:
      spilled.kind === "job" ? `${verb} a background job's output` : `${verb} a command's output`,
    target: null,
  };
}
