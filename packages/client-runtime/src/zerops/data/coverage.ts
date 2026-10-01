import type { QueryCoverage } from "./types.ts";

/** What a search's answer covers, from its envelope's limit, offset and total. */
export function coverageFor(
  count: number,
  envelope: { readonly limit?: number; readonly offset?: number; readonly total?: number },
  malformed: boolean,
): QueryCoverage {
  if (malformed) return { kind: "partial", reason: "malformed" };
  const offset = envelope.offset ?? 0;
  const limit = envelope.limit ?? Math.max(count, 1);
  const total = envelope.total ?? null;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 0 ||
    (total !== null && (!Number.isInteger(total) || total < offset + count)) ||
    (limit > 0 && count > limit)
  )
    return { kind: "partial", reason: "contradictory-total" };
  if (total !== null && offset + count === total)
    return {
      kind: "exhausted-traversal",
      traversedPages: Math.max(1, Math.ceil(Math.max(total, 1) / Math.max(limit, 1))),
      observedTotal: total,
      guarantee: "non-atomic",
    };
  return { kind: "partial-window", offset, limit, traversedPages: 1, observedTotal: total };
}
