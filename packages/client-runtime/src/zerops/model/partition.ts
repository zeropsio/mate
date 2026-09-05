/**
 * The tool-name normalisation shared by `calls.ts` (call membership) and
 * `deriveThreadModel.ts` (which activity rows the transcript must hide) —
 * gate on the NAME, never `itemType` (MF-3): `itemType` names how a provider
 * transports a call, not what the call is.
 *
 * Which activity rows belong to a Zerops call is decided exactly once, by
 * `collectZeropsCalls` in `calls.ts` (`ZeropsCall.rowIds`); there is no
 * second grouping pass here.
 */
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
