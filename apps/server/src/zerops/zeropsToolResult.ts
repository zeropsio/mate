/**
 * Recognises a `zerops_*` MCP tool call on the SPI bus.
 *
 * Every provider's tool call reaches `event.toolCall`
 * (`packages/contracts/src/providerRuntimeSpi.ts`) — the generic ANY-tool
 * view `apps/server/src/spi/toolCall.ts` enriches onto the bus, reading each
 * driver's own item-payload data shape. This module is nothing more than the
 * zerops-specific FILTER over that view: it never reads a driver's raw item
 * payload itself, and it never shape-dispatches per provider.
 */
import type { SpiEvent, SpiToolCall } from "@t3tools/contracts";

/** Tool names ZCP exposes over MCP all start with this. */
const ZEROPS_TOOL_PREFIX = "zerops_";

/** Claude's SDK prefixes MCP tools with `mcp__<server>__`; Codex reports the bare name. */
const MCP_PREFIX_PATTERN = /^mcp__[^_]+(?:_[^_]+)*?__/;

export const normalizeZeropsToolName = (raw: string): string => raw.replace(MCP_PREFIX_PATTERN, "");

export const isZeropsToolName = (raw: string): boolean =>
  normalizeZeropsToolName(raw).startsWith(ZEROPS_TOOL_PREFIX);

/**
 * The `zerops_*` tool call this event's `toolCall` describes, or undefined
 * when the event carries no `toolCall` (not a tool item, an unrecognized
 * shape, or a provider with no reader) or the tool it names is not
 * `zerops_*`.
 */
export const readZeropsToolCall = (event: SpiEvent): SpiToolCall | undefined => {
  const call = event.toolCall;
  return call !== undefined && isZeropsToolName(call.name) ? call : undefined;
};
