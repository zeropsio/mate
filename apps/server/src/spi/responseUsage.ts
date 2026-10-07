import { ResponseUsageCompletedPayload, type UsageComponents } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

const completedUsage = Schema.decodeSync(ResponseUsageCompletedPayload);
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

function record(value: unknown): Record<string, unknown> | undefined {
  return Option.getOrUndefined(decodeRecord(value));
}
function text(value: unknown): string | null {
  return Predicate.isString(value) && value.trim().length > 0 ? value.trim() : null;
}
function quantity(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Predicate.isNumber(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid provider response token quantity");
  }
  return String(value);
}
function claudeComponents(usage: Record<string, unknown>): UsageComponents {
  return {
    uncachedInput: quantity(usage.input_tokens),
    cachedInput: quantity(usage.cache_read_input_tokens),
    cacheCreation: quantity(usage.cache_creation_input_tokens),
    output: quantity(usage.output_tokens),
    reasoning: quantity(record(usage.output_tokens_details)?.thinking_tokens),
    inclusiveTotal: null,
  };
}
interface ClaudeResponse {
  readonly id: string;
  readonly model: string | null;
  usage: Record<string, unknown>;
  completed: boolean;
}

/**
 * Message streams are independent by sidechain. Per-block assistant snapshots are not final.
 * Claude Code's subagent progress currently forwards assistant/user blocks but drops the child
 * stream completion frames. Those null-stop snapshots cannot supply exact child consumption.
 */
export function makeClaudeResponseUsage(): (
  message: unknown,
) => ReadonlyArray<ResponseUsageCompletedPayload> {
  const responses = new Map<string | null, ClaudeResponse>();
  return (message) => {
    const envelope = record(message);
    if (!envelope) return [];
    const nativeThreadId = text(envelope.session_id);
    if (!nativeThreadId) return [];
    const parentId = text(envelope.parent_tool_use_id);
    const fact = (response: ClaudeResponse): ResponseUsageCompletedPayload =>
      completedUsage({
        nativeThreadId,
        nativeResponseId: response.id,
        model: response.model,
        components: claudeComponents(response.usage),
        nativeCost: null,
        parentId,
      });
    if (envelope.type === "stream_event") {
      const event = record(envelope.event);
      if (event?.type === "message_start") {
        const start = record(event.message);
        const id = text(start?.id);
        const usage = record(start?.usage);
        if (id && usage)
          responses.set(parentId, { id, model: text(start?.model), usage, completed: false });
      } else if (event?.type === "message_delta") {
        const response = responses.get(parentId);
        if (response) {
          response.usage = { ...response.usage, ...record(event.usage) };
          response.completed = text(record(event.delta)?.stop_reason) !== null;
        }
      } else if (event?.type === "message_stop") {
        const response = responses.get(parentId);
        responses.delete(parentId);
        if (response?.completed) return [fact(response)];
      }
    } else if (envelope.type === "assistant" && envelope.aborted !== true && !envelope.error) {
      const snapshot = record(envelope.message);
      const id = text(snapshot?.id);
      const usage = record(snapshot?.usage);
      if (
        id &&
        usage &&
        text(snapshot?.stop_reason) &&
        text(snapshot?.model) !== "<synthetic>" &&
        !responses.has(parentId)
      ) {
        return [fact({ id, model: text(snapshot?.model), usage, completed: true })];
      }
    }
    return [];
  };
}

/** rawResponse/completed is the native per-response meter; thread counters are UI context only. */
export function codexResponseUsage(
  payload: unknown,
  model: string | null,
  parentId: string | null,
): ResponseUsageCompletedPayload | undefined {
  const response = record(payload);
  const nativeThreadId = text(response?.threadId);
  const nativeResponseId = text(response?.responseId);
  const usage = record(response?.usage);
  if (!nativeThreadId || !nativeResponseId || !usage) return undefined;
  const input = quantity(usage.inputTokens);
  const cached = quantity(usage.cachedInputTokens);
  const written = quantity(usage.cacheWriteInputTokens);
  const uncached =
    input !== null && cached !== null && written !== null
      ? BigInt(input) - BigInt(cached) - BigInt(written)
      : null;
  if (uncached !== null && uncached < 0n) {
    throw new Error("Provider response cache tokens exceed input tokens");
  }
  return completedUsage({
    nativeThreadId,
    nativeResponseId,
    model,
    components: {
      uncachedInput: uncached !== null ? String(uncached) : null,
      cachedInput: cached,
      cacheCreation: written,
      output: quantity(usage.outputTokens),
      reasoning: quantity(usage.reasoningOutputTokens),
      inclusiveTotal: quantity(usage.totalTokens),
    },
    nativeCost: null,
    parentId,
  });
}
