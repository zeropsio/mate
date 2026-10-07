import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { HqUsageReader, readUsageReport } from "./usageReport.ts";
import { Leader } from "./leader.ts";
import { makeUsagePriceReader } from "./usagePrices.ts";
import { UsageLane } from "./usageLedger.ts";
export const hqUsageReaderLayer = Layer.effect(
  HqUsageReader,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const lane = yield* UsageLane;
    const ensurePrices = (yield* makeUsagePriceReader(sql, leader)).pipe(
      Effect.flatMap((changed) =>
        changed && lane.ledger !== undefined ? lane.ledger.notify : Effect.void,
      ),
    );
    const layerScope = yield* Effect.scope;
    return {
      ...(lane.ledger === undefined ? {} : { changes: lane.ledger.changes }),
      read: (
        userId: Parameters<typeof readUsageReport>[1],
        scope: Parameters<typeof readUsageReport>[2],
        current: Parameters<typeof readUsageReport>[3],
        overviews: Parameters<typeof readUsageReport>[4],
      ) =>
        Effect.andThen(
          Effect.forkIn(ensurePrices, layerScope),
          readUsageReport(sql, userId, scope, current, overviews),
        ),
    };
  }),
).pipe(Layer.provide(NodeHttpClient.layerNodeHttp));
