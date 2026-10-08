import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import * as CrewStore from "./CrewStore.ts";

const storeLayer = CrewStore.layer.pipe(
  Layer.provideMerge(
    Layer.effectDiscard(runMigrations()).pipe(
      Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    ),
  ),
);

const lane = (overrides: Partial<CrewStore.CrewLaneRow> = {}): CrewStore.CrewLaneRow => ({
  crew: "game",
  lane: "backend",
  host: "appdev",
  branch: "crew/backend",
  dispatchCommit: "a".repeat(40),
  recordedTip: "a".repeat(40),
  lastLanding: null,
  refSnapshot: null,
  lockfileHash: null,
  frozenSince: null,
  state: "ready",
  ...overrides,
});

describe("CrewStore", () => {
  it.layer(storeLayer)("lanes", (it) => {
    it.effect("round-trips a lane, updates it in place and lists it by host", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        yield* store.putLane(lane());
        yield* store.putLane(
          lane({ crew: "shop", lane: "web", host: "webdev", branch: "crew/web" }),
        );
        yield* store.updateLane("game", "backend", (row) => ({
          ...row,
          recordedTip: "b".repeat(40),
          refSnapshot: { "refs/heads/crew/web": "c".repeat(40) },
        }));
        const read = yield* store.getLane("game", "backend");
        const onAppdev = yield* store.lanesOnHost("appdev");
        yield* store.deleteLane("shop", "web");
        assert.deepStrictEqual(
          {
            read: Option.getOrUndefined(read),
            onAppdev: onAppdev.map((row) => `${row.crew}/${row.lane}`),
            afterDelete: Option.isNone(yield* store.getLane("shop", "web")),
          },
          {
            read: lane({
              recordedTip: "b".repeat(40),
              refSnapshot: { "refs/heads/crew/web": "c".repeat(40) },
            }),
            onAppdev: ["game/backend"],
            afterDelete: true,
          },
        );
      }),
    );
  });

  it.layer(storeLayer)("definition", (it) => {
    it.effect("bumps seq once per change and never lowers what was flushed", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const definition: CrewStore.CrewDefinitionRow = {
          crew: "game",
          homeHost: "appdev",
          spec: { members: ["backend"] },
          briefHash: "hash-1",
          briefVersion: 1,
          appliedAt: "2026-09-27T10:00:00.000Z",
          appliedBy: "user-1",
          seq: 0,
          flushedSeq: 0,
          state: "applied",
        };
        yield* store.putDefinition(definition);
        const seqs = [yield* store.bumpSeq("game"), yield* store.bumpSeq("game")];
        yield* store.markFlushed("game", 2);
        yield* store.markFlushed("game", 1);
        assert.deepStrictEqual(
          { seqs, read: Option.getOrUndefined(yield* store.getDefinition("game")) },
          { seqs: [1, 2], read: { ...definition, seq: 2, flushedSeq: 2 } },
        );
      }),
    );
  });

  it.layer(storeLayer)("landed outcomes", (it) => {
    it.effect(
      "lists the landings made on a host oldest first, and a crewmate's tasks by number",
      () =>
        Effect.gen(function* () {
          const store = yield* CrewStore.CrewStore;
          const member = (handle: string, host: string): CrewStore.CrewMemberRow => ({
            crew: "game",
            handle,
            displayName: handle,
            kind: "writer",
            tint: null,
            host,
            lane: handle,
            readOnly: false,
            login: null,
            model: null,
            effort: null,
            jobVersion: 1,
            runCommand: null,
            restartAfterMerge: false,
            crewPort: null,
            config: {},
          });
          const task = (
            assignment: string,
            number: number,
            owner: string,
            landedCommit: string | null,
          ): CrewStore.CrewAssignmentRow => ({
            assignment,
            run: null,
            crew: "game",
            member: owner,
            number,
            title: `Task ${number}`,
            source: "you",
            createdBy: "user-1",
            card: null,
            pending: null,
            dependsOn: [],
            fresh: false,
            state: landedCommit === null ? "queued" : "landed",
            attempt: 1,
            reworks: 0,
            remerges: 0,
            mergedHead: null,
            check: null,
            review: null,
            report: null,
            waiting: null,
            landedCommit,
            createdAt: "2026-09-27T10:00:00.000Z",
            updatedAt: `2026-09-27T10:0${number}:00.000Z`,
          });
          yield* store.putMember(member("backend", "appdev"));
          yield* store.putMember(member("web", "webdev"));
          yield* store.putAssignment(task("a-2", 2, "backend", "d".repeat(40)));
          yield* store.putAssignment(task("a-1", 1, "backend", "c".repeat(40)));
          yield* store.putAssignment(task("a-3", 3, "backend", null));
          yield* store.putAssignment(task("a-4", 4, "web", "e".repeat(40)));
          // a-4 landed on appdev; its crewmate serves webdev now. Its landing stays appdev's.
          yield* store.putOperation({
            id: "landing-a-4",
            crew: "game",
            handle: "web",
            taskId: "a-4",
            kind: "landing",
            stage: "landing",
            confirmedStage: "landing",
            status: "succeeded",
            startedBy: "user-1",
            resumeState: "ready",
            targets: {
              host: "appdev",
              path: null,
              ref: null,
              threadId: null,
              commandId: null,
              attempt: 1,
            },
            result: null,
            detail: null,
            startedAt: "2026-09-27T10:04:00.000Z",
            updatedAt: "2026-09-27T10:04:00.000Z",
          });
          const read = yield* store.getAssignment("a-1");
          assert.deepStrictEqual(
            {
              landings: yield* store.landingsOnHost("appdev"),
              webLandings: yield* store.landingsOnHost("webdev"),
              members: (yield* store.members("game")).map((row) => row.handle),
              backendTasks: yield* store.assignmentsOf("game", "backend"),
              read: Option.getOrUndefined(read),
            },
            {
              landings: [
                {
                  crew: "game",
                  member: "backend",
                  assignment: "a-1",
                  title: "Task 1",
                  landedCommit: "c".repeat(40),
                },
                {
                  crew: "game",
                  member: "backend",
                  assignment: "a-2",
                  title: "Task 2",
                  landedCommit: "d".repeat(40),
                },
                {
                  crew: "game",
                  member: "web",
                  assignment: "a-4",
                  title: "Task 4",
                  landedCommit: "e".repeat(40),
                },
              ],
              webLandings: [],
              members: ["backend", "web"],
              backendTasks: ["a-1", "a-2", "a-3"],
              read: task("a-1", 1, "backend", "c".repeat(40)),
            },
          );
        }),
    );
  });

  it.layer(storeLayer)("hosts", (it) => {
    it.effect("round-trips a dev service's crew ports", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const host: CrewStore.CrewHostRow = {
          host: "appdev",
          crewPorts: [
            { port: 3001, routed: true },
            { port: 3002, routed: false },
          ],
        };
        yield* store.putHost(host);
        assert.deepStrictEqual(
          {
            known: Option.getOrUndefined(yield* store.getHost("appdev")),
            unknown: Option.isNone(yield* store.getHost("webdev")),
          },
          { known: host, unknown: true },
        );
      }),
    );
  });

  it.layer(storeLayer)("changes", (it) => {
    it.effect("publishes which table changed for which crew", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const seen = yield* store.changes.pipe(Stream.take(4), Stream.runCollect, Effect.forkChild);
        yield* Effect.yieldNow;
        yield* store.putLane(lane());
        yield* store.putHost({ host: "appdev", crewPorts: [] });
        yield* store.updateClaim("appdev", () =>
          Option.some({
            host: "appdev",
            crew: "game",
            member: "backend",
            lane: "backend",
            state: "requested",
            requestedAt: "2026-09-27T10:00:00.000Z",
            grantedBy: null,
            grantedAt: null,
            expiresAt: null,
            releasedAt: null,
          }),
        );
        yield* store.clearMemory("game", "backend");
        assert.deepStrictEqual(Array.from(yield* Fiber.join(seen)), [
          { crew: "game", table: "lane" },
          { crew: null, table: "host" },
          { crew: "game", table: "claim" },
          { crew: "game", table: "memory" },
        ]);
      }),
    );
  });

  it.layer(storeLayer)("claims", (it) => {
    it.effect("changes a host's claim in one transaction, and deletes it on none", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const requested: CrewStore.CrewClaimRow = {
          host: "appdev",
          crew: "game",
          member: "backend",
          lane: "backend",
          state: "requested",
          requestedAt: "2026-09-27T10:00:00.000Z",
          grantedBy: null,
          grantedAt: null,
          expiresAt: null,
          releasedAt: null,
        };
        const created = yield* store.updateClaim("appdev", () => Option.some(requested));
        const granted = yield* store.updateClaim("appdev", (claim) =>
          Option.map(claim, (row) => ({
            ...row,
            state: "starting" as const,
            grantedBy: "user-1",
            grantedAt: "2026-09-27T10:01:00.000Z",
            expiresAt: "2026-09-27T11:01:00.000Z",
          })),
        );
        const afterGrant = {
          read: Option.getOrUndefined(yield* store.getClaim("appdev")),
          ofCrew: (yield* store.claims("game")).map((row) => row.state),
        };
        const removed = yield* store.updateClaim("appdev", () => Option.none());
        const untouched = yield* store.updateClaim("webdev", (claim) => claim);
        assert.deepStrictEqual(
          {
            created: Option.getOrUndefined(created),
            granted: Option.getOrUndefined(granted)?.state,
            afterGrant,
            removed: Option.isNone(removed),
            gone: Option.isNone(yield* store.getClaim("appdev")),
            untouched: Option.isNone(untouched),
          },
          {
            created: requested,
            granted: "starting",
            afterGrant: {
              read: {
                ...requested,
                state: "starting",
                grantedBy: "user-1",
                grantedAt: "2026-09-27T10:01:00.000Z",
                expiresAt: "2026-09-27T11:01:00.000Z",
              },
              ofCrew: ["starting"],
            },
            removed: true,
            gone: true,
            untouched: true,
          },
        );
      }),
    );
  });

  it.layer(storeLayer)("memory", (it) => {
    it.effect("keeps a crewmate's memory entries, removes one, and clears them all", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const entry = (
          member: string,
          id: string,
          kind: CrewStore.CrewMemoryKind,
          updatedAt: string,
        ): CrewStore.CrewMemoryRow => ({
          crew: "game",
          member,
          id,
          kind,
          topic: kind === "note" ? "api-shape" : null,
          text: `${kind} ${id}`,
          paths: kind === "fact" ? ["src/api.ts", "src/score.ts"] : [],
          verifiedAt: kind === "fact" ? "2026-09-27T10:00:00.000Z" : null,
          fromAssignment: kind === "lesson" ? "a-1" : null,
          updatedAt,
        });
        const fact = entry("backend", "m-2", "fact", "2026-09-27T10:02:00.000Z");
        const lesson = entry("backend", "m-1", "lesson", "2026-09-27T10:01:00.000Z");
        const note = entry("backend", "m-3", "note", "2026-09-27T10:03:00.000Z");
        yield* store.putMemory(fact);
        yield* store.putMemory(lesson);
        yield* store.putMemory(note);
        yield* store.putMemory(entry("frontend", "m-9", "decision", "2026-09-27T10:00:00.000Z"));
        yield* store.putMemory({ ...fact, text: "fact m-2, verified again" });
        const all = yield* store.memory("game", "backend");
        yield* store.deleteMemory("game", "backend", "m-1");
        const afterDelete = (yield* store.memory("game", "backend")).map((row) => row.id);
        yield* store.clearMemory("game", "backend");
        assert.deepStrictEqual(
          {
            all,
            afterDelete,
            cleared: (yield* store.memory("game", "backend")).length,
            frontend: (yield* store.memory("game", "frontend")).map((row) => row.id),
          },
          {
            all: [lesson, { ...fact, text: "fact m-2, verified again" }, note],
            afterDelete: ["m-2", "m-3"],
            cleared: 0,
            frontend: ["m-9"],
          },
        );
      }),
    );
  });

  it.layer(storeLayer)("engine rows", (it) => {
    const stint = (fields: Partial<CrewStore.CrewStintRow> = {}): CrewStore.CrewStintRow => ({
      crew: "game",
      member: "backend",
      stint: 1,
      threadId: "thread-1",
      sessionId: null,
      transcriptPath: null,
      compactions: 0,
      lastCompactSummary: null,
      rotatePending: false,
      reason: null,
      seededFrom: null,
      briefVersion: 1,
      jobVersion: 1,
      startedAt: "2026-09-27T10:00:00.000Z",
      retiredAt: null,
      ...fields,
    });

    it.effect("round-trips stints, finds one by its thread and changes one in place", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        yield* store.putStint(stint());
        yield* store.putStint(
          stint({
            stint: 2,
            threadId: "thread-2",
            seededFrom: { text: "seed" },
            reason: "start-fresh",
          }),
        );
        yield* store.updateStint("game", "backend", 1, (row) => ({
          ...row,
          retiredAt: "2026-09-27T11:00:00.000Z",
          rotatePending: true,
        }));
        assert.deepStrictEqual(
          {
            all: (yield* store.stints("game")).map((row) => [
              row.stint,
              row.retiredAt,
              row.rotatePending,
            ]),
            byThread: Option.getOrUndefined(yield* store.stintByThread("thread-2")),
            none: Option.isNone(yield* store.stintByThread("thread-9")),
          },
          {
            all: [
              [1, "2026-09-27T11:00:00.000Z", true],
              [2, null, false],
            ],
            byThread: stint({
              stint: 2,
              threadId: "thread-2",
              seededFrom: { text: "seed" },
              reason: "start-fresh",
            }),
            none: true,
          },
        );
      }),
    );

    it.effect(
      "keeps a task's attempts, numbers tasks per crew, lists them and drops a crewmate",
      () =>
        Effect.gen(function* () {
          const store = yield* CrewStore.CrewStore;
          const attempt: CrewStore.CrewAttemptRow = {
            assignment: "a-1",
            attempt: 1,
            threadId: "thread-1",
            dispatchCommit: "a".repeat(40),
            tipRef: null,
            rotations: 0,
            ending: null,
            endingDetail: null,
            costUsd: 0,
            startedAt: "2026-09-27T10:00:00.000Z",
            endedAt: null,
          };
          yield* store.putAttempt(attempt);
          yield* store.putAttempt({ ...attempt, costUsd: 0.25, ending: "infrastructure" });
          const firstNumber = yield* store.nextTaskNumber("game");
          yield* store.putAssignment({
            assignment: "a-1",
            run: null,
            crew: "game",
            member: "backend",
            number: firstNumber,
            title: "First",
            source: "message",
            createdBy: "user-1",
            card: null,
            pending: null,
            dependsOn: [],
            fresh: false,
            state: "working",
            attempt: 1,
            reworks: 0,
            remerges: 0,
            mergedHead: null,
            check: null,
            review: null,
            report: null,
            waiting: null,
            landedCommit: null,
            createdAt: "2026-09-27T10:00:00.000Z",
            updatedAt: "2026-09-27T10:00:00.000Z",
          });
          yield* store.appendLog({
            crew: "game",
            run: null,
            at: "2026-09-27T10:00:00.000Z",
            kind: "landed",
            payload: { task: "a-1" },
          });
          yield* store.putMember({
            crew: "game",
            handle: "gone",
            displayName: "Gone",
            kind: "reader",
            tint: null,
            host: null,
            lane: null,
            readOnly: true,
            login: null,
            model: null,
            effort: null,
            jobVersion: 1,
            runCommand: null,
            restartAfterMerge: false,
            crewPort: null,
            config: {},
          });
          yield* store.deleteMember("game", "gone");
          assert.deepStrictEqual(
            {
              attempts: (yield* store.attemptsOf("a-1")).map((row) => [
                row.attempt,
                row.costUsd,
                row.ending,
              ]),
              numbers: [
                firstNumber,
                yield* store.nextTaskNumber("game"),
                yield* store.nextTaskNumber("shop"),
              ],
              tasks: (yield* store.assignments("game")).map((row) => row.assignment),
              members: (yield* store.members("game")).map((row) => row.handle),
            },
            {
              attempts: [[1, 0.25, "infrastructure"]],
              numbers: [1, 2, 1],
              tasks: ["a-1"],
              members: [],
            },
          );
        }),
    );
  });

  it.layer(storeLayer)("runs", (it) => {
    const run = (overrides: Partial<CrewStore.CrewRunRow> = {}): CrewStore.CrewRunRow => ({
      run: "run-1",
      crew: "game",
      startedBy: "user-karel",
      budgetUsd: 20,
      spentUsd: 0,
      options: { budgetUsd: 20, timeLimitHours: "unlimited" },
      reasonDetail: null,
      state: "running",
      reason: null,
      startedAt: "2026-09-27T10:00:00.000Z",
      wallMs: 0,
      waitingMs: 0,
      finishedAt: null,
      ...overrides,
    });

    it.effect("a run's meters move without touching its state; a stale move does not land", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const arcade = (overrides: Partial<CrewStore.CrewRunRow> = {}) =>
          run({ run: "arcade-1", crew: "arcade", ...overrides });
        yield* store.putRun(arcade({ spentUsd: 1 }));
        // The run finished while a tick or a turn's end held the running row it read.
        const finished = yield* store.putRun(arcade({ state: "finished" }), "running");
        yield* store.updateRunMeters(arcade(), { wallMs: 5_000, addSpentUsd: 0.5 });
        const paused = yield* store.putRun(
          arcade({ state: "paused", reason: "budget" }),
          "running",
        );
        assert.deepStrictEqual(
          [finished, paused, Option.getOrUndefined(yield* store.latestRun("arcade"))],
          [true, false, arcade({ state: "finished", spentUsd: 1.5, wallMs: 5_000 })],
        );
      }),
    );

    it.effect("keeps a crew's runs, changes one in place and reads the latest", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const seen = yield* store.changes.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
        yield* Effect.yieldNow;
        const none = Option.isNone(yield* store.latestRun("game"));
        yield* store.putRun(run({ state: "stopped", reason: "person" }));
        yield* store.putRun(
          run({ run: "run-2", budgetUsd: null, startedAt: "2026-09-27T11:00:00.000Z" }),
        );
        yield* store.putRun(
          run({
            run: "run-2",
            budgetUsd: null,
            startedAt: "2026-09-27T11:00:00.000Z",
            state: "paused",
            reason: "refused",
            reasonDetail: "not the login's signer",
            spentUsd: 1.5,
            wallMs: 60_000,
          }),
        );
        assert.deepStrictEqual(
          {
            none,
            latest: Option.getOrUndefined(yield* store.latestRun("game")),
            other: Option.isNone(yield* store.latestRun("shop")),
            change: Array.from(yield* Fiber.join(seen)),
          },
          {
            none: true,
            latest: run({
              run: "run-2",
              budgetUsd: null,
              startedAt: "2026-09-27T11:00:00.000Z",
              state: "paused",
              reason: "refused",
              reasonDetail: "not the login's signer",
              spentUsd: 1.5,
              wallMs: 60_000,
            }),
            other: true,
            change: [{ crew: "game", table: "run" }],
          },
        );
      }),
    );
  });

  it.layer(storeLayer)("log", (it) => {
    it.effect("reads back the entries of the kinds asked, oldest first", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const entry = (kind: string, key: string): CrewStore.CrewLogEntry => ({
          crew: "game",
          run: "run-1",
          at: "2026-09-27T10:00:00.000Z",
          kind,
          payload: { key },
        });
        yield* store.appendLog(entry("nudged", "a-1:1"));
        yield* store.appendLog(entry("landed", "a-1"));
        yield* store.appendLog(entry("lead-woken", "review:a-1:1"));
        yield* store.appendLog({ ...entry("nudged", "a-9:1"), crew: "shop" });
        assert.deepStrictEqual(
          (yield* store.logOf("game", ["nudged", "lead-woken"])).map((row) => [
            row.kind,
            row.run,
            row.payload,
          ]),
          [
            ["nudged", "run-1", { key: "a-1:1" }],
            ["lead-woken", "run-1", { key: "review:a-1:1" }],
          ],
        );
      }),
    );
  });
});

it.layer(storeLayer)("durable operations", (it) => {
  it.effect.each(
    Array.from(["dispatch", "checkpoint", "check", "landing"] as const, (kind) => ({
      title: `keeps ${kind}'s identity, confirmed stage and outcome across reads`,
      kind,
    })),
  )("$title", ({ kind }) =>
    Effect.gen(function* () {
      const store = yield* CrewStore.CrewStore;
      const operation = {
        id: `${kind}-1`,
        crew: "game",
        handle: "backend",
        taskId: "task-1",
        kind,
        stage: "prepared",
        confirmedStage: "prepared",
        status: "running" as const,
        startedBy: "person-1",
        resumeState: "working" as const,
        targets: {
          host: "appdev",
          path: "/app/.crew/backend",
          ref: "crew/backend",
          threadId: null,
          commandId: null,
          attempt: 1,
        },
        result: null,
        detail: null,
        startedAt: "2026-10-03T10:00:00.000Z",
        updatedAt: "2026-10-03T10:00:00.000Z",
      };
      yield* store.putOperation(operation);
      assert.deepStrictEqual(Option.getOrThrow(yield* store.getOperation(operation.id)), operation);
      const ended = {
        ...operation,
        status: "failed" as const,
        stage: "recording-outcome",
        result: { reason: "lost connection" },
        detail: "Outcome unknown",
      };
      yield* store.putOperation(ended);
      assert.deepStrictEqual(yield* store.operations("game"), [ended]);
      yield* store.putOperation({ ...ended, status: "succeeded" });
      assert.deepStrictEqual(yield* store.operations("game"), []);
    }),
  );
});
