// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import {
  type CrewCommandError,
  ProviderInstanceId,
  ThreadId as ThreadIdSchema,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { MateLogin } from "../ZeropsLogins.ts";
import { ServerCommandReadiness } from "../../spi/serverCommandReadiness.ts";
import { ThreadToolPolicyRegistry } from "../../spi/threadToolPolicy.ts";
import { CrewEngine } from "./CrewEngine.ts";
import { CREW_ID } from "./CrewHome.ts";
import { CrewThreadDirectory, CrewToolHost } from "./crewSeams.ts";
import { CrewStore } from "./CrewStore.ts";
import { installCrewThreadPolicy } from "./CrewThreadPolicy.ts";
import {
  eventually,
  loginReconciled,
  drained,
  booted,
  runningPersonThread,
  spiEvent,
  withCrewEngine,
  withCrewEngines,
  writeCrewHome,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import {
  AS_CREW,
  commandWhenFree,
  KAREL,
  applied,
  command,
  dispatchedOf,
  everyCopyReady,
  firstTurn,
  latest,
  reportDone,
  seamsOf,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { TEST_HOST, git, read, write } from "./testing/crewGitFixture.ts";

const mateLogin = (id: string, agent: "claude-code" | "codex", label: string): MateLogin => ({
  id,
  agent,
  kind: "subscription",
  label,
  home: `/home/zerops/.mate/logins/${id}`,
  keyStored: false,
});

describe("CrewEngine", () => {
  it.live("with no crew applied: status none, no policy installed", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const snapshot = yield* latest;
        assert.deepStrictEqual(
          [snapshot.status, snapshot.crew, yield* Ref.get(world.installs)],
          ["none", null, 0],
        );
        const error = yield* Effect.flip(
          command({ _tag: "message", handle: "backend", text: "hi", attachments: [] }),
        );
        assert.strictEqual(error.reason, "no-crew");
      }),
    ),
  );

  it.live("Apply makes each writer's copy, installs the policies once and shows the crew", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        // The first conversation opens once the copy is ready.
        const snapshot = yield* snapshotWhere(
          (current) => current.crewmates[0]!.promptVersions.running !== null,
        );
        const backend = snapshot.crewmates[0]!;
        assert.deepStrictEqual(
          {
            status: snapshot.status,
            crew: snapshot.crew?.name,
            handle: backend.handle,
            lane: backend.lane?.state,
            branch: git(world.root, ["rev-parse", "--abbrev-ref", "crew/backend"]),
            copy: NodeFS.existsSync(NodePath.join(world.root, ".crew/backend/README.md")),
            installs: yield* Ref.get(world.installs),
            versions: backend.promptVersions,
          },
          {
            status: "applied",
            crew: "Game team",
            handle: "backend",
            lane: "ready",
            branch: "crew/backend",
            copy: true,
            installs: 1,
            versions: { running: { brief: 1, job: 1 }, current: { brief: 1, job: 1 } },
          },
        );
      }),
    ),
  );

  it.live(
    "a message to an idle crewmate opens one implicit task and a stint; a second steers it",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({
            _tag: "message",
            handle: "backend",
            text: "Add pagination to /api/items\nCursor based.",
            attachments: [],
          });
          const created = yield* dispatchedOf(world, "thread.crew.create");
          const resume = yield* dispatchedOf(world, "thread.usage-auto-resume.set");
          const turns = yield* dispatchedOf(world, "thread.turn.start");
          assert.deepStrictEqual(
            {
              runtimeMode: created[0]?.runtimeMode,
              crew: created[0]?.crew,
              autoResume: resume.map((entry) => [entry.threadId, entry.enabled]),
              turnThread: turns[0]?.threadId,
              card: turns[0]?.message.text.split("\n").slice(0, 2),
              instance: turns[0]?.modelSelection?.instanceId,
              turnMode: turns[0]?.runtimeMode,
            },
            {
              runtimeMode: "approval-required",
              crew: { crew: "main", crewmate: "backend", stint: 1 },
              autoResume: [[created[0]!.threadId, false]],
              turnThread: created[0]!.threadId,
              card: ["[Crew task card]", "#1 Add pagination to /api/items · from your message"],
              instance: "claudeAgent",
              turnMode: "approval-required",
            },
          );
          yield* world.publish(spiEvent("turn.started", created[0]!.threadId, {}));
          const member = Option.getOrThrow(
            yield* (yield* CrewThreadDirectory).memberFor(created[0]!.threadId),
          );
          const transcript = NodePath.join(world.workspace, "session-1.jsonl");
          NodeFS.writeFileSync(transcript, "{}\n");
          const packet = yield* (yield* CrewToolHost).sessionStart(member, {
            source: "startup",
            sessionId: "session-1",
            transcriptPath: transcript,
          });
          assert.isTrue(packet?.startsWith("crew-state seq"));
          yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.stints[0]?.state === "active");
          yield* command({
            _tag: "message",
            handle: "backend",
            text: "Also sort them.",
            attachments: [],
          });
          const snapshot = yield* snapshotWhere((current) => current.board.tasks.length === 1);
          assert.deepStrictEqual(
            {
              tasks: snapshot.board.tasks.map((task) => [
                task.number,
                task.title,
                task.state,
                task.source,
              ]),
              open: snapshot.crewmates[0]!.openTaskId === snapshot.board.tasks[0]!.id,
              turns: (yield* dispatchedOf(world, "thread.turn.start")).map(
                (turn) => turn.message.text.split("\n")[0],
              ),
              principals: (yield* Ref.get(world.admitted)).map((entry) => entry.principal),
            },
            {
              tasks: [[1, "Add pagination to /api/items", "working", "message"]],
              open: true,
              turns: ["[Crew task card]", "Also sort them."],
              principals: [KAREL, KAREL, KAREL],
            },
          );
        }),
      ),
  );

  it.live(
    "turn end commits the copy's work; a done report merges in, checks and waits for Land",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({
            _tag: "message",
            handle: "backend",
            text: "Write ok.txt",
            attachments: [],
          });
          const [created] = yield* dispatchedOf(world, "thread.crew.create");
          const thread = created!.threadId;
          yield* world.publish(spiEvent("turn.started", thread, {}));
          write(world.root, ".crew/backend/ok.txt", "ok\n");
          const directory = yield* CrewThreadDirectory;
          const host = yield* CrewToolHost;
          const member = Option.getOrThrow(yield* directory.memberFor(thread));
          const answer = yield* host.report(member, { status: "done", summary: "Wrote ok.txt." });
          assert.isFalse(answer.isError);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const ready = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "ready",
          );
          assert.deepStrictEqual(
            {
              wip: git(world.root, ["log", "-1", "--format=%s", "crew/backend"]).startsWith("wip("),
              check: ready.board.tasks[0]!.check?.state,
              attention: ready.attention.map((row) => row.kind),
              report: ready.board.tasks[0]!.report,
            },
            { wip: true, check: "passed", attention: ["ready-to-land"], report: "Wrote ok.txt." },
          );
          yield* Ref.set(world.threads, [runningPersonThread()]);
          const waits = yield* Effect.flip(
            command({ _tag: "land", taskId: ready.board.tasks[0]!.id }),
          );
          assert.strictEqual(waits.reason, "wrong-state");
          yield* Ref.set(world.threads, []);
          yield* command({ _tag: "land", taskId: ready.board.tasks[0]!.id });
          const landed = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "landed",
          );
          const message = git(world.root, ["log", "-1", "--format=%B", "HEAD"]);
          assert.deepStrictEqual(
            {
              file: read(world.root, "ok.txt"),
              trailers:
                message.includes("Crew-Lane: backend") &&
                message.includes(`Crew-Assignment: ${landed.board.tasks[0]!.id}`),
              landedCommit:
                landed.board.tasks[0]!.landedCommit === git(world.root, ["rev-parse", "HEAD"]),
              notDelivered: landed.landedNotDelivered,
            },
            { file: "ok\n", trailers: true, landedCommit: true, notDelivered: 1 },
          );
        }),
      ),
  );

  it.live("a task for a busy crewmate queues and starts as its creator when the first lands", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* command({ _tag: "message", handle: "backend", text: "First", attachments: [] });
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Second",
          brief: "Do the second thing.",
          doneWhen: "",
          dependsOn: [],
        });
        const queued = yield* snapshotWhere((snapshot) => snapshot.board.tasks.length === 2);
        assert.deepStrictEqual(
          queued.board.tasks.map((task) => [task.title, task.state]),
          [
            ["First", "working"],
            ["Second", "queued"],
          ],
        );
        const [stint] = yield* dispatchedOf(world, "thread.crew.create");
        yield* world.publish(spiEvent("turn.completed", stint!.threadId, { state: "completed" }));
        yield* command({ _tag: "discard", taskId: queued.board.tasks[0]!.id });
        yield* snapshotWhere((snapshot) => snapshot.board.tasks[1]?.state === "working");
        const admitted = yield* Ref.get(world.admitted);
        assert.deepStrictEqual(admitted.at(-1)?.principal, {
          kind: "crew",
          startedBy: "user-karel",
        });
      }),
    ),
  );

  /** A press while `backend`'s turn end commits in its copy: what it came to, and how soon. */
  const pressDuringTurnEnd = (
    world: Parameters<Parameters<typeof withCrewEngine>[0]>[0],
    press: (taskId: string) => Parameters<typeof command>[0],
  ) =>
    Effect.gen(function* () {
      const first = (yield* snapshotWhere((snapshot) => snapshot.board.tasks.length >= 1)).board
        .tasks[0]!.id;
      const stint = (yield* dispatchedOf(world, "thread.crew.create")).find(
        (entry) => entry.crew.crewmate === "backend",
      );
      const turnCommit = yield* world.holdSsh((script) => script.includes("): turn 1"));
      const ended = yield* Effect.forkChild(
        world.publish(spiEvent("turn.completed", stint!.threadId, { state: "completed" })),
      );
      yield* turnCommit.reached;
      const pressed = yield* Effect.forkChild(Effect.exit(command(press(first))));
      const atOnce = yield* Fiber.await(pressed).pipe(Effect.timeoutOption("300 millis"));
      yield* turnCommit.release;
      yield* Fiber.join(ended);
      yield* Fiber.join(pressed);
      return { first, atOnce };
    });

  /** The press came back before the turn's end, refused because its crewmate was busy. */
  const refusedAsBusy = (
    atOnce: Option.Option<Exit.Exit<Exit.Exit<unknown, CrewCommandError>>>,
  ) => {
    assert.isTrue(Option.isSome(atOnce), "the press hung on the turn's end");
    const outer = Option.getOrThrow(atOnce);
    assert.isTrue(Exit.isSuccess(outer), "the press died");
    const exit = (outer as Exit.Success<Exit.Exit<unknown, CrewCommandError>>).value;
    assert.isTrue(Exit.isFailure(exit), "the press was not refused");
    const error = Option.getOrThrow(Exit.findErrorOption(exit));
    assert.include(error.detail ?? "", "busy");
  };

  it.live("a discard pressed while its crewmate's turn end is handled is refused at once", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* command({ _tag: "message", handle: "backend", text: "First", attachments: [] });
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Second",
          brief: "Do the second thing.",
          doneWhen: "",
          dependsOn: [],
        });
        yield* snapshotWhere((snapshot) => snapshot.board.tasks.length === 2);
        const { first, atOnce } = yield* pressDuringTurnEnd(world, (taskId) => ({
          _tag: "discard",
          taskId,
        }));
        refusedAsBusy(atOnce);
        // Once the turn has ended, the same press goes through and the queue moves.
        yield* command({ _tag: "discard", taskId: first });
        yield* snapshotWhere(
          (snapshot) =>
            snapshot.board.tasks[0]?.state === "discarded" &&
            snapshot.board.tasks[1]?.state === "working",
        );
      }),
    ),
  );

  const pressesDuringTurnEnd: ReadonlyArray<{
    readonly name: string;
    readonly press: (taskId: string) => Parameters<typeof command>[0];
  }> = [
    {
      name: "a message to the crewmate",
      press: () => ({ _tag: "message", handle: "backend", text: "More", attachments: [] }),
    },
    {
      name: "Tell the crew naming the crewmate",
      press: () => ({ _tag: "tell", text: "@backend more", mentions: [{ handle: "backend" }] }),
    },
    { name: "Land now", press: (taskId) => ({ _tag: "landNow", taskId }) },
    { name: "Try again", press: (taskId) => ({ _tag: "taskRetry", taskId }) },
    {
      name: "a new task for the crewmate",
      press: () => ({
        _tag: "taskCreate",
        owner: "backend",
        title: "Next",
        brief: "Then this.",
        doneWhen: "",
        dependsOn: [],
      }),
    },
  ];

  it.live.each(
    Array.from(pressesDuringTurnEnd, ({ name, press }) => ({
      title: `${name} pressed while its crewmate's turn end is handled is refused at once`,
      press,
    })),
  )("$title", ({ press }) =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* command({ _tag: "message", handle: "backend", text: "First", attachments: [] });
        const { atOnce } = yield* pressDuringTurnEnd(world, press);
        refusedAsBusy(atOnce);
      }),
    ),
  );

  /** `backend` reported done; its check after the turn end is held. */
  const holdTheCheck = (world: Parameters<Parameters<typeof withCrewEngine>[0]>[0]) =>
    Effect.gen(function* () {
      yield* applied(world);
      const thread = yield* firstTurn(world, () => undefined);
      yield* reportDone(thread);
      const check = yield* world.holdSsh((script) => script.includes("test -f ok.txt"));
      yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
      yield* check.reached;
      // The board as the engine has rebuilt it, never a snapshot from before the turn end.
      const taskId = (yield* snapshotWhere(
        (snapshot) => snapshot.board.tasks[0]?.state === "checking",
      )).board.tasks[0]!.id;
      return { thread, check, taskId };
    });

  const quick = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.exit(effect).pipe(Effect.timeoutOption("300 millis"));

  it.live("a discard while the check runs is refused as busy, and the check is not undone", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const { check, taskId } = yield* holdTheCheck(world);
        const pressed = yield* quick(command({ _tag: "discard", taskId }));
        refusedAsBusy(Option.map(pressed, (exit) => Exit.succeed(exit)));
        yield* check.release;
        // No ok.txt: the check fails, and the task goes back for rework — never discarded.
        yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "rework");
      }),
    ),
  );

  it.live(
    "a message during the check goes on at once; a turn that reports before the check ends is integrated after it",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          const { thread, check } = yield* holdTheCheck(world);
          const messaged = yield* quick(
            command({ _tag: "message", handle: "backend", text: "More", attachments: [] }),
          );
          assert.isTrue(
            Option.isSome(messaged) && Exit.isSuccess(Option.getOrThrow(messaged)),
            "the message did not go through at once",
          );
          yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "working");
          // Its turn reports done and ends while the first check still runs.
          yield* world.publish(spiEvent("turn.started", thread, {}));
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          yield* check.release;
          // Never stuck in merging: integrated again once the check ended.
          yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "rework");
        }),
      ),
  );

  it.live("Tell the crew to a busy crewmate is refused and creates nothing", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        writeCrewHome(world.workspace, {
          "crew.yaml": [
            "name: Game team",
            "briefTitle: Space shooter",
            "members:",
            "  - handle: backend",
            "    displayName: Backend",
            "    host: appdev",
            "  - handle: erik",
            "    displayName: Erik",
            "    kind: reader",
            "",
          ].join("\n"),
          "jobs/erik.md": "You write the plan.\n",
        });
        yield* command({ _tag: "apply" });
        yield* snapshotWhere(everyCopyReady);
        yield* command({ _tag: "message", handle: "backend", text: "First", attachments: [] });
        const { atOnce } = yield* pressDuringTurnEnd(world, () => ({
          _tag: "tell",
          text: "@backend adds the API, @erik reviews the plan.",
          mentions: [{ handle: "backend" }, { handle: "erik" }],
        }));
        refusedAsBusy(atOnce);
        // Read from the tables, not a snapshot that may not have caught up.
        assert.strictEqual(
          (yield* (yield* CrewStore).assignments(CREW_ID)).length,
          1,
          "a busy Tell made tasks",
        );
      }),
    ),
  );

  const RUN_NOW = {
    _tag: "start",
    budgetUsd: "unlimited",
    timeLimitHours: "unlimited",
    stopAtUsagePercent: null,
    landing: "person",
    devGrant: false,
    leadMayStart: false,
  } as const;

  /** `backend`'s first task, its turn ended without a report: working, no turn running. */
  const turnEndedWorking = (world: Parameters<Parameters<typeof withCrewEngine>[0]>[0]) =>
    Effect.gen(function* () {
      yield* applied(world);
      const thread = yield* firstTurn(world, () => undefined);
      yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
      const taskId = (yield* snapshotWhere(
        (snapshot) => snapshot.board.tasks[0]?.state === "working",
      )).board.tasks[0]!.id;
      return { thread, taskId };
    });

  const stuckStates: ReadonlyArray<"merging" | "checking"> = ["merging", "checking"];
  it.live.each(
    Array.from(stuckStates, (state) => ({
      title: `a task left ${state} with nothing running on it can be discarded`,
      state,
    })),
  )("$title", ({ state }) =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const { taskId } = yield* turnEndedWorking(world);
        // A redeploy held its merge, or its check errored: nothing runs on it now.
        const store = yield* CrewStore;
        const row = (yield* store.assignments(CREW_ID)).find((task) => task.assignment === taskId)!;
        yield* store.putAssignment({ ...row, state });
        yield* command({ _tag: "discard", taskId });
        yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "discarded");
      }),
    ),
  );

  it.live("a message during a Land now's check goes through", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const { taskId } = yield* turnEndedWorking(world);
        const check = yield* world.holdSsh((script) => script.includes("test -f ok.txt"));
        const landing = yield* Effect.forkChild(Effect.exit(command({ _tag: "landNow", taskId })));
        yield* check.reached;
        const messaged = yield* quick(
          command({ _tag: "message", handle: "backend", text: "More", attachments: [] }),
        );
        yield* check.release;
        yield* Fiber.join(landing);
        assert.isTrue(
          Option.isSome(messaged) && Exit.isSuccess(Option.getOrThrow(messaged)),
          "the message waited on, or was refused by, the Land's check",
        );
      }),
    ),
  );

  it.live("a Land now while the task's integration still runs lands once that one ends", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const { thread, check, taskId } = yield* holdTheCheck(world);
        // Back to work during the check, and its turn ends with no report.
        yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        yield* world.publish(spiEvent("turn.started", thread, {}));
        write(world.root, ".crew/backend/ok.txt", "ok\n");
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* command({ _tag: "landNow", taskId });
        yield* check.release;
        yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "landed");
      }),
    ),
  );

  it.live("Start during a turn end waits for the copy, then carries the task on once", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        const turnCommit = yield* world.holdSsh((script) => script.includes("): turn 1"));
        const ended = yield* Effect.forkChild(
          world.publish(spiEvent("turn.completed", thread, { state: "completed" })),
        );
        yield* turnCommit.reached;
        const turnsBefore = (yield* dispatchedOf(world, "thread.turn.start")).length;
        const started = yield* quick(command(RUN_NOW));
        assert.isTrue(Option.isSome(started), "Start waited on the turn end");
        assert.strictEqual(
          (yield* dispatchedOf(world, "thread.turn.start")).length,
          turnsBefore,
          "a turn went to the crewmate while its copy was being committed",
        );
        yield* turnCommit.release;
        yield* Fiber.join(ended);
        // The advance Start skipped runs once the copy is free: one carry-on, not two.
        yield* eventually(
          Effect.map(
            dispatchedOf(world, "thread.turn.start"),
            (turns) => turns.length === turnsBefore + 1,
          ),
        );
        yield* drained;
        assert.strictEqual(
          (yield* dispatchedOf(world, "thread.turn.start")).length,
          turnsBefore + 1,
        );
      }),
    ),
  );

  it.live("a discard whose copy cannot be reset leaves its task as it was", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(NodePath.join(world.root, ".crew/backend"), "a.txt", "changed\n"),
        );
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Second",
          brief: "Do the second thing.",
          doneWhen: "",
          dependsOn: [],
        });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.ahead === 1);
        const lock = NodePath.join(world.root, ".git/worktrees/backend/index.lock");
        NodeFS.writeFileSync(lock, "");
        const first = (yield* snapshotWhere((snapshot) => snapshot.board.tasks.length === 2)).board
          .tasks[0]!.id;
        const refused = yield* Effect.flip(command({ _tag: "discard", taskId: first }));
        assert.strictEqual(refused.reason, "io");
        NodeFS.rmSync(lock);
        // Pressed again it discards: the refused press left the task open.
        yield* command({ _tag: "discard", taskId: first });
        yield* snapshotWhere(
          (snapshot) =>
            snapshot.board.tasks[0]?.state === "discarded" &&
            snapshot.board.tasks[1]?.state === "working",
        );
      }),
    ),
  );

  it.live("a queued task admission refuses stays queued with a Can't start row", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* Ref.set(world.refusal, "not the login's signer");
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Refused",
          brief: "Try it.",
          doneWhen: "",
          dependsOn: [],
        });
        const snapshot = yield* snapshotWhere((current) => current.attention.length === 1);
        assert.deepStrictEqual(
          [snapshot.board.tasks[0]?.state, snapshot.attention.map((row) => [row.kind, row.text])],
          ["queued", [["cant-start", "not the login's signer"]]],
        );
        yield* Ref.set(world.refusal, undefined);
        yield* command({ _tag: "taskRetry", taskId: snapshot.board.tasks[0]!.id });
        const started = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          [started.attention, (yield* Ref.get(world.admitted)).at(-1)?.principal],
          [[], KAREL],
        );
      }),
    ),
  );

  it.live("Try again is only for a queued task admission refused", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* firstTurn(world, () => undefined);
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Behind",
          brief: "Later.",
          doneWhen: "",
          dependsOn: [],
        });
        const queued = yield* snapshotWhere((current) => current.board.tasks.length === 2);
        const refused = yield* Effect.flip(
          command({ _tag: "taskRetry", taskId: queued.board.tasks[1]!.id }),
        );
        assert.strictEqual(refused.reason, "wrong-state");
      }),
    ),
  );

  it.live("a refused queued task waits through another login's sign-in", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* Ref.set(world.refusal, "not the login's signer");
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Refused",
          brief: "Try it.",
          doneWhen: "",
          dependsOn: [],
        });
        yield* snapshotWhere((current) => current.attention.length === 1);
        const tries = (yield* Ref.get(world.admitted)).length;
        yield* loginReconciled(world.signedInAs("codex"));
        yield* loginReconciled(world.extraSignedIn("work"));
        yield* drained;
        assert.deepStrictEqual(
          [(yield* Ref.get(world.admitted)).length, (yield* latest).board.tasks[0]!.state],
          [tries, "queued"],
        );
      }),
    ),
  );

  it.live("a refused queued task starts again once a login's sign-in changes", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* Ref.set(world.refusal, "not the login's signer");
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Refused",
          brief: "Try it.",
          doneWhen: "",
          dependsOn: [],
        });
        yield* snapshotWhere((current) => current.attention.length === 1);
        yield* Ref.set(world.refusal, undefined);
        yield* world.signedIn;
        const started = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          [started.attention, (yield* Ref.get(world.admitted)).at(-1)?.principal],
          [[], AS_CREW],
        );
      }),
    ),
  );

  it.live("Tell the crew: one mention a task, none refused", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        writeCrewHome(world.workspace, {
          "crew.yaml": [
            "name: Game team",
            "briefTitle: Space shooter",
            "members:",
            "  - handle: backend",
            "    displayName: Backend",
            "    host: appdev",
            "  - handle: erik",
            "    displayName: Erik",
            "    kind: reader",
            "",
          ].join("\n"),
          "jobs/erik.md": "You write the plan.\n",
        });
        yield* command({ _tag: "apply" });
        yield* snapshotWhere(everyCopyReady);
        const none = yield* Effect.flip(
          command({ _tag: "tell", text: "Everyone, go.", mentions: [] }),
        );
        yield* command({
          _tag: "tell",
          text: "@backend adds the API, @erik reviews the plan.",
          mentions: [{ handle: "backend" }, { handle: "erik" }],
        });
        const snapshot = yield* snapshotWhere((current) => current.board.tasks.length === 2);
        assert.deepStrictEqual(
          {
            none: none.reason,
            tasks: snapshot.board.tasks.map((task) => [task.owner, task.title, task.state]),
          },
          {
            none: "no-mention",
            tasks: [
              ["backend", "@backend adds the API", "working"],
              ["erik", "@erik reviews the plan", "working"],
            ],
          },
        );
        const cards = (yield* dispatchedOf(world, "thread.turn.start")).map(
          (turn) => turn.message.text,
        );
        assert.isTrue(cards.every((card) => card.includes("Also sent to")));
      }),
    ),
  );

  it.live("a job saved for the next turn rotates the stint before that turn", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
        const [first] = yield* dispatchedOf(world, "thread.crew.create");
        yield* world.publish(spiEvent("turn.completed", first!.threadId, { state: "completed" }));
        writeCrewHome(world.workspace, {
          "jobs/backend.md": "You own the server and its tests.\n",
        });
        yield* command({ _tag: "jobSave", handle: "backend", apply: "nextTurn" });
        const pending = (yield* snapshotWhere((current) => current.crewmates[0]!.jobVersion === 2))
          .crewmates[0]!.promptVersions;
        yield* command({ _tag: "message", handle: "backend", text: "Go on", attachments: [] });
        const creates = yield* dispatchedOf(world, "thread.crew.create");
        const snapshot = yield* snapshotWhere(
          (current) => current.crewmates[0]!.stints.length === 2,
        );
        assert.deepStrictEqual(
          {
            pending,
            archived: (yield* dispatchedOf(world, "thread.archive")).map((entry) => entry.threadId),
            stopped: (yield* dispatchedOf(world, "thread.session.stop")).map(
              (entry) => entry.threadId,
            ),
            stints: creates.map((entry) => entry.crew.stint),
            reason: snapshot.crewmates[0]!.stints.map((stint) => [stint.state, stint.reason]),
            running: snapshot.crewmates[0]!.promptVersions.running,
            carried: (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!.message.text,
            seams: yield* seamsOf(world),
          },
          {
            pending: { running: { brief: 1, job: 1 }, current: { brief: 1, job: 2 } },
            archived: [first!.threadId],
            stopped: [first!.threadId],
            stints: [1, 2],
            reason: [
              ["retired", null],
              ["open", "Its job changed"],
            ],
            running: { brief: 1, job: 2 },
            carried: [
              "[Crew task card]",
              "#1 Start · continues",
              "Its job changed",
              "",
              "Go on",
            ].join("\n"),
            seams: [
              [
                first!.threadId,
                "Its job changed — from its next message",
                { seam: "saved", apply: "nextTurn" },
              ],
            ],
          },
        );
      }),
    ),
  );

  it.live("a message to a crewmate that asked a question answers its open task", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
        yield* (yield* CrewToolHost).report(member, {
          status: "blocked",
          summary: "Which currency?",
          question: "CZK or EUR?",
        });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "blocked");
        yield* command({ _tag: "message", handle: "backend", text: "EUR", attachments: [] });
        const answered = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        const turns = yield* dispatchedOf(world, "thread.turn.start");
        assert.deepStrictEqual(
          [
            answered.board.tasks.map((task) => [task.number, task.state]),
            turns.at(-1)?.threadId,
            turns.at(-1)?.message.text,
          ],
          [[[1, "working"]], thread, "EUR"],
        );
      }),
    ),
  );

  it.live("refs the engine writes mid-turn never park the lane; a foreign one does", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          git(world.root, ["update-ref", "refs/t3/crew-state/main", "HEAD"]),
        );
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const [task] = yield* Effect.flatMap(CrewStore, (store) => store.assignments(CREW_ID));
        assert.strictEqual(task?.state, "working");
        yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        git(world.root, ["update-ref", "refs/heads/crewmate-made-this", "HEAD"]);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const parked = yield* snapshotWhere(
          (snapshot) => snapshot.board.tasks[0]?.state === "parked",
        );
        assert.strictEqual(
          parked.board.tasks[0]!.reason,
          "a ref changed outside the engine: refs/heads/crewmate-made-this",
        );
      }),
    ),
  );

  it.live(
    "a merge-in conflict goes back naming the files; Ask to resolve sends one turn as you",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          write(world.root, "a.txt", "base\n");
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "a.txt"]);
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/a.txt", "crew\n"),
          );
          write(world.root, "a.txt", "person\n");
          git(world.root, ["commit", "-q", "-am", "person edits a.txt"]);
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const rework = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "rework",
          );
          assert.deepStrictEqual(
            {
              reason: rework.board.tasks[0]!.reason,
              attention: rework.attention.map((row) => [row.kind, row.paths]),
              lane: rework.crewmates[0]!.lane?.state,
            },
            {
              reason: "conflicts with what landed",
              attention: [["conflict", ["a.txt"]]],
              lane: "conflicts",
            },
          );
          yield* command({ _tag: "askResolve", taskId: rework.board.tasks[0]!.id });
          const turns = yield* dispatchedOf(world, "thread.turn.start");
          const resolving = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "working",
          );
          assert.deepStrictEqual(
            {
              card: turns.at(-1)!.message.text.split("\n").slice(1, 3),
              attempts: resolving.board.tasks[0]!.attempts,
              principal: (yield* Ref.get(world.admitted)).at(-1)?.principal,
            },
            {
              card: [
                "#1 Change a.txt · resolve the conflicts",
                "Merging your tree's head into your copy stopped on conflicts in:",
              ],
              attempts: 2,
              principal: KAREL,
            },
          );
        }),
      ),
  );

  it.live(
    "Land now on a crewmate that never reported: WIP, merge-in, check and land; its chat shows the landing",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const working = yield* snapshotWhere(
            (snapshot) => snapshot.crewmates[0]!.lane?.ahead === 1,
          );
          const task = working.board.tasks[0]!;
          yield* command({ _tag: "landNow", taskId: task.id });
          const landed = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "landed",
          );
          const commit = landed.board.tasks[0]!.landedCommit!;
          assert.deepStrictEqual(
            [read(world.root, "ok.txt"), yield* seamsOf(world)],
            [
              "ok\n",
              [
                [
                  thread,
                  `Task #1 landed as ${commit.slice(0, 7)}`,
                  { seam: "landed", taskId: task.id, number: 1, commit },
                ],
              ],
            ],
          );
        }),
      ),
  );

  it.live(
    "a failed check goes back as rework; a landing refused by your edit waits on your tree",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/b.txt", "crew\n"),
          );
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const failed = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "rework",
          );
          assert.deepStrictEqual(
            [failed.board.tasks[0]!.check?.state, failed.attention.map((row) => row.kind)],
            ["failed", ["check-failed"]],
          );
          yield* command({ _tag: "askFix", taskId: failed.board.tasks[0]!.id });
          write(world.root, ".crew/backend/ok.txt", "ok\n");
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const ready = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "ready",
          );
          write(world.root, "b.txt", "the person's own edit\n");
          yield* command({ _tag: "land", taskId: ready.board.tasks[0]!.id });
          const waiting = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "waiting-on-you",
          );
          assert.deepStrictEqual(
            [
              waiting.board.tasks[0]!.waitingOn,
              waiting.attention.map((row) => [row.kind, row.paths]),
            ],
            [["b.txt"], [["landing-wait", ["b.txt"]]]],
          );
        }),
      ),
  );

  it.live("Land now takes a task back from rework as its copy stands", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/b.txt", "crew\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const failed = yield* snapshotWhere(
          (snapshot) => snapshot.board.tasks[0]?.state === "rework",
        );
        write(world.root, ".crew/backend/ok.txt", "ok\n");
        yield* command({ _tag: "landNow", taskId: failed.board.tasks[0]!.id });
        yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "landed");
        assert.deepStrictEqual(
          [read(world.root, "b.txt"), read(world.root, "ok.txt")],
          ["crew\n", "ok\n"],
        );
      }),
    ),
  );

  it.live.each([
    // Claude and Codex open a call with item.started; the ACP agents only update it.
    { opens: "item.started" },
    { opens: "item.updated" },
  ] as const)(
    "a self-deploy onto the service freezes its copies and interrupts their turns ($opens)",
    ({ opens }) =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* world.publish(
            spiEvent(
              opens,
              "person-thread",
              { itemType: "mcp_tool_call", status: "inProgress" } as never,
              {
                itemId: "deploy-1",
                toolCall: {
                  name: "zerops_deploy",
                  rawName: "mcp__zerops__zerops_deploy",
                  server: "zerops",
                  arguments: { targetService: "appdev" },
                },
              } as never,
            ),
          );
          const frozen = yield* snapshotWhere(
            (snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen",
          );
          const interrupts = yield* dispatchedOf(world, "thread.turn.interrupt");
          assert.deepStrictEqual(
            [frozen.crewmates[0]!.lane?.state, interrupts.map((entry) => entry.threadId)],
            ["frozen", [thread]],
          );
        }),
      ),
  );

  const deployEvent = (type: "item.started" | "item.completed") =>
    spiEvent(
      type,
      "person-thread",
      {
        itemType: "mcp_tool_call",
        status: type === "item.started" ? "inProgress" : "completed",
      } as never,
      {
        itemId: "deploy-1",
        toolCall: {
          name: "zerops_deploy",
          rawName: "mcp__zerops__zerops_deploy",
          server: "zerops",
          arguments: { targetService: "appdev" },
        },
      } as never,
    );

  it.live("a self-deploy that lost a copy's branch unfreezes the service and names the loss", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.publish(deployEvent("item.started"));
        yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        NodeFS.rmSync(NodePath.join(world.root, ".crew/backend"), { recursive: true });
        git(world.root, ["worktree", "prune"]);
        git(world.root, ["branch", "-D", "-q", "crew/backend"]);
        yield* world.publish(deployEvent("item.completed"));
        const after = yield* snapshotWhere(
          (snapshot) => snapshot.lastError?.includes("crew/backend") === true,
        );
        const lane = yield* (yield* CrewStore).getLane(CREW_ID, "backend");
        assert.deepStrictEqual(
          [after.crewmates[0]!.lane?.state === "frozen", Option.getOrThrow(lane).frozenSince],
          [false, null],
        );
      }),
    ),
  );

  it.live("a restart during a self-deploy does not leave the service frozen", () =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.publish(deployEvent("item.started"));
          yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        }),
      (world) =>
        Effect.gen(function* () {
          yield* (yield* ServerCommandReadiness).complete;
          yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "ready");
          yield* commandWhenFree({
            _tag: "message",
            handle: "backend",
            text: "Work",
            attachments: [],
          });
          yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "working");
          assert.strictEqual((yield* dispatchedOf(world, "thread.turn.start")).length, 1);
        }),
    ]),
  );

  it.live.each(
    Array.from(
      [
        [
          "still runs",
          [{ serviceStacks: [{ name: "appdev" }], status: "RUNNING" }],
          "still redeploying",
        ],
        ["cannot be read", "unreadable", "could not read"],
      ] as const,
      ([state, processes, words]) => ({
        title: `a restart keeps a service frozen while its deploy ${state}, and thaws it at its end`,
        processes,
        words,
      }),
    ),
  )("$title", ({ processes, words }) =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.publish(deployEvent("item.started"));
          yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        }),
      (world) =>
        Effect.gen(function* () {
          yield* Ref.set(world.processes, processes);
          yield* (yield* ServerCommandReadiness).complete;
          const held = yield* snapshotWhere(
            (snapshot) => snapshot.lastError?.includes(words) === true,
          );
          assert.strictEqual(held.crewmates[0]!.lane?.state, "frozen");
          yield* Ref.set(world.processes, []);
          const thawed = yield* snapshotWhere(
            (snapshot) => snapshot.crewmates[0]!.lane?.state === "ready",
          );
          assert.isNull(thawed.lastError);
        }),
    ]),
  );

  it.live("a restart leaves a frozen host's interrupted work untouched until its deploy ends", () =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* firstTurn(world, () => write(world.root, ".crew/backend/a.txt", "work\n"));
          yield* world.publish(deployEvent("item.started"));
          yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        }),
      (world) =>
        Effect.gen(function* () {
          const copy = NodePath.join(world.root, ".crew/backend");
          yield* Ref.set(world.processes, [
            { serviceStacks: [{ name: "appdev" }], status: "RUNNING" },
          ]);
          yield* (yield* ServerCommandReadiness).complete;
          yield* snapshotWhere(
            (snapshot) => snapshot.lastError?.includes("still redeploying") === true,
          );
          yield* booted;
          const head = git(copy, ["rev-parse", "HEAD"]);
          assert.deepStrictEqual(
            [
              (yield* dispatchedOf(world, "thread.turn.start")).length,
              git(copy, ["status", "--porcelain"]),
            ],
            [1, "?? a.txt"],
          );
          yield* Ref.set(world.processes, []);
          yield* eventually(
            Effect.map(dispatchedOf(world, "thread.turn.start"), (turns) => turns.length === 2),
          );
          assert.notStrictEqual(git(copy, ["rev-parse", "HEAD"]), head);
        }),
    ]),
  );

  it.live("an unreadable redeploy is asked less and less, then offered to the person to thaw", () =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.publish(deployEvent("item.started"));
          yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        }),
      (world) =>
        Effect.gen(function* () {
          yield* Ref.set(world.processes, "unreadable");
          yield* (yield* ServerCommandReadiness).complete;
          const offered = yield* snapshotWhere((snapshot) =>
            snapshot.attention.some((need) => need.kind === "deploy-unreadable"),
          );
          // Asked at boot, then after 50, 100, 200, 200 ms: a handful, not one every tick.
          assert.isAtMost(yield* Ref.get(world.processReads), 8);
          const frames = yield* (yield* CrewEngine).snapshot.pipe(
            Stream.interruptWhen(Effect.sleep("700 millis")),
            Stream.runCount,
          );
          // Nothing moved meanwhile: the feed holds still, its current frame alone.
          assert.isAtMost(frames, 1);
          assert.strictEqual(
            offered.attention.find((need) => need.kind === "deploy-unreadable")!.host,
            TEST_HOST,
          );
          yield* command({ _tag: "thawHost", host: TEST_HOST });
          yield* snapshotWhere(
            (snapshot) =>
              snapshot.crewmates[0]!.lane?.state === "ready" &&
              !snapshot.attention.some((need) => need.kind === "deploy-unreadable"),
          );
          // Thawed, it stops asking.
          const after = yield* Ref.get(world.processReads);
          yield* drained;
          assert.strictEqual(yield* Ref.get(world.processReads), after);
        }),
    ]),
  );

  it.live(
    "a deploy's end recovers the copies before it thaws: a press meanwhile waits its turn",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.publish(deployEvent("item.started"));
          yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
          const hold = yield* world.holdSsh((script) => script.includes("worktree prune"));
          yield* world.publish(deployEvent("item.completed"));
          yield* hold.reached;
          const press = yield* command({
            _tag: "message",
            handle: "backend",
            text: "Work",
            attachments: [],
          }).pipe(Effect.forkChild({ startImmediately: true }));
          const lane = Option.getOrThrow(yield* (yield* CrewStore).getLane(CREW_ID, "backend"));
          assert.deepStrictEqual(
            [lane.frozenSince !== null, press.pollUnsafe() === undefined],
            [true, true],
          );
          yield* hold.release;
          yield* Fiber.join(press);
          yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "working");
        }),
      ),
  );

  it.live("a writer's conversation without its copy as its worktree gets it back at boot", () =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* eventually(
            Effect.map(dispatchedOf(world, "thread.crew.create"), (creates) => creates.length > 0),
          );
          const created = (yield* dispatchedOf(world, "thread.crew.create")).find(
            (entry) => entry.crew.crewmate === "backend",
          )!;
          yield* Ref.set(world.threads, [
            {
              ...runningPersonThread(),
              id: created.threadId,
              crew: created.crew,
              session: null,
              worktreePath: null,
            } as unknown as OrchestrationThreadShell,
          ]);
        }),
      (world) =>
        Effect.gen(function* () {
          yield* (yield* ServerCommandReadiness).complete;
          const created = (yield* dispatchedOf(world, "thread.crew.create")).find(
            (entry) => entry.crew.crewmate === "backend",
          )!;
          yield* eventually(
            Effect.map(dispatchedOf(world, "thread.meta.update"), (updates) => updates.length > 0),
          );
          const [update] = yield* dispatchedOf(world, "thread.meta.update");
          assert.deepStrictEqual(
            [
              update?.threadId,
              update?.worktreePath,
              created.worktreePath?.endsWith("/.crew/backend"),
            ],
            [created.threadId, created.worktreePath, true],
          );
        }),
    ]),
  );

  {
    const path = "/chosen/copy";
    it.live("boot keeps a conversation path a person chose and offers a selected crew copy", () =>
      withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            yield* command({ _tag: "message", handle: "backend", text: "Work", attachments: [] });
            const [created] = yield* dispatchedOf(world, "thread.crew.create");
            yield* Ref.set(world.threads, [
              {
                ...runningPersonThread(),
                id: created!.threadId,
                crew: created!.crew,
                session: null,
                latestTurn: null,
                worktreePath: path,
              } as unknown as OrchestrationThreadShell,
            ]);
          }),
        (world) =>
          Effect.gen(function* () {
            yield* (yield* ServerCommandReadiness).complete;
            const snapshot = yield* snapshotWhere((frame) =>
              frame.attention.some((row) => row.kind === "conversation-copy"),
            );
            assert.deepStrictEqual(yield* dispatchedOf(world, "thread.meta.update"), []);
            const need = snapshot.attention.find((row) => row.kind === "conversation-copy")!;
            const [created] = yield* dispatchedOf(world, "thread.crew.create");
            assert.deepStrictEqual(need.copyAssignment, {
              threadId: created!.threadId,
              currentPath: path,
              crewPath: created!.worktreePath!,
              source: "crew-stint",
            });
            // The restart's turn carries on first; the press waits for its copy to be free.
            yield* commandWhenFree({
              _tag: "useCrewCopy",
              handle: "backend",
              threadId: created!.threadId,
              expectedPath: path,
            });
            const [update] = yield* dispatchedOf(world, "thread.meta.update");
            assert.deepStrictEqual(
              [update?.worktreePath, update?.expectedWorktreePath],
              [created!.worktreePath, path],
            );
            yield* Ref.set(world.threads, [
              {
                ...runningPersonThread(),
                id: created!.threadId,
                crew: created!.crew,
                session: null,
                latestTurn: null,
                worktreePath: "/new/choice",
              } as unknown as OrchestrationThreadShell,
            ]);
            const error = yield* Effect.flip(
              command({
                _tag: "useCrewCopy",
                handle: "backend",
                threadId: created!.threadId,
                expectedPath: path,
              }),
            );
            assert.strictEqual(error.reason, "wrong-state");
            assert.strictEqual((yield* dispatchedOf(world, "thread.meta.update")).length, 1);
          }),
      ]),
    );
  }

  it.live(
    "after a restart: policies install at once, the resume waits for readiness, a died turn carries on",
    () => {
      let turnsBefore = 0;
      return withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            yield* command({
              _tag: "message",
              handle: "backend",
              text: "Long work",
              attachments: [],
            });
            const [created] = yield* dispatchedOf(world, "thread.crew.create");
            yield* Ref.set(world.threads, [
              { ...runningPersonThread(), id: created!.threadId, crew: created!.crew },
            ]);
            turnsBefore = (yield* dispatchedOf(world, "thread.turn.start")).length;
          }),
        (world) =>
          Effect.gen(function* () {
            assert.strictEqual(yield* Ref.get(world.installs), 2);
            assert.strictEqual(
              (yield* dispatchedOf(world, "thread.turn.start")).length,
              turnsBefore,
            );
            yield* (yield* ServerCommandReadiness).complete;
            yield* eventually(
              Effect.map(
                dispatchedOf(world, "thread.turn.start"),
                (turns) => turns.length === turnsBefore + 1,
              ),
            );
            // Its turn died: it carries on in the attempt it stood in, never a forced rework.
            const snapshot = yield* snapshotWhere(
              (current) =>
                current.board.tasks[0]?.attempts === 1 &&
                current.board.tasks[0]?.state === "working" &&
                current.attention.length === 0,
            );
            assert.deepStrictEqual(
              [
                (yield* dispatchedOf(world, "thread.turn.start")).length,
                (yield* Ref.get(world.admitted)).at(-1)?.principal,
                snapshot.lastError,
                snapshot.attention,
              ],
              [turnsBefore + 1, AS_CREW, null, []],
            );
            const resumed = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
            assert.include(resumed.message.text, "Continue where you stopped");
            const thread = snapshot.crewmates[0]!.currentThreadId!;
            const member = yield* (yield* CrewThreadDirectory).memberFor(thread);
            assert.isTrue(Option.getOrThrow(member).live);
          }),
      ]);
    },
  );

  it.live("a subscription reads the tables only: the feed opens no ssh", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* drained;
        const before = yield* Ref.get(world.sshCalls);
        const engine = yield* CrewEngine;
        const frames = yield* engine.snapshot.pipe(Stream.take(1), Stream.runCollect);
        assert.deepStrictEqual([frames.length, (yield* Ref.get(world.sshCalls)) - before], [1, 0]);
      }),
    ),
  );

  it.live("with no crew applied the engine opens no ssh at all", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const engine = yield* CrewEngine;
        yield* engine.snapshot.pipe(Stream.take(1), Stream.runCollect);
        yield* (yield* ServerCommandReadiness).complete;
        yield* drained;
        assert.strictEqual(yield* Ref.get(world.sshCalls), 0);
      }),
    ),
  );

  it.live(
    "Start fresh rotates between turns; Save and apply now interrupts, rotates and continues",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          const busy = yield* Effect.flip(command({ _tag: "startFresh", handle: "backend" }));
          writeCrewHome(world.workspace, { "brief.md": "Ship it by Friday.\n" });
          yield* command({ _tag: "briefSave", apply: "now" });
          const interrupts = (yield* dispatchedOf(world, "thread.turn.interrupt")).map(
            (entry) => entry.threadId,
          );
          yield* world.publish(spiEvent("turn.completed", thread, { state: "interrupted" }));
          yield* eventually(
            Effect.map(
              dispatchedOf(world, "thread.crew.create"),
              (creates) => creates.length === 2,
            ),
          );
          yield* eventually(
            Effect.map(dispatchedOf(world, "thread.turn.start"), (turns) =>
              turns.at(-1)!.message.text.includes("· continue"),
            ),
          );
          const continued = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
          const creates = yield* dispatchedOf(world, "thread.crew.create");
          yield* world.publish(
            spiEvent("turn.completed", continued.threadId, { state: "completed" }),
          );
          yield* eventually(
            command({ _tag: "startFresh", handle: "backend" }).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
          );
          const snapshot = yield* snapshotWhere(
            (current) => current.crewmates[0]!.stints.length === 3,
          );
          const fresh = (yield* dispatchedOf(world, "thread.crew.create")).at(-1)!;
          assert.deepStrictEqual(
            {
              seams: yield* seamsOf(world),
              busy: busy.reason,
              interrupts,
              continueIn: continued.threadId === creates[1]!.threadId,
              continueAs: (yield* Ref.get(world.admitted)).at(-1)?.principal,
              reasons: snapshot.crewmates[0]!.stints.map((stint) => stint.reason),
              brief: snapshot.crew?.briefVersion,
            },
            {
              seams: [
                [thread, "The crew's goal changed — from now on", { seam: "saved", apply: "now" }],
                [
                  fresh.threadId,
                  "You cleared its conversation",
                  { seam: "stint", previousThreadId: creates[1]!.threadId },
                ],
              ],
              busy: "wrong-state",
              interrupts: [thread],
              continueIn: true,
              continueAs: AS_CREW,
              reasons: [null, "The crew's goal changed", "You cleared its conversation"],
              brief: 2,
            },
          );
        }),
      ),
  );

  it.live("a changed login saves only as fresh; the section names it by its label", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* Ref.set(
          world.logins,
          new Map([["claudeAgent_work", mateLogin("claudeAgent_work", "claude-code", "work")]]),
        );
        writeCrewHome(world.workspace, {
          "crew.yaml": [
            "name: Game team",
            "briefTitle: Space shooter",
            "members:",
            "  - handle: backend",
            "    displayName: Backend",
            "    host: appdev",
            "    login: claudeAgent_work",
            "",
          ].join("\n"),
        });
        const refused = yield* Effect.flip(
          command({ _tag: "jobSave", handle: "backend", apply: "nextTurn" }),
        );
        yield* command({ _tag: "jobSave", handle: "backend", apply: "fresh" });
        const snapshot = yield* snapshotWhere(
          (current) => current.crewmates[0]!.login.id === "claudeAgent_work",
        );
        assert.deepStrictEqual(
          [refused.reason, snapshot.crewmates[0]!.login],
          ["login-needs-fresh", { id: "claudeAgent_work", label: "work", agent: "claude-code" }],
        );
      }),
    ),
  );

  it.live("Remove from crew keeps a copy with unlanded work until Discard", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/x.txt", "x\n"),
        );
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.ahead === 1);
        const kept = yield* Effect.flip(
          command({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: false }),
        );
        yield* command({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: true });
        const snapshot = yield* snapshotWhere((current) => current.crewmates.length === 0);
        assert.deepStrictEqual(
          {
            kept: kept.reason,
            copy: NodeFS.existsSync(NodePath.join(world.root, ".crew/backend")),
            task: snapshot.board.tasks[0]?.state,
            home: read(world.workspace, ".mate/crew/main/crew.yaml").includes("backend"),
          },
          { kept: "unlanded-commits", copy: false, task: "discarded", home: false },
        );
      }),
    ),
  );

  it.live(
    "crew ports: Apply gives each writer one, Run and Stop its app, Add crew ports proposes more",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          write(
            world.root,
            "zerops.yaml",
            [
              "zerops:",
              "  - setup: appdev",
              "    run:",
              "      ports:",
              "        - port: 3000",
              "          httpSupport: true",
              "        - port: 3001",
              "          httpSupport: true",
              "",
            ].join("\n"),
          );
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
          writeCrewHome(world.workspace, {
            "crew.yaml": [
              "name: Game team",
              "briefTitle: Space shooter",
              "members:",
              "  - handle: backend",
              "    displayName: Backend",
              "    host: appdev",
              "    run: sleep 30",
              "",
            ].join("\n"),
          });
          yield* command({ _tag: "apply" });
          yield* snapshotWhere(everyCopyReady);
          const ports = yield* command({ _tag: "addCrewPorts", host: "appdev", count: 2 });
          yield* command({ _tag: "appRun", handle: "backend" });
          const running = yield* snapshotWhere(
            (current) => current.crewmates[0]!.app?.state === "running",
          );
          yield* command({ _tag: "appStop", handle: "backend" });
          const stopped = yield* snapshotWhere(
            (current) => current.crewmates[0]!.app?.state === "stopped",
          );
          assert.deepStrictEqual(
            {
              hosts: running.hosts.map((host) => [host.host, host.crewPorts]),
              app: running.crewmates[0]!.app,
              stopped: stopped.crewmates[0]!.app?.state,
              ports,
            },
            {
              hosts: [["appdev", [{ port: 3001, routed: null }]]],
              app: { state: "running", port: 3001, url: null },
              stopped: "stopped",
              ports: { _tag: "crewPorts", host: "appdev", ports: [3002, 3003] },
            },
          );
        }),
      ),
  );

  it.live(
    "Deliver's draft names your tree's uncommitted paths; the orphan scan finds lost branches",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          write(world.root, "notes.txt", "mine\n");
          git(world.root, ["branch", "crew/ghost"]);
          git(world.root, ["commit", "-q", "--allow-empty", "-m", "ahead of ghost"]);
          const draft = yield* command({ _tag: "deliverDraft" });
          const orphans = yield* command({ _tag: "orphanScan" });
          assert.deepStrictEqual(
            [draft, orphans],
            [
              { _tag: "deliverDraft", dirtyPaths: [`${world.root}/notes.txt`] },
              { _tag: "orphans", orphans: [{ host: "appdev", branch: "crew/ghost", ahead: 0 }] },
            ],
          );
        }),
      ),
  );

  /** zcp's dev server, faked: a process started in `cwd` whose pid is in zcp's pidfile. */
  const startDevServer = (world: CrewWorld, cwd: string) => {
    const child = NodeChildProcess.spawn("sleep", ["60"], { cwd, detached: true, stdio: "ignore" });
    child.unref();
    NodeFS.writeFileSync(world.devServerPidFile, `${child.pid}\n`);
    return child.pid!;
  };

  it.live(
    "Show on dev: request, Allow sends the claim turn, dev serving the copy holds it, Back to my tree releases",
    () => {
      const started: Array<number> = [];
      return withCrewEngine((world) =>
        Effect.gen(function* () {
          write(
            world.root,
            "zerops.yaml",
            "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
          );
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
          yield* applied(world);
          started.push(startDevServer(world, world.root));
          const thread = yield* firstTurn(world, () => undefined);
          const directory = yield* CrewThreadDirectory;
          const member = Option.getOrThrow(yield* directory.memberFor(thread));
          const asked = yield* (yield* CrewToolHost).showOnDev(member, { reason: "see the HUD" });
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const requested = yield* snapshotWhere((snapshot) =>
            snapshot.attention.some((row) => row.kind === "show-on-dev"),
          );
          yield* eventually(
            command({ _tag: "claimGrant", host: "appdev" }).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
          );
          const claimTurn = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
          const shaped = Option.getOrThrow(yield* directory.memberFor(thread)).gate;
          started.push(startDevServer(world, NodePath.join(world.root, ".crew/backend")));
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const held = yield* snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "held",
          );
          const gate = Option.getOrThrow(yield* directory.memberFor(thread)).gate;
          const blocked = yield* Effect.flip(
            command({ _tag: "landNow", taskId: held.board.tasks[0]!.id }),
          );
          yield* command({ _tag: "claimRelease", host: "appdev" });
          const releaseTurn = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
          started.push(startDevServer(world, world.root));
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const released = yield* snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "none",
          );
          assert.deepStrictEqual(
            {
              asked: asked.isError,
              attention: requested.attention
                .filter((row) => row.kind === "show-on-dev")
                .map((row) => [row.host, row.text]),
              claimCard: claimTurn.message.text.split("\n")[1],
              claimWorkDir: claimTurn.message.text.includes(`workDir=${world.root}/.crew/backend`),
              shaped: shaped.kind === "live" ? [shaped.turn, shaped.devServer?.port] : null,
              served: held.hosts[0]!.served,
              holdsClaim: gate.kind === "live" && gate.holdsClaim,
              blocked: blocked.reason,
              releaseCard: releaseTurn.message.text.split("\n")[1],
              servedAfter: released.hosts[0]!.served,
            },
            {
              asked: false,
              attention: [["appdev", "see the HUD"]],
              claimCard: "Show your work on appdev",
              claimWorkDir: true,
              shaped: ["claim-start", 3000],
              served: { by: "crewmate", handle: "backend" },
              holdsClaim: true,
              blocked: "wrong-state",
              releaseCard: "Give appdev back",
              servedAfter: { by: "tree" },
            },
          );
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const pid of started) {
              try {
                process.kill(pid);
              } catch {}
            }
          }),
        ),
      );
    },
  );

  it.live("an Allow with no dev server of the Mate's says the way out, in the section too", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        write(
          world.root,
          "zerops.yaml",
          [
            "zerops:",
            "  - setup: appdev",
            "    run:",
            "      ports:",
            "        - port: 3000",
            "          httpSupport: true",
            "        - port: 3001",
            "          httpSupport: true",
            "",
          ].join("\n"),
        );
        git(world.root, ["add", "-A"]);
        git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
        writeCrewHome(world.workspace, {
          "crew.yaml": [
            "name: Game team",
            "briefTitle: Space shooter",
            "members:",
            "  - handle: backend",
            "    displayName: Backend",
            "    host: appdev",
            "    run: sleep 30",
            "",
          ].join("\n"),
        });
        yield* command({ _tag: "apply" });
        yield* snapshotWhere(everyCopyReady);
        const thread = yield* firstTurn(world, () => undefined);
        const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
        yield* (yield* CrewToolHost).showOnDev(member, { reason: "See the camera" });
        yield* snapshotWhere((snapshot) => snapshot.hosts[0]?.claim.state === "requested");
        yield* command({ _tag: "claimGrant", host: TEST_HOST });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const failed = yield* snapshotWhere((snapshot) => snapshot.lastError !== null);
        const refused = yield* Effect.flip(command({ _tag: "claimGrant", host: TEST_HOST }));
        const words =
          "appdev has no dev server started by your Mate — ask your Mate to start it, or open Backend's own app on :3001";
        assert.deepStrictEqual(
          [failed.lastError, refused.reason, refused.detail],
          [words, "wrong-state", words],
        );
      }),
    ),
  );

  it.live("an Allow waiting on a turn that a restart ended goes out when the engine boots", () => {
    const started: Array<number> = [];
    return withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          write(
            world.root,
            "zerops.yaml",
            "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
          );
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
          yield* applied(world);
          started.push(startDevServer(world, world.root));
          const thread = yield* firstTurn(world, () => undefined);
          const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
          yield* (yield* CrewToolHost).showOnDev(member, { reason: "See the camera" });
          yield* snapshotWhere((snapshot) => snapshot.hosts[0]?.claim.state === "requested");
          yield* command({ _tag: "claimGrant", host: TEST_HOST });
          yield* snapshotWhere((snapshot) => snapshot.hosts[0]!.claim.grantWaiting);
        }),
      (world) =>
        Effect.gen(function* () {
          yield* (yield* ServerCommandReadiness).complete;
          const starting = yield* snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
          );
          // The claim reads starting a moment before its turn is dispatched.
          yield* eventually(
            Effect.map(dispatchedOf(world, "thread.turn.start"), (turns) =>
              turns.at(-1)!.message.text.includes("Show your work on appdev"),
            ),
          );
          assert.deepStrictEqual(
            [
              starting.hosts[0]!.claim,
              (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!.message.text.split("\n")[1],
              (yield* Ref.get(world.admitted)).at(-1)?.principal,
            ],
            [
              { state: "starting", handle: "backend", grantWaiting: false },
              "Show your work on appdev",
              KAREL,
            ],
          );
        }),
    ]).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const pid of started) {
            try {
              process.kill(pid);
            } catch {}
          }
        }),
      ),
    );
  });

  it.live(
    "Allow pressed while the crewmate's turn runs is kept and sent when the turn ends",
    () => {
      const started: Array<number> = [];
      return withCrewEngine((world) =>
        Effect.gen(function* () {
          write(
            world.root,
            "zerops.yaml",
            "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
          );
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
          yield* applied(world);
          started.push(startDevServer(world, world.root));
          const thread = yield* firstTurn(world, () => undefined);
          const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
          yield* (yield* CrewToolHost).showOnDev(member, { reason: "See the camera" });
          yield* snapshotWhere((snapshot) => snapshot.hosts[0]?.claim.state === "requested");
          yield* command({ _tag: "claimGrant", host: TEST_HOST });
          const waiting = yield* snapshotWhere((snapshot) => snapshot.hosts[0]!.claim.grantWaiting);
          const turnsWhileRunning = (yield* dispatchedOf(world, "thread.turn.start")).length;
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const starting = yield* snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
          );
          // The claim reads starting a moment before its turn is dispatched.
          yield* eventually(
            Effect.map(dispatchedOf(world, "thread.turn.start"), (turns) =>
              turns.at(-1)!.message.text.includes("Show your work on appdev"),
            ),
          );
          const turns = yield* dispatchedOf(world, "thread.turn.start");
          assert.deepStrictEqual(
            [
              waiting.hosts[0]!.claim,
              turns.length - turnsWhileRunning,
              starting.hosts[0]!.claim,
              turns.at(-1)!.message.text.split("\n")[1],
              (yield* Ref.get(world.admitted)).at(-1)?.principal,
            ],
            [
              { state: "requested", handle: "backend", grantWaiting: true },
              1,
              { state: "starting", handle: "backend", grantWaiting: false },
              "Show your work on appdev",
              KAREL,
            ],
          );
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const pid of started) {
              try {
                process.kill(pid);
              } catch {}
            }
          }),
        ),
      );
    },
  );

  it.live("Show on dev pressed while the crewmate's turn runs goes out when the turn ends", () => {
    const started: Array<number> = [];
    return withCrewEngine((world) =>
      Effect.gen(function* () {
        write(
          world.root,
          "zerops.yaml",
          "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
        );
        git(world.root, ["add", "-A"]);
        git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
        yield* applied(world);
        started.push(startDevServer(world, world.root));
        const thread = yield* firstTurn(world, () => undefined);
        yield* command({ _tag: "showOnDev", handle: "backend" });
        const turnsWhileRunning = (yield* dispatchedOf(world, "thread.turn.start")).length;
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const starting = yield* snapshotWhere(
          (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
        );
        // The claim reads starting a moment before its turn is dispatched.
        yield* eventually(
          Effect.map(dispatchedOf(world, "thread.turn.start"), (turns) =>
            turns.at(-1)!.message.text.includes("Show your work on appdev"),
          ),
        );
        const turns = yield* dispatchedOf(world, "thread.turn.start");
        assert.deepStrictEqual(
          [
            turns.length - turnsWhileRunning,
            starting.hosts[0]!.claim.handle,
            turns.at(-1)!.message.text.split("\n")[1],
            (yield* Ref.get(world.admitted)).at(-1)?.principal,
          ],
          [1, "backend", "Show your work on appdev", KAREL],
        );
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const pid of started) {
            try {
              process.kill(pid);
            } catch {}
          }
        }),
      ),
    );
  });

  it.live("a run that lets the crew show work on dev allows a request when its turn ends", () => {
    const started: Array<number> = [];
    return withCrewEngine((world) =>
      Effect.gen(function* () {
        write(
          world.root,
          "zerops.yaml",
          "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
        );
        git(world.root, ["add", "-A"]);
        git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
        yield* applied(world);
        yield* command({
          _tag: "start",
          budgetUsd: "unlimited",
          timeLimitHours: "unlimited",
          stopAtUsagePercent: null,
          landing: "person",
          devGrant: true,
          leadMayStart: false,
        });
        started.push(startDevServer(world, world.root));
        const thread = yield* firstTurn(world, () => undefined);
        const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
        yield* (yield* CrewToolHost).showOnDev(member, { reason: "See the camera" });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const starting = yield* snapshotWhere(
          (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
        );
        // The claim reads starting a moment before its turn is dispatched.
        yield* eventually(
          Effect.map(dispatchedOf(world, "thread.turn.start"), (turns) =>
            turns.at(-1)!.message.text.includes("Show your work on appdev"),
          ),
        );
        assert.deepStrictEqual(
          [
            starting.hosts[0]!.claim.handle,
            (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!.message.text.split("\n")[1],
            (yield* Ref.get(world.admitted)).at(-1)?.principal,
          ],
          ["backend", "Show your work on appdev", AS_CREW],
        );
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const pid of started) {
            try {
              process.kill(pid);
            } catch {}
          }
        }),
      ),
    );
  });

  it.live("Show on dev pressed by you asks and allows at once, as you", () => {
    const started: Array<number> = [];
    return withCrewEngine((world) =>
      Effect.gen(function* () {
        write(
          world.root,
          "zerops.yaml",
          "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
        );
        git(world.root, ["add", "-A"]);
        git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
        yield* applied(world);
        started.push(startDevServer(world, world.root));
        yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
        const [created] = yield* dispatchedOf(world, "thread.crew.create");
        yield* world.publish(spiEvent("turn.completed", created!.threadId, { state: "completed" }));
        yield* eventually(
          command({ _tag: "showOnDev", handle: "backend" }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
        );
        const starting = yield* snapshotWhere(
          (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
        );
        // The claim reads starting a moment before its turn is dispatched.
        yield* eventually(
          Effect.map(dispatchedOf(world, "thread.turn.start"), (turns) =>
            turns.at(-1)!.message.text.includes("Show your work on appdev"),
          ),
        );
        assert.deepStrictEqual(
          [
            starting.hosts[0]!.claim.handle,
            (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!.message.text.split("\n")[1],
            (yield* Ref.get(world.admitted)).at(-1)?.principal,
          ],
          ["backend", "Show your work on appdev", KAREL],
        );
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const pid of started) {
            try {
              process.kill(pid);
            } catch {}
          }
        }),
      ),
    );
  });

  it.live(
    "the crew's thread policy: installed at Apply, a profile for the live stint, deny-all once retired, none for a person",
    () =>
      withCrewEngine(
        (world) =>
          Effect.gen(function* () {
            const registry = yield* ThreadToolPolicyRegistry;
            const before = yield* registry.current;
            yield* applied(world);
            const thread = yield* firstTurn(world, () => undefined);
            yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
            const policy = Option.getOrThrow(yield* registry.current);
            const profileOf = (threadId: string) =>
              policy.profileFor({
                threadId: ThreadIdSchema.make(threadId),
                instanceId: ProviderInstanceId.make("claudeAgent"),
              });
            const live = yield* profileOf(thread);
            const person = yield* profileOf("person-thread");
            yield* eventually(
              command({ _tag: "startFresh", handle: "backend" }).pipe(
                Effect.as(true),
                Effect.orElseSucceed(() => false),
              ),
            );
            const retired = yield* profileOf(thread);
            assert.deepStrictEqual(
              {
                before: Option.isNone(before),
                live: [
                  live?.sessionContext.includes("You are @backend"),
                  live?.sessionContext.includes("# Brief v1: Space shooter"),
                  live?.readOnly,
                  live?.tools.map((tool) => tool.name),
                ],
                person,
                retired: [retired?.readOnly, retired?.tools.length],
              },
              {
                before: true,
                live: [
                  true,
                  true,
                  false,
                  ["crew_report", "crew_board", "crew_diff", "crew_show_on_dev", "crew_memory"],
                ],
                person: undefined,
                retired: [true, 0],
              },
            );
          }),
        { installer: () => installCrewThreadPolicy },
      ),
  );

  const twoCrewmates = (leadLogin: string, writerLogin: string) =>
    [
      "name: Game team",
      "briefTitle: Space shooter",
      "members:",
      "  - handle: lead",
      "    displayName: Lead",
      "    kind: lead",
      `    login: ${leadLogin}`,
      "  - handle: backend",
      "    displayName: Backend",
      "    host: appdev",
      `    login: ${writerLogin}`,
      "",
    ].join("\n");

  it.live.each([
    {
      name: "a lead on a login that can't host the crew tools",
      lead: "codex_work",
      writer: "codex_work",
      words: "@lead leads the crew, and a lead needs the crew tools, which Codex cannot host",
    },
    {
      name: "a writer on a login that can't carry the crew's rules",
      lead: "claudeAgent",
      writer: "cursor",
      words: "@backend runs on Cursor, which can't run a crewmate",
    },
    {
      name: "a lead on a login that can't carry the crew's rules",
      lead: "cursor",
      writer: "claudeAgent",
      words: "@lead runs on Cursor, which can't run a crewmate",
    },
    {
      name: "a crewmate on a login this Mate doesn't have",
      lead: "claudeAgent",
      writer: "gone",
      words: "@backend runs on gone, which isn't a login on this Mate",
    },
  ])("Apply refuses $name, naming why", ({ lead, writer, words }) =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        writeCrewHome(world.workspace, {
          "crew.yaml": twoCrewmates(lead, writer),
          "jobs/lead.md": "Plan the work.\n",
        });
        const refused = yield* Effect.flip(command({ _tag: "apply" }));
        assert.deepStrictEqual(
          [refused.reason, refused.detail?.startsWith(words)],
          ["invalid-definition", true],
        );
      }),
    ),
  );

  it.live("an agent not live yet when the engine boots gets its crew tools once it is", () =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
          yield* eventually(
            Effect.map(dispatchedOf(world, "thread.crew.create"), (creates) => creates.length > 0),
          );
          yield* Ref.set(world.missingAgents, new Set(["claudeAgent"]));
        }),
      (world) =>
        Effect.gen(function* () {
          yield* Ref.set(world.missingAgents, new Set());
          const created = (yield* dispatchedOf(world, "thread.crew.create")).find(
            (entry) => entry.crew.crewmate === "backend",
          )!;
          const member = Option.getOrThrow(
            yield* (yield* CrewThreadDirectory).memberFor(created.threadId),
          );
          assert.deepStrictEqual([member.prompt.crewTools, member.prompt.memory], [true, true]);
        }),
    ]),
  );

  const NO_SPEND = "Grok doesn't report what it spends, so this crew can't keep a budget";

  it.live(
    "a run's dollar budget is refused while a crewmate's agent doesn't report its spend",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          writeCrewHome(world.workspace, {
            "crew.yaml": twoCrewmates("claudeAgent", "grok"),
            "jobs/lead.md": "Plan the work.\n",
          });
          yield* command({ _tag: "apply" });
          yield* eventually(Effect.map(latest, everyCopyReady));
          const budgeted = yield* Effect.flip(command({ ...RUN_NOW, budgetUsd: 20 }));
          yield* command(RUN_NOW);
          const run = (yield* snapshotWhere((snapshot) => snapshot.run !== null)).run!;
          yield* command({ _tag: "pause", runId: run.id });
          yield* snapshotWhere((snapshot) => snapshot.run?.state === "paused");
          const resumed = yield* Effect.flip(
            command({ _tag: "resume", runId: run.id, budgetUsd: 20 }),
          );
          assert.deepStrictEqual(
            [budgeted.detail?.startsWith(NO_SPEND), resumed.detail?.startsWith(NO_SPEND)],
            [true, true],
          );
        }),
      ),
  );

  it.live("Apply refuses a crewmate on an agent that doesn't report its spend under a budget", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        writeCrewHome(world.workspace, {
          "crew.yaml": twoCrewmates("claudeAgent", "claudeAgent"),
          "jobs/lead.md": "Plan the work.\n",
        });
        yield* command({ _tag: "apply" });
        yield* eventually(Effect.map(latest, everyCopyReady));
        yield* command({ ...RUN_NOW, budgetUsd: 20 });
        yield* snapshotWhere((snapshot) => snapshot.run !== null);
        writeCrewHome(world.workspace, {
          "crew.yaml": twoCrewmates("claudeAgent", "grok"),
          "jobs/lead.md": "Plan the work.\n",
        });
        const refused = yield* Effect.flip(command({ _tag: "apply" }));
        const ownRefused = yield* Effect.flip(
          command({ _tag: "jobSave", handle: "backend", apply: "fresh" }),
        );
        assert.deepStrictEqual(
          [
            refused.reason,
            refused.detail?.startsWith(NO_SPEND),
            ownRefused.detail?.startsWith(NO_SPEND),
          ],
          ["invalid-definition", true, true],
        );
      }),
    ),
  );

  it.live(
    "a Codex writer runs without crew tools and memory; Runs on names each login's agent",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* Ref.set(
            world.logins,
            new Map([["codex_work", mateLogin("codex_work", "codex", "work")]]),
          );
          writeCrewHome(world.workspace, {
            "crew.yaml": twoCrewmates("claudeAgent", "codex_work"),
            "jobs/lead.md": "Plan the work.\n",
          });
          yield* command({ _tag: "apply" });
          yield* snapshotWhere(everyCopyReady);
          yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
          const created = (yield* dispatchedOf(world, "thread.crew.create")).find(
            (entry) => entry.crew.crewmate === "backend",
          )!;
          const member = Option.getOrThrow(
            yield* (yield* CrewThreadDirectory).memberFor(created.threadId),
          );
          const snapshot = yield* latest;
          assert.deepStrictEqual(
            {
              prompt: [member.prompt.crewTools, member.prompt.memory],
              logins: snapshot.crewmates.map((crewmate) => [crewmate.handle, crewmate.login.label]),
            },
            {
              prompt: [false, false],
              logins: [
                ["lead", "Claude"],
                ["backend", "work"],
              ],
            },
          );
        }),
      ),
  );

  it.live("before any crew exists the crew home reads as an empty set, never a refusal", () =>
    withCrewEngine(() =>
      Effect.gen(function* () {
        const engine = yield* CrewEngine;
        assert.deepStrictEqual(
          [yield* engine.readFiles, (yield* latest).status],
          [{ files: [] }, "none"],
        );
      }),
    ),
  );

  it.live(
    "the dev services this Mate mounts show before any crew; opening the crew home reads their databases",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          const engine = yield* CrewEngine;
          const before = yield* snapshotWhere((current) => current.devHosts.length > 0);
          const sshBefore = yield* Ref.get(world.sshCalls);
          yield* engine.readFiles;
          const read = yield* snapshotWhere((current) => current.devHosts[0]?.database !== null);
          assert.deepStrictEqual(
            [
              before.status,
              before.devHosts,
              sshBefore,
              read.devHosts.map((host) => [host.host, typeof host.database]),
            ],
            ["none", [{ host: TEST_HOST, database: null }], 0, [[TEST_HOST, "boolean"]]],
          );
        }),
      ),
  );

  it.live(
    "a writer's conversation runs in its copy; your tree's branch and head are in the snapshot",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
          const [created] = yield* dispatchedOf(world, "thread.crew.create");
          const snapshot = yield* snapshotWhere(
            (current) => current.hosts[0]?.integration !== null,
          );
          assert.deepStrictEqual(
            [created!.worktreePath, snapshot.hosts[0]!.integration],
            [
              `${world.root}/.crew/backend`,
              { branch: "main", head: git(world.root, ["rev-parse", "HEAD"]) },
            ],
          );
        }),
      ),
  );

  it.live("Try again on a stopped task queues it for its next attempt and starts it", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/.env", "SECRET=1\n"),
        );
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        // The guard left the file uncommitted: the copy reads dirty with nothing ahead.
        const parked = yield* snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "parked" &&
            current.crewmates[0]!.lane?.dirty === true,
        );
        NodeFS.rmSync(NodePath.join(world.root, ".crew/backend/.env"));
        yield* command({ _tag: "taskRetry", taskId: parked.board.tasks[0]!.id });
        const retried = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          [parked.board.tasks[0]!.reason?.includes(".env"), retried.board.tasks[0]!.attempts],
          [true, 2],
        );
      }),
    ),
  );
});
