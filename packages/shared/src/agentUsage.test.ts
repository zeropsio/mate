import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  UsageComponents,
  UsageFact,
  UsageQuantity,
  UsageReportQuery,
  UsageUtcDay,
} from "@t3tools/contracts";
import { usageDigest, usageFactDigest, usageOriginId, usageFactId } from "./agentUsage.ts";
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
  it("admits immutable completion batches and rejects the retired scanner protocol", () => {
    assert.strictEqual(usageDigest({ a: 1, b: 2 }), usageDigest({ b: 2, a: 1 }));
    assert.strictEqual(readLinkUp(JSON.stringify({ type: "usage-future" })).kind, "unknown");
    assert.strictEqual(
      readLinkUp(
        JSON.stringify({ type: "usage-facts", protocol: 2, batchId: "B", origins: [], facts: [] }),
      ).kind,
      "message",
    );
    assert.strictEqual(
      readLinkUp(
        JSON.stringify({
          type: "usage-facts",
          protocol: 2,
          batchId: "B",
          origins: [],
          facts: [{}],
        }),
      ).kind,
      "invalid",
    );
    for (const type of ["usage-hello", "usage-batch", "usage-snapshot", "usage-snapshot-abandon"])
      assert.notStrictEqual(readLinkUp(JSON.stringify({ type })).kind, "message");
  });
  it("keys responses by their native thread and turn within one registered Mate provider", () => {
    const binding = { orgId: "ORG", projectId: "P", mateId: "M" };
    const observation = { ...binding, label: "renamed" };
    assert.strictEqual(usageOriginId(binding, "claude"), usageOriginId(observation, "claude"));
    assert.notStrictEqual(usageOriginId(binding, "claude"), usageOriginId(binding, "codex"));
    assert.notStrictEqual(
      usageOriginId(binding, "claude"),
      usageOriginId({ ...binding, mateId: "M2" }, "claude"),
    );
    assert.notStrictEqual(usageFactId("parent", "response"), usageFactId("child", "response"));
  });
  it("keeps model ordering out of native turn identity and rejects repeated model lines", () => {
    const binding = { orgId: "ORG", projectId: "P", mateId: "M" };
    const components = {
      uncachedInput: "30",
      cachedInput: "0",
      cacheCreation: "0",
      output: "0",
      reasoning: null,
      inclusiveTotal: "30",
    };
    const turn = {
      originId: usageOriginId(binding, "claude"),
      factId: usageFactId("session", "turn"),
      nativeId: "turn",
      provider: "claude",
      models: [
        { model: null, components, nativeCost: null },
        { model: "known", components, nativeCost: null },
      ],
      nativeCost: null,
      time: { kind: "instant", at: "2026-10-08T00:00:00.000Z", provenance: "server-completion" },
      evidence: "live-provider-turn",
      meterVersion: "native-turn-v1",
      sessionId: "session",
      parentId: null,
    };
    const decode = Schema.decodeUnknownSync(UsageFact);
    const fact = decode(turn);
    assert.strictEqual(
      usageFactDigest(fact),
      usageFactDigest({ ...fact, models: fact.models.toReversed() }),
    );
    assert.throws(() => decode({ ...turn, models: [turn.models[0], turn.models[0]] }));
    assert.throws(() => decode({ ...turn, models: [] }));
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
