import * as Schema from "effect/Schema";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  UsageCoverage,
  UsageDigest,
  UsageFact,
  UsageIdentity,
  UsageJournalEntry,
  UsageOrigin,
  UsageQuantity,
  AGENT_USAGE_BATCH_MAX,
} from "@t3tools/contracts";
export {
  AGENT_USAGE_CAPTURE_PROTOCOL,
  AGENT_USAGE_REPORT_PROTOCOL,
  AGENT_USAGE_BATCH_BYTES,
  AGENT_USAGE_BATCH_MAX,
} from "@t3tools/contracts";
export const USAGE_GENESIS_DIGEST = "0".repeat(64);
const Channel = { ledgerId: UsageIdentity, channel: UsageIdentity };
const Cursor = { cursor: UsageQuantity, digest: UsageDigest };
export const UsageHello = Schema.Struct({
  type: Schema.Literal("usage-hello"),
  protocol: Schema.Int,
  ledgerId: UsageIdentity,
  highWater: UsageQuantity,
  highDigest: UsageDigest,
  replayFloor: UsageQuantity,
  origins: Schema.Array(UsageOrigin).check(Schema.isMaxLength(64)),
});
export const UsageBatch = Schema.Struct({
  type: Schema.Literal("usage-batch"),
  ...Channel,
  entries: Schema.Array(UsageJournalEntry).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(AGENT_USAGE_BATCH_MAX),
  ),
});
export const UsageSnapshot = Schema.Struct({
  type: Schema.Literal("usage-snapshot"),
  ...Channel,
  snapshotId: UsageIdentity,
  highWater: UsageQuantity,
  highDigest: UsageDigest,
  page: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000000 })),
  totalFacts: UsageQuantity,
  pages: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000000 })),
  /** Rolling digest of canonical page content; final page proves the pinned manifest. */
  previousDigest: UsageDigest,
  digest: UsageDigest,
  manifestDigest: UsageDigest,
  facts: Schema.Array(UsageFact).check(Schema.isMaxLength(AGENT_USAGE_BATCH_MAX)),
  coverage: Schema.Array(Schema.Struct({ originId: UsageIdentity, value: UsageCoverage })).check(
    Schema.isMaxLength(64),
  ),
});
export const UsageSnapshotAbandon = Schema.Struct({
  type: Schema.Literal("usage-snapshot-abandon"),
  ...Channel,
  snapshotId: UsageIdentity,
});
export const UsageLinkUp = Schema.Union([
  UsageHello,
  UsageBatch,
  UsageSnapshot,
  UsageSnapshotAbandon,
]);
export type UsageLinkUp = typeof UsageLinkUp.Type;
export const UsageLinkDown = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("usage-resume"),
    ...Channel,
    ...Cursor,
    action: Schema.Literals(["replay", "snapshot"]),
  }),
  Schema.Struct({ type: Schema.Literal("usage-ack"), ...Channel, ...Cursor }),
  Schema.Struct({
    type: Schema.Literal("usage-snapshot-ack"),
    ...Channel,
    snapshotId: UsageIdentity,
    nextPage: Schema.Int,
    ...Cursor,
  }),
  Schema.Struct({
    type: Schema.Literal("usage-error"),
    ledgerId: UsageIdentity,
    code: UsageIdentity,
    disposition: Schema.Literals(["refused", "transient", "unsupported"]),
    cursor: Schema.optionalKey(UsageQuantity),
  }),
]);
export type UsageLinkDown = typeof UsageLinkDown.Type;
/** Canonical JSON makes content equality independent of object key order on the wire. */
export const usageCanonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(usageCanonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${usageCanonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
export const usageDigest = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(usageCanonical(value))));
/** Hash every field except digest; previousDigest chains the accepted prefix. */
export const usageEntryDigest = (entry: Omit<typeof UsageJournalEntry.Type, "digest">) =>
  usageDigest(entry);
export const usageSnapshotDigest = (
  page: Omit<typeof UsageSnapshot.Type, "digest" | "manifestDigest" | "channel" | "type">,
) => usageDigest(page);
