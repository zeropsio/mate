/**
 * The menu's rows: every row HQ places, as HQ places it, then every project only Zerops lists so
 * far — a project created a moment ago anywhere, ungrouped until somebody places it. A row never
 * waits on HQ; a project its owner proved deleted is drawn no more.
 */
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";

export function menuRows<Row extends CandidateRow>(input: {
  /** HQ's rows, each with where HQ places its project (`menuRowsFromHq`). */
  readonly placed: ReadonlyArray<Row | CandidateRow>;
  /** The organization's listing, where nothing places a project yet. */
  readonly candidates: ReadonlyArray<Row>;
  /** Projects their owner proved deleted. */
  readonly gone: ReadonlySet<string>;
}): ReadonlyArray<Row | CandidateRow> {
  const placed = new Set(input.placed.map((row) => row.project.id));
  return [
    ...input.placed,
    ...input.candidates.filter(
      (row) => !placed.has(row.project.id) && !input.gone.has(row.project.id),
    ),
  ];
}
