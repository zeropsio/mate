// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { EDITED_AFTER_CHECK } from "./crewMachines.ts";
import { write, git } from "./testing/crewGitFixture.ts";
import {
  applied,
  KAREL,
  crewJourney,
  eventually,
  firstTurn,
  pressWhenFree,
  reportDone,
  turnsSent,
  type CrewWorld,
} from "./testing/crewWorld.ts";

describe("owned crew operations", () => {
  it.live("a broken-off turn's operation records its ending and holds nothing", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* world.turnEnds(thread, { state: "failed", reason: "api_error" });
        const again = yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.attempts === 2);
        assert.isFalse(again.attention.some((need) => need.kind === "interrupted"));
        const refusal = yield* Effect.flip(
          world.press({ _tag: "taskRetry", taskId: again.board.tasks[0]!.id }),
        );
        assert.strictEqual(refusal.reason, "wrong-state");
      }),
    ),
  );
});

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

it.live.each(
  Array.from(
    [
      ["failed", "test ! -f fail-setup.txt"],
      ["killed", "if [ -f fail-setup.txt ]; then kill -TERM $$; fi"],
    ] as const,
    ([ending, setup]) => ({
      title: `a ${ending} setup ends its check operation before the check command starts`,
      setup,
    }),
  ),
)("$title", ({ setup }) =>
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
          frame.operations?.some((row) => row.kind === "check" && row.status === "failed") === true,
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
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(lane, "check-count.txt"), "utf8"), "x");
    }),
  ),
);

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

it.live("a graceful shutdown during a check leaves it for the next boot to carry on", () => {
  return crewJourney([
    (world) =>
      Effect.gen(function* () {
        const marker = NodePath.join(world.workspace, "first-check");
        world.writeHome();
        const home = NodePath.join(world.workspace, ".mate/crew/main/crew.yaml");
        const config = NodeFS.readFileSync(home, "utf8").replace(
          "test -f ok.txt",
          () =>
            `"if [ ! -f ${marker} ]; then mkfifo ${marker}-wait; touch ${marker}; read released < ${marker}-wait; touch ${marker}-finished; fi; test -f ok.txt"`,
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
        // Nobody opens the FIFO for writing: only shutdown can stop this real shell child.
      }),
    (world) =>
      Effect.gen(function* () {
        yield* world.serverReady;
        yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "ready");
        assert.isFalse(
          NodeFS.existsSync(NodePath.join(world.workspace, "first-check-finished")),
          "shutdown cancels the first shell child before its blocking command finishes",
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

it.live("the boot sweep holds each crewmate's copy: a press during it waits its turn", () =>
  crewJourney([
    (world) => applied(world),
    (world) =>
      Effect.gen(function* () {
        const hold = yield* world.hold({ step: "sweep" });
        yield* world.serverReady;
        yield* hold.reached;
        yield* Effect.gen(function* () {
          const press = yield* world
            .press({
              _tag: "message",
              handle: "backend",
              text: "Work",
              attachments: [],
            })
            .pipe(Effect.forkChild({ startImmediately: true }));
          yield* TestClock.adjust(0);
          assert.strictEqual(press.pollUnsafe() === undefined, true);
          yield* hold.release;
          yield* Fiber.join(press);
          yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "working");
        }).pipe(Effect.provide(TestClock.layer()));
      }),
  ]),
);

it.live(
  "A press held by copy recovery waits for that recovery's receipt before the copy is used.",
  () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.deploy("started");
        yield* world.snapshotWhere((frame) => frame.crewmates[0]?.lane?.state === "frozen");
        const hold = yield* world.hold({ step: "recover" });
        yield* world.deploy("finished");
        yield* hold.reached;
        const service = yield* world.service;
        yield* Effect.gen(function* () {
          const press = yield* service
            .command(
              {
                _tag: "message",
                handle: "backend",
                text: "Work",
                attachments: [],
              },
              KAREL,
            )
            .pipe(Effect.forkChild({ startImmediately: true }));
          yield* TestClock.adjust(120_001);
          assert.isUndefined(press.pollUnsafe(), "the press must still await the recovery receipt");
          yield* hold.release;
          assert.deepStrictEqual(yield* Fiber.join(press), { _tag: "done" });
          yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "working");
          assert.strictEqual((yield* turnsSent(world)).length, 1);
        }).pipe(Effect.provide(TestClock.layer()));
      }),
    ),
);

it.live(
  "Discard does not report completed preservation while the task's keep effect is pending.",
  () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* readyTask(world);
        const [task] = yield* world.tasks;
        const copy = NodePath.join(world.root, ".crew/backend");
        write(copy, "kept.txt", "preserve me\n");
        const hold = yield* world.hold({ step: "keep" });
        const service = yield* world.service;
        yield* Effect.gen(function* () {
          const discard = yield* service
            .command({ _tag: "discard", taskId: task!.id }, KAREL)
            .pipe(Effect.forkChild({ startImmediately: true }));
          yield* hold.reached;
          yield* TestClock.adjust(30_001);
          assert.isUndefined(discard.pollUnsafe(), "discard must still await the keep receipt");
          assert.strictEqual((yield* world.tasks)[0]!.state, "ready");
          yield* hold.release;
          assert.deepStrictEqual(yield* Fiber.join(discard), { _tag: "done" });
          yield* world.snapshotWhere((frame) => frame.board.tasks[0]?.state === "discarded");
          const kept = git(world.root, ["for-each-ref", "--format=%(refname)", "refs/t3/crew/"])
            .split("\n")
            .filter((ref) => !ref.startsWith("refs/t3/crew/landing/"));
          assert.strictEqual(kept.length, 1);
          assert.strictEqual(git(world.root, ["show", `${kept[0]}:kept.txt`]), "preserve me");
        }).pipe(Effect.provide(TestClock.layer()));
      }),
    ),
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
        yield* world.settled;
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
