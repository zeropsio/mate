import * as Schema from "effect/Schema";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { UsageFact, UsageIdentity, UsageOrigin, AGENT_USAGE_BATCH_MAX } from "@t3tools/contracts";
export {
  AGENT_USAGE_CAPTURE_PROTOCOL,
  AGENT_USAGE_REPORT_PROTOCOL,
  AGENT_USAGE_BATCH_BYTES,
  AGENT_USAGE_BATCH_MAX,
} from "@t3tools/contracts";
export const UsageLinkUp = Schema.Struct({
  type: Schema.Literal("usage-facts"),
  protocol: Schema.Int,
  batchId: UsageIdentity,
  origins: Schema.Array(UsageOrigin).check(Schema.isMaxLength(64)),
  facts: Schema.Array(UsageFact).check(Schema.isMaxLength(AGENT_USAGE_BATCH_MAX)),
});
export type UsageLinkUp = typeof UsageLinkUp.Type;
export const UsageLinkDown = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("usage-ack"),
    batchId: UsageIdentity,
    accepted: Schema.Array(Schema.Struct({ originId: UsageIdentity, factId: UsageIdentity })).check(
      Schema.isMaxLength(AGENT_USAGE_BATCH_MAX),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("usage-error"),
    batchId: UsageIdentity,
    code: UsageIdentity,
    disposition: Schema.Literals(["refused", "transient", "unsupported", "fenced"]),
    cursor: Schema.optionalKey(UsageQuantity),
  }),
]);
export type UsageLinkDown = typeof UsageLinkDown.Type;
/** A newer socket of the same Mate holds the lane: the old one stops and reopens on the new channel. */
export const USAGE_FENCE_CODES: ReadonlyArray<string> = ["channel_replaced", "hello_required"];
/** How a Mate reads HQ's refusal `code`; an unavailable HQ is `transient`, never a refusal. */
export const usageRefusalDisposition = (code: string): "refused" | "unsupported" | "fenced" =>
  USAGE_FENCE_CODES.includes(code)
    ? "fenced"
    : code === "unsupported_protocol"
      ? "unsupported"
      : "refused";
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
/** The first observation timestamps a completion; delivery metadata cannot change consumption. */
export const usageFactDigest = (fact: typeof UsageFact.Type) =>
  usageDigest({
    ...fact,
    time: fact.time.provenance === "server-completion" ? undefined : fact.time,
  });

/** Provider consumption belongs to the registered Mate, never a database or writer instance. */
export const usageOriginId = (
  binding: Pick<typeof UsageOrigin.Type, "orgId" | "projectId" | "mateId">,
  provider: (typeof UsageOrigin.Type)["provider"],
) =>
  usageDigest([
    { orgId: binding.orgId, projectId: binding.projectId, mateId: binding.mateId },
    provider,
  ]);
/** The provider thread namespaces the native response identity. */
export const usageFactId = (nativeThreadId: string, nativeResponseId: string) =>
  usageDigest([nativeThreadId, nativeResponseId]);
