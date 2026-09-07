import { CheckpointHistory, ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const CaptureRun = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.String,
  turnId: Schema.NullOr(TurnId),
  phase: Schema.Literals(["preparing", "prepared", "finishing", "finalized"]),
  history: CheckpointHistory,
});
export type CaptureRun = typeof CaptureRun.Type;

export class CaptureJournalError extends Schema.TaggedErrorClass<CaptureJournalError>()(
  "CaptureJournalError",
  { cause: Schema.Defect() },
) {}

export class WorkspaceCaptureJournal extends Context.Service<
  WorkspaceCaptureJournal,
  {
    readonly get: (
      threadId: ThreadId,
      runId: string,
    ) => Effect.Effect<CaptureRun | undefined, CaptureJournalError>;
    readonly getByTurn: (
      threadId: ThreadId,
      turnId: TurnId,
    ) => Effect.Effect<CaptureRun | undefined, CaptureJournalError>;
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<CaptureRun>, CaptureJournalError>;
    readonly insert: (run: CaptureRun) => Effect.Effect<boolean, CaptureJournalError>;
    readonly save: (run: CaptureRun) => Effect.Effect<void, CaptureJournalError>;
    readonly remove: (threadId: ThreadId) => Effect.Effect<void, CaptureJournalError>;
  }
>()("t3/checkpointing/WorkspaceCaptureJournal") {}

export const layer = Layer.effect(
  WorkspaceCaptureJournal,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const DbRun = CaptureRun.mapFields((fields) => ({
      ...fields,
      history: Schema.fromJsonString(CheckpointHistory),
    }));
    const decode = Schema.decodeUnknownEffect(Schema.Array(DbRun));
    const error = (cause: unknown) => new CaptureJournalError({ cause });
    const get = (threadId: ThreadId, runId: string) =>
      sql`
    SELECT thread_id AS "threadId",run_id AS "runId",turn_id AS "turnId",phase,history_json AS history
    FROM workspace_capture_runs WHERE thread_id=${threadId} AND run_id=${runId}
  `.pipe(
        Effect.flatMap(decode),
        Effect.map((rows) => rows[0]),
        Effect.mapError(error),
      );
    const getByTurn = (threadId: ThreadId, turnId: TurnId) =>
      sql`
    SELECT thread_id AS "threadId",run_id AS "runId",turn_id AS "turnId",phase,history_json AS history
    FROM workspace_capture_runs WHERE thread_id=${threadId} AND turn_id=${turnId}
  `.pipe(
        Effect.flatMap(decode),
        Effect.map((rows) => rows[0]),
        Effect.mapError(error),
      );
    const list = (threadId: ThreadId) =>
      sql`
    SELECT thread_id AS "threadId",run_id AS "runId",turn_id AS "turnId",phase,history_json AS history
    FROM workspace_capture_runs WHERE thread_id=${threadId} ORDER BY rowid
  `.pipe(Effect.flatMap(decode), Effect.mapError(error));
    const insert = (run: CaptureRun) =>
      sql`
    INSERT OR IGNORE INTO workspace_capture_runs(thread_id,run_id,turn_id,phase,history_json)
    VALUES(${run.threadId},${run.runId},${run.turnId},${run.phase},${JSON.stringify(run.history)})
    RETURNING run_id
  `.pipe(
        Effect.map((rows) => rows.length === 1),
        Effect.mapError(error),
      );
    const save = (run: CaptureRun) =>
      sql`
    UPDATE workspace_capture_runs SET turn_id=${run.turnId},phase=${run.phase},history_json=${JSON.stringify(run.history)}
    WHERE thread_id=${run.threadId} AND run_id=${run.runId} AND phase <> 'finalized'
  `.pipe(Effect.asVoid, Effect.mapError(error));
    const remove = (threadId: ThreadId) =>
      sql`DELETE FROM workspace_capture_runs WHERE thread_id=${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(error),
      );
    return WorkspaceCaptureJournal.of({ get, getByTurn, list, insert, save, remove });
  }),
);
