/**
 * The menu's rows, by where HQ's word on the organization stands (`MenuTreeState`). Each answer
 * draws at once and nothing waits on another source: HQ's rows from its first navigation answer,
 * as HQ places them, whatever of the roster is read yet, which only fills their Zerops facts.
 */
import type { MenuTreeState } from "@t3tools/client-runtime/data";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";

/**
 * - `loading`: no row (`null`): HQ's first answer is still coming, and the menu holds its loading
 *   rows rather than draw the roster it would regroup a moment later.
 * - `unreachable`: no row; the header says HQ is unreachable. The roster is never drawn as if it
 *   were the person's whole menu.
 * - `known`: HQ's rows, each with where HQ places its project (`placedMenuRows`), then the
 *   roster's Platform projects.
 * - `refused`: the roster's Mates, ungrouped.
 *
 * A project its owner proved deleted that nothing places is drawn no more, and one HQ still places
 * is drawn gone (`placedMenuRows`).
 */
export function menuRows<Row extends CandidateRow>(input: {
  readonly state: MenuTreeState;
  /** HQ's rows (`placedMenuRows`); none until it answered. */
  readonly placed: ReadonlyArray<Row | CandidateRow>;
  /** The organization's roster: whatever of it is read yet. */
  readonly candidates: ReadonlyArray<Row>;
  /** The roster's projects HQ names nowhere and that carry no birth tag (`menuTree.platform`). */
  readonly platform: ReadonlySet<string>;
  /** A roster project is a Mate HQ's directory or its own listing names (`isListedMateProject`). */
  readonly listedMate: (row: Row) => boolean;
  /** Projects their owner proved deleted. */
  readonly gone: ReadonlySet<string>;
}): ReadonlyArray<Row | CandidateRow> | null {
  const { candidates, gone } = input;
  switch (input.state) {
    case "loading":
      return null;
    case "unreachable":
      return [];
    case "refused":
      return candidates.filter((row) => input.listedMate(row) && !gone.has(row.project.id));
    case "known": {
      const placed = new Set(input.placed.map((row) => row.project.id));
      return [
        ...input.placed,
        ...candidates.filter(
          (row) =>
            input.platform.has(row.project.id) &&
            !placed.has(row.project.id) &&
            !gone.has(row.project.id),
        ),
      ];
    }
  }
}
