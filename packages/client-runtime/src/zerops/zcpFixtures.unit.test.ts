/**
 * zcp's monorepo contract fixtures (zcp `docs/spec-mate.md` §2.8a.7), recorded by zcp and copied
 * byte for byte by `scripts/sync-zcp-fixtures.ts`, decoded through Mate's consumer schema.
 */
import { ZeropsStateEnvelope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import leaseStatus from "./fixtures/zcp/envelope.lease-status.json" with { type: "json" };
import poolPair from "./fixtures/zcp/envelope.pool-pair.json" with { type: "json" };
import singlePair from "./fixtures/zcp/envelope.single-pair.json" with { type: "json" };
import singlePairToday from "./fixtures/zcp/envelope.single-pair.today.json" with { type: "json" };
import threeParts from "./fixtures/zcp/envelope.three-parts.json" with { type: "json" };

const decodeEnvelope = Schema.decodeUnknownSync(ZeropsStateEnvelope);

// witness: packages/contracts/src/zerops.ts | stageHostname: Schema.optional(Schema.String), → stageHost: Schema.optional(Schema.String),
it("ZV+14: zcp's recorded envelopes decode to exactly the snapshots zcp sent", () => {
  const sent: ReadonlyArray<{ readonly services: unknown; readonly leases?: unknown }> = [
    singlePairToday,
    singlePair,
    threeParts,
    poolPair,
    leaseStatus,
  ];
  for (const envelope of sent) {
    const decoded = decodeEnvelope(envelope);
    expect(decoded.services).toEqual(envelope.services);
    expect(decoded.leases).toEqual(envelope.leases);
  }
});
