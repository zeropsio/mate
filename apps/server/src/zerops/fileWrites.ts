/**
 * What a call wrote, read from its own payload as the driver sent it: a
 * write's content, an edit's new text — only ever what the agent itself
 * wrote in the call, never the old text it replaced, the lines around a
 * change, or anything it only read. Every driver that sends one:
 *
 * - Claude Code: `Write` (`content`), `Edit` (`new_string`), `MultiEdit`
 *   (each edit's `new_string`), `NotebookEdit` (`new_source`) — `data.input`.
 * - Codex: a `fileChange` item's `changes` (`add` is the content; an
 *   `update`'s added lines, change by change; a `delete` shows nothing).
 * - OpenCode: `write`, `edit`, `multiedit` in camelCase, `patch`/`apply_patch`
 *   as patch text — `data.input` or `data.state.input`.
 * - An ACP agent (Cursor, Grok, Antigravity): its `diff` content blocks — a
 *   new file's text, or the lines the new text adds over `oldText`, worked
 *   out here; `oldText` itself never leaves.
 *
 * A change that only removes is a count of the lines it removed.
 *
 * A call that sends none of these (an ACP edit without a diff block) writes
 * nothing here, and its row keeps the line it has.
 *
 * Pure: no clock, no file system.
 *
 * @module fileWrites
 */
import type { FileWrite, FileWriteChange } from "@t3tools/contracts";

/** A write's text past this is cut at a line. */
export const FILE_WRITE_TEXT_MAX_CHARS = 64 * 1024;

/** Past this many cells the middle of a diff is told whole, removed then added. */
const DIFF_CELL_BUDGET = 1_000_000;

/** A write as the payload has it, before any change is worked out. */
type RawWrite =
  | { readonly path: string; readonly kind: "write" | "edit"; readonly content: string }
  /** Edits that name their new text: Claude's and OpenCode's `old`/`new` strings. */
  | {
      readonly path: string;
      readonly kind: "edit";
      readonly edits: ReadonlyArray<readonly [before: string, after: string]>;
    }
  /** A whole file before and after (an ACP diff): what it adds is worked out. */
  | { readonly path: string; readonly kind: "edit"; readonly whole: readonly [string, string] }
  /** A unified diff or a patch's update: its added lines, its removed ones counted. */
  | { readonly path: string; readonly kind: "edit"; readonly diff: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A path exactly as the call named it, never trimmed: `/a ` is another file than `/a`. */
function asPath(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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
function acpWrites(
  content: ReadonlyArray<unknown>,
  rawInput: Record<string, unknown> | null,
): RawWrite[] {
  const blocks = content.flatMap((entry) => {
    const block = asRecord(entry);
    const path = asPath(block?.path);
    return block?.type === "diff" && path !== null && typeof block.newText === "string"
      ? [{ path, oldText: block.oldText, newText: block.newText }]
      : [];
  });
  // One file changed, and the call's own input says what the agent wrote
  // there: that, never what the server would work out from the whole file.
  const [only] = blocks;
  if (blocks.length === 1 && only !== undefined && rawInput !== null) {
    const after = firstString(rawInput, NEW_KEYS);
    if (after !== null) {
      const before = firstString(rawInput, OLD_KEYS) ?? "";
      return [{ path: only.path, kind: "edit", edits: [[before, after]] }];
    }
    const written = firstString(rawInput, ["content"]);
    if (written !== null) return [{ path: only.path, kind: "write", content: written }];
  }
  return blocks.map((block): RawWrite =>
    typeof block.oldText === "string"
      ? { path: block.path, kind: "edit", whole: [block.oldText, block.newText] }
      : { path: block.path, kind: "write", content: block.newText },
  );
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
    return path === null || pair === null ? [] : [{ path, kind: "edit", edits: [pair] }];
  }
  if (tool === "multiedit") {
    if (path === null || !Array.isArray(input.edits)) return [];
    const pairs = input.edits.flatMap((entry) => {
      const edit = asRecord(entry);
      const pair = edit === null ? null : editPair(edit);
      return pair === null ? [] : [pair];
    });
    return pairs.length === 0 ? [] : [{ path, kind: "edit", edits: pairs }];
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
    const acp = acpWrites(record.content, asRecord(record.rawInput));
    if (acp.length > 0) return acp;
  }
  const name = asPath(record.toolName) ?? asPath(record.tool);
  const input =
    asRecord(record.input) ?? asRecord(asRecord(record.state)?.input) ?? asRecord(record.rawInput);
  return name === null || input === null ? [] : toolWrites(name, input);
}

/** Whether a raw write has anything to show, without working out its changes. */
function drawsSomething(write: RawWrite): boolean {
  if ("content" in write) return write.content.length > 0;
  if ("diff" in write)
    return write.diff.split("\n").some((line) => /^[+-](?![+-]{2} )/u.test(line));
  // A whole file before and after: some line is new, or gone — lines only
  // moved about change nothing a reader is shown.
  if ("whole" in write) {
    const before = new Set(linesOf(write.whole[0]));
    const after = new Set(linesOf(write.whole[1]));
    return (
      [...after].some((line) => !before.has(line)) || [...before].some((line) => !after.has(line))
    );
  }
  return write.edits.some(([before, after]) => before !== after);
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

/** One run of removed and added lines between kept ones. */
interface Run {
  readonly removed: ReadonlyArray<string>;
  readonly added: ReadonlyArray<string>;
}

/** Lines as runs: each run of removed and added lines between kept ones. */
function runsOf(ops: ReadonlyArray<Op>): Run[] {
  const runs: Run[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const close = () => {
    if (added.length > 0 || removed.length > 0) runs.push({ removed, added });
    added = [];
    removed = [];
  };
  for (const [mark, line] of ops) {
    if (mark === " ") close();
    else if (mark === "+") added.push(line);
    else removed.push(line);
  }
  close();
  return runs;
}

/** A run's lines that it both removes and adds unchanged: each pair dropped, no change. */
function withoutTies(run: Run): Run {
  const removed = [...run.removed];
  const added = run.added.filter((line) => {
    const at = removed.indexOf(line);
    if (at === -1) return true;
    removed.splice(at, 1);
    return false;
  });
  return { removed, added };
}

/**
 * What the added text holds past what it shares with the removed at both
 * ends, an ellipsis where it was cut: `…db2…`.
 */
function differingPart(removed: string, added: string): string {
  if (removed.length === 0 || added.length === 0) return added;
  const most = Math.min(removed.length, added.length);
  let prefix = 0;
  while (prefix < most && removed[prefix] === added[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < most - prefix &&
    removed[removed.length - 1 - suffix] === added[added.length - 1 - suffix]
  ) {
    suffix++;
  }
  const middle = added.slice(prefix, added.length - suffix);
  if (middle.length === 0) return "";
  return `${prefix > 0 ? "…" : ""}${middle}${suffix > 0 ? "…" : ""}`;
}

/** Runs as changes: what each shows of its added lines, and how many it removed. */
function changesOfRuns(runs: ReadonlyArray<Run>, text: (run: Run) => string): FileWriteChange[] {
  return runs
    .filter((run) => run.added.length > 0 || run.removed.length > 0)
    .map((run) => ({ text: text(run), removedLines: run.removed.length }));
}

/**
 * What the new text adds over the old, change by change, as narrow as the
 * text allows — the server works it out, so it shows no more than differs:
 * a line that stands unchanged anywhere in the old text is never added (nor
 * one still in the new text removed), and each change is cut to the
 * characters that differ, an ellipsis where it was cut (`…db2…`). How many
 * lines each removed is counted. Unchanged text changes nothing.
 */
export function lineChanges(before: string, after: string): FileWriteChange[] {
  if (before === after) return [];
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
  const oldLines = new Set(a);
  const newLines = new Set(b);
  const runs = runsOf(
    middleOps(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
  ).map((run) => ({
    removed: run.removed.filter((line) => !newLines.has(line)),
    added: run.added.filter((line) => !oldLines.has(line)),
  }));
  return changesOfRuns(runs, (run) => differingPart(run.removed.join("\n"), run.added.join("\n")));
}

/**
 * A unified diff's or a patch update's changes: its `+` lines — whole lines
 * the agent's patch wrote — its `-` lines counted; context lines, hunk
 * headers (`@@ …` and what follows them) and file headers never leave. A line
 * a run both removes and adds unchanged is no change, and never shown.
 */
function diffChanges(diff: string): FileWriteChange[] {
  const ops: Op[] = [];
  for (const line of diff.split("\n")) {
    if (/^(?:--- |\+\+\+ |diff --git |index |\\ No newline|\*\*\* )/u.test(line)) continue;
    if (line.startsWith("+")) ops.push(["+", line.slice(1)]);
    else if (line.startsWith("-")) ops.push(["-", line.slice(1)]);
    // A context line, a hunk header, an empty line: a break between changes.
    else ops.push([" ", ""]);
  }
  return changesOfRuns(runsOf(ops).map(withoutTies), (run) => run.added.join("\n"));
}

/** The changes cut at the cap, at the end of a line; whether any was cut. */
function capped(changes: ReadonlyArray<FileWriteChange>): {
  readonly changes: FileWriteChange[];
  readonly truncated: boolean;
} {
  const kept: FileWriteChange[] = [];
  let room = FILE_WRITE_TEXT_MAX_CHARS;
  for (const change of changes) {
    if (change.text.length <= room) {
      kept.push(change);
      room -= change.text.length;
      continue;
    }
    const head = change.text.slice(0, room);
    const lineEnd = head.lastIndexOf("\n");
    const text = lineEnd > 0 ? head.slice(0, lineEnd) : head;
    if (text.length > 0) kept.push({ text, removedLines: change.removedLines });
    return { changes: kept, truncated: true };
  }
  return { changes: kept, truncated: false };
}

function drawn(write: RawWrite): FileWrite {
  const changes =
    "content" in write
      ? [{ text: write.content, removedLines: 0 }]
      : "diff" in write
        ? diffChanges(write.diff)
        : "whole" in write
          ? lineChanges(write.whole[0], write.whole[1])
          : write.edits
              .filter(([before, after]) => before !== after)
              .map(([before, after]) => ({
                text: after,
                removedLines: linesOf(before).length,
              }));
  return { path: write.path, kind: write.kind, ...capped(changes) };
}

/** Each file a call's payload shows it wrote, with what it wrote; nothing where it shows none. */
export function readFileWrites(data: unknown): FileWrite[] {
  return rawWrites(data)
    .filter(drawsSomething)
    .map(drawn)
    .filter((write) => write.changes.length > 0);
}

/** Whether a call's payload shows anything it wrote — cheap: no diff is worked out. */
export function hasFileWrites(data: unknown): boolean {
  return rawWrites(data).some(drawsSomething);
}

/**
 * Every path a call's payload shows it wrote or edited, an empty write too,
 * exactly as named; never a deleted one, nor one with a space around it.
 */
export function readFileWritePaths(data: unknown): string[] {
  // A path with a space or a line end around it may be one the tool trimmed
  // before writing: whichever file it wrote, it is not the one named here.
  return [
    ...new Set(
      rawWrites(data)
        .map((write) => write.path)
        .filter((path) => path === path.trim()),
    ),
  ];
}
