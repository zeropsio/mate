// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { CrewStore } from "./CrewStore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { sweptSeamWords } from "./crewCards.ts";
import { EDITED_AFTER_CHECK, MOVED_AFTER_CHECK } from "./crewMachines.ts";
import { write, git } from "./testing/crewGitFixture.ts";
import {
  applied,
  crewJourney,
  eventually,
  firstTurn,
  CREW_WORLD,
  onV1,
  onV1Value,
  pressWhenFree,
  reportDone,
  seamsOf,
  turnsSent,
  v1Journey,
  type CrewWorld,
  type V1CrewWorld,
} from "./testing/crewWorld.ts";

describe("owned crew operations", () => {
  it.live("a broken-off turn's operation records its ending and holds nothing", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        const operation = yield* onV1Value(world, (v1) =>
          v1.v1.run(
            Effect.map(
              Effect.flatMap(CrewStore, (store) => store.operations(CREW_ID)),
              (rows) => rows.find((row) => row.kind === "dispatch"),
            ),
          ),
        );
        yield* world.turnEnds(thread, { state: "failed", reason: "api_error" });
        const again = yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.attempts === 2);
        yield* onV1(world, (v1) =>
          Effect.gen(function* () {
            const ended = yield* v1.v1.run(
              Effect.flatMap(CrewStore, (store) => store.getOperation(operation!.id)),
            );
            assert.strictEqual(ended._tag === "Some" ? ended.value.status : null, "succeeded");
          }).pipe(Effect.orDie),
        );
        assert.isFalse(again.attention.some((need) => need.kind === "interrupted"));
        const refusal = yield* Effect.flip(
          world.press({ _tag: "taskRetry", taskId: again.board.tasks[0]!.id }),
        );
        assert.strictEqual(refusal.reason, "wrong-state");
      }),
    ),
  );

  // A broken crew database is V1's own: the engine keeps crew state in its own store.
  it.live.skipIf(CREW_WORLD !== "v1")(
    "a failed boot inspection records one visible ending and refuses new effects",
    () =>
      v1Journey([
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
            const before = yield* world.snapshot;
            const refused = yield* Effect.flip(
              world.press({ _tag: "message", handle: "backend", text: "Work", attachments: [] }),
            );
            assert.strictEqual(refused.reason, "io");
            yield* world.readFiles;
            const ending = yield* world.snapshotWhere((frame) => frame.seq > before.seq);
            assert.isNotNull(ending.lastError, "the inspection failure must end visibly");
            assert.strictEqual((yield* turnsSent(world)).length, 0);
          }),
      ]),
  );

  // The check's final read of the copy after its command is V1's own step; the engine's check
  // returns its verdict with its command (the owner, 2026-10-08: V1's mechanism goes at cutover).
  it.live.skipIf(CREW_WORLD !== "v1")(
    "a failed check's verdict holds nothing: a fix during its final read goes out at once",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(NodePath.join(world.root, ".crew/backend"), "work.txt", "work\n"),
          );
          yield* reportDone(world, thread);
          const hold = yield* world.hold({ step: "verdict", nth: 2 });
          yield* world.turnEnds(thread);
          yield* hold.reached;
          const operation = yield* onV1Value(world, (v1) =>
            v1.v1.run(
              Effect.map(
                Effect.flatMap(CrewStore, (store) => store.operations(CREW_ID)),
                (rows) => rows.find((row) => row.kind === "check"),
              ),
            ),
          );
          if (operation !== undefined) {
            assert.strictEqual(operation.status, "running");
            assert.strictEqual(operation.confirmedStage, "checking");
            assert.isNull(operation.detail);
          }
          const taskId = (yield* world.snapshot).board.tasks[0]!.id;
          yield* world.press({ _tag: "askFix", taskId });
          assert.strictEqual((yield* world.tasks)[0]!.attempt, 2);
          yield* hold.release;
          yield* world.snapshotWhere(
            (frame) => !frame.operations?.some((row) => row.id === operation?.id),
          );
        }),
      ),
  );

  // An operation's record is V1's own; the engine's effects carry their identity (part C).
  it.live.skipIf(CREW_WORLD !== "v1")(
    "records the dispatch identity and attempt before starting the turn",
    () =>
      v1Journey((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const store = yield* CrewStore;
          yield* Ref.set(
            world.v1.fakes.beforeDispatch,
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
          yield* world.press({ _tag: "message", handle: "backend", text: "Work", attachments: [] });
        }),
      ),
  );

  for (const kind of ["checkpoint", "check", "landing"] as const) {
    // An operation's record is V1's own; the engine's effects carry their identity (part C).
    it.live.skipIf(CREW_WORLD !== "v1")(
      `records ${kind}'s target and stage before its side effect`,
      () =>
        v1Journey((world) =>
          Effect.gen(function* () {
            yield* applied(world);
            const thread = yield* firstTurn(world, () =>
              write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ready\n"),
            );
            if (kind !== "checkpoint") yield* reportDone(world, thread);
            if (kind === "landing") {
              yield* world.turnEnds(thread);
              yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "ready");
            }
            const hold = yield* world.v1.fakes.holdSsh((script) =>
              kind === "checkpoint"
                ? script.includes("wip(")
                : kind === "check"
                  ? script.includes("test -f ok.txt")
                  : script.includes("commit-tree"),
            );
            const fiber = yield* (
              kind === "landing"
                ? world.press({
                    _tag: "land",
                    taskId: (yield* (yield* CrewStore).assignments(CREW_ID))[0]!.assignment,
                  })
                : world.turnEnds(thread)
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
  // A crash's operation row is written into V1's own tables; part C carries the sentence for the engine's effects.
  it.live.skipIf(CREW_WORLD !== "v1")(
    `restart carries ${kind} on from its confirmed stage, its dirty work kept`,
    () => {
      let head = "";
      return v1Journey([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            yield* firstTurn(world, () =>
              write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "dirty work\n"),
            );
            head = git(NodePath.join(world.root, ".crew/backend"), ["rev-parse", "HEAD"]);
            const store = yield* CrewStore;
            const [dispatch] = yield* store.operations(CREW_ID);
            if (kind !== "dispatch")
              yield* store.putOperation({ ...dispatch!, status: "succeeded" });
            const [task] = yield* store.assignments(CREW_ID);
            const state =
              kind === "check" ? "checking" : kind === "landing" ? "landing" : "working";
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
            if (kind === "dispatch")
              yield* store.putOperation({ ...dispatch!, status: "succeeded" });
          }),
        (world) =>
          Effect.gen(function* () {
            yield* world.serverReady;
            const settled = yield* world.snapshotWhere(
              (frame) =>
                !frame.operations?.some((row) => row.id === `crashed-${kind}`) &&
                (kind === "dispatch" || kind === "checkpoint"
                  ? frame.board.tasks[0]?.attempts === 1 &&
                    frame.board.tasks[0]?.state === "working"
                  : frame.board.tasks[0]?.state === (kind === "check" ? "ready" : "rework")),
            );
            const operation = yield* (yield* CrewStore).getOperation(`crashed-${kind}`);
            assert.strictEqual(
              operation._tag === "Some" ? operation.value.status : null,
              "continued",
            );
            assert.isFalse(settled.attention.some((need) => need.kind === "interrupted"));
            const copy = NodePath.join(world.root, ".crew/backend");
            assert.strictEqual(
              NodeFS.readFileSync(NodePath.join(copy, "ok.txt"), "utf8"),
              "dirty work\n",
            );
            if (kind === "landing") {
              // The re-check runs on the committed tree: the untracked ok.txt cannot make it pass,
              // nothing lands, and the file is back in the copy as it was.
              assert.isFalse(NodeFS.existsSync(NodePath.join(world.root, "ok.txt")));
              assert.include(git(copy, ["status", "--porcelain"]), "?? ok.txt");
            }
            if (kind === "checkpoint") {
              // Its turn had ended: the save is redone, and no turn goes out outside a run.
              assert.strictEqual(git(copy, ["rev-parse", "HEAD~1"]), head);
              assert.strictEqual((yield* turnsSent(world)).length, 1);
            }
            if (kind === "dispatch") {
              // The boot sweep saved the dirty work as a commit on the copy's tip, and said so in
              // the crewmate's chat: what it saved, and where.
              assert.strictEqual(git(copy, ["rev-parse", "HEAD~1"]), head);
              const saved = git(copy, ["rev-parse", "HEAD"]);
              assert.deepInclude(
                (yield* seamsOf(world)).map(([, words, seam]) => [words, seam]),
                [
                  sweptSeamWords("crew/backend", saved, ["ok.txt"]),
                  { seam: "swept", branch: "crew/backend", commit: saved, paths: ["ok.txt"] },
                ],
              );
              yield* eventually(Effect.map(turnsSent(world), (rows) => rows.length === 2));
            }
          }),
      ]);
    },
  );
}

it.live("a killed check ends after one command and waits for a person", () =>
  crewJourney((world) =>
    Effect.gen(function* () {
      world.writeHome();
      const home = NodePath.join(world.workspace, ".mate/crew/main/crew.yaml");
      const config = NodeFS.readFileSync(home, "utf8").replace(
        "test -f ok.txt",
        () => "printf x >> check-count.txt; kill -TERM $$",
      );
      world.writeHome({ "crew.yaml": config });
      yield* world.press({ _tag: "apply" });
      yield* world.snapshotWhere((frame) => frame.crewmates[0]?.lane?.state === "ready");
      const thread = yield* firstTurn(world, () =>
        write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ok\n"),
      );
      yield* reportDone(world, thread);
      yield* world.turnEnds(thread);
      const stopped = yield* world.snapshotWhere(
        (frame) => frame.board.tasks[0]?.state === "parked",
      );
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
    crewJourney((world) =>
      Effect.gen(function* () {
        world.writeHome();
        const home = NodePath.join(world.workspace, ".mate/crew/main/crew.yaml");
        const config = NodeFS.readFileSync(home, "utf8").replace(
          "    check: test -f ok.txt",
          () => `    setup: ${setup}\n    check: printf x >> check-count.txt; test -f ok.txt`,
        );
        world.writeHome({ "crew.yaml": config });
        yield* world.press({ _tag: "apply" });
        yield* world.snapshotWhere((frame) => frame.crewmates[0]?.lane?.state === "ready");
        const lane = NodePath.join(world.root, ".crew/backend");
        const thread = yield* firstTurn(world, () => {
          write(lane, "ok.txt", "ok\n");
          write(lane, "fail-setup.txt", "stop\n");
        });
        write(world.root, "package-lock.json", "{}\n");
        git(world.root, ["add", "package-lock.json"]);
        git(world.root, ["commit", "-m", "new lockfile"]);
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        const stopped = yield* world.snapshotWhere((frame) =>
          ["ready", "parked"].includes(frame.board.tasks[0]?.state ?? ""),
        );
        assert.strictEqual(stopped.board.tasks[0]!.state, "parked");
        const receipt = yield* world.snapshotWhere(
          (frame) =>
            frame.operations?.some((row) => row.kind === "check" && row.status === "failed") ===
            true,
        );
        const operation = receipt.operations!.find((row) => row.kind === "check")!;
        assert.strictEqual(operation.status, "failed");
        assert.strictEqual(operation.confirmedStage, "setting-up");
        assert.strictEqual(NodeFS.existsSync(NodePath.join(lane, "check-count.txt")), false);
        NodeFS.unlinkSync(NodePath.join(lane, "fail-setup.txt"));
        yield* world.press({
          _tag: "operationContinue",
          handle: "backend",
          operationId: operation.id,
        });
        yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "ready");
        assert.strictEqual(
          NodeFS.readFileSync(NodePath.join(lane, "check-count.txt"), "utf8"),
          "x",
        );
      }),
    ),
  );
}

for (const taskState of ["landing", "landed"] as const) {
  // A crash's operation row is written into V1's own tables.
  it.live.skipIf(CREW_WORLD !== "v1")(
    `restart records an already landed outcome for a ${taskState} task without landing again`,
    () => {
      let operationId = "";
      let landedHead = "";
      return v1Journey([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            const thread = yield* firstTurn(world, () =>
              write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ok\n"),
            );
            yield* reportDone(world, thread);
            yield* world.turnEnds(thread);
            const ready = yield* world.snapshotWhere(
              (frame) => frame.board.tasks[0]?.state === "ready",
            );
            const hold = yield* world.hold({ step: "land" });
            const landing = yield* world
              .press({ _tag: "land", taskId: ready.board.tasks[0]!.id })
              .pipe(Effect.forkChild);
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
            yield* world.serverReady;
            const recorded = yield* world.snapshotWhere(
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
  "Drop it cancels a task its restart could not carry on, its saved work left in its copy",
  () => {
    let head = "";
    return crewJourney([
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
          yield* world.refuseTurns("not the login's signer");
          yield* world.serverReady;
          const stopped = yield* world.snapshotWhere((frame) =>
            frame.attention.some(
              (need) =>
                need.kind === "interrupted" &&
                need.text?.includes("not the login's signer") === true,
            ),
          );
          const operation = stopped.attention.find(
            (need) => need.kind === "interrupted",
          )!.operation!;
          assert.strictEqual((yield* turnsSent(world)).length, 1);
          yield* world.press({
            _tag: "operationDiscard",
            handle: "backend",
            operationId: operation.id,
          });
          yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "discarded");
          assert.strictEqual(
            git(NodePath.join(world.root, ".crew/backend"), ["rev-parse", "HEAD~1"]),
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

it.live("a missing copy comes back at boot from its recorded branch, its work kept", () => {
  let tip = "";
  return crewJourney([
    (world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "kept\n"),
        );
        yield* world.turnEnds(thread);
        tip = git(world.root, ["rev-parse", "crew/backend"]);
        NodeFS.rmSync(NodePath.join(world.root, ".crew/backend"), { recursive: true });
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        yield* eventually(
          Effect.sync(() => NodeFS.existsSync(NodePath.join(world.root, ".crew/backend/ok.txt"))),
        );
        const back = yield* world.snapshotWhere(
          (frame) =>
            frame.crewmates[0]?.lane?.state === "ready" &&
            !frame.attention.some((need) => need.kind === "copy-missing"),
        );
        assert.isNull(back.lastError);
        assert.strictEqual(
          git(NodePath.join(world.root, ".crew/backend"), ["rev-parse", "HEAD"]),
          tip,
        );
        assert.strictEqual(
          NodeFS.readFileSync(NodePath.join(world.root, ".crew/backend/ok.txt"), "utf8"),
          "kept\n",
        );
        assert.strictEqual((yield* turnsSent(world)).length, 1);
      }),
  ]);
});

it.live("a missing copy whose branch is gone stays missing at boot and names the loss", () =>
  crewJourney([
    (world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "kept\n"),
        );
        yield* world.turnEnds(thread);
        NodeFS.rmSync(NodePath.join(world.root, ".crew/backend"), { recursive: true });
        git(world.root, ["worktree", "prune"]);
        git(world.root, ["branch", "-D", "-q", "crew/backend"]);
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        const lost = yield* world.snapshotWhere(
          (frame) => frame.lastError?.includes("crew/backend") === true,
        );
        assert.notStrictEqual(lost.crewmates[0]?.lane?.state, "ready");
        assert.isFalse(NodeFS.existsSync(NodePath.join(world.root, ".crew/backend")));
      }),
  ]),
);

// A crash's operation row is written into V1's own tables.
it.live.skipIf(CREW_WORLD !== "v1")(
  "Continue after a rebuild interrupted during setup leaves its existing copy in place",
  () =>
    v1Journey([
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
          yield* world.serverReady;
          yield* world.snapshotWhere((frame) =>
            frame.attention.some((need) => need.operation?.id === "rebuild-crash"),
          );
          yield* world.press({
            _tag: "operationContinue",
            handle: "backend",
            operationId: "rebuild-crash",
          });
          assert.strictEqual(
            NodeFS.readFileSync(NodePath.join(world.root, ".crew/backend/preserved.txt"), "utf8"),
            "keep this copy\n",
          );
          const operation = yield* (yield* CrewStore).getOperation("rebuild-crash");
          assert.strictEqual(
            operation._tag === "Some" ? operation.value.status : null,
            "continued",
          );
        }),
    ]),
);

// The copy's last landing is set in V1's own lane row.
it.live.skipIf(CREW_WORLD !== "v1")(
  "Continue explicitly preserves dirty edits that held a new dispatch",
  () =>
    v1Journey((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const store = yield* CrewStore;
        const tip = git(world.root, ["rev-parse", "crew/backend"]);
        yield* store.updateLane(CREW_ID, "backend", (lane) => ({ ...lane, lastLanding: tip }));
        write(world.root, "person.txt", "new landing\n");
        git(world.root, ["add", "-A"]);
        git(world.root, ["commit", "-q", "-m", "person"]);
        write(world.root, ".crew/backend/README.md", "preserved edit\n");
        yield* world.press({
          _tag: "message",
          handle: "backend",
          text: "Next task",
          attachments: [],
        });
        assert.strictEqual((yield* store.assignments(CREW_ID))[0]!.state, "queued");
        const operation = (yield* store.operations(CREW_ID)).find(
          (row) => row.kind === "dispatch" && row.status === "failed",
        )!;
        yield* world.press({
          _tag: "operationContinue",
          handle: "backend",
          operationId: operation.id,
        });
        assert.strictEqual((yield* store.assignments(CREW_ID))[0]!.state, "working");
        assert.strictEqual((yield* turnsSent(world)).length, 1);
        assert.strictEqual(
          NodeFS.readFileSync(NodePath.join(world.root, ".crew/backend/README.md"), "utf8"),
          "preserved edit\n",
        );
      }),
    ),
);

it.live("a graceful shutdown during a check leaves it for the next boot to carry on", () => {
  let operationId = "";
  return crewJourney([
    (world) =>
      Effect.gen(function* () {
        const marker = NodePath.join(world.workspace, "first-check");
        world.writeHome();
        const home = NodePath.join(world.workspace, ".mate/crew/main/crew.yaml");
        const config = NodeFS.readFileSync(home, "utf8").replace(
          "test -f ok.txt",
          () => `"if [ ! -f ${marker} ]; then touch ${marker}; sleep 30; fi; test -f ok.txt"`,
        );
        world.writeHome({ "crew.yaml": config });
        yield* world.press({ _tag: "apply" });
        yield* world.snapshotWhere((frame) => frame.crewmates[0]?.lane?.state === "ready");
        const thread = yield* firstTurn(world, () =>
          write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ok\n"),
        );
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        yield* eventually(Effect.sync(() => NodeFS.existsSync(marker)));
        operationId =
          (yield* onV1Value(world, (v1) =>
            v1.v1.run(
              Effect.map(
                Effect.flatMap(CrewStore, (store) => store.operations(CREW_ID)),
                (rows) => rows.find((row) => row.kind === "check"),
              ),
            ),
          ))?.id ?? "";
        // The phase ends here: the engine's scope closes with the check still sleeping.
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        yield* world.snapshotWhere(
          (frame) =>
            frame.board.tasks[0]?.state === "ready" &&
            !frame.operations?.some((row) => row.id === operationId),
        );
        yield* onV1(world, (v1) =>
          Effect.gen(function* () {
            const operation = yield* v1.v1.run(
              Effect.flatMap(CrewStore, (store) => store.getOperation(operationId)),
            );
            assert.strictEqual(
              operation._tag === "Some" ? operation.value.status : null,
              "continued",
            );
          }).pipe(Effect.orDie),
        );
        assert.strictEqual((yield* turnsSent(world)).length, 1);
        const [task] = yield* world.tasks;
        const [attempt] = yield* world.attempts(task!.id);
        assert.strictEqual(
          attempt!.endingDetail,
          "Its turn had ended; the Mate restarted during its check.",
        );
      }),
  ]);
});

// A crash's operation row is written into V1's own tables; part C carries the sentence for the engine's checkpoint.
it.live.skipIf(CREW_WORLD !== "v1")(
  "a WIP commit its checkpoint finished after the Mate stopped is adopted, not parked",
  () =>
    v1Journey([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const copy = NodePath.join(world.root, ".crew/backend");
          yield* firstTurn(world, () => write(copy, "ok.txt", "saved work\n"));
          const store = yield* CrewStore;
          const [dispatch] = yield* store.operations(CREW_ID);
          yield* store.putOperation({ ...dispatch!, status: "succeeded" });
          yield* store.putOperation({
            ...dispatch!,
            id: "crashed-checkpoint",
            kind: "checkpoint",
            stage: "committing",
            confirmedStage: "prepared",
            status: "running",
          });
          // The commit landed on the service; the Mate died before recording its tip.
          git(copy, ["add", "-A"]);
          git(copy, [
            "commit",
            "-q",
            "-m",
            "wip(a): turn 1",
            "-m",
            "Crew-Operation: crashed-checkpoint",
          ]);
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          const settled = yield* world.snapshotWhere(
            (frame) =>
              !frame.operations?.some((row) => row.id === "crashed-checkpoint") &&
              frame.board.tasks[0]?.attempts === 1,
          );
          const copy = NodePath.join(world.root, ".crew/backend");
          const lane = yield* (yield* CrewStore).getLane(CREW_ID, "backend");
          assert.deepStrictEqual(
            [
              settled.board.tasks[0]!.state,
              lane._tag === "Some" ? lane.value.state : null,
              lane._tag === "Some" ? lane.value.recordedTip : null,
            ],
            ["working", "ready", git(copy, ["rev-parse", "HEAD"])],
          );
        }),
    ]),
);

// A crash's operation and lane rows are written into V1's own tables; part C carries the sentence for the engine's landing.
it.live.skipIf(CREW_WORLD !== "v1")(
  "a landing the service finished after the Mate stopped is landed, its copy moved to it",
  () => {
    let landedHead = "";
    return v1Journey([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const copy = NodePath.join(world.root, ".crew/backend");
          const thread = yield* firstTurn(world, () => write(copy, "ok.txt", "ok\n"));
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const ready = yield* world.snapshotWhere(
            (frame) => frame.board.tasks[0]?.state === "ready",
          );
          const store = yield* CrewStore;
          const before = (yield* store.getLane(CREW_ID, "backend")).pipe(Option.getOrThrow);
          const hold = yield* world.hold({ step: "land" });
          const landing = yield* world
            .press({ _tag: "land", taskId: ready.board.tasks[0]!.id })
            .pipe(Effect.forkChild);
          yield* hold.reached;
          const operation = (yield* store.operations(CREW_ID)).find(
            (row) => row.kind === "landing",
          )!;
          yield* hold.release;
          yield* Fiber.join(landing);
          landedHead = git(world.root, ["rev-parse", "HEAD"]);
          // The Mate died after your branch took the landing, before the copy moved to it.
          git(copy, ["reset", "-q", "--keep", before.recordedTip!]);
          yield* store.updateLane(CREW_ID, "backend", (lane) => ({
            ...lane,
            recordedTip: before.recordedTip,
            lastLanding: before.lastLanding,
          }));
          const [task] = yield* store.assignments(CREW_ID);
          yield* store.putAssignment({ ...task!, state: "landing", landedCommit: null });
          yield* store.putOperation({ ...operation, status: "running", stage: "landing" });
          // An edit in the copy since: the landing went through all the same.
          write(copy, "ok.txt", "edited after the landing\n");
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "landed");
          const copy = NodePath.join(world.root, ".crew/backend");
          yield* eventually(
            Effect.map(
              (yield* CrewStore).getLane(CREW_ID, "backend"),
              (lane) => Option.getOrThrow(lane).recordedTip === landedHead,
            ),
          );
          const lane = Option.getOrThrow(yield* (yield* CrewStore).getLane(CREW_ID, "backend"));
          assert.deepStrictEqual(
            [lane.state, lane.lastLanding, git(copy, ["rev-parse", "HEAD"])],
            ["ready", landedHead, landedHead],
          );
        }),
    ]);
  },
);

for (const state of ["blocked", "ready", "review"] as const) {
  // A task's state is set in V1's own tables.
  it.live.skipIf(CREW_WORLD !== "v1")(
    `a restart leaves a ${state} task whose turn it cut off as it stands`,
    () =>
      v1Journey([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            yield* firstTurn(world, () => undefined);
            const store = yield* CrewStore;
            const [task] = yield* store.assignments(CREW_ID);
            yield* store.putAssignment({ ...task!, state });
          }),
        (world) =>
          Effect.gen(function* () {
            yield* world.serverReady;
            const settled = yield* world.snapshotWhere((frame) =>
              (frame.operations ?? []).every((row) => row.status !== "interrupted"),
            );
            assert.deepStrictEqual(
              [
                settled.board.tasks[0]!.state,
                settled.board.tasks[0]!.attempts,
                (yield* turnsSent(world)).length,
              ],
              [state, 1, 1],
            );
          }),
      ]),
  );
}

// A crash's operation row is written into V1's own tables.
it.live.skipIf(CREW_WORLD !== "v1")(
  "a restart merges and checks a task whose turn-end save it cut off after a report",
  () =>
    v1Journey([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* firstTurn(world, () =>
            write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ok\n"),
          );
          const store = yield* CrewStore;
          const [dispatch] = yield* store.operations(CREW_ID);
          yield* store.putOperation({ ...dispatch!, status: "succeeded" });
          yield* store.putOperation({
            ...dispatch!,
            id: "crashed-save",
            kind: "checkpoint",
            stage: "committing",
            confirmedStage: "prepared",
            status: "running",
          });
          const [task] = yield* store.assignments(CREW_ID);
          yield* store.putAssignment({ ...task!, state: "merging" });
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          const ready = yield* world.snapshotWhere(
            (frame) => frame.board.tasks[0]?.state === "ready",
          );
          assert.strictEqual(ready.board.tasks[0]!.attempts, 1);
        }),
    ]),
);

it.live("a restart sends no turn into a run the person paused; Resume carries the task on", () => {
  let runId = "";
  return crewJourney([
    (world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.press({
          _tag: "start",
          budgetUsd: "unlimited",
          timeLimitHours: "unlimited",
          stopAtUsagePercent: null,
          landing: "person",
          devGrant: false,
          leadMayStart: false,
        });
        runId = (yield* world.snapshotWhere((frame) => frame.run?.state === "running")).run!.id;
        yield* firstTurn(world, () => undefined);
        yield* world.press({ _tag: "pause", runId });
        yield* world.snapshotWhere((frame) => frame.run?.state === "paused");
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        const held = yield* world.snapshotWhere((frame) =>
          (frame.operations ?? []).every((row) => row.status !== "interrupted"),
        );
        const turns = (yield* turnsSent(world)).length;
        assert.deepStrictEqual(
          [held.run?.state, held.board.tasks[0]!.state, turns],
          ["paused", "working", 1],
        );
        yield* world.press({ _tag: "resume", runId });
        yield* eventually(Effect.map(turnsSent(world), (rows) => rows.length === 2));
      }),
  ]);
});

// A crash's operation row is written into V1's own tables.
it.live.skipIf(CREW_WORLD !== "v1")(
  "a copy save outside any task carries on at boot and holds nothing",
  () =>
    v1Journey([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          write(NodePath.join(world.root, ".crew/backend"), "notes.txt", "kept\n");
          yield* (yield* CrewStore).putOperation({
            id: "crashed-idle-save",
            crew: CREW_ID,
            handle: "backend",
            taskId: null,
            kind: "checkpoint",
            stage: "committing",
            confirmedStage: "prepared",
            status: "running",
            startedBy: "",
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
          yield* world.serverReady;
          yield* world.snapshotWhere(
            (frame) => !frame.operations?.some((row) => row.id === "crashed-idle-save"),
          );
          const operation = yield* (yield* CrewStore).getOperation("crashed-idle-save");
          assert.strictEqual(
            operation._tag === "Some" ? operation.value.status : null,
            "continued",
          );
          // Once the boot's own work lets go of the copy, a new message starts its task.
          yield* pressWhenFree(world, {
            _tag: "message",
            handle: "backend",
            text: "Work",
            attachments: [],
          });
          yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "working");
        }),
    ]),
);

// A stopped operation's row is written into V1's own tables.
it.live.skipIf(CREW_WORLD !== "v1")(
  "Drop it settles a stopped copy save outside any task, and its queue moves",
  () =>
    v1Journey((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* (yield* CrewStore).putOperation({
          id: "failed-idle-save",
          crew: CREW_ID,
          handle: "backend",
          taskId: null,
          kind: "checkpoint",
          stage: "committing",
          confirmedStage: "prepared",
          status: "failed",
          startedBy: "",
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
          detail: "Preserving work stopped: frozen",
          startedAt: "2026-10-03T10:00:00.000Z",
          updatedAt: "2026-10-03T10:00:00.000Z",
        });
        yield* world.press({
          _tag: "operationDiscard",
          handle: "backend",
          operationId: "failed-idle-save",
        });
        const operation = yield* (yield* CrewStore).getOperation("failed-idle-save");
        assert.strictEqual(operation._tag === "Some" ? operation.value.status : null, "discarded");
        yield* world.press({ _tag: "message", handle: "backend", text: "Work", attachments: [] });
        yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "working");
      }),
    ),
);

const readyTask = (world: CrewWorld) =>
  Effect.gen(function* () {
    yield* applied(world);
    const thread = yield* firstTurn(world, () =>
      write(NodePath.join(world.root, ".crew/backend"), "ok.txt", "ok\n"),
    );
    yield* reportDone(world, thread);
    yield* world.turnEnds(thread);
    yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "ready");
    return thread;
  });

it.live("a restart never commits edits on a checked copy: its task stops, the edits kept", () => {
  let tip = "";
  return crewJourney([
    (world) =>
      Effect.gen(function* () {
        yield* readyTask(world);
        const copy = NodePath.join(world.root, ".crew/backend");
        tip = git(copy, ["rev-parse", "HEAD"]);
        write(copy, "ok.txt", "edited after the check\n");
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        const stopped = yield* world.snapshotWhere(
          (frame) => frame.board.tasks[0]?.state === "parked",
        );
        const copy = NodePath.join(world.root, ".crew/backend");
        assert.deepStrictEqual(
          [stopped.board.tasks[0]!.reason, git(copy, ["rev-parse", "HEAD"])],
          [EDITED_AFTER_CHECK, tip],
        );
        assert.include(git(copy, ["status", "--porcelain"]), "ok.txt");
      }),
  ]);
});

it.live("a turn's end never commits edits on a checked copy: its task stops", () =>
  crewJourney((world) =>
    Effect.gen(function* () {
      const thread = yield* readyTask(world);
      const copy = NodePath.join(world.root, ".crew/backend");
      const tip = git(copy, ["rev-parse", "HEAD"]);
      yield* world.turnStarts(thread);
      write(copy, "ok.txt", "edited after the check\n");
      yield* world.turnEnds(thread);
      const stopped = yield* world.snapshotWhere(
        (frame) => frame.board.tasks[0]?.state === "parked",
      );
      assert.deepStrictEqual(
        [stopped.board.tasks[0]!.reason, git(copy, ["rev-parse", "HEAD"])],
        [EDITED_AFTER_CHECK, tip],
      );
    }),
  ),
);

// The copy's moved tip is recorded in V1's own lane row.
it.live.skipIf(CREW_WORLD !== "v1")(
  "Land refuses a copy that moved after its check and lands nothing",
  () =>
    v1Journey((world) =>
      Effect.gen(function* () {
        yield* readyTask(world);
        const copy = NodePath.join(world.root, ".crew/backend");
        const head = git(world.root, ["rev-parse", "HEAD"]);
        // A commit the check never saw, recorded as the copy's tip.
        write(copy, "after-check.txt", "unchecked\n");
        git(copy, ["add", "-A"]);
        git(copy, ["commit", "-q", "-m", "after the check"]);
        const moved = git(copy, ["rev-parse", "HEAD"]);
        yield* (yield* CrewStore).updateLane(CREW_ID, "backend", (lane) => ({
          ...lane,
          recordedTip: moved,
        }));
        const [task] = yield* (yield* CrewStore).assignments(CREW_ID);
        yield* world.press({ _tag: "land", taskId: task!.assignment });
        const stopped = yield* world.snapshotWhere(
          (frame) => frame.board.tasks[0]?.state === "parked",
        );
        assert.deepStrictEqual(
          [stopped.board.tasks[0]!.reason, git(world.root, ["rev-parse", "HEAD"])],
          [MOVED_AFTER_CHECK, head],
        );
      }),
    ),
);

it.live("the boot sweep holds each crewmate's copy: a press during it waits its turn", () =>
  crewJourney([
    (world) => applied(world),
    (world) =>
      Effect.gen(function* () {
        const hold = yield* world.hold({ step: "sweep" });
        yield* world.serverReady;
        yield* hold.reached;
        const press = yield* world
          .press({
            _tag: "message",
            handle: "backend",
            text: "Work",
            attachments: [],
          })
          .pipe(Effect.forkChild);
        yield* Effect.sleep("300 millis");
        assert.strictEqual(press.pollUnsafe() === undefined, true);
        yield* hold.release;
        yield* Fiber.join(press);
        yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "working");
      }),
  ]),
);

it.live("a Land whose browser went away mid-landing still lands", () =>
  crewJourney((world) =>
    Effect.gen(function* () {
      yield* readyTask(world);
      const [task] = yield* world.tasks;
      const hold = yield* world.hold({ step: "land" });
      const press = yield* world.press({ _tag: "land", taskId: task!.id }).pipe(Effect.forkChild);
      yield* hold.reached;
      // The RPC server interrupts a disconnecting client's request.
      yield* Fiber.interrupt(press);
      yield* hold.release;
      const landed = yield* world.snapshotWhere(
        (frame) =>
          frame.board.tasks[0]?.state === "landed" &&
          (frame.operations ?? []).every((row) => row.status !== "running"),
      );
      assert.isNotNull(landed.board.tasks[0]!.landedCommit);
    }),
  ),
);

it.live("untracked files never stop a checked task, nor get committed or landed", () =>
  crewJourney([
    (world) =>
      Effect.gen(function* () {
        const thread = yield* readyTask(world);
        const copy = NodePath.join(world.root, ".crew/backend");
        // A show-on-dev turn leaves a build log behind.
        yield* world.turnStarts(thread);
        write(copy, "build.log", "untracked\n");
        yield* world.turnEnds(thread);
        yield* Effect.sleep("200 millis");
        assert.strictEqual((yield* world.snapshot).board.tasks[0]!.state, "ready");
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        const copy = NodePath.join(world.root, ".crew/backend");
        const [task] = yield* world.tasks;
        yield* pressWhenFree(world, { _tag: "land", taskId: task!.id });
        const landed = yield* world.snapshotWhere(
          (frame) => frame.board.tasks[0]?.state === "landed",
        );
        assert.deepStrictEqual(
          [
            landed.board.tasks[0]!.state,
            NodeFS.existsSync(NodePath.join(world.root, "build.log")),
            git(copy, ["status", "--porcelain"]),
          ],
          ["landed", false, "?? build.log"],
        );
      }),
  ]),
);

it.live("a task card a restart cut off before it went out is sent, not a Continue", () =>
  crewJourney([
    (world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const send = yield* world.hold({ step: "send" });
        yield* world
          .press({
            _tag: "message",
            handle: "backend",
            text: "Change a.txt",
            attachments: [],
          })
          .pipe(Effect.forkChild);
        yield* send.reached;
        // The phase ends here: the engine shuts down before the card reached its agent.
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        yield* eventually(Effect.map(turnsSent(world), (turns) => turns.length === 1));
        const [turn] = yield* turnsSent(world);
        assert.include(turn!.text, "Change a.txt");
        assert.notInclude(turn!.text, "Continue where you stopped");
      }),
  ]),
);

// A crash's operation row is written into V1's own tables.
it.live.skipIf(CREW_WORLD !== "v1")(
  "a fix hand-off a restart cut off before its card is sent with its card",
  () =>
    v1Journey([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(NodePath.join(world.root, ".crew/backend"), "work.txt", "no ok.txt\n"),
          );
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "rework");
          const store = yield* CrewStore;
          const [task] = yield* store.assignments(CREW_ID);
          // Ask to fix began its dispatch; the restart came before the task moved or the card went.
          yield* store.putOperation({
            id: "cut-fix",
            crew: CREW_ID,
            handle: "backend",
            taskId: task!.assignment,
            kind: "dispatch",
            stage: "admitting",
            confirmedStage: "prepared",
            status: "running",
            startedBy: "user-karel",
            resumeState: "rework",
            targets: {
              host: "appdev",
              path: NodePath.join(world.root, ".crew/backend"),
              ref: "refs/heads/crew/backend",
              threadId: null,
              commandId: null,
              attempt: task!.attempt,
            },
            result: null,
            detail: null,
            startedAt: "2026-10-03T10:00:00.000Z",
            updatedAt: "2026-10-03T10:00:00.000Z",
          });
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          yield* eventually(Effect.map(turnsSent(world), (turns) => turns.length === 2));
          const fix = (yield* turnsSent(world)).at(-1)!;
          assert.include(fix.text, "fix the check");
        }),
    ]),
);

it.live("a restart after a finished run carries a died turn on: a finished run holds nothing", () =>
  crewJourney([
    (world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.press({
          _tag: "start",
          budgetUsd: "unlimited",
          timeLimitHours: "unlimited",
          stopAtUsagePercent: null,
          landing: "person",
          devGrant: false,
          leadMayStart: false,
        });
        const runId = (yield* world.snapshotWhere((frame) => frame.run?.state === "running")).run!
          .id;
        yield* world.press({ _tag: "finish", runId });
        yield* world.snapshotWhere((frame) => frame.run?.state === "finished");
        yield* firstTurn(world, () => undefined);
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        yield* eventually(Effect.map(turnsSent(world), (turns) => turns.length === 2));
      }),
  ]),
);

const landedCopy = (world: V1CrewWorld) =>
  Effect.gen(function* () {
    yield* readyTask(world);
    const [task] = yield* world.v1.run(
      Effect.flatMap(CrewStore, (store) => store.assignments(CREW_ID)),
    );
    yield* world.press({ _tag: "land", taskId: task!.assignment });
    yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "landed");
    // Your tree moves on past the landing.
    write(world.root, "person.txt", "person\n");
    git(world.root, ["add", "-A"]);
    git(world.root, ["commit", "-q", "-m", "person"]);
    return { head: git(world.root, ["rev-parse", "HEAD"]), task: task! };
  });

const interruptedDispatch = (
  world: V1CrewWorld,
  task: { readonly assignment: string; readonly attempt: number },
  result: unknown,
) =>
  Effect.flatMap(CrewStore, (store) =>
    store.putOperation({
      id: "cut-prepare",
      crew: CREW_ID,
      handle: "backend",
      taskId: task.assignment,
      kind: "dispatch",
      stage: "preparing-copy",
      confirmedStage: "opening-conversation",
      status: "running",
      startedBy: "user-karel",
      resumeState: "queued",
      targets: {
        host: "appdev",
        path: NodePath.join(world.root, ".crew/backend"),
        ref: "refs/heads/crew/backend",
        threadId: null,
        commandId: null,
        attempt: task.attempt,
      },
      result,
      detail: null,
      startedAt: "2026-10-03T10:00:00.000Z",
      updatedAt: "2026-10-03T10:00:00.000Z",
    }),
  );

for (const [title, recorded, parked] of [
  ["its own dispatch's reset, to the target it recorded, is adopted", true, false],
  ["a reset to your tree no dispatch recorded is not the engine's: the copy parks", false, true],
] as const) {
  // A crash's operation row is written into, and the lane read from, V1's own tables.
  it.live.skipIf(CREW_WORLD !== "v1")(title, () =>
    v1Journey([
      (world) =>
        Effect.gen(function* () {
          const { head, task } = yield* landedCopy(world);
          yield* interruptedDispatch(world, task, recorded ? { resetTo: head } : null);
          git(NodePath.join(world.root, ".crew/backend"), ["reset", "-q", "--hard", head]);
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          const head = git(world.root, ["rev-parse", "HEAD"]);
          yield* eventually(
            Effect.map((yield* CrewStore).getLane(CREW_ID, "backend"), (row) => {
              const lane = Option.getOrThrow(row);
              return lane.state === "parked" || lane.recordedTip === head;
            }).pipe(Effect.orElseSucceed(() => false)),
          );
          const lane = Option.getOrThrow(yield* (yield* CrewStore).getLane(CREW_ID, "backend"));
          assert.deepStrictEqual(
            [lane.state === "parked", lane.recordedTip === git(world.root, ["rev-parse", "HEAD"])],
            [parked, !parked],
          );
        }),
    ]),
  );
}
