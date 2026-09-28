import type { MessagesTimelineRow, RunStatus } from "./MessagesTimeline.logic";

/** What a stretch came to, as the turn map colours its mark. */
export type TimelineMinimapTone = "produced" | "failed" | "paused" | "quiet";

export interface TimelineMinimapItem {
  readonly id: string;
  readonly rowIndex: number;
  readonly userText: string | null;
  readonly assistantText: string | null;
  readonly tone: TimelineMinimapTone;
  /** How long the Mate worked after it: 0 under ten minutes, 1 under an hour, 2 longer. */
  readonly weight: 0 | 1 | 2;
  /** Sent into a running turn: a dot on the map, not a line. */
  readonly aside: boolean;
  /** The work line's words, for a stretch that ended without an answer. */
  readonly note: string | null;
}

/** A message the person sent into a running turn: its run's line and answer come after it. */
function isAside(row: MessagesTimelineRow): boolean {
  return row.kind === "message" && row.message.role === "user" && row.aside;
}

/**
 * The run a message started, past the messages sent into it, which stand
 * first: its chat, which says its status on its last line, or its line where
 * it has no chat.
 */
function runAfter(
  rows: ReadonlyArray<MessagesTimelineRow>,
  index: number,
): { readonly row: MessagesTimelineRow; readonly status: RunStatus } | null {
  for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
    const row = rows[cursor]!;
    if (row.kind === "work-line") return { row, status: row };
    if (row.kind === "record" && row.status !== null) return { row, status: row.status };
    if (row.kind === "message" && row.message.role === "user" && !row.aside) return null;
  }
  return null;
}

/** The Mate's latest words in the run's chat, one line: what a preview quotes of its work. */
function lastNoteOf(row: MessagesTimelineRow): string | null {
  if (row.kind !== "record") return null;
  const note = row.items.findLast((item) => item.kind === "note");
  if (note?.kind !== "note") return null;
  const first =
    note.message.text
      .trim()
      .split("\n")[0]
      ?.replace(/[*_`#>]/g, "")
      .trim() ?? "";
  return first.length > 0 ? first : null;
}

function markOf(run: ReturnType<typeof runAfter>) {
  if (run === null) return { tone: "quiet" as const, weight: 0 as const, note: null };
  const { status } = run;
  const tone: TimelineMinimapTone =
    status.face === "failed"
      ? "failed"
      : status.face === "paused"
        ? "paused"
        : status.face === "produced"
          ? "produced"
          : "quiet";
  const endMs = status.endedAt === null ? Date.now() : Date.parse(status.endedAt);
  // How long the Mate worked, as its status says it: its waits on the person are theirs.
  const minutes = (endMs - Date.parse(status.startedAt) - status.waitedMs) / 60_000;
  const weight = !Number.isFinite(minutes) || minutes < 10 ? 0 : minutes < 60 ? 1 : 2;
  return { tone, weight: weight as 0 | 1 | 2, note: lastNoteOf(run.row) };
}

/** Keep full source text untouched until a minimap preview is opened. */
export function deriveTimelineMinimapItems(
  rows: ReadonlyArray<MessagesTimelineRow>,
): TimelineMinimapItem[] {
  const items: TimelineMinimapItem[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message" || row.message.role !== "user") {
      continue;
    }

    // A message sent into a run is a dot: what the run came to is its opener's.
    items.push({
      id: row.id,
      rowIndex: index,
      userText: row.message.text,
      assistantText: row.aside ? null : resolveFinalAssistantTextForTurn(rows, index),
      aside: row.aside,
      ...markOf(row.aside ? null : runAfter(rows, index)),
    });
  }
  return items;
}

function resolveFinalAssistantTextForTurn(
  rows: ReadonlyArray<MessagesTimelineRow>,
  userRowIndex: number,
) {
  let finalAssistantText: string | null = null;
  for (let index = userRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message") {
      continue;
    }
    if (row.message.role === "user") {
      if (isAside(row)) continue;
      break;
    }
    if (row.message.role === "assistant") {
      finalAssistantText = row.message.text ?? null;
    }
  }
  return finalAssistantText;
}

function compactMinimapPreview(text: string | null | undefined) {
  const compact = text?.replace(/\s+/g, " ").trim() ?? "";
  return compact.length > 0 ? compact : null;
}

export function resolveTimelineMinimapPreview(
  item: TimelineMinimapItem | null,
): TimelineMinimapItem | null {
  return item === null
    ? null
    : {
        ...item,
        userText: compactMinimapPreview(item.userText),
        assistantText: compactMinimapPreview(item.assistantText),
      };
}
