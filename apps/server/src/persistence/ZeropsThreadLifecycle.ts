/**
 * Per-thread Zerops lifecycle persistence.
 *
 * Holds the latest `StateEnvelope` a thread's agent reported and the recent
 * `zerops_*` tool calls, so a client reconnecting after a container restart
 * still sees its lifecycle strip. A restart keeps `state.sqlite` — and restart
 * is the product's own "Enable Zerops Mate" path, which is exactly when a
 * returning client should not be shown a blank strip.
 *
 * Written directly from the live provider event stream, not by the projection
 * pipeline: those events are not part of T3's event log, so there is nothing to
 * replay from. Same shape as `ProviderSessionRuntime`.
 *
 * Both JSON columns are stored and returned as `unknown`. Decoding them against
 * a concrete schema here would mean a row written by a build that knew a newer
 * envelope shape could fail the read outright; the caller decodes tolerantly
 * instead, and a row it cannot read costs one `status` call, not an error.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { IsoDateTime, ThreadId } from "@t3tools/contracts";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  type ProjectionRepositoryError,
} from "./Errors.ts";

export const ZeropsThreadLifecycleRow = Schema.Struct({
  threadId: ThreadId,
  envelope: Schema.NullOr(Schema.Unknown),
  recentTools: Schema.Unknown,
  updatedAt: IsoDateTime,
});
export type ZeropsThreadLifecycleRow = typeof ZeropsThreadLifecycleRow.Type;

export class ZeropsThreadLifecycleRepository extends Context.Service<
  ZeropsThreadLifecycleRepository,
  {
    readonly upsert: (
      row: ZeropsThreadLifecycleRow,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly getByThreadId: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<ZeropsThreadLifecycleRow>, ProjectionRepositoryError>;
  }
>()("t3/persistence/ZeropsThreadLifecycle/ZeropsThreadLifecycleRepository") {}

const DbRow = ZeropsThreadLifecycleRow.mapFields(
  Struct.assign({
    envelope: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    recentTools: Schema.fromJsonString(Schema.Unknown),
  }),
);

const RawDbRow = Schema.Struct({
  threadId: Schema.String,
  envelope: Schema.Unknown,
  recentTools: Schema.Unknown,
  updatedAt: Schema.Unknown,
});

const decodeRow = Schema.decodeUnknownEffect(DbRow);

const GetRequest = Schema.Struct({ threadId: ThreadId });

const toRepositoryError =
  (sqlOperation: string, decodeOperation: string) =>
  (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
      : new PersistenceSqlError({ operation: sqlOperation, cause });

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: DbRow,
    execute: (row) =>
      sql`
        INSERT INTO zerops_thread_lifecycle (
          thread_id,
          envelope_json,
          recent_tools_json,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.envelope},
          ${row.recentTools},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          envelope_json = excluded.envelope_json,
          recent_tools_json = excluded.recent_tools_json,
          updated_at = excluded.updated_at
      `,
  });

  const findRow = SqlSchema.findOneOption({
    Request: GetRequest,
    Result: RawDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          envelope_json AS "envelope",
          recent_tools_json AS "recentTools",
          updated_at AS "updatedAt"
        FROM zerops_thread_lifecycle
        WHERE thread_id = ${threadId}
      `,
  });

  return {
    upsert: (row) =>
      upsertRow(row).pipe(
        Effect.mapError(
          toRepositoryError("zeropsThreadLifecycle.upsert", "zeropsThreadLifecycle.upsert.encode"),
        ),
      ),
    getByThreadId: (threadId) =>
      findRow({ threadId }).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeedNone,
            onSome: (raw) => decodeRow(raw).pipe(Effect.map(Option.some)),
          }),
        ),
        Effect.mapError(
          toRepositoryError("zeropsThreadLifecycle.get", "zeropsThreadLifecycle.get.decode"),
        ),
      ),
  } satisfies ZeropsThreadLifecycleRepository["Service"];
});

export const layer = Layer.effect(ZeropsThreadLifecycleRepository, make);
