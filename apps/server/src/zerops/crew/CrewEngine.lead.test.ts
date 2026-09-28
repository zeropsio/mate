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
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { read, write } from "./testing/crewGitFixture.ts";

const RUN: CrewRunOptions = {
  budgetUsd: "unlimited",
  timeLimitHours: "unlimited",
  stopAtUsagePercent: null,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

/** A crew with a lead and a writer, applied. */
const withLead = (world: CrewWorld) =>
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
        "    check: test -f ok.txt",
        "",
      ].join("\n"),
      "jobs/lead.md": "Plan the work.\n",
    });
    yield* command({ _tag: "apply" });
    yield* eventually(Effect.map(latest, everyCopyReady));
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
            answer: "#1 is accepted.",
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
            yield* snapshotWhere((current) => current.run?.state === "running");
            yield* Effect.sleep("500 millis");
            assert.deepStrictEqual([before, yield* wakes(world, yield* leadThread(world))], [1, 1]);
          }),
      ]);
    },
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
          const waiting = yield* snapshotWhere((current) => current.attention.length === 1);
          assert.deepStrictEqual(
            waiting.attention.map((row) => [row.kind, row.handle, row.text]),
            [["question", "lead", "Mobile first?"]],
          );
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
        yield* Effect.sleep("500 millis");
        const wakes = (yield* dispatchedOf(world, "thread.turn.start")).filter(
          (turn) => turn.threadId === lead,
        );
        assert.strictEqual(wakes.length, 1);
      }),
    ),
  );
});
