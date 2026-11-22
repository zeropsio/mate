import { useEffect, useState } from "react";

/**
 * The ids of the timeline rows a native text selection covers. LegendList hands a row's
 * container to another row once it leaves the draw buffer, which moves the selection's ends
 * onto other rows mid-drag; the timeline keeps these rows drawn while they are selected.
 */
export function useSelectedTimelineRowIds(viewport: HTMLElement | null): ReadonlyArray<string> {
  const [rowIds, setRowIds] = useState<ReadonlyArray<string>>([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selectionchange to track which timeline rows a native selection covers
  useEffect(() => {
    if (!viewport) return;
    const update = () => {
      const selection = document.getSelection();
      const range =
        selection && !selection.isCollapsed && selection.rangeCount > 0
          ? selection.getRangeAt(0)
          : null;
      const next: string[] = [];
      if (range?.intersectsNode(viewport)) {
        for (const row of viewport.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
          const rowId = row.dataset.timelineRowId;
          if (rowId && range.intersectsNode(row)) next.push(rowId);
        }
      }
      // Most selection changes move an end within the same rows: no render for those.
      setRowIds((current) =>
        current.length === next.length && current.every((id, index) => id === next[index])
          ? current
          : next,
      );
    };
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      setRowIds([]);
    };
  }, [viewport]);
  return rowIds;
}

/** The indices from the first to the last selected row: rows between them are selected too. */
export function selectedTimelineRowSpan(
  rows: ReadonlyArray<{ readonly id: string }>,
  rowIds: ReadonlyArray<string>,
): number[] {
  if (rowIds.length === 0) return [];
  const selected = new Set(rowIds);
  const first = rows.findIndex((row) => selected.has(row.id));
  const last = rows.findLastIndex((row) => selected.has(row.id));
  if (first < 0) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
