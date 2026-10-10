// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { assert, describe, it } from "@effect/vitest";
import { ThreadId, type CrewCommand, type CrewCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { MateLogin } from "../ZeropsLogins.ts";
import { CREW_ID } from "./CrewHome.ts";
import { CrewStore } from "./CrewStore.ts";
import { TEST_HOST, git, read, write } from "./testing/crewGitFixture.ts";
import {
  AS_CREW,
  KAREL,
  applied,
  crewJourney,
  eventually,
  everyCopyReady,
  firstTurn,
  CREW_WORLD,
  lastAdmitted,
  onV1,
  opened,
  pressWhenFree,
  reportDone,
  seamsOf,
  sentKind,
  turnsSent,
  v1Journey,
  type CrewWorld,
} from "./testing/crewWorld.ts";

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
    crewJourney((world) =>
      Effect.gen(function* () {
        const snapshot = yield* world.snapshot;
        assert.deepStrictEqual(
          [snapshot.status, snapshot.crew, yield* world.profileInstalls],
          ["none", null, 0],
        );
        const error = yield* Effect.flip(
          world.press({ _tag: "message", handle: "backend", text: "hi", attachments: [] }),
        );
        assert.strictEqual(error.reason, "no-crew");
      }),
    ),
  );

  it.live("Apply makes each writer's copy, installs the policies once and shows the crew", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        // The first conversation opens once the copy is ready.
        const snapshot = yield* world.snapshotWhere(
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
            installs: yield* world.profileInstalls,
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
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Add pagination to /api/items\nCursor based.",
            attachments: [],
          });
          const created = yield* opened(world);
          const resume = yield* sentKind(world, "autoResume");
          const turns = yield* turnsSent(world);
          assert.deepStrictEqual(
            {
              runtimeMode: created[0]?.runtimeMode,
              crewmate: [created[0]?.handle, created[0]?.session],
              autoResume: resume.map((entry) => [entry.chat, entry.enabled]),
              turnThread: turns[0]?.chat,
              card: turns[0]?.text.split("\n").slice(0, 2),
              instance: turns[0]?.instanceId,
              turnMode: turns[0]?.runtimeMode,
            },
            {
              runtimeMode: "approval-required",
              crewmate: ["backend", 1],
              autoResume: [[created[0]!.chat, false]],
              turnThread: created[0]!.chat,
              card: ["[Crew task card]", "#1 Add pagination to /api/items · from your message"],
              instance: "claudeAgent",
              turnMode: "approval-required",
            },
          );
          yield* world.turnStarts(created[0]!.chat);
          const transcript = NodePath.join(world.workspace, "session-1.jsonl");
          NodeFS.writeFileSync(transcript, "{}\n");
          const packet = yield* world.sessionStart(created[0]!.chat, {
            source: "startup",
            sessionId: "session-1",
            transcriptPath: transcript,
          });
          assert.isTrue(packet?.startsWith("crew-state seq"));
          yield* world.sessionsWhere("backend", (sessions) => sessions.latest === "active");
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Also sort them.",
            attachments: [],
          });
          const snapshot = yield* world.snapshotWhere(
            (current) => current.board.tasks.length === 1,
          );
          assert.deepStrictEqual(
            {
              tasks: snapshot.board.tasks.map((task) => [
                task.number,
                task.title,
                task.state,
                task.source,
              ]),
              open: snapshot.crewmates[0]!.openTaskId === snapshot.board.tasks[0]!.id,
              turns: (yield* turnsSent(world)).map((turn) => turn.text.split("\n")[0]),
              // As whom its turns ran; how often each world asks is its own mechanism.
              principals: (yield* world.admissions).filter(
                (principal, at, all) =>
                  all.findIndex((other) => NodeUtil.isDeepStrictEqual(other, principal)) === at,
              ),
            },
            {
              tasks: [[1, "Add pagination to /api/items", "working", "message"]],
              open: true,
              turns: ["[Crew task card]", "Also sort them."],
              principals: [KAREL],
            },
          );
        }),
      ),
  );

  it.live(
    "turn end commits the copy's work; a done report merges in, checks and waits for Land",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Write ok.txt",
            attachments: [],
          });
          const [created] = yield* opened(world);
          const thread = created!.chat;
          yield* world.turnStarts(thread);
          write(world.root, ".crew/backend/ok.txt", "ok\n");
          const answer = yield* world.report(thread, { status: "done", summary: "Wrote ok.txt." });
          assert.isFalse(answer.isError);
          yield* world.turnEnds(thread);
          const ready = yield* world.snapshotWhere(
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
          yield* world.mateTurnRunning(true);
          const waits = yield* Effect.flip(
            world.press({ _tag: "land", taskId: ready.board.tasks[0]!.id }),
          );
          assert.strictEqual(waits.reason, "wrong-state");
          yield* world.mateTurnRunning(false);
          yield* world.press({ _tag: "land", taskId: ready.board.tasks[0]!.id });
          const landed = yield* world.snapshotWhere(
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.press({ _tag: "message", handle: "backend", text: "First", attachments: [] });
        yield* world.press({
          _tag: "taskCreate",
          owner: "backend",
          title: "Second",
          brief: "Do the second thing.",
          doneWhen: "",
          dependsOn: [],
        });
        const queued = yield* world.snapshotWhere((snapshot) => snapshot.board.tasks.length === 2);
        assert.deepStrictEqual(
          queued.board.tasks.map((task) => [task.title, task.state]),
          [
            ["First", "working"],
            ["Second", "queued"],
          ],
        );
        const [stint] = yield* opened(world);
        yield* world.turnEnds(stint!.chat);
        yield* world.press({ _tag: "discard", taskId: queued.board.tasks[0]!.id });
        yield* world.snapshotWhere((snapshot) => snapshot.board.tasks[1]?.state === "working");
        assert.deepStrictEqual(yield* lastAdmitted(world), {
          kind: "crew",
          startedBy: "user-karel",
        });
      }),
    ),
  );

  /** A press while `backend`'s turn end commits in its copy: what it came to, and how soon. */
  const pressDuringTurnEnd = (world: CrewWorld, press: (taskId: string) => CrewCommand) =>
    Effect.gen(function* () {
      const first = (yield* world.snapshotWhere((snapshot) => snapshot.board.tasks.length >= 1))
        .board.tasks[0]!.id;
      const stint = (yield* opened(world)).find((entry) => entry.handle === "backend");
      const turnCommit = yield* world.hold({ step: "save" });
      const ended = yield* Effect.forkChild(world.turnEnds(stint!.chat));
      yield* turnCommit.reached;
      const pressed = yield* Effect.forkChild(Effect.exit(world.press(press(first))));
      // Awaited while the commit is held: a press that waited on the turn's end never returns, and
      // a slow one under load is no wait on it (a 300 ms bound read it as one).
      const atOnce = Option.some(yield* Fiber.await(pressed));
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.press({ _tag: "message", handle: "backend", text: "First", attachments: [] });
        yield* world.press({
          _tag: "taskCreate",
          owner: "backend",
          title: "Second",
          brief: "Do the second thing.",
          doneWhen: "",
          dependsOn: [],
        });
        yield* world.snapshotWhere((snapshot) => snapshot.board.tasks.length === 2);
        const { first, atOnce } = yield* pressDuringTurnEnd(world, (taskId) => ({
          _tag: "discard",
          taskId,
        }));
        refusedAsBusy(atOnce);
        // Once the turn has ended, the same press goes through and the queue moves.
        yield* world.press({ _tag: "discard", taskId: first });
        yield* world.snapshotWhere(
          (snapshot) =>
            snapshot.board.tasks[0]?.state === "discarded" &&
            snapshot.board.tasks[1]?.state === "working",
        );
      }),
    ),
  );

  const pressesDuringTurnEnd: ReadonlyArray<{
    readonly name: string;
    readonly press: (taskId: string) => CrewCommand;
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.press({
          _tag: "message",
          handle: "backend",
          text: "First",
          attachments: [],
        });
        const { atOnce } = yield* pressDuringTurnEnd(world, press);
        refusedAsBusy(atOnce);
      }),
    ),
  );

  /** `backend` reported done; its check after the turn end is held. */
  const holdTheCheck = (world: CrewWorld) =>
    Effect.gen(function* () {
      yield* applied(world);
      const thread = yield* firstTurn(world, () => undefined);
      yield* reportDone(world, thread);
      const check = yield* world.hold({ step: "check" });
      yield* world.turnEnds(thread);
      yield* check.reached;
      // The board as the engine has rebuilt it, never a snapshot from before the turn end.
      const taskId = (yield* world.snapshotWhere(
        (snapshot) => snapshot.board.tasks[0]?.state === "checking",
      )).board.tasks[0]!.id;
      return { thread, check, taskId };
    });

  it.live("a discard while the check runs is refused as busy, and the check is not undone", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        const { check, taskId } = yield* holdTheCheck(world);
        // Awaited before the check is released: a discard that waited on it never returns.
        const pressed = yield* Effect.exit(world.press({ _tag: "discard", taskId }));
        refusedAsBusy(Option.some(Exit.succeed(pressed)));
        yield* check.release;
        // No ok.txt: the check fails, and the task goes back for rework — never discarded.
        yield* world.snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "rework");
      }),
    ),
  );

  it.live(
    "a message during the check goes on at once; a turn that reports before the check ends is integrated after it",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          const { thread, check } = yield* holdTheCheck(world);
          // Decision: fix the race, never retry or loosen.
          // Success and delivery must precede check.release; elapsed wall time does not prove that order.
          const messaged = yield* Effect.exit(
            world.press({ _tag: "message", handle: "backend", text: "More", attachments: [] }),
          );
          assert.isTrue(Exit.isSuccess(messaged), "the message did not go through at once");
          const sent = (yield* turnsSent(world)).at(-1);
          assert.deepStrictEqual(
            { chat: sent?.chat, text: sent?.text },
            { chat: thread, text: "More" },
            "the message must be delivered before the check is released",
          );
          yield* world.snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "working");
          // Its turn reports done and ends while the first check still runs.
          yield* world.turnStarts(thread);
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          yield* check.release;
          // Never stuck in merging: integrated again once the check ended.
          yield* world.snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "rework");
        }),
      ),
  );

  it.live("Tell the crew to a busy crewmate is refused and creates nothing", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        world.writeHome({
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
        yield* world.press({ _tag: "apply" });
        yield* world.snapshotWhere(everyCopyReady);
        yield* world.press({ _tag: "message", handle: "backend", text: "First", attachments: [] });
        const { atOnce } = yield* pressDuringTurnEnd(world, () => ({
          _tag: "tell",
          text: "@backend adds the API, @erik reviews the plan.",
          mentions: [{ handle: "backend" }, { handle: "erik" }],
        }));
        refusedAsBusy(atOnce);
        // Read from the tables, not a snapshot that may not have caught up.
        assert.strictEqual((yield* world.tasks).length, 1, "a busy Tell made tasks");
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
  const turnEndedWorking = (world: CrewWorld) =>
    Effect.gen(function* () {
      yield* applied(world);
      const thread = yield* firstTurn(world, () => undefined);
      yield* world.turnEnds(thread);
      const taskId = (yield* world.snapshotWhere(
        (snapshot) => snapshot.board.tasks[0]?.state === "working",
      )).board.tasks[0]!.id;
      return { thread, taskId };
    });

  const stuckStates: ReadonlyArray<"merging" | "checking"> = ["merging", "checking"];
  for (const state of stuckStates) {
    // Only V1's own tables can hold a task in a state nothing runs on.
    it.live.skipIf(CREW_WORLD !== "v1")(
      `a task left ${state} with nothing running on it can be discarded`,
      () =>
        v1Journey((world) =>
          Effect.gen(function* () {
            const { taskId } = yield* turnEndedWorking(world);
            // A redeploy held its merge, or its check errored: nothing runs on it now.
            yield* world.v1.run(
              Effect.gen(function* () {
                const store = yield* CrewStore;
                const row = (yield* store.assignments(CREW_ID)).find(
                  (task) => task.assignment === taskId,
                )!;
                yield* store.putAssignment({ ...row, state });
              }),
            );
            yield* world.press({ _tag: "discard", taskId });
            yield* world.snapshotWhere(
              (snapshot) => snapshot.board.tasks[0]?.state === "discarded",
            );
          }),
        ),
    );
  }

  it.live("a message during a Land now's check goes through", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        const { thread, taskId } = yield* turnEndedWorking(world);
        const check = yield* world.hold({ step: "check" });
        const landing = yield* Effect.forkChild(
          Effect.exit(world.press({ _tag: "landNow", taskId })),
        );
        yield* check.reached;
        // Decision: fix the race, never retry or loosen. The message must go through while the
        // check is still held: awaited before the release, which a message that waited on the
        // check never reaches (the test times out). A 300 ms bound failed it under CI's load.
        const messaged = yield* Effect.exit(
          world.press({ _tag: "message", handle: "backend", text: "More", attachments: [] }),
        );
        assert.isTrue(
          Exit.isSuccess(messaged),
          "the message waited on, or was refused by, the Land's check",
        );
        const sent = (yield* turnsSent(world)).at(-1);
        assert.deepStrictEqual(
          { chat: sent?.chat, text: sent?.text },
          { chat: thread, text: "More" },
          "the message is delivered before the check is released",
        );
        yield* check.release;
        yield* Fiber.join(landing);
      }),
    ),
  );

  it.live("a Land now while the task's integration still runs lands once that one ends", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        const { thread, check, taskId } = yield* holdTheCheck(world);
        // Back to work during the check, and its turn ends with no report.
        yield* world.press({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        yield* world.turnStarts(thread);
        write(world.root, ".crew/backend/ok.txt", "ok\n");
        yield* world.turnEnds(thread);
        yield* world.press({ _tag: "landNow", taskId });
        yield* check.release;
        yield* world.snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "landed");
      }),
    ),
  );

  it.live("Start during a turn end waits for the copy, then carries the task on once", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        const turnCommit = yield* world.hold({ step: "save" });
        const ended = yield* Effect.forkChild(world.turnEnds(thread));
        yield* turnCommit.reached;
        const turnsBefore = (yield* turnsSent(world)).length;
        // Awaited before the copy is released: a Start that waited on the turn end never returns.
        yield* world.press(RUN_NOW);
        assert.strictEqual(
          (yield* turnsSent(world)).length,
          turnsBefore,
          "a turn went to the crewmate while its copy was being committed",
        );
        yield* turnCommit.release;
        yield* Fiber.join(ended);
        // The advance Start skipped runs once the copy is free: one carry-on, not two.
        yield* eventually(
          Effect.map(turnsSent(world), (turns) => turns.length === turnsBefore + 1),
        );
        yield* Effect.sleep("300 millis");
        assert.strictEqual((yield* turnsSent(world)).length, turnsBefore + 1);
      }),
    ),
  );

  it.live("a discard whose copy cannot be reset leaves its task as it was", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(NodePath.join(world.root, ".crew/backend"), "a.txt", "changed\n"),
        );
        yield* world.press({
          _tag: "taskCreate",
          owner: "backend",
          title: "Second",
          brief: "Do the second thing.",
          doneWhen: "",
          dependsOn: [],
        });
        yield* world.turnEnds(thread);
        yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.ahead === 1);
        const lock = NodePath.join(world.root, ".git/worktrees/backend/index.lock");
        NodeFS.writeFileSync(lock, "");
        const first = (yield* world.snapshotWhere((snapshot) => snapshot.board.tasks.length === 2))
          .board.tasks[0]!.id;
        const refused = yield* Effect.flip(world.press({ _tag: "discard", taskId: first }));
        assert.strictEqual(refused.reason, "io");
        NodeFS.rmSync(lock);
        // Pressed again it discards: the refused press left the task open.
        yield* world.press({ _tag: "discard", taskId: first });
        yield* world.snapshotWhere(
          (snapshot) =>
            snapshot.board.tasks[0]?.state === "discarded" &&
            snapshot.board.tasks[1]?.state === "working",
        );
      }),
    ),
  );

  it.live("a queued task admission refuses stays queued with a Can't start row", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.refuseTurns("not the login's signer");
        yield* world.press({
          _tag: "taskCreate",
          owner: "backend",
          title: "Refused",
          brief: "Try it.",
          doneWhen: "",
          dependsOn: [],
        });
        const snapshot = yield* world.snapshotWhere((current) => current.attention.length === 1);
        assert.deepStrictEqual(
          [snapshot.board.tasks[0]?.state, snapshot.attention.map((row) => [row.kind, row.text])],
          ["queued", [["cant-start", "not the login's signer"]]],
        );
        yield* world.refuseTurns(undefined);
        yield* world.press({ _tag: "taskRetry", taskId: snapshot.board.tasks[0]!.id });
        const started = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual([started.attention, yield* lastAdmitted(world)], [[], KAREL]);
      }),
    ),
  );

  it.live("Try again is only for a queued task admission refused", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* firstTurn(world, () => undefined);
        yield* world.press({
          _tag: "taskCreate",
          owner: "backend",
          title: "Behind",
          brief: "Later.",
          doneWhen: "",
          dependsOn: [],
        });
        const queued = yield* world.snapshotWhere((current) => current.board.tasks.length === 2);
        const refused = yield* Effect.flip(
          world.press({ _tag: "taskRetry", taskId: queued.board.tasks[1]!.id }),
        );
        assert.strictEqual(refused.reason, "wrong-state");
      }),
    ),
  );

  it.live("a refused queued task waits through another login's sign-in", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.refuseTurns("not the login's signer");
        yield* world.press({
          _tag: "taskCreate",
          owner: "backend",
          title: "Refused",
          brief: "Try it.",
          doneWhen: "",
          dependsOn: [],
        });
        yield* world.snapshotWhere((current) => current.attention.length === 1);
        const tries = (yield* world.admissions).length;
        yield* world.signedIn("codex");
        yield* world.signedIn({ extra: "work" });
        yield* Effect.sleep("300 millis");
        assert.deepStrictEqual(
          [(yield* world.admissions).length, (yield* world.snapshot).board.tasks[0]!.state],
          [tries, "queued"],
        );
      }),
    ),
  );

  it.live("a refused queued task starts again once a login's sign-in changes", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.refuseTurns("not the login's signer");
        yield* world.press({
          _tag: "taskCreate",
          owner: "backend",
          title: "Refused",
          brief: "Try it.",
          doneWhen: "",
          dependsOn: [],
        });
        yield* world.snapshotWhere((current) => current.attention.length === 1);
        yield* world.refuseTurns(undefined);
        yield* world.signedIn("claude-code");
        const started = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual([started.attention, yield* lastAdmitted(world)], [[], AS_CREW]);
      }),
    ),
  );

  it.live("Tell the crew: one mention a task, none refused", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        world.writeHome({
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
        yield* world.press({ _tag: "apply" });
        yield* world.snapshotWhere(everyCopyReady);
        const none = yield* Effect.flip(
          world.press({ _tag: "tell", text: "Everyone, go.", mentions: [] }),
        );
        yield* world.press({
          _tag: "tell",
          text: "@backend adds the API, @erik reviews the plan.",
          mentions: [{ handle: "backend" }, { handle: "erik" }],
        });
        const snapshot = yield* world.snapshotWhere((current) => current.board.tasks.length === 2);
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
        const cards = (yield* turnsSent(world)).map((turn) => turn.text);
        assert.isTrue(cards.every((card) => card.includes("Also sent to")));
      }),
    ),
  );

  it.live("a job saved for the next turn rotates the stint before that turn", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.press({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
        const [first] = yield* opened(world);
        yield* world.turnEnds(first!.chat);
        world.writeHome({
          "jobs/backend.md": "You own the server and its tests.\n",
        });
        yield* world.press({ _tag: "jobSave", handle: "backend", apply: "nextTurn" });
        const pending = (yield* world.snapshotWhere(
          (current) => current.crewmates[0]!.jobVersion === 2,
        )).crewmates[0]!.promptVersions;
        yield* world.press({ _tag: "message", handle: "backend", text: "Go on", attachments: [] });
        const creates = yield* opened(world);
        const sessions = yield* world.sessionsWhere("backend", (seen) => seen.count === 2);
        const snapshot = yield* world.snapshot;
        // V1 keeps each session in a conversation of its own and archives the one it left.
        yield* onV1(world, () =>
          Effect.map(sentKind(world, "archive"), (archived) =>
            assert.deepStrictEqual(
              archived.map((entry) => entry.chat),
              [first!.chat],
            ),
          ),
        );
        assert.deepStrictEqual(
          {
            pending,
            stopped: (yield* sentKind(world, "stop")).map((entry) => entry.chat),
            stints: creates.map((entry) => entry.session),
            reason: sessions,
            running: snapshot.crewmates[0]!.promptVersions.running,
            carried: (yield* turnsSent(world)).at(-1)!.text,
            seams: yield* seamsOf(world),
          },
          {
            pending: { running: { brief: 1, job: 1 }, current: { brief: 1, job: 2 } },
            stopped: [first!.chat],
            stints: [1, 2],
            reason: { count: 2, latest: "open", reasons: [null, "Its job changed"] },
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
                first!.chat,
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* world.report(thread, {
          status: "blocked",
          summary: "Which currency?",
          question: "CZK or EUR?",
        });
        yield* world.turnEnds(thread);
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "blocked");
        yield* world.press({ _tag: "message", handle: "backend", text: "EUR", attachments: [] });
        const answered = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        const turns = yield* turnsSent(world);
        assert.deepStrictEqual(
          [
            answered.board.tasks.map((task) => [task.number, task.state]),
            turns.at(-1)?.chat,
            turns.at(-1)?.text,
          ],
          [[[1, "working"]], thread, "EUR"],
        );
      }),
    ),
  );

  it.live("refs the engine writes mid-turn never park the lane; a foreign one does", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        git(world.root, ["update-ref", yield* world.ownRef, "HEAD"]);
        yield* world.turnEnds(thread);
        const [task] = yield* world.tasks;
        assert.strictEqual(task?.state, "working");
        yield* world.press({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        git(world.root, ["update-ref", "refs/heads/crewmate-made-this", "HEAD"]);
        yield* world.turnEnds(thread);
        const parked = yield* world.snapshotWhere(
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
      crewJourney((world) =>
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
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const rework = yield* world.snapshotWhere(
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
          yield* world.press({ _tag: "askResolve", taskId: rework.board.tasks[0]!.id });
          const turns = yield* turnsSent(world);
          const resolving = yield* world.snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "working",
          );
          assert.deepStrictEqual(
            {
              card: turns.at(-1)!.text.split("\n").slice(1, 3),
              attempts: resolving.board.tasks[0]!.attempts,
              principal: yield* lastAdmitted(world),
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
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* world.turnEnds(thread);
          const working = yield* world.snapshotWhere(
            (snapshot) => snapshot.crewmates[0]!.lane?.ahead === 1,
          );
          const task = working.board.tasks[0]!;
          yield* world.press({ _tag: "landNow", taskId: task.id });
          const landed = yield* world.snapshotWhere(
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
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/b.txt", "crew\n"),
          );
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const failed = yield* world.snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "rework",
          );
          assert.deepStrictEqual(
            [failed.board.tasks[0]!.check?.state, failed.attention.map((row) => row.kind)],
            ["failed", ["check-failed"]],
          );
          yield* world.press({ _tag: "askFix", taskId: failed.board.tasks[0]!.id });
          write(world.root, ".crew/backend/ok.txt", "ok\n");
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const ready = yield* world.snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "ready",
          );
          write(world.root, "b.txt", "the person's own edit\n");
          yield* world.press({ _tag: "land", taskId: ready.board.tasks[0]!.id });
          const waiting = yield* world.snapshotWhere(
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/b.txt", "crew\n"),
        );
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        const failed = yield* world.snapshotWhere(
          (snapshot) => snapshot.board.tasks[0]?.state === "rework",
        );
        write(world.root, ".crew/backend/ok.txt", "ok\n");
        yield* world.press({ _tag: "landNow", taskId: failed.board.tasks[0]!.id });
        yield* world.snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "landed");
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
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* world.deploy("started", { opens });
          const frozen = yield* world.snapshotWhere(
            (snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen",
          );
          const interrupts = yield* sentKind(world, "interrupt");
          assert.deepStrictEqual(
            [frozen.crewmates[0]!.lane?.state, interrupts.map((entry) => entry.chat)],
            ["frozen", [thread]],
          );
        }),
      ),
  );

  it.live("a self-deploy that lost a copy's branch unfreezes the service and names the loss", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.deploy("started");
        yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        NodeFS.rmSync(NodePath.join(world.root, ".crew/backend"), { recursive: true });
        git(world.root, ["worktree", "prune"]);
        git(world.root, ["branch", "-D", "-q", "crew/backend"]);
        yield* world.deploy("finished");
        const after = yield* world.snapshotWhere(
          (snapshot) => snapshot.lastError?.includes("crew/backend") === true,
        );
        assert.isFalse(after.crewmates[0]!.lane?.state === "frozen");
        yield* onV1(world, (v1) =>
          Effect.gen(function* () {
            const lane = yield* v1.v1.run(
              Effect.flatMap(CrewStore, (store) => store.getLane(CREW_ID, "backend")),
            );
            assert.isNull(Option.getOrThrow(lane).frozenSince);
          }).pipe(Effect.orDie),
        );
      }),
    ),
  );

  it.live("a restart during a self-deploy does not leave the service frozen", () =>
    crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.deploy("started");
          yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "ready");
          yield* pressWhenFree(world, {
            _tag: "message",
            handle: "backend",
            text: "Work",
            attachments: [],
          });
          yield* world.snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "working");
          assert.strictEqual((yield* turnsSent(world)).length, 1);
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
    crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.deploy("started");
          yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.deployState(processes);
          yield* world.serverReady;
          const held = yield* world.snapshotWhere(
            (snapshot) => snapshot.lastError?.includes(words) === true,
          );
          assert.strictEqual(held.crewmates[0]!.lane?.state, "frozen");
          yield* world.deployState([]);
          const thawed = yield* world.snapshotWhere(
            (snapshot) => snapshot.crewmates[0]!.lane?.state === "ready",
          );
          assert.isNull(thawed.lastError);
        }),
    ]),
  );

  it.live("a restart leaves a frozen host's interrupted work untouched until its deploy ends", () =>
    crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* firstTurn(world, () => write(world.root, ".crew/backend/a.txt", "work\n"));
          yield* world.deploy("started");
          yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        }),
      (world) =>
        Effect.gen(function* () {
          const copy = NodePath.join(world.root, ".crew/backend");
          yield* world.deployState([{ serviceStacks: [{ name: "appdev" }], status: "RUNNING" }]);
          yield* world.serverReady;
          yield* world.snapshotWhere(
            (snapshot) => snapshot.lastError?.includes("still redeploying") === true,
          );
          yield* Effect.sleep("500 millis");
          const head = git(copy, ["rev-parse", "HEAD"]);
          assert.deepStrictEqual(
            [(yield* turnsSent(world)).length, git(copy, ["status", "--porcelain"])],
            [1, "?? a.txt"],
          );
          yield* world.deployState([]);
          yield* eventually(Effect.map(turnsSent(world), (turns) => turns.length === 2));
          assert.notStrictEqual(git(copy, ["rev-parse", "HEAD"]), head);
        }),
    ]),
  );

  it.live("an unreadable redeploy is asked less and less, then offered to the person to thaw", () =>
    crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.deploy("started");
          yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.deployState("unreadable");
          yield* world.serverReady;
          const offered = yield* world.snapshotWhere((snapshot) =>
            snapshot.attention.some((need) => need.kind === "deploy-unreadable"),
          );
          // Asked at boot, then after 50, 100, 200, 200 ms: a handful, not one every tick.
          assert.isAtMost(yield* world.deployReads, 8);
          const frames = yield* world.frames.pipe(
            Stream.interruptWhen(Effect.sleep("700 millis")),
            Stream.runCount,
          );
          // Nothing moved meanwhile: the feed holds still, its current frame alone.
          assert.isAtMost(frames, 1);
          assert.strictEqual(
            offered.attention.find((need) => need.kind === "deploy-unreadable")!.host,
            TEST_HOST,
          );
          yield* world.press({ _tag: "thawHost", host: TEST_HOST });
          yield* world.snapshotWhere(
            (snapshot) =>
              snapshot.crewmates[0]!.lane?.state === "ready" &&
              !snapshot.attention.some((need) => need.kind === "deploy-unreadable"),
          );
          // Thawed, it stops asking.
          const after = yield* world.deployReads;
          yield* Effect.sleep("600 millis");
          assert.strictEqual(yield* world.deployReads, after);
        }),
    ]),
  );

  it.live(
    "a deploy's end recovers the copies before it thaws: a press meanwhile waits its turn",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.deploy("started");
          yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen");
          const hold = yield* world.hold({ step: "recover" });
          yield* world.deploy("finished");
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
          assert.isTrue(press.pollUnsafe() === undefined);
          yield* onV1(world, (v1) =>
            Effect.gen(function* () {
              const lane = yield* v1.v1.run(
                Effect.flatMap(CrewStore, (store) => store.getLane(CREW_ID, "backend")),
              );
              assert.isTrue(Option.getOrThrow(lane).frozenSince !== null);
            }).pipe(Effect.orDie),
          );
          yield* hold.release;
          yield* Fiber.join(press);
          yield* world.snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "working");
        }),
      ),
  );

  // A conversation's stored worktree path is V1's thread's: the engine resolves a crewmate's
  // workspace from its copy each time, so nothing drifts to put back (the owner, 2026-10-08:
  // V1's mechanism goes at cutover).
  it.live.skipIf(CREW_WORLD !== "v1")(
    "a writer's conversation without its copy as its worktree gets it back at boot",
    () =>
      crewJourney([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            yield* eventually(Effect.map(opened(world), (creates) => creates.length > 0));
            const created = (yield* opened(world)).find((entry) => entry.handle === "backend")!;
            yield* world.chatWas(created.chat, { worktreePath: null });
          }),
        (world) =>
          Effect.gen(function* () {
            yield* world.serverReady;
            const created = (yield* opened(world)).find((entry) => entry.handle === "backend")!;
            yield* eventually(Effect.map(sentKind(world, "copy"), (updates) => updates.length > 0));
            const [update] = yield* sentKind(world, "copy");
            assert.deepStrictEqual(
              [update?.chat, update?.path, created.copy?.endsWith("/.crew/backend")],
              [created.chat, created.copy, true],
            );
          }),
      ]),
  );

  {
    const path = "/chosen/copy";
    // V1's thread worktree a person chose: an engine crewmate's conversation has no path of its
    // own to choose (the owner, 2026-10-08: V1's mechanism goes at cutover).
    it.live.skipIf(CREW_WORLD !== "v1")(
      "boot keeps a conversation path a person chose and offers a selected crew copy",
      () =>
        crewJourney([
          (world) =>
            Effect.gen(function* () {
              yield* applied(world);
              yield* world.press({
                _tag: "message",
                handle: "backend",
                text: "Work",
                attachments: [],
              });
              const [created] = yield* opened(world);
              yield* world.chatWas(created!.chat, { worktreePath: path });
            }),
          (world) =>
            Effect.gen(function* () {
              yield* world.serverReady;
              const snapshot = yield* world.snapshotWhere((frame) =>
                frame.attention.some((row) => row.kind === "conversation-copy"),
              );
              assert.deepStrictEqual(yield* sentKind(world, "copy"), []);
              const need = snapshot.attention.find((row) => row.kind === "conversation-copy")!;
              const [created] = yield* opened(world);
              assert.deepStrictEqual(need.copyAssignment, {
                threadId: ThreadId.make(created!.chat),
                currentPath: path,
                crewPath: created!.copy!,
                source: "crew-stint",
              });
              // The restart's turn carries on first; the press waits for its copy to be free.
              yield* pressWhenFree(world, {
                _tag: "useCrewCopy",
                handle: "backend",
                threadId: ThreadId.make(created!.chat),
                expectedPath: path,
              });
              const [update] = yield* sentKind(world, "copy");
              assert.deepStrictEqual([update?.path, update?.expected], [created!.copy, path]);
              yield* world.chatWas(created!.chat, { worktreePath: "/new/choice" });
              const error = yield* Effect.flip(
                world.press({
                  _tag: "useCrewCopy",
                  handle: "backend",
                  threadId: ThreadId.make(created!.chat),
                  expectedPath: path,
                }),
              );
              assert.strictEqual(error.reason, "wrong-state");
              assert.strictEqual((yield* sentKind(world, "copy")).length, 1);
            }),
        ]),
    );
  }

  it.live(
    "after a restart: policies install at once, the resume waits for readiness, a died turn carries on",
    () => {
      let turnsBefore = 0;
      return crewJourney([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            yield* world.press({
              _tag: "message",
              handle: "backend",
              text: "Long work",
              attachments: [],
            });
            const [created] = yield* opened(world);
            yield* world.chatWas(created!.chat, { running: true });
            turnsBefore = (yield* turnsSent(world)).length;
          }),
        (world) =>
          Effect.gen(function* () {
            assert.strictEqual(yield* world.profileInstalls, 2);
            yield* Effect.sleep("300 millis");
            assert.strictEqual((yield* turnsSent(world)).length, turnsBefore);
            yield* world.serverReady;
            yield* eventually(
              Effect.map(turnsSent(world), (turns) => turns.length === turnsBefore + 1),
            );
            // Its turn died: it carries on in the attempt it stood in, never a forced rework.
            const snapshot = yield* world.snapshotWhere(
              (current) =>
                current.board.tasks[0]?.attempts === 1 &&
                current.board.tasks[0]?.state === "working" &&
                current.attention.length === 0,
            );
            assert.deepStrictEqual(
              [
                (yield* turnsSent(world)).length,
                yield* lastAdmitted(world),
                snapshot.lastError,
                snapshot.attention,
              ],
              [turnsBefore + 1, AS_CREW, null, []],
            );
            const resumed = (yield* turnsSent(world)).at(-1)!;
            assert.include(resumed.text, "Continue where you stopped");
            const thread = snapshot.crewmates[0]!.currentThreadId!;
            const member = yield* world.member(thread);
            assert.isTrue(Option.getOrThrow(member).live);
          }),
      ]);
    },
  );

  it.live("a subscription reads the tables only: the feed opens no ssh", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* eventually(
          Effect.gen(function* () {
            const settled = yield* world.serviceSessions;
            yield* Effect.sleep("200 millis");
            return settled === (yield* world.serviceSessions);
          }),
        );
        const before = yield* world.serviceSessions;
        const frames = yield* world.frames.pipe(Stream.take(1), Stream.runCollect);
        assert.deepStrictEqual([frames.length, (yield* world.serviceSessions) - before], [1, 0]);
      }),
    ),
  );

  it.live("with no crew applied the engine opens no ssh at all", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* world.frames.pipe(Stream.take(1), Stream.runCollect);
        yield* Effect.sleep("300 millis");
        assert.strictEqual(yield* world.serviceSessions, 0);
      }),
    ),
  );

  it.live(
    "Start fresh rotates between turns; Save and apply now interrupts, rotates and continues",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          const busy = yield* Effect.flip(world.press({ _tag: "startFresh", handle: "backend" }));
          world.writeHome({ "brief.md": "Ship it by Friday.\n" });
          yield* world.press({ _tag: "briefSave", apply: "now" });
          const interrupts = (yield* sentKind(world, "interrupt")).map((entry) => entry.chat);
          yield* world.turnEnds(thread, { state: "interrupted" });
          yield* eventually(Effect.map(opened(world), (creates) => creates.length === 2));
          yield* eventually(
            Effect.map(turnsSent(world), (turns) => turns.at(-1)!.text.includes("· continue")),
          );
          const continued = (yield* turnsSent(world)).at(-1)!;
          const creates = yield* opened(world);
          yield* world.turnEnds(continued.chat);
          yield* eventually(
            world.press({ _tag: "startFresh", handle: "backend" }).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
          );
          const sessions = yield* world.sessionsWhere("backend", (seen) => seen.count === 3);
          const snapshot = yield* world.snapshot;
          const fresh = (yield* opened(world)).at(-1)!;
          const seams = yield* seamsOf(world);
          // V1 opens a stint in a conversation of its own and says so in a seam; the engine's
          // session boundary is its own record's.
          yield* onV1(world, () =>
            Effect.sync(() =>
              assert.deepStrictEqual(
                seams.filter(([, , seam]) => (seam as { seam?: string }).seam === "stint"),
                [
                  [
                    fresh.chat,
                    "You cleared its conversation",
                    { seam: "stint", previousThreadId: creates[1]!.chat },
                  ],
                ],
              ),
            ),
          );
          assert.deepStrictEqual(
            {
              seams: seams.filter(([, , seam]) => (seam as { seam?: string }).seam !== "stint"),
              busy: busy.reason,
              interrupts,
              continueIn: continued.chat === creates[1]!.chat,
              continueAs: yield* lastAdmitted(world),
              reasons: sessions.reasons,
              brief: snapshot.crew?.briefVersion,
            },
            {
              seams: [
                [thread, "The crew's goal changed — from now on", { seam: "saved", apply: "now" }],
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.logins(
          new Map([["claudeAgent_work", mateLogin("claudeAgent_work", "claude-code", "work")]]),
        );
        world.writeHome({
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
          world.press({ _tag: "jobSave", handle: "backend", apply: "nextTurn" }),
        );
        yield* world.press({ _tag: "jobSave", handle: "backend", apply: "fresh" });
        const snapshot = yield* world.snapshotWhere(
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/x.txt", "x\n"),
        );
        yield* world.turnEnds(thread);
        yield* world.snapshotWhere((snapshot) => snapshot.crewmates[0]!.lane?.ahead === 1);
        const kept = yield* Effect.flip(
          world.press({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: false }),
        );
        yield* world.press({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: true });
        const snapshot = yield* world.snapshotWhere((current) => current.crewmates.length === 0);
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
      crewJourney((world) =>
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
          world.writeHome({
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
          yield* world.press({ _tag: "apply" });
          yield* world.snapshotWhere(everyCopyReady);
          const ports = yield* world.press({ _tag: "addCrewPorts", host: "appdev", count: 2 });
          yield* world.press({ _tag: "appRun", handle: "backend" });
          const running = yield* world.snapshotWhere(
            (current) => current.crewmates[0]!.app?.state === "running",
          );
          yield* world.press({ _tag: "appStop", handle: "backend" });
          const stopped = yield* world.snapshotWhere(
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
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          write(world.root, "notes.txt", "mine\n");
          git(world.root, ["branch", "crew/ghost"]);
          git(world.root, ["commit", "-q", "--allow-empty", "-m", "ahead of ghost"]);
          const draft = yield* world.press({ _tag: "deliverDraft" });
          const orphans = yield* world.press({ _tag: "orphanScan" });
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
      return crewJourney((world) =>
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
          const asked = yield* world.showOnDev(thread, { reason: "see the HUD" });
          yield* world.turnEnds(thread);
          const requested = yield* world.snapshotWhere((snapshot) =>
            snapshot.attention.some((row) => row.kind === "show-on-dev"),
          );
          const turnsBefore = (yield* turnsSent(world)).length;
          yield* eventually(
            world.press({ _tag: "claimGrant", host: "appdev" }).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
          );
          // The claim's turn goes out a moment after the press: its session is read once it has.
          yield* eventually(Effect.map(turnsSent(world), (turns) => turns.length > turnsBefore));
          yield* world.turnStarts(thread);
          const claimTurn = (yield* turnsSent(world)).at(-1)!;
          const shaped = Option.getOrThrow(yield* world.member(thread)).gate;
          started.push(startDevServer(world, NodePath.join(world.root, ".crew/backend")));
          yield* world.turnEnds(thread);
          const held = yield* world.snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "held",
          );
          const gate = Option.getOrThrow(yield* world.member(thread)).gate;
          const blocked = yield* Effect.flip(
            world.press({ _tag: "landNow", taskId: held.board.tasks[0]!.id }),
          );
          yield* world.press({ _tag: "claimRelease", host: "appdev" });
          const releaseTurn = (yield* turnsSent(world)).at(-1)!;
          started.push(startDevServer(world, world.root));
          yield* world.turnEnds(thread);
          const released = yield* world.snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "none",
          );
          assert.deepStrictEqual(
            {
              asked: asked.isError,
              attention: requested.attention
                .filter((row) => row.kind === "show-on-dev")
                .map((row) => [row.host, row.text]),
              claimCard: claimTurn.text.split("\n")[1],
              claimWorkDir: claimTurn.text.includes(`workDir=${world.root}/.crew/backend`),
              shaped: shaped.kind === "live" ? [shaped.turn, shaped.devServer?.port] : null,
              served: held.hosts[0]!.served,
              holdsClaim: gate.kind === "live" && gate.holdsClaim,
              blocked: blocked.reason,
              releaseCard: releaseTurn.text.split("\n")[1],
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
    crewJourney((world) =>
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
        world.writeHome({
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
        yield* world.press({ _tag: "apply" });
        yield* world.snapshotWhere(everyCopyReady);
        const thread = yield* firstTurn(world, () => undefined);
        yield* world.showOnDev(thread, { reason: "See the camera" });
        yield* world.snapshotWhere((snapshot) => snapshot.hosts[0]?.claim.state === "requested");
        yield* world.press({ _tag: "claimGrant", host: TEST_HOST });
        yield* world.turnEnds(thread);
        const failed = yield* world.snapshotWhere((snapshot) => snapshot.lastError !== null);
        const refused = yield* Effect.flip(world.press({ _tag: "claimGrant", host: TEST_HOST }));
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
    return crewJourney([
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
          yield* world.showOnDev(thread, { reason: "See the camera" });
          yield* world.snapshotWhere((snapshot) => snapshot.hosts[0]?.claim.state === "requested");
          yield* world.press({ _tag: "claimGrant", host: TEST_HOST });
          yield* world.snapshotWhere((snapshot) => snapshot.hosts[0]!.claim.grantWaiting);
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          const starting = yield* world.snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
          );
          // The claim reads starting a moment before its turn is dispatched.
          yield* eventually(
            Effect.map(turnsSent(world), (turns) =>
              turns.at(-1)!.text.includes("Show your work on appdev"),
            ),
          );
          assert.deepStrictEqual(
            [
              starting.hosts[0]!.claim,
              (yield* turnsSent(world)).at(-1)!.text.split("\n")[1],
              yield* lastAdmitted(world),
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
      return crewJourney((world) =>
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
          yield* world.showOnDev(thread, { reason: "See the camera" });
          yield* world.snapshotWhere((snapshot) => snapshot.hosts[0]?.claim.state === "requested");
          yield* world.press({ _tag: "claimGrant", host: TEST_HOST });
          const waiting = yield* world.snapshotWhere(
            (snapshot) => snapshot.hosts[0]!.claim.grantWaiting,
          );
          const turnsWhileRunning = (yield* turnsSent(world)).length;
          yield* world.turnEnds(thread);
          const starting = yield* world.snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
          );
          // The claim reads starting a moment before its turn is dispatched.
          yield* eventually(
            Effect.map(turnsSent(world), (turns) =>
              turns.at(-1)!.text.includes("Show your work on appdev"),
            ),
          );
          const turns = yield* turnsSent(world);
          assert.deepStrictEqual(
            [
              waiting.hosts[0]!.claim,
              turns.length - turnsWhileRunning,
              starting.hosts[0]!.claim,
              turns.at(-1)!.text.split("\n")[1],
              yield* lastAdmitted(world),
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
    return crewJourney((world) =>
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
        yield* world.press({ _tag: "showOnDev", handle: "backend" });
        const turnsWhileRunning = (yield* turnsSent(world)).length;
        yield* world.turnEnds(thread);
        const starting = yield* world.snapshotWhere(
          (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
        );
        // The claim reads starting a moment before its turn is dispatched.
        yield* eventually(
          Effect.map(turnsSent(world), (turns) =>
            turns.at(-1)!.text.includes("Show your work on appdev"),
          ),
        );
        const turns = yield* turnsSent(world);
        assert.deepStrictEqual(
          [
            turns.length - turnsWhileRunning,
            starting.hosts[0]!.claim.handle,
            turns.at(-1)!.text.split("\n")[1],
            yield* lastAdmitted(world),
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
    return crewJourney((world) =>
      Effect.gen(function* () {
        write(
          world.root,
          "zerops.yaml",
          "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
        );
        git(world.root, ["add", "-A"]);
        git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
        yield* applied(world);
        yield* world.press({
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
        yield* world.showOnDev(thread, { reason: "See the camera" });
        const admittedBefore = (yield* world.admissions).length;
        yield* world.turnEnds(thread);
        const starting = yield* world.snapshotWhere(
          (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
        );
        // The claim reads starting a moment before its turn is dispatched; the turn's admission
        // is recorded as its run starts, a moment after it went out.
        yield* eventually(
          Effect.map(turnsSent(world), (turns) =>
            turns.at(-1)!.text.includes("Show your work on appdev"),
          ),
        );
        yield* eventually(
          Effect.map(world.admissions, (admitted) => admitted.length > admittedBefore),
        );
        assert.deepStrictEqual(
          [
            starting.hosts[0]!.claim.handle,
            (yield* turnsSent(world)).at(-1)!.text.split("\n")[1],
            yield* lastAdmitted(world),
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
    return crewJourney((world) =>
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
        yield* world.press({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
        const [created] = yield* opened(world);
        yield* world.turnEnds(created!.chat);
        yield* eventually(
          world.press({ _tag: "showOnDev", handle: "backend" }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
        );
        const starting = yield* world.snapshotWhere(
          (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
        );
        // The claim reads starting a moment before its turn is dispatched.
        yield* eventually(
          Effect.map(turnsSent(world), (turns) =>
            turns.at(-1)!.text.includes("Show your work on appdev"),
          ),
        );
        assert.deepStrictEqual(
          [
            starting.hosts[0]!.claim.handle,
            (yield* turnsSent(world)).at(-1)!.text.split("\n")[1],
            yield* lastAdmitted(world),
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
      crewJourney(
        (world) =>
          Effect.gen(function* () {
            const before = yield* world.toolProfilesInstalled;
            yield* applied(world);
            const thread = yield* firstTurn(world, () => undefined);
            yield* world.turnEnds(thread);
            assert.isTrue(yield* world.toolProfilesInstalled);
            const profileOf = world.toolProfile;
            const live = yield* profileOf(thread);
            const person = yield* profileOf("person-thread");
            yield* eventually(
              world.press({ _tag: "startFresh", handle: "backend" }).pipe(
                Effect.as(true),
                Effect.orElseSucceed(() => false),
              ),
            );
            const retired = yield* profileOf(thread);
            assert.deepStrictEqual(
              {
                before: !before,
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
        { toolProfiles: true },
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
    crewJourney((world) =>
      Effect.gen(function* () {
        world.writeHome({
          "crew.yaml": twoCrewmates(lead, writer),
          "jobs/lead.md": "Plan the work.\n",
        });
        const refused = yield* Effect.flip(world.press({ _tag: "apply" }));
        assert.deepStrictEqual(
          [refused.reason, refused.detail?.startsWith(words)],
          ["invalid-definition", true],
        );
      }),
    ),
  );

  it.live("an agent not live yet when the engine boots gets its crew tools once it is", () =>
    crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Start",
            attachments: [],
          });
          yield* eventually(Effect.map(opened(world), (creates) => creates.length > 0));
          yield* world.agentsNotLive(new Set(["claudeAgent"]));
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.agentsNotLive(new Set());
          const created = (yield* opened(world)).find((entry) => entry.handle === "backend")!;
          const member = Option.getOrThrow(yield* world.member(created.chat));
          assert.deepStrictEqual([member.prompt.crewTools, member.prompt.memory], [true, true]);
        }),
    ]),
  );

  const NO_SPEND = "Grok doesn't report what it spends, so this crew can't keep a budget";

  it.live(
    "a run's dollar budget is refused while a crewmate's agent doesn't report its spend",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          world.writeHome({
            "crew.yaml": twoCrewmates("claudeAgent", "grok"),
            "jobs/lead.md": "Plan the work.\n",
          });
          yield* world.press({ _tag: "apply" });
          yield* eventually(Effect.map(world.snapshot, everyCopyReady));
          const budgeted = yield* Effect.flip(world.press({ ...RUN_NOW, budgetUsd: 20 }));
          yield* world.press(RUN_NOW);
          const run = (yield* world.snapshotWhere((snapshot) => snapshot.run !== null)).run!;
          yield* world.press({ _tag: "pause", runId: run.id });
          yield* world.snapshotWhere((snapshot) => snapshot.run?.state === "paused");
          const resumed = yield* Effect.flip(
            world.press({ _tag: "resume", runId: run.id, budgetUsd: 20 }),
          );
          assert.deepStrictEqual(
            [budgeted.detail?.startsWith(NO_SPEND), resumed.detail?.startsWith(NO_SPEND)],
            [true, true],
          );
        }),
      ),
  );

  it.live("Apply refuses a crewmate on an agent that doesn't report its spend under a budget", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        world.writeHome({
          "crew.yaml": twoCrewmates("claudeAgent", "claudeAgent"),
          "jobs/lead.md": "Plan the work.\n",
        });
        yield* world.press({ _tag: "apply" });
        yield* eventually(Effect.map(world.snapshot, everyCopyReady));
        yield* world.press({ ...RUN_NOW, budgetUsd: 20 });
        yield* world.snapshotWhere((snapshot) => snapshot.run !== null);
        world.writeHome({
          "crew.yaml": twoCrewmates("claudeAgent", "grok"),
          "jobs/lead.md": "Plan the work.\n",
        });
        const refused = yield* Effect.flip(world.press({ _tag: "apply" }));
        const ownRefused = yield* Effect.flip(
          world.press({ _tag: "jobSave", handle: "backend", apply: "fresh" }),
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
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* world.logins(new Map([["codex_work", mateLogin("codex_work", "codex", "work")]]));
          world.writeHome({
            "crew.yaml": twoCrewmates("claudeAgent", "codex_work"),
            "jobs/lead.md": "Plan the work.\n",
          });
          yield* world.press({ _tag: "apply" });
          yield* world.snapshotWhere(everyCopyReady);
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Start",
            attachments: [],
          });
          const created = (yield* opened(world)).find((entry) => entry.handle === "backend")!;
          const member = Option.getOrThrow(yield* world.member(created.chat));
          const snapshot = yield* world.snapshot;
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
    crewJourney((world) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(
          [yield* world.readFiles, (yield* world.snapshot).status],
          [{ files: [] }, "none"],
        );
      }),
    ),
  );

  it.live(
    "the dev services this Mate mounts show before any crew; opening the crew home reads their databases",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          const before = yield* world.snapshotWhere((current) => current.devHosts.length > 0);
          const sshBefore = yield* world.serviceSessions;
          yield* world.readFiles;
          const read = yield* world.snapshotWhere(
            (current) => current.devHosts[0]?.database !== null,
          );
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
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Start",
            attachments: [],
          });
          const [created] = yield* opened(world);
          const snapshot = yield* world.snapshotWhere(
            (current) => current.hosts[0]?.integration !== null,
          );
          assert.deepStrictEqual(
            [created!.copy, snapshot.hosts[0]!.integration],
            [
              `${world.root}/.crew/backend`,
              { branch: "main", head: git(world.root, ["rev-parse", "HEAD"]) },
            ],
          );
        }),
      ),
  );

  it.live("Try again on a stopped task queues it for its next attempt and starts it", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/.env", "SECRET=1\n"),
        );
        yield* world.turnEnds(thread);
        // The guard left the file uncommitted: the copy reads dirty with nothing ahead.
        const parked = yield* world.snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "parked" &&
            current.crewmates[0]!.lane?.dirty === true,
        );
        NodeFS.rmSync(NodePath.join(world.root, ".crew/backend/.env"));
        yield* world.press({ _tag: "taskRetry", taskId: parked.board.tasks[0]!.id });
        const retried = yield* world.snapshotWhere(
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
