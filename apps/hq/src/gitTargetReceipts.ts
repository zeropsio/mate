import { HqGitRequestRefusalReason } from "@t3tools/shared/hqGitTargets";
/** Request identity is committed with the owner's write, so a lost answer never repeats it. */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import {
  HqGitTargetIntent,
  HqGitOperationReceipt,
  type HqGitOperationResult,
} from "@t3tools/shared/hqGitTargets";
import type { Leader } from "./leader.ts";

export class GitRequestRefused extends Schema.TaggedError<GitRequestRefused>()(
  "GitRequestRefused",
  {
    reason: HqGitRequestRefusalReason,
  },
) {}
const encodeIntent = Schema.encodeSync(Schema.fromJsonString(HqGitTargetIntent));
const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(HqGitOperationReceipt));
const readReceipt = Schema.decodeUnknownEffect(HqGitOperationReceipt);
export const readGitReceipt = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  userId: string,
  requestId: string,
  intent: HqGitTargetIntent,
) {
  const rows = yield* sql<{
    readonly user_id: string;
    readonly intent: HqGitTargetIntent;
    readonly receipt: unknown;
  }>`SELECT user_id,intent,receipt FROM hq_git_target_receipt WHERE request_id=${requestId}`;
  const row = rows[0];
  if (row === undefined) return null;
  if (row.user_id !== userId || encodeIntent(row.intent) !== encodeIntent(intent))
    return yield* new GitRequestRefused({ reason: "request_changed" });
  return yield* readReceipt(row.receipt).pipe(Effect.orDie);
});
export const keepGitReceipt = <E, R>(
  sql: SqlClient.SqlClient,
  leader: Leader["Service"],
  userId: string,
  requestId: string,
  intent: HqGitTargetIntent,
  write: Effect.Effect<HqGitOperationResult | undefined, E, R>,
  pending = false,
) =>
  leader.write(
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 3))`;
      const previous = yield* readGitReceipt(sql, userId, requestId, intent);
      if (previous !== null) return previous;
      const result = yield* write;
      const receipt = receiptOf(requestId, intent, result, pending);
      yield* insertReceipt(sql, userId, requestId, intent, receipt);
      return receipt;
    }),
  );
/**
 * A write that waits between its own transactions — adoption waits for git's receipt of the main it
 * moved, which updates the rows a held transaction would lock — commits its request identity in
 * its last transaction (`commit`, run inside it), never in one held around the whole write. A
 * twin request that lost the race answers with the receipt its winner committed.
 */
export const keepGitReceiptAtCommit = <E, R>(
  sql: SqlClient.SqlClient,
  userId: string,
  requestId: string,
  intent: HqGitTargetIntent,
  write: (commit: Effect.Effect<void, SqlError>) => Effect.Effect<unknown, E, R>,
) =>
  Effect.gen(function* () {
    const previous = yield* readGitReceipt(sql, userId, requestId, intent);
    if (previous !== null) return previous;
    const receipt = receiptOf(requestId, intent, undefined, false);
    const exit = yield* Effect.exit(
      write(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 3))`;
          yield* insertReceipt(sql, userId, requestId, intent, receipt);
        }),
      ),
    );
    if (Exit.isSuccess(exit)) return receipt;
    const kept = yield* readGitReceipt(sql, userId, requestId, intent);
    if (kept !== null) return kept;
    return yield* Effect.failCause(exit.cause);
  });
const receiptOf = (
  requestId: string,
  intent: HqGitTargetIntent,
  result: HqGitOperationResult | undefined,
  pending: boolean,
): HqGitOperationReceipt => ({
  requestId,
  operationId: requestId,
  executor: "hq",
  affected: [{ family: "hqAppDetail", id: intent.appId }],
  handles:
    result !== undefined && "jobs" in result
      ? result.jobs.flatMap((job) => (job.job === null ? [] : [job.job]))
      : [],
  acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
  outcome: pending ? { kind: "pending" } : { kind: "succeeded", evidence: requestId },
});
const insertReceipt = (
  sql: SqlClient.SqlClient,
  userId: string,
  requestId: string,
  intent: HqGitTargetIntent,
  receipt: HqGitOperationReceipt,
) => sql`INSERT INTO hq_git_target_receipt(request_id,user_id,app_id,intent,receipt)
    VALUES (${requestId},${userId},${intent.appId}::uuid,${encodeIntent(intent)}::jsonb,${encodeReceipt(receipt)}::jsonb)`;

/** Safe results are projected once from the accepting requests, newest per scope key. */
export const gitTargetValues = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  appId: string,
) {
  const rows = yield* sql<{
    readonly intent: HqGitTargetIntent;
    readonly receipt: unknown;
  }>`SELECT intent,receipt FROM hq_git_target_receipt WHERE app_id::text=${appId} ORDER BY seq DESC`;
  const values = new Map<string, unknown>();
  for (const row of rows) {
    const receipt = yield* readReceipt(row.receipt).pipe(Effect.orDie);
    const result = receipt.acceptance.result;
    if (result === undefined) continue;
    const put = (key: string, value: unknown) => {
      if (!values.has(key)) values.set(key, value);
    };
    if (Array.isArray(result))
      for (const record of result) {
        if ("repo" in record)
          put(
            `${row.intent.kind === "preview-git-environment" ? "adoption" : "preflight"}:${record.repo}`,
            record,
          );
      }
    else if ("probe" in result && "repo" in row.intent)
      put(`probe:${row.intent.repo}`, result.probe);
    else if ("ok" in result && "repo" in row.intent) put(`probe:${row.intent.repo}`, result);
    else if ("jobs" in result) put("delivery", result);
  }
  return [...values].map(([key, value]) => ({ key, value }));
});
