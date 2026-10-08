import { assert, describe, it } from "@effect/vitest";
import type { CrewRunOptions, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { CREW_ID } from "./CrewHome.ts";
import { CrewThreadDirectory, CrewToolHost, type CrewThreadMember } from "./crewSeams.ts";
import { CrewStore } from "./CrewStore.ts";
import { ServerCommandReadiness } from "../../spi/serverCommandReadiness.ts";
import {
  eventually,
  drained,
  booted,
  spiEvent,
  withCrewEngine,
  withCrewEngines,
  writeCrewHome,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import {
  command,
  dispatchedOf,
  everyCopyReady,
  firstTurn,
  latest,
  reportDone,
  seamsOf,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { git, read, write } from "./testing/crewGitFixture.ts";

const RUN: CrewRunOptions = {
  budgetUsd: "unlimited",
  timeLimitHours: "unlimited",
  stopAtUsagePercent: null,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

/** A crew with a lead and a writer, applied; the writer's check is `check`, none when null. */
const withLead = (world: CrewWorld, check: string | null = "test -f ok.txt") =>
  Effect.gen(function* () {
    writeCrewHome(world.workspace, {
      "crew.yaml": [
        "name: Game team",
        "briefTitle: Space shooter",
        "members:",
        "  - handle: lead",
        "    displayName: Lead",
        "    kind: lead",
        "  - handle: backend",
        "    displayName: Backend",
        "    host: appdev",
        ...(check === null ? [] : [`    check: ${check}`]),
        "",
      ].join("\n"),
      "jobs/lead.md": "Plan the work.\n",
    });
    yield* command({ _tag: "apply" });
    yield* snapshotWhere(everyCopyReady);
  });

const startRun = (options: Partial<CrewRunOptions> = {}) =>
  command({ _tag: "start", ...RUN, ...options });

/** The lead's conversation, once the engine opened one. */
const leadThread = (world: CrewWorld) =>
  Effect.gen(function* () {
    yield* eventually(
      Effect.map(dispatchedOf(world, "thread.crew.create"), (creates) =>
        creates.some((entry) => entry.crew.crewmate === "lead"),
      ),
    );
    return (yield* dispatchedOf(world, "thread.crew.create")).find(
      (entry) => entry.crew.crewmate === "lead",
    )!.threadId;
  });

const memberOf = (thread: ThreadId) =>
  Effect.map(
    Effect.flatMap(CrewThreadDirectory, (directory) => directory.memberFor(thread)),
    (member): CrewThreadMember => Option.getOrThrow(member),
  );

const lastTurnText = (world: CrewWorld, thread: ThreadId) =>
  Effect.map(
    dispatchedOf(world, "thread.turn.start"),
    (turns) => turns.findLast((turn) => turn.threadId === thread)?.message.text ?? "",
  );

/** Turns sent into the lead's conversation. */
const wakes = (world: CrewWorld, lead: ThreadId) =>
  Effect.map(
    dispatchedOf(world, "thread.turn.start"),
    (turns) => turns.filter((turn) => turn.threadId === lead).length,
  );

/** The engine woke the lead with a card that says `words`. */
const wokenWith = (world: CrewWorld, lead: ThreadId, words: string) =>
  eventually(Effect.map(lastTurnText(world, lead), (text) => text.includes(words)));

/** The lead's turn ends with `reply` as its last message. */
const leadReplies = (world: CrewWorld, thread: ThreadId, reply: string) =>
  Effect.gen(function* () {
    yield* world.publish(spiEvent("turn.started", thread, {}));
    yield* world.publish(
      spiEvent("content.delta", thread, { streamKind: "assistant_text", delta: reply }),
    );
    yield* world.publish(
      spiEvent("item.completed", thread, { itemType: "assistant_message", status: "completed" }),
    );
    yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
  });

const PLAN = [
  { owner: "backend", title: "Camera", brief: "Follow the player.", doneWhen: "npm test passes" },
  { owner: "backend", title: "HUD", brief: "Show the score.", dependsOn: ["Camera"] },
];

describe("CrewEngine lead", () => {
  it.live("Apply opens each crewmate's first conversation, without a turn", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        const opened = yield* snapshotWhere((current) =>
          current.crewmates.every((mate) => mate.currentThreadId !== null),
        );
        const creates = yield* dispatchedOf(world, "thread.crew.create");
        assert.deepStrictEqual(
          {
            opened: opened.crewmates.map((mate) => [
              mate.handle,
              mate.currentThreadId ===
                creates.find((entry) => entry.crew.crewmate === mate.handle)?.threadId,
              mate.stints.map((stint) => [stint.state, stint.reason]),
            ]),
            turns: (yield* dispatchedOf(world, "thread.turn.start")).length,
            worktree: creates
              .find((entry) => entry.crew.crewmate === "backend")
              ?.worktreePath?.endsWith("/.crew/backend"),
          },
          {
            opened: [
              ["lead", true, [["open", null]]],
              ["backend", true, [["open", null]]],
            ],
            turns: 0,
            worktree: true,
          },
        );
      }),
    ),
  );

  it.live("a message to the lead is a turn of its own, never a task", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const thread = yield* leadThread(world);
        assert.deepStrictEqual(
          [yield* lastTurnText(world, thread), (yield* latest).board.tasks],
          ["Plan it", []],
        );
      }),
    ),
  );

  it.live("crew_propose puts a plan on the board; Start queues it and only a run starts it", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* memberOf(yield* leadThread(world));
        const answer = yield* (yield* CrewToolHost).propose(lead, PLAN);
        const proposed = yield* snapshotWhere((current) => current.board.tasks.length === 2);
        yield* command({
          _tag: "planAccept",
          taskIds: [proposed.board.tasks[0]!.id, proposed.board.tasks[1]!.id],
        });
        const accepted = yield* snapshotWhere((current) =>
          current.board.tasks.every((task) => task.state === "queued"),
        );
        const beforeRun = (yield* dispatchedOf(world, "thread.turn.start")).length;
        yield* startRun();
        const running = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          {
            answer: answer.text.startsWith("Proposed #1 Camera (@backend), #2 HUD (@backend)"),
            proposed: proposed.board.tasks.map((task) => [task.state, task.source]),
            plan: proposed.attention.map((row) => [row.id, row.kind, row.handle]),
            dependsOn: proposed.board.tasks[1]!.dependsOn,
            accepted: [accepted.attention.length, beforeRun],
            running: running.board.tasks.map((task) => task.state),
          },
          {
            answer: true,
            proposed: [
              ["proposed", "lead"],
              ["proposed", "lead"],
            ],
            plan: [["plan:lead", "plan", "lead"]],
            dependsOn: [proposed.board.tasks[0]!.id],
            accepted: [0, 1],
            running: ["working", "queued"],
          },
        );
      }),
    ),
  );

  it.live("a run that lets the lead start tasks queues its plan and starts it", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun({ leadMayStart: true });
        yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* memberOf(yield* leadThread(world));
        yield* (yield* CrewToolHost).propose(lead, PLAN);
        const running = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          [running.board.tasks.map((task) => task.state), running.attention],
          [["working", "queued"], []],
        );
      }),
    ),
  );

  it.live("in a run the lead lands, a passed check wakes the lead; its accept lands the task", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun({ landing: "lead" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const inReview = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "review",
        );
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "review @backend's work");
        const wake = yield* lastTurnText(world, lead);
        const answer = yield* (yield* CrewToolHost).review(yield* memberOf(lead), {
          task: 1,
          verdict: "accept",
          note: "Looks right.",
        });
        const landed = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "landed",
        );
        assert.deepStrictEqual(
          {
            review: inReview.board.tasks[0]!.state,
            wake: wake.includes("review @backend's work") && wake.includes("crew_review"),
            answer: answer.text,
            verdict: landed.board.tasks[0]!.review,
            tree: read(world.root, "ok.txt"),
          },
          {
            review: "review",
            wake: true,
            answer: "Accepted — landing…",
            verdict: { verdict: "accept", note: "Looks right.", by: "lead" },
            tree: "ok\n",
          },
        );
      }),
    ),
  );

  it.live(
    "the rig: a review whose wake a stopped run cut off wakes the lead at the next Start; its accept moves the queue",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun({ budgetUsd: 3, landing: "lead" });
          const stopped = (yield* snapshotWhere((current) => current.run?.state === "running")).run!
            .id;
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          for (const title of ["Health check", "Metrics"]) {
            yield* command({
              _tag: "taskCreate",
              owner: "backend",
              title,
              brief: title,
              doneWhen: "",
              dependsOn: [],
            });
          }
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          yield* world.publish(spiEvent("turn.started", lead, {}));
          yield* command({ _tag: "stop", runId: stopped });
          yield* world.publish(spiEvent("turn.completed", lead, { state: "interrupted" }));
          yield* snapshotWhere((current) => current.run?.state === "stopped");
          const before = yield* wakes(world, lead);
          yield* startRun({ budgetUsd: 0.5, landing: "lead" });
          yield* eventually(Effect.map(wakes(world, lead), (count) => count === before + 1));
          const waiting = (yield* latest).board.tasks.map((task) => task.state);
          yield* world.publish(spiEvent("turn.started", lead, {}));
          yield* (yield* CrewToolHost).review(yield* memberOf(lead), {
            task: 1,
            verdict: "accept",
            note: "Looks right.",
          });
          yield* world.publish(spiEvent("turn.completed", lead, { state: "completed" }));
          const moved = yield* snapshotWhere(
            (current) =>
              current.board.tasks[0]?.state === "landed" &&
              current.board.tasks[1]?.state === "working",
          );
          assert.deepStrictEqual(
            {
              waiting,
              wake: (yield* lastTurnText(world, lead)).includes("review @backend's work"),
              moved: moved.board.tasks.map((task) => task.state),
            },
            {
              waiting: ["review", "queued", "queued"],
              wake: true,
              moved: ["landed", "working", "queued"],
            },
          );
        }),
      ),
  );

  it.live(
    "without a run a review left waiting names itself in Waiting on you; Land it myself lands it",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun({ landing: "lead" });
          const runId = (yield* snapshotWhere((current) => current.run?.state === "running")).run!
            .id;
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          yield* world.publish(spiEvent("turn.started", lead, {}));
          yield* command({ _tag: "stop", runId });
          yield* world.publish(spiEvent("turn.completed", lead, { state: "interrupted" }));
          yield* snapshotWhere((current) => current.run?.state === "stopped");
          // The review has waited ten minutes with nobody on it.
          const store = yield* CrewStore;
          const task = (yield* store.assignments(CREW_ID))[0]!;
          yield* store.putAssignment({ ...task, updatedAt: "2026-09-28T07:00:00.000Z" });
          const waiting = yield* snapshotWhere((current) => current.attention.length > 0);
          yield* command({ _tag: "land", taskId: task.assignment });
          const landed = yield* snapshotWhere(
            (current) => current.board.tasks[0]?.state === "landed",
          );
          assert.deepStrictEqual(
            {
              waiting: waiting.attention.map((row) => [row.kind, row.handle, row.taskId, row.at]),
              review: landed.board.tasks[0]!.review,
              tree: read(world.root, "ok.txt"),
            },
            {
              waiting: [["review-wait", "backend", task.assignment, "2026-09-28T07:00:00.000Z"]],
              review: { verdict: "accept", note: "", by: null },
              tree: "ok\n",
            },
          );
        }),
      ),
  );

  it.live(
    "without a run a task the review sent back names itself; asking its crewmate reworks it",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun({ landing: "lead" });
          const runId = (yield* snapshotWhere((current) => current.run?.state === "running")).run!
            .id;
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          yield* command({ _tag: "stop", runId });
          yield* snapshotWhere((current) => current.run?.state === "stopped");
          const task = (yield* latest).board.tasks[0]!;
          yield* command({
            _tag: "review",
            taskId: task.id,
            verdict: "reject",
            note: "Name the file hud.ts.",
          });
          const sentBack = yield* snapshotWhere((current) => current.attention.length > 0);
          yield* command({
            _tag: "message",
            handle: "backend",
            text: "Rework #1 after its review: Name the file hud.ts.",
            attachments: [],
          });
          const reworking = yield* snapshotWhere(
            (current) => current.board.tasks[0]?.state === "working",
          );
          assert.deepStrictEqual(
            {
              sentBack: sentBack.attention.map((row) => [row.kind, row.handle, row.text]),
              reworking: [reworking.board.tasks[0]!.attempts, reworking.attention],
            },
            {
              sentBack: [["sent-back", "backend", "Name the file hud.ts."]],
              reworking: [2, []],
            },
          );
        }),
      ),
  );

  it.live(
    "the rig: an accepted review of a copy with nothing of its own closes the task, and the queue moves",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* withLead(world, null);
          yield* startRun({ budgetUsd: 3, landing: "lead" });
          const thread = yield* firstTurn(world, () => undefined);
          yield* command({
            _tag: "taskCreate",
            owner: "backend",
            title: "Health check",
            brief: "Add /health.",
            doneWhen: "",
            dependsOn: [],
          });
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          // Another landing moved your tree after the check, as on the rig.
          write(world.root, "docs/person.md", "person\n");
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "person edits"]);
          yield* world.publish(spiEvent("turn.started", lead, {}));
          const answer = yield* (yield* CrewToolHost).review(yield* memberOf(lead), {
            task: 1,
            verdict: "accept",
            note: "Nothing to change.",
          });
          yield* world.publish(spiEvent("turn.completed", lead, { state: "completed" }));
          const closed = yield* snapshotWhere(
            (current) =>
              current.board.tasks[0]?.state === "landed" &&
              current.board.tasks[1]?.state === "working",
          );
          const log = yield* (yield* CrewStore).logOf(CREW_ID, ["closed"]);
          assert.deepStrictEqual(
            {
              answer: answer.text,
              task: [closed.board.tasks[0]!.landedCommit, closed.board.tasks[0]!.delivered],
              notDelivered: closed.landedNotDelivered,
              seams: (yield* seamsOf(world)).map(([threadId, words, payload]) => [
                threadId,
                words,
                payload,
              ]),
              log: log.map((entry) => entry.payload),
            },
            {
              answer: "Accepted — #1 had no changes, closed",
              task: [null, false],
              notDelivered: 0,
              seams: [
                [
                  thread,
                  "Task #1 closed — nothing to land",
                  { seam: "closed", taskId: closed.board.tasks[0]!.id, number: 1 },
                ],
              ],
              log: [{ task: closed.board.tasks[0]!.id, reason: "nothing to land" }],
            },
          );
        }),
      ),
  );

  it.live("Resume wakes the lead again for the review its pause interrupted", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun({ landing: "lead" });
        const runId = (yield* snapshotWhere((current) => current.run?.state === "running")).run!.id;
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "review @backend's work");
        yield* world.publish(spiEvent("turn.started", lead, {}));
        yield* command({ _tag: "pause", runId });
        yield* world.publish(spiEvent("turn.completed", lead, { state: "interrupted" }));
        yield* snapshotWhere((current) => current.run?.state === "paused");
        yield* command({ _tag: "resume", runId });
        yield* eventually(Effect.map(wakes(world, lead), (count) => count === 2));
        assert.isTrue((yield* lastTurnText(world, lead)).includes("review @backend's work"));
      }),
    ),
  );

  it.live("Start lands a ready task when the run's landing lands it", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "ready");
        yield* startRun({ landing: "check" });
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
        assert.strictEqual(read(world.root, "ok.txt"), "ok\n");
      }),
    ),
  );

  it.live(
    "an accepted task whose landing finds your tree moved merges again and lands, without a second review",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun({ landing: "lead" });
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          write(world.root, "docs/person.md", "person\n");
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "person edits"]);
          yield* world.publish(spiEvent("turn.started", lead, {}));
          yield* (yield* CrewToolHost).review(yield* memberOf(lead), {
            task: 1,
            verdict: "accept",
            note: "Looks right.",
          });
          yield* world.publish(spiEvent("turn.completed", lead, { state: "completed" }));
          yield* snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
          yield* drained;
          assert.deepStrictEqual(
            [
              read(world.root, "ok.txt"),
              read(world.root, "docs/person.md"),
              yield* wakes(world, lead),
            ],
            ["ok\n", "person\n", 1],
          );
        }),
      ),
  );

  it.live("a task back from rework is reviewed afresh, its earlier accept gone", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        const lead = yield* memberOf(yield* leadThread(world));
        yield* (yield* CrewToolHost).propose(lead, [PLAN[0]!]);
        const store = yield* CrewStore;
        const [row] = yield* store.assignments(CREW_ID);
        // Start with the retained rework outcome, without a merge/check still holding the copy.
        yield* store.putAssignment({
          ...row!,
          state: "rework",
          attempt: 1,
          review: { verdict: "accept", note: "Fine.", by: "lead" },
          waiting: { on: "conflict", reason: null, paths: ["ok.txt"] },
        });
        yield* command({ _tag: "askResolve", taskId: row!.assignment });
        const reworking = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          [reworking.board.tasks[0]!.attempts, reworking.board.tasks[0]!.review],
          [2, null],
        );
        yield* startRun({ landing: "lead" });
        const thread = (yield* dispatchedOf(world, "thread.turn.start")).find(
          (turn) =>
            turn.threadId ===
            reworking.crewmates.find((mate) => mate.handle === "backend")!.currentThreadId,
        )!.threadId;
        yield* world.publish(spiEvent("turn.started", thread, {}));
        write(world.root, ".crew/backend/ok.txt", "ok\n");
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const reviewed = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "review",
        );
        assert.deepStrictEqual(
          [reviewed.board.tasks[0]!.attempts, reviewed.board.tasks[0]!.review],
          [2, null],
        );
      }),
    ),
  );

  it.live("the lead's reject sends the task back to its crewmate with the note", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun({ landing: "lead" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "review");
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "review @backend's work");
        yield* (yield* CrewToolHost).review(yield* memberOf(lead), {
          task: 1,
          verdict: "reject",
          note: "Name the file hud.ts.",
        });
        const reworked = yield* snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 2,
        );
        const rework = yield* lastTurnText(world, thread);
        assert.deepStrictEqual(
          [rework.includes("rework after review"), rework.includes("Name the file hud.ts.")],
          [true, true],
        );
        assert.strictEqual(reworked.board.tasks[0]!.review?.verdict, "reject");
      }),
    ),
  );

  it.live("a crewmate's question goes to the lead first; the lead's reply is its answer", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun();
        const thread = yield* firstTurn(world, () => undefined);
        yield* (yield* CrewToolHost).report(yield* memberOf(thread), {
          status: "blocked",
          summary: "Which currency?",
          question: "CZK or EUR?",
        });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const blocked = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "blocked",
        );
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "@backend asks");
        const wake = yield* lastTurnText(world, lead);
        yield* leadReplies(world, lead, "Use EUR.");
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "working");
        assert.deepStrictEqual(
          {
            waiting: blocked.attention,
            wake: wake.includes("@backend asks") && wake.includes("CZK or EUR?"),
            answer: (yield* lastTurnText(world, thread)).split("\n").slice(1),
          },
          {
            waiting: [],
            wake: true,
            answer: ["#1 Change a.txt · answer from @lead", "Use EUR."],
          },
        );
      }),
    ),
  );

  it.live(
    "a question the lead passes on reaches you at once; the next one waits on the lead again",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun();
          const thread = yield* firstTurn(world, () => undefined);
          yield* (yield* CrewToolHost).report(yield* memberOf(thread), {
            status: "blocked",
            summary: "Which currency?",
            question: "CZK or EUR?",
          });
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "@backend asks");
          yield* (yield* CrewToolHost).report(yield* memberOf(lead), {
            status: "blocked",
            summary: "The person decides the currency.",
            question: "CZK or EUR?",
          });
          yield* world.publish(spiEvent("turn.completed", lead, { state: "completed" }));
          const asked = yield* snapshotWhere((current) => current.attention.length === 1);
          yield* command({
            _tag: "answer",
            handle: "backend",
            taskId: asked.attention[0]!.taskId,
            text: "EUR.",
          });
          yield* world.publish(spiEvent("turn.started", thread, {}));
          yield* (yield* CrewToolHost).report(yield* memberOf(thread), {
            status: "blocked",
            summary: "Which font?",
            question: "Serif or sans?",
          });
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          // The new question waits on the lead (its wake keeps two minutes from the last), not on you.
          assert.deepStrictEqual(
            [
              asked.attention.map((row) => [row.kind, row.handle, row.text]),
              (yield* snapshotWhere(
                (current) => current.board.tasks[0]?.question === "Serif or sans?",
              )).attention,
            ],
            [[["question", "backend", "CZK or EUR?"]], []],
          );
        }),
      ),
  );

  it.live("the lead's own question waits on you, and your answer reaches the lead", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* leadThread(world);
        yield* (yield* CrewToolHost).report(yield* memberOf(lead), {
          status: "blocked",
          summary: "Mobile first?",
        });
        yield* world.publish(spiEvent("turn.completed", lead, { state: "completed" }));
        const asked = yield* snapshotWhere((current) => current.attention.length === 1);
        yield* command({ _tag: "answer", handle: "lead", taskId: null, text: "Desktop first." });
        const answered = yield* snapshotWhere((current) => current.attention.length === 0);
        assert.deepStrictEqual(
          [
            asked.attention.map((row) => [row.kind, row.handle, row.taskId, row.text]),
            answered.attention,
            yield* lastTurnText(world, lead),
          ],
          [[["question", "lead", null, "Mobile first?"]], [], "Desktop first."],
        );
      }),
    ),
  );

  it.live("crew_finish ends the run", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun();
        yield* command({ _tag: "message", handle: "lead", text: "Wrap up", attachments: [] });
        const answer = yield* (yield* CrewToolHost).finish(
          yield* memberOf(yield* leadThread(world)),
          { summary: "Every Done when line is met." },
        );
        const finished = yield* snapshotWhere((current) => current.run?.state === "finished");
        assert.deepStrictEqual(
          [answer.text, finished.run!.state],
          ["The run is finished.", "finished"],
        );
      }),
    ),
  );

  it.live(
    "a restart wakes the lead again for a pending review only two minutes after its last wake",
    () => {
      let before = 0;
      return withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* withLead(world);
            yield* startRun({ landing: "lead" });
            const thread = yield* firstTurn(world, () =>
              write(world.root, ".crew/backend/ok.txt", "ok\n"),
            );
            yield* reportDone(thread);
            yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
            yield* wokenWith(world, yield* leadThread(world), "review @backend's work");
            before = yield* wakes(world, yield* leadThread(world));
          }),
        (world) =>
          Effect.gen(function* () {
            yield* (yield* ServerCommandReadiness).complete;
            yield* booted;
            yield* drained;
            assert.deepStrictEqual([before, yield* wakes(world, yield* leadThread(world))], [1, 1]);
          }),
      ]);
    },
  );

  it.live("a person's own turn to the lead in a run keeps its row after a restart", () =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun();
          yield* snapshotWhere((current) => current.run?.state === "running");
          yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
          yield* leadThread(world);
        }),
      () =>
        Effect.gen(function* () {
          yield* (yield* ServerCommandReadiness).complete;
          yield* booted;
          const kept = yield* snapshotWhere((current) =>
            current.attention.some((need) => need.kind === "interrupted" && need.handle === "lead"),
          );
          yield* drained;
          const still = yield* snapshotWhere(() => true);
          assert.isTrue(
            still.attention.some(
              (need) =>
                need.kind === "interrupted" &&
                need.operation?.id ===
                  kept.attention.find((row) => row.kind === "interrupted")!.operation!.id,
            ),
          );
        }),
    ]),
  );

  it.live("the lead's own question still waits on you after a restart", () =>
    withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
          const lead = yield* leadThread(world);
          yield* (yield* CrewToolHost).report(yield* memberOf(lead), {
            status: "blocked",
            summary: "Mobile first?",
          });
          yield* snapshotWhere((current) => current.attention.length === 1);
        }),
      () =>
        Effect.gen(function* () {
          const waiting = yield* snapshotWhere((current) =>
            current.attention.some((need) => need.kind === "question"),
          );
          assert.deepStrictEqual(
            waiting.attention
              .filter((row) => row.kind === "question")
              .map((row) => [row.kind, row.handle, row.text]),
            [["question", "lead", "Mobile first?"]],
          );
          const interruption = waiting.attention.find(
            (need) => need.kind === "interrupted",
          )!.operation!;
          yield* command({ _tag: "answer", handle: "lead", taskId: null, text: "Mobile first." });
          const settled = yield* (yield* CrewStore).getOperation(interruption.id);
          assert.strictEqual(settled._tag === "Some" ? settled.value.status : null, "continued");
        }),
    ]),
  );

  it.live("the lead's wakes stand at least two minutes apart", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun({ landing: "lead" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* (yield* CrewToolHost).report(yield* memberOf(thread), {
          status: "blocked",
          summary: "Which currency?",
          question: "CZK or EUR?",
        });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "@backend asks");
        yield* leadReplies(world, lead, "Use EUR.");
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "working");
        yield* world.publish(spiEvent("turn.started", thread, {}));
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "review");
        yield* drained;
        const wakes = (yield* dispatchedOf(world, "thread.turn.start")).filter(
          (turn) => turn.threadId === lead,
        );
        assert.strictEqual(wakes.length, 1);
      }),
    ),
  );
});
