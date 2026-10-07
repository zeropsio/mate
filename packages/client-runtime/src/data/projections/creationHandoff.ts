import {
  RELEASE_NOTHING_MERGED,
  RELEASE_NOTHING_NEW_ON_MAIN,
  type ReleaseGate,
} from "../../zerops/release.ts";

/**
 * What becomes of a production just added (P7): its first release's review opens by itself once the
 * production is there and the gate offers the release — main has code and this person may release
 * it — and never otherwise. `wait` while HQ has not yet said so; `drop` where it will not be
 * offered, and the production's row says it waits for its first release.
 */
export function creationHandoff(input: {
  /** Whether HQ holds the production now. */
  readonly hasProduction: boolean;
  /** The flow's release gate (`releaseGate`). */
  readonly gate: ReleaseGate;
}): "wait" | "open" | "drop" {
  if (!input.hasProduction) return "wait";
  if (input.gate.allowed) return "open";
  // Only what will not change by waiting ends it: nothing merged, nothing new, HQ's own refusal.
  // HQ not answering, a comparison not yet read, a release under way all pass.
  const { reason } = input.gate;
  return reason === RELEASE_NOTHING_MERGED ||
    reason === RELEASE_NOTHING_NEW_ON_MAIN ||
    input.gate.refusedBy === "hq"
    ? "drop"
    : "wait";
}
