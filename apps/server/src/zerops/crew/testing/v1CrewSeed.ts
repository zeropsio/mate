/**
 * A V1 crew as its tables held it at a flip, written through V1's own repositories: a lead, three
 * writers and a reader, a run working on its own, open work in every state the flip handles —
 * working, checking, landing, queued, a question asked — sixty landed tasks, a held claim and a
 * request, memory, ports, and each crewmate's stints with their threads' turns.
 *
 * @module crew/testing/v1CrewSeed
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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
    yield* store.putDefinition({
      crew: "main",
      homeHost: "appdev",
      spec: DEFINITION,
      briefHash: null,
      briefVersion: 2,
      appliedAt: at(0),
      appliedBy: "user-1",
      seq: 0,
      flushedSeq: 0,
      state: "applied",
    });
    for (const spec of DEFINITION.members) {
      yield* store.putMember({
        crew: "main",
        handle: spec.handle,
        displayName: spec.displayName,
        kind: spec.kind,
        tint: spec.handle === "ana" ? "violet" : null,
        host: spec.kind === "writer" ? (spec.host ?? null) : null,
        lane: spec.kind === "writer" ? spec.handle : null,
        readOnly: spec.kind !== "writer",
        login: spec.handle === "bob" ? "codex" : "claudeAgent",
        model: spec.handle === "ana" ? "claude-opus-4-5" : null,
        effort: spec.handle === "ana" ? "high" : null,
        jobVersion: spec.handle === "ana" ? 3 : 1,
        runCommand: null,
        restartAfterMerge: false,
        crewPort: spec.handle === "ana" ? 4001 : null,
        config: {},
      });
    }
    const lane = (handle: string, host: string, state: "ready" | "lost") =>
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
        state,
      });
    yield* lane("ana", "appdev", "ready");
    yield* lane("bob", "appdev", "lost");
    yield* lane("cy", "stagedev", "ready");
    yield* store.putHost({ host: "appdev", crewPorts: [{ port: 4001, routed: true }] });
    yield* store.putRun({
      run: "run-1",
      crew: "main",
      startedBy: "user-1",
      budgetUsd: null,
      spentUsd: 1.5,
      options: { ...OPTIONS, landing: "check" },
      reasonDetail: null,
      state: "running",
      reason: null,
      startedAt: at(5),
      wallMs: 600_000,
      waitingMs: 0,
      finishedAt: null,
    });
    for (const row of TASKS) yield* store.putAssignment(row);
    yield* store.putAttempt({
      assignment: "task-1",
      attempt: 1,
      threadId: "ana-s3",
      dispatchCommit: "base",
      tipRef: null,
      rotations: 1,
      ending: null,
      endingDetail: null,
      costUsd: 0.5,
      startedAt: at(6),
      endedAt: null,
    });
    const claim = (host: string, member: string, state: "held" | "requested") =>
      store.updateClaim(host, () =>
        Option.some({
          host,
          crew: "main",
          member,
          lane: member,
          state,
          requestedAt: at(10),
          grantedBy: state === "held" ? "user-1" : null,
          grantedAt: state === "held" ? at(11) : null,
          expiresAt: null,
          releasedAt: null,
        }),
      );
    yield* claim("appdev", "ana", "held");
    yield* claim("stagedev", "cy", "requested");
    yield* store.putMemory({
      crew: "main",
      member: "ana",
      id: "mem-1",
      kind: "lesson",
      topic: "build",
      text: "Run the build before the check.",
      paths: ["package.json"],
      verifiedAt: null,
      fromAssignment: "task-100",
      updatedAt: at(3),
    });
    const turns = yield* ProjectionTurnRepository;
    const messages = yield* ProjectionThreadMessageRepository;
    let minute = 6;
    for (const { member, threads } of STINTS) {
      for (const [index, thread] of threads.entries()) {
        yield* store.putStint({
          crew: "main",
          member,
          stint: index + 1,
          threadId: thread.id,
          sessionId: `session-${thread.id}`,
          transcriptPath: null,
          compactions: index,
          lastCompactSummary: null,
          rotatePending: false,
          reason: thread.words,
          seededFrom: null,
          briefVersion: 2,
          jobVersion: 1,
          startedAt: at(minute),
          retiredAt: index === threads.length - 1 ? null : at(minute + 1.5),
        });
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
