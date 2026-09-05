/**
 * The two comparators, stated once. `activity.sequence` is NULL on every
 * provider row in this tree (verified.md) and is never consulted — see
 * `mate-session-model-2026-09-05.md` §2.5 / §8.
 */

interface OrderedRow {
  readonly createdAt: string;
  readonly kind: string;
  readonly id: string;
}

const ROW_RANK: Readonly<Record<string, number>> = {
  "tool.started": 0,
  "tool.updated": 1,
  "tool.completed": 2,
};

function rowRank(kind: string): number {
  return ROW_RANK[kind] ?? 1;
}

/** Rows inside one call: `(createdAt, rank started<updated<completed, id)`. */
export function compareCallRows(a: OrderedRow, b: OrderedRow): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    rowRank(a.kind) - rowRank(b.kind) ||
    a.id.localeCompare(b.id)
  );
}

interface AnchoredEntity {
  readonly anchorAt: string;
  readonly anchorActivityId: string;
}

/** Calls and timeline entries: `(anchorAt, anchorActivityId)`. */
export function compareAnchors(a: AnchoredEntity, b: AnchoredEntity): number {
  return (
    a.anchorAt.localeCompare(b.anchorAt) || a.anchorActivityId.localeCompare(b.anchorActivityId)
  );
}
