/**
 * CrewStore - the crew tables (migration `055_Crew`) plus a change feed.
 *
 * Rows are plain values; JSON columns are decoded here so no caller parses
 * SQL text. Every write publishes a {@link CrewStoreChange} so a snapshot
 * subscriber re-reads without polling. Git is the truth for lanes - a lane
 * row is what the engine last wrote and saw, re-derived by the boot sweep.
 *
 * This slice covers the rows the git core and the crew tools read and write
 * (definition seq, crewmates, lanes, task landings, dev-service crew ports,
 * Show-on-dev claims, memory); runs, attempts, stints and the log are tables
 * the engine adds rows for.
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
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type {
  CrewClaimState,
  CrewMemberKind,
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
  /** Whether the service's subdomain routes the port (`httpRouting`). */
  readonly routed: boolean;
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

/** `parked`: the engine stopped using the lane until the person triages it · `lost`: a recovery could not bring it back. */
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

/** Which table changed, for which crew (`null` for per-host rows). */
export interface CrewStoreChange {
  readonly crew: string | null;
  readonly table: "definition" | "member" | "lane" | "assignment" | "host" | "claim" | "memory";
}

export interface CrewStoreService {
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
  /** Every recorded landing by a crewmate on `host`, oldest first. */
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
  readonly changes: Stream.Stream<CrewStoreChange>;
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
const decodeNullableJson = Schema.decodeUnknownEffect(NullableJsonValue);
const encodeNullableJson = Schema.encodeUnknownEffect(NullableJsonValue);
const DependsOn = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeDependsOn = Schema.decodeEffect(DependsOn);
const encodeDependsOn = Schema.encodeEffect(DependsOn);
const CrewPorts = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ port: Schema.Number, routed: Schema.Boolean })),
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

  return CrewStore.of({
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
      sql<CrewLanding>`
        SELECT
          a.crew, a.member, a.assignment, a.title,
          a.landed_commit AS "landedCommit"
        FROM crew_assignment a
        JOIN crew_member m ON m.crew = a.crew AND m.handle = a.member
        WHERE m.host = ${host} AND a.landed_commit IS NOT NULL
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
    changes: Stream.fromPubSub(changes),
  });
});

export const layer = Layer.effect(CrewStore, make);
