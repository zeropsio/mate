import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

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

function workLineAfter(
  rows: ReadonlyArray<MessagesTimelineRow>,
  index: number,
): Extract<MessagesTimelineRow, { kind: "work-line" }> | null {
  for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
    const row = rows[cursor]!;
    if (row.kind === "work-line") return row;
    if (row.kind === "message" && row.message.role === "user") return null;
  }
  return null;
}

function markOf(line: Extract<MessagesTimelineRow, { kind: "work-line" }> | null) {
  if (line === null) return { tone: "quiet" as const, weight: 0 as const, note: null };
  const tone: TimelineMinimapTone =
    line.face === "failed"
      ? "failed"
      : line.face === "paused"
        ? "paused"
        : line.face === "produced"
          ? "produced"
          : "quiet";
  const endMs = line.endedAt === null ? Date.now() : Date.parse(line.endedAt);
  const minutes = (endMs - Date.parse(line.startedAt)) / 60_000;
  const weight = !Number.isFinite(minutes) || minutes < 10 ? 0 : minutes < 60 ? 1 : 2;
  return { tone, weight: weight as 0 | 1 | 2, note: line.note ?? line.fallback };
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

    items.push({
      id: row.id,
      rowIndex: index,
      userText: row.message.text,
      assistantText: resolveFinalAssistantTextForTurn(rows, index),
      aside: row.aside,
      ...markOf(workLineAfter(rows, index)),
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
