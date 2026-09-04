/**
 * Owned SPI enrichment: reads the generic ANY-tool view out of an item
 * lifecycle event's driver-specific `payload.data`, keyed on
 * `event.provider`.
 *
 * - Claude puts `{toolName, input, result?}` there for EVERY tool call
 *   regardless of the item's classified `itemType` — `ClaudeAdapter.ts`
 *   builds that same `data` shape unconditionally for a native tool (Bash, a
 *   subagent Task), a file edit, and an MCP call alike
 *   (`ClaudeAdapter.ts:2762-2766`, `:1501-1546`). So the reader below is
 *   gated on the DATA shape (does `data.toolName` exist?), never on the
 *   classified `itemType` — Claude's `classifyToolItemType`
 *   (`ClaudeAdapter.ts:736-771`) is an ordered substring match that tests
 *   `…delete…` before `…mcp…`, so `mcp__zerops__zerops_delete` arrives typed
 *   `file_change`; an `itemType` gate would drop it.
 * - Codex's MCP tool calls put the raw `V2Item(Started|Completed)Notification`
 *   there, whose `item` is the `mcpToolCall` variant (`CodexAdapter.ts:466-501`).
 *   Codex's OTHER tool-lifecycle item variants (`commandExecution`,
 *   `fileChange`, `collabAgentToolCall`, `webSearch`, ...) carry unrelated
 *   field layouts this module does not read — see `unrecognized` below.
 *
 * This is the ONE place that reads `payload.data`: everything downstream
 * (`apps/server/src/zerops/**`) reads `event.toolCall`
 * (`packages/contracts/src/providerRuntimeSpi.ts`) instead.
 *
 * Failure semantics: a payload whose `itemType` is one of
 * `TOOL_LIFECYCLE_ITEM_TYPES` (`isToolLifecycleItemType`) IS a tool call by
 * the driver's own classification — reading nothing usable back from its
 * `data` must never resolve to a silent `notATool`, or a driver shape change
 * (or a variant this module has not been taught) would quietly stop
 * reaching `event.toolCall` with nothing to notice it by. That case comes
 * back `unrecognized`, which `ProviderRuntimeEventBus` turns into a logged
 * warning and an `enrichmentFailures` event
 * (`apps/server/src/spi/ProviderRuntimeEventBus.ts`). Anything whose
 * `itemType` is NOT a tool-lifecycle type (`assistant_message`, `reasoning`,
 * ...), or whose provider has no reader below (cursor/grok/opencode), comes
 * back `notATool` — a normal, silent, expected outcome.
 *
 * @module toolCall
 */
import {
  isToolLifecycleItemType,
  type CanonicalItemType,
  type ItemLifecyclePayload,
  type SpiEvent,
  type SpiToolCall,
  type SpiToolCallImage,
} from "@t3tools/contracts";

export type ToolCallReadResult =
  | { readonly kind: "toolCall"; readonly call: SpiToolCall }
  | { readonly kind: "notATool" }
  | {
      readonly kind: "unrecognized";
      readonly itemType: CanonicalItemType;
      readonly reason: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * MCP result content is an array of content blocks; only the text ones carry
 * the result. Claude also permits a bare string. Blocks are concatenated in
 * order — zcp's envelope block is at the end of the LAST text block, and
 * joining with a separator would corrupt a result split across blocks.
 */
const readContentText = (content: unknown): string | undefined => {
  const asString = readString(content);
  if (asString !== undefined) {
    return asString;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  let text = "";
  for (const block of content) {
    if (isRecord(block) && block.type === "text") {
      text += readString(block.text) ?? "";
    }
  }
  return text;
};

/**
 * A `{data}` base64 string over this many UTF-16 code units is dropped
 * rather than carried — 256 KB (SPI-8b, S8b brief), independent of
 * {@link ZEROPS_RESULT_TEXT_LIMIT}-style text caps, which live one layer up
 * in `apps/server/src/zerops/zeropsActivityResult.ts`.
 */
const MAX_IMAGE_BASE64_LENGTH = 256 * 1024;

interface ContentImagesResult {
  readonly images: ReadonlyArray<SpiToolCallImage>;
  readonly dropped: boolean;
}

/**
 * MCP image content blocks (`{type: "image", mimeType, data}`) in a result's
 * `content` array — the `zerops_browser` screenshot is the first consumer. A
 * bare string `content` (Claude's shorthand) carries no image blocks. An
 * over-cap image is dropped, never truncated (a half-decoded JPEG is
 * useless); `dropped` records that at least one was.
 */
const readContentImages = (content: unknown): ContentImagesResult => {
  if (!Array.isArray(content)) {
    return { images: [], dropped: false };
  }
  const images: SpiToolCallImage[] = [];
  let dropped = false;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "image") {
      continue;
    }
    const data = readString(block.data);
    const mimeType = readString(block.mimeType);
    if (data === undefined || mimeType === undefined) {
      continue;
    }
    if (data.length > MAX_IMAGE_BASE64_LENGTH) {
      dropped = true;
      continue;
    }
    const width = typeof block.width === "number" ? block.width : undefined;
    const height = typeof block.height === "number" ? block.height : undefined;
    images.push({
      mimeType,
      data,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    });
  }
  return { images, dropped };
};

/** The `images`/`imagesDropped` fields of a {@link SpiToolCall}'s `result`, built from the same content array {@link readContentText} read. */
const readResultImageFields = (
  content: unknown,
): Pick<NonNullable<SpiToolCall["result"]>, "images" | "imagesDropped"> => {
  const { images, dropped } = readContentImages(content);
  return {
    ...(images.length > 0 ? { images } : {}),
    ...(dropped ? { imagesDropped: true } : {}),
  };
};

/** The `mcp__<server>__` prefix Claude puts on an MCP tool's wire name. */
const MCP_PREFIX_PATTERN = /^mcp__([^_]+(?:_[^_]+)*?)__/;

const splitMcpName = (raw: string): { readonly name: string; readonly server?: string } => {
  const match = MCP_PREFIX_PATTERN.exec(raw);
  if (match === null) {
    return { name: raw };
  }
  const server = match[1];
  const name = raw.slice(match[0].length);
  return server === undefined ? { name } : { name, server };
};

/** `unrecognized` when the item is a classified tool by the driver's own itemType; `notATool` otherwise. */
const shapeMismatch = (
  itemType: CanonicalItemType,
  isToolItem: boolean,
  reason: string,
): ToolCallReadResult =>
  isToolItem ? { kind: "unrecognized", itemType, reason } : { kind: "notATool" };

/** Claude: `data = {toolName, input, result?}`, the SAME shape for every itemType. */
const readClaudeToolCall = (payload: ItemLifecyclePayload): ToolCallReadResult => {
  const isToolItem = isToolLifecycleItemType(payload.itemType);
  const data = payload.data;
  if (!isRecord(data)) {
    return shapeMismatch(payload.itemType, isToolItem, "payload.data is not an object");
  }
  const rawName = readString(data.toolName);
  if (rawName === undefined) {
    return shapeMismatch(payload.itemType, isToolItem, "payload.data has no toolName");
  }
  const { name, server } = splitMcpName(rawName);
  const base: SpiToolCall = {
    name,
    rawName,
    ...(server !== undefined ? { server } : {}),
    ...(data.input !== undefined ? { arguments: data.input } : {}),
  };
  if (data.result === undefined) {
    return { kind: "toolCall", call: base };
  }
  if (!isRecord(data.result)) {
    return { kind: "unrecognized", itemType: payload.itemType, reason: "result is not an object" };
  }
  const text = readContentText(data.result.content);
  if (text === undefined) {
    return {
      kind: "unrecognized",
      itemType: payload.itemType,
      reason: "result.content has no readable text",
    };
  }
  return {
    kind: "toolCall",
    call: {
      ...base,
      result: {
        text,
        failed: data.result.is_error === true,
        ...readResultImageFields(data.result.content),
      },
    },
  };
};

/** Codex: `data = {item: {...}}`; only the `mcpToolCall` variant is read. */
const readCodexToolCall = (payload: ItemLifecyclePayload): ToolCallReadResult => {
  const isToolItem = isToolLifecycleItemType(payload.itemType);
  const data = payload.data;
  if (!isRecord(data)) {
    return shapeMismatch(payload.itemType, isToolItem, "payload.data is not an object");
  }
  const item = data.item;
  if (!isRecord(item)) {
    return shapeMismatch(payload.itemType, isToolItem, "payload.data.item is missing");
  }
  if (item.type !== "mcpToolCall") {
    // A real, classified tool item (commandExecution/fileChange/
    // collabAgentToolCall/webSearch/...) whose field layout this module does
    // not read — see the module doc comment.
    return shapeMismatch(
      payload.itemType,
      isToolItem,
      `codex item type "${String(item.type)}" is not read (only mcpToolCall)`,
    );
  }
  const rawName = readString(item.tool);
  if (rawName === undefined) {
    return {
      kind: "unrecognized",
      itemType: payload.itemType,
      reason: "mcpToolCall item has no tool name",
    };
  }
  const server = readString(item.server);
  const base: SpiToolCall = {
    name: rawName,
    rawName,
    ...(server !== undefined ? { server } : {}),
    ...(item.arguments !== undefined ? { arguments: item.arguments } : {}),
  };
  if (item.result === undefined) {
    return { kind: "toolCall", call: base };
  }
  if (!isRecord(item.result)) {
    return {
      kind: "unrecognized",
      itemType: payload.itemType,
      reason: "item.result is not an object",
    };
  }
  const text = readContentText(item.result.content);
  if (text === undefined) {
    return {
      kind: "unrecognized",
      itemType: payload.itemType,
      reason: "item.result.content has no readable text",
    };
  }
  const failed = item.error != null || item.status === "failed";
  return {
    kind: "toolCall",
    call: {
      ...base,
      result: { text, failed, ...readResultImageFields(item.result.content) },
    },
  };
};

const READERS: Partial<Record<string, (payload: ItemLifecyclePayload) => ToolCallReadResult>> = {
  claudeAgent: readClaudeToolCall,
  codex: readCodexToolCall,
};

/**
 * The tool call one event describes, or why it is not one. Only
 * `item.started` / `item.updated` / `item.completed` can carry a tool call;
 * every other event type (and a provider with no reader — cursor, grok,
 * opencode) reads back `notATool` without failing.
 */
export const readToolCall = (event: SpiEvent): ToolCallReadResult => {
  if (
    event.type !== "item.started" &&
    event.type !== "item.updated" &&
    event.type !== "item.completed"
  ) {
    return { kind: "notATool" };
  }
  const reader = READERS[event.provider];
  return reader === undefined ? { kind: "notATool" } : reader(event.payload);
};

/**
 * Adds `toolCall` to one event when {@link readToolCall} recognizes it,
 * otherwise returns the event unchanged (same reference). Always recomputes
 * from `payload.data` — applying this to an event that already carries a
 * `toolCall` overwrites it rather than trusting it.
 */
export const applyToolCall = (event: SpiEvent): SpiEvent => {
  const result = readToolCall(event);
  return result.kind === "toolCall" ? { ...event, toolCall: result.call } : event;
};

/**
 * Shape-sniffs `payload.data` across every known provider's tool-call shape
 * (Claude's `{toolName, ...}` first, then Codex's `mcpToolCall` item),
 * without requiring the caller to know which provider produced it, or which
 * `itemType` the driver classified the item as.
 *
 * `apps/server/src/zerops/**` must still never call this — it reads
 * `event.toolCall` instead, populated by the bus, which DOES know the
 * provider. This exists for the one caller outside that boundary with no
 * `SpiEvent` in hand:
 * `apps/server/src/orchestration/ActivityPayloadProjection.ts` projects a
 * driver-agnostic `OrchestrationThreadActivity` (no `provider` field,
 * built upstream from an already-enriched event) — by the time it reaches
 * that projection, only `payload.data` survives.
 *
 * Since the caller has no reliable `itemType` either, `unrecognized` here is
 * never loud (there is nothing to log against) — this always resolves to
 * `toolCall` or `notATool`.
 */
export const sniffToolCallShape = (data: unknown): ToolCallReadResult => {
  const payload = { itemType: "unknown", data } as ItemLifecyclePayload;
  const claude = readClaudeToolCall(payload);
  if (claude.kind === "toolCall") {
    return claude;
  }
  const codex = readCodexToolCall(payload);
  return codex.kind === "toolCall" ? codex : { kind: "notATool" };
};
