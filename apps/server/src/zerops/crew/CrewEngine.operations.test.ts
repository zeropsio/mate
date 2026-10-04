// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import { ServerCommandReadiness } from "../../spi/serverCommandReadiness.ts";
import { CrewStore } from "./CrewStore.ts";
import { CrewEngine } from "./CrewEngine.ts";
import { CREW_ID } from "./CrewHome.ts";
import {
  applied,
  command,
  firstTurn,
  latest,
  reportDone,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import {
  eventually,
  spiEvent,
  withCrewEngine,
  withCrewEngines,
  writeCrewHome,
} from "./testing/crewEngineFixture.ts";
import { write, git } from "./testing/crewGitFixture.ts";

describe("owned crew operations", () => {
  it.live("a refused Try again leaves the interrupted operation waiting for Continue", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* world.publish(
          spiEvent("turn.completed", thread, { state: "failed", terminalReason: "api_error" }),
        );
        const store = yield* CrewStore;
        const operation = (yield* store.operations(CREW_ID)).find(
          (row) => row.kind === "dispatch",
        )!;
        assert.strictEqual(operation.status, "interrupted");
        const refusal = yield* Effect.flip(
          command({ _tag: "taskRetry", taskId: operation.taskId! }),
        );
        assert.strictEqual(refusal.reason, "wrong-state");
        const after = yield* store.getOperation(operation.id);
        assert.strictEqual(after._tag === "Some" ? after.value.status : null, "interrupted");
      }),
    ),
  );

  it.live("a failed boot inspection records one visible ending and refuses new effects", () =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const database = new NodeSqlite.DatabaseSync(
            NodePath.join(world.workspace, "crew.sqlite"),
          );
          try {
            database.exec("DROP TABLE crew_claim");
          } finally {
            database.close();
          }
        }),
      (world) =>
        Effect.gen(function* () {
          const before = yield* latest;
          const refused = yield* Effect.flip(
            command({ _tag: "message", handle: "backend", text: "Work", attachments: [] }),
          );
          assert.strictEqual(refused.reason, "io");
          yield* (yield* CrewEngine).readFiles;
          const ending = yield* snapshotWhere((frame) => frame.seq > before.seq);
          assert.isNotNull(ending.lastError, "the inspection failure must end visibly");
          assert.strictEqual(
            (yield* Ref.get(world.dispatched)).filter((row) => row.type === "thread.turn.start")
              .length,
            0,
          );
        }),
    ]),
  );

  it.live(
    "a person's fix acknowledges a confirmed failed check while its final read is pending",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(NodePath.join(world.root, ".crew/backend"), "work.txt", "work\n"),
          );
          yield* reportDone(thread);
          let reads = 0;
          const hold = yield* world.holdSsh(
            (script) => script.includes("dirty=no") && ++reads === 2,
          );
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          yield* hold.reached;
          const store = yield* CrewStore;
          const operation = (yield* store.operations(CREW_ID)).find((row) => row.kind === "check")!;
          assert.strictEqual(operation.status, "running");
          assert.strictEqual(operation.confirmedStage, "checking");
          assert.isNotNull(operation.detail);
          yield* command({ _tag: "askFix", taskId: operation.taskId! });
          const acknowledged = yield* store.getOperation(operation.id);
          assert.strictEqual(
            acknowledged._tag === "Some" ? acknowledged.value.status : null,
            "continued",
          );
          yield* hold.release;
          yield* snapshotWhere(
            (frame) => !frame.operations?.some((row) => row.id === operation.id),
          );
        }),
      ),
  );

  it.live("records the dispatch identity and attempt before starting the turn", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const store = yield* CrewStore;
        yield* Ref.set(
          world.beforeDispatch,
          Effect.gen(function* () {
            const operations = yield* store.operations(CREW_ID);
            const dispatch = operations.find((row) => row.kind === "dispatch");
            assert.isDefined(dispatch, "dispatch must exist before the command is sent");
            assert.strictEqual(dispatch!.stage, "dispatching");
            assert.strictEqual(dispatch!.confirmedStage, "admitted");
            assert.isNotNull(dispatch!.targets.commandId);
            const [task] = yield* store.assignments(CREW_ID);
            assert.strictEqual(task?.attempt, 1);
            assert.strictEqual((yield* store.attemptsOf(task!.assignment)).length, 1);
          }).pipe(Effect.orDie),
        );
        yield* command({ _tag: "message", handle: "backend", text: "Work", attachments: [] });
      }),
    ),
  );

  for (const kind of ["checkpoint", "check", "landing"] as const) {
    it.live(`records ${kind}'s target and stage before its side effect`, () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ready\n"),
          );
          if (kind !== "checkpoint") yield* reportDone(thread);
          if (kind === "landing") {
            yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
            yield* snapshotWhere((frame) => frame.board.tasks[0]?.state === "ready");
          }
          const hold = yield* world.holdSsh((script) =>
            kind === "checkpoint"
              ? script.includes("wip(")
              : kind === "check"
                ? script.includes("test -f ok.txt")
                : script.includes("commit-tree"),
          );
          const fiber = yield* (
            kind === "landing"
              ? command({
                  _tag: "land",
                  taskId: (yield* (yield* CrewStore).assignments(CREW_ID))[0]!.assignment,
                })
              : world.publish(spiEvent("turn.completed", thread, { state: "completed" }))
          ).pipe(Effect.forkChild);
          yield* hold.reached;
          const operations = yield* (yield* CrewStore).operations(CREW_ID);
          const operation = operations.find((row) => row.kind === kind);
          assert.isDefined(operation, `${kind} must be recorded before SSH executes`);
          assert.strictEqual(operation!.status, "running");
          assert.isNotNull(operation!.targets.path);
          assert.strictEqual(operation!.targets.attempt, 1);
          yield* hold.release;
          yield* Fiber.join(fiber);
        }),
      ),
    );
  }
});

for (const kind of ["dispatch", "checkpoint", "check", "landing"] as const) {
  it.live(`restart carries ${kind} on from its confirmed stage, its dirty work kept`, () => {
    let head = "";
    return withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* firstTurn(world, () =>
            write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "dirty work\n"),
          );
          head = git(NodePath.join(world.root, ".crew/backend"), ["rev-parse", "HEAD"]);
          const store = yield* CrewStore;
          const [dispatch] = yield* store.operations(CREW_ID);
          if (kind !== "dispatch") yield* store.putOperation({ ...dispatch!, status: "succeeded" });
          const [task] = yield* store.assignments(CREW_ID);
          const state = kind === "check" ? "checking" : kind === "landing" ? "landing" : "working";
          yield* store.putAssignment({ ...task!, state });
          yield* store.putOperation({
            ...dispatch!,
            id: `crashed-${kind}`,
            kind,
            stage:
              kind === "check"
                ? "checking"
                : kind === "landing"
                  ? "landing"
                  : kind === "checkpoint"
                    ? "committing"
                    : "dispatching",
            confirmedStage: "prepared",
            resumeState: state,
            status: "running",
          });
          if (kind === "dispatch") yield* store.putOperation({ ...dispatch!, status: "succeeded" });
        }),
      (world) =>
        Effect.gen(function* () {
          yield* (yield* ServerCommandReadiness).complete;
          const settled = yield* snapshotWhere(
            (frame) =>
              !frame.operations?.some((row) => row.id === `crashed-${kind}`) &&
              (kind === "dispatch" || kind === "checkpoint"
                ? frame.board.tasks[0]?.attempts === 2 && frame.board.tasks[0]?.state === "working"
                : frame.board.tasks[0]?.state === (kind === "check" ? "ready" : "landed")),
          );
          const operation = yield* (yield* CrewStore).getOperation(`crashed-${kind}`);
          assert.strictEqual(
            operation._tag === "Some" ? operation.value.status : null,
            "continued",
          );
          assert.isFalse(settled.attention.some((need) => need.kind === "interrupted"));
          const copy = NodePath.join(world.root, ".crew/backend");
          assert.strictEqual(
            NodeFS.readFileSync(
              NodePath.join(kind === "landing" ? world.root : copy, "ok.txt"),
              "utf8",
            ),
            "dirty work\n",
          );
          if (kind === "dispatch") {
            assert.strictEqual(git(copy, ["rev-parse", "HEAD"]), head);
            yield* eventually(
              Effect.map(
                Ref.get(world.dispatched),
                (rows) => rows.filter((entry) => entry.type === "thread.turn.start").length === 2,
              ),
            );
          }
        }),
    ]);
  });
}

it.live("a killed check ends after one command and waits for a person", () =>
  withCrewEngine((world) =>
    Effect.gen(function* () {
      writeCrewHome(world.workspace);
      const home = NodePath.join(world.workspace, ".mate/crew/main/crew.yaml");
      const config = NodeFS.readFileSync(home, "utf8").replace(
        "test -f ok.txt",
        () => "printf x >> check-count.txt; kill -TERM $$",
      );
      writeCrewHome(world.workspace, { "crew.yaml": config });
      yield* command({ _tag: "apply" });
      yield* snapshotWhere((frame) => frame.crewmates[0]?.lane?.state === "ready");
      const thread = yield* firstTurn(world, () =>
        write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ok\n"),
      );
      yield* reportDone(thread);
      yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
      const stopped = yield* snapshotWhere((frame) => frame.board.tasks[0]?.state === "parked");
      assert.strictEqual(
        NodeFS.readFileSync(NodePath.join(world.root, ".crew/backend/check-count.txt"), "utf8"),
        "x",
      );
      assert.strictEqual(stopped.board.tasks[0]!.reason, "the check was killed");
    }),
  ),
);

for (const [ending, setup] of [
  ["failed", "test ! -f fail-setup.txt"],
  ["killed", "if [ -f fail-setup.txt ]; then kill -TERM $$; fi"],
] as const) {
  it.live(`a ${ending} setup ends its check operation before the check command starts`, () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        writeCrewHome(world.workspace);
        const home = NodePath.join(world.workspace, ".mate/crew/main/crew.yaml");
        const config = NodeFS.readFileSync(home, "utf8").replace(
          "    check: test -f ok.txt",
          () => `    setup: ${setup}\n    check: printf x >> check-count.txt; test -f ok.txt`,
        );
        writeCrewHome(world.workspace, { "crew.yaml": config });
        yield* command({ _tag: "apply" });
        yield* snapshotWhere((frame) => frame.crewmates[0]?.lane?.state === "ready");
        const lane = NodePath.join(world.root, ".crew/backend");
        const thread = yield* firstTurn(world, () => {
          write(lane, "ok.txt", "ok\n");
          write(lane, "fail-setup.txt", "stop\n");
        });
        write(world.root, "package-lock.json", "{}\n");
        git(world.root, ["add", "package-lock.json"]);
        git(world.root, ["commit", "-m", "new lockfile"]);
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const stopped = yield* snapshotWhere((frame) =>
          ["ready", "parked"].includes(frame.board.tasks[0]?.state ?? ""),
        );
        assert.strictEqual(stopped.board.tasks[0]!.state, "parked");
        const receipt = yield* snapshotWhere(
          (frame) =>
            frame.operations?.some((row) => row.kind === "check" && row.status === "failed") ===
            true,
        );
        const operation = receipt.operations!.find((row) => row.kind === "check")!;
        assert.strictEqual(operation.status, "failed");
        assert.strictEqual(operation.confirmedStage, "setting-up");
        assert.strictEqual(NodeFS.existsSync(NodePath.join(lane, "check-count.txt")), false);
        NodeFS.unlinkSync(NodePath.join(lane, "fail-setup.txt"));
        yield* command({ _tag: "operationContinue", handle: "backend", operationId: operation.id });
        yield* snapshotWhere((frame) => frame.board.tasks[0]?.state === "ready");
        assert.strictEqual(
          NodeFS.readFileSync(NodePath.join(lane, "check-count.txt"), "utf8"),
          "x",
        );
      }),
    ),
  );
}

for (const taskState of ["landing", "landed"] as const) {
  it.live(
    `restart records an already landed outcome for a ${taskState} task without landing again`,
    () => {
      let operationId = "";
      let landedHead = "";
      return withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            const thread = yield* firstTurn(world, () =>
              write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ok\n"),
            );
            yield* reportDone(thread);
            yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
            const ready = yield* snapshotWhere((frame) => frame.board.tasks[0]?.state === "ready");
            const hold = yield* world.holdSsh((script) => script.includes("commit-tree"));
            const landing = yield* command({ _tag: "land", taskId: ready.board.tasks[0]!.id }).pipe(
              Effect.forkChild,
            );
            yield* hold.reached;
            const store = yield* CrewStore;
            const operation = (yield* store.operations(CREW_ID)).find(
              (row) => row.kind === "landing",
            )!;
            operationId = operation.id;
            yield* hold.release;
            yield* Fiber.join(landing);
            landedHead = git(world.root, ["rev-parse", "HEAD"]);
            const [task] = yield* store.assignments(CREW_ID);
            yield* store.putAssignment({
              ...task!,
              state: taskState,
              landedCommit: taskState === "landed" ? landedHead : null,
            });
            yield* store.putOperation({ ...operation, status: "running", stage: "landing" });
          }),
        (world) =>
          Effect.gen(function* () {
            yield* (yield* ServerCommandReadiness).complete;
            const recorded = yield* snapshotWhere(
              (frame) =>
                frame.board.tasks[0]?.state === "landed" &&
                !frame.attention.some((need) => need.operation?.id === operationId),
            );
            const operation = yield* (yield* CrewStore).getOperation(operationId);
            assert.strictEqual(
              operation._tag === "Some" ? operation.value.status : null,
              "continued",
            );
            assert.strictEqual(recorded.board.tasks[0]!.landedCommit, landedHead);
            assert.strictEqual(git(world.root, ["rev-parse", "HEAD"]), landedHead);
          }),
      ]);
    },
  );
}

it.live(
  "Drop it cancels a task its restart could not carry on, keeping its dirty files and HEAD",
  () => {
    let head = "";
    return withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* firstTurn(world, () =>
            write(NodePath.join(world.root, ".crew/backend"), "dirty.txt", "keep me\n"),
          );
          head = git(NodePath.join(world.root, ".crew/backend"), ["rev-parse", "HEAD"]);
        }),
      (world) =>
        Effect.gen(function* () {
          yield* Ref.set(world.refusal, "not the login's signer");
          yield* (yield* ServerCommandReadiness).complete;
          const stopped = yield* snapshotWhere((frame) =>
            frame.attention.some(
              (need) =>
                need.kind === "interrupted" &&
                need.text?.includes("not the login's signer") === true,
            ),
          );
          const operation = stopped.attention.find(
            (need) => need.kind === "interrupted",
          )!.operation!;
          assert.strictEqual(
            (yield* Ref.get(world.dispatched)).filter((entry) => entry.type === "thread.turn.start")
              .length,
            1,
          );
          yield* command({
            _tag: "operationDiscard",
            handle: "backend",
            operationId: operation.id,
          });
          const discarded = yield* snapshotWhere(
            (frame) => frame.board.tasks[0]?.state === "discarded",
          );
          assert.strictEqual(discarded.crewmates[0]!.lane?.dirty, true);
          assert.strictEqual(
            git(NodePath.join(world.root, ".crew/backend"), ["rev-parse", "HEAD"]),
            head,
          );
          assert.strictEqual(
            NodeFS.readFileSync(NodePath.join(world.root, ".crew/backend/dirty.txt"), "utf8"),
            "keep me\n",
          );
        }),
    ]);
  },
);

it.live("a missing copy stays missing at boot and is rebuilt only by its selected press", () => {
  let tip = "";
  return withCrewEngines([
    (world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "kept\n"),
        );
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        tip = git(world.root, ["rev-parse", "crew/backend"]);
        NodeFS.rmSync(NodePath.join(world.root, ".crew/backend"), { recursive: true });
      }),
    (world) =>
      Effect.gen(function* () {
        yield* (yield* ServerCommandReadiness).complete;
        const missing = yield* snapshotWhere(
          (frame) => frame.crewmates[0]?.lane?.state === "missing",
        );
        assert.isFalse(NodeFS.existsSync(NodePath.join(world.root, ".crew/backend")));
        assert.strictEqual(
          (yield* Ref.get(world.dispatched)).filter((entry) => entry.type === "thread.turn.start")
            .length,
          1,
        );
        yield* command({ _tag: "rebuildCopy", handle: missing.crewmates[0]!.handle });
        yield* snapshotWhere((frame) => frame.crewmates[0]?.lane?.state === "ready");
        assert.strictEqual(
          git(NodePath.join(world.root, ".crew/backend"), ["rev-parse", "HEAD"]),
          tip,
        );
        assert.strictEqual(
          NodeFS.readFileSync(NodePath.join(world.root, ".crew/backend/ok.txt"), "utf8"),
          "kept\n",
        );
      }),
  ]);
});

it.live("Continue after a rebuild interrupted during setup leaves its existing copy in place", () =>
  withCrewEngines([
    (world) =>
      Effect.gen(function* () {
        yield* applied(world);
        write(NodePath.join(world.root, ".crew/backend"), "preserved.txt", "keep this copy\n");
        yield* (yield* CrewStore).putOperation({
          id: "rebuild-crash",
          crew: CREW_ID,
          handle: "backend",
          taskId: null,
          kind: "rebuild",
          stage: "setting-up",
          confirmedStage: "copy-rebuilt",
          status: "running",
          startedBy: "person",
          resumeState: "working",
          targets: {
            host: "appdev",
            path: NodePath.join(world.root, ".crew/backend"),
            ref: "refs/heads/crew/backend",
            threadId: null,
            commandId: null,
            attempt: 0,
          },
          result: null,
          detail: null,
          startedAt: "2026-10-03T10:00:00.000Z",
          updatedAt: "2026-10-03T10:00:00.000Z",
        });
      }),
    (world) =>
      Effect.gen(function* () {
        yield* (yield* ServerCommandReadiness).complete;
        yield* snapshotWhere((frame) =>
          frame.attention.some((need) => need.operation?.id === "rebuild-crash"),
        );
        yield* command({
          _tag: "operationContinue",
          handle: "backend",
          operationId: "rebuild-crash",
        });
        assert.strictEqual(
          NodeFS.readFileSync(NodePath.join(world.root, ".crew/backend/preserved.txt"), "utf8"),
          "keep this copy\n",
        );
        const operation = yield* (yield* CrewStore).getOperation("rebuild-crash");
        assert.strictEqual(operation._tag === "Some" ? operation.value.status : null, "continued");
      }),
  ]),
);

it.live("Continue explicitly preserves dirty edits that held a new dispatch", () =>
  withCrewEngine((world) =>
    Effect.gen(function* () {
      yield* applied(world);
      const store = yield* CrewStore;
      const tip = git(world.root, ["rev-parse", "crew/backend"]);
      yield* store.updateLane(CREW_ID, "backend", (lane) => ({ ...lane, lastLanding: tip }));
      write(world.root, "person.txt", "new landing\n");
      git(world.root, ["add", "-A"]);
      git(world.root, ["commit", "-q", "-m", "person"]);
      write(world.root, ".crew/backend/README.md", "preserved edit\n");
      yield* command({ _tag: "message", handle: "backend", text: "Next task", attachments: [] });
      assert.strictEqual((yield* store.assignments(CREW_ID))[0]!.state, "queued");
      const operation = (yield* store.operations(CREW_ID)).find(
        (row) => row.kind === "dispatch" && row.status === "failed",
      )!;
      yield* command({ _tag: "operationContinue", handle: "backend", operationId: operation.id });
      assert.strictEqual((yield* store.assignments(CREW_ID))[0]!.state, "working");
      assert.strictEqual(
        (yield* Ref.get(world.dispatched)).filter((entry) => entry.type === "thread.turn.start")
          .length,
        1,
      );
      assert.strictEqual(
        NodeFS.readFileSync(NodePath.join(world.root, ".crew/backend/README.md"), "utf8"),
        "preserved edit\n",
      );
    }),
  ),
);
