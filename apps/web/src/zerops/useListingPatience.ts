/** How long a listing known only in part may keep saying "Still reading…" (`candidatesNotice`). */
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { STILL_READING_PATIENCE_MS } from "@t3tools/client-runtime/zerops/projections";

import { useHeldFor } from "./useHeldFor";

/**
 * Whether the listing is still within its patience: true unless it has been known only in part
 * for `STILL_READING_PATIENCE_MS` without a break. A listing that completes starts it over.
 */
export function useListingPatience(listing: Shown<ReadonlyArray<unknown>>): boolean {
  const partial = listing.state === "known" && listing.coverage === "partial";
  return !useHeldFor(partial, STILL_READING_PATIENCE_MS);
}
