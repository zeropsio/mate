// How current a scope's answer is and why a refused one is unavailable: the shapes
// `data/projections/freshness.ts` derives.
/** Why a refused scope is unavailable: its session ended, it may not read, or it was refused. */
export type UnavailableReason = "expired-session" | "forbidden" | "refused";

export interface ScopeFreshness {
  /** The scope committed a baseline: what earns an empty answer. */
  readonly complete: boolean;
  /** The scope is live or held within grace, and its connection is open or held within grace. */
  readonly live: boolean;
  /** Read before and not live now: what is held stays, catching up. */
  readonly reconnecting: boolean;
  /** When it stopped being live (wall ms), while it is not; absent while live or never lost. */
  readonly downSince?: number;
  readonly unavailableReason?: UnavailableReason;
}
