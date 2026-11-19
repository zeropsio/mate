/**
 * Crew rows at the flip, written as V1's tables held them: a lead, three
 * writers and a reader, a run working on its own, open work in every state the flip handles —
 * working, checking, landing, queued, a question asked — sixty landed tasks, a held claim and a
 * request, memory, ports, and each crewmate's stints with their threads' turns.
 *
 * @module crew/testing/v1CrewSeed
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type { CrewTaskState } from "@t3tools/contracts";

import { runMigrations } from "../../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../../persistence/Layers/ProjectionThreadMessages.ts";
import { ProjectionTurnRepositoryLive } from "../../../persistence/Layers/ProjectionTurns.ts";
import {
  ProjectionThreadMessageRepository,
  type ProjectionThreadMessage,
} from "../../../persistence/Services/ProjectionThreadMessages.ts";
import {
  ProjectionTurnRepository,
  type ProjectionTurnById,
} from "../../../persistence/Services/ProjectionTurns.ts";
import { make as makeCrewStore, type CrewAssignmentRow } from "../CrewStore.ts";
import { OPTIONS, home, lead, reader, writer } from "../engine/crewDecideFixture.ts";

const BASE = Date.parse("2026-10-08T09:00:00.000Z");
const memoryPathsJson = JSON.stringify(["package.json"]);
/** The time `minutes` into the crew's day. */
export const at = (minutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(BASE + minutes * 60_000));
/** When the Mate flips: an hour in. */
export const FLIP = BASE + 60 * 60_000;

export const DEFINITION = home(
  lead("lead"),
  writer("ana"),
  writer("bob"),
  writer("cy", { host: "stagedev" }),
  reader("dee"),
);

const definitionJson = JSON.stringify(DEFINITION);
const memberConfigJson = JSON.stringify({});
const crewPortsJson = JSON.stringify([{ port: 4001, routed: true }]);
const seededFromJson = JSON.stringify(null);
const runOptionsJson = JSON.stringify({
  options: { ...OPTIONS, landing: "check" },
  reasonDetail: null,
});

/** The landed tasks ana's crew finished: more than the import brings. */
export const LANDED = 60;

/** Each crewmate's stints: their threads, and why each after the first began, in V1's words. */
export const STINTS: ReadonlyArray<{
  readonly member: string;
  readonly threads: ReadonlyArray<{ readonly id: string; readonly words: string | null }>;
}> = [
  {
    member: "ana",
    threads: [
      { id: "ana-s1", words: null },
      { id: "ana-s2", words: "You cleared its conversation" },
      { id: "ana-s3", words: "Its job changed" },
    ],
  },
  { member: "bob", threads: [{ id: "bob-s1", words: null }] },
];

const task = (
  number: number,
  member: string,
  state: CrewTaskState,
  fields: Partial<CrewAssignmentRow> = {},
): CrewAssignmentRow => ({
  assignment: `task-${number}`,
  run: "run-1",
  crew: "main",
  member,
  number,
  title: `Task ${number}`,
  source: "you",
  createdBy: "user-1",
  card: { brief: `Do task ${number}.`, doneWhen: "It works.", note: null },
  pending: null,
  dependsOn: [],
  fresh: false,
  state,
  attempt: state === "queued" ? 0 : 1,
  reworks: 0,
  remerges: 0,
  mergedHead: null,
  check: null,
  review: null,
  report: null,
  waiting: null,
  landedCommit: null,
  createdAt: at(5),
  updatedAt: at(20),
  ...fields,
});

export const TASKS: ReadonlyArray<CrewAssignmentRow> = [
  task(1, "ana", "working"),
  task(2, "bob", "checking", { check: { state: "running", output: "" } }),
  task(3, "cy", "landing", {
    check: { state: "passed", output: "ok", tip: "abc123" },
    attempt: 2,
    reworks: 1,
  }),
  task(4, "ana", "queued", { run: null, dependsOn: ["task-1"] }),
  task(5, "dee", "blocked", {
    report: { status: "blocked", summary: "Reading the API.", question: "Which port?" },
    updatedAt: at(30),
  }),
  ...Array.from({ length: LANDED }, (_, index) =>
    task(100 + index, "ana", "landed", {
      landedCommit: `land-${index}`,
      updatedAt: at(1 + index / 100),
    }),
  ),
  task(200, "bob", "discarded"),
];

/** A turn of a stint's thread: the person's card and the crewmate's answer. */
const turnRows = (
  threadId: string,
  index: number,
  minute: number,
): {
  readonly turn: ProjectionTurnById;
  readonly messages: ReadonlyArray<ProjectionThreadMessage>;
} => ({
  turn: {
    threadId,
    turnId: `${threadId}-turn-${index}`,
    pendingMessageId: `${threadId}-user-${index}`,
    sourceProposedPlanThreadId: null,
    sourceProposedPlanId: null,
    assistantMessageId: null,
    state: "completed",
    requestedAt: at(minute),
    startedAt: at(minute),
    completedAt: at(minute + 0.5),
    checkpointTurnCount: null,
    checkpointRef: null,
    checkpointStatus: null,
    checkpointFiles: [],
  } as unknown as ProjectionTurnById,
  messages: [
    {
      messageId: `${threadId}-user-${index}`,
      threadId,
      turnId: null,
      role: "user",
      text: `#1 Task 1 · turn ${index} of ${threadId}`,
      isStreaming: false,
      createdAt: at(minute),
      updatedAt: at(minute),
    },
    {
      messageId: `${threadId}-note-${index}`,
      threadId,
      turnId: `${threadId}-turn-${index}`,
      role: "assistant",
      text: `Done with turn ${index} of ${threadId}.`,
      isStreaming: false,
      createdAt: at(minute + 0.25),
      updatedAt: at(minute + 0.25),
    },
  ] as unknown as ReadonlyArray<ProjectionThreadMessage>,
});

/** The crew's tables and its stints' threads, written as V1 wrote them, into `filename`. */
export const seedV1Crew = (filename: string) =>
  Effect.gen(function* () {
    yield* runMigrations();
    const store = yield* makeCrewStore;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO crew_definition (
        crew, home_host, spec_json, brief_hash, brief_version, applied_at, applied_by,
        seq, flushed_seq, state
      ) VALUES ('main', 'appdev', ${definitionJson}, NULL, 2, ${at(0)}, 'user-1', 0, 0, 'applied')
    `;
    for (const spec of DEFINITION.members) {
      const writer = spec.kind === "writer";
      const ana = spec.handle === "ana";
      yield* sql`
        INSERT INTO crew_member (
          crew, handle, display_name, kind, tint, host, lane, read_only, login, model, effort,
          job_version, run_command, restart_after_merge, crew_port, config_json
        ) VALUES (
          'main', ${spec.handle}, ${spec.displayName}, ${spec.kind}, ${ana ? "violet" : null},
          ${writer ? (spec.host ?? null) : null}, ${writer ? spec.handle : null}, ${writer ? 0 : 1},
          ${spec.handle === "bob" ? "codex" : "claudeAgent"}, ${ana ? "claude-opus-4-5" : null},
          ${ana ? "high" : null}, ${ana ? 3 : 1}, NULL, 0, ${ana ? 4001 : null}, ${memberConfigJson}
        )
      `;
    }
    const lane = (handle: string, host: string) =>
      store.putLane({
        crew: "main",
        lane: handle,
        host,
        branch: `crew/${handle}`,
        dispatchCommit: "base",
        recordedTip: "tip",
        lastLanding: null,
        refSnapshot: null,
        lockfileHash: null,
        frozenSince: null,
      });
    yield* lane("ana", "appdev");
    yield* lane("bob", "appdev");
    yield* lane("cy", "stagedev");
    yield* sql`
      INSERT INTO crew_host (host, crew_ports_json)
      VALUES ('appdev', ${crewPortsJson})
    `;
    yield* sql`
      INSERT INTO crew_run (
        run, crew, started_by, budget_usd, spent_usd, options_json, state, reason,
        started_at, wall_ms, waiting_ms, finished_at
      ) VALUES ('run-1', 'main', 'user-1', NULL, 1.5, ${runOptionsJson}, 'running', NULL, ${at(5)}, 600000, 0, NULL)
    `;
    for (const row of TASKS) yield* store.putAssignment(row);
    yield* sql`
      INSERT INTO crew_attempt (
        assignment, attempt, thread_id, dispatch_commit, tip_ref, rotations, ending,
        ending_detail, cost_usd, started_at, ended_at
      ) VALUES ('task-1', 1, 'ana-s3', 'base', NULL, 1, NULL, NULL, 0.5, ${at(6)}, NULL)
    `;
    const claim = (host: string, member: string, state: "held" | "requested") =>
      sql`
        INSERT INTO crew_claim (
          host, crew, member, lane, state, requested_at, granted_by, granted_at,
          expires_at, released_at
        ) VALUES (
          ${host}, 'main', ${member}, ${member}, ${state}, ${at(10)},
          ${state === "held" ? "user-1" : null}, ${state === "held" ? at(11) : null}, NULL, NULL
        )
      `;
    yield* claim("appdev", "ana", "held");
    yield* claim("stagedev", "cy", "requested");
    yield* sql`
      INSERT INTO crew_memory (
        crew, member, id, kind, topic, text, paths_json, verified_at, from_assignment, updated_at
      ) VALUES (
        'main', 'ana', 'mem-1', 'lesson', 'build', 'Run the build before the check.',
        ${memoryPathsJson}, NULL, 'task-100', ${at(3)}
      )
    `;
    const turns = yield* ProjectionTurnRepository;
    const messages = yield* ProjectionThreadMessageRepository;
    let minute = 6;
    for (const { member, threads } of STINTS) {
      for (const [index, thread] of threads.entries()) {
        yield* sql`
          INSERT INTO crew_stint (
            crew, member, stint, thread_id, session_id, transcript_path, compactions,
            last_compact_summary, rotate_pending, reason, seeded_from_json, brief_version,
            job_version, started_at, retired_at
          ) VALUES (
            'main', ${member}, ${index + 1}, ${thread.id}, ${`session-${thread.id}`}, NULL, ${index},
            NULL, 0, ${thread.words}, ${seededFromJson}, 2, 1, ${at(minute)},
            ${index === threads.length - 1 ? null : at(minute + 1.5)}
          )
        `;
        for (const turn of [0, 1]) {
          const rows = turnRows(thread.id, turn, minute + turn * 0.6);
          yield* turns.upsertByTurnId(rows.turn);
          for (const message of rows.messages) yield* messages.upsert(message);
        }
        minute += 2;
      }
    }
  }).pipe(
    Effect.provide(
      Layer.mergeAll(ProjectionTurnRepositoryLive, ProjectionThreadMessageRepositoryLive).pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename })),
      ),
    ),
  );

/** Every V1 crew table, row by row. */
export const v1CrewTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const dump: Record<string, unknown> = {};
  for (const table of [
    "crew_definition",
    "crew_member",
    "crew_lane",
    "crew_run",
    "crew_assignment",
    "crew_attempt",
    "crew_stint",
    "crew_memory",
    "crew_claim",
    "crew_log",
    "crew_host",
    "crew_operation",
    "projection_turns",
    "projection_thread_messages",
  ]) {
    dump[table] = yield* sql.unsafe(`SELECT * FROM ${table} ORDER BY rowid`);
  }
  return dump;
});
