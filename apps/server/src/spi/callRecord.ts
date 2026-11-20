/**
 * A call's record, cut once from its driver's `payload.data`: what the call wrote and nothing
 * else (`CallRecord`). The driver's payload carries the call's result, its output and every
 * picture as bytes; none of them is kept (rule 8: pictures travel as references, never bytes —
 * the result's pictures are stored as assets and named in the call's body). Every driver that
 * writes:
 *
 * - Claude Code: `Write`, `Edit`, `MultiEdit`, `NotebookEdit` — `data.input`.
 * - Codex: a `fileChange` item's `changes`.
 * - OpenCode: `write`, `edit`, `multiedit`, `patch`/`apply_patch` — `data.input` or
 *   `data.state.input`, never the rest of `state` (its output and attachments).
 * - An ACP agent: its `diff` content blocks, with its `rawInput`; one without a diff block by its
 *   tool's name, as the others.
 *
 * The engine's pump stores what this returns beside a closing call; the tool-activity projection
 * marks a call that wrote by it. `zerops/fileWrites.ts` reads the record it returns. Pure.
 *
 * @module spi/callRecord
 */
import { CALL_RECORD_INPUT_KEYS, type CallRecord, type CallRecordInput } from "@t3tools/contracts";

/** The tools whose input is what they wrote, by lower-case name. */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "write",
  "edit",
  "multiedit",
  "notebookedit",
  "patch",
  "apply_patch",
]);

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A name or a path exactly as given, when it says anything. */
const asNamed = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/** An input's fields that say what it wrote; none when it has none of them. */
const writtenInput = (input: Readonly<Record<string, unknown>>): CallRecordInput | null => {
  const kept: Record<string, unknown> = {};
  for (const key of CALL_RECORD_INPUT_KEYS) {
    if (input[key] !== undefined) kept[key] = input[key];
  }
  return Object.keys(kept).length === 0 ? null : kept;
};

/** What a call wrote, cut from its driver's payload; none when it wrote nothing. */
export function callRecord(payload: unknown): CallRecord | null {
  const data = asRecord(payload);
  if (data === null) return null;
  // A Codex item is a `fileChange`, or a call that wrote nothing.
  const item = asRecord(data.item);
  if (item !== null) {
    if (item.type !== "fileChange" || !Array.isArray(item.changes)) return null;
    const changes = item.changes.flatMap((entry) => {
      const change = asRecord(entry);
      return change === null ? [] : [{ path: change.path, kind: change.kind, diff: change.diff }];
    });
    return changes.length === 0 ? null : { item: { type: "fileChange", changes } };
  }
  if (Array.isArray(data.content)) {
    const content = data.content.flatMap((entry) => {
      const block = asRecord(entry);
      const path = asNamed(block?.path);
      if (block?.type !== "diff" || path === null || typeof block.newText !== "string") return [];
      return [
        {
          type: "diff" as const,
          path,
          ...(typeof block.oldText === "string" ? { oldText: block.oldText } : {}),
          newText: block.newText,
        },
      ];
    });
    if (content.length > 0) {
      const rawInput = asRecord(data.rawInput);
      const kept = rawInput === null ? null : writtenInput(rawInput);
      return kept === null ? { content } : { content, rawInput: kept };
    }
  }
  const toolName = asNamed(data.toolName) ?? asNamed(data.tool);
  if (toolName === null || !WRITE_TOOLS.has(toolName.toLowerCase())) return null;
  const input =
    asRecord(data.input) ?? asRecord(asRecord(data.state)?.input) ?? asRecord(data.rawInput);
  const kept = input === null ? null : writtenInput(input);
  return kept === null ? null : { toolName, input: kept };
}
