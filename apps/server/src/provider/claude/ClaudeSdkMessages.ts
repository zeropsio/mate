import * as Schema from "effect/Schema";
import * as Exit from "effect/Exit";
import type { ClaudeTextStreamKind } from "./ClaudeSessionState.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));
export const decodeUnknownJsonStringExit = Schema.decodeUnknownExit(
  Schema.fromJsonString(Schema.Unknown),
);

export function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

/**
 * The texts Claude Code itself writes for a reply that says nothing — after a turn with no answer
 * ("No response requested.", which a model also writes on a woken turn it has nothing to say on)
 * and for a reply with no content — and never shows as one (its `kEe`/`DDr`: the trimmed text
 * equal to either is no reply, whatever model wrote it).
 */
const CLAUDE_PLACEHOLDERS: ReadonlyArray<string> = ["No response requested.", "(no content)"];

/** The whole text is Claude Code's no-reply placeholder. */
export const isClaudePlaceholder = (text: string): boolean =>
  CLAUDE_PLACEHOLDERS.includes(text.trim());

/** What streamed so far could still become the placeholder. */
export const isClaudePlaceholderPrefix = (text: string): boolean => {
  const start = text.trimStart();
  return CLAUDE_PLACEHOLDERS.some((placeholder) => placeholder.startsWith(start));
};

export function streamKindFromDeltaType(deltaType: string): ClaudeTextStreamKind {
  // Claude never returns the raw chain of thought. A thinking delta is the
  // API-side summary (or a progress-update sentence) when display is
  // summarized; map it onto the summary stream so it shares the Codex/Grok
  // reasoning-summary path rather than looking like a raw trace we do not have.
  return deltaType.includes("thinking") ? "reasoning_summary_text" : "assistant_text";
}

function extractAssistantContentBlocks(
  message: SDKMessage,
  blockType: "text" | "thinking",
  field: "text" | "thinking",
): Array<string> {
  if (message.type !== "assistant") {
    return [];
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const fragments: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const candidate = block as { type?: unknown; text?: unknown; thinking?: unknown };
    const value = field === "thinking" ? candidate.thinking : candidate.text;
    if (candidate.type === blockType && typeof value === "string" && value.length > 0) {
      fragments.push(value);
    }
  }

  return fragments;
}

export function extractAssistantTextBlocks(message: SDKMessage): Array<string> {
  return extractAssistantContentBlocks(message, "text", "text");
}

export function extractAssistantThinkingBlocks(message: SDKMessage): Array<string> {
  return extractAssistantContentBlocks(message, "thinking", "thinking");
}

export function extractContentBlockText(block: unknown): string {
  if (!block || typeof block !== "object") {
    return "";
  }

  const candidate = block as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractTextContent(entry)).join("");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as {
    text?: unknown;
    content?: unknown;
  };

  if (typeof record.text === "string") {
    return record.text;
  }

  return extractTextContent(record.content);
}

export function toolResultBlocksFromUserMessage(message: SDKMessage): Array<{
  readonly toolUseId: string;
  readonly block: Record<string, unknown>;
  readonly text: string;
  readonly isError: boolean;
}> {
  if (message.type !== "user") {
    return [];
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: Array<{
    readonly toolUseId: string;
    readonly block: Record<string, unknown>;
    readonly text: string;
    readonly isError: boolean;
  }> = [];

  for (const entry of content) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const block = entry as Record<string, unknown>;
    if (block.type !== "tool_result") {
      continue;
    }

    const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
    if (!toolUseId) {
      continue;
    }

    blocks.push({
      toolUseId,
      block,
      text: extractTextContent(block.content),
      isError: block.is_error === true,
    });
  }

  return blocks;
}

/**
 * Claude's own word for a result that is no execution (`tool_result_meta`, not
 * yet in the SDK's message type): `cancelled` when the call was stopped before
 * it ran, which its error text alone cannot tell apart from a refusal.
 */
export function toolNonExecutionKind(message: SDKMessage, toolUseId: string): string | undefined {
  const meta = (message as { readonly tool_result_meta?: unknown }).tool_result_meta;
  if (!Array.isArray(meta)) return undefined;
  const entry: unknown = meta.find(
    (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { readonly id?: unknown }).id === toolUseId,
  );
  const kind = (entry as { readonly non_execution_kind?: unknown } | undefined)?.non_execution_kind;
  return typeof kind === "string" ? kind : undefined;
}

export function sdkMessageType(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { type?: unknown };
  return typeof record.type === "string" ? record.type : undefined;
}

function sdkMessageSubtype(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { subtype?: unknown };
  return typeof record.subtype === "string" ? record.subtype : undefined;
}

export function sdkNativeMethod(message: SDKMessage): string {
  const subtype = sdkMessageSubtype(message);
  if (subtype) {
    return `claude/${message.type}/${subtype}`;
  }

  if (message.type === "stream_event") {
    const streamType = sdkMessageType(message.event);
    if (streamType) {
      const deltaType =
        streamType === "content_block_delta"
          ? sdkMessageType((message.event as { delta?: unknown }).delta)
          : undefined;
      if (deltaType) {
        return `claude/${message.type}/${streamType}/${deltaType}`;
      }
      return `claude/${message.type}/${streamType}`;
    }
  }

  return `claude/${message.type}`;
}

// Discriminator/identity keys carry no human-readable content; everything else
// on an unmodeled SDK message is potentially worth surfacing in the work log.
const SDK_MESSAGE_NOISE_KEYS = new Set([
  "type",
  "subtype",
  "uuid",
  "parent_uuid",
  "session_id",
  "parent_tool_use_id",
  "request_id",
]);

// Pull the salient scalar content out of a message the adapter doesn't model
// yet, so the work-log row shows what actually arrived (e.g. a notification's
// text) instead of an opaque "unhandled subtype" placeholder. Nested structures
// are left to the full payload retained in the event's `detail`.
function previewUnknownSdkContent(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(message as Record<string, unknown>)) {
    if (SDK_MESSAGE_NOISE_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        parts.push(`${key}: ${trimmed}`);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  if (parts.length === 0) {
    return undefined;
  }
  const joined = parts.join(" · ");
  return joined.length > 280 ? `${joined.slice(0, 279)}…` : joined;
}

export function describeUnknownSdkMessage(kind: string, message: unknown): string {
  const preview = previewUnknownSdkContent(message);
  return preview ? `${kind} — ${preview}` : `${kind} (no displayable text content)`;
}

export function sdkNativeItemId(message: SDKMessage): string | undefined {
  if (message.type === "assistant") {
    const maybeId = (message.message as { id?: unknown }).id;
    if (typeof maybeId === "string") {
      return maybeId;
    }
    return undefined;
  }

  if (message.type === "user") {
    return toolResultBlocksFromUserMessage(message)[0]?.toolUseId;
  }

  if (message.type === "stream_event") {
    const event = message.event as {
      type?: unknown;
      content_block?: { id?: unknown };
    };
    if (event.type === "content_block_start" && typeof event.content_block?.id === "string") {
      return event.content_block.id;
    }
  }

  return undefined;
}
