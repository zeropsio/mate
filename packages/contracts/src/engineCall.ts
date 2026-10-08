/**
 * What an engine call's record says besides its step, tool and words: the line it was given, what
 * its row shows, its Zerops result and the parts of it read on demand — what a V1 call's activity
 * payload carries, so a call reads the same on either engine.
 *
 * @module engineCall
 */
import * as Schema from "effect/Schema";

import { ImageOccurrence } from "./assetReference.ts";

/** The longest input line a call's record keeps, in UTF-16 code units (V1's activity detail). */
export const CALL_INPUT_MAX = 180;

/**
 * A picture a Zerops result carried, as a reference to the Mate's content-addressed asset store
 * (rule 8: pictures travel as references, never bytes): its occurrence, as V1's capture stores it
 * (`assets/ConversationMedia.ts`), and its size.
 */
export const CallResultPicture = Schema.Struct({
  mimeType: Schema.String,
  asset: ImageOccurrence,
  width: Schema.optionalKey(Schema.Number),
  height: Schema.optionalKey(Schema.Number),
});
export type CallResultPicture = typeof CallResultPicture.Type;

/**
 * A `zerops_*` call's result, as V1's activity carries it (`ZeropsActivityResult`): the tool's
 * name, its text verbatim — absent while it runs, or when it was over the server's limit
 * (`truncated`) — and its pictures by reference. The client decodes the text into its card.
 */
export const CallResult = Schema.Struct({
  toolName: Schema.String,
  resultText: Schema.optionalKey(Schema.String),
  truncated: Schema.optionalKey(Schema.Boolean),
  images: Schema.optionalKey(Schema.Array(CallResultPicture)),
  imagesDropped: Schema.optionalKey(Schema.Boolean),
});
export type CallResult = typeof CallResult.Type;

/**
 * A call's whole parts, read on demand by name (`engine.readDetail`): its output as the driver
 * streamed it (`detail`), its own record as the driver gave it (`data`), a result cut to the
 * wire's budget (`result`). A newer build's part decodes as its name.
 */
export const CALL_PARTS = ["detail", "data", "result"] as const;

export const callFields = {
  /** What the call was given, as one line: the command, the path, the query. */
  input: Schema.optionalKey(Schema.String),
  /**
   * What its row shows besides its line, in the terms every client's run card reads a call by
   * (V1's projected activity data): the tool's name, the command, the input's named fields, the
   * files it changed, the picture it looked at, whether it wrote, the first line of its output.
   * Bounded by the server; its open keys are for the card, never for a rule.
   */
  shows: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  /** A `zerops_*` call's result. */
  result: Schema.optionalKey(CallResult),
  /** The parts of it that can be read whole on demand. */
  parts: Schema.optionalKey(Schema.Array(Schema.String)),
} as const;

// ── steps ───────────────────────────────────────────────────────────────────────────────────

/** A call's step by the kind of item its driver made it: one step per kind, read back exactly. */
const KIND_STEPS: Readonly<Record<string, string>> = {
  command_execution: "command",
  file_change: "edit",
  web_search: "web",
  image_view: "look",
  collab_agent_tool_call: "helper",
  mcp_tool_call: "mcp",
  dynamic_tool_call: "tool",
};

/** The kind of item each step reads back as on a client: the inverse of `callStep`. */
export const STEP_ITEM_KINDS: Readonly<Record<string, string>> = {
  command: "command_execution",
  edit: "file_change",
  web: "web_search",
  look: "image_view",
  helper: "collab_agent_tool_call",
  mcp: "mcp_tool_call",
  tool: "dynamic_tool_call",
  read: "dynamic_tool_call",
  search: "dynamic_tool_call",
};

/** The tools a generic call reads a file or searches code with, as every driver names them. */
const NAMED_STEPS: Readonly<Record<string, string>> = {
  read: "read",
  "read file": "read",
  grep: "search",
  glob: "search",
  search: "search",
  codesearch: "search",
  list: "search",
  ls: "search",
};

/**
 * The step a call takes: its item's kind, and for a generic call what it did where its tool says
 * so — a file read, a code search — as V1's effort counts it (Claude's `Read: {…}` line, an
 * OpenCode or ACP tool's name or kind, a call titled "Read File").
 */
export function callStep(
  kind: string,
  facts: { readonly line?: string; readonly shows?: Readonly<Record<string, unknown>> },
  title: string | undefined,
): string {
  const step = KIND_STEPS[kind] ?? "tool";
  if (kind !== "dynamic_tool_call") return step;
  const named = /^([A-Za-z][\w-]*):\s*[{[]/.exec(facts.line ?? "")?.[1];
  const toolName = facts.shows?.toolName;
  const own =
    named ??
    (typeof toolName === "string" && !toolName.startsWith("mcp__") ? toolName : undefined) ??
    (typeof facts.shows?.kind === "string" ? facts.shows.kind : undefined) ??
    title;
  return (own === undefined ? undefined : NAMED_STEPS[own.trim().toLowerCase()]) ?? step;
}
