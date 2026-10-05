/** HQ ended this structure segment as planned; open the next segment with a fresh ticket. */
export const HQ_STREAM_SEGMENT_CLOSE = { code: 4410, reason: "segment over" } as const;

/**
 * Whether HQ is the organization's official HQ, as its last check of Zerops said
 * (`apps/hq/src/official.ts`): `unknown` while Zerops does not answer that check — HQ's grace
 * keeps it serving meanwhile, which is no outage. The structure snapshot carries it as `official`,
 * and a `{ type: "official", official }` message each time it changes; `null` before the Core's
 * first check finished. A Core from before this sends no `official` at all.
 */
export type HqOfficialVerdict =
  | "ok"
  | "anchor_missing"
  | "anchor_elsewhere"
  | "credentials_wrong"
  | "unknown";
