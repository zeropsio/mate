/**
 * What a call wrote, read from its own payload as the driver sent it: a new
 * file's content, an edit's change. Every driver that sends one:
 *
 * - Claude Code: `Write` (`content`), `Edit` (`old_string`/`new_string`),
 *   `MultiEdit` (`edits`), `NotebookEdit` (`new_source`) — `data.input`.
 * - Codex: a `fileChange` item's `changes` (`add` is the content, `update` a
 *   unified diff; a `delete` wrote nothing to show) — `data.item`.
 * - OpenCode: `write`, `edit`, `multiedit` in camelCase, `patch`/`apply_patch`
 *   as patch text — `data.input` or `data.state.input`.
 * - An ACP agent (Cursor, Grok, Antigravity): its `diff` content blocks,
 *   `oldText` absent for a new file — `data.content`.
 *
 * A call that sends none of these (an ACP edit without a diff block) writes
 * nothing here, and its row keeps the line it has.
 *
 * Pure: no clock, no file system.
 *
 * @module fileWrites
 */
import type { FileWrite } from "@t3tools/contracts";

/** A write's text past this is cut at a line: the file itself holds the rest. */
export const FILE_WRITE_TEXT_MAX_CHARS = 64 * 1024;

/** Lines of the file kept around each change. */
const CONTEXT_LINES = 3;

/** Past this many cells the middle of a diff is told whole, removed then added. */
const DIFF_CELL_BUDGET = 1_000_000;

/** A write as the payload has it, before any diff is worked out. */
type RawWrite =
  | { readonly path: string; readonly kind: "write" | "edit"; readonly content: string }
  | {
      readonly path: string;
      readonly kind: "edit";
      readonly pairs: ReadonlyArray<readonly [before: string, after: string]>;
    }
  | { readonly path: string; readonly kind: "edit"; readonly diff: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asPath(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstString(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

const OLD_KEYS = ["old_string", "oldString"] as const;
const NEW_KEYS = ["new_string", "newString"] as const;

function editPair(record: Record<string, unknown>): readonly [string, string] | null {
  const before = firstString(record, OLD_KEYS);
  const after = firstString(record, NEW_KEYS);
  return before === null || after === null ? null : [before, after];
}

/** Codex's `fileChange` item: a write per change, a delete none. */
function codexWrites(item: Record<string, unknown>): RawWrite[] {
  if (item.type !== "fileChange" || !Array.isArray(item.changes)) return [];
  return item.changes.flatMap((entry): RawWrite[] => {
    const change = asRecord(entry);
    const kind = asRecord(change?.kind)?.type;
    const diff = change?.diff;
    if (change === null || typeof diff !== "string") return [];
    const path = asPath(asRecord(change.kind)?.move_path) ?? asPath(change.path);
    if (path === null) return [];
    if (kind === "add") return [{ path, kind: "write", content: diff }];
    if (kind === "update") return [{ path, kind: "edit", diff }];
    return [];
  });
}

/** An ACP agent's `diff` blocks: `oldText` absent is a new file. */
function acpWrites(content: ReadonlyArray<unknown>): RawWrite[] {
  return content.flatMap((entry): RawWrite[] => {
    const block = asRecord(entry);
    const path = asPath(block?.path);
    if (block?.type !== "diff" || path === null || typeof block.newText !== "string") return [];
    return typeof block.oldText === "string"
      ? [{ path, kind: "edit", pairs: [[block.oldText, block.newText]] }]
      : [{ path, kind: "write", content: block.newText }];
  });
}

/**
 * Patch text in the `apply_patch` form (`*** Add File:`, `*** Update File:`,
 * `*** Delete File:`): an added file's lines are its content, an update's
 * its diff. A deleted file wrote nothing to show.
 */
function patchWrites(patch: string): RawWrite[] {
  const writes: RawWrite[] = [];
  let current: { path: string; kind: "add" | "update" | "delete"; lines: string[] } | null = null;
  const flush = () => {
    if (current === null) return;
    if (current.kind === "add") {
      writes.push({
        path: current.path,
        kind: "write",
        content: current.lines
          .map((line) => (line.startsWith("+") ? line.slice(1) : line))
          .join("\n"),
      });
    } else if (current.kind === "update") {
      writes.push({ path: current.path, kind: "edit", diff: current.lines.join("\n") });
    }
    current = null;
  };
  for (const line of patch.split("\n")) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/u.exec(line);
    if (header !== null) {
      flush();
      const path = asPath(header[2]);
      if (path !== null) {
        current = {
          path,
          kind: header[1] === "Add" ? "add" : header[1] === "Update" ? "update" : "delete",
          lines: [],
        };
      }
      continue;
    }
    if (/^\*\*\* (Begin|End) Patch\b/u.test(line)) {
      flush();
      continue;
    }
    const moved = /^\*\*\* Move to: (.+)$/u.exec(line);
    if (moved !== null && current !== null) {
      const path = asPath(moved[1]);
      if (path !== null) current.path = path;
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return writes;
}

/** A named tool's input: Claude's and OpenCode's write, edit, multi-edit, notebook and patch. */
function toolWrites(name: string, input: Record<string, unknown>): RawWrite[] {
  const tool = name.toLowerCase();
  const path = asPath(input.file_path) ?? asPath(input.filePath);
  if (tool === "write") {
    const content = firstString(input, ["content"]);
    return path === null || content === null ? [] : [{ path, kind: "write", content }];
  }
  if (tool === "edit") {
    const pair = editPair(input);
    return path === null || pair === null ? [] : [{ path, kind: "edit", pairs: [pair] }];
  }
  if (tool === "multiedit") {
    if (path === null || !Array.isArray(input.edits)) return [];
    const pairs = input.edits.flatMap((entry) => {
      const edit = asRecord(entry);
      const pair = edit === null ? null : editPair(edit);
      return pair === null ? [] : [pair];
    });
    return pairs.length === 0 ? [] : [{ path, kind: "edit", pairs }];
  }
  if (tool === "notebookedit") {
    const notebook = asPath(input.notebook_path) ?? path;
    const source = firstString(input, ["new_source"]);
    return notebook === null || source === null || input.edit_mode === "delete"
      ? []
      : [{ path: notebook, kind: "edit", content: source }];
  }
  if (tool === "patch" || tool === "apply_patch") {
    const patch = firstString(input, ["patchText", "patch", "input"]);
    return patch === null ? [] : patchWrites(patch);
  }
  return [];
}

function rawWrites(data: unknown): RawWrite[] {
  const record = asRecord(data);
  if (record === null) return [];
  const item = asRecord(record.item);
  if (item !== null) return codexWrites(item);
  if (Array.isArray(record.content)) {
    const acp = acpWrites(record.content);
    if (acp.length > 0) return acp;
  }
  const name = asPath(record.toolName) ?? asPath(record.tool);
  const input =
    asRecord(record.input) ?? asRecord(asRecord(record.state)?.input) ?? asRecord(record.rawInput);
  return name === null || input === null ? [] : toolWrites(name, input);
}

/** Whether a raw write has anything to draw, without working out its diff. */
function drawsSomething(write: RawWrite): boolean {
  if ("content" in write) return write.content.length > 0;
  if ("diff" in write) return write.diff.trim().length > 0;
  return write.pairs.some(([before, after]) => before !== after);
}

/** Lines of a text; an empty text has none. */
function linesOf(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

type Op = readonly [mark: " " | "-" | "+", line: string];

/** The middle of a diff by its longest common lines, or whole past the budget. */
function middleOps(before: ReadonlyArray<string>, after: ReadonlyArray<string>): Op[] {
  const n = before.length;
  const m = after.length;
  if (n === 0 || m === 0 || n * m > DIFF_CELL_BUDGET) {
    return [...before.map((line): Op => ["-", line]), ...after.map((line): Op => ["+", line])];
  }
  // lengths[i * (m + 1) + j]: the longest common run of before[i..] and after[j..].
  const lengths = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * (m + 1) + j] =
        before[i] === after[j]
          ? lengths[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(lengths[(i + 1) * (m + 1) + j]!, lengths[i * (m + 1) + j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push([" ", before[i]!]);
      i++;
      j++;
    } else if (lengths[(i + 1) * (m + 1) + j]! >= lengths[i * (m + 1) + j + 1]!) {
      ops.push(["-", before[i]!]);
      i++;
    } else {
      ops.push(["+", after[j]!]);
      j++;
    }
  }
  while (i < n) ops.push(["-", before[i++]!]);
  while (j < m) ops.push(["+", after[j++]!]);
  return ops;
}

/**
 * A change as its lines: `-` removed, `+` added, ` ` kept around a change,
 * `@@` where unchanged lines are left out. Unchanged text is the empty diff.
 */
export function lineDiff(before: string, after: string): string {
  if (before === after) return "";
  const a = linesOf(before);
  const b = linesOf(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const ops: Op[] = [
    ...a.slice(0, prefix).map((line): Op => [" ", line]),
    ...middleOps(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
    ...a.slice(a.length - suffix).map((line): Op => [" ", line]),
  ];
  const near = new Uint8Array(ops.length);
  ops.forEach(([mark], index) => {
    if (mark === " ") return;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(ops.length - 1, index + CONTEXT_LINES);
    for (let at = from; at <= to; at++) near[at] = 1;
  });
  const out: string[] = [];
  ops.forEach(([mark, line], index) => {
    if (near[index] === 1) {
      out.push(`${mark}${line}`);
    } else if (out.at(-1) !== "@@") {
      out.push("@@");
    }
  });
  return out.join("\n");
}

/** A unified diff's lines as drawn: its file headers dropped, each hunk's header a bare `@@`. */
function normalizeDiff(diff: string): string {
  return diff
    .split("\n")
    .filter(
      (line) =>
        !/^(?:--- |\+\+\+ |diff --git |index |\\ No newline)/u.test(line) && line.length > 0,
    )
    .map((line) => (line.startsWith("@@") ? "@@" : line))
    .join("\n");
}

/** A text cut at the cap, at the end of a line. */
function capped(text: string): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= FILE_WRITE_TEXT_MAX_CHARS) return { text, truncated: false };
  const head = text.slice(0, FILE_WRITE_TEXT_MAX_CHARS);
  const lineEnd = head.lastIndexOf("\n");
  return { text: lineEnd > 0 ? head.slice(0, lineEnd) : head, truncated: true };
}

function drawn(write: RawWrite): FileWrite {
  if ("content" in write) {
    return { path: write.path, kind: write.kind, format: "content", ...capped(write.content) };
  }
  const text =
    "diff" in write
      ? normalizeDiff(write.diff)
      : write.pairs
          .map(([before, after]) => lineDiff(before, after))
          .filter((diff) => diff.length > 0)
          .join("\n@@\n");
  return { path: write.path, kind: "edit", format: "diff", ...capped(text) };
}

/** Each file a call's payload shows it wrote, with what it wrote; nothing where it shows none. */
export function readFileWrites(data: unknown): FileWrite[] {
  return rawWrites(data).filter(drawsSomething).map(drawn);
}

/** Whether a call's payload shows anything it wrote — cheap: no diff is worked out. */
export function hasFileWrites(data: unknown): boolean {
  return rawWrites(data).some(drawsSomething);
}

/** Every path a call's payload shows it wrote or edited, an empty write too; never a deleted one. */
export function readFileWritePaths(data: unknown): string[] {
  return [...new Set(rawWrites(data).map((write) => write.path))];
}
