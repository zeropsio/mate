import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { UsageComponents, UsageQuantity, UsageReportQuery, UsageUtcDay } from "@t3tools/contracts";
import { usageDigest, usageEntryDigest, USAGE_GENESIS_DIGEST } from "./agentUsage.ts";
import { readLinkUp } from "./mateLink.ts";

const decodeComponents = Schema.decodeUnknownSync(UsageComponents);
const decodeDay = Schema.decodeUnknownSync(UsageUtcDay);
describe("durable usage wire", () => {
  it("preserves large exact integers and refuses damaged components", () => {
    const quantity = Schema.decodeUnknownSync(UsageQuantity);
    assert.strictEqual(quantity("9007199254740993"), "9007199254740993");
    for (const value of [1, "-1", "1.1", "01", "9".repeat(39)])
      assert.throws(() => quantity(value));
    assert.throws(() =>
      decodeComponents({
        uncachedInput: "2",
        cachedInput: "0",
        cacheCreation: "0",
        output: "3",
        reasoning: "4",
        inclusiveTotal: "5",
      }),
    );
    assert.throws(() => decodeDay("2026-02-30"));
  });
  it("chains content, tolerates future frames and admits a separate usage hello", () => {
    const entry = { sequence: "1", previousDigest: USAGE_GENESIS_DIGEST, facts: [], coverage: [] };
    assert.strictEqual(usageEntryDigest(entry), usageEntryDigest({ ...entry, facts: [] }));
    assert.notStrictEqual(usageEntryDigest(entry), usageEntryDigest({ ...entry, sequence: "2" }));
    assert.strictEqual(usageDigest({ a: 1, b: 2 }), usageDigest({ b: 2, a: 1 }));
    assert.strictEqual(readLinkUp(JSON.stringify({ type: "usage-future" })).kind, "unknown");
    assert.strictEqual(
      readLinkUp(
        JSON.stringify({
          type: "usage-hello",
          protocol: 1,
          ledgerId: "L",
          highWater: "0",
          highDigest: USAGE_GENESIS_DIGEST,
          replayFloor: "1",
          origins: [],
        }),
      ).kind,
      "message",
    );
    assert.strictEqual(
      readLinkUp(
        JSON.stringify({
          type: "usage-batch",
          ledgerId: "L",
          channel: "C",
          entries: [{ ...entry, digest: "broken" }],
        }),
      ).kind,
      "invalid",
    );
  });
  it("refuses ambiguous UTC trend edges and invalid zones", () => {
    const query = {
      since: "2026-10-01T00:00:00.000Z",
      until: "2026-10-02T00:00:00.000Z",
      mode: "utc-days",
      timezone: "UTC",
      projectId: null,
      appId: null,
      mateId: null,
      ownerUserId: null,
      provider: null,
      model: null,
      groupBy: "month",
    };
    const decode = Schema.decodeUnknownSync(UsageReportQuery);
    decode(query);
    assert.throws(() => decode({ ...query, timezone: "No/SuchZone" }));
    assert.throws(() => decode({ ...query, since: "2026-10-01T01:00:00.000Z" }));
  });
});
