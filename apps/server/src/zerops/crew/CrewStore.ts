/**
 * The engine's lane effects write the rows of `crew_lane`; the git handlers read them.
 *
 * @module CrewStore
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** A crew table could not be read or written, or held a row this build cannot decode. */
export class CrewStoreError extends Schema.TaggedError<CrewStoreError>()("CrewStoreError", {
  operation: Schema.String,
  kind: Schema.Literals(["sql", "decode"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Crew store ${this.operation} failed (${this.kind})`;
  }
}

/** A lane operation named a lane the store has no row for. */
export class CrewLaneNotRecorded extends Schema.TaggedError<CrewLaneNotRecorded>()(
  "CrewLaneNotRecorded",
  { crew: Schema.String, lane: Schema.String },
) {
  override get message(): string {
    return `No lane is recorded for ${this.crew}/${this.lane}`;
  }
}

export type CrewMemoryKind =
  | "decision"
  | "lesson"
  | "fact"
  | "open"
  | "note"
  | "handoff"
  | "unfiled";

/** One entry of a crewmate's memory (CONCEPT §3A). */
export interface CrewMemoryRow {
  readonly crew: string;
  readonly member: string;
  readonly id: string;
  readonly kind: CrewMemoryKind;
  readonly topic: string | null;
  readonly text: string;
  /** Files the entry is about; a `fact` is re-verified against them. */
  readonly paths: ReadonlyArray<string>;
  readonly verifiedAt: string | null;
  readonly fromAssignment: string | null;
  readonly updatedAt: string;
}

/** The git handlers' record of their writes to a copy. Its board state belongs to LaneRecord in engine/state.ts. */
export interface CrewLaneRow {
  readonly crew: string;
  /** The crewmate's handle; the lane lives at `.crew/<lane>` on branch `crew/<lane>`. */
  readonly lane: string;
  readonly host: string;
  readonly branch: string;
  /** Where the current attempt started; `keepAndReset` returns here. */
  readonly dispatchCommit: string | null;
  /** The last lane tip the engine wrote; any other tip parks the lane. */
  readonly recordedTip: string | null;
  /** The squash commit of the last landing from this lane. */
  readonly lastLanding: string | null;
  /** The policed refs at dispatch (`refname` to sha). */
  readonly refSnapshot: Readonly<Record<string, string>> | null;
  readonly lockfileHash: string | null;
  readonly frozenSince: string | null;
}

export interface CrewStoreService {
  readonly putLane: (row: CrewLaneRow) => Effect.Effect<void, CrewStoreError>;
  readonly getLane: (
    crew: string,
    lane: string,
  ) => Effect.Effect<Option.Option<CrewLaneRow>, CrewStoreError>;
  readonly requireLane: (
    crew: string,
    lane: string,
  ) => Effect.Effect<CrewLaneRow, CrewStoreError | CrewLaneNotRecorded>;
  /** Read, change and write one lane in a transaction; a missing lane is left missing. */
  readonly updateLane: (
    crew: string,
    lane: string,
    change: (row: CrewLaneRow) => CrewLaneRow,
  ) => Effect.Effect<Option.Option<CrewLaneRow>, CrewStoreError>;
  readonly deleteLane: (crew: string, lane: string) => Effect.Effect<void, CrewStoreError>;
  readonly lanes: (crew: string) => Effect.Effect<ReadonlyArray<CrewLaneRow>, CrewStoreError>;
  readonly lanesOnHost: (host: string) => Effect.Effect<ReadonlyArray<CrewLaneRow>, CrewStoreError>;
}

export class CrewStore extends Context.Service<CrewStore, CrewStoreService>()(
  "t3/zerops/crew/CrewStore",
) {}

const RefSnapshot = Schema.NullOr(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

interface LaneSqlRow {
  readonly crew: string;
  readonly lane: string;
  readonly host: string;
  readonly branch: string;
  readonly dispatchCommit: string | null;
  readonly recordedTip: string | null;
  readonly lastLanding: string | null;
  readonly refSnapshot: string | null;
  readonly lockfileHash: string | null;
  readonly frozenSince: string | null;
}

const decodeRefSnapshot = Schema.decodeUnknownEffect(RefSnapshot);
const encodeRefSnapshot = Schema.encodeUnknownEffect(RefSnapshot);

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const sqlError = (operation: string) => (cause: unknown) =>
    new CrewStoreError({ operation, kind: "sql", cause });
  const decodeError = (operation: string) => (cause: Schema.SchemaError) =>
    new CrewStoreError({ operation, kind: "decode", cause });

  const laneFromSql = (row: LaneSqlRow) =>
    decodeRefSnapshot(row.refSnapshot).pipe(
      Effect.mapError(decodeError("lane")),
      Effect.map((refSnapshot): CrewLaneRow => ({ ...row, refSnapshot })),
    );

  const selectLanes = (where: "lane" | "crew" | "host", crew: string, key: string) => {
    const filter =
      where === "lane"
        ? sql`crew = ${crew} AND lane = ${key}`
        : where === "crew"
          ? sql`crew = ${crew}`
          : sql`host = ${key}`;
    return sql<LaneSqlRow>`
      SELECT
        crew, lane, host, branch,
        dispatch_commit AS "dispatchCommit",
        recorded_tip AS "recordedTip",
        last_landing AS "lastLanding",
        ref_snapshot_json AS "refSnapshot",
        lockfile_hash AS "lockfileHash",
        frozen_since AS "frozenSince"
      FROM crew_lane
      WHERE ${filter}
      ORDER BY crew, lane
    `.pipe(
      Effect.mapError(sqlError("selectLanes")),
      Effect.flatMap((rows) => Effect.forEach(rows, laneFromSql)),
    );
  };

  const writeLane = (row: CrewLaneRow) =>
    Effect.gen(function* () {
      const refSnapshot = yield* encodeRefSnapshot(row.refSnapshot).pipe(
        Effect.mapError(decodeError("putLane")),
      );
      yield* sql`
        INSERT INTO crew_lane (
          crew, lane, host, branch, dispatch_commit, recorded_tip, last_landing,
          ref_snapshot_json, lockfile_hash, frozen_since
        ) VALUES (
          ${row.crew}, ${row.lane}, ${row.host}, ${row.branch}, ${row.dispatchCommit},
          ${row.recordedTip}, ${row.lastLanding}, ${refSnapshot}, ${row.lockfileHash},
          ${row.frozenSince}
        )
        ON CONFLICT (crew, lane) DO UPDATE SET
          host = excluded.host,
          branch = excluded.branch,
          dispatch_commit = excluded.dispatch_commit,
          recorded_tip = excluded.recorded_tip,
          last_landing = excluded.last_landing,
          ref_snapshot_json = excluded.ref_snapshot_json,
          lockfile_hash = excluded.lockfile_hash,
          frozen_since = excluded.frozen_since
      `.pipe(Effect.mapError(sqlError("putLane")));
    });

  const getLane: CrewStoreService["getLane"] = (crew, lane) =>
    selectLanes("lane", crew, lane).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

  return CrewStore.of({
    putLane: writeLane,
    getLane,
    requireLane: (crew, lane) =>
      getLane(crew, lane).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new CrewLaneNotRecorded({ crew, lane })),
            onSome: Effect.succeed,
          }),
        ),
      ),
    updateLane: (crew, lane, change) =>
      sql
        .withTransaction(
          getLane(crew, lane).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(Option.none<CrewLaneRow>()),
                onSome: (row) => {
                  const next = change(row);
                  return writeLane(next).pipe(Effect.as(Option.some(next)));
                },
              }),
            ),
          ),
        )
        .pipe(
          Effect.catchTags({ SqlError: (cause) => Effect.fail(sqlError("updateLane")(cause)) }),
        ),
    deleteLane: (crew, lane) =>
      sql`DELETE FROM crew_lane WHERE crew = ${crew} AND lane = ${lane}`.pipe(
        Effect.mapError(sqlError("deleteLane")),
        Effect.asVoid,
      ),
    lanes: (crew) => selectLanes("crew", crew, crew),
    lanesOnHost: (host) => selectLanes("host", "", host),
  });
});

export const layer = Layer.effect(CrewStore, make);
