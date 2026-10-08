import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as Schema from "effect/Schema";
import * as Duration from "effect/Duration";
import * as Stream from "effect/Stream";
import { UsageUtcDay, AGENT_USAGE_EXACT_DAYS } from "@t3tools/contracts";
import { Leader } from "./leader.ts";
import { UsageRefused } from "./usageLedger.ts";
const decodeDay = Schema.decodeUnknownEffect(UsageUtcDay);
export const USAGE_PRUNE_BATCH_ROWS = 1000;
/** Receipts and daily contributions commit before ACK. Detail expiry changes no quantities. */
export const pruneUsageDetail = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  leader: Pick<Leader["Service"], "write">,
  sinceDay: string,
) {
  yield* decodeDay(sinceDay).pipe(
    Effect.mapError(() => new UsageRefused({ code: "invalid_prune_boundary" })),
  );
  return yield* leader.write(
    Effect.gen(function* () {
      const [state] = yield* sql<{ readonly exact_since: string | null; readonly target: string }>`
      SELECT exact_since::text,to_char((now() AT TIME ZONE 'UTC')::date-${AGENT_USAGE_EXACT_DAYS},'YYYY-MM-DD') AS target
      FROM hq_usage_state WHERE id=1 FOR UPDATE`;
      if (state === undefined) return yield* new UsageRefused({ code: "usage_state_missing" });
      if (sinceDay > state.target)
        return yield* new UsageRefused({ code: "usage_exact_window_too_short" });
      if (
        state.exact_since !== null &&
        Date.parse(`${sinceDay}T00:00:00Z`) < Date.parse(state.exact_since)
      )
        return yield* new UsageRefused({ code: "usage_prune_boundary_regressed" });
      const [removed] = yield* sql<{ readonly count: string }>`WITH retiring AS (
      SELECT origin_id,fact_id FROM hq_usage_fact
      WHERE occurrence<${`${sinceDay}T00:00:00.000Z`}::timestamptz
      OR ((occurrence IS NULL OR occurrence>now()) AND ingested_at<${`${sinceDay}T00:00:00.000Z`}::timestamptz)
      LIMIT ${USAGE_PRUNE_BATCH_ROWS}
    ), removed AS (DELETE FROM hq_usage_fact f USING retiring r WHERE f.origin_id=r.origin_id AND f.fact_id=r.fact_id RETURNING 1)
    SELECT count(*)::text AS count FROM removed`;
      const [legacyRemoved] = yield* sql<{ readonly count: string }>`WITH retiring AS (
      SELECT origin_id,native_id FROM hq_usage_history_fact
      WHERE occurrence<${`${sinceDay}T00:00:00.000Z`}::timestamptz
      OR ((occurrence IS NULL OR occurrence>now()) AND ingested_at<${`${sinceDay}T00:00:00.000Z`}::timestamptz)
      LIMIT ${USAGE_PRUNE_BATCH_ROWS}
    ), removed AS (DELETE FROM hq_usage_history_fact f USING retiring r WHERE f.origin_id=r.origin_id AND f.native_id=r.native_id RETURNING 1)
    SELECT count(*)::text AS count FROM removed`;
      const count = Number(removed?.count ?? "0") + Number(legacyRemoved?.count ?? "0");
      if (
        count > 0 ||
        state.exact_since === null ||
        Date.parse(state.exact_since) !== Date.parse(`${sinceDay}T00:00:00.000Z`)
      )
        yield* sql`UPDATE hq_usage_state SET exact_since=${`${sinceDay}T00:00:00.000Z`}::timestamptz,revision=revision+1 WHERE id=1`;
      return count;
    }),
  );
});

/** Start on leader activation and keep the UTC daily retention boundary moving while idle. */
export const runUsageRetention = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  leader: Leader["Service"],
  notify: Effect.Effect<void>,
) {
  const prune = Effect.gen(function* () {
    const status = yield* leader.status;
    if (status.state !== "active") return;
    const [target] = yield* sql<{
      readonly day: string;
    }>`SELECT to_char((now() AT TIME ZONE 'UTC')::date-${AGENT_USAGE_EXACT_DAYS},'YYYY-MM-DD') AS day`;
    if (target === undefined) return yield* new UsageRefused({ code: "usage_state_missing" });
    let batch: number;
    do {
      batch = yield* pruneUsageDetail(sql, leader, target.day);
    } while (batch >= USAGE_PRUNE_BATCH_ROWS);
    yield* notify;
  }).pipe(
    Effect.catch((error) =>
      error._tag === "NotLeader"
        ? Effect.void
        : Effect.logWarning("usage detail expiry failed", error),
    ),
  );
  yield* Effect.forkScoped(
    Stream.runForEach(leader.changes, (status) =>
      status.state === "active" ? prune : Effect.void,
    ),
  );
  yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(Duration.days(1)), prune)));
});
