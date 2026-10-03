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
 *   Its `commandExecution` and `fileChange` items are its own shell and
 *   patch tools, never an MCP call, and nothing downstream reads them: they
 *   come back `notATool`, deliberately, so a Codex crewmate's every command
 *   does not warn. Its OTHER tool-lifecycle item variants
 *   (`collabAgentToolCall`, `webSearch`, ...) carry unrelated field layouts
 *   this module does not read — see `unrecognized` below.
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
 * ...), or whose provider has no reader below, comes back `notATool` — a
 * normal, silent, expected outcome.
 * - OpenCode puts `{tool, state}` there for every tool; an MCP tool is named
 *   `<server>_<tool>` (`zerops_zerops_deploy`).
 * - The ACP agents (Cursor, Grok, Antigravity) put `{toolCallId, kind,
 *   rawInput, rawOutput, content, ...}` there and name no tool: an MCP call
 *   is known by the name its title carries, a native one by its kind.
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
 * rather than carried — 1 MiB. Live-measured 2026-09-04 (verified.md):
 * Claude Code forwarding a `zerops_browser` screenshot at the default
 * viewport (1280×577 PNG) put ~301 KB of base64 on the wire, so the
 * originally-specified 256 KB cap (S8b brief) would have dropped every real
 * thumbnail; raised with headroom. Independent of
 * {@link ZEROPS_RESULT_TEXT_LIMIT}-style text caps, which live one layer up
 * in `apps/server/src/zerops/zeropsActivityResult.ts`.
 */
const MAX_IMAGE_BASE64_LENGTH = 1024 * 1024;

interface ContentImagesResult {
  readonly images: ReadonlyArray<SpiToolCallImage>;
  readonly dropped: boolean;
}

/**
 * MCP image content blocks in a result's `content` array — the
 * `zerops_browser` screenshot is the first consumer. A bare string `content`
 * (Claude's shorthand) carries no image blocks. An over-cap image is
 * dropped, never truncated (a half-decoded PNG is useless); `dropped`
 * records that at least one was.
 *
 * Two shapes, read defensively:
 * - **Claude** (Agent SDK, live-measured 2026-09-04 — verified.md): mirrors
 *   Anthropic's own `ImageBlockParam`, `{type: "image", source: {type:
 *   "base64", media_type, data}}` — nested under `source`, and it carries no
 *   width/height (the model only ever reported dimensions as prose).
 * - **Codex**: UNMEASURED. The raw MCP protocol's own `ImageContent` is flat
 *   (`{type: "image", data, mimeType}`), so that is read as the fallback —
 *   never live-verified against Codex's `mcpToolCall` item's own result.
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
    const source = isRecord(block.source) ? block.source : undefined;
    const data = readString(source?.data) ?? readString(block.data);
    const mimeType = readString(source?.media_type) ?? readString(block.mimeType);
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

/** Codex's own shell and patch items: tools, but never an MCP call, and read by nothing. */
const CODEX_OWN_TOOL_ITEMS: ReadonlySet<unknown> = new Set(["commandExecution", "fileChange"]);

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
  if (CODEX_OWN_TOOL_ITEMS.has(item.type)) {
    return { kind: "notATool" };
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

/**
 * OpenCode's native tools whose names hold an underscore: no MCP call. Every
 * other underscored name is an MCP tool, `<server>_<tool>` (`zerops_zerops_deploy`).
 */
const OPENCODE_NATIVE_UNDERSCORED: ReadonlySet<string> = new Set(["apply_patch"]);

const splitOpenCodeName = (raw: string): { readonly name: string; readonly server?: string } => {
  const split = raw.indexOf("_");
  if (split <= 0 || split === raw.length - 1 || OPENCODE_NATIVE_UNDERSCORED.has(raw)) {
    return { name: raw };
  }
  return { name: raw.slice(split + 1), server: raw.slice(0, split) };
};

/** A data URL's media type and base64 data: how OpenCode carries a picture a tool returned. */
const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.*)$/s;

/** The pictures an OpenCode result attached, as MCP image blocks read them. */
const openCodeAttachmentBlocks = (attachments: unknown): ReadonlyArray<unknown> =>
  Array.isArray(attachments)
    ? attachments.flatMap((attachment) => {
        const match = isRecord(attachment)
          ? DATA_URL_PATTERN.exec(readString(attachment.url) ?? "")
          : null;
        return match === null ? [] : [{ type: "image", mimeType: match[1], data: match[2] }];
      })
    : [];

/**
 * OpenCode: `data = {tool, state}` (`OpenCodeAdapter.ts`, a tool part's
 * `message.part.updated`) — every tool, its MCP ones named `<server>_<tool>`.
 * A completed call's result is `state.output`, a failed one's `state.error`;
 * a picture it returned is an attachment, a data URL.
 */
const readOpenCodeToolCall = (payload: ItemLifecyclePayload): ToolCallReadResult => {
  const isToolItem = isToolLifecycleItemType(payload.itemType);
  const data = payload.data;
  if (!isRecord(data)) {
    return shapeMismatch(payload.itemType, isToolItem, "payload.data is not an object");
  }
  const rawName = readString(data.tool);
  if (rawName === undefined || rawName.length === 0) {
    return shapeMismatch(payload.itemType, isToolItem, "payload.data has no tool");
  }
  const state = isRecord(data.state) ? data.state : {};
  const { name, server } = splitOpenCodeName(rawName);
  const base: SpiToolCall = {
    name,
    rawName,
    ...(server !== undefined ? { server } : {}),
    ...(state.input !== undefined ? { arguments: state.input } : {}),
  };
  if (state.status === "completed") {
    const blocks = openCodeAttachmentBlocks(state.attachments);
    return {
      kind: "toolCall",
      call: {
        ...base,
        result: {
          text: readString(state.output) ?? "",
          failed: false,
          ...readResultImageFields(blocks),
        },
      },
    };
  }
  if (state.status === "error") {
    return {
      kind: "toolCall",
      call: { ...base, result: { text: readString(state.error) ?? "", failed: true } },
    };
  }
  return { kind: "toolCall", call: base };
};

/** Claude's spelling of an MCP tool in a title: `mcp__<server>__<tool>`. */
const TITLE_MCP_PATTERN = /mcp__([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*?)__([A-Za-z0-9_-]+)/;

/**
 * A Zerops tool in a title, whatever an agent puts around it — `Running
 * zerops_deploy` (Antigravity), `zerops-zerops_deploy`, `zerops: zerops_deploy`,
 * `zerops_zerops_deploy`: the server's name before it, where one stands.
 */
const TITLE_ZEROPS_PATTERN = /(?:^|[^A-Za-z0-9_])(?:(zerops)[\s:./_-]+)?(zerops_[A-Za-z0-9_]+)/;

/** A title that is a tool's name alone (Grok's `enter_plan_mode`), or one being run. */
const TITLE_NAME_PATTERN = /^(?:Running |Run )?([A-Za-z][A-Za-z0-9_.-]*)\??$/;

/** A title's words that are no tool's name: what ACP agents call a call they did not name. */
const UNNAMED_TITLES: ReadonlySet<string> = new Set(["tool", "terminal", "command"]);

const nameFromTitle = (
  title: string | undefined,
): { readonly name: string; readonly server?: string } | undefined => {
  if (title === undefined) {
    return undefined;
  }
  const mcp = TITLE_MCP_PATTERN.exec(title);
  if (mcp !== null) {
    return { name: mcp[2]!, server: mcp[1]! };
  }
  const zerops = TITLE_ZEROPS_PATTERN.exec(title);
  if (zerops !== null) {
    const server = zerops[1];
    return server === undefined ? { name: zerops[2]! } : { name: zerops[2]!, server };
  }
  const named = TITLE_NAME_PATTERN.exec(title.trim());
  const name = named?.[1];
  return name === undefined || UNNAMED_TITLES.has(name.toLowerCase()) ? undefined : { name };
};

/** ACP's text of a call's own content: `[{type: "content", content: {type: "text", text}}]`. */
const acpContentBlocks = (content: unknown): ReadonlyArray<unknown> =>
  Array.isArray(content)
    ? content.flatMap((entry) =>
        isRecord(entry) && entry.type === "content" && isRecord(entry.content)
          ? [entry.content]
          : [],
      )
    : [];

/**
 * What an ACP call returned: the MCP result an agent passes on as
 * `rawOutput` (`{content: [...]}`, or the text alone) first — the call's
 * own `content` is cut to its tail at 8 000 characters
 * (`AcpRuntimeModel.ts`), a document cut is no document — else that
 * content's text and pictures.
 */
const readAcpResult = (
  data: Record<string, unknown>,
  failed: boolean,
): NonNullable<SpiToolCall["result"]> => {
  const rawOutput = data.rawOutput;
  const rawBlocks = isRecord(rawOutput) ? rawOutput.content : undefined;
  const rawText = isRecord(rawOutput)
    ? Array.isArray(rawBlocks)
      ? readContentText(rawBlocks)
      : undefined
    : readString(rawOutput);
  const contentBlocks = acpContentBlocks(data.content);
  const images = readResultImageFields(Array.isArray(rawBlocks) ? rawBlocks : contentBlocks);
  const contentText = readContentText(contentBlocks);
  const text =
    rawText !== undefined && rawText.length > 0
      ? rawText
      : contentText !== ""
        ? contentText
        : rawText;
  return {
    text: text ?? "",
    failed: failed || (isRecord(rawOutput) && rawOutput.isError === true),
    ...images,
  };
};

/**
 * The ACP agents (Cursor, Grok, Antigravity): `data = {toolCallId, kind?,
 * command?, rawInput?, rawOutput?, content?, locations?}`
 * (`AcpRuntimeModel.ts` `makeToolCallState`). ACP names no tool: an MCP call
 * is known by the name its title carries, a native one by its kind (`read`,
 * `edit`, `execute`, `search`, ...). Its arguments are `rawInput`.
 */
const readAcpToolCallData = (
  itemType: CanonicalItemType,
  data: unknown,
  title: string | undefined,
  status: unknown,
): ToolCallReadResult => {
  const isToolItem = isToolLifecycleItemType(itemType);
  if (!isRecord(data)) {
    return shapeMismatch(itemType, isToolItem, "payload.data is not an object");
  }
  const kind = readString(data.kind);
  // A native kind's title is its presentation ("Ran command", "Read file"):
  // only a call of no kind of its own is named by its title — a command that
  // greps for `zerops_deploy` is no Zerops call.
  const titled = kind === undefined || kind === "other" ? nameFromTitle(title) : undefined;
  const named = titled ?? (kind !== undefined && kind.length > 0 ? { name: kind } : undefined);
  if (named === undefined) {
    return shapeMismatch(itemType, isToolItem, "neither a title nor a kind names the call");
  }
  const base: SpiToolCall = {
    name: named.name,
    rawName: titled !== undefined && title !== undefined ? title : named.name,
    ...(named.server !== undefined ? { server: named.server } : {}),
    ...(data.rawInput !== undefined ? { arguments: data.rawInput } : {}),
  };
  if (status !== "completed" && status !== "failed") {
    return { kind: "toolCall", call: base };
  }
  return { kind: "toolCall", call: { ...base, result: readAcpResult(data, status === "failed") } };
};

const readAcpToolCall = (payload: ItemLifecyclePayload): ToolCallReadResult =>
  readAcpToolCallData(payload.itemType, payload.data, payload.title, payload.status);

const READERS: Partial<Record<string, (payload: ItemLifecyclePayload) => ToolCallReadResult>> = {
  claudeAgent: readClaudeToolCall,
  codex: readCodexToolCall,
  opencode: readOpenCodeToolCall,
  cursor: readAcpToolCall,
  grok: readAcpToolCall,
  antigravity: readAcpToolCall,
};

/**
 * The tool call one event describes, or why it is not one. Only
 * `item.started` / `item.updated` / `item.completed` can carry a tool call;
 * every other event type (and a provider with no reader) reads back
 * `notATool` without failing.
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
 * (Claude's `{toolName, ...}` first, then Codex's `mcpToolCall` item,
 * OpenCode's `{tool, state}`, then an ACP agent's `{toolCallId, ...}` named
 * by `title`), without requiring the caller to know which provider produced
 * it, or which `itemType` the driver classified the item as.
 *
 * `apps/server/src/zerops/**` must still never call this — it reads
 * `event.toolCall` instead, populated by the bus, which DOES know the
 * provider. This exists for the one caller outside that boundary with no
 * `SpiEvent` in hand:
 * `apps/server/src/orchestration/ActivityPayloadProjection.ts` projects a
 * driver-agnostic `OrchestrationThreadActivity` (no `provider` field,
 * built upstream from an already-enriched event) — by the time it reaches
 * that projection, only `payload.data`, the call's title (the activity's
 * summary) and its status survive.
 *
 * Since the caller has no reliable `itemType` either, `unrecognized` here is
 * never loud (there is nothing to log against) — this always resolves to
 * `toolCall` or `notATool`.
 */
export const sniffToolCallShape = (
  data: unknown,
  title?: string,
  status?: unknown,
): ToolCallReadResult => {
  const payload = { itemType: "unknown", data, status } as ItemLifecyclePayload;
  const claude = readClaudeToolCall(payload);
  if (claude.kind === "toolCall") {
    return claude;
  }
  const codex = readCodexToolCall(payload);
  if (codex.kind === "toolCall") {
    return codex;
  }
  if (isRecord(data) && typeof data.tool === "string" && isRecord(data.state)) {
    const openCode = readOpenCodeToolCall(payload);
    return openCode.kind === "toolCall" ? openCode : { kind: "notATool" };
  }
  if (isRecord(data) && typeof data.toolCallId === "string") {
    const acp = readAcpToolCallData("unknown", data, title, status);
    return acp.kind === "toolCall" ? acp : { kind: "notATool" };
  }
  return { kind: "notATool" };
};
