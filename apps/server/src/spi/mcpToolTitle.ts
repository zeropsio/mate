/**
 * The MCP tool an ACP call's title names — one rule for the crew's gate
 * (`acpThreadProfile.ts`) and the tool-call reader (`toolCall.ts`). ACP
 * names no tool, so a title is all there is, and only a title that is a
 * tool's name WHOLE names one: `mcp__server__tool`, `server: tool`,
 * `server/tool` or a bare name, after an optional `Running `/`Run `. A
 * title that merely mentions a name ("Update notes in zerops_import.yaml")
 * names nothing.
 *
 * A crew or Zerops tool is known by its name's prefix whatever server the
 * agent says it came from.
 *
 * @module mcpToolTitle
 */

/** The MCP server a profile's tools are served as, so calls read `mcp__crew__<tool>`. */
export const THREAD_TOOLS_SERVER = "crew";

/** The MCP server zcp's tools are served as. */
export const ZEROPS_SERVER = "zerops";

export interface McpToolTitle {
  readonly tool: string;
  /** Its server: the one the title spells, or the one its prefix says; absent for a bare unknown name. */
  readonly server?: string;
  /**
   * Whether the title says it is an MCP tool — Claude's `mcp__` spelling or a
   * crew or Zerops name — rather than a name that could be any tool's.
   */
  readonly certain: boolean;
}

/** `mcp__server__tool`, `server: tool`, `server/tool`, or a bare name. */
const MCP_TITLE =
  /^(?:(mcp__)([A-Za-z0-9_-]+?)__|([A-Za-z0-9_-]+)\s*[:/]\s*)?([A-Za-z][A-Za-z0-9_-]*)$/u;

export const mcpToolOfTitle = (title: string | null | undefined): McpToolTitle | undefined => {
  const match = MCP_TITLE.exec((title ?? "").trim().replace(/^(?:Running |Run )/u, ""));
  if (match === null) return undefined;
  const tool = match[4]!;
  if (tool.startsWith("crew_")) return { tool, server: THREAD_TOOLS_SERVER, certain: true };
  if (tool.startsWith("zerops_")) return { tool, server: ZEROPS_SERVER, certain: true };
  const server = match[2] ?? match[3];
  return server === undefined
    ? { tool, certain: false }
    : { tool, server, certain: match[1] !== undefined };
};
