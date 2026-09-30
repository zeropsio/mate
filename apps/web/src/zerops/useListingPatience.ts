/** How long a listing known only in part may keep saying "Still reading…" (`candidatesNotice`). */
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { STILL_READING_PATIENCE_MS } from "@t3tools/client-runtime/zerops/projections";
import { useEffect, useState } from "react";

/**
 * Whether the listing is still within its patience: true unless it has been known only in part
 * for `STILL_READING_PATIENCE_MS` without a break. A listing that completes starts it over.
 */
export function useListingPatience(listing: Shown<ReadonlyArray<unknown>>): boolean {
  const partial = listing.state === "known" && listing.coverage === "partial";
  const [spent, setSpent] = useState(false);
  useEffect(() => {
    if (!partial) return;
    const timer = setTimeout(() => setSpent(true), STILL_READING_PATIENCE_MS);
    return () => {
      clearTimeout(timer);
      setSpent(false);
    };
  }, [partial]);
  return !(partial && spent);
}
