import {
  subscribeUpdateChanges,
  type SubscribeUpdateChanges,
} from "../../update/subscribeChanges.ts";
/**
 * CrewStore - the crew tables (migration `055_Crew`) plus a change feed.
 *
 * Rows are plain values; JSON columns are decoded here so no caller parses
 * SQL text. Every write publishes a {@link CrewStoreChange} so a snapshot
 * subscriber re-reads without polling. Git is the truth for lanes - a lane
 * row is what the engine last wrote and saw, re-derived by the boot sweep.
 *
 * The git core reads and writes definition seq, crewmates, lanes, task
 * landings and dev-service crew ports; the crew tools Show-on-dev claims and
 * memory; the engine stints, attempts, runs and the log.
 *
 * @module CrewStore
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { CrewOperation } from "@t3tools/contracts";

import type {
  CrewClaimState,
  CrewMemberKind,
  CrewRunState,
  CrewTaskSource,
  CrewTaskState,
} from "@t3tools/contracts";

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

export interface CrewDefinitionRow {
  readonly crew: string;
  readonly homeHost: string | null;
  /** The validated crew home as applied. */
  readonly spec: unknown;
  readonly briefHash: string | null;
  readonly briefVersion: number;
  readonly appliedAt: string | null;
  readonly appliedBy: string | null;
  /** Bumped by every change the crew-state ref mirrors. */
  readonly seq: number;
  /** The highest seq the crew-state ref holds. */
  readonly flushedSeq: number;
  readonly state: string;
}

export interface CrewMemberRow {
  readonly crew: string;
  /** Fixed after Apply: mentions, branch `crew/<handle>`, directory `.crew/<handle>`. */
  readonly handle: string;
  readonly displayName: string;
  readonly kind: CrewMemberKind;
  readonly tint: string | null;
  readonly host: string | null;
  /** `null` for a lead or a reader. */
  readonly lane: string | null;
  readonly readOnly: boolean;
  /** The provider instance the crewmate runs on. */
  readonly login: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly jobVersion: number;
  readonly runCommand: string | null;
  readonly restartAfterMerge: boolean;
  readonly crewPort: number | null;
  /** The rest of the crewmate's `crew.yaml` entry (setup, check, env, ...). */
  readonly config: unknown;
}

/** A task (`#N`); JSON columns are the engine's own shapes, carried as values. */
export interface CrewAssignmentRow {
  readonly assignment: string;
  /** `null` for a task the person started outside a run. */
  readonly run: string | null;
  readonly crew: string;
  readonly member: string;
  readonly number: number;
  readonly title: string;
  readonly source: CrewTaskSource;
  readonly createdBy: string;
  readonly card: unknown;
  readonly pending: unknown;
  readonly dependsOn: ReadonlyArray<string>;
  readonly fresh: boolean;
  readonly state: CrewTaskState;
  readonly attempt: number;
  readonly reworks: number;
  readonly remerges: number;
  readonly mergedHead: string | null;
  readonly check: unknown;
  readonly review: unknown;
  readonly report: unknown;
  readonly waiting: unknown;
  readonly landedCommit: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A landing the integration branch must keep carrying (its `Crew-Assignment:` trailer). */
export interface CrewLanding {
  readonly crew: string;
  readonly member: string;
  readonly assignment: string;
  readonly title: string;
  readonly landedCommit: string;
}

export interface CrewHostPort {
  readonly port: number;
  /** Whether the service's subdomain routes the port (`httpRouting`); `null` when not known. */
  readonly routed: boolean | null;
}

export interface CrewHostRow {
  readonly host: string;
  readonly crewPorts: ReadonlyArray<CrewHostPort>;
}

/** The Show-on-dev claim a dev service holds for one lane (ARCHITECTURE §4). */
export interface CrewClaimRow {
  readonly host: string;
  readonly crew: string;
  readonly member: string;
  readonly lane: string;
  readonly state: CrewClaimState;
  readonly requestedAt: string;
  readonly grantedBy: string | null;
  readonly grantedAt: string | null;
  readonly expiresAt: string | null;
  readonly releasedAt: string | null;
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

/** `parked`: the engine stopped using the lane until the person triages it · `lost`: its saved copy was lost. */
export type CrewLaneState = "ready" | "parked" | "lost";

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
  readonly state: CrewLaneState;
}

/** One conversation of a crewmate (`crew_stint`): a Mate thread over one session. */
export interface CrewStintRow {
  readonly crew: string;
  readonly member: string;
  readonly stint: number;
  readonly threadId: string;
  /** Set when its first turn starts; a stint without one is still `open`. */
  readonly sessionId: string | null;
  readonly transcriptPath: string | null;
  readonly compactions: number;
  readonly lastCompactSummary: string | null;
  readonly rotatePending: boolean;
  /** Why it was opened (a rotation's reason); `null` for a crewmate's first. */
  readonly reason: string | null;
  /** What its first session starts from (the rotation seed). */
  readonly seededFrom: unknown;
  /** The prompt versions its session started with. */
  readonly briefVersion: number;
  readonly jobVersion: number;
  readonly startedAt: string;
  readonly retiredAt: string | null;
}

/**
 * A run (`crew_run`, ARCHITECTURE §4 *Run*). `options` is the run dialog's
 * choices; it and `reasonDetail` — a refusal's own words — share
 * `options_json`, the table having no column for the words. `wallMs` is the
 * time it ran, paused time excluded, as last recorded.
 */
export interface CrewRunRow {
  readonly run: string;
  readonly crew: string;
  readonly startedBy: string;
  /** `null`: *No limit*. */
  readonly budgetUsd: number | null;
  readonly spentUsd: number;
  readonly options: unknown;
  readonly reasonDetail: string | null;
  readonly state: CrewRunState;
  readonly reason: string | null;
  readonly startedAt: string;
  readonly wallMs: number;
  readonly waitingMs: number;
  readonly finishedAt: string | null;
}

/** One attempt at a task (`crew_attempt`): its dispatch, how it ended, what it cost. */
export interface CrewAttemptRow {
  readonly assignment: string;
  readonly attempt: number;
  readonly threadId: string | null;
  readonly dispatchCommit: string | null;
  readonly tipRef: string | null;
  readonly rotations: number;
  readonly ending: string | null;
  readonly endingDetail: string | null;
  readonly costUsd: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** An entry of the crew log: what the engine did, for triage. */
export interface CrewLogEntry {
  readonly crew: string;
  readonly run: string | null;
  readonly at: string;
  readonly kind: string;
  readonly payload: unknown;
}

/** Which table changed, for which crew (`null` for per-host rows). */
export interface CrewStoreChange {
  readonly crew: string | null;
  readonly table:
    | "operation"
    | "definition"
    | "member"
    | "lane"
    | "assignment"
    | "host"
    | "claim"
    | "memory"
    | "stint"
    | "run";
}

export interface CrewStoreService {
  readonly putOperation: (row: CrewOperation) => Effect.Effect<void, CrewStoreError>;
  readonly getOperation: (
    id: string,
  ) => Effect.Effect<Option.Option<CrewOperation>, CrewStoreError>;
  /** Only running, failed and interrupted attempts; completed history stays out of snapshots. */
  readonly operations: (
    crew: string,
  ) => Effect.Effect<ReadonlyArray<CrewOperation>, CrewStoreError>;
  readonly putDefinition: (row: CrewDefinitionRow) => Effect.Effect<void, CrewStoreError>;
  readonly getDefinition: (
    crew: string,
  ) => Effect.Effect<Option.Option<CrewDefinitionRow>, CrewStoreError>;
  /** One more change to mirror; returns the new seq. */
  readonly bumpSeq: (crew: string) => Effect.Effect<number, CrewStoreError>;
  /** The ref now holds `seq`; a lower value than already recorded changes nothing. */
  readonly markFlushed: (crew: string, seq: number) => Effect.Effect<void, CrewStoreError>;
  readonly putMember: (row: CrewMemberRow) => Effect.Effect<void, CrewStoreError>;
  readonly members: (crew: string) => Effect.Effect<ReadonlyArray<CrewMemberRow>, CrewStoreError>;
  readonly putAssignment: (row: CrewAssignmentRow) => Effect.Effect<void, CrewStoreError>;
  readonly getAssignment: (
    assignment: string,
  ) => Effect.Effect<Option.Option<CrewAssignmentRow>, CrewStoreError>;
  /** A crewmate's task ids, by number. */
  readonly assignmentsOf: (
    crew: string,
    member: string,
  ) => Effect.Effect<ReadonlyArray<string>, CrewStoreError>;
  /** Every recorded landing made on `host` (its landing operation's host), oldest first. */
  readonly landingsOnHost: (
    host: string,
  ) => Effect.Effect<ReadonlyArray<CrewLanding>, CrewStoreError>;
  readonly putHost: (row: CrewHostRow) => Effect.Effect<void, CrewStoreError>;
  readonly getHost: (host: string) => Effect.Effect<Option.Option<CrewHostRow>, CrewStoreError>;
  readonly getClaim: (host: string) => Effect.Effect<Option.Option<CrewClaimRow>, CrewStoreError>;
  readonly claims: (crew: string) => Effect.Effect<ReadonlyArray<CrewClaimRow>, CrewStoreError>;
  /** Read, change and write a host's claim in one transaction; `none` deletes it. */
  readonly updateClaim: (
    host: string,
    change: (claim: Option.Option<CrewClaimRow>) => Option.Option<CrewClaimRow>,
  ) => Effect.Effect<Option.Option<CrewClaimRow>, CrewStoreError>;
  /** A crewmate's memory, oldest change first. */
  readonly memory: (
    crew: string,
    member: string,
  ) => Effect.Effect<ReadonlyArray<CrewMemoryRow>, CrewStoreError>;
  readonly putMemory: (row: CrewMemoryRow) => Effect.Effect<void, CrewStoreError>;
  readonly deleteMemory: (
    crew: string,
    member: string,
    id: string,
  ) => Effect.Effect<void, CrewStoreError>;
  readonly clearMemory: (crew: string, member: string) => Effect.Effect<void, CrewStoreError>;
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
  readonly deleteMember: (crew: string, handle: string) => Effect.Effect<void, CrewStoreError>;
  /** Every task of a crew, by number. */
  readonly assignments: (
    crew: string,
  ) => Effect.Effect<ReadonlyArray<CrewAssignmentRow>, CrewStoreError>;
  /** The number the crew's next task takes (`#N`, increasing). */
  readonly nextTaskNumber: (crew: string) => Effect.Effect<number, CrewStoreError>;
  readonly putStint: (row: CrewStintRow) => Effect.Effect<void, CrewStoreError>;
  /** Every stint of a crew, by crewmate and number. */
  readonly stints: (crew: string) => Effect.Effect<ReadonlyArray<CrewStintRow>, CrewStoreError>;
  readonly stintByThread: (
    threadId: string,
  ) => Effect.Effect<Option.Option<CrewStintRow>, CrewStoreError>;
  /** Read, change and write one stint in a transaction; a missing stint is left missing. */
  readonly updateStint: (
    crew: string,
    member: string,
    stint: number,
    change: (row: CrewStintRow) => CrewStintRow,
  ) => Effect.Effect<Option.Option<CrewStintRow>, CrewStoreError>;
  readonly putAttempt: (row: CrewAttemptRow) => Effect.Effect<void, CrewStoreError>;
  readonly attemptsOf: (
    assignment: string,
  ) => Effect.Effect<ReadonlyArray<CrewAttemptRow>, CrewStoreError>;
  readonly appendLog: (entry: CrewLogEntry) => Effect.Effect<void, CrewStoreError>;
  /** The crew's log entries of `kinds`, oldest first. */
  readonly logOf: (
    crew: string,
    kinds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<CrewLogEntry>, CrewStoreError>;
  /**
   * Writes the run; with `from`, a move of its state, only while it still
   * stands there — `false` when it moved meanwhile, so a decision made on a
   * stale read never undoes a newer one — keeping the spend as it stands.
   */
  readonly putRun: (row: CrewRunRow, from?: CrewRunState) => Effect.Effect<boolean, CrewStoreError>;
  /** Moves a run's clock and spend in place, never its state. */
  readonly updateRunMeters: (
    run: Pick<CrewRunRow, "crew" | "run">,
    meters: { readonly wallMs?: number; readonly addSpentUsd?: number },
  ) => Effect.Effect<void, CrewStoreError>;
  /** The crew's run started last, in any state. */
  readonly latestRun: (crew: string) => Effect.Effect<Option.Option<CrewRunRow>, CrewStoreError>;
  readonly changes: Stream.Stream<CrewStoreChange>;
  readonly subscribeChanges: SubscribeUpdateChanges;
}

export class CrewStore extends Context.Service<CrewStore, CrewStoreService>()(
  "t3/zerops/crew/CrewStore",
) {}

const JsonValue = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownEffect(JsonValue);
const encodeJson = Schema.encodeUnknownEffect(JsonValue);

interface DefinitionSqlRow extends Omit<CrewDefinitionRow, "spec"> {
  readonly spec: string;
}

const NullableJsonValue = Schema.NullOr(JsonValue);
const RunOptionsJson = Schema.fromJsonString(
  Schema.Struct({ options: Schema.Unknown, reasonDetail: Schema.NullOr(Schema.String) }),
);
const decodeRunOptions = Schema.decodeEffect(RunOptionsJson);
const encodeRunOptions = Schema.encodeEffect(RunOptionsJson);

interface RunSqlRow extends Omit<CrewRunRow, "options" | "reasonDetail"> {
  readonly options: string;
}
const decodeNullableJson = Schema.decodeUnknownEffect(NullableJsonValue);
const encodeNullableJson = Schema.encodeUnknownEffect(NullableJsonValue);
const DependsOn = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeDependsOn = Schema.decodeEffect(DependsOn);
const encodeDependsOn = Schema.encodeEffect(DependsOn);
const CrewPorts = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ port: Schema.Number, routed: Schema.NullOr(Schema.Boolean) })),
);
const decodeCrewPorts = Schema.decodeEffect(CrewPorts);
const encodeCrewPorts = Schema.encodeEffect(CrewPorts);

interface MemberSqlRow extends Omit<CrewMemberRow, "readOnly" | "restartAfterMerge" | "config"> {
  readonly readOnly: number;
  readonly restartAfterMerge: number;
  readonly config: string;
}

interface AssignmentSqlRow extends Omit<
  CrewAssignmentRow,
  "card" | "pending" | "dependsOn" | "fresh" | "check" | "review" | "report" | "waiting"
> {
  readonly card: string | null;
  readonly pending: string | null;
  readonly dependsOn: string;
  readonly fresh: number;
  readonly check: string | null;
  readonly review: string | null;
  readonly report: string | null;
  readonly waiting: string | null;
}

const MemoryPaths = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeMemoryPaths = Schema.decodeEffect(MemoryPaths);
const encodeMemoryPaths = Schema.encodeEffect(MemoryPaths);

interface MemorySqlRow extends Omit<CrewMemoryRow, "paths"> {
  readonly paths: string;
}

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
  readonly state: CrewLaneState;
}

const decodeRefSnapshot = Schema.decodeUnknownEffect(RefSnapshot);
const encodeRefSnapshot = Schema.encodeUnknownEffect(RefSnapshot);

interface StintSqlRow extends Omit<CrewStintRow, "rotatePending" | "seededFrom"> {
  readonly rotatePending: number;
  readonly seededFrom: string | null;
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<CrewStoreChange>();

  const sqlError = (operation: string) => (cause: unknown) =>
    new CrewStoreError({ operation, kind: "sql", cause });
  const decodeError = (operation: string) => (cause: Schema.SchemaError) =>
    new CrewStoreError({ operation, kind: "decode", cause });
  const publish = (change: CrewStoreChange) => PubSub.publish(changes, change).pipe(Effect.asVoid);

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
        frozen_since AS "frozenSince",
        state
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
          ref_snapshot_json, lockfile_hash, frozen_since, state
        ) VALUES (
          ${row.crew}, ${row.lane}, ${row.host}, ${row.branch}, ${row.dispatchCommit},
          ${row.recordedTip}, ${row.lastLanding}, ${refSnapshot}, ${row.lockfileHash},
          ${row.frozenSince}, ${row.state}
        )
        ON CONFLICT (crew, lane) DO UPDATE SET
          host = excluded.host,
          branch = excluded.branch,
          dispatch_commit = excluded.dispatch_commit,
          recorded_tip = excluded.recorded_tip,
          last_landing = excluded.last_landing,
          ref_snapshot_json = excluded.ref_snapshot_json,
          lockfile_hash = excluded.lockfile_hash,
          frozen_since = excluded.frozen_since,
          state = excluded.state
      `.pipe(Effect.mapError(sqlError("putLane")));
    });

  const getDefinition: CrewStoreService["getDefinition"] = (crew) =>
    sql<DefinitionSqlRow>`
      SELECT
        crew,
        home_host AS "homeHost",
        spec_json AS "spec",
        brief_hash AS "briefHash",
        brief_version AS "briefVersion",
        applied_at AS "appliedAt",
        applied_by AS "appliedBy",
        seq,
        flushed_seq AS "flushedSeq",
        state
      FROM crew_definition
      WHERE crew = ${crew}
    `.pipe(
      Effect.mapError(sqlError("getDefinition")),
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<CrewDefinitionRow>())
          : decodeJson(rows[0].spec).pipe(
              Effect.mapError(decodeError("getDefinition")),
              Effect.map((spec) => Option.some({ ...rows[0]!, spec })),
            ),
      ),
    );

  const decode = <A>(operation: string, effect: Effect.Effect<A, Schema.SchemaError>) =>
    effect.pipe(Effect.mapError(decodeError(operation)));

  const memberFromSql = (row: MemberSqlRow) =>
    decode("members", decodeJson(row.config)).pipe(
      Effect.map((config): CrewMemberRow => ({
        ...row,
        readOnly: row.readOnly !== 0,
        restartAfterMerge: row.restartAfterMerge !== 0,
        config,
      })),
    );

  const assignmentFromSql = (row: AssignmentSqlRow) =>
    Effect.gen(function* () {
      const json = (value: string | null) => decode("assignment", decodeNullableJson(value));
      return {
        ...row,
        card: yield* json(row.card),
        pending: yield* json(row.pending),
        dependsOn: yield* decode("assignment", decodeDependsOn(row.dependsOn)),
        fresh: row.fresh !== 0,
        check: yield* json(row.check),
        review: yield* json(row.review),
        report: yield* json(row.report),
        waiting: yield* json(row.waiting),
      } satisfies CrewAssignmentRow;
    });

  const selectClaims = (where: "host" | "crew", key: string) =>
    sql<CrewClaimRow>`
      SELECT
        host, crew, member, lane, state,
        requested_at AS "requestedAt",
        granted_by AS "grantedBy",
        granted_at AS "grantedAt",
        expires_at AS "expiresAt",
        released_at AS "releasedAt"
      FROM crew_claim
      WHERE ${where === "host" ? sql`host = ${key}` : sql`crew = ${key}`}
      ORDER BY host
    `.pipe(Effect.mapError(sqlError("claims")));

  const getClaim: CrewStoreService["getClaim"] = (host) =>
    selectClaims("host", host).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

  const writeClaim = (host: string, claim: Option.Option<CrewClaimRow>) =>
    Option.match(claim, {
      onNone: () => sql`DELETE FROM crew_claim WHERE host = ${host}`,
      onSome: (row) => sql`
        INSERT INTO crew_claim (
          host, crew, member, lane, state, requested_at, granted_by, granted_at,
          expires_at, released_at
        ) VALUES (
          ${host}, ${row.crew}, ${row.member}, ${row.lane}, ${row.state}, ${row.requestedAt},
          ${row.grantedBy}, ${row.grantedAt}, ${row.expiresAt}, ${row.releasedAt}
        )
        ON CONFLICT (host) DO UPDATE SET
          crew = excluded.crew,
          member = excluded.member,
          lane = excluded.lane,
          state = excluded.state,
          requested_at = excluded.requested_at,
          granted_by = excluded.granted_by,
          granted_at = excluded.granted_at,
          expires_at = excluded.expires_at,
          released_at = excluded.released_at
      `,
    }).pipe(Effect.mapError(sqlError("updateClaim")));

  const getLane: CrewStoreService["getLane"] = (crew, lane) =>
    selectLanes("lane", crew, lane).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

  const selectStints = (
    where: "crew" | "thread" | "stint",
    key: string,
    member = "",
    stint = 0,
  ) => {
    const filter =
      where === "crew"
        ? sql`crew = ${key}`
        : where === "thread"
          ? sql`thread_id = ${key}`
          : sql`crew = ${key} AND member = ${member} AND stint = ${stint}`;
    return sql<StintSqlRow>`
      SELECT
        crew, member, stint,
        thread_id AS "threadId",
        session_id AS "sessionId",
        transcript_path AS "transcriptPath",
        compactions,
        last_compact_summary AS "lastCompactSummary",
        rotate_pending AS "rotatePending",
        reason,
        seeded_from_json AS "seededFrom",
        brief_version AS "briefVersion",
        job_version AS "jobVersion",
        started_at AS "startedAt",
        retired_at AS "retiredAt"
      FROM crew_stint
      WHERE ${filter}
      ORDER BY member, stint
    `.pipe(
      Effect.mapError(sqlError("stints")),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          decode("stints", decodeNullableJson(row.seededFrom)).pipe(
            Effect.map((seededFrom): CrewStintRow => ({
              ...row,
              rotatePending: row.rotatePending !== 0,
              seededFrom,
            })),
          ),
        ),
      ),
    );
  };

  const writeStint = (row: CrewStintRow) =>
    Effect.gen(function* () {
      const seededFrom = yield* decode("putStint", encodeNullableJson(row.seededFrom));
      yield* sql`
        INSERT INTO crew_stint (
          crew, member, stint, thread_id, session_id, transcript_path, compactions,
          last_compact_summary, rotate_pending, reason, seeded_from_json, brief_version,
          job_version, started_at, retired_at
        ) VALUES (
          ${row.crew}, ${row.member}, ${row.stint}, ${row.threadId}, ${row.sessionId},
          ${row.transcriptPath}, ${row.compactions}, ${row.lastCompactSummary},
          ${row.rotatePending ? 1 : 0}, ${row.reason}, ${seededFrom}, ${row.briefVersion},
          ${row.jobVersion}, ${row.startedAt}, ${row.retiredAt}
        )
        ON CONFLICT (crew, member, stint) DO UPDATE SET
          thread_id = excluded.thread_id,
          session_id = excluded.session_id,
          transcript_path = excluded.transcript_path,
          compactions = excluded.compactions,
          last_compact_summary = excluded.last_compact_summary,
          rotate_pending = excluded.rotate_pending,
          reason = excluded.reason,
          seeded_from_json = excluded.seeded_from_json,
          brief_version = excluded.brief_version,
          job_version = excluded.job_version,
          started_at = excluded.started_at,
          retired_at = excluded.retired_at
      `.pipe(Effect.mapError(sqlError("putStint")));
    });

  const selectAssignments = (crew: string) =>
    sql<AssignmentSqlRow>`
      SELECT
        assignment, run, crew, member, number, title, source,
        created_by AS "createdBy",
        card_json AS "card",
        pending_json AS "pending",
        depends_on_json AS "dependsOn",
        fresh, state, attempt, reworks, remerges,
        merged_head AS "mergedHead",
        check_json AS "check",
        review_json AS "review",
        report_json AS "report",
        waiting_json AS "waiting",
        landed_commit AS "landedCommit",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM crew_assignment
      WHERE crew = ${crew}
      ORDER BY number
    `.pipe(
      Effect.mapError(sqlError("assignments")),
      Effect.flatMap((rows) => Effect.forEach(rows, assignmentFromSql)),
    );

  const operationJson = Schema.fromJsonString(CrewOperation);
  const readOperations = (rows: ReadonlyArray<{ readonly data: string }>) =>
    Effect.forEach(rows, (row) =>
      Schema.decodeEffect(operationJson)(row.data).pipe(Effect.mapError(decodeError("operation"))),
    );

  return CrewStore.of({
    putOperation: (row) =>
      Effect.gen(function* () {
        const data = yield* Schema.encodeEffect(operationJson)(row).pipe(
          Effect.mapError(decodeError("putOperation")),
        );
        yield* sql`INSERT INTO crew_operation (id, crew, status, data) VALUES (${row.id}, ${row.crew}, ${row.status}, ${data})
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`.pipe(
          Effect.mapError(sqlError("putOperation")),
        );
        yield* publish({ crew: row.crew, table: "operation" });
      }),
    getOperation: (id) =>
      sql<{ readonly data: string }>`SELECT data FROM crew_operation WHERE id = ${id}`.pipe(
        Effect.mapError(sqlError("getOperation")),
        Effect.flatMap(readOperations),
        Effect.map((rows) => Option.fromUndefinedOr(rows[0])),
      ),
    operations: (crew) =>
      sql<{
        readonly data: string;
      }>`SELECT data FROM crew_operation WHERE crew = ${crew} AND status IN ('running', 'failed', 'interrupted') ORDER BY rowid`.pipe(
        Effect.mapError(sqlError("operations")),
        Effect.flatMap(readOperations),
      ),
    putDefinition: (row) =>
      Effect.gen(function* () {
        const spec = yield* encodeJson(row.spec).pipe(
          Effect.mapError(decodeError("putDefinition")),
        );
        yield* sql`
          INSERT INTO crew_definition (
            crew, home_host, spec_json, brief_hash, brief_version, applied_at, applied_by,
            seq, flushed_seq, state
          ) VALUES (
            ${row.crew}, ${row.homeHost}, ${spec}, ${row.briefHash}, ${row.briefVersion},
            ${row.appliedAt}, ${row.appliedBy}, ${row.seq}, ${row.flushedSeq}, ${row.state}
          )
          ON CONFLICT (crew) DO UPDATE SET
            home_host = excluded.home_host,
            spec_json = excluded.spec_json,
            brief_hash = excluded.brief_hash,
            brief_version = excluded.brief_version,
            applied_at = excluded.applied_at,
            applied_by = excluded.applied_by,
            seq = excluded.seq,
            flushed_seq = excluded.flushed_seq,
            state = excluded.state
        `.pipe(Effect.mapError(sqlError("putDefinition")));
        yield* publish({ crew: row.crew, table: "definition" });
      }),
    getDefinition,
    putMember: (row) =>
      Effect.gen(function* () {
        const config = yield* decode("putMember", encodeJson(row.config));
        yield* sql`
          INSERT INTO crew_member (
            crew, handle, display_name, kind, tint, host, lane, read_only, login, model, effort,
            job_version, run_command, restart_after_merge, crew_port, config_json
          ) VALUES (
            ${row.crew}, ${row.handle}, ${row.displayName}, ${row.kind}, ${row.tint}, ${row.host},
            ${row.lane}, ${row.readOnly ? 1 : 0}, ${row.login}, ${row.model}, ${row.effort},
            ${row.jobVersion}, ${row.runCommand}, ${row.restartAfterMerge ? 1 : 0},
            ${row.crewPort}, ${config}
          )
          ON CONFLICT (crew, handle) DO UPDATE SET
            display_name = excluded.display_name,
            kind = excluded.kind,
            tint = excluded.tint,
            host = excluded.host,
            lane = excluded.lane,
            read_only = excluded.read_only,
            login = excluded.login,
            model = excluded.model,
            effort = excluded.effort,
            job_version = excluded.job_version,
            run_command = excluded.run_command,
            restart_after_merge = excluded.restart_after_merge,
            crew_port = excluded.crew_port,
            config_json = excluded.config_json
        `.pipe(Effect.mapError(sqlError("putMember")));
        yield* publish({ crew: row.crew, table: "member" });
      }),
    members: (crew) =>
      sql<MemberSqlRow>`
        SELECT
          crew, handle,
          display_name AS "displayName",
          kind, tint, host, lane,
          read_only AS "readOnly",
          login, model, effort,
          job_version AS "jobVersion",
          run_command AS "runCommand",
          restart_after_merge AS "restartAfterMerge",
          crew_port AS "crewPort",
          config_json AS "config"
        FROM crew_member
        WHERE crew = ${crew}
        ORDER BY handle
      `.pipe(
        Effect.mapError(sqlError("members")),
        Effect.flatMap((rows) => Effect.forEach(rows, memberFromSql)),
      ),
    putAssignment: (row) =>
      Effect.gen(function* () {
        const json = (value: unknown) => decode("putAssignment", encodeNullableJson(value));
        const dependsOn = yield* decode("putAssignment", encodeDependsOn(row.dependsOn));
        const [card, pending, check, review, report, waiting] = [
          yield* json(row.card),
          yield* json(row.pending),
          yield* json(row.check),
          yield* json(row.review),
          yield* json(row.report),
          yield* json(row.waiting),
        ];
        yield* sql`
          INSERT INTO crew_assignment (
            assignment, run, crew, member, number, title, source, created_by, card_json,
            pending_json, depends_on_json, fresh, state, attempt, reworks, remerges,
            merged_head, check_json, review_json, report_json, waiting_json, landed_commit,
            created_at, updated_at
          ) VALUES (
            ${row.assignment}, ${row.run}, ${row.crew}, ${row.member}, ${row.number},
            ${row.title}, ${row.source}, ${row.createdBy}, ${card}, ${pending}, ${dependsOn},
            ${row.fresh ? 1 : 0}, ${row.state}, ${row.attempt}, ${row.reworks}, ${row.remerges},
            ${row.mergedHead}, ${check}, ${review}, ${report}, ${waiting}, ${row.landedCommit},
            ${row.createdAt}, ${row.updatedAt}
          )
          ON CONFLICT (assignment) DO UPDATE SET
            run = excluded.run,
            member = excluded.member,
            title = excluded.title,
            card_json = excluded.card_json,
            pending_json = excluded.pending_json,
            depends_on_json = excluded.depends_on_json,
            fresh = excluded.fresh,
            state = excluded.state,
            attempt = excluded.attempt,
            reworks = excluded.reworks,
            remerges = excluded.remerges,
            merged_head = excluded.merged_head,
            check_json = excluded.check_json,
            review_json = excluded.review_json,
            report_json = excluded.report_json,
            waiting_json = excluded.waiting_json,
            landed_commit = excluded.landed_commit,
            updated_at = excluded.updated_at
        `.pipe(Effect.mapError(sqlError("putAssignment")));
        yield* publish({ crew: row.crew, table: "assignment" });
      }),
    getAssignment: (assignment) =>
      sql<AssignmentSqlRow>`
        SELECT
          assignment, run, crew, member, number, title, source,
          created_by AS "createdBy",
          card_json AS "card",
          pending_json AS "pending",
          depends_on_json AS "dependsOn",
          fresh, state, attempt, reworks, remerges,
          merged_head AS "mergedHead",
          check_json AS "check",
          review_json AS "review",
          report_json AS "report",
          waiting_json AS "waiting",
          landed_commit AS "landedCommit",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM crew_assignment
        WHERE assignment = ${assignment}
      `.pipe(
        Effect.mapError(sqlError("getAssignment")),
        Effect.flatMap((rows) =>
          rows[0] === undefined
            ? Effect.succeed(Option.none<CrewAssignmentRow>())
            : assignmentFromSql(rows[0]).pipe(Effect.asSome),
        ),
      ),
    assignmentsOf: (crew, member) =>
      sql<{ readonly assignment: string }>`
        SELECT assignment FROM crew_assignment
        WHERE crew = ${crew} AND member = ${member}
        ORDER BY number
      `.pipe(
        Effect.mapError(sqlError("assignmentsOf")),
        Effect.map((rows) => rows.map((row) => row.assignment)),
      ),
    landingsOnHost: (host) =>
      // Each landing on the host it landed on (its landing operation's), else its crewmate's.
      sql<CrewLanding>`
        SELECT
          a.crew, a.member, a.assignment, a.title,
          a.landed_commit AS "landedCommit"
        FROM crew_assignment a
        LEFT JOIN crew_member m ON m.crew = a.crew AND m.handle = a.member
        WHERE a.landed_commit IS NOT NULL AND COALESCE(
          (
            SELECT json_extract(o.data, '$.targets.host') FROM crew_operation o
            WHERE o.crew = a.crew
              AND json_extract(o.data, '$.kind') = 'landing'
              AND json_extract(o.data, '$.taskId') = a.assignment
              AND json_extract(o.data, '$.targets.host') IS NOT NULL
            ORDER BY o.rowid DESC LIMIT 1
          ),
          m.host
        ) = ${host}
        ORDER BY a.updated_at, a.number
      `.pipe(Effect.mapError(sqlError("landingsOnHost"))),
    putHost: (row) =>
      Effect.gen(function* () {
        const crewPorts = yield* decode("putHost", encodeCrewPorts(row.crewPorts));
        yield* sql`
          INSERT INTO crew_host (host, crew_ports_json) VALUES (${row.host}, ${crewPorts})
          ON CONFLICT (host) DO UPDATE SET crew_ports_json = excluded.crew_ports_json
        `.pipe(Effect.mapError(sqlError("putHost")));
        yield* publish({ crew: null, table: "host" });
      }),
    getHost: (host) =>
      sql<{ readonly host: string; readonly crewPorts: string }>`
        SELECT host, crew_ports_json AS "crewPorts" FROM crew_host WHERE host = ${host}
      `.pipe(
        Effect.mapError(sqlError("getHost")),
        Effect.flatMap((rows) =>
          rows[0] === undefined
            ? Effect.succeed(Option.none<CrewHostRow>())
            : decode("getHost", decodeCrewPorts(rows[0].crewPorts)).pipe(
                Effect.map((crewPorts) => Option.some({ host: rows[0]!.host, crewPorts })),
              ),
        ),
      ),
    bumpSeq: (crew) =>
      sql<{ readonly seq: number }>`
        UPDATE crew_definition SET seq = seq + 1 WHERE crew = ${crew} RETURNING seq
      `.pipe(
        Effect.mapError(sqlError("bumpSeq")),
        Effect.tap(() => publish({ crew, table: "definition" })),
        Effect.map((rows) => rows[0]?.seq ?? 0),
      ),
    markFlushed: (crew, seq) =>
      sql`
        UPDATE crew_definition SET flushed_seq = MAX(flushed_seq, ${seq}) WHERE crew = ${crew}
      `.pipe(
        Effect.mapError(sqlError("markFlushed")),
        Effect.andThen(publish({ crew, table: "definition" })),
      ),
    getClaim,
    claims: (crew) => selectClaims("crew", crew),
    updateClaim: (host, change) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const before = yield* getClaim(host);
            const after = change(before);
            yield* writeClaim(host, after);
            return { before, after };
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", (cause) => Effect.fail(sqlError("updateClaim")(cause))),
          Effect.tap(({ before, after }) =>
            Option.match(
              Option.orElse(after, () => before),
              {
                onNone: () => Effect.void,
                onSome: (row) => publish({ crew: row.crew, table: "claim" }),
              },
            ),
          ),
          Effect.map(({ after }) => after),
        ),
    memory: (crew, member) =>
      sql<MemorySqlRow>`
        SELECT
          crew, member, id, kind, topic, text,
          paths_json AS "paths",
          verified_at AS "verifiedAt",
          from_assignment AS "fromAssignment",
          updated_at AS "updatedAt"
        FROM crew_memory
        WHERE crew = ${crew} AND member = ${member}
        ORDER BY updated_at, id
      `.pipe(
        Effect.mapError(sqlError("memory")),
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) =>
            decode("memory", decodeMemoryPaths(row.paths)).pipe(
              Effect.map((paths): CrewMemoryRow => ({ ...row, paths })),
            ),
          ),
        ),
      ),
    putMemory: (row) =>
      Effect.gen(function* () {
        const paths = yield* decode("putMemory", encodeMemoryPaths(row.paths));
        yield* sql`
          INSERT INTO crew_memory (
            crew, member, id, kind, topic, text, paths_json, verified_at, from_assignment,
            updated_at
          ) VALUES (
            ${row.crew}, ${row.member}, ${row.id}, ${row.kind}, ${row.topic}, ${row.text},
            ${paths}, ${row.verifiedAt}, ${row.fromAssignment}, ${row.updatedAt}
          )
          ON CONFLICT (crew, member, id) DO UPDATE SET
            kind = excluded.kind,
            topic = excluded.topic,
            text = excluded.text,
            paths_json = excluded.paths_json,
            verified_at = excluded.verified_at,
            from_assignment = excluded.from_assignment,
            updated_at = excluded.updated_at
        `.pipe(Effect.mapError(sqlError("putMemory")));
        yield* publish({ crew: row.crew, table: "memory" });
      }),
    deleteMemory: (crew, member, id) =>
      sql`DELETE FROM crew_memory WHERE crew = ${crew} AND member = ${member} AND id = ${id}`.pipe(
        Effect.mapError(sqlError("deleteMemory")),
        Effect.andThen(publish({ crew, table: "memory" })),
      ),
    clearMemory: (crew, member) =>
      sql`DELETE FROM crew_memory WHERE crew = ${crew} AND member = ${member}`.pipe(
        Effect.mapError(sqlError("clearMemory")),
        Effect.andThen(publish({ crew, table: "memory" })),
      ),
    putLane: (row) =>
      writeLane(row).pipe(Effect.andThen(publish({ crew: row.crew, table: "lane" }))),
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
          Effect.catchTag("SqlError", (cause) => Effect.fail(sqlError("updateLane")(cause))),
          Effect.tap(() => publish({ crew, table: "lane" })),
        ),
    deleteLane: (crew, lane) =>
      sql`DELETE FROM crew_lane WHERE crew = ${crew} AND lane = ${lane}`.pipe(
        Effect.mapError(sqlError("deleteLane")),
        Effect.andThen(publish({ crew, table: "lane" })),
      ),
    lanes: (crew) => selectLanes("crew", crew, crew),
    lanesOnHost: (host) => selectLanes("host", "", host),
    deleteMember: (crew, handle) =>
      sql`DELETE FROM crew_member WHERE crew = ${crew} AND handle = ${handle}`.pipe(
        Effect.mapError(sqlError("deleteMember")),
        Effect.andThen(publish({ crew, table: "member" })),
      ),
    assignments: selectAssignments,
    nextTaskNumber: (crew) =>
      sql<{ readonly next: number }>`
        SELECT COALESCE(MAX(number), 0) + 1 AS next FROM crew_assignment WHERE crew = ${crew}
      `.pipe(
        Effect.mapError(sqlError("nextTaskNumber")),
        Effect.map((rows) => rows[0]?.next ?? 1),
      ),
    putStint: (row) =>
      writeStint(row).pipe(Effect.andThen(publish({ crew: row.crew, table: "stint" }))),
    stints: (crew) => selectStints("crew", crew),
    stintByThread: (threadId) =>
      selectStints("thread", threadId).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),
    updateStint: (crew, member, stint, change) =>
      sql
        .withTransaction(
          selectStints("stint", crew, member, stint).pipe(
            Effect.flatMap((rows) => {
              const row = rows[0];
              if (row === undefined) return Effect.succeed(Option.none<CrewStintRow>());
              const next = change(row);
              return writeStint(next).pipe(Effect.as(Option.some(next)));
            }),
          ),
        )
        .pipe(
          Effect.catchTag("SqlError", (cause) => Effect.fail(sqlError("updateStint")(cause))),
          Effect.tap(() => publish({ crew, table: "stint" })),
        ),
    putAttempt: (row) =>
      sql`
        INSERT INTO crew_attempt (
          assignment, attempt, thread_id, dispatch_commit, tip_ref, rotations, ending,
          ending_detail, cost_usd, started_at, ended_at
        ) VALUES (
          ${row.assignment}, ${row.attempt}, ${row.threadId}, ${row.dispatchCommit},
          ${row.tipRef}, ${row.rotations}, ${row.ending}, ${row.endingDetail}, ${row.costUsd},
          ${row.startedAt}, ${row.endedAt}
        )
        ON CONFLICT (assignment, attempt) DO UPDATE SET
          thread_id = excluded.thread_id,
          dispatch_commit = excluded.dispatch_commit,
          tip_ref = excluded.tip_ref,
          rotations = excluded.rotations,
          ending = excluded.ending,
          ending_detail = excluded.ending_detail,
          cost_usd = excluded.cost_usd,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at
      `.pipe(Effect.mapError(sqlError("putAttempt"))),
    attemptsOf: (assignment) =>
      sql<CrewAttemptRow>`
        SELECT
          assignment, attempt,
          thread_id AS "threadId",
          dispatch_commit AS "dispatchCommit",
          tip_ref AS "tipRef",
          rotations, ending,
          ending_detail AS "endingDetail",
          cost_usd AS "costUsd",
          started_at AS "startedAt",
          ended_at AS "endedAt"
        FROM crew_attempt
        WHERE assignment = ${assignment}
        ORDER BY attempt
      `.pipe(Effect.mapError(sqlError("attemptsOf"))),
    appendLog: (entry) =>
      Effect.gen(function* () {
        const payload = yield* decode("appendLog", encodeJson(entry.payload));
        yield* sql`
          INSERT INTO crew_log (crew, run, at, kind, payload_json)
          VALUES (${entry.crew}, ${entry.run}, ${entry.at}, ${entry.kind}, ${payload})
        `.pipe(Effect.mapError(sqlError("appendLog")));
      }),
    logOf: (crew, kinds) =>
      kinds.length === 0
        ? Effect.succeed([])
        : sql<{
            readonly crew: string;
            readonly run: string | null;
            readonly at: string;
            readonly kind: string;
            readonly payload: string;
          }>`
            SELECT crew, run, at, kind, payload_json AS "payload"
            FROM crew_log
            WHERE crew = ${crew} AND ${sql.in("kind", kinds)}
            ORDER BY seq
          `.pipe(
            Effect.mapError(sqlError("logOf")),
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) =>
                decode("logOf", decodeJson(row.payload)).pipe(
                  Effect.map((payload): CrewLogEntry => ({ ...row, payload })),
                ),
              ),
            ),
          ),
    putRun: (row, from) =>
      Effect.gen(function* () {
        const options = yield* decode(
          "putRun",
          encodeRunOptions({ options: row.options, reasonDetail: row.reasonDetail }),
        );
        const written = yield* sql<{ readonly run: string }>`
          INSERT INTO crew_run (
            run, crew, started_by, budget_usd, spent_usd, options_json, state, reason,
            started_at, wall_ms, waiting_ms, finished_at
          ) VALUES (
            ${row.run}, ${row.crew}, ${row.startedBy}, ${row.budgetUsd}, ${row.spentUsd},
            ${options}, ${row.state}, ${row.reason}, ${row.startedAt}, ${row.wallMs},
            ${row.waitingMs}, ${row.finishedAt}
          )
          ON CONFLICT (run) DO UPDATE SET
            budget_usd = excluded.budget_usd,
            spent_usd = ${from === undefined ? sql`excluded.spent_usd` : sql`crew_run.spent_usd`},
            options_json = excluded.options_json,
            state = excluded.state,
            reason = excluded.reason,
            wall_ms = excluded.wall_ms,
            waiting_ms = excluded.waiting_ms,
            finished_at = excluded.finished_at
          WHERE ${from === undefined ? sql`1` : sql`crew_run.state = ${from}`}
          RETURNING run
        `.pipe(Effect.mapError(sqlError("putRun")));
        yield* publish({ crew: row.crew, table: "run" });
        return written.length > 0;
      }),
    updateRunMeters: (run, meters) =>
      sql`
        UPDATE crew_run SET
          wall_ms = COALESCE(${meters.wallMs ?? null}, wall_ms),
          spent_usd = spent_usd + ${meters.addSpentUsd ?? 0}
        WHERE run = ${run.run}
      `.pipe(
        Effect.mapError(sqlError("updateRunMeters")),
        Effect.andThen(publish({ crew: run.crew, table: "run" })),
      ),
    latestRun: (crew) =>
      sql<RunSqlRow>`
        SELECT
          run, crew,
          started_by AS "startedBy",
          budget_usd AS "budgetUsd",
          spent_usd AS "spentUsd",
          options_json AS "options",
          state, reason,
          started_at AS "startedAt",
          wall_ms AS "wallMs",
          waiting_ms AS "waitingMs",
          finished_at AS "finishedAt"
        FROM crew_run
        WHERE crew = ${crew}
        ORDER BY started_at DESC
        LIMIT 1
      `.pipe(
        Effect.mapError(sqlError("latestRun")),
        Effect.flatMap((rows) =>
          rows[0] === undefined
            ? Effect.succeed(Option.none<CrewRunRow>())
            : decode("latestRun", decodeRunOptions(rows[0].options)).pipe(
                Effect.map(({ options, reasonDetail }) =>
                  Option.some({ ...rows[0]!, options, reasonDetail }),
                ),
              ),
        ),
      ),
    changes: Stream.fromPubSub(changes),
    subscribeChanges: subscribeUpdateChanges(changes),
  });
});

export const layer = Layer.effect(CrewStore, make);
